// Integration test: the hub_sync_apply Postgres RPC must agree with the pure-TS
// applyOp oracle (sync-ops.ts), op-for-op, AND must never lose a concurrent edit.
//
// GATED + FAIL-LOUD. It only runs when RUN_DB_IT=1 AND the real prod-DB creds are
// in the env; if RUN_DB_IT=1 but the creds are missing it THROWS rather than
// silently masquerading as a pass. With no env it cleanly `describe.skip`s — and
// crucially does NOT construct the Supabase client in that case (createClient
// throws on an undefined url even inside a skipped suite, because vitest still
// evaluates the suite factory during collection). Run it against the real DB
// (PowerShell) only AFTER the migration is applied:
//
//   $env:RUN_DB_IT='1'; $env:SUPABASE_URL='<from .dev.vars>';
//   $env:SUPABASE_SERVICE_ROLE_KEY='<from .dev.vars>';
//   npx vitest run src/lib/hub/sync-rpc.integration.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { applyOp, type SyncOp } from './sync-ops';
import { readColumn, emptyColumn, type ColumnData } from './sync-data';

const RUN = process.env.RUN_DB_IT === '1';
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEEK = '9999-W99', COL = 'recruiting';

(RUN ? describe : describe.skip)('hub_sync_apply RPC == applyOp oracle (real DB)', () => {
  if (RUN && (!url || !key)) throw new Error('RUN_DB_IT=1 but SUPABASE_URL/SERVICE_ROLE_KEY missing — refusing to masquerade as a pass');
  // Only build the client when actually running — a skipped suite is still
  // evaluated by vitest during collection, and createClient(undefined) throws.
  const sb: SupabaseClient = RUN ? createClient(url!, key!) : (null as unknown as SupabaseClient);
  afterAll(async () => { if (sb) await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK); });

  const strip = (c: ColumnData) => c.sections.map((s) => ({ id: s.id, title: s.title, by: s.by,
    focuses: s.focuses.map((f) => ({ id: f.id, html: f.html, by: f.by, editedBy: f.editedBy })) }));

  it('an op sequence yields identical items in DB and oracle (incl. distinct editor, special-char title, hostile html)', async () => {
    await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK);
    let oracle: ColumnData = emptyColumn();
    // endpoint sanitizes upsert html before the RPC; mirror that here:
    const { sanitizeHtml } = await import('./sync-data');
    const opForDb = (op: SyncOp): SyncOp => op.type === 'upsertFocus' ? { ...op, focus: { ...op.focus, html: sanitizeHtml(op.focus.html) } } : op;
    const apply = async (op: SyncOp, email: string) => {
      const { error } = await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: opForDb(op), p_email: email });
      expect(error).toBeNull();
      oracle = applyOp(oracle, op, { email, now: 0 });
    };

    await apply({ type: 'addSection', section: { id: 'secAAA', title: 'Pipe<b>&line' } }, 'zach@iastaffing.com');
    await apply({ type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focAAA', html: 'Call <b>CHS</b>' } }, 'zach@iastaffing.com');
    await apply({ type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focBAD', html: '<script>alert(1)</script>hi' } }, 'zach@iastaffing.com');
    await apply({ type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focAAA', html: 'Call CHS (synced)' } }, 'matt@iastaffing.com'); // edit by DIFFERENT user
    await apply({ type: 'deleteFocus', sectionId: 'secAAA', focusId: 'focBAD' }, 'zach@iastaffing.com');
    await apply({ type: 'setSectionTitle', sectionId: 'secAAA', title: 'Pipe<line' }, 'zach@iastaffing.com');

    const { data } = await sb.from('hub_weekly_sync').select('items').eq('week_key', WEEK).eq('column_key', COL).single();
    const dbCol = readColumn(data!.items);
    expect(strip(dbCol)).toEqual(strip(oracle));
    // editedBy is the DISTINCT editor, not the author:
    const edited = dbCol.sections[0].focuses.find((f) => f.id === 'focAAA')!;
    expect(edited.by).toBe('zach@iastaffing.com');
    expect(edited.editedBy).toBe('matt@iastaffing.com');
  });

  it('two concurrent upserts to DIFFERENT focuses both survive (the no-lost-update guarantee)', async () => {
    await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK);
    await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'addSection', section: { id: 'secCON', title: '' } }, p_email: 'a@iastaffing.com' });
    await Promise.all([
      sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'upsertFocus', sectionId: 'secCON', focus: { id: 'fX', html: 'X' } }, p_email: 'a@iastaffing.com' }),
      sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'upsertFocus', sectionId: 'secCON', focus: { id: 'fY', html: 'Y' } }, p_email: 'b@iastaffing.com' }),
    ]);
    const { data } = await sb.from('hub_weekly_sync').select('items').eq('week_key', WEEK).eq('column_key', COL).single();
    expect(readColumn(data!.items).sections[0].focuses.map((f) => f.id).sort()).toEqual(['fX', 'fY']);
  });

  it('re-applying an identical create op does NOT bump version or add editedBy (idempotent)', async () => {
    await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK);
    await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'addSection', section: { id: 'secIDEM' } }, p_email: 'a@iastaffing.com' });
    const op = { type: 'upsertFocus', sectionId: 'secIDEM', focus: { id: 'fI', html: 'same' } };
    const r1 = await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: op, p_email: 'a@iastaffing.com' });
    const r2 = await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: op, p_email: 'b@iastaffing.com' });
    const v1 = (Array.isArray(r1.data) ? r1.data[0] : r1.data).r_version;
    const v2 = (Array.isArray(r2.data) ? r2.data[0] : r2.data).r_version;
    expect(v2).toBe(v1);   // no-op didn't bump
    const { data } = await sb.from('hub_weekly_sync').select('items').eq('week_key', WEEK).eq('column_key', COL).single();
    expect(readColumn(data!.items).sections[0].focuses[0].editedBy).toBeUndefined();
  });
});
