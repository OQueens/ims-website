# Chromia-Cream V3 Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the production "IMS Dark System" with an exact, faithful re-implementation of the Chromia-Cream / Magenta-Noir site from the Claude Design kit (`IMS Design System V3`), across all kit pages + shared chrome, fit to the Astro zero-JS + CSP architecture.

**Architecture:** Kit CSS (`colors_and_type.css` + `kit.css` + `palette-active.css`) imported verbatim as the global design system; fonts self-hosted (Battlefin/Fraunces/JetBrains Mono + existing Inter); each page ported as `.astro` markup under a cream `MarketingLayout`; kit JS behaviors converted to CSS-only or omitted (zero-JS). No CSP loosening. `verify-build` kept green via token aliases + retained TAY `@font-face`.

**Tech Stack:** Astro 5, `@astrojs/cloudflare` SSR, `@fontsource*`, Supabase (jobs), Vitest, Playwright (MCP), custom `verify-build.mjs` + `voice-lint.mjs`.

**Spec:** `docs/plans/2026-05-28-chromia-cream-port-design.md`
**Kit source:** `C:\Users\oclou\QueenClaude\_ims-v3-extract\` (extracted). Subpaths below are relative to this.

---

## Conventions for every task

- **Verify loop** (the "test" for a design port), run after each task's changes:
  1. `npm run build` — must succeed.
  2. `npm run verify` — `verify-build` must stay green (exit 0); `voice-lint` is advisory.
  3. Playwright (MCP): navigate `npm run dev` server URL for the touched route, screenshot at 1440px + 390px, compare against the kit preview (`ui_kits/...`).
  4. Codex review pass on the diff (in-band mandate); fold findings; re-loop until clean.
- **Commit** atomically at the end of each task with a `feat(v3):` / `chore(v3):` / `refactor(v3):` message.
- **Branch:** `feat/ims-phase-1a-content` (already checked out). Do NOT merge to `main` (launch guardrail, spec §7).
- **Verbatim copies:** when a step says "copy verbatim from `<kit file>`", read that file at execution time and reproduce exactly, then apply only the listed adaptations.

---

## PHASE 1 — Foundation (shared chrome)

### Task 1: Add font dependencies + copy Battlefin files

**Files:**
- Modify: `package.json`
- Create: `public/fonts/Battlefin-Bold.woff2`, `.woff`, `.ttf`
- Create: `public/fonts/Battlefin-Black.woff2`, `.woff`, `.ttf`

- [ ] **Step 1: Install Fraunces + JetBrains Mono**

Run:
```
npm i @fontsource-variable/fraunces @fontsource/jetbrains-mono
```
Expected: both added to `dependencies`, `package-lock`/node_modules updated.

- [ ] **Step 2: Copy Battlefin font files into public/fonts/**

PowerShell:
```powershell
Copy-Item "C:\Users\oclou\QueenClaude\_ims-v3-extract\fonts\Battlefin-Bold.woff2","C:\Users\oclou\QueenClaude\_ims-v3-extract\fonts\Battlefin-Bold.woff","C:\Users\oclou\QueenClaude\_ims-v3-extract\fonts\Battlefin-Bold.ttf","C:\Users\oclou\QueenClaude\_ims-v3-extract\fonts\Battlefin-Black.woff2","C:\Users\oclou\QueenClaude\_ims-v3-extract\fonts\Battlefin-Black.woff","C:\Users\oclou\QueenClaude\_ims-v3-extract\fonts\Battlefin-Black.ttf" "c:\Users\oclou\QueenClaude\ias-website\.worktrees\feat-ims-phase-1-plan\public\fonts\"
```
Expected: 6 files present in `public/fonts/`. (TAY*.woff2/.woff already there — leave them.)

- [ ] **Step 3: Commit**

```
git add package.json package-lock.json public/fonts/Battlefin-*
git commit -m "chore(v3): add Fraunces + JetBrains Mono deps, self-host Battlefin fonts"
```

---

### Task 2: Port kit CSS into src/styles/ with self-hosting + token aliases

**Files:**
- Create: `src/styles/colors_and_type.css` (from kit, adapted)
- Create: `src/styles/kit.css` (from kit, verbatim)
- Create: `src/styles/palette-active.css` (from kit, verbatim)

- [ ] **Step 1: Copy kit.css verbatim**

Copy `ui_kits/website/kit.css` → `src/styles/kit.css` unchanged. (No `url()` font refs inside; relies on colors_and_type.css.)

- [ ] **Step 2: Copy palette-active.css verbatim**

Copy `ui_kits/website/palette-active.css` → `src/styles/palette-active.css` unchanged.

- [ ] **Step 3: Copy colors_and_type.css and apply these exact adaptations**

Copy `colors_and_type.css` → `src/styles/colors_and_type.css`, then:

(a) **Remove** the Google Fonts `@import url('https://fonts.googleapis.com/...')` line entirely (CSP-blocked; replaced by self-hosted @fontsource imports in the layout).

(b) **Rewrite Battlefin `@font-face` src** to absolute public paths:
```css
@font-face {
  font-family: 'Battlefin';
  src: url('/fonts/Battlefin-Bold.woff2') format('woff2'),
       url('/fonts/Battlefin-Bold.woff') format('woff'),
       url('/fonts/Battlefin-Bold.ttf') format('truetype');
  font-weight: 700; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Battlefin';
  src: url('/fonts/Battlefin-Black.woff2') format('woff2'),
       url('/fonts/Battlefin-Black.woff') format('woff'),
       url('/fonts/Battlefin-Black.ttf') format('truetype');
  font-weight: 900; font-style: normal; font-display: swap;
}
```

(c) **Rewrite TAY `@font-face` src** to absolute (keep the blocks — verify-build asserts them):
```css
@font-face { font-family:'TAY Basal'; src:url('/fonts/TAYBasalRegular.woff2') format('woff2'); font-weight:400; font-style:normal; font-display:swap; }
@font-face { font-family:'TAY Amaya'; src:url('/fonts/TAYAmaya.woff2') format('woff2'); font-weight:400; font-style:normal; font-display:swap; }
```
(verify regex needs `TAYBasalRegular` and `TAYAmaya.woff` co-located with family — both satisfied: `.woff2` contains `.woff`.)

(d) **Add verify-build token aliases** inside `:root` (anywhere after the existing semantic aliases):
```css
  /* verify-build compatibility aliases (scripts/verify-build.mjs §4.1) */
  --text:          var(--ink);
  --surface-card:  var(--cream-soft);
  --surface-page:  var(--cream);
  --brand-blue:    var(--ims-cyan);
  --ink-on-cream:  var(--ink);
  --ink-on-dark:   var(--cream-soft);
```
(`--bg` already exists.)

(e) **Define the missing emphasis vars** the kit references but never declares (link hover, ::selection, .section--ink em). Honor Magenta Noir:
```css
  --ink-aubergine: var(--pop-magenta);
  --ink-teal:      var(--pop-magenta);
```
Place in `:root` (palette-active.css may further override; that's fine).

- [ ] **Step 4: Verify loop** (build only here — not wired to layout yet)

Run `npm run build`. Expected: success (CSS not yet imported anywhere, so this just confirms no syntax break if imported). Optionally import temporarily to smoke-test; revert.

- [ ] **Step 5: Commit**

```
git add src/styles/colors_and_type.css src/styles/kit.css src/styles/palette-active.css
git commit -m "feat(v3): port kit design-system CSS (self-hosted fonts, token aliases, Magenta Noir)"
```

---

### Task 3: Rewrite MarketingLayout for cream chrome

**Files:**
- Modify: `src/layouts/MarketingLayout.astro`

- [ ] **Step 1: Replace the dark imports + body with cream**

In the frontmatter, replace `import '../styles/tokens.css';` with:
```astro
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../styles/colors_and_type.css';
import '../styles/kit.css';
import '../styles/palette-active.css';
```
(Order matters: colors_and_type → kit → palette-active.)

- [ ] **Step 2: Update head meta**

- `<meta name="color-scheme" content="light" />`
- `<meta name="theme-color" content="#F4ECDF" />`
- Keep: description, canonical, OG/Twitter, Plausible inline script, Org JSON-LD, generator.
- Change favicon if desired (keep `/ims-logo-mark.png` for now).
- Add Battlefin preloads:
```astro
<link rel="preload" href="/fonts/Battlefin-Black.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/Battlefin-Bold.woff2" as="font" type="font/woff2" crossorigin />
```

- [ ] **Step 3: Replace the body style block**

Remove `body.marketing { background: navy; ... }`, `main.card { navy }`. Cream body + dot-grid come from `colors_and_type.css` `body` rule, but that rule targets `body` (not `body.marketing`). Keep `<body class="marketing">` and add a thin scoped rule so the dot-grid/cream apply:
```astro
<style>
  body.marketing { margin: 0; }
  main.full-bleed { display: block; }
  /* inCard retained as deprecated no-op wrapper for unported pages */
  main.card { display: block; }
</style>
```
(The cream bg, dot-grid, font, color all come from the global `body {}` in colors_and_type.css.)

- [ ] **Step 4: Verify loop**

`npm run build && npm run verify`. Expected: build OK; verify-build green (Plausible/JSON-LD/canonical source checks still pass; tokens present in bundled CSS now that CSS is imported; TAY blocks present). If any token check FAILs, fix the alias in colors_and_type.css.

- [ ] **Step 5: Playwright smoke** — `npm run dev`, open `/`, confirm cream bg + dot-grid render (page content still old until Task 6, but chrome/bg should be cream).

- [ ] **Step 6: Commit**

```
git add src/layouts/MarketingLayout.astro
git commit -m "feat(v3): cream MarketingLayout chrome + self-hosted font imports"
```

---

### Task 4: Build SiteNav as floating pill topnav

**Files:**
- Modify: `src/components/nav/SiteNav.astro`
- Reference: `ui_kits/website/TopNav.jsx`, `.topnav*` classes in `kit.css`

- [ ] **Step 1: Replace markup with the kit topnav structure**

Port `TopNav.jsx` to Astro. Structure:
```astro
---
const path = Astro.url.pathname;
const links = [
  { id: 'facilities', href: '/facilities', label: 'Facilities' },
  { id: 'clinicians', href: '/clinicians', label: 'Clinicians' },
  { id: 'about',      href: '/about',      label: 'About Us' },
  { id: 'jobs',       href: '/jobs',       label: 'Job Board' },
];
const isCurrent = (href) => path === href || (href !== '/' && path.startsWith(href));
---
<a href="#main" class="skip-to-content">Skip to content</a>
<nav class="topnav" aria-label="Primary">
  <a class="topnav__logo" href="/" aria-label="IMS home">
    <img src="/ims-logo-light.png" alt="IMS" height="24" />
  </a>
  <div class="topnav__links">
    {links.map(l => (
      <a href={l.href} aria-current={isCurrent(l.href) ? 'page' : undefined}>{l.label}</a>
    ))}
  </div>
  <a class="topnav__cta" href="/contact">
    Get in touch
    <span class="topnav__cta__puck" aria-hidden="true">→</span>
  </a>
</nav>
```
- **Drop** JS hide-on-scroll (zero-JS) — nav stays sticky/visible.
- Add a `.skip-to-content` style if not in kit.css (visually-hidden, focus-visible).
- Confirm `.topnav*` classes exist in kit.css (they do); no per-component CSS needed beyond skip link + any `aria-current` styling (kit uses `.is-current`/current color — map `aria-current` to the same visual via a small scoped rule if kit keys off a class).

- [ ] **Step 2: Verify loop** — build + verify + Playwright (nav renders as floating dark pill, links + puck CTA, hover states).

- [ ] **Step 3: Commit** — `feat(v3): floating pill SiteNav (zero-JS)`

---

### Task 5: Build SiteFooter as dark-ink footer-b

**Files:**
- Modify: `src/components/footer/SiteFooter.astro`
- Reference: `ui_kits/website/Footer.jsx`, `variations/footer.html` (Variation B), `.footer-b*` in `kit.css`

- [ ] **Step 1: Port the footer-b markup verbatim**

Port `Footer.jsx` / footer.html Variation B: 2 blobs (`aria-hidden`), eyebrow "Get in touch", sign-off, newsletter (native `<form>`), 4-col sitemap, bottom bar (logo + copyright + LinkedIn/Instagram social pills).
- **Sign-off string:** use the brand-brief locked string `Let's place you <em>somewhere good</em>.` (NOT the kit Footer.jsx "The place to be is right here." — flag to Zach in handoff).
- Sitemap "How it works" → `/how-it-works`, "Specialties" → `/specialties` (existing routes, no 404).
- Newsletter form: `method="post"` to a real endpoint if one exists, else `action="/contact"` GET fallback (no JS). Confirm endpoint in execution; default to linking to /contact.
- Social SVGs: inline (from primitives.jsx LucideIcon linkedin/instagram) — inline SVG, not files (icon-cap safe).
- Copyright: `© Innovative Medical Staffing · Fort Worth, TX · NALTO member · Joint Commission certified`.

- [ ] **Step 2: Verify loop** — build + verify + Playwright (dark footer, blobs, sitemap, socials at desktop + mobile).

- [ ] **Step 3: Commit** — `feat(v3): dark-ink footer-b SiteFooter`

---

### Task 6 (Phase 1 gate): Full foundation verify + Codex review

- [ ] **Step 1:** `npm run build && npm run verify && npm run test` — all green.
- [ ] **Step 2:** Playwright: load `/` — confirm cream chrome + pill nav + dark footer wrap the (still-old) homepage body without layout break.
- [ ] **Step 3:** Codex review of the full Phase-1 diff; fold findings; re-loop.
- [ ] **Step 4:** Save a memory checkpoint (foundation landed, HEAD hash).

---

## PHASE 2 — Homepage

### Task 7: Port homepage sections into index.astro

**Files:**
- Modify: `src/pages/index.astro` (full rewrite of body; keep `export const prerender = false;`)
- Reference: `ui_kits/website/App.jsx` (home route order) + each component JSX + `kit.css`

Home section order (App.jsx home route): Hero(center) → MarqueeStrip → PositioningStrip → AudienceSplit → CompareStrip → CTABand → ProcessSteps → SpecialtyGrid → ValuesGrid → ContactForm.

- [ ] **Step 1:** Keep frontmatter: `import MarketingLayout`, `import SiteNav`, `import SiteFooter`; `export const prerender = false;`. Render `<MarketingLayout inCard={false}>` with `<SiteNav slot="nav" />` and `<SiteFooter slot="footer" />`.

- [ ] **Step 2:** Port each section verbatim from its kit component into the page body (or into small `src/components/sections/*.astro` partials if a section is reused across pages — Marquee, ContactForm, CTA are reused). Use exact kit classes + content (Magenta Noir). Wrap each in `<section class="section section--...">` per the component's root class.

- [ ] **Step 3 — Hero rotating word (CSS-only):** Replace JS `RotatingWord` with stacked words cycled by CSS `@keyframes` (opacity), e.g. 4 words × 2.4s, `prefers-reduced-motion` → show first word only. Provide the keyframes in the page/Hero `<style>`. The locked headline is "A More _Personal_ Way to Staff Care." — keep "Personal" as the static default emphasis word; the rotator (Personal/Curated/Thoughtful/Human) is the kit's; replicate it CSS-only.

- [ ] **Step 4 — ContactForm:** native `<form method="post" action="/api/contact">`; the "Sent." state is shown on server redirect/response, not client JS. (If `/api/contact` returns JSON only, render the form to POST and handle the thank-you via a server redirect target — confirm endpoint contract in execution.)

- [ ] **Step 5 — scroll reveal:** apply `.reveal` classes only if implementing CSS scroll-driven reveal (`animation-timeline: view()`); otherwise omit `.reveal` so content is visible by default. Decide in execution; default = omit (static-first), keep content visible.

- [ ] **Step 6: Verify loop** — build + verify + Playwright `/` at 1440/390 vs `ui_kits/website/index.html` rendered preview. Iterate to visual parity.

- [ ] **Step 7: Codex review** of homepage diff; fold; commit `feat(v3): homepage Chromia-Cream port`.

---

## PHASE 3 — Audience pages + contact + jobs

> Reusable section partials created in Phase 2 (Marquee, CTA, ContactForm) should be imported, not duplicated.

### Task 8: /clinicians (pick C)
**Files:** Modify `src/pages/clinicians.astro`. Reference `page-variations/clinicians.html`.
- [ ] Port section flow: Hero(lilac, centered) → 4-step timeline (`.cc__timeline`, colored nodes) → Why grid (4 cards) → Quotes (3) → CTA. Port the page's own `<style>` block (lines ~607-673) into the `.astro` scoped `<style>`. Render under `MarketingLayout inCard={false}` + nav/footer slots.
- [ ] Verify loop (build/verify/Playwright vs clinicians.html) + Codex review + commit `feat(v3): /clinicians port`.

### Task 9: /facilities (pick B+C)
**Files:** Modify `src/pages/facilities.astro`. Reference `page-variations/facilities.html`.
- [ ] Port: Hero(butter) + roster snapshot card → Marquee strip → 3-pillar grid (`.fb__pillars`) → quotes (`.fc__quotes`) → CTA (`.wns-card`). Port page `<style>` block. Reuse Marquee partial.
- [ ] Verify loop + Codex + commit `feat(v3): /facilities port`.

### Task 10: /about (pick B+C)
**Files:** Modify `src/pages/about.astro`. Reference `page-variations/about.html`.
- [ ] Port: Hero(centered) → Mission(butter card) → 3 principles (`.au__pillar`, colored top borders) → Team grid (founders + leadership) → Stats (ink, `.au__stats`). Port page `<style>`.
- [ ] Verify loop + Codex + commit `feat(v3): /about port`.

### Task 11: /contact (variation B)
**Files:** Modify `src/pages/contact.astro`. Reference `variations/contact.html` Variation B + `ContactForm.jsx`.
- [ ] Port the split butter `.contact-b__panel` (left info + right form). Native form POST to `/api/contact`. Keep existing Turnstile integration if the current contact page uses it (check before overwriting — preserve CSP/Turnstile wiring). Eyebrow "Get in touch", headline "Let's _talk_."
- [ ] Verify loop + Codex + commit `feat(v3): /contact port`.

### Task 12: /jobs — kit layout + real Supabase data
**Files:** Modify `src/pages/jobs/index.astro`. Reference `page-variations/jobs.html` (B) for layout; preserve the EXISTING Supabase SSR query.
- [ ] **Step 1:** Read the current `jobs/index.astro` to capture the live `ims_jobs WHERE status='active'` query + field mapping (public_facility_label, specialty, location, etc.) — DO NOT delete it.
- [ ] **Step 2:** Render real rows into the kit grid `.jb-b__card--{spec}` (map DB specialty → kit color class; default class for unknown specialties). Hero count derived from real `rows.length` (or qualitative label). Keep `prerender = false`.
- [ ] **Step 3 — filter (zero-JS):** specialty chips + search as a `<form method="get">`; read `Astro.url.searchParams` (`spec`, `q`) server-side and filter rows before render; active chip via `aria-current`. Empty state (`.jb-b__empty`) shown when 0 matches.
- [ ] **Step 4:** Verify loop (build/verify/Playwright). Confirm empty-state renders if LocumSmart feed is dormant (per memory: "Website" LS subscription may be pending). Codex review. Commit `feat(v3): /jobs new layout on live Supabase data`.

---

## PHASE 4 — Legal + reconcile + cleanup

### Task 13: /privacy, /terms, /cookies
**Files:** Modify `src/pages/privacy.astro`, `terms.astro`, `cookies.astro`. Reference `ui_kits/website/Legal.jsx`.
- [ ] Port the `.legal-page` cream layout for each `kind`. Keep `noindex` prop if the current pages set it (privacy/terms/cookies are noindex per Explore map — preserve). Render under MarketingLayout. Back link → `/`.
- [ ] Verify loop + Codex + commit `feat(v3): legal pages port`.

### Task 14: Reconcile /how-it-works + /specialties (keep orphan check green)
**Files:** `src/pages/how-it-works.astro`, `src/pages/specialties.astro`.
- [ ] These keep their existing bodies but MUST still render `<MarketingLayout` (verify-build orphan check = strict equality across all pages). Confirm they do; if they reference retired `tokens.css` classes, they'll look unstyled-but-not-broken on cream — acceptable (flagged for later). Set `inCard={false}` if their old layout assumed the dark card. Minimal touch only.
- [ ] Verify loop (focus: orphan check passes, no build break) + commit `chore(v3): keep how-it-works/specialties on MarketingLayout`.

### Task 15: Retire tokens.css from layout + final gate
- [ ] **Step 1:** Confirm no page imports `tokens.css` anymore (grep). If clean, the layout already dropped it (Task 3). Leave the file on disk only if still referenced; else note for deletion (do not delete if any `.astro` still uses dark tokens).
- [ ] **Step 2:** Full gate: `npm run build && npm run verify && npm run test` green.
- [ ] **Step 3:** Playwright full-site walk (all routes, desktop + mobile), screenshot set.
- [ ] **Step 4:** Final Codex review across the branch diff; fold; commit.
- [ ] **Step 5:** Memory checkpoint (full port landed, HEAD hash, open items).

---

## Self-review (spec coverage)

- Spec §3.1-3.2 (CSS + fonts) → Tasks 1-2. ✓
- §3.3 layout → Task 3. ✓
- §3.4 verify-build aliases → Task 2 step 3d + Task 3 step 4. ✓
- §3.5 missing tokens → Task 2 step 3e. ✓
- §3.6 nav → Task 4. ✓ §3.7 footer → Task 5. ✓
- §4 pages → Tasks 7-13. ✓
- §5 behavior conversion → Task 7 (hero/form/reveal), Task 4 (nav), Task 12 (jobs filter). ✓
- §6 jobs data → Task 12. ✓
- §7 guardrail → Conventions (no merge to main) + voice-lint advisory. ✓
- §8 phasing → Phases 1-4 + gate tasks 6, 15. ✓
- Out-of-scope how-it-works/specialties → Task 14 (orphan-check compliance only). ✓

No placeholders requiring code that isn't either shown or pointed at a verbatim kit source. Verbatim CSS/markup intentionally referenced (not duplicated) — 2135-line kit.css and per-page HTML are copied at execution, not retyped into the plan.
