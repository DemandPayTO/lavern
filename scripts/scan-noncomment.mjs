/**
 * scan-noncomment — grep for a pattern in NON-COMMENT source text.
 *
 * Strips line comments (//...), block comments, and JSX comment wrappers
 * before matching, so language rules (no em-dashes, no contractions in
 * user-facing strings) are checked against code that actually ships, not
 * against developer commentary.
 *
 * Usage: node scripts/scan-noncomment.mjs '<regex>' <dir-or-file> [...]
 * Exits 1 with the offending lines when the pattern is found.
 */

import fs from 'node:fs';
import path from 'node:path';

const [, , pattern, ...targets] = process.argv;
if (!pattern || targets.length === 0) {
  console.error('usage: scan-noncomment.mjs <regex> <dir-or-file>...');
  process.exit(2);
}
const re = new RegExp(pattern);
const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

function* walk(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) { yield target; return; }
  for (const entry of fs.readdirSync(target)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    yield* walk(path.join(target, entry));
  }
}

function stripComments(source) {
  // Remove block comments (including JSDoc) and JSX comment wrappers first,
  // then line comments. String contents are preserved well enough for
  // language-rule scanning; a false negative inside a string containing
  // "//" is acceptable for these lenses.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([^'"`\n]*?)\/\/.*$/gm, '$1');
}

let hits = 0;
for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  for (const file of walk(target)) {
    if (!exts.has(path.extname(file)) || file.includes('.test.')) continue;
    const stripped = stripComments(fs.readFileSync(file, 'utf8'));
    stripped.split('\n').forEach((line, i) => {
      if (re.test(line)) {
        console.error(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
        hits++;
      }
    });
  }
}
process.exit(hits > 0 ? 1 : 0);
