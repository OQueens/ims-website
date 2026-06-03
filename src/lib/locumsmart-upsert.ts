/**
 * Atomic conditional upsert of an LS assignment into the ims_jobs board table.
 *
 * Extracted VERBATIM from src/pages/api/locumsmart-webhook.ts so the unified
 * events endpoint (/api/locumsmart-events) reuses the exact same battle-tested
 * freshness logic rather than a re-implementation. The original endpoint keeps
 * its inline copy until it is retired at cutover (design §11 step 6).
 *
 * Strategy: INSERT first; on a primary-key conflict (23505 on ims_jobs_pkey)
 * fall through to a conditional UPDATE whose WHERE clause encodes the freshness
 * rules (mirrors evaluateFreshness in locumsmart-webhook-logic.ts):
 *   - apply when incoming ls_last_modified > stored
 *   - apply when same-timestamp AND incoming archived AND stored active
 *     (terminal events dominate ties)
 *   - skip when incoming < stored (stale)  → action 'skipped'
 *   - skip same-timestamp active-incoming-vs-archived-stored
 * Postgres row-level locking on UPDATE serializes concurrent writes to the same
 * id, so a delayed stale event cannot overwrite a later cancel.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { mapToImsJobsRow, type LSWebhookPayload } from './locumsmart-webhook-logic';

export type UpsertOutcome =
  | { ok: true; action: 'inserted' | 'updated' | 'skipped' }
  | { ok: false; error: string };

export async function upsertImsJobsRow(
  supabase: SupabaseClient,
  payload: LSWebhookPayload,
): Promise<UpsertOutcome> {
  const row = mapToImsJobsRow(payload);

  const { error: insertErr } = await supabase.from('ims_jobs').insert(row);
  if (!insertErr) return { ok: true, action: 'inserted' };

  // Only fall through to UPDATE on a PK conflict. A conflict on the
  // assignment_number unique constraint means LS sent the same number with a
  // different assignmentId — an integrity problem worth surfacing, not a stale
  // no-op.
  if (insertErr.code !== '23505') return { ok: false, error: insertErr.message };
  if (!insertErr.message.includes('ims_jobs_pkey')) return { ok: false, error: insertErr.message };

  // Normalize the incoming timestamp to a strict ISO string before injecting it
  // into the PostgREST .or() filter so LS format drift cannot break the grammar.
  const rawLm = row.ls_last_modified;
  const parsedLm = rawLm ? new Date(rawLm) : null;
  const incomingLm = parsedLm && !isNaN(parsedLm.getTime()) ? parsedLm.toISOString() : null;

  let updateBuilder = supabase
    .from('ims_jobs')
    .update(row, { count: 'exact' })
    .eq('id', payload.assignmentId);

  if (incomingLm) {
    const orFilters = ['ls_last_modified.is.null', `ls_last_modified.lt.${incomingLm}`];
    if (row.status === 'archived') {
      orFilters.push(`and(ls_last_modified.eq.${incomingLm},status.eq.active)`);
    }
    updateBuilder = updateBuilder.or(orFilters.join(','));
  }
  // No parseable incoming timestamp → apply unconditionally rather than drop.

  const { error: updateErr, count } = await updateBuilder;
  if (updateErr) return { ok: false, error: updateErr.message };
  if (count === 0) return { ok: true, action: 'skipped' };
  return { ok: true, action: 'updated' };
}
