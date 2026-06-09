import { describe, it, expect } from 'vitest';
import { seal, unseal, signSession, verifySession } from './session';

const SECRET = 'test-secret-0123456789-abcdefghij';

describe('seal/unseal', () => {
  it('round-trips an object', async () => {
    const t = await seal({ a: 1, b: 'x' }, SECRET);
    expect(await unseal(t, SECRET)).toEqual({ a: 1, b: 'x' });
  });
  it('rejects a tampered body', async () => {
    const t = await seal({ a: 1 }, SECRET);
    const [body, sig] = t.split('.');
    const tampered = body.slice(0, -1) + (body.endsWith('A') ? 'B' : 'A') + '.' + sig;
    expect(await unseal(tampered, SECRET)).toBeNull();
  });
  it('rejects a wrong secret', async () => {
    const t = await seal({ a: 1 }, SECRET);
    expect(await unseal(t, 'other-secret')).toBeNull();
  });
  it('rejects malformed tokens', async () => {
    expect(await unseal('', SECRET)).toBeNull();
    expect(await unseal('nodot', SECRET)).toBeNull();
    expect(await unseal('a.b.c', SECRET)).toBeNull();
  });
});

describe('signSession/verifySession', () => {
  it('issues a session that verifies before expiry', async () => {
    const now = 1_000_000;
    const tok = await signSession('zach@iastaffing.com', 'Zach', SECRET, now);
    const s = await verifySession(tok, SECRET, now + 10);
    expect(s?.email).toBe('zach@iastaffing.com');
    expect(s?.name).toBe('Zach');
  });
  it('rejects an expired session', async () => {
    const now = 1_000_000;
    const tok = await signSession('z@iastaffing.com', 'Z', SECRET, now, { ttlSeconds: 60 });
    expect(await verifySession(tok, SECRET, now + 61)).toBeNull();
  });
  it('rejects a forged session (no valid signature)', async () => {
    const forged = btoa(JSON.stringify({ email: 'x@iastaffing.com', exp: 9_999_999_999 })) + '.zzzz';
    expect(await verifySession(forged, SECRET, 1)).toBeNull();
  });
  it('kill-switch: a session minted under one generation fails under another', async () => {
    const now = 1_000_000;
    const tok = await signSession('z@iastaffing.com', 'Z', SECRET, now, { generation: '1' });
    expect((await verifySession(tok, SECRET, now + 10, '1'))?.email).toBe('z@iastaffing.com');
    expect(await verifySession(tok, SECRET, now + 10, '2')).toBeNull();
  });
});
