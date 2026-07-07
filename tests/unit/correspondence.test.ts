/**
 * Unit Tests — client correspondence engine (src/employment/correspondence.ts)
 *
 * The mitigation series: step 1 due immediately, step 2 anchored on the
 * termination date plus the firm's window (6-8 weeks), never in the past.
 * Drafts are deterministic, carry the merge fields, use no em dashes, and
 * flag firm-judgment points for the lawyer.
 */

import { describe, it, expect } from 'vitest';
import {
  startMitigationSequence,
  buildCorrespondenceDraft,
  collectCorrespondenceItems,
} from '../../src/employment/correspondence.js';

function localIsoDaysFromNow(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('startMitigationSequence', () => {
  it('creates two steps: one due today, one at the window end', () => {
    const termination = localIsoDaysFromNow(-7);
    const items = startMitigationSequence({ termination_date: termination }, 6);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('mitigation-1');
    expect(items[0].status).toBe('scheduled');
    const step2 = items[1];
    // 6 weeks from termination = 42 days; termination was 7 days ago → due in ~35 days
    const expected = new Date(`${termination}T00:00:00`);
    expected.setDate(expected.getDate() + 42);
    expect(step2.dueDate).toBe(expected.toISOString().slice(0, 10));
  });

  it('clamps the window to 6-8 weeks', () => {
    const wide = startMitigationSequence({}, 12);
    const narrow = startMitigationSequence({}, 2);
    expect(wide[1].title).toContain('8-week');
    expect(narrow[1].title).toContain('6-week');
  });

  it('never schedules the follow-up in the past for an old termination', () => {
    const items = startMitigationSequence({ termination_date: '2024-01-15' }, 6);
    const today = new Date().toISOString().slice(0, 10);
    expect(items[1].dueDate >= today).toBe(true);
  });
});

describe('buildCorrespondenceDraft', () => {
  const intake = { client_first_name: 'Nadia', termination_date: '2026-06-01' };
  const firm = { firmName: 'Test Firm LLP' };

  it('step 1 carries the merge fields, the window, and the lawyer flag', () => {
    const [step1] = startMitigationSequence(intake, 7);
    const draft = buildCorrespondenceDraft(step1, intake, firm, 7);
    expect(draft.subject.length).toBeGreaterThan(10);
    expect(draft.body).toContain('Dear Nadia');
    expect(draft.body).toContain('Test Firm LLP');
    expect(draft.body).toContain('7 weeks');
    expect(draft.body).toContain('[LAWYER:');
    expect(draft.body).toContain('duty to mitigate');
    expect(draft.body).not.toContain('—');
  });

  it('step 2 references the tracker and carries the attachment hint', () => {
    const [, step2] = startMitigationSequence(intake, 6);
    const draft = buildCorrespondenceDraft(step2, intake, firm, 6);
    expect(draft.body).toContain('mitigation tracker');
    expect(draft.attachmentHint).toContain('Mitigation Log');
    expect(draft.body).not.toContain('—');
  });

  it('uses placeholders when intake fields are blank', () => {
    const [step1] = startMitigationSequence({}, 6);
    const draft = buildCorrespondenceDraft(step1, {}, {}, 6);
    expect(draft.body).toContain('[Client first name]');
    expect(draft.body).toContain('[Firm name]');
  });
});

describe('collectCorrespondenceItems', () => {
  it('returns only scheduled and drafted items', () => {
    const items = startMitigationSequence({}, 6);
    items[0].status = 'sent';
    const open = collectCorrespondenceItems(items);
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe('mitigation-2');
  });

  it('handles undefined input', () => {
    expect(collectCorrespondenceItems(undefined)).toEqual([]);
  });
});
