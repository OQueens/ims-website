import { describe, it, expect, vi, beforeEach } from 'vitest';

// Lives in tests/ (NOT src/pages/) because Astro routes everything under
// src/pages/ — a *.test.ts there gets built as a page. Mock every collaborator
// so this suite exercises ONLY the route's orchestration: insert-before-send
// ordering, success-on-persist, and the both-fail->502 guard.
const parseContactForm = vi.hoisted(() => vi.fn());
const wantsJson = vi.hoisted(() => vi.fn());
const verifyTurnstile = vi.hoisted(() => vi.fn());
const sendContactEmail = vi.hoisted(() => vi.fn());
const hashIp = vi.hoisted(() => vi.fn());
const buildContactRow = vi.hoisted(() => vi.fn());
const insertContactMessage = vi.hoisted(() => vi.fn());
const markResendOutcome = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/contact-submission', () => ({ parseContactForm, wantsJson }));
vi.mock('../src/lib/turnstile-server', () => ({ verifyTurnstile }));
vi.mock('../src/lib/resend-server', () => ({ sendContactEmail }));
vi.mock('../src/lib/ip-hash', () => ({ hashIp }));
vi.mock('../src/lib/contact-persistence', () => ({ buildContactRow, insertContactMessage, markResendOutcome }));

import { POST } from '../src/pages/api/contact';

const ENV = {
  SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k',
  RESEND_API_KEY: 'r', RESEND_FROM_EMAIL: 'f', RECRUITING_TO_ADDRESS: 't',
  TURNSTILE_SECRET_KEY: 's',
};

const VALID_DATA = {
  name: 'Jordan', email: 'j@x.co', audience: 'facility' as const,
  role: '', message: '', turnstileToken: 'tok',
};

function post(accept = 'application/json') {
  const body = 'name=Jordan&email=j@x.co&audience=facility&turnstileToken=tok';
  const request = new Request('https://ims.test/api/contact', {
    method: 'POST',
    headers: {
      accept,
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': String(body.length),
      'cf-connecting-ip': '203.0.113.7',
      'user-agent': 'TestUA/1.0',
    },
    body,
  });
  return POST({ request, locals: { runtime: { env: ENV } } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  parseContactForm.mockReturnValue({ kind: 'ok', data: VALID_DATA });
  wantsJson.mockReturnValue(true);
  verifyTurnstile.mockResolvedValue(true);
  hashIp.mockResolvedValue('iphash');
  buildContactRow.mockReturnValue({ name: 'Jordan', email: 'j@x.co', audience: 'facility', role: null, message: null, ip_hash: 'iphash', user_agent: 'TestUA/1.0' });
  insertContactMessage.mockResolvedValue({ ok: true, configured: true, id: 'row-1' });
  sendContactEmail.mockResolvedValue({ ok: true });
  markResendOutcome.mockResolvedValue({ ok: true, configured: true });
});

describe('POST /api/contact orchestration', () => {
  it('insert ok + email ok -> 200 and reconciles resend_status=sent', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(markResendOutcome).toHaveBeenCalledWith(ENV, 'row-1', true, undefined);
  });

  it('insert ok + email FAIL -> still 200 (success-on-persist) and reconciles resend_status=failed', async () => {
    sendContactEmail.mockResolvedValue({ ok: false, error: 'resend down' });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(markResendOutcome).toHaveBeenCalledWith(ENV, 'row-1', false, 'resend down');
  });

  it('persistence not configured + email ok -> 200 (email-only fallback) and no reconcile', async () => {
    insertContactMessage.mockResolvedValue({ ok: false, configured: false });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(markResendOutcome).not.toHaveBeenCalled();
  });

  it('insert FAIL + email FAIL -> 502 send (the only lead-lost case) and no reconcile', async () => {
    insertContactMessage.mockResolvedValue({ ok: false, configured: true, error: 'db down' });
    sendContactEmail.mockResolvedValue({ ok: false, error: 'resend down' });
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'send' });
    expect(markResendOutcome).not.toHaveBeenCalled();
  });

  it('persists BEFORE emailing (insert-first is the core invariant)', async () => {
    const order: string[] = [];
    insertContactMessage.mockImplementation(async () => { order.push('insert'); return { ok: true, configured: true, id: 'row-1' }; });
    sendContactEmail.mockImplementation(async () => { order.push('send'); return { ok: true }; });
    await post();
    expect(order).toEqual(['insert', 'send']);
  });

  it('honeypot -> 200 with no insert and no email (no DB write, no cost)', async () => {
    parseContactForm.mockReturnValue({ kind: 'honeypot' });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertContactMessage).not.toHaveBeenCalled();
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('failed Turnstile -> 403 verify, before any insert or email', async () => {
    verifyTurnstile.mockResolvedValue(false);
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'verify' });
    expect(insertContactMessage).not.toHaveBeenCalled();
    expect(sendContactEmail).not.toHaveBeenCalled();
  });
});
