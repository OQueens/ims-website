import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the resend SDK: Resend is a class whose instance exposes emails.send.
// vi.hoisted ensures sendMock is available inside the vi.mock factory (which is
// hoisted to the top of the file by vitest at transform time).
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () { return { emails: { send: sendMock } }; }),
}));

import { sendContactEmail, sendLeadAlert } from './resend-server';

const ENV = {
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'noreply@iastaffing.com',
  RECRUITING_TO_ADDRESS: 'recruiting@iastaffing.com',
};

beforeEach(() => {
  sendMock.mockReset();
});

describe('sendContactEmail', () => {
  it('returns ok:true and sends with replyTo = submitter email', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const res = await sendContactEmail(ENV, {
      name: 'Jordan Rivers', email: 'jordan@example.com', audience: 'facility',
      role: 'Hospitalist', message: 'We need night coverage.',
    });
    expect(res.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.from).toBe(ENV.RESEND_FROM_EMAIL);
    expect(arg.to).toBe(ENV.RECRUITING_TO_ADDRESS);
    expect(arg.replyTo).toBe('jordan@example.com');
    expect(arg.subject).toContain('Jordan Rivers');
    expect(arg.subject).toContain('Facility');
    expect(arg.html).toContain('jordan@example.com');
    expect(arg.html).toContain('Hospitalist');
    expect(arg.html).toContain('We need night coverage.');
  });

  it('escapes HTML in user fields (no injection into the admin email)', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_2' }, error: null });
    await sendContactEmail(ENV, {
      name: '<script>alert(1)</script>', email: 'x@y.co', audience: 'clinician',
      role: '', message: 'a & b < c > d "q" \'s\'',
    });
    const html = sendMock.mock.calls[0][0].html as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  it('omits optional role/message lines when empty', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_3' }, error: null });
    await sendContactEmail(ENV, { name: 'A', email: 'a@b.co', audience: 'other', role: '', message: '' });
    const html = sendMock.mock.calls[0][0].html as string;
    expect(html).not.toContain('Role');
    expect(html).not.toContain('Message');
  });

  it('returns ok:false with truncated error when Resend returns an error object', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'x'.repeat(900) } });
    const res = await sendContactEmail(ENV, { name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: 'hi' });
    expect(res.ok).toBe(false);
    expect((res.error ?? '').length).toBeLessThanOrEqual(500);
  });

  it('never throws — returns ok:false when send() rejects', async () => {
    sendMock.mockRejectedValue(new Error('boom'));
    const res = await sendContactEmail(ENV, { name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('boom');
  });

  it('returns ok:false without calling send() when env is incomplete', async () => {
    const res = await sendContactEmail({ RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', RECRUITING_TO_ADDRESS: '' }, {
      name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: 'hi',
    });
    expect(res.ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('strips CR/LF from header-bound fields (subject name + replyTo) — no header injection', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_4' }, error: null });
    await sendContactEmail(ENV, {
      name: 'Evil\r\nBcc: attacker@example.com',
      email: 'a@b.co\r\nBcc: attacker@example.com',
      audience: 'facility', role: '', message: 'hi',
    });
    const arg = sendMock.mock.calls[0][0];
    expect(arg.subject).not.toMatch(/[\r\n]/);
    expect(arg.replyTo).not.toMatch(/[\r\n]/);
  });
});

describe('sendContactEmail — job inquiry (role + direct link)', () => {
  const JOB_URL = 'https://imstaffing.ai/jobs/11111111-2222-3333-4444-555555555555';
  it('leads the subject with the role and renders a clickable link to the posting', async () => {
    sendMock.mockResolvedValue({ data: { id: 'j1' }, error: null });
    await sendContactEmail(ENV, {
      name: 'Dana Lee', email: 'dana@x.co', audience: 'clinician', role: 'CRNA · Ref A-123',
      message: 'Available in July.', jobUrl: JOB_URL, jobRole: 'CRNA', jobRef: 'A-123', jobCity: 'Austin, TX',
    });
    const arg = sendMock.mock.calls[0][0];
    expect(arg.subject).toContain('IMS Job');
    expect(arg.subject).toContain('CRNA');
    expect(arg.html).toContain('Regarding this role');
    expect(arg.html).toContain('Austin, TX');
    expect(arg.html).toContain('A-123');
    expect(arg.html).toContain(`href="${JOB_URL}"`);
    expect(arg.html).toContain('View the job posting');
  });

  it('drops a non-http(s) jobUrl (no javascript: href reaches the email)', async () => {
    sendMock.mockResolvedValue({ data: { id: 'j2' }, error: null });
    await sendContactEmail(ENV, {
      name: 'X', email: 'x@y.co', audience: 'clinician', role: '', message: '',
      jobUrl: 'javascript:alert(1)', jobRole: 'Hospitalist',
    });
    const html = sendMock.mock.calls[0][0].html as string;
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('View the job posting'); // no link rendered
    expect(html).toContain('Regarding this role'); // role still shown
  });

  it('a non-job contact has no job block and keeps the audience-typed subject', async () => {
    sendMock.mockResolvedValue({ data: { id: 'j3' }, error: null });
    await sendContactEmail(ENV, { name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: 'hi' });
    const arg = sendMock.mock.calls[0][0];
    expect(arg.subject).toContain('IMS Contact');
    expect(arg.html).not.toContain('Regarding this role');
  });
});

describe('sendContactEmail — BCC (owner copy)', () => {
  it('adds bcc when LEAD_NOTIFY_BCC is set (comma-split + header-stripped)', async () => {
    sendMock.mockResolvedValue({ data: { id: 'm' }, error: null });
    await sendContactEmail({ ...ENV, LEAD_NOTIFY_BCC: 'owner@gmail.com, second@x.co' }, {
      name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: 'hi',
    });
    expect(sendMock.mock.calls[0][0].bcc).toEqual(['owner@gmail.com', 'second@x.co']);
  });

  it('omits the bcc key entirely when LEAD_NOTIFY_BCC is unset', async () => {
    sendMock.mockResolvedValue({ data: { id: 'm' }, error: null });
    await sendContactEmail(ENV, { name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: 'hi' });
    expect('bcc' in sendMock.mock.calls[0][0]).toBe(false);
  });
});

describe('sendLeadAlert — safety-net fallback', () => {
  const ALERT_ENV = { RESEND_API_KEY: 're_test_key', LEAD_ALERT_TO: 'zach.young@iastaffing.com' };

  it('sends FROM the default Resend-verified sender TO LEAD_ALERT_TO with the safety-net banner', async () => {
    sendMock.mockResolvedValue({ data: { id: 'a1' }, error: null });
    const res = await sendLeadAlert(ALERT_ENV, {
      name: 'Jordan', email: 'j@x.co', audience: 'clinician', role: 'CRNA', message: 'hello',
    });
    expect(res.ok).toBe(true);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.from).toContain('onboarding@resend.dev');
    expect(arg.to).toEqual(['zach.young@iastaffing.com']);
    expect(arg.replyTo).toBe('j@x.co');
    expect(arg.subject).toContain('safety-net');
    expect(arg.html).toContain('Safety-net copy');
    expect(arg.html).toContain('CRNA');
  });

  it('uses LEAD_ALERT_FROM when provided and supports a comma list of recipients', async () => {
    sendMock.mockResolvedValue({ data: { id: 'a2' }, error: null });
    await sendLeadAlert(
      { ...ALERT_ENV, LEAD_ALERT_FROM: 'Ops <ops@iastaffing.com>', LEAD_ALERT_TO: 'a@x.co, b@y.co' },
      { name: 'A', email: 'a@b.co', audience: 'other', role: '', message: '' },
    );
    const arg = sendMock.mock.calls[0][0];
    expect(arg.from).toBe('Ops <ops@iastaffing.com>');
    expect(arg.to).toEqual(['a@x.co', 'b@y.co']);
  });

  it('is a no-op (ok:false, no send) when LEAD_ALERT_TO is unset', async () => {
    const res = await sendLeadAlert({ RESEND_API_KEY: 're_test_key' }, {
      name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: '',
    });
    expect(res.ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('is a no-op when RESEND_API_KEY is unset', async () => {
    const res = await sendLeadAlert({ LEAD_ALERT_TO: 'z@x.co' }, {
      name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: '',
    });
    expect(res.ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('never throws — returns ok:false when send() rejects', async () => {
    sendMock.mockRejectedValue(new Error('boom'));
    const res = await sendLeadAlert(ALERT_ENV, { name: 'A', email: 'a@b.co', audience: 'facility', role: '', message: '' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('boom');
  });
});
