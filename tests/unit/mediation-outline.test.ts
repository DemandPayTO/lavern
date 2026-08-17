import { describe, it, expect } from 'vitest';
import {
  mediationSections, buildMediationOutline, mediationDraftReadiness, assembleMediationNarrative, MEDIATION_SECTIONS,
} from '../../src/employment/mediation-outline.js';
import type { MediationDraftState } from '../../src/employment/mediation-outline.js';

describe('mediation outline', () => {
  it('uses the eight standard sections by default', () => {
    const secs = mediationSections();
    expect(secs).toHaveLength(8);
    expect(secs[0].id).toBe('OVERVIEW');
    expect(secs.map(s => s.id)).toContain('SETTLEMENT_POSITION');
    expect(secs.every(s => s.guidance.length > 20)).toBe(true);
  });

  it("uses the firm's flow headings when at least three are supplied", () => {
    const secs = mediationSections(['Our Client', 'The Dismissal', 'What We Seek', 'Why Settle Now']);
    expect(secs).toHaveLength(4);
    expect(secs[0]).toMatchObject({ id: 'FIRM_1', header: 'Our Client' });
    // Fewer than three falls back to the standard set.
    expect(mediationSections(['Only One'])).toHaveLength(MEDIATION_SECTIONS.length);
  });

  it('stamps draft status from the saved draft', () => {
    const draft: MediationDraftState = {
      sections: {
        OVERVIEW: { html: '<p>x</p>', approved: true, generatedAt: 't' },
        MITIGATION: { html: '<p>y</p>', approved: false, generatedAt: 't' },
      },
    };
    const outline = buildMediationOutline(mediationSections(), draft);
    const byId = new Map(outline.map(s => [s.id, s]));
    expect(byId.get('OVERVIEW')!.draftStatus).toBe('approved');
    expect(byId.get('MITIGATION')!.draftStatus).toBe('drafted');
    expect(byId.get('FACTUAL_BACKGROUND')!.draftStatus).toBe('not_drafted');
  });

  it('readiness flags all-approved only when every section is approved', () => {
    const secs = mediationSections();
    const all: MediationDraftState = { sections: Object.fromEntries(secs.map(s => [s.id, { html: '<p>x</p>', approved: true, generatedAt: 't' }])) };
    expect(mediationDraftReadiness(buildMediationOutline(secs, all)).allApproved).toBe(true);
    const partial: MediationDraftState = { sections: { OVERVIEW: { html: '<p>x</p>', approved: true, generatedAt: 't' } } };
    const r = mediationDraftReadiness(buildMediationOutline(secs, partial));
    expect(r.allApproved).toBe(false);
    expect(r.approved).toBe(1);
    expect(r.drafted).toBe(1);
  });

  it('assembles the approved narrative as heading + paragraphs in order', () => {
    const draft: MediationDraftState = {
      sections: {
        OVERVIEW: { html: '<p>The plaintiff was dismissed.</p>', approved: true, generatedAt: 't' },
        SETTLEMENT_POSITION: { html: '<p>The realistic range is eight months.</p>', approved: true, generatedAt: 't' },
      },
    };
    const outline = buildMediationOutline(mediationSections(), draft).filter(s => s.approved);
    const narrative = assembleMediationNarrative(outline);
    expect(narrative).toContain('<h2>Overview</h2>');
    expect(narrative).toContain('The plaintiff was dismissed.');
    expect(narrative.indexOf('Overview')).toBeLessThan(narrative.indexOf('Settlement Position'));
  });
});
