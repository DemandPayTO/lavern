/**
 * DOCX revision extraction — read what a client actually did in Word.
 *
 * Phase 3 of docs/specs/revision-loop-2026-08.md. A client who receives a
 * draft rarely writes a tidy email: they turn on track changes, or leave
 * comments in the margin, and send the file back. Mammoth's text extraction
 * discards both, so this walks the OOXML directly.
 *
 * A .docx is a zip. The parts that matter:
 *   word/document.xml  — the body, with <w:ins> insertions and <w:del>
 *                        deletions inline where changes were tracked, and
 *                        <w:commentRangeStart/End> marking commented spans
 *   word/comments.xml  — the comment text, keyed by id
 *
 * Everything here is deterministic: no model call. The output is fed to the
 * revision planner as feedback, so the lawyer still reviews every item.
 */

import JSZip from 'jszip';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DOCX-REVISIONS');

export interface DocxComment {
  id: string;
  author: string;
  date?: string;
  text: string;
  /** The document text the comment is anchored to, where resolvable. */
  anchoredTo?: string;
}

export interface DocxTrackedChange {
  kind: 'insertion' | 'deletion';
  author: string;
  date?: string;
  text: string;
}

export interface DocxRevisions {
  comments: DocxComment[];
  trackedChanges: DocxTrackedChange[];
  /** Plain text of the document with tracked changes ACCEPTED. */
  acceptedText: string;
  /** True when the file carried no comments and no tracked changes. */
  clean: boolean;
}

/** Text content of a run-bearing XML fragment, in document order. */
function textOf(xml: string): string {
  const parts = [...xml.matchAll(/<w:(?:t|delText)[^>]*>([\s\S]*?)<\/w:(?:t|delText)>/g)].map(m => m[1]);
  return decode(parts.join(''))
    .replace(/\s+/g, ' ')
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(fragment: string, name: string): string | undefined {
  const m = fragment.match(new RegExp(`${name}="([^"]*)"`));
  return m ? decode(m[1]) : undefined;
}

/**
 * Extract comments and tracked changes from a .docx.
 *
 * Returns empty collections rather than throwing when the file has neither,
 * so a plain edited document is a normal case rather than an error.
 */
export async function extractDocxRevisions(buffer: Buffer): Promise<DocxRevisions> {
  const zip = await JSZip.loadAsync(buffer);

  const documentXml = await zip.file('word/document.xml')?.async('string') ?? '';
  const commentsXml = await zip.file('word/comments.xml')?.async('string') ?? '';

  // ── Comments ──────────────────────────────────────────────────────────
  const comments: DocxComment[] = [];
  for (const match of commentsXml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const [, attrs, body] = match;
    const text = textOf(body);
    if (!text) continue;
    comments.push({
      id: attr(attrs, 'w:id') ?? String(comments.length),
      author: attr(attrs, 'w:author') ?? 'Unknown',
      date: attr(attrs, 'w:date'),
      text,
    });
  }

  // Anchor each comment to the document text it marks, so the planner can
  // see WHICH passage the client was pointing at rather than the note alone.
  for (const comment of comments) {
    const span = documentXml.match(
      new RegExp(`<w:commentRangeStart[^>]*w:id="${comment.id}"[^>]*/>([\\s\\S]*?)<w:commentRangeEnd[^>]*w:id="${comment.id}"`),
    );
    if (span) {
      const anchored = textOf(span[1]);
      if (anchored) comment.anchoredTo = anchored.slice(0, 400);
    }
  }

  // ── Tracked changes ───────────────────────────────────────────────────
  const trackedChanges: DocxTrackedChange[] = [];
  for (const match of documentXml.matchAll(/<w:ins\b([^>]*)>([\s\S]*?)<\/w:ins>/g)) {
    const text = textOf(match[2]);
    if (!text) continue;
    trackedChanges.push({
      kind: 'insertion',
      author: attr(match[1], 'w:author') ?? 'Unknown',
      date: attr(match[1], 'w:date'),
      text,
    });
  }
  for (const match of documentXml.matchAll(/<w:del\b([^>]*)>([\s\S]*?)<\/w:del>/g)) {
    const text = textOf(match[2]);
    if (!text) continue;
    trackedChanges.push({
      kind: 'deletion',
      author: attr(match[1], 'w:author') ?? 'Unknown',
      date: attr(match[1], 'w:date'),
      text,
    });
  }

  // ── Body with changes accepted ────────────────────────────────────────
  // Drop deleted runs, keep inserted ones: what the client meant the
  // document to say.
  const acceptedXml = documentXml.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '');
  const paragraphs = [...acceptedXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map(m => textOf(m[1]))
    .filter(Boolean);

  const result: DocxRevisions = {
    comments,
    trackedChanges,
    acceptedText: paragraphs.join('\n'),
    clean: comments.length === 0 && trackedChanges.length === 0,
  };

  logger.info('DOCX revisions extracted', {
    comments: comments.length, trackedChanges: trackedChanges.length, clean: result.clean,
  });
  return result;
}

/**
 * Render extracted comments and tracked changes as feedback prose.
 *
 * The revision planner already takes feedback as text, so rather than a
 * second planning path, what the client did in Word is described in the
 * same terms an email would use. Each item keeps its author and the passage
 * it touched, which is what the planner needs to locate it.
 */
export function revisionsAsFeedback(revisions: DocxRevisions): string {
  const lines: string[] = [];

  for (const c of revisions.comments) {
    lines.push(
      c.anchoredTo
        ? `Comment from ${c.author} on "${c.anchoredTo}": ${c.text}`
        : `Comment from ${c.author}: ${c.text}`,
    );
  }

  for (const t of revisions.trackedChanges) {
    lines.push(
      t.kind === 'insertion'
        ? `${t.author} inserted: "${t.text}"`
        : `${t.author} deleted: "${t.text}"`,
    );
  }

  return lines.join('\n');
}
