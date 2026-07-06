# Research Prompt — Discord + Slack Adapters (refreshes brief 16)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/16-portability-chat.md`.

## Scope
"Type a message → get a rate" for Slack and Discord as thin shells over the headless core. Confirm
the three non-chat-specific blockers (browser-shaped overlay, singleton no-reset, host-side
confidence blend), the platform contract facts (ack windows, signature schemes, intents), the
serverless-vs-gateway split, and the feedback-loop seeding opportunity.

## Code anchors to re-verify
- `sim-adapter.ts:203-218` (`simParseFreetext`, null on no-specialty), `:305-377` (`quoteFromFactors`), `:256-278` (confidence blend)
- `marketRates.ts:319` (browser SDK read → REST), `:478-548` (overlay mutates, no reset)
- `src/pages/api/locumsmart-events.ts:41-52,78` (the proven CF Pages API-route + constant-time secret pattern)
- `agent-sdk/core/slack_client.py:16-40` (existing IAS Slack app + token; write-only today)
- `quote_events`/`quote_outcomes` migration `20260604000000` (feedback destination — RLS-locked, not the world-writable RTDB path)

## External questions to refresh (verify against current docs)
1. Slack: slash 3000 ms ack + `response_url`; Events API 3s ack / 3 retries; signing `v0` HMAC;
   ~1 msg/sec/channel.
2. Discord: Ed25519 verify + PING/PONG; 3s ack + type-5 defer (15-min window); message content is
   Gateway-only (mention flow needs a persistent process); 25-choice static cap → autocomplete for 88 specialties.
3. Firebase RTDB REST GET `.json` unauthenticated when rules allow public read.
4. Discord CF Workers hosting sample (`discord/cloudflare-sample-app`) currency.

## Known claims to re-check
Derived $ examples (CRNA p70 $232, night clamped $250, bill @22% $300/$325) — recompute; existing
Slack token validity + scopes; RTDB deployed public-read.

## Deliverable
Rewrite brief 16 + update BACKLOG rows for reset hazard, core extraction boundary, Slack-first,
shared formatter, feedback buttons, Discord slash-only, question pre-strip, RTDB cache.
