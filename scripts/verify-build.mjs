import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// verify-build — Phase 1.A invariants (T17)
//
// This script extends Phase 1.0's structural SSR-architecture checks with the
// design-system + content-hygiene invariants from spec §4.1, §4.2, §4.7, §6.
// Plan T17 (docs/plans/2026-05-06-ims-website-phase-1-plan.md line 1497) was
// authored against a static-rendered homepage; the canonical-redirect
// migration (Phase 1.0) made `/` SSR via `dist/_worker.js`, so the plan's
// HTML-content checks against `dist/index.html` are not viable. The
// equivalent surface has been moved to:
//   - middleware-bundle content checks (already present, below)
//   - source-template assertions on src/layouts/MarketingLayout.astro
//     (this file — guards Plausible script ref, Org JSON-LD, canonical link
//     against accidental template removal)
//
// LAUNCH HARD GATE (T14 + T15 + T16 — paired removal):
//   The following THREE markers are intentionally checked as PRESENT
//   during the Phase 1.A noindex window. ALL THREE must be inverted (or
//   removed) in the same launch commit; partial flip = misconfigured prod.
//
//     • T14 — middleware bundle inlines `noindex, nofollow`
//             ↳ assertion: 'middleware bundle inlines X-Robots-Tag noindex value'
//             ↳ on launch: invert (or delete) — drop X-Robots-Tag from
//               src/middleware-logic.ts SECURITY_HEADERS
//     • T15 — robots.txt contains `Disallow: /`
//             ↳ assertion: 'robots.txt has Disallow: / (LAUNCH HARD GATE …)'
//             ↳ on launch: flip to `Allow: /` — edit public/robots.txt
//     • T16 — _headers contains `X-Robots-Tag: noindex, nofollow`
//             ↳ assertion: '_headers contains "X-Robots-Tag"'
//                          (matches via the `requiredHeaders` array below)
//             ↳ on launch: drop the X-Robots-Tag entry from public/_headers
//               AND remove the requiredHeaders entry here
//
//   That paired-flip is the gate's tests-fail-becomes-pass story; do NOT
//   silently remove the markers in between.
// ─────────────────────────────────────────────────────────────────────────────

const dist = join(process.cwd(), 'dist');
const robotsPath = join(dist, 'robots.txt');
const headersPath = join(dist, '_headers');
const routesPath = join(dist, '_routes.json');
const workerEntryPath = join(dist, '_worker.js', 'index.js');
const middlewareBundlePath = join(dist, '_worker.js', '_astro-internal_middleware.mjs');
const sitemapIndexPath = join(dist, 'sitemap-index.xml');
const iconsDir = join(process.cwd(), 'src', 'assets', 'icons');
const marketingLayoutPath = join(process.cwd(), 'src', 'layouts', 'MarketingLayout.astro');

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

function findAstroPages(dir, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'api') continue; // JSON endpoints — never use a layout
      findAstroPages(full, results);
    } else if (entry.endsWith('.astro')) {
      results.push(full);
    }
  }
  return results;
}

console.log('verify-build:');

// ─── SSR architecture (Phase 1.0 canonical-redirect migration) ──────────────

check('dist/_worker.js/index.js exists', existsSync(workerEntryPath));

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
  check(
    'middleware bundle inlines PAGES_DEV_HOSTNAME literal',
    middlewareBundle.includes('ims-website.pages.dev'),
  );
  check(
    'middleware bundle inlines CANONICAL_HOSTNAME literal',
    middlewareBundle.includes('innovativemedicalstaffing.com'),
  );
  check(
    'middleware bundle constructs 301 redirect with Location header',
    /status:\s*301/.test(middlewareBundle) && middlewareBundle.includes('Location'),
  );
  // LAUNCH HARD GATE marker — flipped by T14
  check(
    'middleware bundle inlines X-Robots-Tag noindex value (LAUNCH HARD GATE — T14 flips)',
    middlewareBundle.includes('noindex, nofollow'),
  );
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
    'X-Robots-Tag: noindex, nofollow',  // LAUNCH HARD GATE — T16 flips
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

// ─── SEO + crawler hygiene ───────────────────────────────────────────────────

check('dist/robots.txt exists', existsSync(robotsPath));
check('dist/sitemap-index.xml exists', existsSync(sitemapIndexPath));

if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, 'utf8');
  // LAUNCH HARD GATE marker — flipped by T15
  check(
    'robots.txt has Disallow: / (LAUNCH HARD GATE — T15 flips to Allow)',
    /Disallow:\s*\/\s*$/m.test(robots),
  );
  // Codex r1+r2 fold: enforce exact canonical sitemap URL — a loose
  // /Sitemap:\s+https:\/\// match would pass pages.dev / wrong-host /
  // wrong-cased-path slips, exactly the canonical hygiene this gate is
  // meant to catch. Case-sensitive (no /i) — URL paths are case-sensitive
  // and our canonical emit is always lowercase, so exact match catches
  // both wrong-case-host AND wrong-case-path.
  check(
    'robots.txt has canonical Sitemap directive (exact host + path, case-sensitive)',
    /^Sitemap:\s+https:\/\/innovativemedicalstaffing\.com\/sitemap-index\.xml\s*$/m.test(robots),
  );
}

if (existsSync(sitemapIndexPath)) {
  const sitemap = readFileSync(sitemapIndexPath, 'utf8');
  check(
    'sitemap-index.xml references innovativemedicalstaffing.com',
    sitemap.includes('innovativemedicalstaffing.com'),
  );
}

// ─── Design-system tokens (spec §4.1) ───────────────────────────────────────
//
// Bundled CSS still gets emitted to dist/_astro/* and is served via CDN
// (excluded from worker). Verify design-system tokens survived bundling.

const bundledCss = findCssFiles(join(dist, '_astro'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

check('Phase 1.0 base token present (--bg)', bundledCss.includes('--bg:'));
check('Phase 1.0 base token present (--text)', bundledCss.includes('--text:'));
check(
  'dark-mode block present in bundled CSS',
  /prefers-color-scheme:\s*dark/i.test(bundledCss),
);
check(
  'system font stack present in bundled CSS',
  bundledCss.includes('-apple-system') || bundledCss.includes('SF Pro'),
);

// Phase 1.A brand tokens — surface this early so token rename / removal
// blows up in CI rather than at render time.
check('Phase 1.A brand token present (--surface-card)', bundledCss.includes('--surface-card:'));
check('Phase 1.A brand token present (--surface-page)', bundledCss.includes('--surface-page:'));
check('Phase 1.A brand token present (--brand-blue)', bundledCss.includes('--brand-blue:'));
check('Phase 1.A brand token present (--ink-on-cream)', bundledCss.includes('--ink-on-cream:'));
check('Phase 1.A brand token present (--ink-on-dark)', bundledCss.includes('--ink-on-dark:'));

// ─── Type system (spec §4.2) ────────────────────────────────────────────────
//
// Codex r1+r2 fold: family-OR-src tolerance lets the check pass when
// @font-face blocks are removed but the family name still appears in
// --font-display / --font-body tokens — silent prod fallback to system
// fonts. Tighten to require an @font-face block containing BOTH the family
// name AND its matching src URL within the same block. r2 fix: switched
// from [\s\S]*? to [^}]*? so the lazy match cannot slide past the closing
// brace of the block — without this, a broken block (family but missing
// src) could match a later src marker in another block. CSS @font-face
// cannot nest, so [^}]* is sufficient. Quotes around family name are
// optional — Vite's CSS bundler emits unquoted (e.g. `font-family:TAY
// Basal`) when the identifier is valid CSS without quoting.

const fontFaceBlock = (family, srcMarker) =>
  new RegExp(
    `@font-face\\s*\\{[^}]*?font-family:\\s*['"]?${family}['"]?[^}]*?${srcMarker}[^}]*?\\}`,
    'i',
  );

check(
  'TAY Basal @font-face block (family + TAYBasalRegular src co-located)',
  fontFaceBlock('TAY Basal', 'TAYBasalRegular').test(bundledCss),
);
check(
  'TAY Amaya @font-face block (family + TAYAmaya src co-located)',
  fontFaceBlock('TAY Amaya', 'TAYAmaya\\.woff').test(bundledCss),
);

// ─── Functional icon set cap (spec §4.7 hard cap; Codex r2 AMBER #6 fold) ──
//
// Spec §4.7 lines 633-638 hard-caps the launch surface at ≤ 8 functional
// icons. Counting at the source dir (not dist) — Astro inlines SVGs via
// `?raw` imports so dist/* doesn't surface them as discrete files.
// Fails-closed when directory missing (T6 should always have created it).

if (existsSync(iconsDir)) {
  const svgFiles = readdirSync(iconsDir).filter((f) => f.endsWith('.svg'));
  check(
    `src/assets/icons/*.svg ≤ 8 (functional icon cap; spec §4.7) — found ${svgFiles.length}`,
    svgFiles.length <= 8,
  );
} else {
  check('src/assets/icons/ directory exists (T6)', false);
}

// ─── MarketingLayout source-template invariants (spec §6 + §0.5.8) ─────────
//
// Replaces the plan's "dist/index.html includes Plausible / JSON-LD /
// canonical" assertions, which can't run post-SSR migration (no
// dist/index.html). Asserting on the source template guards against
// accidental removal during template edits — caught at CI time, not
// after the next deploy.

if (existsSync(marketingLayoutPath)) {
  const layout = readFileSync(marketingLayoutPath, 'utf8');
  check(
    'MarketingLayout references Plausible script source',
    layout.includes('plausible.io/js/script.tagged-events.js'),
  );
  check(
    'MarketingLayout declares Schema.org Organization JSON-LD',
    /['"]@type['"]\s*:\s*['"]Organization['"]/i.test(layout),
  );
  check(
    'MarketingLayout emits <link rel="canonical">',
    /<link\s+rel=["']canonical["']/i.test(layout),
  );
} else {
  check('src/layouts/MarketingLayout.astro exists', false);
}

// Codex r1+r2+r3 HIGH fold: source-template checks above are
// orphan-vulnerable — they pass even when no page actually renders
// MarketingLayout. Pre-T28, src/pages/index.astro renders BaseLayout
// (maintenance mode); the marketing surface lights up at T28 swap-in.
// r3 fix: detection is now keyed to actual template-body usage
// (`<MarketingLayout`) rather than import text. An `import MarketingLayout`
// without a matching opening tag (dead import, layout-rename drift,
// commented-out import) no longer satisfies the gate. Comments are stripped
// before matching to prevent a `// <MarketingLayout` line spoofing it.

function stripForTemplateScan(src) {
  // r4 fold: strip what could spoof the opening-tag regex without
  // actually invoking the component:
  //   - Astro frontmatter `---\n...\n---` (imports + constants —
  //     'import MarketingLayout' or `const x = "<MarketingLayout>"`)
  //   - JS block comments `/* ... */`
  //   - Astro/JSX `{/* ... */}` template comments
  //   - HTML comments `<!-- ... -->` (Astro emits these to output but they
  //     do NOT instantiate the component; this is the r4 spoof shape)
  //
  // Residual surface (pathological / requires intent): string literals
  // inside `<script>` blocks containing the literal opening-tag text.
  // Acceptable — code review catches deliberate CI-gate spoofs.
  let out = src;
  // Strip leading frontmatter only — capture the first `---\n...\n---`.
  out = out.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
  return out;
}

function rendersMarketingLayout(src) {
  const stripped = stripForTemplateScan(src);
  // Match real opening forms in the template body:
  //   <MarketingLayout>            (children form)
  //   <MarketingLayout prop=...>   (attributes)
  //   <MarketingLayout/>           (self-close, no space — r4 false-neg fix)
  //   <MarketingLayout />          (self-close, with space)
  return /<MarketingLayout[\s>/]/.test(stripped);
}

function rendersBaseLayout(src) {
  const stripped = stripForTemplateScan(src);
  return /<BaseLayout[\s>/]/.test(stripped);
}

const indexAstroPath = join(process.cwd(), 'src', 'pages', 'index.astro');
const indexAstro = existsSync(indexAstroPath)
  ? readFileSync(indexAstroPath, 'utf8')
  : '';
const indexRendersMarketingLayout = rendersMarketingLayout(indexAstro);
const indexRendersBaseLayout = rendersBaseLayout(indexAstro);

// Catches drift where index.astro renders a third layout (e.g., HomeLayout)
// — a regression that would also leak any MarketingLayout markers.
check(
  'src/pages/index.astro renders BaseLayout (maintenance) or MarketingLayout (post-T28)',
  indexRendersMarketingLayout || indexRendersBaseLayout,
);

const pageFiles = findAstroPages(join(process.cwd(), 'src', 'pages'));
const pagesRenderingMarketingLayout = pageFiles.filter((f) =>
  rendersMarketingLayout(readFileSync(f, 'utf8')),
);
// Marketing era active = the homepage actually renders MarketingLayout
// (T28 has landed). Activates immediately on T28 commit, not gated on
// route count — closes both the solo-T28 vacuous-bypass (r2) and the
// dead-import / layout-drift bypass (r3).
const marketingEraActive = indexRendersMarketingLayout;
check(
  marketingEraActive
    ? `MarketingLayout rendered by ≥1 page route (orphan check active) — found ${pagesRenderingMarketingLayout.length} of ${pageFiles.length}`
    : `MarketingLayout orphan check vacuous (pre-T28: index.astro on BaseLayout, ${pageFiles.length} page(s))`,
  marketingEraActive ? pagesRenderingMarketingLayout.length >= 1 : true,
);

// ─── Result ─────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\nverify-build FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nverify-build OK');
