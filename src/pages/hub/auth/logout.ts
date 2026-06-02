import type { APIRoute } from 'astro';

export const prerender = false;

const CLEAR = 'hub_session=; HttpOnly; Secure; SameSite=Lax; Path=/hub; Max-Age=0';

export const GET: APIRoute = () => {
  const h = new Headers({ Location: '/hub/login', 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', CLEAR);
  return new Response(null, { status: 302, headers: h });
};
