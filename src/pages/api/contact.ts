/**
 * POST /api/contact — Get-in-touch form receiver.
 *
 * Flow: parse FormData → honeypot drop → validate (shared predicate) →
 * Turnstile siteverify → Resend send → respond. Content-negotiated:
 *   - Accept: application/json (the JS fetch path)  → JSON { ok } + status code
 *   - otherwise (native no-JS POST)                 → 303 redirect to
 *     /contact?sent=1 (success) or /contact?error=<code> (failure), which
 *     contact.astro renders server-side.
 *
 * Scope: Turnstile + Resend + durable capture. Every valid, human-verified
 * submission is INSERTed to Supabase (ims_contact_messages) BEFORE the email so
 * a lead is never lost when Resend fails; the row's resend_status is then
 * reconciled to 'sent'/'failed'. Turnstile is the bot/abuse gate; the honeypot
 * is belt-and-suspenders. No rate-limit yet (deferred).
 */
import type { APIRoute } from 'astro';
import { parseContactForm, wantsJson, buildJobUrl, type ContactFields } from '../../lib/contact-submission';
import { verifyTurnstile } from '../../lib/turnstile-server';
import { sendContactEmail, sendLeadAlert, type ResendEnv, type SendResult } from '../../lib/resend-server';
import { hashIp } from '../../lib/ip-hash';
import {
  buildContactRow,
  insertContactMessage,
  markResendOutcome,
  type PersistenceEnv,
} from '../../lib/contact-persistence';

export const prerender = false;

interface ContactEnv extends ResendEnv, PersistenceEnv {
  TURNSTILE_SECRET_KEY?: string;
  /** Optional secret pepper for ip_hash; degrades to unsalted SHA-256 if unset. */
  IP_HASH_SALT?: string;
}

function readEnv(locals: App.Locals): ContactEnv {
  // @astrojs/cloudflare exposes Pages env at locals.runtime.env. In dev/test
  // locals.runtime is undefined → fall back to import.meta.env so misconfig
  // fails as a clean response rather than a runtime crash.
  const cf = (locals as { runtime?: { env?: ContactEnv } }).runtime?.env;
  if (cf) return cf;
  return {
    RESEND_API_KEY: import.meta.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: import.meta.env.RESEND_FROM_EMAIL,
    RECRUITING_TO_ADDRESS: import.meta.env.RECRUITING_TO_ADDRESS,
    LEAD_NOTIFY_BCC: import.meta.env.LEAD_NOTIFY_BCC,
    LEAD_ALERT_FROM: import.meta.env.LEAD_ALERT_FROM,
    LEAD_ALERT_TO: import.meta.env.LEAD_ALERT_TO,
    TURNSTILE_SECRET_KEY: import.meta.env.TURNSTILE_SECRET_KEY,
    SUPABASE_URL: import.meta.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    IP_HASH_SALT: import.meta.env.IP_HASH_SALT,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function redirect(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } });
}

// Sanitize a provider-influenced error string before logging: strip ALL control
// characters (not just CR/LF) so a crafted provider message can't forge log
// lines or inject terminal escapes, and cap the length.
const safeLog = (s: string | undefined): string =>
  (s ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').slice(0, 500);

export const POST: APIRoute = async ({ request, locals }) => {
  const accept = request.headers.get('accept');
  const asJson = wantsJson(accept);

  const ok = (): Response => (asJson ? json(200, { ok: true }) : redirect('/contact?sent=1'));
  const fail = (status: number, code: string, field?: string): Response =>
    asJson ? json(status, { ok: false, error: code, field }) : redirect(`/contact?error=${code}`);

  // Reject oversized bodies before buffering them (cheap DoS guard). A legit
  // submission is well under 100KB (the message cap is 4000 chars plus small
  // fields). Content-Length may be absent on chunked requests; then this is a
  // no-op and the Cloudflare platform request-size limit is the backstop.
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 100_000) {
    return fail(413, 'toolarge');
  }

  // 1. Parse the form body.
  let fields: ContactFields;
  let phone = '';
  // Job-inquiry context — present only on the /jobs apply form. Read raw + capped
  // here; the trusted link is built from jobSlug below (after env is available).
  const job = { slug: '', role: '', ref: '', city: '' };
  const clip = (s: string, n: number): string => s.replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);
  try {
    const form = await request.formData();
    const get = (k: string): string => {
      const v = form.get(k);
      return typeof v === 'string' ? v : '';
    };
    fields = {
      name: get('name'),
      email: get('email'),
      audience: get('audience'),
      role: get('role'),
      message: get('message'),
      turnstileToken: get('turnstileToken'),
      // Honeypot — renamed off "company" + the <label> dropped in the forms
      // (INC-2) so password managers stop autofilling it and silently dropping
      // real leads. The HTML field is now `website_url`; it still feeds the same
      // `company` honeypot slot consumed by parseContactForm.
      company: get('website_url'),
    };
    // Optional phone (only on the /jobs apply form). Read server-side + capped so
    // a no-JS native POST still captures it; folded into the message below.
    phone = clip(get('phone'), 40);
    job.slug = get('jobSlug').trim();
    job.role = clip(get('jobRole'), 160);
    job.ref = clip(get('jobRef'), 80);
    job.city = clip(get('jobCity'), 120);
  } catch {
    return fail(400, 'validation');
  }

  // 2. Validate + honeypot (pure, tested).
  const parsed = parseContactForm(fields);
  if (parsed.kind === 'honeypot') {
    // Silent success shape so the bot does not retry. No Resend (no cost).
    console.log('[contact] honeypot drop');
    return ok();
  }
  if (parsed.kind === 'invalid') {
    return fail(400, 'validation', parsed.field);
  }
  const data = parsed.data;

  // Fold the optional phone into the message — ims_contact_messages has no phone
  // column, and reading it server-side (vs the old JS-only compose) means a no-JS
  // POST keeps it. Persists in the durable row AND the recruiter email.
  if (phone) {
    data.message = data.message ? `Phone: ${phone}\n${data.message}` : `Phone: ${phone}`;
  }

  // Build a TRUSTED link to the exact job posting (validated uuid slug + request
  // origin — never a client-supplied URL) and fold it into the captured message so
  // BOTH the recruiter email AND the durable row reference the role + link, even on
  // a no-JS native POST. The email also renders it as a clickable block (renderLead).
  const jobUrl = buildJobUrl(job.slug, request.url);
  if (jobUrl && !data.message.includes(jobUrl)) {
    data.message = data.message ? `${data.message}\nJob: ${jobUrl}` : `Job: ${jobUrl}`;
  }
  // Hard final bound on the stored/emailed message. parseContactForm caps the USER
  // message at 4000; the server then prepends phone + appends the job link. Cap the
  // result so it can't grow unbounded — generous enough that the appended link
  // (added last, ~80 chars over a ≤4000 user message) is never truncated.
  if (data.message.length > 4500) data.message = data.message.slice(0, 4500);

  const env = readEnv(locals);

  // 3. Turnstile siteverify (tri-state). 'rejected' = genuine bot → 403.
  // 'unavailable' = Cloudflare unreachable/misconfigured (NOT the visitor's
  // fault) → fail OPEN into durable capture so a siteverify outage can't silently
  // eat every legitimate lead. 'verified' and 'unavailable' both proceed.
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const turnstile = await verifyTurnstile(data.turnstileToken, ip, env.TURNSTILE_SECRET_KEY ?? '');
  if (turnstile === 'rejected') {
    return fail(403, 'verify');
  }
  if (turnstile === 'unavailable') {
    console.warn('[contact] turnstile unavailable — failing open to durable capture');
  }

  // 4. Durable capture FIRST (INSERT before email) so a lead is never lost when
  // Resend fails. The row defaults to resend_status='pending'; step 6 reconciles
  // it. If Supabase isn't wired (configured:false) this is a no-op and the flow
  // degrades to email-only (the prior behavior).
  const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 512) || null;
  const ipHash = await hashIp(ip, env.IP_HASH_SALT ?? '');
  const row = buildContactRow(data, { ipHash, userAgent });
  const inserted = await insertContactMessage(env, row);
  if (inserted.configured && !inserted.ok) {
    console.error('[contact] durable capture failed:', safeLog(inserted.error));
  }

  // 5. Deliver via Resend (never throws).
  const lead = {
    name: data.name,
    email: data.email,
    audience: data.audience,
    role: data.role,
    message: data.message,
    // Job-inquiry context → renderLead leads with the role + a clickable link.
    jobUrl,
    jobRole: job.role,
    jobRef: job.ref,
    jobCity: job.city,
  };
  const sent = await sendContactEmail(env, lead);
  if (!sent.ok) {
    // safeLog strips control chars + caps length: prevents log-line forgery if a
    // provider message ever echoes attacker-influenced content.
    console.error('[contact] resend failed:', safeLog(sent.error));
  }

  // 5b. Safety-net alert. If the primary notification failed, fire a fallback
  // send FROM Resend's OWN verified domain (LEAD_ALERT_FROM) → LEAD_ALERT_TO so a
  // human is still notified — crucially this delivers even before iastaffing.com
  // is a verified sending domain (Resend testing mode can reach the account
  // owner). Fired ONLY on primary failure, so a healthy pipeline never
  // double-sends. NEVER throws; a no-op when LEAD_ALERT_TO is unset.
  let alerted: SendResult = { ok: false };
  if (!sent.ok) {
    alerted = await sendLeadAlert(env, lead);
    if (!alerted.ok) {
      console.error('[contact] safety-net alert failed:', safeLog(alerted.error));
    }
  }

  // 6. Reconcile the captured row's delivery state (only when we inserted one).
  // Awaited (not fire-and-forget) so the write completes before the Worker
  // response settles — a 'pending' row left behind would re-send on an ops sweep.
  if (inserted.ok && inserted.id) {
    const marked = await markResendOutcome(env, inserted.id, sent.ok, sent.error);
    if (!marked.ok && marked.configured) {
      console.error('[contact] resend-status reconcile failed:', safeLog(marked.error));
    }
  }

  // 7. Respond. The lead is safe if it was persisted OR emailed (primary) OR a
  // human was reached via the safety-net alert; only when ALL THREE channels
  // fail do we surface an error and ask the user to email directly.
  // Persisted-but-unsent rows carry resend_status='failed' for an ops follow-up
  // sweep (idx_ims_contact_resend) — success-on-persist trades a real-time email
  // for a durable record rather than silently dropping the lead.
  if (!inserted.ok && !sent.ok && !alerted.ok) {
    return fail(502, 'send');
  }
  return ok();
};

// Non-POST methods get a fast 405 (the form only ever POSTs).
export const GET: APIRoute = () => new Response('Method Not Allowed', { status: 405 });
export const HEAD: APIRoute = () => new Response(null, { status: 405 });
