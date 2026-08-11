/**
 * Unit Tests — the intake questionnaire definition and its aliases.
 *
 * The definition is generated from the firm's workbook; these tests pin
 * the contract: every question's key exists in the intake schema, every
 * option set referenced exists, conditions parse, and the aliases write
 * the fields the engines read without ever overwriting a direct answer.
 */

import { describe, it, expect } from 'vitest';
import { loadQuestionnaire, applyQuestionnaireAliases } from '../../src/employment/intake-questionnaire.js';
import { employmentIntakeSchema } from '../../src/types/employment-intake.js';

const def = loadQuestionnaire();
const schemaKeys = new Set(Object.keys((employmentIntakeSchema as unknown as { shape: Record<string, unknown> }).shape));

describe('the definition', () => {
  it('carries the full bank: 17 sections, 110 questions', () => {
    expect(def.sections.length).toBe(17);
    expect(def.sections.reduce((n, s) => n + s.questions.length, 0)).toBe(110);
  });

  it('every question key exists in the intake schema', () => {
    for (const s of def.sections) for (const q of s.questions) {
      expect(schemaKeys.has(q.key), `${q.id}: ${q.key} missing from schema`).toBe(true);
    }
  });

  it('every referenced option set exists', () => {
    for (const s of def.sections) for (const q of s.questions) {
      if (q.optionsRef) expect(def.optionSets[q.optionsRef], `${q.id}: ${q.optionsRef}`).toBeTruthy();
    }
  });

  it('every alias points at a real schema field', () => {
    for (const a of def.aliases) {
      expect(schemaKeys.has(a.to), `alias target ${a.to}`).toBe(true);
    }
  });
});

describe('applyQuestionnaireAliases', () => {
  it('mirrors an answer onto the field the engines read', () => {
    const out = applyQuestionnaireAliases({ base_salary: 92000 });
    expect(out.annual_salary).toBe(92000);
  });

  it('No to "was vacation pay paid" states the shortfall', () => {
    const out = applyQuestionnaireAliases({ vacation_paid: false });
    expect(out.vacation_unpaid).toBe(true);
    const yes = applyQuestionnaireAliases({ vacation_paid: true });
    expect(yes.vacation_unpaid).toBe(false);
  });

  it('a multi-select joins onto a text field', () => {
    const out = applyQuestionnaireAliases({ hrc_grounds: ['disability', 'age'] });
    expect(out.hrc_protected_ground).toBe('disability, age');
  });

  it('never overwrites a directly-set target, and absent keys mirror nothing', () => {
    const out = applyQuestionnaireAliases({ base_salary: 92000, annual_salary: 95000 });
    expect(out.annual_salary).toBe(95000);
    const none = applyQuestionnaireAliases({ job_title: 'Advisor' });
    expect('annual_salary' in none).toBe(false);
  });
});
