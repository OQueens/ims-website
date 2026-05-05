import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');
const robotsPath = join(dist, 'robots.txt');

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

check('dist/index.html exists', existsSync(indexPath));
check('dist/robots.txt exists', existsSync(robotsPath));

let html = '';
if (existsSync(indexPath)) {
  html = readFileSync(indexPath, 'utf8');
  check(
    'index.html contains wordmark',
    html.includes('Innovative Medical Staffing'),
  );
  check(
    'index.html contains sub-line',
    html.includes("We&#x27;re crafting something new") ||
      html.includes("We're crafting something new"),
  );
  check(
    'index.html contains noindex meta',
    /<meta\s+name=["']robots["']\s+content=["']noindex,\s*nofollow["']/i.test(html),
  );
  check(
    'index.html declares color-scheme support',
    html.includes('color-scheme'),
  );
}

// CSS may be inlined in <style> in index.html (small projects) or bundled
// to dist/_astro/*.css (larger projects). Combine both sources for the check.
const bundledCss = findCssFiles(join(dist, '_astro'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const allCss = html + '\n' + bundledCss;

check('IAS tokens present (--bg)', allCss.includes('--bg:'));
check('IAS tokens present (--text)', allCss.includes('--text:'));
check(
  'dark-mode block present',
  /prefers-color-scheme:\s*dark/i.test(allCss),
);
check(
  'SF Pro / system font stack present',
  allCss.includes('-apple-system') || allCss.includes('SF Pro'),
);

if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, 'utf8');
  check('robots.txt has Disallow: /', /Disallow:\s*\/\s*$/m.test(robots));
}

if (failures > 0) {
  console.error(`\nverify-build FAILED (${failures} check(s))`);
  process.exit(1);
}
console.log('\nverify-build OK');
