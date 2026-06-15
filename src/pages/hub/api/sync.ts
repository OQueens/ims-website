import type { APIRoute } from 'astro';
import { readHubEnv } from '../../../lib/hub/hub-env';
import { getCookie } from '../../../lib/hub/cookies';
import { verifySession, SESSION_COOKIE } from '../../../lib/hub/session';
import { getHubSupabase } from '../../../lib/hub/hub-supabase';
import {
  sanitizeHtml,
  readColumn,
  isWeekKey,
  COLUMN_KEYS,
  type ColumnData,
} from '../../../lib/hub/sync-data';
import { validateOp } from '../../../lib/hub/sync-ops';

// Weekly Sync read/write endpoint. Lives UNDER /hub so the Path=/hub session
// cookie is sent AND the middleware hub guard applies (a second auth layer that
// now returns 401 JSON, not a 302). prerender=false → SSR/Function.
//   POST            → persist one team column for one week (v2 sections shape).
//   GET ?week=KEY   → read that week's three columns (used by live poll + history).
//   GET ?list=1     → list the distinct week_keys present (history picker).
export const prerender = false;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

async function authedEmail(request: Request, env: ReturnType<typeof readHubEnv>): Promise<string | null> {
  const token = getCookie(request.headers.get('cookie'), SESSION_COOKIE);
  const now = Math.floor(Date.now() / 1000);
  const session = token && env.HUB_SESSION_SECRET
    ? await verifySession(token, env.HUB_SESSION_SECRET, now, env.HUB_SESSION_GENERATION)
    : null;
  return session ? session.email : null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = readHubEnv(locals);

  // 1) Authenticate (defense-in-depth atop the middleware guard; also yields the
  //    writer's email for the audit column).
  const email = await authedEmail(request, env);
  if (!email) return json(401, { ok: false, error: 'unauthorized' });

  // 2) Parse + validate the single-intent op.
  let raw: unknown;
  try { raw = await request.json(); } catch { return json(400, { ok: false, error: 'invalid-json' }); }
  const r = raw as { weekKey?: unknown; columnKey?: unknown; op?: unknown };
  if (!isWeekKey(r.weekKey)) return json(400, { ok: false, error: 'bad-week-key' });
  if (typeof r.columnKey !== 'string' || !(COLUMN_KEYS as readonly string[]).includes(r.columnKey)) return json(400, { ok: false, error: 'bad-column' });
  const parsed = validateOp(r.op);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.reason });

  // Sanitize html the op carries BEFORE the DB (the RPC stores raw).
  const op = parsed.op.type === 'upsertFocus'
    ? { ...parsed.op, focus: { ...parsed.op.focus, html: sanitizeHtml(parsed.op.focus.html) } }
    : parsed.op;

  // 3) Apply atomically via the RPC (service-role).
  const supabase = getHubSupabase(env);
  if (!supabase) return json(503, { ok: false, error: 'storage-unconfigured' });
  const { data, error } = await supabase.rpc('hub_sync_apply', {
    p_week: r.weekKey, p_col: r.columnKey, p_op: op, p_email: email,
  });
  if (error) {
    console.error('[/hub/api/sync POST] rpc failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }
  const row = Array.isArray(data) ? data[0] : data;
  const column = readColumn(row?.r_items);
  return json(200, { ok: true, columnKey: r.columnKey, version: row?.r_version ?? 0, column });
};

export const GET: APIRoute = async ({ request, locals }) => {
  const env = readHubEnv(locals);
  const email = await authedEmail(request, env);
  if (!email) return json(401, { ok: false, error: 'unauthorized' });

  const url = new URL(request.url);
  const supabase = getHubSupabase(env);

  // ?list=1 → distinct week keys present, newest first (history picker).
  if (url.searchParams.get('list') !== null) {
    if (!supabase) return json(503, { ok: false, error: 'storage-unconfigured' });
    const { data, error } = await supabase.from('hub_weekly_sync').select('week_key');
    if (error) {
      console.error('[/hub/api/sync GET list] read failed:', error.message);
      return json(502, { ok: false, error: 'storage-failed' });
    }
    const weeks = Array.from(new Set((data ?? []).map((r) => (r as { week_key: string }).week_key)))
      .filter(isWeekKey)
      .sort()
      .reverse();
    return json(200, { ok: true, weeks });
  }

  // ?week=KEY → that week's three columns (live poll + history view).
  const week = url.searchParams.get('week');
  if (!isWeekKey(week)) return json(400, { ok: false, error: 'bad-week-key' });
  if (!supabase) return json(503, { ok: false, error: 'storage-unconfigured' });

  const { data, error } = await supabase
    .from('hub_weekly_sync')
    .select('column_key, items, version')
    .eq('week_key', week);
  if (error) {
    console.error('[/hub/api/sync GET week] read failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }

  const columns: Record<string, { v: 3; version: number; sections: ColumnData['sections'] }> = {};
  for (const key of COLUMN_KEYS) columns[key] = { v: 3, version: 0, sections: [] };
  for (const row of data ?? []) {
    const rr = row as { column_key: string; items: unknown; version: number | null };
    if ((COLUMN_KEYS as readonly string[]).includes(rr.column_key)) {
      columns[rr.column_key] = { v: 3, version: rr.version ?? 0, sections: readColumn(rr.items).sections };
    }
  }
  return json(200, { ok: true, week, columns });
};
