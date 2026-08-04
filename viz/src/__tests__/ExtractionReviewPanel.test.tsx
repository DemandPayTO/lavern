/**
 * ExtractionReviewPanel — Component tests (the apply loop's human gate).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtractionReviewPanel } from '../starling/ExtractionReviewPanel.js';
import type { DocumentExtraction } from '../starling/hooks/useStarlingApi.js';

const EXTRACTION: DocumentExtraction = {
  id: 'ext-9',
  filename: 'termination-letter.pdf',
  documentType: 'termination_letter',
  extractedFields: {
    termination_date: { value: '2026-05-15', confidence: 'high', sourceQuote: 'will terminate effective May 15, 2026', verified: true },
    annual_salary: { value: 105000, confidence: 'medium', sourceQuote: 'a salary of $105,000', verified: false },
    last_day_worked: { value: null, confidence: 'low' },
  },
  keyFindings: [],
  confirmed: false,
};

const INTAKE = { annual_salary: 90000 }; // termination_date blank, salary present

describe('ExtractionReviewPanel', () => {
  it('pre-checks blank fields, shows verified marks and current values', () => {
    render(<ExtractionReviewPanel extraction={EXTRACTION} intake={INTAKE} onApply={vi.fn()} />);
    expect(screen.getByLabelText('Apply termination date')).toBeChecked();      // blank → pre-checked
    expect(screen.getByLabelText('Apply annual salary')).not.toBeChecked();     // has value
    expect(screen.getByLabelText(/Verified in document: termination date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Not verified in document: annual salary/)).toBeInTheDocument();
    expect(screen.getByText('90000')).toBeInTheDocument();                      // current value shown
    expect(screen.queryByText('last day worked')).not.toBeInTheDocument();      // null value → no row
  });

  it('requires the per-field replace tick before a non-blank field counts', async () => {
    render(<ExtractionReviewPanel extraction={EXTRACTION} intake={INTAKE} onApply={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Apply 1 field/ })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Apply annual salary'));
    // checked but not overwriting → still only 1 field will actually apply
    expect(screen.getByRole('button', { name: /Apply 1 field/ })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Replace current value of annual salary'));
    expect(screen.getByRole('button', { name: /Apply 2 fields/ })).toBeInTheDocument();
  });

  it('applies and reports the consequence diff and analysis staleness', async () => {
    const onApply = vi.fn().mockResolvedValue({
      ok: true,
      applied: ['termination_date'],
      overwritten: [],
      skippedNotBlank: [],
      unmapped: [],
      analysisStale: true,
      timelineDiff: { added: [{ date: '2028-05-15', label: 'Limitation period expires' }], removed: [] },
    });
    render(<ExtractionReviewPanel extraction={EXTRACTION} intake={INTAKE} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: /Apply 1 field/ }));
    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith('ext-9', ['termination_date'], [], []);
      expect(screen.getByText(/Applied 1 field to the intake/)).toBeInTheDocument();
      expect(screen.getByText(/Limitation period expires \(2028-05-15\)/)).toBeInTheDocument();
      expect(screen.getByText(/re-run it from the Issues tab/)).toBeInTheDocument();
    });
  });

  it('surfaces a rejection naming the invalid fields', async () => {
    const onApply = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Applying these values would make the intake invalid. Uncheck the listed fields or correct them manually.',
      invalidFields: ['termination_date'],
    });
    render(<ExtractionReviewPanel extraction={EXTRACTION} intake={INTAKE} onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: /Apply 1 field/ }));
    await waitFor(() => {
      expect(screen.getByText(/would make the intake invalid/)).toBeInTheDocument();
      expect(screen.getByText(/Fields: termination_date/)).toBeInTheDocument();
    });
  });
});
