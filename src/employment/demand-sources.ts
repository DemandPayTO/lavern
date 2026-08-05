/**
 * What the demand letter is built from.
 *
 * A demand letter argues about specific words: the termination clause the
 * parties signed, the reason the employer put in writing, the code on the
 * record of employment. Until now the letter had only what the intake form
 * captured, so it argued from a paraphrase of the contract rather than the
 * contract. Attaching the documents themselves lets it quote.
 *
 * Two rules make this safe rather than merely bigger:
 *
 * The lawyer says what each document IS. A file called "final.docx" tells
 * the model nothing, and a model guessing that a policy manual is the
 * employment agreement will quote the wrong words with confidence.
 *
 * The letter quotes; it does not paraphrase. Anything the model attributes
 * to a source has to be reproducible from the source, because opposing
 * counsel is holding the same document.
 *
 * Deterministic: no model call.
 */

/** Document kinds a demand letter can be built from. */
export const DEMAND_SOURCE_KINDS = [
  'employment_agreement',
  'termination_letter',
  'roe',
  'correspondence',
  'policy_document',
  'other',
] as const;

export type DemandSourceKind = typeof DEMAND_SOURCE_KINDS[number];

const KIND_LABEL: Record<DemandSourceKind, string> = {
  employment_agreement: 'Employment agreement',
  termination_letter: 'Termination letter',
  roe: 'Record of employment',
  correspondence: 'Correspondence',
  policy_document: 'Policy document',
  other: 'Document',
};

/** What each kind is FOR, told to the model so it reads with a purpose. */
const KIND_PURPOSE: Record<DemandSourceKind, string> = {
  employment_agreement:
    'The operative contract. Quote the termination provision and any related clause exactly as written when the letter argues about it.',
  termination_letter:
    'What the employer said in writing. The letter should answer the stated reason and the stated entitlement, in the employer\'s own words.',
  roe:
    'The record of employment. Relevant to the reason code given and to any statutory entitlement shown as paid.',
  correspondence:
    'Exchanges between the parties. Relevant to what has already been offered, admitted or refused.',
  policy_document:
    'A policy said to form part of the employment terms. Relevant only where the letter relies on it.',
  other:
    'Background the lawyer considered relevant.',
};

// Sized to real documents. An employment agreement runs 10 to 20 pages and
// a truncated one loses exactly the schedule the argument turns on.
const MAX_CHARS_PER_SOURCE = 40_000;
const MAX_SOURCES = 5;

export interface DemandSource {
  name: string;
  kind: DemandSourceKind;
  text: string;
}

export function isDemandSourceKind(value: unknown): value is DemandSourceKind {
  return typeof value === 'string' && (DEMAND_SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Build the prompt section for the attached documents.
 *
 * Returns an empty string when nothing is attached, so the caller can
 * append it unconditionally.
 */
export function demandSourceContext(sources: DemandSource[]): { context: string; dropped: string[] } {
  const dropped: string[] = [];
  const used: DemandSource[] = [];

  // The contract and the termination letter are what the letter argues
  // about; they keep their place when the cap bites.
  const priority: DemandSourceKind[] = ['employment_agreement', 'termination_letter', 'roe'];
  const ordered = [...sources].sort((a, b) => {
    const ai = priority.indexOf(a.kind);
    const bi = priority.indexOf(b.kind);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const source of ordered) {
    if (used.length >= MAX_SOURCES) { dropped.push(source.name); continue; }
    const text = source.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PER_SOURCE);
    if (!text) continue;
    used.push({ ...source, text });
  }

  if (used.length === 0) return { context: '', dropped };

  const blocks = used.map(s => [
    `--- ${KIND_LABEL[s.kind]}: ${s.name} ---`,
    KIND_PURPOSE[s.kind],
    '',
    s.text,
  ].join('\n'));

  const context = [
    'CASE DOCUMENTS',
    '',
    'The documents below are on the file. They are the words the parties',
    'actually used, and opposing counsel has the same documents.',
    '',
    'Rules for using them:',
    '- Quote exactly when the letter turns on the wording. Do not paraphrase a clause and present it as the clause.',
    '- Attribute what you quote ("the termination provision at clause 12 provides").',
    '- Where a document contradicts the intake summary, the document governs; say so plainly.',
    '- Do not describe a document that is not below, and do not infer the contents of one that is missing.',
    '',
    ...blocks,
  ].join('\n');

  return { context, dropped };
}
