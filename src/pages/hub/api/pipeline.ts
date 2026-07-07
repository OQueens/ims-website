// src/pages/hub/api/pipeline.ts
import type { APIRoute } from 'astro';
import { readHubEnv } from '../../../lib/hub/hub-env';
import { getCookie } from '../../../lib/hub/cookies';
import { verifySession, SESSION_COOKIE } from '../../../lib/hub/session';
import { getHubSupabase } from '../../../lib/hub/hub-supabase';
import { readPerson, BOARD_STAGES } from '../../../lib/hub/pipeline-data';
import { validateOp } from '../../../lib/hub/pipeline-ops';

// Recruitment & Credentialing pipeline read/write endpoint. UNDER /hub so the
// Path=/hub session cookie is sent AND the middleware guard applies (401 JSON).
//   POST                → apply ONE op atomically via hub_pipeline_apply.
//   GET ?view=active    → all non-archived people (board). ?view=archived → archive.
export const prerender = false;

const SELECT = 'id, stage, full_name, specialty_slug, specialty_name, state, phone, email, owner_email, target_start_date, assignment_id, assignment_number, assignment_label, chk_collecting_docs, chk_needs_contract, chk_start_dates_booked, chk_credentialing_started, chk_credentialing_complete, chk_provider_working, checklist_audit, notes, version, updated_by, updated_at';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// A read error whose code marks the TABLE itself as absent (pre-migration): raw
// Postgres undefined_table (42P01) or PostgREST's schema-cache miss (PGRST205).
// ONLY these degrade the GET to an empty board; every other error is transient
// and must surface as 5xx (see GET below).
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);
const isMissingTable = (error: { code?: string | null } | null): boolean =>
  !!error && MISSING_TABLE_CODES.has(error.code ?? '');

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
  const email = await authedEmail(request, env);
  if (!email) return json(401, { ok: false, error: 'unauthorized' });

  let raw: unknown;
  try { raw = await request.json(); } catch { return json(400, { ok: false, error: 'invalid-json' }); }
  const parsed = validateOp((raw as { op?: unknown })?.op);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.reason });

  const supabase = getHubSupabase(env);
  if (!supabase) return json(503, { ok: false, error: 'storage-unconfigured' });

  // deletePerson is a HARD delete (row removed) — for test/mistyped entries. It
  // does not go through hub_pipeline_apply (no version/merge needed for a terminal
  // removal); a direct delete by id on the service-role client is sufficient.
  if (parsed.op.type === 'deletePerson') {
    const { error } = await supabase.from('hub_pipeline_people').delete().eq('id', parsed.op.id);
    if (error) {
      console.error('[/hub/api/pipeline POST delete] failed:', error.message);
      return json(502, { ok: false, error: 'storage-failed' });
    }
    return json(200, { ok: true, person: null, deleted: true });
  }

  const { data, error } = await supabase.rpc('hub_pipeline_apply', { p_op: parsed.op, p_email: email });
  if (error) {
    console.error('[/hub/api/pipeline POST] rpc failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json(200, { ok: true, person: null, version: 0 });
  const person = readPerson(row);
  return json(200, { ok: true, person, version: person.version });
};

export const GET: APIRoute = async ({ request, locals }) => {
  const env = readHubEnv(locals);
  const email = await authedEmail(request, env);
  if (!email) return json(401, { ok: false, error: 'unauthorized' });

  const url = new URL(request.url);
  const archived = url.searchParams.get('view') === 'archived';
  const supabase = getHubSupabase(env);
  // Unconfigured storage is a 503, NOT a 200-empty — a 200-empty looks like a
  // real (empty) board to the client poll, which would then run active-cleanup
  // and BLANK the board. Mirrors POST + the sync.ts GET; the poll skips on 503.
  if (!supabase) return json(503, { ok: false, error: 'storage-unconfigured' });

  let q = supabase.from('hub_pipeline_people').select(SELECT).order('updated_at', { ascending: false, nullsFirst: false });
  q = archived ? q.eq('stage', 'archived') : q.in('stage', BOARD_STAGES as unknown as string[]);
  const { data, error } = await q;
  if (error) {
    // A genuinely-missing table (pre-migration) degrades to an empty board. ANY
    // other error is transient and MUST surface as 5xx — otherwise a blip looks
    // identical to an empty board and the client's ~4s poll runs active-cleanup,
    // BLANKING the whole board for ~4s. The poll skips on !res.ok / !body.ok, so a
    // 502 leaves the last-good board intact until the next healthy read (#6).
    if (isMissingTable(error)) return json(200, { ok: true, people: [] });
    console.error('[/hub/api/pipeline GET] read failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }
  return json(200, { ok: true, people: (data ?? []).map(readPerson) });
};
