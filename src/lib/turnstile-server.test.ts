import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyTurnstile } from './turnstile-server';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl as typeof fetch);
}

describe('verifyTurnstile (tri-state)', () => {
  it("returns 'verified' when Cloudflare reports success", async () => {
    const f = mockFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyTurnstile('good-token', '1.2.3.4', 'secret')).toBe('verified');
    expect(f).toHaveBeenCalledWith(SITEVERIFY, expect.objectContaining({ method: 'POST' }));
  });

  it("returns 'rejected' when Cloudflare reports failure (genuine bot, fail closed)", async () => {
    mockFetch(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    expect(await verifyTurnstile('bad-token', '1.2.3.4', 'secret')).toBe('rejected');
  });

  it("returns 'unavailable' on non-200 HTTP status (Cloudflare-side trouble, fail open)", async () => {
    mockFetch(async () => new Response('upstream error', { status: 500 }));
    expect(await verifyTurnstile('token', '1.2.3.4', 'secret')).toBe('unavailable');
  });

  it("returns 'unavailable' on HTTP 429 (rate-limited, fail open)", async () => {
    mockFetch(async () => new Response('rate limited', { status: 429 }));
    expect(await verifyTurnstile('token', '1.2.3.4', 'secret')).toBe('unavailable');
  });

  it("returns 'unavailable' when the body is not valid JSON (fail open)", async () => {
    mockFetch(async () => new Response('<html>not json</html>', { status: 200 }));
    expect(await verifyTurnstile('token', '1.2.3.4', 'secret')).toBe('unavailable');
  });

  it("returns 'unavailable' when fetch throws (network error, fail open)", async () => {
    mockFetch(async () => { throw new Error('network down'); });
    expect(await verifyTurnstile('token', '1.2.3.4', 'secret')).toBe('unavailable');
  });

  it("returns 'unavailable' when secret is empty (server misconfig, fail open, no network call)", async () => {
    const f = mockFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyTurnstile('token', '1.2.3.4', '')).toBe('unavailable');
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 'rejected' when token is empty (bot signal, fail closed, no network call)", async () => {
    const f = mockFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyTurnstile('', '1.2.3.4', 'secret')).toBe('rejected');
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
