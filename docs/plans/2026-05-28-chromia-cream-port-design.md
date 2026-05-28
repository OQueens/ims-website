# Design Spec — Port IMS Design System V3 ("Chromia-Cream / Magenta Noir") into production

**Date:** 2026-05-28
**Branch:** `feat/ims-phase-1a-content`
**Source kit:** `IMS Design System V3.zip` (Claude Design handoff) → extracted at `C:\Users\oclou\QueenClaude\_ims-v3-extract`
**Status:** Approved by Zach (full pivot, exact kit replication, then iterate)

---

## 1. Goal

Replace the current production "IMS Dark System" with an exact replication of the
Chromia-Cream / Magenta-Noir site Zach designed in Claude Design. The kit's **visual
system is canonical**: cream surface, plum-black ink, dot-grid texture, floating dark
pill nav, Battlefin/Fraunces display, magenta (#C44569) emphasis, butter/rose pastel
accents, dark-ink warm footer.

Decision log (from approval dialogue):
- **Fidelity:** replicate the kit exactly — content and all — then iterate. Demo/fabricated
  content is preserved as-is for now (NOT cleaned), with the launch guardrail in §7.
- **Palette:** Magenta Noir = `colors_and_type.css` base + `palette-active.css` overrides.
  This is what the kit actually renders. The README's aubergine/teal prose is superseded.
- **Jobs:** new kit *layout*, wired to the **existing Supabase SSR + LocumSmart live feed**
  (NOT the kit's fake "124 assignments" demo data). Real `ims_jobs WHERE status='active'`
  stays the data source.
- **Out of scope:** `/how-it-works` and `/specialties` are NOT kit pages — leave the existing
  routes as-is (they inherit new chrome, keep old bodies; revisit later).

## 2. Core approach — faithful re-implementation, not a file-drop

The kit renders via **React 18 + Babel-in-browser (unpkg), Google Fonts `@import`, and
inline `<script>` handlers**. Production forbids all three:
- CSP `script-src 'self'` (+plausible/turnstile) → unpkg React/Babel blocked.
- CSP `font-src 'self'` → Google Fonts blocked.
- Zero-JS marketing architecture (inline dynamism was tried and reverted).

So "exact replication" = a faithful re-implementation that produces the **identical
rendered result**, fit to the production architecture:
- Kit CSS imported **verbatim** (it *is* the design — not re-derived).
- Fonts **self-hosted** (same pixels, CSP-clean).
- Behaviors converted to **CSS-only** or **bundled (self-hosted) scripts** — never inline,
  never CDN.
- React multi-route SPA → real Astro routes (an upgrade, same UX).

This is the only way the live site can be "exactly the one I designed" AND function under
the existing CSP/security posture. No CSP loosening, no security regressions.

## 3. Foundation layer (shared chrome — built first, Phase 1)

### 3.1 Global CSS
Copy the kit stylesheets into `src/styles/`, imported in this cascade order in
`MarketingLayout.astro`:
1. `src/styles/colors_and_type.css` (verbatim, with edits in §3.4 + §3.5)
2. `src/styles/kit.css` (verbatim — 2135 lines, all component classes)
3. `src/styles/palette-active.css` (verbatim — Magenta Noir overrides)

`src/styles/tokens.css` (the dark system) is retired from the layout import. It may be
left on disk temporarily if any not-yet-ported page references it, but the goal is to
remove it once `/how-it-works` and `/specialties` are addressed.

### 3.2 Fonts (self-hosted)
| Family | Source | Action |
|---|---|---|
| Inter 400-700 | `@fontsource-variable/inter` (already a dep) | keep |
| Fraunces (italic emphasis fallback) | add `@fontsource-variable/fraunces` | `npm i`, import in layout |
| JetBrains Mono 400/500 | add `@fontsource/jetbrains-mono` | `npm i`, import in layout |
| Battlefin Bold 700 + Black 900 | self-host (woff2/woff/ttf in kit `fonts/`) | copy to `public/fonts/`, `@font-face` |
| TAY Basal / TAY Amaya | already in `public/fonts/` | keep `@font-face` (verify-build asserts) |

- Remove the Google Fonts `@import` line from `colors_and_type.css`.
- Battlefin `@font-face` src rewritten to absolute `/fonts/Battlefin-*.woff2|woff|ttf`.
- `@fontsource` packages serve same-origin (bundled to `/_astro/…`) → `font-src 'self'` OK.

### 3.3 MarketingLayout
- Body: cream + dot-grid background (move from `colors_and_type.css` `body` rule, or apply
  via `body.marketing`). `color-scheme: light`, `theme-color: #F4ECDF`.
- Drop the dark `main.card` wrapper; pages own full-bleed sectioning (the kit pattern).
  Keep `inCard` as a deprecated no-op for any unported page.
- Preserve EXACTLY: Plausible inline script, Schema.org Organization JSON-LD, `<link
  rel="canonical">`, OG/Twitter meta. (verify-build asserts these in source.)
- Add font preloads for Battlefin Black/Bold + Inter.

### 3.4 verify-build reconciliation (must stay green)
`scripts/verify-build.mjs` asserts these tokens exist in bundled CSS — add as aliases in
`colors_and_type.css` `:root`:
- `--bg` (already present = `var(--cream)`)
- `--text` → `var(--ink)`
- `--surface-card` → `var(--cream-soft)`
- `--surface-page` → `var(--cream)`
- `--brand-blue` → `var(--ims-cyan)`
- `--ink-on-cream` → `var(--ink)`
- `--ink-on-dark` → `var(--cream-soft)`
- System font present: Inter is in `--font-body` → satisfied.
- TAY `@font-face` blocks: keep both (family + `TAYBasalRegular` / `TAYAmaya.woff` src
  co-located in the same block — the kit's blocks already satisfy the regex).
- Icons ≤ 8 in `src/assets/icons/`: kit uses inline Lucide SVGs in markup (not files in
  that dir) → cap unaffected. Do not add SVG files there.
- Orphan check: EVERY page in `src/pages/` must render `<MarketingLayout`. All ported pages
  do; `/how-it-works`, `/specialties`, legal pages must keep rendering it too.

### 3.5 Missing token note (kit bug to fix during port)
`colors_and_type.css` references `--ink-aubergine` and `--ink-teal` (links `:hover`,
`::selection`, `.section--ink em`) but never defines them in `:root`. `palette-active.css`
doesn't define them either. During the port, define them (map to the Magenta-Noir family,
e.g. `--ink-aubergine: var(--pop-magenta)`; `--ink-teal: var(--pop-magenta)`) so hover/
selection states resolve. Honor "what renders": confirm against the kit's actual computed
fallback before finalizing.

### 3.6 SiteNav → floating pill `topnav`
Replicate the kit `TopNav`: dark-ink pill, `position: sticky; top: 16px`, logo
(`ims-logo-light.png`), links Facilities / Clinicians / About Us / Job Board, coral puck
"Get in touch" CTA → `/contact`. `aria-current` on active route (derive from
`Astro.url.pathname`). **Drop** the JS hide-on-scroll (zero-JS) — nav stays sticky/visible.
Skip-to-content link retained.

### 3.7 SiteFooter → dark-ink `footer-b`
Replicate the kit `Footer`: dark-ink, coral/butter blobs (CSS, `aria-hidden`), eyebrow
"Get in touch", sign-off "Let's place you *somewhere good*." (kit Footer.jsx uses "The
place to be is right here." — **use the locked brief string "Let's place you *somewhere
good*."** per brand brief; flag the discrepancy for Zach). Newsletter (native form),
4-col sitemap, copyright, LinkedIn/Instagram social pills. Sitemap keeps How-it-works /
Specialties links pointed at the existing routes so nothing 404s.

## 4. Pages (Phases 2-4)

Each page = kit markup ported verbatim into `.astro` under `MarketingLayout`, full-bleed.
Content replicated exactly (per §7 guardrail).

| Route | Kit source | Section flow |
|---|---|---|
| `/` (home) | `ui_kits/website/*` | Hero (center, rotating word) → Marquee → Positioning stats → AudienceSplit → CompareStrip → CTABand → ProcessSteps → SpecialtyGrid → ValuesGrid → ContactForm |
| `/clinicians` | `page-variations/clinicians.html` (C) | Hero → 4-step timeline → Why grid (4) → Quotes (3) → CTA |
| `/facilities` | `page-variations/facilities.html` (B+C) | Hero → Marquee → 3-pillar grid → Quotes (3) → CTA |
| `/about` | `page-variations/about.html` (B+C) | Hero → Mission → 3 principles → Team grid → Stats |
| `/jobs` | `page-variations/jobs.html` (B) layout + **real Supabase data** | Hero → search + specialty chips → live card grid → empty state |
| `/contact` | `variations/contact.html` (B) | split butter panel: info + form (POST `/api/contact`) |
| `/privacy` `/terms` `/cookies` | `Legal.jsx` | cream legal-page layout |

Page-specific `<style>` blocks from each variation HTML are ported into the corresponding
`.astro` component `<style>` (scoped). Shared classes resolve from `kit.css`.

## 5. Behavior conversion (kit JS → production-safe, zero-JS-first)

| Kit behavior | Production approach |
|---|---|
| Rotating hero word | CSS-only keyframe cycle (stacked words, opacity), reduced-motion safe |
| Scroll-reveal (IntersectionObserver) | CSS scroll-driven animation (`animation-timeline: view()`) w/ reduced-motion fallback; or omit (brief is "static-first") |
| Nav hide-on-scroll | Dropped (sticky, always visible) |
| Blob float / puck rotate / marquee scroll | Kept as-is (pure CSS animations) |
| Contact form submit + "Sent." state | Native POST to existing `/api/contact`; success via server response / thank-you state |
| Jobs search + specialty chips | **Server-side via URL query params** (form GET, page reload) over real Supabase data — zero-JS. (Confirm exact filter UX in Phase 3.) |
| Tweaks panel, React Router | Dropped (dev tooling → real Astro routes) |

## 6. Jobs page data wiring (Phase 3 detail)

- Keep the existing SSR query (`ims_jobs WHERE status='active'`, `prerender=false`,
  routes through `_worker.js`).
- Render real rows into the kit's colored specialty-card grid (`.jb-b__card--{spec}`).
- Specialty chips + search → server-side filter via querystring (e.g.
  `/jobs?spec=anesthesia&q=austin`), form method GET. No client JS.
- Hero counts ("124 open assignments") → derive from real row count, or use a truthful
  qualitative label if the count is volatile.
- Do NOT delete the Supabase client/query code.

## 7. Content fidelity + launch guardrail

- Replicate kit content exactly (named hospitals in marquee, invented counts, fabricated
  testimonials/people/team, kit contact strings). This is Zach's explicit call: replicate,
  then iterate.
- **Guardrail (kept despite "replicate everything"):** all fabricated marketing content
  stays on the `feat/ims-phase-1a-content` preview branch and does **NOT** merge to indexed
  production until Zach's content pass. The site is currently set indexable
  (`robots Allow: /`). Jobs (real data) is exempt.
- `voice-lint.mjs` is advisory (exit 0) — it may flag kit copy; note but do not block.

## 8. Phasing

Each phase ends with: `npm run build` + `npm run verify` (must stay green) + a real
Playwright visual check at desktop + mobile widths + a Codex review pass (per the in-band
Codex collaboration mandate). Commit atomically.

- **P1 — Foundation:** fonts, global CSS (3 files + token aliases + missing-token fix),
  MarketingLayout, SiteNav, SiteFooter, font copy, verify-build reconciliation.
- **P2 — Homepage:** full home section port (all components).
- **P3 — Audience + contact + jobs:** clinicians, facilities, about, contact, jobs
  (real-data wiring).
- **P4 — Legal + cleanup:** privacy/terms/cookies; reconcile `/how-it-works` + `/specialties`
  (keep rendering MarketingLayout so orphan check passes); retire `tokens.css` from layout
  if no longer referenced.

## 9. Risks / assumptions

- **Visual drift:** re-implementation may differ subtly from the kit. Mitigation: import kit
  CSS verbatim; Playwright side-by-side against the kit previews.
- **Font licensing:** Battlefin (Pangram Pangram, paid) is self-hosted from the kit. Assumed
  licensed for web use (kit shipped the woff2). Confirm with Zach before public launch.
- **Zero-JS interactivity:** jobs filtering becomes server-side; if Zach wants instant
  client filtering, a single opt-in island can be added later.
- **`palette-active.css` `!important` overrides** assume specific class names from the kit
  markup. Porting markup verbatim preserves the selectors; deviations would break overrides.
- **Footer sign-off string** discrepancy (kit Footer.jsx vs brand brief) — defaulting to the
  brief's locked "Let's place you *somewhere good*."; Zach to confirm.
- **Orphan check** requires every `src/pages/*.astro` to render MarketingLayout — keep legal +
  how-it-works + specialties compliant.

## 10. New / modified file manifest (high level)

**New:**
- `src/styles/colors_and_type.css`, `src/styles/kit.css`, `src/styles/palette-active.css`
- `public/fonts/Battlefin-Bold.{woff2,woff,ttf}`, `public/fonts/Battlefin-Black.{woff2,woff,ttf}`
- (Astro pages already exist; bodies rewritten)

**Modified:**
- `src/layouts/MarketingLayout.astro` (cream chrome, font imports, CSS imports)
- `src/components/nav/SiteNav.astro` (floating pill)
- `src/components/footer/SiteFooter.astro` (dark-ink footer-b)
- `src/pages/index.astro`, `clinicians.astro`, `facilities.astro`, `about.astro`,
  `contact.astro`, `jobs/index.astro`, `privacy.astro`, `terms.astro`, `cookies.astro`
- `package.json` (+ @fontsource fraunces, jetbrains-mono)
- `colors_and_type.css` token aliases (within the new copy)

**Untouched:**
- `src/middleware.ts`, `src/middleware-logic.ts` (CSP + canonical redirect)
- `src/pages/api/*` (contact/apply endpoints)
- `scripts/verify-build.mjs` (kept green via aliases; edit only if unavoidable, with Codex review)
