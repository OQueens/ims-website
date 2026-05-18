# IMS Website — Step 1: Backend Consolidation (Design Spec)

**Date:** 2026-05-18
**Status:** Approved (design); spec pending user review
**Worktree:** `.worktrees/feat-ims-temp-site` (branch `feat/ims-temp-site`)
**Author:** Claude (brainstorming session with Zach)

---

## 0. Status & Decision Record (read first)

- **The Belleval site is now the permanent, real production IMS site.** The
  "temporary / throwaway placeholder" framing in prior memory is **retired**.
  This decision is authoritative and supersedes every "temp site" note.
- **Phase 1.A (`feat/ims-phase-1a-content`, HEAD `801656d`) is retired.** Its
  dark "IMS Dark System" UI is abandoned. Its *backend plumbing* (LocumSmart
  receiver, `ims_jobs` schema, Supabase client, job-board SSR read, privacy
  contract) is **extracted into the Belleval codebase** ("Approach A",
  user-approved). The Phase 1.A worktree is left **intact as a read/extract
  reference** — not modified, not deleted, no destruction without explicit
  user go.
- **Scope decision:** the website **consumes the existing Supabase `ims_jobs`**
  the webhook already populates. **No new LocumSmart pull-API integration** in
  this step (explicitly deferred as a possible later initiative).

---

## 1. Problem & Goal

Two divergent copies of the IMS site exist:

- **Phase 1.A** — working plumbing (LocumSmart → Supabase `ims_jobs` → SSR
  `/jobs`), old dark design, ~2 wired pages.
- **Belleval** — the approved cream quiet-luxury design, all 8 pages, but
  **100% fabricated content** and **zero backend** (pure-static Astro 6, one
  dep, no adapter; a Cloudflare Pages Function handles the Resend contact form).

**Goal of Step 1:** give the Belleval codebase the real LocumSmart data
backbone by relocating Phase 1.A's proven, tested backend into it — without
rewriting the security-sensitive code, and without changing Belleval's approved
visual design or its 8 prerendered pages.

This is **Step 1 of a 6-step program** (see §9). Step 1 delivers the data
*backbone only*; it does not itself replace fabricated copy (that is Step 2+).

---

## 2. Program Decomposition (context)

| # | Step | Spec |
|---|------|------|
| **1** | **Backend consolidation (THIS SPEC)** | this doc |
| 2 | Data wiring — homepage specialty counts + featured assignments; clinicians/facilities live stats; `/jobs` filter/search UX polish (the SSR `/jobs` itself ships in **Step 1**) | future |
| 3 | Real team — scrape `iastaffing.com` → real founders/ops/recruiting, replace the 5 invented people | future |
| 4 | Non-LS content — disposition of E (Charleston city-guide Pamphlet), F (weekly-report mock), A (company stats Zach confirms) | future |
| 5 | Critique/audit fix campaign — em-dash sweep, members-club scrub, a11y/contrast, contact form-data-loss, CTA/`tel:` wiring | future |
| 6 | `impeccable live` polish on the homepage (on real content) | future |

Each later step is its own brainstorm/spec/plan cycle. Step 1 must not bleed
into them.

---

## 3. Step 1 Scope

### In scope
- Add `@astrojs/cloudflare` adapter + `@supabase/supabase-js` to Belleval.
- Set `astro.config.mjs` to `output:'static'` + `adapter: cloudflare()` (Astro
  "static with on-demand routes" — only `prerender=false` routes run on the
  Worker; the 8 designed pages stay prerendered/unchanged).
- Relocate, **verbatim where possible**, from Phase 1.A:
  - `src/lib/locumsmart-webhook-logic.ts` + `src/lib/locumsmart-webhook-logic.test.ts`
  - `src/pages/api/locumsmart-webhook.ts`
  - `migrations/20260508_ims_jobs_table.sql`, `migrations/20260506_ims_phase1_tables.sql`
    (schema already applied to the live Supabase project; carried for the record/repro)
- Establish a Supabase read client + the **public/internal privacy-render
  contract** for `ims_jobs` reads (the exact contract Phase 1.A's `/jobs` uses).
- Make `/jobs` a server-rendered (`prerender=false`) page in the Belleval design
  that lists `ims_jobs WHERE status='active'` through the privacy contract.
- Port the vitest suite; add a privacy-contract assertion test.
- Verify the LocumSmart "Website" subscription + Cloudflare env wiring
  (status currently **unknown** — see §7, §8).

### Out of scope (later steps / explicitly excluded)
- Replacing fabricated homepage/clinicians/facilities copy with live data
  (Step 2).
- Real team content (Step 3). City-guide / report-mock / company-stats
  disposition (Step 4). The em-dash / members-club / a11y / contact
  form-data-loss fixes (Step 5). `impeccable live` (Step 6).
- Belleval's existing Resend **contact** Pages Function — **left working
  exactly as-is.** Cloudflare Pages Functions and the Astro adapter Worker
  coexist (Pages runs `/functions/*` first, then the Astro Worker). Migrating
  contact to an Astro route + adding Supabase-persist durability (which also
  fixes the critique's P1 contact form-data-loss) is **Step 5**, not here.
- Any new LocumSmart pull-API client.

---

## 4. Runtime Architecture Decision

**Decision:** adopt the **Astro `@astrojs/cloudflare` adapter** model in
Belleval (identical to Phase 1.A). Rationale:

1. **Reuse, don't rewrite, the security-sensitive code.** The webhook receiver
   enforces token auth (constant-time), a freshness/idempotency guard, secret
   redaction, and the public/internal privacy derivation. Rewriting it as a
   Cloudflare Pages Function would re-introduce risk into precisely the code we
   least want to re-risk. The Astro-route shell ports verbatim.
2. **SSR is required anyway.** The site is **zero-client-JS by design** (CSP has
   no `script-src`). Live data must therefore be **server-rendered**, not
   client-fetched. Astro's adapter is the cleanest SSR path and Phase 1.A
   already proves it on this exact Cloudflare Pages stack.
3. **One model, not two.** Astro routes/pages for app logic; the lone existing
   Pages Function (contact) is left untouched until Step 5 unifies it.
4. **The 8 designed pages are unaffected** — they remain prerendered static
   HTML (`prerender` defaults to true under `output:'static'`); only data
   routes opt out.

Rejected alternatives: rewrite the receiver as a Pages Function (re-risks
security code, splits the model); keep Belleval pure-static and client-fetch
(violates the zero-JS design principle).

---

## 5. Inventory — What Moves, What's Added

**Relocated from Phase 1.A (verbatim or near-verbatim):**

| File | Change on move |
|------|----------------|
| `src/lib/locumsmart-webhook-logic.ts` | verbatim (pure, runtime-agnostic) |
| `src/lib/locumsmart-webhook-logic.test.ts` | verbatim |
| `src/pages/api/locumsmart-webhook.ts` | verbatim (`prerender=false`, reads `locals.runtime.env`) |
| `migrations/20260508_ims_jobs_table.sql` | verbatim (record of applied schema) |
| `migrations/20260506_ims_phase1_tables.sql` | verbatim (applications/contact tables — used in Step 5) |

**New in Belleval:**

- `astro.config.mjs` — `output:'static'`, `adapter: cloudflare()`, `site` set.
- `package.json` — add `@astrojs/cloudflare`, `@supabase/supabase-js`
  (pin to the versions Phase 1.A proved: `@astrojs/cloudflare@^12.6.13`,
  `@supabase/supabase-js@^2.105.4`); add `vitest` (+ `zod`,
  `@cloudflare/workers-types`, `miniflare`) as devDeps for the ported test.
- A Supabase read helper + the **privacy-render contract** for `ims_jobs`
  (mirrors Phase 1.A `/jobs`), consumed by the reskinned Belleval `/jobs`.
- A reskinned, server-rendered `/jobs` page in the Belleval design.
- A privacy-contract assertion test (see §10).

**Astro version note:** Phase 1.A is Astro 5; Belleval is Astro 6. The adapter
+ supabase-js are Astro-version-independent, but the build/SSR config and any
adapter API drift between Astro 5→6 **must be verified** during implementation
(not assumed). This is a tracked risk (§9).

---

## 6. Data Flow & the Privacy Contract (top risk area)

```
LocumSmart  --POST /api/locumsmart-webhook (token in body, constant-time)-->
  validatePayloadShape --> constantTimeEquals(key, LOCUMSMART_WEBHOOK_SECRET)
  --> mapToImsJobsRow (redact secret, derive public-safe label, normalize
      specialty slug, compute duration) --> atomic conditional UPSERT
      (freshness guard) --> Supabase `ims_jobs`
Belleval SSR pages --> service-role read of `ims_jobs WHERE status='active'`
  --> render ONLY public fields --> prerendered-looking HTML at the edge
```

**The privacy contract is non-negotiable and is the single highest risk.**
`ims_jobs` deliberately separates:

- **INTERNAL (never rendered publicly):** `facility_name`, `facility_names`,
  `description` (LS payloads empirically embed facility name, phone numbers,
  and explicit "vendors must NOT contact the facility" disclaimers),
  `raw_payload`, contact emails.
- **PUBLIC (safe to render):** `public_facility_label` (derived type label,
  e.g. "Level 1 Trauma Center"), `public_description` (recruiter-scrubbed;
  may be NULL → omit the block), specialty/dates/duration/requirements.

Any Belleval surface that shows assignment data (the future homepage featured
block in Step 2, and `/jobs` in Step 1) must render **only** PUBLIC fields.
Mitigations:
- Port Phase 1.A's exact render selection (no ad-hoc re-derivation).
- A Supabase read helper that **selects only public columns** (deny-by-default;
  internal columns are never put in the select list).
- An automated test asserting no internal field value can reach rendered HTML
  (§10).
- Codex review of the port (mandate; this is security-sensitive → 3 rounds).

---

## 7. SSR vs Static Page Matrix

| Route | Step 1 mode | Why |
|-------|-------------|-----|
| `/jobs` | **SSR (`prerender=false`)** | live `ims_jobs` list |
| `/api/locumsmart-webhook` | **SSR endpoint** | receiver |
| `/` (homepage) | static in Step 1; **becomes SSR in Step 2** | live specialty counts + featured assignments are Step 2 |
| `/clinicians`, `/facilities` | static in Step 1; stat numbers wired in Step 2 | same |
| `/story`, `/contact`, `/thank-you`, `/couldnt-send` | **static (unchanged)** | no live data |

Step 1 only flips `/jobs` + the webhook endpoint to SSR. Homepage/clinicians/
facilities SSR conversion is Step 2 scope (kept out to bound Step 1).
SSR data pages get edge cache headers (short TTL) so "live" does not mean
"slow" — exact TTL decided in Step 2 when those pages are wired.

---

## 8. LocumSmart Subscription Requirement

**New requirement captured from Zach (2026-05-18):**

- An existing LocumSmart subscription posts jobs **to Slack, filtered to
  specific specialties only**. That subscription is **not** the website's.
- The **website requires its own LocumSmart subscription with NO specialty
  parameter filter — every specialty** (the site is a full multi-specialty
  board, not anesthesia-only).
- Whether the website "Website" subscription exists and points at the live
  webhook URL, and whether the Supabase env vars are set on the Cloudflare
  Pages project, is **UNKNOWN**. Verification is an explicit task in the Step 1
  plan, not an assumption.

Until the unfiltered "Website" LS subscription is live and pointed at the
deployed webhook, the pipeline is correct but `/jobs` renders the (dignified)
**empty state**. That is expected behavior, not a defect.

---

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Privacy-contract leak (internal facility data rendered) | **Critical** | port exact contract; public-only select helper; assertion test; 3-round Codex |
| Astro 5→6 adapter / SSR API drift | High | verify adapter config against Astro 6 docs during impl; build + curl gate before claiming done |
| LS "Website" subscription not wired / wrong filter | High (operational) | §8 verification task; empty-state is acceptable interim; flag to Zach |
| Supabase env vars absent on Pages project | High (operational) | verification task; receiver already 500s safely on missing env (LS retries heal it) |
| Pages Function (contact) vs Astro Worker routing conflict | Medium | `/functions/*` takes precedence on CF Pages; verify `/api/contact` still resolves to the Function and `/api/locumsmart-webhook` to the Astro route; curl both |
| Secret sprawl (service-role key, LS secret) | Medium | env-only, never in client bundle; receiver redacts `key` from `raw_payload`; never echo secrets |
| Scope creep into Steps 2–6 | Medium | §3 scope guard; data wiring/copy explicitly excluded |

---

## 10. Testing Strategy

1. **Port `locumsmart-webhook-logic.test.ts`** — must pass unchanged in
   Belleval (proves the pure logic survived the move).
2. **Privacy-contract assertion test (new):** given a representative
   `ims_jobs` row containing internal facility name + raw description with a
   phone number, assert the `/jobs` render output (HTML string) contains the
   `public_facility_label` and contains **none** of: `facility_name`,
   `facility_names`, `description` raw text, payload phone numbers.
3. **Build gate:** `npx astro build` green (8 static pages + SSR routes).
4. **Runtime gate:** `npx astro preview` (or wrangler/miniflare) →
   - `curl POST /api/locumsmart-webhook` with a captured sample payload + the
     real secret → 200 + row in Supabase; wrong key → 401; missing env → 500.
   - `curl /jobs` → 200, renders empty-state OR live rows with only public
     fields.
   - `curl /api/contact` (the existing Resend Function) → still works (no
     regression from the adapter addition).
5. **Codex review** of the relocated receiver + the read helper +
   privacy-render (security-sensitive → 3 rounds per the collaboration
   mandate).
6. No success claim without a verification tag (`[runtime-verified]` etc.).

---

## 11. Operational Dependencies on Zach (flagged, not blocking the build)

1. Create / confirm the LocumSmart **"Website" subscription**: **no specialty
   parameter (every specialty)**, pointed at the deployed
   `/api/locumsmart-webhook` URL, with its Webhook Key.
2. Confirm/set Cloudflare Pages env on the `ims-website` project:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOCUMSMART_WEBHOOK_SECRET`
   (= the "Website" subscription's Webhook Key).
3. These can lag the build — the pipeline ships correct and renders empty-state
   until they're done. The plan will produce a precise checklist for Zach.

---

## 12. Assumptions

- The Supabase project that Phase 1.A's migrations were applied to is the same
  project the Belleval production deploy will use (single source of truth). To
  be confirmed during the §8 verification task.
- `ims_jobs` schema is already applied to that Supabase project (Phase 1.A
  notes say so); migrations are carried for repro/record, not necessarily
  re-run.
- No commit/push of any code or this spec without Zach's explicit go (standing
  user rule; overrides the brainstorming skill's "commit the design doc" step).
- Belleval's design system (`ims.css` Belleval tokens) is the canonical visual
  language for the reskinned `/jobs`; only logic/contract is ported, not
  Phase 1.A's dark styles.

---

## 13. Definition of Done (Step 1)

- Adapter + supabase-js added; `astro build` green with 8 static pages intact.
- Webhook receiver relocated, ported tests pass, privacy assertion test passes.
- `/jobs` server-renders from `ims_jobs` in the Belleval design through the
  public-only contract; empty-state correct when no data.
- Existing Resend contact Function verified non-regressed.
- LS/Supabase wiring status verified and reported (wired → live rows; not
  wired → documented checklist for Zach + correct empty-state).
- Codex-reviewed (3 rounds, security-sensitive); all findings folded.
- Nothing from Steps 2–6 implemented.
- No commit/push without explicit go.
