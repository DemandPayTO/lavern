/**
 * Unit Tests — what a document reads before it drafts.
 *
 * The policy lived in five routes and they disagreed. These pin the answers,
 * including the two that were wrong: the claim's section-by-section facts
 * route read nothing, and the mediation brief's section route dropped every
 * attached document while the whole-document route read them all.
 */

import { describe, it, expect } from 'vitest';
import { documentSources, documentSourcesText } from '../../src/api/routes/employment/document-sources.js';

const LONG = (label: string) => `${label} ${'x'.repeat(300)}`;

function matter(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    generatedDemandLetter: { html: `<p>${LONG('DEMAND')}</p>`, docType: 'demand_letter' },
    generatedSOC: { html: `<p>${LONG('CLAIM')}</p>`, docType: 'statement_of_claim' },
    briefSources: [
      { id: 'src-1', name: 'Termination letter', text: LONG('TERMINATION') },
      { id: 'src-2', name: 'Employment agreement', text: LONG('AGREEMENT') },
    ],
    ...over,
  };
}
const names = (r: { sources: Array<{ name: string }> }) => r.sources.map(s => s.name);

describe('documentSources', () => {
  it('gives the claim the demand letter automatically', () => {
    const r = documentSources(matter(), { documentType: 'statement_of_claim' });
    expect(names(r)).toContain('the demand letter on this matter');
  });

  // A claim that reads itself would restate its own pleading back at itself.
  it('never gives the claim itself as a source', () => {
    const r = documentSources(matter(), { documentType: 'statement_of_claim', includeGeneratedClaim: true });
    expect(names(r)).not.toContain('the statement of claim on this matter');
  });

  it('reads the ticked attachments and ignores the unticked', () => {
    const r = documentSources(matter(), { documentType: 'statement_of_claim', briefSourceIds: ['src-2'] });
    expect(names(r)).toContain('Employment agreement');
    expect(names(r)).not.toContain('Termination letter');
  });

  it('reads nothing from the store when nothing is ticked', () => {
    const r = documentSources(matter(), { documentType: 'statement_of_claim' });
    expect(names(r)).not.toContain('Termination letter');
    expect(names(r)).not.toContain('Employment agreement');
  });

  it('still reads the legacy single attachment on the claim', () => {
    const r = documentSources(matter({ socSource: { name: 'Old attachment', text: LONG('OLD') } }), { documentType: 'statement_of_claim' });
    expect(names(r)).toContain('Old attachment');
  });

  it('gives the brief both positions, and lets the lawyer switch one off', () => {
    const both = documentSources(matter(), { documentType: 'mediation_brief' });
    expect(names(both)).toEqual(expect.arrayContaining([
      'the demand letter on this matter', 'the statement of claim on this matter',
    ]));
    const noClaim = documentSources(matter(), { documentType: 'mediation_brief', includeGeneratedClaim: false });
    expect(names(noClaim)).not.toContain('the statement of claim on this matter');
  });

  // The claim's demand letter is policy, not preference: the claim must not
  // contradict the position already taken.
  it('does not let a flag switch off what the policy requires', () => {
    const r = documentSources(matter(), { documentType: 'statement_of_claim', includeGeneratedDemand: false });
    expect(names(r)).toContain('the demand letter on this matter');
  });

  it('gives Schedule A the same store the brief reads', () => {
    const r = documentSources(matter(), { documentType: 'hrto_schedule_a', briefSourceIds: ['src-1'] });
    expect(names(r)).toContain('Termination letter');
  });

  it('reads no generated positions for a document with no policy', () => {
    const r = documentSources(matter(), { documentType: 'discovery_plan', briefSourceIds: ['src-1'] });
    expect(names(r)).toEqual(['Termination letter']);
  });

  it('caps at six sources and reports what it dropped', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Doc ${i}`, text: LONG(`D${i}`) }));
    const r = documentSources(matter({ briefSources: many }), {
      documentType: 'mediation_brief',
      briefSourceIds: many.map(m => m.id),
    });
    expect(r.sources).toHaveLength(6);
    expect(r.dropped.length).toBeGreaterThan(0);
  });

  it('skips a source with no text rather than passing an empty one', () => {
    const r = documentSources(matter({ briefSources: [{ id: 'e', name: 'Empty', text: '   ' }] }), {
      documentType: 'mediation_brief', briefSourceIds: ['e'],
    });
    expect(names(r)).not.toContain('Empty');
  });

  it('skips a generated document that was never generated', () => {
    const r = documentSources({ briefSources: [] }, { documentType: 'mediation_brief' });
    expect(r.sources).toHaveLength(0);
  });

  it('strips the markup from a generated document', () => {
    const r = documentSources(matter(), { documentType: 'statement_of_claim' });
    const demand = r.sources.find(s => s.name === 'the demand letter on this matter');
    expect(demand?.content).not.toContain('<p>');
    expect(demand?.content).toContain('DEMAND');
  });

  it('takes documents supplied with the request as well as stored ones', () => {
    const r = documentSources(matter(), {
      documentType: 'mediation_brief',
      extraSources: [{ name: 'Pasted memo', text: LONG('MEMO') }],
    });
    expect(names(r)).toContain('Pasted memo');
  });
});

describe('documentSourcesText', () => {
  it('labels each source so the model can attribute a fact to it', () => {
    const text = documentSourcesText([{ name: 'Termination letter', content: 'You are dismissed.' }]);
    expect(text).toContain('[Termination letter]');
    expect(text).toContain('You are dismissed.');
  });

  it('says nothing at all when there are no sources', () => {
    expect(documentSourcesText([])).toBeUndefined();
  });
});
