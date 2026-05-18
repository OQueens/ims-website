/**
 * Cloudflare Pages Function — Get In Touch → recruiting inbox.
 *
 * Path: POST /api/contact  (Pages serves top-level functions/ as Workers,
 * independent of Astro — the site stays 100% static, zero client JS.)
 *
 * Zero dependencies: calls the Resend REST API with fetch(). Reuses env vars
 * provisioned 2026-05-08 on the ims-website Pages project (Production +
 * Preview), inherited by a branch deploy of this temp site:
 *   RESEND_API_KEY        secret  — rotated key (the first was leaked + rotated)
 *   RESEND_FROM_EMAIL     text    — "Innovative Medical Staffing <hello@iastaffing.com>"
 *   RECRUITING_TO_ADDRESS text    — recruiting@iastaffing.com
 * Optional binding (project-level, inherited if present):
 *   RATE_KV               KV      — per-IP submission throttle (circuit breaker)
 *
 * Result UX is no-JS: POST → 303 to a static Belleval page (/thank-you or
 * /couldnt-send). Native HTML validation handles bad input client-side; the
 * server re-validates as the source of truth.
 *
 * Abuse controls (Codex fold 2026-05-18): per-IP KV rate limit (fail-open on
 * KV outage so a real lead is never lost), Resend Idempotency-Key for
 * double-submit dedupe, and a honeypot that NEVER drops a lead whose visible
 * fields are all valid (defends against browser autofill false-positives).
 */

const MAX = { name: 120, email: 160, phone: 40, org: 160, message: 4000 };
const INTENTS = { clinician: "clinician", facility: "facility", other: "general" };
const RL_IP_MAX = 5; // submissions per IP per window (soft, first line)
const RL_DAY_MAX = 200; // GLOBAL hard ceiling per UTC day (the spending cap)
const RL_WINDOW = 3600; // per-IP window, seconds

/** strip CRLF/tabs (header-injection hygiene) and clamp length */
function clean(value, max) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, max);
}

/** escape for safe interpolation into the HTML email body */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function go(request, path) {
  return Response.redirect(new URL(path, request.url).toString(), 303);
}

/** Mandatory abuse gate before the paid Resend call. Per the project rule
 *  "circuit breakers on all paid services — hard spending limits", this fails
 *  CLOSED: a missing/unreadable RATE_KV binding, or either counter at its cap,
 *  BLOCKS the send. The static /couldnt-send page routes the user to the phone,
 *  so a blocked lead still has a path — it is not lost. KV has no atomic
 *  increment, so the per-IP window is a soft first line; the GLOBAL per-UTC-day
 *  counter is the hard ceiling that bounds total sends even under distributed
 *  or parallel abuse (a marginal race cannot exceed the cap meaningfully). */
async function abuseBlocked(env, ipHash) {
  if (!env || !env.RATE_KV) {
    console.error(
      "[contact] RATE_KV unbound — failing CLOSED (paid-endpoint circuit breaker)",
    );
    return true;
  }
  const ipKey = `rl:contact:ip:${ipHash}`;
  const dayKey = `rl:contact:day:${new Date().toISOString().slice(0, 10)}`;
  try {
    const [ipRaw, dayRaw] = await Promise.all([
      env.RATE_KV.get(ipKey),
      env.RATE_KV.get(dayKey),
    ]);
    const ipN = ipRaw ? parseInt(ipRaw, 10) || 0 : 0;
    const dayN = dayRaw ? parseInt(dayRaw, 10) || 0 : 0;
    if (ipN >= RL_IP_MAX) {
      console.warn(`[contact] per-IP cap hit ${ipHash}`);
      return true;
    }
    if (dayN >= RL_DAY_MAX) {
      console.error(
        `[contact] GLOBAL daily cap ${RL_DAY_MAX} reached — circuit breaker OPEN`,
      );
      return true;
    }
    // best-effort counters (KV non-atomic; the day cap is the hard backstop)
    await Promise.all([
      env.RATE_KV.put(ipKey, String(ipN + 1), { expirationTtl: RL_WINDOW }),
      env.RATE_KV.put(dayKey, String(dayN + 1), { expirationTtl: 172800 }),
    ]);
    return false;
  } catch (e) {
    console.error(`[contact] RATE_KV error — failing CLOSED: ${e && e.message}`);
    return true;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let form;
  try {
    form = await request.formData();
  } catch {
    return go(request, "/couldnt-send");
  }

  const honeypot = clean(form.get("hp_url"), 200);
  const intentRaw = clean(form.get("intent"), 20).toLowerCase();
  const intentLabel = INTENTS[intentRaw] || "general";
  const name = clean(form.get("name"), MAX.name);
  const email = clean(form.get("email"), MAX.email);
  const phone = clean(form.get("phone"), MAX.phone);
  const org = clean(form.get("org"), MAX.org);
  const message = clean(form.get("message"), MAX.message);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const fieldsValid = !!name && emailOk && !!message;

  // Honeypot: only a lead with bot-like (incomplete/invalid) visible fields is
  // silently dropped. A valid lead that tripped the trap (browser autofill) is
  // still sent — we never lose a real enquiry to a hidden field.
  if (honeypot) {
    if (fieldsValid) {
      console.warn(
        "[contact] honeypot filled but visible fields valid — sending anyway (likely autofill)",
      );
    } else {
      console.warn("[contact] honeypot tripped + fields bot-like — dropped");
      return go(request, "/thank-you"); // look successful, send nothing
    }
  }

  if (!fieldsValid) {
    return go(request, "/couldnt-send");
  }

  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM_EMAIL;
  const to = env.RECRUITING_TO_ADDRESS;
  if (!apiKey || !from || !to) {
    console.error(
      "[contact] missing env: " +
        [
          !apiKey && "RESEND_API_KEY",
          !from && "RESEND_FROM_EMAIL",
          !to && "RECRUITING_TO_ADDRESS",
        ]
          .filter(Boolean)
          .join(", "),
    );
    return go(request, "/couldnt-send");
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = (await sha256hex(ip)).slice(0, 32); // never store raw IP
  if (await abuseBlocked(env, ipHash)) {
    return go(request, "/couldnt-send");
  }

  const subject = `New ${intentLabel} enquiry — ${name}`;
  const lines = [
    `Intent:  ${intentLabel}`,
    `Name:    ${name}`,
    `Email:   ${email}`,
    phone && `Phone:   ${phone}`,
    org && `Org:     ${org}`,
    "",
    "Message:",
    message,
    "",
    "— sent from the innovativemedicalstaffing.com Get In Touch form",
  ].filter((l) => l !== false && l !== undefined);
  const text = lines.join("\n");
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#161513">` +
    `<p style="margin:0 0 14px"><strong>New ${esc(intentLabel)} enquiry</strong></p>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    `<tr><td style="padding:2px 16px 2px 0;color:#6b6357">Name</td><td>${esc(name)}</td></tr>` +
    `<tr><td style="padding:2px 16px 2px 0;color:#6b6357">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>` +
    (phone ? `<tr><td style="padding:2px 16px 2px 0;color:#6b6357">Phone</td><td>${esc(phone)}</td></tr>` : "") +
    (org ? `<tr><td style="padding:2px 16px 2px 0;color:#6b6357">Org</td><td>${esc(org)}</td></tr>` : "") +
    `</table>` +
    `<p style="margin:16px 0 4px;color:#6b6357">Message</p>` +
    `<p style="margin:0;white-space:pre-wrap">${esc(message)}</p>` +
    `<hr style="border:0;border-top:1px solid #e0d8c6;margin:20px 0"/>` +
    `<p style="margin:0;font-size:12px;color:#9a9286">Sent from the innovativemedicalstaffing.com Get In Touch form</p>` +
    `</div>`;

  // No Resend idempotency key: a content-derived key (sha256 of email+message)
  // would make Resend silently swallow a *deliberate* repeat enquiry within
  // its 24h window — a clinician re-sending "did this go through?" would see
  // /thank-you but no email would reach the desk (Codex r3). A rare accidental
  // duplicate email is harmless (recruiter sees two); a silently-dropped real
  // lead is not. The per-IP + daily abuse gate already bounds true floods.
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject,
        text,
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[contact] Resend ${res.status}: ${detail.slice(0, 300)}`);
      return go(request, "/couldnt-send");
    }
  } catch (err) {
    console.error(`[contact] send threw: ${err && err.message}`);
    return go(request, "/couldnt-send");
  }

  return go(request, "/thank-you");
}
