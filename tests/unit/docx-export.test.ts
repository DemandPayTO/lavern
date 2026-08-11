/**
 * Unit Tests — DOCX export (src/employment/docx-export.ts)
 *
 * Court documents require numbered paragraphs: an SOC's facts arrive as
 * <ol><li> and each item must carry its sequential number in the DOCX.
 * We verify by extracting the document text from the packed .docx XML.
 */

import { describe, it, expect } from 'vitest';
import { htmlToDocx } from '../../src/employment/docx-export.js';

/** Pull the word/document.xml text content out of a packed DOCX buffer. */
async function docxText(buffer: Buffer): Promise<string> {
  // A .docx is a zip; unzip in-memory via jszip (already a docx dependency)
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  // Strip XML tags to get readable text
  return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('htmlToDocx — ordered list numbering', () => {
  it('numbers <ol><li> items sequentially', async () => {
    const html = `
      <h2>The Facts</h2>
      <ol>
        <li>The Plaintiff was employed by the Defendant for eight years.</li>
        <li>The Plaintiff was terminated without cause on January 15, 2026.</li>
        <li>The termination clause violates the ESA.</li>
      </ol>`;
    const buffer = await htmlToDocx(html, { title: 'Test SOC' });
    const text = await docxText(buffer);

    expect(text).toContain('1.');
    expect(text).toContain('2.');
    expect(text).toContain('3.');
    expect(text).toContain('terminated without cause');
  });

  it('does not double-number items the model already numbered', async () => {
    const html = '<ol><li>7. The Plaintiff claims damages.</li></ol>';
    const buffer = await htmlToDocx(html, { title: 'Test' });
    const text = await docxText(buffer);

    expect(text).toContain('7. The Plaintiff claims damages');
    // No "1. 7." double prefix
    expect(text).not.toMatch(/1\.\s*7\./);
  });

  it('resets numbering between separate ordered lists', async () => {
    const html = `
      <ol><li>First list item one.</li><li>First list item two.</li></ol>
      <p>Interlude paragraph.</p>
      <ol><li>Second list item one.</li></ol>`;
    const buffer = await htmlToDocx(html, { title: 'Test' });
    const text = await docxText(buffer);

    // The second list restarts at 1 — so "1." appears before both
    // "First list item one" and "Second list item one", and "3." never appears
    expect(text).not.toContain('3.');
    expect(text).toContain('Second list item one');
  });

  it('leaves unordered <ul><li> items un-numbered', async () => {
    const html = '<ul><li>Bullet point alpha.</li><li>Bullet point beta.</li></ul>';
    const buffer = await htmlToDocx(html, { title: 'Test' });
    const text = await docxText(buffer);

    expect(text).toContain('Bullet point alpha');
    expect(text).not.toMatch(/1\.\s*Bullet point alpha/);
  });
});

describe('htmlToDocx — court format is court-ready', () => {
  const SOC_HTML = [
    '<p class="right">Court File No.: CV-26-001</p>',
    '<p class="centre"><strong>ONTARIO<br>SUPERIOR COURT OF JUSTICE</strong></p>',
    '<p class="centre"><strong>AISHA OSEI</strong></p>',
    '<p class="centre"><strong><u>STATEMENT OF CLAIM</u></strong></p>',
    '<p>1. The Plaintiff claims against the Defendant.</p>',
    '<hr>',
    '<p class="centre">OSEI v. ACME</p>',
    '<p class="centre">PROCEEDING COMMENCED AT TORONTO</p>',
  ].join('\n');

  async function rawXml(buffer: Buffer, file: string): Promise<string> {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buffer);
    const f = zip.file(file);
    return f ? await f.async('string') : '';
  }

  it('centres and right-aligns the cover, underlines the title, double-spaces in TNR', async () => {
    const buffer = await htmlToDocx(SOC_HTML, { title: 'Statement of Claim', documentType: 'statement_of_claim', firmName: 'Evans Law Firm' });
    const xml = await rawXml(buffer, 'word/document.xml');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:jc w:val="right"/>');
    const title = xml.slice(Math.max(0, xml.indexOf('STATEMENT OF CLAIM') - 400), xml.indexOf('STATEMENT OF CLAIM'));
    expect(title).toContain('<w:u ');
    expect(xml).toContain('Times New Roman');
    expect(xml).toContain('w:line="480"');
  });

  it('the backsheet gets its own page: hr becomes a page break in court format', async () => {
    const buffer = await htmlToDocx(SOC_HTML, { title: 'Statement of Claim', documentType: 'statement_of_claim' });
    const xml = await rawXml(buffer, 'word/document.xml');
    expect(xml).toContain('<w:pageBreakBefore/>');
    const afterBreak = xml.slice(xml.indexOf('<w:pageBreakBefore/>'));
    expect(afterBreak).toContain('PROCEEDING COMMENCED AT');
  });

  it('a court document carries no firm chrome: page number only', async () => {
    const buffer = await htmlToDocx(SOC_HTML, { title: 'Statement of Claim', documentType: 'statement_of_claim', firmName: 'Evans Law Firm', lawyerName: 'Jordan Evans' });
    const header = await rawXml(buffer, 'word/header1.xml');
    const footer = await rawXml(buffer, 'word/footer1.xml');
    expect(header).not.toContain('Evans');
    expect(footer).toContain('PAGE');
    expect(footer).not.toContain('Evans');
  });

  it('a letter keeps its rule and its firm header: court furniture stays in court', async () => {
    const buffer = await htmlToDocx('<p>Dear Counsel:</p>\n<hr>\n<p>More text.</p>', { title: 'Letter', documentType: 'demand_letter', firmName: 'Evans Law Firm' });
    const xml = await rawXml(buffer, 'word/document.xml');
    expect(xml).not.toContain('<w:pageBreakBefore/>');
    const header = await rawXml(buffer, 'word/header1.xml');
    expect(header).toContain('Evans');
  });
});
