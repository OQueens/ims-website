import { describe, it, expect } from 'vitest';
import type { LSWebhookPayload } from './locumsmart-webhook-logic';
import { deriveDedupeKey, mapToLsEventRow, validateEventEnvelope } from './locumsmart-events-logic';

// A representative assignment-shaped LS payload (the known contract, per
// docs/superpowers/specs/2026-06-02-locumsmart-unified-webhook-design.md §4).
function basePayload(overrides: Partial<LSWebhookPayload> = {}): LSWebhookPayload {
  return {
    assignmentId: '11111111-1111-1111-1111-111111111111',
    assignmentNumber: 'A-DEMC-260602-12345',
    key: 'super-secret-webhook-key',
    operation: 'Receive',
    details: {
      status: 'Open',
      organization: 'Acme Health',
      organizationId: '22222222-2222-2222-2222-222222222222',
      providerType: 'Physician',
      numProvidersRequested: 2,
      specialties: [{ specialtyId: 's1', specialtyName: 'Anesthesiology' }],
      facilities: [{ facility: 'St. Mary', facilityCity: 'Fort Worth', facilityState: 'TX' }],
      createDate: '2026-06-01T10:00:00.000Z',
      lastModified: '2026-06-02T12:00:00.000Z',
    },
    ...overrides,
  };
}

const RECEIVED_AT = '2026-06-02T15:00:00.000Z';

describe('deriveDedupeKey', () => {
  it('combines assignmentId, operation, and lastModified', () => {
    expect(deriveDedupeKey(basePayload())).toBe(
      '11111111-1111-1111-1111-111111111111:Receive:2026-06-02T12:00:00.000Z',
    );
  });

  it('falls back to createDate when lastModified is absent', () => {
    const p = basePayload();
    delete p.details.lastModified;
    expect(deriveDedupeKey(p)).toBe(
      '11111111-1111-1111-1111-111111111111:Receive:2026-06-01T10:00:00.000Z',
    );
  });

  it('falls back to "no-ts" when both timestamps are absent', () => {
    const p = basePayload();
    delete p.details.lastModified;
    delete p.details.createDate;
    expect(deriveDedupeKey(p)).toBe('11111111-1111-1111-1111-111111111111:Receive:no-ts');
  });

  it('uses a content-hash key for non-assignment-shaped events (no natural identity)', () => {
    const p = basePayload();
    delete (p as Partial<LSWebhookPayload>).assignmentId;
    expect(deriveDedupeKey(p)).toMatch(/^evt:/);
  });

  it('gives DISTINCT keys to distinct non-assignment events of the same type (no collision -> no drop)', () => {
    const bid1 = { key: 'k', operation: 'Accepted', bidId: 'bid-1' } as unknown as LSWebhookPayload;
    const bid2 = { key: 'k', operation: 'Accepted', bidId: 'bid-2' } as unknown as LSWebhookPayload;
    expect(deriveDedupeKey(bid1)).not.toBe(deriveDedupeKey(bid2));
  });

  it('gives the SAME key to an identical non-assignment payload (retry dedupes)', () => {
    const inv = { key: 'k', operation: 'Paid', invoiceId: 'inv-9' } as unknown as LSWebhookPayload;
    const invRetry = { key: 'k', operation: 'Paid', invoiceId: 'inv-9' } as unknown as LSWebhookPayload;
    expect(deriveDedupeKey(inv)).toBe(deriveDedupeKey(invRetry));
  });

  it('dedupes a non-assignment retry regardless of field order (stable hash)', () => {
    const a = { key: 'k', operation: 'Paid', invoiceId: 'inv-1', amount: 100 } as unknown as LSWebhookPayload;
    const b = { amount: 100, invoiceId: 'inv-1', operation: 'Paid', key: 'k' } as unknown as LSWebhookPayload;
    expect(deriveDedupeKey(a)).toBe(deriveDedupeKey(b));
  });

  it('does not depend on the bearer key value (key omitted from the hash)', () => {
    const a = { key: 'key-A', operation: 'Paid', invoiceId: 'inv-1' } as unknown as LSWebhookPayload;
    const b = { key: 'key-B', operation: 'Paid', invoiceId: 'inv-1' } as unknown as LSWebhookPayload;
    expect(deriveDedupeKey(a)).toBe(deriveDedupeKey(b));
  });

  it('produces distinct keys for different operations on the same assignment', () => {
    const recv = deriveDedupeKey(basePayload({ operation: 'Receive' }));
    const cancel = deriveDedupeKey(basePayload({ operation: 'Cancel' }));
    expect(recv).not.toBe(cancel);
  });
});

describe('mapToLsEventRow', () => {
  it('projects the assignment payload into the ls_events row dimensions', () => {
    const row = mapToLsEventRow(basePayload(), RECEIVED_AT);
    expect(row).toMatchObject({
      dedupe_key: '11111111-1111-1111-1111-111111111111:Receive:2026-06-02T12:00:00.000Z',
      event_type: 'Receive',
      assignment_id: '11111111-1111-1111-1111-111111111111',
      assignment_number: 'A-DEMC-260602-12345',
      occurred_at: '2026-06-02T12:00:00.000Z',
      received_at: RECEIVED_AT,
      status_after: 'active',
      ls_status: 'Open',
      specialty_slug: 'anesthesiology',
      specialty_name: 'Anesthesiology',
      provider_type: 'Physician',
      facility_state: 'TX',
      facility_city: 'Fort Worth',
      organization: 'Acme Health',
      organization_id: '22222222-2222-2222-2222-222222222222',
      num_providers_requested: 2,
    });
  });

  it('occurred_at falls back createDate -> received_at as timestamps drop off', () => {
    const noLm = basePayload();
    delete noLm.details.lastModified;
    expect(mapToLsEventRow(noLm, RECEIVED_AT).occurred_at).toBe('2026-06-01T10:00:00.000Z');

    const noTs = basePayload();
    delete noTs.details.lastModified;
    delete noTs.details.createDate;
    expect(mapToLsEventRow(noTs, RECEIVED_AT).occurred_at).toBe(RECEIVED_AT);
  });

  it('derives status_after = archived for a terminal operation', () => {
    expect(mapToLsEventRow(basePayload({ operation: 'Cancel' }), RECEIVED_AT).status_after).toBe('archived');
  });

  it('stores the full payload in raw_payload with the bearer key redacted', () => {
    const row = mapToLsEventRow(basePayload(), RECEIVED_AT);
    const raw = row.raw_payload as Record<string, unknown>;
    expect(raw.key).toBe('[REDACTED]');
    // non-secret fields survive losslessly
    expect(raw.assignmentId).toBe('11111111-1111-1111-1111-111111111111');
    expect(raw.operation).toBe('Receive');
  });

  it('event_type falls back to "unknown" when operation is absent', () => {
    const noOp = { key: 'k', details: {} } as unknown as LSWebhookPayload;
    expect(mapToLsEventRow(noOp, RECEIVED_AT).event_type).toBe('unknown');
  });

  it('is null-safe for a payload missing details (non-assignment / sparse event)', () => {
    const sparse = {
      assignmentId: '33333333-3333-3333-3333-333333333333',
      assignmentNumber: 'A-X',
      key: 'k',
      operation: 'Ping',
      details: {},
    } as LSWebhookPayload;
    const row = mapToLsEventRow(sparse, RECEIVED_AT);
    expect(row.specialty_slug).toBe('other');
    expect(row.facility_state).toBeNull();
    expect(row.occurred_at).toBe(RECEIVED_AT);
  });
});

describe('validateEventEnvelope (lenient — must accept any event for the log)', () => {
  it('accepts a minimal event with just key + operation (future non-assignment event)', () => {
    const r = validateEventEnvelope({ key: 'k', operation: 'CandidateSubmitted' });
    expect(r.ok).toBe(true);
  });

  it('accepts a full assignment payload', () => {
    expect(validateEventEnvelope(basePayload()).ok).toBe(true);
  });

  it('rejects non-objects (cannot form an event)', () => {
    expect(validateEventEnvelope(null).ok).toBe(false);
    expect(validateEventEnvelope('not-json').ok).toBe(false);
    expect(validateEventEnvelope(42).ok).toBe(false);
  });

  it('rejects a missing or non-string key (cannot authenticate)', () => {
    expect(validateEventEnvelope({ operation: 'Receive' }).ok).toBe(false);
    expect(validateEventEnvelope({ key: 123, operation: 'Receive' }).ok).toBe(false);
    expect(validateEventEnvelope({ key: '', operation: 'Receive' }).ok).toBe(false);
  });

  it('accepts an event with no operation (still logged losslessly; event_type falls back)', () => {
    expect(validateEventEnvelope({ key: 'k' }).ok).toBe(true);
    expect(validateEventEnvelope({ key: 'k', operation: '' }).ok).toBe(true);
  });
});
