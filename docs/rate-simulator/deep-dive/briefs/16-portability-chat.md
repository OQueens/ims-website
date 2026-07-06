# Brief 16 — Portability: Discord + Slack Adapters Over the Headless Core

> Deep-dive brief, 2026-07-03. Pillar: PORTABILITY (chat surfaces). Scope: "type a message in a
> channel → it replies with a rate" for Slack and Discord, as thin shells over ONE headless core
> extracted from the LIVE engine (`ias-website` → `src/lib/rate-engine/` + `src/lib/hub/`).
> Topology per Zach 2026-07-02: the live simulator is imstaffing.ai/hub served by this repo; the
> ias-dashboard app is dead (its `src/features/rate-simulator/` is reference-only); the bridge +
> scraper remain the live data pipeline writing the RTDB the engine reads.
>
> All repo paths relative to `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/`
> unless prefixed. OBSERVED = read from code (file:line). ESTIMATED/DERIVED = labeled inline.
> Every external platform claim is cited and repeated in the fact-check list at the end.

---

## Summary

The chat adapters are cheap because the hard part already exists. `sim-adapter.ts` +
`parser.ts`/`fuzzyMatch.ts` already implement exactly the contract a chat bot needs:
**freetext in → full quote out**, including the honest refusal path (unrecognized specialty →
`null`, never a silent default) and a machine-usable one-line "why" (`confidenceReason`). A
Slack or Discord adapter is transport + formatting only — signature verification, a ~100-line
`SimQuote → text/Block-Kit/embed` formatter, and platform ack timing. Estimated (labeled):
~250–450 LOC per adapter, sharing one formatter.

Three real engineering obstacles stand between today's code and a server-side chat adapter,
and none of them is chat-specific — they are the same headless-core-extraction work the
portability program already names:

1. **The live overlay is browser-shaped.** `loadMarketBuckets()` reads RTDB through the
   `firebase/database` web SDK via the DI seam (`runtime.ts:29`), and the hub only applies the
   overlay client-side (SSR first paint is static curated — `SimulatorView.astro` per map 02 §3).
   A server adapter should read the same public-read tree over the RTDB **REST API**
   (`GET …/rate-simulator/market-rates-v2.json`) and feed the parsed JSON to the existing pure
   gate/overlay logic. Without this, Slack answers would silently diverge from the hub's
   post-overlay hero for promoted cells.
2. **The overlay mutates a module singleton with no reset.** `applyMarketBucketsOverlay`
   promotes in place and `continue`s on gate failure (`marketRates.ts:478-548`) — correct in a
   browser page lifecycle, but in a long-lived Worker isolate or Node daemon a cell promoted on
   an earlier request **stays promoted after its posterior goes stale** (no revert-to-curated
   pass). The headless core needs a `resetSpecialtiesToStatic()` before each overlay apply, or a
   pure `(staticTable, posterior) → quotedTable` refactor (already flagged as map 01 seam #3).
3. **The confidence blend lives in the hub adapter, not the engine.** Displayed confidence =
   `weakerConfidence(scoreConfidence(factors), dataTier)` + `confidenceReasonFor` — all in
   `sim-adapter.ts:263-278`. Any new consumer that skips this blend silently overclaims
   (map 01 seam #10). The extraction boundary must therefore include `quoteFromFactors`,
   not just `calculateRate`.

Platform asymmetry that shapes the design: **Slack's entire "type a message → reply" UX is
HTTP-webhook-native** (slash commands and `app_mention` events both POST to your endpoint —
no persistent connection), so Slack fits the existing Cloudflare Pages deployment
(`astro.config.mjs:13`, API-route pattern already proven by `src/pages/api/locumsmart-events.ts`).
**Discord splits**: slash commands work over a pure HTTPS interactions endpoint (officially
documented on Cloudflare Workers), but *reading channel messages/mentions requires a Gateway
(WebSocket) connection* — i.e., a persistent process. Recommendation: ship Slack first
(slash + @mention, serverless), ship Discord slash-command-only on the same core, and add the
Discord mention flow later as a small gateway daemon on the EC2 box that already runs the
bridge cron and `ims-ls-tap` — only if a Discord community actually materializes.

Bonus strategic finding: the chat adapters are the natural seeding point for the currently-empty
feedback loop (Move #4). Every chat quote is an identified recruiter + query + quote — log it to
the already-migrated `quote_events`/`quote_outcomes` tables, and a 👍/👎 button (Slack Block Kit
action / Discord message component) becomes the won/lost outcome writer the engine's dormant
calibration layer has been waiting for.

---

## Findings (cited)

### F1 — The headless core already exists in practice; it is just not packaged

- `simParseFreetext(text, marginPct)` (`src/lib/hub/sim-adapter.ts:203-218`) is the whole
  message→factors pipeline: `buildParsedFromFreetext` → `initFactors` → full `RateFactors`,
  returning `null` when no specialty is recognized. Crucially it rejects the engine's silent
  internal-medicine fallback (`if (f.specialty.source === 'default') return null`,
  sim-adapter.ts:207) — the honesty behavior a chat bot must inherit, because a bot that answers
  "internal medicine $X" to an unparseable question is fabricating.
- `quoteFromFactors(factors, marginPct)` (`sim-adapter.ts:305-377`) produces the complete reply
  payload: `payRate` (hero $/hr), `billRate` at margin (`roundUp5(pay/(1-m))`,
  sim-adapter.ts:298-301), band (`marketMin/Max`), marker, synthetic percentiles, `confidence`,
  `confidenceData`, **`confidenceReason` — a ready-made one-line "why"** (sim-adapter.ts:272-278),
  clamp disclosures (`capped`, `marketMaxApplied`, `uncapped`), and the call-only surface incl.
  `insufficientData` (sim-adapter.ts:312-351).
- The Phase-1 barrel (`src/lib/rate-engine/index.ts:39-45`) deliberately excludes the
  `firebase` value import, so the parse+quote path runs in any JS runtime with **zero backend
  configuration** (`runtime.ts:14-17`: clients are only required when a backend function is
  actually called). A chat adapter that skipped the live overlay would need no I/O at all.
- Composition cost of the core API (`quoteFromText(text) → QuoteResult`): ~15 lines over
  existing exports. OBSERVED: nothing else in `src/lib/hub` does rate math
  (`sim-adapter.ts:1-15` header contract).

### F2 — Natural-language parsing exists and is conservatively tuned for chat input

`parseFreetextInput` (`src/lib/rate-engine/parser.ts:223-354`) already extracts, from one line
of prose:
- **specialty** — multi-word (3→2→1 token) fuzzy match against 88 keys + ~140 aliases;
- **state** — `", TX"` code pattern (parser.ts:231-237) or state-name match, *exact-or-nothing*
  (`fuzzyMatch.ts:94-102`: a misspelled state never routes to the closest one);
- **city** — metro + GSA-city list (parser.ts:331-351);
- **facility** — keyword map with word-boundary guards ('asc' ∌ "vascular", 'va' ∌ "Nevada";
  parser.ts:42-47, 256-261);
- **shift** — longest-key-first so "weekend night" beats "night" (parser.ts:64-66);
- **call / no-call**, **duration** ("x weeks", "ASAP"), **holiday** (parser.ts:245-270).

Chat-phrasing robustness is decent by construction: `fuzzyMatchSpecialty` only accepts exact
key/alias or a one-way substring with a 4-char floor, shortest key wins (`fuzzyMatch.ts:53-86`)
— so question words ("what", "much", "should") cannot Levenshtein-drift into a specialty.
Gap: `FILLER_WORDS` (`fuzzyMatch.ts:15-18`) covers staffing phrasing ('locum', 'need',
'looking') but not question phrasing ('what', 'pay', 'rate', 'quote', 'how', 'much', 'we',
'should') — harmless to matching (those tokens simply fail to match) but they waste the
3-word-phrase windows and can, in principle, split a specialty phrase. A chat-side pre-strip
of the command verb + question words is a ~10-line adapter concern (or extend FILLER_WORDS in
the core — engine change, golden-master-relevant).

### F3 — The reply content is already designed; only the renderer is HTML-bound

`src/lib/hub/sim-render.ts` is pure `SimQuote → HTML string` (header comment, sim-render.ts:1-5)
— pills (category/specialty/state/confidence + reason tooltip, :15-26), market bar + percentile
chips (:50-76), honest clamp captions (:79-89), and the call-only card including the
no-fabrication "Insufficient public data … quote this assignment manually" surface (:103-129).
A chat adapter needs a parallel `sim-format.ts` producing plain text / Slack mrkdwn / Discord
embed from the same `SimQuote` — a pure-function sibling, ESTIMATED ~100-150 LOC, zero engine
knowledge. The existing renderer proves the shaping layer carries every disclosure the chat
reply needs (confidence pill, clamp notes, provenance, call-only honesty).

### F4 — The only I/O on the quote path is the live overlay, and it is currently browser-only

- Live wiring today: `hub-client.ts` lazily imports `sim-live.ts` → `initLiveMarket()` →
  `configureEngine({db: getHubFirebaseDb()})` + `loadMarketBucketRates()` (`sim-live.ts:43-50`),
  which `get(ref(getDb(), 'rate-simulator/market-rates-v2'))` through the **web SDK**
  (`marketRates.ts:319`). The SSR first paint does NOT apply the overlay (map 02 §3) — so today,
  *server-rendered quotes and client quotes can already differ for promoted cells*; a chat
  adapter must not replicate that inconsistency.
- The RTDB tree is public-read: `rate-simulator/market-rates-v2 .read: true, .write: false`
  (`C:/Users/oclou/QueenClaude/ias-dashboard/database.rules.json:26-47`, per map 06 §2.1).
  Firebase RTDB supports plain REST reads — `GET https://weekly-sync-451e2-default-rtdb.firebaseio.com/rate-simulator/market-rates-v2.json`
  — with no auth when rules permit public read (Firebase docs, cited below). So the server
  adapter needs **no firebase dependency at all**: fetch JSON, run the existing pure gates
  (`isRenderableBucket`, `selectPrimary`, `applyMarketBucketsOverlay` — all pure w.r.t.
  Firebase, `marketRates.ts:464` comment) over it.
- Refactor shape: split `loadMarketBuckets()` into `parseMarketTree(json, now)` (pure; body is
  already `marketRates.ts:329-370` minus the `get(ref(...))`) + host-provided fetch. The hub
  keeps the SDK fetch; the chat adapter uses REST with a short cache (bridge writes once daily
  at 04:00 UTC — `bridge-rate-intelligence.ts:7-13` — so a 15–60 min TTL loses nothing).

### F5 — Server lifetime bug waiting to happen: overlay promotion never reverts

`applyMarketBucketsOverlay` mutates `SPECIALTIES[key]` on promotion and skips (leaves as-is) on
any failed gate (`marketRates.ts:478-548`; e.g. `:481 continue`, `:498 continue`). The curated
baseline is only restored by module re-evaluation — a fresh browser page load. In a Cloudflare
Worker isolate (which persists across requests) or a Node daemon, a cell promoted at T0 keeps
`provenance='live'`, the anchored p70, and possibly `confidence='high'` after its bucket ages
past the 7-day reader window — the exact staleness the reader gate (`RATE_READ_WINDOW_MS`,
`marketRates.ts:136`) exists to prevent. The frozen snapshots needed for a reset already exist
(`STATIC_SPECIALTY_RANGES` + `STATIC_CONFIDENCE`, `specialties.ts:195-225`); what is missing is
a `resetSpecialtiesToStatic()` (ESTIMATED ~20 LOC) or the pure-table refactor. **This must land
before any long-lived server process quotes rates.**

### F6 — Confidence honesty is adapter-layer logic; the extraction boundary must include it

Displayed confidence = weaker of identification confidence (`scoreConfidence`, engine) and the
specialty's data tier, plus the limiting-factor sentence (`sim-adapter.ts:256-278`). The engine
alone would let a well-parsed CRNA question read "High" over a medium-researched band. Chat
adapters MUST consume `quoteFromFactors` (which embeds the blend) — never `calculateRate`
directly. This argues for the headless core package boundary being "sim-adapter and below",
i.e. move `sim-adapter.ts` (minus UI option lists) into the core, leaving `sim-render.ts` and
the DOM wiring in the hub.

### F7 — Existing Slack assets: a bot app with a token already exists; MCP is operator-side only

- `C:/Users/oclou/QueenClaude/agent-sdk/core/slack_client.py:19-40` — a `slack_sdk.WebClient`
  wrapper loading `SLACK_BOT_TOKEN` from fleet secrets, used by Strategy Brain for daily DMs
  (`ZACH_USER_ID = "U0AFJUNFMFH"`, :16). So an IAS Slack app is already created and installed
  with at least `chat:write`-class scope. It is **write-only** (no event receiving, no slash
  commands) — the adapter adds a signing secret + slash command + event subscription to that
  same app (or a new dedicated app; see Open Questions).
- The bridge's operator alerting already assumes Slack (`bridge-rate-intelligence.ts:262-271,
  1320-1338`: "the cron wrapper's Slack alert is the authoritative surface").
- The "existing Slack MCP integration" is the Claude Code plugin surface in this dev environment
  (`mcp__plugin_slack_slack__*` tools + `slack:*` skills incl. `create-slack-app` and
  `block-kit`). It is **operator tooling** — Claude can post rate lookups into Slack manually
  today, which is a useful zero-code interim demo, but it is not a production adapter (no
  always-on listener, human-in-the-loop). Its `block-kit` and `create-slack-app` skills are,
  however, direct accelerants for building the real adapter.

### F8 — Hosting fit: the CF Pages pattern is already proven in this repo; Discord officially supports Workers

- The site is Astro + `@astrojs/cloudflare` (`astro.config.mjs:13`), with server API routes
  under `src/pages/api/` reading secrets from `locals.runtime.env` and doing constant-time
  token compare (`src/pages/api/locumsmart-events.ts:41-52, 78-80`). A `/api/slack/rate` +
  `/api/discord/interactions` route pair follows this exact pattern; the middleware already
  exempts `/api` from canonical redirects (`src/middleware-logic.ts:163-174`) and the hub CSP
  concerns don't apply to server routes.
- Discord documents Cloudflare Workers as a first-class hosting target for HTTP-interaction
  apps: official tutorial + `discord/cloudflare-sample-app` repo (cited below).
- The quote itself is pure CPU (sub-ms table math); the only latency is the RTDB REST read,
  which is cacheable — so both platforms' **3-second ack windows** are comfortably met with a
  synchronous full reply; deferred-response machinery is a fallback, not the default.
- Tradeoff to name: hosting the adapters inside `ias-website` couples bot uptime to marketing-
  site deploys (push-to-main auto-deploy). A standalone Worker consuming the extracted core
  package avoids that, but requires the package extraction first — do not create a third
  vendored engine copy for the bot.

### F9 — Platform contract facts (all external; repeated in fact-check list)

**Slack**
- Slash command endpoint must ack within **3000 ms** (empty HTTP 200 suffices); `response_url`
  provides a follow-up webhook for async replies; payload carries `text`, `channel_id`,
  `user_id`, `response_url`, `trigger_id`; reply is `ephemeral` (default) or `in_channel`.
  [docs.slack.dev/interactivity/implementing-slash-commands]
- Events API (for @mention flow via `app_mention`): respond 2xx within **3 seconds** or Slack
  retries up to **3 times** (immediately, 1 min, 5 min) with `x-slack-retry-num` headers —
  adapter must dedupe on `event_id`. Delivery cap 30,000 events/workspace/app/hour.
  [docs.slack.dev/apis/events-api]
- Request auth: `X-Slack-Signature` = `v0=` + HMAC-SHA256(signing secret,
  `v0:{timestamp}:{raw body}`), verify timestamp within ~5 minutes against replay.
  [docs.slack.dev/authentication/verifying-requests-from-slack]
- Posting limit: ~**1 message/second/channel** (`chat.postMessage` special tier, bursts
  tolerated). Fine for recruiter usage. [docs.slack.dev/apis/web-api/rate-limits]
- Slash + Events are plain HTTPS webhooks → serverless-compatible. (Socket Mode is the
  persistent-WebSocket alternative and is NOT needed here.)

**Discord**
- HTTP interactions endpoint: must verify **Ed25519** signature from `X-Signature-Ed25519` +
  `X-Signature-Timestamp` against the app public key; must answer the `type:1` PING with a
  PONG; Discord actively probes with invalid signatures and expects 401.
  [docs.discord.com/developers/interactions/overview]
- Initial interaction response within **3 seconds**; `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`
  (type 5) shows "thinking…" and opens a **15-minute** follow-up window on the interaction
  token. [discord.com/developers/docs/interactions/receiving-and-responding; discordjs.guide]
- Message content is a **privileged intent**, but content is exempt (delivered anyway) for DMs,
  the bot's own messages, and **messages that @mention the bot** — however message events
  (`MESSAGE_CREATE`) arrive over the **Gateway (persistent WebSocket)**, not the HTTP
  interactions endpoint. Net: a serverless HTTP-only Discord app can do slash commands but
  cannot see channel messages at all; the mention-reply UX requires a gateway process.
  [support-dev.discord.com Message Content Intent FAQ; discord/discord-api-docs #5412]
- Slash commands support an **autocomplete** interaction type — required here because static
  option choices cap at 25 and the engine has 88 specialty keys; back the autocomplete handler
  with `fuzzyMatchSpecialty`/`simSpecialtyOptions()` (`sim-adapter.ts:436-440`).
- Official CF Workers hosting sample: `github.com/discord/cloudflare-sample-app` +
  docs.discord.com tutorial "Hosting … on Cloudflare Workers".

### F10 — What chat will expose harder than the hub does (be ready for honest "no" answers)

- **Call-only coverage**: only 19 of 88 specialties carry a quotable daily band; every holiday
  band is null; weekend bands exist for ~10 (map 01 §6/§10.9, `callRates.ts:34-376`). Chat users
  WILL ask "what's psychiatry weekend call in TN" — psychiatry carries `adjacentHourly` context
  only (map 01 §6), so the honest reply is the insufficient-data card. The formatter must make
  that answer feel competent (name the day-type, cite `sources: 0`, offer the hourly band as
  context) rather than like a bot failure.
- **Percentiles are synthetic** — linear interpolation across `[adjustedMin, adjustedMax]`
  (`sim-adapter.ts:372`), not observed quantiles. The reply must word position as "sits at ~pXX
  of the *researched band*", never "of observed market rates" (north-star gap, map 01 seam #2).
- **Region vs state**: chat input usually names a city/state, which is the engine's best case
  (exact `STATE_MULT`); but a bare "midwest" query would need the representative-state
  approximation (`sim-adapter.ts:75-81`) — the reply should name the state actually priced.
- **The taxonomy chasm doesn't block chat** (chat parses against the ENGINE's 88 keys +
  aliases, same as the hub), but live-anchor coverage is capped at ~19 bridged names
  (map 06 §3.4) — most chat answers will honestly say "curated band" provenance.

### F11 — Chat adapters are the cheapest instrumentation point for the empty feedback loop

`quote_events` / `quote_outcomes` tables already exist with a 6-value outcome enum and
service-role-only RLS (`ias-dashboard/supabase/migrations/20260604000000_quote_regret_telemetry.sql:123-186`,
per map 06 §1.5), and RTDB `rate-simulator/feedback` is world-writable but EMPTY (map 06 §2.4;
improvement-plan Move #4). A Slack reply with two Block Kit buttons ("Won at this rate" /
"Client pushed back") or Discord message components writes attributable, recruiter-identified
outcomes server-side (through the adapter's service-role credential — NOT the world-writable
RTDB path, avoiding the poisoning vector in map 06 seam #4). This turns the portability work
into accuracy work: the chat surface can seed the observed-outcome calibration data no other
surface has produced.

---

## Adapter design

### D0 — The shared headless core contract (the thing both adapters call)

```ts
// @ias/rate-core (extracted from src/lib/hub/sim-adapter.ts + src/lib/rate-engine)
export interface RateQuery { text: string; marginPct?: number }        // defaults 22 (sim-adapter.ts:49)
export type RateAnswer =
  | { ok: true;  quote: SimQuote; specialtyLabel: string; stateName: string | null;
      provenance: 'curated' | 'live'; overlayAgeMs: number | null }
  | { ok: false; reason: 'no_specialty'; suggestions: string[] }       // from fuzzyMatchSpecialty over tokens
export async function quoteFromText(q: RateQuery): Promise<RateAnswer>
```

Internally: (1) ensure overlay fresh — REST-fetch `market-rates-v2.json` if cache TTL expired,
`resetSpecialtiesToStatic()`, `applyMarketBucketsOverlay(parseMarketTree(json))`;
(2) `simParseFreetext(text, marginPct)`; (3) on null, run `fuzzyMatchSpecialty` over the
2-3 longest tokens for suggestions; (4) `quoteFromFactors` is already called inside the parse
path's quote step. Failure posture inherits the engine's: RTDB unreachable → curated bands
serve (mirrors `marketRates.ts:371-374`), never an error to the user.

**Adapter thinness ledger** (what each platform shell owns — nothing else):

| Concern | Slack | Discord |
|---|---|---|
| Transport auth | HMAC v0 + 5-min timestamp | Ed25519 verify + PING/PONG |
| Input | `text` field of slash payload / `app_mention` text minus `<@BOTID>` | `query` option string / autocomplete partials |
| Ack discipline | sync reply < 3 s (or 200 + `response_url`) | type 4 < 3 s (or type 5 + PATCH ≤ 15 min) |
| Formatting | mrkdwn / Block Kit | embed / components |
| Feedback buttons | `block_actions` handler → `quote_outcomes` | message-component handler → `quote_outcomes` |
| Rate/abuse | team_id allowlist (+ per-user token bucket) | guild_id allowlist + `default_member_permissions` |

ESTIMATED sizes: core composition ~50 LOC + reset/REST refactor ~80 LOC; shared text formatter
~120 LOC; Slack shell ~250-350 LOC; Discord shell ~300-450 LOC (autocomplete adds weight).

### D1 — Reply format (shared spec; wording carries the honesty disclosures)

```
{SpecialtyLabel} · {shift label} · {state name | "National"}          ← pills line
Pay ${payRate}/hr        Bill ${billRate}/hr @ {marginPct}%           ← hero line
Band ${marketMin}–${marketMax}/hr · {curated | live-anchored} · sits ~p{XX} of researched band
Confidence: {High|Medium|Low} — {confidenceReason}                    ← the one-line why
[if marketMaxApplied] Bounded to the top of the researched range (${specMax}/hr).
[if capped]           Multiplier ceiling applied — uncapped ≈ ${uncapped}/hr.
[call-only, data]     ${dailyPay}/day stipend ÷ {coverageHrs}h = ${payRate}/hr ({comp model}) · bill fixed 20%
[call-only, no data]  No defensible public call-only {dayType} rate for {specialty}. Not fabricating one —
                      quote manually. ({sources} public sources) [+ hourly band as context]
[buttons] 👍 Won at this rate · 👎 Pushed back                        ← feeds quote_outcomes
```

Every line maps 1:1 onto existing `SimQuote` fields / `sim-render.ts` captions (maxNoteHTML
`:79-82`, capNoteHTML `:86-89`, callOnlyHTML `:103-129`) — no new semantics, no new numbers.

### D2 — Slack adapter (recommended first target)

- **App**: extend the existing IAS Slack app (the one whose `SLACK_BOT_TOKEN` lives in agent-sdk
  secrets) or create a sibling "IMS Rates" app via manifest. Scopes: `commands`, `chat:write`,
  `app_mentions:read`. Request URL(s): `https://imstaffing.ai/api/slack/rate` (slash) and
  `/api/slack/events` (mention) — Astro API routes, `prerender = false`, secrets via
  `locals.runtime.env` exactly like `locumsmart-events.ts:41-52`.
- **Flow (slash)**:
  1. Recruiter types `/rate crna nights in houston, tx`.
  2. Endpoint verifies `X-Slack-Signature` (HMAC v0, raw body, ±5 min) → parses form payload →
     `quoteFromText({text})` → responds **synchronously** with the Block Kit message
     (`response_type: "in_channel"` so the team sees the pricing discussion; make it a
     per-workspace config). Total budget well under 3 s (pure CPU + cached REST read).
  3. If the overlay cache is cold and the REST read is slow, return `200` immediately and POST
     the full reply to `response_url` (Cloudflare `ctx.waitUntil` keeps the worker alive).
- **Flow (@mention)**: `@IMS Rates what should we pay a psychiatrist in Ohio?` → `app_mention`
  event → ack 200 instantly, post reply via `chat.postMessage` to `event.channel` (thread reply
  via `thread_ts` when the mention was in a thread). Dedupe on `event_id` (Slack retries 3×).
- **Auth/rate-limit**: signature verification + `team_id` check against the IAS workspace id;
  optional channel allowlist for `in_channel` responses; per-user token bucket (e.g. 10/min —
  ESTIMATED policy, not a platform number) mostly to bound REST fetch fan-out. Slack's own
  1 msg/sec/channel posting limit is the effective output ceiling.
- **Worked example** (all numbers DERIVED from code constants — flagged for verification):
  - `/rate crna` → CRNA curated band $190–$250/hr (`specialties.ts:59`), p70 =
    round(190 + 60×0.70) = **$232/hr** (`specialties.ts:179` formula); bill @22% =
    roundUp5(232/0.78) = **$300/hr** (`sim-adapter.ts:298-301`). Reply: "CRNA · Day · National —
    Pay $232/hr · Bill $300/hr @22% · Band $190–$250 (curated) · Confidence: Medium —
    Geography not specified — national estimate."
  - `/rate crna nights` → night ×1.20 (`multipliers.ts:13-19`) → 232×1.2 = 278.4, clamped to the
    researched max **$250/hr** with `marketMaxApplied` (`rateCalculator.ts:704-707`); bill @22% =
    roundUp5(250/0.78) = **$325/hr**. Reply adds: "Bounded to the top of the researched range
    ($250/hr) — uncapped ≈ $278/hr."
  - `/rate psychiatry weekend call in tn` → `detectCallOnly` path; psychiatry has no quotable
    daily band (adjacent-hourly context only, map 01 §6) → honest insufficient-data reply,
    zero fabricated dollars.
  - `/rate what do we pay for a perfusionist` → if no specialty resolves, `ok:false` reply:
    "Couldn't identify a specialty. Closest matches: … Try `/rate crna nights in houston, tx`."

### D3 — Discord adapter

- **Phase 1 (serverless, slash-only)**: register a guild-scoped `/rate query:<string>` command;
  set Interactions Endpoint URL to `/api/discord/interactions` (same repo) or a standalone
  Worker per `discord/cloudflare-sample-app`. Handler: Ed25519 verify → `type:1`→PONG →
  `type:4` reply with an embed within 3 s (fallback `type:5` defer + PATCH the webhook).
  Add an autocomplete handler on an optional `specialty` option backed by
  `fuzzyMatchSpecialty` (88 keys exceed the 25-choice static cap).
- **Phase 2 (mention flow, only if demanded)**: a small gateway daemon (discord.js, pm2 on the
  EC2 box `54.145.175.182` alongside the bridge cron and `ims-ls-tap`) listening for
  `MESSAGE_CREATE` where the bot is mentioned — content is exempt from the privileged intent
  for mentions, so no intent review needed. The daemon imports the same `@ias/rate-core`.
- **Auth/rate-limit**: `guild_id` allowlist (reject interactions from any other server — the
  quote data is competitive rate intelligence; a public-server bot would leak it);
  `default_member_permissions` to restrict to a recruiter role; same per-user token bucket.
- **Example flow**: `/rate query: neurosurgery beeper call weekend in ohio` →
  `detectCallOnly` → weekend beeper band exists for neurosurgery (cited entry,
  `callRates.ts:73-82`) → embed with $/day stipend, ÷24 coverage $/hr, comp-model label,
  provenance note, and the fixed-20% call bill (`sim-adapter.ts:317-321`).

### D4 — Hosting decision table

| Option | Fits | Notes |
|---|---|---|
| Astro API routes in `ias-website` (CF Pages) | Slack slash+events, Discord slash | Zero new infra; pattern proven (`locumsmart-events.ts`); couples bot uptime to site deploys; core stays in-repo (no package extraction needed on day 1, but F5 reset fix IS needed) |
| Standalone CF Worker | Same | Cleanest isolation; requires the core extracted to a package first — do NOT vendor a third engine copy |
| EC2 daemon (pm2) | Discord gateway (mention flow); could also host Slack | Only option for Discord MESSAGE_CREATE; box already runs bridge cron + ims-ls-tap; adds ops surface (NEVER `pm2 save` rule applies) |
| Slack Socket Mode daemon | Slack alt-transport | Unnecessary — Slack's webhook model already fits serverless; adds a persistent process for no gain |

---

## Recommendations

1. **[impact: high, effort: low] Fix the singleton-overlay server hazard first.** Add
   `resetSpecialtiesToStatic()` (rebuild `SPECIALTIES[key]` from `STATIC_SPECIALTY_RANGES` +
   `STATIC_CONFIDENCE`, `specialties.ts:195-225`) and call it before every
   `applyMarketBucketsOverlay` in any non-browser host. Blocks all server-side quoting (F5).
2. **[impact: high, effort: medium] Extract the headless core with the boundary at
   `quoteFromFactors`, not `calculateRate`.** Package = engine files + the quote/parse/confidence
   halves of `sim-adapter.ts` + a new `quoteFromText` composition + `parseMarketTree` REST-JSON
   overlay seam (F1/F4/F6). This is the same extraction the whole portability pillar needs;
   chat is just its first consumer.
3. **[impact: high, effort: medium] Ship the Slack adapter first** (slash command + `app_mention`)
   as Astro API routes on the existing CF Pages deployment, reusing the already-installed IAS
   Slack app + adding `commands`/`app_mentions:read` (F7/F8/D2). Slack is where IAS recruiters
   already are (Strategy Brain DMs land there) and its webhook model needs no new infra.
4. **[impact: high, effort: low] Build the shared chat formatter as a pure `SimQuote → text/blocks`
   module with the honesty lines baked in** (confidenceReason, clamp notes, synthetic-percentile
   wording, call-only insufficient card) so no adapter can accidentally drop a disclosure (F3/F10/D1).
5. **[impact: high, effort: medium] Put feedback buttons on every chat reply and write to
   `quote_events`/`quote_outcomes` server-side.** This is Move #4's missing data producer,
   nearly free once the adapter exists, and it uses the RLS-locked Supabase tables instead of
   the world-writable RTDB feedback path (F11).
6. **[impact: medium, effort: low] Discord = slash-command-only on serverless for now;** defer
   the gateway daemon until a Discord community exists. Guild-allowlist + role-gate the command
   because quotes are competitive intelligence (F9/D3).
7. **[impact: medium, effort: low] Pre-strip question phrasing in the adapter** (command verb,
   'what/how/much/pay/should/we/quote') before `simParseFreetext`, and reply with fuzzy
   suggestions on `no_specialty` — never a defaulted quote (F2, honesty rule).
8. **[impact: medium, effort: low] Cache the RTDB REST tree with a 15–60 min TTL and surface
   overlay age in the reply footer** ("live anchor, bridge run <n>h ago") — chat has no
   client-side re-fetch loop, and the 7-day silent-revert cliff (map 03 S11) deserves a visible
   trace on this surface.
9. **[impact: low, effort: low] Log every chat query verbatim.** Chat queries are free
   market-demand telemetry ("what are recruiters trying to price that we can't answer?") —
   route `no_specialty` and `insufficientData` hits into a triage view; they are the
   specialty-coverage defect list the north star demands.

---

## Open questions

1. **Which Slack app?** Extend the existing fleet bot (token in agent-sdk secrets — whose app
   config/ownership needs confirming) vs. a dedicated "IMS Rates" app with its own signing
   secret. Dedicated is cleaner for scope hygiene; existing is faster.
2. **Ephemeral vs in_channel default** for slash replies — pricing discussions may be
   deliberately public to the team, but in shared/guest channels ephemeral is safer. Needs
   Zach's call; suggest in_channel in a private #pricing channel, ephemeral elsewhere.
3. **Does a Discord surface have a real audience today?** No Discord assets exist in any of the
   three repos; if the target is IAS-internal recruiters, Slack alone may fully cover the need,
   and Discord is only worth building for an external clinician/recruiter community play.
4. **Margin control in chat**: expose `margin:25` syntax / slash option, or pin 22% (hub
   default, `sim-adapter.ts:49`)? Pinning avoids recruiters quoting below-floor margins in a
   shared channel; exposing matches the hub's slider power.
5. **Where do adapter secrets live** on CF Pages (project env) vs the fleet secrets store —
   and does the existing `SLACK_BOT_TOKEN` app already have `commands` scope or will re-install
   be required (re-auth ceremony involves Zach).
6. **Team/guild identity values** (Slack `team_id`, Discord `guild_id`) — need to be read from
   the live workspace/server before the allowlists can be pinned.

---

## Fact-check list (every external/behavioral claim + derived $ figure)

External platform claims (cited above, need independent confirmation):
1. Slack slash commands: 3000 ms ack; `response_url` follow-up; ephemeral/in_channel types.
2. Slack Events API: 3 s ack; 3 retries (immediate / 1 min / 5 min); 30,000 events/hr cap;
   `x-slack-retry-num` dedupe headers.
3. Slack signing: `X-Slack-Signature` v0 HMAC-SHA256 basestring `v0:{ts}:{body}`, ~5-min replay window.
4. Slack posting: ~1 msg/sec/channel for `chat.postMessage` with burst tolerance.
5. Discord HTTP interactions: Ed25519 verification via `X-Signature-Ed25519`/`X-Signature-Timestamp`;
   PING(type 1)/PONG; Discord probes with invalid signatures expecting 401.
6. Discord timing: initial response ≤ 3 s; type-5 defer; 15-min interaction-token window.
7. Discord message content: privileged intent, with DM/mention/own-message exemptions; and
   `MESSAGE_CREATE` is Gateway-only (HTTP-interaction-only apps cannot receive channel messages).
8. Discord officially documents CF Workers hosting (`discord/cloudflare-sample-app` + tutorial).
9. Firebase RTDB REST: `GET {db}/{path}.json`, unauthenticated when rules allow public read.
10. Slack autocomplete-equivalent constraint: Discord static option choices cap at 25 (hence
    autocomplete for 88 specialties) — verify the 25-choice limit against current Discord docs.

Code-derived $ figures (verify by executing `quoteFromControls` / `quoteFromFactors`):
11. CRNA curated band $190–$250/hr (`specialties.ts:59`); p70 = $232/hr (formula `specialties.ts:179`).
12. CRNA National @22% margin bill = $300/hr (roundUp5(232/0.78)).
13. CRNA night National: uncapped ≈ $278/hr → clamped to $250/hr (`marketMaxApplied`); bill @22% = $325/hr.
14. RTDB `rate-simulator/*` public-read rules — verify the DEPLOYED rules match
    `ias-dashboard/database.rules.json:26-47` (repo copy ≠ proof of deployment).
15. `SLACK_BOT_TOKEN` in agent-sdk secrets is live and its app can post (Strategy Brain DM path) —
    verify token validity + current scopes before extending that app.
