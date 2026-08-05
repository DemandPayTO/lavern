/**
 * Unit Tests — the documents a demand letter argues from.
 *
 * The point of attaching the contract is that the letter quotes the clause
 * instead of paraphrasing it. So the context must say what each document
 * is, must instruct the model to quote, and must not silently drop the
 * contract to make room for a policy manual.
 */

import { describe, it, expect } from 'vitest';
import { demandSourceContext, isDemandSourceKind } from '../../src/employment/demand-sources.js';

const src = (name: string, kind: string, text = 'body text') =>
  ({ name, kind, text }) as never;

describe('demandSourceContext', () => {
  it('is empty when nothing is attached', () => {
    expect(demandSourceContext([]).context).toBe('');
  });

  it('names each document by what it is, not just its filename', () => {
    const { context } = demandSourceContext([
      src('final-v3.docx', 'employment_agreement', 'The Company may terminate at any time.'),
    ]);
    expect(context).toContain('Employment agreement: final-v3.docx');
    expect(context).toContain('The Company may terminate at any time.');
  });

  it('tells the model to quote rather than paraphrase', () => {
    const { context } = demandSourceContext([src('a.docx', 'employment_agreement')]);
    expect(context).toContain('Quote exactly');
    expect(context).toContain('Do not paraphrase a clause and present it as the clause');
    expect(context).toContain('the document governs');
  });

  it('gives each kind its own purpose', () => {
    const { context } = demandSourceContext([
      src('c.pdf', 'employment_agreement'),
      src('t.pdf', 'termination_letter'),
    ]);
    expect(context).toContain('Quote the termination provision');
    expect(context).toContain("employer's own words");
  });

  it('keeps the contract and termination letter when the cap bites', () => {
    const many = [
      src('policy1.pdf', 'policy_document'),
      src('policy2.pdf', 'policy_document'),
      src('note1.pdf', 'other'),
      src('note2.pdf', 'other'),
      src('note3.pdf', 'other'),
      src('contract.pdf', 'employment_agreement'),
      src('termination.pdf', 'termination_letter'),
    ];
    const { context, dropped } = demandSourceContext(many);
    expect(context).toContain('contract.pdf');
    expect(context).toContain('termination.pdf');
    // Something had to go, and the caller is told which.
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped).not.toContain('contract.pdf');
    expect(dropped).not.toContain('termination.pdf');
  });

  it('skips an empty document instead of emitting a headed blank', () => {
    const { context } = demandSourceContext([
      src('empty.pdf', 'roe', '   '),
      src('real.pdf', 'termination_letter', 'You are terminated for cause.'),
    ]);
    expect(context).not.toContain('empty.pdf');
    expect(context).toContain('real.pdf');
  });

  it('caps a long document rather than sending it whole', () => {
    const huge = 'clause '.repeat(20_000);
    const { context } = demandSourceContext([src('big.pdf', 'employment_agreement', huge)]);
    expect(context.length).toBeLessThan(45_000);
  });
});

describe('isDemandSourceKind', () => {
  it('accepts the kinds the panel offers and refuses anything else', () => {
    expect(isDemandSourceKind('employment_agreement')).toBe(true);
    expect(isDemandSourceKind('roe')).toBe(true);
    expect(isDemandSourceKind('statement_of_claim')).toBe(false);
    expect(isDemandSourceKind(undefined)).toBe(false);
  });
});
