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
The July incident (whole paid fleet dark ~1 week) was `no_budget_row`. The provisioner
function is the durable fix but it has **no caller**. Rows run out after September; on
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
