/**
 * Cloudflare Turnstile server-side verification (siteverify).
 *
 * TRI-STATE by contract (INC-2 hardening):
 *   - 'verified'     — Cloudflare confirmed a human (success:true).
 *   - 'rejected'     — Cloudflare actively said NO (success:false), or the
 *                      client sent no token. Genuine bot signal → fail CLOSED.
 *   - 'unavailable'  — we could not get an answer from Cloudflare (missing
 *                      secret/misconfig, HTTP 5xx/429, unparseable body, network
 *                      throw). NOT the user's fault → the caller fails OPEN into
 *                      durable capture so a Cloudflare/our outage does not
 *                      silently eat every legitimate lead.
 *
 * The empty-TOKEN case stays 'rejected' on purpose: it is the dominant bot
 * signal, and a real user whose widget failed to load still sees the on-page
 * error + direct-email fallback (and the widget's expired/timeout reset retries).
 * Failing open on a missing token would be a spam floodgate.
 *
 * Never throws. Never logs the token or secret.
 */
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult = 'verified' | 'rejected' | 'unavailable';

export async function verifyTurnstile(
  token: string,
  remoteIp: string,
  secret: string,
): Promise<TurnstileResult> {
  // Missing secret = server misconfig (e.g. the CF env-var wipe hazard). Not the
  // visitor's fault → 'unavailable' so the caller captures rather than drops.
  if (!secret) return 'unavailable';
  // No token = bot signal (or a widget that never loaded) → fail closed.
  if (!token) return 'rejected';
  try {
    const body = new FormData();
    body.append('secret', secret);
    body.append('response', token);
    if (remoteIp) body.append('remoteip', remoteIp);
    const resp = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    // 5xx/429/anything non-2xx = Cloudflare-side trouble, not a verdict on the
    // user → unavailable (fail open to capture).
    if (!resp.ok) return 'unavailable';
    let json: { success?: boolean };
    try {
      json = (await resp.json()) as { success?: boolean };
    } catch {
      return 'unavailable';
    }
    return json.success === true ? 'verified' : 'rejected';
  } catch {
    // Network throw (DNS, timeout, TLS) = we couldn't reach Cloudflare → unavailable.
    return 'unavailable';
  }
}
