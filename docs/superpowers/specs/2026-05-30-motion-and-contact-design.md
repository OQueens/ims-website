# Spec — Site Motion Language + Dark "Get in touch" Page

**Date:** 2026-05-30
**Status:** APPROVED (Zach, this session). Ready for implementation plan → build in a fresh session.
**Branch:** `feat/ims-phase-1a-content` (worktree `feat-ims-phase-1-plan`)
**Staging:** `https://ims-staging.pages.dev` (HTTP Basic Auth, password `ZY`, any username). Redeploy recipe in §10.

---

## 1. Goal

Bring **best-in-class, accessible scroll motion** to the five static marketing pages that currently feel static, and **port the new dark "Get in touch" page + confetti success state** from the `IMS Design System.zip` handoff — unified into ONE motion language. Zach's directive: replicate the caliber of the best sites on the web (Apple / Linear / Stripe / Framer), executed tastefully ("nothing moves just to move"), cutting no corners. Hard constraint: **content must never be able to render invisible**.

### Why this is needed (root cause)
- `ScrollReveal.astro` (IntersectionObserver fade+rise) exists and works, but is applied to **only** `how-it-works.astro` + `specialties.astro`.
- The live homepage `index.astro` is raw zero-JS `<section>` markup; `about`, `clinicians`, `facilities`, `jobs` have **zero** reveal. (The `Home*.astro` components that use ScrollReveal are DEAD CODE — not imported by `index.astro`.)
- A second `.reveal` (40px/720ms) CSS system in `kit.css` + `about`/`facilities` is **orphaned** — no JS ever adds `.in`. Standardize on `ScrollReveal`; do not resurrect `.reveal`.

---

## 2. Approach (decision)

**Extend the existing IntersectionObserver + CSS-transition mechanism, hardened — NO new animation library, NO CSS `animation-timeline` as primary.** Rationale:

- **Zero new bundle / zero CSP surface.** CSP is `script-src 'self' 'unsafe-inline'` with **no `unsafe-eval`** (`public/_headers`). Motion/GSAP add weight; some paths need `unsafe-eval`. IO + CSS + one small canvas script cover everything (reveals, stagger, confetti).
- **NOT CSS scroll-driven (`animation-timeline: view()`) as primary** — Firefox still ships it disabled (as of 2026-05) and Safari support lags, which fragments the motion language across browsers and can't cleanly drive the confetti/timeline. May be used later as *optional* progressive sugar on ambient parallax only — never load-bearing.
- **Reuse the existing premium reveal curve** `cubic-bezier(0.22, 1, 0.36, 1)` (easeOutQuint settle) and the Magenta-Noir token system. No new design system.

---

## 3. Motion Primitives (the vocabulary)

Six reusable primitives. **All animate only `transform` + `opacity`** (compositor-only — no layout/CLS). All hidden start-states are gated behind `.js` (see §4) and killed under reduced-motion/print.

| # | Primitive | From → To | Duration | Easing | Notes |
|---|-----------|-----------|----------|--------|-------|
| 1 | **reveal-rise** (workhorse) | `opacity:0; translateY(20px)` → `opacity:1; translateY(0)` | **560ms** | `cubic-bezier(0.22,1,0.36,1)` | IO `rootMargin:'0px 0px -12% 0px'`, `threshold:0`, once-only (unobserve). `will-change` added on observe, **removed on `transitionend`**. 20px = the premium band (12px too subtle, 40px too template-y). |
| 2 | **stagger-step** | children get `style="--i:N"` → `transition-delay: calc(var(--i) * var(--stagger-step))` | step **70ms** | — | **Cap at 6 items / ~420ms.** For grids >6 (specialty grid=8), stagger first row only, then reveal the rest with the container. |
| 3 | **hero-entrance** (above-fold, first-paint-safe) | visible by default; `.js` adds `.hero-stage` (`opacity:0; translateY(16px)`) then 1 rAF later `.hero-go` plays reveal-rise | **600ms** | `cubic-bezier(0.22,1,0.36,1)` | The ONLY on-load (non-scroll) reveal. Stagger eyebrow→h1→sub→CTAs at 0/90/180/260ms. **Never** applied to interactive controls (jobs search/chips). If JS never runs, hero is fully visible. |
| 4 | **hover-lift** (standardize existing) | `translateY(-4px)` + shadow; `:active scale(0.98)` | 200ms | `--ease-snap` | Gated `@media (hover:hover) and (pointer:fine)`. Matches existing `.proc-card`/`.aud-mix__card`. |
| 5 | **ambient-glow-drift** | `transform: translate()/scale()` + `opacity` only, ~3–5% drift | 14–22s `linear` infinite | — | Vestibular-safe (no large positional). The brand blobs "breathing." Reduced-motion + mobile off. |
| 6 | **success-pop + confetti** (north star) | `gtPop scale(0.4→1.12→1)`; `gtRise translateY(18px→0)` stagger 60/140/220; 160-piece canvas confetti | 600ms | `--ease-snap` (pop), `--ease-out` (rise) | From the handoff; the timing anchor (600ms) the whole site harmonizes to. Reduced-motion = explicit **JS** skip (see §4). |

### New tokens to add (DRY)
```css
--dur-reveal: 560ms;      /* primitive 1 */
--stagger-step: 70ms;     /* primitive 2 */
```
Reuse existing: `--ease-out cubic-bezier(0.22,0.61,0.36,1)`, `--ease-snap cubic-bezier(0.32,0.72,0,1)`, `--ease-spring cubic-bezier(0.34,1.56,0.64,1)`.
**VERIFY at build:** active duration tokens live in `src/styles/colors_and_type.css` (`--dur-fast 150ms / --dur-base 280ms / --dur-slow 520ms`). The legacy `tokens.css` (120/200/360) is NOT loaded on marketing pages — ignore it. The reveal curve `cubic-bezier(0.22,1,0.36,1)` is the existing ScrollReveal curve; keep it (richer than `--ease-out` for entrances).

---

## 4. Never-invisible hardening (LOAD-BEARING — do not skip)

Today `.scroll-reveal{opacity:0}` is the **default** resting state, depending on JS to reveal. If the bundled script 404s/throws (CSP/JS error) and the user is NOT reduced-motion → content is invisible forever. There is no no-JS fallback. **Invert the default to visible; only hide once JS is confirmed:**

1. In `MarketingLayout.astro`, immediately after `<html>`, add an inline (CSP-allowed via `'unsafe-inline'`) script: `document.documentElement.classList.add('js')`.
2. Gate hidden start-states on `.js`:
   ```css
   .scroll-reveal { opacity: 1; transform: none; }              /* bare default = VISIBLE */
   .js .scroll-reveal { opacity: 0; transform: translateY(20px); transition: opacity var(--dur-reveal) cubic-bezier(0.22,1,0.36,1), transform var(--dur-reveal) cubic-bezier(0.22,1,0.36,1); }
   .scroll-reveal.is-revealed { opacity: 1; transform: none; }
   ```
   Apply the same `.js`-gated pattern to `.reveal`, `.cc__step`, `.hero-stage`.
3. Belt-and-suspenders:
   ```css
   @media (prefers-reduced-motion: reduce), print {
     .scroll-reveal, .reveal, .cc__step, .hero-stage { opacity: 1 !important; transform: none !important; transition: none; }
   }
   ```
4. Keep the component's existing `revealAll()` fallback (IO-unsupported but JS present).

**Result:** no-JS, script-error, crawler, print, SSR-snapshot, IO-unsupported → all render at `opacity:1`. The IO script only ever *removes* visibility (then restores via `.is-revealed`) on browsers that proved they can run it.

**Reduced-motion + confetti:** the global switch in `colors_and_type.css:389` collapses durations to `0.01ms !important` (it does NOT cancel JS loops). So the confetti must skip via an **explicit JS guard**: `if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;`.

---

## 5. Per-surface application plan

Above-fold heroes use **hero-entrance** (primitive 3, first-paint-visible). Below-fold sections use **reveal-rise + stagger** via hardened `ScrollReveal`.

- **HOME (`index.astro`):** hero = hero-entrance (eyebrow/rotator-h1/sub/2 CTAs 0/90/180/260; the rotator keyframe is already first-paint-safe). Marquee = fade-in wrapper only (it's already CSS motion, leave the scroll). Stats row (4 statchips) = reveal-rise + stagger 0–3. Audience split (2 cards) = stagger 0/70. Compare (2 lists) = reveal the two columns 0/70; **do NOT** stagger the 7 bullet rows (too noisy). CTA band = single block. Process (3 cards) = stagger 0/70/140. Specialty grid (8 cards) = stagger first 4 (0/70/140/210), reveal remaining 4 with container. Values (3 cards) = stagger 0/70/140. ContactPanel = reveal-rise block (stays cream — see §6).
- **ABOUT (`about.astro`, already uses ScrollReveal):** keep; standardize stagger to `--i`. hero = hero-entrance. mission = reveal-rise. pillars(3) = stagger. team (2 groups of 3) = reveal each group on its own scroll-in, stagger the 3 within. stats(4) = stagger.
- **CLINICIANS (`clinicians.astro`) — SIGNATURE MOMENT:** hero = hero-entrance. The vertical **timeline** (`.cc__step--01..04` + `.cc__timeline-line`): (a) the connecting line draws top→bottom via `transform: scaleY(0)→1; transform-origin: top`, **900ms `--ease-out`**, triggered when the track enters; (b) each step reveal-rises with **140ms** stagger (slower for drama — page hero), and its numbered node pops `--ease-spring scale(0.6→1)` 60ms after its card starts. why(4) = first-row stagger rule. quotes(3) = stagger. CTA = reveal-rise.
- **FACILITIES (`facilities.astro`, already uses ScrollReveal):** hero w/ roster(4) = hero-entrance, roster chips stagger on load. marquee = leave. pillars(3) = stagger. quotes(3) = stagger. form CTA = block.
- **JOBS (`jobs/index.astro`) — GRID-SAFE:** hero w/ SEARCH + CHIPS is above-fold + **interactive** → render fully visible immediately; hero-entrance at most on the heading, **NEVER** on the search input/chips (no fade-in on interactive controls). The card grid is **live-filtered** by JS toggling `.is-hidden{display:none}` → **do NOT** put per-card IO here. Instead reveal the **whole grid container once** (single observer on the wrapper) when it first enters; filtering then operates on already-revealed cards.
- **DARK `/contact` + success:** see §6. This is the gold standard.

**Above-fold first paint (every page):** heroes render visible by default; hero-entrance adds the offset only AFTER `.js` + rAF confirm, so first paint shows the full hero even pre-hydration; the entrance plays one frame later.

---

## 6. Dark "Get in touch" page + success/confetti (port the handoff)

Source: `C:\Users\oclou\QueenClaude\_ims-design-extract\design_handoff_contact_page\` (`README.md` + `contact-reference.html`). High-fidelity; recreate pixel-faithfully in Astro using existing tokens.

- **Scope:** the dark design applies to **`/contact` + its success state ONLY** (Zach). The homepage's `ContactPanel` stays cream/unchanged. Replace `/contact`'s `<ContactPanel>` render with a new dark component (e.g. `src/components/sections/GetInTouch.astro` or inline in `contact.astro`). Keep `ContactPanel.astro` for the homepage.
- **Structure** (exact CSS in the understand-workflow map: `docs/superpowers/research/2026-05-30-handoff-and-codebase-map.json`): `.gt-page` dark wrapper (radial magenta+rose glows over `--mn-black`, two `.gt-glow` drifting blobs via primitive 5) → main `.gt-shell` grid `5fr 6fr` (≤920px → single column, max 560px): **left rail** (eyebrow "Get in touch", headline "Let's *talk*." with "talk" magenta, sub, 3-row Email/Phone/Office `<dl>`) + **cream form card** `.gt-card` (`--cream-soft #FBF6EE`, radius 24, shadow). → success `.gt-thanks` section (hidden until `.is-active`) → confetti `<canvas>` fixed sibling.
- **Form fields:** name (req) | email (req) on row 1; **"I am a…" segmented control** (3 radio-buttons: Facility/Clinician/Something else, values `facility`/`clinician`/`other`, one required — checked = ink bg + cream text); role (optional, full); message textarea (full); magenta submit pill "Send it →" with dark puck.
- **Tokens:** map to existing `--mn-*` family (all match exactly). Focus ring magenta. **Confetti 5 colors = `['#C44569','#E8C465','#D88B9F','#59BFE7','#F4ECDF']`** (use the code value `#F4ECDF`, NOT the README's `#FBF6EE`).
- **Success state copy (verbatim):**
  > Eyebrow: "Message received" · Title: "Thank you for *reaching out*." · Body: "We believe that every great opportunity starts with a conversation, and we're thrilled to have started one with you. We're already working on what's next, and we'll be in touch soon. Until then, know that we appreciate you and are excited for what's ahead." · Signoff: "With gratitude, **the IMS team**" · Actions: "Back to home →" (→ `/`) + "Browse open jobs" (→ `/jobs`).
- **Entrance animations:** transform-only (gtPop, gtRise — primitive 6). Per the handoff's own caution, NEVER `opacity:0` resting on these nodes.
- **Validation (client):** `name` non-empty; `email` matches `/.+@.+\..+/`; an `audience` radio checked. On invalid → focus + WAAPI shake (`translateX` 0/-6/6/0 over 320ms), do not advance.
- **Confetti:** port `fireConfetti()` near-verbatim (160 pieces, mixed rect/circle, gravity+drift+rotation, fade after 2600ms, clear by 4000ms, reduced-motion JS-skip). Run client-side only (inside the submit handler / a client island) — never at SSR module top-level.

### ⚠ Content reconciliation (do NOT ship the design's placeholders)
The handoff uses placeholder contact info that contradicts the committed real info. **Use the REAL info:**
- Email: **`recruiting@iastaffing.com`** (NOT `hello@imsstaffing.com`)
- Phone: **`(512) 524-6686`** (NOT `(817) 555-0140`)
- Office: **Fort Worth, TX**
- The meta lines "One floor, about 40 people" / "Replies within one business day" / "Mon–Fri 8a–6p Central" are unverified claims — keep them only behind the staging gate and flag for Zach's go-live confirmation (consistent with the deferred unverified-stats list).

---

## 7. Contact form BACKEND (right after look+feel — Zach's sequencing)

The form is currently non-functional (`/api/contact` does NOT exist → POST 404; `resend` not installed; `TurnstileWidget` built but orphaned; no success UX). Build it as the immediate follow-up after the visual/motion pass:

1. **Install** `resend` (npm dep; bundled by Astro).
2. **Create `src/pages/api/contact.ts`** (`export const prerender = false`): verify Turnstile token (`https://challenges.cloudflare.com/turnstile/v0/siteverify`) → on pass, send via Resend to `RECRUITING_TO_ADDRESS`. Reference implementation exists in `docs/plans/2026-05-06-ims-website-phase-1-plan.md` (~lines 3277–3581).
3. **Wire `TurnstileWidget`** into the form (`<TurnstileWidget form=".gt-form" />`) so the hidden `turnstileToken` input populates.
4. **Progressive success UX:** JS path = `fetch` POST → on 200 flip to success state + confetti (no navigation). No-JS path = native POST → 303 redirect to `/contact?sent=1` (server renders the success state). Both honor the client validation pre-check.
5. **Env vars:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RECRUITING_TO_ADDRESS`, `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` — **already set on PROD `ims-website`**; must be set on `ims-staging` to test there (and Supabase read vars for the webhook step).
6. **Codex-review** the endpoint (auth/verify/error handling) before claiming done.

---

## 8. Accessibility & performance (hard constraints)

- **Reduced motion:** global switch (`colors_and_type.css:389`) + per-primitive belt-and-suspenders (§4). Reduce-not-remove: keep focus rings, button press, jobs display-toggle. Confetti skipped via explicit JS guard.
- **Compositor-only:** transform + opacity only; the timeline line uses `scaleY` (transform). Never animate width/height/top/left/margin → no CLS/reflow. Heroes reserve their space.
- **`will-change` discipline:** add on observe, **remove on `transitionend`** (the current component sets it permanently — change to JS add/remove). Never blanket-promote the whole 8-card grid simultaneously.
- **Mobile:** smaller translate (16px <768px); disable ambient-glow-drift (battery); hover-lift already gated to fine pointers. Consider `content-visibility:auto` + `contain-intrinsic-size: 0 600px` on long below-fold sections (MUST set intrinsic size or scrollbars jump). Target 60fps on a mid-range Android.

---

## 9. Implementation phases (for the plan / fresh-session build)

- **Phase 0 — Motion infra:** add `--dur-reveal`/`--stagger-step` tokens; add `.js` flip to `MarketingLayout`; harden `ScrollReveal` (invert default visible, `.js`-gate, will-change add/remove on transitionend); add stagger support (`--i`) + hero-entrance primitive + ambient-glow-drift helper. Verify how-it-works/specialties still reveal (no regression).
- **Phase 1 — Apply across pages:** home, about, clinicians (timeline signature), facilities, jobs (grid-safe). Standardize about/facilities to `--i` stagger (keep `data-reveal-delay` fallback during transition).
- **Phase 2 — Dark `/contact` + success + confetti** (client-side success; real info; verbatim copy).
- **Phase 3 — Build + deploy + VERIFY:** `npm run build` → `STAGING_GATE_PASSWORD=ZY node scripts/apply-staging-gate.mjs` → redeploy `ims-staging` → **Playwright real-browser verification** (reveals fire on scroll, hero on load, reduced-motion path renders visible+instant, no-JS renders visible, confetti on submit, no jank). Confirm `verify-build` 11/11 + `vitest` 83/83.
- **Phase 4 — Backend (§7):** `/api/contact` + Resend + Turnstile + progressive success; set staging env; verify end-to-end; Codex-review.

Each phase: atomic commits; `npm run build` + `verify` + `test` gates green; **Codex review on non-trivial changes** (the Codex runtime is working again — `codex-cli 0.135.0`); `review-gate` stamp.

---

## 10. Redeploy recipe (staging)
```
npm run build
STAGING_GATE_PASSWORD=ZY node scripts/apply-staging-gate.mjs
CLOUDFLARE_API_TOKEN=$(cat ~/.cloudflare-token) CLOUDFLARE_ACCOUNT_ID=7e0fc3bb9718dbaf4d31145eb6da1c5a \
  npx wrangler@latest pages deploy dist --project-name=ims-staging --branch=main --commit-dirty=true
```
(`npm run build` regenerates a CLEAN `dist` with no gate — MUST re-run the gate script after every build.)

---

## 11. Risks / resolved decisions

**Resolved (Zach delegated — "do whatever you think is best"):**
- Add `.js` class flip to `MarketingLayout` → **YES** (strictly safer no-JS contract).
- Add `--dur-reveal` / `--stagger-step` tokens vs hardcode → **ADD TOKENS** (DRY).
- Clinicians timeline 900ms draw (the one "spend" moment) vs ≤600ms uniformity → **KEEP 900ms** (it's the signature).
- Ambient-glow-drift ship now vs defer → **SHIP NOW** (content-agnostic; the placeholder-content gate doesn't apply to motion).
- Dark design scope → **`/contact` + success only**; homepage ContactPanel stays cream.
- Form sending → **look+feel first, real backend immediately after.**

**Open risks to watch during build:**
1. `about.astro` + `facilities.astro` use the `delay` prop, not `--i` — standardizing is a small refactor; keep `data-reveal-delay` as a fallback path so their current reveals don't regress.
2. Token-value confusion: the synthesis cited `tokens.css` (120/200/360); the ACTIVE file is `colors_and_type.css` (150/280/520). Use the active values; verify by reading the file.
3. `content-visibility:auto` can break anchor scrolling if intrinsic sizes mismatch real heights — test.
4. Staging content (marquee names, testimonials, stats) is still placeholder/deferred per memory — motion must be **content-agnostic** (built on existing markup) so it's correct when real content lands.
5. The dark `/contact` success timing (gtPop/gtRise) is the shared 600ms anchor — if those values change, re-sync the site's reveal timings.

---

## 12. Pointers
- Understand-workflow map (exact handoff CSS, contact stack, tokens, sections): `docs/superpowers/research/2026-05-30-handoff-and-codebase-map.json` (committed; was workflow task output `wi2sgcofn`).
- Motion research + synthesis (the proposal this spec is built from): `docs/superpowers/research/2026-05-30-motion-research-synthesis.json` (committed; was workflow task output `w8lr4fker`).
- Memory: `project_ims_motion_workstream_2026-05-30.md`, `project_ims_chromia_cream_v3_port_2026-05-28.md`.
