# Recruitment & Credentialing Pipeline — Design Spec

**Date:** 2026-07-05
**Status:** Approved design — ready for implementation planning
**Branch:** `redesign/v5-reskin` (feature branch — no auto-deploy)
**Surface:** IMS Hub (`imstaffing.ai/hub`, served by `ias-website`)
**Author intent:** Zach wants a new hub section to track providers from first contact through placement, with credentialing progress visible in parallel — built to feel premium.

---

## 1. Summary

A new left-nav hub section that tracks each provider on **two parallel tracks at once**:

- **Recruitment** — a single position on a drag-and-drop pipeline: Warm Leads → Active Bids → Accepted Bids → Needs Onboarding → Placed/Working.
- **Credentialing** — a 6-item multi-select checklist that runs alongside recruitment from day one (a warm lead can already be collecting documents).

Both tracks live on **one board**. Each provider is a card that shows recruitment position (by lane) and a live credentialing meter (baked onto the card). Clicking a card opens a **focus-spotlight dossier** with full contact, quick actions, the full checklist, and notes.

The feature is a faithful clone of the existing **Weekly Sync** collaboration spine (Supabase table + atomic Postgres RPC + optimistic op-based edits + polling), so ~80% of the engineering is a proven port; the new work is the pipeline data model and the visual layer.

---

## 2. Goals

1. One place to see every provider's recruitment stage **and** credentialing status simultaneously.
2. Fast, delightful daily use: drag cards between stages, tick credentialing statuses, glance progress.
3. Real-time multi-recruiter editing with attribution (who did what, when).
4. Premium, native-to-the-hub visual quality (dark Magenta-Noir theme).
5. Honest data — no fabricated/auto-seeded records.

## 3. Non-goals (explicitly out of v1)

- Auto-syncing recruitment stages from LocumSmart (that data is facility *demand*, not candidate bids — auto-feeding would be fabrication).
- A full audit-history timeline per provider (last-writer + per-status attribution only in v1).
- Per-role permissions (any hub user can edit).
- Drag-reordering *within* a lane (cards sort by most-recently-updated).
- A separate/second "Credentialing" view — credentialing lives on the card + spotlight only.

---

## 4. Locked design decisions

| Area | Decision |
|------|----------|
| Board style | **Vivid** (colored stage pills, avatars, live 6-dot credentialing meter on each card) |
| Layout | **Single board**, credentialing baked onto every card, running in parallel with recruitment |
| Detail reveal | **Focus-spotlight dossier** — click a card → board blurs, card scales up centered |
| End states | **Placed/Working** terminal lane + off-board **Archive** for lost/inactive |
| Second view | None — one board only |
| Multi-user | Anyone in the hub can edit; every change stamped with who + when |
| Data origin | Manual entry (greenfield); optional manual link to a LocumSmart job for context |
| Store | Supabase (Postgres) + atomic RPC, op-based, polling — clone of Weekly Sync spine |

---

## 5. UX specification

### 5.1 Navigation & placement

- Add one nav button to **`src/components/hub/HubSidebar.astro`** under the `Desk` group: `<button class="hub-nav__item" data-view="pipeline">` with a users/clipboard SVG icon and label **"Pipeline"**.
- Topbar title: **"Recruitment & Credentialing"** (add to the `VIEW_TITLES` map in `src/components/hub/hub-client.ts`).
- Rendered as one `<section class="hub-view" data-view="pipeline">` (hidden/shown by the existing `showView()` mechanism — no router).

### 5.2 The board

- **Five lanes**, left to right: **Warm Leads → Active Bids → Accepted Bids → Needs Onboarding → Placed/Working.**
- Each lane header: a colored stage pill (mono uppercase) + a live count.
- Lane accents are drawn only from the **locked hub palette** (no new colors) — a distinct accent per stage so lanes read at a glance. The **Placed lane** uses the hub's established positive/"done" treatment (the same cyan family used for completed credentialing) so it reads as a destination, and it highlights as a drop target during drag. Exact per-lane color mapping is finalized at build against the real tokens in `hub.css` / `colors_and_type.css`.
- Horizontal scroll if lanes overflow.
- Cards sort within a lane by `updated_at` descending (most recently touched on top).

### 5.3 Drag-and-drop

- Cards drag between lanes with real motion: lift (scale + shadow), slight tilt, and a spring/FLIP settle on drop.
- Dropping into a lane issues a `moveStage` op (optimistic move + server persist).
- Dropping into **Placed/Working** also checks the **Provider Working** status (see coupling rule §7.3).
- Library: **`@atlaskit/pragmatic-drag-and-drop`** (framework-agnostic, tiny, vanilla-TS friendly, bundled by Vite — no CSP change) with **SortableJS** as fallback. Final pick at build time; must degrade to click-to-move buttons if a user prefers no-drag / a11y.

### 5.4 The card (front)

Top → bottom, visually two zones separated by a dashed divider:

1. **Identity zone (recruitment):** avatar (initials), name (display serif), specialty pill, state.
2. **Credentialing zone:** a labeled 6-segment meter + "N/6" count + current-milestone label. Cyan fill = done.
3. **Footer:** recruiter-owner (avatar chip + name).

The gold folded-corner from earlier mockups is **removed** (peel metaphor dropped).

### 5.5 Focus-spotlight dossier (reveal)

- Clicking a card → the board dims + blurs and a centered dossier scales up (`scale .9→1`, fade), close via ✕ or click-outside.
- Contents:
  - Header: avatar, name, specialty · state · stage · owner.
  - Quick actions: **Call / Email / Text** (use `tel:` / `mailto:` / `sms:` from stored phone/email).
  - Contact rows: phone, email.
  - Linked job (if set): facility label · job number · start date (read-only context pulled from `ims_jobs`).
  - **Credentialing checklist:** all 6 statuses as multi-select chips; ticking any issues a `toggleChecklist` op and shows who/when.
  - **Notes:** free-text (sanitized), editable.
  - Actions: change owner, edit fields, **Archive** / **Restore**.

### 5.6 Credentialing statuses (6, multi-select, independent)

`Collecting Documents · Needs Contract · Start Dates Booked · Credentialing Started · Credentialing Complete · Provider Working`

- Independent booleans, tickable in any order.
- Each toggle stamps attribution: `checklist_audit[item] = { by: email, at: timestamp }`.

### 5.7 Add person

- A `+ Add` affordance at the top of each lane (and/or a board-level "+ Add provider").
- Opens a compact form: name (required), specialty, state, phone, email, owner (defaults to current user), target start date, notes. Stage defaults to the lane it was added from.
- Issues a `createPerson` op.

### 5.8 Archive

- Archiving sets `stage = 'archived'`; the card leaves the active board but remains searchable/restorable.
- An "Archive" filter/list surfaces archived people; Restore returns them to a chosen stage.

### 5.9 Empty / loading / error states

- **Empty board:** honest "No providers yet — add your first" per lane (the board starts empty; nothing is seeded).
- **Table missing in prod** (migration not yet applied): degrade gracefully to an empty board, no crash (mirror the sync path's tolerance).
- **Save failure / expired session:** surface a "sign-in expired / not saved" chip; never silently succeed (mirror `sendOp` 401/redirect handling).

### 5.10 Motion & polish

- Card hover lift; drag lift/tilt/settle; spotlight scale-in; meter fill transitions; Placed-lane drop glow.
- Respect `prefers-reduced-motion` (reduce transforms).

---

## 6. Data model

New migration: **`migrations/20260705_hub_pipeline.sql`**. Mirror the conventions in `migrations/20260615_hub_weekly_sync_v3.sql` (RLS on, no public policy, service-role only, `SECURITY DEFINER` RPC with `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`).

```sql
CREATE TABLE hub_pipeline_people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Recruitment track: exactly one position. 'placed' is the terminal working
  -- lane; 'archived' is off-board (lost/inactive, still searchable).
  stage         text NOT NULL DEFAULT 'warm_lead' CHECK (stage IN (
                  'warm_lead','active_bid','accepted_bid',
                  'needs_onboarding','placed','archived')),

  -- Person / role
  full_name        text NOT NULL,
  specialty_slug   text,   -- reuse the canonical specialty slug set used by
  specialty_name   text,   -- ims_jobs (copy its CHECK verbatim — verify exact
                           -- values against the ims_jobs migration at build time)
  state            text,

  -- Contact
  phone         text,
  email         text,

  -- Ownership + timing
  owner_email        text,
  target_start_date  date,

  -- Optional soft link to a real requisition (recruiter attaches; NOT auto-fed).
  -- No FK: ims_jobs rows archive and must not cascade. Cache a label for display.
  assignment_id       uuid,
  assignment_number   text,
  assignment_label    text,

  -- Credentialing track: 6 independent multi-select flags (typed, not jsonb →
  -- queryable, constraint-safe, no fabrication).
  chk_collecting_docs        boolean NOT NULL DEFAULT false,
  chk_needs_contract         boolean NOT NULL DEFAULT false,
  chk_start_dates_booked     boolean NOT NULL DEFAULT false,
  chk_credentialing_started  boolean NOT NULL DEFAULT false,
  chk_credentialing_complete boolean NOT NULL DEFAULT false,
  chk_provider_working       boolean NOT NULL DEFAULT false,

  -- Per-item attribution: { "chk_needs_contract": {"by":"…","at":"…"}, … }
  checklist_audit  jsonb NOT NULL DEFAULT '{}'::jsonb,

  notes         text,

  -- Optimistic-concurrency + audit (mirror hub_weekly_sync.version/updated_by)
  version       int NOT NULL DEFAULT 0,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hub_pipeline_stage_idx
  ON hub_pipeline_people (stage) WHERE stage <> 'archived';
CREATE INDEX hub_pipeline_updated_idx
  ON hub_pipeline_people (updated_at DESC);

ALTER TABLE hub_pipeline_people ENABLE ROW LEVEL SECURITY;  -- no public policy
```

Plus RPC **`hub_pipeline_apply(p_op jsonb, p_email text)`** mirroring `hub_sync_apply`: take a `pg_advisory_xact_lock` on the person id, read `FOR UPDATE`, apply exactly one op, bump `version` only when the row actually changes, `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`. **Read `migrations/20260615_hub_weekly_sync_v3.sql` and copy its structure.**

---

## 7. Operations (op algebra)

Defined in **`src/lib/hub/pipeline-ops.ts`** (mirror `src/lib/hub/sync-ops.ts`). The pure `applyOp(state, op, email)` is the single source of truth used three ways: client optimistic UI, vitest oracle, and the SQL RPC.

### 7.1 Op set

- `createPerson { full_name, stage?, specialty_slug?, specialty_name?, state?, phone?, email?, owner_email?, target_start_date?, notes? }`
- `updateField { id, field, value }` — for name/specialty/state/phone/email/owner_email/target_start_date/notes/assignment link
- `moveStage { id, stage }`
- `toggleChecklist { id, item, value }` — item ∈ the 6 `chk_*`; stamps `checklist_audit[item]`
- `archivePerson { id }` → `stage = 'archived'`
- `restorePerson { id, stage }` — from archive back to a live stage

### 7.2 Validation (in `src/lib/hub/pipeline-data.ts`, mirror `sync-data.ts`)

- `STAGES`, `CHECKLIST_ITEMS` constants; field caps; `full_name` required + length cap; sanitize free-text `notes` via the existing `sanitizeHtml`/`escapeText` from `sync-data.ts`.

### 7.3 Stage ⟷ Provider-Working coupling (defined, not ambiguous)

The `placed` stage and the `chk_provider_working` flag are kept in **lockstep**:

- `moveStage → placed` sets `chk_provider_working = true` (stamps audit).
- `moveStage` out of `placed` to an earlier stage sets `chk_provider_working = false`.
- `toggleChecklist { provider_working, true }` sets `stage = 'placed'` (if currently an earlier stage).
- `toggleChecklist { provider_working, false }` while `stage = 'placed'` moves `stage → needs_onboarding`.

The other 5 checklist items never affect stage.

---

## 8. API endpoint

**`src/pages/hub/api/pipeline.ts`** (clone `src/pages/hub/api/sync.ts`):

- `GET /hub/api/pipeline?view=active` → all non-archived people (`view=archived` → archived list). Returns `{ people: [...], serverTime }`.
- `POST /hub/api/pipeline` → body = one op → re-derive `email` from the `hub_session` cookie (server authoritative — never trust a client-supplied author) → `supabase.rpc('hub_pipeline_apply', { p_op, p_email })` → echo `{ person, version }`.
- Reads/writes go through `getHubSupabase()` (service-role, server-side only).
- Tolerant of a missing table → empty result (graceful degrade).

**Middleware:** `/hub/api/pipeline` is automatically protected by `isHubProtectedPath` and is already exempt from trailing-slash/canonical redirects (`middleware-logic.ts`) — do not add new redirect rules. Client `fetch` must use `credentials:'same-origin'` + `redirect:'manual'` and treat 401/opaque-redirect as "sign-in expired" (copy `sendOp` in `hub-client.ts`).

---

## 9. Client architecture

- **`src/components/hub/PipelineView.astro`** (mirror `SyncView.astro`): renders `<section class="hub-view" data-view="pipeline">` with the board container, an empty state, and an SSR `<script type="application/json">` island carrying the initial `people` + `me` (current user email).
- **`src/components/hub/pipeline-client.ts`** (mirror the `weeklySync()` IIFE in `hub-client.ts`): hydrate from the island; render lanes + cards; wire drag (→ `moveStage`), card click (→ spotlight dossier), chip toggles (→ `toggleChecklist`), add-person (→ `createPerson`), archive; run the poll loop (~4s `GET`), adopt-by-id with per-row `version` monotonicity guard; optimistic local apply via the shared `applyOp`; localStorage mirror + save-status chip. Import it from `index.astro`'s existing bottom `<script>` block.
- **`src/pages/hub/index.astro`**: import `PipelineView`, add the server-side Supabase read (parallel with the existing reads), render `<PipelineView people={…} me={me} />` inside `<main>`.
- **Styles:** append a `.pipe-*` block to `src/styles/hub.css` using existing tokens (`--surface`, `--rule`, `--ink*`, `--pop-magenta`, `--mn-cyan`, `--pop-butter`, `--space-*`, radius/shadow). No new colors.

---

## 10. Auth & attribution

- Current user is already available: `index.astro` verifies the `hub_session` cookie and derives `me = session.email`; pass it into `PipelineView`.
- Server is authoritative on attribution: the POST re-derives `email` from the cookie; the RPC stamps `updated_by` and `checklist_audit[item].by`. Only real observed identity is recorded (no fabrication).
- Display attribution reuses **`src/lib/hub/hub-roster.ts`** (email → name/initials/color) + `avatarHtml()` for avatar chips.
  - **Build-time follow-up:** `hub-roster.ts` keys are placeholder emails; populate real `@iastaffing.com` emails so avatars render names/colors, and confirm `HUB_ALLOWED_DOMAINS` covers all users.
- Access gating: any authenticated hub user can read/edit all pipeline data (no per-row scoping) — matches existing hub behavior.

---

## 11. Reuse map (clone from Weekly Sync)

| New file | Clone from |
|----------|-----------|
| `migrations/20260705_hub_pipeline.sql` | `migrations/20260615_hub_weekly_sync_v3.sql` |
| `src/lib/hub/pipeline-data.ts` | `src/lib/hub/sync-data.ts` |
| `src/lib/hub/pipeline-ops.ts` | `src/lib/hub/sync-ops.ts` |
| `src/pages/hub/api/pipeline.ts` | `src/pages/hub/api/sync.ts` |
| `src/components/hub/PipelineView.astro` | `src/components/hub/SyncView.astro` |
| `src/components/hub/pipeline-client.ts` | the `weeklySync()` IIFE in `src/components/hub/hub-client.ts` |

Merge/version helpers: reuse `src/lib/hub/sync-merge.ts` patterns for adopt/version guards. Sanitizers, `avatarHtml`, roster, and the topbar search plumbing are all reusable.

**Edit:** `HubSidebar.astro` (nav button), `index.astro` (import/render + SSR read + pass `me`), `hub-client.ts` (`VIEW_TITLES` entry + import pipeline-client), `hub.css` (`.pipe-*` block), `hub-roster.ts` (real emails).

---

## 12. Concurrency & sync model

- **Optimistic local write → atomic server op → version-guarded poll adoption**, entirely over Supabase + same-origin HTTP (no websockets, no CSP change).
- The RPC's advisory lock + `version` bump is the concurrency guarantee — never do read-modify-write from the endpoint.
- Two recruiters editing the same person are serialized safely; poll adoption drops stale snapshots via per-row `version` monotonicity.

---

## 13. Risks & gotchas

- **Migration is applied out-of-band by Zach.** The table won't exist in prod until he runs `20260705_hub_pipeline.sql`; the SSR read + endpoint must degrade to an empty board if it's missing.
- **Redirect hazard:** a 302 on a `fetch` POST silently swallows the body (the original "Weekly Sync didn't save" bug). Keep `/hub/api/pipeline` exempt and use `redirect:'manual'`.
- **RLS-on-no-policy is load-bearing:** the table must be reachable only via the service-role client; never query it from a client bundle.
- **No fabrication:** do not seed cards from `ims_jobs`/`ls_events`. Empty-until-a-recruiter-adds is the honest state.
- **Deploy discipline:** feature branch → no auto-deploy. SHOW-BEFORE-DEPLOY and explicit deploy authorization required before anything reaches `origin/main`.
- **Codex peer review** required on the non-trivial modules (ops, RPC, endpoint, client) per the standing in-band review loop.

---

## 14. Testing approach

- **Unit (vitest):** `pipeline-ops.test.ts` (op algebra incl. the stage⟷working coupling), `pipeline-data.test.ts` (validation/sanitize), following `sync-ops.test.ts` / `sync-data.test.ts`.
- **Integration:** an RPC parity test mirroring `sync-rpc.integration.test.ts` — the SQL RPC and the TS `applyOp` must agree byte-for-byte on every op.
- **Endpoint:** mirror `sync-endpoint.test.ts` (auth required, one-op-per-POST, echo shape, missing-table tolerance).
- **Manual:** drive the board in the hub — add, drag across lanes (incl. into Placed), tick statuses, open the spotlight, archive/restore, two-tab concurrency.

---

## 15. Build-time decisions (not blockers)

1. Final drag library pick (Pragmatic DnD vs SortableJS) + reduced-motion / click-to-move fallback.
2. Exact specialty slug set — copy the `ims_jobs` CHECK verbatim.
3. Real roster emails in `hub-roster.ts`.
4. Whether to include an optional `position` column for future in-lane manual ordering (default sort by `updated_at` in v1).

---

## 16. Future (v2+)

- Optional manual linking → richer read-only job context (incl. `estimated_credentialing_time`).
- Append-only audit-history log per provider.
- Auto-suggest from LocumSmart assignments (with a human confirm step — never silent).
- Per-role permissions (owner-only edits).
- In-lane drag-reordering.
