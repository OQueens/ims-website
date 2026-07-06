# Rate Simulator Execution — KICKOFF / Handoff (2026-07-03)

> **You are a fresh session picking up the rate-simulator improvement program.** This file is your
> lossless handoff. Read it top to bottom, then read the deep-dive deliverables it points to, then
> follow the Execution Protocol. Nothing that was decided in prior sessions is allowed to be
> forgotten; if you are tempted to skip a guardrail below, don't.
>
> **North star (Zach, verbatim intent):** recruiters price real placements off this simulator. It
> must be unbelievably accurate for EVERY locum specialty, for the rate we would actually pay the
> physician, AND for where that rate sits in the market (percentile). Coverage gaps, missing comp
> factors, and unquantified uncertainty are DEFECTS. Cut no corners. Leave no stone unturned.

---

## 0. First actions (do these before anything else)

1. **Invoke `superpowers:using-superpowers`**, then **`superpowers:writing-plans`** (you will author
   the Plan 1 task list) and, at execution time, **`superpowers:subagent-driven-development`**.
2. **Read the deep-dive deliverables** (they are the source of truth for WHAT and WHY):
   - `docs/rate-simulator/deep-dive/00-MASTER-REPORT.md` (10 sections + Top-10-Moves table + fact-check appendix)
   - `docs/rate-simulator/deep-dive/BACKLOG.md` (100+ scored items, 7 tiers; Plan 1 items map to Tier 1)
   - `docs/rate-simulator/deep-dive/WEEKLY-SYNC-WINS.md` (Zach's plain-English brag log — APPEND to it as you ship, newest on top, no em-dashes, no code names)
   - The relevant `maps/01-06` and `briefs/10-26` for whichever item you are implementing.
3. **Read the verification results** from the pre-run ground-truth pass (read-only, 5 agents):
   run id `wf_9b90e442-cad`. Its per-agent results are in
   `.../subagents/workflows/wf_9b90e442-cad/journal.jsonl` (grep for `"type":"result"`). These
   confirm current file:lines for the Plan 1 surfaces. If that journal is unavailable or you want to
   be certain, RE-VERIFY every file:line yourself before writing a task that cites it. The deep-dive
   briefs are dated ~2026-07-03/05 and their line numbers may have drifted.
4. **Confirm repo state:** branch `redesign/v5-reskin`, worktree
   `c:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan`. HEAD was `0c62d57` at
   handoff. Run `npm run build` (PASSES at handoff) and `npm test` (`vitest run`).
   **STATUS UPDATE (2026-07-06, reconciled):** the `src/lib/hub/sync-merge.test.ts` clock-skew flake
   that earlier blocked 1B was ROOT-CAUSED + FIXED by the Weekly Sync workstream (`comparableCol` no
   longer keys on the client-stamped `editedAt`). VERIFIED in this worktree: `sync-merge.test.ts`
   passes 6/6 and `comparableCol` dropped `editedAt`. **BUT the fix is UNCOMMITTED** (` M` on
   `sync-merge.ts` + `.test.ts`, owned by the Weekly Sync / hub-pipeline workstream). So: with the
   current working tree, `npm test` should be green; on a CLEAN checkout WITHOUT those two modified
   files, the flake returns. Confirm those changes are present (or committed) before you rely on a
   green baseline for task 1B (§7.B). Capture your actual pass/fail counts as YOUR baseline; do not
   attribute anything to your own work.

---

## 1. Non-negotiable guardrails (from durable memory + CLAUDE.md)

- **NO DEPLOY.** `redesign/v5-reskin` is a feature branch (no auto-deploy). Prod deploys only from
  `origin/main` in the `ias-website` repo. "Do whatever / do what's best" is NOT deploy
  authorization. Zach must give an explicit, separate deploy-go. SHOW-BEFORE-DEPLOY on anything
  user-visible.
- **NEVER fabricate a $ figure.** Every rate/number is either read-from-code (file:line) or cited to
  a real named external source, else it is flagged UNVERIFIED. This is the whole point of the tool.
- **Do NOT change any quote NUMBER without SHOW-BEFORE + golden-master parity + Zach sign-off.**
  Plan 1 is deliberately scoped to changes that do NOT move a single quote number (see §3). Number
  changes (IronDome ceilings, curated band re-audit) are a LATER, separately-approved batch.
- **`git add <exact file paths>` ONLY. NEVER `git add -A` / `git add .`.** This worktree has ~100
  untracked WIP files from other workstreams (brand-guidelines, linkedin PNGs, welcome-post,
  pipeline-ops, etc.). A blanket add would commit unrelated work. Stage only the files your task
  created or modified.
- **Codex peer-review loop is mandatory** for every non-trivial code change: write it, hand to Codex
  (`/codex:rescue` or the codex bash runtime), fix what it flags, loop until it has nothing to add,
  THEN claim done. If you skip it, say so with `[codex-skip:reason]`.
- **Verification before completion:** tag any done/fixed/works/passing claim with `[runtime-verified]`
  / `[logically-inspected]` / `[syntax-checked]` and actually run the command. No bare "done."
- **Review gate:** after a task's changes, run the reviewer (code-reviewer agent or `/codex:rescue`)
  and stamp `bash ~/.claude/hooks/review-gate.sh --stamp`. Ignore the gate's noise about the ~100
  pre-existing unrelated WIP files; review only YOUR diff.
- **Operator-only steps are Zach's, not yours** (see §4). Do not run prod DB migrations, rotate
  secrets, or deploy Firebase rules. Stage the file change and hand the deploy to Zach.
- **Copy/voice:** NO em-dashes anywhere (AI tell). Pay cadence is weekly. Never publicly state
  founders are physicians. Do not touch testimonials/palette.

---

## 2. Priority order (the whole program, so you never lose the thread)

This follows the master report's own expert sequencing (§10 "Sequencing note"). Do NOT jump ahead to
the flashy keystone before the safety net is in.

1. **PLAN 1 — the safe, local, no-quote-change batch (THIS handoff, do first).** Honesty + CI safety
   + landmine defusal. Autonomous on the feature branch, show-before on the one user-visible copy
   change. Details in §3.
2. **PLAN 2 — the show-before accuracy batch.** Kill the silent internal-medicine default (`BACKLOG`
   Tier 1, `22 R2`); IronDome ingestion-ceiling fixes + cited curated-band re-audit (Move 8,
   `20 R1/R2/R4`); expose facility/call/holiday controls in the hub (Move 9, `26 R5`); the
   promotion-drop / 7-day-cliff alert (Move 10, bridge-side). These MOVE NUMBERS or user-visible
   behavior, so each needs cited sourcing + show-before + golden-master. Separate plan, separate
   approval.
3. **PLAN 3 — the keystone: producer to engine specialty mapping layer (152 to 88)** (Move 1,
   `22 R1`). Unlocks live corroboration for 7 of the top-15 cells with zero new scrapes. Cross-repo
   (bridge lives in `ias-dashboard/scripts/data-refresh`). **Hard prereq that is Zach-only:** apply
   migration `20260701000000` to prod first (one bad row 23514s the whole batch). Do not start Plan
   3 code until Zach confirms the migration is applied.
4. **PLAN 4+ — live-data features** now unblocked by the mapping layer: wire the outcome + feedback
   calibration loop (Move 2), the `RateDistribution` percentile layer (Move 3 distribution tier),
   market-timing history + geo tiers (Move 10). Pull these from `BACKLOG.md` in impact order.

The full, scored, deduped backlog is `docs/rate-simulator/deep-dive/BACKLOG.md`. Treat it as the
master task registry; every plan draws from it and cites the item ids (e.g. `24 R1`).

---

## 3. PLAN 1 — scope you will turn into a TDD task list

Four items. All in the `ias-website` worktree. None changes a quote number. Author each as
bite-sized TDD tasks per the writing-plans skill, verifying current file:lines first.

### 1A. Percentile honesty relabel (Master §5.1 Phase-0; Move 3; `BACKLOG 24 R1`)
- **Problem:** every displayed "percentile" is a linear interpolation between two band endpoints,
  not a percentile of any observed distribution. Labeling it a percentile is dishonest.
- **Change (ZERO math). VERIFIED targets (run wf_9b90e442-cad, see §7.A):** the displayed
  "percentiles" are built inline at `src/lib/hub/sim-adapter.ts:372` (labels from `WF_PERCENTILES`
  at `:254`) and rendered ONLY in `src/lib/hub/sim-render.ts` — the two user-facing strings are
  `:67` "Recommended (market median)" and `:68` "Premium tier", plus the `pXX` chips at `:57-58`.
  Relabel these strings (the honest fix: stop implying observed percentiles) and update the two
  tests that assert them (`sim-render.test.ts:23-24`). **CORRECTION to the brief:**
  `getPercentileRate` (`rateCalculator.ts:50`) is DEAD exported API with zero call sites — it does
  NOT produce the on-screen numbers; renaming it to `bandInterpolate` is optional and touches only
  its def + the `index.ts:16` re-export, with no runtime/test effect.
- **HARD SCOPE BOUNDARY:** the internal `spec.p70` band field (`specialties.ts:179`,
  `rateCalculator.ts:658` `base = f.baseRate || spec.p70`) is the quote BASE and is asserted by ~50
  tests. A relabel MUST NOT rename or touch it. Restrict edits to `sim-render.ts` strings +
  `WF_PERCENTILES` naming + the `SimQuote.percentiles` display array.
- **Acceptance:** golden master byte-identical (no number moves); user-facing copy no longer claims
  "percentile"/"market median" for what is an interpolation; the two `sim-render.test.ts` assertions
  updated. User-visible copy -> SHOW-BEFORE (no deploy).

### 1B. Make the test arsenal a real CI gate + pin the golden-master count (Master §3.4/§10 Move 4; `BACKLOG 14 R1, 17 R2`)
- **Problem:** the 207-case golden master + ~44 test files never gate a deploy; `ci.yml` runs
  `build` + `verify` only; a red parity gate ships anyway.
- **Change. VERIFIED (§7.B):** `.github/workflows/ci.yml` currently runs `npm ci` -> `npm run build`
  -> `npm run verify` and NO tests (`verify` = verify-build.mjs + voice-lint.mjs, no vitest). Add a
  `- run: npm test` step (recommended between `npm ci` and `npm run build` for fail-fast). Add an
  exact-count pin — the true current N is **207** (goldenMaster.json `count` field AND
  `cases.length` both = 207; memory's "208" is STALE). Today the only size assertion is a FLOOR
  `expect(corpus.length).toBeGreaterThanOrEqual(150)` at `rate-engine-parity.test.ts:50`; add
  `expect(gm.count).toBe(207)` / `expect(corpus.length).toBe(207)`.
- **Former blocker, now largely resolved (§0.4):** the `sync-merge.test.ts` clock-skew flake that
  would have red-walled a required `npm test` gate was FIXED by the Weekly Sync workstream and passes
  6/6 in this worktree — but the fix is UNCOMMITTED and owned by that workstream. Before adding a
  REQUIRED gate: (a) confirm the fix is committed on `redesign/v5-reskin` (coordinate with that
  workstream; if still uncommitted, CI on a clean checkout would fail), and (b) run `npm test`
  yourself to confirm a green baseline. Do NOT delete or re-scope that test yourself.
- **Acceptance:** CI fails on a real test regression or golden-master count drift; you have confirmed
  a green baseline (with the sync-merge fix present/committed) before making the gate required. Pure
  infra, no quote impact.

### 1C. Lock the world-writable feedback RTDB node (Master §2.5/§10 Move 5; `BACKLOG 13 R2`)
- **Problem:** `rate-simulator/feedback` is `.write:true` (world-writable) with 2-field validation.
  This must be locked BEFORE any calibration loop (Plan 4) consumes it, or it is a poisoning vector.
- **Change. VERIFIED (§7.C):** the authoritative file is
  `C:/Users/oclou/QueenClaude/ias-dashboard/database.rules.json` (it carries the live rate-sim tree:
  `market-rates-v2` + `cap-rates`, both correctly `.write:false`). The `rate-simulator/feedback` node
  at **lines 26-34** is `.read:true, .write:true` (world-writable) with only a per-`$entryId`
  `.validate` requiring `specialty` + `timestamp` children. Replace `.write:true` with an
  authenticated write (`"auth != null"`) and/or a stricter server-timestamp + rate-plausibility
  `.validate`. **EDIT THE FILE LOCALLY ONLY.** Deploying rules (`firebase deploy --only database`) is
  Zach-only (§4); first confirm the deploy target project (memory says the hub's Firebase is
  `weekly-sync-451e2`; confirm via `ias-dashboard/.firebaserc`).
- **GOTCHA:** there is a STALE duplicate `C:/Users/oclou/QueenClaude/weekly-sync/database.rules.json`
  whose `rate-simulator` block is out of date (it has `market-rates` as `.write:true` and lacks
  `market-rates-v2`/`cap-rates`). Do NOT edit that one for the live tree; flag it for cleanup.
- **Acceptance:** the feedback node in `ias-dashboard/database.rules.json` is no longer
  world-writable; a short deploy checklist is left for Zach. Do not deploy. Quote data
  (`market-rates-v2`) is already `.write:false` — confirm you did not loosen it.
- **Related but OPERATOR-ONLY (do NOT do, list for Zach):** rotate + vault the two write credentials
  (firebase-admin service account + `SUPABASE_SERVICE_ROLE_KEY`) — `BACKLOG 13 R1`.

### 1D. Portability Step 0 — defuse the sync landmine (Master §7 Step 0; Move 6; `BACKLOG 15 R1`)
- **Problem:** the "dead" `ias-dashboard/src/features/rate-simulator/engine/` copy is still a live
  dependency of the bridge, and `sync-rate-engine.mjs` syncs in a direction that would silently
  REVERT the premium-erasure fix (commit `6d9edb1`) already in the live `ias-website` copy. Standing
  landmine independent of any feature.
- **Change. VERIFIED (§7.D):** the sync direction is legacy->live and destructive (`rmSync(dest)`
  first), so a run overwrites the live engine and reverts the `6d9edb1` premium fix silently (the
  parity gate excludes `marketRates.ts`). **Only 2 of 22 files truly diverge**, so the back-port is
  small and MANUAL (do NOT copy from legacy — legacy still has the buggy `Math.max(range.max,anchor)`
  line): (1) add the `aggregator_estimate: 0` rung to `BUCKET_PRECEDENCE` in live
  `src/lib/rate-engine/marketRates.ts:119-124`; (2) add the 7 WS1 family mappings to live
  `src/lib/rate-engine/sourceFamily.ts` after `aya_healthcare: 'aya',` (`:95`). Then tombstone
  `scripts/sync-rate-engine.mjs` (neuter: print deprecation + exit non-zero, or delete with a note),
  strip/rewrite the false "VENDORED — canonical: ias-dashboard" banner across all 22
  `src/lib/rate-engine/*.ts`, and reword the parity-gate header (`rate-engine-parity.test.ts:1-5`)
  that still names ias-dashboard canonical.
- **GOTCHAS:** (i) there are TWO byte-identical copies of the sync script — the worktree one AND
  `C:/Users/oclou/QueenClaude/ias-website/scripts/sync-rate-engine.mjs` on branch `main`; neutering
  only the worktree copy leaves the main one runnable (propagating to main is a Zach-gated push).
  (ii) The sync's `rmSync` also DELETES `src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts`
  (the only guard test for the premium fix) — another reason to kill it. (iii) Files are CRLF on
  disk; preserve CRLF on edits or you create whole-file diffs.
- **Acceptance:** the live copy holds the WS1 deltas AND keeps the premium fix; the sync script can
  no longer overwrite the live engine; `npx vitest run src/lib/rate-engine` (the overlay guard test)
  + the parity suite stay green; the bridge-repoint is noted as tracked for Plan 3.
- **SEQUENCING NOTE:** do 1D BEFORE Plan 2's band/IronDome edits. The engine `.ts` files are vendored
  and parity-gated today; once 1D declares the live copy canonical, Plan 2 edits `specialties.ts` /
  `blsSanityCheck.ts` directly instead of "edit canonical in ias-dashboard then re-sync."

**Plan 1 self-check before execution:** does every task cite a CURRENT verified file:line? Does any
task change a quote number? (It must not — if it does, it belongs in Plan 2.) Is every commit staging
exact files only?

---

## 4. Operator-only items (Zach's, never do these autonomously)
**Turnkey runbook for ALL of these:** `docs/superpowers/plans/2026-07-03-rate-sim-OPERATOR-RUNBOOK.md`
(exact files, commands, verify + rollback for each — grounded in the real migration SQL + `.firebaserc`).
- Apply prod DB migration `20260701000000` (Plan 3 hard prereq) — runbook OP-1.
- Deploy the Firebase RTDB rules lock (you edit the file in Plan 1C; Zach deploys) — runbook OP-2.
  Note the two-rules-files-one-project hazard called out there.
- Rotate/vault the two write secrets (firebase-admin SA, `SUPABASE_SERVICE_ROLE_KEY`) — runbook OP-3.
- Any `origin/main` push / prod deploy (show-before + explicit go) — runbook OP-4. Any live
  fleet/bridge run (EC2/firebase-admin creds).

---

## 5. Execution protocol (subagent-driven-development)
1. Author Plan 1 as `docs/superpowers/plans/2026-07-03-rate-sim-plan1-safe-batch.md` using
   writing-plans (bite-sized TDD tasks, exact files, exact commands, full code in each step).
2. Show the plan to Zach for a quick look (self-review first per the skill).
3. Execute task-by-task: fresh subagent per task, write failing test -> implement -> green ->
   Codex review -> fix loop -> review-gate stamp -> atomic commit staging EXACT files.
4. After each task: update `.superpowers/sdd/progress.md` (or the equivalent ledger) and, when a
   user-meaningful win lands, append a plain-English line to `WEEKLY-SYNC-WINS.md`.
5. When Plan 1 is fully green + reviewed, report to Zach and ask whether to proceed to Plan 2
   (which needs show-before because it moves numbers).

---

## 6. Pointers
- Deep-dive root: `docs/rate-simulator/deep-dive/` (00-MASTER-REPORT.md, BACKLOG.md, maps/, briefs/,
  research-prompts/, WEEKLY-SYNC-WINS.md).
- Operator runbook (Zach-only steps, turnkey): `docs/superpowers/plans/2026-07-03-rate-sim-OPERATOR-RUNBOOK.md`.
- Verification run: `wf_9b90e442-cad` (COMPLETE) — distilled into §7 above; raw per-agent results in
  its `journal.jsonl` if you want the long form.
- Memory index: the project MEMORY.md "START HERE" entry for the deep-dive points here.
- Topology reminder: ONE live engine = `ias-website` (`src/lib/rate-engine/` + `src/lib/hub/`) serving
  imstaffing.ai/hub; the `ias-dashboard` app is dead but its bridge + the `agent-sdk` scraper are the
  still-live data pipeline. Do not treat the dead app copy as a second live engine.

---

## 7. VERIFIED GROUND TRUTH (read-only pass `wf_9b90e442-cad`, 2026-07-03)

Confirmed against current on-disk code. Where this contradicts the 3-day-old deep-dive briefs, THIS
wins. (One of the 5 verification agents mis-fired and returned a junk "probe" stub for the feedback
target; §7.C was re-verified by hand instead and is solid.)

**§7.A — Percentile relabel (task 1A):**
- Displayed percentiles: `sim-adapter.ts:254` `const WF_PERCENTILES = [25, 50, 70, 75, 90];`;
  `sim-adapter.ts:372` `WF_PERCENTILES.map((p) => ({ p, value: Math.round(adjustedMin + (adjustedMax - adjustedMin) * (p / 100)) }))`; field decl `:238`; call-only emits `percentiles: []` at `:338`.
- User-facing strings ONLY in `sim-render.ts`: `:67` `Recommended (market median) ${usd(q.marketMarker)}`, `:68` `Premium tier ${usd(p90)}`, `:57-58` chips `p${p.p}: ${usd(p.value)}` (p70 chip highlighted via `.is-p70`). `SimulatorView.astro:166` just does `set:html={marketHTML(q0)}` — no strings of its own.
- Tests to update: `sim-render.test.ts:23-24` (assert the two legend strings). `getPercentileRate` is dead (no call sites). Internal `spec.p70` (`specialties.ts:179`, quote base) is OFF-LIMITS.

**§7.B — CI + golden master (task 1B):**
- `ci.yml` (whole file, 20 lines): `npm ci` -> `npm run build` -> `npm run verify`. NO test step.
- `npm test` = `vitest run` (package.json:15). Golden master = `src/lib/rate-engine/__tests__/goldenMaster.json`, `count: 207` and `cases.length` = 207 (memory "208" STALE). Only size check today is `>=150` floor at `rate-engine-parity.test.ts:50`.
- Baseline flake `src/lib/hub/sync-merge.test.ts` (clock-skew) was FIXED by the Weekly Sync workstream (2026-07-06): `comparableCol` dropped `editedAt`; test passes 6/6 in this worktree. Fix is UNCOMMITTED (` M` on `sync-merge.ts` + `.test.ts`). Confirm it is present/committed before requiring the `npm test` gate.

**§7.C — Feedback RTDB node (task 1C), hand-verified:**
- Authoritative file: `ias-dashboard/database.rules.json`. `rate-simulator/feedback` lines 26-34:
  `".read": true, ".write": true` + `.indexOn` + per-`$entryId` `.validate` (needs `specialty` + `timestamp`). Sibling `market-rates` (35-38), `market-rates-v2` (39-42), `cap-rates` (43-46) are all `.write:false` (quote data already locked — do not loosen).
- Stale duplicate to AVOID: `weekly-sync/database.rules.json` (its `rate-simulator` block lacks v2/cap-rates and has `market-rates` write:true). Flag for cleanup; do not edit for the live tree.
- Deploy = Zach (`firebase deploy --only database`); confirm project via `ias-dashboard/.firebaserc` (memory: hub Firebase = `weekly-sync-451e2`).

**§7.D — Portability Step 0 (task 1D):**
- `scripts/sync-rate-engine.mjs:17-20` src=ias-dashboard legacy engine, dest=`src/lib/rate-engine`; `:38` `rmSync(dest)` then copies (so legacy overwrites live).
- LIVE-only (would be lost): premium fix `marketRates.ts:537-541` (`spec.max = anchor >= range.max && range.p70 > 0 ? Math.round(anchor*(range.max/range.p70)) : range.max`). LEGACY still buggy: `Math.max(range.max, anchor)`.
- LEGACY-only WS1 (back-port BY HAND): `aggregator_estimate: 0` into `BUCKET_PRECEDENCE` (live `marketRates.ts:119-124`); 7 families (trackfive/locumjobsonline/tandym/tandym_health/communitybrands/jama/acr) into live `sourceFamily.ts` after `:95`. Precedence map is named `BUCKET_PRECEDENCE` (not `RATE_TYPE_PRECEDENCE`).
- Two sync-script copies (worktree + `ias-website/scripts/...` on `main`). `rmSync` also deletes `marketBucketsOverlay.test.ts`. All 22 `rate-engine/*.ts` carry the false VENDORED banner. Only `marketRates.ts` + `sourceFamily.ts` have real content divergence; the other 20 differ only by banner + CRLF.

**§7.E — Band/IronDome intel for PLAN 2 (Move 8), captured so it is not re-discovered:**
- `crna` max = 250 is TRIPLICATED and must change in lockstep: `agent-sdk/core/iron_dome.py:24`, `blsSanityCheck.ts:223` (`MAX_HOURLY_CEILING`), `specialties.ts:59` — plus stale $250 comments (`blsSanityCheck.ts:221-222/453/569`, `iron_dome.py:18-21`). `callRates.ts:150` already documents `adjacentHourly {200,325}` for CRNA (corroborates the 325 target).
- `allergy/immunology`: curated `specialties.ts:109` max is ALREADY 215 — so the "200->215" fix is likely IronDome-ONLY (`iron_dome.py:50`), reconciling the plausibility bound with the existing curated ceiling. Verify intent before editing specialties.ts.
- Curated bands have NO stored p70 — it is derived (`specialties.ts:179` `Math.round(min+(max-min)*0.70)`); edit min/max only. `callRates.ts` is a DIFFERENT daily/per-diem structure (not hourly), and endocrinology has no `callRates` entry. Any number change is SHOW-BEFORE + golden-master regenerate. IronDome lives in the separate `agent-sdk` repo (branch `feat/rate-engine-extract-2026-06-22`); identify its Python test runner before editing.
