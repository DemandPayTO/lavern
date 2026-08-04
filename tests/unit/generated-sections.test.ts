/**
 * Unit Tests — generated-document section splitting (Phase 3).
 *
 * A firm template that names where each part of the document goes should
 * receive the parts, not the whole document repeated. The properties that
 * matter: existing letterhead templates keep working unchanged, generated
 * content is never silently dropped, and each section lands in its own
 * placeholder.
 */

import { describe, it, expect } from 'vitest';
import {
  splitGeneratedSections, wantsSectionedFill, buildSectionValues,
} from '../../src/employment/generated-sections.js';

// The shape the demand-letter generator actually emits (headings verified
// against eval-results output).
const GENERATED = [
  '<h1>Demand Letter — Marcus Webb adv. Cadence Manufacturing Ltd</h1>',
  '<p>Dear Sirs/Mesdames:</p>',
  '<h2>Employment Background</h2>',
  '<p>Mr. Webb was employed from 2015.</p>',
  '<h2>Termination Facts</h2>',
  '<p>He was terminated on May 2, 2026.</p>',
  '<h2>Legal Analysis</h2>',
  '<p>The termination clause is unenforceable per Waksdale.</p>',
  '<h2>Damages Quantification</h2>',
  '<p>Twelve months of notice, being $96,000.</p>',
  '<h2>Demand</h2>',
  '<p>We demand $110,000.</p>',
  '<h2>Closing</h2>',
  '<p>Respond within 14 days.</p>',
].join('\n');

describe('splitting', () => {
  it('splits a generated document at its section headings', () => {
    const { sections, preamble } = splitGeneratedSections(GENERATED);

    expect(Object.keys(sections).sort()).toEqual([
      'CLOSING', 'DAMAGES_SECTION', 'DEMAND', 'EMPLOYMENT_BACKGROUND',
      'LEGAL_ANALYSIS', 'TERMINATION_FACTS',
    ]);
    expect(sections.EMPLOYMENT_BACKGROUND).toContain('employed from 2015');
    expect(sections.LEGAL_ANALYSIS).toContain('Waksdale');
    expect(sections.DEMAND).toContain('$110,000');

    // Each section carries only its own content.
    expect(sections.EMPLOYMENT_BACKGROUND).not.toContain('Waksdale');
    expect(sections.DEMAND).not.toContain('employed from 2015');

    // The title and salutation land in the preamble, not in a section.
    expect(preamble).toContain('Dear Sirs/Mesdames');
  });

  it('returns the whole document as preamble when there are no headings', () => {
    const plain = '<p>One paragraph, no headings at all.</p>';
    const { sections, preamble } = splitGeneratedSections(plain);
    expect(Object.keys(sections)).toHaveLength(0);
    expect(preamble).toBe(plain);
  });

  it('keeps unknown headings with the preceding section rather than dropping them', () => {
    const html = [
      '<h2>Legal Analysis</h2><p>Analysis.</p>',
      '<h2>Some Firm-Specific Heading</h2><p>Important content.</p>',
    ].join('\n');
    const { sections, unmatchedHeadings } = splitGeneratedSections(html);
    expect(unmatchedHeadings).toContain('some firm-specific heading');
    expect(sections.LEGAL_ANALYSIS).toContain('Important content.');
  });
});

describe('deciding whether to section', () => {
  it('leaves existing letterhead templates alone', () => {
    // The historical shape: one whole-document marker.
    expect(wantsSectionedFill(['CLIENT_NAME', 'LEGAL_ANALYSIS'])).toBe(false);
    // Both aliases together are still just "put the document here".
    expect(wantsSectionedFill(['LEGAL_ANALYSIS', 'FACTS_SECTION'])).toBe(false);
    expect(wantsSectionedFill(['CLIENT_NAME', 'FIRM_NAME'])).toBe(false);
  });

  it('sections when the template names distinct parts', () => {
    expect(wantsSectionedFill(['EMPLOYMENT_BACKGROUND', 'LEGAL_ANALYSIS'])).toBe(true);
    expect(wantsSectionedFill(['CLIENT_NAME', 'TERMINATION_FACTS', 'DEMAND', 'CLOSING'])).toBe(true);
  });
});

describe('building the values a sectioned template receives', () => {
  it('gives each named section its own content', () => {
    const values = buildSectionValues(GENERATED, [
      'CLIENT_NAME', 'EMPLOYMENT_BACKGROUND', 'TERMINATION_FACTS', 'LEGAL_ANALYSIS', 'DEMAND',
    ]);
    expect(values.EMPLOYMENT_BACKGROUND).toContain('employed from 2015');
    expect(values.TERMINATION_FACTS).toContain('May 2, 2026');
    expect(values.LEGAL_ANALYSIS).toContain('Waksdale');
    expect(values.DEMAND).toContain('$110,000');
    // A non-section marker is not given content here.
    expect(values.CLIENT_NAME).toBeUndefined();
  });

  it('never drops generated content the template has no placeholder for', () => {
    // The template omits damages and closing entirely.
    const values = buildSectionValues(GENERATED, ['EMPLOYMENT_BACKGROUND', 'LEGAL_ANALYSIS']);
    const all = Object.values(values).join('\n');

    // The damages figures and the closing must still reach the document.
    expect(all).toContain('$96,000');
    expect(all).toContain('Respond within 14 days');
    // And the salutation from the preamble.
    expect(all).toContain('Dear Sirs/Mesdames');
  });

  it('folds orphaned content into the first named section, in document order', () => {
    const values = buildSectionValues(GENERATED, ['LEGAL_ANALYSIS', 'DEMAND']);
    // Employment background and termination facts have nowhere of their own,
    // so they arrive ahead of the analysis rather than vanishing.
    expect(values.LEGAL_ANALYSIS).toContain('employed from 2015');
    expect(values.LEGAL_ANALYSIS).toContain('Waksdale');
    expect(values.DEMAND).toContain('$110,000');
  });
});
