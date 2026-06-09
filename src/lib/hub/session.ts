// HMAC-SHA256 sealed cookie value via Web Crypto (Cloudflare Workers + Node 22).
// Format: base64url(utf8(JSON)) + "." + base64url(HMAC). No external deps.
// The constant-time primitives (hmac / timingSafeEqual / constantTimeEqual) live
// in the hub-free ../crypto-equal so the public contact-sweep endpoint can reuse
// constantTimeEqual without importing any hub module.
import { hmac, timingSafeEqual } from '../crypto-equal';

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

export interface HubSession { email: string; name: string; iat: number; exp: number; gen?: string }
// 30 days — staff stay signed in to the internal hub ("keep me logged in").
export const SESSION_TTL = 2592000;
// Break-glass kill-switch: this generation tag is baked into every token and
// checked on verify. Bumping HUB_SESSION_GENERATION (env) invalidates ALL live
// sessions at once — global revocation without rotating the signing secret
// (which would also break in-flight OAuth state cookies). Per-session server-
// side revocation (a KV/D1 store) is intentionally out of scope for this small
// internal tool; logout clears the HttpOnly cookie on the device.
const DEFAULT_GENERATION = '1';

export async function signSession(
  email: string, name: string, secret: string, now: number,
  opts: { ttlSeconds?: number; generation?: string } = {},
): Promise<string> {
  const ttl = opts.ttlSeconds ?? SESSION_TTL;
  return seal({ email, name, iat: now, exp: now + ttl, gen: opts.generation ?? DEFAULT_GENERATION }, secret);
}
export async function verifySession(
  token: string, secret: string, now: number, generation: string = DEFAULT_GENERATION,
): Promise<HubSession | null> {
  const o = await unseal<HubSession>(token, secret);
  if (!o || typeof o.email !== 'string' || typeof o.exp !== 'number' || o.exp <= now) return null;
  if ((o.gen ?? DEFAULT_GENERATION) !== generation) return null;
  return o;
}

// Shared Set-Cookie strings so the cookie Max-Age can never drift from the
// signed-session TTL (a mismatch would log staff out early or strand a dead cookie).
export const SESSION_COOKIE = 'hub_session';
export const sessionSetCookie = (value: string): string =>
  `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=${SESSION_TTL}`;
export const SESSION_CLEAR_COOKIE = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=0`;
