import { describe, it, expect } from 'vitest';
import { parseContactForm, wantsJson } from './contact-submission';

const base = {
  name: 'Jordan Rivers',
  email: 'jordan@example.com',
  audience: 'facility',
  role: 'Hospitalist',
  message: 'Need coverage',
  turnstileToken: 'tok',
  company: '',
};

describe('parseContactForm', () => {
  it('accepts a complete valid submission', () => {
    const r = parseContactForm(base);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.data.name).toBe('Jordan Rivers');
      expect(r.data.audience).toBe('facility');
      expect(r.data.turnstileToken).toBe('tok');
    }
  });

  it('accepts a minimal submission (no role/message)', () => {
    const r = parseContactForm({ ...base, role: '', message: '' });
    expect(r.kind).toBe('ok');
  });

  it('trims whitespace on all fields', () => {
    const r = parseContactForm({ ...base, name: '  Jordan  ', email: '  jordan@example.com  ' });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.data.name).toBe('Jordan');
  });

  it('flags honeypot when company is filled (before any other check)', () => {
    const r = parseContactForm({ ...base, company: 'AcmeBot', name: '', email: 'bad' });
    expect(r.kind).toBe('honeypot');
  });

  it('rejects missing name', () => {
    const r = parseContactForm({ ...base, name: '   ' });
    expect(r).toEqual({ kind: 'invalid', field: 'name' });
  });

  it('rejects malformed email', () => {
    const r = parseContactForm({ ...base, email: 'not-an-email' });
    expect(r).toEqual({ kind: 'invalid', field: 'email' });
  });

  it('rejects an email containing CR/LF (header-injection guard)', () => {
    const r = parseContactForm({ ...base, email: 'a@b.co\r\nBcc: attacker@example.com' });
    expect(r).toEqual({ kind: 'invalid', field: 'email' });
  });

  it('accepts valid plus-addressing (guard must not over-reject)', () => {
    const r = parseContactForm({ ...base, email: 'user+tag@example.com' });
    expect(r.kind).toBe('ok');
  });

  it('rejects missing audience', () => {
    const r = parseContactForm({ ...base, audience: '' });
    expect(r).toEqual({ kind: 'invalid', field: 'audience' });
  });

  it('rejects an audience value outside the allowed set', () => {
    const r = parseContactForm({ ...base, audience: 'hacker' });
    expect(r).toEqual({ kind: 'invalid', field: 'audience' });
  });

  it('rejects missing turnstile token', () => {
    const r = parseContactForm({ ...base, turnstileToken: '' });
    expect(r).toEqual({ kind: 'invalid', field: 'token' });
  });

  it('rejects over-length name', () => {
    const r = parseContactForm({ ...base, name: 'x'.repeat(121) });
    expect(r).toEqual({ kind: 'invalid', field: 'name' });
  });

  it('rejects over-length message', () => {
    const r = parseContactForm({ ...base, message: 'x'.repeat(4001) });
    expect(r).toEqual({ kind: 'invalid', field: 'message' });
  });

  it('silently truncates over-length role (does not reject)', () => {
    const r = parseContactForm({ ...base, role: 'x'.repeat(200) });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.data.role.length).toBe(160);
  });

  it('tolerates undefined optional fields', () => {
    const r = parseContactForm({ name: 'A', email: 'a@b.co', audience: 'other', turnstileToken: 'tok' });
    expect(r.kind).toBe('ok');
  });
});

describe('wantsJson', () => {
  it('true when Accept includes application/json', () => {
    expect(wantsJson('application/json')).toBe(true);
    expect(wantsJson('text/html, application/json;q=0.9')).toBe(true);
  });
  it('false for html-only or null Accept', () => {
    expect(wantsJson('text/html')).toBe(false);
    expect(wantsJson(null)).toBe(false);
    expect(wantsJson('')).toBe(false);
  });
});
