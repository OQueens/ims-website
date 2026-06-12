import { describe, it, expect, vi, beforeEach } from 'vitest';

// Lives in tests/ (NOT src/pages/) because Astro routes everything under
// src/pages/ — a *.test.ts there gets built as a page. Mock every collaborator
// so this suite exercises ONLY the route's orchestration: insert-before-send
// ordering, success-on-persist, and the both-fail->502 guard.
const parseContactForm = vi.hoisted(() => vi.fn());
const wantsJson = vi.hoisted(() => vi.fn());
const buildJobUrl = vi.hoisted(() => vi.fn());
const verifyTurnstile = vi.hoisted(() => vi.fn());
const sendContactEmail = vi.hoisted(() => vi.fn());
const sendLeadAlert = vi.hoisted(() => vi.fn());
const hashIp = vi.hoisted(() => vi.fn());
const buildContactRow = vi.hoisted(() => vi.fn());
const insertContactMessage = vi.hoisted(() => vi.fn());
const markResendOutcome = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/contact-submission', () => ({ parseContactForm, wantsJson, buildJobUrl }));
vi.mock('../src/lib/turnstile-server', () => ({ verifyTurnstile }));
vi.mock('../src/lib/resend-server', () => ({ sendContactEmail, sendLeadAlert }));
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
  // Fresh copy each test: the route may mutate data.message (phone fold), so a
  // shared object reference would leak across tests.
  parseContactForm.mockReturnValue({ kind: 'ok', data: { ...VALID_DATA } });
  wantsJson.mockReturnValue(true);
  buildJobUrl.mockReturnValue(''); // no job context by default (general contact form)
  verifyTurnstile.mockResolvedValue('verified');
  hashIp.mockResolvedValue('iphash');
  buildContactRow.mockReturnValue({ name: 'Jordan', email: 'j@x.co', audience: 'facility', role: null, message: null, ip_hash: 'iphash', user_agent: 'TestUA/1.0' });
  insertContactMessage.mockResolvedValue({ ok: true, configured: true, id: 'row-1' });
  sendContactEmail.mockResolvedValue({ ok: true });
  // Default: safety-net alert not configured (no LEAD_ALERT_TO in ENV) → ok:false.
  sendLeadAlert.mockResolvedValue({ ok: false });
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

  it('insert FAIL + primary FAIL + safety-net FAIL -> 502 send (the only true lead-lost case) and no reconcile', async () => {
    insertContactMessage.mockResolvedValue({ ok: false, configured: true, error: 'db down' });
    sendContactEmail.mockResolvedValue({ ok: false, error: 'resend down' });
    sendLeadAlert.mockResolvedValue({ ok: false, error: 'alert down' });
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: 'send' });
    expect(sendLeadAlert).toHaveBeenCalledTimes(1);
    expect(markResendOutcome).not.toHaveBeenCalled();
  });

  it('primary FAIL fires the safety-net alert; alert OK -> 200 (human reached) and reconcile records the PRIMARY failure', async () => {
    sendContactEmail.mockResolvedValue({ ok: false, error: 'testing mode' });
    sendLeadAlert.mockResolvedValue({ ok: true });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendLeadAlert).toHaveBeenCalledTimes(1);
    expect(markResendOutcome).toHaveBeenCalledWith(ENV, 'row-1', false, 'testing mode');
  });

  it('does NOT fire the safety-net alert when the primary send succeeds (no double-send)', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(sendLeadAlert).not.toHaveBeenCalled();
  });

  it('insert FAIL + primary FAIL + safety-net OK -> 200 (lead reached a human even with no durable row)', async () => {
    insertContactMessage.mockResolvedValue({ ok: false, configured: true, error: 'db down' });
    sendContactEmail.mockResolvedValue({ ok: false, error: 'resend down' });
    sendLeadAlert.mockResolvedValue({ ok: true });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
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

  it('REJECTED Turnstile (genuine bot) -> 403 verify, before any insert or email', async () => {
    verifyTurnstile.mockResolvedValue('rejected');
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'verify' });
    expect(insertContactMessage).not.toHaveBeenCalled();
    expect(sendContactEmail).not.toHaveBeenCalled();
  });

  it('UNAVAILABLE Turnstile (Cloudflare outage) -> fails OPEN: 200, durable capture still happens', async () => {
    verifyTurnstile.mockResolvedValue('unavailable');
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertContactMessage).toHaveBeenCalled();
    expect(sendContactEmail).toHaveBeenCalled();
  });

  it('reads the phone field server-side and folds it into the captured message', async () => {
    const body = 'name=Jordan&email=j@x.co&audience=facility&turnstileToken=tok&phone=555-123-4567';
    const request = new Request('https://ims.test/api/contact', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(body.length),
        'cf-connecting-ip': '203.0.113.7',
        'user-agent': 'TestUA/1.0',
      },
      body,
    });
    await POST({ request, locals: { runtime: { env: ENV } } } as never);
    // The route mutates data.message before buildContactRow; assert the phone landed.
    const rowData = buildContactRow.mock.calls[0][0];
    expect(rowData.message).toContain('Phone: 555-123-4567');
  });

  it('maps the renamed honeypot field (website_url) into the company slot parseContactForm checks', async () => {
    const body = 'name=Jordan&email=j@x.co&audience=facility&turnstileToken=tok&website_url=bot-filled-this';
    const request = new Request('https://ims.test/api/contact', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(body.length),
        'cf-connecting-ip': '203.0.113.7',
        'user-agent': 'TestUA/1.0',
      },
      body,
    });
    await POST({ request, locals: { runtime: { env: ENV } } } as never);
    // Honeypot plumbing: the HTML field `website_url` must feed the `company`
    // slot that parseContactForm inspects — otherwise the honeypot is dead.
    expect(parseContactForm).toHaveBeenCalledWith(expect.objectContaining({ company: 'bot-filled-this' }));
  });

  it('job inquiry: folds the trusted job link into the message + passes job context to the email', async () => {
    buildJobUrl.mockReturnValue('https://imstaffing.ai/jobs/11111111-2222-3333-4444-555555555555');
    const body =
      'name=Jordan&email=j@x.co&audience=clinician&turnstileToken=tok' +
      '&jobSlug=11111111-2222-3333-4444-555555555555&jobRole=CRNA&jobRef=A-123&jobCity=Austin%2C+TX';
    const request = new Request('https://ims.test/api/contact', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(body.length),
        'cf-connecting-ip': '203.0.113.7',
        'user-agent': 'TestUA/1.0',
      },
      body,
    });
    await POST({ request, locals: { runtime: { env: ENV } } } as never);
    // The link is folded into the captured row's message (durable + no-JS safe)…
    expect(buildContactRow.mock.calls[0][0].message).toContain('Job: https://imstaffing.ai/jobs/');
    // …and the job context reaches the recruiter email (renderLead → clickable link).
    const lead = sendContactEmail.mock.calls[0][1];
    expect(lead.jobUrl).toBe('https://imstaffing.ai/jobs/11111111-2222-3333-4444-555555555555');
    expect(lead.jobRole).toBe('CRNA');
    expect(lead.jobRef).toBe('A-123');
    expect(lead.jobCity).toBe('Austin, TX');
  });
});
