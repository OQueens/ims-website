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
export const CANONICAL_HOSTNAME = "innovativemedicalstaffing.com";

export const SECURITY_HEADERS: Record<string, string> = {
  // X-Robots-Tag dropped at LAUNCH HARD GATE (T14 paired with T15+T16+T28).
  // Reintroducing this header would silently de-index the site — see the
  // matching regression guard in scripts/verify-build.mjs.
  "Strict-Transport-Security": "max-age=15768000; includeSubDomains",
  // Spec §0.5.3 final CSP — Plausible analytics + Cloudflare Turnstile
  // allowlisted; 'unsafe-inline' for scripts/styles accepted per spec §0.5.3
  // Notes (Astro hydration injects inline scripts; component-scoped styles).
  // form-action 'self' allows POST to /api/contact + /api/apply (T46+T47).
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://plausible.io https://challenges.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "connect-src 'self' https://plausible.io https://challenges.cloudflare.com; " +
    "frame-src https://challenges.cloudflare.com; " +
    "form-action 'self'; " +
    "base-uri 'self'; " +
    "frame-ancestors 'none'",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

// Exact-host match only. Preview deploys (<hash>.ims-website.pages.dev,
// <branch>.ims-website.pages.dev) keep their own hostnames so the preview
// workflow is unaffected.
export function buildCanonicalRedirect(requestUrl: string): Response | null {
  const url = new URL(requestUrl);
  if (url.hostname !== PAGES_DEV_HOSTNAME) return null;
  url.hostname = CANONICAL_HOSTNAME;
  url.protocol = "https:";
  return new Response(null, {
    status: 301,
    headers: { Location: url.toString(), ...SECURITY_HEADERS },
  });
}

export function applySecurityHeaders(response: Response): Response {
  const cloned = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
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
  env: { HUB_SESSION_SECRET?: string },
  now: number,
): Promise<Response | null> {
  if (!isHubProtectedPath(pathname)) return null;
  const token = getCookie(cookieHeader, "hub_session");
  const session = token && env.HUB_SESSION_SECRET
    ? await verifySession(token, env.HUB_SESSION_SECRET, now)
    : null;
  if (session) return null;
  const loc = "/hub/login?returnTo=" + encodeURIComponent(pathname);
  return new Response(null, { status: 302, headers: { Location: loc, ...SECURITY_HEADERS } });
}
