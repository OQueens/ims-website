import { defineMiddleware } from "astro:middleware";
import { applySecurityHeaders, buildCanonicalRedirect } from "./middleware-logic";

export const onRequest = defineMiddleware(async ({ request }, next) => {
  const redirect = buildCanonicalRedirect(request.url);
  if (redirect) return redirect;
  const response = await next();
  return applySecurityHeaders(response);
});
