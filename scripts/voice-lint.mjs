#!/usr/bin/env node
// Voice + visual lint — advisory at v1 (exit 0 always, prints findings to stderr)
// Spec §4.5 / §0.5.6. Promoted to BLOCKING for BANNED tier at Phase 1.5.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BANNED = [
  'streamline', 'streamlining', 'solutions', 'premier',
  'disrupt', 'disruptive', 'scale', 'gig', 'rockstar',
  'ninja', 'game-changing', 'best-in-class', 'cutting-edge',
  'seamless', 'seamlessly', 'revolutionize', 'revolutionary',
];
const CARE = ['ai', 'platform', 'pipeline', 'database'];
const VISUAL_BANNED = [
  'crossed-arms', 'stethoscope-stock', 'neural-mesh', 'data-stream',
  'blue-gradient-medical', 'hospital-hallway-stock',
];

const ROOT = process.cwd();
const TARGETS = ['src', 'docs/specs']; // .astro/.md only — MDX dropped from Phase 1 per spec §0.5.1
const EXTS = new Set(['.astro', '.md']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else {
      const dot = entry.lastIndexOf('.');
      if (dot >= 0 && EXTS.has(entry.slice(dot))) out.push(full);
    }
  }
  return out;
}

function checkLine(line, lineNum, file, findings) {
  const lower = line.toLowerCase();
  for (const word of BANNED) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(line)) findings.push({ file, lineNum, tier: 'BANNED', word, line: line.trim() });
  }
  for (const word of CARE) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(line)) findings.push({ file, lineNum, tier: 'CARE', word, line: line.trim() });
  }
  for (const word of VISUAL_BANNED) {
    if (lower.includes(word)) findings.push({ file, lineNum, tier: 'VISUAL', word, line: line.trim() });
  }
}

function scanFile(filepath, findings) {
  // Skip lines inside markdown code fences — the brand spec quotes BANNED
  // words in anti-pattern arrays + lists which are real anti-patterns, not
  // real copy. Without this, advisory output is noise-dominated and new
  // real violations would blend into the baseline.
  const lines = readFileSync(filepath, 'utf8').split(/\r?\n/);
  const rel = relative(ROOT, filepath);
  let inCodeFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;
    checkLine(line, i + 1, rel, findings);
  });
}

const findings = [];
const scanErrors = [];
for (const target of TARGETS) {
  const dir = join(ROOT, target);
  let files = [];
  try {
    files = walk(dir);
  } catch (err) {
    // Don't silently drop coverage — surface every walk failure to stderr
    // even in advisory mode so '0 findings' isn't misread as 'all clean'
    // when entire trees were skipped.
    scanErrors.push({ target, message: err && err.message ? err.message : String(err) });
    continue;
  }
  for (const file of files) {
    try {
      scanFile(file, findings);
    } catch (err) {
      scanErrors.push({ target: file, message: err && err.message ? err.message : String(err) });
    }
  }
}

if (scanErrors.length > 0) {
  process.stderr.write(`voice-lint: ${scanErrors.length} scan error(s) — coverage INCOMPLETE:\n`);
  for (const e of scanErrors) {
    process.stderr.write(`  scan-error: ${e.target}: ${e.message}\n`);
  }
}

if (findings.length === 0 && scanErrors.length === 0) {
  console.log('voice-lint: 0 findings');
  process.exit(0);
}

if (findings.length === 0) {
  // Errors but no findings — still advisory exit 0 per spec §0.5.6, but the
  // scan-error block above already documented what was skipped.
  process.stderr.write('voice-lint: 0 findings (with scan errors above) — ADVISORY exit 0\n');
  process.exit(0);
}

// Advisory mode at v1 — print to stderr, exit 0
process.stderr.write(`voice-lint: ${findings.length} advisory finding(s)\n`);
for (const f of findings) {
  process.stderr.write(`  [${f.tier}] ${f.file}:${f.lineNum}  "${f.word}"  ${f.line.slice(0, 100)}\n`);
}
process.stderr.write('voice-lint: ADVISORY — not failing build at v1 (spec §0.5.6)\n');
process.exit(0);
