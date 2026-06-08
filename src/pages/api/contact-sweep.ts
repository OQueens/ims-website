/**
 * POST /api/contact-sweep — INC-3 scheduled reconcile.
 *
 * Token-gated (CONTACT_SWEEP_TOKEN bearer). Re-attempts the primary recruiting
 * notification for every captured-but-unsent lead (resend_status != 'sent',
 * attempts < MAX), bounding retries and firing the safety-net alert on
 * exhaustion. Returns a liveness summary. Intended to be hit on a schedule
 * (.github/workflows/contact-sweep.yml or any cron) so no lead is silently lost.
 *
 * Disabled (503) until CONTACT_SWEEP_TOKEN is set, so the endpoint is never an
 * open trigger. All Supabase + Resend access uses the same service-role +
 * Resend env as /api/contact.
 */
import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { sendContactEmail, sendLeadAlert, type ResendEnv } from '../../lib/resend-server';
import { constantTimeEqual } from '../../lib/hub/session';
import { runSweep, MAX_ATTEMPTS, DEFAULT_LIMIT, type SweepDeps, type SweepLead } from '../../lib/contact-sweep';

export const prerender = false;

interface SweepEnv extends ResendEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CONTACT_SWEEP_TOKEN?: string;
}

function readEnv(locals: App.Locals): SweepEnv {
  const cf = (locals as { runtime?: { env?: SweepEnv } }).runtime?.env;
  if (cf) return cf;
  const e = import.meta.env as unknown as Record<string, string>;
  return {
    RESEND_API_KEY: e.RESEND_API_KEY,
    RESEND_FROM_EMAIL: e.RESEND_FROM_EMAIL,
    RECRUITING_TO_ADDRESS: e.RECRUITING_TO_ADDRESS,
    LEAD_NOTIFY_BCC: e.LEAD_NOTIFY_BCC,
    LEAD_ALERT_FROM: e.LEAD_ALERT_FROM,
    LEAD_ALERT_TO: e.LEAD_ALERT_TO,
    SUPABASE_URL: e.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SERVICE_ROLE_KEY,
    CONTACT_SWEEP_TOKEN: e.CONTACT_SWEEP_TOKEN,
  };
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function bearer(header: string | null): string {
  if (!header) return '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = readEnv(locals);

  // Disabled unless a token is configured — never an open trigger.
  if (!env.CONTACT_SWEEP_TOKEN) return json(503, { ok: false, error: 'sweep-disabled' });
  const provided = bearer(request.headers.get('authorization'));
  if (!provided || !(await constantTimeEqual(provided, env.CONTACT_SWEEP_TOKEN))) {
    return json(401, { ok: false, error: 'unauthorized' });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { ok: false, error: 'storage-unconfigured' });
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const deps: SweepDeps = {
    fetchUnsent: async (limit) => {
      const { data, error } = await supabase
        .from('ims_contact_messages')
        .select('id, name, email, audience, role, message, created_at, resend_status, resend_attempts')
        .neq('resend_status', 'sent')
        .lt('resend_attempts', MAX_ATTEMPTS)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as SweepLead[];
    },
    sendPrimary: (lead) => sendContactEmail(env, lead),
    sendAlert: (lead) => sendLeadAlert(env, lead),
    recordOutcome: async (id, patch) => {
      const { error } = await supabase
        .from('ims_contact_messages')
        .update({
          resend_status: patch.sent ? 'sent' : 'failed',
          resend_attempts: patch.attempts,
          last_attempt_at: new Date().toISOString(),
          resend_error: patch.sent ? null : (patch.error ?? '').slice(0, 500) || null,
        })
        .eq('id', id);
      if (error) console.error('[contact-sweep] recordOutcome failed for', id, error.message);
    },
  };

  try {
    const summary = await runSweep(deps, Date.now(), { limit: DEFAULT_LIMIT });
    if (summary.alert) {
      console.warn('[contact-sweep] leads still unsent:', JSON.stringify(summary));
    } else if (summary.scanned > 0) {
      console.log('[contact-sweep] reconciled:', JSON.stringify(summary));
    }
    return json(200, { ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[contact-sweep] sweep crashed:', msg.slice(0, 500));
    return json(500, { ok: false, error: 'sweep-failed' });
  }
};

export const GET: APIRoute = () => new Response('Method Not Allowed', { status: 405 });
