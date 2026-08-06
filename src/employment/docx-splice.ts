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
