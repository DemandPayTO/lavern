/**
 * Generate the intake questionnaire definition from the DemandPay schema
 * workbook (inbox/Employment_Law_Intake_Schema.xlsx, Questions + Answer
 * Options sheets) into src/employment/intake-questionnaire.json.
 *
 * Run when the firm updates the workbook:
 *   npx tsx scripts/generate-intake-questionnaire.ts
 *
 * The output is DATA, checked in like soc-nodes-data.json, so the app
 * never parses a spreadsheet at runtime and the diff of a regeneration
 * is reviewable. Aliases (below) mirror questionnaire answers onto the
 * Starling fields the generators and gates already read.
 */

import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('inbox/Employment_Law_Intake_Schema.xlsx');
const OUT = path.resolve('src/employment/intake-questionnaire.json');

/** Questionnaire answers mirrored onto existing Starling intake fields. */
const ALIASES: Array<{ from: string; to: string; transform?: 'invert' | 'join' }> = [
  { from: 'base_salary', to: 'annual_salary' },
  { from: 'age_at_termination', to: 'client_age' },
  { from: 'employer_alleged_cause', to: 'employer_alleged_just_cause' },
  { from: 'found_new_employment', to: 'new_employment_found' },
  { from: 'has_noncompete', to: 'has_non_compete' },
  { from: 'has_nonsolicit', to: 'has_non_solicitation' },
  { from: 'bad_faith_acts', to: 'bad_faith_conduct' },
  { from: 'hrc_grounds', to: 'hrc_protected_ground', transform: 'join' },
  { from: 'recruitment_promises', to: 'inducement_representations', transform: 'join' },
  // "Was X paid?" answered No is the lawyer stating the shortfall.
  { from: 'vacation_paid', to: 'vacation_unpaid', transform: 'invert' },
  { from: 'benefits_continued', to: 'benefits_not_continued', transform: 'invert' },
  { from: 'received_term_pay', to: 'esa_term_shortfall', transform: 'invert' },
];

/** CHECKBOX questions stored as a joined string because a generator reads them as text. */
const JOIN_AS_STRING = new Set(['cd_changes']);

async function readSheet(zip: JSZip, file: string, shared: string[]): Promise<Record<string, string>[]> {
  const xml = await zip.file(`xl/worksheets/${file}`)!.async('string');
  const rows: Record<string, string>[] = [];
  for (const rm of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row: Record<string, string> = {};
    for (const c of rm[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
      if (!ref) continue;
      const t = /t="([a-z]+)"/i.exec(c[1])?.[1];
      const inner = c[2] ?? '';
      let v = '';
      if (t === 'inlineStr') v = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('');
      else {
        const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        v = t === 's' ? (shared[+raw] ?? '') : raw;
      }
      row[ref] = v;
    }
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

const zip = await JSZip.loadAsync(fs.readFileSync(SRC));
const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? '';
const shared = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m =>
  [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&'));

// The workbook references one option set its Answer Options sheet never
// defines; supply it here rather than silently rendering a dead dropdown.
const FALLBACK_OPTION_SETS: Record<string, Array<{ value: string; label: string }>> = {
  OPT_CAUSE_STANDARD: [
    { value: 'wilful_misconduct', label: "Uses the exact phrase 'wilful misconduct'" },
    { value: 'broader', label: "Uses a broader standard (e.g. 'just cause', 'any breach')" },
    { value: 'unsure', label: 'Unsure' },
  ],
};

const qRows = (await readSheet(zip, 'sheet2.xml', shared)).slice(2);
const oRows = (await readSheet(zip, 'sheet4.xml', shared)).slice(1);

const optionSets: Record<string, Array<{ value: string; label: string }>> = {};
for (const r of oRows) {
  if (!r.A || !r.B) continue;
  const parts = r.B.split('|');
  const opts: Array<{ value: string; label: string }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) opts.push({ value: parts[i], label: parts[i + 1] });
  optionSets[r.A] = opts;
}

interface Question {
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

const sections: Array<{ id: string; title: string; questions: Question[] }> = [];
for (const r of qRows) {
  if (!r.A || !r.D || !r.C) continue;
  const sectionTitle = (r.B ?? 'Other').trim();
  let section = sections.find(s => s.title === sectionTitle);
  if (!section) {
    section = { id: `s${sections.length}`, title: sectionTitle, questions: [] };
    sections.push(section);
  }
  const rawType = (r.E ?? 'TEXT').trim().toUpperCase();
  const optionsRef = (r.F ?? '').trim();
  const type: Question['type'] =
    rawType === 'DATE' ? 'date'
    : rawType === 'NUMBER' ? 'number'
    : rawType === 'TEXTAREA' ? 'textarea'
    : rawType === 'CHECKBOX' ? 'multi'
    : rawType === 'RADIO' ? (optionsRef === 'OPT_YESNO' || !optionsRef ? 'yesno' : 'select')
    : 'text';
  section.questions.push({
    id: r.A.trim(),
    key: r.D.trim(),
    text: (r.C ?? '').trim(),
    type,
    ...(type === 'select' || type === 'multi' ? { optionsRef } : {}),
    required: (r.G ?? '').trim().toUpperCase() === 'YES',
    ...((r.H ?? '').trim() ? { showIf: r.H.trim() } : {}),
    ...((r.N ?? '').trim() ? { note: r.N.trim().slice(0, 200) } : {}),
    ...(JOIN_AS_STRING.has(r.D.trim()) ? { joinAsString: true } : {}),
  });
}

for (const [name, opts] of Object.entries(FALLBACK_OPTION_SETS)) {
  if (!optionSets[name]) optionSets[name] = opts;
}

const out = { generatedFrom: 'Employment_Law_Intake_Schema.xlsx', sections, optionSets, aliases: ALIASES };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${OUT}: ${sections.length} sections, ${sections.reduce((n, s) => n + s.questions.length, 0)} questions, ${Object.keys(optionSets).length} option sets.`);
