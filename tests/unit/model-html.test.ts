/**
 * Unit Tests — a Markdown response where HTML was asked for.
 *
 * The failure this guards against was seen live: a Schedule "A" came back with
 * "## OVERVIEW" and plain paragraphs, so the deterministic numbering found no
 * <p> to number and the lawyer would have received a document with Markdown
 * printed in it.
 */

import { describe, it, expect } from 'vitest';
import { htmlFromModelText } from '../../src/employment/model-html.js';

describe('htmlFromModelText', () => {
  it('returns proper HTML untouched', () => {
    const html = '<h2>Overview</h2>\n<p>The applicant was dismissed.</p>';
    const out = htmlFromModelText(html);
    expect(out.convertedFromMarkdown).toBe(false);
    expect(out.html).toBe(html);
  });

  it('converts a Markdown response into paragraphs that can be numbered', () => {
    const md = '# SCHEDULE "A"\n\n## OVERVIEW\n\nThe applicant was employed from 1988.\n\nShe was dismissed in 2026.';
    const out = htmlFromModelText(md);
    expect(out.convertedFromMarkdown).toBe(true);
    expect(out.html).toContain('<h2>OVERVIEW</h2>');
    expect((out.html.match(/<p[\s>]/g) ?? []).length).toBe(2);
    expect(out.html).not.toContain('## OVERVIEW');
  });

  it('keeps HTML that was already correct inside a Markdown response', () => {
    const mixed = '## REMEDIES\n\nThe applicant seeks:\n\n<ol><li>Compensation.</li></ol>';
    const out = htmlFromModelText(mixed);
    expect(out.convertedFromMarkdown).toBe(true);
    expect(out.html).toContain('<li>Compensation.</li>');
    expect(out.html).toContain('<h2>REMEDIES</h2>');
  });

  it('leaves a document alone when it has HTML headings, even with a stray hash', () => {
    const html = '<h2>Overview</h2>\n<p>The file number is # 1234.</p>';
    expect(htmlFromModelText(html).convertedFromMarkdown).toBe(false);
  });

  it('does not treat a hash without a following word as a heading', () => {
    const text = '<p>Paragraph.</p>\n#\n<p>Another.</p>';
    expect(htmlFromModelText(text).convertedFromMarkdown).toBe(false);
  });

  it('converts a heading that is not on the first line', () => {
    const md = 'Some preamble text.\n\n## THE FACTS\n\nShe was hired in 1988.';
    expect(htmlFromModelText(md).convertedFromMarkdown).toBe(true);
  });

  it('leaves plain prose with no headings alone', () => {
    const text = '<p>Just a paragraph with no headings at all.</p>';
    expect(htmlFromModelText(text).convertedFromMarkdown).toBe(false);
  });
});
