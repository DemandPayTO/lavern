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
 * Mirror questionnaire answers onto the Starling fields the generators
 * and gates read. Only keys PRESENT in the payload mirror; an alias
 * never overwrites a target the payload set directly.
 */
export function applyQuestionnaireAliases(values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
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
