import { describe, it, expect } from 'vitest';
import { safeReturnTo } from './safe-redirect';

describe('safeReturnTo', () => {
  it('allows /hub and paths under it', () => {
    expect(safeReturnTo('/hub')).toBe('/hub');
    expect(safeReturnTo('/hub/')).toBe('/hub/');
    expect(safeReturnTo('/hub/settings')).toBe('/hub/settings');
  });
  it('falls back when empty or null', () => {
    expect(safeReturnTo('')).toBe('/hub');
    expect(safeReturnTo(null)).toBe('/hub');
    expect(safeReturnTo(undefined)).toBe('/hub');
  });
  it('rejects path traversal that escapes /hub', () => {
    expect(safeReturnTo('/hub/../../../etc')).toBe('/hub');
    expect(safeReturnTo('/hub/../admin')).toBe('/hub');
  });
  it('rejects protocol-relative and absolute off-site URLs', () => {
    expect(safeReturnTo('//evil.com')).toBe('/hub');
    expect(safeReturnTo('https://evil.com/hub/x')).toBe('/hub/x'); // host discarded → same-origin path
    expect(safeReturnTo('https://evil.com/phish')).toBe('/hub');
  });
  it('rejects sibling paths that merely share the /hub prefix', () => {
    expect(safeReturnTo('/hubble')).toBe('/hub');
    expect(safeReturnTo('/hub-admin')).toBe('/hub');
  });
});
