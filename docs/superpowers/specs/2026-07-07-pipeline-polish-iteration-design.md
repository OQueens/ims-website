# Pipeline Polish Iteration — Design Spec

**Date:** 2026-07-07
**Status:** Approved (Zach signed off via rendered mockup) — ready for implementation planning
**Branch:** `redesign/v5-reskin` (feature branch — no auto-deploy)
**Surface:** IMS Hub `/hub` → Recruitment & Credentialing pipeline (`ias-website`)
**Parent spec:** `docs/superpowers/specs/2026-07-05-recruitment-credentialing-pipeline-design.md`
**Prod at time of writing:** `origin/main ba263a1`; branch tip `29b7ad6`.

A focused visual/UX polish pass on the already-live pipeline board, driven by Zach's
post-launch feedback. Approved against an interactive before/after mockup rendered in the
real hub dark tokens (Current ⇄ Polished toggle). No data-model, endpoint, RPC, or
concurrency changes — this touches presentation + two small client helpers only.

---

## 1. Scope

### In scope (4 changes)
1. **Board fills the desktop width.** Lanes currently sit at a fixed `236px` and cluster
   to the left, leaving dead space on wide desktops. Lanes should flex-grow to fill the
   available width, and fall back to horizontal scroll only when the viewport is genuinely
   narrow.
2. **Lane-header pills centered + vertically corrected.** The stage pills (Warm Leads /
   Active Bids / …) must be horizontally centered over each lane, and the uppercase label
   must read vertically centered against the count badge (today it optically rides high in
   its line box).
3. **Card avatars show first+last initials.** Today the avatar shows a single letter
   (first initial only). It should show first+last initials (e.g. "Dr. Marcus Bell" → `MB`;
   single-word name → one letter; not-a-doctor names handled the same way).
4. **Specialty pills colored by discipline.** Today every specialty pill is magenta. Each
   specialty maps to one of **11 clinical disciplines**, and the pill takes that discipline's
   fixed color, so a discipline reads the same color everywhere on the board. Unrecognized /
   free-text specialties fall to a neutral **"Other"** grey (no fabricated grouping).

### Out of scope (explicitly decided this round)
- **LocumSmart import** — DROPPED. Recon confirmed our LS feed contains only facility job
  demand (`ims_jobs`) + aggregate KPIs (`ims_ls_analytics`); zero named-provider data exists
  anywhere server-side. An import that created candidate cards would fabricate people (the
  locked non-goal). Zach chose to keep the board **manual-entry only**. No code change.
- **Credentialing chip colors** — no change (Zach: "the chip colors are fine"). The card
  meter keeps its 6 signature colors; the dossier chips stay cyan.
- **Delete opt-out toggle** — no change (Zach: "leave it as is"). The permanent per-browser
  "Don't ask me this again" skip stands.

---

## 2. Design decisions (locked)

### 2.1 Lane fill + header
- `.pipe-board` stays `display:flex; gap; overflow-x:auto`.
- `.pipe-lane` changes from fixed `min-width:236px; width:236px` to **`flex:1 1 240px;
  min-width:240px`** — grow to fill on wide screens, scroll below ~5×240px + gaps.
- `.pipe-lane__head` becomes **`display:flex; justify-content:center`** (was left-aligned).
- `.pipe-lane__pill` gets a fixed height with symmetric vertical rhythm; the label text is
  wrapped in a new inner span **`.pipe-lane__lbl`** nudged down 1px
  (`position:relative; top:1px`) to counter the uppercase-glyph optical-high effect. Verified
  by Zach on the mockup ("centered now").

### 2.2 Initials
Replace the single-letter `initials()` in `pipeline-client.ts` with first+last:
```
name → strip leading "Dr." → split on whitespace →
  first-word initial + (last-word initial if >1 word), uppercased; "?" if empty.
```

### 2.3 Discipline color mapping
- New shared, testable data in **`src/lib/hub/pipeline-data.ts`**:
  - `DISCIPLINE_COLORS: Record<Discipline, string>` (12 entries incl. `Other`).
  - a specialty-name → discipline map covering all 60 `SPECIALTY_SUGGESTIONS` entries.
  - `disciplineColorFor(specialtyName: string | null): string` — case-insensitive lookup on
    the display name; returns the discipline color, or the `Other` grey for null / unknown /
    free-text. Never throws.
- `pipeline-client.ts` `cardHtml()` sets the pill color inline:
  `<span class="pipe-spec" style="--sc:${disciplineColorFor(spec)}">…</span>`.
- `.pipe-spec` CSS switches from hardcoded magenta to the `--sc` custom property with a
  magenta fallback: `color:var(--sc); background:color-mix(in srgb,var(--sc) 15%,transparent);
  border-color:color-mix(in srgb,var(--sc) 26%,transparent)`.

**The 11 disciplines → colors** (all on the dark hub surface; drawn from / harmonized with
the brand palette; `Other` = neutral grey):

| Discipline | Color | Specialties (from the curated 60) |
|---|---|---|
| Surgery | `#F26A5B` | Cardiothoracic, Colorectal, ENT/Otolaryngology, General, Hand, Neurosurgery, Ophthalmology, Orthopedic, Plastic, Podiatry, Trauma, Urology, Vascular |
| Emergency & Critical Care | `#F2A03D` | Emergency Medicine, Critical Care / Intensivist |
| Cardiology | `#E85D7A` | Cardiology, Electrophysiology, Interventional Cardiology |
| Medicine | `#3FB3E0` | Internal Medicine, Family Medicine, Hospitalist, Geriatric Medicine, Correctional Medicine, Occupational Medicine, Hospice / Palliative Care, Wound Care, Allergy/Immunology, Dermatology, Endocrinology, Gastroenterology, Infectious Disease, Nephrology, Pulmonology, Rheumatology, Physical Medicine & Rehabilitation, Hematology/Oncology, Medical Oncology |
| Neurology | `#7C84E8` | Neurology |
| Anesthesia | `#2FB9AE` | Anesthesiology, Cardiac Anesthesiology, Anesthesiologist Assistant, CRNA, Pain Management |
| Psychiatry & Behavioral | `#A06CD8` | Psychiatry, Addiction Psychiatry, Child & Adolescent Psychiatry, Forensic Psychiatry, Geriatric Psychiatry |
| Radiology & Pathology | `#5B8DD6` | Radiology (Diagnostic), Interventional Radiology, Neuroradiology, Pathology |
| Women's Health | `#D4569E` | OB/GYN, Maternal-Fetal Medicine, Gynecologic Oncology |
| Pediatrics | `#3DBE85` | Pediatrics, Pediatric Hospitalist, Neonatology |
| Advanced Practice | `#B5C24B` | Nurse Practitioner, Physician Assistant |
| Other | `#8A93A0` | anything free-text / unrecognized |

All 60 curated specialties are covered (13+2+3+19+1+5+5+4+3+3+2 = 60).

### 2.4 Owner field → inline autocomplete
Mirror the specialty field's inline ghost-text completion for the Owner input in the
add-provider form:
- Remove the `<datalist id="pipe-owner-list">` + `list="pipe-owner-list"` dropdown.
- Reuse the existing `wireInlineAutocomplete()` helper, feeding it the distinct owner
  **emails** already on the board plus the signed-in user (`me`). Completion is on email
  prefix; the field stays free-text (`type="email"`), still defaults to `me`, and server-side
  `cleanEmail` still normalizes whatever is submitted.

---

## 3. Files touched

| File | Change |
|---|---|
| `src/lib/hub/pipeline-data.ts` | Add `DISCIPLINE_COLORS`, the specialty→discipline map, and `disciplineColorFor()`. Pure, no I/O. |
| `src/components/hub/pipeline-client.ts` | New `initials()` (first+last); lane label wrapped in `.pipe-lane__lbl`; spec pill gets `--sc` via `disciplineColorFor`; Owner input switched from datalist to `wireInlineAutocomplete` on owner emails. |
| `src/styles/hub.css` | `.pipe-lane` flex-fill; `.pipe-lane__head` center; `.pipe-lane__pill` height + `.pipe-lane__lbl` 1px nudge; `.pipe-spec` → `--sc` custom property. |

No changes to: the migration/RPC, `pipeline-ops.ts`, `api/pipeline.ts`, endpoint auth,
polling/concurrency, the dossier logic, delete flow, or the credentialing meter.

---

## 4. Testing

- **Unit (vitest), `pipeline-data.test.ts`:** `disciplineColorFor` returns the right color for
  a representative specialty in each of the 11 disciplines; returns `Other` grey for `null`,
  `''`, and an unknown free-text string; is case-insensitive; every entry in
  `SPECIALTY_SUGGESTIONS` resolves to a non-`Other` discipline (guards the map against drift).
- **Unit (vitest), initials:** if the current `initials()` is unit-reachable, cover
  "Dr. Marcus Bell" → `MB`, single-word → 1 letter, empty → `?`, leading "Dr." stripped. If it
  is a closure inside the IIFE, extract a tiny pure helper so it is testable.
- **Existing suite stays green** (full vitest; astro check 0-new; build 0).
- **Visual (Zach, browser):** the pixel result on real `/hub` — pills centered, lanes fill the
  width, discipline colors, initials, owner autocomplete. This env has no browser; the mockup
  stands in for pre-implementation visual approval.

---

## 5. Guardrails

- **No deploy** without explicit Zach go + show-before-deploy (the standing rule).
- **Codex peer review** on the non-trivial diff (the discipline map + client changes) before
  claiming done.
- `git add <exact files>` — NEVER `-A` (repo carries ~100 untracked WIP from other work).
- No new colors outside the approved discipline palette; `Other` grey is the only neutral.
- No fabrication: `Other` is used honestly for unknown specialties (no forced discipline).

---

## 6. Rollout

Same recipe as prior iterations: implement + test + Codex on `redesign/v5-reskin`, then (on
explicit go) **pathspec-checkout the exact changed files** onto clean `main` in the main
worktree, build-verify, push. Rollback = `git revert <sha> && git push`.
