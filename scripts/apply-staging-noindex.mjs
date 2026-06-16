import { readFileSync, writeFileSync, renameSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// apply-staging-noindex — keep the PASSWORDLESS ims-staging deploy out of search
// indexes (so the WIP reskin / trial fonts / half-rendered /hub can't be crawled
// and confused with the real imstaffing.ai). Run AFTER `astro build`, BEFORE
// `wrangler pages deploy`. Replaces the old apply-staging-gate.mjs (Zach dropped
// the password 2026-06-16); this is its noindex-only successor. Idempotent.
//
//   npm run build && node scripts/apply-staging-noindex.mjs && \
//     CLOUDFLARE_API_TOKEN=$(cat ~/.cloudflare-token) \
//     CLOUDFLARE_ACCOUNT_ID=7e0fc3bb9718dbaf4d31145eb6da1c5a \
//     npx wrangler pages deploy dist --project-name=ims-staging --branch=main --commit-dirty=true
//
// Why two layers: Cloudflare `_headers` applies to STATIC assets (covers the
// prerendered pages), but the homepage / jobs / contact are SSR worker responses
// that `_headers` misses — so we also wrap the worker entry to set the header.
// ─────────────────────────────────────────────────────────────────────────────

const MARKER = '__IMS_STAGING_NOINDEX__';
const ROBOTS_LINE = '  X-Robots-Tag: noindex, nofollow\n';

// 1. Static pages: append the header to the existing `/*` block in dist/_headers.
const headers = join(process.cwd(), 'dist', '_headers');
if (!existsSync(headers)) {
  console.error('[noindex] ERROR: dist/_headers not found. Run `npm run build` first.');
  process.exit(1);
}
const headersText = readFileSync(headers, 'utf8');
if (headersText.includes('X-Robots-Tag')) {
  console.log('[noindex] _headers already has X-Robots-Tag (skipped).');
} else {
  // The bare header line below attaches to the LAST path block in _headers.
  // public/_headers is a single `/*` block, so an EOF append lands under `/*`.
  // Fail loud if that ever stops being true — a path-specific block added after
  // `/*` would silently capture the noindex line instead of the catch-all.
  const lastPathLine = headersText.split('\n').filter((l) => l.startsWith('/')).pop();
  if (lastPathLine !== '/*') {
    console.error(`[noindex] ERROR: expected '/*' to be the last path block in _headers, found '${lastPathLine}'. Append target is ambiguous — update scripts/apply-staging-noindex.mjs.`);
    process.exit(1);
  }
  appendFileSync(headers, ROBOTS_LINE, 'utf8');
  console.log('[noindex] _headers → appended X-Robots-Tag: noindex to the /* block.');
}

// 2. SSR pages: wrap the Astro worker entry so every app response gets the header.
const workerDir = join(process.cwd(), 'dist', '_worker.js');
const entry = join(workerDir, 'index.js');
const moved = join(workerDir, '_astro-app.mjs');
// Already wrapped (our marker present) → nothing to do.
if (existsSync(entry) && readFileSync(entry, 'utf8').includes(MARKER)) {
  console.log('[noindex] worker already wrapped (skipped).');
  process.exit(0);
}
// Stash the original app module at `moved`. Normal path: rename the fresh entry.
// Recovery: if a prior run renamed but crashed before writing, `entry` is gone
// while `moved` already holds the original — keep it and just (re)write the wrapper.
if (existsSync(entry)) {
  renameSync(entry, moved);
} else if (!existsSync(moved)) {
  console.error(`[noindex] ERROR: ${entry} not found. Run \`npm run build\` first.`);
  process.exit(1);
}
writeFileSync(
  entry,
  `// ${MARKER} — staging-only: tag every SSR response noindex (scripts/apply-staging-noindex.mjs). NOT for production.
import app from './_astro-app.mjs';
export default {
  async fetch(request, env, ctx) {
    const res = await app.fetch(request, env, ctx);
    // Clone the response and set ONE header. Passing \`res\` as init preserves
    // status/statusText and copies headers (incl. multi-value Set-Cookie) intact,
    // and is safe for bodyless 204/304 responses.
    const wrapped = new Response(res.body, res);
    wrapped.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return wrapped;
  },
};
export * from './_astro-app.mjs';
`,
  'utf8',
);
console.log('[noindex] worker entry wrapped (SSR responses now noindex).');
