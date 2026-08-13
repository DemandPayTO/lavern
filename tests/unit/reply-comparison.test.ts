/**
 * Unit Tests — reading the Defence against the Claim.
 *
 * The properties: every surviving item quotes the Defence verbatim (an
 * issues list that misquotes the pleading it summarizes is worse than
 * none); the clamp keeps long output alive; missing ids are assigned.
 */

import { describe, it, expect } from 'vitest';
import { clampComparison, comparisonSchema, enforceComparisonQuotes } from '../../src/employment/reply-comparison.js';
import type { ReplyComparison } from '../../src/employment/reply-comparison.js';

const DEFENCE = 'STATEMENT OF DEFENCE. 2. The Defendant pleads the Plaintiff was dismissed for just cause, being repeated lateness. 4. Any claim regarding 2019 is statute-barred under the Limitations Act, 2002.';

describe('enforceComparisonQuotes', () => {
  it('keeps items whose quote verifies and drops the rest', () => {
    const result: ReplyComparison = {
      items: [
        { id: 'n1', defenceParagraph: '2', kind: 'new_matter', summary: 'Cause alleged.', needsReply: true, quote: 'dismissed for just cause, being repeated lateness' },
        { id: 'n2', defenceParagraph: '9', kind: 'new_matter', summary: 'Invented.', needsReply: true, quote: 'a sentence the Defence never contains' },
      ],
    };
    const { kept, dropped } = enforceComparisonQuotes(result, DEFENCE);
    expect(kept.items.map(i => i.id)).toEqual(['n1']);
    expect(dropped).toBe(1);
  });
});

describe('clampComparison', () => {
  it('assigns missing ids, trims overlong fields, drops empty why', () => {
    const clamped = clampComparison({
      items: [
        { defenceParagraph: '2', kind: 'new_matter', summary: 'x'.repeat(900), needsReply: true, why: '', quote: 'q'.repeat(1000) },
        { id: 'n2', defenceParagraph: '4', kind: 'weird_kind', summary: 'Limitation.', needsReply: 'yes', quote: 'statute-barred' },
      ],
    });
    const parsed = comparisonSchema.parse(clamped);
    expect(parsed.items[0].id).toBe('n1');
    expect(parsed.items[0].summary.length).toBeLessThanOrEqual(600);
    expect(parsed.items[0].quote.length).toBeLessThanOrEqual(800);
    expect('why' in parsed.items[0]).toBe(false);
    // Unknown kind and non-boolean needsReply fall back instead of failing.
    expect(parsed.items[1].kind).toBe('other');
    expect(parsed.items[1].needsReply).toBe(false);
  });
});
