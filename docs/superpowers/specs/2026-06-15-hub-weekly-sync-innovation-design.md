# IMS Hub — Weekly Sync Innovation Pass — Design Spec

- **Date:** 2026-06-15
- **Status:** Design approved (Zach, 2026-06-15) — ready for implementation planning
- **Branch:** `feat/hub-weekly-sync-innovation` (off `hub-port` @ `3985020`; ships hub-port → `main` → prod `imstaffing.ai/hub`)
- **Builds on:** the shipped T1 Weekly Sync rebuild (live in prod). This spec is the ambitious pass *on top of* that working foundation.
- **Prior art / context:** `~/.claude/projects/.../memory/project_ims_hub_weekly_sync_rebuild_2026-06-15.md`

---

## 1. Goal & context

The Weekly Sync is a shared standup board for the **6-person IMS management team** (Zach, Donovan, Chad, Matt, Brent, Jon). It is used two ways: **live during the Monday 10:00 EST standup** (all six editing together) *and* as an **async whiteboard** the team returns to through the week to see "what everyone is driving." It is explicitly **not** a task tracker — no checkboxes / done-state.

Today's board (shipped T1) is solid but has two gaps this pass closes:

1. **It can silently lose edits.** Writes are blind whole-column upserts (`onConflict week_key,column_key`, last-writer-wins). With six people live in one column at 10am, one person's new focus can be overwritten with no error. This is a real data-loss hole, not a nicety.
2. **It shows lists, not people.** There is no attribution, presence, or live awareness — so it can't answer "who's doing what," which is the team's primary reason for using it.

**This pass delivers:** a lost-update-proof write engine, per-focus attribution, live presence, reactions, @mentions, "new since last look," carry-over, drag-reorder, links, keyboard-first capture, an optional AI weekly rollup, and (Phase B) true sub-second Realtime with live cursors — all while keeping the database **sealed server-side** (no public anon-key read surface) and honoring Magenta Noir.

### Non-goals (explicitly out of scope)
- **No checkboxes / done-state / completion tracking** (Zach's explicit call — it's a whiteboard).
- No public/anon DB exposure. The browser never reads the DB directly.
- No change to the marketing site, the V5 reskin, or any non-hub surface.
- No port of the old IAS hub sync ("corrupted/wonky" — build fresh).

---

## 2. Approved decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Usage | Live Monday 10am standup **+** async whiteboard through the week |
| Team | Fixed roster of 6 (management) → presence + avatars are high-signal |
| Done-state | **None** — no checkboxes; living whiteboard |
| Headline feature | **Per-focus attribution** ("see who's doing what") |
| Architecture | **Hybrid**: server-only correctness + presence core first (Phase A), true Realtime as a private-token layer (Phase B), AI rollup (Phase C) |
| DB exposure | **Never.** No public anon key; Realtime uses minted private-channel tokens, not `postgres_changes` |
| AI rollup | **In** — on-demand button (no cron), Claude Haiku, hard circuit-breaker |
| @mention pings | On-board + in-hub notification center; **no** external Slack/email ping by default |

---

## 3. Verified design decisions (adversarial-hardened)

A 5-pillar research + adversarial-verification pass (11 agents) ran against current authoritative docs. **All five hold; none refuted.** Key corrections folded in below.

### 3.1 Write protocol — **atomic Postgres RPC, not app-level CAS** (corrected)
Original plan was TypeScript compare-and-swap. The adversarial review overturned it: CAS leaves the cross-column "move a focus from Recruiting to Operations" non-atomic and invites retry storms with 6 concurrent editors. **Final: one `SECURITY DEFINER` Postgres function** applies a single operation in one transaction under an advisory lock. Provably lost-update-free, one round-trip.

### 3.2 Realtime — feasible via minted private-channel JWT (no anon exposure)
Mint a short-lived JWT server-side for our cookie-only Google-OAuth staff, connect a **private** Realtime channel per week using **Broadcast + Presence only** (no `postgres_changes`, no DB reads leaked). The persistence path is unchanged; Realtime is a pure awareness/signal bus. **#1 open risk:** must confirm the project still signs JWTs with **HS256** (legacy symmetric secret) vs **ES256** (asymmetric, default for projects created after Oct 2025) — ES256 changes the signing code. Resolve before building Phase B.

### 3.3 AI rollup — Anthropic API from a Worker, atomic breaker
Server-side `fetch` to `api.anthropic.com/v1/messages`, model `claude-haiku-4-5`, single non-streaming call, on-demand only. Circuit breaker must be **atomic** (one SQL statement), not check-then-act. Structured-output schema must avoid `maxItems`/`maxLength` (Anthropic rejects them). Cap path returns `200 {limited:true}`, never 4xx (the client treats 401 as sign-out).

### 3.4 Collab UX Tier-1 — ships on existing infra, zero new secrets
Attribution, soft presence, reactions, @mentions, "new since last look" all ride the existing poll + the new write engine. The HTML sanitizer **strips all attributes**, so attribution/reaction/mention chrome renders as **separate DOM nodes from typed Focus fields**, never embedded in sanitized HTML.

---

## 4. Data model v3

Same `hub_weekly_sync` table, same `items` jsonb (stored as the **sections array** to satisfy `CHECK jsonb_typeof(items)='array'`). The focus and section gain typed metadata fields:

```ts
interface Focus {
  id: string;            // [A-Za-z0-9_-]{3,40}
  html: string;          // sanitized rich text (existing allowlist + <a> — see §7.7)
  by: string;            // author email (SERVER-STAMPED — see §6.3)
  createdAt: number;     // unix seconds, server-stamped
  editedBy?: string;     // last editor email, server-stamped on change
  editedAt?: number;
  reactions?: Record<string, string[]>;  // emoji -> [email]; bounded
  mentions?: string[];   // [email]; bounded; derived server-side from html
}
interface Section {
  id: string;
  title: string;         // escaped plain text, <= 80 chars
  by?: string;           // creator email
  focuses: Focus[];      // order = array order
}
interface ColumnData { v: 3; sections: Section[] }   // persisted as `sections` array
```

**Migration & backward-compat (load-bearing):**
- `readColumn` upgrades **v1** (`string[]`) and **v2** (sections without `by`/`reactions`) → v3 on read. Missing `by` → `null`/`"unknown"`; missing timestamps → omitted. The live prod `2026-W25` row and all history keep rendering.
- New DB column: `ALTER TABLE hub_weekly_sync ADD COLUMN version int NOT NULL DEFAULT 0;`
- Update the stale comment in `migrations/20260607_hub_weekly_sync.sql` line 17 ("array of strings") to describe the v3 sections array.
- Caps mirror existing bounds: `MAX_SECTIONS=16`, `MAX_FOCUSES=50`, `MAX_HTML_LEN` raised only if links need it (keep 2000), plus new `MAX_REACTIONS_PER_FOCUS` (e.g. 6 emoji × 6 users) and `MAX_MENTIONS_PER_FOCUS` (e.g. 6).

---

## 5. Write protocol — `hub_sync_apply` RPC (the correctness core)

### 5.1 Operations (all id-addressed, all idempotent under retry)
| Op | Shape | Idempotency rule |
|---|---|---|
| `upsertFocus` | `{col, sectionId, focus:{id,html}}` | set-by-id (create if absent) |
| `deleteFocus` | `{col, sectionId, focusId}` | remove-by-id (no-op if absent) |
| `setSectionTitle` | `{col, sectionId, title}` | set-by-id |
| `addSection` | `{col, section:{id,title}}` | set-by-id |
| `deleteSection` | `{col, sectionId}` | remove-by-id (no-op if absent) |
| `reorderFocus` | `{col, focusId, beforeId\|afterId}` | **anchor-relative** move; drop if anchor gone |
| `moveFocus` (cross-column) | `{fromCol, toCol, focusId, toSectionId, anchor}` | delete-from-source + insert-to-target, **both columns locked** in sorted order, one tx |
| `setReaction` | `{col, focusId, emoji, email, present:bool}` | **absolute** (never toggle — toggle re-applies wrong) |

`react` is `setReaction(present:true|false)`, **never** a toggle, so a retry is safe.

### 5.2 The function (PL/pgSQL, `SECURITY DEFINER`)
- `SET search_path = ''` and fully-qualify `public.hub_weekly_sync` (prevents search-path-hijack privilege escalation).
- `REVOKE EXECUTE ON FUNCTION ... FROM public, anon, authenticated;` (only `service_role` retains it — as sealed as the table).
- Acquire `pg_advisory_xact_lock(hashtext(p_week), hashtext(p_col))` (two-int4 form, consistently — covers the no-row-yet INSERT race that `FOR UPDATE` cannot; auto-releases at tx end). For `moveFocus`, lock **both** columns in sorted `column_key` order (deadlock-free).
- Read current `items` + `version`, apply the op to the jsonb, `UPDATE ... SET items=..., version=version+1, updated_by=:email, updated_at=now()`, `RETURNING items, version`.
- Server stamps `by`/`createdAt`/`editedBy`/`editedAt` (see §6.3) — never trusts client timestamps/authorship.

### 5.3 TypeScript oracle (testability)
Because CI has no Postgres (pure-TS vitest only; Codex win32-blocked), the merge logic also exists as a **pure TS `applyOp(column, op, ctx)`** that the PL/pgSQL mirrors behavior-for-behavior. The TS oracle is exhaustively unit-tested (every op, idempotency under double-apply, caps, cross-column move). An **integration test** runs the real op sequence against the live Supabase RPC on a throwaway week key (`9999-W99`) and asserts the result equals the oracle, then cleans up — same pattern as the shipped Playwright-vs-real-DB tests. (Decision: TS-oracle + real-DB integration over containerized PG in CI — matches the project's existing verification pattern. Flagged as an open item if Zach prefers a Supabase preview branch.)

### 5.4 Endpoint changes
- `POST /hub/api/sync` body changes from `{weekKey, columnKey, column}` (whole-column) to `{weekKey, op}` (single op). Server validates the op, calls the RPC via service-role, returns `{ok, items, version}`.
- The client `persist()` is rewritten to emit ops (not whole columns). **The GET/poll contract is unchanged** — keep the existing `pending`/`epoch`/`comparableCol` guards. If any incremental `.update().eq('version',n)` is ever used, it MUST chain `.select()` or a 0-row miss is silent.
- **Honest limit to state in the spec:** concurrent reorders of the same list resolve last-writer-wins on *order* (no data loss, but an order neither user fully intended). Inherent; acceptable for 6 users.

---

## 6. Feature layer — Phase A (no new secrets / CSP / paid services)

### 6.1 Roster of six
A hardcoded `HUB_ROSTER: Record<email, {name, color, initials}>`, seeded with the six. **Monogram initials only — no photo URLs** (`img-src` is `'self' data:`). Colors drawn from / harmonized with Magenta Noir; obey color rules: `--mn-black` initials on light/saturated hues, `--mn-cream` only on deep hues, **never cream-on-butter `#E8C465`** (fails WCAG), **no yellow+purple pairing**. Unknown emails degrade gracefully (derived initials + deterministic hashed hue). *Zach to confirm the six emails at build.*

### 6.2 Per-focus attribution (headline)
Each focus renders a small owner avatar (initials, owner hue) as a **sibling DOM node** (not in sanitized html), hover/long-press caption: "Added by Brent · Mon 10:04" (and "· edited by Chad" when `editedBy` differs).

### 6.3 Server-stamped authorship (anti-spoof — the correct call)
On `upsertFocus`, the endpoint compares the incoming focus to the stored one; for any **new or changed** focus it **overwrites `by`/`editedBy` with the authenticated session email** (available at the endpoint). Authorship is therefore trustworthy, not client-spoofable — the right call for a board whose whole point is "who's doing what."

### 6.4 Soft presence (poll-derived)
- `POST /hub/api/presence` heartbeat (~10s) upserts `{email, weekKey, editing:{col,sectionId,focusId}|null, lastSeen}` into a new `hub_presence` table (PK `email`; reads filter `lastSeen > now()-30s` → self-expiring, no cleanup job).
- The existing read poll returns the active roster → header **avatar stack of who's here** + a subtle "just updated" pulse on a column a teammate touched + a "Donovan is editing" hint on the focus being edited.
- Throttle/heartbeat respects the same `epoch`/`viewedWeek` guards. (True live cursors are Phase B.)

### 6.5 Reactions
A curated 6-emoji pill row on each focus (👍 🔥 👀 ✅ 💡 ❤️), rendered as sibling nodes from `Focus.reactions`. Click → `setReaction` op. **`comparableCol()` MUST be extended** to hash reactions + author/editor, or a teammate's reaction/attribution change never poll-adopts and is invisible to everyone — reactions simply don't function without this. Note: reaction writes ride the same debounce; two reactions to the same focus inside the debounce window can drop one (acceptable for 6 users; documented).

### 6.6 @mentions + in-hub notification center
- Typing `@` opens a roster picker; a mention persists inline as attribute-less `<mark>@Name</mark>` (sanitizer-safe) **plus** a typed `Focus.mentions:[email]` derived server-side.
- A **notification center** (a bell in the hub topbar) shows "you were mentioned in Recruiting" / "Chad reacted to your focus," computed from board state vs a per-user last-seen marker (localStorage + a lightweight server read). Self-contained — **no external integration**. (Optional future: a Slack ping reusing the existing `SLACK_WEBHOOK_URL`, server-side, behind a flag — explicitly deferred.)

### 6.7 "New since last look"
Subtle dots on focuses created/changed since the viewer last opened the board (per-user `lastViewedAt` in localStorage keyed by week, compared against `createdAt`/`editedAt`). Pure client; zero infra.

### 6.8 Carry-over
A "Pull from last Monday" action copies the previous week's focuses into the current (blank) week as a starting point. "Last Monday" = the newest `week_key` strictly `< currentWeek` from the `?list=1` set (**not** date arithmetic). New ids generated; `by` re-stamped to the puller or preserved (decide in plan — default: preserve original `by`, set a "carried over" marker).

### 6.9 Drag-reorder
Drag a focus within a section, between sections, and between columns. Emits `reorderFocus`/`moveFocus` ops (anchor-relative, §5.1) so concurrent reorders merge without data loss. Keyboard-accessible alternative (move up/down) for a11y.

### 6.10 Links + keyboard-first
- Clickable links: extend the sanitizer to allow `<a>` with a **strict `href` allowlist (http/https only)**, `rel="noopener noreferrer nofollow"`, no other attributes (XSS re-review required — see §7.7).
- Keyboard: Enter adds a focus / commits; Shift+Enter newline; arrow nav between focuses; `@` mention; fast capture flow.

---

## 7. AI "This week at a glance" — Phase C

### 7.1 Endpoint & model
`POST /hub/api/rollup` (prerender=false, under `/hub` guard). Raw `fetch` to `api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. Model **`claude-haiku-4-5`**, single non-streaming request, `max_tokens ≈ 900`. **No** `effort`/thinking budget (Haiku 400s on those). **No** prompt caching (system prompt < cache minimum; on-demand calls outrun the 5-min TTL). Server-side call → **do NOT** add `api.anthropic.com` to CSP `connect-src`.

> Build-time note: re-verify the exact Haiku model id + pricing via the `claude-api` skill / Anthropic docs before wiring (model ids and prices drift).

### 7.2 Prompt & output
- Strip board HTML → plain text **before** prompting (prompt-injection mitigation + a system instruction: "summarize only what is in the data; never invent").
- Input: the current week's three columns' sections/focuses + (optional) last Monday's snapshot for a "what changed" delta.
- Structured output schema = plain typed fields only — `{ glance: {recruiting, marketing, operations: string}, changed: string[] }`, `additionalProperties:false` on every object. **No `maxItems`/`maxLength`** (Anthropic rejects them); express caps as soft prompt instructions + `max_tokens`.
- Server-stamp `generatedAt` + `week` (don't trust the model).

### 7.3 Atomic circuit breaker (cost control — non-negotiable per cost rules)
- New table `hub_rollup_usage(day date PK, calls int NOT NULL DEFAULT 0, est_cost_usd numeric NOT NULL DEFAULT 0)`, RLS on / no public policy.
- Enforce the cap inside **one** statement via a `SECURITY DEFINER` RPC: `INSERT ... (day,calls) VALUES (current_date,1) ON CONFLICT (day) DO UPDATE SET calls = hub_rollup_usage.calls + 1 WHERE hub_rollup_usage.calls < :cap RETURNING calls;` — zero rows / no-op ⇒ **limited**, skip the Anthropic call. Increment **binds before** the API call (fail-closed).
- Defaults (env-overridable): **20 calls/day, 200/mo, ~$2/mo**. Monthly $ ceiling is advisory (lags one call); the call-count cap bounds spend first (~$0.005–0.01/call).
- Over-cap response: `200 {ok:true, limited:true, resetsAt}` with a friendly "rollup limit reached — resets tomorrow" — **never** 4xx/5xx.
- `env.ANTHROPIC_API_KEY` null (dev/preview) → friendly disabled state, mirror the `getHubSupabase`-null pattern; never throw.

### 7.4 Dependencies (Phase C)
- New CF Pages secret `ANTHROPIC_API_KEY` (+ `.dev.vars` local, gitignored) → add to `HubEnv`/`readHubEnv`.
- New table `hub_rollup_usage` + the atomic increment RPC → applied to prod Supabase.
- **Zach actions:** create the Anthropic key, set a workspace-level monthly spend limit in the Anthropic Console (provider-side backstop), approve the default caps, confirm button-triggered only.

---

## 8. True Realtime — Phase B (sub-second + live cursors)

### 8.1 Mechanism
- Mint a short-lived **HS256** JWT server-side at `POST /hub/api/realtime-token` for the authed hub user, signed with `SUPABASE_JWT_SECRET` using the existing `crypto-equal.hmac` (Web Crypto, Workers-safe; no `jsonwebtoken`/`node:crypto`).
- Required claims: `role:'authenticated'` **and** `aud:'authenticated'` (both mandatory), `sub`=UUIDv5(email) (stable `auth.uid()`), `email`, `iat`, `exp = now + ~900s` (short). `iss`/`ref` not required.
- Client: `createClient(url, RESTRICTED_PUBLISHABLE_KEY, { accessToken: async () => mintedToken, realtime:{...} })` — use the **`accessToken` async callback** (library handles refresh), not bare `setAuth` + a hand-rolled timer. Build the refresh path so a refresh **failure surfaces an error**, never silently degrades to a capped anon socket.
- Subscribe to a **private** channel `hub:weekly-sync:<weekKey>` using **Broadcast** (edit signals + cursor positions) + **Presence** (who's here). **No `postgres_changes`.** The DB is never read by the browser; `/hub/api/sync` remains the sole source of truth. A broadcast just tells clients "pull" or carries the patch.
- Lazy-import `RealtimeClient` into the hub island only (never an SSR path). Pin `@supabase/realtime-js` as a direct dep (~2.105.x). Throttle presence/cursors to ≤5 updates / 30s (Supabase per-client cap; rAF-batch cursors).

### 8.2 RLS on `realtime.messages` (the entire access surface — system table, RLS already on)
Two policies (SELECT + INSERT — Presence `track()` is an INSERT), scoped by `topic() LIKE 'hub:%'` **AND** `extension in ('broadcast','presence')` **AND** an email-claim predicate (`%@iastaffing.com` / `%@imstaffing.ai`) for defense-in-depth (topic-prefix alone trusts any holder of a minted authenticated token). Reserve the `hub:` topic prefix project-wide (realtime.messages RLS is global). **NEVER** add an `authenticated`-role policy to `hub_weekly_sync` or any app table (a leaked minted token would have that role's power).

### 8.3 CSP (the hard blocker — both files, in lockstep)
Add **both** `wss://<project-ref>.supabase.co` **and** `https://<project-ref>.supabase.co` (exact host, no wildcard) to `connect-src` in **both** `src/middleware-logic.ts` `SECURITY_HEADERS` **and** `public/_headers`. The https origin **is** required — `channel.send()` auto-falls back to an HTTPS POST during reconnect/pre-SUBSCRIBED windows, so wss-only silently drops edit signals exactly when the socket is flaky.
- **Close the verify-build gap:** `scripts/verify-build.mjs` currently asserts `default-src`/Plausible/Turnstile but **not** `connect-src` parity across the two files. Add an explicit assertion that both files carry the identical Supabase `connect-src` origins, or a Realtime CSP edit to one file silently passes CI and breaks only in prod.

### 8.4 Dependencies (Phase B)
- New server secret `SUPABASE_JWT_SECRET` — **but first confirm HS256 vs ES256** (§3.2 / §11). ES256 = a non-trivial rewrite (ECDSA-P256 via `crypto.subtle`, not the HMAC primitive).
- New env `SUPABASE_PUBLISHABLE_KEY` (restricted `sb_publishable_`, zero table grants; identifies the project at handshake only) → add to `HubEnv`/`readHubEnv` (currently only URL + service-role).
- Two RLS policy migrations on `realtime.messages` (prod Supabase).
- **Zach actions:** accept the hub's **first CSP egress beyond `'self'`** (low risk, exact-host); confirm Realtime is enabled (per-project toggle; ~1% of Pro's 500-connection quota for 6 seats, no incremental cost).

---

## 9. Security model (summary)

- **DB stays sealed.** Service-role only, server-side. The browser never reads the DB. Realtime (Phase B) uses Broadcast/Presence relays, not DB reads; its access is gated by RLS on `realtime.messages` + an email-claim predicate + short-lived minted tokens.
- **Authorship is server-stamped** (not client-trusted).
- **HTML is sanitized on write and render** via the existing idempotent allowlist; the `<a>` extension gets its own XSS review (§7.7 in §6.10).
- **All paid services have hard circuit-breakers** (AI rollup: atomic per-day/per-month caps + Anthropic Console spend limit). No spend increase without Zach's approval.
- **Secrets** are server-only env (`SUPABASE_JWT_SECRET`, `ANTHROPIC_API_KEY`); the publishable key is non-sensitive by design (zero grants).
- **Inputs bounded** (sections/focuses/reactions/mentions caps; emails validated `^[^\s@]+@[^\s@]+$`; ids `[A-Za-z0-9_-]{3,40}`).

---

## 10. Phasing, delivery & dependencies

| Phase | Scope | New secrets/infra | Zach actions | Buildable+testable solo? |
|---|---|---|---|---|
| **A — Correctness + collaboration core** | v3 model, `hub_sync_apply` RPC + `version` col, op-based writes, attribution (server-stamped), soft presence, reactions, @mentions + notification center, new-since-last-look, carry-over, drag-reorder, links, keyboard | `version` column + RPC + `hub_presence` table (prod DB migrations) | confirm roster emails; ship-to-prod go | **Yes** (real-DB via preview-passcode path) |
| **B — True Realtime** | minted-JWT private channel, Broadcast+Presence, live cursors, CSP egress, verify-build parity guard | `SUPABASE_JWT_SECRET`, `SUPABASE_PUBLISHABLE_KEY`, `realtime.messages` RLS | resolve HS256/ES256; provide secrets; accept CSP egress; enable Realtime | Partially (Zach-gated) |
| **C — AI rollup** | `/hub/api/rollup`, Haiku, atomic breaker, `hub_rollup_usage` | `ANTHROPIC_API_KEY`, `hub_rollup_usage` table + RPC | create key; set Console spend limit; approve caps | Partially (Zach-gated) |

**Phase A is the heart and depends on nothing external** — build, harden to flawless, then ship on Zach's go. B and C are clean bolt-ons gated on the secrets/decisions above. Each phase: TDD (pure helpers) → real-DB verification → code-reviewer agent (Codex is win32-blocked → tag `[codex-skip:win32-sandbox]`) → build + verify-build → one prod ship on Zach's go → Zach auth-verifies (only he can Google sign-in).

**Prod deploy:** `hub-port` → `wrangler pages deploy dist --project-name=ims-website --branch=main` (the hub's real prod path; git `main` carries no hub code). DB migrations applied to prod Supabase `gbakzhibzotugfyktcrt` (service-role).

---

## 11. Open risks (need a human call or build-time resolution)

1. **HS256 vs ES256 JWT signer (highest — gates Phase B implementation).** Confirm in Supabase dashboard (Settings → JWT Keys) whether the project still validates HS256 against a usable symmetric secret. ES256 ⇒ ECDSA-P256 signing rewrite. Resolve **before** building Realtime. (Even HS256 is a deprecation tail ~end-2026.) — *I will verify this via the Supabase tools at the start of Phase B.*
2. **No Postgres in CI** for the two `SECURITY DEFINER` RPCs (the lost-update + overspend guarantees). Mitigation: TS oracle + real-DB integration test on a throwaway week (§5.3). Open: add a Supabase preview branch / containerized PG if Zach wants automated PG tests in CI.
3. **`verify-build.mjs` CSP-parity gap** — add the `connect-src` parity assertion with the Phase B CSP edit, or the two header files can drift silently (§8.3).
4. **CSP egress widening** (Phase B) — first time the hub allows `connect-src` beyond `'self'`. Low risk (exact-host, no wildcard); a deliberate posture change for Zach to accept.
5. **Concurrent-reorder order** resolves last-writer-wins on ordering (no data loss). Inherent; acceptable for 6 users.

---

## 12. Testing & verification strategy

- **vitest (pure helpers):** v1/v2→v3 migration, every `applyOp` op + idempotency under double-apply, caps, sanitizer (incl. `<a>` allowlist + attribute-strip), `comparableCol` reaction/author hashing, JWT mint claim shape (Phase B), breaker math (Phase C).
- **Real-DB integration:** op sequences against the live RPC on `9999-W99`, asserted == TS oracle, cleaned up. Two-browser concurrent-edit test (no lost focus). Presence expiry.
- **Playwright vs real DB** (preview-passcode session): add-focus→attribution, reaction round-trip, @mention + notification, drag between columns, carry-over, poll picks up a simulated teammate edit, 0 app console errors.
- **Build gates:** `npm run build` + `verify-build` (incl. new CSP-parity assertion for Phase B) + the existing 400-test suite green.
- **code-reviewer agent** each phase (Codex win32-blocked). Adversarial security re-review specifically for the `<a>` sanitizer change and the `realtime.messages` RLS policies.
- **Zach auth-verifies** each prod ship (Google sign-in → edit → reload persists → 2nd device sees it → reaction/mention/presence/rollup as applicable).

---

## 13. Visual language

Keep **Magenta Noir** (dark default): `--mn-magenta #C44569`, `--mn-butter #E8C465`, `--mn-cyan #59BFE7` (success), `--mn-black #0A0A0F`, `--mn-cream #F4ECDF`. The V5 sky+violet reskin is **marketing-only and must not bleed into the hub.** Owner hues harmonize with this palette under the contrast/pairing rules in §6.1. Big type + color-mix, calm + crafted, never bland. Visual polish verified via Playwright screenshots at build time (the board already exists — screenshots beat speculative mockups).
