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

export const PAGES_DEV_HOSTNAME = "ims-website.pages.dev";
export const CANONICAL_HOSTNAME = "innovativemedicalstaffing.com";

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=15768000; includeSubDomains",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
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
