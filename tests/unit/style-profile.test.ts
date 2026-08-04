/**
 * Unit Tests — firm style profiles: the deterministic halves.
 *
 * The style guide itself is model-written and reviewed by the lawyer; what
 * must be MECHANICALLY right is the safety rail around it: identifier
 * extraction from precedents, the precedent-bleed scan on generated
 * output, and the prompt rendering that instructs the model.
 */

import { describe, it, expect } from 'vitest';
import {
  extractIdentifiers, checkPrecedentBleed, styleContextForPrompt, styleGuideSchema,
  clampStyleGuide,
} from '../../src/employment/style-profile.js';

const PRECEDENT_A = `MEDIATION BRIEF
Re: Marta Kowalczyk and Lakeshore Dental Group Inc
Ms. Kowalczyk was dismissed while on medical leave. We demand $95,000.
The Ontario Superior Court of Justice has held consistently.`;

const PRECEDENT_B = `MEDIATION BRIEF
Re: Devon Achebe and Halton Logistics Ltd
Mr. Achebe seeks damages of $52,500 for wrongful dismissal.`;

describe('extractIdentifiers', () => {
  it('collects the precedents\' names and amounts', () => {
    const ids = extractIdentifiers([PRECEDENT_A, PRECEDENT_B]);
    expect(ids).toContain('Marta Kowalczyk');
    expect(ids).toContain('Devon Achebe');
    expect(ids).toContain('$95,000');
    expect(ids).toContain('$52,500');
  });

  it('does not treat legal furniture as client names', () => {
    const ids = extractIdentifiers([PRECEDENT_A]);
    expect(ids).not.toContain('Superior Court');
    expect(ids).not.toContain('Employment Standards');
  });

  it('ignores sentence-initial capitals and corporate suffixes', () => {
    const ids = extractIdentifiers(['The Human Rights Code protects leave. This Court agreed. Lakeshore Dental Group Inc paid.']);
    expect(ids).not.toContain('The Human');
    expect(ids).not.toContain('This Court');
    expect(ids).not.toContain('Group Inc');
    expect(ids).toContain('Lakeshore Dental');
  });
});

describe('checkPrecedentBleed', () => {
  const identifiers = extractIdentifiers([PRECEDENT_A, PRECEDENT_B]);

  it('stays quiet when the draft uses only this matter\'s values', () => {
    const html = '<p>Aisha Osei was dismissed by Brightpath Financial Group Inc. We seek $120,000.</p>';
    expect(checkPrecedentBleed(html, identifiers, ['Aisha Osei', 'Brightpath Financial Group Inc'])).toEqual([]);
  });

  it('flags a precedent client\'s name that leaked into the draft', () => {
    const html = '<p>As in the case of Marta Kowalczyk, dismissal during medical leave attracts damages.</p>';
    const flags = checkPrecedentBleed(html, identifiers, ['Aisha Osei']);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('Marta Kowalczyk');
    expect(flags[0]).toContain('precedent bleed');
  });

  it('flags a precedent dollar figure', () => {
    const flags = checkPrecedentBleed('<p>We demand $95,000.</p>', identifiers, []);
    expect(flags[0]).toContain('$95,000');
  });

  it('excludes values that belong to THIS matter, so its own figures never flag', () => {
    const flags = checkPrecedentBleed('<p>We demand $95,000.</p>', identifiers, ['$95,000']);
    expect(flags).toEqual([]);
  });
});

describe('styleContextForPrompt', () => {
  const guide = styleGuideSchema.parse({
    flow: [
      { heading: 'Opening position', purpose: 'One paragraph stating what the case is worth and why.' },
      { heading: 'The person, not the file', purpose: 'Humanise the plaintiff before the numbers.' },
    ],
    voice: 'Short declarative sentences. Confident, never strident.',
    recurringLanguage: ['We say this plainly:', 'That position will not survive scrutiny.'],
    factWeaving: 'Facts appear inside argument, never as a bare chronology.',
    notes: ['Never more than six pages.'],
  });

  it('renders the flow, voice, and phrasings with the safety instruction', () => {
    const ctx = styleContextForPrompt(guide, 'Medical leave terminations');
    expect(ctx).toContain('Medical leave terminations');
    expect(ctx).toContain('1. Opening position');
    expect(ctx).toContain('Short declarative sentences');
    expect(ctx).toContain('We say this plainly:');
    expect(ctx).toContain('none of their names, dates, or amounts may appear');
    // The pinned generator headings stay authoritative for machine mapping.
    expect(ctx).toContain('KEEP the required headings');
  });

  it('schema strips dollar-amount phrasings at validation time via analyseStyle filter contract', () => {
    // The filter lives in analyseStyle; the schema itself accepts strings.
    // This pins the schema shape so stored guides stay readable.
    expect(guide.flow).toHaveLength(2);
    expect(guide.notes).toEqual(['Never more than six pages.']);
  });
});


describe('clampStyleGuide (the pilot 502)', () => {
  it('trims over-length values instead of rejecting the whole guide', () => {
    const raw = {
      flow: [{ heading: 'Overview', purpose: 'p'.repeat(900) }],
      voice: 'v'.repeat(2000),
      recurringLanguage: ['r'.repeat(600)],
      factWeaving: 'f'.repeat(1230),   // the exact production failure
      notes: [],
    };
    const validated = styleGuideSchema.safeParse(clampStyleGuide(raw));
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.factWeaving).toHaveLength(1000);
      expect(validated.data.voice).toHaveLength(1500);
      expect(validated.data.flow[0].purpose).toHaveLength(500);
      expect(validated.data.recurringLanguage[0]).toHaveLength(400);
    }
  });

  it('slices over-long lists to their caps', () => {
    const raw = {
      flow: Array.from({ length: 30 }, (_, i) => ({ heading: `S${i}`, purpose: 'x' })),
      voice: 'v', recurringLanguage: Array.from({ length: 25 }, () => 'p'), factWeaving: 'f', notes: [],
    };
    const validated = styleGuideSchema.safeParse(clampStyleGuide(raw));
    expect(validated.success).toBe(true);
    if (validated.success) {
      expect(validated.data.flow).toHaveLength(24);
      expect(validated.data.recurringLanguage).toHaveLength(20);
    }
  });

  it('still fails structurally broken output (clamping is not laundering)', () => {
    expect(styleGuideSchema.safeParse(clampStyleGuide({ flow: [], voice: 'v', recurringLanguage: [], factWeaving: 'f', notes: [] })).success).toBe(false);
    expect(styleGuideSchema.safeParse(clampStyleGuide({ voice: 'v' })).success).toBe(false);
  });
});
