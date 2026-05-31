import { Resend } from 'resend';

export interface ResendEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RECRUITING_TO_ADDRESS?: string;
}

export interface SendResult {
  ok: boolean;
  /** Truncated (≤500) error string for logs. NEVER throws. */
  error?: string;
}

export type Audience = 'facility' | 'clinician' | 'other';

const AUDIENCE_LABEL: Record<Audience, string> = {
  facility: 'Facility',
  clinician: 'Clinician',
  other: 'Something else',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Defense-in-depth against email-header injection. validateContact's email
// regex is unanchored and the name check is only non-empty, so a CR/LF could
// reach a header-bound field (subject, replyTo). Resend's HTTPS API sanitizes
// server-side, but we strip CR/LF/tab at the boundary regardless — a legitimate
// name or address never contains them, so this is non-destructive for real input.
function stripHeader(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').trim();
}

function envOk(env: ResendEnv): env is Required<ResendEnv> {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && env.RECRUITING_TO_ADDRESS);
}

export async function sendContactEmail(env: ResendEnv, p: {
  name: string;
  email: string;
  audience: Audience;
  role?: string;
  message?: string;
}): Promise<SendResult> {
  if (!envOk(env)) return { ok: false, error: 'Missing Resend env vars' };
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    // p.audience is the Audience enum (validated upstream by parseContactForm),
    // so the lookup is always defined — no raw-user-string fallback that could
    // leak un-escaped input into the subject line.
    const label = AUDIENCE_LABEL[p.audience];
    const subject = stripHeader(`[IMS Contact · ${label}] ${p.name}`);
    const role = (p.role ?? '').trim();
    const message = (p.message ?? '').trim();
    const html =
      `<h2>New contact inquiry</h2>` +
      `<p><strong>Name:</strong> ${escapeHtml(p.name)}</p>` +
      `<p><strong>Email:</strong> ${escapeHtml(p.email)}</p>` +
      `<p><strong>I am a:</strong> ${escapeHtml(label)}</p>` +
      (role ? `<p><strong>Role or specialty:</strong> ${escapeHtml(role)}</p>` : '') +
      (message ? `<p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : '') +
      `<hr><p style="color:#888;font-size:12px">Sent from the iastaffing.com Get-in-touch form.</p>`;
    const result = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: env.RECRUITING_TO_ADDRESS,
      replyTo: stripHeader(p.email),
      subject,
      html,
    });
    if (result.error) {
      const msg = result.error.message ?? String(result.error);
      return { ok: false, error: msg.slice(0, 500) };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 500) };
  }
}
