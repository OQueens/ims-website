import { describe, it, expect } from 'vitest';
import { buildAuthUrl, decodeJwtPayload, validateIdTokenClaims } from './google-oauth';

const CID = 'client-123.apps.googleusercontent.com';

function jwt(payload: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64({ alg: 'RS256' }) + '.' + b64(payload) + '.' + 'sigsig';
}

describe('buildAuthUrl', () => {
  it('includes hd, scope, state, nonce, client_id, redirect', () => {
    const u = new URL(
      buildAuthUrl(
        { clientId: CID, redirectUri: 'https://x/hub/auth/callback', allowedDomain: 'iastaffing.com' },
        'STATE',
        'NONCE',
      ),
    );
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('hd')).toBe('iastaffing.com');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('state')).toBe('STATE');
    expect(u.searchParams.get('nonce')).toBe('NONCE');
    expect(u.searchParams.get('client_id')).toBe(CID);
    expect(u.searchParams.get('redirect_uri')).toBe('https://x/hub/auth/callback');
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
  const opts = { clientId: CID, allowedDomain: 'iastaffing.com', nonce: 'N', now: 1000 };
  it('accepts a valid token and lowercases email', () => {
    expect(validateIdTokenClaims(base, opts)).toEqual({ ok: true, email: 'zach@iastaffing.com', name: 'Zach' });
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
  it('rejects a foreign domain', () => {
    expect(validateIdTokenClaims({ ...base, email: 'a@gmail.com' }, opts)).toMatchObject({ ok: false, reason: 'domain' });
  });
  it('rejects null/malformed claims', () => {
    expect(validateIdTokenClaims(null, opts)).toMatchObject({ ok: false, reason: 'malformed' });
  });
});
