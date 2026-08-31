/**
 * What a document reads before it drafts, answered in one place.
 *
 * This existed five times, once per generation path, and the copies disagreed.
 * The claim's section-by-section facts route passed nothing at all, so those
 * facts were written from intake fields alone. The mediation brief's section
 * route hardcoded `extraSources: []`, so drafting the brief section by section
 * silently dropped every document the lawyer had attached, while drafting it
 * whole read all six. One route resolved the demand letter through
 * findGeneratedDocKey and another reached for matter.generatedDemandLetter
 * directly.
 *
 * None of that was visible from any single file, which is the point: a
 * question asked in five places gets five answers, and the wrong ones are
 * silent. The policy per document type now lives in one table, and a new route
 * cannot forget to ask.
 *
 * Deterministic: no model call.
 */

import { findGeneratedDocKey } from './shared.js';

export type DocumentSource = { name: string; content: string };

/** Per document type: what rides along automatically, and what it may read. */
type SourcePolicy = {
  /** Generated documents included by default, subject to the caller's flags. */
  generatedDemand: boolean;
  generatedClaim: boolean;
  /** The caller's include flags are honoured. Where false, the policy governs
   *  and a flag cannot switch the document off. */
  flagsGovern: boolean;
  /** The legacy single-slot attachment this document has always read. */
  legacySlot?: 'socSource';
};

const POLICY: Record<string, SourcePolicy> = {
  // The claim reads the position already taken, and must not contradict it.
  // It is never a source for itself.
  statement_of_claim: { generatedDemand: true, generatedClaim: false, flagsGovern: false, legacySlot: 'socSource' },
  // The brief argues the positions already taken, so both ride along, and the
  // lawyer may switch either off.
  mediation_brief: { generatedDemand: true, generatedClaim: true, flagsGovern: true },
  // Schedule "A" takes its allegations from the pleading the lawyer attaches.
  hrto_schedule_a: { generatedDemand: true, generatedClaim: true, flagsGovern: true },
};

const DEFAULT_POLICY: SourcePolicy = { generatedDemand: false, generatedClaim: false, flagsGovern: true };

/** Six sources dilute a draft, and each one costs attention and money. */
const MAX_SOURCES = 6;
const MAX_CHARS_PER_SOURCE = 60_000;

function stripCap(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS_PER_SOURCE);
}

function generatedHtml(matter: Record<string, unknown>, docType: string): string | undefined {
  const key = findGeneratedDocKey(matter, docType);
  if (!key) return undefined;
  return String((matter[key] as Record<string, unknown> | undefined)?.html ?? '') || undefined;
}

export function documentSources(
  matter: Record<string, unknown>,
  opts: {
    documentType: string;
    /** Ids from the matter's shared attachment store that the lawyer ticked. */
    briefSourceIds?: string[];
    /** Documents supplied with the request rather than stored on the matter. */
    extraSources?: Array<{ name: string; text: string }>;
    includeGeneratedDemand?: boolean;
    includeGeneratedClaim?: boolean;
  },
): { sources: DocumentSource[]; dropped: string[] } {
  const policy = POLICY[opts.documentType] ?? DEFAULT_POLICY;
  const wantDemand = policy.generatedDemand
    && (!policy.flagsGovern || (opts.includeGeneratedDemand ?? true));
  const wantClaim = policy.generatedClaim
    && (!policy.flagsGovern || (opts.includeGeneratedClaim ?? true));

  const sources: DocumentSource[] = [];
  const dropped: string[] = [];
  const push = (name: string, content: string) => {
    if (!name.trim() || !content.trim()) return;
    if (sources.length >= MAX_SOURCES) { dropped.push(name); return; }
    sources.push({ name, content });
  };

  // The positions already taken come first: they are the operative documents.
  if (wantDemand) push('the demand letter on this matter', stripCap(generatedHtml(matter, 'demand_letter')));
  if (wantClaim) push('the statement of claim on this matter', stripCap(generatedHtml(matter, 'statement_of_claim')));

  // The legacy single attachment, still read for matters that carry one.
  if (policy.legacySlot) {
    const attached = matter[policy.legacySlot] as { name?: string; text?: string } | undefined;
    if (attached?.text) push(String(attached.name ?? 'attached document'), attached.text.slice(0, MAX_CHARS_PER_SOURCE));
  }

  // The matter's shared store, the one the workspaces attach into.
  if (opts.briefSourceIds?.length) {
    const stored = (matter.briefSources ?? []) as Array<{ id: string; name: string; text: string }>;
    for (const sd of stored) {
      if (!opts.briefSourceIds.includes(sd.id)) continue;
      push(String(sd.name ?? 'attached document'), String(sd.text ?? '').slice(0, MAX_CHARS_PER_SOURCE));
    }
  }

  for (const extra of opts.extraSources ?? []) {
    push(String(extra.name ?? '').slice(0, 200), String(extra.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PER_SOURCE));
  }

  return { sources, dropped };
}

/** The same sources rendered for a prompt that takes one block of text. */
export function documentSourcesText(sources: DocumentSource[]): string | undefined {
  const text = sources.map(s => `[${s.name}]\n${s.content}`).join('\n\n');
  return text.trim() ? text : undefined;
}
