# IMS Step 1 — AMENDMENT: Pages Functions + HTMLRewriter (supersedes the adapter architecture)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver request-time-fresh `/jobs` (public-only `ims_jobs` data) and the LS webhook on the EXISTING Cloudflare **Pages** deployment, with zero client JS, full Belleval design, and the live Resend contact form + site CSP/canonicalization untouched — by replacing the (now-impossible) Astro Cloudflare adapter with Cloudflare **Pages Functions + HTMLRewriter**.

**Architecture:** The Astro site stays **100% static (no adapter)** — the proven pre-Step-1 model. `/jobs` is a prerendered full-Belleval shell whose dignified empty-state is the default content. A route Pages Function `functions/jobs.js` reads `ims_jobs` through the privacy keystone, builds public-only card HTML, fetches the static shell via `context.next()`, and stream-injects the cards with `HTMLRewriter`; empty/error returns the shell untouched. The LS webhook is a Pages Function `functions/api/locumsmart-webhook.js` reusing the verbatim pure logic. `functions/_middleware.js` (CSP + host canonicalization) and `functions/api/contact.js` (Resend) are untouched and keep working because there is no `_worker.js` to trigger Cloudflare advanced-mode.

**Tech Stack:** Astro 6 (static, no adapter), Cloudflare Pages Functions, `@supabase/supabase-js`, `HTMLRewriter` (CF runtime built-in), vitest, TypeScript.

**Supersedes:** the original `docs/superpowers/plans/2026-05-18-ims-step1-backend-consolidation.md` Tasks 1, 5, 6 and the spec's "runtime decision" (Astro adapter). Tasks 2, 3-migrations, and 4 from the original plan are COMPLETE and CARRY OVER UNCHANGED.

---

## Why this amendment exists (verified blocker)

`@astrojs/cloudflare@13` (the only major peer-compatible with Astro 6) **dropped Cloudflare Pages support** — Workers only. Verified from three primary sources: the installed package README ("SSR adapter for use with Cloudflare Workers targets"), the official Astro adapter docs ("no longer supports deployment on Cloudflare Pages"), and the `withastro/adapters` changelog (dropped in `@astrojs/cloudflare@13.0.0`). Production is the `ims-website` Cloudflare **Pages** project; any `_worker.js`-style adapter output there makes the whole `functions/` directory ignored (CF advanced-mode), which would break `functions/api/contact.js` (Resend) and `functions/_middleware.js` (the entire site CSP + `.pages.dev → innovativemedicalstaffing.com` canonicalization). The original Step-1 runtime decision is therefore invalid.

**The replacement mechanism was proven end-to-end on the real `wrangler pages dev` runtime before this re-plan** (throwaway spike, now deleted): a route Function `functions/jobs.js` calling `context.next()` returns the prerendered static shell; `HTMLRewriter` injects server-built cards; zero `<script>`; the empty path preserves the baked static empty-state; `_middleware.js` CSP composes onto the transformed response; a sibling `functions/api/contact.js` coexists. [runtime-verified]

## Current committed state (HEAD `f46cedd`, branch `feat/ims-temp-site`, NOTHING pushed)

| Original task | Commit | Disposition in this amendment |
|---|---|---|
| T1 adapter + supabase-js + vitest (`cb23e1b`,`35c7b91`) | done | **A1 reverts the adapter**; keeps supabase-js + vitest |
| T2 `src/lib/locumsmart-webhook-logic.ts`+`.test.ts` 69/69 (`f93e694`) | done | **CARRIES UNCHANGED**; reused by A2 |
| T3 `src/pages/api/locumsmart-webhook.ts` + 2 migrations (`b87a080`) | done | migrations **CARRY**; the Astro route is **deleted in A1, re-homed as a Pages Function in A2** |
| T4 `src/lib/ims-jobs-read.ts`+`.test.ts` 72/72 (`5aa8c13`) | done | **CARRIES UNCHANGED**; consumed by A3's Function |
| T5 `src/pages/jobs.astro` SSR (`2969f60`) | done | **rebuilt in A3** as a static shell |
| Astro-6 env fix (`f46cedd`) | done | **moot** — A1 removes the adapter/`cloudflare:workers`; Pages Functions use `context.env` |

**Standing constraints (unchanged):** No push (go-live is a separate explicit gate). No commit unless green. NEVER `--no-verify`; if `precommit-codex-check` blocks security code, report DONE_WITH_CONCERNS (controller resolves via the A4 Codex pass). Codex 3-round on the new security surface (A4). Tag every completion claim. Bash cwd RESETS after every call to `…/.worktrees/feat-ims-phase-1-plan` → every Bash call must `cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site" &&`. The paused `feat-ims-phase-1-plan` worktree is read-only.

---

## File Structure (this amendment)

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | remove `@astrojs/cloudflare` (keep `@supabase/supabase-js`, vitest, `@cloudflare/workers-types`) |
| `astro.config.mjs` | Rewrite | pure static, NO adapter |
| `src/pages/api/locumsmart-webhook.ts` | Delete | re-homed as a Pages Function |
| `src/pages/jobs.astro` | Rewrite | static prerendered full-Belleval shell; empty-state baked as default; stable HTMLRewriter hooks |
| `functions/api/locumsmart-webhook.js` | Create | LS webhook as a Pages Function, reusing `src/lib/locumsmart-webhook-logic.ts` verbatim logic |
| `functions/jobs.js` | Create | route Function: keystone read → public card HTML → `context.next()` → `HTMLRewriter` inject; empty/error → pass-through |
| `src/lib/locumsmart-webhook-logic.ts` | Reuse (unchanged) | Task 2 pure logic (auth/map/freshness) |
| `src/lib/ims-jobs-read.ts` | Reuse (unchanged) | Task 4 privacy keystone (allowlist + helpers + `fetchActiveJobs`) |
| `migrations/*.sql` | Reuse (unchanged) | Task 3 schema of record |

**Out of scope (do NOT touch):** `functions/_middleware.js`, `functions/api/contact.js`, `public/_headers`, `src/styles/ims.css`, the other 7 pages, every component. Filter/search UX, homepage wiring, real-team content, the fix campaign, `impeccable live` — later program steps.

---

## Task A1: Revert to pure static Astro (remove adapter + Astro SSR routes)

**Files:** Modify `package.json`; Rewrite `astro.config.mjs`; Delete `src/pages/api/locumsmart-webhook.ts`; Rewrite `src/pages/jobs.astro` (to a temporary static stub — the real shell is A3).

- [ ] **Step 1: Remove the adapter dependency**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npm uninstall @astrojs/cloudflare
```
Expected: `@astrojs/cloudflare` removed from `package.json` dependencies; `@supabase/supabase-js`, `vitest`, `@cloudflare/workers-types` remain.

- [ ] **Step 2: Rewrite `astro.config.mjs` to pure static (no adapter)**

Replace the entire file with:
```js
// @ts-check
import { defineConfig } from 'astro/config';

const SITE_URL = 'https://innovativemedicalstaffing.com';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
});
```

- [ ] **Step 3: Delete the Astro webhook route (re-homed as a Pages Function in A2)**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git rm src/pages/api/locumsmart-webhook.ts
```

- [ ] **Step 4: Replace `src/pages/jobs.astro` with a minimal static stub (real shell is A3)**

Replace the entire file with the Belleval Placeholder stub so the build is green static now; A3 builds the real shell:
```astro
---
import Placeholder from "../components/Placeholder.astro";
---
<Placeholder route="/jobs" />
```
(If `src/components/Placeholder.astro` is not the correct path, find the Placeholder component used by the other stub pages — e.g. `src/pages` siblings — and match their exact import. Do not invent a component.)

- [ ] **Step 5: Verify pure-static build (no adapter, no `_worker.js`, no `dist/server/`)**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx astro build 2>&1 | tail -15
ls dist/ ; test ! -e dist/_worker.js && echo "OK no _worker.js" ; test ! -e dist/server && echo "OK no dist/server"
ls dist/jobs/index.html dist/contact/index.html dist/index.html
```
Expected: build green; `dist/` contains static `client`-style output with `dist/jobs/index.html`, all 8 pages prerendered as plain HTML; **no `dist/_worker.js`, no `dist/server/`** (proves we are back on the pure-static model that coexists with `functions/`). **[runtime-verified]** required.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add package.json package-lock.json astro.config.mjs src/pages/jobs.astro
git -c commit.gpgsign=false commit -m "refactor(belleval): revert Astro Cloudflare adapter — back to pure static

@astrojs/cloudflare@13 (Astro 6's only peer-compatible major) dropped
Cloudflare Pages support (Workers only); the existing prod is a Pages
project whose functions/ (Resend contact + CSP/canonicalization
middleware) would be shadowed by any adapter _worker.js. Reverting to
the proven pure-static model; /jobs + webhook move to Pages Functions
(see the Pages-Functions+HTMLRewriter amendment plan).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: LS webhook as a Pages Function (reuse the verbatim pure logic)

**Files:** Create `functions/api/locumsmart-webhook.js`. Reuse (unchanged) `src/lib/locumsmart-webhook-logic.ts` + its 69/69 test suite. Migrations already present (Task 3).

The pure logic (`constantTimeEquals`, `validatePayloadShape`, `mapToImsJobsRow`, types) is unchanged and stays unit-tested. Only the HTTP shell moves from an Astro `APIRoute` to a Pages Functions handler. The auth/upsert/freshness behaviour ports byte-faithfully from the deleted `src/pages/api/locumsmart-webhook.ts` (its full prior content is in git at `b87a080:src/pages/api/locumsmart-webhook.ts` — read it with `git show` for the exact upsert/freshness block; do not re-derive it).

- [ ] **Step 1: Read the canonical prior endpoint logic**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git show b87a080:src/pages/api/locumsmart-webhook.ts
```
Use its INSERT-then-conditional-UPDATE freshness block VERBATIM in Step 2 (only the handler signature + env source change).

- [ ] **Step 2: Create `functions/api/locumsmart-webhook.js`**

Pages Functions handler. `env` comes from the handler context (same pattern as `functions/api/contact.js`). Imports the pure logic from `src/lib` (wrangler/esbuild bundles it). Create `functions/api/locumsmart-webhook.js`:
```js
// LS webhook receiver as a Cloudflare Pages Function (replaces the Astro
// route; @astrojs/cloudflare@13 dropped Pages support). Pure auth/map/
// freshness logic is reused unchanged from src/lib/locumsmart-webhook-logic.ts
// (unit-tested 69/69). env arrives via the Pages Functions context, exactly
// like functions/api/contact.js — no Astro.locals, no cloudflare:workers.
import { createClient } from "@supabase/supabase-js";
import {
  constantTimeEquals,
  mapToImsJobsRow,
  validatePayloadShape,
} from "../../src/lib/locumsmart-webhook-logic";

export const onRequestPost = async (context) => {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.LOCUMSMART_WEBHOOK_SECRET) {
    // Intentional 500 (not 401): LS retries 5xx but not 4xx, so a transient
    // missing-secret window during deploy self-heals on the next retry.
    console.error("[ls-webhook] env misconfigured");
    return new Response("Server misconfigured", { status: 500 });
  }

  let raw;
  try {
    raw = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const shape = validatePayloadShape(raw);
  if (!shape.ok) {
    console.warn("[ls-webhook] shape invalid:", shape.reason);
    return new Response("Bad payload", { status: 400 });
  }
  const payload = raw;

  if (!constantTimeEquals(payload.key, env.LOCUMSMART_WEBHOOK_SECRET)) {
    console.warn("[ls-webhook] unauthorized — token mismatch for", payload.assignmentId);
    return new Response("Unauthorized", { status: 401 });
  }

  const row = mapToImsJobsRow(payload);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- BEGIN verbatim atomic conditional upsert from b87a080 ---
  // (Paste the INSERT -> on 23505 PK conflict -> conditional UPDATE with the
  //  ls_last_modified .or() freshness filter EXACTLY as in
  //  git show b87a080:src/pages/api/locumsmart-webhook.ts lines ~86-164.
  //  Do not alter the freshness rules, the 23505 / ims_jobs_pkey handling,
  //  the count===0 stale-skip, or the response codes. Only the surrounding
  //  function is a Pages handler instead of an APIRoute.)
  // --- END verbatim block ---
};

// LS only sends POST; anything else is a probe/misconfig.
export const onRequestGet = () => new Response("Method Not Allowed", { status: 405 });
export const onRequestHead = () => new Response(null, { status: 405 });
```
Note for the implementer: the `--- verbatim block ---` MUST be filled in with the exact code from `git show b87a080:src/pages/api/locumsmart-webhook.ts` (the `const { error: insertErr } = await supabase.from('ims_jobs').insert(row); ...` through the final `return new Response('OK', { status: 200 });`). This is a deterministic copy, not a placeholder — the source is pinned by commit SHA. **Carry-forward Codex target (A4, do NOT change here):** the `insertErr.message.includes('ims_jobs_pkey')` substring match is PostgREST-version-fragile — flagged for A4, ported verbatim now.

- [ ] **Step 3: Confirm the pure-logic suite still passes (unchanged)**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx vitest run src/lib/locumsmart-webhook-logic.test.ts
```
Expected: 69/69 PASS (the logic file is untouched). **[runtime-verified]** required.

- [ ] **Step 4: Runtime-verify the webhook Function on the real Pages runtime**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx astro build >/dev/null 2>&1
( CI=1 npx wrangler pages dev dist --port 8788 --compatibility-date=2026-05-18 & )
curl -s -o /dev/null -w "wh-get:%{http_code}\n" --retry 20 --retry-connrefused --retry-delay 1 --max-time 20 http://localhost:8788/api/locumsmart-webhook
curl -s --max-time 10 -X POST http://localhost:8788/api/locumsmart-webhook -H "Content-Type: application/json" -d "{}"
```
Expected: `wh-get:405`; the POST returns `Server misconfigured` with HTTP 500 (no env locally → the intentional graceful misconfig path, NOT a crash). **[runtime-verified]** required. Kill wrangler/workerd after (see Server Gotcha at the end).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add functions/api/locumsmart-webhook.js
git -c commit.gpgsign=false commit -m "feat(belleval): LS webhook as a Pages Function (verbatim logic reuse)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A3: `/jobs` — static Belleval shell + `functions/jobs.js` HTMLRewriter injection

**Files:** Rewrite `src/pages/jobs.astro` (static, full Belleval, empty-state baked, HTMLRewriter hooks). Create `functions/jobs.js`. Reuse (unchanged) `src/lib/ims-jobs-read.ts`.

The keystone (`PUBLIC_JOB_COLUMNS`, `fetchActiveJobs`, `specialtyLabel`, `lengthDisplay`, `facilityHeadline`, `bodyParts`, `cardTitle`, `JobRow`) is unchanged and is imported by the Function (not the shell). The shell renders the dignified empty-state as DEFAULT content (so no-env/empty/error just serves the static shell). The Function rewrites three stable hooks only when there are jobs: `[data-jobs-h]` (headline text), `[data-jobs-lede]` (lede text), `[data-jobs-slot]` (replace the empty-state block with the card grid).

- [ ] **Step 1: Capture the exact Button/Icon output HTML (design fidelity)**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
cat src/components/Button.astro src/components/Icon.astro
```
Record the EXACT class names `Button.astro` emits for `variant="ghost"` and the exact inline `<svg>` markup `Icon.astro` emits for `name="arrowRight"` (the `d` path, `viewBox`, `width/height`, `aria-hidden`). The Function's card builder (Step 3) must emit byte-equivalent HTML so injected cards are visually identical to Astro-rendered ones.

- [ ] **Step 2: Rewrite `src/pages/jobs.astro` as the static shell**

Replace the entire file with (static — NO `prerender`, NO adapter import, NO data fetch; empty-state is the default baked content; `data-jobs-*` hooks are stable HTMLRewriter targets; markup/styles preserved verbatim from the spec-approved Task 5 design):
```astro
---
/**
 * /jobs — static Belleval shell. Prerendered, zero JS.
 *
 * Request-time data is injected at the edge by functions/jobs.js via
 * HTMLRewriter into the [data-jobs-slot] / [data-jobs-h] / [data-jobs-lede]
 * hooks. With no env / no rows / any error the Function returns this shell
 * unchanged, so the dignified empty-state below is the default. The privacy
 * allowlist lives in src/lib/ims-jobs-read.ts and is consumed ONLY by the
 * Function — internal columns never reach this page.
 */
import IMSLayout from "../layouts/IMSLayout.astro";
import Eyebrow from "../components/Eyebrow.astro";
import Button from "../components/Button.astro";
import Icon from "../components/Icon.astro";
---
<IMSLayout title="Job board — Innovative Medical Staffing" route="/jobs">
  <section class="jobs section section--lg">
    <header class="jobs__head">
      <Eyebrow orn={false} tone="gold">Job board</Eyebrow>
      <h1 data-jobs-h>Roles open soon.</h1>
      <p class="lede" data-jobs-lede>No live assignments at this moment. Tell us what you're looking for and a real recruiter will reach out the day one opens.</p>
    </header>
    <div data-jobs-slot>
      <aside class="jobs__empty">
        <Eyebrow orn={false} tone="gold">No listings yet</Eyebrow>
        <h2>Tell us what you're after.</h2>
        <p>We place across every specialty. Send one note and the right recruiter follows up the moment a match opens.</p>
        <div class="cta">
          <Button href="/contact" variant="primary">Get in touch <Icon name="arrowRight" size={14} color="var(--on-pine)" /></Button>
          <Button href="/" variant="ghost"><Icon name="arrowLeft" size={14} color="var(--ink)" /> Back to home</Button>
        </div>
      </aside>
    </div>
  </section>
</IMSLayout>

<style>
  .jobs__head { max-width: 60ch; }
  .jobs__head h1 { font: var(--t-display-lg); letter-spacing: var(--tracking-display); color: var(--ink); margin-top: 16px; }
  .jobs__head .lede { font: var(--t-body-lg); color: var(--ink-2); margin-top: 20px; max-width: 52ch; }
  .jobs__grid {
    margin-top: 56px; display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px;
  }
  .jc {
    border: 1px solid var(--line); border-radius: var(--r-xl);
    padding: 32px; background: var(--paper);
    display: flex; flex-direction: column; gap: 12px;
  }
  .jc__eb {
    font: var(--t-label); letter-spacing: .14em; text-transform: uppercase;
    display: flex; gap: 14px; align-items: baseline;
  }
  .jc__spec { color: var(--ims-blue-ink); }
  .jc__len { color: var(--ink-3); }
  .jc__h { font: var(--t-h3); color: var(--ink); line-height: 1.3; }
  .jc__b { font: 500 15px/1.5 var(--sans); color: var(--ink-2); }
  .jc__rate { font: 600 14px/1.4 var(--sans); color: var(--ink-2); margin-top: auto; }
  .jobs__empty {
    margin-top: 48px; background: var(--paper); border: 1px solid var(--line);
    border-radius: var(--r-xl); padding: 56px; max-width: 60ch;
  }
  .jobs__empty h2 { font: var(--t-display-lg); letter-spacing: var(--tracking-display); color: var(--ink); margin-top: 14px; }
  .jobs__empty p { font: var(--t-body-lg); color: var(--ink-2); margin-top: 16px; max-width: 46ch; }
  .jobs__empty .cta { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
  @media (max-width: 900px) { .jobs__grid { grid-template-columns: 1fr; } .jobs__empty { padding: 36px; } }
</style>
```
(`<aside>`→ kept as the empty-state block but it now lives INSIDE `[data-jobs-slot]`; the A4 a11y nit — empty-state landmark — is folded in A4 with the other carried nits to keep this rewrite reviewable.)

- [ ] **Step 3: Create `functions/jobs.js`**

Route Function. Reads via the keystone `fetchActiveJobs` (public allowlist only), builds card HTML matching the `.jc` design (using Step 1's captured Button/Icon markup), `context.next()` for the static shell, `HTMLRewriter` injects; empty/error → shell untouched. Create `functions/jobs.js`:
```js
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
// the EXACT Button(variant="ghost") + Icon(name="arrowRight") output captured
// in A3 Step 1 — fill {{BTN_GHOST_OPEN}} / {{ICON_ARROW_RIGHT}} / {{BTN_CLOSE}}
// with that verbatim markup so injected cards are pixel-identical.
function cardHtml(j) {
  const spec = esc(specialtyLabel(j.specialty_slug));
  const len = j.length_category ? `<span class="jc__len">${esc(lengthDisplay(j.length_category))}</span>` : "";
  const head = esc(facilityHeadline(j));
  const body = bodyParts(j);
  const bodyP = body ? `<p class="jc__b">${esc(body)}</p>` : "";
  return `<article class="jc"><div class="jc__eb"><span class="jc__spec">${spec}</span>${len}</div>` +
    `<h2 class="jc__h">${head}</h2>${bodyP}` +
    `<p class="jc__rate"><em>Rate on request</em></p>` +
    `{{BTN_GHOST_OPEN}}Apply through IMS {{ICON_ARROW_RIGHT}}{{BTN_CLOSE}}` +
    `</article>`;
}

export const onRequestGet = async (context) => {
  const { env } = context;
  let jobs = [];
  try {
    jobs = await fetchActiveJobs({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    });
  } catch (e) {
    console.error("[/jobs fn] keystone read crash:", e);
    jobs = [];
  }

  const shell = await context.next();
  if (!jobs.length) return new Response(shell.body, shell); // baked empty-state

  const total = jobs.length;
  const grid = `<div class="jobs__grid">${jobs.map(cardHtml).join("")}</div>`;
  const lede = `${total} active ${total === 1 ? "assignment" : "assignments"} across the IMS network. Every listing has a recruiter attached; nothing is auto-scraped.`;

  return new HTMLRewriter()
    .on("[data-jobs-h]", { element(el) { el.setInnerContent("Open opportunities."); } })
    .on("[data-jobs-lede]", { element(el) { el.setInnerContent(lede); } })
    .on("[data-jobs-slot]", { element(el) { el.setInnerContent(grid, { html: true }); } })
    .transform(shell);
};
```
Fill `{{BTN_GHOST_OPEN}}`, `{{ICON_ARROW_RIGHT}}`, `{{BTN_CLOSE}}` with the exact markup captured in Step 1 (e.g. `<a class="btn btn--ghost" href="/contact">` … `<svg …><path d="…"/></svg>` … `</a>`). These braces are explicit fill-from-Step-1 tokens, not vague placeholders — Step 1 produces their exact value deterministically from the real components.

- [ ] **Step 4: Runtime-verify on the real Pages runtime — both paths, zero-JS, CSP, coexistence**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx astro build >/dev/null 2>&1
( CI=1 npx wrangler pages dev dist --port 8788 --compatibility-date=2026-05-18 & )
curl -s -L -o /dev/null -w "jobs:%{http_code}\n" --retry 20 --retry-connrefused --retry-delay 1 --max-time 20 http://localhost:8788/jobs
echo "empty path (no env -> baked empty-state):"
curl -s -L --max-time 10 http://localhost:8788/jobs | grep -o "No live assignments at this moment\|Roles open soon" | head -1
echo "script tags (must be 0):"
curl -s -L --max-time 10 http://localhost:8788/jobs | grep -c "<script" || true
echo "CSP from _middleware still present:"
curl -s -L -D - -o /dev/null --max-time 10 http://localhost:8788/jobs | grep -i "content-security-policy" | head -1
echo "contact + webhook coexist:"
curl -s -o /dev/null -w "contact:%{http_code}\n" -L --max-time 10 http://localhost:8788/contact
curl -s -o /dev/null -w "wh-get:%{http_code}\n" --max-time 10 http://localhost:8788/api/locumsmart-webhook
```
Expected: `jobs:200`; with no Supabase env the page shows the baked empty-state ("No live assignments at this moment" / "Roles open soon"); **0 `<script>` tags**; the `_middleware.js` CSP header is present on `/jobs`; `contact:200`; `wh-get:405`. (A data-path render with real rows is verified in A4/A5 once env is available; the empty path is the deterministic local gate.) **[runtime-verified]** required. Kill wrangler/workerd after.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add src/pages/jobs.astro functions/jobs.js
git -c commit.gpgsign=false commit -m "feat(belleval): /jobs static shell + Pages Function HTMLRewriter injection (zero-JS, public-only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task A4: Codex 3-round security review of the new surface + fold carried-forward nits

**Files:** none new (review + fold only). Controller-orchestrated (Codex companion `adversarial-review --wait --base <ref> --scope branch`).

- [ ] **Step 1: Round 1** — adversarial security review over `functions/jobs.js`, `functions/api/locumsmart-webhook.js`, `src/lib/ims-jobs-read.ts`, `src/lib/locumsmart-webhook-logic.ts`, `astro.config.mjs`, `src/pages/jobs.astro`. Focus: (a) can any internal `ims_jobs` column reach injected HTML or logs (privacy keystone is still the only read path; the Function imports it, not raw Supabase); (b) HTMLRewriter injection is server-built escaped HTML, no XSS via job fields, no client JS; (c) `context.next()` cannot be coerced to leak the shell+secrets, no secret in `console.*`; (d) webhook auth/upsert/freshness still sound as a Pages Function; (e) `functions/_middleware.js` + `functions/api/contact.js` genuinely untouched and uncompromised; (f) the carried-forward items: `insertErr.message` constraint-name fragility (prefer structured `code`/narrow re-select), `PUBLIC_JOB_COLUMNS`↔`JobRow` drift, `autoRefreshToken:false` stale-JWT, `.limit(1000)` hard cap, empty-vs-error operator log signal, the `/jobs` empty-state landmark a11y (`<aside>`), unused-import/double-eval hygiene in the Function's card builder.

- [ ] **Step 2: Fold Round 1 findings** (apply fixes; keep the privacy keystone single-sourced; commit per fix or one fold commit).
- [ ] **Step 3: Round 2** — re-review the updated diff; expected R1 resolved, no new criticals.
- [ ] **Step 4: Round 3** — final pass; loop until Codex has nothing material (mandate: security-sensitive code loops to clean).
- [ ] **Step 5: Commit the fold** (skip if nothing folded; note `[codex: clean]`). Re-run `npx vitest run` (72/72) + the A3 Step 4 runtime gate after folds to confirm no regression. **[runtime-verified]**.

---

## Task A5: Wiring verification + Zach handoff checklist + DoD + memory/report

**Files:** create `docs/superpowers/plans/2026-05-18-ims-step1-WIRING-CHECKLIST.md`.

- [ ] **Step 1: Determine Cloudflare env + LS subscription state** (`npx wrangler pages project list` if authed; else a Zach checklist item). Env vars needed on the `ims-website` Pages project (Production + Preview): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOCUMSMART_WEBHOOK_SECRET`.
- [ ] **Step 2: Write the checklist** — exact Cloudflare Pages env-var steps; the LocumSmart "Website" subscription (NO specialty filter — every specialty) pointed at `https://innovativemedicalstaffing.com/api/locumsmart-webhook`, its Webhook Key → Pages env `LOCUMSMART_WEBHOOK_SECRET`. Commit the doc.
- [ ] **Step 3: Definition-of-Done** (tagged): pure-static build green, no `_worker.js`/`dist/server`; `/jobs` 200 baked empty-state with no env and (if wired) injected public-only cards with zero `<script>`; `_middleware.js` CSP intact on `/jobs`; `/api/contact` non-regressed; webhook Function GET 405 / POST graceful 500 with no env; `locumsmart-webhook-logic.test.ts` 69/69; `ims-jobs-read.test.ts` privacy assertions pass; Codex 3 rounds folded; nothing pushed.
- [ ] **Step 4: Update memory + report** — authoritative block: amendment status, new HEAD, wiring state, what Zach owns. Report Step 1 done + verified (tagged) and that program Step 2 (data wiring/filter UX) is a fresh spec/plan cycle. **Do not push.**

---

## Server Gotcha (every wrangler/preview cycle)

`wrangler pages dev` spawns `workerd.exe`/`node.exe` that survive a TaskStop. Kill via a `%TEMP%` .ps1 run as `powershell.exe -NoProfile -File`: match `node.exe`/`workerd.exe` whose CommandLine is `*wrangler*pages*dev*` or `*workerd*`, `Stop-Process -Force`, re-count to 0. Start exactly one `CI=1 npx wrangler pages dev dist --port <p> --compatibility-date=2026-05-18`; curl-confirm before trusting. `/jobs` 308→`/jobs/` trailing-slash is normal Astro `trailingSlash` (same as prod `/contact`); always curl with `-L`.

---

## Self-Review (against the spec + the verified blocker)

- Spec privacy contract (top risk) → keystone `ims-jobs-read.ts` UNCHANGED, still the only `ims_jobs` read path; the Function imports it, never raw Supabase; assertion test still guards it; A4 Codex 3-round. ✓
- Spec "request-time fresh /jobs without rebuild" → A3 Function reads at request time via `fetchActiveJobs`. ✓
- Spec "zero client JS / CSP" → HTMLRewriter injects server-built HTML; A3 Step 4 asserts 0 `<script>` + CSP header; mechanism proven in the pre-plan spike. ✓
- Spec "8 prerendered pages, contact untouched, coexist" → A1 pure-static (no `_worker.js` → `functions/` honored); `_middleware.js`/`contact.js` untouched; A3 Step 4 curls contact + webhook coexisting. ✓ (replaces the invalid SSR-adapter matrix)
- Spec LS unfiltered "Website" subscription + Zach deps → A5. ✓
- Spec testing (ported suite 69/69, privacy assertion 72/72, runtime curl, contact non-regression, 3-round Codex) → A2/A3/A4/A5. ✓
- Carried-over Tasks 2/3-migrations/4 → unchanged, reused. ✓
- Placeholder scan: the only fill-tokens (`{{BTN_*}}`/`{{ICON_*}}`, the verbatim upsert block) are deterministically resolved from a pinned commit (`b87a080`) / real components in an explicit prior step — computed inputs, not vague TODOs. ✓
- Type/name consistency: `fetchActiveJobs`, `specialtyLabel`, `lengthDisplay`, `facilityHeadline`, `bodyParts`, `JobRow`, `PUBLIC_JOB_COLUMNS`, `constantTimeEquals`, `validatePayloadShape`, `mapToImsJobsRow` reused with the exact signatures defined in the (unchanged) Task 2/4 modules. ✓

No gaps found.
