// HMAC-SHA256 sealed cookie value via Web Crypto (Cloudflare Workers + Node 22).
// Format: base64url(utf8(JSON)) + "." + base64url(HMAC). No external deps.
const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function seal(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const sig = bytesToB64url(await hmac(secret, body));
  return body + '.' + sig;
}
export async function unseal<T = Record<string, unknown>>(token: string, secret: string): Promise<T | null> {
  if (!token || token.split('.').length !== 2) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let given: Uint8Array;
  try { given = b64urlToBytes(sig); } catch { return null; }
  const expected = await hmac(secret, body);
  if (!timingSafeEqual(expected, given)) return null;
  try { return JSON.parse(dec.decode(b64urlToBytes(body))) as T; } catch { return null; }
}

// Constant-time string compare (passcode/secret checks). Compares HMACs of the
// inputs so length is not leaked and timing is uniform regardless of where the
// first differing byte is.
export async function constantTimeEqual(a: string, b: string, key = 'ct-compare'): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmac(key, a), hmac(key, b)]);
  return timingSafeEqual(ha, hb);
}

export interface HubSession { email: string; name: string; iat: number; exp: number; }
// 30 days — staff stay signed in to the internal hub ("keep me logged in").
export const SESSION_TTL = 2592000;

export async function signSession(
  email: string, name: string, secret: string, now: number, ttlSeconds = SESSION_TTL,
): Promise<string> {
  return seal({ email, name, iat: now, exp: now + ttlSeconds }, secret);
}
export async function verifySession(token: string, secret: string, now: number): Promise<HubSession | null> {
  const o = await unseal<HubSession>(token, secret);
  if (!o || typeof o.email !== 'string' || typeof o.exp !== 'number' || o.exp <= now) return null;
  return o;
}

// Shared Set-Cookie strings so the cookie Max-Age can never drift from the
// signed-session TTL (a mismatch would log staff out early or strand a dead cookie).
export const SESSION_COOKIE = 'hub_session';
export const sessionSetCookie = (value: string): string =>
  `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=${SESSION_TTL}`;
export const SESSION_CLEAR_COOKIE = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=0`;
