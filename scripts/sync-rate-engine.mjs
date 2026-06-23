// Vendors the canonical @ias/rate-engine into the hub at src/lib/rate-engine/.
//
// Single source of truth = ias-dashboard (mirror: OQueens/oqueens-ias-dashboard).
// This copy is READ-ONLY — never hand-edit src/lib/rate-engine/**; only re-sync.
// Drift is caught by the golden-master parity gate (rate-engine-parity.test.ts),
// which is the mandatory safeguard the port contract requires regardless of the
// delivery mechanism. (We use copy+parity rather than git-subtree because the
// engine is a subdirectory of a monorepo, not a standalone repo root.)
//
// Run: node scripts/sync-rate-engine.mjs   [RATE_ENGINE_SRC=/abs/path overrides source]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const src = process.env.RATE_ENGINE_SRC
  ? resolve(process.env.RATE_ENGINE_SRC)
  : resolve(repoRoot, '../../../ias-dashboard/src/features/rate-simulator/engine');
const dest = join(repoRoot, 'src/lib/rate-engine');

if (!existsSync(src)) {
  console.error(`✗ canonical engine not found at:\n  ${src}\n  Set RATE_ENGINE_SRC=/abs/path/to/engine and retry.`);
  process.exit(1);
}

// Validate the source BEFORE destroying the destination — a wrong/empty source
// (bad RATE_ENGINE_SRC, pointed one dir too high) must abort with the old copy
// intact, not leave src/lib/rate-engine/ empty. The engine has 22 modules; a
// floor of 10 catches "pointed at the wrong place" without being brittle.
const tsFiles = readdirSync(src).filter((f) => f.endsWith('.ts'));
if (tsFiles.length < 10) {
  console.error(`✗ source has only ${tsFiles.length} .ts files (expected ≥10): ${src}\n  Aborting WITHOUT touching the existing vendored copy.`);
  process.exit(1);
}

// Now it's safe to clean the vendored dir (deletions upstream propagate).
rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, '__tests__'), { recursive: true });

const banner =
  '// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard ' +
  '(OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.\n' +
  '// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by ' +
  'src/lib/hub/rate-engine-parity.test.ts.\n';

// Insert the banner AFTER any leading /// triple-slash references so we never
// move a reference directive out of position (tsc ignores misplaced ones).
const withBanner = (body) =>
  body.startsWith('///')
    ? body.replace(/^((?:\/\/\/[^\n]*\n)*)/, `$1${banner}`)
    : banner + body;

let copied = 0;
for (const f of tsFiles) {                     // top-level engine modules only
  writeFileSync(join(dest, f), withBanner(readFileSync(join(src, f), 'utf8')));
  copied++;
}

// Bring the golden-master corpus along (the cross-repo parity contract).
const corpus = join(src, '__tests__/goldenMaster.json');
if (!existsSync(corpus)) {
  console.error(`✗ goldenMaster.json missing at ${corpus} — run gen-golden-master in the canonical repo first.`);
  process.exit(1);
}
writeFileSync(join(dest, '__tests__/goldenMaster.json'), readFileSync(corpus, 'utf8'));

console.log(`✓ vendored ${copied} engine modules + goldenMaster.json`);
console.log(`  from: ${src}`);
console.log(`  to:   ${dest}`);
