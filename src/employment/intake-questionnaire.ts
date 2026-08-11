/**
 * The intake questionnaire: the firm's DemandPay question bank, served
 * as data and mirrored onto the fields the engines read.
 *
 * The definition (17 gate sections, 110 questions, option sets, alias
 * map) is generated from the firm's schema workbook by
 * scripts/generate-intake-questionnaire.ts into intake-questionnaire.json
 * and checked in, so a regeneration is a reviewable diff and the app
 * never parses a spreadsheet at runtime.
 *
 * Aliases are applied AT SAVE, server side, and only when the source key
 * is present in the incoming payload: answering "Was vacation pay paid?"
 * with No writes vacation_unpaid = true alongside it, because that answer
 * IS the lawyer stating the shortfall. Stale mirrors are never re-derived
 * from old answers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface QuestionnaireQuestion {
  id: string;
  key: string;
  text: string;
  type: 'date' | 'number' | 'text' | 'textarea' | 'yesno' | 'select' | 'multi';
  optionsRef?: string;
  required: boolean;
  showIf?: string;
  note?: string;
  joinAsString?: boolean;
}

export interface QuestionnaireDefinition {
  generatedFrom: string;
  sections: Array<{ id: string; title: string; questions: QuestionnaireQuestion[] }>;
  optionSets: Record<string, Array<{ value: string; label: string }>>;
  aliases: Array<{ from: string; to: string; transform?: 'invert' | 'join' }>;
}

let cached: QuestionnaireDefinition | null = null;

export function loadQuestionnaire(): QuestionnaireDefinition {
  if (cached) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = fs.readFileSync(path.join(here, 'intake-questionnaire.json'), 'utf8');
  cached = JSON.parse(raw) as QuestionnaireDefinition;
  return cached;
}

/**
 * Derive the ENGINE fields from questionnaire answers: the gate
 * evaluator, the analysis, and the claim assembly read Starling's
 * original field names, and the questionnaire speaks DemandPay's. This
 * is the full bridge, applied at save alongside the plain aliases.
 * Same guarantees: a rule only fires when its source is present in the
 * payload, and never overwrites a target the payload set directly.
 */
export function deriveEngineFields(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  const has = (k: string) => k in values && values[k] !== undefined && values[k] !== null && values[k] !== '';
  const put = (k: string, v: unknown) => { if (!(k in values)) out[k] = v; };
  const yes = (k: string) => values[k] === true;
  const no = (k: string) => values[k] === false;

  // Gate 4: manner of separation drives the claim's spine.
  if (has('separation_type')) {
    const st = String(values.separation_type).toUpperCase();
    put('is_constructive_dismissal', st === 'CONSTRUCTIVE');
    put('was_terminated', st === 'TERMINATED' || st === 'CONSTRUCTIVE' || st === 'LAID_OFF');
  }

  // Gate 3: the termination clause attack.
  if (has('has_term_clause')) put('termination_clause_exists', yes('has_term_clause'));
  if (has('no_fresh_consideration')) put('fresh_consideration_provided', !yes('no_fresh_consideration'));
  if (has('cause_standard') && String(values.cause_standard) === 'broader') put('clause_cause_broader', true);
  if (no('clause_benefits_continuation')) put('clause_no_benefits', true);

  // Gate 5: constructive dismissal particulars.
  if (has('cd_changes')) {
    const v = values.cd_changes;
    put('constructive_dismissal_grounds', Array.isArray(v) ? v.join(', ') : String(v));
  }

  // Gate 7: inducement.
  if (has('resigned_prior_employer')) put('left_secure_employment', yes('resigned_prior_employer'));

  // Gate 8: successor employer.
  if (yes('formal_sale') || yes('no_gap_successor')) put('employer_changed_through_acquisition', true);

  // Gate 10: human rights.
  if (has('hrc_grounds')) {
    const grounds = Array.isArray(values.hrc_grounds) ? values.hrc_grounds as string[] : [String(values.hrc_grounds)];
    if (grounds.length > 0) {
      put('believes_discriminatory_termination', true);
      // The gate evaluator reads this as a list, not prose.
      put('discrimination_grounds', grounds);
    }
  }
  if (has('has_disability')) put('has_known_medical_condition', yes('has_disability'));
  if (has('accommodation_refused')) put('accommodation_denied', yes('accommodation_refused'));
  if (has('hrc_harassment')) put('experienced_harassment', yes('hrc_harassment'));

  // Gate 11: manner of dismissal.
  if (has('dismissal_manner')) put('bad_faith_details', String(values.dismissal_manner));
  if (has('roe_coded_correctly')) put('roe_wrong_or_missing', !yes('roe_coded_correctly'));

  // Gate 12: compensation shape.
  if (has('has_equity_comp')) put('has_equity', yes('has_equity_comp'));
  if (has('other_compensation') && Array.isArray(values.other_compensation)) {
    const oc = values.other_compensation as string[];
    if (oc.includes('CAR_ALLOW')) put('has_car_allowance', true);
    if (oc.includes('RRSP')) put('has_rrsp', true);
  }

  // Gate 14: OHSA reprisal.
  const reprisals: string[] = [];
  if (yes('ohsa_concern_raised')) reprisals.push('raised a health and safety concern');
  if (yes('ohsa_work_refusal')) reprisals.push('refused unsafe work');
  if (yes('workplace_violence')) reprisals.push('reported workplace violence');
  if (yes('ohsa_harassment_reported')) reprisals.push('reported workplace harassment');
  if (reprisals.length > 0) {
    put('experienced_reprisal', true);
    put('reprisal_type', 'ohsa');
    put('reprisal_details', reprisals.join('; '));
  }

  return out;
}

/**
 * Mirror questionnaire answers onto the Starling fields the generators
 * and gates read. Only keys PRESENT in the payload mirror; an alias
 * never overwrites a target the payload set directly.
 */
export function applyQuestionnaireAliases(values: Record<string, unknown>): Record<string, unknown> {
  const out = deriveEngineFields(values);
  for (const alias of loadQuestionnaire().aliases) {
    if (!(alias.from in values)) continue;
    if (alias.to in values) continue;
    const v = values[alias.from];
    if (v === undefined || v === null || v === '') continue;
    if (alias.transform === 'invert') {
      if (typeof v === 'boolean') out[alias.to] = !v;
    } else if (alias.transform === 'join') {
      if (Array.isArray(v)) out[alias.to] = v.join(', ');
      else if (typeof v === 'string') out[alias.to] = v;
    } else {
      out[alias.to] = v;
    }
  }
  return out;
}
