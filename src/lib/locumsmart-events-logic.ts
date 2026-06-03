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
  type LSWebhookPayload,
  type SpecialtySlug,
} from './locumsmart-webhook-logic';

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
  if (typeof r.key !== 'string' || r.key.length === 0) return { ok: false, reason: 'missing-key' };
  if (typeof r.operation !== 'string' || r.operation.length === 0) return { ok: false, reason: 'missing-operation' };
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
  const d = payload.details ?? {};
  const ts = d.lastModified ?? d.createDate ?? 'no-ts';
  // assignmentId is non-optional on the assignment contract, but a future
  // non-assignment event (candidate/offer/credentialing — design §10) may omit
  // it, so fall back rather than stringify `undefined` into the dedupe key.
  const id = payload.assignmentId ?? 'no-id';
  return `${id}:${payload.operation}:${ts}`;
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
    event_type: payload.operation,
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
