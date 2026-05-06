# Codex r3 review — Plan v1 (post-r2 fold) — 2026-05-06

Task ID: `task-mouctmm1-pdgc3d`
Output: agent_message in rollout `2026-05-06T13-51-52-019dfe6a-e6ed-7863-b70a-f46c951ac134.jsonl`

## Summary
- VERIFIED-CLEAN (r2 folds confirmed correct): all 10 folds — F3 (PA5 1-miss retain), F4 partial (hash-diff core), F5 (Turnstile per-widget), F6 (T17 icon-cap), F9 (matrix sync), F12 (File Structure), F14 (T34/T48 gate), F15 (T17/T18 refs), F13 (T34 rename), F16 (placeholder tags). ✅
- VERIFIED-CLEAN (drift scan): D1 (PA5 old shape) ✅, D2 (test counts) ✅, D3 (wave plan completeness) ✅, D4 (T20-batch collision) ✅, D5 (T48/49/50 wave placement) ✅, D6 (oneMissPayloadById types) ✅, D7 (putIfChanged digest runtime) ✅
- NEW AMBER: 2
- NEW NO-GO: 0
- NEW NIT: 0
- Verdict: **NO-GO** (2 AMBER, both consistency drifts I introduced in r2 fold)

---

## Finding R3-A1 — AMBER: PA5 write-budget numbers inconsistent
**Location:** Line 4010 (tests), 4232 (PA5 math), 4238 (Codex prompt), 4671 (Risk Register)
**Issue:**
- Tests at 4010 say "200-listing fixture → first-cycle writes ≤ 240"
- PA5 worst-case math at 4232 says "150-listing cold start = 188"
- Codex prompt at 4238 says "200-listing cold start ≤ 188"
- Risk Register at 4671 says "200-listing cold start ≤ 188"
**Math reconciliation:**
- 150-listing fixture: 150 (byid) + 1 (index) + ~6 (specialty) + ~30 (state) + 1 (meta) = **188 writes** one-time
- 200-listing fixture: 200 (byid) + 1 (index) + ~6 (specialty) + ~30 (state) + 1 (meta) = **238 writes** one-time
**Fix:** Pick ONE fixture size and align all four locations. Use 200-listing/≤240 (matches tests as written) since tests are the contract.

## Finding R3-D8 — AMBER: Execution Handoff recommendation contradicts wave plan
**Location:** Line 4688 (recommendation) vs Lines 4691-4701 (wave plan)
**Issue:** Recommendation reads "Subagent-Driven for T1–T33, T52–T65" + "Inline Execution for T35–T51". Wave plan places T48 in Wave 6 (subagent-driven), T49/T50/T51 in Wave 7 (subagent-driven). The "Inline T35–T51" range contradicts that.
**Fix:** Change recommendation to "Inline Execution for T35–T47" (the actual server-libs/api-routes dependency chain) + "Subagent-Driven for T1–T34, T48–T65" (forms infra T48-T51 are independent components, not dep-chain).
