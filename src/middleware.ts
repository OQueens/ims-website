import { defineMiddleware } from "astro:middleware";
import {
  applySecurityHeaders,
  buildCanonicalRedirect,
  buildTrailingSlashRedirect,
  hubGuardRedirect,
  isHubProtectedPath,
} from "./middleware-logic";
import { readHubEnv } from "./lib/hub/hub-env";

export const onRequest = defineMiddleware(async ({ request, locals, url }, next) => {
  // 1) Pin the canonical host (legacy/careers/www/pages.dev → imstaffing.ai).
  const redirect = buildCanonicalRedirect(request.url);
  if (redirect) return redirect;

  // 2) Pin the canonical trailing-slash form for on-demand PAGE routes (/api +
  //    /hub exempt — see buildTrailingSlashRedirect). Runs after the host pin so
  //    a cross-host hit resolves host first, then slash, on the canonical host.
  const slashRedirect = buildTrailingSlashRedirect(request.url, request.method);
  if (slashRedirect) return slashRedirect;

  // Gate /hub behind the Google-OAuth session cookie before rendering. Only the
  // protected hub paths are SSR; reading request.headers here (not on the
  // prerendered marketing pages) avoids the build-time prerender warning.
  if (isHubProtectedPath(url.pathname)) {
    const env = readHubEnv(locals);
    const now = Math.floor(Date.now() / 1000);
    const guard = await hubGuardRedirect(url.pathname, request.headers.get("cookie"), env, now);
    if (guard) return guard;
  }

  const response = await next();
  const secured = applySecurityHeaders(response);
  // Authenticated/internal hub HTML must never be cached by the browser,
  // back-button, or a shared forward proxy. (Cloudflare already doesn't cache
  // SSR responses, so this is browser/proxy defense-in-depth.) Scoped to /hub so
  // cacheable prerendered marketing routes that also flow through the worker
  // keep their default cacheability.
  if (url.pathname === "/hub" || url.pathname.startsWith("/hub/")) {
    secured.headers.set("Cache-Control", "private, no-store");
  }
  return secured;
});
