# IMS Hub — auth & env setup runbook

The hub (`/hub`) is gated by Google sign-in restricted to `@iastaffing.com`. This
is the one-time provisioning Zach does; the app code is already wired.

## 1. Create the Google OAuth client (Zach)

1. Go to **Google Cloud Console → APIs & Services → Credentials**
   (use the IMS / iastaffing.com Google Workspace org).
2. **OAuth consent screen** → User type = **Internal** (restricts to your
   Workspace automatically). App name: "IMS Hub". Add your support email. Save.
3. **Credentials → Create Credentials → OAuth client ID → Web application.**
   - Name: "IMS Hub Web"
   - **Authorized redirect URIs** (add both):
     - `https://ims-staging.pages.dev/hub/auth/callback`
     - `https://innovativemedicalstaffing.com/hub/auth/callback`
   - Create → copy the **Client ID** and **Client secret**.
4. Send me the Client ID + Client secret **masked** (first 10 chars + `…` + last 4);
   I'll tell you which env var each goes in and you paste the full values into
   Cloudflare (never into git).

## 2. Cloudflare environment variables

Set these on the Pages projects (dashboard → project → Settings → Environment
variables, or `wrangler pages secret put`). **Secrets** (mark encrypted): the
Google secret + session secret + preview passcode.

| Variable | Staging (`ims-staging`) | Prod (`ims-website`) | Notes |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | ✅ | ✅ | from step 1 (same client) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ✅ (secret) | ✅ (secret) | from step 1 |
| `HUB_SESSION_SECRET` | ✅ (secret) | ✅ (secret) | random 32+ bytes; **different per env**. Generate: `node -e "console.log(crypto.randomBytes(48).toString('base64url'))"` |
| `HUB_ALLOWED_DOMAIN` | `iastaffing.com` | `iastaffing.com` | optional (defaults to iastaffing.com) |
| `HUB_PREVIEW_PASSCODE` | ✅ (secret, temp) | ❌ **never set** | staging-only preview before Google is live; prod relies on Google only |
| `SUPABASE_URL` | already set | already set | reused from /jobs + /contact |
| `SUPABASE_SERVICE_ROLE_KEY` | already set | already set | reused |

After changing env vars, **redeploy** (or trigger a new deployment) so the worker
picks them up.

## 3. How sign-in works (no per-user accounts to manage)

- A staff member opens any public page → faint top-left dot → "Staff log in" →
  `/hub/login` → "Continue with Google Workspace".
- Google only offers `@iastaffing.com` accounts (consent screen = Internal +
  `hd=iastaffing.com` hint); the server **also** rejects any non-`@iastaffing.com`
  email. Anyone with an IMS Google account is in; nobody else is.
- Session lasts 12h (signed HttpOnly cookie). "Sign out" is in the sidebar.

## 4. Preview before Google is ready (staging only)

Until the Google client exists, set `HUB_PREVIEW_PASSCODE` on **ims-staging**
only. The login page then shows a passcode box; entering it lands you on the
dashboard so we can review and port data section-by-section. Remove it (and rely
on Google) before/at go-live. Prod never has this var, so the passcode path is
inert on production.

## 5. Data status (v1)

- **Real now:** Active-reqs count, pipeline by state + specialty, "Latest 5 jobs",
  recent activity — all from the live `ims_jobs` Supabase feed (SSR).
- **Seed starting point (to port together):** the other Overview KPIs, Analytics,
  Costs, Rate-Simulator base rates, and the Weekly-Sync board. These are clearly
  the porting canvas, gated behind auth — not live IMS metrics.
- **Weekly Sync** persists to the browser (`localStorage`) for now; a shared
  per-team table is the planned upgrade for that section.
