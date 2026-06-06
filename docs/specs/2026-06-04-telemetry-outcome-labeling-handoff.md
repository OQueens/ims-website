# IMS Website — Quote/Job Outcome-Labeling Page (Integration Handoff)

**Status:** Contract frozen for parallel build. Backend is LIVE; IMS-side page is to be built.
**Created:** 2026-06-04
**Owner of the backend:** `OQueens/oqueens-ias-dashboard` (the rate-simulator track — Phase 7 "Quote-Regret Telemetry"). Backend questions go there.
**Owner of this page:** `OQueens/ims-website` (this repo).
**Supabase project:** `gbakzhibzotugfyktcrt` (shared — same project the dashboard uses).

---

## 0. What this is (one paragraph)

The rate simulator quotes locum pay/bill rates, but never learns whether those quotes were any good. This feature is the feedback loop: IAS staff label what actually happened to a quote/job — **won, lost, pushed_back, walked, adjusted, abandoned** — plus the rate it actually closed at. Those labels are the *only* fast outcome signal IAS controls (Sisense is blocked), and they're what eventually makes the calculator accurate. The secure capture backend is already built and deployed (three Supabase Edge Functions + two append-only tables). **This repo builds the staff-facing labeling page** on the IMS site, behind the Google SSO gate, calling that backend through a server-side proxy. The two repos build in parallel against the contract below; "merge" just means both point at the same Supabase project.

**Load-bearing data rule (from Zach):** a label is only useful if it captures BOTH (a) the pay/bill we *quoted* AND (b) the *actual rate the clinician ends up getting*. Without the actual rate, the calculator learns nothing. The form MUST require the quoted pay, and MUST require the actual winning rate whenever the job closed (won/adjusted); on a loss, capture the competitor's winning rate if known.

---

## 1. What is ALREADY LIVE (do not rebuild)

Three Supabase Edge Functions, deployed `verify_jwt=false` (they use a custom shared-secret, not Supabase JWT), on project `gbakzhibzotugfyktcrt`. Base URL:

```
https://gbakzhibzotugfyktcrt.functions.supabase.co/<function-name>
```

| Function | Method | Purpose |
|----------|--------|---------|
| `log-quote` | POST | Write ONE append-only `quote_events` row; returns `{ quote_id }` |
| `label-outcome` | POST | Write ONE append-only `quote_outcomes` row linked by `quote_id` |
| `list-quotes` | POST | Read recent quotes + their outcomes (service-role; never anon) |

**Every call requires the header `x-telemetry-secret: <TELEMETRY_WRITE_SECRET>`.** The functions fail closed (401 if the secret is unset server-side; 401 on a missing/wrong caller secret, constant-time compared). CORS allows the custom header. The two tables (`quote_events`, `quote_outcomes`) are anon-deny for BOTH read and write (RLS on, zero policies, REVOKE from anon+authenticated) — the *only* way in or out is through these functions. **Never call Supabase PostgREST/anon client for telemetry data — it is denied by design.**

### Outcome enum (DB-enforced — exactly these six)
```
won | lost | pushed_back | walked | adjusted | abandoned
```

---

## 2. What is COMING from the dashboard repo (build against these; they'll exist before merge)

The backend repo will add (tracked there — additive, safe):

- **New edge function `list-jobs`** (POST, same `x-telemetry-secret` gate) → returns recent jobs from the Supabase `ims_jobs` table for the searchable dropdown. Shape in §4.4.
- **Additive columns** on the existing tables (all nullable — no breaking change):
  - `quote_events.job_id TEXT`, `quote_events.job_source TEXT` — link a labeled row back to its source job.
  - `quote_outcomes.labeled_by TEXT` — the signed-in staffer's email (audit; populated by the proxy from the Cloudflare Access header).
- `log-quote` / `label-outcome` will accept the new optional fields (`job_id`, `job_source`, `labeled_by`). Until then they ignore unknown fields safely, so you can send them now.

Until `list-jobs` ships, you can build the dropdown against a small local fixture matching the §4.4 shape, then flip to the live endpoint — no other change.

---

## 3. IMS-side architecture (recommended, matches this repo's stack)

This repo is Astro + Cloudflare Pages with the `@astrojs/cloudflare` hybrid adapter (per the Phase-1 spec). Use that server layer so **the telemetry secret never enters the browser**:

```
Browser (staff, behind Cloudflare Access / Google SSO)
   │  fetch('/api/telemetry/...')   ← no secret in the browser
   ▼
Cloudflare Pages Function / Astro SSR route  (/api/telemetry/[action])
   │  adds  x-telemetry-secret: env.TELEMETRY_WRITE_SECRET
   │  adds  labeled_by: <Cf-Access-Authenticated-User-Email>
   ▼
Supabase Edge Function (log-quote / label-outcome / list-quotes / list-jobs)
   ▼
Supabase Postgres (quote_events / quote_outcomes / ims_jobs)
```

### 3.1 Auth gate
Put the labeling page (and the `/api/telemetry/*` routes) behind **Cloudflare Access with Google as the IdP** — this IS the "Google Authenticator login for IAS Staffing." Configured in the Cloudflare dashboard (Zero Trust → Access → Applications), not in this repo. Access injects request headers the proxy can trust:
- `Cf-Access-Authenticated-User-Email` → use as `labeled_by` (who labeled it).
- `Cf-Access-Jwt-Assertion` → optionally verify for defense-in-depth.

### 3.2 The secret
`TELEMETRY_WRITE_SECRET` is set as a **Cloudflare Pages environment secret** (Settings → Environment variables → encrypt) — the SAME value the operator set in the Supabase dashboard for the backend. It is read only inside the Pages Function/SSR route (`env.TELEMETRY_WRITE_SECRET` / `import.meta.env` server-side). It must NEVER appear in client code, a `PUBLIC_*`/`VITE_*` var, the bundle, or git.

### 3.3 The proxy (`/api/telemetry/[action]`)
A single server route that:
1. Confirms the request carries a valid Cloudflare Access identity (reject otherwise).
2. Maps `action` ∈ `{ log-quote, label-outcome, list-quotes, list-jobs }`.
3. Forwards the JSON body to the matching Supabase function with `x-telemetry-secret` + (for writes) injects `labeled_by` from the Access email.
4. Returns the function's JSON/status verbatim.

This keeps the browser → proxy contract secret-free and gives a clean audit trail.

---

## 4. Endpoint contracts (exact shapes)

All bodies are JSON. The browser calls your proxy (`/api/telemetry/<action>`); the proxy calls Supabase. Shapes below are the Supabase-facing contract (your proxy passes them through, adding the secret + `labeled_by`).

### 4.1 `log-quote` (POST) — create a quote/job row
Request body:
```jsonc
{
  "specialty": "CRNA",            // required
  "state": "IN",                  // required
  "facility": "St. Vincent",      // nullable (human-readable facility name)
  "shift": "Days",                // nullable
  "quoted_pay": 250,              // REQUIRED — the pay/hr we quoted (displayed/calibrated number)
  "quoted_bill": 320,             // nullable — the bill rate we quoted
  "days_until_start": 14,         // nullable INTEGER — never fabricate; null if unknown
  "confidence": "medium",         // nullable snapshot
  "is_call_only": false,
  "day_type": null,               // nullable (call-only context)
  "comp_model": null,             // nullable (call-only context)
  "market_max_applied": null,     // nullable boolean
  "calibration_applied": null,    // nullable numeric
  "raw_pay": null,                // nullable — engine pre-calibration pay
  "labeled_via": "backfill",      // 'live' (from the sim) or 'backfill' (labeling a past job)
  "job_id": "<ims_jobs.id uuid>", // NEW (optional) — set when sourced from the jobs dropdown
  "job_source": "ims_jobs"        // NEW (optional)
}
```
Response: `{ "quote_id": "<uuid>" }` (200) · `{ "error": "..." }` (401 unauthorized / 500 db).

### 4.2 `label-outcome` (POST) — attach an outcome
Request body:
```jsonc
{
  "quote_id": "<uuid from log-quote>",   // required
  "outcome": "won",                       // required — one of the 6 enum values
  "actual_winning_rate": 240,             // pay/hr the clinician ACTUALLY gets — REQUIRED for won/adjusted;
                                          //   on a loss, the competitor's winning rate if known; else null
  "note": "Closed at 240 after one counter", // nullable
  "labeled_via": "backfill",              // 'live' | 'backfill'
  "labeled_by": "<injected by proxy>"     // NEW — Google email from Cloudflare Access (proxy adds it)
}
```
Response: `{ "ok": true }` (200) · `{ "error": "..." }` (400 bad enum / 401 / 500).

### 4.3 `list-quotes` (POST) — read recent quotes + outcomes
Request: `{}` (the secret header is the auth). Response:
```jsonc
{ "quotes": [
  { "quote_id": "...", "created_at": "...", "specialty": "...", "state": "...",
    "facility": "...", "shift": "...", "quoted_pay": 250, "quoted_bill": 320,
    "days_until_start": 14, "confidence": "medium", "is_call_only": false,
    "quote_outcomes": [ { "outcome": "won", "actual_winning_rate": 240,
                          "note": "...", "labeled_at": "...", "labeled_via": "backfill" } ] }
] }
```

### 4.4 `list-jobs` (POST) — the searchable dropdown source (COMING from backend repo)
Request: `{ "limit": 200, "q": "optional search string" }`. Response (fields from `ims_jobs`):
```jsonc
{ "jobs": [
  { "id": "<uuid>", "assignment_number": "A-10432", "specialty_name": "CRNA",
    "facility_name": "St. Vincent", "facility_state": "IN", "facility_city": "Indianapolis",
    "start_date": "2026-07-01", "end_date": "2026-12-31", "status": "open",
    "provider_type": "...", "call_type": "..." }
] }
```
Dropdown label suggestion: `{assignment_number} · {specialty_name} · {facility_name}, {facility_state} · starts {start_date}`. Store the selected `id` as `job_id` (+ `job_source: "ims_jobs"`) when you call `log-quote`.

---

## 5. The page UX (what staff do)

Route (suggested): `/hub/telemetry` (or wherever the hub lives), behind Cloudflare Access.

1. **Searchable job dropdown** — type to filter the `list-jobs` results by assignment #, specialty, facility, or state. Recent-first.
2. On select, **prefill** specialty / state / facility from the job.
3. **Outcome form:**
   - Outcome: the 6-value control (won / lost / pushed_back / walked / adjusted / abandoned).
   - **Quoted pay** (required) + **quoted bill** (encouraged) — what we quoted.
   - **Actual winning rate** — REQUIRED when outcome ∈ {won, adjusted}; on {lost, walked} capture the competitor's winning rate if known; optional for {pushed_back, abandoned}.
   - Note (optional).
4. **Submit** → proxy → `log-quote` (with `job_id`/`job_source`/`labeled_via:"backfill"`) → take the returned `quote_id` → `label-outcome` (with the outcome + actual rate + note; proxy adds `labeled_by`).
5. **Recent labels list** (optional, via `list-quotes`) so staff see what's been recorded and can re-label (re-labeling appends a new outcome; it never mutates the original — by design).

Design tokens: follow this repo's design system (`docs/IAS-Design-System.md`). The 6 outcomes read well as a segmented control or labeled buttons.

---

## 6. Division of labor

| Repo | Builds |
|------|--------|
| **ias-dashboard** (backend) | `list-jobs` edge function; additive migration (`job_id`/`job_source`/`labeled_by`); accept new fields in `log-quote`/`label-outcome`. Keeps the existing dashboard `/telemetry` page working. |
| **ims-website** (this repo) | The `/hub/telemetry` Astro page; the `/api/telemetry/*` server proxy (holds the secret, injects `labeled_by`); the searchable dropdown; the outcome form; Cloudflare Access gate; `TELEMETRY_WRITE_SECRET` as a Pages env secret. |

Both write the **same** `quote_events`/`quote_outcomes` tables — one dataset, two entry points (the dashboard's quote-based flow + this repo's job-based flow). Intended.

---

## 7. Build checklist (this repo)

- [ ] Add `@astrojs/cloudflare` adapter + `output: "hybrid"` if not already (Phase-1 spec already plans this).
- [ ] `TELEMETRY_WRITE_SECRET` set as an encrypted Cloudflare Pages env var (matches the Supabase dashboard value).
- [ ] Cloudflare Access app over `/hub/*` + `/api/telemetry/*` with Google IdP; restrict to the IAS Staffing Google group/emails.
- [ ] `/api/telemetry/[action].ts` proxy: secret injection + `labeled_by` from `Cf-Access-Authenticated-User-Email`; pass-through status/JSON.
- [ ] `/hub/telemetry` page: searchable job dropdown (`list-jobs`), outcome form (6 values + quoted pay/bill + actual winning rate + note), submit chains `log-quote`→`label-outcome`.
- [ ] Recent-labels list via `list-quotes` (optional).
- [ ] Acceptance: a real label round-trips (job picked → outcome saved → appears in `list-quotes`); a request *without* a valid Access session is rejected; the secret never appears in any client asset (`grep` the built `dist/` for the secret value → 0 hits).

---

## 8. Open items to confirm (not blockers for starting)

1. **Cloudflare Access / Google SSO** must be configured on the Pages project (dashboard step). Confirm this is the intended "Google Authenticator login."
2. **`ims_jobs` freshness** — it's a 167-row snapshot in Supabase. The backend repo will confirm an LS sync keeps it current; if it's stale, the dropdown will instead point at the live Firebase `locumsmart/jobs` feed (the backend `list-jobs` would read that). Either way the page contract is unchanged.
3. **Where the hub lives** in this repo's routing (`/hub`, root, subdomain) — slot the page accordingly.

---

*Backend reference (read-only context): the dashboard repo's `.planning/phases/07-quote-regret-telemetry-parallel-start-earliest/` — CONTEXT.md (decisions D-01..D-13), 07-RESEARCH.md (edge-function patterns), 07-VERIFICATION.md (live deploy record). The function source lives at `supabase/functions/{log-quote,label-outcome,list-quotes}/` in that repo.*
