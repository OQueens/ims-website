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
});
