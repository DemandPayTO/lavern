/**
 * Unit Tests — Selective Anonymisation (src/claw/anonymize.ts)
 *
 * Tests anonymize(), deanonymize(), and deanonymizeFindings()
 * for the selective redaction strategy:
 *   - REDACTS: names, emails, phones, addresses, SINs, financial IDs,
 *             health IDs, driver's licences, passports, DOBs
 *   - PRESERVES: monetary amounts, dates, job titles, durations
 */

import { describe, it, expect } from 'vitest';
import { anonymize, deanonymize, deanonymizeFindings } from '../../src/claw/anonymize.js';

// ── Party Names (kept from original) ─────────────────────────────────────

describe('anonymize — party names', () => {
  it('replaces defined terms with [PARTY_N] placeholders', () => {
    const text = 'Acme Corp agrees to provide services to Globex Inc.';
    const result = anonymize(text, ['Acme Corp', 'Globex Inc']);
    expect(result.anonymizedText).not.toContain('Acme Corp');
    expect(result.anonymizedText).not.toContain('Globex Inc');
    expect(result.stats.parties).toBe(2);
  });

  it('masks a party name that ends in punctuation (Inc.) — regression 2026-07-15', () => {
    // The \b-anchored termRegex leaked corporate names ending in "Inc." /
    // "Ltd." / "Corp." because \b fails after the "." before a space.
    const text = 'Employment with Acme Widgets Inc. ended on June 15, 2026.';
    const result = anonymize(text, ['Acme Widgets Inc.']);
    expect(result.anonymizedText).not.toContain('Acme Widgets Inc');
    expect(result.anonymizedText).toContain('[PARTY_1]');
    // The preserved analytical data survives.
    expect(result.anonymizedText).toContain('June 15, 2026');
  });

  it('masks Ltd. / Corp. suffixes too', () => {
    const text = 'Globex Ltd. and Initech Corp. are the defendants.';
    const result = anonymize(text, ['Globex Ltd.', 'Initech Corp.']);
    expect(result.anonymizedText).not.toContain('Globex');
    expect(result.anonymizedText).not.toContain('Initech');
  });

  it('same entity gets same placeholder across multiple occurrences', () => {
    const text = 'Acme Corp shall pay. Acme Corp shall also deliver.';
    const result = anonymize(text, ['Acme Corp']);
    expect(result.anonymizedText).toBe('[PARTY_1] shall pay. [PARTY_1] shall also deliver.');
    expect(result.stats.parties).toBe(1);
    expect(result.mappings.length).toBe(1);
  });

  it('skips common legal terms (Agreement, Services, etc.)', () => {
    const text = 'The Agreement governs the Services provided.';
    const result = anonymize(text, ['Agreement', 'Services', 'Confidential Information']);
    expect(result.anonymizedText).toBe(text);
    expect(result.stats.parties).toBe(0);
  });
});

// ── PRESERVED: Monetary Amounts ──────────────────────────────────────────

describe('anonymize — monetary amounts are PRESERVED', () => {
  it('does NOT redact dollar amounts', () => {
    const text = 'The salary is $95,000 per year.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('$95,000');
  });

  it('does NOT redact EUR amounts', () => {
    const text = 'Total liability capped at EUR 50,000.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('EUR 50,000');
  });

  it('does NOT redact CAD amounts', () => {
    const text = 'Severance of CAD 120,000 was offered.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('CAD 120,000');
  });
});

// ── PRESERVED: General Dates ─────────────────────────────────────────────

describe('anonymize — general dates are PRESERVED', () => {
  it('does NOT redact long-form dates', () => {
    const text = 'Hired on January 15, 2020. Terminated March 1, 2026.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('January 15, 2020');
    expect(result.anonymizedText).toContain('March 1, 2026');
  });

  it('does NOT redact ISO dates', () => {
    const text = 'Start date: 2020-01-15.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('2020-01-15');
  });

  it('does NOT redact slash dates', () => {
    const text = 'Signed on 01/15/2020.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('01/15/2020');
  });
});

// ── NEW: Date of Birth (redacted when labelled) ──────────────────────────

describe('anonymize — date of birth', () => {
  it('redacts labelled DOB (long form)', () => {
    const text = 'Date of Birth: March 15, 1982.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[DOB_1]');
    expect(result.anonymizedText).not.toContain('March 15, 1982');
    expect(result.stats.dobs).toBe(1);
  });

  it('redacts labelled DOB (numeric)', () => {
    const text = 'DOB: 03/15/1982.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[DOB_1]');
    expect(result.anonymizedText).not.toContain('03/15/1982');
  });

  it('redacts labelled DOB (ISO)', () => {
    const text = 'Date of birth: 1982-03-15.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[DOB_1]');
    expect(result.anonymizedText).not.toContain('1982-03-15');
  });

  it('redacts "born" prefix', () => {
    const text = 'The claimant was born March 15, 1982.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[DOB_1]');
    expect(result.stats.dobs).toBe(1);
  });

  it('does NOT redact unlabelled dates (hire date, termination date)', () => {
    const text = 'Hired on January 10, 2018. Terminated on June 1, 2026.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('January 10, 2018');
    expect(result.anonymizedText).toContain('June 1, 2026');
    expect(result.stats.dobs).toBe(0);
  });
});

// ── NEW: SIN ─────────────────────────────────────────────────────────────

describe('anonymize — SIN', () => {
  it('redacts labelled SIN', () => {
    const text = 'SIN: 123-456-789';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[SIN_1]');
    expect(result.anonymizedText).not.toContain('123-456-789');
    expect(result.stats.sins).toBe(1);
  });

  it('redacts "Social Insurance Number" label', () => {
    const text = 'Social Insurance Number: 987 654 321';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[SIN_1]');
    expect(result.anonymizedText).not.toContain('987 654 321');
  });

  it('redacts bare dashed SIN pattern (xxx-xxx-xxx)', () => {
    const text = 'The employee provided 123-456-789 as identification.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[SIN_1]');
    expect(result.anonymizedText).not.toContain('123-456-789');
  });
});

// ── NEW: Financial IDs ───────────────────────────────────────────────────

describe('anonymize — financial IDs', () => {
  it('redacts credit card numbers (spaced)', () => {
    const text = 'Card: 4111 1111 1111 1111';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[FINANCIAL_');
    expect(result.anonymizedText).not.toContain('4111 1111 1111 1111');
    expect(result.stats.financial).toBeGreaterThanOrEqual(1);
  });

  it('redacts credit card numbers (dashed)', () => {
    const text = 'Payment via 5500-0000-0000-0004.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[FINANCIAL_');
    expect(result.anonymizedText).not.toContain('5500-0000-0000-0004');
  });

  it('redacts labelled bank account numbers', () => {
    const text = 'Account number: 12345678';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[FINANCIAL_');
    expect(result.anonymizedText).not.toContain('12345678');
  });

  it('redacts routing/transit numbers', () => {
    const text = 'Transit number: 04567';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[FINANCIAL_');
    expect(result.anonymizedText).not.toContain('04567');
  });
});

// ── NEW: Health / Insurance IDs ──────────────────────────────────────────

describe('anonymize — health / insurance IDs', () => {
  it('redacts OHIP numbers', () => {
    const text = 'OHIP: 1234-567-890-AB';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[HEALTH_ID_');
    expect(result.anonymizedText).not.toContain('1234-567-890-AB');
    expect(result.stats.healthIds).toBeGreaterThanOrEqual(1);
  });

  it('redacts health card numbers', () => {
    const text = 'Health card number: 9876543210XY';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[HEALTH_ID_');
    expect(result.anonymizedText).not.toContain('9876543210XY');
  });

  it('redacts insurance policy numbers', () => {
    const text = 'Policy number: GRP-12345-AB';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[HEALTH_ID_');
    expect(result.anonymizedText).not.toContain('GRP-12345-AB');
  });
});

// ── NEW: Driver's Licence ────────────────────────────────────────────────

describe('anonymize — driver\'s licence', () => {
  it('redacts labelled Ontario DL number', () => {
    const text = "Driver's licence number: A1234-56789-01234";
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[DL_1]');
    expect(result.anonymizedText).not.toContain('A1234-56789-01234');
    expect(result.stats.driversLicences).toBe(1);
  });

  it('redacts "DL" abbreviated label', () => {
    const text = 'DL: B9876543210';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[DL_1]');
    expect(result.anonymizedText).not.toContain('B9876543210');
  });
});

// ── NEW: Passport ────────────────────────────────────────────────────────

describe('anonymize — passport', () => {
  it('redacts labelled passport number', () => {
    const text = 'Passport number: AB1234567';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[PASSPORT_1]');
    expect(result.anonymizedText).not.toContain('AB1234567');
    expect(result.stats.passports).toBe(1);
  });

  it('redacts "Passport No." format', () => {
    const text = 'Passport No. GA123456';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[PASSPORT_1]');
  });
});

// ── Addresses ────────────────────────────────────────────────────────────

describe('anonymize — addresses', () => {
  it('redacts street addresses', () => {
    const text = 'Resident at 123 Maple Street, Toronto.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[ADDRESS_');
    expect(result.anonymizedText).not.toContain('123 Maple Street');
    expect(result.stats.addresses).toBeGreaterThanOrEqual(1);
  });

  it('redacts Canadian postal codes', () => {
    const text = 'Postal code: M5V 2T6';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[ADDRESS_');
    expect(result.anonymizedText).not.toContain('M5V 2T6');
  });

  it('redacts addresses with suite numbers', () => {
    const text = 'Located at 4500 Yonge St, Suite 200.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[ADDRESS_');
    expect(result.anonymizedText).not.toContain('4500 Yonge St, Suite 200');
  });
});

// ── Emails (kept from original) ──────────────────────────────────────────

describe('anonymize — emails', () => {
  it('replaces email addresses', () => {
    const text = 'Contact us at legal@acme-corp.com for questions.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[EMAIL_1]');
    expect(result.anonymizedText).not.toContain('legal@acme-corp.com');
    expect(result.stats.emails).toBe(1);
  });

  it('replaces multiple emails', () => {
    const text = 'Notice to alice@example.com and bob@example.org.';
    const result = anonymize(text);
    expect(result.stats.emails).toBe(2);
  });
});

// ── Phones (kept from original) ──────────────────────────────────────────

describe('anonymize — phones', () => {
  it('replaces US/CA-format phone numbers', () => {
    const text = 'Call +1 (555) 123-4567 for support.';
    const result = anonymize(text);
    expect(result.anonymizedText).toContain('[PHONE_');
    expect(result.anonymizedText).not.toContain('555');
    expect(result.stats.phones).toBeGreaterThanOrEqual(1);
  });
});

// ── Structure Preservation ───────────────────────────────────────────────

describe('anonymize — structure preservation', () => {
  it('preserves section numbers and headings', () => {
    const text = '## Section 4.2 — Indemnification\n\n4.2.1 The Licensee shall indemnify...';
    const result = anonymize(text, ['Licensee']);
    expect(result.anonymizedText).toContain('## Section 4.2');
    expect(result.anonymizedText).toContain('4.2.1');
    expect(result.anonymizedText).toContain('[PARTY_1]');
  });
});

// ── Employment Law Scenario ──────────────────────────────────────────────

describe('anonymize — employment law scenario', () => {
  it('redacts names but preserves salary, dates, title, and tenure', () => {
    const text =
      'John Smith was employed by Acme Corp as a Senior Manager from January 10, 2018 ' +
      'to March 1, 2026, earning $95,000 per year. Date of Birth: March 15, 1982. ' +
      'SIN: 123-456-789. Email: john.smith@email.com.';
    const result = anonymize(text, ['John Smith', 'Acme Corp']);

    // Names redacted
    expect(result.anonymizedText).not.toContain('John Smith');
    expect(result.anonymizedText).not.toContain('Acme Corp');

    // Salary preserved
    expect(result.anonymizedText).toContain('$95,000');

    // Dates preserved
    expect(result.anonymizedText).toContain('January 10, 2018');
    expect(result.anonymizedText).toContain('March 1, 2026');

    // Job title preserved
    expect(result.anonymizedText).toContain('Senior Manager');

    // DOB redacted
    expect(result.anonymizedText).not.toContain('March 15, 1982');
    expect(result.stats.dobs).toBe(1);

    // SIN redacted
    expect(result.stats.sins).toBeGreaterThanOrEqual(1);

    // Email redacted
    expect(result.stats.emails).toBe(1);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────

describe('anonymize — determinism', () => {
  it('is deterministic (same input = same output)', () => {
    const text = 'Acme Corp, SIN: 123-456-789, email: test@test.com.';
    const terms = ['Acme Corp'];
    const r1 = anonymize(text, terms);
    const r2 = anonymize(text, terms);
    expect(r1.anonymizedText).toBe(r2.anonymizedText);
    expect(r1.mappings).toEqual(r2.mappings);
    expect(r1.stats).toEqual(r2.stats);
  });
});

// ── deanonymize() — Round-trip ───────────────────────────────────────────

describe('deanonymize', () => {
  it('perfectly reverses anonymisation (round-trip)', () => {
    const original = 'Acme Corp hired John Smith. SIN: 123-456-789. Email: john@acme.com.';
    const { anonymizedText, mappings } = anonymize(original, ['Acme Corp', 'John Smith']);
    const restored = deanonymize(anonymizedText, mappings);
    expect(restored).toBe(original);
  });

  it('handles multiple occurrences of same entity', () => {
    const original = 'Acme Corp agrees. Acme Corp shall also comply. Acme Corp warrants.';
    const { anonymizedText, mappings } = anonymize(original, ['Acme Corp']);
    expect(anonymizedText).not.toContain('Acme Corp');
    const restored = deanonymize(anonymizedText, mappings);
    expect(restored).toBe(original);
  });

  it('is a no-op when no mappings exist', () => {
    const text = 'Plain text without entities.';
    expect(deanonymize(text, [])).toBe(text);
  });
});

// ── deanonymizeFindings() ────────────────────────────────────────────────

describe('deanonymizeFindings', () => {
  it('replaces placeholders in content and evidence', () => {
    const { mappings } = anonymize('Acme Corp, email: legal@acme.com.', ['Acme Corp']);
    const findings = [
      { content: 'Risk: [PARTY_1] clause is broad', evidence: 'See [EMAIL_1]' },
    ];
    const result = deanonymizeFindings(findings, mappings);
    expect(result[0].content).toContain('Acme Corp');
    expect(result[0].evidence).toContain('legal@acme.com');
  });

  it('preserves undefined evidence', () => {
    const { mappings } = anonymize('Acme Corp.', ['Acme Corp']);
    const findings = [{ content: '[PARTY_1] is liable' }];
    const result = deanonymizeFindings(findings, mappings);
    expect(result[0].content).toContain('Acme Corp');
    expect(result[0].evidence).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(deanonymizeFindings([], [])).toEqual([]);
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────────

describe('anonymize — edge cases', () => {
  it('handles empty text', () => {
    const result = anonymize('', ['Acme']);
    expect(result.anonymizedText).toBe('');
    expect(result.mappings).toEqual([]);
  });

  it('handles text with no matching entities', () => {
    const text = 'This document contains no recognisable entities.';
    const result = anonymize(text);
    expect(result.anonymizedText).toBe(text);
    expect(result.mappings).toEqual([]);
  });

  it('handles text that is entirely a party name', () => {
    const text = 'Acme Corp';
    const result = anonymize(text, ['Acme Corp']);
    expect(result.anonymizedText).toBe('[PARTY_1]');
    expect(result.stats.parties).toBe(1);
  });
});
