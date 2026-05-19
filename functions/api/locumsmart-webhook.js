// LS webhook receiver as a Cloudflare Pages Function (replaces the Astro
// route; @astrojs/cloudflare@13 dropped Pages support). Pure auth/map/
// freshness logic is reused unchanged from src/lib/locumsmart-webhook-logic.ts
// (unit-tested 69/69). env arrives via the Pages Functions context, exactly
// like functions/api/contact.js — no Astro.locals, no cloudflare:workers.
import { createClient } from "@supabase/supabase-js";
import {
  constantTimeEquals,
  mapToImsJobsRow,
  validatePayloadShape,
} from "../../src/lib/locumsmart-webhook-logic";

export const onRequestPost = async (context) => {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.LOCUMSMART_WEBHOOK_SECRET) {
    // Intentional 500 (not 401): LS retries 5xx but not 4xx, so a transient
    // missing-secret window during deploy self-heals on the next retry.
    // The 500-vs-401 body-shape difference is a deploy-state oracle in theory,
    // accepted: LS is the only legitimate caller, bounded by IP + the Webhook
    // Key (resilience over stealth). Oracle behaviour tracked for the A4 Codex round.
    console.error("[ls-webhook] env misconfigured");
    return new Response("Server misconfigured", { status: 500 });
  }

  let raw;
  try {
    raw = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const shape = validatePayloadShape(raw);
  if (!shape.ok) {
    console.warn("[ls-webhook] shape invalid:", shape.reason);
    return new Response("Bad payload", { status: 400 });
  }
  const payload = raw; // shape validated above; alias kept for diff-parity with the canonical TS source

  if (!constantTimeEquals(payload.key, env.LOCUMSMART_WEBHOOK_SECRET)) {
    console.warn("[ls-webhook] unauthorized — token mismatch for", payload.assignmentId);
    return new Response("Unauthorized", { status: 401 });
  }

  const row = mapToImsJobsRow(payload);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Atomic conditional upsert. Try INSERT first; on PK conflict (code 23505)
  // fall through to a conditional UPDATE whose WHERE clause encodes the
  // freshness rules. Postgres row-level locking on UPDATE serializes
  // concurrent writes against the same id — an older event whose WHERE
  // clause does not match simply no-ops, so a delayed stale event cannot
  // overwrite a later cancel. The freshness rules mirror evaluateFreshness
  // in src/lib/locumsmart-webhook-logic.ts (kept as the unit-tested spec):
  //   - apply when incoming ls_last_modified > stored
  //   - apply when same-timestamp AND incoming archived AND stored active
  //     (terminal events dominate ties)
  //   - skip when incoming < stored (stale)
  //   - skip same-timestamp ties for active-incoming-vs-archived-stored
  const { error: insertErr } = await supabase
    .from('ims_jobs')
    .insert(row);

  if (!insertErr) {
    console.log('[ls-webhook] inserted:', payload.assignmentId, payload.operation, '->', row.status);
    return new Response('OK', { status: 200 });
  }

  // Postgres unique_violation = '23505'. Two unique constraints exist on
  // ims_jobs: ims_jobs_pkey (on id) and ims_jobs_assignment_number_key
  // (on assignment_number). Disambiguate by a NARROW id re-select rather
  // than the PostgREST-version-fragile constraint-name substring match
  // (Codex A4-R1): if a row with this id already exists the conflict is
  // the PK and we fall through to the conditional freshness UPDATE; if no
  // such row exists the conflict is on assignment_number (LS sent the same
  // assignmentNumber under a different assignmentId) — an integrity problem
  // surfaced as 500, never silently no-opped as "stale". Error logs carry
  // only the structured Postgres code, never the raw message (which can
  // echo rejected internal row values into Workers logs — Codex A4-R1).
  if (insertErr.code !== '23505') {
    console.error('[ls-webhook] insert failed:', payload.assignmentId, 'code=' + (insertErr.code ?? 'unknown'));
    return new Response('Database error', { status: 500 });
  }
  const { data: existingRow, error: reselectErr } = await supabase
    .from('ims_jobs')
    .select('id')
    .eq('id', payload.assignmentId)
    .maybeSingle();
  if (reselectErr) {
    console.error('[ls-webhook] post-conflict re-select failed:', payload.assignmentId, 'code=' + (reselectErr.code ?? 'unknown'));
    return new Response('Database error', { status: 500 });
  }
  if (!existingRow) {
    console.error('[ls-webhook] non-pk unique violation (assignment_number integrity):', payload.assignmentId);
    return new Response('Database error', { status: 500 });
  }

  // Existing row — conditional UPDATE. Normalize the incoming timestamp to a
  // strict ISO string before injecting into the PostgREST .or() filter so LS
  // format drift (fractional seconds, timezone offsets, etc.) cannot break
  // the filter grammar. Date.prototype.toISOString always emits the
  // YYYY-MM-DDTHH:mm:ss.sssZ shape which is unambiguous for both PostgREST
  // and Postgres timestamptz parsing.
  const rawLm = row.ls_last_modified;
  const parsedLm = rawLm ? new Date(rawLm) : null;
  const incomingLm = parsedLm && !isNaN(parsedLm.getTime()) ? parsedLm.toISOString() : null;

  let updateBuilder = supabase
    .from('ims_jobs')
    .update(row, { count: 'exact' })
    .eq('id', payload.assignmentId);

  if (incomingLm) {
    const orFilters = [
      'ls_last_modified.is.null',
      `ls_last_modified.lt.${incomingLm}`,
    ];
    if (row.status === 'archived') {
      // Same-timestamp tie: archived overwrites active.
      orFilters.push(`and(ls_last_modified.eq.${incomingLm},status.eq.active)`);
    }
    updateBuilder = updateBuilder.or(orFilters.join(','));
  }
  // If incoming has no ls_last_modified (or it failed to parse) we apply
  // unconditionally rather than drop the event silently.

  const { error: updateErr, count } = await updateBuilder;

  if (updateErr) {
    console.error('[ls-webhook] update failed:', payload.assignmentId, 'code=' + (updateErr.code ?? 'unknown'));
    return new Response('Database error', { status: 500 });
  }

  if (count === 0) {
    console.warn('[ls-webhook] event skipped (atomic freshness guard):', payload.assignmentId, payload.operation);
    return new Response('OK (skipped: stale-or-tie)', { status: 200 });
  }

  console.log('[ls-webhook] updated:', payload.assignmentId, payload.operation, '->', row.status);
  return new Response('OK', { status: 200 });
};

// LS only sends POST; anything else is a probe/misconfig.
export const onRequestGet = () => new Response("Method Not Allowed", { status: 405 });
export const onRequestHead = () => new Response(null, { status: 405 });
