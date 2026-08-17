import { describe, it, expect } from 'vitest';
import { buildFactumOutline, factumDraftReadiness, isStructuralSectionId, structuralSectionKind } from '../../src/employment/factum-outline.js';
import type { FactumDraftState } from '../../src/employment/factum-outline.js';
import type { FactumNodeReport } from '../../src/employment/factum-nodes.js';

function arg(blockId: string, header: string): FactumNodeReport {
  return {
    blockId, sectionHeader: header, issueLabel: header, authorities: 'Bardal v Globe & Mail',
    status: 'firing', reason: '', forceable: true, lawyerReview: false, guidance: `Argue ${header}.`, custom: false,
  };
}

describe('factum outline', () => {
  it('lays out Overview, Facts, the selected arguments, then the Order', () => {
    const sections = buildFactumOutline([arg('FACTUM_NOTICE_01', 'Reasonable Notice'), arg('FACTUM_CLAUSE_01', 'The Clause')], undefined);
    expect(sections.map(s => s.id)).toEqual(['OVERVIEW', 'FACTS', 'FACTUM_NOTICE_01', 'FACTUM_CLAUSE_01', 'ORDER']);
    expect(sections.map(s => s.kind)).toEqual(['overview', 'facts', 'argument', 'argument', 'order']);
    expect(sections.map(s => s.partLabel)).toEqual(['Part I', 'Part II', 'Part III', 'Part III', 'Part IV']);
    // argument sections carry the firm guidance + authorities for drafting.
    expect(sections[2].guidance).toContain('Reasonable Notice');
    expect(sections[2].authorities).toContain('Bardal');
  });

  it('every section starts not drafted with no draft', () => {
    const sections = buildFactumOutline([arg('FACTUM_NOTICE_01', 'Reasonable Notice')], undefined);
    for (const s of sections) {
      expect(s.hasDraft).toBe(false);
      expect(s.approved).toBe(false);
      expect(s.draftStatus).toBe('not_drafted');
    }
  });

  it('stamps drafted and approved status from the saved draft', () => {
    const draft: FactumDraftState = {
      sections: {
        OVERVIEW: { html: '<p>...</p>', approved: true, generatedAt: '2026-08-17T00:00:00.000Z' },
        FACTS: { html: '<p>...</p>', approved: false, generatedAt: '2026-08-17T00:00:00.000Z' },
      },
    };
    const sections = buildFactumOutline([arg('FACTUM_NOTICE_01', 'Reasonable Notice')], draft);
    const byId = new Map(sections.map(s => [s.id, s]));
    expect(byId.get('OVERVIEW')!.draftStatus).toBe('approved');
    expect(byId.get('OVERVIEW')!.approved).toBe(true);
    expect(byId.get('OVERVIEW')!.generatedAt).toBe('2026-08-17T00:00:00.000Z');
    expect(byId.get('FACTS')!.draftStatus).toBe('drafted');
    expect(byId.get('FACTS')!.hasDraft).toBe(true);
    expect(byId.get('FACTS')!.approved).toBe(false);
    expect(byId.get('FACTUM_NOTICE_01')!.draftStatus).toBe('not_drafted');
  });

  it('readiness counts drafted and approved, and flags all approved', () => {
    const draft: FactumDraftState = {
      sections: {
        OVERVIEW: { html: 'x', approved: true, generatedAt: 't' },
        FACTS: { html: 'x', approved: true, generatedAt: 't' },
        FACTUM_NOTICE_01: { html: 'x', approved: true, generatedAt: 't' },
        ORDER: { html: 'x', approved: true, generatedAt: 't' },
      },
    };
    const sections = buildFactumOutline([arg('FACTUM_NOTICE_01', 'Reasonable Notice')], draft);
    const r = factumDraftReadiness(sections);
    expect(r.total).toBe(4);
    expect(r.approved).toBe(4);
    expect(r.allApproved).toBe(true);

    const partial = factumDraftReadiness(buildFactumOutline([arg('FACTUM_NOTICE_01', 'Reasonable Notice')], {
      sections: { OVERVIEW: { html: 'x', approved: true, generatedAt: 't' } },
    }));
    expect(partial.approved).toBe(1);
    expect(partial.drafted).toBe(1);
    expect(partial.allApproved).toBe(false);
  });

  it('knows the structural section ids and their kinds', () => {
    expect(isStructuralSectionId('OVERVIEW')).toBe(true);
    expect(isStructuralSectionId('FACTUM_CLAUSE_01')).toBe(false);
    expect(structuralSectionKind('FACTS')).toBe('facts');
    expect(structuralSectionKind('ORDER')).toBe('order');
    expect(structuralSectionKind('FACTUM_CLAUSE_01')).toBe(null);
  });
});
