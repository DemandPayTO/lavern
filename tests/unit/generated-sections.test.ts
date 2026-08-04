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

describe('pinned headings across the generators', () => {
  it('recognises the Statement of Claim sections', () => {
    const soc = [
      '<h1>Statement of Claim</h1>',
      '<h2>Title of Proceedings</h2><p>Ontario Superior Court.</p>',
      '<h2>Claim</h2><p>The Plaintiff claims damages.</p>',
      '<h2>Facts</h2><p>1. The plaintiff was hired in 2015.</p>',
      '<h2>Legal Basis</h2><p>Wrongful dismissal at common law.</p>',
      '<h2>Damages Particulars</h2><p>Twelve months notice.</p>',
    ].join('\n');
    const { sections } = splitGeneratedSections(soc);
    expect(Object.keys(sections).sort()).toEqual([
      'CLAIM', 'DAMAGES_PARTICULARS', 'FACTS_SECTION', 'LEGAL_BASIS', 'TITLE_OF_PROCEEDINGS',
    ]);
    expect(sections.FACTS_SECTION).toContain('hired in 2015');
    expect(sections.CLAIM).not.toContain('hired in 2015');
  });

  it('recognises the severance assessment sections', () => {
    const memo = [
      '<h2>The Offer</h2><p>Eight weeks.</p>',
      '<h2>The Statutory Floor</h2><p>ESA minimum is six weeks.</p>',
      '<h2>The Common Law Range</h2><p>Ten to fourteen months.</p>',
      '<h2>Termination Clause Analysis</h2><p>Likely void per Waksdale.</p>',
      '<h2>The Gap</h2><p>Shortfall of $80,000.</p>',
      '<h2>Other Factors</h2><p>Deadline pressure.</p>',
      '<h2>Recommendation</h2><p>Counter at $120,000.</p>',
    ].join('\n');
    const { sections } = splitGeneratedSections(memo);
    expect(sections.OFFER_SUMMARY).toContain('Eight weeks');
    expect(sections.STATUTORY_FLOOR).toContain('six weeks');
    expect(sections.NOTICE_RANGE).toContain('fourteen months');
    expect(sections.CLAUSE_ANALYSIS).toContain('Waksdale');
    expect(sections.GAP_ANALYSIS).toContain('$80,000');
    expect(sections.RECOMMENDATION).toContain('$120,000');
  });

  it('maps the counter-offer sections onto the shared vocabulary', () => {
    const letter = [
      '<h2>Acknowledgment</h2><p>We have the offer.</p>',
      '<h2>Why the offer is inadequate</h2><p>It is below the Bardal range.</p>',
      '<h2>The counter-position</h2><p>We counter at $130,000.</p>',
      '<h2>Terms</h2><p>Respond within ten days.</p>',
    ].join('\n');
    const { sections } = splitGeneratedSections(letter);
    expect(sections.OFFER_SUMMARY).toContain('We have the offer');
    expect(sections.LEGAL_ANALYSIS).toContain('Bardal');
    expect(sections.DEMAND).toContain('$130,000');
    expect(sections.CLOSING).toContain('ten days');
  });
});


describe('mediation brief sections', () => {
  // The pilot's first real use: a firm template built from mediation
  // precedents must be able to place every narrative section and every
  // front-matter table deliberately.
  it('maps every pinned mediation heading and table to its own marker', () => {
    const html = [
      '<h1>Mediation Brief of the Plaintiff, Jane Smith</h1>',
      '<h2>Profile of the Plaintiff</h2><table><tr><th>Age</th><td>52</td></tr></table>',
      '<h2>Damages Calculation</h2><table><tr><td>Base</td></tr></table>',
      '<h2>Comparable Cases</h2><table><tr><td>Case</td></tr></table>',
      '<h2>Negotiation History</h2><p>No offers.</p>',
      '<h2>Overview</h2><p>1.&nbsp;&nbsp;The case.</p>',
      '<h2>Factual Background</h2><p>2.&nbsp;&nbsp;Hired 2010.</p>',
      '<h2>Issues in Dispute</h2><p>3.&nbsp;&nbsp;Notice period.</p>',
      '<h2>Response to Anticipated Defences</h2><p>4.&nbsp;&nbsp;Cause fails.</p>',
      '<h2>Mitigation</h2><p>5.&nbsp;&nbsp;Forty applications.</p>',
      '<h2>Settlement Position</h2><p>6.&nbsp;&nbsp;Twelve months.</p>',
      '<h2>Mediation Objectives</h2><p>7.&nbsp;&nbsp;Reference letter.</p>',
      '<h2>Practical Considerations</h2><p>8.&nbsp;&nbsp;Costs.</p>',
    ].join('\n');
    const { sections, unmatchedHeadings } = splitGeneratedSections(html);
    expect(unmatchedHeadings).toEqual([]);
    for (const marker of [
      'PROFILE_TABLE', 'DAMAGES_TABLE', 'COMPARABLES_TABLE', 'NEGOTIATION_HISTORY',
      'OVERVIEW', 'FACTUAL_BACKGROUND', 'ISSUES_IN_DISPUTE', 'DEFENCE_RESPONSE',
      'MITIGATION_SECTION', 'SETTLEMENT_POSITION', 'MEDIATION_OBJECTIVES',
      'PRACTICAL_CONSIDERATIONS',
    ]) expect(sections[marker], marker).toBeTruthy();
    expect(sections.SETTLEMENT_POSITION).toContain('Twelve months');
    expect(sections.DAMAGES_TABLE).toContain('<table>');
  });

  it('treats a mediation template naming two sections as sectioned', () => {
    expect(wantsSectionedFill(['OVERVIEW', 'SETTLEMENT_POSITION'])).toBe(true);
  });
});
