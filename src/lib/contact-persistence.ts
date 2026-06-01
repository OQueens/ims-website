/**
 * Durable capture for the Get-in-touch form. The route persists every valid,
 * human-verified submission to `ims_contact_messages` BEFORE attempting the
 * Resend email, so a lead is never lost when email delivery fails. After the
 * send attempt the row's `resend_status` is reconciled to 'sent' or 'failed'.
 *
 * Mirrors the Supabase access pattern in locumsmart-webhook.ts: service-role
 * key (bypasses RLS), no session persistence. All functions NEVER throw — they
 * return a discriminated result so the route can apply its fallback logic
 * (e.g. fall back to email-only if the DB is unreachable).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// Single source of truth for the audience union (mirrors the DB CHECK and the
// GetInTouch radio values) — re-exported so persistence + email layers can't drift.
import type { Audience } from './resend-server';

export type { Audience };

export interface PersistenceEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** A row ready to INSERT into ims_contact_messages (status/resend_status/
 *  created_at fall back to their DB defaults). */
export interface ContactRow {
  name: string;
  email: string;
  audience: Audience;
  role: string | null;
  message: string | null;
  ip_hash: string | null;
  user_agent: string | null;
}

export interface InsertResult {
  ok: boolean;
  /** false when env vars are absent — distinguishes "not wired" from "failed". */
  configured: boolean;
  id?: string;
  error?: string;
}

export interface UpdateResult {
  ok: boolean;
  configured: boolean;
  error?: string;
}

const TABLE = 'ims_contact_messages';

function envOk(env: PersistenceEnv): env is Required<PersistenceEnv> {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function client(env: Required<PersistenceEnv>): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Pure: shape a parsed submission + request metadata into an insertable row.
 *  Empty optional fields become null (cleaner than storing ''). */
export function buildContactRow(
  input: { name: string; email: string; audience: Audience; role: string; message: string },
  meta: { ipHash: string | null; userAgent: string | null },
): ContactRow {
  return {
    name: input.name,
    email: input.email,
    audience: input.audience,
    role: input.role ? input.role : null,
    message: input.message ? input.message : null,
    ip_hash: meta.ipHash,
    user_agent: meta.userAgent,
  };
}

/** INSERT-first durable capture. Returns the new row id on success. */
export async function insertContactMessage(env: PersistenceEnv, row: ContactRow): Promise<InsertResult> {
  if (!envOk(env)) return { ok: false, configured: false };
  try {
    const { data, error } = await client(env).from(TABLE).insert(row).select('id').single();
    if (error) return { ok: false, configured: true, error: (error.message ?? String(error)).slice(0, 500) };
    // Couple ok to a present id: a row we cannot confirm was captured must NOT
    // report success, or the route would skip the reconcile (leaving resend_status
    // ='pending') yet still return success-on-persist.
    const id = (data as { id: string } | null)?.id;
    if (!id) return { ok: false, configured: true, error: 'insert returned no id' };
    return { ok: true, configured: true, id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, configured: true, error: msg.slice(0, 500) };
  }
}

/** Reconcile the captured row's delivery state after the Resend attempt. */
export async function markResendOutcome(
  env: PersistenceEnv,
  id: string,
  sent: boolean,
  error?: string,
): Promise<UpdateResult> {
  if (!envOk(env)) return { ok: false, configured: false };
  const patch = {
    resend_status: sent ? 'sent' : 'failed',
    resend_error: sent ? null : ((error ?? '').slice(0, 500) || null),
  };
  try {
    // count:'exact' + a 0-row guard mirrors locumsmart-webhook.ts so a reconcile
    // that matched nothing (id vanished) surfaces as a failure the route logs,
    // rather than silently masking a row stuck at resend_status='pending'.
    const { error: updErr, count } = await client(env)
      .from(TABLE)
      .update(patch, { count: 'exact' })
      .eq('id', id);
    if (updErr) return { ok: false, configured: true, error: (updErr.message ?? String(updErr)).slice(0, 500) };
    if (count === 0) return { ok: false, configured: true, error: `reconcile matched 0 rows (id ${id})` };
    return { ok: true, configured: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, configured: true, error: msg.slice(0, 500) };
  }
}
