/**
 * Unit Tests — Firm Template System + DOCX Export + Litigation Documents
 */

import { describe, it, expect } from 'vitest';
import { detectPlaceholders, injectPlaceholders, buildPlaceholderValues, STANDARD_PLACEHOLDERS } from '../../src/employment/firm-templates.js';
import { getDocumentTitle } from '../../src/employment/litigation-documents.js';

// ── Placeholder detection ────────────────────────────────────────────────

describe('detectPlaceholders', () => {
  it('detects standard placeholders', () => {
    const text = 'Dear {{CLIENT_NAME}}, we represent {{EMPLOYER_NAME}}.';
    const found = detectPlaceholders(text);
    expect(found).toContain('CLIENT_NAME');
    expect(found).toContain('EMPLOYER_NAME');
    expect(found).toHaveLength(2);
  });

  it('returns unique placeholders only', () => {
    const text = '{{CLIENT_NAME}} and {{CLIENT_NAME}} again.';
    const found = detectPlaceholders(text);
    expect(found).toHaveLength(1);
  });

  it('returns sorted results', () => {
    const text = '{{EMPLOYER_NAME}} then {{CLIENT_NAME}} then {{DATE}}.';
    const found = detectPlaceholders(text);
    expect(found).toEqual(['CLIENT_NAME', 'DATE', 'EMPLOYER_NAME']);
  });

  it('returns empty for no placeholders', () => {
    expect(detectPlaceholders('Plain text with no markers.')).toEqual([]);
  });

  it('does not detect lowercase placeholders', () => {
    expect(detectPlaceholders('{{client_name}}')).toEqual([]);
  });
});

// ── Placeholder injection ────────────────────────────────────────────────

describe('injectPlaceholders', () => {
  it('replaces simple placeholders', () => {
    const result = injectPlaceholders(
      'Dear {{CLIENT_NAME}}, your employer {{EMPLOYER_NAME}} has terminated you.',
      { CLIENT_NAME: 'Jane Doe', EMPLOYER_NAME: 'Acme Corp' },
    );
    expect(result).toBe('Dear Jane Doe, your employer Acme Corp has terminated you.');
  });

  it('leaves unknown placeholders unchanged', () => {
    const result = injectPlaceholders(
      '{{CLIENT_NAME}} — File: {{UNKNOWN_FIELD}}',
      { CLIENT_NAME: 'Jane' },
    );
    expect(result).toContain('Jane');
    expect(result).toContain('{{UNKNOWN_FIELD}}');
  });

  it('handles conditional sections — includes when value present', () => {
    const template = 'Start. {{#LEGAL_ANALYSIS}}Analysis: {{LEGAL_ANALYSIS}}{{/LEGAL_ANALYSIS}} End.';
    const result = injectPlaceholders(template, { LEGAL_ANALYSIS: 'This is the analysis.' });
    expect(result).toContain('This is the analysis.');
    expect(result).not.toContain('{{#LEGAL_ANALYSIS}}');
  });

  it('handles conditional sections — removes when value absent', () => {
    const template = 'Start. {{#LEGAL_ANALYSIS}}Analysis: {{LEGAL_ANALYSIS}}{{/LEGAL_ANALYSIS}} End.';
    const result = injectPlaceholders(template, {});
    expect(result).toBe('Start.  End.');
  });
});

// ── Placeholder value builder ────────────────────────────────────────────

describe('buildPlaceholderValues', () => {
  it('builds values from intake data', () => {
    const values = buildPlaceholderValues({
      intake: {
        client_first_name: 'Jane',
        client_last_name: 'Doe',
        employer_legal_name: 'Acme Corp',
      },
      firmName: 'Smith & Associates',
      lawyerName: 'John Smith',
    });

    expect(values.CLIENT_NAME).toBe('Jane Doe');
    expect(values.CLIENT_FIRST_NAME).toBe('Jane');
    expect(values.EMPLOYER_NAME).toBe('Acme Corp');
    expect(values.FIRM_NAME).toBe('Smith & Associates');
    expect(values.LAWYER_NAME).toBe('John Smith');
    expect(values.DATE).toBeDefined();
    expect(values.COURT_FILE_NUMBER).toBe('[TO BE ASSIGNED]');
  });

  it('handles missing intake fields gracefully', () => {
    const values = buildPlaceholderValues({ intake: {} });
    expect(values.CLIENT_NAME).toBeUndefined();
    expect(values.EMPLOYER_NAME).toBeUndefined();
    expect(values.DATE).toBeDefined(); // Always has a date
  });
});

// ── Standard placeholders ────────────────────────────────────────────────

describe('STANDARD_PLACEHOLDERS', () => {
  it('includes all essential placeholders', () => {
    expect(STANDARD_PLACEHOLDERS['{{CLIENT_NAME}}']).toBeDefined();
    expect(STANDARD_PLACEHOLDERS['{{EMPLOYER_NAME}}']).toBeDefined();
    expect(STANDARD_PLACEHOLDERS['{{FIRM_NAME}}']).toBeDefined();
    expect(STANDARD_PLACEHOLDERS['{{DATE}}']).toBeDefined();
    expect(STANDARD_PLACEHOLDERS['{{LEGAL_ANALYSIS}}']).toBeDefined();
    expect(STANDARD_PLACEHOLDERS['{{FACTS_SECTION}}']).toBeDefined();
    expect(STANDARD_PLACEHOLDERS['{{RELIEF_SOUGHT}}']).toBeDefined();
  });
});

// ── Litigation document titles ───────────────────────────────────────────

describe('getDocumentTitle', () => {
  it('returns correct titles', () => {
    expect(getDocumentTitle('discovery_plan')).toBe('Discovery Plan');
    expect(getDocumentTitle('affidavit_of_documents')).toBe('Affidavit of Documents');
    expect(getDocumentTitle('mediation_brief')).toBe('Mediation Brief');
  });
});
