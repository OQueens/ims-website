# Pipeline Polish Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved polish pass to the live Recruitment & Credentialing board — fill the desktop width, center the lane pills, show first+last initials, and color specialty pills by clinical discipline — plus switch the Owner field to inline autocomplete.

**Architecture:** Presentation + two pure helpers only. The real logic (initials, discipline→color) lands in the pure, already-tested `src/lib/hub/pipeline-data.ts`; the client (`pipeline-client.ts`) consumes those helpers and the CSS (`hub.css`) is restyled through them. No data-model, RPC, endpoint, polling, or concurrency change.

**Tech Stack:** Astro + vanilla-TS IIFE client, SortableJS, vitest (`vitest run`, happy-dom for the runtime suite), `astro check` typecheck, `astro build`.

## Global Constraints

- **NO deploy** without explicit Zach go + show-before-deploy. Feature branch `redesign/v5-reskin` only.
- **`git add <exact files>` — NEVER `-A`/`.`** (repo carries ~100 untracked WIP from other work).
- **Codex peer-review the whole diff** (pathspec-scoped) before claiming done.
- **No new colors** outside the approved 11-discipline palette + the single neutral `Other` grey `#8A93A0`.
- **No fabrication:** unknown/free-text specialty → `Other` (never a forced discipline).
- Discipline palette (verbatim): Surgery `#F26A5B` · Emergency & Critical Care `#F2A03D` · Cardiology `#E85D7A` · Medicine `#3FB3E0` · Neurology `#7C84E8` · Anesthesia `#2FB9AE` · Psychiatry & Behavioral `#A06CD8` · Radiology & Pathology `#5B8DD6` · Women's Health `#D4569E` · Pediatrics `#3DBE85` · Advanced Practice `#B5C24B` · Other `#8A93A0`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/hub/pipeline-data.ts` | Pure data/helpers | ADD `personInitials`, `Discipline` type, `DISCIPLINE_COLORS`, discipline map, `disciplineForSpecialty`, `disciplineColorFor` |
| `src/components/hub/pipeline-client.ts` | Board client IIFE | Use the two helpers; wrap lane label; owner field → inline autocomplete |
| `src/styles/hub.css` | Board styling | Lane flex-fill; centered pill + `.pipe-lane__lbl`; `.pipe-spec` → `--sc` |
| `src/lib/hub/pipeline-data.test.ts` | Unit tests | Tests for the two helpers |
| `src/components/hub/pipeline-client.runtime.test.ts` | DOM regression | Assert initials, discipline `--sc`, lane label wrap, no owner datalist |

---

## Task 1: First+last initials

**Files:**
- Modify: `src/lib/hub/pipeline-data.ts` (add `personInitials`)
- Modify: `src/components/hub/pipeline-client.ts:45` (remove local `initials` closure), `:60` and `:380` (call sites)
- Test: `src/lib/hub/pipeline-data.test.ts`, `src/components/hub/pipeline-client.runtime.test.ts`

**Interfaces:**
- Produces: `personInitials(fullName: string): string` — first+last initials, uppercased; one letter for a single-word name; `"?"` when empty; strips a leading `"Dr."`.

- [ ] **Step 1: Write the failing unit test**

In `pipeline-data.test.ts`, add to the imports `personInitials` and add:
```ts
describe('personInitials', () => {
  it('returns first+last initials, stripping a leading Dr.', () => {
    expect(personInitials('Dr. Marcus Bell')).toBe('MB');
    expect(personInitials('Priya Nair')).toBe('PN');
  });
  it('uses first+last for 3+ word names', () => {
    expect(personInitials('Mary Jane Watson')).toBe('MW');
  });
  it('returns one letter for a single-word name', () => {
    expect(personInitials('Cher')).toBe('C');
    expect(personInitials('Dr. House')).toBe('H');
  });
  it('returns ? for an empty/blank name', () => {
    expect(personInitials('')).toBe('?');
    expect(personInitials('   ')).toBe('?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts -t personInitials`
Expected: FAIL — `personInitials is not a function` / import error.

- [ ] **Step 3: Implement `personInitials`**

Add to `pipeline-data.ts` (near `checklistCount`):
```ts
/** First+last initials from a person's name (strips a leading "Dr."). One letter for a
 *  single-word name; "?" when empty. NOT HTML-escaped — caller escapes at render. */
export function personInitials(fullName: string): string {
  const parts = (fullName || '').replace(/^dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (parts[0][0] + last).toUpperCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts -t personInitials`
Expected: PASS.

- [ ] **Step 5: Wire the client to use it**

In `pipeline-client.ts`, add `personInitials` to the existing `pipeline-data` import block (top of file). Delete the local closure at line ~45:
```ts
const initials = (p: PipelinePerson) => (p.full_name.replace(/^dr\.?\s*/i, '').trim()[0] || '?').toUpperCase();
```
Replace both call sites — `${esc(initials(p))}` (in `cardHtml`, ~line 60, and in `openSpot`, ~line 380) — with:
```ts
${esc(personInitials(p.full_name))}
```

- [ ] **Step 6: Add a runtime DOM assertion**

In `pipeline-client.runtime.test.ts`, add inside the main describe:
```ts
it('card avatar shows first+last initials of the person name', async () => {
  await boot();
  expect(cardById('p-alpha')!.querySelector('.pipe-av')!.textContent).toBe('AR'); // "Dr. Alpha Reyes"
  expect(cardById('p-bravo')!.querySelector('.pipe-av')!.textContent).toBe('BO'); // "Dr. Bravo Okafor"
});
```

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts src/components/hub/pipeline-client.runtime.test.ts`
Expected: PASS (incl. the existing owner-chip `'ZY'` test at ~line 120, which reads `.pipe-owner`, not `.pipe-av`, so it is unaffected).
Run: `npm run typecheck` — Expected: no NEW errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/hub/pipeline-data.ts src/lib/hub/pipeline-data.test.ts src/components/hub/pipeline-client.ts src/components/hub/pipeline-client.runtime.test.ts
git commit -m "feat(hub): pipeline card avatars show first+last initials"
```

---

## Task 2: Discipline color for specialty pills

**Files:**
- Modify: `src/lib/hub/pipeline-data.ts` (discipline map + helpers)
- Modify: `src/components/hub/pipeline-client.ts` (~line 55/63, `cardHtml` spec pill)
- Modify: `src/styles/hub.css:595` (`.pipe-spec`)
- Test: `src/lib/hub/pipeline-data.test.ts`, `src/components/hub/pipeline-client.runtime.test.ts`

**Interfaces:**
- Consumes: `SPECIALTY_SUGGESTIONS` (existing).
- Produces: `Discipline` (union type), `DISCIPLINE_COLORS: Record<Discipline,string>`, `disciplineForSpecialty(name: string|null|undefined): Discipline`, `disciplineColorFor(name: string|null|undefined): string` (returns a `#rrggbb`).

- [ ] **Step 1: Write the failing unit test**

In `pipeline-data.test.ts`, import `SPECIALTY_SUGGESTIONS, DISCIPLINE_COLORS, disciplineForSpecialty, disciplineColorFor` and add:
```ts
describe('discipline colors', () => {
  it('maps a representative specialty in each discipline', () => {
    expect(disciplineForSpecialty('Emergency Medicine')).toBe('Emergency & Critical Care');
    expect(disciplineForSpecialty('General Surgery')).toBe('Surgery');
    expect(disciplineForSpecialty('Psychiatry')).toBe('Psychiatry & Behavioral');
    expect(disciplineForSpecialty('CRNA')).toBe('Anesthesia');
    expect(disciplineForSpecialty('OB/GYN')).toBe("Women's Health");
    expect(disciplineForSpecialty('Nurse Practitioner')).toBe('Advanced Practice');
    expect(disciplineForSpecialty('Radiology (Diagnostic)')).toBe('Radiology & Pathology');
  });
  it('is case-insensitive and trims', () => {
    expect(disciplineForSpecialty('  emergency medicine ')).toBe('Emergency & Critical Care');
  });
  it('falls back to Other for null / empty / unknown free-text', () => {
    expect(disciplineForSpecialty(null)).toBe('Other');
    expect(disciplineForSpecialty('')).toBe('Other');
    expect(disciplineForSpecialty('Underwater Basket Weaving')).toBe('Other');
    expect(disciplineColorFor('Underwater Basket Weaving')).toBe('#8A93A0');
  });
  it('returns the discipline hex color', () => {
    expect(disciplineColorFor('Emergency Medicine')).toBe('#F2A03D');
  });
  it('every curated specialty resolves to a real discipline (no Other drift)', () => {
    for (const s of SPECIALTY_SUGGESTIONS) {
      expect(disciplineForSpecialty(s), s).not.toBe('Other');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts -t "discipline colors"`
Expected: FAIL — imports undefined.

- [ ] **Step 3: Implement the map + helpers**

Add to `pipeline-data.ts` (after `SPECIALTY_SUGGESTIONS`):
```ts
// Specialty → clinical DISCIPLINE → fixed color. Color encodes the broad field so ~11
// legible hues cover all 60 specialties + free text; unknown → neutral 'Other' (honest,
// no forced grouping). The same discipline is one color everywhere on the board.
export type Discipline =
  | 'Surgery' | 'Emergency & Critical Care' | 'Cardiology' | 'Medicine' | 'Neurology'
  | 'Anesthesia' | 'Psychiatry & Behavioral' | 'Radiology & Pathology' | "Women's Health"
  | 'Pediatrics' | 'Advanced Practice' | 'Other';

export const DISCIPLINE_COLORS: Record<Discipline, string> = {
  'Surgery': '#F26A5B', 'Emergency & Critical Care': '#F2A03D', 'Cardiology': '#E85D7A',
  'Medicine': '#3FB3E0', 'Neurology': '#7C84E8', 'Anesthesia': '#2FB9AE',
  'Psychiatry & Behavioral': '#A06CD8', 'Radiology & Pathology': '#5B8DD6',
  "Women's Health": '#D4569E', 'Pediatrics': '#3DBE85', 'Advanced Practice': '#B5C24B',
  'Other': '#8A93A0',
};

const DISCIPLINE_SPECIALTIES: Record<Exclude<Discipline, 'Other'>, readonly string[]> = {
  'Surgery': ['Cardiothoracic Surgery','Colorectal Surgery','ENT / Otolaryngology','General Surgery','Hand Surgery','Neurosurgery','Ophthalmology','Orthopedic Surgery','Plastic Surgery','Podiatry','Trauma Surgery','Urology','Vascular Surgery'],
  'Emergency & Critical Care': ['Emergency Medicine','Critical Care / Intensivist'],
  'Cardiology': ['Cardiology','Electrophysiology','Interventional Cardiology'],
  'Medicine': ['Internal Medicine','Family Medicine','Hospitalist','Geriatric Medicine','Correctional Medicine','Occupational Medicine','Hospice / Palliative Care','Wound Care','Allergy/Immunology','Dermatology','Endocrinology','Gastroenterology','Infectious Disease','Nephrology','Pulmonology','Rheumatology','Physical Medicine & Rehabilitation','Hematology/Oncology','Medical Oncology'],
  'Neurology': ['Neurology'],
  'Anesthesia': ['Anesthesiology','Cardiac Anesthesiology','Anesthesiologist Assistant','CRNA','Pain Management'],
  'Psychiatry & Behavioral': ['Psychiatry','Addiction Psychiatry','Child & Adolescent Psychiatry','Forensic Psychiatry','Geriatric Psychiatry'],
  'Radiology & Pathology': ['Radiology (Diagnostic)','Interventional Radiology','Neuroradiology','Pathology'],
  "Women's Health": ['OB/GYN','Maternal-Fetal Medicine','Gynecologic Oncology'],
  'Pediatrics': ['Pediatrics','Pediatric Hospitalist','Neonatology'],
  'Advanced Practice': ['Nurse Practitioner','Physician Assistant'],
};

const DISCIPLINE_OF: Record<string, Discipline> = (() => {
  const map: Record<string, Discipline> = {};
  for (const disc of Object.keys(DISCIPLINE_SPECIALTIES) as Array<Exclude<Discipline, 'Other'>>)
    for (const name of DISCIPLINE_SPECIALTIES[disc]) map[name.toLowerCase()] = disc;
  return map;
})();

export function disciplineForSpecialty(name: string | null | undefined): Discipline {
  if (!name) return 'Other';
  return DISCIPLINE_OF[name.trim().toLowerCase()] ?? 'Other';
}

export function disciplineColorFor(name: string | null | undefined): string {
  return DISCIPLINE_COLORS[disciplineForSpecialty(name)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts -t "discipline colors"`
Expected: PASS (all 60 curated specialties resolve to a non-`Other` discipline).

- [ ] **Step 5: Wire `cardHtml` to color the spec pill**

In `pipeline-client.ts`, add `disciplineColorFor` to the `pipeline-data` import. In `cardHtml` change the spec pill line (~line 63) from:
```ts
${spec ? `<span class="pipe-spec">${esc(spec)}</span>` : ''}
```
to:
```ts
${spec ? `<span class="pipe-spec" style="--sc:${disciplineColorFor(spec)}">${esc(spec)}</span>` : ''}
```
(`disciplineColorFor` returns a fixed `#rrggbb` from a closed set — safe to interpolate; no user data enters the style.)

- [ ] **Step 6: Update `.pipe-spec` to read `--sc`**

In `hub.css` replace the `.pipe-spec` rule (line ~595) with:
```css
.pipe-spec { display: inline-block; margin-top: 4px; font-size: 10.5px; font-weight: 600; color: var(--sc, var(--pop-magenta, #C44569)); background: color-mix(in srgb, var(--sc, var(--pop-magenta,#C44569)) 14%, transparent); border: 1px solid color-mix(in srgb, var(--sc, var(--pop-magenta,#C44569)) 24%, transparent); border-radius: 999px; padding: 2px 8px; }
```

- [ ] **Step 7: Add a runtime DOM assertion**

In `pipeline-client.runtime.test.ts` add:
```ts
it('specialty pill carries its discipline color via --sc', async () => {
  await boot();
  const spec = cardById('p-alpha')!.querySelector('.pipe-spec') as HTMLElement; // Emergency Medicine
  expect(spec.style.getPropertyValue('--sc').trim()).toBe('#F2A03D');
  const psych = cardById('p-cleo')!.querySelector('.pipe-spec') as HTMLElement;  // Psychiatry
  expect(psych.style.getPropertyValue('--sc').trim()).toBe('#A06CD8');
});
```

- [ ] **Step 8: Run the full suite + typecheck**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts src/components/hub/pipeline-client.runtime.test.ts`
Expected: PASS.
Run: `npm run typecheck` — Expected: no NEW errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/hub/pipeline-data.ts src/lib/hub/pipeline-data.test.ts src/components/hub/pipeline-client.ts src/components/hub/pipeline-client.runtime.test.ts src/styles/hub.css
git commit -m "feat(hub): color pipeline specialty pills by clinical discipline"
```

---

## Task 3: Board fills the width + centered lane pills

**Files:**
- Modify: `src/styles/hub.css` (lines ~575-583, `.pipe-lane`, `.pipe-lane__head`, `.pipe-lane__pill`; add `.pipe-lane__lbl`)
- Modify: `src/components/hub/pipeline-client.ts:97` (wrap lane label)
- Test: `src/components/hub/pipeline-client.runtime.test.ts`

**Interfaces:** none exported; presentation + one render string change.

- [ ] **Step 1: Write the failing runtime test**

In `pipeline-client.runtime.test.ts` add:
```ts
it('lane header wraps its label in .pipe-lane__lbl (centering hook)', async () => {
  await boot();
  const pill = $('#pipe-board .pipe-lane[data-stage="warm_lead"] .pipe-lane__pill')!;
  const lbl = pill.querySelector('.pipe-lane__lbl');
  expect(lbl).toBeTruthy();
  expect(lbl!.textContent).toBe('Warm Leads');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/hub/pipeline-client.runtime.test.ts -t "pipe-lane__lbl"`
Expected: FAIL — `.pipe-lane__lbl` not found.

- [ ] **Step 3: Wrap the lane label in the client render**

In `pipeline-client.ts` `render()` (~line 97) change:
```ts
<span class="pipe-lane__pill">${esc(STAGE_LABELS[stage])}<span class="pipe-lane__n">${list.length}</span></span>
```
to:
```ts
<span class="pipe-lane__pill"><span class="pipe-lane__lbl">${esc(STAGE_LABELS[stage])}</span><span class="pipe-lane__n">${list.length}</span></span>
```

- [ ] **Step 4: Apply the CSS polish**

In `hub.css` replace the current lane rules:
```css
.pipe-lane { min-width: 236px; width: 236px; flex-shrink: 0; }
.pipe-lane__head { padding: 2px 4px 12px; }
.pipe-lane__pill { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 5px 11px 5px 9px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700; }
```
with:
```css
.pipe-lane { flex: 1 1 240px; min-width: 240px; }
.pipe-lane__head { display: flex; justify-content: center; padding: 2px 4px 12px; }
.pipe-lane__pill { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px; border-radius: 999px; font-family: var(--font-mono); font-size: 10px; line-height: 1; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700; }
/* Uppercase mono glyphs sit optically high in their line box; nudge the label down 1px
   so it reads vertically centered against the count badge (Zach-verified on the mockup). */
.pipe-lane__lbl { display: inline-block; position: relative; top: 1px; }
```
(Leave `.pipe-lane__n` and the per-stage `.pipe-lane--* .pipe-lane__pill` color rules unchanged.)

- [ ] **Step 5: Run the test + typecheck + build**

Run: `npx vitest run src/components/hub/pipeline-client.runtime.test.ts`
Expected: PASS.
Run: `npm run typecheck` — Expected: no NEW errors.
Run: `npm run build` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/styles/hub.css src/components/hub/pipeline-client.ts src/components/hub/pipeline-client.runtime.test.ts
git commit -m "feat(hub): pipeline board fills desktop width + centered lane pills"
```

---

## Task 4: Owner field → inline autocomplete

**Files:**
- Modify: `src/components/hub/pipeline-client.ts` (~lines 287-317, `openAddForm`)
- Test: `src/components/hub/pipeline-client.runtime.test.ts`

**Interfaces:** reuses existing `wireInlineAutocomplete(input, suggestions)`.

- [ ] **Step 1: Write the failing runtime test**

In `pipeline-client.runtime.test.ts` add:
```ts
it('add-provider Owner field uses inline autocomplete, not a datalist dropdown', async () => {
  await boot();
  $('#pipe-add')!.click();
  await flush();
  const owner = document.querySelector('.pipe-form input[name="owner_email"]') as HTMLInputElement;
  expect(owner).toBeTruthy();
  expect(owner.getAttribute('list')).toBeNull();               // no datalist binding
  expect(document.querySelector('#pipe-owner-list')).toBeNull(); // datalist removed
  expect(owner.hasAttribute('data-owner-autocomplete')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/hub/pipeline-client.runtime.test.ts -t "inline autocomplete, not a datalist"`
Expected: FAIL — the owner input still has `list="pipe-owner-list"` and the datalist exists.

- [ ] **Step 3: Swap the datalist for inline autocomplete**

In `openAddForm`, drop the `ownerSuggestions` construction (keep the `ownerEmails` Set). Change the Owner input + delete the datalist line:
```ts
<label class="pipe-f"><span>Owner</span><input name="owner_email" type="email" data-owner-autocomplete maxlength="120" value="${esc(me)}" placeholder="owner@…" autocomplete="off" /></label>
```
(remove the `<datalist id="pipe-owner-list">…</datalist>` line entirely).

Then, next to the existing specialty wiring (~line 317, after `wireInlineAutocomplete(form.querySelector('input[data-autocomplete]'), SPECIALTY_SUGGESTIONS);`), add:
```ts
wireInlineAutocomplete(form.querySelector('input[data-owner-autocomplete]'), [...ownerEmails]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/hub/pipeline-client.runtime.test.ts -t "inline autocomplete, not a datalist"`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npm test`
Expected: PASS (full `vitest run`, no regressions).
Run: `npm run typecheck` — Expected: no NEW errors.
Run: `npm run build` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/hub/pipeline-client.ts src/components/hub/pipeline-client.runtime.test.ts
git commit -m "feat(hub): pipeline Owner field uses inline autocomplete (drop datalist)"
```

---

## Task 5: Codex review + verification gate (no new code unless review finds issues)

- [ ] **Step 1: Scope the diff** — `git diff <BASE> HEAD -- src/lib/hub/pipeline-data.ts src/lib/hub/pipeline-data.test.ts src/components/hub/pipeline-client.ts src/components/hub/pipeline-client.runtime.test.ts src/styles/hub.css` where `BASE` = the commit before Task 1.
- [ ] **Step 2: Hand that diff to Codex** (companion background runtime, per `reference_codex_runtime_invocation`). Focus: the discipline map (completeness/typos), the `--sc` interpolation (no injection), the initials edge cases, the owner-autocomplete swap, and any CSS regression on `.pipe-lane`/`.pipe-spec`.
- [ ] **Step 3: Fix anything Codex flags; re-review until clean.**
- [ ] **Step 4: Final verification** — `npm test` (full), `npm run typecheck` (0 new), `npm run build` (0). Record counts.
- [ ] **Step 5: Show Zach** the changed files / summary and get explicit deploy authorization. Do NOT deploy without it.

---

## Self-Review (completed by author)

- **Spec coverage:** board fill (T3) · centered/vertical pills (T3) · initials (T1) · discipline colors incl. full 60→11 map + Other fallback (T2) · owner inline autocomplete (T4) · dropped items are no-ops (not tasked). All spec §1/§2 items covered.
- **Placeholder scan:** no TBD/TODO; every code step shows the actual code; every test step shows the assertions and the exact `vitest`/`astro` command + expected result.
- **Type consistency:** `personInitials(fullName: string)`, `disciplineForSpecialty(name)`, `disciplineColorFor(name)`, `DISCIPLINE_COLORS`, and the `.pipe-lane__lbl` / `data-owner-autocomplete` hooks are named identically in their defining task and every consumer/test. The `.pipe-av` (person avatar, T1) vs `.pipe-owner` (owner chip, unchanged) distinction is called out so T1 doesn't collide with the existing `'ZY'` owner test.
