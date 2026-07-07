# Pipeline Motion + Celebration + Easter Egg — Design (2026-07-07)

Three aesthetic upgrades to the live Hub "Recruitment & Credentialing" board (prod `631879b`), all
**feel-validated by Zach in a visual-companion Motion Lab** before this spec. Nothing changes the board's
data model, RPC, polling, or the hardened drag-commit/race logic — these are cosmetic layers riding on top.

Companion lab (throwaway): `.superpowers/brainstorm/18294-1783457326/content/physics-lab.html`.

## Goals
1. **Drag physics** — kill the flat gray drag ghost; the card you drag has weight: hangs from the grab
   point, swings back as you move, overshoots forward and settles when you stop.
2. **Placed celebration** — when a provider transitions into Placed / Working, a short emoji firework
   pops around/over the card, then twinkles out.
3. **Matthew Draughon / Celsius Easter egg** — typing his name into the add-provider form auto-fills a
   Celsius-themed joke card (reviewable; user still clicks Add).

## Non-goals / guardrails
- No change to `hub_pipeline_apply` RPC, `hub_pipeline_people` schema, endpoint, or the ~4s poll.
- No change to the optimistic-commit / per-row send-lock / adopt-by-version race handling.
- All motion respects `prefers-reduced-motion: reduce` (existing block at `hub.css:629`).
- No new runtime dependencies (SortableJS is already vendored; celebration + easter egg are hand-rolled).
- Feature branch `redesign/v5-reskin`; deploy only via the exact-file cherry-pick onto `main`. Codex-gate.

---

## Feature 1 — Drag physics

### Current state (verified)
`mountSortables()` in `pipeline-client.ts` uses SortableJS in **native HTML5 drag mode** (no
`forceFallback`). `ghostClass:'is-dragging'` → `.pipe-card.is-dragging{opacity:.5}` dims the source in
place; the element under the cursor is the browser's frozen bitmap — unstyleable, no physics possible.

### Approach
Flip SortableJS to **`forceFallback: true`** so the follower becomes a real DOM clone we own
(`fallbackClass`, default `.sortable-fallback`). Then a velocity→tilt **spring** drives the clone's
independent CSS **`rotate:`** property — which composes with the `transform: translate3d()` SortableJS
sets on the clone each move (so we never fight its positioning). A single `requestAnimationFrame` loop,
live only between `onStart`→`onEnd`, integrates the spring; a document `pointermove` listener feeds
pointer velocity. `transform-origin` is set to the grab point so the card hangs from where you hold it.

- Keep ALL existing `onStart`/`onMove`/`onEnd` logic (dropzone highlight, rAF-deferred commit, the
  `dragging` guard that blocks `render()` mid-gesture). forceFallback does not change when `onEnd` fires.
- Source placeholder: keep a dimmed/dashed gap where the card lifted from (drop-position indicator).
- Fallback clone styled as a lifted card (bigger shadow, `scale`, `cursor:grabbing`).

### Locked parameters (Balanced preset, from the lab)
| Param | Value | Meaning |
|---|---|---|
| swing | `15°` | max tilt cap |
| sens | `0.85` | tilt per unit pointer velocity |
| stiff | `0.11` | spring constant toward target |
| damp | `0.80` | velocity damping (overshoot + settle) |
| lift | `1.05` | pick-up scale |

Velocity signal (kills low-speed jitter without dulling real drags):
```
smoothX += (px - smoothX) * 0.6           // light low-pass anchor
inst     = smoothX - prevSmoothX
vx       = vx*0.55 + inst*0.45            // gentle EMA
v        = sign(vx) * max(0, |vx| - 0.15) // soft dead-zone
target   = clamp(-v * sens, -swing, swing)
angleVel += (target - angle) * stiff; angleVel *= damp; angle += angleVel
```
Position tracks the pointer 1:1 (card stays "attached"); only the *tilt* is low-passed. Settle when
`|angle|<0.05 && |angleVel|<0.05`. **reduced-motion → tilt forced 0, lift 1** (card follows, no swing).

### Risk
`forceFallback` swaps the desktop drag *mechanism* (native → JS clone) — the one piece touching existing
behavior. It's the same engine SortableJS already uses for touch/mobile. Independent `rotate` needs
Chrome 104+/Safari 14.1+/FF 72+ (fine for an internal tool). This is the item most needing Zach's live
eyeball + Codex scrutiny.

---

## Feature 2 — Placed celebration (emoji firework)

### Trigger
Only on a **local user action** that moves a person INTO `placed` and they weren't already placed:
- drag-to-Placed (`commit({type:'moveStage', stage:'placed'})` in the `onEnd` rAF), and
- toggling **Provider Working** true in the dossier (couples stage→placed via the invariant).

NOT on page load, NOT on a poll/adopt echo (a teammate's placement never fires it). Implemented by
checking the prior stage in `commit()` before applying the op.

### Visual (locked from the lab)
- 20 emojis: `👏 🎉 🥂 🍾 🙌 🎊 ✨ ⭐ 💫`, `font-size:26px`, spawned in a fixed `pointer-events:none` layer.
- Firework, **filled + staggered**: `ang=(i/N)·2π + jitter±0.5rad`; `rad=ringR·(0.18 + rnd·0.92)` where
  `ringR=max(cardW,cardH)/2` (varied radius fills the center, no hollow ring); `dx=cos·rad`,
  `dy=sin·rad·0.9`; per-emoji `animation-delay=(i/N)·0.28 + rnd·0.05` (spaced emission, not one blast).
- Keyframe `pgfw` (1.45s, `cubic-bezier(.12,.8,.25,1)`): pop from center → overshoot ×1.08 at 50% →
  settle to (dx,dy) + fade in place at 100%. Card itself does a 620ms scale pop (1→1.06→0.99→1).
- Layer self-removes after ~1.9s. **reduced-motion → card pop only, no emoji.**

Lives in `hub.css` (keyframes/particle) + a `celebrate(cardEl)` helper in `pipeline-client.ts`. The layer
is positioned over the card's `getBoundingClientRect()` and appended to `document.body`, so a re-render
(poll/adopt) can't wipe it mid-animation.

---

## Feature 3 — Matthew Draughon / Celsius Easter egg

Founder in-joke: Matthew Draughon is a devout Celsius drinker. In `openAddForm()`, when the name field
value normalizes to `matthew draughon` (or `matt draughon`), auto-fill the other fields with the joke
payload (user still reviews + clicks Add — never a silent create):

| Field | Value |
|---|---|
| specialty | `Doctor of Celsius · MD` (leans on his initials MD = "doctor") |
| state | `A crisp 3°C` (Celsius = temperature pun) |
| notes | `Runs entirely on Celsius. Never seen without a can. Keep the fridge stocked or productivity drops to 0. ⚡🥤` |

On the rendered card, an egg card gets a Celsius-orange avatar + glow + a 🥤 corner badge, and (if he's
created into/dragged to Placed) the normal firework. Detection + payload is a small pure helper in
`pipeline-data.ts` (`celsiusEasterEgg(name) → fields | null`) so it's unit-testable and decoupled.
Honest-data note: this writes a real, deletable row the user chose to add — not fabricated pipeline data.

---

## Architecture / files
- `src/components/hub/pipeline-client.ts` — forceFallback + spring rAF + document pointermove; `celebrate()`
  + placed-transition trigger in `commit()`; easter-egg autofill wired into `openAddForm()`.
- `src/lib/hub/pipeline-data.ts` — pure `celsiusEasterEgg(name)` helper (+ its unit tests).
- `src/styles/hub.css` — `.sortable-fallback` lifted styling, drag placeholder, `rotate` compose note,
  `@keyframes pgfw` + particle + egg card styles; extend the `prefers-reduced-motion` block.
- Tests: `pipeline-data.test.ts` (easter-egg helper), `pipeline-client.runtime.test.ts` (placed-transition
  trigger fires once on local action / not on poll; reduced-motion path; easter-egg autofill). The rAF
  spring math is extracted to a pure `tiltStep(state, params)` so it's unit-tested without a real DOM.

## Testing strategy
TDD. Pure helpers (`celsiusEasterEgg`, `tiltStep`, celebration-trigger predicate) get unit tests. The
happy-dom runtime suite asserts: celebration fires exactly once on a local moveStage→placed, does NOT
fire on an adopt()/poll placement, respects reduced-motion, and the easter-egg autofill maps correctly.
Physics *feel* is validated by Zach in the lab + on the live board (no browser in the build env).

## Deploy + rollback
Branch `redesign/v5-reskin` → cherry-pick the exact commits (or pathspec-checkout the exact touched files)
onto clean `main` in the MAIN worktree `C:/Users/oclou/QueenClaude/ias-website`; build-verify on main
(astro check 0-new, build 0, full vitest green); push `main` (CF Pages auto-deploy ~45s); smoke
`/`→200, `/hub`→302, `/hub/api/pipeline`→401. **Rollback** = `git revert <range> && git push origin main`.
Residual = Zach's authed-browser eyeball of the live board (grab a card; drop into Placed).

Related: [[project_ims_recruitment_credentialing_pipeline_2026-07-05]].
