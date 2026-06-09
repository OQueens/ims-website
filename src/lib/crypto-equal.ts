// Constant-time comparison primitives via Web Crypto (Cloudflare Workers + Node
// 22). No external deps, no app-specific coupling — shared by the hub session
// sealing (lib/hub/session.ts) AND the public contact-sweep endpoint
// (pages/api/contact-sweep.ts), so this module deliberately lives OUTSIDE
// lib/hub/ and depends on nothing hub-specific. That lets the contact-form
// lead-sweep ship to production independently of the (staging-only) hub.
const enc = new TextEncoder();

/** Constant-time byte-array compare. Returns false on length mismatch; for
 *  equal lengths the loop time does not depend on where the first byte differs. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** HMAC-SHA256 of `data` under `secret`, as raw bytes (32). */
export async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// Constant-time string compare (passcode/secret/token checks). Compares HMACs of
// the inputs so length is not leaked and timing is uniform regardless of where
// the first differing byte is.
export async function constantTimeEqual(a: string, b: string, key = 'ct-compare'): Promise<boolean> {
  const [ha, hb] = await Promise.all([hmac(key, a), hmac(key, b)]);
  return timingSafeEqual(ha, hb);
}
