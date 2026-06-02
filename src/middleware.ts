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
  return applySecurityHeaders(response);
});
