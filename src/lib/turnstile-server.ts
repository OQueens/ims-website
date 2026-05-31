/**
 * Cloudflare Turnstile server-side verification (siteverify).
 *
 * FAIL-CLOSED by contract: any uncertainty (empty secret/token, HTTP error,
 * network throw, success:false) returns false. Never throws. Never logs the
 * token or secret.
 */
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: string, remoteIp: string, secret: string): Promise<boolean> {
  if (!secret || !token) return false;
  try {
    const body = new FormData();
    body.append('secret', secret);
    body.append('response', token);
    if (remoteIp) body.append('remoteip', remoteIp);
    const resp = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    if (!resp.ok) return false;
    const json = (await resp.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
