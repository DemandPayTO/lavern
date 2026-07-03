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
