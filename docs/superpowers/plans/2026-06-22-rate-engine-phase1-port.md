# Rate-Engine Phase-1 Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The extraction is parity-critical and sequential — execute INLINE with checkpoints, not via parallel subagents. Use a Workflow only for the two fan-out steps explicitly marked **[WORKFLOW]** (golden-master matrix generation + adversarial drift verification).

**Goal:** Import the battle-tested IAS rate engine into the IMS hub as a shared, dependency-injected package — proving byte-identical parity against a frozen golden master — then replace the hub's 84-line static stub, with zero math rewritten.

**Architecture:** The 18-file `engine/` becomes injectable (a `runtime.ts` DI seam replaces the only 2 external imports) and barrel-exported in `ias-dashboard` (canonical source). It is vendored into the hub at `src/lib/rate-engine/` (git subtree; tracked-copy + sync-script fallback). A golden-master corpus generated from the canonical engine is committed to **both** repos; a hub parity test recomputes it through the vendored engine and asserts deep equality. Only after parity is green does the hub's quote computation move onto the real engine and the stub get deleted.

**Tech Stack:** TypeScript (strict, `verbatimModuleSyntax`), Vitest (both repos), Astro 5 + Cloudflare adapter (hub, `output: 'static'`), React 19 + Vite (canonical SPA only). Engine is pure framework-free TS (verified Cloudflare-Workers-clean: no Node built-ins, no React, no pdfjs, no `import.meta.env`).

## Global Constraints

- **IMPORT, never rewrite.** Zero edits to engine math. The only permitted engine changes: swap 2 external import lines to `./runtime`, add `runtime.ts`, add `index.ts`, relocate `recentJobsBridge.ts` into `engine/`. Any other engine diff is a plan violation.
- **Same backends, never fork.** Supabase `gbakzhibzotugfyktcrt`, Firebase `weekly-sync-451e2`. (Phase 1 wires neither — but the seam must point nowhere else.)
- **Parity gate is absolute.** The stub is NOT deleted until the hub parity test is green (byte-identical, rate-relevant fields).
- **Canonical source of truth = `ias-dashboard`.** The hub copy is READ-ONLY; never hand-edit vendored engine files — only re-sync.
- **Show-before for the stub swap.** The swap changes the numbers the hub displays; surface a before/after to Zach before finalizing. No deploy this session (work stays on branches; prod = `origin/main`).
- **Codex review** on every non-trivial change (per session hook): runtime seam, parity harness, adapter, stub swap.
- **Determinism rule for parity:** drive the engine from explicit `RateFactors` / fixed parser strings with pinned dates (never `'asap'`). Compare full `CalculatedRate`/`CalculatedCallRate` objects (they carry no timestamp fields). `cellAggregation`/`crnaCellLookup`/`marketRates` `Date.now()` paths are Phase 2 and excluded from the Phase-1 corpus.

**Phase-1 scope boundary (source-verified import DAG):**
- **In (pure, drop-in):** `rateCalculator`, `callRates`, `multipliers`, `specialties`, `stateData`, `types`, `fuzzyMatch`, `parser`, `sourceFamily`, `firebaseKeyCodec`, `cellAggregation`, `crnaAggregation`, `liveCalibration`, `rateObservation`, `blsOewsBaseline`, `recentJobsBridge`. Plus `blsSanityCheck` **for non-CRNA** (it transitively imports `crnaCellLookup`→`supabase`; the runtime seam makes module-eval safe; only CRNA-cell *calls* defer to Phase 2).
- **Out (Phase 2, needs injected clients):** `marketRates` (Firebase), `crnaCellLookup` live fetch (Supabase). Files ship in the package but their backend functions are not called in Phase 1.
- **Out (later phases):** full React UI port (11 components), telemetry UI/edge calls, the bridge/scrapers (stay backend).

---

## File Structure

**Canonical (`c:\Users\oclou\QueenClaude\ias-dashboard`):**
- Create: `src/features/rate-simulator/engine/runtime.ts` — DI seam (`configureEngine`, `getDb`, `getSupabase`).
- Create: `src/features/rate-simulator/engine/index.ts` — public API barrel.
- Modify: `src/features/rate-simulator/engine/marketRates.ts:8` — import `db` from `./runtime`.
- Modify: `src/features/rate-simulator/engine/crnaCellLookup.ts:23` — import `supabase` from `./runtime`.
- Move: `src/features/rate-simulator/components/recentJobsBridge.ts` → `src/features/rate-simulator/engine/recentJobsBridge.ts` (import path `../engine/types` → `./types`).
- Modify: `src/features/rate-simulator/components/RecentJobs.tsx` — repoint `recentJobsBridge` import.
- Modify: `src/App.tsx` — call `configureEngine({ db, supabase })` once at startup.
- Create: `scripts/rate-engine/gen-golden-master.ts` — emits the frozen corpus.
- Create: `src/features/rate-simulator/engine/__tests__/goldenMaster.json` — committed corpus (shared contract).

**Hub (`c:\Users\oclou\QueenClaude\ias-website\.worktrees\feat-ims-phase-1-plan`):**
- Create: `src/lib/rate-engine/**` — vendored engine (subtree of canonical `engine/`).
- Create: `src/lib/rate-engine/__tests__/goldenMaster.json` — same corpus, committed.
- Create: `src/lib/hub/rate-engine-parity.test.ts` — recompute + deep-equal gate.
- Create: `src/lib/hub/sim-adapter.ts` — maps hub `<select>` controls → `RateFactors`; thin, Phase-1.
- Rewrite: `src/lib/hub/rate-engine.ts` — re-export `SIM_*` derived from real `SPECIALTIES`/multipliers via the adapter (keeps the existing UI contract; deletes the curated 8-specialty table).
- Modify: `src/components/hub/hub-client.ts` — compute quote via `calculateRate` (adapter), not the coarse mult chain.
- Modify (only if signatures shift): `src/lib/hub/hub-data.ts`, `src/lib/hub/hub-data.test.ts`, `src/lib/hub/rate-engine.test.ts`, `src/components/hub/SimulatorView.astro`, `src/components/hub/OverviewView.astro`.
- Create: `scripts/sync-rate-engine.mjs` — subtree-pull wrapper / fallback copy + drift report.

---

## STAGE A — Extract & inject in canonical (zero math drift)

> Acceptance for the whole stage: `npm test` (759 engine tests) and `npm run build` (`tsc -b && vite build`) both green in `ias-dashboard` with no engine-math diff. The existing suite IS the characterization net.

### Task A0: Isolate the canonical work on a branch

**Files:** none (git only).

- [ ] **Step 1:** Confirm clean source tree (ignore `_claude_global` plugin-cache noise).

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && git status --porcelain -- src scripts`
Expected: empty (no pending source changes).

- [ ] **Step 2:** Create the extraction branch off current HEAD.

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && git switch -c feat/rate-engine-extract-2026-06-22`
Expected: `Switched to a new branch ...`

- [ ] **Step 3:** Baseline the suite BEFORE any change (record the green number).

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npm test 2>&1 | tail -20`
Expected: all pass (~759). Record the exact count — it must not drop.

### Task A1: Add the DI runtime seam

**Files:**
- Create: `src/features/rate-simulator/engine/runtime.ts`

**Interfaces:**
- Produces: `configureEngine(opts: { db?: Database; supabase?: SupabaseClient }): void`, `getDb(): Database`, `getSupabase(): SupabaseClient`.

- [ ] **Step 1: Write the failing test.**

Create `src/features/rate-simulator/engine/__tests__/runtime.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { configureEngine, getDb, getSupabase, __resetEngineRuntime } from '../runtime'

describe('engine runtime DI seam', () => {
  beforeEach(() => __resetEngineRuntime())

  it('throws a clear error when used before configuration', () => {
    expect(() => getSupabase()).toThrow(/engine: supabase not configured/)
    expect(() => getDb()).toThrow(/engine: db not configured/)
  })

  it('returns the injected clients after configureEngine', () => {
    const db = { __db: true } as never
    const supabase = { __sb: true } as never
    configureEngine({ db, supabase })
    expect(getDb()).toBe(db)
    expect(getSupabase()).toBe(supabase)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npx vitest run src/features/rate-simulator/engine/__tests__/runtime.test.ts`
Expected: FAIL (module `../runtime` not found).

- [ ] **Step 3: Implement `runtime.ts`.**

```ts
// engine/runtime.ts — dependency-injection seam.
// The engine reaches outside its folder in exactly two places (marketRates: db,
// crnaCellLookup: supabase). Both now import from here. Each host calls
// configureEngine() once at init with ITS OWN clients pointing at the SAME
// backends (Supabase gbakzhibzotugfyktcrt, Firebase weekly-sync-451e2).
// Module-eval touches no client — clients are required only when a backend fn
// is actually called, which is why the pure Phase-1 calc path needs no config.
import type { Database } from 'firebase/database'
import type { SupabaseClient } from '@supabase/supabase-js'

let _db: Database | null = null
let _supabase: SupabaseClient | null = null

export function configureEngine(opts: { db?: Database; supabase?: SupabaseClient }): void {
  if (opts.db) _db = opts.db
  if (opts.supabase) _supabase = opts.supabase
}

export function getDb(): Database {
  if (!_db) throw new Error('engine: db not configured — call configureEngine({ db }) at app init')
  return _db
}

export function getSupabase(): SupabaseClient {
  if (!_supabase) throw new Error('engine: supabase not configured — call configureEngine({ supabase }) at app init')
  return _supabase
}

/** Test-only reset. Not part of the public API. */
export function __resetEngineRuntime(): void {
  _db = null
  _supabase = null
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npx vitest run src/features/rate-simulator/engine/__tests__/runtime.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
cd /c/Users/oclou/QueenClaude/ias-dashboard
git add src/features/rate-simulator/engine/runtime.ts src/features/rate-simulator/engine/__tests__/runtime.test.ts
git commit -m "feat(rate-engine): add DI runtime seam (configureEngine/getDb/getSupabase)"
```

### Task A2: Repoint the 2 external imports to the seam

**Files:**
- Modify: `src/features/rate-simulator/engine/marketRates.ts:8`
- Modify: `src/features/rate-simulator/engine/crnaCellLookup.ts:23`

**Interfaces:**
- Consumes: `getDb`, `getSupabase` from `./runtime` (A1).

- [ ] **Step 1:** In `marketRates.ts`, replace `import { db } from '../../../config/firebase'` with `import { getDb } from './runtime'`, then replace each bare `db` usage with `getDb()`. (Grep first: `grep -n "\\bdb\\b" marketRates.ts` — repoint only the firebase-RTDB `db` references.)

- [ ] **Step 2:** In `crnaCellLookup.ts`, replace `import { supabase } from '../../../config/supabase'` with `import { getSupabase } from './runtime'`, then replace each bare `supabase` usage with `getSupabase()`.

- [ ] **Step 3:** Update the two files' existing vitest mocks. They currently `vi.mock('../../../config/supabase', ...)` / `firebase`. Add an equivalent `vi.mock('../runtime', () => ({ getSupabase: () => mockClient, getDb: () => mockDb, ... }))` OR keep the config mock and have `configureEngine` called in the test setup. Pick whichever keeps the existing assertions byte-identical. (Inspect `marketRates.test.ts` / `crnaCellLookup.test.ts` mock blocks and mirror them.)

- [ ] **Step 4: Run the affected suites.**

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npx vitest run src/features/rate-simulator/engine/__tests__/marketRates.test.ts src/features/rate-simulator/engine/__tests__/crnaCellLookup.test.ts src/features/rate-simulator/engine/__tests__/crnaAggregation.test.ts`
Expected: PASS (same counts as baseline).

- [ ] **Step 5: Full suite + build (zero-drift gate).**

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npm test 2>&1 | tail -10 && npm run build 2>&1 | tail -10`
Expected: 759 green; build succeeds.

- [ ] **Step 6: Commit.**

```bash
git add src/features/rate-simulator/engine/marketRates.ts src/features/rate-simulator/engine/crnaCellLookup.ts src/features/rate-simulator/engine/__tests__/*.test.ts
git commit -m "refactor(rate-engine): consume db/supabase via runtime seam (no math change)"
```

### Task A3: Relocate recentJobsBridge into the engine boundary

**Files:**
- Move: `components/recentJobsBridge.ts` → `engine/recentJobsBridge.ts`
- Modify: `components/RecentJobs.tsx` import path
- Move: `components/__tests__/recentJobsBridge.test.*` if present → engine tests

- [ ] **Step 1:** `git mv src/features/rate-simulator/components/recentJobsBridge.ts src/features/rate-simulator/engine/recentJobsBridge.ts`

- [ ] **Step 2:** In the moved file, change `import type { ParsedAssignment } from '../engine/types'` → `from './types'`.

- [ ] **Step 3:** In `RecentJobs.tsx`, repoint `./recentJobsBridge` → `../engine/recentJobsBridge` (verify the relative path).

- [ ] **Step 4:** Move any `recentJobsBridge` test alongside it and fix its import.

- [ ] **Step 5: Build + suite.**

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -8`
Expected: green; build OK.

- [ ] **Step 6: Commit.**

```bash
git add -A src/features/rate-simulator
git commit -m "refactor(rate-engine): move recentJobsBridge into engine package boundary"
```

### Task A4: Public API barrel

**Files:**
- Create: `src/features/rate-simulator/engine/index.ts`

**Interfaces:**
- Produces the hub-facing surface. Use `export type` for types (`verbatimModuleSyntax`).

- [ ] **Step 1: Write the barrel** (verified-existing exports only):

```ts
// engine/index.ts — public API. Single import surface for both repos.
export { configureEngine, getDb, getSupabase } from './runtime'
// Calculate
export { calculateRate, calculateCallRate, initFactors, getPercentileRate, roundUp5, extractBillRateCap } from './rateCalculator'
// Parse
export { parseFreetextInput, buildParsedFromFreetext, parseLocumsmartAssignment } from './parser'
// Specialty / multipliers / geo
export { SPECIALTIES, SPECIALTY_ALIASES, confidenceLabel } from './specialties'
export { SHIFT_MULT, FACILITY_MULT, DURATION_MULT } from './multipliers'
export { STATE_MULT, STATE_NAMES, STATE_DEMAND_CLASS, METRO_CITIES } from './stateData'
// Sanity
export { evaluateBlsSanityCheck } from './blsSanityCheck'
// Call rates
export { CALL_RATE_DATA, getCallRateEntry, GSA_STANDARD } from './callRates'
// Fuzzy / family / codec / live (Phase-1 pure)
export { fuzzyMatchSpecialty, fuzzyMatchState, fuzzyMatchCity } from './fuzzyMatch'
export { sourceFamily, KNOWN_FAMILY_OVERRIDES } from './sourceFamily'
export { firebaseSafeKey, firebaseUnsafeKey } from './firebaseKeyCodec'
export { observedHcoProfile, observedSpecialtyProfile, enrichedJobCount } from './liveCalibration'
export { buildParsedFromJob } from './recentJobsBridge'
// Live overlays (Phase 2 — exported, not called in Phase 1)
export { computeDisplayedRate, computeDisplayedBill, loadMarketRates } from './marketRates'
export { getCrnaCellEnvelope, deriveLocumMultCrna } from './crnaCellLookup'
// Types
export type {
  RateFactors, CalculatedRate, CalculatedCallRate, CallRateBand, CallCompModel,
  ParsedAssignment, FreetextParseResult, RateCapFactor, RateCapUnit,
  FactorSource, ConfidenceLevel, GsaRates, RateSourceEntry,
} from './types'
export type { SpecialtyRate } from './specialties'
```

- [ ] **Step 2: Verify each re-export resolves** (typecheck catches typos):

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npx tsc -b 2>&1 | tail -20`
Expected: no errors. Fix any export-name mismatch by grepping the source file for the real symbol name before guessing.

- [ ] **Step 3: Commit.**

```bash
git add src/features/rate-simulator/engine/index.ts
git commit -m "feat(rate-engine): public API barrel (index.ts)"
```

### Task A5: Wire configureEngine in the SPA

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1:** Near the top of `App.tsx` module scope (after the client imports), add:

```ts
import { db } from './config/firebase'
import { supabase } from './config/supabase'
import { configureEngine } from './features/rate-simulator/engine'
configureEngine({ db, supabase })
```

(Adjust relative paths to App.tsx's location. This replaces the implicit coupling the engine used to have — the SPA behavior is unchanged.)

- [ ] **Step 2: Build + full suite + smoke the dev server briefly.**

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npm run build 2>&1 | tail -8 && npm test 2>&1 | tail -8`
Expected: build OK; 759 green.

- [ ] **Step 3: Commit.**

```bash
git add src/App.tsx
git commit -m "feat(rate-engine): SPA injects db/supabase via configureEngine at init"
```

---

## STAGE B — Golden master (the parity contract)

### Task B1: Golden-master generator + corpus

**Files:**
- Create: `scripts/rate-engine/gen-golden-master.ts`
- Create: `src/features/rate-simulator/engine/__tests__/goldenMaster.json`

**Interfaces:**
- Consumes: `engine/index.ts` (A4).
- Produces: `goldenMaster.json` = `{ version, cases: Array<{ id, kind, input, output }> }` where `output` is the full `CalculatedRate` | `CalculatedCallRate` | parser result.

- [ ] **Step 1: Write the generator** (seed RateFactors directly — fully deterministic; covers §7.2 cases). Minimum viable seed below; the full matrix is expanded in B2.

```ts
// scripts/rate-engine/gen-golden-master.ts — run: npx tsx scripts/rate-engine/gen-golden-master.ts
import { writeFileSync } from 'node:fs'
import {
  initFactors, calculateRate, calculateCallRate, parseFreetextInput,
  firebaseSafeKey, firebaseUnsafeKey, fuzzyMatchSpecialty,
} from '../../src/features/rate-simulator/engine/index'
import type { ParsedAssignment } from '../../src/features/rate-simulator/engine/index'

// Deterministic ParsedAssignment factory — explicit dates, never 'asap'.
function pa(over: Partial<ParsedAssignment> & { specialty: string }): ParsedAssignment {
  return {
    assignmentNumber: 'GM', status: 'open', hco: 'Test HCO',
    startDate: '2026-01-05', endDate: '2026-04-05', facilities: [], sections: [],
    _source: 'freetext', ...over,
  }
}

const cases: Array<{ id: string; kind: string; input: unknown; output: unknown }> = []
const push = (id: string, kind: string, input: unknown, output: unknown) =>
  cases.push({ id, kind, input, output })

// 1. Curated-path quotes across specialties/states/facility/shift/duration
const SPECS = ['Anesthesiology', 'CRNA', 'Emergency Medicine', 'Hospitalist', 'General Surgery', 'Radiology']
const STATES = ['CA', 'TX', 'NY', 'FL', 'WY', '']  // incl. empty-state edge
for (const s of SPECS) for (const st of STATES) {
  const f = initFactors(pa({ specialty: s, facilities: st ? [{ name: 'F', city: '', state: st }] : [] }))
  push(`hourly:${s}:${st || 'none'}`, 'hourly', f, calculateRate(f))
}

// 2. Call-only path (incl. insufficient-data + coverage divisor)
for (const s of ['CRNA', 'Cardiology', 'Hospitalist']) {
  const f = initFactors(pa({ specialty: s }))
  f.callOnly = { isCallOnly: true, source: 'manual', reason: 'test' }
  for (const dt of ['weekday', 'weekend', 'holiday'] as const) {
    f.dayType = { key: dt, source: 'manual' }
    push(`call:${s}:${dt}`, 'call', f, calculateCallRate(f))
  }
}

// 3. Fuzzy 4-char floor + slashed-key codec round-trip
for (const q of ['anes', 'anesth', 'ob/gyn', 'hematology/oncology', 'np/pa', 'cardio']) {
  push(`fuzzy:${q}`, 'fuzzy', q, fuzzyMatchSpecialty(q))
}
for (const k of ['ob/gyn', 'hematology/oncology', 'np/pa', 'plain']) {
  const enc = firebaseSafeKey(k)
  push(`codec:${k}`, 'codec', k, { enc, dec: firebaseUnsafeKey(enc) })
}

// 4. Parser determinism (fixed strings, no asap)
for (const txt of ['CRNA in Dallas TX nights', 'Emergency Medicine California weekend call', 'Hospitalist 13 week assignment']) {
  push(`parse:${txt}`, 'parse', txt, parseFreetextInput(txt))
}

writeFileSync(
  new URL('../../src/features/rate-simulator/engine/__tests__/goldenMaster.json', import.meta.url),
  JSON.stringify({ version: 1, generatedFrom: 'ias-dashboard', cases }, null, 2) + '\n',
)
console.log(`wrote ${cases.length} golden cases`)
```

- [ ] **Step 2: Generate.**

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npx tsx scripts/rate-engine/gen-golden-master.ts`
Expected: `wrote N golden cases` (N ≥ 50). Inspect the JSON: every `output` has real numbers; no `null` where a band is expected for sufficient specialties.

- [ ] **Step 3: Self-parity test in canonical** (generator output is stable across runs):

Create `src/features/rate-simulator/engine/__tests__/goldenMaster.selfparity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import gm from './goldenMaster.json'
import { initFactors, calculateRate, calculateCallRate, parseFreetextInput, fuzzyMatchSpecialty, firebaseSafeKey, firebaseUnsafeKey } from '../index'

describe('golden master is reproducible in canonical', () => {
  for (const c of gm.cases as Array<{ id: string; kind: string; input: any; output: any }>) {
    it(c.id, () => {
      let actual: unknown
      if (c.kind === 'hourly') actual = calculateRate(c.input)
      else if (c.kind === 'call') actual = calculateCallRate(c.input)
      else if (c.kind === 'parse') actual = parseFreetextInput(c.input)
      else if (c.kind === 'fuzzy') actual = fuzzyMatchSpecialty(c.input)
      else if (c.kind === 'codec') { const enc = firebaseSafeKey(c.input); actual = { enc, dec: firebaseUnsafeKey(enc) } }
      expect(actual).toEqual(c.output)
    })
  }
})
```

Run: `cd /c/Users/oclou/QueenClaude/ias-dashboard && npx vitest run src/features/rate-simulator/engine/__tests__/goldenMaster.selfparity.test.ts`
Expected: all N PASS. (If `hourly`/`call` fail because re-running `calculateRate` on the stored factors differs, the input is non-deterministic — fix the seed, not the assertion.)

- [ ] **Step 4: Commit.**

```bash
git add scripts/rate-engine/gen-golden-master.ts src/features/rate-simulator/engine/__tests__/goldenMaster.json src/features/rate-simulator/engine/__tests__/goldenMaster.selfparity.test.ts
git commit -m "test(rate-engine): golden-master corpus + canonical self-parity"
```

### Task B2 **[WORKFLOW]**: Expand the matrix + adversarial drift verification

- [ ] **Step 1:** Run a Workflow that (a) fans out to enumerate the full §7.2 coverage — all 88 `SPECIALTIES` keys × representative states × facility/shift/duration/rural/holiday combinations + every CRNA tier dispatch + sanity-verdict classes — proposing additional seed cases, and (b) an adversarial verifier pass that diffs the generator's coverage against the §7.2 checklist and reports gaps. Fold accepted cases back into `gen-golden-master.ts`, regenerate, re-run self-parity, re-commit.
- [ ] **Step 2:** Log any deliberately-excluded coverage (e.g., live-overlay cases requiring backends) so the corpus is honest about scope.

---

## STAGE C — Vendor into the hub + prove parity

### Task C1: Vendor the engine into the hub

**Files:**
- Create: `src/lib/rate-engine/**`
- Create: `scripts/sync-rate-engine.mjs`

- [ ] **Step 1 (primary — git subtree):** From the hub worktree, add the canonical repo as a remote and subtree the engine prefix.

```bash
cd "c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan"
git remote add ias-dashboard "c:/Users/oclou/QueenClaude/ias-dashboard" 2>/dev/null || true
git fetch ias-dashboard feat/rate-engine-extract-2026-06-22
git subtree add --prefix=src/lib/rate-engine ias-dashboard feat/rate-engine-extract-2026-06-22 --squash
```

If the prefix mismatch blocks a clean subtree (engine is a sub-path, not repo root), use **Step 1-fallback** instead.

- [ ] **Step 1-fallback (tracked copy + sync script):** Write `scripts/sync-rate-engine.mjs` that copies `ias-dashboard/src/features/rate-simulator/engine/**` (excluding `__tests__` except `goldenMaster.json`) into `src/lib/rate-engine/`, then prints a `diff` summary. Run it. Commit the copy. Document that re-sync is `node scripts/sync-rate-engine.mjs` and the hub copy is READ-ONLY.

- [ ] **Step 2: Typecheck the vendored engine under the hub's tsconfig.**

Run: `cd "c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan" && npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors. If `firebase`/`@supabase/supabase-js` types are missing (Phase-2 files), add `firebase` to hub devDeps for types only, or `// @ts-expect-error`-guard the Phase-2 type imports — but DO NOT delete the files (they ship in the package).

- [ ] **Step 3: Commit.**

```bash
git add src/lib/rate-engine scripts/sync-rate-engine.mjs
git commit -m "feat(hub): vendor @ias/rate-engine (read-only, canonical=ias-dashboard)"
```

### Task C2: Hub parity test (THE GATE)

**Files:**
- Create: `src/lib/hub/rate-engine-parity.test.ts`
- Ensure: `src/lib/rate-engine/__tests__/goldenMaster.json` present (came with the subtree/sync).

- [ ] **Step 1: Write the parity test** (recompute through the vendored engine, deep-equal the committed corpus):

```ts
import { describe, it, expect } from 'vitest'
import gm from '../rate-engine/__tests__/goldenMaster.json'
import {
  calculateRate, calculateCallRate, parseFreetextInput, fuzzyMatchSpecialty,
  firebaseSafeKey, firebaseUnsafeKey,
} from '../rate-engine/index'

describe('hub engine is byte-identical to canonical golden master', () => {
  for (const c of (gm as any).cases as Array<{ id: string; kind: string; input: any; output: any }>) {
    it(c.id, () => {
      let actual: unknown
      if (c.kind === 'hourly') actual = calculateRate(c.input)
      else if (c.kind === 'call') actual = calculateCallRate(c.input)
      else if (c.kind === 'parse') actual = parseFreetextInput(c.input)
      else if (c.kind === 'fuzzy') actual = fuzzyMatchSpecialty(c.input)
      else if (c.kind === 'codec') { const enc = firebaseSafeKey(c.input); actual = { enc, dec: firebaseUnsafeKey(enc) } }
      expect(actual).toEqual(c.output)
    })
  }
})
```

- [ ] **Step 2: Run the gate.**

Run: `cd "c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan" && npx vitest run src/lib/hub/rate-engine-parity.test.ts`
Expected: **all N PASS**. ← This is the gate. If any case differs, STOP — the vendoring introduced drift (path resolution, TS downleveling, or a missed file). Diagnose with systematic-debugging; do not weaken the assertion.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/hub/rate-engine-parity.test.ts
git commit -m "test(hub): golden-master parity gate vs canonical rate engine"
```

- [ ] **Step 4: CHECKPOINT — report parity result to Zach before Stage D.** Show the passing count and the case kinds covered.

---

## STAGE D — Swap the stub (gated finale; show-before)

> Only after C2 is green. This changes the hub's displayed numbers — surface a before/after to Zach before finalizing.

### Task D1: Sim adapter (hub controls → RateFactors)

**Files:**
- Create: `src/lib/hub/sim-adapter.ts`
- Test: `src/lib/hub/sim-adapter.test.ts`

**Interfaces:**
- Produces: `buildSimFactors(opts: { specialtyLabel: string; regionKey: string; shiftKey: string; urgencyKey: string }): RateFactors` and `simSpecialtyOptions(): Array<{ label: string; key: string }>` derived from real `SPECIALTIES`.
- Region→state mapping: the existing 5-region control maps to representative states (National→'' ; West→'CA'; NE→'NY'; SE→'FL'; Midwest→'IL'). Urgency→duration factor (Standard→standard; Priority→short; Emergent→emergency). Document these mappings as the explicit, reviewable Phase-1 simplification.

- [ ] **Step 1:** Write `sim-adapter.test.ts` asserting `buildSimFactors` produces a `RateFactors` whose `calculateRate` is finite, ≥ 0, and that an unknown specialty label throws (no silent 0). (Concrete cases: Anesthesiology/West/Nights/Standard → payRate within `SPECIALTIES['anesthesiology']` range × ≤1.75.)
- [ ] **Step 2:** Run → fails (module missing).
- [ ] **Step 3:** Implement `sim-adapter.ts` using `SPECIALTIES`, `initFactors`/manual factor build, `SHIFT_MULT`. No new math — only mapping + delegation to `calculateRate`.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5:** Commit.

### Task D2: Rewrite the stub as a real-engine façade

**Files:**
- Rewrite: `src/lib/hub/rate-engine.ts`
- Modify: `src/components/hub/hub-client.ts`, `src/lib/hub/hub-data.ts`
- Update tests: `src/lib/hub/rate-engine.test.ts`, `src/lib/hub/hub-data.test.ts`

- [ ] **Step 1:** Re-derive `SIM_SPECIALTIES` from real `SPECIALTIES` (label + key + a `billBase` computed via the engine, not the curated p70 table) so `SimulatorView.astro`/`OverviewView.astro` keep rendering options. Keep the exported names (`SIM_SPECIALTIES`, `SIM_SHIFTS`, `SIM_REGIONS`, `SIM_URGENCY`) so the `.astro` files need no change unless shape shifts. Preserve `SimSpecialty`/`SimOption` interfaces consumed by `hub-data.ts`.
- [ ] **Step 2:** In `hub-client.ts`, replace the coarse `billBase × region × shift × urgency` math with `buildSimFactors(...)` → `calculateRate(...)` → display `payRate`/`billRate`. Keep the UI/DOM wiring; change only the computation.
- [ ] **Step 3:** Update `rate-engine.test.ts`/`hub-data.test.ts` to the new contract (more specialties; values now engine-derived). Assert structural invariants (every option has a finite `billBase`; `SIM_BY_LABEL` covers all options), not the old hardcoded numbers.
- [ ] **Step 4: Full hub suite + build.**

Run: `cd "c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan" && npm test 2>&1 | tail -12 && npm run build 2>&1 | tail -12`
Expected: green; `astro build` succeeds (engine compiles for Cloudflare).

- [ ] **Step 5: Codex review** the swap (hub-client math change + façade). Fix what it flags; loop until clean.
- [ ] **Step 6: SHOW-BEFORE checkpoint.** Present Zach a before/after table of representative hub quotes (old stub vs new engine) + the region/urgency mapping decisions. Get explicit go before committing the deletion of the curated table.
- [ ] **Step 7: Commit.**

```bash
git add src/lib/hub/rate-engine.ts src/lib/hub/sim-adapter.ts src/components/hub/hub-client.ts src/lib/hub/hub-data.ts src/lib/hub/*.test.ts
git commit -m "feat(hub): rate simulator computes via real @ias/rate-engine (stub retired)"
```

---

## Out of scope (this session)
- Phase 2 live overlays: `configureEngine` wiring to hub Firebase/Supabase, `marketRates`/`crnaCellLookup` live fetch, calibration.
- Full React UI component port (RateResults waterfall, FactorGrid, MarketContext, MarketDataView, FeedbackSection, UploadZone/pdfjs, CitedObservations, HomePage quick-calc, telemetry UI).
- Telemetry edge-function calls + `TELEMETRY_WRITE_SECRET`.
- GitHub Packages graduation (needs Zach's classic PAT + CF env `NPM_TOKEN` in Production+Preview).
- Backend pipelines (bridge/scrapers) — stay backend.

## Self-Review
- **Spec coverage:** §7.2 golden-master cases → B1/B2; "IMPORT not rewrite" → Stage A constraint + parity gate; recentJobsBridge → A3; runtime seam/DI → A1/A2/A5; same-backends → Global Constraints + A5; stub replacement gated on parity → Stage D after C2. Phase-2/UI/telemetry explicitly deferred.
- **Determinism:** corpus seeded from explicit factors/strings, pinned dates; outputs carry no timestamps (verified in `types.ts`). ✓
- **Type consistency:** barrel exports verified against source (`calculateRate`, `calculateCallRate`, `initFactors`, `extractBillRateCap`, `parseFreetextInput`, `buildParsedFromFreetext`, `parseLocumsmartAssignment`, `computeDisplayedRate` all confirmed present). ✓
- **Risk:** the one behavior-changing step (D2) is gated on parity + Codex + show-before. The canonical extraction is guarded by the 759-test characterization net.
