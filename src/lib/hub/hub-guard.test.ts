import { describe, it, expect } from 'vitest';
import { isHubProtectedPath, hubGuardRedirect } from '../../middleware-logic';
import { signSession } from './session';

const SECRET = 'guard-secret-0123456789-abcdef';

describe('isHubProtectedPath', () => {
  it('protects /hub and /hub/', () => {
    expect(isHubProtectedPath('/hub')).toBe(true);
    expect(isHubProtectedPath('/hub/')).toBe(true);
  });
  it('leaves public auth paths open', () => {
    for (const p of ['/hub/login', '/hub/auth/start', '/hub/auth/callback', '/hub/auth/logout']) {
      expect(isHubProtectedPath(p)).toBe(false);
    }
  });
  it('ignores non-hub paths', () => {
    expect(isHubProtectedPath('/jobs')).toBe(false);
    expect(isHubProtectedPath('/')).toBe(false);
    expect(isHubProtectedPath('/hubbub')).toBe(false);
  });
});

describe('hubGuardRedirect', () => {
  const env = { HUB_SESSION_SECRET: SECRET };
  it('redirects an unauthenticated protected request to login', async () => {
    const r = await hubGuardRedirect('/hub', null, env, 1000);
    expect(r?.status).toBe(302);
    expect(r?.headers.get('Location')).toBe('/hub/login?returnTo=%2Fhub');
  });
  it('allows a valid session through (null = no redirect)', async () => {
    const tok = await signSession('z@iastaffing.com', 'Z', SECRET, 1000);
    expect(await hubGuardRedirect('/hub', `hub_session=${tok}`, env, 1010)).toBeNull();
  });
  it('redirects when the session is expired', async () => {
    const tok = await signSession('z@iastaffing.com', 'Z', SECRET, 1000, 60);
    const r = await hubGuardRedirect('/hub', `hub_session=${tok}`, env, 2000);
    expect(r?.status).toBe(302);
  });
  it('does not guard public paths', async () => {
    expect(await hubGuardRedirect('/hub/login', null, env, 1000)).toBeNull();
  });
});
