import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Architecture note (post-canonical-redirect migration 2026-05-07):
// src/pages/index.astro is `prerender = false` so the homepage routes
// through @astrojs/cloudflare advanced-mode `_worker.js`. Middleware
// (src/middleware.ts) does the host-aware ims-website.pages.dev →
// innovativemedicalstaffing.com 301 + applies SECURITY_HEADERS as
// defense-in-depth. dist/index.html intentionally does NOT exist anymore.
//
// HTML smoke checks (wordmark / sub-line / noindex meta / color-scheme)
// moved out of verify-build because the HTML is rendered at runtime in
// the worker, not at build time. The middleware unit tests (vitest)
// cover the redirect + headers logic; for end-to-end runtime verification
// against the built worker, see the planned Phase 1.A miniflare
// integration test (plan T11+T12 vicinity).

const dist = join(process.cwd(), 'dist');
const robotsPath = join(dist, 'robots.txt');
const headersPath = join(dist, '_headers');
const routesPath = join(dist, '_routes.json');
const workerEntryPath = join(dist, '_worker.js', 'index.js');
const middlewareBundlePath = join(dist, '_worker.js', '_astro-internal_middleware.mjs');
const sitemapIndexPath = join(dist, 'sitemap-index.xml');

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures++;
  }
}

function findCssFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findCssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

console.log('verify-build:');

// Worker bundle (advanced-mode Pages output). Required for canonical
// redirect + SSR homepage rendering.
check('dist/_worker.js/index.js exists', existsSync(workerEntryPath));

// Middleware bundle existence + content markers.
//
// `_astro-internal_middleware.mjs` is emitted whenever ANY middleware exists
// in the sequence — including @astrojs/cloudflare adapter v12's own
// pre-middleware (`onRequest$1` — sets context.locals.runtime). Existence
// alone therefore does NOT prove src/middleware.ts was bundled. We must
// also assert distinctive content from src/middleware-logic.ts. See
// Codex r1 + r2 reviews 2026-05-07.
check(
  'dist/_worker.js/_astro-internal_middleware.mjs exists',
  existsSync(middlewareBundlePath),
);
if (existsSync(middlewareBundlePath)) {
  const middlewareBundle = readFileSync(middlewareBundlePath, 'utf8');
  // Host constants prove src/middleware-logic.ts inlined (string literals
  // survive minification; function names may not).
  check(
    'middleware bundle inlines PAGES_DEV_HOSTNAME literal',
    middlewareBundle.includes('ims-website.pages.dev'),
  );
  check(
    'middleware bundle inlines CANONICAL_HOSTNAME literal',
    middlewareBundle.includes('innovativemedicalstaffing.com'),
  );
  // Canonical redirect shape: 301 + Location header construction.
  check(
    'middleware bundle constructs 301 redirect with Location header',
    /status:\s*301/.test(middlewareBundle) && middlewareBundle.includes('Location'),
  );
  // SECURITY_HEADERS values inlined — distinctive value that won't appear
  // by accident in adapter pre-middleware.
  check(
    'middleware bundle inlines X-Robots-Tag noindex value',
    middlewareBundle.includes('noindex, nofollow'),
  );
  // T9 (Phase 1.A) replaced default-src 'none' with 'self' + Plausible/Turnstile
  // allowlists per spec §0.5.3. Marker proves middleware-logic.ts CSP value
  // (not adapter pre-middleware) was inlined.
  check(
    "middleware bundle inlines CSP default-src 'self'",
    middlewareBundle.includes("default-src 'self'"),
  );
  check(
    'middleware bundle inlines Plausible script-src allowlist',
    middlewareBundle.includes('https://plausible.io'),
  );
  check(
    'middleware bundle inlines Turnstile script-src/frame-src allowlist',
    middlewareBundle.includes('https://challenges.cloudflare.com'),
  );
}

// _routes.json must NOT exclude `/` — otherwise the worker (and middleware)
// won't see homepage requests, which silently disables the canonical redirect.
let routesOk = false;
let routesContent = null;
if (existsSync(routesPath)) {
  routesContent = JSON.parse(readFileSync(routesPath, 'utf8'));
  routesOk = true;
}
check('dist/_routes.json exists and is valid JSON', routesOk);
if (routesOk) {
  const exclude = Array.isArray(routesContent.exclude) ? routesContent.exclude : [];
  check(
    'dist/_routes.json does NOT exclude / (homepage must reach worker)',
    !exclude.includes('/'),
  );
  check(
    'dist/_routes.json includes /* (worker handles all non-excluded paths)',
    Array.isArray(routesContent.include) && routesContent.include.includes('/*'),
  );
}

// Static-asset CDN headers (covers paths excluded from worker).
check('dist/_headers exists (Pages CDN headers)', existsSync(headersPath));
if (existsSync(headersPath)) {
  const headersFile = readFileSync(headersPath, 'utf8');
  const requiredHeaders = [
    'X-Robots-Tag: noindex, nofollow',
    'Strict-Transport-Security:',
    'Content-Security-Policy:',
    'Permissions-Policy:',
    'Referrer-Policy:',
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
  ];
  for (const required of requiredHeaders) {
    check(
      `_headers contains "${required.split(':')[0]}"`,
      headersFile.includes(required),
    );
  }
}

// Sitemap + robots required for SEO/crawler hygiene.
check('dist/robots.txt exists', existsSync(robotsPath));
check('dist/sitemap-index.xml exists', existsSync(sitemapIndexPath));

if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, 'utf8');
  check('robots.txt has Disallow: /', /Disallow:\s*\/\s*$/m.test(robots));
}

// Bundled CSS still gets emitted to dist/_astro/* and is served via CDN
// (excluded from worker). Verify design-system tokens survived bundling.
const bundledCss = findCssFiles(join(dist, '_astro'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

check('IAS tokens present in bundled CSS (--bg)', bundledCss.includes('--bg:'));
check('IAS tokens present in bundled CSS (--text)', bundledCss.includes('--text:'));
check(
  'dark-mode block present in bundled CSS',
  /prefers-color-scheme:\s*dark/i.test(bundledCss),
);
check(
  'SF Pro / system font stack present in bundled CSS',
  bundledCss.includes('-apple-system') || bundledCss.includes('SF Pro'),
);

if (failures > 0) {
  console.error(`\nverify-build FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nverify-build OK');
