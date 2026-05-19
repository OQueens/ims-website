// /jobs request-time enhancement (Cloudflare Pages Function).
// Reads ims_jobs ONLY through the privacy keystone (public column allowlist),
// builds public-only card HTML, and stream-injects it into the prerendered
// static Belleval shell via HTMLRewriter. Zero client JS. With no env / no
// rows / any error: returns the static shell unchanged (its baked empty-state).
import {
  fetchActiveJobs,
  specialtyLabel,
  lengthDisplay,
  facilityHeadline,
  bodyParts,
} from "../src/lib/ims-jobs-read";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );

// Card markup mirrors src/pages/jobs.astro .jc structure. The CTA reproduces
// the EXACT Astro build-time output of Button(variant="ghost") wrapping an
// arrowRight Icon, captured byte-for-byte from dist/jobs/index.html in A3
// Step 1 so injected cards are pixel-identical to Astro-rendered DOM:
//
//  - Button.astro has a scoped <style>, so its instance carries the build-time
//    cid `data-astro-cid-vnzlvqnm="true"` and Astro emits attrs in the order
//    href, data-astro-cid-vnzlvqnm, class — and one space inside the <a> around
//    the slot (Astro's <slot /> whitespace). href is /contact (the card CTA
//    target), not / (the shell's "Back to home").
//  - Icon.astro has NO <style>, so its <svg> carries NO cid and `class`
//    renders as a bare valueless attribute. arrowRight d/viewBox/size/order
//    are reproduced exactly; stroke is var(--ink) to match .btn--ghost text
//    color (identical in shape to the captured arrowRight svg, differing only
//    by the stroke value — exactly what Icon would emit inside a ghost button).
const BTN_GHOST_OPEN =
  '<a href="/contact" data-astro-cid-vnzlvqnm="true" class="btn btn--ghost"> ';
const ICON_ARROW_RIGHT =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class aria-hidden="true"><path d="M5 12h14"/><path d="m13 5 7 7-7 7"/></svg>';
const BTN_CLOSE = " </a>";

function cardHtml(j) {
  const spec = esc(specialtyLabel(j.specialty_slug));
  const len = j.length_category ? `<span class="jc__len">${esc(lengthDisplay(j.length_category))}</span>` : "";
  const head = esc(facilityHeadline(j));
  const body = bodyParts(j);
  const bodyP = body ? `<p class="jc__b">${esc(body)}</p>` : "";
  return `<article class="jc"><div class="jc__eb"><span class="jc__spec">${spec}</span>${len}</div>` +
    `<h2 class="jc__h">${head}</h2>${bodyP}` +
    `<p class="jc__rate"><em>Rate on request</em></p>` +
    `${BTN_GHOST_OPEN}Apply through IMS ${ICON_ARROW_RIGHT}${BTN_CLOSE}` +
    `</article>`;
}

export const onRequestGet = async (context) => {
  const { env } = context;
  // Fetch the prerendered shell and the (timeout-bounded) job data
  // concurrently — the data read must never serialize ahead of, or stall,
  // delivery of the static shell. fetchActiveJobs bounds itself with an
  // internal AbortController (JOBS_READ_TIMEOUT_MS), so this Promise.all
  // resolves within that bound even if Supabase stalls (Codex A4-R2).
  // context.next() resolves the prerendered static /jobs asset and does not
  // reject for a built asset; the keystone never throws (it returns a
  // discriminated result) but the .catch is last-resort defense-in-depth.
  const [result, shell] = await Promise.all([
    fetchActiveJobs({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    }).catch((e) => {
      console.error("[/jobs fn] keystone read crash:", e instanceof Error ? e.message : String(e));
      return { ok: false, reason: "client_crash" };
    }),
    context.next(),
  ]);

  if (!result.ok) {
    // 'unconfigured' is the EXPECTED pre-wiring state (Supabase not wired
    // yet) → serve the baked empty-state silently. 'query_error' /
    // 'timeout' / 'client_crash' mean the read DEGRADED while configured:
    // still serve the dignified shell (UX unchanged) but emit an operator-
    // distinct alertable log + an x-jobs-data:degraded response header so
    // uptime checks can tell degradation from a genuinely empty board.
    if (result.reason === "unconfigured") {
      return new Response(shell.body, shell);
    }
    console.error("[/jobs fn] DATA READ DEGRADED (serving baked shell, NOT true-empty inventory) — reason=" + result.reason);
    const dh = new Headers(shell.headers);
    dh.set("x-jobs-data", "degraded");
    return new Response(shell.body, { status: shell.status, statusText: shell.statusText, headers: dh });
  }

  const jobs = result.jobs;
  if (!jobs.length) return new Response(shell.body, shell); // genuinely empty inventory

  const total = jobs.length;
  const grid = `<div class="jobs__grid">${jobs.map(cardHtml).join("")}</div>`;
  const lede = `${total} active ${total === 1 ? "assignment" : "assignments"} across the IMS network. Every listing has a recruiter attached; nothing is auto-scraped.`;

  return new HTMLRewriter()
    .on("[data-jobs-h]", { element(el) { el.setInnerContent("Open opportunities."); } })
    .on("[data-jobs-lede]", { element(el) { el.setInnerContent(lede); } })
    .on("[data-jobs-slot]", { element(el) { el.setInnerContent(grid, { html: true }); } })
    .transform(shell);
};
