/**
 * Unit Tests — the evidence rule behind the pleading fields.
 *
 * A field whose approval arms a cause of action reaches the lawyer only
 * with a quote that verifies against the document. A true without
 * surviving evidence is discarded, not shown; a false is discarded
 * whatever its quote, because absence in one document is not evidence a
 * thing did not happen.
 */

import { describe, it, expect } from 'vitest';
import {
  enforcePleadingEvidence, verifySourceQuotes, CAUSE_TRIGGER_FIELDS,
} from '../../src/api/briefing/employment-extractor.js';
import { APPLYABLE_INTAKE_FIELDS } from '../../src/employment/extraction-apply.js';

const doc = 'The manager told the client that statements about her conduct were shared with industry contacts after her departure.';

const field = (value: unknown, quote?: string) => ({
  value, confidence: 'high' as const, ...(quote ? { sourceQuote: quote } : {}),
});

describe('enforcePleadingEvidence', () => {
  it('keeps a true whose quote verifies against the document', () => {
    const fields = verifySourceQuotes({
      defamatory_statements: field(true, 'statements about her conduct were shared with industry contacts'),
    }, doc);
    const { fields: out, discarded } = enforcePleadingEvidence(fields);
    expect(out.defamatory_statements.value).toBe(true);
    expect(discarded).toEqual([]);
  });

  it('discards a true with no quote at all', () => {
    const { fields: out, discarded } = enforcePleadingEvidence({
      privacy_breach: field(true),
    });
    expect(out.privacy_breach.value).toBeNull();
    expect(discarded).toEqual(['privacy_breach']);
  });

  it('discards a true whose quote does not survive the string search', () => {
    const fields = verifySourceQuotes({
      common_employer: field(true, 'a sentence that appears nowhere in the document'),
    }, doc);
    const { fields: out, discarded } = enforcePleadingEvidence(fields);
    expect(out.common_employer.value).toBeNull();
    expect(discarded).toEqual(['common_employer']);
  });

  it('discards a false regardless of evidence: absence proves nothing', () => {
    const fields = verifySourceQuotes({
      iims: field(false, 'statements about her conduct'),
    }, doc);
    const { fields: out, discarded } = enforcePleadingEvidence(fields);
    expect(out.iims.value).toBeNull();
    expect(discarded).toEqual(['iims']);
  });

  it('leaves ordinary fields alone: the rule is for cause triggers only', () => {
    const { fields: out, discarded } = enforcePleadingEvidence({
      annual_salary: field(110000),
      employer_alleged_just_cause: field(false),
    });
    expect(out.annual_salary.value).toBe(110000);
    expect(out.employer_alleged_just_cause.value).toBe(false);
    expect(discarded).toEqual([]);
  });

  it('leaves a null alone, which is the honest not-found', () => {
    const { fields: out, discarded } = enforcePleadingEvidence({
      unjust_enrichment: field(null),
    });
    expect(out.unjust_enrichment.value).toBeNull();
    expect(discarded).toEqual([]);
  });
});

describe('the wiring holds together', () => {
  it('every cause-trigger field can actually land on the intake', () => {
    for (const name of Object.keys(CAUSE_TRIGGER_FIELDS)) {
      expect(APPLYABLE_INTAKE_FIELDS.has(name), `${name} missing from the apply allowlist`).toBe(true);
    }
  });
});
