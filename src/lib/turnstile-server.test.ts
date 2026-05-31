import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyTurnstile } from './turnstile-server';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl as typeof fetch);
}

describe('verifyTurnstile', () => {
  it('returns true when Cloudflare reports success', async () => {
    const f = mockFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const ok = await verifyTurnstile('good-token', '1.2.3.4', 'secret');
    expect(ok).toBe(true);
    expect(f).toHaveBeenCalledWith(SITEVERIFY, expect.objectContaining({ method: 'POST' }));
  });

  it('returns false when Cloudflare reports failure', async () => {
    mockFetch(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    expect(await verifyTurnstile('bad-token', '1.2.3.4', 'secret')).toBe(false);
  });

  it('returns false on non-200 HTTP status (fail-closed)', async () => {
    mockFetch(async () => new Response('upstream error', { status: 500 }));
    expect(await verifyTurnstile('token', '1.2.3.4', 'secret')).toBe(false);
  });

  it('returns false when fetch throws (network error, fail-closed)', async () => {
    mockFetch(async () => { throw new Error('network down'); });
    expect(await verifyTurnstile('token', '1.2.3.4', 'secret')).toBe(false);
  });

  it('returns false when secret is empty (fail-closed, no network call)', async () => {
    const f = mockFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyTurnstile('token', '1.2.3.4', '')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns false when token is empty (fail-closed, no network call)', async () => {
    const f = mockFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyTurnstile('', '1.2.3.4', 'secret')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('omits remoteip from the body when ip is empty', async () => {
    let captured: FormData | null = null;
    mockFetch(async (_url, init) => {
      captured = init?.body as FormData;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    await verifyTurnstile('token', '', 'secret');
    expect(captured?.get('remoteip')).toBeNull();
    expect(captured?.get('secret')).toBe('secret');
    expect(captured?.get('response')).toBe('token');
  });
});
