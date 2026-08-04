/**
 * Unit Tests — brief source assembly.
 *
 * The pilot's case: the SOC was drafted OUTSIDE Starling, so the brief
 * must be groundable on attached documents, with the generated positions
 * first, the cap enforced honestly (dropped names reported, never
 * silently vanished), and HTML stripped from generated documents.
 */

import { describe, it, expect } from 'vitest';
import { assembleBriefSources } from '../../src/employment/brief-sources.js';

describe('assembleBriefSources', () => {
  it('puts generated positions first, then attached documents', () => {
    const { sources, dropped } = assembleBriefSources({
      generatedDemandHtml: '<h1>Demand</h1><p>We demand $120,000.</p>',
      generatedSocHtml: undefined,
      includeGeneratedDemand: true,
      includeGeneratedSoc: true,
      extraSources: [
        { name: 'SOC-draft-v3.docx', text: 'The plaintiff claims damages for wrongful dismissal.' },
        { name: 'authorities.docx', text: 'Bardal v Globe & Mail; Waksdale v Swegon.' },
      ],
    });
    expect(sources.map(s => s.title)).toEqual(['Demand Letter', 'SOC-draft-v3.docx', 'authorities.docx']);
    // HTML stripped from the generated document.
    expect(sources[0].text).toBe('Demand We demand $120,000.');
    expect(dropped).toEqual([]);
  });

  it('honours the toggles for generated positions', () => {
    const { sources } = assembleBriefSources({
      generatedDemandHtml: '<p>demand</p>',
      generatedSocHtml: '<p>soc</p>',
      includeGeneratedDemand: false,
      includeGeneratedSoc: true,
      extraSources: [],
    });
    expect(sources.map(s => s.title)).toEqual(['Statement of Claim']);
  });

  it('caps at six sources and names what was dropped', () => {
    const extras = Array.from({ length: 7 }, (_, i) => ({ name: `doc-${i}.docx`, text: 'x'.repeat(50) }));
    const { sources, dropped } = assembleBriefSources({
      generatedDemandHtml: '<p>demand</p>',
      includeGeneratedDemand: true,
      includeGeneratedSoc: true,
      extraSources: extras,
    });
    expect(sources).toHaveLength(6);
    expect(dropped).toEqual(['doc-5.docx', 'doc-6.docx']);
  });

  it('caps each source text and skips empties', () => {
    const { sources } = assembleBriefSources({
      includeGeneratedDemand: true,
      includeGeneratedSoc: true,
      extraSources: [
        { name: 'big.docx', text: 'w '.repeat(80000) },
        { name: 'empty.docx', text: '   ' },
      ],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0].text.length).toBeLessThanOrEqual(60_000);
  });
});
