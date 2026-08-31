/**
 * outline-adapters — Unit tests.
 *
 * Three panels became one, and the per-document behaviour that used to live in
 * their JSX now lives in this mapping. That makes the mapping the place a
 * regression would hide, so each rule the old panels enforced is pinned here.
 */

import { describe, it, expect } from 'vitest';
import {
  socOutlineSections, factumOutlineSections, mediationOutlineSections,
  type SocOutlineSectionUI, type FactumOutlineSectionUI, type MediationOutlineSectionUI,
} from '../starling/matter/workspaces/outline-adapters.js';

function socNode(over: Partial<SocOutlineSectionUI> = {}): SocOutlineSectionUI {
  return {
    id: 'SOC_TERM_CLAUSE_01', kind: 'node', header: 'INVALID TERMINATION CLAUSE',
    html: '<p>The provision is void.</p>', missing: [], edited: false, approved: false,
    draftStatus: 'rendered', lawyerReview: false, ...over,
  };
}
function socFacts(over: Partial<SocOutlineSectionUI> = {}): SocOutlineSectionUI {
  return {
    id: 'SOC_FACTS_01', kind: 'facts', header: 'BACKGROUND FACTS',
    html: '', missing: [], edited: false, approved: false,
    draftStatus: 'not_drafted', lawyerReview: true, ...over,
  };
}

describe('socOutlineSections', () => {
  it('reads a pleading node even though Starling never drafts it', () => {
    const [s] = socOutlineSections([socNode()]);
    expect(s.readable).toBe(true);
    expect(s.draftable).toBe(false);
    expect(s.status).toBe('as_pleaded');
  });

  it('drafts the Background Facts and nothing else', () => {
    const [facts] = socOutlineSections([socFacts()]);
    expect(facts.draftable).toBe(true);
    expect(facts.suffix).toBe('Starling drafts this');
  });

  it('cannot read the facts before they are drafted', () => {
    const [s] = socOutlineSections([socFacts({ html: '' })]);
    expect(s.readable).toBe(false);
    expect(s.hasDraft).toBe(false);
  });

  it('reads the facts once drafted, and offers to discard them', () => {
    const [s] = socOutlineSections([socFacts({ html: '<p>Drafted.</p>', draftStatus: 'drafted' })]);
    expect(s.readable).toBe(true);
    expect(s.status).toBe('drafted');
    expect(s.discardLabel).toBe('Discard');
  });

  // A node the lawyer has not touched has nothing to revert to, so offering
  // "Revert to standard" on it would be a control that does nothing.
  it('offers no revert on an untouched node', () => {
    expect(socOutlineSections([socNode()])[0].discardLabel).toBeUndefined();
  });

  it('offers revert on a node the lawyer edited or approved', () => {
    expect(socOutlineSections([socNode({ edited: true })])[0].discardLabel).toBe('Revert to standard');
    expect(socOutlineSections([socNode({ approved: true })])[0].discardLabel).toBe('Revert to standard');
  });

  it('ranks approved above edited above drafted in the chip', () => {
    expect(socOutlineSections([socNode({ approved: true, edited: true })])[0].status).toBe('approved');
    expect(socOutlineSections([socNode({ edited: true, draftStatus: 'drafted' })])[0].status).toBe('edited');
  });

  it('counts the blanks still to fill, singular and plural', () => {
    expect(socOutlineSections([socNode({ missing: ['a'] })])[0].notes).toEqual(['1 blank to fill']);
    expect(socOutlineSections([socNode({ missing: ['a', 'b'] })])[0].notes).toEqual(['2 blanks to fill']);
  });

  it('adds no note where nothing is missing', () => {
    expect(socOutlineSections([socNode()])[0].notes).toBeUndefined();
  });

  it('treats whitespace-only text as no text', () => {
    expect(socOutlineSections([socFacts({ html: '   ' })])[0].hasDraft).toBe(false);
  });
});

// ── The factum ───────────────────────────────────────────────────────────

function factumSection(over: Partial<FactumOutlineSectionUI> = {}): FactumOutlineSectionUI {
  return {
    id: 'FACTUM_WAKSDALE_01', kind: 'argument', partLabel: 'Part III',
    header: 'The Termination Provision is Unenforceable', custom: false,
    draftStatus: 'drafted', hasDraft: true, approved: false,
    html: '<p>Argued.</p>', ...over,
  };
}

describe('factumOutlineSections', () => {
  it('carries the Part label as the section prefix', () => {
    expect(factumOutlineSections([factumSection()])[0].prefix).toBe('Part III');
  });

  it('marks a section the lawyer wrote as their own', () => {
    expect(factumOutlineSections([factumSection({ custom: true })])[0].suffix).toBe('your section');
    expect(factumOutlineSections([factumSection()])[0].suffix).toBeUndefined();
  });

  it('shows the authorities on an argument and nowhere else', () => {
    expect(factumOutlineSections([factumSection({ authorities: 'Waksdale v Swegon' })])[0].detail).toBe('Waksdale v Swegon');
    expect(factumOutlineSections([factumSection({ kind: 'overview', authorities: 'Waksdale' })])[0].detail).toBeUndefined();
  });

  it('drafts every section, and reads one only once drafted', () => {
    const [drafted] = factumOutlineSections([factumSection()]);
    const [undrafted] = factumOutlineSections([factumSection({ hasDraft: false, draftStatus: 'not_drafted' })]);
    expect(drafted.draftable).toBe(true);
    expect(drafted.readable).toBe(true);
    expect(undrafted.readable).toBe(false);
  });
});

// ── The mediation brief ──────────────────────────────────────────────────

function mediationSection(over: Partial<MediationOutlineSectionUI> = {}): MediationOutlineSectionUI {
  return {
    id: 'MED_OVERVIEW', header: 'Overview', guidance: 'Set the scene.',
    draftStatus: 'drafted', hasDraft: true, approved: false, html: '<p>Drafted.</p>', ...over,
  };
}

describe('mediationOutlineSections', () => {
  it('drafts every section and carries no part label', () => {
    const [s] = mediationOutlineSections([mediationSection()]);
    expect(s.draftable).toBe(true);
    expect(s.prefix).toBeUndefined();
    expect(s.discardLabel).toBe('Discard');
  });

  it('passes the draft status straight through to the chip', () => {
    expect(mediationOutlineSections([mediationSection({ draftStatus: 'approved', approved: true })])[0].status).toBe('approved');
    expect(mediationOutlineSections([mediationSection({ draftStatus: 'not_drafted', hasDraft: false })])[0].status).toBe('not_drafted');
  });

  it('keeps the review flags and the drafted time', () => {
    const [s] = mediationOutlineSections([mediationSection({ reviewFlags: ['Check the figure'], generatedAt: '2026-08-27T10:00:00Z' })]);
    expect(s.reviewFlags).toEqual(['Check the figure']);
    expect(s.generatedAt).toBe('2026-08-27T10:00:00Z');
  });
});
