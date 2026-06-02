import { describe, it, expect } from 'vitest';
import { getCookie } from './cookies';

describe('getCookie', () => {
  it('reads a value among several', () => {
    expect(getCookie('a=1; hub_session=abc.def; b=2', 'hub_session')).toBe('abc.def');
  });
  it('returns null when absent or header missing', () => {
    expect(getCookie('a=1', 'hub_session')).toBeNull();
    expect(getCookie(null, 'hub_session')).toBeNull();
  });
  it('does not match a name prefix', () => {
    expect(getCookie('hub_session_x=nope', 'hub_session')).toBeNull();
  });
});
