import type { APIRoute } from 'astro';
import { buildAuthUrl } from '../../../lib/hub/google-oauth';
import { seal } from '../../../lib/hub/session';
import { readHubEnv } from '../../../lib/hub/hub-env';
import { safeReturnTo } from '../../../lib/hub/safe-redirect';

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  const env = readHubEnv(locals);
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.HUB_SESSION_SECRET) {
    return new Response('Hub auth not configured', { status: 503 });
  }
  const redirectUri = url.origin + '/hub/auth/callback';
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
  const now = Math.floor(Date.now() / 1000);
  const oauth = await seal({ state, nonce, returnTo, exp: now + 600 }, env.HUB_SESSION_SECRET);
  const authUrl = buildAuthUrl(
    { clientId: env.GOOGLE_OAUTH_CLIENT_ID, redirectUri, allowedDomains: env.HUB_ALLOWED_DOMAINS },
    state,
    nonce,
  );
  const headers = new Headers({ Location: authUrl, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', `hub_oauth=${oauth}; HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=600`);
  return new Response(null, { status: 302, headers });
};
