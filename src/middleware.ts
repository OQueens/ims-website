import { defineMiddleware } from "astro:middleware";
import {
  applySecurityHeaders,
  buildCanonicalRedirect,
  hubGuardRedirect,
  isHubProtectedPath,
} from "./middleware-logic";
import { readHubEnv } from "./lib/hub/hub-env";

export const onRequest = defineMiddleware(async ({ request, locals, url }, next) => {
  const redirect = buildCanonicalRedirect(request.url);
  if (redirect) return redirect;

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
