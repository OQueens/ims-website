import type { APIRoute } from 'astro';
import { SESSION_CLEAR_COOKIE } from '../../../lib/hub/session';

export const prerender = false;

export const GET: APIRoute = () => {
  const h = new Headers({ Location: '/hub/login', 'Cache-Control': 'no-store' });
  h.append('Set-Cookie', SESSION_CLEAR_COOKIE);
  return new Response(null, { status: 302, headers: h });
};
