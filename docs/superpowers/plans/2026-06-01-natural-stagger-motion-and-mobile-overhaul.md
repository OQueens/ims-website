# Natural-Stagger Motion + Mobile Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the site's scroll/reveal/hover motion into a cohesive, per-element *natural stagger* cascade, restore the floating CTA nodes on mobile, polish the `/contact` success state, and fix mobile breakage — verified on real mobile + desktop viewports.

**Architecture:** A shared motion-token set + a new `.reveal-group` CSS mechanism (an IntersectionObserver reveals the *container*; its `.reveal` children cascade individually via `transition-delay: calc(var(--i) * --stagger-step)` — the Framer-Motion `staggerChildren` model in pure CSS). Existing `.scroll-reveal` (single-element) and `.hero-stage` (hero) mechanisms are kept for back-compat; the clinicians timeline (line-draw + node pop) is preserved. No new JS library (CSP-safe). Every reveal is visible-by-default and hidden only under `html.js` (never-invisible contract).

**Tech Stack:** Astro (static + SSR), vanilla CSS (`src/styles/colors_and_type.css`, `kit.css`), one inline IntersectionObserver in `MarketingLayout.astro`, Cloudflare Pages (`ims-staging`), Playwright (verification), Codex 0.135.0 (review).

**Spec:** `docs/superpowers/specs/2026-06-01-natural-stagger-motion-and-mobile-overhaul-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/styles/colors_and_type.css` | Motion tokens (single source of truth) | Modify (Task 1) |
| `src/styles/kit.css` | Reveal-group CSS, repoint curves to tokens, `.cta-pop` responsive | Modify (Tasks 1, 2, 12) |
| `src/layouts/MarketingLayout.astro` | Observer + never-invisible failsafe | Modify (Task 3) |
| `src/components/util/ScrollReveal.astro` | Optional `group` prop | Modify (Task 3) |
| `scripts/verify-build.mjs` | Static motion-contract invariant | Modify (Task 4) |
| `src/pages/index.astro` | Homepage cascade (worked example) | Modify (Task 5) |
| `src/pages/about.astro` | Cascade | Modify (Task 6) |
| `src/pages/facilities.astro` | Cascade | Modify (Task 7) |
| `src/pages/clinicians.astro` | Cascade + preserve timeline | Modify (Task 8) |
| `src/pages/jobs/index.astro` | Cascade (filter-safe) | Modify (Task 9) |
| `src/pages/how-it-works.astro`, `specialties.astro` | Cascade (ScrollReveal wrapper pages) | Modify (Task 10) |
| `src/components/nav/SiteNav.astro`, `footer/SiteFooter.astro` | Hover polish | Modify (Task 11) |
| `src/components/sections/GetInTouch.astro` | `/contact` success rebuild | Modify (Task 13) |

**Conventions used by every page task:**
- A **container** that should cascade gets class `reveal-group` (add it; if it currently has `scroll-reveal`, replace it).
- Each **direct child** that should cascade gets class `reveal` + `style="--i:N"` (0-based, incrementing). Children rendered via `.map((x,i)=>…)` use `style={\`--i:${i}\`}` and `class:list={['reveal', existing]}` (Astro), capping `--i` at 5 for grids >6 (use `Math.min(i,5)`).
- For a 2-up row, alternate direction: first child `reveal reveal--left`, second `reveal reveal--right`.
- A **section-anchor header** (`<div class="section-anchor">…`) becomes `class="section-anchor reveal-group"`; its direct children (the `<div>` holding eyebrow+heading, and the `<p class="…__sub">`) get `reveal` + `--i:0` / `--i:1`.
- **Do NOT touch:** heroes (`.hero-stage` already cascades), marquees, all decorative blobs/glows/pulse dots, and interactive above-fold controls (search inputs, filter chips, tabs, form fields, nav) — these get NO entrance animation.
- Motion verification is **deferred to Task 16 (Playwright)** — per-page tasks verify only that the build compiles and the conversion matches this plan (logical inspection). Do not claim motion "works" in a page task.

---

## Phase 0 — Motion infrastructure

### Task 1: Motion tokens + repoint hardcoded curves

**Files:**
- Modify: `src/styles/colors_and_type.css:202-209`
- Modify: `src/styles/kit.css:2169-2170` (scroll-reveal transition), `2186` (hero-stage transition)

- [ ] **Step 1: Add the two new easing tokens + adjust durations**

In `src/styles/colors_and_type.css`, the existing block is:
```css
  --ease-out:        cubic-bezier(0.22, 0.61, 0.36, 1);  /* default */
  --ease-snap:       cubic-bezier(0.32, 0.72, 0.00, 1);  /* page xitions */
  --ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1);  /* reserved */
  --dur-fast:        150ms;
  --dur-base:        280ms;
  --dur-slow:        520ms;
  --dur-reveal:      560ms;   /* scroll-reveal entrance */
  --stagger-step:    70ms;    /* per-child cascade step */
```
Replace with:
```css
  --ease-out:        cubic-bezier(0.22, 0.61, 0.36, 1);  /* default / hover-out */
  --ease-snap:       cubic-bezier(0.32, 0.72, 0.00, 1);  /* success mark / page xitions */
  --ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1);  /* DELIGHT ONLY — node pop / success */
  --ease-rise:       cubic-bezier(0.22, 1, 0.36, 1);     /* easeOutQuint — reveal workhorse */
  --ease-hero:       cubic-bezier(0.16, 1, 0.3, 1);      /* easeOutExpo — hero + large entrances */
  --dur-fast:        150ms;
  --dur-base:        280ms;
  --dur-slow:        520ms;
  --dur-reveal:      620ms;   /* scroll-reveal entrance (was 560) */
  --stagger-step:    80ms;    /* per-child cascade step (was 70) */
```

- [ ] **Step 2: Repoint the hardcoded reveal curve to the token**

In `src/styles/kit.css`, the `html.js .scroll-reveal` rule (~2169-2170) currently hardcodes the curve:
```css
  transition:
    opacity var(--dur-reveal, 560ms) cubic-bezier(0.22, 1, 0.36, 1),
    transform var(--dur-reveal, 560ms) cubic-bezier(0.22, 1, 0.36, 1);
```
Replace with:
```css
  transition:
    opacity var(--dur-reveal, 620ms) var(--ease-rise),
    transform var(--dur-reveal, 620ms) var(--ease-rise);
```

- [ ] **Step 3: Repoint the hero-stage curve to the hero token**

In `src/styles/kit.css` (~2186), the `html.js .hero-stage > *` rule hardcodes `cubic-bezier(0.22,1,0.36,1)`. Replace its `transition` line with:
```css
  transition: opacity 700ms var(--ease-hero), transform 700ms var(--ease-hero);
```
(Was 600ms quint; now 700ms expo per spec — more dramatic hero entrance. Leave the `transition-delay: calc(var(--i, 0) * 90ms)` line unchanged.)

- [ ] **Step 4: Build to verify CSS parses**

Run: `npm run build`
Expected: build completes with no CSS/Astro errors.

- [ ] **Step 5: Commit**

```bash
git add src/styles/colors_and_type.css src/styles/kit.css
git commit -m "motion(tokens): add --ease-rise/--ease-hero, retune reveal 620/80ms, repoint curves"
```

---

### Task 2: Reveal-group cascade CSS

**Files:**
- Modify: `src/styles/kit.css` (insert immediately AFTER the existing `.scroll-reveal` block, which ends at the `@media (prefers-reduced-motion…)` rule ~line 2179, BEFORE the `.hero-stage` block ~2181)

- [ ] **Step 1: Add the reveal-group block**

Insert:
```css
/* Reveal-group · per-child STAGGERED cascade (the fix for "loads all-at-once").
 * The container is the IntersectionObserver trigger; its direct .reveal children
 * cascade individually via --i. Bare default = visible (never-invisible). The
 * revealed rule MUST stay html.js-gated so it outranks the hidden rule
 * (specificity: hidden 0,3,1 < revealed 0,4,1) — the 2026-05-30 lesson. */
.reveal-group > .reveal { opacity: 1; transform: none; }
html.js .reveal-group > .reveal {
  opacity: 0;
  transform: translateY(22px);
  transition:
    opacity var(--dur-reveal, 620ms) var(--ease-rise),
    transform var(--dur-reveal, 620ms) var(--ease-rise);
  transition-delay: calc(var(--i, 0) * var(--stagger-step, 80ms));
  will-change: opacity, transform;
}
/* Directional variants — adjacent cards don't all rise identically (reads natural). */
html.js .reveal-group > .reveal--left  { transform: translateX(-28px); }
html.js .reveal-group > .reveal--right { transform: translateX(28px); }
html.js .reveal-group > .reveal--scale { transform: translateY(22px) scale(0.96); }
/* Revealed — outranks every hidden/directional rule above (0,4,1). */
html.js .reveal-group.is-revealed > .reveal { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce), print {
  .reveal-group > .reveal { opacity: 1 !important; transform: none !important; transition: none; }
}
```

Note on `will-change`: it's set in CSS here for simplicity (the children are few and once-only); the observer (Task 3) does not need to add/remove it for groups. Acceptable because group children are bounded.

- [ ] **Step 2: Build to verify CSS parses**

Run: `npm run build`
Expected: build completes, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/kit.css
git commit -m "motion(css): add .reveal-group per-child stagger cascade + directional variants"
```

---

### Task 3: Observer + failsafe + ScrollReveal `group` prop

**Files:**
- Modify: `src/layouts/MarketingLayout.astro:100-106` (head failsafe), `156-205` (inline observer)
- Modify: `src/components/util/ScrollReveal.astro`

- [ ] **Step 1: Extend the head never-invisible failsafe to cover groups**

In `MarketingLayout.astro`, the head failsafe currently force-reveals `.scroll-reveal` + `.hero-stage`. Add `.reveal-group`:
```js
      addEventListener('load', function () {
        setTimeout(function () {
          if (window.__scrollRevealReady) return;
          document.querySelectorAll('.scroll-reveal, .reveal-group').forEach(function (el) { el.classList.add('is-revealed'); });
          document.querySelectorAll('.hero-stage').forEach(function (el) { el.classList.add('hero-go'); });
        }, 1500);
      });
```

- [ ] **Step 2: Make the main observer observe + reveal groups too**

In the inline observer (`MarketingLayout.astro`), update `revealAll()` and the `observe` query so `.reveal-group` is treated like `.scroll-reveal` (the CSS does the cascade; the observer just toggles `.is-revealed` on the container):
```js
        function revealAll() {
          document.querySelectorAll('.scroll-reveal, .reveal-group').forEach(function (el) {
            el.classList.add('is-revealed');
          });
        }
```
and the observe loop:
```js
          document.querySelectorAll('.scroll-reveal, .reveal-group').forEach(function (el) {
            observer.observe(el);
          });
```
The existing per-entry handler (adds `.is-revealed`, sets/clears `will-change`, `unobserve`) is unchanged and works for both — for a `.reveal-group` it adds `.is-revealed` to the container, and the CSS cascades the children. (The `el.style.willChange` it sets on the container is harmless.)

- [ ] **Step 3: Add an optional `group` prop to ScrollReveal.astro**

Replace the body of `src/components/util/ScrollReveal.astro` so it can emit a group container:
```astro
---
interface Props {
  as?: string;
  /** legacy single-element delay in ms (kept for about/facilities back-compat) */
  delay?: number;
  /** when true, emit a .reveal-group (children cascade) instead of single .scroll-reveal */
  group?: boolean;
  class?: string;
  [key: string]: unknown;
}
const { as: As = 'section', delay = 0, group = false, class: className = '', ...rest } = Astro.props;
const revealClass = group ? 'reveal-group' : 'scroll-reveal';
---
<As class:list={[revealClass, className]} data-reveal-delay={delay} {...rest}>
  <slot />
</As>
```

- [ ] **Step 4: Build to verify Astro compiles**

Run: `npm run build`
Expected: build completes, no errors.

- [ ] **Step 5: Run existing tests (must stay green)**

Run: `npx vitest run`
Expected: all existing tests pass (≥150).

- [ ] **Step 6: Commit**

```bash
git add src/layouts/MarketingLayout.astro src/components/util/ScrollReveal.astro
git commit -m "motion(observer): observe .reveal-group + extend never-invisible failsafe + ScrollReveal group prop"
```

---

### Task 4: verify-build motion-contract invariant

**Files:**
- Modify: `scripts/verify-build.mjs`

- [ ] **Step 1: Read the current invariant style**

Read `scripts/verify-build.mjs` to match its existing assertion pattern (it does literal-presence checks on built CSS/HTML and counts). Identify how it loads built CSS (the `dist/_astro/*.css` bundle) or source.

- [ ] **Step 2: Add an invariant asserting the motion contract exists**

Add a check (matching the file's existing style) that asserts, in the built CSS:
- `.reveal-group` rule is present AND `is-revealed` cascade rule is present.
- `--ease-rise` and `--ease-hero` tokens are present.
- The never-invisible default exists: a bare `.reveal-group > .reveal` (or `.scroll-reveal`) rule with `opacity: 1` (i.e. hidden state is `html.js`-gated, not a bare `opacity:0`).

If the file checks source files instead of dist, assert against `src/styles/kit.css` + `colors_and_type.css`. Use the existing failure-reporting mechanism (push to the errors array / throw) so a missing contract fails `npm run verify`.

- [ ] **Step 3: Run verify**

Run: `npm run verify`
Expected: all checks pass (including the new motion invariant).

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-build.mjs
git commit -m "verify(motion): assert reveal-group cascade + never-invisible contract present"
```

---

## Phase 1 — Apply the cascade per page

> Each page task: read the file, apply the conversions listed (exact classes/lines from the inventory), build, logical-inspect against this list. Motion is verified later (Task 16). Cap grid `--i` at 5.

### Task 5: Homepage cascade (worked example)

**Files:** Modify `src/pages/index.astro`

- [ ] **Step 1: Convert each container `scroll-reveal` → `reveal-group` and tag children `reveal` + `--i`**

Apply exactly:
1. **Positioning** (`117`): `<div class="positioning scroll-reveal">` → `class="positioning reveal-group"`. Each `.statchip` (`.map`, 119) → add `reveal` to its class and keep `style={\`--i:${i}\`}` → `class:list={['statchip','reveal']} style={\`--i:${i}\`}`.
2. **Audience split** (`141`): `<div class="aud-mix scroll-reveal" …>` → `class="aud-mix reveal-group"`. Card 1 (`142`, `--i:0`) → add `reveal reveal--left`. Card 2 (`178`, `--i:1`) → add `reveal reveal--right`.
3. **Compare** (`230`): the wrapper `.compare__grid` has no reveal today; add `reveal-group` to it. Col `--old` (`231`, `--i:0`) → `reveal reveal--left` (remove its `scroll-reveal`). Col `--ims` (`245`, `--i:1`) → `reveal reveal--right` (remove its `scroll-reveal`).
4. **CTA band inner** (`284`): `<div class="container cta-band__inner scroll-reveal">` → `reveal-group`; wrap its direct children to cascade — give the eyebrow `<span>` `class:list adding reveal` `--i:0`, the `<h2>` `reveal` `--i:1`, the `<p>` `reveal` `--i:2`, the `<a>` pill `reveal` `--i:3`.
5. **Process cards** (`312`): `<div class="process-cards scroll-reveal">` → `reveal-group`. Each `.proc-card` (313/325/348, `--i:0/1/2`) → add `reveal`.
6. **Specialty grid** (`385`): `<div class="spec-grid scroll-reveal">` → `reveal-group`. Each `.spec-card` (`.map`, 387) → `class:list={['spec-card',\`spec-card--${s.tint}\`,'reveal']} style={\`--i:${Math.min(i,5)}\`}` (replace the existing `--i:${i<4?i:0}` with the cap).
7. **Values** (`413`): `<div class="values scroll-reveal">` → `reveal-group`. Each `.value-card` (`.map`, 415) → add `reveal`, keep `--i:${i}`.
8. **ContactPanel wrapper** (`425`): `<div class="scroll-reveal"><ContactPanel /></div>` → leave as a single `scroll-reveal` (ContactPanel is one block; single reveal-rise is correct here).
9. **Section-anchor headers** (`131`, `220`, `302`, `376`, `404`): convert each `<div class="section-anchor">` → `class="section-anchor reveal-group"`; its inner heading `<div>` → add `reveal` `--i:0`; its `<p class="section-anchor__sub">` → add `reveal` `--i:1`.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compiles, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "motion(home): convert grids to reveal-group cascades + header reveals"
```

---

### Task 6: About cascade

**Files:** Modify `src/pages/about.astro`

- [ ] **Step 1: Apply conversions (from inventory)**

1. **Mission** (`25`): `.container` has `scroll-reveal` → leave as single `scroll-reveal` (one text block).
2. **Pillars** (`40`): `.au__pillars-grid scroll-reveal` → `reveal-group`; each `.au__pillar` (41/51/61, `--i:0/1/2`) → add `reveal`.
3. **Team** (two grids, `87` + `111`): each `.au__team-grid` `scroll-reveal` → `reveal-group`; each `.au__member` (`--i:0/1/2`) → add `reveal`.
4. **Stats** (`141`): `.au__stats-grid scroll-reveal` → `reveal-group`; each inner `<div style="--i:N">` (142/146/150/154) → add `class="reveal"`.
5. **Section-anchor headers** (`33`, `77`): convert to `section-anchor reveal-group` with heading `<div>` `reveal --i:0` + `.au__pillars`/team sub `reveal --i:1` where a `.section-anchor__sub` exists.
6. Hero (`17` `.hero-stage`) — leave unchanged.

- [ ] **Step 2: Build** — `npm run build` (expected: compiles).
- [ ] **Step 3: Commit** — `git add src/pages/about.astro && git commit -m "motion(about): reveal-group cascades for pillars/team/stats + header reveals"`

---

### Task 7: Facilities cascade

**Files:** Modify `src/pages/facilities.astro`

- [ ] **Step 1: Apply conversions**

1. **Hero roster** (`28`): `.fb__roster scroll-reveal` → `reveal-group`; each `.fb__roster-item` (30/38/46/54, `--i:0..3`) → add `reveal`. (The hero copy at `.hero-stage` line 18 stays.)
2. **Pillars** (`98`): `.fb__pillars-grid scroll-reveal` → `reveal-group`; each `.fb__pillar` (99/109/119, `--i:0/1/2`) → add `reveal`.
3. **Quotes** (`142`): `.fc__quotes-grid scroll-reveal` → `reveal-group`; each `.fc__quote` (143/153/163, `--i:0/1/2`) → add `reveal`.
4. **Form** (`179`): `.wns-card scroll-reveal` → leave single `scroll-reveal` (one card).
5. **Section-anchor headers** (`91`, `135`): → `section-anchor reveal-group` with `reveal --i:0/1`.
6. Marquee (67-87) — leave unchanged.

- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git commit -m "motion(facilities): reveal-group cascades for roster/pillars/quotes + headers"`

---

### Task 8: Clinicians cascade (PRESERVE the timeline)

**Files:** Modify `src/pages/clinicians.astro`

- [ ] **Step 1: Migrate Why + Quotes to reveal-group; cascade headers**

1. **Why** (`99`): wrapper `.cc__why-grid` — add `reveal-group`. Each `.cc__why-card` (100/105/110/115) currently has its OWN `scroll-reveal` + `--i` — **remove the per-child `scroll-reveal`, add `reveal`**, keep `--i:0..3`. (Converts per-child observation to group cascade.)
2. **Quotes** (`133`): wrapper `.cc__quotes-grid` — add `reveal-group`. Each `.cc__quote` (134/144/154) → remove `scroll-reveal`, add `reveal`, keep `--i:0/1/2`.
3. **Section-anchor headers** (`92`, `126`) → `section-anchor reveal-group` with `reveal --i:0/1`.
4. **CTA** (`170`): `.cc__cta-card scroll-reveal` → leave single `scroll-reveal`.

- [ ] **Step 2: DO NOT MODIFY the timeline (lines 26-88).** Leave `.cc__timeline-track scroll-reveal` (28), `.cc__timeline-line` (29), and each `.cc__step scroll-reveal --i:N` (31/45/59/73) exactly as-is. The line-draw (kit.css 578-583), the scoped `--stagger-step:140ms` (kit.css 586), and `nodePop` (kit.css 588-591) depend on this structure. Verify in Task 16 that the timeline still draws + pops with the new `--dur-reveal`/curve tokens.

- [ ] **Step 3: Build** — `npm run build`.
- [ ] **Step 4: Commit** — `git commit -m "motion(clinicians): migrate why/quotes to reveal-group, preserve timeline"`

---

### Task 9: Jobs cascade (filter-safe)

**Files:** Modify `src/pages/jobs/index.astro`

- [ ] **Step 1: Convert the cards grid; leave search/chips alone**

1. **Cards grid** (`197`): `.jb-b__grid scroll-reveal` → `reveal-group`. In the `{jobs.map((j,i)=>…)}` (198), each `.jb-b__card` → add `reveal` and `style={\`--i:${Math.min(i,5)}\`}`.
2. **Filter coexistence:** the filter JS toggles `.is-hidden` (`display:none`) on cards. Ensure the reveal hidden-state (`opacity:0;transform`) does not make a *filtered-in* card invisible after filtering. Because `.is-revealed` is added once on first scroll-in and `display:none` (`.is-hidden`) overrides visually, no conflict — but confirm `.jb-b__card.is-hidden` rule sets `display:none` (which wins over opacity). If a card can be un-hidden by filtering AFTER the group already revealed, it will already be `opacity:1` (group has `.is-revealed`), so it appears correctly. **Add no special JS.** Just verify in Task 16 that filtering still shows/hides cards and initial cascade plays.
3. **Search** (`154-184`) and **chips** (`186-193`): add NO reveal classes (interactive above-fold).
4. **Empty state** (`223`): leave as-is.
5. Hero (`148` `.hero-stage`) — unchanged.

- [ ] **Step 2: Build** — `npm run build`.
- [ ] **Step 3: Commit** — `git commit -m "motion(jobs): reveal-group cascade on cards grid (filter-safe), controls untouched"`

---

### Task 10: How-it-works + Specialties cascade

**Files:** Modify `src/pages/how-it-works.astro`, `src/pages/specialties.astro`

> These use the `<ScrollReveal>` wrapper on whole sections and are on the older navy/cream tokens. Convert the section that contains a card grid/list to a group; keep simple sections as single reveals.

- [ ] **Step 1: specialties.astro — cascade the 12-card grid**

The grid section (`101-119`) is `<ScrollReveal as="section" class="sp-grid">`. Change it to `<ScrollReveal as="section" class="sp-grid" group>` (emits `reveal-group`). On the `<ul class="grid">` `.map` (105), each `<li>` → wrap the `.card` or the `<li>` with `class:list={['reveal']} style={\`--i:${Math.min(i,5)}\`}` (apply to the `<li>` so the cascade unit is the list item). Hero (`89`) + closing (`121`) stay as plain `<ScrollReveal>` (single reveal).

- [ ] **Step 2: how-it-works.astro — cascade the steps**

The process section (`114-157`) is `<ScrollReveal as="section" class="hw-process">`. Keep the section as a single reveal for the header, but make the `<ol class="steps">` (144) the group: add `reveal-group` to the `<ol>` (it's inside the section; a nested reveal-group is fine — it gets its own IO trigger). Each `.step` (`.map`, 146) → `class:list={['step','reveal']} style={\`--i:${Math.min(i,5)}\`}`. **Tabs** (`118`, role=tablist) get NO reveal. The hidden tab panel's steps: because the panel is `hidden` until its tab is active, its `reveal-group` won't be observed as visible until shown — acceptable; verify in Task 16 that switching tabs still works and the newly-shown steps are visible (the head failsafe + `revealAll` cover any never-observed group). Hero (`102`) + closing (`159`) stay single reveals.

- [ ] **Step 3: Build** — `npm run build`.
- [ ] **Step 4: Commit** — `git commit -m "motion(how-it-works,specialties): reveal-group cascade for steps + specialty grid"`

---

### Task 11: Chrome hover polish

**Files:** Modify `src/styles/kit.css` (nav/footer hover rules), optionally `SiteFooter.astro`

- [ ] **Step 1: Ensure hover-lift/press use tokens + are pointer-gated**

Audit existing `.topnav` link/CTA and `.footer-b` link hover rules in `kit.css`. Where a hover transform/filter exists, ensure it: uses `var(--ease-out)` for the out-transition and `var(--dur-fast)`/`200ms` timing; is wrapped in `@media (hover: hover) and (pointer: fine)`; and pills/buttons get `:active { transform: scale(0.97); }` with `--ease-snap`. Add a consistent card/pill hover-lift helper if one is missing:
```css
@media (hover: hover) and (pointer: fine) {
  .pill { transition: transform 200ms var(--ease-rise), box-shadow 200ms var(--ease-rise), filter 200ms var(--ease-out); }
  .pill:hover { transform: translateY(-2px); }
  .pill:active { transform: scale(0.97); transition-duration: 110ms; }
}
```
(Only ADD what's missing; do not duplicate existing rules. Keep nav entrance-free.)

- [ ] **Step 2: Footer signoff single reveal (optional)**

In `SiteFooter.astro`, optionally wrap `.footer-b__signoff` (line 24) area: add `scroll-reveal` to the eyebrow+signoff block so it rises once on scroll-in. Skip if it complicates the footer; not load-bearing.

- [ ] **Step 3: Build + verify + test** — `npm run build && npm run verify && npx vitest run` (all green).
- [ ] **Step 4: Commit** — `git commit -m "motion(chrome): token-consistent pointer-gated hover-lift/press on pills + nav/footer"`

---

## Phase 2 — Floating nodes responsive

### Task 12: `.cta-pop` mobile subset + desynced drift

**Files:** Modify `src/styles/kit.css:1268-1295`

- [ ] **Step 1: Replace the blanket mobile hide with a 2-node subset**

Currently `kit.css:1292` + `1294` (duplicate): `@media (max-width: 1080px) { .cta-pop { display: none; } }`. Replace BOTH duplicate lines with a single responsive treatment:
```css
/* Mobile/tablet: keep a tasteful 2-node subset (tl + br), scaled + corner-tucked,
 * so the CTA band stays alive. Hide the two that would crowd the headline. */
@media (max-width: 1080px) {
  .cta-pop--tr, .cta-pop--bl { display: none; }
  .cta-pop { transform: scale(0.8); }
  .cta-pop--tl { top: 6%; left: 4%; }
  .cta-pop--br { bottom: 8%; right: 4%; }
}
@media (max-width: 560px) {
  .cta-pop { transform: scale(0.7); }
  .cta-pop--tl { top: 3%; left: 2%; }
  .cta-pop--br { bottom: 5%; right: 2%; }
}
@media (prefers-reduced-motion: reduce) { .cta-pop { animation: none !important; } }
```
(Remove the duplicate `display:none` and the duplicate reduced-motion line. The desktop positions/desynced `--cta-pop-delay/dur` at 1268-1291 stay — they already desync the drift. Note `.cta-pop` uses `transform` for its tilt via `.cta-pop__pill`/`__card`, so scaling the outer `.cta-pop` is safe; verify the tilt still reads in Task 16.)

- [ ] **Step 2: Confirm the band has bottom padding so tucked nodes don't overlap text on mobile**

Check `.cta-band` / `.cta-band__inner` padding at small widths; if the headline/sub could overlap the tucked nodes at 390px, add `@media (max-width:560px){ .cta-band{ padding-block: var(--space-7); } }` (adjust to existing scale). Verify visually in Task 16 (screenshot).

- [ ] **Step 3: Build** — `npm run build`.
- [ ] **Step 4: Commit** — `git commit -m "motion(cta-nodes): restore 2-node subset on mobile (was display:none ≤1080), keep desynced drift"`

---

## Phase 3 — /contact success rebuild

### Task 13: GetInTouch success-state polish

**Files:** Modify `src/components/sections/GetInTouch.astro`

- [ ] **Step 1: Remove the hard-clipped glow divs**

Delete the two glow elements (lines `56-57`):
```html
<div class="gt-glow gt-glow--magenta" aria-hidden="true"></div>
<div class="gt-glow gt-glow--rose" aria-hidden="true"></div>
```
Delete their CSS: `.gt-glow` base (`395`), `--magenta` (`396-399`), `--rose` (`400-403`), `@keyframes gtDrift` (`404`), and the `.gt-glow` line in the reduced-motion block (`424`). The `.gt-page` background radial-gradients (`190-193`) already provide the soft ambient color with no clip.

- [ ] **Step 2: Relax `.gt-page` overflow now that nothing clips**

`.gt-page` (`198`) currently `overflow: hidden;` (added to contain the absolute glows). Change to `overflow-x: hidden;` so the soft radial-gradient still can't cause horizontal scroll but vertical content/footer is never clipped. Keep `:global(body:has(.gt-page)){background:#0A0A0F}` (`173-175`) and the layered-gradient background unchanged.

- [ ] **Step 3: Add hover-alive micro-interactions (gated, transform-only)**

Within `@media (hover: hover) and (pointer: fine)`, add to the GetInTouch `<style>`:
```css
@media (hover: hover) and (pointer: fine) {
  .gt-submit { transition: transform 200ms var(--ease-rise), box-shadow 200ms var(--ease-rise); }
  .gt-submit:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(196,69,105,0.45); }
  .gt-submit:active { transform: scale(0.98); transition-duration: 110ms; }
  .gt-submit:hover .gt-submit__puck { transform: translateX(3px); }
  .gt-submit__puck { transition: transform 200ms var(--ease-rise); }
  .gt-seg__btn { transition: transform 120ms var(--ease-snap), background 160ms var(--ease-out), color 160ms var(--ease-out), border-color 160ms var(--ease-out); }
  .gt-seg__opt:active .gt-seg__btn { transform: scale(0.97); }
}
```
(Only add rules that don't already exist; if `.gt-submit`/`.gt-seg__btn` already have a `transition`, merge rather than duplicate.)

- [ ] **Step 4: Add a gentle breathing on the success checkmark (reduced-motion off)**

Add:
```css
.gt-thanks.is-active .gt-thanks__check {
  animation: gtPop 600ms var(--ease-snap), gtBreathe 4.5s ease-in-out 800ms infinite;
}
@keyframes gtBreathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.03); } }
@media (prefers-reduced-motion: reduce) {
  .gt-thanks.is-active .gt-thanks__check { animation: none; }
}
```
(Verify the existing `gtPop` on `.gt-thanks__check` — inventory says the mark uses `gtPop`; if the class is `.gt-thanks__check`, the entrance pop is preserved by listing `gtPop` first, then the infinite breathe starts after 800ms. Confirm the exact mark class when editing — inventory shows `.gt-thanks__check` at line 150.)

- [ ] **Step 5: Confirm never-invisible + confetti guard unchanged**

Leave the transform-only `gtRise`/`gtPop` success cascade (412-419), the `.gt-thanks.is-active` toggle (534), `fireConfetti()` + its reduced-motion early-return (547-548), and the confetti spec intact.

- [ ] **Step 6: Build + test** — `npm run build && npx vitest run` (green).
- [ ] **Step 7: Commit** — `git commit -m "motion(contact): drop clipped glows for soft gradient, relax overflow, add hover-alive + breathing check"`

---

## Phase 4 — Local verification gate

### Task 14: Full green gate

- [ ] **Step 1: Build** — `npm run build` (expected: success).
- [ ] **Step 2: Verify-build** — `npm run verify` (expected: all invariants incl. the new motion one pass).
- [ ] **Step 3: Tests** — `npx vitest run` (expected: ≥150 pass).
- [ ] **Step 4:** If any fail, fix before proceeding. Do NOT deploy on red.

---

## Phase 5 — Deploy + real-browser verification

> Tasks 15-17 are run by the orchestrator (need credentials, a browser, and the Codex binary), not delegated to a fresh code subagent.

### Task 15: Deploy to ims-staging (apex)

- [ ] **Step 1: Build with the Turnstile test key**

```bash
PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build
```

- [ ] **Step 2: Apply the staging gate**

```bash
STAGING_GATE_PASSWORD=ZY node scripts/apply-staging-gate.mjs
```

- [ ] **Step 3: Deploy to the production branch (apex updates only on --branch=main)**

```bash
CLOUDFLARE_API_TOKEN=$(cat ~/.cloudflare-token) CLOUDFLARE_ACCOUNT_ID=7e0fc3bb9718dbaf4d31145eb6da1c5a \
  npx wrangler pages deploy dist --project-name=ims-staging --branch=main --commit-dirty=true
```

- [ ] **Step 4:** Confirm live: `https://ims-staging.pages.dev` returns 401 without auth, 200 with `ZY`.

### Task 16: Playwright verification — mobile + desktop, every page

- [ ] **Step 1: Desktop pass (1440×900)** — for each of `/`, `/about`, `/clinicians`, `/facilities`, `/jobs`, `/how-it-works`, `/specialties`, `/contact` (auth `x:ZY`):
  - Scroll the page; for a known cascade group (e.g. home `.spec-grid`/`.values`, about `.au__pillars-grid`), read `getComputedStyle(child)` for ≥2 children and assert their `transition-delay` differs by `--i × 80ms` (the cascade is real, not all-at-once) AND that after scroll-in `opacity` → `1` and `transform` → `none`.
  - Assert never-invisible: with motion JS active, every `.reveal`/`.scroll-reveal` ends visible; spot-check that removing `html.js` (evaluate `document.documentElement.classList.remove('js')`) leaves content at `opacity:1`.
  - Clinicians: confirm the timeline line draws (`.cc__timeline-line` computed `transform` scaleY transitions to 1) and nodes pop.
  - Screenshot each page.
- [ ] **Step 2: Mobile pass (390×844)** — same pages:
  - Assert the CTA band shows **2 `.cta-pop` nodes** (`.cta-pop--tl` + `--br` `display` ≠ `none`; `--tr`/`--bl` = `none`).
  - Assert no horizontal scroll (`document.scrollingElement.scrollWidth <= window.innerWidth + 1`) on every page.
  - Assert cascades still fire; assert no element is clipped/missing vs desktop (visual screenshot review).
  - `/contact`: trigger success (`?sent=1` or submit) and confirm the success state shows with NO clipped glow edges; checkmark breathes.
  - Screenshot each page.
- [ ] **Step 3: Reduced-motion pass** — emulate `prefers-reduced-motion: reduce`; reload `/` and `/contact`; assert content is fully visible (opacity 1, no transform) and the confetti canvas does not run (no rAF loop) on submit.
- [ ] **Step 4:** Compile findings. If any assertion fails, fix the relevant page/CSS, rebuild, redeploy (Task 15), re-verify. Loop until all green. Save screenshots for Zach.

### Task 17: Codex review

- [ ] **Step 1:** Assemble the diff of all motion changes (CSS + observer + page markup + GetInTouch) into a prompt file OUTSIDE the repo (e.g. `C:\Users\oclou\codex-motion-review-prompt.md`), embedding the changed file contents (Codex's read-only sandbox can't spawn a shell on this box). Instruct: "review for never-invisible regressions, specificity inversions, reduced-motion gaps, CSP, and mobile correctness; do not run shell commands."
- [ ] **Step 2:** Run the native binary:
```bash
C:\Users\oclou\AppData\Local\Volta\tools\image\packages\@openai\codex\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe exec -s read-only --skip-git-repo-check -C . < C:\Users\oclou\codex-motion-review-prompt.md
```
- [ ] **Step 3:** Fold all Crit/High/Medium findings; loop Codex until clean (the mandated 1:1 review loop). Re-run Task 14 gate + redeploy + re-verify after folds.
- [ ] **Step 4:** Only after Codex is clean + Playwright green on both viewports, report completion `[runtime-verified]` with screenshots. NOT pushed/merged (staging only, for Zach's review).

---

## Self-review notes
- **Spec coverage:** tokens (T1) ✓, reveal-group cascade (T2-T3) ✓, all 7 pages + chrome (T5-T11) ✓, floating nodes mobile (T12) ✓, /contact success (T13) ✓, never-invisible/reduced-motion contracts (T2/T3/T13 + T16 checks) ✓, mobile audit (T16) ✓, Playwright mobile+desktop (T16) ✓, Codex (T17) ✓.
- **Preserved:** clinicians timeline (T8 explicitly hands-off), heroes (`.hero-stage` untouched), marquees, decorative blobs/glows.
- **Risks handled:** specificity inversion (T2 gated rules + T16 computed-style check), jobs filter coexistence (T9), tab-hidden steps (T10), mobile node crowding (T12 + T16 screenshot).
