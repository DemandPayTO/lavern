/**
 * Unit Tests — revision loop (docs/specs/revision-loop-2026-08.md).
 *
 * The properties that make it safe to point a model at a pleading:
 *   - paragraphs the lawyer did not approve come back byte-identical, or
 *     the whole apply is refused
 *   - a factual correction carries an intake update, not just a text edit
 *   - a client's characterisation is refused rather than pleaded
 */

import { describe, it, expect } from 'vitest';
import {
  toParagraphs, fromParagraphs, paragraphText,
  verifyOnlyApprovedChanged, applyRevisions, groundPlan,
  correctionMakesAnalysisStale, CORRECTABLE_INTAKE_FIELDS,
  type RevisionItem,
} from '../../src/employment/revision-loop.js';

const DOC = [
  '<h1>Statement of Claim</h1>',
  '<p>1. The Plaintiff was hired on March 2, 2017.</p>',
  '<p>2. The Plaintiff was employed as a Buyer.</p>',
  '<p>3. The Plaintiff was terminated without cause on May 20, 2026.</p>',
  '<p>4. The Plaintiff claims damages in lieu of reasonable notice.</p>',
].join('\n');

const item = (over: Partial<RevisionItem> = {}): RevisionItem => ({
  id: 'r1', feedback: 'x', kind: 'wording', paragraphIndices: [1], proposal: 'y', ...over,
});

describe('document handling', () => {
  it('splits into addressable paragraphs and back again', () => {
    const paras = toParagraphs(DOC);
    expect(paras).toHaveLength(5);
    expect(paras[1]).toContain('March 2, 2017');
    expect(fromParagraphs(paras)).toBe(DOC);
  });

  it('reads paragraph text without markup', () => {
    expect(paragraphText('<p>1. Hired on <strong>March 2</strong>.</p>')).toBe('1. Hired on March 2.');
  });
});

describe('the safety property: no drift outside approved paragraphs', () => {
  it('accepts a change confined to an approved paragraph', () => {
    const before = toParagraphs(DOC);
    const after = [...before];
    after[1] = '<p>1. The Plaintiff was hired on March 2, 2016.</p>';
    const check = verifyOnlyApprovedChanged(before, after, new Set([1]));
    expect(check.ok).toBe(true);
    expect(check.changed).toEqual([1]);
  });

  it('refuses when an unapproved paragraph changed', () => {
    const before = toParagraphs(DOC);
    const after = [...before];
    after[1] = '<p>1. The Plaintiff was hired on March 2, 2016.</p>';
    after[4] = '<p>4. The Plaintiff claims substantial damages.</p>';  // not approved
    const check = verifyOnlyApprovedChanged(before, after, new Set([1]));
    expect(check.ok).toBe(false);
    expect(check.drifted).toEqual([4]);
  });

  it('refuses when the paragraph count changed', () => {
    const before = toParagraphs(DOC);
    const check = verifyOnlyApprovedChanged(before, before.slice(0, 4), new Set([1]));
    expect(check.ok).toBe(false);
  });
});

describe('applying approved revisions', () => {
  it('applies an approved paragraph and reports what changed', () => {
    const paras = toParagraphs(DOC);
    const result = applyRevisions(
      paras,
      [item({ paragraphIndices: [1], kind: 'factual_correction', intakeField: 'hire_date', intakeValue: '2016-03-02' })],
      { 1: '<p>1. The Plaintiff was hired on March 2, 2016.</p>' },
    );
    expect(result.ok).toBe(true);
    expect(result.changedIndices).toEqual([1]);
    expect(result.paragraphs![1]).toContain('2016');
    // The correction carries an intake update, not just a text edit.
    expect(result.intakeUpdates).toEqual({ hire_date: '2016-03-02' });
  });

  it('ignores revisions to paragraphs no item approved', () => {
    const paras = toParagraphs(DOC);
    const result = applyRevisions(
      paras,
      [item({ paragraphIndices: [1] })],
      { 1: '<p>1. Revised.</p>', 4: '<p>4. Sneaky rewrite.</p>' },
    );
    expect(result.ok).toBe(true);
    expect(result.paragraphs![4]).toBe(paras[4]);
    expect(result.paragraphs![4]).not.toContain('Sneaky');
  });

  it('refuses the whole apply rather than partially trusting it', () => {
    const paras = toParagraphs(DOC);
    // Simulate drift that slipped past the index filter.
    const drifted = [...paras];
    drifted[3] = '<p>3. Terminated for cause.</p>';
    const check = verifyOnlyApprovedChanged(paras, drifted, new Set([1]));
    expect(check.ok).toBe(false);
    expect(check.drifted).toContain(3);
  });

  it('collects intake updates only from factual corrections', () => {
    const paras = toParagraphs(DOC);
    const result = applyRevisions(paras, [
      item({ id: 'a', paragraphIndices: [1], kind: 'factual_correction', intakeField: 'hire_date', intakeValue: '2016-03-02' }),
      item({ id: 'b', paragraphIndices: [2], kind: 'wording', intakeField: 'job_title', intakeValue: 'Senior Buyer' }),
    ], { 1: '<p>1. Hired 2016.</p>', 2: '<p>2. Employed as a Buyer.</p>' });
    expect(result.intakeUpdates).toEqual({ hire_date: '2016-03-02' });
  });
});

describe('grounding a proposed plan', () => {
  const paras = toParagraphs(DOC);

  it('drops items pointing at paragraphs that do not exist', () => {
    const { items } = groundPlan(
      { items: [item({ paragraphIndices: [99] })] }, paras, CORRECTABLE_INTAKE_FIELDS,
    );
    // Not silently dropped: handed to the lawyer instead.
    expect(items[0].kind).toBe('needs_lawyer');
    expect(items[0].paragraphIndices).toEqual([]);
  });

  it('refuses to write an intake field outside the allowlist', () => {
    const { items, warnings } = groundPlan(
      { items: [item({ kind: 'factual_correction', intakeField: 'secret_field', intakeValue: 'x' })] },
      paras, CORRECTABLE_INTAKE_FIELDS,
    );
    expect(items[0].intakeField).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/not a field Starling stores/);
  });

  it('keeps a well-grounded item intact', () => {
    const { items } = groundPlan(
      { items: [item({ kind: 'factual_correction', paragraphIndices: [1], intakeField: 'hire_date', intakeValue: '2016-03-02' })] },
      paras, CORRECTABLE_INTAKE_FIELDS,
    );
    expect(items[0].kind).toBe('factual_correction');
    expect(items[0].intakeField).toBe('hire_date');
  });

  it('lets a needs_lawyer item through without paragraph grounding', () => {
    const { items } = groundPlan(
      { items: [item({ kind: 'needs_lawyer', paragraphIndices: [], reason: 'Client characterisation of motive.' })] },
      paras, CORRECTABLE_INTAKE_FIELDS,
    );
    expect(items[0].kind).toBe('needs_lawyer');
    expect(items[0].reason).toMatch(/characterisation/);
  });
});

describe('downstream consequences', () => {
  it('flags an analysis as stale when a correction feeds it', () => {
    expect(correctionMakesAnalysisStale({ hire_date: '2016-03-02' })).toBe(true);
    expect(correctionMakesAnalysisStale({ annual_salary: 104000 })).toBe(true);
    // A cosmetic field does not invalidate the damages analysis.
    expect(correctionMakesAnalysisStale({ client_phone: '416-555-0199' })).toBe(false);
  });
});

describe('a factual correction must reach the matter, not just the text', () => {
  const paras = toParagraphs(DOC);

  it('warns when a factual correction carries no intake field', () => {
    const { warnings } = groundPlan(
      { items: [item({ kind: 'factual_correction', feedback: 'I was hired in 2016.', paragraphIndices: [1] })] },
      paras, CORRECTABLE_INTAKE_FIELDS,
    );
    expect(warnings.join(' ')).toMatch(/corrects the document only/i);
    expect(warnings.join(' ')).toMatch(/Intake tab/i);
  });

  it('stays quiet when the correction does carry one', () => {
    const { warnings } = groundPlan(
      { items: [item({ kind: 'factual_correction', paragraphIndices: [1], intakeField: 'hire_date', intakeValue: '2016-03-02' })] },
      paras, CORRECTABLE_INTAKE_FIELDS,
    );
    expect(warnings.join(' ')).not.toMatch(/document only/i);
  });
});
