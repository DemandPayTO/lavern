/**
 * Canon Store — full texts of the citation-canon decisions, kept on disk
 * with provenance, so quotations and pinpoint references in generated
 * documents can be verified against the actual words of the case rather
 * than the model's memory of them.
 *
 * Storage: <data dir>/canon-cases/<keyword>.txt plus manifest.json
 * recording where each text came from and when. Texts are imported one
 * case at a time (scripts/import-canon-case.ts or the canon-texts route);
 * every entry must correspond to a case in the citation canon.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CITATION_CANON } from './citation-canon.js';

export interface CanonTextMeta {
  keyword: string;
  name: string;
  citation: string;
  source: string;
  retrievedAt: string;
  sha256: string;
  chars: number;
}

function canonDir(): string {
  return process.env.LAVERN_CANON_DIR || path.join(process.cwd(), 'data', 'canon-cases');
}

function manifestPath(): string {
  return path.join(canonDir(), 'manifest.json');
}

function fileFor(keyword: string): string {
  return path.join(canonDir(), `${keyword.replace(/[^a-z0-9]+/g, '-')}.txt`);
}

// Texts are small (a judgment is tens of KB); cache reads per process,
// validated by file mtime so out-of-band changes are picked up.
let textCache: Map<string, { text: string | null; mtimeMs: number }> | null = null;

/** Test hook: drop the in-process cache. */
export function _resetCanonCache(): void {
  textCache = null;
}

function readManifest(): Record<string, CanonTextMeta> {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(), 'utf-8')) as Record<string, CanonTextMeta>;
  } catch {
    return {};
  }
}

/** The canon entry for a keyword, or null when the keyword is not in the canon. */
export function canonEntryFor(keyword: string): { keyword: string; name: string; citations: string[] } | null {
  const k = keyword.trim().toLowerCase();
  return CITATION_CANON.find(c => c.keyword === k) ?? null;
}

/**
 * Save the full text of a canon case. The keyword must belong to the
 * citation canon; provenance is recorded in the manifest.
 */
export function saveCanonText(keyword: string, text: string, source: string): CanonTextMeta {
  const entry = canonEntryFor(keyword);
  if (!entry) {
    throw new Error(`"${keyword}" is not in the citation canon. Add the case to the canon first, then import its text.`);
  }
  const body = text.trim();
  if (body.length < 500) {
    throw new Error('The text is too short to be a full decision. Provide the complete text of the case.');
  }
  fs.mkdirSync(canonDir(), { recursive: true });
  fs.writeFileSync(fileFor(entry.keyword), body, 'utf-8');

  const meta: CanonTextMeta = {
    keyword: entry.keyword,
    name: entry.name,
    citation: entry.citations[0].toUpperCase(),
    source: source.slice(0, 500),
    retrievedAt: new Date().toISOString(),
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    chars: body.length,
  };
  const manifest = readManifest();
  manifest[entry.keyword] = meta;
  fs.writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), 'utf-8');
  _resetCanonCache();
  return meta;
}

/** The stored full text for a canon keyword, or null when not on file. */
export function getCanonText(keyword: string): string | null {
  if (!textCache) textCache = new Map();
  const k = keyword.trim().toLowerCase();
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(fileFor(k)).mtimeMs;
  } catch { /* not on file */ }

  const cached = textCache.get(k);
  if (cached && cached.mtimeMs === mtimeMs) return cached.text;

  let text: string | null = null;
  if (mtimeMs !== -1) {
    try {
      text = fs.readFileSync(fileFor(k), 'utf-8');
    } catch {
      text = null;
    }
  }
  textCache.set(k, { text, mtimeMs });
  return text;
}

/** Provenance for every stored canon text. */
export function listCanonTexts(): CanonTextMeta[] {
  return Object.values(readManifest()).sort((a, b) => a.name.localeCompare(b.name));
}
