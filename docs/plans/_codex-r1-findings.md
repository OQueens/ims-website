# Codex r1 review — Plan v1 — 2026-05-06

Task ID: `task-moub5ke4-xo75o5`
Duration: 283.5s
Output sandbox-blocked from `/tmp/codex-plan-review-r1.md`; transcribed from rollout JSONL.

## Finding 1 — NO-GO: Filtered `/jobs?...` Noindex Is Client-Side Only
**Location:** Spec §0.5.5 lines 139-146; plan T33 lines 2429-2447 and 2475-2477
**Issue:** Spec requires filtered `/jobs?...` URLs to ship with `noindex,follow` and canonical `/jobs`. T33 adds that only in browser JS after hydration, so crawlers can receive indexable SSG HTML.
**Fix:** Emit filtered URL robots/canonical server-side via SSR, middleware/header logic, or another pre-hydration mechanism.

## Finding 2 — NO-GO: PA10 Breaks Path B SSG Fallback Contract
**Location:** Spec §0.5.1 line 26 and §3.4 lines 455-460; plan PA10 line 3671
**Issue:** Spec says Path B `/jobs` is SSG and `/api/jobs` does not exist. PA10 says `export const prerender = false` unconditionally, making Path B SSR after Path A work lands.
**Fix:** Keep Path B SSG when `PUBLIC_PATH_A=false`; only Path A should opt `/jobs` into SSR.

## Finding 3 — NO-GO: Path A Stale-Listing Lifecycle Is Missing
**Location:** Spec §3.4 lines 408-410 and 467-468; plan line 190; PA4 lines 3486-3496; PA5 lines 3512-3524
**Issue:** Spec requires 2 missed syncs → `_stale: true`, 24h grace, then drop. PA4/PA5 do not test or implement that lifecycle.
**Fix:** Add tests and implementation for missed-sync counting, stale marking, grace retention, and deletion across KV indexes/meta.

## Finding 4 — AMBER: Job Empty State Omits Required Mini Form
**Location:** Spec §3.1 line 343; plan T32 lines 2253-2255; T34 lines 2487-2489
**Issue:** Spec requires an empty-state mini form with specialty, state, and email. Plan only links to contact.
**Fix:** Add the mini form and define/verify its submit path.

## Finding 5 — AMBER: Functional Icon Set Has No Task
**Location:** Spec §4.7 lines 633-638; plan map lines 76-90; task index lines 209-263
**Issue:** Spec requires `src/assets/icons/` with ≤8 functional icons at launch. No task creates or verifies it.
**Fix:** Add a task for the icon set, exact icons, styling, and ≤8 verification.

## Finding 6 — AMBER: Honeypot Bot Drops Are Not Logged
**Location:** Spec §3.3 line 380; plan T46 lines 3047-3048 and 3081-3082; T47 lines 3151-3175
**Issue:** Spec says populated `phone_alt` submissions are silently dropped AND logged. Plan only returns silent 200.
**Fix:** Add non-PII logging/audit behavior and tests asserting no row/email but log occurs.

## Finding 7 — AMBER: Sitemap URL Contract Drifts From Spec
**Location:** Spec §1 line 185 and §5 line 665; plan map line 180; T14 lines 1175-1182; HC3 line 3866
**Issue:** Spec says robots.txt references `sitemap.xml`; plan switches to `sitemap-index.xml`.
**Fix:** Align spec/checklist/plan on one public sitemap URL, or configure output to match `sitemap.xml`.

## Finding 8 — AMBER: Codex Matrix Skips Non-Trivial Code
**Location:** Plan lines 50-55; T20 lines 1637-1675; T25 lines 1785-1815; T48 lines 3187-3227; T51 lines 3270-3297; T52 lines 3302-3327
**Issue:** T20 section components, T25 tab JS, T48 Turnstile JS, T51 modal wiring, and T52 analytics JS are real code paths but are skip/N/A.
**Fix:** Mark these MANDATORY, at least as batch reviews for related UI scripts/components.

## Finding 9 — AMBER: Risk Register References Missing T44 Test
**Location:** Plan T44 lines 2876-2909; Risk Register line 3899
**Issue:** Risk register claims T44 runs a `wrangler pages dev` Supabase env-binding connection test. T44 only implements the helper.
**Fix:** Add that verification to T44 or correct the risk-register reference.

## Finding 10 — NIT: Literal TODO Placeholder Remains
**Location:** Plan T27 line 1850
**Issue:** The plan includes `{/* TODO Zach review before launch */}` despite the no-placeholder quality rule.
**Fix:** Replace with explicit gate wording or rely on SG15/T63.

## Summary
- NO-GO: 3
- AMBER: 6
- NIT: 1
- Verdict: NOT executable as-is. Fix NO-GOs before execution, especially filtered `/jobs?...` indexability and PA10's Path B SSR drift.
