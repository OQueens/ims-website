# IMS Site-Perfection Punch-List & Execution Plan (2026-06-17)

**Origin:** a 9-dimension, adversarially-verified multi-agent audit of LIVE imstaffing.ai + the codebase (2026-06-16), producing **47 confirmed findings**. Zach's directive: *"cutting no corners, leaving no stone unturned"* — make the whole site as close to perfect as possible. He wants the plan stated up front, then fixes in **safe, verified batches, shown before each deploy**.

**Prod state at plan time:** `origin/main == redesign/v5-reskin @ 76938da` = the v5/Palette-A reskin + the restored Weekly Sync A1 hub code + the hub dark-text fix. `main` is now the SINGLE prod source (the old "hub ships via wrangler from hub-port" split is retired). GT America fonts are still TRIAL on prod (licensed swap pending Zach's files).

## Execution guardrails (apply to every batch)
1. Implement → `npm run build` + `npm run verify` (noindex gate) + `npm test` (438 baseline) → Codex review (inline `[codex-skip:win32-sandbox]` if the CLI is blocked) → **show Zach the batch** → deploy on his OK → verify live.
2. **Before ANY push to main: reconcile branch↔deployment** (today's regression lesson — a "marketing-only" main deploy silently reverted the hub because the hub work wasn't on main).
3. Hub/data items get extra care. NEVER fabricate data. NEVER touch the testimonials or Zach's deliberate bright-on-cream palette without explicit sign-off.
4. Commit in logical batches (precommit-codex hook + review-gate); keep hub-login WIP and junk (`_sx.html`, `*.tgz`) out of commits.

---

## PHASE 1 — Honesty / fake-data (CRITICAL/HIGH — do first)
- **`src/lib/hub/hub-seed.ts:13-20`** — fabricated "Sara P." priorities + invented cities/day-counts shown as real, counted in a live "{open} open" chip. **Fix:** replace seeded `PRIORITIES` with `[]` + honest empty state ("No priorities set this week"). (Stretch: make it user-editable+persisted like Weekly Sync — propose as a small build.) Also resolves `hub-client.ts:77-90` (priority checkboxes that toggle DOM only, never persist).
- **`src/pages/hub/login.astro:195-197` + `src/lib/hub/login-data.ts`** — live `/hub/login` shows fake KPIs (37+ reqs, 18d fill, 94% rate). The honest-login redesign already exists as UNCOMMITTED WIP. **Fix:** commit login.astro + login-data.ts + login-data.test.ts and deploy → real single live stat (or omit).
- **`src/pages/hub/login.astro:99-111,134-146` (prod bug)** — the login's live active-req figure returns null in prod (the `count:'exact',head:true` head-count read) so the signature proof-point is silently hidden, even though `/jobs` reads the same `ims_jobs` active feed fine. **Fix:** diagnose the count/head read path vs service-role/RLS in prod so the real number renders.
- **`src/components/hub/SimulatorView.astro:25,34` + `hub-client.ts:176-191`** — the Rate Simulator says "Parsed · applied suggested inputs" / "We'll read the specialty, region and shift" but `handleFile()` never reads the PDF; it always applies the same hardcoded chips. **DECISION (Zach):** relabel as a non-parsing demo (1-line, honest, now) **vs** implement real PDF extraction (bigger build). Recommend relabel now.
- **`src/components/hub/HubTopbar.astro:13-23`** — top-bar search box + notification bell are decorative (no handlers). **Fix:** wire to real behavior or remove/disable.

## PHASE 2 — Copy / voice (em-dash scrub — zero functional risk)
Strip em-dashes (Zach's "AI tell") from VISIBLE body copy + indexed metadata + microcopy. Locations: `index.astro:139,222,254,258,388`; `about.astro:20,44,64,82,140`; `how-it-works.astro:37,48,64,69,70(x2),76(x2),107`; `MarketingLayout.astro:50` (default desc); `contact.astro:28`; `ContactPanel.astro:55` + `GetInTouch.astro:74`; `jobs/index.astro:181`; `specialties.astro:161`. Replace each with comma/colon/period or restructure. (Legal pages `LegalPage.astro` ~31 list-intro em-dashes = OPTIONAL later legal pass, not marketing-voice.)

## PHASE 3 — Accessibility
- **`jobs/index.astro:388-401` (HIGH)** — filter has no live region. Add visually-hidden `<div aria-live="polite" id="jobs-status">`, set text at end of `applyFilter()` (`${visible} roles match` / "No roles match your search").
- **`HubTopbar.astro:14-15`** — add `aria-label="Search reqs and clinicians"` to input; `aria-hidden="true"` on the magnifier SVG.
- **`HubSidebar.astro:14-30` + `hub-client.ts:52`** — set `aria-current="page"` on the active view tab, toggled with the class.
- **`hub/index.astro:137`** — change `<div class="hub-main">` → `<main class="hub-main" id="hub-main">` (no styling impact); add a skip link.
- **`clinicians.astro:26,35-77`** — heading skips h1→h3; add `<h2 class="visually-hidden">The four steps</h2>` atop `cc__timeline`.
- **`ContactPanel.astro:73-82`** — homepage inline form has no visible `<label>` (placeholder-only at ~2.62:1). Render visible labels like GetInTouch, or raise placeholder opacity (`kit.css:2108`) to ~0.6+.
- **`index.astro:218,254`** — remove purposeless `tabindex="0"` on the two non-interactive `aud-mix__card` articles.

## PHASE 4 — Performance
- **`public/ims-logo-light.png` (HIGH)** — 2558×1355 / 166KB PNG shown at 28-36px on every page. Export optimized SVG or ~120px WebP (<5KB); keep a small raster only if the CSS mask needs it. ~160KB sitewide.
- **`/state-shapes/*.svg` (HIGH)** — 29 SVGs (~178KB) eager-loaded as `/jobs` mask watermarks. SVGO + precision reduction (50-70% cut), or viewport-gate, or sprite. Dominant /jobs cost.
- **`MarketingLayout.astro:213-239`** — animated favicon re-encodes a 64×64 canvas via `toDataURL` ~14×/sec. Drop to ~200-250ms (4-6fps) or precompute a small ring of data-URL frames and cycle cached strings.
- **`/hub/login` favicon → `public/ims-logo-mark.png`** — 87KB PNG for a 16-32px tab. Point at `favicon-32.png`/`favicon.svg`.
- **`SiteNav.astro:33` + `SiteFooter.astro:65`** — add explicit width/height to logo `<img>` (CLS).
- **Fonts (tie to license swap):** the 8 GT America faces are OTF; convert the LICENSED set to WOFF2 (20-40% smaller) + update `@font-face` src + 3 preload `type`s when swapping.

## PHASE 5 — SEO
- **`jobs/[slug].astro`** — add JobPosting JSON-LD from real fields (title, jobLocation from facility_city/state, hiringOrganization=IMS, datePosted from start_date), omit nulls, do NOT fabricate salary. Restores Google-for-Jobs eligibility.
- **`jobs/[slug].astro` + sitemap** — ~129 SSR job URLs are absent from the sitemap. Add an SSR `sitemap-jobs.xml.ts` querying active `ims_jobs` ids, referenced from sitemap-index.xml (or noindex to make exclusion deliberate).
- **`MarketingLayout.astro:61-63,117,122` + `astro.config.mjs` (DECISION — mild risk)** — canonical/og:url emitted WITHOUT trailing slash but served WITH it (308 self-redirect); sitemap uses trailing. Set `trailingSlash:'always'` + drop the strip + add trailing to internal hrefs (`SiteNav.astro:22-25,48` + footer/home) so canonical, og:url, sitemap, served URL, and internal links all match. Verify redirects after.
- **`MarketingLayout.astro:118-123`** — add twitter:title/description/image (mirror og:*), og:site_name="Innovative Medical Staffing", og:locale="en_US", og:image:width/height/alt.

## PHASE 6 — Visual/CSS + code bugs + security + hygiene
- **`kit.css:2045`** — contact-band link hover resolves to retired periwinkle `--violet-deep` #4F57C0 (off Palette-A). Add `.contact-b__info-value a:hover { color: var(--grass) !important; }`.
- **facilities/clinicians scoped CSS** — old literal hexes (#1f1a23, #fbf6ee...) bypass v5 tokens. Swap to `var(--ink)`/`var(--cream-soft)` (+alpha).
- **`v5-reskin.css:126,150` (DECISION — Zach's palette call)** — headline `.em` emphasis is sky #3FB3E0 on cream = 2.14:1 (below 3:1). Keep (his approved brights-on-cream) OR point `--ink-emphasis` at a deeper sky (#1A6E8E ≈ 5:1). Default: keep unless Zach says nudge.
- **`MarketingLayout.astro:388-417` + form components** — action-puck 700ms hover interval not torn down on form-submit error (flashes on unhovered button). Guard `paint()`: `if (!host.matches(':hover')) { stop(); return; }`.
- **`jobs/index.astro:400,203,379`** — "All · N" chip count gets overwritten with the filtered count under an active specialty. Only update `[data-count="all"]` when `activeSpec==='all' && !query`.
- **`hub/login.astro:534`** — delete the stray unbalanced `</HubLayout>` (dead markup; page still 200).
- **`how-it-works.astro:69`** — spaced en-dash range "1 – 3 days" → unspaced "1-3 days".
- **`middleware-logic.ts:47` + `public/_headers:2`** — HSTS `max-age` 15768000 (~182d) → 31536000 (1yr); add `preload` only if submitting to hstspreload.org.
- **`middleware-logic.ts:52-62` + `public/_headers:3`** — append `object-src 'none';` to CSP.
- **Repo hygiene** — `_sx.html` + `openai-codex-0.135.0.tgz` are untracked + un-ignored (a `git add .` would commit them). Delete or `.gitignore`.

---

## DECISIONS needed from Zach (resolve at session start)
1. **Simulator** — relabel as demo (recommend) vs build real PDF parsing.
2. **Emphasis color** — keep bright sky (his aesthetic) vs nudge to deeper sky for legibility.
3. **Trailing-slash SEO change** — do it (recommend, careful + verify) vs skip.
4. **"Sara P." priorities** — honest empty state (recommend now) vs build a real persisted priorities feature.

## DO NOT TOUCH without explicit sign-off
- **Testimonials** (`clinicians.astro:131,140,160` + `facilities.astro:118,126`) — research-grounded composites, flagged do-not-remove.
- The deliberate **bright-on-cream palette** beyond the one optional emphasis nudge.

## GATED on Zach (external)
- **GT America licensed font files** → hot-swap into `public/fonts/gt-america/` (same filenames) + convert to WOFF2. (Prod on trial until then.)
- **Confirm the hub Analytics tab** shows real LS numbers (rules out a prod-read issue like the login one).
- **Hub smoke test** (sign in → Weekly Sync add/persist/reset).

## NET-NEW builds (separate from the punch-list, when Zach wants)
- **Real Overview bill-rate + fill-rate** — wire the LS invoice (`totalMarkup`/`totalExpense` → bill rate) + Bids/Agreements/placements feed (→ true fill rate). Needs ~3 LS-semantic confirms from Zach. This is why those tiles honestly show "—" today (never built, NOT a regression).
- **Weekly Sync A2** — live presence + reactions, on top of the restored A1.
- Backlog: GoFetchData leads page · 138-placements rate registry · job-board chatbot · INC-3 contact-sweep.
