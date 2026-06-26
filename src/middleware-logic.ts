// Pure logic for the authoritative security-headers + canonical-redirect
// layer. Split from src/middleware.ts so unit tests can import without
// pulling the `astro:middleware` virtual module.
//
// Migrated from functions/_middleware.js (dead under @astrojs/cloudflare
// advanced-mode bundling — _worker.js takes precedence over /functions in
// Cloudflare Pages: https://developers.cloudflare.com/pages/functions/advanced-mode/).
//
// Static assets continue to receive these headers via public/_headers
// (CDN-applied for paths excluded by _routes.json). This module is the
// defense-in-depth layer for any worker-handled response (homepage routes
// through worker because src/pages/index.astro is `prerender = false` for
// canonicalization, plus any future SSR routes).

import { getCookie } from "./lib/hub/cookies";
import { verifySession } from "./lib/hub/session";

export const PAGES_DEV_HOSTNAME = "ims-website.pages.dev";
// Canonical FLIP (2026-06-11): imstaffing.ai is the new primary brand host.
// innovativemedicalstaffing.com now 301s here (path-preserving) — see
// buildCanonicalRedirect + LEGACY_HOSTNAMES below.
export const CANONICAL_HOSTNAME = "imstaffing.ai";

// Hosts that 301 to the canonical apex, path + query preserved. Includes the
// pages.dev prod alias, the www apex variant, and the retired primary domain
// (+ its www). Preview deploys (<hash>.ims-website.pages.dev) are NOT exact
// matches and keep serving on their own hostname.
export const LEGACY_HOSTNAMES: readonly string[] = [
  PAGES_DEV_HOSTNAME,
  "www.imstaffing.ai",
  "innovativemedicalstaffing.com",
  "www.innovativemedicalstaffing.com",
];

// Job-board domain. Root → the canonical job board; deeper paths are
// preserved onto the canonical host (e.g. /jobs/<slug> stays intact).
export const CAREERS_HOSTNAMES: readonly string[] = [
  "imstaffing.careers",
  "www.imstaffing.careers",
];
// Trailing slash = the site's one canonical URL form (see
// buildTrailingSlashRedirect). Landing on /jobs/ keeps the careers-domain entry
// a single hop instead of careers → /jobs → /jobs/.
export const CAREERS_LANDING_PATH = "/jobs/";

// connect-src baseline (every route). Spec §0.5.3: Plausible analytics + Cloudflare
// Turnstile allowlisted.
const CSP_CONNECT_BASE = "'self' https://plausible.io https://challenges.cloudflare.com";

// Firebase RTDB origins — added to connect-src ONLY on the authenticated hub. The
// hub Rate Simulator's Phase-2 live market overlay reads weekly-sync-451e2 RTDB in
// the browser over a WebSocket; the marketing site never loads firebase, so its CSP
// stays tight (least privilege — max-security directive 2026-06-26). The client
// forces the WebSocket transport (hub-firebase.ts forceWebSockets) so no long-poll
// <script> injection is needed (that would require script-src). Wildcard host:
// firebase redirects the socket from the project host to a regional sharded host
// (s-gke-*.firebaseio.com), so an exact-host allowlist is insufficient
// (browser-verified). Public-read path; no credentials flow over it.
const HUB_RTDB_ORIGINS = "https://*.firebaseio.com wss://*.firebaseio.com";

// Build the final CSP string; connect-src is the only directive that differs
// between the marketing baseline and the hub. 'unsafe-inline' for scripts/styles is
// accepted per spec §0.5.3 (Astro hydration injects inline scripts; component-scoped
// styles). form-action 'self' allows POST to /api/contact + /api/apply (T46+T47).
function buildCsp(connectSrc: string): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://plausible.io https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-src https://challenges.cloudflare.com",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const SECURITY_HEADERS: Record<string, string> = {
  // X-Robots-Tag dropped at LAUNCH HARD GATE (T14 paired with T15+T16+T28).
  // Reintroducing this header would silently de-index the site — see the
  // matching regression guard in scripts/verify-build.mjs.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": buildCsp(CSP_CONNECT_BASE),
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

// Hub variant: identical to SECURITY_HEADERS, but connect-src also allows the
// Firebase RTDB origins. Applied ONLY to authenticated hub responses
// (isHubProtectedPath) so the firebase allowance never reaches a marketing route.
export const HUB_SECURITY_HEADERS: Record<string, string> = {
  ...SECURITY_HEADERS,
  "Content-Security-Policy": buildCsp(`${CSP_CONNECT_BASE} ${HUB_RTDB_ORIGINS}`),
};

// Exact-host match only. Preview deploys (<hash>.ims-website.pages.dev,
// <branch>.ims-website.pages.dev) keep their own hostnames so the preview
// workflow is unaffected. Requests already on the canonical apex return null
// (served, not redirected).
export function buildCanonicalRedirect(requestUrl: string): Response | null {
  const url = new URL(requestUrl);
  const host = url.hostname;

  // NEVER canonical-redirect API routes. They are not indexed, and they are hit
  // by non-browser POST clients — notably the LIVE LocumSmart webhook at
  // innovativemedicalstaffing.com/api/locumsmart-events — that do NOT follow a
  // 301 (clients downgrade POST→GET and drop the body/auth header; LS retries
  // 5xx but not 4xx, so the resulting 401 is a silent permanent drop). The route
  // still exists in this same deployment on every attached host, so falling
  // through serves it normally. This also protects /api/contact + /api/apply.
  if (url.pathname.startsWith("/api/")) return null;

  // Job-board domain: send the bare root to the canonical job board, preserve
  // every deeper path/query verbatim onto the canonical host.
  if (CAREERS_HOSTNAMES.includes(host)) {
    url.hostname = CANONICAL_HOSTNAME;
    url.protocol = "https:";
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = CAREERS_LANDING_PATH;
    }
    return redirect301(url);
  }

  // Legacy / non-canonical hosts → canonical apex, path + query preserved.
  if (LEGACY_HOSTNAMES.includes(host)) {
    url.hostname = CANONICAL_HOSTNAME;
    url.protocol = "https:";
    return redirect301(url);
  }

  return null;
}

function redirect301(url: URL): Response {
  return new Response(null, {
    status: 301,
    headers: { Location: url.toString(), ...SECURITY_HEADERS },
  });
}

// ── Trailing-slash canonicalization (SEO: one indexable URL per page) ─────────
// The site serves ONE canonical URL form: the trailing-slash form. @astrojs/sitemap
// emits /path/ and MarketingLayout emits the matching canonical/og:url. This 301s
// the slash-less form of any worker-handled PAGE route onto that form so there is
// a single indexable 200 per page. It is the redirect of record for the on-demand
// pages (/jobs, /jobs/<id>, /contact); prerendered pages (/about, /clinicians, …)
// are also served at /path/ — Cloudflare Pages' asset layer 308s their slash-less
// form, and if such a request instead reaches the worker this guard 301s it (both
// resolve to /path/, so the end state is identical and loop-free either way).
//
// Why this lives here and NOT in Astro's global `trailingSlash: 'always'`:
// Astro applies that redirect to EVERY on-demand route — including /api
// endpoints — inside App.render, BEFORE middleware runs
// (node_modules/astro/dist/core/app/index.js #redirectTrailingSlash). A 308 on
// POST /api/locumsmart-events would silently kill the LIVE LocumSmart webhook,
// which does not follow redirects (same hazard documented on buildCanonicalRedirect).
// Doing the redirect here lets us exempt /api and the internal /hub surface.
export function buildTrailingSlashRedirect(requestUrl: string, method: string): Response | null {
  // Only ever redirect safe, body-less navigations. A method-changing or
  // body-dropping redirect on a POST/PUT is the exact hazard the /api guard
  // avoids — never do it to any route.
  if (method !== "GET" && method !== "HEAD") return null;
  const url = new URL(requestUrl);
  const p = url.pathname;
  if (p === "/") return null; // root: no slash to add
  if (p.endsWith("/")) return null; // already canonical — no redirect loop
  if (p === "/api" || p.startsWith("/api/")) return null; // endpoints (webhook + form POST targets) — NEVER redirect
  if (p === "/hub" || p.startsWith("/hub/")) return null; // internal hub (OAuth, /hub/api, noindex)
  if (/\.[^/]+$/.test(p)) return null; // file-like asset path (defense-in-depth; worker rarely sees these)
  url.pathname = p + "/";
  return redirect301(url);
}

export function applySecurityHeaders(response: Response, opts?: { hub?: boolean }): Response {
  const headers = opts?.hub ? HUB_SECURITY_HEADERS : SECURITY_HEADERS;
  const cloned = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) {
    cloned.headers.set(name, value);
  }
  return cloned;
}

// ── Hub auth guard ──────────────────────────────────────────────────────────
// The hub (/hub) is gated behind a Google-OAuth session cookie. These public
// paths run the sign-in handshake and must stay reachable unauthenticated.
export const HUB_PUBLIC_PATHS = new Set([
  "/hub/login",
  "/hub/auth/start",
  "/hub/auth/callback",
  "/hub/auth/logout",
]);

export function isHubProtectedPath(pathname: string): boolean {
  if (pathname !== "/hub" && !pathname.startsWith("/hub/")) return false;
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return !HUB_PUBLIC_PATHS.has(p);
}

// Returns a 302-to-login Response when a protected /hub path lacks a valid
// session, else null (request proceeds). `now` is unix seconds.
export async function hubGuardRedirect(
  pathname: string,
  cookieHeader: string | null,
  env: { HUB_SESSION_SECRET?: string; HUB_SESSION_GENERATION?: string },
  now: number,
): Promise<Response | null> {
  if (!isHubProtectedPath(pathname)) return null;
  const token = getCookie(cookieHeader, "hub_session");
  const session = token && env.HUB_SESSION_SECRET
    ? await verifySession(token, env.HUB_SESSION_SECRET, now, env.HUB_SESSION_GENERATION ?? "1")
    : null;
  if (session) return null;
  // API routes under /hub return a clean 401 JSON rather than a 302-to-login.
  // A browser fetch() follows redirects by default, so a 302 would resolve to
  // the login HTML (a 200) and a save with a lapsed session would *look* like it
  // succeeded while persisting nothing (the Weekly Sync "not shared" bug). A 401
  // lets the client surface "sign-in expired" instead of silently dropping data.
  if (pathname.startsWith("/hub/api/")) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...SECURITY_HEADERS },
    });
  }
  const loc = "/hub/login?returnTo=" + encodeURIComponent(pathname);
  return new Response(null, { status: 302, headers: { Location: loc, ...SECURITY_HEADERS } });
}
