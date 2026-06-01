import { describe, it, expect, vi } from 'vitest';
import { hashIp } from './ip-hash';

const HEX64 = /^[0-9a-f]{64}$/;

describe('hashIp', () => {
  it('returns null for absent IPs (undefined / null / empty / whitespace)', async () => {
    expect(await hashIp(undefined)).toBeNull();
    expect(await hashIp(null)).toBeNull();
    expect(await hashIp('')).toBeNull();
    expect(await hashIp('   ')).toBeNull();
  });

  it('returns a 64-char lowercase hex SHA-256 digest for a real IP', async () => {
    const h = await hashIp('203.0.113.7');
    expect(h).toMatch(HEX64);
  });

  it('is deterministic — same IP yields the same hash', async () => {
    expect(await hashIp('203.0.113.7')).toBe(await hashIp('203.0.113.7'));
  });

  it('maps different IPs to different hashes', async () => {
    expect(await hashIp('203.0.113.7')).not.toBe(await hashIp('203.0.113.8'));
  });

  it('does not store the raw IP anywhere in the output', async () => {
    const ip = '198.51.100.42';
    const h = await hashIp(ip);
    expect(h).not.toContain(ip);
  });

  it('salt (pepper) changes the digest for the same IP', async () => {
    const plain = await hashIp('203.0.113.7');
    const salted = await hashIp('203.0.113.7', 'server-secret-pepper');
    expect(salted).toMatch(HEX64);
    expect(salted).not.toBe(plain);
  });

  it('trims surrounding whitespace before hashing (clean IP == padded IP)', async () => {
    expect(await hashIp('  203.0.113.7  ')).toBe(await hashIp('203.0.113.7'));
  });

  // Known-answer vectors lock the algorithm (SHA-256) + hex encoding so a future
  // regression to a different deterministic digest can't pass the relative tests.
  it('matches the canonical SHA-256 of the IP string', async () => {
    expect(await hashIp('203.0.113.7')).toBe(
      'fec52565aa0cf18f57d7cf5b3ac728503b8992d2d6f7d46da1d1201090902b02',
    );
  });

  it('pins the salt+IP concatenation order (salt is prepended)', async () => {
    expect(await hashIp('203.0.113.7', 'server-secret-pepper')).toBe(
      '2909bafc03ca7adde6da91f187ed64bf722a578e04781f373cf74b6da396e379',
    );
  });

  // Never-throws contract: the route awaits hashIp BEFORE the durable INSERT, so
  // a Web Crypto failure must degrade to a null hash, not abort the submission.
  it('returns null (never throws) when the Web Crypto digest fails', async () => {
    const spy = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('no webcrypto'));
    expect(await hashIp('203.0.113.7')).toBeNull();
    spy.mockRestore();
  });
});
