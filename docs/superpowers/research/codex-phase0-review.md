# Codex review — Phase 0 motion infrastructure (never-invisible contract)

VERDICT: AIRTIGHT (after re-architecture)

## Context
Phase 0 brings a site-wide scroll-motion language to the IMS marketing site with a
HARD constraint: content must NEVER render stuck-invisible (no-JS, JS error,
reduced-motion, print, crawler, no-IntersectionObserver, slow network → all opacity:1).

## Round 1 findings (against the first implementation)
- **CRITICAL 1a/1b — never-invisible hole.** The `.js` class was set by a head-inline
  script, but the reveal CSS + IntersectionObserver lived INSIDE `ScrollReveal.astro`,
  where Astro SCOPES them (`.scroll-reveal:where(.astro-cid-xxx)`) AND bundles the
  observer as a separate module chunk. Two real problems:
  (i) directly adding `class="scroll-reveal"` to page markup (which Phase 1 requires)
      would be hidden by the global-ish `html.js` ancestor but the scoped hide rule only
      matched the component's own element — and the observer only observed at module load;
  (ii) if the module chunk failed to fetch (CSP/network) while the inline `.js` succeeded,
      content was hidden with nothing to reveal it → stuck invisible.
- **IMPORTANT 3 — will-change leak.** `will-change` cleared only on `transitionend`;
  if no transition fires (already-final state) it leaks a permanent compositor layer.
- MINOR 4 — transition-delay on initial hide: no real bug in this architecture.

## Re-architecture applied (the fix)
1. **Reveal CSS moved to GLOBAL `src/styles/kit.css`** (not component-scoped). Compiled
   output verified as `html.js .scroll-reveal{opacity:0;...}` with NO `:where(.astro-cid)`
   hash, so ANY element on ANY page (markup-direct or via wrapper) is governed by it.
2. **Observer moved to a single `is:inline` script in `MarketingLayout`** (before
   `</body>`). Being inline, it CANNOT fail to fetch independently of the head `.js` flag.
   It sets `window.__scrollRevealReady = true`, then: no-IO / reduced-motion → `revealAll()`;
   else IntersectionObserver (rootMargin `0px 0px -12% 0px`, threshold 0) adds `is-revealed`
   with will-change discipline (cleared on `transitionend` AND a `setTimeout(1200+delay)`
   backstop), honors `data-reveal-delay`, unobserves. Then double-rAF adds `.hero-go`.
3. **Head-inline failsafe:** sets `.js`, then on window `load` + 1500ms, if
   `__scrollRevealReady` is still falsy, force-reveals all `.scroll-reveal` + `.hero-stage`
   (covers the inline observer throwing before it set the flag).
4. **`ScrollReveal.astro` is now a thin class-applying wrapper** — no `<style>`, no
   `<script>` — kept for back-compat with how-it-works/specialties.

## Never-invisible walk (post-fix)
| Failure mode | End state |
|---|---|
| no-JS / crawler | bare `.scroll-reveal{opacity:1}` → visible |
| print | `@media print` `opacity:1 !important` → visible |
| reduced-motion | CSS `!important` visible + JS `revealAll()` |
| no IntersectionObserver | JS `revealAll()` |
| inline observer throws before flag | head `load`+1500ms failsafe reveals all |
| slow network | observer is INLINE (parsed with HTML) — no separate chunk to stall |
| normal | observer reveals on scroll; flag set synchronously so failsafe no-ops |

No remaining path to stuck-invisible content. will-change leak closed via setTimeout backstop.

## Verification
`npm run build` Complete · `verify-build OK` · `vitest 83/83`. Compiled CSS confirmed
global (no astro-cid scoping). Inline observer + `__scrollRevealReady` present in
prerendered output (about/clinicians/how-it-works/specialties).
