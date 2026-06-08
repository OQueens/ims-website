import { describe, it, expect } from 'vitest';
import { runSweep, assessLiveness, MAX_ATTEMPTS, type SweepDeps, type SweepLead } from './contact-sweep';

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

function lead(p: Partial<SweepLead>): SweepLead {
  return {
    id: 'id-1',
    name: 'Valencia Mosley',
    email: 'vstephensmd@msn.com',
    audience: 'clinician',
    role: 'OB Hospitalist',
    message: 'TMC Tucson',
    created_at: '2026-06-03T00:00:00Z',
    resend_status: 'failed',
    resend_attempts: 0,
    ...p,
  };
}

interface Recorded { id: string; sent: boolean; attempts: number; error?: string }

function mockDeps(rows: SweepLead[], behavior: { primaryOk?: boolean; alertOk?: boolean } = {}): SweepDeps & { recorded: Recorded[]; alerts: number } {
  const recorded: Recorded[] = [];
  let alerts = 0;
  return {
    recorded,
    get alerts() { return alerts; },
    fetchUnsent: async () => rows,
    sendPrimary: async () => ({ ok: behavior.primaryOk ?? false, error: behavior.primaryOk ? undefined : 'resend down' }),
    sendAlert: async () => { alerts++; return { ok: behavior.alertOk ?? true }; },
    recordOutcome: async (id, patch) => { recorded.push({ id, ...patch }); },
  };
}

describe('assessLiveness', () => {
  it('flags an alert + oldest age when leads remain unsent', () => {
    const r = assessLiveness(
      [{ created_at: '2026-06-13T12:00:00Z', resend_status: 'failed' }, { created_at: '2026-06-14T12:00:00Z', resend_status: 'sent' }],
      NOW,
    );
    expect(r.unsentRemaining).toBe(1);
    expect(r.alert).toBe(true);
    expect(r.oldestUnsentAgeMins).toBe(2 * 24 * 60); // 2 days
  });
  it('is quiet when everything is sent', () => {
    const r = assessLiveness([{ created_at: '2026-06-14T12:00:00Z', resend_status: 'sent' }], NOW);
    expect(r).toEqual({ unsentRemaining: 0, oldestUnsentAgeMins: null, alert: false });
  });
});

describe('runSweep', () => {
  it('marks a lead sent when the primary retry succeeds (domain now verified)', async () => {
    const deps = mockDeps([lead({ id: 'a', resend_attempts: 1 })], { primaryOk: true });
    const s = await runSweep(deps, NOW);
    expect(s.sent).toBe(1);
    expect(s.alert).toBe(false);
    expect(s.unsentRemaining).toBe(0);
    expect(deps.recorded).toEqual([{ id: 'a', sent: true, attempts: 2 }]);
    expect(deps.alerts).toBe(0);
  });

  it('increments attempts and keeps the lead unsent when the primary still fails (below max)', async () => {
    const deps = mockDeps([lead({ id: 'b', resend_attempts: 0 })], { primaryOk: false });
    const s = await runSweep(deps, NOW);
    expect(s.sent).toBe(0);
    expect(s.retriedStillFailing).toBe(1);
    expect(s.exhausted).toBe(0);
    expect(s.alert).toBe(true);
    expect(s.unsentRemaining).toBe(1);
    expect(deps.recorded).toEqual([{ id: 'b', sent: false, attempts: 1, error: 'resend down' }]);
    expect(deps.alerts).toBe(0); // no safety-net spam before exhaustion
  });

  it('fires the safety-net alert and marks exhausted at MAX attempts', async () => {
    const deps = mockDeps([lead({ id: 'c', resend_attempts: MAX_ATTEMPTS - 1 })], { primaryOk: false });
    const s = await runSweep(deps, NOW);
    expect(s.exhausted).toBe(1);
    expect(s.alertsFired).toBe(1);
    expect(deps.alerts).toBe(1);
    expect(deps.recorded[0].attempts).toBe(MAX_ATTEMPTS);
    expect(deps.recorded[0].sent).toBe(false);
  });

  it('is a no-op with no alert when nothing is unsent', async () => {
    const deps = mockDeps([]);
    const s = await runSweep(deps, NOW);
    expect(s).toMatchObject({ scanned: 0, sent: 0, unsentRemaining: 0, alert: false, oldestUnsentAgeMins: null });
  });

  it('mixes outcomes across a batch', async () => {
    // First succeeds, second still failing — recorded for both, one still unsent.
    const deps: SweepDeps & { recorded: Recorded[] } = (() => {
      const recorded: Recorded[] = [];
      let i = 0;
      return {
        recorded,
        fetchUnsent: async () => [lead({ id: 'ok', resend_attempts: 0 }), lead({ id: 'bad', resend_attempts: 0 })],
        sendPrimary: async () => ({ ok: i++ === 0, error: 'x' }),
        sendAlert: async () => ({ ok: true }),
        recordOutcome: async (id, patch) => { recorded.push({ id, ...patch }); },
      };
    })();
    const s = await runSweep(deps, NOW);
    expect(s.sent).toBe(1);
    expect(s.retriedStillFailing).toBe(1);
    expect(s.unsentRemaining).toBe(1);
    expect(deps.recorded).toHaveLength(2);
  });
});
