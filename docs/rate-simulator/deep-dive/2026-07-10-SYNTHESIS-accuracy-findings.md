# Rate-simulator accuracy audit — SYNTHESIS (2026-07-10)

Two independent adversarial passes over the LIVE engine (`src/lib/rate-engine/*.ts` + `src/lib/hub/*.ts`):
- **Claude 8-lens review** (self-refuted): 17 confirmed / 14 refuted. Input: `2026-07-10-sol-audit-input.md`.
- **GPT-5.6-Sol adversarial audit**: confirmed 13 of 17, refuted 4 (C2, C13, C15, C17) with code reasons, found 9 new. Output: `2026-07-10-sol-audit-OUTPUT.md`.

Verdict standard (Sol's, adopted): a **concrete input must reach a wrong or unjustifiably-confident displayed dollar figure**. "Can't enter a factor" and "no quote returned" are separated from "wrong quote."

Net: **22 real accuracy defects**, clustered and tiered by real quote impact + urgency below. Nothing here is fixed yet.

---

## TIER 0 — MUST fix BEFORE un-darking the live overlay (they arm the instant WS1 data flows)
These are dormant only because `market-rates-v2` is stale / 0 promotions today. The moment a fresh anchorable bucket lands (the whole point of WS1), a wrong/gamed/low posterior moves a REAL quote, labeled "high / live." This cluster is the north-star "un-gameable accuracy" guarantee and is the true prerequisite to WS1 un-dark.

- **[HIGH] No UPPER plausibility bound on a promoted anchor** — C9 (`marketRates.ts:493-545`). A fresh 2-family `$900` posterior for a `$250` specialty becomes a High-confidence `$900` base; the researched prior is widened to fit, not used as a ceiling.
- **[HIGH] No LOWER plausibility bound** — Sol-N4 (`marketRates.ts:493-528`). Mirror of C9: `weighted_mean:50` for a `$300-400` specialty promotes a High-confidence `$50` base.
- **[HIGH] Sentinel families count as independent** — C11 (`marketRates.ts:499-517`). `source_families:['amn','unattributed']` clears the >=2-family gate → one real source unlocks a High anchor. (`unknown`/`unattributed` must be excluded from the count.)
- **[HIGH] Bucket `confidence` validated but not enforced at promotion** — Sol-N5 (`marketRates.ts:200-234,483-551`). A `single_source` bucket still promotes and is relabeled High.
- **[MED] Far-future timestamps stay fresh ~forever** — Sol-N6 (`marketRates.ts:155-164`). `isFreshBucket` has no future-skew bound; a bucket stamped years ahead keeps a wrong anchor live.
- **[MED] Parsed-path base freeze** — C6 (`rateCalculator.ts:656-680,877-902`; `hub-client.ts:248-253`). A parsed quote freezes `baseRate=spec.p70` pre-overlay; after promotion the re-render keeps the stale base, so only the ceiling moves — the observed anchor never becomes the base.

**Fix shape:** add a plausibility band (e.g. reject/clamp+downgrade when `anchor` outside `[k_lo, k_hi] × researched range`), exclude non-independent sentinel families, enforce `b.confidence` at the gate, bound freshness on both sides, and re-derive `baseRate` from current `spec.p70` on re-quote. All in `marketRates.ts` + one `rateCalculator.ts`/`hub-client.ts` seam. Lockable with unit tests; 0 live-quote movement today (overlay dark).

## TIER 1 — Wrong or over-cap quotes on the CURRENT live path (parsed/manual — active today)
- **[HIGH] Displayed bill EXCEEDS the contractual cap** — Sol-N1 (`rateCalculator.ts:683-691`; `sim-adapter.ts:298-300,354-361`). `Rate Cap $250/hr` + default 22% margin → pay capped $200, hub displays `roundUp5(200/0.78)=$260/hr` — above the stated cap. Worst single defect: shows a number the contract forbids.
- **[HIGH] Specialty MISROUTES to a confident wrong cell** — C1/C4/C5/C16 + Sol-N2 (`rateCalculator.ts:77-92`, `specialties.ts`). Alias-first substring scan w/o word boundaries or unmatched-token checks: Radiation Onc→medical onc $350-500; Gyn Onc→medical onc; Endovascular Surgery→endocrinology; Pediatric ICU→adult critical care; Reproductive Endo→adult endo; Urogynecology→OB/GYN; Pediatric Anesthesiologist→general anes. All `source:'inferred'` → can display Medium/High on the WRONG specialty.
- **[HIGH] Negated / lower-priority facility words priced as real** — Sol-N3 (`rateCalculator.ts:238-298`). "No telehealth; on-site" still applies telehealth 0.75×; "university-affiliated CAH" picks academic 0.85 before CAH 1.22 (~30% underquote).
- **[MED] Manual controls can't express facility/call/holiday** — C3/C12 (`sim-adapter.ts:38-46,127-145`). The most common recruiter path silently prices community/no-call/no-holiday; a known CAH loses +22%.

## TIER 2 — Premium / parse correctness (medium, current path)
- **[MED] Holiday premium is channel-dependent** — C7 (`rateCalculator.ts:213-235,360-394,670-675`). Structured "Holiday: Yes" → 1.10×; free-text "holiday" → 1.35×. Same fact, 22% apart, by parse channel.
- **[MED] 24-hour shift classified as night** — C8 (`rateCalculator.ts:213-235`). Full 1.20× night premium on all hours of a day+night shift.
- **[MED] Call burden is a flat boolean 1.10×** — C14 (`rateCalculator.ts:323-337,670-675`). q2 in-house == 1:4 beeper; uncited.
- **[MED] Unitless cap silently applied as hourly; warning never reaches hub** — Sol-N7 (`rateCalculator.ts:503-541,683-691`; `sim-adapter.ts:220-252`).
- **[MED] Multi-state assignment quoted from first facility, can show High geo confidence** — Sol-N8 (`rateCalculator.ts:137-140,621-637`).
- **[MED] Reversed/typo dates → emergency premium instead of rejection** — Sol-N9 (`rateCalculator.ts:301-319`). End<Start → `<=7 days` → 1.20× emergency.

## TIER 3 — Display honesty (low)
- **[LOW] "Premium tier $X" labels linear band geometry as an observed market segment** — C10 (`sim-adapter.ts:354-372`; `sim-render.ts:50-69`). Relabel to a band-position phrase; 0 math change.

---

## Refuted (do not fix — with reason)
- **C2** (unknown→internal-medicine): live adapters reject `source==='default'` → manual-escalation UI, not an internist quote (`sim-adapter.ts:185-188,203-207`).
- **C13** (`ob-gyn` hyphen): real, but returns NULL → availability defect (no quote), not a wrong quote. *(Still worth a small fix — IAS's #1 specialty gets no quote for a common spelling — but it's not a misprice.)*
- **C15** (national→first-state cell): real code, but latent — v2 is national-only today, no live trigger.
- **C17** (narrow-band premium clamp): intentional design; UI states the quote was bounded.

## Recommended sequence
1. **Tier 0** (overlay robustness) — prerequisite to a safe WS1 un-dark. Fix + unit-test; deploy is quote-neutral today.
2. **Tier 1** (current-path wrong/over-cap quotes) — the bill-exceeds-cap (N1) and the specialty misroutes are live-today accuracy failures.
3. **Tier 2 / Tier 3** — correctness polish.
Every fix: TDD + Codex-gated; NO deploy without explicit go.
