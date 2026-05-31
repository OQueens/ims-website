import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the resend SDK: Resend is a class whose instance exposes emails.send.
// vi.hoisted ensures sendMock is available inside the vi.mock factory (which is
// hoisted to the top of the file by vitest at transform time).
const sendMock = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () { return { emails: { send: sendMock } }; }),
}));

import { sendContactEmail } from './resend-server';

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
});
