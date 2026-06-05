import { Resend } from 'resend';

export interface ResendEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RECRUITING_TO_ADDRESS?: string;
  /** Optional comma-separated BCC on the PRIMARY lead email (e.g. an owner inbox).
   *  Only delivers once the sending domain is Resend-verified (testing mode blocks
   *  non-owner recipients). */
  LEAD_NOTIFY_BCC?: string;
  /** Safety-net sender. Defaults to Resend's OWN verified domain so the fallback
   *  alert delivers even before iastaffing.com is a verified Resend domain. */
  LEAD_ALERT_FROM?: string;
  /** Safety-net recipient(s), comma-separated. In Resend testing mode the only
   *  reachable address is the account owner (zach.young@iastaffing.com); add the
   *  gmail/recruiting addresses after the domain is verified. When unset, the
   *  safety-net alert is a no-op. */
  LEAD_ALERT_TO?: string;
}

export interface SendResult {
  ok: boolean;
  /** Truncated (≤500) error string for logs. NEVER throws. */
  error?: string;
}

export type Audience = 'facility' | 'clinician' | 'other';

/** The lead content shared by the primary email and the safety-net alert. */
export interface LeadPayload {
  name: string;
  email: string;
  audience: Audience;
  role?: string;
  message?: string;
}

const AUDIENCE_LABEL: Record<Audience, string> = {
  facility: 'Facility',
  clinician: 'Clinician',
  other: 'Something else',
};

const DEFAULT_ALERT_FROM = 'IMS Lead (safety-net) <onboarding@resend.dev>';

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

/** Split a comma-separated address list into clean, header-safe entries. */
function parseList(s: string | undefined): string[] {
  return (s ?? '')
    .split(',')
    .map((x) => stripHeader(x))
    .filter(Boolean);
}

interface RequiredResend {
  RESEND_API_KEY: string;
  RESEND_FROM_EMAIL: string;
  RECRUITING_TO_ADDRESS: string;
}

function envOk(env: ResendEnv): env is ResendEnv & RequiredResend {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && env.RECRUITING_TO_ADDRESS);
}

/** Build the subject + HTML for a lead. Single source of truth so the primary
 *  email and the safety-net alert render identical content (the alert adds a
 *  banner explaining why the visitor's primary notification did not arrive). */
function renderLead(p: LeadPayload, opts?: { safetyNet?: boolean }): { subject: string; html: string } {
  // p.audience is the Audience enum (validated upstream by parseContactForm), so
  // the lookup is always defined — no raw-user-string fallback that could leak
  // un-escaped input into the subject line.
  const label = AUDIENCE_LABEL[p.audience];
  const prefix = opts?.safetyNet ? `[IMS Lead · safety-net] ` : `[IMS Contact · ${label}] `;
  const subject = stripHeader(`${prefix}${p.name}`);
  const role = (p.role ?? '').trim();
  const message = (p.message ?? '').trim();
  const banner = opts?.safetyNet
    ? `<p style="background:#FBE9C9;border:1px solid #E8C465;padding:10px 12px;border-radius:8px;font-size:13px;line-height:1.5">` +
      `<strong>Safety-net copy.</strong> The primary notification to recruiting@iastaffing.com did not send ` +
      `(the sending domain is not yet verified, or Resend errored). Reply here or follow up directly — this lead is captured.</p>`
    : '';
  const html =
    `<h2>New contact inquiry</h2>` +
    banner +
    `<p><strong>Name:</strong> ${escapeHtml(p.name)}</p>` +
    `<p><strong>Email:</strong> ${escapeHtml(p.email)}</p>` +
    `<p><strong>I am a:</strong> ${escapeHtml(label)}</p>` +
    (role ? `<p><strong>Role or specialty:</strong> ${escapeHtml(role)}</p>` : '') +
    (message ? `<p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>` : '') +
    `<hr><p style="color:#888;font-size:12px">Sent from the iastaffing.com Get-in-touch form.</p>`;
  return { subject, html };
}

/** PRIMARY lead notification: FROM the branded sender TO recruiting@, optional
 *  BCC (owner inbox). replyTo = submitter so a reply reaches the lead. */
export async function sendContactEmail(env: ResendEnv, p: LeadPayload): Promise<SendResult> {
  if (!envOk(env)) return { ok: false, error: 'Missing Resend env vars' };
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { subject, html } = renderLead(p);
    const bcc = parseList(env.LEAD_NOTIFY_BCC);
    const result = await resend.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: env.RECRUITING_TO_ADDRESS,
      ...(bcc.length ? { bcc } : {}),
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

/** SAFETY-NET alert: a Resend-channel fallback fired when the primary send fails.
 *  Sends FROM Resend's own verified domain by default (LEAD_ALERT_FROM) so it
 *  delivers even before iastaffing.com is verified, TO LEAD_ALERT_TO (the
 *  testing-mode-reachable owner address until the domain is verified). NEVER
 *  throws; a no-op (ok:false) when the key or recipient is unset. This is NOT a
 *  Resend-independent channel — a full Resend outage still defeats it; the
 *  scheduled reconcile worker (INC-3) adds the out-of-band path. */
export async function sendLeadAlert(env: ResendEnv, p: LeadPayload): Promise<SendResult> {
  const to = parseList(env.LEAD_ALERT_TO);
  if (!env.RESEND_API_KEY || to.length === 0) {
    return { ok: false, error: 'Safety-net alert not configured (RESEND_API_KEY/LEAD_ALERT_TO)' };
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { subject, html } = renderLead(p, { safetyNet: true });
    const result = await resend.emails.send({
      from: stripHeader(env.LEAD_ALERT_FROM || DEFAULT_ALERT_FROM),
      to,
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
