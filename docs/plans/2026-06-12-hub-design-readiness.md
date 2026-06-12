# IMS Hub — Design-Readiness Map (2026-06-12)

> Read-only audit of the LIVE hub (imstaffing.ai/hub) to seed the "make it look
> great" section-by-section design pass. Produced by a 6-agent workflow + synthesis.
> Priority = the no-fake-data fixes (CLAUDE.md). Source: per-section file:line audit.

## 1. Fabricated-Data Hit List (priority — CLAUDE.md no-fake-data)

Ordered most-visible / most-egregious first. "Egregious" = the app itself elsewhere refuses to show this exact number.

| # | Fake value shown as real | File:line | Why it's fake | Honest fix |
|---|---|---|---|---|
| 1 | **`94% Fill rate`** (login aside) | `src/pages/hub/login.astro:99-100` | Hardcoded. Fill rate is **uncomputable today** (only Receive/Update/Cancel/Reject events flow; no Bids/Agreements). The dashboard itself renders this exact metric as `—` + "Needs LS Bids + Agreements feed" (`OverviewView.astro:71-73`). Flattering invented KPI on the first screen users see. | Drop it. Replace with a real KPI from `ims_ls_analytics` (providers placed / invoiced YTD) or a non-numeric feature chip. |
| 2 | **`18d Avg fill time`** (login aside) | `src/pages/hub/login.astro:95-96` | Hardcoded. Dashboard renders this exact metric as `—` ("Awaiting close-time history", `OverviewView.astro:60-62`). | Drop it (mirror dashboard `—`) or bind to a real KPI. |
| 3 | **`37+ Active reqs`** (login aside) | `src/pages/hub/login.astro:91-92` | Hardcoded; page makes no Supabase query. A real live count exists (`OverviewView.astro:54`). | Bind to the same live `ims_jobs` feed Overview uses (`login.astro` is `prerender=false`). Real number, no new infra. |
| 4 | **"This week's priorities" — 6 invented tasks** ("Boise hospitalist open 26 days", "3 candidates pending", named person **"Sara P."**) + drives a `{N} open` chip | `hub-seed.ts:14-21` → `OverviewView.astro:144-153` | Invented ops tasks with named people/day-counts, **no example/starter label**, on the live default view. Reads as the team's real to-do list. | Derive from real `ls_events` req-aging, OR move to a staff-editable table, OR add a visible "starter" marker. |
| 5 | **Quick rate check `$463/hr`** (Overview) | `OverviewView.astro:123` | Hardcoded literal on initial paint as "Estimated bill rate", not derived from default dropdowns at SSR. | Compute the SSR default from first specialty×region (`rate-engine` billBase × region mult). |
| 6 | **PDF dropzone fake "parsing"** — always shows `Anesthesiology / Southeast / Nights / 13 weeks` and claims "Parsed · applied suggested inputs" | `hub-seed.ts:23` (PDF_CHIPS) → `hub-client.ts:168-183`; copy at `SimulatorView.astro:25,34` | Dropzone **ignores file bytes entirely** while the UI claims it "reads the specialty, region and shift." Active lie. | Wire real extraction, or relabel honestly ("Coming soon") / remove. Highest credibility risk in the Simulator. |
| 7 | **Simulator hardcoded result panel** `$463 / $440–$491 / $361 / $102·22%` | `SimulatorView.astro:92-100` | Literals in static HTML; only *coincidentally* match the JS default. Pre-JS / no-JS / changed-defaults shows wrong figures. | Derive at SSR or render skeleton until `updateSim()` runs. |
| 8 | **Confidence band `$440–$491`** (Simulator) | `hub-client.ts:129` | Fixed cosmetic ±5/6% spread, not from any real variance. | Derive from real per-specialty variance in `ims_ls_analytics`, or label as a flat heuristic. |
| 9 | **Weekly Sync seed items** (Recruiting/Marketing/Ops specifics) | `hub-seed.ts:25-44` | Invented specifics rendered identically to user-saved entries on a fresh week — no "starter" styling. Lower severity (editable starter text). | Add ghost/"starter template" styling + empty first-run state; optionally auto-seed Recruiting from real open-reqs. |
| 10 | **Static `9:00 AM` standup chip** (Sync) | `SyncView.astro:26` | Hardcoded next to live `weekKey`; implies a real recurring standup. Minor. | Wire to config/refresh timestamp, or make generic. |
| 11 | **`Mon` badge** on Weekly Sync nav (Shell) | `HubSidebar.astro:29` | Static literal; reads as a live "due Monday" cue. Minor. | Drive from `syncPersisted` or make neutral. |
| 12 | **Always-on notification "unread" dot** (Shell) | `hub.css:77` + `HubTopbar.astro:21-23` | Permanent CSS pseudo-element claiming unread notifications; **no notification system exists**. | Remove, or build a real `ls_events`-driven popover. |

**Not violations (leave):** Rate Simulator base rates/multipliers (`rate-engine.ts:38-84`) are honestly labeled "Modeled estimate / curated market base rates"; Overview's `—` empty KPIs; all of Analytics.

## 2. Per-Section State

| Section | Data state | Biggest design gap |
|---|---|---|
| **Login** | Mixed (real auth; **all 3 aside stats fake**) | Left aside is `display:none` <860px → design vanishes on mobile; polishing the fake stats only makes them more prominent. |
| **Overview** | Mixed (KPIs/pipeline/activity real; priorities + `$463` fake) | Up to **3 of 4 hero KPI tiles show `—` at once** → reads as broken; `—` needs a deliberate empty-state. |
| **Analytics** | **Real** (zero fabrication; honest `—`/proxy/stale guards) | Thinnest possible render of the richest source — mapper produces monthly series, revenue-by-specialty, providers the view never draws; weak freshness signal. |
| **Simulator** | Mixed (Latest-5 jobs real; rates modeled-but-labeled; **PDF + result literals fake**) | PDF dropzone claims to "parse" but ignores the file — biggest credibility risk. |
| **Sync** | **Seed** (real for returning editors; honest plumbing) | Seed items indistinguishable from real saved entries; no saved/unsaved indicator; no-confirm destructive "Reset board". |
| **Shell** | **Real** (pure chrome; 2 fake state signals) | Two **dead controls** in topbar (search input + bell, no handlers); desktop-first (no mobile nav); view state not URL-addressable. |

## 3. Suggested Section Order for the "Make It Look Great" Pass

1. **Login** — first impression + highest-egregiousness fakes (#1–3); honesty fix is small. Fix the mobile `display:none` aside in the same pass.
2. **Shell** — frames all 4 views; polishing it (mobile nav, URL-addressable views, kill the 2 dead controls + fake dot/badge) compounds across every section.
3. **Overview** — default landing; resolve the `—` empty-state treatment + priorities/`$463` fakes before deeper styling.
4. **Simulator** — self-contained; fix the active-lie PDF dropzone + literal result panel first, then polish.
5. **Analytics** — already honest → additive work (port LS series / revenue-by-specialty / providers into real charts). Do after Shell chart-styling decisions.
6. **Sync** — mostly presentational (starter styling, saved-state indicator, Reset confirm); safest last.
