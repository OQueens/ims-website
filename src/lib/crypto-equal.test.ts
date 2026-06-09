import { describe, it, expect } from 'vitest';
import { constantTimeEqual, hmac, timingSafeEqual } from './crypto-equal';

describe('constantTimeEqual', () => {
  it('is true for equal strings', async () => {
    expect(await constantTimeEqual('hunter2', 'hunter2')).toBe(true);
  });
  it('is false for differing strings of equal length', async () => {
    expect(await constantTimeEqual('hunter2', 'hunter3')).toBe(false);
  });
  it('is false when only one side is empty', async () => {
    expect(await constantTimeEqual('', 'x')).toBe(false);
    expect(await constantTimeEqual('x', '')).toBe(false);
  });
  it('is true when both sides are empty', async () => {
    expect(await constantTimeEqual('', '')).toBe(true);
  });
  it('is false for strings that differ only in length (prefix)', async () => {
    expect(await constantTimeEqual('abc', 'abcd')).toBe(false);
  });
  it('handles unicode equality', async () => {
    expect(await constantTimeEqual('café—✓', 'café—✓')).toBe(true);
    expect(await constantTimeEqual('café—✓', 'café—x')).toBe(false);
  });
  it('matches on long secrets', async () => {
    const s = 'a'.repeat(4096);
    expect(await constantTimeEqual(s, s)).toBe(true);
    expect(await constantTimeEqual(s, s.slice(0, -1) + 'b')).toBe(false);
  });
});

describe('hmac', () => {
  it('is deterministic for the same secret + data', async () => {
    const a = await hmac('k', 'data');
    const b = await hmac('k', 'data');
    expect(timingSafeEqual(a, b)).toBe(true);
  });
  it('differs for a different secret', async () => {
    const a = await hmac('k1', 'data');
    const b = await hmac('k2', 'data');
    expect(timingSafeEqual(a, b)).toBe(false);
  });
  it('returns 32 bytes (SHA-256)', async () => {
    expect((await hmac('k', 'data')).length).toBe(32);
  });
});

describe('timingSafeEqual', () => {
  it('is true for identical byte arrays', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });
  it('is false for different lengths', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
  it('is false when one byte differs', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });
});
