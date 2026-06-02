# IMS Design System Hub — Design Spec

**Date:** 2026-06-02
**Branch:** `feat/ims-phase-1a-content`
**Source handoff:** `Downloads/IMS Design System (Hub.zip` → `design_handoff_hub/` (README + `src/` readable source + `*-reference.html`)
**Live predecessor (data port source, later):** https://ias-hub-dashboard.web.app/

## 1. Goal

Consolidate the standalone IAS hub dashboard into the main IMS Astro site as an internal **operations hub**, re-skinned to the unified Magenta Noir theme, reusing existing tokens/components. Three deliverables, implemented faithfully from the handoff:

1. **Cloaked login entry** — a near-invisible top-left marker on every public marketing page that hover/focus-reveals a "Staff log in" pill linking to the hub login.
2. **Login page** — dark split-screen sign-in, **real Google Workspace auth restricted to `@iastaffing.com`**.
3. **Dashboard** — five views (Overview, Rate Simulator, Analytics, Weekly Sync, Costs), dark-default theme + persisted light toggle, gated behind auth.

**v1 strategy (Zach):** stand the *whole* handoff up first (full design fidelity + real auth + real SSR architecture), wire the data that is already free and real (`ims_jobs`), and keep the reference's seed content as the explicit starting point. Then iterate section-by-section together to port real data from the previous IAS hub.

### Non-goals (v1)
- Full real-data wiring of Analytics / Costs / Overview-KPIs / the rate model — these ship with the reference's seed values as the porting starting point (behind auth, with Zach's informed sign-off).
- Shared-table Weekly Sync persistence — v1 keeps the prototype's `localStorage` (exact parity); real `ims_hub_weekly_sync` table is the planned upgrade for that section.
- Restyling the rest of the marketing site beyond adding the cloaked entry.

## 2. Routing & deploy

| Route | Render | Auth | Purpose |
|---|---|---|---|
| `/hub/login` | SSR (`prerender=false`) | public | Google sign-in page |
| `/hub` | SSR | **gated** | Dashboard (all 5 views) |
| `/hub/auth/start` | SSR | public | Begin Google OAuth (redirect to Google) |
| `/hub/auth/callback` | SSR | public | OAuth code exchange → mint session → redirect to `/hub` |
| `/hub/auth/logout` | SSR | gated | Clear session → `/hub/login` |

- All `/hub/*` is `noindex,nofollow` and **excluded from the sitemap** (`astro.config.mjs` filter).
- SSR routes flow through the existing `dist/_worker.js` (same as `/jobs` + `/api/contact`). Env is read at `Astro.locals.runtime.env` with an `import.meta.env` fallback for dev/test (existing pattern).
- Cloudflare Pages projects: staging `ims-staging` (behind the `apply-staging-gate.mjs` Basic-Auth wrapper, pw `ZY`), prod `ims-website` (git-integrated to `main`).

## 3. Auth — Google OAuth, `@iastaffing.com` only

Self-contained **Google OAuth 2.0 authorization-code flow** implemented in Astro SSR routes — *not* Supabase Auth. Rationale: keeps the shared `gbakzhibzotugfyktcrt` project untouched, no client-side SDK, no CSP `connect-src` changes (token exchange is server-to-server).

### Flow
1. **`/hub/auth/start`** — generate a random `state` and `nonce` (Web Crypto). Set a short-lived (10 min), signed, HttpOnly `hub_oauth` cookie holding `{state, nonce, returnTo}`. 302 to Google `authorization_endpoint` with: `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, `state`, `nonce`, `hd=iastaffing.com`, `prompt=select_account`.
2. **`/hub/auth/callback`** — read `code` + `state`. Verify `state` matches the `hub_oauth` cookie (CSRF guard). POST to Google `token_endpoint` (server-side, authenticated with the client secret over TLS). The returned `id_token` is **trusted by channel** (came directly from Google). Decode its payload and validate, defense-in-depth: `iss ∈ {https://accounts.google.com, accounts.google.com}`, `aud === client_id`, `exp` in the future, `nonce` matches cookie, `email_verified === true`, **`email` ends with `@iastaffing.com`**. Any failure → redirect `/hub/login?error=<code>` (e.g. `domain`, `state`, `verify`). On success → mint the session cookie, clear `hub_oauth`, 302 to `returnTo` (default `/hub`).
3. **`/hub/auth/logout`** — clear the session cookie, 302 to `/hub/login`.

### Session cookie
- Name `hub_session`, value = `base64url(JSON{email,name,iat,exp})` + `"."` + `base64url(HMAC-SHA256(payload, HUB_SESSION_SECRET))`.
- Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=43200` (12h).
- Verify: split, recompute HMAC, **timing-safe compare**, check `exp`. Invalid/expired → treated as logged-out.

### Guard
`src/middleware.ts` (+ pure `middleware-logic.ts`) gains a hub guard that runs before security headers: for any request whose path starts with `/hub` and is **not** in the public allowlist (`/hub/login`, `/hub/auth/start`, `/hub/auth/callback`), verify `hub_session`; if absent/invalid → 302 to `/hub/login?returnTo=<path>`. Middleware only runs for worker-handled routes; all `/hub/*` pages are `prerender=false`, so coverage is complete.

### Staging preview fallback (env-gated, prod-never)
To let Zach preview the dashboard on staging *before* the Google client exists: if `HUB_PREVIEW_PASSCODE` is set in the environment, `/hub/login` also renders a passcode field; a matching POST mints a normal session (`email = preview@iastaffing.com`). **Prod never sets `HUB_PREVIEW_PASSCODE`**, so the passcode path is dead code on prod (Google is the only gate). Flagged for Codex; trivially removable.

### Env vars
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `HUB_SESSION_SECRET` (random 32+ bytes), `HUB_ALLOWED_DOMAIN` (default `iastaffing.com`), optional `HUB_PREVIEW_PASSCODE` (staging only). The OAuth redirect URI is derived from the request origin so one codebase serves staging + prod.

**External dependency (Zach):** create a Google Cloud OAuth 2.0 Web client; redirect URIs = staging + prod `/hub/auth/callback`; consent screen User-type = Internal. Provide Client ID + Secret.

## 4. The three deliverables

### 4.1 Cloaked login entry
- Markup in `MarketingLayout.astro` (renders on every public page automatically), `.cloak-login` block added to `kit.css`.
- `position:fixed; top:0; left:0; z-index:300`. `.cloak-login__dot` 7px, opacity ~0.16 at rest. `.cloak-login__pill` dark pill, opacity 0 + offset/scaled, `pointer-events:none` at rest. On `:hover`/`:focus-visible` the dot fades out and the pill fades/scales in and becomes clickable. Hidden `@media (max-width:768px)`. Links to `/hub/login`. Transform-only reveal (never-invisible safe).

### 4.2 Login page (`/hub/login`)
- Faithful dark split-screen from `src/login.html`, re-skinned to site tokens. Left aside: brand glow, clickable IMS logo + "Hub" tag → `/`, "The whole desk, one screen." headline, 3 stats. Right: "← Back to site", "Welcome back.", the **Google Workspace** button (primary, → `/hub/auth/start`), `@iastaffing.com`-only framing. Email/password fields are dropped (Google-only) — *or* shown disabled with an "IMS Google accounts only" note; final call during build (lean: drop the password form, keep Google + optional staging passcode).
- Dark-island pattern from `GetInTouch.astro` (`body:has()` dark paint, transform-only entrance, reduced-motion fallback).
- Reuses a new minimal `HubLayout.astro` (head scaffolding, fonts, `noindex`).

### 4.3 Dashboard (`/hub`)
Faithful port of `src/dashboard.html` + `src/hub.css` + `src/hub.js`, re-skinned to site tokens (most already match — the hub.css already references `--pop-magenta`, `--mn-black`, `--mn-cyan`, `--font-*`, `--space-*`, `--cream`, `--bone`, `--rule`, etc.).
- **Layout:** 248px true-black sidebar + main column with sticky topbar; one `<section class="hub-view">` per view, only active shown.
- **Theme:** `data-hub-theme="dark"` set before paint by an `is:inline` head script reading `localStorage.imsHubTheme` (default `dark`); sun/moon toggle flips + persists. Dark overrides use `!important` (marketing palette sets `--cream` with `!important`).
- **Views:** Overview (4 KPIs, pipeline bars, quick rate check, activity feed, priorities), Rate Simulator (PDF dropzone, controls, dark result panel, latest-5-jobs), Analytics (KPI row, line chart, donut, bar cards), Weekly Sync (3 editable team columns, add/delete/persist/reset), Costs (KPIs, agent table, category bars, tooling list).
- **Two gotchas honored:** bars are `display:block` with width baked into markup (no rAF); all entrances are transform-only with `prefers-reduced-motion` fallbacks.
- **CSP:** all interactivity ported into bundled component `<script>` (served from `'self'`); the only inline script is the theme-before-paint (CSP allows `'unsafe-inline'`).

## 5. Data plan (v1)

- **Real now — SSR from `ims_jobs`** (service-role, `status='active'`, same client pattern as `/jobs`), aggregated by a pure `hub-data.ts`:
  - Active reqs count, pipeline by `facility_state` (top N), pipeline by specialty (top N), latest 5 jobs (newest by `ls_last_modified`), recent activity feed (most-recent reqs). Public/internal boundary preserved (never read `facility_name`; use `public_facility_label`). No fabricated pay numbers.
- **Seed starting point** (`hub-seed.ts`, typed port of `hub-data.js`): Overview KPIs without a source, Analytics, Costs, Rate-Simulator base rates, Weekly-Sync seed. Rendered behind auth as the canvas for section-by-section porting. Not presented as verified production metrics.
- **Weekly Sync:** v1 `localStorage` (prototype parity). Planned upgrade: `ims_hub_weekly_sync` table + `/api/hub/sync` authed write.

## 6. File inventory

**New — server logic (pure + TDD):**
- `src/lib/hub/google-oauth.ts` (+ `.test.ts`) — buildAuthUrl, validateIdTokenClaims (pure), domain check; thin async `exchangeCode` fetch wrapper.
- `src/lib/hub/session.ts` (+ `.test.ts`) — `signSession`, `verifySession` (HMAC via Web Crypto), timing-safe compare.
- `src/lib/hub/hub-data.ts` (+ `.test.ts`) — pure `aggregateHub(rows)` → overview/pipeline/latest/activity.
- `src/lib/hub/hub-seed.ts` — typed seed constants (port of `hub-data.js`).
- `src/lib/hub/hub-guard.ts` (or fold into `middleware-logic.ts`, + tests) — pure path-guard decision.

**New — routes/pages:**
- `src/pages/hub/login.astro`, `src/pages/hub/index.astro`
- `src/pages/hub/auth/start.ts`, `callback.ts`, `logout.ts`
- `src/layouts/HubLayout.astro`

**New — components (`src/components/hub/`):** `HubSidebar.astro`, `HubTopbar.astro`, `OverviewView.astro`, `SimulatorView.astro`, `AnalyticsView.astro`, `SyncView.astro`, `CostsView.astro`, and a bundled client module `src/components/hub/hub-client.ts` (view switching, theme, sim math, dropzone, sync board, charts — port of `hub.js`).

**New — styles:** `src/styles/hub.css` (ported, imported only by hub pages).

**Modified:** `MarketingLayout.astro` (+ cloak markup), `kit.css` (`.cloak-login`), `src/middleware.ts` + `middleware-logic.ts` (hub guard), `astro.config.mjs` (sitemap exclude `/hub`).

## 7. Testing & quality

- **Unit (vitest):** session sign/verify (tamper, expiry, timing), OAuth claim validation (good/bad iss/aud/exp/nonce/email_verified/domain), hub-data aggregation (empty feed, grouping, top-N, internal-label boundary), guard decisions (public allowlist, gated paths). Target: keep the suite green and extend it.
- **Build gates:** `npm run build` (Turnstile test key), `npm run verify` (verify-build + voice-lint), `npm test`.
- **Visual:** render the reference via local `http-server` + Playwright (file:// is blocked), screenshot, compare the built `/hub` on staging for fidelity (dark + light, all 5 views, mobile).
- **Security review:** adversarial multi-lens review of the auth flow (CSRF/state, domain bypass, cookie forgery, open-redirect on `returnTo`) + Codex before prod.
- **Hard rules:** never-invisible (transform-only), CSP-clean, no real secrets in code, no fabricated data presented as real.

## 8. Deploy

1. Build: `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build`.
2. Gate + deploy staging: `STAGING_GATE_PASSWORD=ZY node scripts/apply-staging-gate.mjs` → `wrangler pages deploy dist --project-name=ims-staging --branch=main`.
3. Set staging env: `HUB_SESSION_SECRET`, `HUB_PREVIEW_PASSCODE` (+ Google creds once provided). Verify via Playwright (Basic-Auth URL creds) — note: gated-staging `fetch()` submit caveat.
4. Codex review → fix → loop.
5. Prod on Zach's **explicit go**: push `feat/ims-phase-1a-content`, then FF `:main` (auto prod deploy). Prod env vars (Google creds + `HUB_SESSION_SECRET`, **no** `HUB_PREVIEW_PASSCODE`) set before the dashboard is reachable.

## 9. Risks / open items
- **Google creds are a hard external dependency** for real login; staging preview passcode unblocks visual review meanwhile.
- `returnTo` open-redirect: only allow same-origin relative paths beginning `/hub`.
- Shared Supabase project: read-only `ims_jobs` SELECT only; no writes in v1.
- Seed content is explicitly temporary; flagged in code comments + this spec; Zach drives the real-data port per section.
