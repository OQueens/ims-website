import type { APIRoute } from 'astro';
import { exchangeCode, decodeJwtPayload, validateIdTokenClaims } from '../../../lib/hub/google-oauth';
import { unseal, signSession } from '../../../lib/hub/session';
import { getCookie } from '../../../lib/hub/cookies';
import { readHubEnv } from '../../../lib/hub/hub-env';

export const prerender = false;

const CLEAR_OAUTH = 'hub_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=0';

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = readHubEnv(locals);
  const fail = (code: string) => {
    const h = new Headers({ Location: '/hub/login?error=' + code, 'Cache-Control': 'no-store' });
    h.append('Set-Cookie', CLEAR_OAUTH);
    return new Response(null, { status: 302, headers: h });
  };
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.HUB_SESSION_SECRET) {
    return fail('config');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return fail('state');

  const now = Math.floor(Date.now() / 1000);
  const sealed = await unseal<{ state: string; nonce: string; returnTo: string; exp: number }>(
    getCookie(request.headers.get('cookie'), 'hub_oauth') ?? '',
    env.HUB_SESSION_SECRET,
  );
  if (!sealed || sealed.exp <= now || sealed.state !== state) return fail('state');

  const redirectUri = url.origin + '/hub/auth/callback';
  const tok = await exchangeCode(
    {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri,
      allowedDomain: env.HUB_ALLOWED_DOMAIN,
    },
    code,
  );
  if (!tok?.id_token) return fail('verify');

  const result = validateIdTokenClaims(decodeJwtPayload(tok.id_token), {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    allowedDomain: env.HUB_ALLOWED_DOMAIN,
    nonce: sealed.nonce,
    now,
  });
  if (!result.ok) return fail(result.reason === 'domain' ? 'domain' : 'verify');

  const session = await signSession(result.email, result.name, env.HUB_SESSION_SECRET, now);
  const returnTo = sealed.returnTo.startsWith('/hub') && !sealed.returnTo.startsWith('//') ? sealed.returnTo : '/hub';
  const headers = new Headers({ Location: returnTo, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', `hub_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=43200`);
  headers.append('Set-Cookie', CLEAR_OAUTH);
  return new Response(null, { status: 302, headers });
};
