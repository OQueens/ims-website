/**
 * hashIp — coarse, privacy-preserving fingerprint of a client IP for the
 * durable contact-capture row (`ims_contact_messages.ip_hash`). We never store
 * the raw IP: a SHA-256 digest is enough for abuse/dedup signal while keeping
 * the leads table free of plaintext PII.
 *
 * Runs on the Cloudflare Workers runtime and in Node 22 tests via the global
 * Web Crypto API (`crypto.subtle.digest`) — no Node `crypto` import, so it is
 * portable to both.
 *
 * IPs are low-entropy and brute-forceable from a bare hash, so an optional
 * `salt` (a server-side secret pepper, supplied from env when present) hardens
 * the digest against reversal. Absent a salt it degrades to a plain SHA-256,
 * which remains an acceptable internal signal for a service-role-only table.
 *
 * @returns lowercase 64-char hex digest, or null when no IP is present.
 */
export async function hashIp(ip: string | null | undefined, salt = ''): Promise<string | null> {
  const clean = (ip ?? '').trim();
  if (!clean) return null;
  try {
    const data = new TextEncoder().encode(salt + clean);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Never throw: the route awaits this BEFORE the durable INSERT, so a Web
    // Crypto failure must degrade to a null hash rather than abort the lead.
    return null;
  }
}
