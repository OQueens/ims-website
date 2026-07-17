# Budget-guard alerting — closing the silent-outage holes (DESIGN, for Zach)

**Date:** 2026-07-13 · **Status:** DESIGN ONLY — touches the spend guard; nothing changed yet.
**Verified against prod this session** (EC2 + prod PG, read-only): `reserve_budget` /
`ensure_budget_rows` / `reconcile_budget` definitions pulled live; `config/schedules.yml`;
sweeper source; `budget_counters` state; pg_trigger + cron.job checked.

## Current state (all runtime-verified 2026-07-13)

- **Delivery works** (proven end-to-end 2026-07-10): `agent_alerts` → `budget_alert_sweeper.py`
  (inside `analytics_watchdog`, daily **7:30 CT** via the orchestrator's APScheduler) → Slack
  #agent-ops. Severity filter `IN ('warning','critical')`.
- `budget_counters` currently provisioned through **2026-09-01** (5 APIs × $195 caps/month).
- `reserve_budget`: `cap_exceeded` (per-API and `_global`) **writes a `warning` alert**. 
  `no_budget_row` / `no_global_budget_row` **write NOTHING** — deny with a reason string only.
- `ensure_budget_rows` (the provisioner): writes `info` on success. **Nothing schedules it.**
  No pg_cron (extension absent), no DB trigger, no caller in the fleet source tree, no caller
  in the deployed watchdog image (grepped the running image). Aug+Sept rows exist only because
  we ran it manually on 2026-07-10.

## The three holes, worst first

### H1 — The provisioner is unscheduled (the July outage returns Oct 1)

> **CORRECTION (2026-07-13, later the same day):** the premise above is WRONG.
> A **host crontab** on EC2 (`0 6 * * *` →
> `~/ias-dashboard/scripts/ensure-budget-rows.sh`, installed 2026-07-08) already
> calls `ensure_budget_rows()` daily — verified live with successful idempotent
> runs logged Jul 11/12/13 in `~/ias-dashboard/logs/budget-provision.log`. The
> audit above checked pg_cron, triggers, the fleet source tree and the deployed
> watchdog image, but not the host crontab. There is **no Oct 1 re-outage** as
> long as that cron works — but it logs to a file nobody watches and alerts on
> NOTHING (a broken `.env`, a rotated DB credential, or node breakage fails
> silently forever). H1 as implemented below is therefore the **redundant
> scheduling home with failure semantics**, not the first scheduler.

The July incident (whole paid fleet dark ~1 week) was `no_budget_row`. The provisioner
function is the durable fix but it has **no caller** ~~(see correction)~~. Rows run out after September; on
**Oct 1** every `reserve_budget` call denies again — and per H2, still silently.

**Proposed fix:** call `ensure_budget_rows()` at the **top of the analytics_watchdog daily
run** (immediately before the alert sweep, same DB session pattern):
- Idempotent by design (`ON CONFLICT DO NOTHING`), cheap (3-row loop), keeps a 2-month buffer
  ahead — a month of missed watchdog runs still can't create a gap.
- Wrap in try/except: on exception, `INSERT agent_alerts ('critical','budget_provisioner',
  'ensure_budget_rows FAILED: …')` before re-raising into the watchdog's own failure path.
- Degenerate branch: if the function reports `rows_created=0` **and** the target month has no
  rows at all (v_src NULL case = empty table), alert `critical` (today it returns silently).
- No new agent, no new schedule entry, ~15 lines in the watchdog + 1 test.

### H2 — `no_budget_row` denies silently (the exact July failure mode)
`cap_exceeded` alerts; the *worse* failure (rows missing entirely → 100% denial) doesn't.

**Proposed fix (SQL, in `reserve_budget`):** in both `no_budget_row` branches, INSERT a
**`critical`** alert (source `budget_guard`), **deduped**: skip the insert when an
unprocessed alert with the same source + message prefix already exists —
`WHERE NOT EXISTS (SELECT 1 FROM agent_alerts WHERE processed_at IS NULL AND source='budget_guard' AND message LIKE 'no_budget_row:'||p_api_name||'%')`.
Without the dedup, a scraper retry-loop would write hundreds of rows and flood the 50/sweep
drain for days. (Optional same-pass hardening: apply the identical dedup guard to the two
existing `cap_exceeded` warning inserts — they have the same flood property — and upgrade the
`_global` cap trip from `warning`→`critical` since it halts the whole fleet.)

### H3 — Critical alerts can wait ~24h (daily 7:30 CT sweep)
The sweeper's own docstring anticipates the fix: *"Lift to a dedicated alert_poster agent if
cadence pressure ever demands faster turnaround."*

**Proposed fix:** new minimal `alert_poster` agent entry in `schedules.yml` running
**hourly**, whose run is nothing but `sweep_budget_alerts(supabase, SlackClient())` — the
existing, proven module, reused unchanged. Keep the watchdog's daily sweep as backstop (the
`processed_at IS NULL` watermark makes double-draining a benign no-op; at-least-once
semantics already designed in). Worst-case critical latency drops 24h → ~1h.
- **Rejected alternative — immediate push from the DB** (pg_net http_post to Slack inside
  `reserve_budget`): true real-time, but puts a Slack secret + outbound HTTP inside the spend
  guard's transaction path; a Slack outage would then slow/fail budget reservations. Not
  worth it at this fleet's scale; hourly is proportionate.
- Cost: one tiny container run/hour (~seconds); no paid APIs involved.

## Rollout order & blast radius

1. **H2 SQL first** (one `CREATE OR REPLACE FUNCTION` migration; deny paths gain an INSERT —
   spend math untouched; every branch keeps returning exactly the same (allowed, reason) —
   subtractive-risk: worst failure is a missing/duplicate alert row, never a wrong allow).
2. **H1 watchdog change** (fleet Python + image rebuild for analytics_watchdog only).
3. **H3 schedules.yml + alert_poster** (orchestrator reload; zero change to existing agents).

Each step lands separately, each with its own test + rollback (previous function def is
archived in this doc's git history; images are rollback-tagged like `:pre-ws1`).

**Test plan:** synthetic-row proofs like the 2026-07-10 session (inject → sweep in-container →
observe Slack → delete); for H2, call `reserve_budget` against a fake api_name with no row in
a transaction and ROLLBACK — assert the alert insert, zero spend movement.

**Awaiting your go per-hole (H1/H2/H3 independently) — no spend-guard change until then.**

---

## ✅ APPLIED TO PROD 2026-07-16 (Zach's explicit apply-go, same-day verify)
## H2: `h2-proof.temp.mjs --apply` → reserve_budget committed, ALL proof probes
## PASS (dedup index live, exact-definition check PASS, probes rolled back, no
## leaks). H1: `:pre-h1-20260713` rollback tag created (1257c713ecaf), image
## rebuilt (`:latest` ad9a71dab324, ensure_budget_rows verified inside), one
## verification run success (agent_runs 2026-07-16T19:42Z).
##
## BUILT + SOL-APPROVED, STAGED ON EC2 — APPLY IS THE ONE REMAINING STEP
## (2026-07-13, same day — Zach's go: H1+H2, H3 deferred)

Both changes are code-complete on EC2 after TDD + a 3-round GPT-5.6-Sol
adversarial gate ending in "ship" (after a one-line rollback fix, applied).
The auto-mode classifier blocked the final production mutations (its reading:
the "explicit go" covered building/proving, not deploying), so the APPLY is a
two-command operator step:

```bash
# H2 — commit the SQL to prod (proof probes then run + roll back):
ssh -i ~/.ssh/ias-clinician-agent.pem ubuntu@54.145.175.182 \
  'cd ~/ias-dashboard && set -a && . ./.env && set +a && node h2-proof.temp.mjs /home/ubuntu/020_budget_alerting_h2.sql --apply'
# H1 — rollback-tag + rebuild + one verification run of the watchdog image:
ssh -i ~/.ssh/ias-clinician-agent.pem ubuntu@54.145.175.182 \
  'docker tag ias-agent-analytics_watchdog:latest ias-agent-analytics_watchdog:pre-h1-20260713 && cd ~/ias-agents && bash scripts/build_agent.sh analytics_watchdog && docker run --rm ias-agent-analytics_watchdog:latest'
```

Rollback: `~/ias-agents/migrations/020_budget_alerting_h2_ROLLBACK.sql` (via the
same node/pg path) + retag `:pre-h1-20260713` → `:latest`. The fleet tree has no
git, so this section is the durable record.

**H1 (rev 3)** — `~/ias-agents/agents/analytics_watchdog/agent.py`: `ensure_budget_rows`
RPC at the **top of `execute()`** (an analytics exception can never strand it; its
alert drains via the same run's sweep). Critical `agent_alerts` on RPC failure AND on
the empty-table degenerate branch; a **DB-independent Slack fallback** (direct
`send_message` to #agent-ops) fires ONLY when the alert row failed to persist (no
double-posting). Backups: `agent.py.bak-pre-h1`, `test_analytics_watchdog.py.bak-pre-h1`.
Tests: 14/14 in the fleet base image. Image rollback tag: see the pre-rebuild tag
`ias-agent-analytics_watchdog:pre-h1-<ts>` created at rebuild time.

**H2 (rev 3)** — `~/ias-agents/migrations/020_budget_alerting_h2.sql` (+ `_ROLLBACK.sql`
restoring the verbatim pre-H2 live definition): deduped **critical** alerts on both
`no_budget_row` branches. Dedup = exact deterministic message equality (no LIKE — Sol:
wildcards/NULL break patterns) + a **partial unique index**
`idx_agent_alerts_budget_guard_dedup ON public.agent_alerts (source, message) WHERE
processed_at IS NULL AND source = 'budget_guard'` with `ON CONFLICT DO NOTHING` on all
four budget_guard inserts (the cap_exceeded pair REQUIRED it once the index exists —
byte-identical repeats would otherwise throw inside the spend guard). Index scoped to
budget_guard because undrained `info` rows would otherwise collide. Every branch
returns byte-identical (allowed, reason, …); spend math untouched. Proof
(`h2-proof.mjs`): transactional, ran on prod and ROLLED BACK — deny+alert+dedup both
branches, NULL-name dedup, exact spend increments, index definition, zero leakage.

**Sol-accepted residuals:** missing-credential failures die at agent construction
(before the fallback — host-cron log is the only signal); the synchronous Slack
fallback can add ~30s on the failure path; `cap_exceeded` floods with distinct
messages still queue-compete (A5).
