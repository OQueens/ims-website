import type { APIRoute } from 'astro';
import { readHubEnv } from '../../../lib/hub/hub-env';
import { getCookie } from '../../../lib/hub/cookies';
import { verifySession, SESSION_COOKIE } from '../../../lib/hub/session';
import { getHubSupabase } from '../../../lib/hub/hub-supabase';
import { validateSyncPayload } from '../../../lib/hub/sync-data';

// Weekly Sync write endpoint. Lives UNDER /hub so the Path=/hub session cookie
// is sent AND the middleware hub guard applies (a second auth layer). Persists
// one team column for one week to hub_weekly_sync. prerender=false → SSR/Function.
export const prerender = false;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = readHubEnv(locals);

  // 1) Authenticate via the hub session cookie (defense-in-depth atop the
  //    middleware guard; also yields the writer's email for the audit column).
  const token = getCookie(request.headers.get('cookie'), SESSION_COOKIE);
  const now = Math.floor(Date.now() / 1000);
  const session = token && env.HUB_SESSION_SECRET
    ? await verifySession(token, env.HUB_SESSION_SECRET, now, env.HUB_SESSION_GENERATION)
    : null;
  if (!session) return json(401, { ok: false, error: 'unauthorized' });

  // 2) Parse + validate the body.
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

  const { weekKey, columnKey, items } = parsed.value;
  const { error } = await supabase
    .from('hub_weekly_sync')
    .upsert(
      { week_key: weekKey, column_key: columnKey, items, updated_by: session.email, updated_at: new Date(now * 1000).toISOString() },
      { onConflict: 'week_key,column_key' },
    );
  if (error) {
    console.error('[/hub/api/sync] upsert failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }
  return json(200, { ok: true });
};
