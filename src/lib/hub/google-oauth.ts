// Self-contained Google OAuth 2.0 authorization-code flow. The id_token is
// obtained server-side from Google's token endpoint over TLS (trusted by
// channel), so we decode-and-validate claims rather than verify the RS256
// signature (defense-in-depth claim checks below).
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthUrl(
  cfg: { clientId: string; redirectUri: string; allowedDomains: string[] },
  state: string,
  nonce: string,
): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
    access_type: 'online',
  });
  // Google's `hd` hint takes a single domain. With one allowed domain we pass it
  // to pre-filter the account chooser; with multiple we omit it (a `*` wildcard
  // risks invalid_request) and rely on the server-side allowlist in
  // validateIdTokenClaims — that claim check is the real gate either way.
  if (cfg.allowedDomains.length === 1) p.set('hd', cfg.allowedDomains[0]);
  return GOOGLE_AUTH_ENDPOINT + '?' + p.toString();
}

export interface IdTokenClaims {
  iss?: string; aud?: string; exp?: number;
  email?: string; email_verified?: boolean | string; name?: string;
  nonce?: string; hd?: string;
}

export function decodeJwtPayload(idToken: string): IdTokenClaims | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    let s = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as IdTokenClaims;
  } catch {
    return null;
  }
}

export type ClaimResult =
  | { ok: true; email: string; name: string }
  | { ok: false; reason: 'malformed' | 'iss' | 'aud' | 'expired' | 'nonce' | 'unverified' | 'domain' };

export function validateIdTokenClaims(
  claims: IdTokenClaims | null,
  opts: { clientId: string; allowedDomains: string[]; nonce: string; now: number },
): ClaimResult {
  if (!claims || typeof claims.email !== 'string') return { ok: false, reason: 'malformed' };
  const iss = claims.iss ?? '';
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') return { ok: false, reason: 'iss' };
  if (claims.aud !== opts.clientId) return { ok: false, reason: 'aud' };
  if (typeof claims.exp !== 'number' || claims.exp <= opts.now) return { ok: false, reason: 'expired' };
  if (claims.nonce !== opts.nonce) return { ok: false, reason: 'nonce' };
  if (!(claims.email_verified === true || claims.email_verified === 'true')) return { ok: false, reason: 'unverified' };
  const domains = opts.allowedDomains.map((d) => d.toLowerCase());
  const email = claims.email.toLowerCase();
  if (!domains.some((d) => email.endsWith('@' + d))) return { ok: false, reason: 'domain' };
  // Defense-in-depth (Google's own recommendation): require the Workspace
  // hosted-domain claim and that it is one of the allowed domains. Workspace
  // accounts always populate `hd`; personal Gmail never does, so this rejects any
  // non-Workspace token even if it somehow carried a matching email. In a
  // multi-domain Workspace `hd` may report the org's primary domain rather than
  // the user's email domain, so we check allowlist membership, not equality.
  const hd = typeof claims.hd === 'string' ? claims.hd.toLowerCase() : '';
  if (!hd || !domains.includes(hd)) return { ok: false, reason: 'domain' };
  return { ok: true, email, name: typeof claims.name === 'string' && claims.name ? claims.name : email };
}

export async function exchangeCode(
  cfg: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id_token?: string } | null> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  try {
    const res = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;
    return (await res.json()) as { id_token?: string };
  } catch {
    return null;
  }
}
