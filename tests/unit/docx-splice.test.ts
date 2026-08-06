/**
 * Unit Tests — putting generated content into a firm's Word template.
 *
 * The failure this replaces was verified on a real template: the letter's
 * HTML went into a single text run, so a firm that uploaded its letterhead
 * got "<p><strong>WITHOUT PREJUDICE</strong></p>" printed on the page.
 *
 * The splice has to replace the whole paragraph holding the marker. Word
 * paragraphs cannot nest, so putting several <w:p> elements inside one is
 * a file Word refuses to open.
 */

import { describe, it, expect } from 'vitest';
import {
  spliceIntoParagraph, looksLikeHtml, escapeXml, renderHtmlAsWordXml,
} from '../../src/employment/docx-splice.js';
import { htmlToParagraphs } from '../../src/employment/docx-export.js';

const template = [
  '<w:body>',
  '<w:p><w:r><w:t>August 5, 2026</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>{{LEGAL_ANALYSIS}}</w:t></w:r></w:p>',
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
  '</w:body>',
].join('');

describe('spliceIntoParagraph', () => {
  const body = '<w:p><w:r><w:t>One.</w:t></w:r></w:p><w:p><w:r><w:t>Two.</w:t></w:r></w:p>';

  it('replaces the paragraph, never nests inside it', () => {
    const out = spliceIntoParagraph(template, 'LEGAL_ANALYSIS', body);
    expect(out).toContain('One.');
    expect(out).toContain('Two.');
    expect(out).not.toContain('{{LEGAL_ANALYSIS}}');
    // The marker's own paragraph is gone, not wrapped around the new ones.
    expect(out).not.toMatch(/<w:p><w:r><w:t><w:p>/);
  });

  it('leaves the rest of the template alone, page setup included', () => {
    const out = spliceIntoParagraph(template, 'LEGAL_ANALYSIS', body);
    expect(out).toContain('August 5, 2026');
    expect(out).toContain('<w:sectPr>');
    expect(out).toContain('w:pgSz');
  });

  it('handles a paragraph with properties on its opening tag', () => {
    const withProps = '<w:body><w:p w:rsidR="00A1"><w:r><w:t>{{X}}</w:t></w:r></w:p></w:body>';
    const out = spliceIntoParagraph(withProps, 'X', body);
    expect(out).toBe(`<w:body>${body}</w:body>`);
  });

  it('does nothing when the marker is not in the template', () => {
    expect(spliceIntoParagraph(template, 'NOT_PRESENT', body)).toBe(template);
  });

  it('leaves a marker with no enclosing paragraph visible rather than corrupting the file', () => {
    const loose = '<w:body>{{LEGAL_ANALYSIS}}</w:body>';
    expect(spliceIntoParagraph(loose, 'LEGAL_ANALYSIS', body)).toBe(loose);
  });
});

describe('looksLikeHtml', () => {
  it('recognises generated content', () => {
    expect(looksLikeHtml('<p>We act for the plaintiff.</p>')).toBe(true);
    expect(looksLikeHtml('<h2>Demand</h2>')).toBe(true);
    expect(looksLikeHtml('<table><tr><td>x</td></tr></table>')).toBe(true);
  });

  it('leaves plain values alone, so they stay text', () => {
    expect(looksLikeHtml('Evans Law Firm')).toBe(false);
    expect(looksLikeHtml('DP-2026-004')).toBe(false);
    // A firm name with an angle bracket is still not markup.
    expect(looksLikeHtml('Smith < Jones')).toBe(false);
  });
});

describe('escapeXml', () => {
  it('escapes what would otherwise break the document', () => {
    // "Smith & Jones Inc" produced XML Word could not open.
    expect(escapeXml('Smith & Jones Inc')).toBe('Smith &amp; Jones Inc');
    expect(escapeXml('a < b > c')).toBe('a &lt; b &gt; c');
    expect(escapeXml('say "yes"')).toBe('say &quot;yes&quot;');
  });
});

describe('renderHtmlAsWordXml', () => {
  it('turns the letter into Word paragraphs and a Word table', async () => {
    const html = [
      '<p><strong>WITHOUT PREJUDICE</strong></p>',
      '<h2>Damages Quantification</h2>',
      '<table><tr><th>Head</th><th>Amount</th></tr><tr><td>Notice</td><td>$8,462</td></tr></table>',
    ].join('');
    const xml = await renderHtmlAsWordXml(html, htmlToParagraphs as never);

    expect(xml).toContain('<w:p');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('WITHOUT PREJUDICE');
    expect(xml).toContain('$8,462');
    // No HTML survives into the Word file.
    expect(xml).not.toContain('<p>');
    expect(xml).not.toContain('<strong>');
  });

  it('leaves out the section properties, which belong to the template', async () => {
    // The template's sectPr carries the page size, margins, and the header
    // and footer references. Ours must not replace it.
    const xml = await renderHtmlAsWordXml('<p>Body.</p>', htmlToParagraphs as never);
    expect(xml).not.toContain('<w:sectPr');
  });

  it('names no font, so the firm’s own typeface applies', async () => {
    const xml = await renderHtmlAsWordXml('<p>Body.</p><table><tr><td>cell</td></tr></table>', htmlToParagraphs as never);
    expect(xml).not.toContain('Times New Roman');
  });

  it('is empty for empty content, so the caller can fall back', async () => {
    expect(await renderHtmlAsWordXml('', htmlToParagraphs as never)).toBe('');
  });
});
