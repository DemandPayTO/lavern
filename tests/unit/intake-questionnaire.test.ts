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

describe('deriveEngineFields: the answers reach the engines', () => {
  it('a constructive dismissal answer fires gate G5 end to end', async () => {
    const { applyQuestionnaireAliases } = await import('../../src/employment/intake-questionnaire.js');
    const { evaluateGates } = await import('../../src/employment/gate-evaluator.js');
    const saved = applyQuestionnaireAliases({
      separation_type: 'CONSTRUCTIVE',
      cd_changes: 'Territory reduced, Compensation cut',
    });
    expect(saved.is_constructive_dismissal).toBe(true);
    expect(saved.was_terminated).toBe(true);
    expect(saved.constructive_dismissal_grounds).toContain('Territory reduced');
    const gates = evaluateGates(saved as never);
    expect(gates.find(g => g.gate === 'G5')?.triggered).toBe(true);
  });

  it('human rights grounds fire G10; OHSA answers fire G14', async () => {
    const { applyQuestionnaireAliases } = await import('../../src/employment/intake-questionnaire.js');
    const { evaluateGates } = await import('../../src/employment/gate-evaluator.js');
    const saved = applyQuestionnaireAliases({
      hrc_grounds: ['disability', 'age'],
      has_disability: true,
      accommodation_refused: true,
      ohsa_work_refusal: true,
    });
    expect(saved.believes_discriminatory_termination).toBe(true);
    expect(saved.discrimination_grounds).toEqual(['disability', 'age']);
    expect(saved.accommodation_denied).toBe(true);
    expect(saved.experienced_reprisal).toBe(true);
    const gates = evaluateGates(saved as never);
    expect(gates.find(g => g.gate === 'G10')?.triggered).toBe(true);
    expect(gates.find(g => g.gate === 'G14')?.triggered).toBe(true);
  });

  it('the clause answers arm the clause fields without inventing an attack', async () => {
    const { applyQuestionnaireAliases } = await import('../../src/employment/intake-questionnaire.js');
    const saved = applyQuestionnaireAliases({
      has_term_clause: true,
      cause_standard: 'broader',
      clause_benefits_continuation: false,
      no_fresh_consideration: true,
    });
    expect(saved.termination_clause_exists).toBe(true);
    expect(saved.clause_cause_broader).toBe(true);
    expect(saved.clause_no_benefits).toBe(true);
    expect(saved.fresh_consideration_provided).toBe(false);
  });

  it('a resignation answer says so: was_terminated false, nothing armed', async () => {
    const { applyQuestionnaireAliases } = await import('../../src/employment/intake-questionnaire.js');
    const saved = applyQuestionnaireAliases({ separation_type: 'RESIGNED' });
    expect(saved.was_terminated).toBe(false);
    expect(saved.is_constructive_dismissal).toBe(false);
  });

  it('a direct answer always beats a derivation', async () => {
    const { applyQuestionnaireAliases } = await import('../../src/employment/intake-questionnaire.js');
    const saved = applyQuestionnaireAliases({ separation_type: 'CONSTRUCTIVE', is_constructive_dismissal: false });
    expect(saved.is_constructive_dismissal).toBe(false);
  });
});
