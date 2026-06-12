import { describe, it, expect } from 'vitest';
import { parseAllowedDomains } from './hub-env';

describe('parseAllowedDomains', () => {
  it('splits a comma-separated list, trimming and lowercasing', () => {
    expect(parseAllowedDomains('  IAStaffing.com , imstaffing.ai ')).toEqual(['iastaffing.com', 'imstaffing.ai']);
  });
  it('accepts a single domain', () => {
    expect(parseAllowedDomains('iastaffing.com')).toEqual(['iastaffing.com']);
  });
  it('defaults to both IMS domains when unset or empty', () => {
    expect(parseAllowedDomains(undefined)).toEqual(['iastaffing.com', 'imstaffing.ai']);
    expect(parseAllowedDomains('')).toEqual(['iastaffing.com', 'imstaffing.ai']);
    expect(parseAllowedDomains('  ,  ')).toEqual(['iastaffing.com', 'imstaffing.ai']);
  });
  it('drops empty entries from a messy list', () => {
    expect(parseAllowedDomains('iastaffing.com,,imstaffing.ai,')).toEqual(['iastaffing.com', 'imstaffing.ai']);
  });
  it('drops non-domain entries (wildcards, bare TLDs, dotless names, junk)', () => {
    expect(parseAllowedDomains('iastaffing.com,*,.com,localhost,@@@,imstaffing.ai')).toEqual([
      'iastaffing.com',
      'imstaffing.ai',
    ]);
  });
  it('falls back to the defaults when every entry is invalid', () => {
    expect(parseAllowedDomains('*, .com , @@@')).toEqual(['iastaffing.com', 'imstaffing.ai']);
  });
});
