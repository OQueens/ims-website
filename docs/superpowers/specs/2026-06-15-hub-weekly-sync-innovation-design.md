# IMS Hub — Weekly Sync Innovation Pass — Design Spec (v2)

- **Date:** 2026-06-15
- **Status:** Design approved (Zach, 2026-06-15). v2 folds a 4-lens adversarial spec review (all findings valid). Ready for implementation planning.
- **Branch:** `feat/hub-weekly-sync-innovation` (off `hub-port` @ `3985020`; ships hub-port → `main` → prod `imstaffing.ai/hub`)
- **Builds on:** the shipped T1 Weekly Sync rebuild (live in prod). This is the ambitious pass *on top of* that working foundation.
- **Prior art:** memory `project_ims_hub_weekly_sync_rebuild_2026-06-15.md`

---

## 1. Goal & context

The Weekly Sync is a shared standup board for the **6-person IMS management team** (Zach, Donovan, Chad, Matt, Brent, Jon). Two uses: **live during the Monday 10:00 EST standup** (all six editing together) *and* an **async whiteboard** the team returns to through the week to see "what everyone is driving." It is **not** a task tracker — no checkboxes / done-state.

Today's shipped board is solid but has two gaps this pass closes:

1. **It can silently lose edits.** Writes are blind whole-column upserts (last-writer-wins). With six people live in one column at 10am, one person's new focus can be overwritten with no error. Real data-loss hole.
2. **It shows lists, not people.** No attribution, presence, or live awareness — so it can't answer "who's doing what," the team's primary reason for using it.

**This pass delivers:** a lost-update-proof write engine, per-focus attribution, live presence, reactions, @mentions, "new since last look," carry-over, drag-reorder, render-time link-ification, keyboard-first capture, an optional AI weekly rollup, and (Phase B) true sub-second Realtime with live cursors — all while keeping the database **sealed server-side** (no public anon-key read surface) and honoring Magenta Noir.

### Non-goals (explicit)
- **No checkboxes / done-state / completion tracking** (Zach's explicit call). This extends to **no completion glyph in the reaction set** (§6.5).
- No public/anon DB exposure. The browser never reads the DB directly.
- No change to the marketing site, the V5 reskin, or any non-hub surface.
- No port of the old IAS hub sync ("corrupted/wonky" — build fresh).
- **No external notifications this pass** (Slack/email @mention pings are explicitly deferred — see §6.6).

---

## 2. Approved decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Usage | Live Monday 10am standup **+** async whiteboard through the week |
| Team | Fixed roster of 6 (management) → presence + avatars high-signal |
| Done-state | **None** — living whiteboard |
| Headline feature | **Per-focus attribution** ("see who's doing what") |
| Architecture | **Hybrid**: server-only correctness + presence core (Phase A), private-token Realtime (Phase B), AI rollup (Phase C) |
| DB exposure | **Never.** No public anon key; Realtime uses minted private-channel tokens, not `postgres_changes` |
| AI rollup | **In** — on-demand button (no cron), Claude Haiku, hard atomic circuit-breaker |
| @mention pings | On-board + in-hub notification center; **no** external ping this pass |

---

## 3. Verified design decisions (adversarial-hardened)

Two parallel workflows ran against current authoritative docs: a 5-pillar design-hardening pass (11 agents) and a 4-lens spec review (4 agents). **All pillars hold; all spec-review findings were valid and are folded into this v2.** Key corrections:

- **Write protocol = atomic Postgres RPC**, not app-level CAS (cross-column moves must be atomic; CAS invites retry storms). §5.
- **GET/poll contract MUST change** to carry the new metadata + a `version` — the v1 claim that it was "unchanged" was wrong. §5.4.
- **Poll adoption must be per-focus, not per-column / not gated off during editing** — the shipped poll skips the whole cycle whenever the board has focus, which would freeze sync during the standup. §5.4.
- **Links are render-time DOM-constructed**, never a sanitizer attribute extension (the escape-all-then-restore sanitizer strips all attributes by design; an href allowlist in regex is XSS-prone). §6.10.
- **✅ dropped from reactions** (it's a done-state by another name). §6.5.
- **ES256 is likely the live JWT signer**, not HS256 — `crypto-equal.hmac` is not reusable in that case. Hard pre-Phase-B gate. §8.1, §11.
- **Haiku 4.5 pricing pinned:** $1.00 / 1M input, $5.00 / 1M output tokens. §7.

---

## 4. Data model v3

Same `hub_weekly_sync` table; `items` jsonb stores the **bare sections ARRAY** (to satisfy `CHECK jsonb_typeof(items)='array'`).

```ts
interface FocusLink { text: string; href: string }   // reserved; primary link UX is render-time linkify (§6.10)
interface Focus {
  id: string;            // [A-Za-z0-9_-]{3,40}
  html: string;          // sanitized rich text, ATTRIBUTE-LESS (existing allowlist; NO href — see §6.10)
  by: string;            // author email — SERVER-STAMPED (§6.3)
  createdAt: number;     // unix seconds, server-stamped
  editedBy?: string;     // last editor email, server-stamped on change
  editedAt?: number;
  reactions?: Record<string, string[]>;  // emoji -> [email]; bounded
  mentions?: string[];   // [email]; bounded; derived server-side from html
  carriedFrom?: string;  // week_key this focus was carried over from (§6.8)
}
interface Section { id: string; title: string; by?: string; focuses: Focus[] }   // order = array order
interface ColumnData { v: 3; sections: Section[] }
```

### Two distinct "version" concepts — do not conflate
- **`ColumnData.v` (= 3)** is a **synthetic in-memory shape tag**. It is **never persisted** — `items` stores only the sections array, and `readColumn` re-applies `v` on read. So "v2→v3" is purely a **read-time shape enrichment** (fill missing metadata fields), not an on-disk migration.
- **`version int` (SQL column)** is the **optimistic-concurrency counter** for the write RPC (§5). This is the *only* real schema change to the table.

### Migration & backward-compat (load-bearing)
- `ALTER TABLE hub_weekly_sync ADD COLUMN version int NOT NULL DEFAULT 0;` (the only DDL change to the table).
- **`normalizeSections` / `readColumn` (sync-data.ts) currently emit ONLY `{id, html}` per focus and `{id, title, focuses}` per section — they silently DROP unknown fields.** v3 work MUST widen them to preserve/normalize `by`/`createdAt`/`editedBy`/`editedAt`/`reactions`/`mentions`/`carriedFrom`, or the server's normalize-on-write erases every reaction/author on each save. The client `shape()` (hub-client.ts) strips identically and must be widened in lockstep.
- `readColumn` upgrades v1 (`string[]`) and v2 (sections without metadata) → v3 on read: missing `by` → `null`/`"unknown"`, missing timestamps omitted. The live prod `2026-W25` row and all history keep rendering.
- Update the stale comment at `migrations/20260607_hub_weekly_sync.sql:17` ("array of strings") to describe the v3 sections array.
- Caps mirror existing bounds: `MAX_SECTIONS=16`, `MAX_FOCUSES=50`, `MAX_HTML_LEN=2000`, plus `MAX_REACTIONS_PER_FOCUS` (6 emoji × roster) and `MAX_MENTIONS_PER_FOCUS` (6).

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
| `reorderFocus` | `{col, focusId, beforeId\|afterId}` | **anchor-relative**; drop if anchor gone |
| `moveFocus` (cross-column) | `{fromCol, toCol, focusId, toSectionId, anchor}` | delete-from-source + insert-to-target; **both rows locked**; **no-op if focusId absent under lock** (delete-vs-move race → no zombie) |
| `setReaction` | `{col, focusId, emoji, email, present:bool}` | **absolute** (never toggle); **no-op if focusId absent** (never recreates a focus) |
| `carryOver` | `{fromWeek, toWeek}` | copies prior week's sections/focuses into the (current) week with **new ids**, **preserving original `by`** and stamping `carriedFrom=fromWeek`; idempotent guard: skip if `toWeek` already has content (§6.8) |

`react` is `setReaction(present:true|false)`, **never** a toggle, so a retry is safe.

### 5.2 The function (PL/pgSQL, `SECURITY DEFINER`)
- `SET search_path = ''`; fully-qualify `public.hub_weekly_sync` and qualify all non-`pg_catalog` references (build-time runtime-error trap otherwise). `hashtextextended`/jsonb operators resolve from `pg_catalog`.
- **`REVOKE EXECUTE ON FUNCTION ... FROM public, anon, authenticated;` in the SAME migration transaction as `CREATE FUNCTION`** (functions are PUBLIC-executable at create time — close the window). Only `service_role` retains EXECUTE.
- **Advisory lock:** a single deterministic bigint key `pg_advisory_xact_lock(hashtextextended(p_week || ':' || p_col, 0))` — used consistently everywhere (avoids the two-int4 collision/keyspace-overlap footgun). For `moveFocus`, acquire **both** column locks (sorted `column_key` order) **before reading either row**, deadlock-free, then re-read under lock and no-op if `focusId` is gone.
- Read current `items` + `version`, apply the op to the jsonb, `UPDATE ... SET items=..., version=version+1, updated_by=:email, updated_at=now() RETURNING items, version`.
- The lock covers the no-row-yet INSERT race that `FOR UPDATE` cannot. Auto-releases at tx end.

### 5.3 TypeScript oracle (testability)
CI has no Postgres (pure-TS vitest; Codex win32-blocked). The merge logic also exists as a pure TS **`applyOp(column, op, ctx)`** that the PL/pgSQL mirrors behavior-for-behavior, exhaustively unit-tested (every op, idempotency under double-apply, caps, cross-column move, reaction-on-missing no-op). An **integration test** runs the real op sequence against the live Supabase RPC on throwaway week `9999-W99`, asserts result == oracle, then cleans up — same pattern as the shipped Playwright-vs-real-DB tests. Plus a **real-DB smoke test that the function executes** (the oracle cannot catch a `search_path` runtime error). *(Open: a Supabase preview branch / containerized PG for automated PG tests if Zach prefers — §11.)*

### 5.4 Endpoint & client read/merge contract (corrected)
- `POST /hub/api/sync` body changes from whole-column to a single op: `{weekKey, op}`. Server validates the op, calls the RPC via service-role, returns `{ok, items, version}` for **that** column.
- **The GET/poll contract DOES change** (the v1 spec was wrong to call it unchanged). `GET ?week=KEY` response GAINS a per-column `version` and every new per-focus/section metadata field. Only the **request shape** and the **guard semantics** (`epoch`, dirty-tracking, `comparableCol`) carry over. New response: `{ ok, week, columns: { <col>: { v:3, version:int, sections:[…full v3 focuses…] } } }`.
- **`persist()` consumes the POST `{items, version}` response and id-merges it into local `cols[col]`** (it currently ignores the body), storing per-column `version`.
- **Poll adoption becomes per-focus, not all-or-nothing:**
  - The shipped poll **skips the entire cycle whenever `document.activeElement` is in the board** (hub-client.ts ~line 580). During a live standup someone is almost always focused in a contenteditable → nothing would adopt for the whole meeting (the opposite of the goal). Replace with a **per-focus skip**: adopt server changes for every focus **except the one whose contenteditable currently holds the caret** (`data-foc` of the active element).
  - Replace whole-column `pending` gating with **per-focus dirty tracking**, so a slow/failing op on one focus doesn't blind the user to every other change in that column.
  - Adoption is **id-merge, not column-replace**; the active focus is the only protected node.
- **`comparableCol()` MUST be extended** to hash `reactions` + `by`/`editedBy` (and `mentions`), or a teammate's reaction/attribution change never poll-adopts and is invisible to everyone (§6.5).
- *(Removed: the v1 `.update().eq('version',n)` caveat — vestigial from the rejected app-level CAS design; the RPC owns concurrency.)*
- **Honest limit:** concurrent reorders of the same list resolve last-writer-wins on *order* (no data loss; an order neither user fully intended). Inherent; acceptable for 6 users.

---

## 6. Feature layer — Phase A (no new secrets / CSP / paid services)

### 6.1 Roster of six
Hardcoded `HUB_ROSTER: Record<email, {name, color, initials}>`, seeded with the six. **Monogram initials only — no photo URLs** (`img-src` is `'self' data:`). Colors harmonized with Magenta Noir; obey color rules: `--mn-black` initials on light/saturated hues, `--mn-cream` only on deep hues, **never cream-on-butter `#E8C465`**, **no yellow+purple pairing**. Unknown emails degrade gracefully (derived initials + deterministic hashed hue). **Prerequisite (tracked in §11): Zach confirms the six emails + display names** — the mention picker and avatar palette can't be finalized without them.

### 6.2 Per-focus attribution (headline)
Owner avatar (initials, owner hue) rendered as a **sibling DOM node** (never in sanitized html), hover/long-press caption "Added by Brent · Mon 10:04" (+ "· edited by Chad" when `editedBy` differs).

### 6.3 Server-stamped authorship (anti-spoof)
On `upsertFocus`, the endpoint compares incoming vs stored focus; for any **new or changed** focus it **overwrites `by`/`editedBy` with the authenticated session email**. Authorship is trustworthy, not client-spoofable. **The single exception is `carryOver`** (§6.8), which preserves original `by` — the only op permitted to set `by` to a non-session value.

### 6.4 Soft presence (poll-derived)
- `POST /hub/api/presence` heartbeat (~10s) upserts `{email (SERVER-STAMPED from session, never the body), weekKey, editing:{col,sectionId,focusId}|null, lastSeen}` into a new `hub_presence` table (PK `email`; read filters `lastSeen > now()-30s` → self-expiring, no cleanup job). Validate `col` against `COLUMN_KEYS` and ids against `[A-Za-z0-9_-]{3,40}`; optional server-side debounce (ignore writes <5s apart per email) to blunt a reconnect-loop tab.
- The read poll returns the active roster → header **avatar stack of who's here** + a "just updated" pulse on a touched column + a "Donovan is editing" hint on the focus being edited.
- Endpoint is part of the Phase A inventory (§10). True live cursors are Phase B.

### 6.5 Reactions
A curated 6-emoji pill row per focus — **👍 🔥 👀 💡 ❤️ 🎯** — rendered as sibling nodes from `Focus.reactions`. **✅ and any checkmark/completion glyph are intentionally excluded** to honor the no-done-state rule. Click → `setReaction` op, sent **immediately** (not coalesced into the 700ms text-edit debounce — reactions are tiny absolute idempotent ops; coalescing them caused the v1 "two reactions in the window drop one" hole). Reactions do **not** share the per-column dirty/timer machinery. `setReaction` on a missing focus is a no-op. **`comparableCol()` extension (§5.4) is mandatory** or reactions never sync.

### 6.6 @mentions + in-hub notification center
- Typing `@` opens a roster picker; a mention persists inline as attribute-less `<mark>@Name</mark>` (sanitizer-safe) **plus** a typed `Focus.mentions:[email]` derived server-side.
- A **notification center** (a bell in the hub topbar): "you were mentioned in Recruiting" / "Chad reacted to your focus," computed from board state vs a per-user last-seen marker (localStorage + a lightweight server read). Self-contained — **no external integration**.
- *Deferred (out of scope this pass):* a Slack ping. Note: there is **no `SLACK_WEBHOOK_URL` in this repo** (it lives only in the separate ims-ls-tap project); if ever built it would be a **NEW** server secret added to `HubEnv`/`readHubEnv`.

### 6.7 "New since last look"
Subtle dots on focuses created/changed since the viewer last opened the board (per-user `lastViewedAt` in localStorage keyed by week, vs `createdAt`/`editedAt`). Pure client; zero infra.

### 6.8 Carry-over
A "Pull from last Monday" action runs the atomic **`carryOver` op**, copying the previous week's focuses into the current (blank) week as a starting point. "Last Monday" = the newest `week_key` strictly `< currentWeek` from the `?list=1` set (**not** date arithmetic). New ids; **original `by` preserved** (truthful attribution — the carve-out in §6.3); `carriedFrom=fromWeek` stamped → a small "carried from W24" marker. Guard: skip if the target week already has content (so a second click can't duplicate).

### 6.9 Drag-reorder
Drag a focus within a section, between sections, between columns → `reorderFocus`/`moveFocus` ops (anchor-relative, §5.1) so concurrent reorders merge without data loss. Keyboard-accessible alternative (move up/down) for a11y.

### 6.10 Links (render-time, DOM-constructed) + keyboard-first
- **Links are linkified at RENDER, never stored as href.** Do **not** extend the regex sanitizer (it strips all attributes by design; an href allowlist there is XSS-prone — `javascript:`, `data:`, protocol-relative `//`, mixed-case, **entity-encoded schemes** which the sanitizer's entity-preserving `AMP_RE` would pass, attribute-injection, mid-href truncation). Instead: after setting the focus's sanitized (attribute-less) html, walk text nodes, detect `http(s)://` URLs, and replace each with a **constructed DOM anchor** — `const a=document.createElement('a'); const u=new URL(raw); if(u.protocol!=='http:'&&u.protocol!=='https:') skip; a.href=u.href; a.textContent=raw; a.rel='noopener noreferrer nofollow'; a.target='_blank'`. Never via `innerHTML`. Decode-then-revalidate to defeat entity tricks; require a scheme (reject protocol-relative). **This `<a>` path gets its own adversarial XSS review before Phase A sign-off.**
- Keyboard: Enter adds/commits a focus; Shift+Enter newline; arrow nav between focuses; `@` mention; fast capture flow.

---

## 7. AI "This week at a glance" — Phase C

### 7.1 Endpoint & model
`POST /hub/api/rollup` (prerender=false, under `/hub` guard). Raw `fetch` to `api.anthropic.com/v1/messages`; headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. Model **`claude-haiku-4-5`** (confirmed current; 200K ctx, 64K max out), single non-streaming request, `max_tokens ≈ 900`. **Pinned pricing: $1.00 / 1M input, $5.00 / 1M output** → ~$0.005–0.01/call. **No** `effort`/thinking budget (Haiku 400s on those). **No** prompt caching (system prompt below cache minimum; on-demand calls outrun the 5-min TTL). Server-side call → **do NOT** add `api.anthropic.com` to CSP.

### 7.2 Prompt & output
- Strip board HTML → plain text **before** prompting (injection mitigation) + system instruction "summarize only what is in the data; never invent."
- Input: current week's three columns' sections/focuses + (optional) last Monday's snapshot for a "what changed" delta.
- Use **`output_config: { format: { type:'json_schema', schema:{…} } }`** (the canonical param; top-level `output_format` is deprecated). Haiku 4.5 supports structured outputs. Schema = plain typed fields only: `{ glance:{recruiting,marketing,operations:string}, changed:string[] }`, `additionalProperties:false` on every object. **No `maxItems`/`maxLength`/`minLength`** (rejected); express caps via prompt guidance + `max_tokens`.
- Server-stamp `generatedAt` + `week` (don't trust the model).
- **Render output as `textContent`/through `esc()`/`sanitizeHtml` — NEVER raw `innerHTML`.** Model output is untrusted (a staffer could write a focus that makes the model echo markup).

### 7.3 Atomic circuit breaker (cost control — non-negotiable)
- New table `hub_rollup_usage(day date PK, calls int NOT NULL DEFAULT 0, est_cost_usd numeric NOT NULL DEFAULT 0)`, RLS on / no public policy.
- Enforce the cap in **one** statement via a `SECURITY DEFINER` RPC: `INSERT (day,calls,est_cost_usd) VALUES (current_date,1,:est) ON CONFLICT (day) DO UPDATE SET calls = hub_rollup_usage.calls + 1, est_cost_usd = hub_rollup_usage.est_cost_usd + :est WHERE hub_rollup_usage.calls < :cap RETURNING calls;` — zero rows ⇒ **limited**, skip the Anthropic call. Increment **binds before** the API call (fail-closed). **A failed Anthropic call is NOT refunded** (a model error consumes a unit — keeps the breaker strictly fail-closed under 6 simultaneous clicks). **`est_cost_usd` increments in the SAME statement** so the $ ceiling doesn't lag a full call. Special-case **`cap=0` ⇒ disabled** (skip the INSERT entirely), since the `WHERE` only filters the UPDATE branch and the first-insert-of-day would otherwise pass 1 call through.
- Defaults (env-overridable): **20 calls/day, 200/mo, ~$2/mo**. Over-cap → `200 {ok:true, limited:true, resetsAt}` with a friendly "rollup limit reached — resets tomorrow" — **never** 4xx/5xx (the client treats 401 as sign-out).
- `env.ANTHROPIC_API_KEY` null (dev/preview) → friendly disabled state (mirror the `getHubSupabase`-null pattern); never throw.

### 7.4 Dependencies (Phase C)
- New CF Pages secret `ANTHROPIC_API_KEY` (+ gitignored `.dev.vars`) → add to `HubEnv`/`readHubEnv`.
- New table `hub_rollup_usage` + the atomic increment RPC → prod Supabase.
- **Zach:** create the key, set a workspace monthly spend limit in the Anthropic Console (provider backstop), approve the caps, confirm button-triggered only.

---

## 8. True Realtime — Phase B (sub-second + live cursors)

### 8.1 Mechanism (ES256-first)
- **JWT signer is a hard pre-Phase-B gate.** The asymmetric **ES256** signing default is already live for projects created after ~Oct 2025 (the Supabase CLI flipped to asymmetric-by-default with no opt-out), and a migrated project may have **no symmetric key in `in_use` status** — Realtime verifies via JWKS and would reject an HS256 token. **Bias the plan toward ES256.** Before building: query the project's signing keys (Dashboard → Settings → JWT Keys, or `GET /v1/projects/{ref}/config/auth/signing-keys`) to confirm whether an HS256 key is still `in_use` and what Realtime accepts.
  - **If HS256 still active:** mint with `crypto-equal.hmac` (Web Crypto HMAC-SHA256, Workers-safe).
  - **If ES256 (expected):** mint via `crypto.subtle.sign('ECDSA', {hash:'SHA-256'}, …)` with an imported P-256 private JWK; header `{alg:'ES256', kid:<key id>, typ:'JWT'}` (**`kid` required** for asymmetric verification). `crypto-equal.hmac` is **NOT** reusable on this path.
- Mint at `POST /hub/api/realtime-token` for the authed hub user. Claims: `role:'authenticated'` **and** `aud:'authenticated'` (both mandatory), `sub`=UUIDv5(email) (stable `auth.uid()`), `email`, `iat`, **`exp = now + ~180s` (short)**, **`jti`** (nonce), and a claim derived from the current `HUB_SESSION_GENERATION` so a break-glass gen bump also invalidates outstanding realtime tokens.
- Client: `createClient(url, RESTRICTED_PUBLISHABLE_KEY, { accessToken: async () => mintedToken })` — the **`accessToken` async callback** is the correct supabase-js v2 mechanism. **Do not rely on it as the sole refresh path:** for a backgrounded async-whiteboard tab the heartbeat pauses and a short token can expire mid-session, so **proactively re-mint before `exp` on a `visibilitychange` handler and on `CHANNEL_ERROR`**, calling `supabase.realtime.setAuth(fresh)`. A refresh failure must **surface an error**, never silently degrade to a capped anon socket. **Use the Realtime client bundled inside `@supabase/supabase-js` (`createClient(...).realtime` / `.channel`) — do NOT add a separate `@supabase/realtime-js` direct dep** (the umbrella and realtime-js version independently; a `~2.105.x` pin on realtime-js won't resolve). Lazy-import into the hub island only (never SSR).
- Subscribe to a **private** channel `hub:weekly-sync:<weekKey>` using **Broadcast** (edit signals + cursors) + **Presence** (who's here). **No `postgres_changes`.** A broadcast is a "pull" signal / ephemeral cursor; the DB is never read by the browser. Throttle presence/cursors to ≤5 updates/30s (Supabase per-client cap; rAF-batch cursors).

### 8.2 RLS on `realtime.messages` + untrusted-payload principle
- `realtime.messages` is a **project-global** system table (RLS already on) — it is the entire access surface. Two policies (SELECT for receive + INSERT for send — Presence `track()` is an INSERT), scoped by `topic() LIKE 'hub:%'` **AND** `extension in ('broadcast','presence')` **AND** an email-claim predicate (`%@iastaffing.com` / `%@imstaffing.ai`). **Reserve the `hub:` topic prefix project-wide** (the RLS is global — any other private-channel feature shares these policies). **NEVER** add an `authenticated`-role policy to `hub_weekly_sync` or any app table.
- **Broadcast/Presence payloads are UNTRUSTED.** A 180s token holder can squat/flood/spoof any `hub:*` topic. So: **never render a teammate identity from a broadcast body** — identity comes only from server-stamped board state fetched via `/hub/api/sync`. Broadcasts are used purely as pull-signals + ephemeral cursors clearly scoped to the (untrusted) claimed email. **No correctness decision is ever made from a broadcast.** Realtime is an awareness bus with no integrity guarantee.

### 8.3 CSP (the hard blocker — both files, lockstep)
Add **both** `wss://<project-ref>.supabase.co` **and** `https://<project-ref>.supabase.co` (exact host, no wildcard) to `connect-src` in **both** `src/middleware-logic.ts` `SECURITY_HEADERS` **and** `public/_headers`. The https origin **is** required — `channel.send()` auto-falls-back to an HTTPS POST during reconnect/pre-SUBSCRIBED windows, so wss-only silently drops edit signals when the socket is flaky.
- **Extend `scripts/verify-build.mjs`** (it asserts `default-src`/Plausible/Turnstile but **not** `connect-src` parity). The Phase-B assertion must check **(a)** the two files are identical on the `connect-src` directive **AND (b)** each contains the literal `wss://<ref>.supabase.co` **and** `https://<ref>.supabase.co` pair — not mere file-equality (both could be identically wrong, e.g. wss-only).

### 8.4 Dependencies (Phase B)
- New server secret `SUPABASE_JWT_SECRET` **or** the ES256 private signing key (per §8.1 gate).
- New env `SUPABASE_PUBLISHABLE_KEY` (restricted `sb_publishable_`, zero table grants; handshake-only) → add to `HubEnv`/`readHubEnv`.
- Two RLS policy migrations on `realtime.messages` (prod Supabase).
- **Zach:** resolve the HS256/ES256 signer; provide the signing secret/key; accept the hub's **first CSP egress beyond `'self'`** (exact-host, low risk); confirm Realtime enabled (~1% of Pro's 500-connection quota for 6 seats, no incremental cost).

---

## 9. Security model (summary)

- **DB stays sealed.** Service-role only, server-side. The browser never reads the DB.
- **Realtime (Phase B)** uses Broadcast/Presence relays (not DB reads), gated by RLS on the **project-global** `realtime.messages` (the one place the "sealed DB" posture leans on a table the hub doesn't exclusively own — hence the reserved `hub:` prefix + email-claim predicate). Tokens are short-lived (180s) + `jti` + session-gen-bound. **All broadcast payloads are untrusted; identity only from server state.**
- **Authorship is server-stamped** (carry-over excepted, by design).
- **HTML sanitized on write + render** (existing idempotent allowlist, attribute-less). **Links are render-time DOM-constructed with a `new URL()` http/https scheme allowlist, never an href in stored html** — own XSS review (§6.10). **AI rollup output rendered as textContent/esc, never raw innerHTML** (§7.2).
- **All paid services have hard, atomic, fail-closed circuit-breakers** (§7.3) + an Anthropic Console spend backstop. No spend increase without Zach's approval.
- **Secrets** server-only (`SUPABASE_JWT_SECRET`/ES256 key, `ANTHROPIC_API_KEY`); the publishable key is non-sensitive by design (zero grants).
- **Inputs bounded** (caps; emails `^[^\s@]+@[^\s@]+$`; ids `[A-Za-z0-9_-]{3,40}`; presence/op `col` ∈ `COLUMN_KEYS`).

---

## 10. Phasing, delivery & dependencies

**"Phase A depends on no new secrets or third-party services"** — but it is **not** dependency-free: it requires **Zach confirming the six roster emails** and **three prod-DB migrations** (the `version` column, `hub_presence`, and the `hub_sync_apply` RPC). It is large enough to plan as **sub-phases**:

| Sub-phase | Scope |
|---|---|
| **A1 — Write engine** | v3 model + read-time enrichment, `version` column, `hub_sync_apply` RPC + TS oracle, op-based POST rewrite, client `persist()` rewrite, **GET contract widening + per-focus poll adoption** (§5.4), server-stamped attribution |
| **A2 — Presence + reactions** | `hub_presence` table + heartbeat endpoint, header presence/avatars, reactions (immediate-send) + `comparableCol` redesign |
| **A3 — Mentions + awareness** | @mentions + notification center, "new since last look", carry-over (`carryOver` op) |
| **A4 — Manipulation + polish** | drag-reorder (+ cross-column `moveFocus`), render-time links (+ XSS review), keyboard-first |

| Phase | New secrets/infra | Zach actions | Solo-buildable? |
|---|---|---|---|
| **A** | 3 prod-DB migrations (version col, hub_presence, RPC) | confirm 6 roster emails; ship-to-prod go | **Yes** (real-DB via preview-passcode) |
| **B — Realtime** | `SUPABASE_JWT_SECRET`/ES256 key, `SUPABASE_PUBLISHABLE_KEY`, `realtime.messages` RLS | resolve HS256/ES256; provide key; accept CSP egress; enable Realtime | Partial (Zach-gated) |
| **C — AI rollup** | `ANTHROPIC_API_KEY`, `hub_rollup_usage` + RPC | create key; Console spend limit; approve caps | Partial (Zach-gated) |

Each (sub-)phase: TDD (pure helpers) → real-DB verification → code-reviewer agent (Codex win32-blocked → tag `[codex-skip:win32-sandbox]`) → `npm run build` + `verify-build` + the existing 400-test suite green → one prod ship on Zach's go → Zach auth-verifies (only he can Google sign-in).

**Prod deploy:** `hub-port` → `wrangler pages deploy dist --project-name=ims-website --branch=main` (the hub's real prod path; git `main` carries no hub code). DB migrations applied to prod Supabase `gbakzhibzotugfyktcrt` (service-role).

---

## 11. Open risks (need a human call or build-time resolution)

1. **JWT signer HS256 vs ES256 (highest — hard pre-Phase-B gate).** ES256 asymmetric is likely the live default; the HMAC primitive is not reusable then (ECDSA-P256 + `kid` rewrite). **Query the project signing keys before building Phase B.** I'll do this via the Supabase tools at Phase B start.
2. **Confirm the six roster emails + display names** (Phase A prerequisite — attribution/avatars/mention-picker key off `HUB_ROSTER`).
3. **No Postgres in CI** for the two `SECURITY DEFINER` RPCs. Mitigation: TS oracle + real-DB integration + a function-executes smoke test (§5.3). Open: Supabase preview branch / containerized PG if Zach wants automated PG tests.
4. **`<a>` link XSS review** before Phase A sign-off (render-time DOM construction; §6.10).
5. **`verify-build.mjs` CSP gap** — add the wss+https literal + parity assertion with the Phase B CSP edit (§8.3).
6. **CSP egress widening** (Phase B) — first hub `connect-src` beyond `'self'`; deliberate posture change for Zach to accept.
7. **Realtime token blast radius / backgrounded-tab refresh** — mitigated by 180s exp + jti + session-gen binding + visibilitychange re-mint + untrusted-payload rule (§8.1–8.2); confirm acceptable.
8. **Concurrent-reorder order** = last-writer-wins on ordering (no data loss). Inherent; acceptable for 6.
9. **Supabase Realtime token auto-refresh** is not guaranteed for custom tokens on backgrounded tabs (§8.1) — handled by explicit re-mint, flagged so it's tested.

---

## 12. Testing & verification strategy

- **vitest (pure helpers):** v1/v2→v3 read-enrichment; every `applyOp` op + idempotency under double-apply; caps; `setReaction`-on-missing no-op; cross-column `moveFocus`; sanitizer (attribute-strip) + render-time linkify scheme allowlist (`javascript:`/`data:`/protocol-relative/entity-encoded/mixed-case rejected); `comparableCol` reaction/author hashing; JWT claim shape (Phase B); breaker math incl. cap=0 + no-refund (Phase C).
- **Real-DB integration:** op sequences against the live RPC on `9999-W99`, asserted == TS oracle, cleaned up; the function-executes smoke test; two-browser concurrent same-column edit (no lost focus); cross-column move-vs-delete race (no zombie); presence expiry.
- **Playwright vs real DB** (preview-passcode): add-focus→attribution; reaction round-trip + cross-client adoption while a *different* focus is being edited; @mention + notification; drag between columns; carry-over (original `by` preserved); link click safety; 0 app console errors.
- **Build gates:** `npm run build` + `verify-build` (+ the new CSP literal/parity assertion for Phase B) + the 400-test suite green.
- **code-reviewer agent** each sub-phase (Codex win32-blocked). Dedicated adversarial XSS review for the link path; security review for the `realtime.messages` RLS + token mint.
- **Zach auth-verifies** each prod ship (sign in → edit → reload persists → 2nd device sees it → reaction/mention/presence/rollup as applicable).

---

## 13. Visual language

Keep **Magenta Noir** (dark default): `--mn-magenta #C44569`, `--mn-butter #E8C465`, `--mn-cyan #59BFE7` (success), `--mn-black #0A0A0F`, `--mn-cream #F4ECDF`. The V5 sky+violet reskin is **marketing-only and must not bleed into the hub.** Owner hues harmonize under the contrast/pairing rules in §6.1. Big type + color-mix, calm + crafted, never bland. Visual polish verified via Playwright screenshots at build time (the board already exists — screenshots beat speculative mockups).
