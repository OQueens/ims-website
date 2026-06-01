# Natural-Stagger Motion System + Mobile Overhaul — Design Spec

**Date:** 2026-06-01 · **Branch:** `feat/ims-phase-1a-content` · **Surface:** all 7 marketing pages + chrome + `/contact`
**Supersedes/absorbs:** the open `/contact` success-state delight task and the site-wide motion critique from
`project_ims_contact_backend_2026-05-31` (TOP NEXT-SESSION PRIORITY).
**Builds on:** `2026-05-30-motion-and-contact-design.md` (the prior motion spec) — this spec **replaces its reveal
mechanism** (container-level fade) with a per-child cascade and adds the mobile + floating-node + success-state work.

---

## 1. Problem (verified in code, not assumed)

Zach's verbatim critique after viewing live staging: *"the motion itself is horrible. Stuff loads in together and not
like individually… This motion looks so poor."* Plus: mobile is missing elements, and the floating CTA nodes are gone.

Three root causes, all confirmed by reading source:

1. **The stagger is wired but dead.** [kit.css:2171](../../../src/styles/kit.css) defines
   `transition-delay: calc(var(--i,0) * var(--stagger-step))` — but only on `html.js .scroll-reveal`. Pages put
   `.scroll-reveal` on the **container** (`.positioning`, `.aud-mix`, `.process-cards`, `.spec-grid`, `.values`) while the
   `--i:N` vars sit on the **children** ([index.astro:117-124](../../../src/pages/index.astro), 385-397). The children
   are not reveal elements, so their `--i` never applies. **The whole container fades as one block with `--i:0` → zero
   stagger.** This is the "loads in together, not individually" bug exactly.
2. **Floating nodes are killed on mobile/tablet by design.** [kit.css:1292](../../../src/styles/kit.css) (+ dup 1294):
   `@media (max-width: 1080px) { .cta-pop { display: none; } }`. On every phone, tablet, and small laptop the four
   `.cta-pop` nodes around the "Skip ahead / Tell us what you need" band vanish entirely.
3. **The ported reference has no scroll choreography.** The `design-imports/claude-design-01` bundle is a static React
   prototype: hover-lift (`translateY(-3px)` + `brightness(1.04)` @200ms `--ease-out`), button press (`scale(0.98)`
   @120ms), one 360ms `page-fade`, and the `/contact` drifting glows. No IntersectionObserver, no stagger. So the
   "natural staggered cascade" Zach wants must be **built with standard motion craft** — it was never in the bundle.
   The bundle remains canonical for the *aesthetic vocabulary* (hover/press/fade/glow values), which we match exactly.

**Design principle (Zach's words):** elements enter in a **natural cascade — card by card, staggered, not robotic, not
as a synchronized pair.** Smooth ease-out deceleration, short organic travel. This is the standard premium pattern.

---

## 2. Research basis (the quality bar)

Cross-validated from impeccable.style (Zach's named reference), Framer Motion / motion.dev, Emil Kowalski's "Great
Animations", Material Design motion tokens, easings.net, and the prior in-repo synthesis. Key rulings:

- **Stagger is the #1 lever.** 50–100ms between siblings reads as one cascading gesture; 60–80ms is the card sweet
  spot. Below ~40ms stops reading as stagger; above ~120ms reads as a slow list, not a cascade.
- **Ease-out for everything entering.** `cubic-bezier(0.22,1,0.36,1)` (easeOutQuint) is the "expensive" workhorse;
  `cubic-bezier(0.16,1,0.3,1)` (easeOutExpo) for the hero/large moves. Never `ease` / `ease-in-out` / `transition: all`.
- **Short directional travel.** 16–24px rise (we use 22px), ≤32px for side content (±28px). Large distances read cheap.
- **Transform + opacity only** (composite-only). Never width/height/margin/top/left.
- **Overshoot/bounce on UI is "dated and tacky"** (impeccable.style, verbatim). Reserve overshoot strictly for the
  success-pop, confetti, and the clinicians timeline node pops. Everything else is smooth ease-out.
- **Ambient life:** decorative drift ≤8–10px, 6–12s, **desynced** via negative `animation-delay` (lockstep loops are the
  cheap tell). Hover-lift gated to `@media (hover:hover) and (pointer:fine)`.
- **Duration bands:** hover 150–250ms; reveals 600–800ms (they travel + fire once); success/hero ~600–700ms; the one
  "spend" moment (clinicians timeline line-draw) ~900ms.

---

## 3. Motion tokens (extend the existing set; do not duplicate)

Existing in [colors_and_type.css:202-209](../../../src/styles/colors_and_type.css):
`--ease-out: cubic-bezier(0.22,0.61,0.36,1)`, `--ease-snap: cubic-bezier(0.32,0.72,0,1)`,
`--ease-spring: cubic-bezier(0.34,1.56,0.64,1)` (= easeOutBack, marked "reserved"),
`--dur-fast 150ms`, `--dur-base 280ms`, `--dur-slow 520ms`, `--dur-reveal 560ms`, `--stagger-step 70ms`.

**Add / adjust:**
```css
--ease-rise:  cubic-bezier(0.22, 1, 0.36, 1);   /* easeOutQuint — the reveal workhorse (was hardcoded in kit.css) */
--ease-hero:  cubic-bezier(0.16, 1, 0.3, 1);    /* easeOutExpo — hero + large entrances */
/* reuse --ease-spring (easeOutBack) for the success-pop + node pops ONLY */
--dur-reveal: 620ms;     /* was 560 — slightly longer for the natural glide */
--stagger-step: 80ms;    /* was 70 — read each card as clearly individual */
```
All reveal/stagger CSS references these tokens (no more hardcoded curves), so the whole site shares one motion language
and tunes in one place.

---

## 4. Architecture — the `reveal-group` cascade (the core fix)

A container marked `.reveal-group` is the IntersectionObserver trigger; its children marked `.reveal` (each with an
incrementing `--i`) cascade individually. This is the Framer-Motion `staggerChildren` model in pure CSS.

```css
/* BARE DEFAULT = VISIBLE (no-JS / crawler / print / SSR / reduced-motion safe) */
.reveal { opacity: 1; transform: none; }

/* Hidden start-state ONLY once JS confirms (html.js), scoped to a revealed group's children */
html.js .reveal-group > .reveal {
  opacity: 0;
  transform: translateY(22px);
  transition: opacity var(--dur-reveal) var(--ease-rise),
              transform var(--dur-reveal) var(--ease-rise);
  transition-delay: calc(var(--i, 0) * var(--stagger-step));
}
/* Revealed — MUST stay html.js-gated to outrank the hidden rule (specificity lesson from 2026-05-30) */
html.js .reveal-group.is-revealed > .reveal { opacity: 1; transform: none; }

/* Directional variants so adjacent cards don't all rise identically (reads "natural", not "robotic") */
html.js .reveal-group > .reveal--left  { transform: translateX(-28px); }
html.js .reveal-group > .reveal--right { transform: translateX(28px); }
html.js .reveal-group > .reveal--scale { transform: translateY(22px) scale(0.96); }
html.js .reveal-group.is-revealed > .reveal { transform: none; }  /* covers all variants */

@media (prefers-reduced-motion: reduce), print {
  .reveal { opacity: 1 !important; transform: none !important; transition: none; }
}
```

**Observer (extends the existing inline observer in MarketingLayout):** observe `.reveal-group` **and** keep observing
standalone `.scroll-reveal` (back-compat). On intersect, add `.is-revealed` (groups) / `.is-revealed` (standalone),
set `will-change` then clear on `transitionend` (+ failsafe timeout), `unobserve` (once-only). The head load+1500ms
never-invisible failsafe must also force `.reveal-group.is-revealed` on every group.

**Back-compat:** `.scroll-reveal` (single-element fade) is retained for `how-it-works.astro` / `specialties.astro`
section wrappers. Where those want a cascade, they convert to `.reveal-group` + `.reveal` children. `ScrollReveal.astro`
gains an optional `group` prop that emits `.reveal-group` instead of `.scroll-reveal`.

**Stagger discipline:** cap visible stagger at 6 children (`--i` 0–5); for grids >6 (8-card specialty grid), the first
row cascades and the remainder reveal together (assign `--i` per-row, not per-card, beyond row 1) so the tail never
drags. Section headers cascade their own children (eyebrow `--i:0` → heading `--i:1` → sub `--i:2`).

---

## 5. Motion primitives (exact values)

| Primitive | Duration | Transform | Stagger | Easing |
|---|---|---|---|---|
| **hero-entrance** | 700ms | `translateY(24px→0)` + opacity | lines 0/90/180/260ms | `--ease-hero` |
| **reveal-rise** (workhorse) | 620ms | `translateY(22px→0)` + opacity | n/a (single) | `--ease-rise` |
| **stagger cascade** (group child) | 620ms each | `translateY(22px→0)` / ±28px / scale .96 | `--i × 80ms` | `--ease-rise` |
| **hover-lift** (cards) | 200ms in / 240ms out | `translateY(-4px)` + shadow grow | — | in `--ease-rise`, out `--ease-out` |
| **button-press** | 110ms | `scale(0.97)` on `:active` | — | `--ease-snap` |
| **ambient-drift** (nodes/glows) | 7–12s infinite | `translate(≤8px,≤8px)` | desynced `animation-delay` | `ease-in-out` |
| **success-pop** (delight only) | 600ms | `scale(0.4→1.12→1)` | — | `--ease-snap` (mark) / `--ease-spring` ok |
| **timeline line-draw** (clinicians) | 900ms | `scaleY(0→1)` origin top | nodes pop after | `--ease-rise` |

Hover/press all gated `@media (hover: hover) and (pointer: fine)` so touch devices never get stuck states.

---

## 6. Per-surface application

**Home (`index.astro`)** — hero already staggers (`.hero-stage` + `--i`); keep. Convert each container `.scroll-reveal`
to `.reveal-group`, tag children `.reveal` + `--i`: stat chips (positioning), the 2 audience cards (alternate
`--left`/`--right`), compare columns (`--left`/`--right`), CTA band inner (header cascade), 3 process cards, 8 specialty
cards (row-1 cascade), 3 value cards, ContactPanel. Section-anchor headers cascade.

**About, Clinicians, Facilities, Jobs, How-it-works, Specialties** — same rule: every grid/list/card-row → `.reveal-group`
with cascading `.reveal` children; section headers cascade; signature moment on Clinicians = the timeline line-draw +
node pops (already present per prior work — verify it still fires and uses the new tokens). Jobs search/filter controls
get **no entrance animation** (interactive above-fold). Each page audited individually during execution.

**Chrome (nav/footer)** — nav stays static (no entrance); add hover-lift/press polish to pills/links consistent with the
token system. Footer signoff may get a single reveal-rise.

**Floating nodes (`.cta-pop`)** — replace `display:none ≤1080px` with a responsive treatment:
- Desktop (>1080px): all 4, current positions, **desynced** ambient drift (already desynced via per-node `--cta-pop-*`
  delays — verify, keep).
- Mobile/tablet (≤1080px): show a **2-node subset** (e.g. `--tl` "Live phone line" + `--br` "No AI / Just humans"),
  scaled ~0.8, repositioned to safe corners that don't overlap the headline, lighter drift. Hide the other two.
- All drift killed under `prefers-reduced-motion`.

---

## 7. `/contact` success-state rebuild

Current live success state (`.gt-thanks.is-active`) has hard-clipped glow edges (the `overflow:hidden` added in `632afe3`
to contain the now-`absolute` `.gt-glow` divs) and reads plain.

- **Drop the separate `.gt-glow` blurred divs**; rely on `.gt-page`'s own soft radial-gradient background (fades
  naturally, no clip). Re-evaluate the `.gt-page` `overflow` once the glow divs are gone (likely can relax to
  `overflow-x: hidden` or remove entirely).
- **Keep** the existing transform-only success choreography (`gtPop` `scale 0.4→1.12→1` @600ms `--ease-snap`; `gtRise`
  `translateY 18px→0` staggered 60/140/220ms with `backwards` fill) and the 160-piece confetti
  (`['#C44569','#E8C465','#D88B9F','#59BFE7','#F4ECDF']`, 2600/900/4000ms fade).
- **Add hover-alive micro-interactions** (within reduced-motion + never-invisible): submit-button lift
  (`translateY(-2px)` + shadow) + puck slide (`translateX(3px)`), segmented-control press feedback, and a gentle
  **breathing** on the success checkmark disc (slow `scale 1↔1.03`, reduced-motion off). Confetti stays a one-shot burst
  (JS-guarded for reduced-motion).
- Keep the dark-only scoping (`body:has(.gt-page){background:#0A0A0F}`) and real contact info.

---

## 8. Hard contracts (non-negotiable)

1. **Never-invisible.** Every reveal element is `opacity:1; transform:none` by default; hidden only under `html.js`. The
   head failsafe force-reveals everything 1500ms after load if the observer never signals ready. No element's *resting*
   state is ever `opacity:0`.
2. **prefers-reduced-motion.** Reveals jump to final state instantly (no transition); ambient drift + breathing off;
   confetti JS-guarded (`matchMedia('(prefers-reduced-motion: reduce)').matches` early-return before the rAF loop — the
   global CSS switch only shortens durations, it won't cancel a canvas loop).
3. **Transform + opacity only.** No layout-property animation anywhere.
4. **CSP-safe.** No new JS motion lib (CSP has no `unsafe-eval`). Pure CSS transitions/animations + the existing inline
   IntersectionObserver. (`linear()` springs are CSS timing functions and CSP-safe, but **not required** — easeOutBack
   covers the pop; defer `linear()` unless a moment specifically needs it.)
5. **No re-fire on scroll-up** (once-only `unobserve`). Interruptible.

---

## 9. Verification (before any completion claim)

1. `npm run build` + `npm run verify` (verify-build invariants) + `vitest` (≥150 green) — all pass.
2. Deploy to `ims-staging` apex via the `--branch=main` recipe (build with `PUBLIC_TURNSTILE_SITE_KEY=1x…AA` → gate
   `STAGING_GATE_PASSWORD=ZY node scripts/apply-staging-gate.mjs` → `wrangler pages deploy dist
   --project-name=ims-staging --branch=main`).
3. **Playwright real-browser verification on BOTH viewports, every page:**
   - **Mobile 390×844** and **desktop 1440×900** (+ a tablet 768 spot-check on the CTA band).
   - Assert (computed-style, not just class presence — the 2026-05-30 specificity lesson): group children transition
     `opacity 0→1` with **distinct `transition-delay` per `--i`** (the cascade actually staggers); above-fold hero
     staggers; floating nodes **render on mobile** (2-node subset visible, not `display:none`); never-invisible holds
     (remove `html.js` → everything opacity 1); `/contact` success state has no clipped glow; reduced-motion emulation
     → content visible, no confetti loop.
   - Screenshot each page at both viewports for Zach.
4. **Codex 0.135.0 review** (native binary recipe, file contents embedded in prompt) — fold findings, loop until clean.
5. Only then report, tagged `[runtime-verified]`.

---

## 10. Non-goals (YAGNI)

- No new animation library, no `animation-timeline: view()` as primary (Firefox still ships it disabled).
- No cursor-following magnetic JS (the CSS hover-scale approximation is enough for now).
- No parallax, no scroll-scrubbed timelines, no count-up stats (out of scope; can revisit).
- No content/copy changes, no backend changes (durable-capture + Resend untouched).
- Not pushing/merging — staging only, for Zach's review.

---

## 11. Open risks

- **Specificity inversion** (the 2026-05-30 trap): every "revealed" rule must stay `html.js`-gated. Caught only by
  computed-style inspection in a real browser — hence the Playwright computed-style assertions.
- **8-card grid tail drag** if every card gets a unique `--i`; mitigated by row-capped stagger.
- **Mobile node crowding** at 390px; mitigated by the 2-node subset + safe-corner positioning + Playwright screenshot
  review before claiming done.
- **Reveal-group with a single child** must still animate (degenerate cascade = one reveal-rise).
