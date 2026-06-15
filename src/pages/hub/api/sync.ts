import type { APIRoute } from 'astro';
import { readHubEnv } from '../../../lib/hub/hub-env';
import { getCookie } from '../../../lib/hub/cookies';
import { verifySession, SESSION_COOKIE } from '../../../lib/hub/session';
import { getHubSupabase } from '../../../lib/hub/hub-supabase';
import {
  validateSyncPayload,
  readColumn,
  emptyColumn,
  isWeekKey,
  COLUMN_KEYS,
  type ColumnData,
} from '../../../lib/hub/sync-data';

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

  // 2) Parse + validate + sanitize the body (HTML allowlist, count/length caps).
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { ok: false, error: 'invalid-json' });
  }
  const parsed = validateSyncPayload(raw);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.reason });

  // 3) Persist (service-role; RLS-on table, no public policy).
  const supabase = getHubSupabase(env);
  if (!supabase) return json(503, { ok: false, error: 'storage-unconfigured' });

  const now = Math.floor(Date.now() / 1000);
  const { weekKey, columnKey, column } = parsed.value;
  // Persist the SECTIONS ARRAY (the table CHECK-constrains `items` to a JSON
  // array). readColumn re-wraps it into a ColumnData on the way out.
  const { error } = await supabase
    .from('hub_weekly_sync')
    .upsert(
      { week_key: weekKey, column_key: columnKey, items: column.sections, updated_by: email, updated_at: new Date(now * 1000).toISOString() },
      { onConflict: 'week_key,column_key' },
    );
  if (error) {
    console.error('[/hub/api/sync] upsert failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }
  return json(200, { ok: true });
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
    .select('column_key, items')
    .eq('week_key', week);
  if (error) {
    console.error('[/hub/api/sync GET week] read failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }

  const columns: Record<string, ColumnData> = {};
  for (const key of COLUMN_KEYS) columns[key] = emptyColumn();
  for (const row of data ?? []) {
    const r = row as { column_key: string; items: unknown };
    if ((COLUMN_KEYS as readonly string[]).includes(r.column_key)) {
      columns[r.column_key] = readColumn(r.items);
    }
  }
  return json(200, { ok: true, week, columns });
};
