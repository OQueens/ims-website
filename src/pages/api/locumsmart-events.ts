/**
 * Unified LocumSmart events receiver — POST /api/locumsmart-events
 *
 * Design: docs/superpowers/specs/2026-06-02-locumsmart-unified-webhook-design.md
 *
 * One LS subscription POSTs here. In a single pass the handler:
 *   1. Lenient-validates (needs only `key` + `operation`) and authenticates via
 *      constant-time compare against LOCUMSMART_WEBHOOK_SECRET.
 *   2. Appends every delivery to the append-only `ls_events` log (idempotent on
 *      dedupe_key) — the source of truth for Hub analytics.
 *   3. If the payload is assignment-shaped, also upserts `ims_jobs` (the public
 *      job board) using the existing atomic freshness logic.
 *
 * Response policy: LS retries 5xx but not 4xx. So a transient DB error returns
 * 500 (to be retried and healed); a malformed payload or bad token returns 4xx
 * (dropped). The log is the source of truth — if we cannot record the event we
 * return 500 and do NOT proceed to the board write.
 *
 * Coexists with the legacy /api/locumsmart-webhook during cutover: both upsert
 * ims_jobs idempotently, so running both against the same feed is safe. The
 * legacy endpoint is retired once this one is verified (design §11 step 6).
 */

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import {
  constantTimeEquals,
  validatePayloadShape,
} from '../../lib/locumsmart-webhook-logic';
import { validateEventEnvelope, mapToLsEventRow } from '../../lib/locumsmart-events-logic';
import { upsertImsJobsRow } from '../../lib/locumsmart-upsert';

export const prerender = false;

interface PagesEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  LOCUMSMART_WEBHOOK_SECRET?: string;
}

function readEnv(locals: App.Locals): PagesEnv {
  // Cloudflare Pages exposes env at locals.runtime.env. In dev/test
  // locals.runtime is undefined; fall back to import.meta.env so a
  // misconfiguration surfaces as 500 rather than a runtime crash.
  const cf = (locals as { runtime?: { env?: PagesEnv } }).runtime?.env;
  if (cf) return cf;
  return {
    SUPABASE_URL: import.meta.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    LOCUMSMART_WEBHOOK_SECRET: import.meta.env.LOCUMSMART_WEBHOOK_SECRET,
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = readEnv(locals);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.LOCUMSMART_WEBHOOK_SECRET) {
    // 500 (not 401) for misconfig: LS retries 5xx, so a transient missing-secret
    // window during deploy is healed by the next retry once the env var is set.
    console.error('[ls-events] env misconfigured');
    return new Response('Server misconfigured', { status: 500 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const envelope = validateEventEnvelope(raw);
  if (!envelope.ok) {
    console.warn('[ls-events] envelope invalid:', envelope.reason);
    return new Response('Bad payload', { status: 400 });
  }
  const payload = envelope.payload;

  if (!constantTimeEquals(payload.key, env.LOCUMSMART_WEBHOOK_SECRET)) {
    console.warn('[ls-events] unauthorized — token mismatch for', payload.assignmentId ?? '(no id)');
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Append to the event log. Idempotent: ON CONFLICT (dedupe_key) DO NOTHING
  // (ignoreDuplicates) — an LS retry or backfill replay is a silent no-op, never
  // a duplicate analytics row. The log is the source of truth, so if this write
  // fails we return 500 and do NOT touch the board.
  const eventRow = mapToLsEventRow(payload, new Date().toISOString());
  const { error: evErr } = await supabase
    .from('ls_events')
    .upsert(eventRow, { onConflict: 'dedupe_key', ignoreDuplicates: true });

  if (evErr) {
    console.error('[ls-events] log append failed:', payload.assignmentId, evErr.message);
    return new Response('Database error', { status: 500 });
  }

  // 2. If assignment-shaped, project onto the public job board. Re-running this
  // on a retry is safe — the atomic freshness guard makes a stale/duplicate
  // event a no-op, and a retry heals the board if a prior delivery logged the
  // event but failed the board write.
  if (validatePayloadShape(payload).ok) {
    const outcome = await upsertImsJobsRow(supabase, payload);
    if (!outcome.ok) {
      console.error('[ls-events] board upsert failed:', payload.assignmentId, outcome.error);
      return new Response('Database error', { status: 500 });
    }
    console.log('[ls-events] logged + board', outcome.action, ':', payload.assignmentId, payload.operation, '->', eventRow.status_after);
  } else {
    // Non-assignment event (candidate / offer / credentialing, etc.) — logged
    // losslessly for the Hub; no board projection.
    console.log('[ls-events] logged (non-assignment):', payload.operation);
  }

  return new Response('OK', { status: 200 });
};

// LS only sends POST; anything else is a probe or misconfiguration.
export const GET: APIRoute = () => new Response('Method Not Allowed', { status: 405 });
export const HEAD: APIRoute = () => new Response(null, { status: 405 });
