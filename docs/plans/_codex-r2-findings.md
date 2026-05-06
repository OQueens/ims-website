# Codex r2 review — Plan v1 (post-r1 fold) — 2026-05-06

Task ID: `task-moubza1n-iojruc`
Output: agent_message in rollout `2026-05-06T13-28-15-019dfe55-...jsonl`

## Summary
- VERIFIED-CLEAN (r1 folds confirmed correct): Finding 1 (filtered noindex middleware), Finding 2 (PA10 build-time prerender), Finding 6 (honeypot logging), Finding 7 (sitemap URL contract), Finding 9 (T44 Supabase ping), Finding 10 (TODO removed) — 7 of 10 r1 folds verified.
- NEW NO-GO: 1
- NEW AMBER: 6
- NEW NIT: 2
- Verdict: **NO-GO** — fold 9 findings, re-review.

---

## Finding 3 — NO-GO: PA5 lifecycle index inclusion incomplete
**Location:** PA5 lines 3946-3952 and 4066-4085
**Issue:** PA5 implementation rebuilds `jobs:index` and by-specialty/by-state indexes from `currentListings + stalePayloadById` only, so 1-miss listings disappear from indexes before the required 2-miss `_stale` transition.
**Fix:** Include missCount=1 retained listings in rebuilt indexes WITHOUT `_stale` flag. Add tests asserting `jobs:index`, `jobs:by:specialty:*`, `jobs:by:state:*` retain them.

## Finding 4 — AMBER: PA5 KV write budget worst-case overrun
**Location:** PA5 lines 4073-4085 and Risk Register line 4547
**Issue:** PA5 always rewrites `jobs:index`, all by-specialty keys, all by-state keys, and `jobs:_meta` every hourly cycle. Worst-case state distribution can exceed 1k/day KV write budget despite Risk Register claim of ≤74 baseline + ≤500 burst.
**Fix:** Add hash/diff writes for aggregate indexes (only write when content changed). Update write-budget tests + Risk Register worst-case math.

## Finding 5 — AMBER: Turnstile multi-widget dispatch incorrect
**Location:** T34 lines 2714-2722 and T48 lines 3621-3639
**Issue:** `window.onTurnstileSuccess` loops over every `.cf-turnstile` and writes the same token to every target form rather than dispatching to only the widget/form that completed.
**Fix:** Render per-widget callbacks closing over target form selector, OR identify completing widget in callback. Add 2-widget test/smoke asserting distinct hidden inputs.

## Finding 6 — AMBER: T17 verify-build missing icon-cap check
**Location:** T6 lines 719-730 and T17 lines 1464-1549
**Issue:** T6 plans an icon-cap CI guardrail (`≤8 functional icons`), but the actual T17 `verify-build.mjs` replacement does not include the icon-count check.
**Fix:** Add `src/assets/icons/*.svg ≤ 8` assertion directly into T17 verifier code + Codex prompt.

## Finding 9 — AMBER: Codex matrix vs task body inconsistency
**Location:** Codex matrix lines 52-55, T20 lines 1842-1864, T48 lines 3611-3647
**Issue:** Matrix promotes T20a-T20j and T48 to MANDATORY, but task bodies and commit messages still mark them `[codex-skip]`.
**Fix:** Update affected task-level Codex review fields + commit-message templates to match mandatory matrix.

## Finding 12 — AMBER: File Structure section drift
**Location:** File Structure section lines 74-200
**Issue:** Map still omits `public/_redirects`, `src/components/icons/Icon.astro`, `src/assets/icons/*.svg` despite later tasks creating them.
**Fix:** Add those paths to relevant File Structure tables.

## Finding 13 — NIT: Task Index T34 stale description
**Location:** Task Index line 242 and T34 lines 2706-2841
**Issue:** Task Index describes T34 as "Empty-state + filter result rendering verification" but T34 is now a real coding task wiring a submit handler.
**Fix:** Rename T34 index row to "Wire empty-state mini-form submit handler."

## Finding 14 — AMBER: T34/T48 dependency order drift
**Location:** T34 lines 2706-2722, T48 lines 3607-3647, Execution Handoff line 4564
**Issue:** T34 depends on `TurnstileWidget` multi-instance behavior from T48, but T34 appears and is recommended for execution before T48.
**Fix:** Move T48 before T34 OR explicitly gate T34 on T48 in dependency/execution ordering.

## Finding 15 — AMBER: Stale T17/T18 cross-references
**Location:** Lines 291, 975, 983
**Issue:** Task-ID cross-references say T17/T18 or T17 remove `X-Robots-Tag`, but actual removal tasks are T15/T16 and T18 is `SiteNav`.
**Fix:** Replace stale refs with T15/T16. Leave T17 as verify-build only.

## Finding 16 — NIT: Placeholder verification tags in commit templates
**Location:** PA4 line 3921, PA5 line 4120, PA6 line 4194, PA9 line 4255
**Issue:** Placeholder `[runtime-verified: N/N]` strings remain in commit-message templates.
**Fix:** Replace each with concrete expected counts OR `[runtime-verified]` until counts are known.

---

## Verified-clean from r1 fold (no further action)

1. **Finding 1 — Filtered /jobs noindex middleware:** T15 covers FILTER_PARAMS (specialty, state, length), Link uses url.origin, both withSecurityHeaders callers pass request, curl smoke covers 5 cases. ✅
2. **Finding 2 — PA10 build-time prerender:** Uses `import.meta.env.PUBLIC_PATH_A !== 'true'`, PUBLIC_ visible at build time, statically foldable, PA9 stays prerender=false (Path-A only). ✅
6. **Finding 6 — Honeypot logging:** ipHash computed pre-honeypot check, contact/apply logs use first 16 hex + phone_alt_len, tests assert log/no row/no Resend, route order Turnstile→RL→Supabase→Resend preserved. ✅
7. **Finding 7 — Sitemap URL contract:** Robots uses public sitemap.xml, _redirects maps to sitemap-index.xml, HC3 matches, verify-build still checks dist/sitemap-index.xml. ✅
9. **Finding 9 — T44 Supabase ping:** Creates _supabase-ping.ts, runs wrangler pages dev, curls {ok:true}, queries table, env/RLS/network taxonomy, deletes scratch file. ✅
10. **Finding 10 — TODO removed:** T27 points to SG15/T63 gates, no literal TODO remaining. ✅
