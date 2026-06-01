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
 * Scope (spec §7): Turnstile + Resend only. No persistence, no rate-limit.
 * Turnstile is the bot/abuse gate; the honeypot is belt-and-suspenders.
 */
import type { APIRoute } from 'astro';
import { parseContactForm, wantsJson, type ContactFields } from '../../lib/contact-submission';
import { verifyTurnstile } from '../../lib/turnstile-server';
import { sendContactEmail, type ResendEnv } from '../../lib/resend-server';

export const prerender = false;

interface ContactEnv extends ResendEnv {
  TURNSTILE_SECRET_KEY?: string;
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
    TURNSTILE_SECRET_KEY: import.meta.env.TURNSTILE_SECRET_KEY,
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
      company: get('company'),
    };
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

  const env = readEnv(locals);

  // 3. Turnstile siteverify (fail-closed).
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const human = await verifyTurnstile(data.turnstileToken, ip, env.TURNSTILE_SECRET_KEY ?? '');
  if (!human) {
    return fail(403, 'verify');
  }

  // 4. Deliver via Resend (never throws).
  const sent = await sendContactEmail(env, {
    name: data.name,
    email: data.email,
    audience: data.audience,
    role: data.role,
    message: data.message,
  });
  if (!sent.ok) {
    // Newline-sanitize the provider error before logging (prevents log-line
    // forgery if a provider message ever echoes attacker-influenced content).
    console.error('[contact] resend failed:', (sent.error ?? '').replace(/[\r\n]+/g, ' '));
    return fail(502, 'send');
  }

  return ok();
};

// Non-POST methods get a fast 405 (the form only ever POSTs).
export const GET: APIRoute = () => new Response('Method Not Allowed', { status: 405 });
export const HEAD: APIRoute = () => new Response(null, { status: 405 });
