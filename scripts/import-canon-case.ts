/**
 * Import a canon case's full text into the canon library.
 *
 * Usage:
 *   npx tsx scripts/import-canon-case.ts <keyword> <file-or-url> [source-note]
 *
 * Examples:
 *   npx tsx scripts/import-canon-case.ts waksdale ~/cases/waksdale-2020-onca-391.html "CanLII, saved 2026-07-05"
 *   npx tsx scripts/import-canon-case.ts hryniak https://canlii.ca/t/g2s18
 *
 * Import cases ONE AT A TIME from their official or CanLII pages; do not
 * script bulk downloads (CanLII's terms prohibit scraping). The text is
 * stored under data/canon-cases/ with provenance (source, date, SHA-256),
 * and from then on every generated document's quotations and pinpoint
 * references to the case are verified against it.
 */

import fs from 'node:fs';
import { saveCanonText, canonEntryFor } from '../src/employment/canon-store.js';

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>(?=\S)/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function main() {
  const [keyword, source, note] = process.argv.slice(2);
  if (!keyword || !source) {
    console.error('Usage: npx tsx scripts/import-canon-case.ts <keyword> <file-or-url> [source-note]');
    process.exit(1);
  }

  const entry = canonEntryFor(keyword);
  if (!entry) {
    console.error(`"${keyword}" is not in the citation canon (src/employment/citation-canon.ts). Add the case to the canon first.`);
    process.exit(1);
  }

  let raw: string;
  let provenance: string;
  if (/^https?:\/\//.test(source)) {
    console.log(`Fetching ${source} ...`);
    const res = await fetch(source, { headers: { 'User-Agent': 'Starling canon import (single case, manual)' } });
    if (!res.ok) {
      console.error(`Fetch failed: HTTP ${res.status}. Save the page manually and import the file instead.`);
      process.exit(1);
    }
    raw = await res.text();
    provenance = note ? `${source} (${note})` : source;
  } else {
    raw = fs.readFileSync(source, 'utf-8');
    provenance = note ? `${source} (${note})` : `file: ${source}`;
  }

  const text = /<\w+[^>]*>/.test(raw) ? htmlToText(raw) : raw;
  const meta = saveCanonText(entry.keyword, text, provenance);
  console.log(`Imported ${meta.name}`);
  console.log(`  citation:   ${meta.citation}`);
  console.log(`  characters: ${meta.chars.toLocaleString('en-CA')}`);
  console.log(`  sha256:     ${meta.sha256.slice(0, 16)}...`);
  console.log(`  source:     ${meta.source}`);
  const hasParas = /\[\s*1\s*\]/.test(text) && /\[\s*2\s*\]/.test(text);
  console.log(`  paragraph markers: ${hasParas ? 'found (pinpoint checking enabled)' : 'NOT found (pinpoint checking disabled for this case)'}`);
}

main().catch(err => {
  console.error('Import failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
