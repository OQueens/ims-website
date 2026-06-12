import { describe, it, expect } from 'vitest';
import { buildAuthUrl, decodeJwtPayload, validateIdTokenClaims } from './google-oauth';

const CID = 'client-123.apps.googleusercontent.com';
const DOMAINS = ['iastaffing.com', 'imstaffing.ai'];

function jwt(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64({ alg: 'RS256' }) + '.' + b64(payload) + '.' + 'sigsig';
}

describe('buildAuthUrl', () => {
  it('includes scope, state, nonce, client_id, redirect', () => {
    const u = new URL(
      buildAuthUrl(
        { clientId: CID, redirectUri: 'https://x/hub/auth/callback', allowedDomains: DOMAINS },
        'STATE',
        'NONCE',
      ),
    );
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('state')).toBe('STATE');
    expect(u.searchParams.get('nonce')).toBe('NONCE');
    expect(u.searchParams.get('client_id')).toBe(CID);
    expect(u.searchParams.get('redirect_uri')).toBe('https://x/hub/auth/callback');
  });

  it('sets the hd hint when exactly one domain is allowed', () => {
    const u = new URL(
      buildAuthUrl(
        { clientId: CID, redirectUri: 'https://x/hub/auth/callback', allowedDomains: ['iastaffing.com'] },
        'S',
        'N',
      ),
    );
    expect(u.searchParams.get('hd')).toBe('iastaffing.com');
  });

  it('omits the hd hint when multiple domains are allowed (server validates instead)', () => {
    const u = new URL(
      buildAuthUrl(
        { clientId: CID, redirectUri: 'https://x/hub/auth/callback', allowedDomains: DOMAINS },
        'S',
        'N',
      ),
    );
    expect(u.searchParams.get('hd')).toBeNull();
  });
});

describe('decodeJwtPayload', () => {
  it('decodes the payload segment', () => {
    expect(decodeJwtPayload(jwt({ email: 'a@iastaffing.com' }))?.email).toBe('a@iastaffing.com');
  });
  it('returns null for non-jwt', () => {
    expect(decodeJwtPayload('nope')).toBeNull();
  });
});

describe('validateIdTokenClaims', () => {
  const base = {
    iss: 'https://accounts.google.com',
    aud: CID,
    exp: 2000,
    email: 'Zach@iastaffing.com',
    email_verified: true,
    name: 'Zach',
    nonce: 'N',
    hd: 'iastaffing.com',
  };
  const opts = { clientId: CID, allowedDomains: DOMAINS, nonce: 'N', now: 1000 };

  it('accepts a valid iastaffing.com token and lowercases email', () => {
    expect(validateIdTokenClaims(base, opts)).toEqual({ ok: true, email: 'zach@iastaffing.com', name: 'Zach' });
  });
  it('accepts an imstaffing.ai token', () => {
    const claims = { ...base, email: 'New@imstaffing.ai', hd: 'imstaffing.ai' };
    expect(validateIdTokenClaims(claims, opts)).toEqual({ ok: true, email: 'new@imstaffing.ai', name: 'Zach' });
  });
  it('accepts an imstaffing.ai email even when hd reports the primary domain (secondary-domain Workspace)', () => {
    const claims = { ...base, email: 'new@imstaffing.ai', hd: 'iastaffing.com' };
    expect(validateIdTokenClaims(claims, opts)).toMatchObject({ ok: true, email: 'new@imstaffing.ai' });
  });
  it('rejects wrong issuer', () => {
    expect(validateIdTokenClaims({ ...base, iss: 'evil' }, opts)).toMatchObject({ ok: false, reason: 'iss' });
  });
  it('rejects wrong audience', () => {
    expect(validateIdTokenClaims({ ...base, aud: 'other' }, opts)).toMatchObject({ ok: false, reason: 'aud' });
  });
  it('rejects expired', () => {
    expect(validateIdTokenClaims({ ...base, exp: 999 }, opts)).toMatchObject({ ok: false, reason: 'expired' });
  });
  it('rejects nonce mismatch', () => {
    expect(validateIdTokenClaims({ ...base, nonce: 'X' }, opts)).toMatchObject({ ok: false, reason: 'nonce' });
  });
  it('rejects unverified email', () => {
    expect(validateIdTokenClaims({ ...base, email_verified: false }, opts)).toMatchObject({ ok: false, reason: 'unverified' });
  });
  it('rejects a foreign email domain not in the allowlist', () => {
    expect(validateIdTokenClaims({ ...base, email: 'a@gmail.com', hd: 'iastaffing.com' }, opts)).toMatchObject({ ok: false, reason: 'domain' });
    expect(validateIdTokenClaims({ ...base, email: 'a@evil.com', hd: 'evil.com' }, opts)).toMatchObject({ ok: false, reason: 'domain' });
  });
  it('rejects a missing or out-of-allowlist hd claim (defense-in-depth)', () => {
    const { hd, ...noHd } = base;
    expect(validateIdTokenClaims(noHd, opts)).toMatchObject({ ok: false, reason: 'domain' });
    expect(validateIdTokenClaims({ ...base, hd: 'evil.com' }, opts)).toMatchObject({ ok: false, reason: 'domain' });
  });
  it('rejects null/malformed claims', () => {
    expect(validateIdTokenClaims(null, opts)).toMatchObject({ ok: false, reason: 'malformed' });
  });
});
