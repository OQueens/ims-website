/**
 * Pure-logic helpers for the unified LocumSmart events receiver
 * (POST /api/locumsmart-events). Kept separate from the route so vitest can
 * cover dedupe-key derivation and event-row projection without the Supabase
 * client or the Cloudflare runtime.
 *
 * Design: docs/superpowers/specs/2026-06-02-locumsmart-unified-webhook-design.md
 *
 * The events receiver appends every delivery to the append-only `ls_events`
 * log (the source of truth for Hub analytics) and — when the payload is
 * assignment-shaped — also upserts `ims_jobs` (the job board) via the existing
 * mapToImsJobsRow + atomic freshness logic. This module owns the FIRST write:
 * projecting a payload into an `ls_events` row + the idempotency key.
 *
 * All denormalized dimensions are best-effort and null-safe: the raw payload is
 * stored losslessly in `raw_payload`, so a dimension we cannot extract today
 * (a new event shape, a renamed field) is never lost — we backfill the typed
 * column from the log later without re-ingestion.
 */

import {
  deriveStatus,
  normalizeSpecialtySlug,
  redactPayloadForStorage,
  validatePayloadShape,
  type LSWebhookPayload,
  type SpecialtySlug,
} from './locumsmart-webhook-logic';

/**
 * cyrb53 — a fast, deterministic, dependency-free 53-bit string hash (sync, runs
 * in both the Workers runtime and Node). Used only to derive a collision-free
 * dedupe key for non-assignment events that have no shared natural identity. A
 * 53-bit space makes accidental collisions negligible at this event volume.
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Deterministic, key-order-independent JSON serialization. Recursively sorts
 * object keys so the SAME logical payload hashes identically even if LS re-emits
 * its fields in a different order (e.g. after a platform upgrade) — so a true
 * retry always dedupes instead of double-logging.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

/**
 * A row destined for the append-only `ls_events` table. Mirrors the migration
 * in migrations/20260602_ls_events_table.sql. `recruiter` stays null until the
 * first real sample payload confirms whether LS attributes a recruiter/owner
 * (design §10 open item 3) — extracted then without a migration.
 */
export interface LsEventRow {
  dedupe_key: string;
  event_type: string;
  assignment_id: string | null;
  assignment_number: string | null;
  occurred_at: string;
  received_at: string;
  status_after: 'active' | 'archived';
  ls_status: string | null;
  specialty_slug: SpecialtySlug;
  specialty_name: string | null;
  provider_type: string | null;
  facility_state: string | null;
  facility_city: string | null;
  organization: string | null;
  organization_id: string | null;
  num_providers_requested: number | null;
  recruiter: string | null;
  raw_payload: Record<string, unknown>;
}

export type EnvelopeResult =
  | { ok: true; payload: LSWebhookPayload }
  | { ok: false; reason: string };

/**
 * LENIENT validation for the unified events endpoint. Unlike the strict
 * validatePayloadShape (which requires the full assignment shape), this only
 * demands what the events log fundamentally needs: a string `key` (so we can
 * authenticate the delivery) and a string `operation` (so the event has a type
 * and a usable dedupe key). Everything else is optional and captured losslessly
 * in raw_payload — so a future non-assignment event (candidate / offer /
 * credentialing, design §10) is logged the day it first arrives without a
 * schema change. mapToLsEventRow is null-safe for all the optional fields.
 */
export function validateEventEnvelope(raw: unknown): EnvelopeResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not-an-object' };
  const r = raw as Record<string, unknown>;
  // `key` is the ONLY hard requirement — it is how we authenticate the delivery.
  // `operation` is NOT required: a non-assignment event (Bid / Agreement /
  // Invoice / Timesheet / Provider / Confirmation Amendment) may carry a
  // different discriminator, and we must still log it losslessly rather than
  // drop it. mapToLsEventRow falls back to event_type 'unknown' and a content-
  // hash dedupe key, and raw_payload captures the full shape for later.
  if (typeof r.key !== 'string' || r.key.length === 0) return { ok: false, reason: 'missing-key' };
  return { ok: true, payload: raw as LSWebhookPayload };
}

/**
 * The event's logical occurrence time: LS lastModified, else createDate, else
 * the time we received it. Used both for `occurred_at` and for the dedupe key.
 */
function deriveOccurredAt(payload: LSWebhookPayload, receivedAtIso: string): string {
  const d = payload.details ?? {};
  return d.lastModified ?? d.createDate ?? receivedAtIso;
}

/**
 * Synthesize an idempotency key. LS assignment payloads carry no explicit event
 * id, so we derive one from (assignmentId, operation, occurrence timestamp). The
 * same logical event — an LS retry or a backfill replay — produces the same key,
 * so the UNIQUE constraint on ls_events.dedupe_key makes the append idempotent
 * and placements/fills are never double-counted. If a future sample payload
 * reveals a true LS event id, switch to it (design §10 item 4).
 */
export function deriveDedupeKey(payload: LSWebhookPayload): string {
  // Assignment-shaped events have a stable natural identity (assignmentId +
  // operation + timestamp). Use it so a re-serialized retry dedupes and
  // placements/fills are never double-counted.
  if (validatePayloadShape(payload).ok) {
    const d = payload.details ?? {};
    const ts = d.lastModified ?? d.createDate ?? 'no-ts';
    return `${payload.assignmentId}:${payload.operation}:${ts}`;
  }
  // Everything else (Bids, Agreements, Invoices, Timesheets, Providers,
  // Confirmation Amendments) shares no natural identity, so a fixed prefix like
  // "no-id:<operation>:no-ts" would collide and silently DROP distinct events.
  // Key off a content hash instead: identical retries dedupe (same hash),
  // distinct events never collide. The bearer `key` is OMITTED from the hash
  // (not just redacted) so the hash never depends on the secret or the redaction
  // marker; stableStringify makes it independent of field order.
  const { key: _bearerKey, ...hashable } = payload as Record<string, unknown>;
  return `evt:${cyrb53(stableStringify(hashable))}`;
}

/**
 * Project an LS payload into an `ls_events` row. Pure function — no I/O. The
 * bearer key is stripped from raw_payload (redactPayloadForStorage) so the
 * secret is not replicated across every logged event.
 */
export function mapToLsEventRow(payload: LSWebhookPayload, receivedAtIso: string): LsEventRow {
  const d = payload.details ?? {};
  const facility0 = d.facilities?.[0];
  const specialty0 = d.specialties?.[0];

  return {
    dedupe_key: deriveDedupeKey(payload),
    event_type: payload.operation || 'unknown',
    assignment_id: payload.assignmentId ?? null,
    assignment_number: payload.assignmentNumber ?? null,
    occurred_at: deriveOccurredAt(payload, receivedAtIso),
    received_at: receivedAtIso,
    status_after: deriveStatus(payload.operation),
    ls_status: d.status ?? null,
    specialty_slug: normalizeSpecialtySlug(specialty0?.specialtyName),
    specialty_name: specialty0?.specialtyName ?? null,
    provider_type: d.providerType ?? null,
    facility_state: facility0?.facilityState ?? null,
    facility_city: facility0?.facilityCity ?? null,
    organization: d.organization ?? null,
    organization_id: d.organizationId ?? null,
    num_providers_requested: typeof d.numProvidersRequested === 'number' ? d.numProvidersRequested : null,
    // Recruiter attribution unconfirmed until the first sample payload — see §10.
    recruiter: null,
    raw_payload: redactPayloadForStorage(payload),
  };
}
