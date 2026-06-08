import { describe, it, expect } from 'vitest';
import { POST } from '../../pages/hub/api/sync';
import { signSession } from './session';

const SECRET = 'test-secret-0123456789-abcdef';

function locals(env: Record<string, string> = {}) {
  return { runtime: { env: { HUB_SESSION_SECRET: SECRET, HUB_SESSION_GENERATION: '1', HUB_ALLOWED_DOMAIN: 'iastaffing.com', ...env } } };
}

async function call(body: unknown, opts: { cookie?: string; env?: Record<string, string> } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.cookie) headers.set('cookie', opts.cookie);
  const request = new Request('https://ims/hub/api/sync', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST({ request, locals: locals(opts.env) } as never);
}

async function validCookie() {
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession('zach@iastaffing.com', 'Zach', SECRET, now);
  return 'hub_session=' + token;
}

describe('POST /hub/api/sync', () => {
  it('401s with no session cookie', async () => {
    const res = await call({ weekKey: '2026-W24', columnKey: 'recruiting', items: [] });
    expect(res.status).toBe(401);
  });

  it('401s with a forged/invalid session', async () => {
    const res = await call({ weekKey: '2026-W24', columnKey: 'recruiting', items: [] }, { cookie: 'hub_session=not.valid' });
    expect(res.status).toBe(401);
  });

  it('400s on invalid JSON for an authenticated request', async () => {
    const res = await call('{not json', { cookie: await validCookie() });
    expect(res.status).toBe(400);
  });

  it('400s on a bad payload (unknown column)', async () => {
    const res = await call({ weekKey: '2026-W24', columnKey: 'finance', items: [] }, { cookie: await validCookie() });
    expect(res.status).toBe(400);
  });

  it('503s when storage is unconfigured (no Supabase env)', async () => {
    const res = await call({ weekKey: '2026-W24', columnKey: 'recruiting', items: ['x'] }, { cookie: await validCookie() });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('storage-unconfigured');
  });
});
