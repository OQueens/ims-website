# Site Motion Language + Dark Contact Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **READ FIRST:** the design spec `docs/superpowers/specs/2026-05-30-motion-and-contact-design.md` (exact values, rationale, per-surface plan). For the dark-contact verbatim CSS/markup, the authoritative source is the decoded map at `docs/superpowers/research/2026-05-30-handoff-and-codebase-map.json` (committed; the `handoff.*` keys have the exact CSS transcribed) plus the original handoff `C:\Users\oclou\QueenClaude\_ims-design-extract\design_handoff_contact_page\contact-reference.html` + `README.md`. This plan tells you WHAT to do and shows the NEW logic; for the pixel-exact contact CSS, transcribe from those sources.

**Goal:** Bring accessible, best-in-class scroll motion to the 5 static marketing pages and port the dark "Get in touch" page with confetti success state — unified into one motion language, with content that can never render invisible.

**Architecture:** Extend the existing IntersectionObserver + CSS-transition `ScrollReveal` mechanism (no new libs, no CSP changes). Invert the hidden state to `.js`-gated so default rendering is always visible. Reuse Magenta-Noir tokens. Confetti is a small client-only canvas script. The dark contact page is a new component; the homepage's cream `ContactPanel` is untouched.

**Tech Stack:** Astro v5 (static + `@astrojs/cloudflare`), vanilla CSS (`src/styles/*.css`), IntersectionObserver, Web Animations API (shake), canvas (confetti). Verify with `npm run build`, `npm run verify`, `vitest`, and **Playwright real-browser** (curl cannot see JS reveal).

---

## File Structure

**Modify:**
- `src/styles/colors_and_type.css` — add `--dur-reveal`, `--stagger-step` tokens; verify `--dur-*` values.
- `src/layouts/MarketingLayout.astro` — add `.js` class flip (inline, right after `<html>`).
- `src/components/util/ScrollReveal.astro` — harden (invert default visible, `.js`-gate, stagger via `--i`, will-change add/remove on transitionend, keep `delay` fallback).
- `src/styles/kit.css` — add motion primitive helper classes (`.hero-stage`/`.hero-go`, `.ambient-glow`, the `.cc__timeline-line` draw, stagger child rule); harden the orphaned `.reveal` defaults the same way (or delete it — see Task 0.3).
- `src/pages/index.astro`, `about.astro`, `clinicians.astro`, `facilities.astro`, `jobs/index.astro` — wrap sections / add reveal classes + `--i` per the spec §5.
- `src/pages/contact.astro` — render the new dark component instead of `<ContactPanel>`.

**Create:**
- `src/components/sections/GetInTouch.astro` — the dark "Get in touch" page (form + success + confetti), client-side success.
- `tests/contact-validation.test.ts` — unit test the validation predicate (the one piece of pure logic).

**Do NOT touch:** `src/components/sections/ContactPanel.astro` (homepage keeps cream), the marquee/testimonial/stat *content* (placeholder, deferred), `tokens.css` (legacy, not loaded).

---

## Phase 0 — Motion infrastructure

### Task 0.1: Add motion tokens

**Files:** Modify `src/styles/colors_and_type.css` (the `:root` that defines `--dur-fast/base/slow`).

- [ ] **Step 1: Confirm the active duration tokens.** Open `src/styles/colors_and_type.css`, find `--dur-fast/--dur-base/--dur-slow`. Confirm they are `150ms / 280ms / 520ms` (NOT the legacy `tokens.css` 120/200/360). If different, note the real values.

- [ ] **Step 2: Add two tokens** in the same `:root`, after `--dur-slow`:
```css
  --dur-reveal: 560ms;   /* scroll-reveal entrance */
  --stagger-step: 70ms;  /* per-child cascade step */
```

- [ ] **Step 3: Commit.**
```bash
git add src/styles/colors_and_type.css
git commit -m "feat(motion): add --dur-reveal + --stagger-step tokens"
```

### Task 0.2: Add the `.js` flag (never-invisible foundation)

**Files:** Modify `src/layouts/MarketingLayout.astro`.

- [ ] **Step 1:** In `MarketingLayout.astro`, find the `<head>` open (or the very top of `<body>`). Add this inline script as the FIRST thing after `<html ...>` opens / earliest in `<head>` (CSP allows `'unsafe-inline'`):
```astro
<script is:inline>document.documentElement.classList.add('js')</script>
```
Place it before stylesheet links so the `.js` class exists before first paint of reveal elements.

- [ ] **Step 2: Build to confirm no error.** Run: `npm run build` — Expected: success, no CSP/parse error.

- [ ] **Step 3: Commit.**
```bash
git add src/layouts/MarketingLayout.astro
git commit -m "feat(motion): add .js flag for no-JS-safe progressive enhancement"
```

### Task 0.3: Harden + generalize ScrollReveal (the core change)

**Files:** Modify `src/components/util/ScrollReveal.astro`. Also handle the orphaned `.reveal` CSS in `kit.css` + `about.astro` + `facilities.astro`.

- [ ] **Step 1: Replace the component** with the hardened version. Full new file content:
```astro
---
interface Props {
  as?: string;
  /** legacy single-element delay in ms (kept for about/facilities back-compat) */
  delay?: number;
  class?: string;
  [key: string]: unknown;
}
const { as: As = 'section', delay = 0, class: className = '', ...rest } = Astro.props;
---
<As class:list={['scroll-reveal', className]} data-reveal-delay={delay} {...rest}>
  <slot />
</As>

<style>
  /* BARE DEFAULT = VISIBLE (no-JS / crawler / print / SSR-snapshot safe). */
  .scroll-reveal { opacity: 1; transform: none; }
  /* Hidden start-state ONLY once JS is confirmed. */
  :global(html.js) .scroll-reveal {
    opacity: 0;
    transform: translateY(20px);
    transition:
      opacity var(--dur-reveal, 560ms) cubic-bezier(0.22, 1, 0.36, 1),
      transform var(--dur-reveal, 560ms) cubic-bezier(0.22, 1, 0.36, 1);
    transition-delay: calc(var(--i, 0) * var(--stagger-step, 70ms));
  }
  .scroll-reveal.is-revealed { opacity: 1; transform: none; }
  /* Belt-and-suspenders: never hidden under reduced-motion or print. */
  @media (prefers-reduced-motion: reduce), print {
    .scroll-reveal { opacity: 1 !important; transform: none !important; transition: none; }
  }
</style>

<script>
  function revealAll() {
    document.querySelectorAll<HTMLElement>('.scroll-reveal').forEach((el) => el.classList.add('is-revealed'));
  }
  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (typeof window === 'undefined' || !('IntersectionObserver' in window) || prefersReduced) {
    revealAll();
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.style.willChange = 'opacity, transform';
          // legacy per-element delay still honored; --i stagger handled in CSS
          const legacyDelay = Number(el.dataset.revealDelay ?? 0);
          const apply = () => el.classList.add('is-revealed');
          legacyDelay > 0 ? setTimeout(apply, legacyDelay) : apply();
          el.addEventListener('transitionend', () => { el.style.willChange = ''; }, { once: true });
          observer.unobserve(el);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0 },
    );
    document.querySelectorAll<HTMLElement>('.scroll-reveal').forEach((el) => observer.observe(el));
  }
</script>
```

- [ ] **Step 2: Neutralize the orphaned `.reveal` CSS.** In `kit.css` (~line 1517) and the duplicated blocks in `about.astro` (~372) and `facilities.astro` (~693): since no JS ever adds `.in`, these are dead and default to `opacity:0` (a latent invisibility trap). Either DELETE the `.reveal`/`.reveal.in` rules, or invert them the same way (`.reveal{opacity:1}` bare; `:global(html.js) .reveal{opacity:0;...}`). **Recommended: delete** them (we standardize on `.scroll-reveal`). Confirm no element uses `class="reveal"` first: `grep -rn 'class=.*\breveal\b' src/` should return nothing.

- [ ] **Step 3: Build + verify no regression.** Run: `npm run build && npm run verify` — Expected: build success, verify 11/11. Then manually: how-it-works + specialties still use `<ScrollReveal>` — they should still reveal (now `.js`-gated).

- [ ] **Step 4: Playwright sanity (real browser).** Start a local preview (`npm run build` then `npx wrangler pages dev dist --port 8788 --compatibility-flags=nodejs_compat` or `npm run preview` if configured). With Playwright: load `/how-it-works`, confirm sections start hidden then reveal on scroll; toggle `prefers-reduced-motion` and confirm content is immediately visible; disable JS and confirm content visible.

- [ ] **Step 5: Commit.**
```bash
git add src/components/util/ScrollReveal.astro src/styles/kit.css src/pages/about.astro src/pages/facilities.astro
git commit -m "feat(motion): harden ScrollReveal — visible-by-default, .js-gated, --i stagger, will-change discipline; remove dead .reveal"
```

### Task 0.4: Hero-entrance + ambient-glow-drift helpers

**Files:** Modify `src/styles/kit.css` (add helper classes).

- [ ] **Step 1: Add hero-entrance CSS** (first-paint-visible; offset applied only after `.js` + a `.hero-go` toggle):
```css
/* Hero entrance — visible by default; plays one frame after JS confirms. */
.hero-stage > * { /* children animate */ }
html.js .hero-stage > * {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 600ms cubic-bezier(0.22,1,0.36,1), transform 600ms cubic-bezier(0.22,1,0.36,1);
  transition-delay: calc(var(--i, 0) * 90ms);
}
html.js .hero-stage.hero-go > * { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce), print {
  html.js .hero-stage > * { opacity: 1 !important; transform: none !important; transition: none; }
}
```

- [ ] **Step 2: Add a tiny inline hero-go script** to `MarketingLayout.astro` (or each hero) that, after load, adds `.hero-go` on the next frame:
```astro
<script is:inline>
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.hero-stage').forEach((el) => el.classList.add('hero-go'));
    });
  });
</script>
```
(Two rAFs ensure the initial offset paints first, so the transition runs.)

- [ ] **Step 3: Add ambient-glow-drift** (apply to existing decorative blob elements, e.g. `.hero__blob`, `.atmosphere`, `.gt-glow`):
```css
@media (min-width: 769px) and (prefers-reduced-motion: no-preference) {
  .ambient-glow { animation: ambientDrift 18s linear infinite; }
}
@keyframes ambientDrift {
  0%, 100% { transform: translate(0,0) scale(1); }
  50%      { transform: translate(3%, -2%) scale(1.04); }
}
```

- [ ] **Step 4: Build.** Run: `npm run build` — Expected: success.

- [ ] **Step 5: Commit.**
```bash
git add src/styles/kit.css src/layouts/MarketingLayout.astro
git commit -m "feat(motion): add hero-entrance + ambient-glow-drift primitives"
```

---

## Phase 1 — Apply motion across the 5 pages

> Pattern: wrap each below-fold `<section>` (or its inner content group) so it gets `class="scroll-reveal"` (use the `<ScrollReveal>` component OR add the class directly to existing `<section>`s). For staggered groups, add `style="--i:0"`, `--i:1`, … to the repeating children. Heroes get `.hero-stage` + `--i` on their direct children (NOT on interactive controls). Follow spec §5 exactly. Build + Playwright-verify after each page; commit per page.

### Task 1.1: Home (`src/pages/index.astro`)
- [ ] Hero `<section class="...hero...">`: add `hero-stage`; set `--i` on eyebrow(0)/h1(1)/sub(2)/cta-row(3). Do NOT hide the rotator (CSS-only, fine).
- [ ] Stats `.positioning`: add `scroll-reveal`; each `.statchip` gets `--i:0..3`.
- [ ] Audience `.aud-mix`: `scroll-reveal`; 2 cards `--i:0/1`.
- [ ] Compare: add `scroll-reveal` to the two `.compare__col` (stagger 0/1); do NOT stagger the 7 `.compare__item`.
- [ ] CTA band: `scroll-reveal` on the inner block.
- [ ] Process `.process-cards`: `scroll-reveal`; 3 `.proc-card` `--i:0/1/2`.
- [ ] Specialty `.spec-grid`: `scroll-reveal`; FIRST 4 `.spec-card` `--i:0..3`, remaining 4 `--i:0` (reveal with container — cap rule).
- [ ] Values `.values`: `scroll-reveal`; 3 `--i:0/1/2`.
- [ ] ContactPanel: wrap in `scroll-reveal` (stays cream).
- [ ] Build + Playwright verify `/`; commit: `feat(motion): home page scroll-reveal + stagger`.

### Task 1.2: About (`src/pages/about.astro`) — standardize to `--i`
- [ ] hero → `hero-stage` + `--i` on children.
- [ ] Convert existing `<ScrollReveal delay={…}>` usages: keep the component but add `--i` on repeating children (pillars 3, team members 3+3 per group, stats 4). Remove now-redundant `delay` props where `--i` replaces them (keep `data-reveal-delay` fallback path intact in the component).
- [ ] Build + Playwright verify `/about`; commit: `feat(motion): about page stagger standardization`.

### Task 1.3: Clinicians (`src/pages/clinicians.astro`) — SIGNATURE timeline
- [ ] hero → `hero-stage` + `--i`.
- [ ] Timeline line draw: give `.cc__timeline-line` a JS-gated `scaleY(0)→1` from-top reveal (900ms `--ease-out`) triggered when `.cc__timeline` enters. Add CSS:
```css
html.js .cc__timeline-line { transform: scaleY(0); transform-origin: top; transition: transform 900ms cubic-bezier(0.22,0.61,0.36,1); }
html.js .cc__timeline.is-revealed .cc__timeline-line { transform: scaleY(1); }
@media (prefers-reduced-motion: reduce), print { html.js .cc__timeline-line { transform: none !important; } }
```
Wrap `.cc__timeline` so it gets `scroll-reveal`/`is-revealed` (the observer adds `is-revealed`; the line keys off the same class on the track).
- [ ] Steps `.cc__step--01..04`: `scroll-reveal` + `--i:0..3` BUT override stagger step to 140ms for drama — either add a local `style="--stagger-step:140ms"` on the track or a `.cc__timeline .scroll-reveal { --stagger-step:140ms }` rule. Node badges pop: `html.js .cc__step.is-revealed .cc__step-node { animation: nodePop 320ms var(--ease-spring) 60ms backwards; } @keyframes nodePop { from { transform: scale(0.6) } to { transform: scale(1) } }` (transform-only, backwards fill, never opacity:0).
- [ ] why(4) / quotes(3): `scroll-reveal` + `--i` (first-row stagger rule on the 4).
- [ ] Build + Playwright verify the timeline unfurl `/clinicians`; commit: `feat(motion): clinicians timeline signature reveal`.

### Task 1.4: Facilities (`src/pages/facilities.astro`)
- [ ] hero + roster(4) → `hero-stage` + `--i` (roster chips stagger on load).
- [ ] pillars(3)/quotes(3): `scroll-reveal` + `--i`. form CTA: `scroll-reveal` block. marquee: leave.
- [ ] Build + Playwright verify `/facilities`; commit: `feat(motion): facilities scroll-reveal + stagger`.

### Task 1.5: Jobs (`src/pages/jobs/index.astro`) — GRID-SAFE
- [ ] hero heading may use `hero-stage`; the SEARCH input + CHIPS must render visible/interactive immediately — NO reveal class on them.
- [ ] Reveal the whole grid container `#jobs-grid` wrapper ONCE (`scroll-reveal` on the wrapper, NOT per card). Do not add `--i` to cards (they are display-toggled by the filter).
- [ ] Confirm the existing filter script (`.is-hidden` toggle) still works after the wrapper reveal (the wrapper reveal only animates the container; cards inside are untouched by it).
- [ ] Build + Playwright verify `/jobs` (scroll reveal + filter still works); commit: `feat(motion): jobs grid-safe reveal`.

### Task 1.6: Cross-page Playwright verification
- [ ] Build, run local preview, and with Playwright walk all 5 pages: reveals fire on scroll, heroes on load, no layout shift, filter on /jobs intact. Toggle reduced-motion → all content visible+instant. Disable JS → all content visible.

---

## Phase 2 — Dark "Get in touch" page + success + confetti

### Task 2.1: Create `GetInTouch.astro` (structure + real info)
**Files:** Create `src/components/sections/GetInTouch.astro`.
- [ ] Build the `.gt-page` dark wrapper + two `.gt-glow` (add `ambient-glow` class) + `.gt-shell` (5fr/6fr grid, ≤920px single col) per the spec §6 / handoff map (`docs/superpowers/research/2026-05-30-handoff-and-codebase-map.json`). Transcribe the exact CSS from `contact-reference.html` into a scoped `<style>`, mapping tokens to `--mn-*` (`--mn-black`, `--mn-magenta`, `--mn-rose`, `--mn-butter`, `--cream-soft`, etc.).
- [ ] Left rail: eyebrow "Get in touch", headline `Let's <span class="em">talk</span>.`, sub copy, and the 3-row `<dl>` with **REAL info**: `recruiting@iastaffing.com` / `(512) 524-6686` / `Fort Worth, TX`. (Meta lines optional — flag as unverified; default to including them.)
- [ ] Commit: `feat(contact): dark Get-in-touch page shell + left rail (real info)`.

### Task 2.2: Form card + segmented control
- [ ] Cream `.gt-card` form: name|email row, "I am a…" segmented control (3 radio-buttons facility/clinician/other, checked = ink bg), role (optional), message textarea, magenta "Send it →" submit pill. Use exact classes/CSS from the handoff map. `<form class="gt-form" method="post" action="/api/contact" novalidate>`.
- [ ] Commit: `feat(contact): dark form card + segmented control`.

### Task 2.3: Success state + entrance animations
- [ ] `.gt-thanks` section (hidden via `display:none`, `.is-active` → flex). Checkmark (gtPop), eyebrow "Message received", title "Thank you for *reaching out*.", **verbatim** body copy (spec §6), signoff "With gratitude, **the IMS team**", two action pills → `/` and `/jobs`.
- [ ] Entrance keyframes (transform-only — NEVER opacity:0): `gtPop` (scale 0.4→1.12→1, 600ms `--ease-snap`), `gtRise` (translateY 18→0, 600ms `--ease-out`, stagger 60/140/220ms via `backwards` fill on title/body/signoff). Confirm resting states are fully opaque.
- [ ] Commit: `feat(contact): success state + transform-only entrance`.

### Task 2.4: Validation + confetti client script
**Files:** `GetInTouch.astro` `<script>`; Create `tests/contact-validation.test.ts`.
- [ ] **Write failing test** for the validation predicate. Extract a pure `validateContact({name,email,audience})` into `src/lib/contact-validation.ts`:
```ts
// tests/contact-validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateContact } from '../src/lib/contact-validation';
describe('validateContact', () => {
  it('fails on empty name', () => expect(validateContact({name:'',email:'a@b.co',audience:'facility'}).ok).toBe(false));
  it('fails on bad email', () => expect(validateContact({name:'A',email:'nope',audience:'facility'}).ok).toBe(false));
  it('fails on missing audience', () => expect(validateContact({name:'A',email:'a@b.co',audience:''}).ok).toBe(false));
  it('passes when all valid', () => expect(validateContact({name:'A',email:'a@b.co',audience:'clinician'}).ok).toBe(true));
});
```
- [ ] Run: `npx vitest run tests/contact-validation.test.ts` — Expected: FAIL (module missing).
- [ ] Implement `src/lib/contact-validation.ts`:
```ts
export function validateContact(v: { name: string; email: string; audience: string }) {
  if (!v.name.trim()) return { ok: false, field: 'name' as const };
  if (!/.+@.+\..+/.test(v.email)) return { ok: false, field: 'email' as const };
  if (!v.audience) return { ok: false, field: 'audience' as const };
  return { ok: true as const };
}
```
- [ ] Run the test — Expected: PASS.
- [ ] In `GetInTouch.astro` client `<script>`: import-free inline port of the submit handler — on submit `preventDefault`, run validation (mirror the predicate), on invalid focus + WAAPI shake (translateX 0/-6/6/0 320ms), on valid hide form + `.is-active` success + `scrollTo(0)` + `fireConfetti()`. **Phase-2 = client-side success only** (no real POST yet; backend is the follow-on plan). Port `fireConfetti()` near-verbatim from the handoff: 160 pieces, colors `['#C44569','#E8C465','#D88B9F','#59BFE7','#F4ECDF']`, reduced-motion `matchMedia` early-return. Guard `document`/`canvas` access to client only.
- [ ] Commit: `feat(contact): client validation + confetti success (look+feel; backend follows)`.

### Task 2.5: Wire `/contact` to the dark page
**Files:** Modify `src/pages/contact.astro`.
- [ ] Replace `<ContactPanel as="h1" />` with `<GetInTouch />`. Keep `SiteNav`/`SiteFooter`. If the dark page needs the nav translucent over it, add the `.gt-page .topnav` recolor per handoff (only if nav is black-on-black). Leave `src/pages/index.astro`'s `<ContactPanel />` unchanged (homepage stays cream).
- [ ] Build + verify. Commit: `feat(contact): swap /contact to dark Get-in-touch page`.

### Task 2.6: Playwright verification of contact
- [ ] Local preview. Playwright: load `/contact`, fill valid form → submit → success state shows + confetti fires (observe canvas). Submit invalid → shake, no advance. Toggle reduced-motion → success shows instantly, NO confetti. Disable JS → form + content fully visible (native POST would 404 until backend, acceptable for this phase).

---

## Phase 3 — Deploy to staging + verify live

### Task 3.1: Build, gate, redeploy
- [ ] Run the redeploy recipe (spec §10):
```bash
npm run build
STAGING_GATE_PASSWORD=ZY node scripts/apply-staging-gate.mjs
CLOUDFLARE_API_TOKEN=$(cat ~/.cloudflare-token) CLOUDFLARE_ACCOUNT_ID=7e0fc3bb9718dbaf4d31145eb6da1c5a \
  npx wrangler@latest pages deploy dist --project-name=ims-staging --branch=main --commit-dirty=true
```
- [ ] Confirm `verify-build` 11/11 + `vitest` 83/83 (+ the new validation test) green BEFORE deploy.

### Task 3.2: Live verification (real browser, authed)
- [ ] Playwright against `https://ims-staging.pages.dev` (Basic auth user `x` / pass `ZY`): walk all pages, confirm reveals + timeline + hero entrances + contact success/confetti work live; confirm reduced-motion + no-JS safety; confirm /jobs filter intact.
- [ ] Report to Zach with the staging URL for critique.

---

## Self-Review (completed by author)

- **Spec coverage:** §3 primitives → Tasks 0.1/0.3/0.4 + per-page application; §4 hardening → 0.2/0.3; §5 per-surface → 1.1–1.5; §6 dark contact → 2.1–2.5; §8 a11y/perf → baked into each task's CSS + 1.6/2.6 verification; §10 redeploy → 3.1. §7 backend is intentionally a SEPARATE follow-on plan (see below).
- **Placeholders:** none — new logic shown in full; verbatim contact CSS explicitly delegated to the authoritative handoff source (transcription task, not invention).
- **Type consistency:** `validateContact` signature consistent between test (2.4) and impl (2.4); `.scroll-reveal`/`.is-revealed`/`--i`/`--stagger-step`/`.hero-stage`/`.hero-go` names consistent across 0.3/0.4/1.x.

## Follow-on plan (separate): Contact form backend
Spec §7. Create `docs/superpowers/plans/2026-05-30-contact-form-backend.md` covering: install `resend`; `src/pages/api/contact.ts` (`prerender=false`, Turnstile siteverify + Resend send, reference impl in `docs/plans/2026-05-06-ims-website-phase-1-plan.md` ~3277–3581); wire `<TurnstileWidget form=".gt-form" />`; progressive success (JS fetch → success state; no-JS → 303 `/contact?sent=1`); set staging env vars; Codex-review. Do this immediately after the look+feel pass lands and Zach has critiqued.
```
```
