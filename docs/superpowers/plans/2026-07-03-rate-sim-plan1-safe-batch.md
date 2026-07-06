# Rate Simulator — Plan 1 (Safe, No-Quote-Change Batch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four HIGH-impact / LOW-effort rate-simulator safety + honesty fixes (percentile-honesty relabel, CI test-gate + golden-master pin, feedback-node lock, portability Step-0 landmine defusal) on `redesign/v5-reskin` WITHOUT moving a single quote number and WITHOUT deploying.

**Architecture:** Each item is an independent, atomic commit. Three of the four are pure safety/infra (no user-visible effect); one (1A) is a display-only copy change gated by SHOW-BEFORE. Two touch the vendored rate-engine but neither crosses the parity gate (the gate imports only the Phase-1 barrel, which excludes the edited files). One touches a sibling repo (`ias-dashboard`) config file the operator (Zach) deploys separately.

**Tech Stack:** Astro (`output: 'static'`, Cloudflare adapter) + TypeScript + Vitest; GitHub Actions CI; Firebase Realtime Database security rules (JSON).

## Global Constraints

Every task's requirements implicitly include this section. Copied verbatim from the KICKOFF (`docs/superpowers/plans/2026-07-03-rate-sim-execution-KICKOFF.md` §1) and durable memory.

- **NO DEPLOY.** `redesign/v5-reskin` is a feature branch (no auto-deploy). Prod ships only from `origin/main` in the `ias-website` repo, Zach-gated. "Do whatever / do what's best" is NOT deploy authorization.
- **NEVER fabricate a $ figure.** Every number is read-from-code (file:line) or cited to a named external source, else flagged UNVERIFIED. Plan 1 changes ZERO quote numbers.
- **Do NOT change any quote NUMBER.** If a task would move a number, it belongs in Plan 2, not here.
- **`git add <exact file paths>` ONLY. NEVER `git add -A` / `git add .`.** This worktree has ~100 untracked WIP files from other workstreams. Stage only the files your task created/modified.
- **SHARED, actively-committed branch.** Two other sessions (hub-pipeline execution, Weekly Sync) commit to `redesign/v5-reskin` in parallel; HEAD advances under you. Pin every diff/review range to an explicit SHA. Re-run `git status` before every commit. Read any hub file LIVE right before editing in case it moved.
- **Codex peer-review loop is mandatory** for every non-trivial code change: write it, hand to Codex (`/codex:rescue` or the codex bash runtime), fix what it flags, loop until nothing to add, THEN claim done. If skipped, say so with `[codex-skip:reason]`.
- **Verification before completion:** tag any done/fixed/passing claim with `[runtime-verified]` / `[logically-inspected]` / `[syntax-checked]` and actually run the command. No bare "done."
- **Review gate:** after a task's changes, run the reviewer and stamp `bash ~/.claude/hooks/review-gate.sh --stamp`. Review only YOUR diff; ignore gate noise about the ~100 pre-existing unrelated WIP files.
- **Copy/voice:** NO em-dashes anywhere (AI tell). Pay cadence weekly. Never publicly state founders are physicians. Do not touch testimonials/palette.
- **Operator-only steps are Zach's** (see the OPERATOR-RUNBOOK): prod DB migrations, secret rotation, Firebase rules DEPLOY, any `origin/main` push. You edit the file; Zach deploys.

---

## 0. Verified ground truth (re-verified against HEAD `6f885c1`, 2026-07-06)

Re-verification run `wf_d022fb8f-1bd` (4 read-only agents, one per item) + hand reads confirmed the KICKOFF §7 line cites against current on-disk code. **All Plan 1 targets confirmed present.** Corrections to the KICKOFF that this plan already bakes in:

| # | KICKOFF said | Reality now | Impact on plan |
|---|---|---|---|
| C1 | parity test at `src/lib/rate-engine/__tests__/rate-engine-parity.test.ts` | it is at **`src/lib/hub/rate-engine-parity.test.ts`** (floor at :50); the `rate-engine/__tests__/` dir holds only `goldenMaster.json` + `marketBucketsOverlay.test.ts` | Task 2 + Task 4 edit the correct path |
| C2 | golden-master count "208" (memory) | **207** (`goldenMaster.json` `count` field AND `cases.length`, independently counted) | Task 2 pins `toBe(207)` |
| C3 | premium fix at `marketRates.ts:537-541` | actually **`:538-540`** (3-line ternary) | Task 4 documents the true span |
| C4 | (implicit) 1A could touch `getPercentileRate` / `index.ts` | all 22 `rate-engine/*.ts` carry a `VENDORED — DO NOT EDIT` banner; `getPercentileRate` is DEAD (0 call sites) but editing it needs an upstream change | **Task 5 stays 100% in `sim-render.ts` + its test** — no vendored file touched |
| C5 | parity gate "gates drift" | the gate imports only the Phase-1 barrel (`../rate-engine/index`), whose closure **excludes `marketRates.ts`** | Task 4's back-port to `marketRates.ts`/`sourceFamily.ts` does NOT trip parity — confirmed by the 2026-07-02 premium fix already living there with the gate green |

**Baseline captured (do not attribute to your work):** `npm test` → **1045 passed | 7 skipped (49 files)** GREEN at `6f885c1`. The former `sync-merge.test.ts` clock-skew flake is fixed and COMMITTED on this branch (commit `2214893` "drop editedAt from Weekly Sync comparableCol") — `comparableCol` no longer keys on `editedAt`. So a required `npm test` CI gate (Task 2) is safe.

### ⚠ BLOCKING ISSUE DISCOVERED — flag to Zach, NOT fixed by this plan
`npm run build` is currently **RED (exit 1)** on this branch. Root cause: `src/pages/hub/api/pipeline.test.ts` — a Vitest file sitting inside the Astro `pages/` route directory (added by the concurrent hub-pipeline session, commit `6ed58b6`). With `output: 'static'`, Astro prerenders it as a route and it throws `Cannot read properties of undefined (reading 'config')` (a top-level `describe()` runs with no vitest runtime). The `astro.config.mjs` `filter` at :27 is a **sitemap** filter only, so it does not exclude the file from the build.
- **Not this plan's file** (the pipeline session owns `pipeline-*`). Do NOT fix it here — flag it. The fix is theirs: relocate `pipeline.test.ts` out of `src/pages/` (e.g. `src/lib/hub/__tests__/` or a top-level `tests/` dir).
- **Consequence for Task 2:** the `npm test` gate itself is green (Vitest is independent of the build). But CI also runs `npm run build`, so overall CI stays red until the pipeline session relocates that file. Task 2 still lands the correct test gate; note the caveat in the commit body. This build-red MUST be resolved before ANY of this work is cherry-picked to `main`.

---

## File Structure

Files created or modified by this plan, and each one's responsibility.

- **Modify** `C:/Users/oclou/QueenClaude/ias-dashboard/database.rules.json` (Task 1) — flip the world-writable `rate-simulator/feedback` node to authenticated-write + tighten its per-entry `.validate`. Sibling repo; Zach deploys. (No test harness here — validated by JSON parse + Codex review of the rule expression + Zach's `firebase deploy` at OP-2.)
- **Modify** `.github/workflows/ci.yml` (Task 2) — add `- run: npm test` between `npm ci` and `npm run build`.
- **Modify** `src/lib/hub/rate-engine-parity.test.ts` (Task 2) — pin the golden-master corpus size to exactly 207.
- **Modify** `src/lib/rate-engine/marketRates.ts` + `src/lib/rate-engine/sourceFamily.ts` (Task 3) — back-port the 2 WS1 deltas (`aggregator_estimate: 0` precedence rung + 7 family mappings) so the live copy is complete.
- **Create** `src/lib/rate-engine/__tests__/ws1-backport.test.ts` (Task 3) — behavioral test proving the 7 families map correctly.
- **Modify** `scripts/sync-rate-engine.mjs` (Task 4) — neuter the destructive legacy→live sync so it can no longer overwrite the live engine.
- **Modify** all 22 `src/lib/rate-engine/*.ts` banners + `src/lib/hub/rate-engine-parity.test.ts` header (Task 4) — rewrite the false "canonical: ias-dashboard / re-sync" banner to state the live copy is now canonical (line-count-preserving, so no downstream line drift).
- **Modify** `src/lib/hub/sim-render.ts` + `src/lib/hub/sim-render.test.ts` (Task 5) — percentile-honesty relabel (display-only, SHOW-BEFORE). NOT vendored.

**Not touched (hard boundaries):** any `spec.p70` band field (`specialties.ts:179`, `rateCalculator.ts:658` — the quote base, asserted 60+ times); `goldenMaster.json` (generated artifact); `sim-adapter.ts` math; the concurrent sessions' files (`pipeline-*`, `hub-client.ts` `VIEW_TITLES`); the main-branch `scripts/sync-rate-engine.mjs` copy (Zach-gated); the stale `weekly-sync/database.rules.json`.

---

## Task 1: Lock the world-writable feedback RTDB node (item 1C)

**Files:**
- Modify: `C:/Users/oclou/QueenClaude/ias-dashboard/database.rules.json` (the `rate-simulator/feedback` node, lines 27-34)

**Why / verified state:** The live authoritative rules file is `ias-dashboard/database.rules.json` (it carries `market-rates-v2` + `cap-rates`). Its `rate-simulator/feedback` node is world-writable (`.write: true`, line 29) with only a per-`$entryId` `.validate` requiring `specialty` + `timestamp`. Siblings `market-rates` (:37), `market-rates-v2` (:41), `cap-rates` (:45) are already `.write: false` — DO NOT loosen them. The feedback node is currently EMPTY with no live writer (the calibration loop is unwired), so locking it now breaks nothing and must happen before Plan 4 calibration consumes it (poisoning vector). `.write: "auth != null"` blocks anonymous world-writes while still permitting a future authenticated hub client AND admin-SDK server writes (admin bypasses rules). `.read` stays `true` (unchanged — matches the sibling nodes; read-privacy is a Plan 4 concern when the real writer lands, per Master §5.2 "write to a private store").

**GOTCHA (hazard, for the deploy checklist, not an edit):** both `ias-dashboard/.firebaserc` and `weekly-sync/.firebaserc` default to the SAME project `weekly-sync-451e2`, so RTDB rules are project-wide and last-deploy-wins. The stale `weekly-sync/database.rules.json` (market-rates `.write:true`, no v2/cap-rates, feedback `.validate` at the collection root instead of per-`$entryId`) must NEVER be deployed for the live tree. Deploy from `ias-dashboard` only (runbook OP-2).

- [ ] **Step 1: Read the live node to confirm it has not moved**

Run: `grep -n '"feedback"' -A 8 "C:/Users/oclou/QueenClaude/ias-dashboard/database.rules.json"`
Expected: the `"feedback"` block at ~L27 with `".write": true` at ~L29 and a `$entryId` `.validate`. If line numbers drifted, use the real ones.

- [ ] **Step 2: Apply the lock** (Edit, exact match — preserve the file's existing indentation)

Replace this block:

```json
      "feedback": {
        ".read": true,
        ".write": true,
        ".indexOn": ["specialty", "timestamp"],
        "$entryId": {
          ".validate": "newData.hasChildren() && newData.child('specialty').exists() && newData.child('timestamp').exists()"
        }
      }
```

with:

```json
      "feedback": {
        ".read": true,
        ".write": "auth != null",
        ".indexOn": ["specialty", "timestamp"],
        "$entryId": {
          ".validate": "newData.hasChildren(['specialty', 'timestamp']) && newData.child('specialty').isString() && newData.child('specialty').val().length > 0 && newData.child('specialty').val().length <= 80 && newData.child('timestamp').isNumber() && newData.child('timestamp').val() <= now"
        }
      }
```

Changes, all defensible with ZERO fabricated schema: (a) `.write` `true` → `"auth != null"` (kills world-write, the whole point); (b) `.validate` tightened using ONLY the two fields already required — `specialty` must be a non-empty string ≤80 chars, `timestamp` must be a number not in the future (`<= now`, server clock — the idiomatic RTDB server-timestamp bound; it blocks future-dating, not backdating, and we deliberately do NOT fabricate a lower-bound epoch). No new/invented field names. Residual hardening (closed schema, anon-auth exclusion, backdating floor) is deferred to Plan 4 when the real feedback writer + its schema exist — over-tightening this empty node now risks rejecting the legitimate future writer.

- [ ] **Step 3: Verify the file still parses as JSON and the node is locked**

Run:
```bash
node -e "const r=require('C:/Users/oclou/QueenClaude/ias-dashboard/database.rules.json'); const f=r.rules['rate-simulator'].feedback; if(f['.write']!=='auth != null') throw new Error('feedback .write not locked: '+f['.write']); if(r.rules['rate-simulator']['market-rates-v2']['.write']!==false) throw new Error('market-rates-v2 loosened!'); if(r.rules['rate-simulator']['cap-rates']['.write']!==false) throw new Error('cap-rates loosened!'); console.log('OK: feedback locked to', JSON.stringify(f['.write']), '| market-rates-v2 .write=', r.rules['rate-simulator']['market-rates-v2']['.write'], '| cap-rates .write=', r.rules['rate-simulator']['cap-rates']['.write']);"
```
Expected: `OK: feedback locked to "auth != null" | market-rates-v2 .write= false | cap-rates .write= false` (confirms lock applied AND quote-data nodes NOT loosened).

- [ ] **Step 4: Codex review of the rule expression** (config file, no vitest harness — `[codex-skip]` does NOT apply; the RULE LOGIC gets reviewed)

Hand the diff to Codex (`/codex:rescue`), asking specifically: does the `.validate` reject a malformed/backdated entry, does `"auth != null"` correctly deny anonymous writes, and does anything here loosen a sibling node? Fix what it flags; loop until clean.

- [ ] **Step 5: Leave the deploy checklist for Zach and commit**

Append a short deploy note (do NOT deploy) referencing runbook OP-2, then:

```bash
cd "C:/Users/oclou/QueenClaude/ias-dashboard"
git status --short   # confirm ONLY database.rules.json is staged-worthy
git add database.rules.json
git commit -m "fix(rate-sim): lock world-writable feedback RTDB node to authenticated-write

The rate-simulator/feedback node was .write:true (world-writable). Flip to
'auth != null' + tighten the per-entry .validate (specialty string bound,
timestamp <= now) before the Plan 4 calibration loop consumes it. market-rates-v2
+ cap-rates remain .write:false (untouched). Deploy is Zach-only (runbook OP-2,
from ias-dashboard, NOT the stale weekly-sync copy). No app code changes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Note: this commit is in the `ias-dashboard` repo, not `ias-website`. Stage the RULES file only.

**Acceptance:** feedback node no longer world-writable; `market-rates-v2`/`cap-rates` still `.write:false`; JSON parses; deploy checklist left for Zach; nothing deployed.

---

## Task 2: CI test-gate + pin the golden-master count (item 1B)

**Files:**
- Modify: `.github/workflows/ci.yml:17-19`
- Modify (test): `src/lib/hub/rate-engine-parity.test.ts:49-51`

**Why / verified state:** CI runs `npm ci` → `npm run build` → `npm run verify` and NO tests (`verify` = `verify-build.mjs && voice-lint.mjs`, package.json:13). So the 207-case golden master + ~44 test files never gate anything. `package.json:15` `test` = `vitest run`. The golden master `count` field and `cases.length` are both **207** (memory's 208 is stale). Today the only size assertion is a floor `expect(corpus.length).toBeGreaterThanOrEqual(150)` at `src/lib/hub/rate-engine-parity.test.ts:50` (`corpus = (gm as { cases: Case[] }).cases`, gm imported from `../rate-engine/__tests__/goldenMaster.json`).

- [ ] **Step 1: Write the failing pin test** (Edit `src/lib/hub/rate-engine-parity.test.ts`)

Replace the existing size-floor `it` block:

```typescript
  it('corpus loaded and non-trivial', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(150);
  });
```

with an exact pin on both the `count` field and the array length:

```typescript
  it('corpus loaded and pinned to the exact golden-master count (drift tripwire)', () => {
    // Exact pin, not a floor: a legit corpus regen moves count + cases.length
    // together, so this catches a truncated/duplicated/silently-shrunk corpus.
    // Bump BOTH the number here and the JSON when the golden master is regenerated.
    expect((gm as { count: number }).count).toBe(207);
    expect(corpus.length).toBe(207);
    expect(corpus.length).toBe((gm as { count: number }).count);
  });
```

- [ ] **Step 2: Run the test to verify it passes at 207 (and would fail on drift)**

Run: `npx vitest run src/lib/hub/rate-engine-parity.test.ts -t "pinned to the exact golden-master count"`
Expected: PASS (count and length both 207). Sanity-check the tripwire mentally: if `goldenMaster.json` `count` were 208, `toBe(207)` fails.

- [ ] **Step 3: Add the `npm test` CI gate** (Edit `.github/workflows/ci.yml`)

Replace:
```yaml
      - run: npm ci
      - run: npm run build
      - run: npm run verify
```
with (test runs first for fail-fast, before the slower build):
```yaml
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: npm run verify
```

- [ ] **Step 4: Run the full suite to confirm a green baseline for the gate**

Run: `npm test`
Expected: all pass (baseline was 1045 passed | 7 skipped; +2 assertions from Step 1, still green). Capture the actual counts.

- [ ] **Step 5: Codex review + commit**

Codex-review the two-file diff (loop until clean). Then:
```bash
cd "c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan"
git status --short
git add .github/workflows/ci.yml src/lib/hub/rate-engine-parity.test.ts
git commit -m "ci(rate-sim): run npm test in CI + pin golden-master corpus to 207

Adds a fail-fast 'npm test' step (was build+verify only, so the 207-case parity
gate + ~44 test files never gated CI) and converts the >=150 corpus floor to an
exact toBe(207) pin (count field + cases.length) as a drift tripwire. No quote
numbers change.

KNOWN CAVEAT (not this workstream's file): 'npm run build' is currently red on
this branch because src/pages/hub/api/pipeline.test.ts (concurrent hub-pipeline
session, 6ed58b6) is a vitest file inside the Astro pages/ dir and gets
prerendered as a route. The test gate itself is green; overall CI stays red until
that file is relocated. Must be resolved before this reaches main.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Acceptance:** CI invokes `npm test`; the golden-master count is pinned to 207 and fails on drift; green test baseline confirmed; pure infra, no quote impact. Build-red caveat documented in the commit body.

---

## Task 3: Back-port the WS1 deltas into the live engine (item 1D, part a)

**Files:**
- Modify: `src/lib/rate-engine/sourceFamily.ts:95` (insert 7 family mappings after `aya_healthcare: 'aya',`)
- Modify: `src/lib/rate-engine/marketRates.ts:119-124` (add `aggregator_estimate: 0` rung to `BUCKET_PRECEDENCE`)
- Create (test): `src/lib/rate-engine/__tests__/ws1-backport.test.ts`

**Why / verified state:** The legacy `ias-dashboard` engine has two WS1 (2026-07-01) additions the live copy lacks — `aggregator_estimate: 0` in `BUCKET_PRECEDENCE` (legacy `marketRates.ts:128`) and 7 family mappings in `KNOWN_FAMILY_OVERRIDES` (legacy `sourceFamily.ts:105-117`). The live copy has the premium-erasure fix (`marketRates.ts:538-540`) the legacy LACKS (legacy still has `Math.max(range.max, anchor)` at legacy :523). We back-port BY HAND (never via the sync — the sync would revert the premium fix and delete the overlay guard test). Both deltas are additive and FORWARD-LOOKING: these families/rung do NOT fire on today's live universe (per the code's own comments), so ZERO quote numbers move. `marketRates.ts` is outside the parity-gate closure; `sourceFamily.ts` IS reachable from the Phase-1 barrel but is not exercised by any Phase-1 golden-master case, and the additions are inert data (no `sourceFamily()` control flow changes) — so this is parity-safe, confirmed empirically (the 207-case parity gate + overlay guard stay green). **CRLF:** these files are CRLF on disk; match exactly so Edit preserves line endings.

**Interfaces (verified exports):** `sourceFamily.ts` exports `sourceFamily(source: string): string` and `KNOWN_FAMILY_OVERRIDES: Record<string,string>`. Existing test pattern (`rate-engine-gate2-market.test.ts:892`): `expect(sourceFamily('locums_com')).toBe('locums')`. `BUCKET_PRECEDENCE` in `marketRates.ts` is a module-private const (no exported accessor) — verified by inspection + Codex, not a unit test.

- [ ] **Step 1: Write the failing test** (Create `src/lib/rate-engine/__tests__/ws1-backport.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { sourceFamily } from '../sourceFamily';

// WS1 (2026-07-01) back-port: the 7 forward-looking Scrapling posting-source
// families must resolve to their canonical family so independence counting stays
// correct once the aggregators go live. These do NOT fire on today's universe, so
// no quote number changes — this only proves the mapping is present in the LIVE copy.
describe('WS1 back-port — posting-source family mappings present in the live engine', () => {
  it('maps TrackFive / LocumJobsOnline to one family', () => {
    expect(sourceFamily('trackfive')).toBe('trackfive');
    expect(sourceFamily('locumjobsonline')).toBe('trackfive');
    expect(sourceFamily('trackfive')).toBe(sourceFamily('locumjobsonline'));
  });
  it('maps Tandym / Tandym Health to one family', () => {
    expect(sourceFamily('tandym')).toBe('tandym');
    expect(sourceFamily('tandym_health')).toBe('tandym');
    expect(sourceFamily('tandym')).toBe(sourceFamily('tandym_health'));
  });
  it('collapses JAMA + ACR into the shared Community Brands platform family', () => {
    expect(sourceFamily('communitybrands')).toBe('communitybrands');
    expect(sourceFamily('jama')).toBe('communitybrands');
    expect(sourceFamily('acr')).toBe('communitybrands');
    // independence: two postings of one platform must not fake two families
    expect(sourceFamily('jama')).toBe(sourceFamily('acr'));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** (families not yet in the live copy)

Run: `npx vitest run src/lib/rate-engine/__tests__/ws1-backport.test.ts`
Expected: FAIL — e.g. `sourceFamily('jama')` returns `'jama'` (prefix fallback), not `'communitybrands'`.

- [ ] **Step 3: Back-port the 7 families** (Edit `src/lib/rate-engine/sourceFamily.ts`, insert after line 95 `  aya_healthcare: 'aya',`, before the `  // ziprecruiter / adzuna` comment)

Insert this block (verbatim from legacy, with its provenance comments):

```typescript
  // WS1 (2026-07-01) — FORWARD-LOOKING for the Scrapling posting scrape
  // (agent-sdk/agents/rate_scraper/posting_sources.py). These sources are STAGED
  // (verified:false) or their recovered-agency family is written by the fleet-
  // phase org-recovery, so — like medefis / jackson_physician_search above —
  // they do NOT fire on today's live universe. Keys cover BOTH the board id the
  // scraper writes today AND the underscore agency-org form a future org-recovery
  // will write, so independence counting stays correct once the aggregators go live.
  //   - trackfive : TrackFive operates LocumJobsOnline (aggregator_estimate; it
  //                 NEVER anchors regardless, but the family pins independence).
  trackfive: 'trackfive',
  locumjobsonline: 'trackfive',
  //   - tandym    : Tandym Health — a distinct agency recovered THROUGH JSON-LD
  //                 aggregators (runtime-seen on live Physemp 2026-06-30).
  tandym: 'tandym',
  tandym_health: 'tandym',
  //   - communitybrands : JAMA Career Center + ACR share the Community Brands
  //                 careers platform, so two board postings of ONE agency's req
  //                 must not fake two independent families. Only JAMA + ACR emit
  //                 pay on that platform today.
  communitybrands: 'communitybrands',
  jama: 'communitybrands',
  acr: 'communitybrands',
```

- [ ] **Step 4: Back-port the precedence rung** (Edit `src/lib/rate-engine/marketRates.ts`)

Replace:
```typescript
const BUCKET_PRECEDENCE: Record<string, number> = {
  actual_paid_locum: 4,
  advertised_clinician_pay: 3,
  crowd_survey: 2,
  scraped_article_estimate: 1,
}
```
with:
```typescript
const BUCKET_PRECEDENCE: Record<string, number> = {
  actual_paid_locum: 4,
  advertised_clinician_pay: 3,
  crowd_survey: 2,
  scraped_article_estimate: 1,
  // WS1 (2026-07-01): aggregator_estimate is the LOWEST rung (0) — an aggregator's
  // self-"estimated" range (LJO/TrackFive) for a hidden-pay posting. Renderable as
  // labeled context when it's the only signal, but NEVER anchorable (absent from
  // DEFAULT_ANCHORABLE_RATE_TYPES), so it can never drive the quote off the curated band.
  aggregator_estimate: 0,
}
```

- [ ] **Step 5: Run the new test + the marketRates suite to confirm green and no quote-number drift**

Run: `npx vitest run src/lib/rate-engine/__tests__/ws1-backport.test.ts src/lib/rate-engine src/lib/hub/rate-engine-parity.test.ts`
Expected: the ws1-backport test PASSES; the `marketBucketsOverlay.test.ts` overlay guard + the 207-case parity gate STAY GREEN (proves no quote number moved).

- [ ] **Step 6: Codex review + commit**

Codex-review (confirm additive/inert today, no quote impact, families match legacy, CRLF preserved). Then:
```bash
cd "c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan"
git status --short
git add src/lib/rate-engine/sourceFamily.ts src/lib/rate-engine/marketRates.ts src/lib/rate-engine/__tests__/ws1-backport.test.ts
git commit -m "feat(rate-engine): back-port WS1 deltas into the live copy (additive, no quote change)

Adds the 7 forward-looking Scrapling posting-source families (trackfive/
locumjobsonline, tandym/tandym_health, communitybrands/jama/acr) to
KNOWN_FAMILY_OVERRIDES and the aggregator_estimate:0 rung to BUCKET_PRECEDENCE,
matching the legacy ias-dashboard engine. Hand-ported (NOT via sync, which would
revert the live premium-erasure fix at marketRates.ts:538-540). Inert on today's
universe; golden master + overlay guard stay byte-identical. Precondition for
retiring the backwards sync (next commit).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Acceptance:** the 7 families resolve correctly (new test green); `aggregator_estimate:0` present in `BUCKET_PRECEDENCE`; overlay guard + 207-case parity stay green (no quote number moved); the live copy now holds BOTH the WS1 deltas AND the premium fix.

---

## Task 4: Retire the destructive sync + declare the live copy canonical (item 1D, part b)

**Files:**
- Modify: `scripts/sync-rate-engine.mjs` (neuter — refuse to run)
- Modify: all 22 `src/lib/rate-engine/*.ts` (banner lines 1-2, replace-in-place, line-count-preserving)
- Modify: `src/lib/hub/rate-engine-parity.test.ts:1-5` (reword the header)

**Why / verified state:** `scripts/sync-rate-engine.mjs` copies the legacy `ias-dashboard` engine over the live copy and `rmSync(dest)` (:38) FIRST — so a run reverts the premium fix (Task 3 keeps it) AND permanently deletes `src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts` (only `goldenMaster.json` is re-copied). All 22 engine files carry a 2-line banner declaring `ias-dashboard` canonical and telling operators to "re-sync" — now false and dangerous. The banner is byte-identical across the 22 files. A byte-identical copy of the sync script also lives on `main` (`C:/Users/oclou/QueenClaude/ias-website/scripts/sync-rate-engine.mjs`, sha256 `fdd6be69…`) — do NOT touch it (Zach-gated; propagating to main is a separate push). **Keep the new banner exactly 2 lines** so line numbers below do not shift (protects other plans' line cites). NO em-dashes in the new text.

- [ ] **Step 1: Neuter the sync script** (Edit `scripts/sync-rate-engine.mjs`)

Replace the ENTIRE file contents with a refusing stub (delete the destructive body; keep the file so its history and the deprecation reason are discoverable):

```javascript
// RETIRED 2026-07-06 (rate-sim Plan 1D). This script used to vendor the ias-dashboard
// engine over src/lib/rate-engine/, rmSync-ing the live dir FIRST. That direction is now
// WRONG: the live ias-website copy is CANONICAL. Running it would (1) revert the live-only
// premium-erasure fix (marketRates.ts:538-540 -> legacy Math.max) and (2) permanently delete
// src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts. The parity gate imports only the
// Phase-1 barrel (excludes marketRates.ts) so it would NOT catch either regression.
//
// The engine is now edited in place; behavioral parity vs the frozen golden master is gated by
// src/lib/hub/rate-engine-parity.test.ts. If you truly need to re-vendor FROM the dead twin,
// resurrect this from git history deliberately and know it reverts the premium fix.
console.error(
  '✗ sync-rate-engine.mjs is RETIRED. The live src/lib/rate-engine copy is canonical; ' +
  'a sync would revert the premium-erasure fix and delete the overlay guard test. Aborting.',
);
process.exit(1);
```

- [ ] **Step 2: Confirm the neutered script refuses to run and changes nothing**

Run: `node scripts/sync-rate-engine.mjs; echo "exit=$?"`
Expected: prints the RETIRED message and `exit=1` (non-zero). Then `git status --short src/lib/rate-engine` shows NO changes to the engine dir (nothing was overwritten/deleted).

- [ ] **Step 3: Rewrite the false banner across all 22 engine files** (throwaway script in scratchpad — replaces line-texts only, so CRLF is preserved and line count is unchanged)

Write and run:
```bash
node - <<'EOF'
const fs = require('node:fs');
const dir = 'src/lib/rate-engine';
const OLD1 = '// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.';
const OLD2 = '// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.';
const NEW1 = '// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.';
const NEW2 = '// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.';
let changed = 0;
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
  const p = dir + '/' + f;
  const before = fs.readFileSync(p, 'utf8');
  if (!before.includes(OLD1)) { console.log('skip (no banner):', f); continue; }
  const after = before.replace(OLD1, NEW1).replace(OLD2, NEW2);
  fs.writeFileSync(p, after);
  changed++;
}
console.log('rewrote banner in', changed, 'files');
EOF
```
Expected: `rewrote banner in 22 files` (no skips). If any file skips, investigate before continuing.

- [ ] **Step 4: Reword the parity-gate header** (Edit `src/lib/hub/rate-engine-parity.test.ts`, lines 1-5 — keep exactly 5 lines, no em-dashes)

Replace:
```typescript
// ⭐ THE PARITY GATE — proves the hub's vendored @ias/rate-engine reproduces the
// canonical engine BYTE-FOR-BYTE. The golden-master corpus is generated by the
// canonical repo (ias-dashboard); this recomputes every case through the hub's
// vendored copy and asserts deep equality. If this fails, the vendored copy has
// drifted from canonical — STOP and re-sync / debug; never weaken the assertion.
```
with:
```typescript
// ⭐ THE PARITY GATE: proves the canonical LIVE engine still reproduces the FROZEN
// golden-master corpus (the behavioral contract / math truth). The corpus was
// generated from the engine's frozen baseline; this recomputes every case through
// the live copy and asserts deep equality. If this fails, engine BEHAVIOR changed;
// STOP and investigate the diff (do NOT re-vendor from the dead twin), never weaken it.
```

- [ ] **Step 5: Run the affected suites + the full test run to confirm nothing broke**

Run: `npx vitest run src/lib/rate-engine src/lib/hub/rate-engine-parity.test.ts && npm test`
Expected: parity gate + overlay guard GREEN (comment/banner edits are behaviorally inert); full suite still green. Also `git diff --stat src/lib/rate-engine/*.ts` should show each of the 22 files with 2 lines changed (banner only), confirming no accidental body edits.

- [ ] **Step 6: Codex review + commit**

Codex-review (confirm: sync truly refuses, banners are truthful + line-count-preserving, no body lines changed, parity header no longer says "re-sync"). Then stage the EXACT files (22 engine files + the script + the parity test):
```bash
cd "c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan"
git status --short
git add scripts/sync-rate-engine.mjs src/lib/hub/rate-engine-parity.test.ts $(git ls-files 'src/lib/rate-engine/*.ts')
git status --short   # re-confirm ONLY the intended files are staged (no pipeline-*, no WIP)
git commit -m "refactor(rate-engine): retire the backwards sync + declare the live copy canonical

Neuters scripts/sync-rate-engine.mjs (it rmSync-wiped src/lib/rate-engine and
repopulated from the dead ias-dashboard twin, reverting the premium-erasure fix
and deleting the overlay guard test; the parity gate excludes marketRates.ts so it
never caught this). Rewrites the false 'VENDORED / canonical: ias-dashboard /
re-sync' banner across all 22 engine files (line-count-preserving) and the parity
header to state the live copy is canonical and drift means a real behavior change
to investigate. No engine bodies change; golden master + overlay guard stay green.
The byte-identical main-branch script copy is Zach-gated and untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Acceptance:** the sync script can no longer overwrite the live engine (refuses, exit 1); all 22 banners + the parity header tell the truth (live is canonical); parity + overlay guard stay green; no engine body changed; bridge-repoint remains tracked for Plan 3. Delete the throwaway scratchpad script (it is not committed).

---

## Task 5: Percentile-honesty relabel (item 1A) — SHOW-BEFORE

**Files:**
- Modify: `src/lib/hub/sim-render.ts:58,67` (chip + legend display strings)
- Modify (test): `src/lib/hub/sim-render.test.ts:24` (the "market median" assertion)

**Why / verified state:** Every displayed "percentile" is a linear interpolation of the researched band (`sim-adapter.ts:372` `adjustedMin + (adjustedMax-adjustedMin)*(p/100)`), NOT a percentile of an observed distribution. Labeling the chips `pXX:` and the marker "Recommended (market median)" is dishonest (Master §5.1, BACKLOG 24 R1). The relabel is DISPLAY-ONLY: it stays entirely in `sim-render.ts` (NOT vendored, safe to edit) and changes ZERO math and ZERO numbers — the `percentiles` DATA array (`{p, value}` with p=25/50/70/75/90) is untouched, so the data-shape test at `sim-render.test.ts:26-30` still passes. **HARD BOUNDARY:** do not touch `sim-adapter.ts` (`WF_PERCENTILES`, the map), `spec.p70`, or any vendored file. The dead `getPercentileRate` rename is explicitly OUT of scope (it is vendored + parity-gated; renaming needs an upstream change and has zero display effect).

**DECISION FOR ZACH (this is the SHOW-BEFORE item — the one user-visible change).** Proposed honest copy, ZERO math change:
1. Chip `p${p.p}: ${usd(p.value)}` → `${p.p}% of range: ${usd(p.value)}` — literally true (it IS the value that % of the way up the researched band), and drops the false "pXX percentile" notation.
2. Legend `Recommended (market median) ${usd(q.marketMarker)}` → `Recommended ${usd(q.marketMarker)}` — drops the false "market median" claim (it is the recommended/anchor rate, not an observed median).
3. Keep `Premium tier ${usd(p90)}` unchanged — a qualitative band label, not a false percentile/median claim.

Alternatives Zach may prefer (pick at show-before): chips as a qualitative ladder ("Low / Mid / Rec / High / Top"); or "Recommended (anchor)" per Master §5.1 instead of bare "Recommended"; or keep the chips and add a one-line honesty caption. Real observed percentiles come later (Plan 4 `RateDistribution`). **Nothing deploys** — this lands on the feature branch and is shown to Zach; the relabel does not ship to prod without a separate deploy-go.

- [ ] **Step 1: Update the failing test to assert honesty** (Edit `src/lib/hub/sim-render.test.ts`)

Replace line 24:
```typescript
    expect(html).toContain('Recommended (market median)');
```
with:
```typescript
    expect(html).toContain('Recommended');
    expect(html).not.toContain('market median'); // honesty: it is an anchor, not an observed median
    expect(html).not.toMatch(/\bp(25|50|70|75|90):/); // honesty: no fabricated-percentile chip notation
    expect(html).toContain('% of range'); // chips honestly describe band position, not observed percentiles
```
(Leave line 23 `expect(html).toContain('Premium tier');` unchanged.)

- [ ] **Step 2: Run the test to verify it fails** (old strings still present)

Run: `npx vitest run src/lib/hub/sim-render.test.ts -t "renders the recommended"`
Expected: FAIL — `not.toContain('market median')` fails (the old legend still says "market median"), and `% of range` is absent.

- [ ] **Step 3: Relabel the chip** (Edit `src/lib/hub/sim-render.ts`, line 58)

Replace:
```typescript
    `<span class="sim-mkt__chip${p.p === 70 ? ' is-p70' : ''}">p${p.p}: ${usd(p.value)}</span>`,
```
with:
```typescript
    `<span class="sim-mkt__chip${p.p === 70 ? ' is-p70' : ''}">${p.p}% of range: ${usd(p.value)}</span>`,
```
(The `is-p70` CSS class is internal, not user-visible — leave it so styling stays intact.)

- [ ] **Step 4: Relabel the legend** (Edit `src/lib/hub/sim-render.ts`, line 67)

Replace:
```typescript
      <span class="sim-mkt__leg"><i class="sim-mkt__key sim-mkt__key--rec"></i>Recommended (market median) ${usd(q.marketMarker)}</span>
```
with:
```typescript
      <span class="sim-mkt__leg"><i class="sim-mkt__key sim-mkt__key--rec"></i>Recommended ${usd(q.marketMarker)}</span>
```

- [ ] **Step 5: Run the test + full suite to confirm green and no number moved**

Run: `npx vitest run src/lib/hub/sim-render.test.ts && npm test`
Expected: the relabel test PASSES (honesty assertions hold, data-shape test at 26-30 still green); full suite green. No quote number changed (only display strings).

- [ ] **Step 6: Show Zach the before/after, Codex review, then commit** (feature branch, NO deploy)

Render/screenshot the market-position panel before/after (or paste the exact before/after strings) so Zach sees the copy. Codex-review the diff. On Zach's OK of the wording:
```bash
cd "c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan"
git status --short
git add src/lib/hub/sim-render.ts src/lib/hub/sim-render.test.ts
git commit -m "fix(rate-sim): stop labeling interpolations as percentiles (honesty relabel)

The market-position chips and 'Recommended (market median)' legend implied
observed percentiles, but every value is a linear interpolation of the researched
band (sim-adapter.ts:372). Relabel chips 'pXX:' -> 'XX% of range:' and drop the
false 'market median' claim. Display-only: zero math change, zero quote-number
change, percentiles data array untouched. Real observed distributions come in Plan
4. Feature branch only, no deploy (shown to Zach for copy sign-off).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Append the win to WEEKLY-SYNC-WINS.md**

Add a dated section at the TOP (under the intro, above the most recent entry) of `docs/rate-simulator/deep-dive/WEEKLY-SYNC-WINS.md`, plain-English, no em-dashes, no code names, e.g.: "We made the market-position readout honest: the figures a recruiter sees are now labeled as positions in our researched rate range, not as real market percentiles, because that is what they are today. True market percentiles are the next build." Commit it with `git add docs/rate-simulator/deep-dive/WEEKLY-SYNC-WINS.md`.

**Acceptance:** the market panel no longer claims "percentile"/"market median" for an interpolation; the two `sim-render.test.ts` legend assertions updated + honesty assertions added; golden master byte-identical (no number moved); Zach has seen the copy; nothing deployed.

---

## Operator handoff (Zach-only, do NOT do autonomously)

After Task 1 lands, one operator step is unblocked (full detail in `docs/superpowers/plans/2026-07-03-rate-sim-OPERATOR-RUNBOOK.md`):
- **OP-2:** deploy the feedback-node lock. `cd ias-dashboard && firebase deploy --only database` (project `weekly-sync-451e2`). Deploy from `ias-dashboard` ONLY (the stale `weekly-sync/database.rules.json` would re-open the world-write + drop the v2/cap-rates locks — last-deploy-wins). Verify an unauthenticated write to `rate-simulator/feedback` is now denied and `market-rates-v2` is still readable + `.write:false`.

Not touched by Plan 1, still Zach-only: OP-1 (migration `20260701000000`, Plan 3 prereq), OP-3 (rotate the two write secrets), OP-4 (any prod deploy). The build-red `pipeline.test.ts` (see §0) is the concurrent hub-pipeline session's to relocate.

---

## Self-Review

**1. Spec coverage** (KICKOFF §3 items → tasks):
- 1A percentile relabel → Task 5 ✅ (display-only, sim-render.ts + test, SHOW-BEFORE)
- 1B CI gate + golden-master pin (207) → Task 2 ✅ (ci.yml + parity test)
- 1C lock feedback node → Task 1 ✅ (ias-dashboard rules, Zach deploys)
- 1D portability Step 0 → Task 3 (back-port deltas) + Task 4 (neuter sync + banners) ✅
- Operator OP-2 → handoff section ✅
- WEEKLY-SYNC-WINS append → Task 5 Step 7 ✅

**2. Placeholder scan:** every code step shows the exact before/after or full file body; every command has expected output. No "TBD"/"add error handling"/"similar to Task N". The only intentionally deferred decision is the exact 1A copy wording, which is correctly a SHOW-BEFORE checkpoint, not a code placeholder (concrete proposed strings are given).

**3. Type/name consistency:** `sourceFamily(source: string): string` used in Task 3 matches the verified export; `BUCKET_PRECEDENCE`, `KNOWN_FAMILY_OVERRIDES`, `WF_PERCENTILES`, `marketMarker`, `is-p70` all verified against current code. Golden-master count `207` consistent across Task 2. Parity-test path `src/lib/hub/rate-engine-parity.test.ts` corrected consistently in Tasks 2 + 4.

**4. Guarantees:** no task moves a quote number (Tasks 1/2/4 are config/infra/comments; Task 3 is additive+inert; Task 5 is display strings). Every commit stages EXACT files (explicit `git add`, `git status --short` re-check). Every code task has a Codex review step. Vendored/parity boundaries respected (Task 5 stays in sim-render.ts; Task 3's files are outside the parity closure; Task 4's edits are behaviorally inert).
