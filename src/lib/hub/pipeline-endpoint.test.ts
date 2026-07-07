// src/lib/hub/pipeline-endpoint.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from '../../pages/hub/api/pipeline';
import { signSession } from './session';

// A fake Supabase client whose query chain resolves with a controllable
// {data,error}. Drives the GET error-classification branch (#6) without a live DB.
// The chain (from→select→order→eq/in→await) all returns the same thenable `q`,
// whose `then` reads the mutable `state.result` at await time.
const state = vi.hoisted(() => ({ result: { data: [] as unknown[] | null, error: null as unknown }, clientNull: false }));
vi.mock('./hub-supabase', () => {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  Object.assign(q, {
    select: chain, order: chain, eq: chain, in: chain,
    then: (resolve: (v: unknown) => unknown) => resolve(state.result),
  });
  return { getHubSupabase: () => (state.clientNull ? null : { from: () => q, rpc: async () => state.result }) };
});

const SECRET = 'test-secret-0123456789-abcdef';
const authedLocals = {
  runtime: { env: { HUB_SESSION_SECRET: SECRET, HUB_SESSION_GENERATION: '1', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' } },
};

async function signedCookie() {
  const now = Math.floor(Date.now() / 1000);
  return 'hub_session=' + (await signSession('zach@iastaffing.com', 'Zach', SECRET, now));
}
async function getWithCookie(view: 'active' | 'archived' = 'active') {
  const headers = new Headers({ Accept: 'application/json' });
  headers.set('cookie', await signedCookie());
  const request = new Request('https://x/hub/api/pipeline?view=' + view, { method: 'GET', headers });
  return GET({ request, locals: authedLocals } as never);
}

// ── Auth (no DB needed) — unchanged baseline coverage ─────────────────────────
const locals = {} as App.Locals;
const req = (body?: unknown, url = 'https://x/hub/api/pipeline') =>
  new Request(url, { method: body !== undefined ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

describe('/hub/api/pipeline', () => {
  it('POST without a session → 401', async () => {
    const res = await POST({ request: req({ op: { type: 'archivePerson', id: 'p1' } }), locals } as any);
    expect(res.status).toBe(401);
  });
  it('GET without a session → 401', async () => {
    const res = await GET({ request: req(undefined), locals } as any);
    expect(res.status).toBe(401);
  });
});

// ── #6: distinguish a missing table (degrade) from a transient read error (5xx) ─
// Bug: the GET returned 200 {ok:true,people:[]} on ANY read error, so a transient
// blip looked identical to a pre-migration empty board → the ~4s poll ran its
// active-cleanup and BLANKED the whole board for ~4s. A missing table must still
// degrade gracefully; a transient error must surface as 5xx so the poll skips.
describe('/hub/api/pipeline GET error classification (#6 board-wipe fix)', () => {
  beforeEach(() => { state.result = { data: [], error: null }; state.clientNull = false; });

  it('storage unconfigured (no Supabase env) → 503, NOT an empty board', async () => {
    state.clientNull = true;  // getHubSupabase returns null
    const res = await getWithCookie();
    expect(res.status).toBe(503);
    const b = await res.json();
    expect(b.ok).toBe(false);
    expect(b.error).toBe('storage-unconfigured');
    expect(b.people).toBeUndefined();
  });

  it('missing table (Postgres 42P01) → 200 empty board (graceful pre-migration degrade)', async () => {
    state.result = { data: null, error: { code: '42P01', message: 'relation "hub_pipeline_people" does not exist' } };
    const res = await getWithCookie();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, people: [] });
  });

  it('missing table (PostgREST PGRST205 schema-cache miss) → 200 empty board', async () => {
    state.result = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.hub_pipeline_people' in the schema cache" } };
    const res = await getWithCookie();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, people: [] });
  });

  it('transient read error (statement timeout 57014) → 502, NOT an empty board', async () => {
    state.result = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const res = await getWithCookie();
    expect(res.status).toBe(502);
    const b = await res.json();
    expect(b.ok).toBe(false);
    expect(b.people).toBeUndefined();
  });

  it('transient network error (empty/undefined code) → 502', async () => {
    state.result = { data: null, error: { code: '', message: 'fetch failed' } };
    const res = await getWithCookie();
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });

  it('happy path (no error) → 200 with mapped people', async () => {
    state.result = { data: [], error: null };
    const res = await getWithCookie();
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.ok).toBe(true);
    expect(Array.isArray(b.people)).toBe(true);
  });
});
