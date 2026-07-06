// src/lib/hub/pipeline-rpc.integration.test.ts
// Parity: the SQL RPC must agree with the TS oracle applyOp on the row fields.
// Runs ONLY when SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_ROLE_KEY are set
// against a database that already has the 20260705 migration applied; otherwise
// it is skipped (the migration is applied to prod out-of-band by Zach).
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { applyOp, type PipelineOp } from './pipeline-ops';
import { readPerson } from './pipeline-data';

const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
// Fail loud on a partial config rather than masquerading as a pass (mirrors the
// sibling sync-rpc.integration.test.ts): both creds, or neither.
if (Boolean(URL) !== Boolean(KEY)) {
  throw new Error('pipeline-rpc.integration: set BOTH SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY, or neither');
}
const RUN = Boolean(URL && KEY);
const run = RUN ? describe : describe.skip;
const EMAIL = 'test@iastaffing.com';

run('hub_pipeline_apply parity', () => {
  // Only build the client when actually running — a skipped suite is still
  // evaluated by vitest during collection, and createClient(undefined) throws
  // (same guard as sync-rpc.integration.test.ts).
  const db: SupabaseClient = RUN ? createClient(URL!, KEY!, { auth: { persistSession: false } }) : (null as unknown as SupabaseClient);
  const compare = (a: unknown, b: unknown) => {
    const strip = (r: Record<string, unknown>) => { const { version, updated_at, updated_by, created_at, ...rest } = r; return rest; };
    expect(strip(readPerson(a) as unknown as Record<string, unknown>)).toEqual(strip(readPerson(b) as unknown as Record<string, unknown>));
  };
  const rpc = async (op: PipelineOp) => {
    const { data, error } = await db.rpc('hub_pipeline_apply', { p_op: op, p_email: EMAIL });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data[0] : data;
  };

  it('create → toggle provider_working → parity with oracle', async () => {
    const id = crypto.randomUUID();
    const created = await rpc({ type: 'createPerson', input: { id, full_name: 'Parity Test', stage: 'active_bid' } });
    let oracle = applyOp(null, { type: 'createPerson', input: { id, full_name: 'Parity Test', stage: 'active_bid' } }, { email: EMAIL, now: 0 })!;
    compare(created, oracle);

    const toggled = await rpc({ type: 'toggleChecklist', id, item: 'provider_working', value: true });
    oracle = applyOp(oracle, { type: 'toggleChecklist', id, item: 'provider_working', value: true }, { email: EMAIL, now: 0 })!;
    compare(toggled, oracle);
    expect(readPerson(toggled).stage).toBe('placed');

    await db.from('hub_pipeline_people').delete().eq('id', id);
  });

  it('moveStage / archive / restore mirror the oracle incl. the working⟺placed invariant', async () => {
    const id = crypto.randomUUID();
    const mk = { type: 'createPerson', input: { id, full_name: 'Move Parity', stage: 'warm_lead' } } as const;
    let oracle = applyOp(null, mk, { email: EMAIL, now: 0 })!;
    await rpc(mk);

    const placed = await rpc({ type: 'moveStage', id, stage: 'placed' });
    oracle = applyOp(oracle, { type: 'moveStage', id, stage: 'placed' }, { email: EMAIL, now: 0 })!;
    compare(placed, oracle);
    expect(readPerson(placed).chk_provider_working).toBe(true); // invariant

    const back = await rpc({ type: 'moveStage', id, stage: 'accepted_bid' });
    oracle = applyOp(oracle, { type: 'moveStage', id, stage: 'accepted_bid' }, { email: EMAIL, now: 0 })!;
    compare(back, oracle);
    expect(readPerson(back).chk_provider_working).toBe(false); // invariant

    const archived = await rpc({ type: 'archivePerson', id });
    oracle = applyOp(oracle, { type: 'archivePerson', id }, { email: EMAIL, now: 0 })!;
    compare(archived, oracle);

    const restored = await rpc({ type: 'restorePerson', id, stage: 'needs_onboarding' });
    oracle = applyOp(oracle, { type: 'restorePerson', id, stage: 'needs_onboarding' }, { email: EMAIL, now: 0 })!;
    compare(restored, oracle);

    await db.from('hub_pipeline_people').delete().eq('id', id);
  });

  it('malformed date/uuid/id DEGRADE to null or no-op — never throw (graceful-degradation contract)', async () => {
    const id = crypto.randomUUID();
    // createPerson with a malformed date stores NULL (not a 502).
    await rpc({ type: 'createPerson', input: { id, full_name: 'Degrade Test', stage: 'warm_lead', target_start_date: 'not-a-date' } });
    const { data: created } = await db.from('hub_pipeline_people').select('*').eq('id', id).single();
    expect(readPerson(created).target_start_date).toBeNull();

    // updateField: malformed date → null; malformed uuid → null; both without throwing.
    expect(readPerson(await rpc({ type: 'updateField', id, field: 'target_start_date', value: 'garbage' })).target_start_date).toBeNull();
    expect(readPerson(await rpc({ type: 'updateField', id, field: 'assignment_id', value: 'not-a-uuid' })).assignment_id).toBeNull();

    // A mutating op with a NON-UUID id is a graceful no-op (error null, empty rows), not a 502.
    const { data: noop, error: noopErr } = await db.rpc('hub_pipeline_apply', { p_op: { type: 'archivePerson', id: 'definitely-not-a-uuid' }, p_email: EMAIL });
    expect(noopErr).toBeNull();
    expect(Array.isArray(noop) ? noop.length : noop).toBeFalsy();

    // A well-formed value still round-trips.
    expect(readPerson(await rpc({ type: 'updateField', id, field: 'target_start_date', value: '2026-08-01' })).target_start_date).toBe('2026-08-01');

    await db.from('hub_pipeline_people').delete().eq('id', id);
  });
});
