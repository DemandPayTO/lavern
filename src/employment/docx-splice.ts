/**
 * Putting generated content into a firm's own Word template.
 *
 * The template machinery already preserves everything that makes a letter
 * look like the firm's: the letterhead graphic, the fonts, the margins,
 * the header and footer. It did that by editing the firm's .docx directly,
 * which is the right approach and is what Contract Express does.
 *
 * What it did NOT do was convert the generated document into Word content.
 * The letter's HTML was dropped into a single text run, so a firm that
 * uploaded its letterhead got a document with "<p><strong>WITHOUT
 * PREJUDICE</strong></p>" printed on the page as literal text, in one
 * unbroken run, with no paragraphs, no bold and no damages table. Verified
 * on a real template before this module existed.
 *
 * This converts the HTML to real WordprocessingML and splices it in.
 *
 * Three things make the splice safe rather than corrupting:
 *
 * IT REPLACES THE PARAGRAPH, NOT THE MARKER. Word paragraphs cannot nest.
 * Substituting several <w:p> elements INSIDE the <w:p> that holds the
 * marker produces a file Word refuses to open, so the whole enclosing
 * paragraph goes and the generated paragraphs take its place.
 *
 * IT CARRIES NO STYLE REFERENCES. The generated content uses direct
 * formatting only (bold, spacing, borders), never named styles or a
 * numbering definition, so nothing it emits can reference a style or a
 * list that the firm's styles.xml and numbering.xml do not define.
 *
 * IT INHERITS THE FIRM'S TYPE. Runs are emitted without a font or size so
 * the template's own defaults apply. A letter on the firm's letterhead
 * should be in the firm's typeface, not ours.
 */

import { Document, Packer } from 'docx';
import JSZip from 'jszip';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DOCX-SPLICE');

/** XML-escape a value destined for a <w:t> element or an attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Does this value need converting to Word content, or is it a plain string? */
export function looksLikeHtml(value: string): boolean {
  return /<(p|h[1-6]|table|ul|ol|li|div|br|strong|em)\b[^>]*>/i.test(value);
}

/**
 * Render generated HTML as WordprocessingML body content.
 *
 * Builds a throwaway document with the same converter the standalone
 * export uses, then lifts the body out of it. Going through the library
 * rather than emitting XML by hand means paragraph properties, table grids
 * and run properties are all produced by code that is already exercised.
 */
export async function renderHtmlAsWordXml(
  html: string,
  htmlToParagraphs: (html: string, opts?: { inheritFont?: boolean }) => Array<never>,
): Promise<string> {
  const children = htmlToParagraphs(html, { inheritFont: true });
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) return '';
  const xml = await file.async('string');

  // Everything inside <w:body>, minus the section properties, which belong
  // to the TEMPLATE's section and must not be replaced by ours: they carry
  // the page size, the margins and the header and footer references.
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml);
  if (!body) return '';
  return body[1].replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '').trim();
}

/**
 * Replace the paragraph containing {{MARKER}} with the given body XML.
 *
 * Returns the XML unchanged when the marker is not present, so callers can
 * apply this for every marker without checking first.
 */
export function spliceIntoParagraph(documentXml: string, marker: string, bodyXml: string): string {
  const markerText = `{{${marker}}}`;
  const at = documentXml.indexOf(markerText);
  if (at === -1) return documentXml;

  // The enclosing <w:p>. Search backwards for its opening tag and forwards
  // for its close, so the whole paragraph is replaced rather than the text
  // inside it.
  const open = documentXml.lastIndexOf('<w:p ', at);
  const openShort = documentXml.lastIndexOf('<w:p>', at);
  const start = Math.max(open, openShort);
  const closeAt = documentXml.indexOf('</w:p>', at);
  if (start === -1 || closeAt === -1) {
    // No enclosing paragraph to replace. Leaving the marker visible is
    // better than emitting content Word cannot open.
    logger.warn('Marker had no enclosing paragraph; left in place', { marker });
    return documentXml;
  }

  return documentXml.slice(0, start) + bodyXml + documentXml.slice(closeAt + '</w:p>'.length);
}

// ── Templates with no markers ────────────────────────────────────────────

/** Markers that mean "the generated document goes here". */
const BODY_MARKERS = ['LEGAL_ANALYSIS', 'FACTS_SECTION', 'DOCUMENT_BODY', 'BODY'];

/** Does this template say anywhere that the generated document goes in it? */
export function hasBodyMarker(documentXml: string): boolean {
  return BODY_MARKERS.some(m => documentXml.includes(`{{${m}}}`));
}

/**
 * Put the generated document on a template that carries no markers.
 *
 * A firm precedent is usually a letterhead and a skeleton, not a file with
 * our markers in it. Uploading one produced a download that was the
 * precedent, unchanged, with none of the letter in it: the template had
 * nothing to fill, so nothing was filled, and the result looked like a
 * finished document. A lawyer could send an empty letter.
 *
 * Treated as letterhead: the body is replaced by the generated document
 * and everything that makes it the firm's is kept, which is what a lawyer
 * means by "put my letter on this". The section properties stay, since
 * they carry the page size, the margins and the header and footer links.
 * The caller is told this happened; it is never silent.
 */
export function replaceBodyContent(documentXml: string, bodyXml: string): string {
  const body = /(<w:body>)([\s\S]*)(<\/w:body>)/.exec(documentXml);
  if (!body || !bodyXml) return documentXml;

  const sectPr = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(body[2]);
  const kept = sectPr ? sectPr[0] : '';
  return documentXml.slice(0, body.index)
    + body[1] + bodyXml + kept + body[3]
    + documentXml.slice(body.index + body[0].length);
}

/**
 * Placeholder conventions a firm precedent might already use.
 *
 * A template full of [CLIENT NAME] or «Client Name» is a template someone
 * has already marked up, just not in the notation Starling reads. Saying
 * so beats reporting zero placeholders and leaving the lawyer to guess.
 */
export function detectForeignMarkerStyle(text: string): string | null {
  const conventions: Array<{ label: string; re: RegExp }> = [
    { label: 'square brackets, for example [CLIENT NAME]', re: /\[[A-Z][A-Z \-_/]{2,40}\]/ },
    { label: 'guillemets, for example \u00abClient Name\u00bb', re: /\u00ab[^\u00bb]{2,40}\u00bb/ },
    { label: 'angle brackets, for example <<Client Name>>', re: /<<[^>]{2,40}>>/ },
    { label: 'underscores, for example ____________', re: /_{6,}/ },
  ];
  for (const c of conventions) if (c.re.test(text)) return c.label;
  return null;
}

// ── The firm's own notation ──────────────────────────────────────────────

/**
 * Fill the firm's OWN placeholders in its template.
 *
 * A firm precedent is already marked up, just not in Starling's notation:
 * [CLIENT NAME], [DATE], [NAME OF RECIPIENT]. Ignoring them meant the
 * template's carefully built opening was thrown away and rebuilt from
 * Starling's format, when the firm had already written the one it wanted.
 *
 * Only names that RESOLVE are touched. A bracket the resolver does not
 * know is left exactly as the firm wrote it, so an unrecognised marker
 * stays visible for the lawyer rather than becoming a wrong value or an
 * empty space. Prose that merely uses brackets, like a citation year, is
 * left alone for the same reason.
 */
export function fillFirmMarkers(
  documentXml: string,
  slots: Record<string, string | undefined>,
): { xml: string; filled: string[]; unresolved: string[] } {
  const filled = new Set<string>();
  const unresolved = new Set<string>();

  const xml = documentXml.replace(/\[([A-Z][A-Z0-9 _'-]{1,40})\]/g, (whole, rawName: string) => {
    const name = rawName.trim().toUpperCase();
    const value = slots[name] ?? slots[name.replace(/\s+NAME$/, '')] ?? slots[`${name} NAME`];
    if (!value) { unresolved.add(name); return whole; }
    filled.add(name);
    return escapeXml(value);
  });

  return { xml, filled: [...filled], unresolved: [...unresolved] };
}

/**
 * Does the template already carry the letter's opening?
 *
 * Where it does, Starling's opening would be the second one on the page.
 * Judged from the markings a letter opening has and a bare letterhead does
 * not: a salutation, a subject line, or a without-prejudice marking in the
 * BODY rather than the header.
 */
export function templateHasOwnOpening(bodyText: string): boolean {
  const head = bodyText.slice(0, 1_500);
  // Anchored patterns are wrong here: the template's text arrives with its
  // newlines collapsed, so a line-start "RE:" never matched and the check
  // was leaning on the other marks alone.
  const marks = [
    /\bdear\b/i,
    /\bre:\s/i,
    /without prejudice/i,
    /\battention:/i,
  ];
  return marks.filter(m => m.test(head)).length >= 2;
}

/**
 * Remove the letter's opening from generated content.
 *
 * Used when the firm's template carries its own opening: without this the
 * page shows two, the template's and Starling's. Only the LEADING run of
 * furniture paragraphs goes, so a "without prejudice" reservation in the
 * closing, which is substantive, survives.
 */
export function stripLeadingFurniture(html: string): string {
  const FURNITURE = [
    /^without prejudice\.?$/i,
    /^dear\b/i,
    /^re:\s/i,
    /^attention:/i,
    /^our file no/i,
    // An address block: a short line with no sentence in it.
    /^[^.!?]{1,60}$/,
  ];
  const blocks = html.split(/(?=<p[\s>])/i);
  let stillOpening = true;
  return blocks.filter(block => {
    if (!stillOpening) return true;
    const text = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return true;
    // A heading means the body has started, whatever it says.
    if (/^<h[1-6]/i.test(block.trim())) { stillOpening = false; return true; }
    if (FURNITURE.some(re => re.test(text))) return false;
    stillOpening = false;
    return true;
  }).join('');
}
