/**
 * CaseFileDropPanel — Component tests.
 *
 * Bulk drop: per-file pipeline with isolated failures, chronology approval,
 * conflict picking, and the synthesis memo. All collaborators injected.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaseFileDropPanel } from '../starling/CaseFileDropPanel.js';

const CHRON = [
  { date: '2016-03-01', field: 'hire_date', label: 'Hire date', category: 'employment', sources: [{ filename: 'contract.pdf', extractionId: 'e1', confidence: 'high', verified: true }], onTimeline: false },
  { date: '2026-05-15', field: 'termination_date', label: 'Employment terminated', category: 'termination', sources: [{ filename: 'letter.pdf', extractionId: 'e2', confidence: 'high' }], onTimeline: true },
];

const CONFLICTS = [
  { field: 'annual_salary', current: 95000, candidates: [
    { value: 95000, filename: 'contract.pdf', extractionId: 'e1', confidence: 'high', verified: true },
    { value: 98000, filename: 'stub.pdf', extractionId: 'e3', confidence: 'medium' },
  ] },
];

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    classifyDocument: vi.fn(async (file: File) => ({ ok: true, kind: 'termination_letter', confidence: 'high', fallback: false, content: 'text', name: file.name, definedTerms: [] })),
    extractParsed: vi.fn(async () => ({ ok: true })),
    getCaseReview: vi.fn(async () => ({ ok: true, chronology: CHRON, conflicts: CONFLICTS, extractionCount: 3 })),
    applyChronology: vi.fn(async () => ({ ok: true, added: [{ date: '2016-03-01', label: 'Hire date' }] })),
    generateCaseSynthesis: vi.fn(async () => ({ ok: true, document: { html: '<h2>Overview</h2><p>Memo (letter.pdf).</p>', documentTitle: 'Case File Review Memo', lawyerReviewFlags: ['Verify every cited fact.'] } })),
    applyExtraction: vi.fn(async () => ({ ok: true })),
    onDone: vi.fn(),
    ...overrides,
  };
}

function dropFiles(names: string[]) {
  const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
  const files = names.map(n => new File(['content'], n, { type: 'text/plain' }));
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('CaseFileDropPanel', () => {
  it('processes every file and loads the review', async () => {
    const props = makeProps();
    render(<CaseFileDropPanel {...props} />);
    dropFiles(['a.pdf', 'b.pdf']);
    await waitFor(() => expect(screen.getAllByText('done')).toHaveLength(2));
    expect(props.classifyDocument).toHaveBeenCalledTimes(2);
    expect(props.extractParsed).toHaveBeenCalledTimes(2);
    expect(props.extractParsed).toHaveBeenCalledWith('text', 'a.pdf', 'termination_letter', []);
    await waitFor(() => expect(screen.getByText('Hire date')).toBeInTheDocument());
    expect(props.onDone).toHaveBeenCalled();
  });

  it('isolates a failing file: the rest still complete', async () => {
    const props = makeProps({
      classifyDocument: vi.fn(async (file: File) => file.name === 'bad.pdf'
        ? { ok: false, error: 'Could not read the file.' }
        : { ok: true, kind: 'correspondence', fallback: false, content: 'text', name: file.name, definedTerms: [] }),
    });
    render(<CaseFileDropPanel {...props} />);
    dropFiles(['good.pdf', 'bad.pdf']);
    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument();
      expect(screen.getByText('Could not read the file.')).toBeInTheDocument();
    });
  });

  it('applies only the checked chronology entries; on-timeline rows are locked', async () => {
    const props = makeProps();
    render(<CaseFileDropPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review already-uploaded documents' }));
    await waitFor(() => expect(screen.getByText('Hire date')).toBeInTheDocument());

    const hireBox = screen.getByLabelText('Add to timeline: Hire date 2016-03-01') as HTMLInputElement;
    const termBox = screen.getByLabelText('Add to timeline: Employment terminated 2026-05-15') as HTMLInputElement;
    expect(hireBox.checked).toBe(true);       // not on timeline → pre-checked
    expect(termBox.disabled).toBe(true);      // already on timeline → locked

    await userEvent.click(screen.getByRole('button', { name: /Add 1 to the timeline/ }));
    await waitFor(() => expect(props.applyChronology).toHaveBeenCalledWith([
      { date: '2016-03-01', label: 'Hire date', category: 'employment', sourceDoc: 'contract.pdf' },
    ]));
    expect(await screen.findByText(/Added 1 event to the timeline/)).toBeInTheDocument();
  });

  it('resolves a conflict through the apply loop with overwrite', async () => {
    const props = makeProps();
    render(<CaseFileDropPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review already-uploaded documents' }));
    await waitFor(() => expect(screen.getByText('annual salary')).toBeInTheDocument());

    const useButtons = screen.getAllByRole('button', { name: 'Use' });
    await userEvent.click(useButtons[1]); // pick the stub.pdf value
    await waitFor(() => expect(props.applyExtraction).toHaveBeenCalledWith('e3', ['annual_salary'], ['annual_salary']));
  });

  it('generates and renders the memo with its review flags', async () => {
    const props = makeProps();
    render(<CaseFileDropPanel {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Review already-uploaded documents' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate case review memo' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Generate case review memo' }));
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument();
      expect(screen.getByText(/Verify every cited fact/)).toBeInTheDocument();
      expect(screen.getByText(/Saved to this matter's draft history/)).toBeInTheDocument();
    });
  });
});
