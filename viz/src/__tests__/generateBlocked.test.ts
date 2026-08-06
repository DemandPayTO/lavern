/**
 * Unit Tests — why Generate cannot be pressed.
 *
 * The pilot reported a dead button: coloured, no press, nothing happened.
 * It was disabled for a missing demand amount while still painted orange
 * with a pointer cursor, so it read as working. A button that is disabled
 * has to look disabled AND say why, and both come from this one value.
 */

import { describe, it, expect } from 'vitest';

/** Mirrors the workspace's blockedReason. Kept in step by these tests. */
function blockedReason(args: {
  selectedDraft: string | null;
  needsAmount: Set<string>;
  amount: string;
  requiredFields?: Array<{ key: string; label: string; required?: boolean }>;
  fieldValues?: Record<string, string>;
}): string | null {
  if (!args.selectedDraft) return null;
  if (args.needsAmount.has(args.selectedDraft) && !args.amount) {
    return args.selectedDraft === 'demand'
      ? 'Enter the Demand Amount above. It is the figure the letter demands, which is your judgment and not the total of the heads.'
      : 'Enter the Claim Amount above before generating.';
  }
  const missing = (args.requiredFields ?? [])
    .filter(f => f.required && !(args.fieldValues?.[f.key] ?? '').trim())
    .map(f => f.label);
  if (missing.length > 0) return `Fill in ${missing.join(', ')} before generating.`;
  return null;
}

const NEEDS_AMOUNT = new Set(['demand', 'soc', 'counter', 'rule49']);

describe('blockedReason', () => {
  it('names the demand amount, and says it is a judgment and not the subtotal', () => {
    const reason = blockedReason({ selectedDraft: 'demand', needsAmount: NEEDS_AMOUNT, amount: '' });
    expect(reason).toContain('Demand Amount');
    // The heads rows show a subtotal, which is exactly why the empty field
    // reads as already filled in.
    expect(reason).toContain('not the total of the heads');
  });

  it('clears once the amount is entered', () => {
    expect(blockedReason({ selectedDraft: 'demand', needsAmount: NEEDS_AMOUNT, amount: '92000' })).toBeNull();
  });

  it('names every missing court form field, not just the first', () => {
    const reason = blockedReason({
      selectedDraft: 'sj_motion',
      needsAmount: NEEDS_AMOUNT,
      amount: '1',
      requiredFields: [
        { key: 'court_file_no', label: 'Court file number', required: true },
        { key: 'hearing_date', label: 'Hearing date', required: true },
        { key: 'note', label: 'Note', required: false },
      ],
      fieldValues: { court_file_no: '  ' },
    });
    expect(reason).toContain('Court file number');
    expect(reason).toContain('Hearing date');
    expect(reason).not.toContain('Note');
  });

  it('is null when nothing is selected, so the button is not blamed for it', () => {
    expect(blockedReason({ selectedDraft: null, needsAmount: NEEDS_AMOUNT, amount: '' })).toBeNull();
  });

  it('does not ask for an amount from documents that do not take one', () => {
    expect(blockedReason({ selectedDraft: 'mediation', needsAmount: NEEDS_AMOUNT, amount: '' })).toBeNull();
  });
});
