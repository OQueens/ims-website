# IMS Website Phase 1 (1.0 + 1.A Launch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan source spec:** [`docs/specs/2026-05-05-ims-website-phase-1-design.md`](../specs/2026-05-05-ims-website-phase-1-design.md) (874 lines, 7-round Codex GO at HEAD `e019b5e`)

**Plan branch:** `feat/ims-phase-1-plan` — worktree at `.worktrees/feat-ims-phase-1-plan/`

**Goal:** Ship the first indexable IMS website (`v1.0.0-launch`). All 12 technical hard checks + 5 process soft gates in spec §5 Phase 1.A pass. Marketing pages + minimal `/jobs` grid + lightweight contact-style apply (no CV upload until 1.5).

**Architecture:** Astro 6 hybrid output on Cloudflare Pages. Marketing routes prerender (SSG); `/api/apply` and `/api/contact` opt into SSR via `export const prerender = false`. **Path B (manual Astro Content Collection at `src/content/jobs/*.md`)** is the default planning baseline for `/jobs`; **Path A (Cloudflare Scheduled Worker → KV)** folds in as a scope-add IFF Zach gets written LocumSmart admin authorization by **2026-05-13**. Apply form writes Supabase row FIRST with `resend_status='pending'`, then attempts Resend send (resend_status enum makes the row source-of-truth even if email fails). Per-IP rate-limiting via KV namespace `IMS_RATE` (3 submissions / 10 minutes / route).

**Tech Stack:**
- **Framework:** Astro 6.x + `@astrojs/cloudflare` (`output: "hybrid"`) + `@astrojs/sitemap`
- **Hosting:** Cloudflare Pages (Free) + Cloudflare KV (Free) + (Path A) Cloudflare Workers + Cron Triggers (Free)
- **Database:** Supabase Postgres (Free tier) — `ims_applications` + `ims_contact_messages` tables; service-role-key only access
- **Email:** Resend (Free tier ≥3k emails/mo) — verified `iastaffing.com` domain
- **Anti-spam:** Cloudflare Turnstile (Free, unlimited)
- **Analytics:** Plausible Cloud ($9/mo) — privacy-friendly, no cookie banner needed (per spec §0.5.8)
- **Type:** TAY Basal (display) + TAY Amaya (body), self-hosted woff2/woff at `public/fonts/` (already committed `e019b5e`). Fallback: Inter Variable 700-900 via `@fontsource-variable/inter` (per spec §9 row 23)
- **Test runtime:** Vitest 1.x for unit + integration; `miniflare` for KV mocking; manual browser smoke at launch (Playwright deferred to Phase 1.5)

---

## Scope

### IN SCOPE — Phase 1.0 (Foundation) + Phase 1.A (Launch)
- Phase 1.0 primitives (T1–T13): adapter swap + sitemap, brand tokens, fonts wired, logo variants, MarketingLayout, ScrollReveal helper, CSP block (still-noindex), voice-lint advisory, Phase 1.0 deploy gate (Lighthouse ≥95 on `/`)
- Phase 1.A index-flip + pages (T14–T29): X-Robots-Tag removal, robots.txt allow, verify-build swap, all marketing pages per spec §1, `/privacy` + `/cookies` + `/terms`, browser smoke
- Phase 1.A job board + backend + forms + analytics (T30–T55): Content Collection + `/jobs` Path B grid, Supabase tables + RLS, KV `IMS_RATE` provisioning, `/api/contact` + `/api/apply` routes (TDD with full route contracts), Turnstile / Resend / IP-hash / rate-limit primitives, ApplyModal + ContactForm components, Plausible goal wiring, Schema.org Organization JSON-LD validation, WCAG audit, TAY first-paint validation
- Phase 1.A pre-launch verification (T56–T64): 5 E2E smoke tests covering happy + invalid Turnstile + rate-limit + Resend-failure paths; Lighthouse ≥95 on 5 sample pages; hard-checks 1-12 + soft-gates 13-17 walkthrough; DNSSEC DS at Namecheap
- Phase 1.A launch (T65): preview → main merge → tag `v1.0.0-launch` → GitHub Release → 7-day Plausible goal-fire watch

### CONDITIONAL — Path A scope-add (PA1–PA12)
EXECUTE ONLY IF Zach reports written LocumSmart admin authorization by **2026-05-13**. If 2026-05-13 passes without authorization: SKIP PA1–PA12 entirely; Path A migrates to a separate Phase 1.5 plan (see spec §3.4).

### OUT OF SCOPE (separate plans, written closer to those phases)
- **Phase 1.5** (~2 weeks post-launch): `/jobs/[id]` per-job detail pages, CV upload + Supabase Storage `cv-uploads` + ClamAV scan + signed URLs, faceted full-text search via Pagefind, Schema.org `JobPosting` markup, programmatic OG via `satori`, voice-lint promoted from advisory to blocking, Lighthouse-CI integration, application-receipt email to applicant, Path B → Path A migration if launched on B
- **Phase 1.75** (~3 weeks post-1.5): `/specialties/[slug]` programmatic SEO (Astro Content Collection schema-validated), 600-1000 words/page, internal linking, LocumSmart webhook upgrade
- **Phase 1.9** (signal-driven): locum income calculator, blog, JCAHO HCSS cert, ATS integration, custom illustration commission (~$800-1500)
- **Phase 3+** (separate spec already in memory): dashboard migration behind `@iastaffing.com` Cloudflare Access login

### Spec §10 open Zach action items — DEFERRED, NOT plan-writing blockers
Per user direction at planning kickoff, the plan executes against the current spec without waiting on §10 items. The plan flags which tasks reach a Zach-gated gate. Those gate the `v1.0.0-launch` tag, NOT plan execution. The 9 open items: DNSSEC DS record, leadership cards, LS authorization, top-12 specialty list confirm, legal page review, LinkedIn URL, Resend SPF/DKIM/DMARC, Supabase project pick, WCAG contrast audit decisions.

---

## Codex Collaboration Protocol

Per project standing rule (CODEX COLLABORATION mandatory 2026-04-23): each non-trivial code commit MUST go through `/codex:rescue` (or direct `codex-companion.mjs` task review) before push. Loop: write → Codex review → fold findings → re-Codex → repeat until clean.

**Per-task Codex matrix** (updated post-Codex r1 AMBER #8 fold — T20 sub-tasks, T25, T34, T48, T51, T52 promoted to MANDATORY since they ship real code paths, not just copy):
- **Code/route/library/migration tasks:** Codex review **MANDATORY** (T7, T8, T9, T10, T15, T16, T17, T18, T19, **T20a-T20j** (homepage section components incl. ScrollReveal+animation logic), **T25** (how-it-works tab JS island), T28, T30, T32, T33, **T34** (empty-state mini-form submit JS — added Codex r1 AMBER #4 fold), T35, T41, T42, T43, T44, T45, T46, T47, **T48** (Turnstile widget JS — multi-instance dispatch hook), T49, T50, **T51** (ApplyModal data-flow wiring with click handlers), **T52** (Plausible goal-fire analytics wiring), PA4, PA5, PA6, PA9, PA10)
- **Page-copy / markdown / content-seed tasks:** `[codex-skip:reason]` allowed (T21–T24, T26, T27, T31, T54, T55) — note: T20 sub-tasks moved out of skip-allowed because they ship JS for tab toggling, IntersectionObserver wiring, and section-reveal logic per spec §2.4 / §2.7 / §2.8
- **Config / deps / dashboard / process tasks:** Codex case-by-case; default skip with reason (T1, T2, T3, T11, T13, T14, T36–T40, T53, T56–T65)

**Direct invocation pattern** (per memory feedback `feedback_codex_direct_bash_invocation.md`):
```
node /c/Users/oclou/.claude/plugins/cache/openai-codex/codex/<ver>/scripts/codex-companion.mjs task --background --write --prompt "<self-contained prompt naming files + the round-N deltas to verify>"
```
Poll via `until grep -qE "Phase: done|Duration:" <output_log>; do sleep 2; done` (the older `completed|failed|cancelled` pattern false-positives on sub-command progress text).

**Verification tags on commit messages** (active commit-msg hook):
- `[runtime-verified: N/N]` — tests passed in real runtime
- `[logically-inspected]` — markdown / config / docs
- `[syntax-checked]` — typecheck/lint clean only
- `[unverified]` — explicit no-verify (avoid)
- Augment with `[codex-reviewed: r1 NO-GO X → ... → rN GO]` or `[codex-skip:reason]`

**Stop-hook review-gate:** after each batch of ≥3 code-file commits, stamp via `bash ~/.claude/hooks/review-gate.sh --stamp` once Codex review is clean.

---

## File Structure (decomposition map)

### Files to CREATE in Phase 1.0
| Path | Responsibility |
|---|---|
| `src/styles/tokens.css` *(extend)* | Add brand palette tokens (PT-derived) + typography tokens + `@font-face` for TAY Basal + TAY Amaya (existing dashboard tokens KEPT for transition; remove in Phase 1.5 cleanup) |
| `src/layouts/MarketingLayout.astro` | Cream-card chrome + dark exterior + scroll-reveal slot + Plausible script + Schema.org Organization JSON-LD + `<head>` meta defaults |
| `src/components/brand/LogoDefault.astro` | IMS logo on cream surfaces (cls-1 `#59BFE7`, cls-2 `#1E1E1E`) |
| `src/components/brand/LogoOnDark.astro` | IMS logo on dark surfaces (cls-1 `#59BFE7`, cls-2 `#F2E8DC`) |
| `src/components/brand/LogoMono.astro` | IMS logo using `currentColor` for both classes |
| `src/components/util/ScrollReveal.astro` | IntersectionObserver-driven once-only fade+rise (500ms / 12px / `-10%` root margin); honors `prefers-reduced-motion` |
| `src/assets/brand/IMS-Logo-Original.svg` | Preserved original (cls-1 `#59BFE7`, cls-2 `#F4F5F5`) — archive only, not rendered |
| `src/assets/brand/IMS-Logo-Default.svg` | Generated default variant (cream surfaces) |
| `src/assets/brand/IMS-Logo-OnDark.svg` | Generated dark-surface variant |
| `src/assets/brand/IMS-Logo-Mono.svg` | Generated currentColor variant |
| `src/assets/icons/*.svg` × ≤ 8 | Functional icon set per spec §4.7 (search / arrow / external-link / email / phone / location / play / close — exact 8 picked in T6). T17 verify-build asserts count ≤ 8. (Codex r2 AMBER #6/#12 fold) |
| `src/components/icons/Icon.astro` | Thin wrapper that inlines the requested icon SVG via build-time import; `<Icon name="search" size={16} />` — provides `currentColor` stroke + size variant. (Codex r2 AMBER #12 fold) |
| `scripts/voice-lint.mjs` | Greps `.astro` + `.md` for spec §4.5 BANNED + CARE + VISUAL_BANNED tokens; advisory at v1 (exits 0, prints to stderr) |
| `tests/_setup/vitest.config.ts` | Vitest config; sets up miniflare KV mocks |

### Files to MODIFY in Phase 1.0
| Path | Change |
|---|---|
| `astro.config.mjs` | Add `@astrojs/cloudflare` adapter (`output: "hybrid"`) + `@astrojs/sitemap` integration with excludes per spec §0.5.5; canonical site URL `https://innovativemedicalstaffing.com` |
| `package.json` | Add deps: `@astrojs/cloudflare`, `@astrojs/sitemap`, `@fontsource-variable/inter`, `@supabase/supabase-js`, `resend`, `vitest`, `@vitest/ui`, `@cloudflare/workers-types`, `miniflare`, `zod`. Add scripts: `test`, `test:watch`, `test:ui`, extend `verify` to invoke voice-lint advisory |
| `functions/_middleware.js` | Replace `Content-Security-Policy` value (line 22-23) with §0.5.3 final CSP block. **DO NOT remove `X-Robots-Tag` yet** — that's a Phase 1.A LAUNCH HARD GATE in T15 |
| `scripts/verify-build.mjs` | Wire voice-lint script as advisory (warnings to stderr, exit 0); KEEP existing Phase-0 maintenance-page assertions until T17 swaps them at Phase 1.A |

### Files to CREATE in Phase 1.A
**Pages:**
| Path | Responsibility |
|---|---|
| `src/pages/clinicians.astro` | For Clinicians (supply path) |
| `src/pages/facilities.astro` | For Facilities (demand path) |
| `src/pages/specialties.astro` | 12 editorial cards (no `[slug]` pages — those are Phase 1.75) |
| `src/pages/about.astro` | Story / leadership placeholder cards / philosophy / values |
| `src/pages/how-it-works.astro` | 4-step process tabbed clinicians/facilities |
| `src/pages/contact.astro` | Contact form + email + phone (NO map per spec §6 disposition) |
| `src/pages/privacy.astro` | Per spec §0.5.8 — boilerplate + Zach review block |
| `src/pages/cookies.astro` | Plausible-no-cookie stance + `__cf_bm` exemption |
| `src/pages/terms.astro` | Healthcare-staffing template + Zach review block |
| `src/pages/jobs/index.astro` | Path B SSG over Content Collection at v1; SSR-over-KV when Path A active (env `PUBLIC_PATH_A=true`) |

**Components:**
| Path | Responsibility |
|---|---|
| `src/components/nav/SiteNav.astro` | Sticky nav appearing at scroll-y > 80vh per spec §1 |
| `src/components/footer/SiteFooter.astro` | 3-column EXPLORE/FOLLOW/CONTACT; FOLLOW conditionally drops if no LinkedIn URL provided |
| `src/components/forms/ContactForm.astro` | Contact form (intent: coverage / general); wires Turnstile widget |
| `src/components/forms/ApplyModal.astro` | Vanilla-JS modal triggered from `/jobs` cards; reads `data-job-ref`/`data-job-title` attrs |
| `src/components/forms/TurnstileWidget.astro` | Cloudflare Turnstile widget wrapper |
| `src/components/sections/HomeHero.astro` | Homepage section §2.1 |
| `src/components/sections/HomePositioningStrip.astro` | §2.2 |
| `src/components/sections/HomePhilosophy.astro` | §2.3 pull-quote |
| `src/components/sections/HomeAudienceSplit.astro` | §2.4 two-card grid |
| `src/components/sections/HomeConcierge.astro` | §2.5 dark inverse band (renders OUTSIDE the cream card) |
| `src/components/sections/HomeHumanLedTech.astro` | §2.6 split panel |
| `src/components/sections/HomeSpecialties.astro` | §2.7 12-card grid (live counts) |
| `src/components/sections/HomeProcess.astro` | §2.8 4-step horizontal with audience tabs |
| `src/components/sections/HomeValues.astro` | §2.9 6-tile grid |
| `src/components/sections/HomeFinalCta.astro` | §2.10 dark final CTA band |

**Server libraries (`src/lib/` — server-only, never imported into client islands):**
| Path | Responsibility |
|---|---|
| `src/lib/ip-hash.ts` | `hashIp(ip: string, dailySalt: string): string` → `sha256(ip + dailySalt)` hex |
| `src/lib/rate-limit-kv.ts` | `checkAndIncrement(kv, route, ipHash, opts): Promise<{ok: boolean, retryAfter?: number}>`. 3 submissions / 600s TTL. Bypass via `X-IMS-Test-Bypass` header |
| `src/lib/turnstile-server.ts` | `verifyTurnstile(token: string, remoteIp: string, secret: string): Promise<boolean>` against `https://challenges.cloudflare.com/turnstile/v0/siteverify` |
| `src/lib/supabase-server.ts` | `createSupabaseServer(env): SupabaseClient` using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from runtime env (Cloudflare Pages bindings) |
| `src/lib/resend-server.ts` | `sendApplicationEmail(...)` + `sendContactEmail(...)` wrapping Resend SDK; returns `{ ok: boolean, error?: string }` (errors NEVER throw — caller flips `resend_status` instead) |

**API routes (`src/pages/api/` — `export const prerender = false`):**
| Path | Responsibility |
|---|---|
| `src/pages/api/contact.ts` | POST handler per spec §0.5.4 — Turnstile → rate-limit → Supabase row INSERT FIRST → Resend → update `resend_status` |
| `src/pages/api/apply.ts` | POST handler per spec §0.5.4 — same order; payload includes `jobRef` + `jobTitle` |

**Content + schema:**
| Path | Responsibility |
|---|---|
| `src/content/config.ts` | Zod schemas for `jobs` (Path B) and `specialties` (Phase 1.75 placeholder) collections |
| `src/content/jobs/_template.md` | Recruiter-facing template with all schema fields |
| `src/content/jobs/example-NN.md` × 10 | Placeholder seeds (Zach action item: recruiter team replaces with real before launch) |

**Database:**
| Path | Responsibility |
|---|---|
| `migrations/20260506_ims_phase1_tables.sql` | CREATE `ims_applications` + `ims_contact_messages` + RLS ENABLE per spec §0.5.4 |

**Cloudflare Pages config:**
| Path | Responsibility |
|---|---|
| `public/_redirects` | 301 `/sitemap.xml → /sitemap-index.xml` so robots.txt's stable public URL resolves to the @astrojs/sitemap-emitted file. (Codex r2 AMBER #12 fold — added to map; T14 creates the file.) |

**Tests:**
| Path | Responsibility |
|---|---|
| `tests/lib/ip-hash.test.ts` | Hash determinism, salt sensitivity |
| `tests/lib/rate-limit-kv.test.ts` | Counter increment, TTL behavior, bypass header, route-isolation |
| `tests/lib/turnstile-server.test.ts` | Mocked HTTP response shapes (success / fail / network error) |
| `tests/api/contact.test.ts` | Full route contract (Turnstile → rate-limit → Supabase → Resend → 200/4xx/5xx semantics) |
| `tests/api/apply.test.ts` | Full route contract; resend_status flip cases |

**Docs:**
| Path | Responsibility |
|---|---|
| `docs/IAS-Design-System.md` *(extend)* | Append §Marketing color tokens / WCAG audit / TAY first-paint validation decisions |

### Files to MODIFY in Phase 1.A
| Path | Change |
|---|---|
| `public/_headers` | REMOVE line 2 `X-Robots-Tag: noindex, nofollow` (LAUNCH HARD GATE) |
| `functions/_middleware.js` | REMOVE line 20 `"X-Robots-Tag": "noindex, nofollow",` from `SECURITY_HEADERS` (LAUNCH HARD GATE — both files must change together) |
| `public/robots.txt` | Replace `User-agent: *\nDisallow: /` with `User-agent: *\nAllow: /\nSitemap: https://innovativemedicalstaffing.com/sitemap.xml` |
| `scripts/verify-build.mjs` | Swap from Phase-0 maintenance-page assertions to Phase 1.A indexability assertions (no `noindex`, sitemap exists, brand tokens present, robots.txt allows) |
| `src/pages/index.astro` | Replace Phase-0 maintenance content with marketing home (10 sections per spec §2) |
| `src/layouts/BaseLayout.astro` | Default `noindex` flips to `false` (or stays for any non-marketing route still using BaseLayout); MarketingLayout used for all public pages |

### Files to CREATE on Path A scope-add (CONDITIONAL)
| Path | Responsibility |
|---|---|
| `workers/jobs-sync/wrangler.toml` | Worker config per spec §3.4 — `crons = ["0 * * * *"]` (60-min cadence), `JOBS_KV` binding |
| `workers/jobs-sync/src/index.ts` | Worker entrypoint — `scheduled` + `fetch` handlers |
| `workers/jobs-sync/src/normalize.ts` | LS feed normalization (specialty canonical, USPS state, rate-range sanitize, `_lastSeenAt` tag, 2-sync-miss / 24h grace) |
| `workers/jobs-sync/src/kv-writer.ts` | Hash-based change detection, write-only-on-change (≤74 writes/day target) |
| `workers/jobs-sync/tests/normalize.test.ts` | Specialty canonical mapping, state validation, rate-range sanitization |
| `workers/jobs-sync/tests/kv-writer.test.ts` | Hash dedup, KV write-budget under 1k/day cap |
| `src/pages/api/jobs.ts` | `export const prerender = false` — KV reader for filter queries (Path A only) |
| `src/data/specialties.json` | Canonical specialty allowlist used by both `/jobs` filter UI and Worker normalization |

### Files to MODIFY on Path A scope-add (CONDITIONAL)
| Path | Change |
|---|---|
| `src/pages/jobs/index.astro` | Switch SSG-over-Content-Collection to SSR-over-KV when `import.meta.env.PUBLIC_PATH_A === 'true'` (env-flag-toggleable so a Path A failure can revert to Path B without code change) |
| `astro.config.mjs` | Confirm SSR routes set: `/jobs`, `/api/jobs`, `/api/apply`, `/api/contact` — Path A vs Path B differ on first two |

---

## Task Index

| ID | Phase | Title |
|---|---|---|
| T1 | 1.0 | Install `@astrojs/cloudflare` adapter + `@astrojs/sitemap`; switch to hybrid output |
| T2 | 1.0 | Install `@fontsource-variable/inter` (display + body fallback) |
| T3 | 1.0 | Install Vitest + miniflare + workers-types; add test scripts |
| T4 | 1.0 | Extend `tokens.css` with brand palette tokens (PT-derived) |
| T5 | 1.0 | Add typography tokens + `@font-face` declarations for TAY Basal + TAY Amaya |
| T6 | 1.0 | Generate logo SVG variants + Astro components (Default / OnDark / Mono from preserved Original) |
| T7 | 1.0 | Create `ScrollReveal.astro` IntersectionObserver helper |
| T8 | 1.0 | Create `MarketingLayout.astro` chrome (cream card + dark exterior + Plausible + Org JSON-LD) |
| T9 | 1.0 | Replace CSP block in `functions/_middleware.js` per §0.5.3 (X-Robots-Tag stays — Phase 1.A removes it) |
| T10 | 1.0 | Create `scripts/voice-lint.mjs` advisory script |
| T11 | 1.0 | Wire voice-lint into `npm run verify` (advisory, exit 0) |
| T12 | 1.0 | Phase 1.0 deploy gate — Lighthouse ≥95 on `/` (still maintenance), voice-lint runs without errors |
| T13 | 1.0 | Tag Phase 1.0 commit; deploy preview |
| T14 | 1.A | Update `public/robots.txt` (`Allow: /` + `Sitemap:` line) |
| T15 | 1.A | REMOVE `X-Robots-Tag` from `functions/_middleware.js:20` (LAUNCH HARD GATE 1/2) |
| T16 | 1.A | REMOVE `X-Robots-Tag` from `public/_headers:2` (LAUNCH HARD GATE 2/2) |
| T17 | 1.A | Update `scripts/verify-build.mjs` from Phase-0 to Phase-1.A invariants |
| T18 | 1.A | Create `SiteNav.astro` (sticky after 80vh scroll) |
| T19 | 1.A | Create `SiteFooter.astro` (3-col with FOLLOW conditional drop) |
| T20 | 1.A | Build homepage (10 sections per §2.1–§2.10) — split into 10 sub-tasks T20a–T20j |
| T21 | 1.A | Build `/clinicians` page |
| T22 | 1.A | Build `/facilities` page |
| T23 | 1.A | Build `/specialties` page (12 editorial cards) |
| T24 | 1.A | Build `/about` page (with leadership placeholder cards) |
| T25 | 1.A | Build `/how-it-works` page (4-step tabbed) |
| T26 | 1.A | Build `/contact` page (NO map per §6) |
| T27 | 1.A | Build `/privacy` + `/cookies` + `/terms` pages |
| T28 | 1.A | Replace Phase-0 maintenance `index.astro` with marketing home (wires T20 sections) |
| T29 | 1.A | Run dev server + browser smoke through all marketing pages |
| T30 | 1.A | Create `src/content/config.ts` Zod schemas (jobs + specialties placeholder) |
| T31 | 1.A | Seed `src/content/jobs/` (template + 10 example listings — Zach action: replace with real before launch) |
| T32 | 1.A | Build `src/pages/jobs/index.astro` (Path B SSG over Content Collection — filter rail + card grid) |
| T33 | 1.A | Wire vanilla-TS filter island for URL-param filter state |
| T34 | 1.A | Wire empty-state mini-form submit handler (depends on T48) |
| T35 | 1.A | Create `migrations/20260506_ims_phase1_tables.sql` |
| T36 | 1.A | Apply migration to Supabase (`gbakzhibzotugfyktcrt` default per §10 item 8) |
| T37 | 1.A | Provision KV namespace `IMS_RATE` + bind as `RATE_KV` (Cloudflare dashboard — operator action) |
| T38 | 1.A | Set Cloudflare Pages env vars per §0.5.4 (operator action) |
| T39 | 1.A | Add Resend SPF + DKIM + DMARC records at Namecheap for `iastaffing.com` (Zach action) |
| T40 | 1.A | Provision Cloudflare Turnstile site + secret keys (operator action) |
| T41 | 1.A | TDD `src/lib/ip-hash.ts` |
| T42 | 1.A | TDD `src/lib/rate-limit-kv.ts` |
| T43 | 1.A | TDD `src/lib/turnstile-server.ts` |
| T44 | 1.A | Create `src/lib/supabase-server.ts` |
| T45 | 1.A | Create `src/lib/resend-server.ts` |
| T46 | 1.A | TDD `src/pages/api/contact.ts` |
| T47 | 1.A | TDD `src/pages/api/apply.ts` |
| T48 | 1.A | Create `TurnstileWidget.astro` |
| T49 | 1.A | Create `ContactForm.astro` (wires Turnstile + posts `/api/contact`) |
| T50 | 1.A | Create `ApplyModal.astro` (vanilla-JS, posts `/api/apply`) |
| T51 | 1.A | Wire ApplyModal data flow from `/jobs` cards (`data-job-ref`/`data-job-title`) |
| T52 | 1.A | Plausible goal-fire wiring for hero CTAs |
| T53 | 1.A | Schema.org Organization JSON-LD verification (validator.schema.org) |
| T54 | 1.A | WCAG contrast audit decisions → `docs/IAS-Design-System.md` |
| T55 | 1.A | TAY first-paint validation step → `docs/IAS-Design-System.md` |
| PA1 | Path A | DECISION GATE: Confirm Zach has written LS authorization by 2026-05-13. If NO → halt, migrate to Phase 1.5 plan |
| PA2 | Path A | Provision KV namespace `IMS_JOBS` + bind as `JOBS_KV` (operator action) |
| PA3 | Path A | Create `workers/jobs-sync/wrangler.toml` + `package.json` |
| PA4 | Path A | TDD `workers/jobs-sync/src/normalize.ts` (+ `src/data/specialties.json`) |
| PA5 | Path A | TDD `workers/jobs-sync/src/kv-writer.ts` |
| PA6 | Path A | TDD `workers/jobs-sync/src/index.ts` (cron + fetch handlers) |
| PA7 | Path A | Set Worker secret `LS_FEED_AUTH_TOKEN` via `wrangler secret put` (operator action) |
| PA8 | Path A | Deploy Worker; observe one full cron cycle clean |
| PA9 | Path A | Create `src/pages/api/jobs.ts` (KV reader) |
| PA10 | Path A | Modify `src/pages/jobs/index.astro` to switch on `PUBLIC_PATH_A` env var |
| PA11 | Path A | E2E smoke — feed-write → KV → /jobs render |
| PA12 | Path A | Document Path A → Path B fallback procedure (revert env, redeploy) |
| T56 | 1.A | E2E smoke — `/api/contact` happy path (valid Turnstile) |
| T57 | 1.A | E2E smoke — `/api/apply` happy path (valid Turnstile) |
| T58 | 1.A | E2E smoke — invalid Turnstile (4xx, no Supabase row, no Resend) |
| T59 | 1.A | E2E smoke — rate-limit hit (4th submission within 10min from same IP) |
| T60 | 1.A | E2E smoke — forced Resend failure (Supabase row at `resend_status='failed'`, returns 200) |
| T61 | 1.A | Lighthouse ≥95 on `/`, `/clinicians`, `/facilities`, `/jobs`, `/about` |
| T62 | 1.A | Pre-deploy hard-checks 1-12 walkthrough (spec §5) |
| T63 | 1.A | Pre-deploy soft-gates 13-17 walkthrough — capture Zach action status |
| T64 | 1.A | DNSSEC DS record at Namecheap (Zach action — exact digest in §10 item 1) |
| T65 | Launch | Deploy preview → final smoke → merge to `main` → tag `v1.0.0-launch` → GitHub Release |

---

## Phase 1.0 — Foundation Tasks

> Phase 1.0 is additive only — site STAYS noindex (`X-Robots-Tag` not removed yet). Phase 1.A T15/T16 do the index-flip together (T17 then verifies it via build invariants). Phase 1.0 deploy gate: Lighthouse ≥95 on `/` (still maintenance page), voice-lint runs without errors. (Codex r2 AMBER #15 fold — corrected from stale T17/T18 reference.)

### T1: Install `@astrojs/cloudflare` adapter + `@astrojs/sitemap`; switch to hybrid

**Files:**
- Create: `astro.config.mjs` (replace existing 5-line stub)
- Modify: `package.json` + `package-lock.json` (deps)

**Codex review:** `[codex-skip: trivial config + 2 deps]`

- [ ] **Step 1: Install deps**

```bash
npm install @astrojs/cloudflare@latest @astrojs/sitemap@latest
```

- [ ] **Step 2: Replace `astro.config.mjs`**

```js
// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

const SITE_URL = 'https://innovativemedicalstaffing.com';

export default defineConfig({
  site: SITE_URL,
  output: 'hybrid',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  integrations: [
    sitemap({
      filter: (page) => {
        if (page.startsWith(`${SITE_URL}/api/`)) return false;
        if (page.startsWith(`${SITE_URL}/og/`)) return false;
        if (page.includes('/jobs?')) return false;
        return true;
      },
    }),
  ],
});
```

- [ ] **Step 3: Build + verify sitemap excludes**

```bash
npm run build
ls dist/sitemap-*.xml          # expect sitemap-index.xml + sitemap-0.xml
cat dist/sitemap-index.xml     # expect well-formed
```

Manual check: open `dist/sitemap-0.xml`, confirm it does NOT contain any URL with `/api/`, `/og/`, or `?` query param.

- [ ] **Step 4: Commit**

```bash
git add astro.config.mjs package.json package-lock.json
git commit -m "feat(1.0): add @astrojs/cloudflare hybrid + sitemap [syntax-checked] [codex-skip: trivial config]"
```

---

### T2: Install `@fontsource-variable/inter` (display + body fallback)

**Files:** `package.json` + `package-lock.json`

**Codex review:** `[codex-skip: dep add]`

- [ ] **Step 1: Install**

```bash
npm install @fontsource-variable/inter@latest
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(1.0): add Inter Variable fallback for TAY synthesis-fail [syntax-checked] [codex-skip: dep add]"
```

---

### T3: Install Vitest + miniflare + workers-types; add test scripts

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (deps + scripts)

**Codex review:** `[codex-skip: trivial test infra]`

- [ ] **Step 1: Install dev deps**

```bash
npm install -D vitest @vitest/ui @cloudflare/workers-types miniflare zod
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'workers/**/*.test.ts'],
    globals: false,
    testTimeout: 10000,
  },
});
```

- [ ] **Step 3: Add scripts to `package.json`**

Add to the `"scripts"` object:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 4: Smoke test setup**

Create `tests/_smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 test passing.

Delete the smoke file before commit.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "feat(1.0): add Vitest + miniflare test runtime [runtime-verified: 1/1] [codex-skip: trivial test infra]"
```

---

### T4: Extend `src/styles/tokens.css` with brand palette tokens

**Files:** `src/styles/tokens.css`

**Codex review:** `[codex-skip: design-token addition, values from spec §4.1]`

- [ ] **Step 1: Append brand tokens block to `:root` at end of `tokens.css`**

Append after the existing `--mono` declaration (currently line 59) — keep all existing dashboard tokens (`--bg`, `--text`, etc.) in place; they stay until Phase 1.5 cleanup so the maintenance-page transition doesn't break.

```css
  /* === Marketing brand tokens (PT-derived, IMS-adjusted — spec §4.1) === */
  /* Surfaces */
  --surface-page:        #1E1E1E;
  --surface-card:        #F2E8DC;
  --surface-card-2:      #FFFAF3;
  --surface-warm:        #A79785;

  /* Inks */
  --ink-on-cream:        #1E1E1E;
  --ink-on-cream-2:      #7B5E5C;
  --ink-on-cream-3:      #403F3E;
  --ink-on-dark:         #F2E8DC;
  --ink-on-dark-2:       #C8C8C8;

  /* Brand */
  --brand-blue:          #59BFE7;
  --brand-blue-deep:     #3898EC;
  --brand-navy:          #1A2B4A;
  --brand-gold:          #F0B420;
  --brand-gold-muted:    #B8975B;
  --brand-red:           #E73C37;
  --brand-teal:          #3D6B6F;
  --brand-green:         #2F4A40;

  /* Borders (marketing surfaces — distinct from dashboard --border) */
  --border-hairline:     rgba(30, 30, 30, 0.12);
  --border-strong-mkt:   rgba(30, 30, 30, 0.32);

  /* Functional */
  --success:             #2F6B4A;
  --warning:             #B87A1F;
  --error-mkt:           #A33A2C;

  /* Marketing radius scale (vw-based card chrome — spec §4.6) */
  --r-card:              clamp(20px, 5vw, 96px);
  --r-section:           16px;
  --r-audience:          24px;
  --r-pill-mkt:          999px;
  --r-input:             8px;
  --r-illustration:      24px;
```

- [ ] **Step 2: Verify tokens.css still parses**

```bash
npm run build
```
Expected: build succeeds; existing dashboard tokens still parse; new tokens present in `dist/` CSS bundle.

- [ ] **Step 3: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(1.0): brand palette tokens (PT-derived) per spec §4.1 [logically-inspected] [codex-skip: design-token values from spec]"
```

---

### T5: Add typography tokens + `@font-face` declarations for TAY Basal + TAY Amaya

**Files:** `src/styles/tokens.css` (extend further)

**Codex review:** `[codex-skip: typography token + @font-face from spec §4.2]`

- [ ] **Step 1: Append `@font-face` block + font-family vars to `tokens.css`**

After the marketing brand-token block from T4, append:

```css
  /* === Marketing typography (spec §4.2) === */
  --font-display: 'TAY Basal', 'Inter Variable', 'Source Serif 4', Georgia, serif;
  --font-body:    'TAY Amaya', 'Inter Variable', 'Inter', system-ui, sans-serif;
  --font-mono-mkt: ui-monospace, 'JetBrains Mono', Consolas, monospace;
}

/* @font-face declarations live OUTSIDE :root */
@font-face {
  font-family: 'TAY Basal';
  src: url('/fonts/TAYBasalRegular.woff2') format('woff2'),
       url('/fonts/TAYBasalRegular.woff') format('woff');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'TAY Amaya';
  src: url('/fonts/TAYAmaya.woff2') format('woff2'),
       url('/fonts/TAYAmaya.woff') format('woff');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

Important: the closing `}` of `:root` shifts down to AFTER the new font-family lines. The `@font-face` rules are top-level, not inside `:root`.

- [ ] **Step 2: Import Inter Variable in tokens.css (fallback when TAY swap-fails)**

At the very top of `tokens.css`, add:

```css
@import '@fontsource-variable/inter';
```

- [ ] **Step 3: Build + verify font URLs resolve**

```bash
npm run build
grep -r 'TAYBasalRegular' dist/ | head -5
ls dist/fonts/                   # expect TAY*.woff2 copied to dist
```
Expected: TAY font URLs in compiled CSS reference `/fonts/TAYBasalRegular.woff2` (Astro auto-copies `public/fonts/` to `dist/fonts/`).

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(1.0): @font-face TAY Basal + Amaya + Inter Variable fallback [syntax-checked] [codex-skip: spec §4.2]"
```

---

### T6: Generate logo SVG variants + functional icon set + Astro components

**Files:**
- Create: `src/assets/brand/IMS-Logo-Original.svg`
- Create: `src/assets/brand/IMS-Logo-Default.svg`
- Create: `src/assets/brand/IMS-Logo-OnDark.svg`
- Create: `src/assets/brand/IMS-Logo-Mono.svg`
- Create: `src/components/brand/LogoDefault.astro`
- Create: `src/components/brand/LogoOnDark.astro`
- Create: `src/components/brand/LogoMono.astro`
- Create: `src/assets/icons/{chevron-down,chevron-right,close,external-link,arrow-right,menu,check,info}.svg` (≤8 functional icons per spec §4.7 — Codex r1 AMBER #5 fold)
- Create: `src/components/icons/Icon.astro` (single wrapper that takes a `name` prop and inlines the matching SVG)

**Codex review:** `[codex-skip: SVG asset + thin component wrapper]`

> **Operator note:** the existing IMS logo SVG path data lives off-repo (Zach has the source). T6 step 1 says where to start. If the source is unavailable at execution time, file a Zach-action subtask and pause T6 — block T7+ until logos exist. Do NOT proceed with placeholder logos.

- [ ] **Step 1: Source the original SVG**

Locate the existing IMS logo SVG with `cls-1` (swoop) and `cls-2` (MS letters) classes. Save to `src/assets/brand/IMS-Logo-Original.svg` with `cls-1: #59BFE7`, `cls-2: #F4F5F5`.

- [ ] **Step 2: Generate Default variant**

Copy `IMS-Logo-Original.svg` → `IMS-Logo-Default.svg`. Change `cls-2` fill from `#F4F5F5` to `#1E1E1E`. Keep `cls-1` at `#59BFE7`.

- [ ] **Step 3: Generate OnDark variant**

Copy → `IMS-Logo-OnDark.svg`. Change `cls-2` fill to `#F2E8DC`. Keep `cls-1` at `#59BFE7`.

- [ ] **Step 4: Generate Mono variant**

Copy → `IMS-Logo-Mono.svg`. Change BOTH `cls-1` and `cls-2` fills to `currentColor`.

- [ ] **Step 5: Create `src/components/brand/LogoDefault.astro`**

```astro
---
interface Props {
  height?: number | string;
  class?: string;
}
const { height = 32, class: className = '' } = Astro.props;
---
<svg
  role="img"
  aria-label="Innovative Medical Staffing"
  class={className}
  height={height}
  viewBox="0 0 [WIDTH] [HEIGHT]"
  xmlns="http://www.w3.org/2000/svg"
>
  <!-- inline SVG path data from IMS-Logo-Default.svg -->
</svg>
```

Replace `[WIDTH]` `[HEIGHT]` with actual viewBox values from the source SVG. Inline the actual `<path>` / `<g>` elements rather than `<img src="...svg">` so `currentColor` works on Mono variant + a11y label is reliable.

- [ ] **Step 6: Create `LogoOnDark.astro` + `LogoMono.astro`**

Same shape as LogoDefault, swap inlined SVG content per variant.

- [ ] **Step 7: Verify logo components render**

In a temporary scratch route or by importing into `src/pages/index.astro`, render all three and confirm:
- Default reads correctly on cream
- OnDark reads correctly on `#1E1E1E`
- Mono inherits parent `color` (test by wrapping in `<div style="color: red">`)

- [ ] **Step 8: Author functional icon SVGs (Codex r1 AMBER #5 fold — spec §4.7)**

Create 8 icons in `src/assets/icons/`. All are 24×24px viewBox, line-art at 1.5px stroke-width, `currentColor` stroke + `none` fill, `stroke-linecap="round"` + `stroke-linejoin="round"`:

| Icon | Path / Use case |
|---|---|
| `chevron-down.svg` | `<polyline points="6 9 12 15 18 9" />` — used by select / accordion |
| `chevron-right.svg` | `<polyline points="9 6 15 12 9 18" />` — used by CTAs (replaces Unicode `→` where icon-style fits better) |
| `close.svg` | `<line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />` — modal close |
| `external-link.svg` | `<path d="M14 4h6v6 M14 10l6-6 M19 11v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h8" />` — outbound LinkedIn / careers links in footer |
| `arrow-right.svg` | `<line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" />` — primary CTA emphasis |
| `menu.svg` | `<line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />` — Phase 1.5 hamburger nav (icon staged at v1 even if menu component is 1.5) |
| `check.svg` | `<polyline points="5 12 10 17 19 7" />` — form-success indicator |
| `info.svg` | `<circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="17" /><circle cx="12" cy="7.5" r="0.5" fill="currentColor" />` — tooltip / hint marker |

SVG template (apply to each):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <!-- icon content per table above -->
</svg>
```

**Cap enforcement:** ≤8 icons at Phase 1 launch per spec §4.7. Adding a 9th icon requires either (a) a Phase 1.5 plan addendum, or (b) replacing an existing icon. CI guardrail: `verify-build.mjs` (T17) adds an assertion `readdirSync('src/assets/icons').filter(f => f.endsWith('.svg')).length <= 8`.

- [ ] **Step 9: Create `src/components/icons/Icon.astro` wrapper**

```astro
---
import chevronDown from '../../assets/icons/chevron-down.svg?raw';
import chevronRight from '../../assets/icons/chevron-right.svg?raw';
import close from '../../assets/icons/close.svg?raw';
import externalLink from '../../assets/icons/external-link.svg?raw';
import arrowRight from '../../assets/icons/arrow-right.svg?raw';
import menu from '../../assets/icons/menu.svg?raw';
import check from '../../assets/icons/check.svg?raw';
import info from '../../assets/icons/info.svg?raw';

const ICONS = {
  'chevron-down': chevronDown,
  'chevron-right': chevronRight,
  'close': close,
  'external-link': externalLink,
  'arrow-right': arrowRight,
  'menu': menu,
  'check': check,
  'info': info,
} as const;

interface Props {
  name: keyof typeof ICONS;
  size?: number;
  /** Optional accessible label; if omitted, icon is aria-hidden (decorative) */
  label?: string;
}
const { name, size = 24, label } = Astro.props;
const raw = ICONS[name];
---
<span
  class="icon"
  style={`--icon-size: ${size}px`}
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  set:html={raw}
/>

<style>
  .icon { display: inline-flex; align-items: center; justify-content: center; }
  .icon :global(svg) { width: var(--icon-size); height: var(--icon-size); }
</style>
```

The `?raw` import + `set:html` trick inlines the SVG so `currentColor` resolves to whatever ink color the parent provides (matches logo Mono behavior).

- [ ] **Step 10: Add icon-set CI guardrail to verify-build.mjs**

This step is consumed by T17 (verify-build rewrite). Add a planned check that will land in T17:

```js
// In scripts/verify-build.mjs T17 update — icon set cap enforcement
import { readdirSync } from 'node:fs';
const iconsDir = 'src/assets/icons';
let iconCount = 0;
try { iconCount = readdirSync(iconsDir).filter(f => f.endsWith('.svg')).length; } catch {}
check(`icon set ≤ 8 (spec §4.7 cap)`, iconCount <= 8);
check(`icon set has at least chevron-down + close (load-bearing)`, /* check both files exist */);
```

- [ ] **Step 11: Commit**

```bash
git add src/assets/brand/IMS-Logo-*.svg src/components/brand/Logo*.astro src/assets/icons/*.svg src/components/icons/Icon.astro
git commit -m "feat(1.0): IMS logo variants + 8 functional icons (spec §4.7) + Icon.astro wrapper [logically-inspected] [codex-skip: SVG asset]"
```

---

### T7: Create `ScrollReveal.astro` IntersectionObserver helper

**Files:** `src/components/util/ScrollReveal.astro`

**Codex review:** MANDATORY (small but real client-runtime code path)

- [ ] **Step 1: Create the component**

```astro
---
interface Props {
  /** Tag name for the wrapper. Default: section */
  as?: string;
  /** Reveal delay in ms (default 0) */
  delay?: number;
  class?: string;
}
const { as: As = 'section', delay = 0, class: className = '' } = Astro.props;
---
<As class:list={['scroll-reveal', className]} data-reveal-delay={delay}>
  <slot />
</As>

<style>
  .scroll-reveal {
    opacity: 0;
    transform: translateY(12px);
    transition:
      opacity 500ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 500ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: opacity, transform;
  }
  .scroll-reveal.is-revealed {
    opacity: 1;
    transform: translateY(0);
  }
  @media (prefers-reduced-motion: reduce) {
    .scroll-reveal {
      transition: opacity 200ms linear;
      transform: none;
    }
  }
</style>

<script>
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          const delay = Number(el.dataset.revealDelay ?? 0);
          if (delay > 0) {
            setTimeout(() => el.classList.add('is-revealed'), delay);
          } else {
            el.classList.add('is-revealed');
          }
          observer.unobserve(el); // once-only per spec §4.4
        }
      }
    },
    { rootMargin: '-10%' },
  );

  document.querySelectorAll<HTMLElement>('.scroll-reveal').forEach((el) => {
    observer.observe(el);
  });
</script>
```

- [ ] **Step 2: Codex review**

Run `/codex:rescue` (or direct `codex-companion.mjs task --prompt "Review src/components/util/ScrollReveal.astro for: IntersectionObserver leak risk, prefers-reduced-motion handling, once-only contract per spec §4.4, multiple instances per page sharing one observer instance correctly."`).

Fold any findings.

- [ ] **Step 3: Commit**

```bash
git add src/components/util/ScrollReveal.astro
git commit -m "feat(1.0): ScrollReveal IntersectionObserver helper per spec §4.4 [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T8: Create `MarketingLayout.astro` chrome

**Files:** `src/layouts/MarketingLayout.astro`

**Codex review:** MANDATORY (load-bearing layout — every marketing page renders through this)

- [ ] **Step 1: Create the layout**

Create `src/layouts/MarketingLayout.astro`:

```astro
---
import '../styles/tokens.css';

interface Props {
  title?: string;
  description?: string;
  noindex?: boolean;
  /** When true, the page wraps content in the cream rounded card. False = full-bleed dark exterior (rare; used by §2.5/§2.10 dark sections rendered as siblings) */
  inCard?: boolean;
  /** Canonical URL override (defaults to current Astro.url) */
  canonical?: string;
  /** OG image URL (Phase 1.5 will add programmatic /og/[slug].png — at v1, falls back to a static asset) */
  ogImage?: string;
}

const {
  title = 'Innovative Medical Staffing',
  description = 'Healthcare staffing that is more personal, responsive, and technology-enabled.',
  noindex = false, // marketing pages default to indexable in 1.A
  inCard = true,
  canonical,
  ogImage = '/og-default.png',
} = Astro.props;

const canonicalUrl = canonical ?? Astro.url.toString();

const PLAUSIBLE_DOMAIN = 'innovativemedicalstaffing.com';
const ORG_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Innovative Medical Staffing',
  url: 'https://innovativemedicalstaffing.com',
  logo: 'https://innovativemedicalstaffing.com/og-default.png',
  contactPoint: [
    {
      '@type': 'ContactPoint',
      email: 'recruiting@iastaffing.com',
      telephone: '+1-512-524-6686',
      contactType: 'customer service',
      areaServed: 'US',
      availableLanguage: ['English'],
    },
  ],
};
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content={description} />
    {noindex && <meta name="robots" content="noindex, nofollow" />}
    <link rel="canonical" href={canonicalUrl} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content={ogImage} />
    <meta property="og:type" content="website" />
    <meta property="og:url" content={canonicalUrl} />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="generator" content={Astro.generator} />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#1E1E1E" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>{title}</title>
    <!-- Plausible Cloud — privacy-friendly, no cookie banner per spec §0.5.8 -->
    <script
      is:inline
      defer
      data-domain={PLAUSIBLE_DOMAIN}
      src="https://plausible.io/js/script.tagged-events.js"
    ></script>
    <!-- Schema.org Organization — spec §6 -->
    <script
      is:inline
      type="application/ld+json"
      set:html={JSON.stringify(ORG_JSON_LD)}
    />
  </head>
  <body class="marketing">
    <slot name="nav" />
    {inCard ? (
      <main class="card">
        <slot />
      </main>
    ) : (
      <main class="full-bleed">
        <slot />
      </main>
    )}
    <slot name="footer" />
  </body>
</html>

<style>
  body.marketing {
    background: var(--surface-page);
    font-family: var(--font-body);
    color: var(--ink-on-cream);
    line-height: 1.6;
    margin: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  main.card {
    background: var(--surface-card);
    border-radius: var(--r-card);
    margin: clamp(20px, 4vw, 64px);
    overflow: hidden; /* keeps inner sections flush per spec §1 page-level rules */
  }
  main.full-bleed {
    background: var(--surface-page);
    color: var(--ink-on-dark);
  }
  /* prose max width handled per-section, not at layout */
</style>
```

- [ ] **Step 2: Codex review**

Run Codex on this file with prompt: "Review src/layouts/MarketingLayout.astro for: noindex default semantics (Phase 1.0 vs 1.A flip), CSP compatibility with Plausible inline script + JSON-LD inline script (both need 'unsafe-inline' in script-src per spec §0.5.3), canonical URL correctness for trailing-slash variants, OG image fallback behavior at Phase 1.A (v1.0 ships /og-default.png — verify file is added before T31), and Schema.org Organization markup completeness."

Fold findings; expect Codex to flag the missing `/og-default.png` file in `public/` — add a placeholder during T29 (browser smoke pass).

- [ ] **Step 3: Commit**

```bash
git add src/layouts/MarketingLayout.astro
git commit -m "feat(1.0): MarketingLayout (cream card chrome + Plausible + Org JSON-LD) per spec §1/§6 [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T9: Replace CSP block in `functions/_middleware.js` per §0.5.3

**Files:** `functions/_middleware.js`

**Codex review:** MANDATORY (security-policy change)

> **Critical:** Phase 1.0 keeps `X-Robots-Tag: noindex, nofollow` in place — site stays noindex until Phase 1.A T15 (functions/_middleware.js) and T16 (public/_headers) remove it. T9 replaces ONLY the CSP value. (Codex r2 AMBER #15 fold — corrected from stale T17/T18 reference.)

- [ ] **Step 1: Modify `functions/_middleware.js` line 22-23**

Replace the `Content-Security-Policy` value in `SECURITY_HEADERS` with the spec §0.5.3 final block:

```js
const SECURITY_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",  // KEEP — Phase 1.A T15 removes this
  "Strict-Transport-Security": "max-age=15768000; includeSubDomains",
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://plausible.io https://challenges.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "connect-src 'self' https://plausible.io https://challenges.cloudflare.com; " +
    "frame-src https://challenges.cloudflare.com; " +
    "form-action 'self'; " +
    "base-uri 'self'; " +
    "frame-ancestors 'none'",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
```

- [ ] **Step 2: Verify CSP locally**

Run dev server: `npm run dev`. Open `http://localhost:4321/` and check browser DevTools Network → `/` response → Headers. Confirm `Content-Security-Policy` matches above (note: `_middleware.js` only runs in Pages env; for full local CSP test use `npx wrangler pages dev dist` after a build).

- [ ] **Step 3: Codex review**

Prompt: "Review functions/_middleware.js CSP change. Verify: matches spec §0.5.3 exactly; trailing semicolon retention; all required directives present (default-src, script-src, style-src, img-src, font-src, connect-src, frame-src, form-action, base-uri, frame-ancestors); X-Robots-Tag intentionally KEPT for Phase 1.0 (Phase 1.A removes); no regressions to canonicalization redirect logic at lines 39-46."

Fold findings.

- [ ] **Step 4: Commit**

```bash
git add functions/_middleware.js
git commit -m "feat(1.0): replace CSP per spec §0.5.3 (Plausible + Turnstile + self-hosted fonts) [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T10: Create `scripts/voice-lint.mjs` advisory script

**Files:** `scripts/voice-lint.mjs`

**Codex review:** MANDATORY (build-time tooling that affects CI signal)

- [ ] **Step 1: Create the script**

```js
#!/usr/bin/env node
// Voice + visual lint — advisory at v1 (exit 0 always, prints findings to stderr)
// Spec §4.5 / §0.5.6. Promoted to BLOCKING for BANNED tier at Phase 1.5.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BANNED = [
  'streamline', 'streamlining', 'solutions', 'premier',
  'disrupt', 'disruptive', 'scale', 'gig', 'rockstar',
  'ninja', 'game-changing', 'best-in-class', 'cutting-edge',
  'seamless', 'seamlessly', 'revolutionize', 'revolutionary',
];
const CARE = ['ai', 'platform', 'pipeline', 'database'];
const VISUAL_BANNED = [
  'crossed-arms', 'stethoscope-stock', 'neural-mesh', 'data-stream',
  'blue-gradient-medical', 'hospital-hallway-stock',
];

const ROOT = process.cwd();
const TARGETS = ['src', 'docs/specs']; // .astro/.md only — MDX dropped from Phase 1 per spec §0.5.1
const EXTS = new Set(['.astro', '.md']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else {
      const dot = entry.lastIndexOf('.');
      if (dot >= 0 && EXTS.has(entry.slice(dot))) out.push(full);
    }
  }
  return out;
}

function checkLine(line, lineNum, file, findings) {
  const lower = line.toLowerCase();
  for (const word of BANNED) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(line)) findings.push({ file, lineNum, tier: 'BANNED', word, line: line.trim() });
  }
  for (const word of CARE) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(line)) findings.push({ file, lineNum, tier: 'CARE', word, line: line.trim() });
  }
  for (const word of VISUAL_BANNED) {
    if (lower.includes(word)) findings.push({ file, lineNum, tier: 'VISUAL', word, line: line.trim() });
  }
}

const findings = [];
for (const target of TARGETS) {
  const dir = join(ROOT, target);
  let files = [];
  try { files = walk(dir); } catch { continue; }
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => checkLine(line, i + 1, relative(ROOT, file), findings));
  }
}

if (findings.length === 0) {
  console.log('voice-lint: 0 findings');
  process.exit(0);
}

// Advisory mode at v1 — print to stderr, exit 0
process.stderr.write(`voice-lint: ${findings.length} advisory finding(s)\n`);
for (const f of findings) {
  process.stderr.write(`  [${f.tier}] ${f.file}:${f.lineNum}  "${f.word}"  ${f.line.slice(0, 100)}\n`);
}
process.stderr.write('voice-lint: ADVISORY — not failing build at v1 (spec §0.5.6)\n');
process.exit(0);
```

- [ ] **Step 2: Test the script on existing repo**

```bash
node scripts/voice-lint.mjs
```

Expected output: lists any `BANNED`/`CARE`/`VISUAL` findings in `src/` + `docs/specs/`. The script file itself contains banned tokens in the BANNED arrays (literal strings) — confirm the lint correctly skips its own definition (it does — TARGETS excludes `scripts/`). If it self-flags, fix the TARGETS scope.

- [ ] **Step 3: Codex review**

Prompt: "Review scripts/voice-lint.mjs for: regex correctness on word-boundary edge cases (e.g., 'AI' uppercase), Windows path-separator handling in walk(), exit-code semantics (must exit 0 at v1 per spec §0.5.6), and that it does not self-flag the BANNED arrays it defines. Verify the EXTS Set excludes MDX per spec §0.5.1."

Fold findings.

- [ ] **Step 4: Commit**

```bash
git add scripts/voice-lint.mjs
git commit -m "feat(1.0): voice-lint advisory script per spec §4.5 [runtime-verified: 1/1] [codex-reviewed: r1 GO]"
```

---

### T11: Wire voice-lint into `npm run verify` (advisory)

**Files:** `scripts/verify-build.mjs`, `package.json`

**Codex review:** `[codex-skip: 1-line shell-out + verifier compose]`

- [ ] **Step 1: Add voice-lint invocation to `verify-build.mjs`**

Append to the END of `scripts/verify-build.mjs` (after the existing `verify-build OK` log line, before `process.exit(failures > 0 ? 1 : 0)` if rearranging). The cleanest wire-in: add a separate npm script that chains `verify-build` + `voice-lint`, rather than modifying the JS.

In `package.json` `"scripts"`, change:

```json
"verify": "node scripts/verify-build.mjs"
```

to:

```json
"verify": "node scripts/verify-build.mjs && node scripts/voice-lint.mjs"
```

Note: voice-lint exits 0 even with findings, so the `&&` chain won't break on advisory output.

- [ ] **Step 2: Test**

```bash
npm run build && npm run verify
```

Expected: `verify-build OK` followed by voice-lint output (or `voice-lint: 0 findings`). Exit 0 either way.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(1.0): wire voice-lint into npm run verify (advisory) [runtime-verified: 1/1] [codex-skip: trivial verifier compose]"
```

---

### T12: Phase 1.0 deploy gate — Lighthouse ≥95 on `/` (still maintenance)

**Files:** none (verification task)

**Codex review:** N/A

- [ ] **Step 1: Build + preview locally**

```bash
npm run build && npm run preview
# or for full Cloudflare runtime parity:
npx wrangler pages dev dist
```

- [ ] **Step 2: Run Lighthouse**

Open `http://localhost:4321/` (or wrangler-served URL) in Chromium. DevTools → Lighthouse → run on Mobile, all 4 categories. Confirm scores ≥95 for Performance / Accessibility / Best Practices / SEO.

If a score is <95, drop into the Lighthouse "Opportunities" panel and fix the highest-impact issue. Common Phase 1.0 culprits:
- `font-display: swap` missing (already in T5)
- Inline JSON-LD missing → fixed in T8 MarketingLayout
- Render-blocking Plausible script — `defer` already on `<script>` in T8
- Missing favicon — already present at `public/favicon.svg`

- [ ] **Step 3: Run `npm run verify`**

```bash
npm run verify
```

Expected: existing Phase-0 checks still pass (`Innovative Medical Staffing` wordmark + maintenance-page strings + `noindex` meta tag + dashboard tokens — these all stay because Phase 1.0 doesn't touch the maintenance page). voice-lint runs to completion.

- [ ] **Step 4: Record results**

Append to commit message of T13 (the tag commit) the Lighthouse scores for `/`.

---

### T13: Tag Phase 1.0 commit; deploy preview

**Files:** `docs/IAS-Design-System.md` (append Phase 1.0 implementation note)

**Codex review:** `[codex-skip: documentation note]`

- [ ] **Step 1: Append Phase 1.0 note to IAS-Design-System.md**

Append to the END of `docs/IAS-Design-System.md`:

```markdown
---

## Marketing Phase 1.0 implementation (2026-05)

Brand tokens (PT-derived), TAY Basal + TAY Amaya self-hosted, MarketingLayout chrome, ScrollReveal helper, voice-lint advisory, and CSP rewrite per spec §0.5.3 are in place as of `feat/ims-phase-1-plan`. Site stays `noindex` — Phase 1.A removes `X-Robots-Tag` in T15/T16.
```

- [ ] **Step 2: Commit + tag**

```bash
git add docs/IAS-Design-System.md
git commit -m "docs(1.0): mark Phase 1.0 foundation primitives landed [logically-inspected] [codex-skip: doc note]"
git tag -a phase-1.0-foundation -m "Phase 1.0 foundation: adapter+sitemap+brand tokens+TAY fonts+MarketingLayout+ScrollReveal+CSP+voice-lint advisory"
```

- [ ] **Step 3: Push + verify Cloudflare preview deploys clean**

```bash
git push -u origin feat/ims-phase-1-plan --tags
```

Open the preview URL Cloudflare Pages assigns. Verify: maintenance page renders, fonts load (DevTools Network → `TAY*.woff2` 200), CSP header present (DevTools Network → `/` response → Headers), no console errors.

- [ ] **Step 4: Run review-gate stamp**

```bash
bash ~/.claude/hooks/review-gate.sh --stamp
```

---



## Phase 1.A — Index-Flip Tasks

> **Critical sequencing:** T14 + T15 + T16 are the LAUNCH HARD GATE for indexability. They must land in the same PR / deploy as T28 (the home-page swap). Tagging `v1.0.0-launch` requires all four. T17 swaps the verifier so CI guards the new state.

### T14: Update `public/robots.txt` to allow + reference sitemap

**Files:** `public/robots.txt`

**Codex review:** `[codex-skip: 3-line config]`

- [ ] **Step 1: Replace `public/robots.txt` contents**

```
User-agent: *
Allow: /

Sitemap: https://innovativemedicalstaffing.com/sitemap.xml
```

The `sitemap.xml` URL matches spec §1 line 185. `@astrojs/sitemap` emits `sitemap-index.xml` + `sitemap-0.xml` by default, so Step 2 below adds a redirect from `/sitemap.xml` to the integration output.

- [ ] **Step 2: Add `/sitemap.xml` → `/sitemap-index.xml` redirect (Codex r1 AMBER #7 fold)**

Cloudflare Pages reads `public/_redirects` for routing. Append (or create) the file with:

```
/sitemap.xml  /sitemap-index.xml  301
```

This 301-redirects `https://innovativemedicalstaffing.com/sitemap.xml` (the public URL declared in robots.txt + spec §1) to the actual integration-generated index, so crawlers + cache-validators land on the real file regardless of which name they hit. Both URLs work; canonical is `sitemap.xml` per spec.

- [ ] **Step 3: Verify locally**

```bash
npm run build
npx wrangler pages dev dist
```

In a separate shell:

```bash
curl -sI 'http://localhost:8788/sitemap.xml'         # expect 301 → /sitemap-index.xml
curl -sL 'http://localhost:8788/sitemap.xml' | head  # expect <sitemapindex> XML body
curl -sI 'http://localhost:8788/sitemap-index.xml'   # expect 200
curl -sI 'http://localhost:8788/robots.txt'          # expect 200; body references sitemap.xml
```

- [ ] **Step 4: Commit**

```bash
git add public/robots.txt public/_redirects
git commit -m "feat(1.A): robots.txt + sitemap.xml redirect (aligns with spec §1) [runtime-verified: 4/4 curl smoke] [codex-skip: trivial config]"
```

---

### T15: REMOVE static `X-Robots-Tag` + ADD query-aware `/jobs?...` noindex header (LAUNCH HARD GATE 1/2)

**Files:** `functions/_middleware.js`

**Codex review:** MANDATORY (security/index header change AND server-side SEO contract)

> **Why two changes in one task (Codex r1 NO-GO #1 fold):** the spec §0.5.5 requires filtered `/jobs?...` URLs to ship `noindex,follow` + canonical to `/jobs`. With Path B SSG, every filtered URL serves the SAME static HTML — so a `<meta name="robots">` injected client-side in T33 hits crawlers AFTER they've already seen indexable content. The fix is server-side: the Pages Function inspects the request URL and sets `X-Robots-Tag: noindex, follow` BEFORE the static HTML is returned. Static `X-Robots-Tag` removal + dynamic `/jobs?...` injection happen in the same middleware function, so they belong in the same task.

- [ ] **Step 1: Remove the static `X-Robots-Tag` entry from `SECURITY_HEADERS`**

In `functions/_middleware.js` line 20, delete the line:

```js
"X-Robots-Tag": "noindex, nofollow",
```

The `SECURITY_HEADERS` object should now START with `"Strict-Transport-Security"`. Leave all other headers (HSTS, CSP, Permissions-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options) intact.

- [ ] **Step 2: Add filtered-`/jobs?...` query-aware noindex injection**

Add this helper above `withSecurityHeaders`:

```js
const NOINDEX_FOLLOW = "noindex, follow";
const FILTER_PARAMS = ["specialty", "state", "length"];

function isFilteredJobsUrl(url) {
  if (url.pathname !== "/jobs" && url.pathname !== "/jobs/") return false;
  return FILTER_PARAMS.some((p) => url.searchParams.has(p));
}
```

Modify `withSecurityHeaders` to accept the `request` argument and conditionally inject `X-Robots-Tag` when the URL has a filtered `/jobs?...` shape:

```js
const withSecurityHeaders = (response, request) => {
  const cloned = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    cloned.headers.set(name, value);
  }
  const url = new URL(request.url);
  if (isFilteredJobsUrl(url)) {
    cloned.headers.set("X-Robots-Tag", NOINDEX_FOLLOW);
    cloned.headers.set("Link", `<${url.origin}/jobs>; rel="canonical"`);
  }
  return cloned;
};
```

Update both `onRequest` callers to pass `request`:

```js
export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname === "ims-website.pages.dev") {
    url.hostname = "innovativemedicalstaffing.com";
    url.protocol = "https:";
    return withSecurityHeaders(Response.redirect(url.toString(), 301), request);
  }
  return withSecurityHeaders(await next(), request);
};
```

The HTTP `Link: rel="canonical"` header is the server-side equivalent of the `<link rel="canonical">` tag and is honored by Google + Bing crawlers (per https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls). T33's client-side meta-injection stays as a defense-in-depth layer for users who view source.

- [ ] **Step 3: Verify no static `X-Robots-Tag` remains; verify dynamic logic is wired**

```bash
grep -n "X-Robots-Tag" functions/_middleware.js
```

Expected: 1 match — the line `cloned.headers.set("X-Robots-Tag", NOINDEX_FOLLOW);` inside the `isFilteredJobsUrl` branch. NO occurrence in `SECURITY_HEADERS`.

```bash
grep -n "isFilteredJobsUrl\|FILTER_PARAMS" functions/_middleware.js
```

Expected: helper definitions + the call-site in `withSecurityHeaders`.

- [ ] **Step 4: E2E verification with `wrangler pages dev`**

```bash
npm run build
npx wrangler pages dev dist
```

In a separate shell:

```bash
curl -I http://localhost:8788/                    # expect NO X-Robots-Tag header
curl -I http://localhost:8788/jobs                # expect NO X-Robots-Tag header (root listing, indexable)
curl -I 'http://localhost:8788/jobs?specialty=anesthesiology'   # expect X-Robots-Tag: noindex, follow + Link: canonical
curl -I 'http://localhost:8788/jobs?state=TX&length=medium'     # expect X-Robots-Tag + Link: canonical
curl -I 'http://localhost:8788/jobs?unrelated=1'  # expect NO X-Robots-Tag (only filter params trigger it)
```

If any expectation fails, debug `_middleware.js` before committing.

- [ ] **Step 5: Codex review**

Prompt: "Review functions/_middleware.js. Verify: static `X-Robots-Tag` fully removed from SECURITY_HEADERS object; dynamic injection only fires for `/jobs` (with optional trailing slash) when query params include specialty/state/length; canonicalization redirect at lines 39-46 unchanged; `request` correctly passed to `withSecurityHeaders` from BOTH the redirect path AND the next() path; no header collision between the dynamic X-Robots-Tag and any client-side `<meta>` injected by T33 (server header takes precedence per Google, but client meta still useful for view-source clarity); `Link: rel=canonical` header URL has correct origin (uses request URL origin, not hardcoded)."

- [ ] **Step 6: Commit**

```bash
git add functions/_middleware.js
git commit -m "feat(1.A): static X-Robots-Tag removed + query-aware /jobs?... noindex,follow header (Codex r1 NO-GO #1 fix) [runtime-verified: 5/5 curl smoke] [codex-reviewed: r1 GO]"
```

---

### T16: REMOVE `X-Robots-Tag` from `public/_headers` (LAUNCH HARD GATE 2/2)

**Files:** `public/_headers`

**Codex review:** MANDATORY (security/index header change — sibling to T15)

- [ ] **Step 1: Delete line 2**

In `public/_headers`, remove the line:

```
  X-Robots-Tag: noindex, nofollow
```

The remaining file content keeps HSTS, CSP, Permissions-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options. (Spec §0.5.3 makes `_middleware.js` authoritative; `_headers` is fallback only — but both must agree.)

- [ ] **Step 2: Cross-file verification (T15 + T16)**

```bash
git grep -n "X-Robots-Tag"
```

Expected: empty across the entire repo.

- [ ] **Step 3: Commit**

```bash
git add public/_headers
git commit -m "feat(1.A): REMOVE X-Robots-Tag from _headers (LAUNCH HARD GATE 2/2) [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T17: Update `scripts/verify-build.mjs` from Phase-0 to Phase-1.A invariants

**Files:** `scripts/verify-build.mjs`

**Codex review:** MANDATORY (CI gate — false-pass risk if assertions wrong)

- [ ] **Step 1: Rewrite verify-build.mjs**

Replace contents with:

```js
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');
const robotsPath = join(dist, 'robots.txt');
const sitemapIndexPath = join(dist, 'sitemap-index.xml');

let failures = 0;
function check(name, condition) {
  if (condition) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}`); failures++; }
}

function findCssFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findCssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

console.log('verify-build (Phase 1.A invariants):');

check('dist/index.html exists', existsSync(indexPath));
check('dist/robots.txt exists', existsSync(robotsPath));
check('dist/sitemap-index.xml exists', existsSync(sitemapIndexPath));

let html = '';
if (existsSync(indexPath)) {
  html = readFileSync(indexPath, 'utf8');
  check(
    'index.html contains wordmark',
    html.includes('Innovative Medical Staffing'),
  );
  check(
    'index.html does NOT contain noindex meta (LAUNCH HARD GATE)',
    !/<meta\s+name=["']robots["']\s+content=["']noindex/i.test(html),
  );
  check(
    'index.html declares canonical link',
    /<link\s+rel=["']canonical["']/i.test(html),
  );
  check(
    'index.html includes Plausible script',
    html.includes('plausible.io/js/script.tagged-events.js'),
  );
  check(
    'index.html includes Schema.org Organization JSON-LD',
    /"@type"\s*:\s*"Organization"/i.test(html) ||
    /&quot;@type&quot;\s*:\s*&quot;Organization&quot;/i.test(html),
  );
}

const bundledCss = findCssFiles(join(dist, '_astro'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const allCss = html + '\n' + bundledCss;

check('Brand tokens present (--surface-card)', allCss.includes('--surface-card:'));
check('Brand tokens present (--brand-blue)', allCss.includes('--brand-blue:'));
check('Brand tokens present (--ink-on-cream)', allCss.includes('--ink-on-cream:'));
check('TAY Basal @font-face present', allCss.includes('TAY Basal') || allCss.includes('TAYBasalRegular'));
check('TAY Amaya @font-face present', allCss.includes('TAY Amaya') || allCss.includes('TAYAmaya'));

if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, 'utf8');
  check('robots.txt has Allow: / (LAUNCH HARD GATE)', /Allow:\s*\/\s*$/m.test(robots));
  check('robots.txt has Sitemap directive', /Sitemap:\s+https:\/\//i.test(robots));
  check('robots.txt does NOT contain Disallow: /', !/^Disallow:\s*\/\s*$/m.test(robots));
}

if (existsSync(sitemapIndexPath)) {
  const sitemap = readFileSync(sitemapIndexPath, 'utf8');
  check('sitemap-index.xml has innovativemedicalstaffing.com URLs', sitemap.includes('innovativemedicalstaffing.com'));
}

// Functional icon set cap (Codex r2 AMBER #6 — moved from T6 plan to actual T17 enforcement).
// Spec §4.7 lines 633-638 hard-cap: ≤ 8 functional icons at launch.
const iconsDir = join(process.cwd(), 'src', 'assets', 'icons');
if (existsSync(iconsDir)) {
  const svgFiles = readdirSync(iconsDir).filter((f) => f.endsWith('.svg'));
  check(
    `src/assets/icons/*.svg ≤ 8 (functional icon cap; spec §4.7) — found ${svgFiles.length}`,
    svgFiles.length <= 8,
  );
} else {
  check('src/assets/icons/ directory exists (T6)', false);
}

if (failures > 0) {
  console.error(`\nverify-build FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nverify-build OK');
```

- [ ] **Step 2: Run verify against current dist (will likely fail until home page lands in T28 — expected)**

```bash
npm run build && npm run verify
```

If the verifier fails because the home page is still maintenance content, that's expected — T17 plants the new gate; T28 is the swap that makes it pass. Document expected current failures in commit body.

- [ ] **Step 3: Codex review**

Prompt: "Review scripts/verify-build.mjs Phase 1.A rewrite. Verify: noindex absence check is correctly negated, sitemap-index.xml (not sitemap.xml) matches @astrojs/sitemap output, JSON-LD detection handles both raw and HTML-entity-encoded JSON, brand-token assertions match the tokens added in T4, TAY @font-face check tolerates either font-family name or src URL pattern (build-time CSS minification might mangle one but not the other), AND **icon-cap check (Codex r2 AMBER #6 fold)**: `src/assets/icons/*.svg ≤ 8` assertion runs against the source dir (not dist); fails-closed when directory missing; counts only `.svg` files (no other extensions); failure message includes the actual count for debugging."

Fold findings.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-build.mjs
git commit -m "feat(1.A): verify-build.mjs Phase 1.A invariants (no noindex, sitemap, brand tokens, TAY, icon-cap ≤8 per Codex r2 AMBER #6) [logically-inspected] [codex-reviewed: r1 GO + r2 GO]"
```

> **Note:** Subsequent task commits in Phase 1.A may temporarily fail `npm run verify` until T28 lands. That is acceptable on `feat/ims-phase-1-plan` branch; the verifier MUST pass before merging to `main`.

---

## Phase 1.A — Marketing Page Tasks

> **Pattern:** Each marketing page extends `MarketingLayout`. Sections inside the cream card render flush (no internal radius / margin). Section-level animations use `<ScrollReveal>`. Copy from spec verbatim or per brief §22-§24 (verbatim copy in the predecessor brainstorm-paused memo). After each page, run `npm run dev` and visually verify in browser; commit only when render is clean.

### T18: Create `SiteNav.astro` (sticky after 80vh scroll)

**Files:** `src/components/nav/SiteNav.astro`

**Codex review:** MANDATORY (load-bearing UI on every page)

- [ ] **Step 1: Create the component**

```astro
---
import LogoDefault from '../brand/LogoDefault.astro';
import LogoOnDark from '../brand/LogoOnDark.astro';

interface Props {
  /** When true, nav uses dark variant (used over §2.5/§2.10 dark sections) */
  inverse?: boolean;
}
const { inverse = false } = Astro.props;

const links = [
  { href: '/clinicians', label: 'For Clinicians' },
  { href: '/facilities', label: 'For Facilities' },
  { href: '/specialties', label: 'Specialties' },
  { href: '/jobs', label: 'Open Roles' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];
---
<nav class:list={['site-nav', { inverse }]} aria-label="Main">
  <a href="/" class="brand">
    {inverse ? <LogoOnDark height={28} /> : <LogoDefault height={28} />}
  </a>
  <ul class="links">
    {links.map((l) => (
      <li><a href={l.href}>{l.label}</a></li>
    ))}
  </ul>
</nav>

<style>
  .site-nav {
    position: sticky;
    top: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px clamp(20px, 4vw, 64px);
    background: var(--surface-card);
    color: var(--ink-on-cream);
    font-family: var(--font-body);
    transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 240ms;
  }
  .site-nav.inverse {
    background: var(--surface-page);
    color: var(--ink-on-dark);
  }
  .site-nav .brand {
    display: inline-flex;
    align-items: center;
  }
  .site-nav .links {
    display: flex;
    gap: 28px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .site-nav .links a {
    color: inherit;
    text-decoration: none;
    font-size: 15px;
    transition: opacity 180ms ease-out;
  }
  .site-nav .links a:hover { opacity: 0.7; }
  /* Sticky-after-80vh per spec §1: slide nav out for first 80vh, slide in after */
  .site-nav.is-hidden {
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
  }
  @media (max-width: 768px) {
    .site-nav .links { display: none; }
    /* Phase 1.5: add hamburger menu */
  }
</style>

<script>
  const nav = document.querySelector('.site-nav') as HTMLElement | null;
  if (nav) {
    let lastScroll = 0;
    const onScroll = () => {
      const y = window.scrollY;
      const threshold = window.innerHeight * 0.8;
      if (y < threshold) {
        nav.classList.add('is-hidden');
      } else {
        nav.classList.remove('is-hidden');
      }
      lastScroll = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }
</script>
```

- [ ] **Step 2: Codex review**

Prompt: "Review src/components/nav/SiteNav.astro for: sticky-after-80vh behavior matches spec §1, mobile fallback safety (links hidden but no replacement at v1 — Phase 1.5 adds hamburger), inverse variant for dark sections, scroll-listener leak risk (no removal on unmount; acceptable for SPA-less Astro), accessibility (nav landmark, aria-label, link semantics)."

- [ ] **Step 3: Commit**

```bash
git add src/components/nav/SiteNav.astro
git commit -m "feat(1.A): SiteNav with sticky-after-80vh behavior [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T19: Create `SiteFooter.astro` (3-col with FOLLOW conditional drop)

**Files:** `src/components/footer/SiteFooter.astro`

**Codex review:** MANDATORY (every page renders this)

- [ ] **Step 1: Create the component**

```astro
---
const LINKEDIN_URL = ''; // Zach action: spec §10 item 6. Empty = drop FOLLOW column.
const showFollow = LINKEDIN_URL.length > 0;
const year = new Date().getFullYear();
---
<footer class="site-footer">
  <div class="cols">
    <div class="col">
      <h3>EXPLORE</h3>
      <ul>
        <li><a href="/clinicians">For Clinicians</a></li>
        <li><a href="/facilities">For Facilities</a></li>
        <li><a href="/about">About</a></li>
        <li><a href="/how-it-works">How It Works</a></li>
        <li><a href="/jobs">Open Opportunities</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </div>
    {showFollow && (
      <div class="col">
        <h3>FOLLOW</h3>
        <ul>
          <li><a href={LINKEDIN_URL} rel="noopener" target="_blank">LinkedIn</a></li>
        </ul>
      </div>
    )}
    <div class="col">
      <h3>CONTACT</h3>
      <ul>
        <li><a href="mailto:recruiting@iastaffing.com">recruiting@iastaffing.com</a></li>
        <li><a href="tel:+15125246686">512-524-6686</a></li>
      </ul>
    </div>
  </div>
  <div class="bottom">
    <span>© {year} INNOVATIVE MEDICAL STAFFING</span>
    <span class="legal-links">
      <a href="/privacy">PRIVACY POLICY</a>
      <a href="/cookies">COOKIES</a>
      <a href="/terms">TERMS &amp; CONDITIONS</a>
    </span>
  </div>
</footer>

<style>
  .site-footer {
    background: var(--surface-page);
    color: var(--ink-on-dark);
    padding: 80px clamp(20px, 4vw, 64px) 32px;
    font-family: var(--font-body);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 48px;
    margin-bottom: 48px;
  }
  .cols:has(.col:nth-child(2):last-child) {
    grid-template-columns: repeat(2, 1fr); /* drop to 2-col when FOLLOW is hidden */
  }
  .col h3 {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 400;
    letter-spacing: 0.10em;
    margin: 0 0 16px;
    text-transform: uppercase;
  }
  .col ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .col a {
    color: inherit;
    text-decoration: none;
    font-size: 15px;
    transition: opacity 180ms ease-out;
  }
  .col a:hover { opacity: 0.7; }
  .bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid rgba(242, 232, 220, 0.12);
    padding-top: 24px;
    font-family: var(--font-display);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .legal-links { display: flex; gap: 24px; }
  .legal-links a { color: inherit; text-decoration: none; }
  @media (max-width: 768px) {
    .cols { grid-template-columns: 1fr; gap: 32px; }
    .bottom { flex-direction: column; gap: 16px; align-items: flex-start; }
  }
</style>
```

- [ ] **Step 2: Codex review**

Prompt: "Review src/components/footer/SiteFooter.astro for: FOLLOW column conditional drop behavior with empty LINKEDIN_URL constant, the `:has()` CSS selector fallback for browsers without :has() support (currently 92% global per caniuse), accessibility (footer landmark, h3 hierarchy, anchor labels), tel: + mailto: link correctness, and that LinkedIn URL is treated as Zach action item not a placeholder text the lint should catch."

The `:has()` fallback — if Codex flags lack of fallback for older browsers, add a JS-side conditional class (`.is-2col`) computed at render and use that as the grid-columns selector.

- [ ] **Step 3: Commit**

```bash
git add src/components/footer/SiteFooter.astro
git commit -m "feat(1.A): SiteFooter 3-col with FOLLOW conditional drop per spec §6 [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T20: Build homepage (10 sections per spec §2)

**Files:**
- Create: `src/components/sections/HomeHero.astro`
- Create: `src/components/sections/HomePositioningStrip.astro`
- Create: `src/components/sections/HomePhilosophy.astro`
- Create: `src/components/sections/HomeAudienceSplit.astro`
- Create: `src/components/sections/HomeConcierge.astro`
- Create: `src/components/sections/HomeHumanLedTech.astro`
- Create: `src/components/sections/HomeSpecialties.astro`
- Create: `src/components/sections/HomeProcess.astro`
- Create: `src/components/sections/HomeValues.astro`
- Create: `src/components/sections/HomeFinalCta.astro`

**Codex review:** MANDATORY (per Codex matrix line 53 + Codex r2 AMBER #9 fold). Components ship real ScrollReveal logic (T20a, T20j), tab-toggle JS (T20h), prop-driven count rendering (T20g), and full-bleed dark-band layouts that interact with MarketingLayout slot pattern (T20e, T20j). Use **batch review at end of T20 group** — one `codex task` invocation reviewing all 10 components together (~500-800 LOC) before T28 wire-up.

> **Step 1-10 below each cover one section. Each is its own component file. Per-section copy comes from spec §2.1–§2.10 verbatim where the spec quotes copy, otherwise from brand brief §22-§24 (in predecessor brainstorm memo). Each component commits separately as `[codex-pending: T20-batch]` — the batch review (T20-batch step at the end) folds across all 10 commits.**

- [ ] **T20a — Hero (§2.1)**: Build `HomeHero.astro` per spec §2.1. Eyebrow `INNOVATIVE MEDICAL STAFFING` (TAY Basal 14px uppercase, `--brand-gold-muted`). Headline `clamp(56px, 9vw, 96px)` "Medical staffing, handled with care." Body 19px TAY Amaya — paragraph 1 from brief §16. Dual CTA: primary `Find Opportunities` → `/jobs` (filled `--brand-navy` bg, cream text, 999px radius); secondary `Request Coverage` → `/contact?intent=coverage` (outline 1.5px navy border, navy text, 999px radius). Right-side ~40% reserved for hand-drawn illustrated character — at v1 use placeholder from `public/illustrations/hero-placeholder.svg` (sourced from Streamline Free or undraw.co with palette-recolor; commit step includes the asset). 600ms fade + 8px rise on first paint via `<ScrollReveal delay={0}>`. Commit: `feat(1.A): HomeHero per spec §2.1 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20b — Positioning strip (§2.2)**: Build `HomePositioningStrip.astro`. Hairline divider top + bottom. 4 columns, TAY Basal 13px uppercase letter-spacing 0.08em: `Locum Tenens Coverage` · `Multi-Specialty Staffing` · `Clinician Support` · `Facility Partnerships`. Charcoal-on-cream. No icons. Commit: `feat(1.A): HomePositioningStrip per spec §2.2 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20c — Philosophy (§2.3)**: Build `HomePhilosophy.astro`. Single column, padding `clamp(96px, 14vh, 200px)` top/bottom. Pull-quote TAY Basal 40-56px: *"Staffing is more than filling a schedule. It is trust, timing, communication, and fit."* Em-dash signature `— The IMS Team` in `--ink-on-cream-2`. Commit: `feat(1.A): HomePhilosophy per spec §2.3 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20d — Audience split (§2.4)**: Build `HomeAudienceSplit.astro`. Two equal cards inside cream surface with hand-drawn divider between (vertical SVG line + small ornament). Card 1 For Clinicians: eyebrow `FOR CLINICIANS`, TAY Basal 32px headline *"Opportunities with a team behind you."*, TAY Amaya 17px tease, CTA `Explore Clinician Path →` to `/clinicians`. Card 2 For Facilities: same shape with §2.4 copy. Cards use 1px hairline border, no shadow, padding `clamp(32px, 4vw, 64px)`. Commit: `feat(1.A): HomeAudienceSplit per spec §2.4 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20e — Concierge support DARK INVERSE (§2.5)**: Build `HomeConcierge.astro`. **CRITICAL: this section renders OUTSIDE the cream card** — it is a sibling to the card, full-bleed `--surface-page` band. Use MarketingLayout's `inCard={false}` slot pattern OR render as a `<section class="full-bleed">` after the card closes. Three-column grid; headlines TAY Basal 28px, body TAY Amaya 17px. Section closer centered italic. After §2.5, the homepage opens a NEW cream card for §2.6-§2.9 (per spec §1 page-level rules). Commit: `feat(1.A): HomeConcierge dark inverse band per spec §2.5 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20f — Human-led tech (§2.6)**: Build `HomeHumanLedTech.astro`. Two-half panel (cream | warm taupe `--surface-warm`). Left TAY Basal 40px *"Technology where it helps."* — right *"People where it matters."* Single body paragraph TAY Amaya 17px below split running full width with brief §10 say-this column copy. Single thin horizontal hand-drawn rule below. NO AI mesh / neural-net / data-stream visuals. Commit: `feat(1.A): HomeHumanLedTech per spec §2.6 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20g — Specialties 12-card grid (§2.7)**: Build `HomeSpecialties.astro`. 4×3 grid. Each card: TAY Basal 24px specialty name; one-line TAY Amaya 15px framing; live count `N open opportunities` (Path B = build-time count from Content Collection, Path A = runtime KV read — at v1 the component takes a `counts: Record<string, number>` prop and the page provides). Hover: card border darkens to navy + count gets navy underline. Each card links to `/jobs?specialty={slug}`. Sub-CTA below grid centered: `View all specialties →` → `/specialties`. The 12 specialties default to spec §1 list; until Zach confirms top-12 (spec §10 item 4), use the spec defaults. Commit: `feat(1.A): HomeSpecialties 12-card per spec §2.7 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20h — Process 4-step (§2.8)**: Build `HomeProcess.astro`. Numbered `01`→`04`, hand-drawn connecting rules between steps. Tabbed by audience (Clinicians: Submit CV → Onboarding → Schedule → Start; Facilities: Request → Match → Coordinate → Support). Tab toggle = pill, default Clinicians. ≤14 words body per step. TAY Basal 56px step numbers, TAY Basal 22px headlines. Tab switching = vanilla JS `document.querySelectorAll('[data-tab]')` listeners. Commit: `feat(1.A): HomeProcess 4-step tabbed per spec §2.8 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20i — Values 6-tile grid (§2.9)**: Build `HomeValues.astro`. 6 tiles 3×2. Per tile: TAY Basal 22px name (Patient-First / Human-Led / Quality-Obsessed / Built on Trust / Detail-Minded / Calm Under Pressure); TAY Amaya 15px definition from brief §6; restrained `--brand-gold` underline 24px wide × 2px thick beneath each name (the only "decoration"). Commit: `feat(1.A): HomeValues 6-tile per spec §2.9 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20j — Final CTA (§2.10)**: Build `HomeFinalCta.astro`. Full-bleed dark exterior section (NOT cream, sibling to card). TAY Basal 56-72px headline cream-on-dark *"Ready for a more thoughtful staffing experience?"* Single CTA pill in `--brand-blue-deep` (`#3898EC`, NOT `--brand-blue` — the deep variant is the on-dark CTA per spec §2.10): `Get in Touch` → `/contact`. Hand-drawn character to right + decorative leaf in lower-left. Commit: `feat(1.A): HomeFinalCta dark band per spec §2.10 [logically-inspected] [codex-pending: T20-batch]`

- [ ] **T20-batch — Codex batch review of all 10 home sections** (Codex r2 AMBER #9 fold)

After T20a-T20j all committed, run a single Codex review over the 10 component files together. Prompt: "Batch-review src/components/sections/Home*.astro (10 files). Verify across components: (1) consistent ScrollReveal usage — none missing reveal where spec §0.5.7 / §2.1 implies first-paint motion; (2) tab-toggle JS in HomeProcess uses ARIA-correct attributes (role='tablist', role='tab', aria-selected, aria-controls); (3) HomeSpecialties prop signature `counts: Record<string, number>` matches T28 page-level invocation expectations + handles missing slugs gracefully (defaults to 0); (4) HomeConcierge + HomeFinalCta full-bleed pattern is consistent (both close+reopen cream card or both render as siblings to card); (5) brand-blue-deep usage in HomeFinalCta vs brand-blue elsewhere — flag if any cross-contamination; (6) no inline styles bypassing tokens; (7) no AI/mesh/neural-net visuals (brief §3 banned imagery); (8) lang-attr-aware copy (no smart-quotes that fail Plausible event-name encoding); (9) any wrapping `<section>` lacks `id` for in-page anchor / Plausible event source; (10) responsive sizing actually uses `clamp()` not media queries for type-scale per spec §4.3."

Fold findings as a single follow-up commit:
```bash
git commit -m "fix(1.A): T20-batch Codex findings across HomeHero/Audience/Process/Specialties/etc [logically-inspected] [codex-reviewed: r1 GO]"
```

If no findings: skip the follow-up commit; just edit the prior 10 commit messages' `[codex-pending: T20-batch]` is replaced with `[codex-reviewed: r1 GO]` via `git rebase` only if no commits have been pushed yet — otherwise leave as-is and append a note in the T20-batch step's commit body documenting the GO verdict.

> All T20a-T20j commits are independent — each section is a self-contained component. Wire into `index.astro` in T28.

---

### T21: Build `/clinicians` page

**Files:** `src/pages/clinicians.astro`

**Codex review:** `[codex-skip: page copy]`

- [ ] **Step 1: Build the page using MarketingLayout**

Wrap content in `MarketingLayout`. Sections (each may be inlined for now — can promote to components if reused):

1. Hero — eyebrow `FOR CLINICIANS`, TAY Basal headline *"Opportunities with a team behind you."*, TAY Amaya body adapted from brief §16 paragraph 2.
2. Why IMS — 3 bullets per brief §11 say-this column ("personal, responsive, and technology-enabled").
3. Specialties strip — links to `/specialties` and `/jobs?specialty=...`.
4. Process — links to `/how-it-works` (clinicians tab pre-selected: `?audience=clinicians`).
5. Final CTA → `/jobs`.

Use `<ScrollReveal>` per section. Inverse-section pattern reserved for homepage; this page stays in-card.

- [ ] **Step 2: Browser smoke**

```bash
npm run dev
# open http://localhost:4321/clinicians, verify all sections render
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/clinicians.astro
git commit -m "feat(1.A): /clinicians page per spec §1 [logically-inspected] [codex-skip: page copy]"
```

---

### T22: Build `/facilities` page

**Files:** `src/pages/facilities.astro`

**Codex review:** `[codex-skip: page copy]`

- [ ] **Step 1:** Mirror T21 structure, swap clinicians voice for facilities voice. Hero: *"Coverage support you can trust."* Body adapted from brief §16 facilities paragraph. CTAs: primary → `/contact?intent=coverage`; secondary → `/about`.
- [ ] **Step 2:** Browser smoke.
- [ ] **Step 3:** Commit.

```bash
git commit -m "feat(1.A): /facilities page per spec §1 [logically-inspected] [codex-skip: page copy]"
```

---

### T23: Build `/specialties` page (12 editorial cards)

**Files:** `src/pages/specialties.astro`

**Codex review:** `[codex-skip: page copy]`

- [ ] **Step 1: Build the page**

Use MarketingLayout. Page hero (TAY Basal 56px headline *"What we cover."*) + subhead from brief §3. 12 editorial cards (4×3 desktop, 2×6 tablet, 1×12 mobile). Each card:
- TAY Basal 28px specialty name
- TAY Amaya 17px 2-line description (from spec §2.7 examples, expanded; placeholder for now if exact content not in spec — note in commit which copy is placeholder vs final).
- Card link → `/jobs?specialty={slug}`
- NO `[slug]` page links yet — spec §1 says `[slug]` is Phase 1.75. Cards link to filtered `/jobs` only.

Top-12 list (per spec §1 + §10 item 4 default):
Anesthesiology · CRNA · Hospitalist · Emergency Medicine · Family Medicine · Psychiatry · OB/GYN · General Surgery · Radiology · Pediatrics · Cardiology · Neurology

- [ ] **Step 2: Browser smoke + commit**

```bash
git commit -m "feat(1.A): /specialties 12-card editorial page per spec §1 (1.75 adds [slug] pages) [logically-inspected] [codex-skip]"
```

---

### T24: Build `/about` page (with leadership placeholder cards)

**Files:** `src/pages/about.astro` + `public/illustrations/leadership-placeholder.svg`

**Codex review:** `[codex-skip: page copy + asset]`

- [ ] **Step 1: Build the page**

Page hero (TAY Basal 64px) *"Built around trust."* with subhead from brief §3 mission. Story section (3-paragraph editorial), Leadership section (3-4 cards depending on info from Zach — at v1 use cream silhouette placeholder + role only; spec §10 item 2 is the Zach action). Philosophy section + Values quick-grid linking to homepage values for full text.

Leadership card structure (placeholder mode):
```html
<article class="leader">
  <div class="silhouette" aria-hidden="true"><!-- cream-on-cream SVG silhouette --></div>
  <h3>—</h3>
  <p class="role">Founder &amp; CEO</p>
  <p class="hint">Photo coming soon</p>
</article>
```

The placeholder silhouette SVG: simple line-art profile shape in `--ink-on-cream-3` strokes on `--surface-card-2` fill (cream-on-cream). Save as `public/illustrations/leadership-placeholder.svg`.

- [ ] **Step 2: Browser smoke + commit**

```bash
git add src/pages/about.astro public/illustrations/leadership-placeholder.svg
git commit -m "feat(1.A): /about with leadership placeholder cards (Zach action: spec §10 item 2 — real headshots before launch) [logically-inspected] [codex-skip]"
```

---

### T25: Build `/how-it-works` page (4-step tabbed)

**Files:** `src/pages/how-it-works.astro`

**Codex review:** MANDATORY (per Codex matrix line 53 — tab JS island with URL-param sync ships real client-side state. Codex r2 AMBER #9 fold extends this consistency check beyond the original r1 finding 8 list.)

- [ ] **Step 1: Build the page**

Hero + 4-step process (more detailed than homepage §2.8 — each step gets its own subsection: ~80 words per step, what-to-expect, time estimate). Tabbed by audience with URL-param sync (`/how-it-works?audience=clinicians|facilities`). Default = `clinicians`.

Tab switch JS:
```js
const tabs = document.querySelectorAll<HTMLElement>('[data-tab]');
const panels = document.querySelectorAll<HTMLElement>('[data-panel]');
function setTab(audience) {
  tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === audience));
  panels.forEach(p => p.classList.toggle('is-active', p.dataset.panel === audience));
  const url = new URL(window.location.href);
  url.searchParams.set('audience', audience);
  history.replaceState({}, '', url.toString());
}
const initial = new URL(window.location.href).searchParams.get('audience') || 'clinicians';
setTab(initial);
tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
```

- [ ] **Step 2: Codex review** — Prompt: "Review src/pages/how-it-works.astro tab-toggle JS. Verify: (1) ARIA roles wired (role='tablist', role='tab', aria-selected, aria-controls on each tab, aria-labelledby on each panel); (2) keyboard navigation works (arrow keys move focus between tabs per WAI-ARIA pattern) — flag if missing as a11y gap; (3) URL-param sync uses `history.replaceState` (not pushState — back-button shouldn't trip on tab clicks); (4) initial-load default `clinicians` matches the audience matrix; (5) `audience` query param sanitized — only `clinicians`/`facilities` accepted, anything else falls back to default; (6) panels' `display: none` is class-based (.is-active toggle), not inline-style mutation."

- [ ] **Step 3: Browser smoke + commit**

```bash
git commit -m "feat(1.A): /how-it-works tabbed 4-step per spec §1 [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T26: Build `/contact` page (NO map per spec §6 disposition)

**Files:** `src/pages/contact.astro`

**Codex review:** `[codex-skip: page copy + uses ContactForm component built in T49]`

> **Note:** This task SKELETON-builds the page; the actual form rendering depends on T49 (ContactForm component). The page can be committed with a `<!-- T49 wires ContactForm here -->` comment and updated when T49 lands. Alternatively, defer this task until after T49.

- [ ] **Step 1: Build the page skeleton**

Hero (TAY Basal 56px) *"Tell us what you're looking for."* with intent-specific subhead based on `?intent=coverage` query param (vanilla JS reads URL on load). Below: 2-column layout — left `<ContactForm />` (component rendered conditionally based on `intent` query — `coverage` pre-fills intent dropdown to "Coverage" else "General"); right contact card with email + phone (plain text). NO map embed (spec §6 disposition).

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(1.A): /contact page (NO map per spec §6) — wires ContactForm from T49 [logically-inspected] [codex-skip]"
```

---

### T27: Build `/privacy` + `/cookies` + `/terms` pages

**Files:**
- Create: `src/pages/privacy.astro`
- Create: `src/pages/cookies.astro`
- Create: `src/pages/terms.astro`

**Codex review:** `[codex-skip: legal boilerplate awaiting Zach review per spec §10 item 5]`

- [ ] **Step 1: Build `/privacy`**

MarketingLayout. Headings: What we collect / How we use it / Storage location / Retention (apply 18mo, contact 12mo) / Deletion request flow (mailto `recruiting@iastaffing.com` with subject `Data deletion request`) / Sub-processors (Plausible Cloud, Resend, Supabase — all DPA-signed) / US state-law accommodations (CA/CO/CT/UT/VA) / GDPR section if any EU traffic (paragraph). Stamp at bottom: "Last updated 2026-05-{day}". The Zach legal-review gate is tracked separately by SG15 (Pre-Launch Checklist) and surfaced again in T63 walkthrough — no inline placeholder comments needed in the .astro file (Codex r1 NIT #10 fold).

- [ ] **Step 2: Build `/cookies`**

MarketingLayout. Per spec §0.5.8: explains we use Plausible Cloud (no tracking cookies, no banner needed), lists `__cf_bm` (Cloudflare bot-management functional cookie, exempt from EU consent under PECR). No cookie consent banner. Link to `/privacy` for fuller PII handling.

- [ ] **Step 3: Build `/terms`**

MarketingLayout. Healthcare-staffing template adapted boilerplate: services description, no-fee-to-clinicians clause, recruiter-relationship language, dispute resolution (Texas governing law for IMS), severability, modification clause. Heavily marked as draft pending Zach legal review (spec §10 item 5).

- [ ] **Step 4: Commit**

```bash
git add src/pages/privacy.astro src/pages/cookies.astro src/pages/terms.astro
git commit -m "feat(1.A): /privacy + /cookies + /terms (pending Zach review per spec §10 item 5) [logically-inspected] [codex-skip: legal boilerplate]"
```

---

### T28: Replace Phase-0 maintenance `index.astro` with marketing home

**Files:** `src/pages/index.astro`, `src/layouts/BaseLayout.astro` (default `noindex` flip)

**Codex review:** MANDATORY (the home-page swap is the launch moment for indexability)

- [ ] **Step 1: Replace `src/pages/index.astro` content**

Replace the entire current Phase-0 maintenance content with:

```astro
---
import MarketingLayout from '../layouts/MarketingLayout.astro';
import SiteNav from '../components/nav/SiteNav.astro';
import SiteFooter from '../components/footer/SiteFooter.astro';
import HomeHero from '../components/sections/HomeHero.astro';
import HomePositioningStrip from '../components/sections/HomePositioningStrip.astro';
import HomePhilosophy from '../components/sections/HomePhilosophy.astro';
import HomeAudienceSplit from '../components/sections/HomeAudienceSplit.astro';
import HomeConcierge from '../components/sections/HomeConcierge.astro';
import HomeHumanLedTech from '../components/sections/HomeHumanLedTech.astro';
import HomeSpecialties from '../components/sections/HomeSpecialties.astro';
import HomeProcess from '../components/sections/HomeProcess.astro';
import HomeValues from '../components/sections/HomeValues.astro';
import HomeFinalCta from '../components/sections/HomeFinalCta.astro';

// Path B (default): build-time count from Content Collection
import { getCollection } from 'astro:content';
const jobs = await getCollection('jobs');
const counts: Record<string, number> = {};
for (const j of jobs) {
  const s = j.data.specialty;
  counts[s] = (counts[s] ?? 0) + 1;
}
---
<MarketingLayout
  title="Innovative Medical Staffing — Healthcare staffing, handled with care"
  description="A more personal, responsive, and technology-enabled medical staffing experience."
  noindex={false}
  inCard={false}
>
  <SiteNav slot="nav" />

  <section class="card-wrap-1">
    <HomeHero />
    <HomePositioningStrip />
    <HomePhilosophy />
    <HomeAudienceSplit />
  </section>

  <HomeConcierge />  <!-- DARK INVERSE band, OUTSIDE card -->

  <section class="card-wrap-2">
    <HomeHumanLedTech />
    <HomeSpecialties counts={counts} />
    <HomeProcess />
    <HomeValues />
  </section>

  <HomeFinalCta />  <!-- DARK band, OUTSIDE card -->

  <SiteFooter slot="footer" />
</MarketingLayout>

<style>
  .card-wrap-1, .card-wrap-2 {
    background: var(--surface-card);
    border-radius: var(--r-card);
    margin: clamp(20px, 4vw, 64px);
    overflow: hidden;
  }
</style>
```

- [ ] **Step 2: Update `BaseLayout.astro` default `noindex` to `false`**

In `src/layouts/BaseLayout.astro` line 13, change:
```ts
noindex = true,
```
to:
```ts
noindex = false,
```

(BaseLayout may still be used by some non-marketing route — keep the layout file but flip the default. Marketing pages use MarketingLayout exclusively.)

- [ ] **Step 3: Build + verify**

```bash
npm run build && npm run verify
```

Expected: `verify-build OK` — all Phase 1.A invariants now hold (no `noindex` meta, sitemap exists, brand tokens present, TAY @font-face present, robots allows). voice-lint runs to completion.

- [ ] **Step 4: Codex review**

Prompt: "Review src/pages/index.astro home-page swap. Verify: section ordering matches spec §2 (hero → positioning → philosophy → audience split → concierge dark → human-led tech → specialties → process → values → final-cta dark), DARK sections (§2.5 + §2.10) render OUTSIDE the cream card, MarketingLayout `inCard={false}` is the right pattern (since the page itself manages the card-wrap markup so the dark sections can break out), Path B counts read from Content Collection at build time, BaseLayout default flip from noindex=true to noindex=false doesn't accidentally re-index any non-public route (grep for BaseLayout import to enumerate)."

Fold findings.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro src/layouts/BaseLayout.astro
git commit -m "feat(1.A): home page swap — Phase-0 maintenance → marketing per spec §2 [runtime-verified: verify-build OK] [codex-reviewed: r1 GO]"
```

---

### T29: Run dev server + browser smoke through all marketing pages

**Files:** none (verification task)

**Codex review:** N/A

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Browser-walk all routes**

Visit each route at `http://localhost:4321{path}`:
- `/`
- `/clinicians`
- `/facilities`
- `/specialties`
- `/about`
- `/how-it-works` and `/how-it-works?audience=facilities`
- `/contact` and `/contact?intent=coverage`
- `/privacy`
- `/cookies`
- `/terms`

For each, verify:
- Page renders without console error
- Nav present + sticky-after-80vh works
- Footer present + columns correct
- TAY fonts loaded (DevTools Network → `TAY*.woff2` → 200)
- Hover states work
- Scroll-reveal animations fire (or are disabled with `prefers-reduced-motion`)
- Mobile breakpoint (`@media max-width: 768px`) doesn't break layout — resize browser

- [ ] **Step 3: If issues found, fix them, then re-smoke**

Loop step 2 until clean.

- [ ] **Step 4: Tag preview deploy**

Push `feat/ims-phase-1-plan` to remote and confirm Cloudflare Pages preview deploys clean. Visit preview URL; repeat the route walk.

(No commit unless fixes were applied.)

---



## Phase 1.A — Job Board (Path B Default)

### T30: Create `src/content/config.ts` Zod schemas

**Files:** `src/content/config.ts`

**Codex review:** MANDATORY (schema is the contract for all `/jobs` reads)

- [ ] **Step 1: Create the config**

```ts
import { defineCollection, z } from 'astro:content';

const SPECIALTIES = [
  'anesthesiology',
  'crna',
  'hospitalist',
  'emergency-medicine',
  'family-medicine',
  'psychiatry',
  'ob-gyn',
  'general-surgery',
  'radiology',
  'pediatrics',
  'cardiology',
  'neurology',
  'other',
] as const;

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
] as const;

const jobs = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().min(3).max(120),
    specialty: z.enum(SPECIALTIES),
    state: z.enum(US_STATES),
    city: z.string().min(1).max(80),
    facilityType: z.string().min(1).max(80),
    callType: z.string().optional(),
    schedule: z.string().optional(),
    lengthCategory: z.enum(['short', 'medium', 'long']),
    rateLow: z.number().int().positive().nullable().optional(),
    rateHigh: z.number().int().positive().nullable().optional(),
    emr: z.string().optional(),
    publishedAt: z.coerce.date(),
    expiresAt: z.coerce.date().optional(),
  }).refine(
    (j) => !(j.rateLow != null && j.rateHigh != null && j.rateLow > j.rateHigh),
    { message: 'rateLow cannot exceed rateHigh' },
  ),
});

const specialties = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.enum(SPECIALTIES),
    summary: z.string().max(300),
    publishedAt: z.coerce.date(),
  }),
});

export const collections = { jobs, specialties };
```

- [ ] **Step 2: Codex review** — Prompt: "Review src/content/config.ts. Verify SPECIALTIES allowlist matches spec §1 top-12 + 'other'; US_STATES matches USPS 2-letter incl DC; lengthCategory enum maps to spec §3.1 filter rail; rateLow ≤ rateHigh refine matches spec §3.4; publishedAt vs expiresAt nullable behavior matches Path B (recruiter omits expiresAt for evergreen)."

- [ ] **Step 3: Commit**

```bash
git add src/content/config.ts
git commit -m "feat(1.A): jobs + specialties Content Collection Zod schemas [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T31: Seed `src/content/jobs/` (template + 10 example listings)

**Files:** `src/content/jobs/_template.md` + `src/content/jobs/example-{01..10}.md`

**Codex review:** `[codex-skip: content seeds — recruiter team replaces with real before launch]`

- [ ] **Step 1: Create `_template.md`**

```markdown
---
title: "Anesthesiology · 200-bed Acute-Care Hospital · Austin, TX"
specialty: anesthesiology
state: TX
city: Austin
facilityType: "200-bed acute-care hospital"
callType: "Mixed (1 in 4)"
schedule: "Mon-Fri, 7a-5p with weekend rotation"
lengthCategory: medium
rateLow: 230
rateHigh: 280
emr: "Epic"
publishedAt: 2026-05-06
expiresAt: 2026-08-06
---

Plain-language description from recruiter perspective. 2-3 sentences. Mention support team availability, geographic context, any quirks the clinician should know up front.
```

- [ ] **Step 2: Create 10 example seeds** covering ≥6 specialties, ≥4 states. Title prefix `[PLACEHOLDER]` so they're obviously mock until recruiter team replaces.

- [ ] **Step 3: Build + verify**

```bash
npm run build
```
Astro reports 11 collection entries (1 template excluded by `_` prefix + 10 examples). Schema-validation failures get fixed inline.

- [ ] **Step 4: Commit**

```bash
git add src/content/jobs/
git commit -m "feat(1.A): seed jobs Content Collection (template + 10 PLACEHOLDER listings — recruiter replaces before launch) [logically-inspected] [codex-skip: content seeds]"
```

---

### T32: Build `src/pages/jobs/index.astro` (Path B SSG)

**Files:** `src/pages/jobs/index.astro`

**Codex review:** MANDATORY (load-bearing route — drives the entire jobs UX in Path B)

- [ ] **Step 1: Build the page**

```astro
---
import MarketingLayout from '../../layouts/MarketingLayout.astro';
import SiteNav from '../../components/nav/SiteNav.astro';
import SiteFooter from '../../components/footer/SiteFooter.astro';
import ApplyModal from '../../components/forms/ApplyModal.astro';
import { getCollection } from 'astro:content';

const all = await getCollection('jobs');
const now = new Date();
const active = all
  .filter((j) => !j.data.expiresAt || j.data.expiresAt > now)
  .sort((a, b) => +b.data.publishedAt - +a.data.publishedAt);

const specialtiesPresent = [...new Set(active.map((j) => j.data.specialty))].sort();
const statesPresent = [...new Set(active.map((j) => j.data.state))].sort();
const totalCount = active.length;
---
<MarketingLayout
  title={`Open Roles · Innovative Medical Staffing`}
  description={`${totalCount} open opportunities across the IMS network.`}
  noindex={false}
  inCard={false}
>
  <SiteNav slot="nav" />
  <div class="card-wrap">
    <header class="page-hero">
      <h1>Open opportunities</h1>
      <p>{totalCount} active roles. Filter by specialty, state, or length.</p>
    </header>

    <div class="layout">
      <aside class="filter-rail" aria-label="Filters">
        <section>
          <h2>Specialty</h2>
          <ul role="group">
            {specialtiesPresent.map((s) => (
              <li>
                <label>
                  <input type="checkbox" name="specialty" value={s} />
                  <span>{s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>State</h2>
          <ul role="group">
            {statesPresent.map((st) => (
              <li><label><input type="checkbox" name="state" value={st} /> <span>{st}</span></label></li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Length</h2>
          <ul role="group">
            <li><label><input type="checkbox" name="length" value="short" /> &lt; 4 weeks</label></li>
            <li><label><input type="checkbox" name="length" value="medium" /> 4–12 weeks</label></li>
            <li><label><input type="checkbox" name="length" value="long" /> 12+ weeks</label></li>
          </ul>
        </section>
        <button type="button" class="reset" id="filter-reset">Reset filters</button>
      </aside>

      <section class="results" id="results-grid">
        {active.map((j) => (
          <article
            class="job-card"
            data-job-ref={j.slug}
            data-job-title={j.data.title}
            data-specialty={j.data.specialty}
            data-state={j.data.state}
            data-length={j.data.lengthCategory}
          >
            <div class="eyebrow">
              <span class="specialty">{j.data.specialty.replace(/-/g, ' ')}</span>
              <span class="length">{j.data.lengthCategory}</span>
            </div>
            <h3>{j.data.facilityType} · {j.data.city}, {j.data.state}</h3>
            <p>{[j.data.callType, j.data.schedule].filter(Boolean).join(' · ')}</p>
            {j.data.rateLow != null && j.data.rateHigh != null
              ? <p class="rate"><strong>${j.data.rateLow} – ${j.data.rateHigh} / hr</strong></p>
              : <p class="rate"><em>Rate on request</em></p>}
            <button class="apply-trigger" type="button">Apply through IMS →</button>
          </article>
        ))}
      </section>
    </div>

    <div id="empty-state" hidden>
      <p>No openings match those filters. Tell us what you're looking for and we'll reach out when one opens.</p>
      <!-- Mini form per spec §3.1 — specialty + state + email. Posts to /api/contact with intent=coverage and a constructed message field. -->
      <form id="empty-state-alert-form" class="empty-form" novalidate>
        <label>
          <span>Specialty</span>
          <select name="specialty" required>
            <option value="">Choose…</option>
            {specialtiesPresent.map((s) => (
              <option value={s}>{s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
            ))}
            <option value="other">Other / not listed</option>
          </select>
        </label>
        <label>
          <span>State</span>
          <select name="state" required>
            <option value="">Choose…</option>
            {statesPresent.map((st) => (<option value={st}>{st}</option>))}
            <option value="OPEN">Open / no preference</option>
          </select>
        </label>
        <label>
          <span>Email</span>
          <input type="email" name="email" required maxlength="254" />
        </label>
        <input type="text" name="phone_alt" tabindex="-1" autocomplete="off" class="honeypot" aria-hidden="true" />
        <!-- Reuses TurnstileWidget from T48; widget is page-scoped — see ApplyModal slot. -->
        <button type="submit" class="submit-btn">Notify me when one opens</button>
        <p class="form-status" role="status" aria-live="polite"></p>
      </form>
    </div>
  </div>

  <ApplyModal />
  <SiteFooter slot="footer" />
</MarketingLayout>

<style>
  .card-wrap {
    background: var(--surface-card);
    border-radius: var(--r-card);
    margin: clamp(20px, 4vw, 64px);
    overflow: hidden;
    padding: clamp(48px, 8vw, 96px) clamp(24px, 4vw, 64px);
  }
  .page-hero h1 {
    font-family: var(--font-display);
    font-size: clamp(40px, 6vw, 64px);
    margin: 0 0 16px;
  }
  .page-hero p { font-family: var(--font-body); color: var(--ink-on-cream-2); }
  .layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 48px;
    margin-top: 48px;
  }
  .filter-rail {
    position: sticky;
    top: 96px;
    align-self: start;
    font-family: var(--font-body);
  }
  .filter-rail h2 {
    font-family: var(--font-display);
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.10em;
    margin: 24px 0 8px;
  }
  .filter-rail ul {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 6px;
  }
  .filter-rail label {
    display: flex; align-items: center; gap: 8px;
    cursor: pointer; font-size: 14px;
  }
  .filter-rail .reset {
    margin-top: 16px;
    background: transparent;
    border: 1px solid var(--border-strong-mkt);
    border-radius: var(--r-pill-mkt);
    padding: 8px 16px;
    cursor: pointer;
    font-family: inherit;
  }
  .results {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 24px;
  }
  .job-card {
    border: 1px solid var(--border-hairline);
    border-radius: 16px;
    padding: 32px;
    background: var(--surface-card);
    transition: border-color 180ms ease-out, transform 180ms ease-out;
  }
  .job-card:hover { border-color: var(--brand-navy); transform: translateY(-1px); }
  .job-card .eyebrow {
    font-family: var(--font-display);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 16px;
  }
  .job-card .eyebrow .specialty { color: var(--brand-gold-muted); margin-right: 12px; }
  .job-card .eyebrow .length { color: var(--brand-teal); }
  .job-card h3 {
    font-family: var(--font-display);
    font-size: 24px;
    margin: 0 0 12px;
  }
  .job-card p { font-size: 15px; margin: 0 0 8px; color: var(--ink-on-cream-2); }
  .job-card .rate { color: var(--brand-navy); font-weight: 600; }
  .job-card .apply-trigger {
    margin-top: 16px;
    background: transparent;
    border: 1.5px solid var(--brand-navy);
    color: var(--brand-navy);
    padding: 10px 20px;
    border-radius: var(--r-pill-mkt);
    cursor: pointer;
    font-family: inherit;
  }
  #empty-state { text-align: center; padding: 96px 0; }
  @media (max-width: 768px) {
    .layout { grid-template-columns: 1fr; }
    .filter-rail { position: static; }
  }
</style>

<!-- T33 inserts the filter island script + T51 inserts the apply-trigger wiring below -->
```

- [ ] **Step 2: Codex review** — Prompt: "Review src/pages/jobs/index.astro Path B SSG. Verify: data attrs on .job-card match what ApplyModal will read (data-job-ref + data-job-title); expired listings filtered; rate-range conditional rendering shows 'Rate on request' when missing; filter rail accessibility (role=group, label associations); empty-state ID/behavior; ApplyModal mounted in DOM tree."

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(1.A): /jobs Path B SSG over Content Collection (filter rail + card grid) [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T33: Wire vanilla-TS filter island for URL-param filter state

**Files:** `src/pages/jobs/index.astro` (append `<script>` block)

**Codex review:** MANDATORY

- [ ] **Step 1: Append filter island script**

```astro
<script>
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.job-card'));
  const empty = document.getElementById('empty-state');
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.filter-rail input[type=checkbox]');
  const reset = document.getElementById('filter-reset');

  function readUrlFilters() {
    const p = new URL(window.location.href).searchParams;
    return {
      specialty: new Set(p.getAll('specialty')),
      state: new Set(p.getAll('state')),
      length: new Set(p.getAll('length')),
    };
  }

  function applyFilters() {
    const f = readUrlFilters();
    let visible = 0;
    for (const card of cards) {
      const sp = card.dataset.specialty || '';
      const st = card.dataset.state || '';
      const ln = card.dataset.length || '';
      const show = (f.specialty.size === 0 || f.specialty.has(sp))
                && (f.state.size === 0 || f.state.has(st))
                && (f.length.size === 0 || f.length.has(ln));
      card.hidden = !show;
      if (show) visible++;
    }
    if (empty) empty.hidden = visible !== 0;
  }

  function syncCheckboxesFromUrl() {
    const f = readUrlFilters();
    checkboxes.forEach((cb) => {
      const set = f[cb.name as keyof typeof f];
      cb.checked = !!set?.has(cb.value);
    });
  }

  function writeUrlFromCheckboxes() {
    const url = new URL(window.location.href);
    url.searchParams.delete('specialty');
    url.searchParams.delete('state');
    url.searchParams.delete('length');
    checkboxes.forEach((cb) => { if (cb.checked) url.searchParams.append(cb.name, cb.value); });
    history.replaceState({}, '', url.toString());
  }

  // Filtered URLs get noindex,follow + canonical pointing to root /jobs (spec §0.5.5)
  function updateRobotsMeta() {
    const params = new URL(window.location.href).searchParams;
    const isFiltered = params.has('specialty') || params.has('state') || params.has('length');
    const head = document.head;
    let robots = head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (isFiltered) {
      if (!robots) {
        robots = document.createElement('meta');
        robots.name = 'robots';
        head.appendChild(robots);
      }
      robots.content = 'noindex,follow';
      const can = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (can) {
        const u = new URL(can.href);
        u.search = '';
        can.href = u.toString();
      }
    } else if (robots) {
      robots.remove();
    }
  }

  syncCheckboxesFromUrl();
  applyFilters();
  updateRobotsMeta();
  checkboxes.forEach((cb) => cb.addEventListener('change', () => {
    writeUrlFromCheckboxes();
    applyFilters();
    updateRobotsMeta();
  }));
  reset?.addEventListener('click', () => {
    checkboxes.forEach((cb) => { cb.checked = false; });
    writeUrlFromCheckboxes();
    applyFilters();
    updateRobotsMeta();
  });
  window.addEventListener('popstate', () => {
    syncCheckboxesFromUrl();
    applyFilters();
    updateRobotsMeta();
  });
</script>
```

- [ ] **Step 2: Browser test** — Apply filter, verify URL updates with `?specialty=anesthesiology` etc.; refresh preserves; reset clears all; back/forward preserves; filtered URL gets `<meta name="robots" content="noindex,follow">` and canonical points to `/jobs` (DevTools Elements → `<head>`).

- [ ] **Step 3: Codex review** — Prompt: "Review the vanilla-TS filter island. Verify: SSR-first contract preserved (cards visible without JS); replaceState (not pushState — avoids polluting back-history); popstate listener for browser back/forward; canonical update behavior matches spec §0.5.5 (filtered URLs get noindex,follow + canonical to root /jobs); empty-state visibility toggle when ALL cards filtered out."

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(1.A): /jobs filter island (vanilla TS, URL-param state, noindex on filtered) [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T34: Wire empty-state mini-form submit handler

**Depends on:** **T48 must land first** (Codex r2 AMBER #14 fold — T34's empty-state widget passes `instanceId="jobs-empty-state"` which only works against T48's per-widget-callback TurnstileWidget). If executing tasks in numeric order, gate T34 on T48 completion in the execution-handoff section. Subagent-driven execution: T48 is in the same wave as ContactForm/ApplyModal — schedule T34 in a subsequent wave after T48 lands.

**Files:** `src/pages/jobs/index.astro` (append `<TurnstileWidget />` for the empty-state form + submit handler script)

**Codex review:** MANDATORY (form posts to /api/contact — same anti-spam contract as T49 ContactForm)

> **Codex r1 AMBER #4 fold:** spec §3.1 line 343 calls for an empty-state mini form (specialty + state + email). T32 added the form HTML. T34 wires the Turnstile widget instance + submit handler that posts to `/api/contact` with `intent=coverage` and a constructed `message` field summarizing the criteria. Reuses the same anti-spam plumbing (Turnstile + honeypot + rate-limit on `/api/contact`).

- [ ] **Step 1: Add a second TurnstileWidget for the empty-state form**

In `src/pages/jobs/index.astro`, INSIDE the `#empty-state` div (near the closing `</form>`), add:

```astro
<TurnstileWidget form="#empty-state-alert-form" instanceId="jobs-empty-state" />
```

> **Codex r2 AMBER #5 note:** the TurnstileWidget from T48 uses per-widget callbacks (each instance registers `window.onTurnstileSuccess_<sanitized-instanceId>`). Pass an explicit `instanceId` here so the empty-state widget on `/jobs` does not collide with the ApplyModal's TurnstileWidget when both render on the same page. The ApplyModal (T50) registers its widget with `instanceId="jobs-apply-modal"`.

- [ ] **Step 2: Add submit handler script**

Append to the `<script>` block at the end of `src/pages/jobs/index.astro`:

```ts
const alertForm = document.getElementById('empty-state-alert-form') as HTMLFormElement | null;
const alertStatus = alertForm?.querySelector<HTMLElement>('.form-status');
const alertSubmit = alertForm?.querySelector<HTMLButtonElement>('.submit-btn');

if (alertForm && alertStatus && alertSubmit) {
  alertForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(alertForm);
    const specialty = String(fd.get('specialty') ?? '');
    const state = String(fd.get('state') ?? '');
    const email = String(fd.get('email') ?? '');
    const phoneAlt = String(fd.get('phone_alt') ?? '');
    const turnstileToken = String(fd.get('turnstileToken') ?? '');

    if (!turnstileToken) {
      alertStatus.textContent = 'Please complete the security check.';
      alertStatus.className = 'form-status is-error';
      return;
    }
    alertSubmit.disabled = true;
    alertStatus.textContent = 'Sending…';
    alertStatus.className = 'form-status';
    try {
      // Construct a message from criteria; reuses /api/contact route + Turnstile + rate-limit.
      const message = `Job alert request — specialty: ${specialty || 'any'}, state: ${state || 'any'}.`;
      const resp = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: '(job-alert)',  // server schema requires non-empty name; we send a marker
          email,
          intent: 'coverage',
          message,
          turnstileToken,
          phone_alt: phoneAlt,
        }),
      });
      if (resp.status === 429) {
        alertStatus.textContent = "You're submitting a bit fast — give us a moment to catch up.";
        alertStatus.className = 'form-status is-error';
      } else if (!resp.ok) {
        alertStatus.textContent = 'Something glitched. Please email recruiting@iastaffing.com.';
        alertStatus.className = 'form-status is-error';
      } else {
        alertStatus.textContent = "Thanks — we'll be in touch when something opens that matches.";
        alertStatus.className = 'form-status is-success';
        alertForm.reset();
        (window as any).plausible?.('contact_form_submitted'); // counts toward HC11 goal
      }
    } catch {
      alertStatus.textContent = 'Network error. Please try again.';
      alertStatus.className = 'form-status is-error';
    } finally {
      alertSubmit.disabled = false;
    }
  });
}
```

- [ ] **Step 3: Add CSS for `.empty-form`**

Inside the `<style>` block of `src/pages/jobs/index.astro`, add:

```css
.empty-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 420px;
  margin: 24px auto 0;
  text-align: left;
  font-family: var(--font-body);
}
.empty-form label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.empty-form select, .empty-form input {
  padding: 10px 12px;
  border: 1px solid var(--border-strong-mkt);
  border-radius: var(--r-input);
  background: var(--surface-card-2);
  font-family: inherit;
  font-size: 16px;
}
.empty-form .submit-btn {
  align-self: flex-start;
  background: var(--brand-navy);
  color: var(--surface-card);
  border: none;
  padding: 10px 20px;
  border-radius: var(--r-pill-mkt);
  cursor: pointer;
  font-family: inherit;
}
.empty-form .form-status { font-size: 14px; color: var(--ink-on-cream-2); min-height: 1.4em; }
.empty-form .form-status.is-error { color: var(--error-mkt); }
.empty-form .form-status.is-success { color: var(--success); }
```

- [ ] **Step 4: Browser smoke**

Apply a filter combo that returns 0 results (e.g., specialty Pediatrics + state RI + length short, assuming no seed). Confirm:
- Empty-state form renders with three fields + Turnstile + submit button
- Turnstile widget loads + completes
- Submission shows "Thanks — we'll be in touch…" on success
- Supabase `ims_contact_messages` row appears with `intent='coverage'`, `name='(job-alert)'`, `message` containing the criteria

**Multi-widget smoke (Codex r2 AMBER #5):** on the SAME page, also click an apply CTA on a card to open the ApplyModal (returns to a non-empty filter to surface a card if needed). Confirm:
- TWO Turnstile widgets render simultaneously: one inside `#empty-state-alert-form` (callback `onTurnstileSuccess_jobs_empty_state`) and one inside the apply modal `<dialog>` (callback `onTurnstileSuccess_jobs_apply_modal`)
- Completing the empty-state widget populates ONLY `#empty-state-alert-form input[name="turnstileToken"]` — the apply modal's hidden token input remains empty
- Completing the apply-modal widget populates ONLY the apply modal's hidden token input — the empty-state form's token is unchanged
- (`document.querySelectorAll('input[name="turnstileToken"]')` shows two distinct values when both are completed)

- [ ] **Step 5: Codex review**

Prompt: "Review the empty-state mini-form wiring in src/pages/jobs/index.astro. Verify: form posts to /api/contact (not a separate endpoint) with intent=coverage; specialty + state values populate the message body; honeypot phone_alt forwarded to /api/contact for honeypot drop; Turnstile widget uses `instanceId='jobs-empty-state'` distinct from ApplyModal's `instanceId='jobs-apply-modal'` (no cross-widget token leak — Codex r2 AMBER #5 multi-widget contract); Plausible goal-fire wired correctly to `contact_form_submitted`; name field set to `(job-alert)` marker so recruiter can distinguish in Supabase Studio (flag if a dedicated bool column would be cleaner — but for v1 this minimizes schema churn)."

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(1.A): /jobs empty-state mini-form (specialty + state + email → /api/contact intent=coverage; Codex r1 AMBER #4 + r2 AMBER #5 multi-widget) [runtime-verified] [codex-reviewed: r1 GO + r2 GO]"
```

---

## Phase 1.A — Backend (Database, KV, Server Libs, API Routes)

### T35: Create `migrations/20260506_ims_phase1_tables.sql`

**Files:** `migrations/20260506_ims_phase1_tables.sql`

**Codex review:** MANDATORY (database schema is source-of-truth for the entire apply/contact flow)

- [ ] **Step 1: Create migration file** using exact SQL from spec §0.5.4 plus indexes:

```sql
-- IMS Phase 1.A — apply + contact tables (spec §0.5.4) — 2026-05-06

CREATE TABLE ims_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_ref         text,
  job_title       text,
  name            text NOT NULL,
  email           text NOT NULL,
  phone           text,
  npi             text,
  licenses        text[],
  note            text,
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz DEFAULT now(),
  status          text DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  resend_status   text DEFAULT 'pending' CHECK (resend_status IN ('pending','sent','failed')),
  resend_error    text
);

CREATE TABLE ims_contact_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent          text NOT NULL CHECK (intent IN ('coverage','general')),
  name            text NOT NULL,
  email           text NOT NULL,
  message         text NOT NULL,
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz DEFAULT now(),
  status          text DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  resend_status   text DEFAULT 'pending' CHECK (resend_status IN ('pending','sent','failed')),
  resend_error    text
);

ALTER TABLE ims_applications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ims_contact_messages ENABLE ROW LEVEL SECURITY;
-- No PUBLIC policies. Service-role-key only access from Pages Functions.

CREATE INDEX idx_ims_applications_created_at ON ims_applications (created_at DESC);
CREATE INDEX idx_ims_applications_status     ON ims_applications (status);
CREATE INDEX idx_ims_applications_resend     ON ims_applications (resend_status) WHERE resend_status != 'sent';
CREATE INDEX idx_ims_contact_created_at      ON ims_contact_messages (created_at DESC);
CREATE INDEX idx_ims_contact_resend          ON ims_contact_messages (resend_status) WHERE resend_status != 'sent';
```

- [ ] **Step 2: Codex review** — Prompt: "Verify schema matches spec §0.5.4 byte-for-byte for column names + types + CHECK constraints + RLS enable; the partial-index on resend_status (WHERE resend_status != 'sent') is reasonable for recruiter Studio queries finding failed sends; no public RLS policies."

- [ ] **Step 3: Commit**

```bash
git add migrations/20260506_ims_phase1_tables.sql
git commit -m "feat(1.A): Supabase migration for ims_applications + ims_contact_messages [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T36: Apply Supabase migration

**Files:** none (operator action)

**Codex review:** N/A

- [ ] **Step 1: Confirm target project with Zach** — default existing `gbakzhibzotugfyktcrt`; or new IMS project. Silence > 24h → default.
- [ ] **Step 2: Apply migration** via Supabase MCP `apply_migration` (project_id = chosen ref, name = `20260506_ims_phase1_tables`, query = file contents) OR Supabase Studio SQL Editor.
- [ ] **Step 3: Verify** — `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'ims_%';` — both tables show `rowsecurity: true`.

(no commit — DB state)

---

### T37: Provision KV namespace `IMS_RATE` + bind as `RATE_KV`

**Files:** `DEPLOY.md` (extend with KV binding table)

- [ ] **Step 1:** Cloudflare dashboard → KV → Create namespace `IMS_RATE`. Capture ID.
- [ ] **Step 2:** Pages → IMS website → Settings → Functions → KV bindings → add `RATE_KV` → `IMS_RATE` (Production + Preview).
- [ ] **Step 3:** Append KV binding table to `DEPLOY.md`:

```markdown
### KV bindings

| Binding | Namespace | Used in | Phase |
|---|---|---|---|
| `RATE_KV` | `IMS_RATE` | rate-limiting (apply, contact) | 1.A |
| `JOBS_KV` | `IMS_JOBS` | LS feed cache | 1.A Path A only |
```

- [ ] **Step 4: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(1.A): document KV bindings (RATE_KV, JOBS_KV) [logically-inspected] [codex-skip: doc note]"
```

---

### T38: Set Cloudflare Pages env vars per spec §0.5.4

**Files:** none (dashboard action)

- [ ] **Step 1:** In Cloudflare Pages → Settings → Environment variables (BOTH Production + Preview):

| Var | Value source |
|---|---|
| `RESEND_API_KEY` | Resend dashboard → API Keys (encrypted) |
| `RESEND_FROM_DOMAIN` | `iastaffing.com` |
| `RESEND_FROM_ADDRESS` | `noreply@iastaffing.com` |
| `RECRUITING_TO_ADDRESS` | `recruiting@iastaffing.com` |
| `SUPABASE_URL` | from T36 chosen project |
| `SUPABASE_SERVICE_ROLE_KEY` | from T36 (encrypted) |
| `PUBLIC_TURNSTILE_SITE_KEY` | from T40 |
| `TURNSTILE_SECRET_KEY` | from T40 (encrypted) |
| `PUBLIC_PLAUSIBLE_DOMAIN` | `innovativemedicalstaffing.com` |
| `IMS_RATE_BYPASS_KEY` | `openssl rand -hex 16` (encrypted) — used by T42 bypass header |
| `IP_HASH_BASE_SECRET` | `openssl rand -hex 32` (encrypted) — independent salt secret per Codex r1 fold from T46 |

- [ ] **Step 2:** `npx wrangler pages dev dist` and hit a route after T46/T47 land — confirm env vars readable via `Astro.locals.runtime.env`.

(no commit — dashboard state)

---

### T39: Resend SPF + DKIM + DMARC at Namecheap (Zach action)

> **🚨 Zach action — spec §10 item 7.**

- [ ] **Step 1:** Resend → Domains → Add `iastaffing.com` → capture 3 DNS records.
- [ ] **Step 2:** Namecheap → Advanced DNS for `iastaffing.com` → add SPF (TXT @ — MERGE if existing), DKIM (CNAME `resend._domainkey`), DMARC (TXT `_dmarc` → start `p=none`, tighten later).
- [ ] **Step 3:** Wait for verification (1-30min). Resend dashboard marks domain verified.
- [ ] **Step 4:** Send test email to `recruiting@iastaffing.com` from Resend test panel — verify lands in inbox not spam.

(no commit — DNS state)

---

### T40: Provision Cloudflare Turnstile keys

- [ ] Cloudflare → Turnstile → Add site `IMS website` with domains `innovativemedicalstaffing.com` + `*.ims-website.pages.dev`. Mode: Managed.
- [ ] Capture site key + secret. Set in Pages env vars (T38) as `PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.

(no commit)

---

### T41: TDD `src/lib/ip-hash.ts`

**Files:** `src/lib/ip-hash.ts` + `tests/lib/ip-hash.test.ts`

**Codex review:** MANDATORY (PII handling)

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { hashIp, dailySalt } from '../../src/lib/ip-hash';

describe('hashIp', () => {
  it('returns 64-char hex SHA-256', async () => {
    expect(await hashIp('1.2.3.4', 'salt-A')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('deterministic for same input', async () => {
    const a = await hashIp('1.2.3.4', 'salt-A');
    const b = await hashIp('1.2.3.4', 'salt-A');
    expect(a).toBe(b);
  });
  it('differs on different IP', async () => {
    expect(await hashIp('1.2.3.4', 's')).not.toBe(await hashIp('1.2.3.5', 's'));
  });
  it('differs on different salt', async () => {
    expect(await hashIp('1.2.3.4', 'A')).not.toBe(await hashIp('1.2.3.4', 'B'));
  });
  it('does not include raw IP', async () => {
    expect(await hashIp('1.2.3.4', 's')).not.toContain('1.2.3.4');
  });
});

describe('dailySalt', () => {
  it('stable within UTC day', () => {
    expect(dailySalt(new Date('2026-05-06T03:00:00Z'), 'base'))
      .toBe(dailySalt(new Date('2026-05-06T22:00:00Z'), 'base'));
  });
  it('changes across UTC days', () => {
    expect(dailySalt(new Date('2026-05-06T23:59:00Z'), 'base'))
      .not.toBe(dailySalt(new Date('2026-05-07T00:01:00Z'), 'base'));
  });
});
```

- [ ] **Step 2: Run — failure expected** (`npm test -- tests/lib/ip-hash.test.ts`)

- [ ] **Step 3: Implement `src/lib/ip-hash.ts`**

```ts
/** Daily-salted SHA-256 hash for IPs (Web Crypto — works in Cloudflare runtime). */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${salt}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Daily salt rotates at UTC midnight; combines base secret with YYYY-MM-DD. */
export function dailySalt(now: Date, baseSecret: string): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${baseSecret}::${y}-${m}-${d}`;
}
```

- [ ] **Step 4: Run — pass expected** (6 tests)

- [ ] **Step 5: Codex review** — Prompt: "Verify Web Crypto subtle.digest (not Node-only) for Cloudflare runtime; UTC-anchored salt rotation (not local-time); `${ip}|${salt}` separator avoids ambiguity collision; tests cover salt-rotation; no raw IP in output."

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(1.A): ip-hash daily-salted SHA-256 (Web Crypto, edge-safe) [runtime-verified: 6/6] [codex-reviewed: r1 GO]"
```

---

### T42: TDD `src/lib/rate-limit-kv.ts`

**Files:** `src/lib/rate-limit-kv.ts` + `tests/lib/rate-limit-kv.test.ts`

**Codex review:** MANDATORY

- [ ] **Step 1: Write failing tests** (using Miniflare KV mock):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Miniflare } from 'miniflare';
import { checkAndIncrement } from '../../src/lib/rate-limit-kv';

let mf: Miniflare;
beforeEach(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {};', kvNamespaces: ['RATE_KV'] });
});

describe('checkAndIncrement', () => {
  it('allows up to LIMIT in window', async () => {
    const kv = await mf.getKVNamespace('RATE_KV');
    for (let i = 1; i <= 3; i++) {
      const r = await checkAndIncrement(kv, 'apply', 'h1', { limit: 3, windowSec: 600 });
      expect(r.ok).toBe(true);
    }
  });
  it('rejects LIMIT+1 with retryAfter', async () => {
    const kv = await mf.getKVNamespace('RATE_KV');
    for (let i = 1; i <= 3; i++) await checkAndIncrement(kv, 'apply', 'h2', { limit: 3, windowSec: 600 });
    const r = await checkAndIncrement(kv, 'apply', 'h2', { limit: 3, windowSec: 600 });
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
  });
  it('isolates by route', async () => {
    const kv = await mf.getKVNamespace('RATE_KV');
    for (let i = 1; i <= 3; i++) await checkAndIncrement(kv, 'apply', 'h3', { limit: 3, windowSec: 600 });
    const r = await checkAndIncrement(kv, 'contact', 'h3', { limit: 3, windowSec: 600 });
    expect(r.ok).toBe(true);
  });
  it('honors bypass when keys match', async () => {
    const kv = await mf.getKVNamespace('RATE_KV');
    for (let i = 1; i <= 3; i++) await checkAndIncrement(kv, 'apply', 'h4', { limit: 3, windowSec: 600 });
    const r = await checkAndIncrement(kv, 'apply', 'h4', {
      limit: 3, windowSec: 600, bypassPresented: 'k', bypassExpected: 'k',
    });
    expect(r.ok).toBe(true);
    expect(r.bypassUsed).toBe(true);
  });
  it('FAIL-CLOSED when expected key empty', async () => {
    const kv = await mf.getKVNamespace('RATE_KV');
    for (let i = 1; i <= 3; i++) await checkAndIncrement(kv, 'apply', 'h5', { limit: 3, windowSec: 600 });
    const r = await checkAndIncrement(kv, 'apply', 'h5', {
      limit: 3, windowSec: 600, bypassPresented: '', bypassExpected: '',
    });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/lib/rate-limit-kv.ts`**

```ts
export interface RateLimitOpts {
  limit: number;
  windowSec: number;
  bypassPresented?: string;
  bypassExpected?: string;
}
export interface RateLimitResult {
  ok: boolean;
  retryAfter?: number;
  bypassUsed?: boolean;
}

export async function checkAndIncrement(
  kv: KVNamespace,
  route: string,
  ipHash: string,
  opts: RateLimitOpts,
): Promise<RateLimitResult> {
  // Bypass: only honor if BOTH presented AND expected are non-empty AND match.
  if (opts.bypassPresented && opts.bypassExpected && opts.bypassPresented === opts.bypassExpected) {
    return { ok: true, bypassUsed: true };
  }
  const key = `rate:${route}:${ipHash}`;
  const raw = (await kv.get(key, 'json')) as { count: number; resetAt: number } | null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!raw || raw.resetAt <= nowSec) {
    await kv.put(key, JSON.stringify({ count: 1, resetAt: nowSec + opts.windowSec }), { expirationTtl: opts.windowSec });
    return { ok: true };
  }
  if (raw.count >= opts.limit) {
    return { ok: false, retryAfter: raw.resetAt - nowSec };
  }
  await kv.put(key, JSON.stringify({ count: raw.count + 1, resetAt: raw.resetAt }), { expirationTtl: raw.resetAt - nowSec });
  return { ok: true };
}
```

- [ ] **Step 3: Run — pass expected** (5 tests)

- [ ] **Step 4: Codex review** — Prompt: "Verify bypass FAIL-CLOSED when expected empty; fixed-window vs sliding-window decision; KV expirationTtl shrinks on increment; per-route key prefix isolation; no PII in keys (sha256 ipHash only)."

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(1.A): rate-limit-kv (3/600s, route-scoped, fail-closed bypass) [runtime-verified: 5/5] [codex-reviewed: r1 GO]"
```

---

### T43: TDD `src/lib/turnstile-server.ts`

**Files:** `src/lib/turnstile-server.ts` + `tests/lib/turnstile-server.test.ts`

**Codex review:** MANDATORY

- [ ] **Step 1: Write tests** — covers: valid token (success: true), rejected token (success: false), HTTP 500, network throw, empty secret (fail-closed).

- [ ] **Step 2: Implement**

```ts
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token: string, remoteIp: string, secret: string): Promise<boolean> {
  if (!secret || !token) return false;
  try {
    const body = new FormData();
    body.append('secret', secret);
    body.append('response', token);
    if (remoteIp) body.append('remoteip', remoteIp);
    const resp = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    if (!resp.ok) return false;
    const json = (await resp.json()) as { success: boolean };
    return !!json.success;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Codex review** — Prompt: "Fail-closed when secret empty; fail-closed when token empty; HTTP error branch; network-error catch; FormData matches Cloudflare siteverify spec; no token/secret logging."

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(1.A): turnstile-server verify (fail-closed) [runtime-verified: 5/5] [codex-reviewed: r1 GO]"
```

---

### T44: Create `src/lib/supabase-server.ts`

**Files:** `src/lib/supabase-server.ts`

**Codex review:** MANDATORY (auth boundary)

- [ ] **Step 1: Implement**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface RuntimeEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** Server-only Supabase client. NEVER import from client-hydrating components. Only from src/pages/api/*. */
export function createSupabaseServer(env: RuntimeEnv): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Pages env');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'ims-website/1.A' } },
  });
}
```

- [ ] **Step 2: Codex review** — Prompt: "Throws (not silently fails) when env missing; persistSession=false matches stateless edge; X-Client-Info for telemetry; error message no key leakage."

- [ ] **Step 3: End-to-end env-binding verification (Codex r1 AMBER #9 fold — Risk Register references this test)**

The Risk Register flags Pages-Functions-can't-read-Supabase-env as a real launch risk that should be caught BEFORE T46/T47 routes. This step exercises the env binding through `wrangler pages dev` against a temporary scratch endpoint:

Create `src/pages/api/_supabase-ping.ts` (temp file, removed before commit):

```ts
import type { APIContext } from 'astro';
import { createSupabaseServer } from '../../lib/supabase-server';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const env = (context.locals as any).runtime?.env ?? {};
  try {
    const sb = createSupabaseServer(env);
    // Cheap query — auth check uses RLS context. We expect 'count' result regardless of table contents.
    const { error } = await sb.from('ims_contact_messages').select('id', { count: 'exact', head: true });
    return new Response(JSON.stringify({ ok: !error, error: error?.message ?? null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
```

Run:

```bash
npm run build
npx wrangler pages dev dist --kv RATE_KV
```

In a separate shell (env vars from T38 must be set in Cloudflare dashboard OR via `--var` flags):

```bash
curl -s http://localhost:8788/api/_supabase-ping
```

Expected: `{"ok":true,"error":null}`. If `ok: false`, inspect `error`:
- `must be set in Pages env` → env vars not bound; fix T38 setup
- `permission denied for table ims_contact_messages` → RLS not configured per T35; fix migration
- network error → check Cloudflare dashboard / wrangler config

Once green, **delete the scratch file** before commit (don't ship the ping endpoint to production):

```bash
rm src/pages/api/_supabase-ping.ts
```

This step's pass status is what Risk Register row "Pages Functions can't read Supabase service-role key (env-binding mismatch)" depends on for failure-detection BEFORE T46/T47 routes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase-server.ts
git commit -m "feat(1.A): supabase-server (service-role, edge-runtime, fail-loud + env-binding smoke) [runtime-verified: 1/1 ping] [codex-reviewed: r1 GO]"
```

---

### T45: Create `src/lib/resend-server.ts`

**Files:** `src/lib/resend-server.ts`

**Codex review:** MANDATORY

- [ ] **Step 1: Implement**

```ts
import { Resend } from 'resend';

export interface ResendEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_ADDRESS?: string;
  RECRUITING_TO_ADDRESS?: string;
}

export interface SendResult {
  ok: boolean;
  /** Truncated error message for resend_status='failed' row column. NEVER throws. */
  error?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function envOk(env: ResendEnv): env is Required<Pick<ResendEnv, 'RESEND_API_KEY' | 'RESEND_FROM_ADDRESS' | 'RECRUITING_TO_ADDRESS'>> {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_ADDRESS && env.RECRUITING_TO_ADDRESS);
}

export async function sendApplicationEmail(env: ResendEnv, p: {
  name: string; email: string;
  phone?: string; npi?: string; licenses?: string[]; note?: string;
  jobRef?: string; jobTitle?: string;
  applicationId: string;
}): Promise<SendResult> {
  if (!envOk(env)) return { ok: false, error: 'Missing Resend env vars' };
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const subj = p.jobTitle ? `[IMS Apply] ${p.jobTitle} — ${p.name}` : `[IMS Apply] ${p.name}`;
    const html =
      `<h2>New application</h2>` +
      `<p><strong>Name:</strong> ${escapeHtml(p.name)}</p>` +
      `<p><strong>Email:</strong> ${escapeHtml(p.email)}</p>` +
      (p.phone ? `<p><strong>Phone:</strong> ${escapeHtml(p.phone)}</p>` : '') +
      (p.npi ? `<p><strong>NPI:</strong> ${escapeHtml(p.npi)}</p>` : '') +
      (p.licenses?.length ? `<p><strong>Licenses:</strong> ${escapeHtml(p.licenses.join(', '))}</p>` : '') +
      (p.jobRef ? `<p><strong>Job ref:</strong> ${escapeHtml(p.jobRef)}</p>` : '') +
      (p.note ? `<p><strong>Note:</strong><br>${escapeHtml(p.note).replace(/\n/g, '<br>')}</p>` : '') +
      `<hr><p style="color:#888;font-size:12px">Application ID: ${p.applicationId}</p>`;
    const result = await resend.emails.send({
      from: env.RESEND_FROM_ADDRESS,
      to: env.RECRUITING_TO_ADDRESS,
      replyTo: p.email,
      subject: subj,
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

export async function sendContactEmail(env: ResendEnv, p: {
  name: string; email: string;
  intent: 'coverage' | 'general';
  message: string;
  contactId: string;
}): Promise<SendResult> {
  if (!envOk(env)) return { ok: false, error: 'Missing Resend env vars' };
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const subj = `[IMS Contact · ${p.intent}] ${p.name}`;
    const html =
      `<h2>New ${p.intent} inquiry</h2>` +
      `<p><strong>Name:</strong> ${escapeHtml(p.name)}</p>` +
      `<p><strong>Email:</strong> ${escapeHtml(p.email)}</p>` +
      `<p><strong>Message:</strong><br>${escapeHtml(p.message).replace(/\n/g, '<br>')}</p>` +
      `<hr><p style="color:#888;font-size:12px">Contact ID: ${p.contactId}</p>`;
    const result = await resend.emails.send({
      from: env.RESEND_FROM_ADDRESS,
      to: env.RECRUITING_TO_ADDRESS,
      replyTo: p.email,
      subject: subj,
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
```

- [ ] **Step 2: Codex review** — Prompt: "NEVER-throws contract; HTML escaping prevents XSS in admin email view; replyTo applicant email; error truncated to 500 chars (DB column fit); env-vars-missing returns error result not throw; subject + body include row UUID for cross-reference."

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(1.A): resend-server (sendApplicationEmail + sendContactEmail, never-throws) [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T46: TDD `src/pages/api/contact.ts`

**Files:** `src/pages/api/contact.ts` + `tests/api/contact.test.ts`

**Codex review:** MANDATORY (route enforces §0.5.4 contract)

- [ ] **Step 1: Write failing tests** (vi.mock the libs; assert composition):

Tests cover:
1. Malformed payload → 400
2. Invalid Turnstile → 403, no Supabase write, no Resend
3. Rate-limit hit → 429 with `Retry-After`, no Supabase write, no Resend
4. Happy path → Supabase INSERT FIRST with resend_status=pending → THEN Resend → update resend_status=sent → 200
5. Resend fail → row at resend_status=failed, returns 200
6. Supabase insert fail → 502, no Resend attempt
7. Honeypot `phone_alt` populated → 200 silent (bot drop) AND `console.log` fires with `[honeypot]` prefix + truncated `ip_hash` (audit trail per spec §3.3 — Codex r1 AMBER #6 fold). Test stubs `console.log` via `vi.spyOn(console, 'log')` and asserts the call. Also asserts NO Supabase row created and NO Resend call.

- [ ] **Step 2: Implement `src/pages/api/contact.ts`**

```ts
import type { APIContext } from 'astro';
import { z } from 'zod';
import { verifyTurnstile } from '../../lib/turnstile-server';
import { checkAndIncrement } from '../../lib/rate-limit-kv';
import { hashIp, dailySalt } from '../../lib/ip-hash';
import { createSupabaseServer } from '../../lib/supabase-server';
import { sendContactEmail } from '../../lib/resend-server';

export const prerender = false;

const ContactPayload = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(254),
  intent: z.enum(['coverage', 'general']),
  message: z.string().trim().min(1).max(4000),
  turnstileToken: z.string().min(1),
  phone_alt: z.string().optional(), // honeypot — populated = bot
});

const RATE = { limit: 3, windowSec: 600 };

export async function POST(context: APIContext): Promise<Response> {
  let body: unknown;
  try { body = await context.request.json(); } catch { return j(400, { error: 'Invalid JSON' }); }
  const parsed = ContactPayload.safeParse(body);
  if (!parsed.success) return j(400, { error: 'Invalid payload' });
  const data = parsed.data;

  const env = (context.locals as any).runtime?.env ?? {};
  const ip = context.request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
  // Compute ipHash early so honeypot drop can log a non-PII fingerprint (Codex r1 AMBER #6 fold — spec §3.3 says drop AND log).
  const ipHash = await hashIp(ip, dailySalt(new Date(), env.IP_HASH_BASE_SECRET ?? ''));

  // Honeypot — silent 200 so bot doesn't retry, but LOG the drop for audit trail (non-PII).
  if (data.phone_alt && data.phone_alt.trim().length > 0) {
    console.log(`[honeypot] dropped contact submission ip_hash=${ipHash.slice(0, 16)} phone_alt_len=${data.phone_alt.length}`);
    return j(200, { ok: true });
  }

  // 1. Turnstile verify
  if (!await verifyTurnstile(data.turnstileToken, ip, env.TURNSTILE_SECRET_KEY ?? '')) {
    return j(403, { error: 'Turnstile verification failed' });
  }

  // 2. Rate-limit (ipHash already computed above)
  const bypass = context.request.headers.get('x-ims-test-bypass') ?? '';
  const rl = await checkAndIncrement(env.RATE_KV, 'contact', ipHash, {
    ...RATE, bypassPresented: bypass, bypassExpected: env.IMS_RATE_BYPASS_KEY ?? '',
  });
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: 'rate-limited' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': String(rl.retryAfter ?? 600) },
    });
  }

  // 3. Supabase row INSERT FIRST with resend_status=pending (default)
  const sb = createSupabaseServer(env);
  const userAgent = context.request.headers.get('user-agent') ?? '';
  const { data: row, error: insErr } = await sb.from('ims_contact_messages').insert({
    intent: data.intent, name: data.name, email: data.email, message: data.message,
    ip_hash: ipHash, user_agent: userAgent,
  }).select('id').single();
  if (insErr || !row) {
    return j(502, { error: 'Could not record submission. Please try again or email recruiting@iastaffing.com.' });
  }

  // 4. THEN Resend send
  const sendResult = await sendContactEmail(env, {
    name: data.name, email: data.email, intent: data.intent, message: data.message, contactId: row.id,
  });

  // 5. Update resend_status (no await needed for response — but await so test asserts work)
  await sb.from('ims_contact_messages').update({
    resend_status: sendResult.ok ? 'sent' : 'failed',
    resend_error: sendResult.ok ? null : (sendResult.error?.slice(0, 500) ?? null),
  }).eq('id', row.id);

  return j(200, { ok: true });
}

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 3: Codex review** — Prompt: "Spec §0.5.4 route contract: order verify→RL→Supabase INSERT FIRST→Resend→update; honeypot fail-silent (200 ok) — confirm intentional; 502 on Supabase fail (NO Resend); 429 + Retry-After on rate-limit; 403 on Turnstile fail; resend_error truncated; resend_status flip to sent/failed; ip_hash always written; export const prerender = false set; daily salt uses dedicated IP_HASH_BASE_SECRET env var per Codex r1 fold."

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(1.A): /api/contact — full route contract per spec §0.5.4 [runtime-verified: 7/7] [codex-reviewed: r1 GO]"
```

---

### T47: TDD `src/pages/api/apply.ts`

**Files:** `src/pages/api/apply.ts` + `tests/api/apply.test.ts`

**Codex review:** MANDATORY

- [ ] **Step 1: Write tests** mirroring T46's 7 cases (including the honeypot-logs-and-drops case from Codex r1 AMBER #6 fold) plus:
- NPI validation (10-digit numeric only or empty)
- jobRef + jobTitle propagated to email subject
- licenses array max length 60

- [ ] **Step 2: Implement** mirroring T46 pattern (including early `ipHash` compute + honeypot `console.log` for audit per spec §3.3) but writing to `ims_applications` with apply-specific columns:

```ts
const ApplyPayload = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().max(254),
  phone: z.string().trim().min(1).max(40),
  npi: z.string().regex(/^\d{10}$/).optional().or(z.literal('')),
  licenses: z.array(z.string().min(2).max(2)).max(60).optional(),
  note: z.string().trim().max(500).optional(),
  jobRef: z.string().max(120).optional(),
  jobTitle: z.string().max(200).optional(),
  turnstileToken: z.string().min(1),
  phone_alt: z.string().optional(),
});
```

INSERT statement includes `phone`, `npi`, `licenses`, `note`, `job_ref`, `job_title`. Resend payload includes `applicationId` (uuid), `jobTitle`, `jobRef`. Subject `[IMS Apply] ${jobTitle ?? name}`.

Honeypot drop log message (matches T46 pattern with `apply` route name):
```ts
console.log(`[honeypot] dropped apply submission ip_hash=${ipHash.slice(0, 16)} phone_alt_len=${data.phone_alt.length}`);
```

- [ ] **Step 3: Codex review** — Prompt: "Same order-of-ops as /api/contact; apply-specific columns inserted; NPI regex /^\\d{10}$/ matches 10-digit US format; licenses array max 60; jobRef/jobTitle to email subject; honeypot silent 200 AND console.log audit trail with ip_hash prefix; ipHash computed BEFORE honeypot check so log can include it."

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(1.A): /api/apply — full route contract with NPI + licenses + jobRef [runtime-verified: 9/9] [codex-reviewed: r1 GO]"
```

---

## Phase 1.A — Form Components + Analytics + Type/Color Validation

### T48: Create `TurnstileWidget.astro`

**Files:** `src/components/forms/TurnstileWidget.astro`

**Codex review:** MANDATORY (callback-dispatch correctness — multi-widget pages must not cross-leak tokens; Codex r2 AMBER #5 fold)

- [ ] **Step 1: Build** — Renders the Cloudflare Turnstile widget div + injects the api.js script (CSP allows challenges.cloudflare.com per §0.5.3). Each widget instance gets its OWN callback function (named after a sanitized form selector) that closes over the target form selector — this prevents cross-widget token leak when two widgets render on the same page (e.g. `/jobs` empty-state mini-form + apply modal).

```astro
---
const TURNSTILE_SITE_KEY = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
interface Props { form: string; instanceId?: string; }
const { form, instanceId } = Astro.props;
// Per-widget callback name — sanitized to JS identifier characters only.
// Defaults derive from the form selector so callers don't need to think about it,
// but two widgets pointing at the same form should pass distinct instanceId values.
const callback = `onTurnstileSuccess_${(instanceId ?? form).replace(/[^a-zA-Z0-9_]/g, '_')}`;
---
<div class="cf-turnstile" data-sitekey={TURNSTILE_SITE_KEY} data-form={form} data-callback={callback}></div>
<script is:inline async defer src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
<script is:inline define:vars={{ form, callback }}>
  // Per-widget callback closes over THIS widget's target form selector — no cross-widget leak.
  // (Codex r2 AMBER #5 fold — replaced the previous cross-iterating onTurnstileSuccess.)
  window[callback] = function (token) {
    var target = document.querySelector(form);
    if (!target) return;
    var input = target.querySelector('input[name="turnstileToken"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'turnstileToken';
      target.appendChild(input);
    }
    input.value = token;
  };
</script>
```

- [ ] **Step 2: Codex review** — Prompt: "Review src/components/forms/TurnstileWidget.astro. Verify: (1) per-widget callback closes over its own `form` selector (no `document.querySelectorAll('.cf-turnstile').forEach` pattern); (2) callback name is unique per `instanceId` so two widgets on the same page register distinct globals; (3) sanitization regex `/[^a-zA-Z0-9_]/g` prevents JS-identifier injection from form selector strings; (4) `window[callback]` assignment is idempotent on script re-execution (Astro view transitions may re-run inline scripts); (5) `data-callback` attribute matches the `window[callback]` name exactly; (6) hidden input named `turnstileToken` is created if absent (idempotent — multi-fire callback safe)."

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(1.A): TurnstileWidget per-widget callback (no cross-widget token leak; Codex r2 AMBER #5) [logically-inspected] [codex-reviewed: r2 GO]"
```

---

### T49: Create `ContactForm.astro`

**Files:** `src/components/forms/ContactForm.astro`

**Codex review:** MANDATORY (user-facing contract for /api/contact)

- [ ] **Step 1: Build** — Form with fields per `/api/contact` payload; honeypot `phone_alt` hidden via off-screen positioning (`position: absolute; left: -10000px`); intent select pre-fills from `defaultIntent` prop (set by `/contact?intent=coverage` query). Submit-handler posts JSON, displays status message; `.is-success` / `.is-error` styling. 429 → `"You're submitting a bit fast..."` per spec §3.3. Plausible goal `contact_form_submitted` fires only on success (calls `window.plausible?.('contact_form_submitted')`).

- [ ] **Step 2: Codex review** — Prompt: "novalidate (server enforces); honeypot via off-screen (not display:none); intent pre-fill; Turnstile token check before submit; 429 message verbatim from spec §3.3; Plausible fires only on success; no PII in error messages back to user; same-origin fetch (no credentials)."

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(1.A): ContactForm (Turnstile + honeypot + 429 messaging + Plausible goal) [logically-inspected] [codex-reviewed: r1 GO]"
```

Then update `/contact.astro` (T26) to render `<ContactForm defaultIntent={intent} />` based on `?intent=` query param.

---

### T50: Create `ApplyModal.astro`

**Files:** `src/components/forms/ApplyModal.astro`

**Codex review:** MANDATORY (modal a11y + state management)

- [ ] **Step 1: Build** — Native `<dialog>` element + `showModal()` — preferred for built-in focus-trap + ESC-close. Backdrop click closes. Form fields: name, email, phone (required), npi (optional 10-digit), licenses_csv (parsed client-side: split → trim → uppercase → filter to 2-letter). Hidden `jobRef` + `jobTitle` populated by `window.openApplyModal(ref, title)`. Submit-handler same shape as ContactForm. Confirmation copy verbatim from spec §3.3 step 5: *"We received your application for ${jobTitle}. Our team will be in touch within 1 business day."* Plausible goal `application_submitted` fires on success.

> **TurnstileWidget instance** (Codex r2 AMBER #5): render `<TurnstileWidget form="#apply-modal-form" instanceId="jobs-apply-modal" />` inside the dialog so it does NOT collide with T34's `instanceId="jobs-empty-state"` widget when both render on `/jobs`.

- [ ] **Step 2: Codex review** — Prompt: "Native <dialog> + showModal; backdrop click closes (event.target === dialog); openApplyModal global type-safe (window declaration); licenses_csv splits + filters to 2-letter uppercase only — non-2-letter entries silently dropped (intentional? or surprise?); confirmation message wording exact spec match; Plausible fires only on success; phone required (matches spec §3.3 contact-style payload); TurnstileWidget rendered with `instanceId='jobs-apply-modal'` distinct from T34's `instanceId='jobs-empty-state'` per Codex r2 AMBER #5 multi-widget contract."

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(1.A): ApplyModal (native <dialog>, vanilla JS, /api/apply integration) [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T51: Wire ApplyModal data flow from `/jobs` cards

**Files:** `src/pages/jobs/index.astro` (append script)

**Codex review:** MANDATORY (per Codex matrix line 53 — click-handler wiring with global function call. Codex r2 AMBER #9 fold extends consistency.)

- [ ] **Step 1: Append wiring script** to `/jobs/index.astro`:

```astro
<script>
  document.querySelectorAll<HTMLButtonElement>('.apply-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest<HTMLElement>('.job-card');
      if (!card) return;
      const ref = card.dataset.jobRef ?? '';
      const title = card.dataset.jobTitle ?? '';
      (window as any).openApplyModal?.(ref, title);
    });
  });
</script>
```

- [ ] **Step 2: Codex review** — Prompt: "Review the apply-trigger wiring script. Verify: (1) querySelector scope is per-page (not cross-page); (2) `closest('.job-card')` matches the actual DOM produced by T30/T32; (3) `window.openApplyModal` is defined by T50 ApplyModal before this script runs (Astro `is:inline` ordering — flag if T50's modal renders AFTER this script in HTML order, since `?.()` swallows the bug); (4) `dataset.jobRef` and `dataset.jobTitle` match the data-attrs T30 emits on the card; (5) no XSS path through dataset values into modal innerHTML — modal must use textContent/setAttribute, not innerHTML interpolation."

- [ ] **Step 3: Browser smoke** — open `/jobs`, click `Apply through IMS →`, confirm modal opens with correct job title displayed; submit → status message shown.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(1.A): wire ApplyModal trigger from /jobs cards [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T52: Plausible goal-fire wiring for hero CTAs

**Files:** `src/components/sections/HomeHero.astro` + small global script in MarketingLayout

**Codex review:** MANDATORY (per Codex matrix line 53 — analytics wiring affects HC11 conversion-goal pass/fail. Codex r2 AMBER #9 fold extends consistency.)

- [ ] **Step 1:** In Plausible dashboard → Goals → register: `cta_find_opportunities`, `cta_request_coverage`, `application_submitted`, `contact_form_submitted` (the latter two are fired by T49 + T50 already).

- [ ] **Step 2:** In `HomeHero.astro` add `data-analytics="find-opportunities"` to primary CTA + `data-analytics="request-coverage"` to secondary CTA.

- [ ] **Step 3:** In MarketingLayout end-of-body, add inline script:

```js
document.querySelectorAll('[data-analytics]').forEach((el) => {
  el.addEventListener('click', () => {
    const goal = el.getAttribute('data-analytics');
    if (goal === 'find-opportunities') window.plausible?.('cta_find_opportunities');
    if (goal === 'request-coverage') window.plausible?.('cta_request_coverage');
  });
});
```

- [ ] **Step 4: Codex review** — Prompt: "Review goal-fire wiring. Verify: (1) goal names exact-match Plausible-dashboard registration (`cta_find_opportunities`, `cta_request_coverage`) — typo would mean events fire but don't count toward HC11 goals; (2) `window.plausible?.()` optional-chain is correct (event silently noops when blocker/extension prevents Plausible script load); (3) script lives in MarketingLayout (not BaseLayout) so /jobs job-cards don't accidentally fire hero goals; (4) `data-analytics` value-list is closed (only the two known goals — anything else is silently dropped); (5) click handler does not stopPropagation/preventDefault on anchor CTAs (link navigation must still occur)."

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(1.A): wire Plausible goal-fire on hero CTAs (cta_find_opportunities, cta_request_coverage) [logically-inspected] [codex-reviewed: r1 GO]"
```

---

### T53: Schema.org Organization JSON-LD verification

**Files:** none (already shipped in T8 MarketingLayout — verification only)

- [ ] **Step 1:** `npm run build && grep -A 20 '"@context": "https://schema.org"' dist/index.html`. Expect well-formed JSON-LD with `@type: Organization`.
- [ ] **Step 2:** Validate at https://validator.schema.org/ — paste JSON-LD; expect 0 errors.
- [ ] **Step 3:** Mark complete. (no commit)

---

### T54: WCAG contrast audit decisions → `docs/IAS-Design-System.md`

**Files:** `docs/IAS-Design-System.md` (extend)

**Codex review:** `[codex-skip: docs audit values]`

- [ ] **Step 1: Compute contrast ratios** for the pairs called out in spec §5 HC11 — use https://webaim.org/resources/contrastchecker/:

| Foreground | Background | Ratio (computed) | AA Normal Pass (4.5:1) | AA Large Pass (3:1) | Decision |
|---|---|---|---|---|---|
| `#59BFE7` | `#F2E8DC` | RUN | RUN | RUN | If normal fails: limit to 18px+ usage OR swap to `--brand-blue-deep` for text-bearing |
| `#59BFE7` | `#1E1E1E` | RUN | RUN | RUN | Likely passes large; flag if normal fails |
| `#B8975B` | `#F2E8DC` | RUN | RUN | RUN | If fails normal: increase weight, or restrict to 18px+ |
| `#1A2B4A` | `#F2E8DC` | RUN | RUN | RUN | Expect AA + AAA pass — primary CTA |
| `#7B5E5C` | `#F2E8DC` | RUN | RUN | RUN | Secondary text — must pass AA |

- [ ] **Step 2: Append to `docs/IAS-Design-System.md`:**

```markdown
---

## WCAG Contrast Audit (Phase 1.A — 2026-05)

[filled table]

Approved variants:
- `--brand-blue` text on cream → if AA fails, restrict to ≥18px and wrap critical small-size usage with `--brand-blue-deep`.
- `--brand-gold-muted` on cream → if normal AA fails, restrict to ≥18px or wrap with `--brand-navy` (passes AA + AAA).
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(1.A): WCAG contrast audit per spec §5 HC11 [logically-inspected] [codex-skip: audit values]"
```

---

### T55: TAY first-paint validation step → `docs/IAS-Design-System.md`

**Files:** `docs/IAS-Design-System.md` (extend)

- [ ] **Step 1:** Deploy preview, open homepage on Chrome + Safari (desktop production-like). Inspect TAY Basal at hero clamp-max (~96px) on cream — does it read crisp + bold-enough? Inspect TAY Amaya at 19px body — legible + on-brand?

- [ ] **Step 2:** If TAY Basal reads too light → swap `--font-display` first fallback to `'Inter Variable'` (Inter becomes display, TAY becomes secondary). If TAY Amaya reads quirky for body → swap `--font-body` first fallback to `'Inter Variable'`. Edit `tokens.css` accordingly. Document decision in design system doc.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs(1.A): TAY first-paint validation per spec §0.5.6 / §4.2 [logically-inspected] [codex-skip: docs note]"
```

---

## Path A Scope-Add (CONDITIONAL on 2026-05-13 LS authorization)

> **🚨 EXECUTE ONLY IF Zach reports written LocumSmart admin authorization by 2026-05-13.** PA1 is the decision gate. If NO auth: SKIP PA1-PA12, proceed to T56+. Path A migrates to a separate Phase 1.5 plan.

### PA1: Decision gate — confirm LS authorization

- [ ] **Step 1:** Ask Zach: "Has LS admin authorized written feed-pull / scrape access for `iastaffing.com`? If yes, paste the email/written confirmation. If no or pending, we proceed Path B-only and migrate Path A to Phase 1.5."
- [ ] **Step 2:** If YES → proceed to PA2; add note to `DEPLOY.md` capturing authorization date + scope. If NO → skip PA2-PA12; file `docs/plans/2026-05-XX-ims-phase-1.5-path-a-migration.md` stub linking to spec §3.4. If PENDING past 2026-05-13 → fall back to NO. Don't let "pending" indefinitely block launch.

(no commit unless DEPLOY.md update or Phase 1.5 plan stub)

---

### PA2: Provision KV namespace `IMS_JOBS` + bind as `JOBS_KV`

- [ ] Cloudflare → Workers & Pages → KV → Create namespace `IMS_JOBS`. Capture ID.
- [ ] Bind to Pages project as `JOBS_KV` (Production + Preview).
- [ ] Bind to Worker (PA3) `wrangler.toml` `kv_namespaces` block.
- [ ] Update `DEPLOY.md` KV bindings table — flip Path-A row from optional to active.

---

### PA3: Create `workers/jobs-sync/wrangler.toml` + `package.json`

**Codex review:** `[codex-skip: config]`

- [ ] **Step 1: Create wrangler.toml**

```toml
name = "ims-jobs-sync"
main = "src/index.ts"
compatibility_date = "2026-05-06"
compatibility_flags = ["nodejs_compat"]

kv_namespaces = [
  { binding = "JOBS_KV", id = "<production_id>", preview_id = "<preview_id>" }
]

[triggers]
crons = ["0 * * * *"]

[vars]
LS_FEED_BASE_URL = "https://locumsmart.example/feed"

# Secret (set via wrangler secret put):
# LS_FEED_AUTH_TOKEN
```

Replace IDs from PA2.

- [ ] **Step 2: Create `workers/jobs-sync/package.json`**

```json
{
  "name": "ims-jobs-sync",
  "private": true,
  "type": "module",
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "tail": "wrangler tail",
    "test": "vitest run"
  },
  "devDependencies": {
    "wrangler": "^3.x",
    "@cloudflare/workers-types": "^4.x",
    "typescript": "^5.x",
    "vitest": "^1.x"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(1.A · Path A): workers/jobs-sync scaffold [logically-inspected] [codex-skip: config]"
```

---

### PA4: TDD `workers/jobs-sync/src/normalize.ts`

**Files:**
- Create: `workers/jobs-sync/src/normalize.ts` + tests
- Create: `src/data/specialties.json` (canonical allowlist + aliases)

**Codex review:** MANDATORY

- [ ] **Step 1: Create `src/data/specialties.json`** with 12 canonical slugs + ~20 aliases (anesth → anesthesiology, em / er → emergency-medicine, peds → pediatrics, etc.).

- [ ] **Step 2: TDD normalize.ts** — Tests:
- Specialty alias lookup (case-insensitive)
- Unknown specialty → `'other'` bucket + return original to `unknownSpecialties[]`
- USPS state validation (uppercase, 2-letter, valid set incl DC)
- Rate-range sanitize: low > high → both `null`, listing kept with "Rate on request"
- `_lastSeenAt` ISO timestamp tag
- Missing required fields (id, title, state, length) → drop with reason

- [ ] **Step 3: Implement** — `normalizeSpecialty()`, `normalizeState()`, `categorizeLength()` (days < 28 = short, 28-84 = medium, >84 = long), `sanitizeRate()`, top-level `normalize(raw, nowIso): NormalizeResult`. (Full implementation pattern in spec §3.4 dirty-data handling.)

- [ ] **Step 4: Codex review** — Prompt: "Specialty alias map case-insensitive; lengthCategory boundaries (28d / 84d) match spec §3.1 filter rail (<4w / 4-12w / 12+w); rate-range sanitize matches spec §3.4; state validation strict; unknown specialties bucketed under 'other' AND surfaced via unknownSpecialties array for jobs:_meta logging."

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(1.A · Path A): jobs-sync normalize (specialty alias, USPS state, rate sanitize) [runtime-verified] [codex-reviewed: r1 GO]"
```

---

### PA5: TDD `workers/jobs-sync/src/kv-writer.ts` (incl. stale-listing lifecycle)

**Files:** `workers/jobs-sync/src/kv-writer.ts` + tests

**Codex review:** MANDATORY (write-budget critical AND stale-lifecycle correctness — Codex r1 NO-GO #3 fold)

> **Stale-lifecycle requirement (spec §3.4 lines 408-410 and 467-468):** listings absent from a sync are NOT immediately dropped. Pattern: 2 consecutive misses → mark `_stale: true`; 24h grace from `_lastSeenAt` → drop entirely. State (per-id miss counter) lives in `jobs:_meta.lifecycle: { [id]: { missCount, lastSeenAt } }`.

- [ ] **Step 1: Tests** — extend the test cases below:

Core write-budget tests:
- Hash-based dedup: unchanged record → no `jobs:byid:{id}` write
- Hash diff: changed record → write
- `jobs:index` slim record (id/specialty/state/length/rateLow/rateHigh/callType only — assert size ≤ 500KB at 1000-listing scale)
- `jobs:by:specialty:{slug}` updates correctly
- `jobs:by:state:{ST}` updates correctly
- `jobs:byid:{id}` full record stored separately
- `jobs:_meta.hashes` persisted across runs (read at Worker start, write at end)
- `jobs:_meta.unknownSpecialties[]` deduped + capped at 200 entries

Stale-lifecycle tests (Codex r1 NO-GO #3 fold + Codex r2 NO-GO #3 expansion):
- **1-miss retain (r2 #3 fix):** listing seen in sync N but absent in sync N+1 → `lifecycle[id].missCount === 1`, listing remains in `jobs:byid` (NO rewrite — read-but-don't-write), AND remains in `jobs:index` with `_stale: false`, AND remains in `jobs:by:specialty:{slug}` AND `jobs:by:state:{ST}` with `_stale: false`
- 2-miss → stale: listing absent in sync N+1 AND N+2 → `lifecycle[id].missCount === 2`, `jobs:byid:{id}` updated to include `_stale: true`, still appears in `jobs:index` with `_stale: true` flag (UI renders "Updated N hours ago" microtype), still in by-specialty/by-state aggregates
- Listing returns in sync N+3 (after 1 miss) → `missCount` resets to 0, `_stale: false`, `_lastSeenAt` updated
- Listing absent for N+1 + N+2 + 24h since last `_lastSeenAt` elapsed → `jobs:byid:{id}` deleted, removed from `jobs:index`, removed from `jobs:by:specialty:*` and `jobs:by:state:*`, `lifecycle[id]` deleted from meta
- Listing absent for N+1 + N+2 but only 12h since `_lastSeenAt` → still in KV (24h grace not yet elapsed), `_stale: true`
- Boundary: listing JUST missed cutoff (24h - 1s) → still in KV; listing JUST past (24h + 1s) → dropped

Hash-diff aggregate-write tests (NEW — Codex r2 AMBER #4 fold):
- `jobs:index` content unchanged across sync N and N+1 (same listings, same data) → KV.put('jobs:index') NOT called in N+1 (assert via mock spy)
- `jobs:by:specialty:crna` content unchanged → KV.put NOT called for that key on N+1
- `jobs:by:state:CA` content unchanged → KV.put NOT called for that key on N+1
- Specialty/state key transitions to empty (last listing for that slug dropped) → KV.delete called for that key, hash entry removed from `meta.aggregateHashes`
- **Write-budget bound:** 200-listing fixture, 5% churn (~10 listings change per cycle) → total writes per cycle ≤ 25 (assert ≤ 25 to leave 1k/day headroom: 24 cycles × 25 = 600/day)
- **Day-1 cold-start burst:** empty KV at start, 200-listing fixture → first-cycle writes ≤ 240 (200 byid + 1 index + ~6 specialty + ~30 state + 1 meta + 1-2 retries headroom = 238 nominal + 2 headroom)

- [ ] **Step 2: Implement** — `syncToKv(kv, listings, unknownSpecialties): SyncStats`. Logic:

```ts
import type { NormalizedListing } from './normalize';

const STALE_AFTER_MISSES = 2;
const DROP_AFTER_GRACE_MS = 24 * 60 * 60 * 1000;

interface LifecycleEntry {
  missCount: number;
  lastSeenAt: string; // ISO
}

interface MetaRecord {
  lastSyncAt: string;
  lastSyncDurationMs: number;
  syncErrorCount: number;
  unknownSpecialties: string[];
  hashes: Record<string, string>;
  /** SHA-256 hex of last-written JSON for each aggregate KV key (jobs:index + jobs:by:*).
   *  Used to skip writes when content unchanged. (Codex r2 AMBER #4 fold) */
  aggregateHashes: Record<string, string>;
  lifecycle: Record<string, LifecycleEntry>;
}

export interface SyncStats {
  totalSeen: number;
  written: number;
  staleMarked: number;
  dropped: number;
  unknownSpecialties: string[];
  durationMs: number;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashListing(l: NormalizedListing): Promise<string> {
  return sha256Hex(JSON.stringify({
    id: l.id, title: l.title, specialty: l.specialty, state: l.state,
    rateLow: l.rateLow, rateHigh: l.rateHigh, schedule: l.schedule,
    callType: l.callType, lengthCategory: l.lengthCategory,
    facilityType: l.facilityType,
  }));
}

/** Hash-diff aggregate-write helper (Codex r2 AMBER #4 fold).
 *  Records the new hash in `nextHashes` regardless. Writes only when content differs from `prevHashes`.
 *  Returns true iff a write occurred. */
async function putIfChanged(
  kv: KVNamespace,
  key: string,
  json: string,
  prevHashes: Record<string, string>,
  nextHashes: Record<string, string>,
): Promise<boolean> {
  const hash = await sha256Hex(json);
  nextHashes[key] = hash;
  if (prevHashes[key] === hash) return false;
  await kv.put(key, json);
  return true;
}

const SLIM_KEYS: (keyof NormalizedListing | '_stale')[] = [
  'id', 'specialty', 'state', 'lengthCategory', 'rateLow', 'rateHigh', 'callType', '_stale',
];

function slim(l: NormalizedListing, stale: boolean): Record<string, unknown> {
  return Object.fromEntries(SLIM_KEYS.map((k) => [k, k === '_stale' ? stale : (l as any)[k]]));
}

export async function syncToKv(
  kv: KVNamespace,
  listings: NormalizedListing[],
  unknownSpecialties: string[],
): Promise<SyncStats> {
  const start = Date.now();
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const meta = (await kv.get<MetaRecord>('jobs:_meta', 'json')) ?? {
    lastSyncAt: '', lastSyncDurationMs: 0, syncErrorCount: 0,
    unknownSpecialties: [], hashes: {}, aggregateHashes: {}, lifecycle: {},
  };
  // Backfill aggregateHashes on legacy meta records that pre-date the r2 fold
  meta.aggregateHashes ??= {};

  const currentIds = new Set(listings.map((l) => l.id));
  const previousIds = new Set(Object.keys(meta.lifecycle));

  // 1. Drop pass — find IDs that have exceeded grace and delete from all KV indexes
  const toDrop: string[] = [];
  for (const id of previousIds) {
    if (currentIds.has(id)) continue; // listing returned; skip drop
    const lc = meta.lifecycle[id];
    if (!lc) continue;
    const ageMs = nowMs - new Date(lc.lastSeenAt).getTime();
    if (lc.missCount >= STALE_AFTER_MISSES && ageMs > DROP_AFTER_GRACE_MS) {
      toDrop.push(id);
    }
  }
  for (const id of toDrop) {
    await kv.delete(`jobs:byid:${id}`);
    delete meta.hashes[id];
    delete meta.lifecycle[id];
  }

  // 2. Absence pass (Codex r2 NO-GO #3 fold) — IDs absent this sync get missCount++.
  //    missCount === 1 → KEEP ACTIVE in aggregate indexes (NO _stale flag, NO byid rewrite).
  //    missCount >= 2 → flip _stale on byid record, include in slim index with _stale: true.
  const stalePayloadById = new Map<string, NormalizedListing>();
  const oneMissPayloadById = new Map<string, NormalizedListing>();
  for (const id of previousIds) {
    if (currentIds.has(id)) continue;
    if (toDrop.includes(id)) continue;
    const lc = meta.lifecycle[id];
    if (!lc) continue;
    lc.missCount += 1;
    const prev = await kv.get<NormalizedListing>(`jobs:byid:${id}`, 'json');
    if (!prev) continue; // already gone (defensive)
    if (lc.missCount >= STALE_AFTER_MISSES) {
      const updated: NormalizedListing = { ...prev, _stale: true };
      await kv.put(`jobs:byid:${id}`, JSON.stringify(updated));
      stalePayloadById.set(id, updated);
    } else {
      // missCount === 1 — listing stays alive in aggregates without _stale flag.
      // Do NOT rewrite byid (saves a write).
      oneMissPayloadById.set(id, prev);
    }
  }

  // 3. Active-write pass — current listings update lifecycle, write changed records
  const newHashes: Record<string, string> = { ...meta.hashes };
  let written = 0;
  for (const l of listings) {
    const lc = meta.lifecycle[l.id];
    meta.lifecycle[l.id] = { missCount: 0, lastSeenAt: nowIso };
    const hash = await hashListing(l);
    newHashes[l.id] = hash;
    if (lc && meta.hashes[l.id] === hash) continue; // unchanged
    await kv.put(`jobs:byid:${l.id}`, JSON.stringify({ ...l, _lastSeenAt: nowIso, _stale: false }));
    written++;
  }

  // 4. Build slim index — active + 1-miss-retained (both _stale=false) + 2-miss-stale (_stale=true at end).
  //    Hash-diff aggregate write (Codex r2 AMBER #4 fold) — only put when content changed.
  const nextAggregateHashes: Record<string, string> = {};
  const indexJson = JSON.stringify([
    ...listings.map((l) => slim(l, false)),
    ...[...oneMissPayloadById.values()].map((l) => slim(l, false)),
    ...[...stalePayloadById.values()].map((l) => slim(l, true)),
  ]);
  if (indexJson.length > 500_000) {
    console.warn(`jobs:index size ${indexJson.length} exceeds 500KB cap`);
  }
  if (await putIfChanged(kv, 'jobs:index', indexJson, meta.aggregateHashes, nextAggregateHashes)) {
    written++;
  }

  // 5. By-specialty + by-state — rebuild from active + 1-miss + stale, hash-diff per key,
  //    delete previously-tracked aggregate keys whose listing-set is now empty.
  const indexLive: NormalizedListing[] = [
    ...listings,
    ...oneMissPayloadById.values(),
    ...stalePayloadById.values(),
  ];
  const bySpecialty: Record<string, NormalizedListing[]> = {};
  const byState: Record<string, NormalizedListing[]> = {};
  for (const l of indexLive) {
    (bySpecialty[l.specialty] ??= []).push(l);
    (byState[l.state] ??= []).push(l);
  }
  const presentSpecialtyKeys = new Set(Object.keys(bySpecialty).map((k) => `jobs:by:specialty:${k}`));
  const presentStateKeys = new Set(Object.keys(byState).map((k) => `jobs:by:state:${k}`));
  for (const key of Object.keys(meta.aggregateHashes)) {
    if (key === 'jobs:index') continue;
    if (key.startsWith('jobs:by:specialty:') && !presentSpecialtyKeys.has(key)) {
      await kv.delete(key);
      // Do not carry hash forward — key is gone.
    } else if (key.startsWith('jobs:by:state:') && !presentStateKeys.has(key)) {
      await kv.delete(key);
    }
  }
  for (const [k, v] of Object.entries(bySpecialty)) {
    if (await putIfChanged(kv, `jobs:by:specialty:${k}`, JSON.stringify(v), meta.aggregateHashes, nextAggregateHashes)) {
      written++;
    }
  }
  for (const [k, v] of Object.entries(byState)) {
    if (await putIfChanged(kv, `jobs:by:state:${k}`, JSON.stringify(v), meta.aggregateHashes, nextAggregateHashes)) {
      written++;
    }
  }

  // 6. Update meta — always written because lastSyncAt advances each cycle (24/day max).
  const updatedMeta: MetaRecord = {
    lastSyncAt: nowIso,
    lastSyncDurationMs: Date.now() - start,
    syncErrorCount: meta.syncErrorCount,
    unknownSpecialties: [...new Set([...meta.unknownSpecialties, ...unknownSpecialties])].slice(0, 200),
    hashes: newHashes,
    aggregateHashes: nextAggregateHashes,
    lifecycle: meta.lifecycle,
  };
  await kv.put('jobs:_meta', JSON.stringify(updatedMeta));
  written++;

  return {
    totalSeen: listings.length,
    written,
    staleMarked: stalePayloadById.size,
    dropped: toDrop.length,
    unknownSpecialties,
    durationMs: Date.now() - start,
  };
}
```

**Worst-case write budget (Codex r2 AMBER #4 + r3 AMBER #1 reconciled math — 200-listing fixture):** Steady state with 200-listing fixture + ~5% churn: 24 (`_meta`) + ~10 (`byid` changes) + ~3 (changed specialty aggregates) + ~5 (changed state aggregates) + 1 (`index`) ≈ 43 writes/changed-cycle; with most cycles writing only `_meta` (24/day baseline), total daily ≈ 100-250/day steady. Day-1 cold-start burst: 200 (`byid`) + 1 (`index`) + ~6 (`specialty`) + ~30 (`state`) + 1 (`meta`) = **238 writes one-time** (test bound: ≤ 240 with retry headroom). Both well under 1k/day Workers Free cap.

This requires extending `NormalizedListing` (in PA4) to include optional `_stale?: boolean` and optional `_lastSeenAt?: string` fields. Update PA4's normalize() to NOT set these on output (they're managed by kv-writer); the PA4 type union just allows them to be present after kv-writer enriches.

- [ ] **Step 3: Codex review**

Prompt: "Review workers/jobs-sync/src/kv-writer.ts. Verify: (1) **1-miss retain (Codex r2 NO-GO #3):** missCount=1 listings remain in `jobs:index`, `jobs:by:specialty:*`, `jobs:by:state:*` with `_stale: false` AND `jobs:byid:{id}` is NOT rewritten (oneMissPayloadById path). (2) Stale-lifecycle matches spec §3.4 lines 408-410 + 467-468 (2-miss → flip _stale on byid + include in slim-index/by-* with _stale:true; 24h-after-lastSeenAt + ≥2 misses → drop). (3) missCount resets to 0 when listing returns; lastSeenAt advances. (4) Drop pass deletes byid + meta.hashes + meta.lifecycle entry — confirm no strand. (5) **Hash-diff aggregate writes (Codex r2 AMBER #4):** putIfChanged writes only when SHA-256 hex differs; nextAggregateHashes accumulates ALL aggregate keys this cycle (whether written or not); previously-tracked aggregates with empty listing-sets are kv.delete'd; meta.aggregateHashes round-trips legacy nullish field via `??= {}`. (6) Worst-case write budget: 200-listing + 5% churn ≤ 43 writes/changed-cycle, 200-listing cold start = 238 writes (test bound ≤ 240) one-time, both under 1k/day. (Codex r3 AMBER #1 reconciliation — all four locations now state 200-listing fixture.) (7) jobs:index size cap 500KB warn-only. (8) Concurrency: cron-only writer (one Worker invocation at a time) — KV eventual consistency tolerable. (9) lifecycle entry creation for never-seen-before IDs (first sync — verify entry written via active-write loop)."

- [ ] **Step 4: Commit**

```bash
git add workers/jobs-sync/src/kv-writer.ts workers/jobs-sync/tests/kv-writer.test.ts
git commit -m "feat(1.A · Path A): kv-writer with 2-miss/24h-grace lifecycle + hash-diff aggregate writes (Codex r1 NO-GO #3 + r2 NO-GO #3 + r2 AMBER #4) [runtime-verified] [codex-reviewed: r1 GO + r2 NO-GO 1+1+0 → r3 GO]"
```

---

### PA6: TDD `workers/jobs-sync/src/index.ts`

**Files:** `workers/jobs-sync/src/index.ts` + tests

**Codex review:** MANDATORY

- [ ] **Step 1: Implement scheduled + fetch handlers**

```ts
import { normalize, type RawListing, type NormalizedListing } from './normalize';
import { syncToKv } from './kv-writer';

export interface Env {
  JOBS_KV: KVNamespace;
  LS_FEED_BASE_URL: string;
  LS_FEED_AUTH_TOKEN: string;
}

async function fetchFeed(env: Env): Promise<RawListing[]> {
  const resp = await fetch(`${env.LS_FEED_BASE_URL}/jobs`, {
    headers: { authorization: `Bearer ${env.LS_FEED_AUTH_TOKEN}` },
  });
  if (!resp.ok) throw new Error(`LS feed HTTP ${resp.status}`);
  return await resp.json() as RawListing[];
}

async function runSync(env: Env): Promise<{ ok: boolean; stats?: any; error?: string }> {
  try {
    const raw = await fetchFeed(env);
    const nowIso = new Date().toISOString();
    const normalized: NormalizedListing[] = [];
    const unknown: string[] = [];
    for (const r of raw) {
      const result = normalize(r, nowIso);
      if (result.listing) normalized.push(result.listing);
      if (result.unknownSpecialty) unknown.push(result.unknownSpecialty);
    }
    const stats = await syncToKv(env.JOBS_KV, normalized, unknown);
    return { ok: true, stats };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default {
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env).then((r) => {
      if (!r.ok) console.error(`[jobs-sync] cron failed:`, r.error);
      else console.log(`[jobs-sync] wrote ${r.stats.written}/${r.stats.totalSeen} in ${r.stats.durationMs}ms`);
    }));
  },
  async fetch(req: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === '/run' && req.headers.get('x-trigger-secret') === env.LS_FEED_AUTH_TOKEN) {
      const r = await runSync(env);
      return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('jobs-sync — see /run with x-trigger-secret header', { status: 404 });
  },
};
```

- [ ] **Step 2: Tests** — mock fetchFeed; assert scheduled handler increments stats; /run gates by header.

- [ ] **Step 3: Codex review** — Prompt: "ctx.waitUntil ensures cron sync completes after handler returns; error path logged-not-thrown; manual /run gated by x-trigger-secret == LS_FEED_AUTH_TOKEN (header-based auth — consider rotating token if shared with LS feed creds)."

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(1.A · Path A): jobs-sync Worker entrypoint (scheduled + fetch + auth-gated /run) [runtime-verified] [codex-reviewed: r1 GO]"
```

---

### PA7: Set Worker secret `LS_FEED_AUTH_TOKEN`

- [ ] `cd workers/jobs-sync && npx wrangler secret put LS_FEED_AUTH_TOKEN` — paste the LS-provided auth token.

(no commit)

---

### PA8: Deploy Worker; observe one full cron cycle clean

- [ ] `cd workers/jobs-sync && npx wrangler deploy`
- [ ] `npx wrangler tail` — wait for next top-of-hour cron. Confirm log line `[jobs-sync] wrote N/M in Xms`.
- [ ] Cloudflare dashboard → KV → IMS_JOBS — confirm keys appear: `jobs:index`, `jobs:_meta`, `jobs:by:specialty:*`, `jobs:by:state:*`, `jobs:byid:*`.

---

### PA9: Create `src/pages/api/jobs.ts` (KV reader)

**Files:** `src/pages/api/jobs.ts`

**Codex review:** MANDATORY

```ts
import type { APIContext } from 'astro';

export const prerender = false;

export async function GET(context: APIContext): Promise<Response> {
  const env = (context.locals as any).runtime?.env ?? {};
  const kv = env.JOBS_KV as KVNamespace | undefined;
  if (!kv) return j(503, { error: 'JOBS_KV not bound' });

  const params = context.url.searchParams;
  const specialty = params.get('specialty');
  const state = params.get('state');

  let listings: any[] = [];
  if (specialty) listings = (await kv.get(`jobs:by:specialty:${specialty}`, 'json')) ?? [];
  else if (state) listings = (await kv.get(`jobs:by:state:${state}`, 'json')) ?? [];
  else listings = (await kv.get('jobs:index', 'json')) ?? [];

  const meta = (await kv.get('jobs:_meta', 'json')) ?? null;
  return j(200, { jobs: listings, _meta: meta });
}

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' },
  });
}
```

- [ ] Codex review + commit.

```bash
git commit -m "feat(1.A · Path A): /api/jobs KV reader [runtime-verified] [codex-reviewed: r1 GO]"
```

---

### PA10: Modify `src/pages/jobs/index.astro` to switch on `PUBLIC_PATH_A` (build-time)

> **Codex r1 NO-GO #2 fold:** spec §0.5.1 line 26 + §3.4 lines 455-460 require Path B `/jobs` to be SSG. Earlier draft used `export const prerender = false` unconditionally, which would have regressed Path B to SSR. Fix: `prerender` evaluates the build-time env flag. When `PUBLIC_PATH_A=true` at build, Astro emits SSR for `/jobs`; when unset/false (Path B default), Astro pre-renders `/jobs` to static HTML at build time. Switching paths becomes a build-and-redeploy operation (acceptable — both Path A activation and Path A→B fallback already imply a redeploy).

- [ ] **Step 1: Make `prerender` build-time conditional**

In `src/pages/jobs/index.astro`, replace the existing `export const prerender = false` (or absence thereof) with:

```ts
// Path B (default) prerenders to SSG; Path A SSRs against KV.
// Astro evaluates `import.meta.env` at build time so this is statically resolved.
export const prerender = import.meta.env.PUBLIC_PATH_A !== 'true';
```

- [ ] **Step 2: Make data-fetch path-aware**

In the same `<script>` frontmatter, branch the `active` listings source on the same flag — but DO NOT use a runtime conditional that breaks SSG. Instead, define both branches as separate top-level `await` calls and let dead-code-elimination drop the unused branch when `prerender = true`:

```ts
const isPathA = import.meta.env.PUBLIC_PATH_A === 'true';

let active: any[];
if (isPathA) {
  // Path A: SSR — read KV at request time
  const env = (Astro.locals as any).runtime?.env;
  active = env?.JOBS_KV ? (await env.JOBS_KV.get('jobs:index', 'json')) ?? [] : [];
} else {
  // Path B: SSG — read Content Collection at build time
  const { getCollection } = await import('astro:content');
  const all = await getCollection('jobs');
  const now = new Date();
  active = all
    .filter((j) => !j.data.expiresAt || j.data.expiresAt > now)
    .sort((a, b) => +b.data.publishedAt - +a.data.publishedAt)
    .map((j) => ({ slug: j.slug, ...j.data }));
}
```

When `prerender = true`, the `if (isPathA)` branch is unreachable and Astro/Vite can tree-shake it. The page emits to `dist/jobs/index.html` as static. When `prerender = false`, both branches compile but only the `isPathA = true` branch executes at runtime.

- [ ] **Step 3: Set env var when activating Path A**

In Cloudflare Pages → Settings → Environment variables → Production AND Preview:
- `PUBLIC_PATH_A=true` (set ONLY after PA8 confirms clean Worker cron cycle)

After setting, trigger a fresh deploy (Cloudflare Pages → Deployments → Retry last deployment). The new build picks up the env var and emits SSR for `/jobs`.

To roll back to Path B: unset `PUBLIC_PATH_A` (or set to `false`), retry deployment. The new build emits SSG for `/jobs` again. This is the Path A → Path B fallback procedure documented in PA12.

- [ ] **Step 4: Verify both paths build cleanly**

Run two builds locally, observe output:

```bash
PUBLIC_PATH_A=false npm run build
ls dist/jobs/index.html        # expect file (SSG output)

PUBLIC_PATH_A=true npm run build
ls dist/jobs/                   # expect SSR endpoint, NO index.html in dist (or empty dir)
```

Astro emits SSR routes as Functions; static routes as `dist/<route>/index.html`. Confirm both shapes.

- [ ] **Step 5: Codex review**

Prompt: "Review src/pages/jobs/index.astro Path A/B switch. Verify: `prerender` is build-time evaluated (`import.meta.env.PUBLIC_PATH_A !== 'true'`), not runtime; both data-fetch branches compile but only the active one runs (Astro tree-shakes the unreachable branch when prerender=true); fallback to Path B requires unsetting env + redeploying (matches PA12 fallback doc); /api/jobs (PA9) is similarly Path-A-only and PA9's prerender flag should align — flag if PA9 missing the same conditional pattern."

- [ ] **Step 6: Commit**

```bash
git add src/pages/jobs/index.astro
git commit -m "feat(1.A · Path A): /jobs build-time prerender conditional (Path B SSG default; Path A SSR when PUBLIC_PATH_A=true; Codex r1 NO-GO #2 fix) [runtime-verified] [codex-reviewed: r1 GO]"
```

---

### PA11: E2E smoke — feed write → KV → /jobs render

- [ ] `curl -H "x-trigger-secret: $LS_FEED_AUTH_TOKEN" https://ims-jobs-sync.<account>.workers.dev/run` — verify 200 + stats.
- [ ] Verify `jobs:index` updated in KV dashboard.
- [ ] Visit `/jobs` on preview deploy. Confirm Path A listings render. Confirm filter behavior identical to Path B.

---

### PA12: Document Path A → Path B fallback procedure

- [ ] Append to `DEPLOY.md`:

```markdown
### Path A → Path B fallback

If LS pipeline breaks (Worker fails repeatedly, LS API auth revoked, KV corruption):

1. Cloudflare Pages → Settings → Environment variables → set `PUBLIC_PATH_A=false` for Production.
2. Trigger redeploy (push no-op commit OR Cloudflare dashboard → Deployments → Retry deployment).
3. /jobs falls back to Content Collection (Path B). Recruiter team updates `src/content/jobs/` until pipeline restored.
4. Investigate Worker logs via `wrangler tail` from `workers/jobs-sync/`. Common causes:
   - LS feed schema change → update `normalize.ts`
   - LS rate-limit / IP block → contact LS admin
   - KV namespace deletion → re-provision per PA2
5. Re-flip `PUBLIC_PATH_A=true` once Worker confirmed healthy.
```

- [ ] Commit.

```bash
git commit -m "docs(1.A · Path A): document Path A → Path B fallback [logically-inspected] [codex-skip: doc note]"
```

---

## Phase 1.A — Pre-Launch Verification

### T56: E2E smoke — `/api/contact` happy path (valid Turnstile)

- [ ] **Step 1:** In a real browser (Turnstile token must be issued by the widget — automated curl can't generate one), open preview `/contact`, fill form, submit.
- [ ] **Step 2: Verify**
  - HTTP 200 response in DevTools Network panel
  - Response body `{ ok: true }`
  - Supabase Studio → `ims_contact_messages` → most-recent row has all fields populated, `resend_status='sent'` within 1-2s of submit
  - Recruiting inbox received the email
- [ ] **Step 3:** Mark complete (no commit)

---

### T57: E2E smoke — `/api/apply` happy path

- [ ] Same as T56 but on apply modal triggered from a `/jobs` card. Verify additional fields: `phone`, `npi` (if filled), `licenses` array, `job_ref`, `job_title`. Email subject contains the `jobTitle`. UI shows confirmation copy from spec §3.3 step 5.

---

### T58: E2E smoke — invalid Turnstile (4xx, no Supabase row, no Resend)

- [ ] **Manual:** Edit DOM to corrupt Turnstile hidden input value before submit. Server returns 403; no Supabase row created (verify in Studio); no email sent (verify in Resend logs).

---

### T59: E2E smoke — rate-limit hit

- [ ] Submit 4 valid contact-form submissions within 10min from same IP. Disable bypass: temporarily clear `IMS_RATE_BYPASS_KEY` in Pages env OR don't send the bypass header. The 4th returns 429 with `Retry-After`. UI shows *"You're submitting a bit fast..."* per spec §3.3.

---

### T60: E2E smoke — forced Resend failure

- [ ] **Step 1:** Temporarily corrupt `RESEND_API_KEY` in Pages env (set to `invalid-key`).
- [ ] **Step 2:** Submit `/api/apply`. Verify:
  - HTTP 200 (row is source of truth)
  - Supabase row created with `resend_status='failed'`, `resend_error` populated
  - Email NOT sent (Resend dashboard shows no recent activity)
- [ ] **Step 3:** Restore valid `RESEND_API_KEY`.

---

### T61: Lighthouse ≥95 on `/`, `/clinicians`, `/facilities`, `/jobs`, `/about`

- [ ] **Step 1:** Run Lighthouse on production-build preview deploy. Each page must score ≥95 on Performance / Accessibility / Best Practices / SEO.
- [ ] **Step 2:** Fix highest-impact issues per page until clean. Common fixes:
  - Image without `loading="lazy"` → add
  - Missing `alt` on illustrations → add (or `role="presentation"` for decorative)
  - Heading hierarchy issue → adjust h-levels
  - Color contrast fails → use approved variant from T54 audit table
- [ ] **Step 3:** Record final scores per page in launch-ticket comment.

---

### T62: Pre-deploy hard checks 1-12 walkthrough

- [ ] Walk each HC in the Pre-Launch Checklist below. Verify each one with the listed task references + commands. Capture outcomes in launch-ticket comment. Any "fail" → block T65 launch tag until fixed.

---

### T63: Pre-deploy soft gates 13-17 walkthrough

- [ ] Confirm Zach action status for each SG:
  - SG13 leadership cards — placeholder green-lit OR real data?
  - SG14 DNSSEC DS record — set at Namecheap?
  - SG15 legal pages reviewed?
  - SG16 LS authorization — Path A or Path B locked?
  - SG17 final copy review — done by Zach?

Any "no" → block launch tag T65. Loop back until all green.

---

### T64: DNSSEC DS record at Namecheap

> **🚨 Zach action — spec §10 item 1 + §5 SG14**

- [ ] Namecheap → Domain List → Manage `iastaffing.com` → Advanced DNS → DNSSEC tab.
- [ ] Add DS record: Key Tag `2371`, Algorithm `13`, Digest Type `2`, Digest `E87E0FAA4A721D1DB10ECD41DE219002F4988B65DF61D51C65C93074C3E951E3`.
- [ ] Wait propagation (up to 24-48h). Verify via `dig +dnssec iastaffing.com DNSKEY` and https://dnsviz.net/d/innovativemedicalstaffing.com/.

---

### T65: Launch — preview → main → tag `v1.0.0-launch` → GitHub Release

**Files:** none (release workflow)

**Codex review:** N/A (this is process; code already Codex-cleaned per task)

- [ ] **Step 1: Final preview smoke**

`git push origin feat/ims-phase-1-plan` if not pushed. Cloudflare Pages → Preview deploys → click latest. Walk through every page (T29 routine). Run T56-T60 smokes against preview env.

- [ ] **Step 2: Open PR, merge to `main`**

PR title: `Phase 1 Launch — first indexable IMS website`. Body summarizes scope (Phase 1.0 + 1.A delivered, what's deferred to 1.5+, §10 open items resolved). Codex final review + Zach approval. Squash-merge or merge-commit per repo convention.

- [ ] **Step 3: Tag the launch commit**

```bash
git checkout main && git pull
git tag -a v1.0.0-launch -m "IMS Phase 1.A launch — first indexable site

12 hard checks + 5 soft gates passed. Path B Content Collection ships;
Path A migrated to Phase 1.5 plan if LS auth not granted.

Spec: docs/specs/2026-05-05-ims-website-phase-1-design.md (HEAD e019b5e baseline)
Plan: docs/plans/2026-05-06-ims-website-phase-1-plan.md"
git push origin v1.0.0-launch
```

- [ ] **Step 4: Cloudflare Pages production deploy**

Cloudflare Pages auto-deploys main on push. Verify:
- `https://innovativemedicalstaffing.com` resolves
- Live page is the marketing home, NOT maintenance
- `curl -I https://innovativemedicalstaffing.com/robots.txt` — body shows `Allow: /` + `Sitemap:` line
- `curl -I https://innovativemedicalstaffing.com` — no `X-Robots-Tag` header
- DevTools `<head>` no `<meta name="robots" content="noindex">`

- [ ] **Step 5: GitHub Release**

GitHub → Releases → Draft new release. Tag = `v1.0.0-launch`. Title = `Phase 1 Launch — IMS Website (1.0 + 1.A)`. Body summarizes shipped scope + §10-deferred items + Phase 1.5 backlog reference.

- [ ] **Step 6: Post-launch validation window setup**

Calendar reminder for launch+7d: check Plausible for goal fires (`cta_find_opportunities`, `cta_request_coverage`, `application_submitted`, `contact_form_submitted` — at least 1 of each per spec §8). If 0 of any: investigate. Plus: GSC verification, sitemap submission, Schema.org Rich-Results validation.

- [ ] **Step 7: Stamp + memo**

```bash
bash ~/.claude/hooks/review-gate.sh --stamp
```

Update `~/.claude/projects/.../memory/projects/` with launch memo summarizing what shipped + what's still §10-deferred.

---



## Pre-Launch Checklist

This section mirrors spec §5 Phase 1.A `pre-deploy hard checks` (machine-verifiable) + `pre-deploy soft gates` (human approval). **All 12 hard checks + 5 soft gates must pass before tagging `v1.0.0-launch`.** Tasks T62 + T63 walk through this checklist.

### Hard checks (machine-verifiable)
- [ ] **HC1** `functions/_middleware.js` CSP replaced per §0.5.3; `X-Robots-Tag: noindex, nofollow` REMOVED from line 20 (T9 + T15)
- [ ] **HC2** `public/_headers` no longer contains `X-Robots-Tag` line (T16)
- [ ] **HC3** `public/robots.txt` reads `User-agent: *\nAllow: /\nSitemap: https://innovativemedicalstaffing.com/sitemap.xml`; `public/_redirects` 301s `/sitemap.xml → /sitemap-index.xml` (T14)
- [ ] **HC4** `@astrojs/sitemap` integration installed; sitemap excludes `/api/*`, `/og/*`, filtered `/jobs?...` URLs (T1)
- [ ] **HC5** `@astrojs/cloudflare` adapter installed; `output: "hybrid"`. Path B SSR routes built: `/api/apply`, `/api/contact`. Path A (only if active) adds `/jobs`, `/api/jobs` SSR (T1, optional PA10)
- [ ] **HC6** KV namespace `IMS_RATE` provisioned + bound as `RATE_KV`. (Path A only) `IMS_JOBS` provisioned + bound as `JOBS_KV` + Worker `ims-jobs-sync` deployed + 1 clean cron cycle observed (T37, optional PA2/PA8). (Path B only) `src/content/jobs/` populated with ≥10 real listings + recruiter onboarded (T31 confirmation)
- [ ] **HC7** Resend domain `iastaffing.com` SPF + DKIM + DMARC verified; `RESEND_API_KEY` + `RESEND_FROM_*` + `RECRUITING_TO_ADDRESS` env vars set in Pages dashboard (T38 + T39)
- [ ] **HC8** Turnstile site + secret keys provisioned; widget renders on `/contact` + apply modal; server-verify path tested with valid + invalid tokens (T40, T56, T58)
- [ ] **HC9** Supabase tables `ims_applications` + `ims_contact_messages` created with RLS enabled per §0.5.4 SQL; `SUPABASE_SERVICE_ROLE_KEY` env var set in Pages dashboard (T35, T36, T38)
- [ ] **HC10** Lighthouse ≥95 (Performance/A11y/Best Practices/SEO) on sample: `/`, `/clinicians`, `/facilities`, `/jobs`, `/about` (T61)
- [ ] **HC11** Plausible installed (`<head>` snippet) + 4 conversion goals registered: `cta_find_opportunities`, `cta_request_coverage`, `application_submitted`, `contact_form_submitted` (T52). Goal-fire validation moved to post-launch (T65) per spec §5 / §9 row 24
- [ ] **HC12** WCAG AA contrast verified for `--brand-blue` (`#59BFE7`) on cream `#F2E8DC` and on `#1E1E1E`; `--brand-gold-muted` `#B8975B` on cream; navy `#1A2B4A` on cream. Failing pairs swapped or contrast-boosted; decisions in `docs/IAS-Design-System.md` (T54)

### Soft gates (human approval)
- [ ] **SG13** Zach reviewed leadership placeholder cards and either green-lit launch with placeholder OR sent real headshots+names+roles (T24 + T63)
- [ ] **SG14** DNSSEC DS record set at Namecheap (Key Tag 2371, Algo 13, Digest Type 2, Digest `E87E0FAA4A721D1DB10ECD41DE219002F4988B65DF61D51C65C93074C3E951E3`) (T64)
- [ ] **SG15** `/privacy` + `/cookies` + `/terms` Zach-reviewed before launch (T27 + T63)
- [ ] **SG16** LocumSmart authorization status confirmed (Path A or Path B locked per §3.4 default-Path-B rule) (PA1)
- [ ] **SG17** Final copy review pass — designated reviewer (default: Zach) walks all committed copy against brief §21 BANNED list; approval recorded as PR comment (T63)

---

## Risk Register (subset of spec §5 risks that touch execution)

| Risk | Mitigation in this plan |
|---|---|
| `X-Robots-Tag` removal forgotten in one of the two files | T15 + T16 are sibling tasks with explicit `git grep "X-Robots-Tag"` verification step; HC1 + HC2 split on the checklist |
| Apply-form Supabase row written AFTER Resend send (out-of-order failure semantics) | T47 TDD enforces order with explicit test asserting `resend_status='pending'` row exists before Resend call. Codex review MANDATORY |
| Resend send failure crashes 200 response path | T47 TDD test asserts forced Resend failure leaves row at `resend_status='failed'` + returns 200. T60 E2E confirms in deployed environment |
| Rate-limit bypass leaks to production | T42 includes test asserting bypass header `X-IMS-Test-Bypass` only honored when `IMS_RATE_BYPASS_KEY` env var matches; default-empty env fails closed |
| Path A KV write-budget exceeds 1k/day free-tier cap | PA5 uses hash-diff `putIfChanged` for `jobs:index` + `jobs:by:specialty:*` + `jobs:by:state:*` (Codex r2 AMBER #4 fold). Worst-case math (200-listing fixture, reconciled per Codex r3 AMBER #1): ≤ 43 writes/changed-cycle steady state; cold-start = 238 writes one-time (test bound ≤ 240). PA5 TDD asserts upper bound ≤ 25 writes for 5%-churn cycle and ≤ 240 for cold start. PA8 deploy step observes first cycle's actual write count via Cloudflare KV analytics |
| TAY Basal at 96px reads too light | T55 documents validation step at first paint; if fails, Inter Variable 700-900 fallback already wired via T2 (`@fontsource-variable/inter`) — swap is CSS-token change in `tokens.css` `--font-display`, no rebuild of layouts |
| Recruiter Path B onboarding lag delays content | T31 ships placeholder seeds; HC6 (Path B branch) calls out that 10 real listings must replace placeholders before launch; failure mode = launch slips, not breaks |
| Plausible script blocked by CSP | §0.5.3 CSP includes `script-src https://plausible.io` + `connect-src https://plausible.io`; T9 verification step greps both domains in committed CSP |
| Schema.org Organization JSON-LD malformed (Google Rich Results invalid) | T53 includes `https://validator.schema.org/` manual check; failure blocks T65 |
| Pages Functions can't read Supabase service-role key (env-binding mismatch) | T44 connection test runs in `npx wrangler pages dev` with full env binding; failure surfaces before T46/T47 |

---

## Execution Handoff

After plan approval, two execution paths:

**1. Subagent-Driven (recommended)** — Use `superpowers:subagent-driven-development`. I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for plans with this many independent tasks.

**2. Inline Execution** — Use `superpowers:executing-plans`. Execute tasks in this session with batch checkpoints. Better for tight feedback loops on tasks with high coupling (e.g., the api/apply.ts task chain T41–T47).

Recommendation (Codex r3 AMBER #D8 reconciled): **Subagent-Driven for T1–T34, T48–T65** (independent components — pages, sections, forms, telemetry, verification — parallelizable in waves) + **Inline Execution for T35–T47** (Supabase migration → KV → server libs → API routes is a dependency chain that benefits from same-session continuity). **T34 deferred to a wave after T48** (Codex r2 AMBER #14 fold — T34's empty-state TurnstileWidget instance passes `instanceId="jobs-empty-state"` which depends on T48's per-widget-callback wrapper). Path A (PA1–PA12) is a separate single-track execution gated on PA1's decision.

Wave plan for subagent-driven execution:
1. **Wave 1** (no deps): T1, T2, T3, T4, T5, T6, T11, T13 (Phase 1.0 foundation)
2. **Wave 2** (deps Wave 1): T7, T8, T9, T10, T12 (layout + scroll-reveal + CSP)
3. **Wave 3** (Phase 1.A index-flip + nav): T14, T15, T16, T17, T18, T19
4. **Wave 4** (homepage sections + content): T20a-T20j, T31 (parallel-safe)
5. **Wave 5** (T20-batch Codex review + page wire-ups): T20-batch, T21, T22, T23, T24, T25, T26, T27, T28, T29
6. **Wave 6** (job board Path B + forms infra): T30, T32, T33, T48
7. **Wave 7** (T34 + form components — T48 dep met): T34, T49, T50
8. **Wave 8** (Inline backend chain): T35 → T36 → T37 → T38 → T39 → T40 → T41 → T42 → T43 → T44 → T45 → T46 → T47
9. **Wave 9** (Plausible + analytics): T51, T52, T53, T54, T55
10. **Wave 10** (Pre-launch verification): T56, T57, T58, T59, T60, T61, T62, T63, T64
11. **Wave 11** (Launch): T65

Path A (PA1–PA12) runs as Wave-A1 through Wave-A6 in parallel with Waves 6-10, gated on PA1's 2026-05-13 LS authorization decision.

Ask Zach which approach when ready to execute.
