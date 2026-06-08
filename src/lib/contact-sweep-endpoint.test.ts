import { describe, it, expect } from 'vitest';
import { POST } from '../pages/api/contact-sweep';

function call(opts: { auth?: string; env?: Record<string, string> } = {}) {
  const headers = new Headers();
  if (opts.auth) headers.set('authorization', opts.auth);
  const request = new Request('https://ims/api/contact-sweep', { method: 'POST', headers });
  const locals = { runtime: { env: opts.env ?? {} } };
  return POST({ request, locals } as never);
}

describe('POST /api/contact-sweep auth gate', () => {
  it('503s when the sweep token is unset (endpoint disabled)', async () => {
    const res = await call({ auth: 'Bearer anything' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('sweep-disabled');
  });

  it('401s on a wrong/absent bearer token', async () => {
    const env = { CONTACT_SWEEP_TOKEN: 'real-secret-token' };
    expect((await call({ env })).status).toBe(401);
    expect((await call({ auth: 'Bearer nope', env })).status).toBe(401);
  });

  it('503s with a valid token but no Supabase env', async () => {
    const res = await call({ auth: 'Bearer real-secret-token', env: { CONTACT_SWEEP_TOKEN: 'real-secret-token' } });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('storage-unconfigured');
  });
});
