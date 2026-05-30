import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// apply-staging-gate — TEMPORARY password lock for the password-locked staging
// deploy (ims-staging). NOT a production artifact. Run AFTER `astro build`.
//
//   STAGING_GATE_PASSWORD=<pw> node scripts/apply-staging-gate.mjs
//
// Why a worker wrapper (and not src/middleware.ts):
//   The Astro Cloudflare adapter prerenders the content pages to static HTML and
//   lists them in dist/_routes.json `exclude` → the CDN serves them directly,
//   BYPASSING dist/_worker.js. Worse, the adapter's own ASSETS fallback
//   (chunks/_@astrojs-ssr-adapter*.mjs `handle()`) serves prerendered HTML via
//   env.ASSETS.fetch() WITHOUT calling app.render() — so Astro middleware never
//   runs for those pages either. The only layer that sees 100% of requests is
//   the worker's fetch() entry. So the gate lives there, and we rewrite
//   _routes.json so every request is routed through the worker.
//
// What it does (idempotent against a fresh build):
//   1. dist/_worker.js/index.js  (the Astro entry) → renamed to _astro-app.mjs
//      (relative imports stay valid — same directory), then a tiny wrapper
//      index.js is written that does HTTP Basic Auth, then delegates to the
//      real Astro handler. Any username is accepted; only the password matters.
//   2. dist/_routes.json → { include:["/*"], exclude:[] } so nothing (static
//      page, asset, or SSR route) escapes the gate.
//
// To REMOVE the gate: just `astro build` again and DON'T re-run this script —
// the build regenerates a clean dist/.
// ─────────────────────────────────────────────────────────────────────────────

const MARKER = '__IMS_STAGING_GATE__';

const password = process.env.STAGING_GATE_PASSWORD;
if (!password || !password.length) {
  console.error('[staging-gate] ERROR: STAGING_GATE_PASSWORD env var is required and must be non-empty.');
  process.exit(1);
}

const workerDir = join(process.cwd(), 'dist', '_worker.js');
const entry = join(workerDir, 'index.js');
const moved = join(workerDir, '_astro-app.mjs');
const routes = join(process.cwd(), 'dist', '_routes.json');

if (!existsSync(entry)) {
  console.error(`[staging-gate] ERROR: ${entry} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

const current = readFileSync(entry, 'utf8');
if (current.includes(MARKER)) {
  console.error('[staging-gate] ERROR: dist already gated (marker found in index.js). Run a fresh `npm run build` before re-applying.');
  process.exit(1);
}

// 1. Move the real Astro entry aside, then write the gate wrapper as the entry.
renameSync(entry, moved);

const wrapper = `// ${MARKER} — TEMPORARY Basic-Auth gate (scripts/apply-staging-gate.mjs). NOT for production.
// Wraps the real Astro Cloudflare worker (./_astro-app.mjs) with a shared-password check.
import app, { pageMap } from './_astro-app.mjs';

const PASSWORD = ${JSON.stringify(password)};

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function authorized(request) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = atob(header.slice(6)); } catch { return false; }
  const sep = decoded.indexOf(':');
  const supplied = sep === -1 ? decoded : decoded.slice(sep + 1);
  return timingSafeEqual(supplied, PASSWORD);
}

const challenge = () =>
  new Response('Authentication required. This is a private staging preview.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="IMS staging — enter password (any username)", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });

export default {
  fetch(request, env, ctx) {
    if (!authorized(request)) return challenge();
    return app.fetch(request, env, ctx);
  },
};

export { pageMap };
`;

writeFileSync(entry, wrapper, 'utf8');

// 2. Route everything through the worker so the gate covers 100% of requests.
writeFileSync(routes, JSON.stringify({ version: 1, include: ['/*'], exclude: [] }, null, 2) + '\n', 'utf8');

const masked = password.length <= 2 ? '*'.repeat(password.length) : password.slice(0, 1) + '*'.repeat(password.length - 1);
console.log('[staging-gate] applied.');
console.log(`[staging-gate]   • worker entry wrapped (real entry → _astro-app.mjs), password set (${masked})`);
console.log('[staging-gate]   • _routes.json → include:["/*"], exclude:[] (all requests gated)');
