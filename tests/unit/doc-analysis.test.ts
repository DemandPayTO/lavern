/**
 * Unit Tests — the document analysis lane.
 *
 * The quote rule is the heart: a "present" checklist finding whose quote
 * does not appear in the document is downgraded to "unclear" and says
 * so, because a claim about a document the document does not contain is
 * the one failure this feature must never produce. Around it: the
 * deterministic pre-pass, the clamp, and the checklists themselves.
 */

import { describe, it, expect } from 'vitest';
import {
  KIND_CHECKLISTS, ANALYZABLE_KINDS, KIND_LABELS,
  deterministicNotes, clampDocAnalysis, docAnalysisResultSchema,
  quoteVerifies, enforceAnalysisQuotes, buildAnalysisPrompt,
  type DocAnalysisResult,
} from '../../src/employment/doc-analysis.js';

describe('the checklists', () => {
  it('every kind has a checklist and a label', () => {
    for (const kind of ANALYZABLE_KINDS) {
      expect(KIND_CHECKLISTS[kind].length).toBeGreaterThan(0);
      expect(KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });

  it('checklist ids are unique within each kind', () => {
    for (const kind of ANALYZABLE_KINDS) {
      const ids = KIND_CHECKLISTS[kind].map(i => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('the pay stub checklist carries the ESA vacation pay minimums', () => {
    const vacation = KIND_CHECKLISTS.pay_stub.find(i => i.id === 'vacation_pay_rate');
    expect(vacation?.lookFor).toContain('4 percent');
    expect(vacation?.lookFor).toContain('6 percent');
  });

  it('the bonus plan checklist reads for forfeiture and active employment conditions', () => {
    const ids = KIND_CHECKLISTS.bonus_plan.map(i => i.id);
    expect(ids).toContain('forfeiture_on_termination');
    expect(ids).toContain('active_employment_condition');
  });
});

describe('deterministicNotes', () => {
  it('surfaces percentages and dollar amounts from the face of the document', () => {
    const notes = deterministicNotes('bonus_plan', 'A bonus of 10% of salary, capped at $25,000.00, vests annually.');
    expect(notes.join(' ')).toContain('10%');
    expect(notes.join(' ')).toContain('$25,000.00');
  });

  it('an absent vacation line asks the client, it does not conclude underpayment', () => {
    const notes = deterministicNotes('pay_stub', 'Gross pay $2,000.00. Net pay $1,500.00.');
    const note = notes.find(n => n.includes('No vacation pay line appears'));
    expect(note).toBeTruthy();
    expect(note).toContain('pay vacation pay only when the employee takes vacation time');
    expect(note).toContain('confirm with the client');
  });

  it('the pay stub checklist itself carries the paid-on-vacation-taken caution', () => {
    const vacation = KIND_CHECKLISTS.pay_stub.find(i => i.id === 'vacation_pay_rate');
    expect(vacation?.lookFor).toContain('takes vacation time');
    expect(vacation?.lookFor).toContain('NOT by itself evidence of underpayment');
  });

  it('flags a pay stub whose percentages sit below the ESA minimum', () => {
    const notes = deterministicNotes('pay_stub', 'Vacation accrual 2% this period. Tax 20%.');
    expect(notes.some(n => n.includes('ESA minimum vacation pay is 4%'))).toBe(false);
    const low = deterministicNotes('pay_stub', 'Vacation accrual 2% this period.');
    expect(low.some(n => n.includes('ESA minimum vacation pay is 4%'))).toBe(true);
  });

  it('flags post-2021 non-compete language in an agreement', () => {
    const notes = deterministicNotes('employment_agreement', 'The Employee shall not engage in any non-competition breach.');
    expect(notes.some(n => n.includes('October 25, 2021'))).toBe(true);
  });

  it('stays quiet on a document with nothing to surface', () => {
    expect(deterministicNotes('client_summary', 'I started there years ago and it ended badly.')).toEqual([]);
  });
});

describe('quoteVerifies', () => {
  const doc = 'The Employee must be “actively employed” on the payment date\n to receive any bonus.';

  it('survives smart quotes and collapsed whitespace', () => {
    expect(quoteVerifies('must be "actively employed" on the payment date to receive', doc)).toBe(true);
  });

  it('rejects a quote that is not in the document', () => {
    expect(quoteVerifies('the bonus vests immediately upon termination', doc)).toBe(false);
  });

  it('rejects the empty and the trivially short', () => {
    expect(quoteVerifies(undefined, doc)).toBe(false);
    expect(quoteVerifies('the', doc)).toBe(false);
  });
});

describe('enforceAnalysisQuotes', () => {
  const doc = 'Bonus is forfeited if employment terminates for any reason before the payment date.';
  const base: DocAnalysisResult = {
    summary: 'A bonus plan.',
    checklist: [],
    answers: [],
    comparison: null,
    redFlags: [],
  };

  it('keeps a present finding whose quote verifies', () => {
    const out = enforceAnalysisQuotes({
      ...base,
      checklist: [{ id: 'forfeiture_on_termination', status: 'present', finding: 'Forfeiture on any termination.', quote: 'forfeited if employment terminates for any reason' }],
    }, doc);
    expect(out.checklist[0].status).toBe('present');
    expect(out.checklist[0].quote).toBeTruthy();
  });

  it('downgrades a present finding whose quote does not verify, and says so', () => {
    const out = enforceAnalysisQuotes({
      ...base,
      checklist: [{ id: 'forfeiture_on_termination', status: 'present', finding: 'Forfeiture on any termination.', quote: 'a sentence the document does not contain' }],
    }, doc);
    expect(out.checklist[0].status).toBe('unclear');
    expect(out.checklist[0].quote).toBeUndefined();
    expect(out.checklist[0].finding).toContain('did not verify');
  });

  it('downgrades a present finding with no quote at all', () => {
    const out = enforceAnalysisQuotes({
      ...base,
      checklist: [{ id: 'discretion_language', status: 'present', finding: 'Discretion is absolute.' }],
    }, doc);
    expect(out.checklist[0].status).toBe('unclear');
  });

  it('leaves absent findings alone: absence needs no quote', () => {
    const out = enforceAnalysisQuotes({
      ...base,
      checklist: [{ id: 'notice_period_carveout', status: 'absent', finding: 'No notice period language.' }],
    }, doc);
    expect(out.checklist[0].status).toBe('absent');
  });

  it('accepts a quote that verifies against the comparison document instead', () => {
    const out = enforceAnalysisQuotes({
      ...base,
      checklist: [{ id: 'x', status: 'present', finding: 'From the case.', quote: 'the clause failed for ambiguity' }],
    }, doc, 'The court held the clause failed for ambiguity and awarded damages.');
    expect(out.checklist[0].status).toBe('present');
  });

  it('strips an unverifiable quote from an answer but keeps the answer', () => {
    const out = enforceAnalysisQuotes({
      ...base,
      answers: [{ question: 'Is the bonus forfeited?', answer: 'Yes, on any termination.', quote: 'not in the document at all, truly' }],
    }, doc);
    expect(out.answers[0].answer).toContain('Yes');
    expect(out.answers[0].quote).toBeUndefined();
  });
});

describe('clampDocAnalysis', () => {
  it('clamps an overlong summary instead of failing it', () => {
    const clamped = clampDocAnalysis({ summary: 'x'.repeat(9000), checklist: [], answers: [], comparison: null, redFlags: [] });
    const parsed = docAnalysisResultSchema.safeParse(clamped);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.summary.length).toBeLessThanOrEqual(6000);
  });

  it('normalises null on optional quote fields, which models write for absent', () => {
    const clamped = clampDocAnalysis({
      summary: 'ok',
      checklist: [{ id: 'a', status: 'absent', finding: 'not there', quote: null }],
      answers: [{ question: 'q', answer: 'a', quote: null }],
      comparison: null,
      redFlags: [],
    });
    expect(docAnalysisResultSchema.safeParse(clamped).success).toBe(true);
  });

  it('truncates runaway lists to the caps', () => {
    const clamped = clampDocAnalysis({
      summary: 'ok',
      checklist: Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, status: 'absent', finding: 'f' })),
      answers: [],
      comparison: null,
      redFlags: Array.from({ length: 40 }, () => 'flag'),
    });
    const parsed = docAnalysisResultSchema.safeParse(clamped);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.checklist.length).toBe(30);
    expect(parsed.success && parsed.data.redFlags.length).toBe(12);
  });
});

describe('buildAnalysisPrompt', () => {
  it('carries the checklist, the questions and the document', () => {
    const prompt = buildAnalysisPrompt({
      docName: 'Bonus Plan 2025.pdf', kind: 'bonus_plan',
      docText: 'THE PLAN TEXT', questions: ['Does the plan survive termination?'],
    });
    expect(prompt).toContain('forfeiture_on_termination');
    expect(prompt).toContain('Does the plan survive termination?');
    expect(prompt).toContain('THE PLAN TEXT');
    expect(prompt).not.toContain('COMPARISON DOCUMENT');
  });

  it('adds the comparison section only when a comparison is attached', () => {
    const prompt = buildAnalysisPrompt({
      docName: 'Plan.pdf', kind: 'bonus_plan', docText: 'PLAN',
      questions: [], comparisonName: 'Matthews decision.pdf', comparisonText: 'THE CASE TEXT',
    });
    expect(prompt).toContain('COMPARISON DOCUMENT');
    expect(prompt).toContain('THE CASE TEXT');
  });

  it('contains no em-dashes and no contractions', () => {
    const prompt = buildAnalysisPrompt({ docName: 'x', kind: 'pay_stub', docText: 'stub', questions: [] });
    expect(prompt).not.toMatch(/—/);
    expect(prompt).not.toMatch(/\b(don't|can't|won't|it's|isn't|doesn't)\b/i);
  });
});
