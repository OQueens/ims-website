/**
 * INC-3 — lead liveness monitor + auto-retry sweep.
 *
 * Closes the "no lead silently lost" gap: the contact route captures every lead
 * to ims_contact_messages BEFORE emailing, so a Resend failure at submit time
 * leaves a durable row at resend_status='failed'/'pending'. Nothing read those
 * rows — so a lead could sit captured-but-unnotified forever (e.g. Valencia's
 * pre-domain-verification lead). This sweep periodically re-attempts the PRIMARY
 * recruiting notification for unsent rows (which now deliver since the domain is
 * verified), bounds retries with an attempt counter, fires the out-of-band
 * safety-net alert when a lead exhausts its retries, and returns a liveness
 * summary a scheduler/monitor can alert on.
 *
 * Orchestration only — all I/O is injected (SweepDeps) so it is fully unit
 * testable. The endpoint (/api/contact-sweep) supplies the real Supabase +
 * Resend wiring.
 */
import type { Audience, LeadPayload, SendResult } from './resend-server';

/** A captured-but-unsent lead row (subset of ims_contact_messages). */
export interface SweepLead {
  id: string;
  name: string;
  email: string;
  audience: Audience;
  role: string | null;
  message: string | null;
  created_at: string;
  resend_status: string;
  resend_attempts: number;
}

export interface SweepSummary {
  scanned: number;
  sent: number;
  retriedStillFailing: number;
  exhausted: number;
  alertsFired: number;
  unsentRemaining: number;
  oldestUnsentAgeMins: number | null;
  /** True when leads remain unsent after the sweep — the monitor signal. */
  alert: boolean;
}

export interface SweepDeps {
  /** Fetch up to `limit` rows where resend_status != 'sent' AND attempts < MAX. */
  fetchUnsent: (limit: number) => Promise<SweepLead[]>;
  /** Re-attempt the primary recruiting notification. */
  sendPrimary: (lead: LeadPayload) => Promise<SendResult>;
  /** Out-of-band safety-net alert (fired only on final exhaustion). */
  sendAlert: (lead: LeadPayload) => Promise<SendResult>;
  /** Persist the attempt outcome (resend_status + attempts + last_attempt_at). */
  recordOutcome: (id: string, patch: { sent: boolean; attempts: number; error?: string }) => Promise<void>;
}

// After this many failed attempts a lead stops being auto-retried (so a
// permanently-undeliverable address can't re-alert forever); the final attempt
// fires the safety-net alert for a manual human follow-up.
export const MAX_ATTEMPTS = 6;
export const DEFAULT_LIMIT = 100;

function toLead(r: SweepLead): LeadPayload {
  return {
    name: r.name,
    email: r.email,
    audience: r.audience,
    role: r.role ?? undefined,
    message: r.message ?? undefined,
  };
}

function ageMins(createdAt: string, nowMs: number): number | null {
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 60000));
}

/** Pure liveness assessment over a set of still-unsent rows. */
export function assessLiveness(
  rows: { created_at: string; resend_status: string }[],
  nowMs: number,
): { unsentRemaining: number; oldestUnsentAgeMins: number | null; alert: boolean } {
  const unsent = rows.filter((r) => r.resend_status !== 'sent');
  let oldest: number | null = null;
  for (const r of unsent) {
    const a = ageMins(r.created_at, nowMs);
    if (a !== null && (oldest === null || a > oldest)) oldest = a;
  }
  return { unsentRemaining: unsent.length, oldestUnsentAgeMins: oldest, alert: unsent.length > 0 };
}

export async function runSweep(deps: SweepDeps, nowMs: number, opts?: { limit?: number }): Promise<SweepSummary> {
  const rows = await deps.fetchUnsent(opts?.limit ?? DEFAULT_LIMIT);
  let sent = 0;
  let retriedStillFailing = 0;
  let exhausted = 0;
  let alertsFired = 0;
  const stillUnsent: { created_at: string; resend_status: string }[] = [];

  for (const r of rows) {
    const lead = toLead(r);
    const res = await deps.sendPrimary(lead);
    if (res.ok) {
      await deps.recordOutcome(r.id, { sent: true, attempts: r.resend_attempts + 1 });
      sent++;
      continue;
    }
    const attempts = r.resend_attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const alert = await deps.sendAlert(lead);
      if (alert.ok) alertsFired++;
      exhausted++;
    } else {
      retriedStillFailing++;
    }
    await deps.recordOutcome(r.id, { sent: false, attempts, error: res.error });
    stillUnsent.push({ created_at: r.created_at, resend_status: 'failed' });
  }

  const liveness = assessLiveness(stillUnsent, nowMs);
  return {
    scanned: rows.length,
    sent,
    retriedStillFailing,
    exhausted,
    alertsFired,
    unsentRemaining: liveness.unsentRemaining,
    oldestUnsentAgeMins: liveness.oldestUnsentAgeMins,
    alert: liveness.alert,
  };
}
