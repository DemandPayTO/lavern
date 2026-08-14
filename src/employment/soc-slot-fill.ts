/**
 * Filling the claim's blanks from the file's own documents, and turning
 * the lawyer's intake prose into pleading language.
 *
 * The node engine never invents a fact: an unknown slot renders as
 * [LAWYER: name]. That guarantee stays. What changes is who does the
 * looking-up: when the matter carries sources (the demand letter, an
 * attached document), one model pass proposes values for the unresolved
 * slots, each with a verbatim quote that must string-verify against a
 * source or the fill is dropped. Every applied fill is flagged on the
 * draft with its quote, so the lawyer reviews what was filled, not
 * whether filling happened.
 *
 * The same pass rewrites PROSE slots: the intake asks "what happened at
 * termination" and gets an answer in the lawyer's or client's words;
 * pasting that verbatim into a pleading paragraph is transcription, not
 * drafting. The rewrite must preserve every fact and add none; the
 * original wording stays on the intake untouched.
 */

import { z } from 'zod';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('soc-slot-fill');

/** Intake fields that carry narrative prose and deserve pleading register. */
export const PROSE_SLOTS = new Set([
  'termination_reasons',
  'cd_changes',
  'constructive_dismissal_grounds',
  'bad_faith_termination_particulars',
  'overtime_duties_description',
  'hrc_conduct_description',
  'inducement_representations',
]);

const fillSchema = z.object({
  fills: z.record(z.string(), z.object({
    value: z.string().min(1).max(600),
    sourceQuote: z.string().min(8).max(800),
    sourceName: z.string().max(300).optional(),
  })).default({}),
  rewrites: z.record(z.string(), z.string().min(1).max(2000)).default({}),
});

export type SlotFillResult = z.infer<typeof fillSchema>;

const SYSTEM = `You assist an Ontario employment litigator assembling a Statement of Claim from the firm's settled pleading language. Two jobs, both bound by one rule: never invent, never embellish, never soften.

1. FILLS. You are given slot names the claim could not fill and the file's source documents. Fill a slot ONLY where a source explicitly states the value, and ALWAYS include sourceQuote with the exact sentence it came from. A fill without a verbatim quote is discarded. Skip slots the sources do not answer.

2. REWRITES. You are given intake answers written in conversational words. Rewrite each into pleading register: third person, formal, concise, suitable for insertion into a numbered pleading paragraph. Preserve EVERY fact; add NONE; no case citations; no adjectives the facts do not carry. Write "the Plaintiff" for the client and "the Defendant" for the employer.

No em-dashes. No contractions. Return strict JSON only:
{"fills": {"slot_name": {"value": "...", "sourceQuote": "...", "sourceName": "..."}}, "rewrites": {"slot_name": "..."}}`;

export interface SlotFillArgs {
  missingSlots: string[];
  proseSlots: Record<string, string>;
  sources: Array<{ name: string; text: string }>;
  definedTerms?: string[];
}

export function clampSlotFill(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const clampStr = (v: unknown, max: number) => typeof v === 'string' && v.length > max ? v.slice(0, max - 1) : v;
  if (r.fills && typeof r.fills === 'object') {
    const fills: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.fills as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const f = { ...(v as Record<string, unknown>) };
      f.value = clampStr(f.value, 600);
      f.sourceQuote = clampStr(f.sourceQuote, 800);
      f.sourceName = clampStr(f.sourceName, 300);
      if (f.sourceName == null) delete f.sourceName;
      fills[k] = f;
    }
    r.fills = fills;
  }
  if (r.rewrites && typeof r.rewrites === 'object') {
    const rw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.rewrites as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) rw[k] = clampStr(v, 2000);
    }
    r.rewrites = rw;
  }
  for (const k of ['fills', 'rewrites']) if (r[k] == null) delete r[k];
  return r;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/** Drop fills whose quote does not verify against any source. Never trust an unquoted lookup. */
export function enforceFillQuotes(result: SlotFillResult, sources: Array<{ name: string; text: string }>): { kept: SlotFillResult; droppedFills: string[] } {
  const haystacks = sources.map(s => norm(s.text));
  const kept: SlotFillResult = { fills: {}, rewrites: result.rewrites };
  const droppedFills: string[] = [];
  for (const [slot, fill] of Object.entries(result.fills)) {
    if (haystacks.some(h => h.includes(norm(fill.sourceQuote)))) kept.fills[slot] = fill;
    else droppedFills.push(slot);
  }
  return { kept, droppedFills };
}

export async function fillSocSlots(args: SlotFillArgs): Promise<{ kept: SlotFillResult; droppedFills: string[]; costUsd: number } | null> {
  if (args.missingSlots.length === 0 && Object.keys(args.proseSlots).length === 0) return null;

  const parts: string[] = [];
  if (args.missingSlots.length > 0 && args.sources.length > 0) {
    parts.push(`SLOTS THE CLAIM COULD NOT FILL:\n${args.missingSlots.map(s => `- ${s}`).join('\n')}`);
  }
  if (Object.keys(args.proseSlots).length > 0) {
    parts.push('INTAKE ANSWERS TO REWRITE INTO PLEADING REGISTER:\n' +
      Object.entries(args.proseSlots).map(([k, v]) => `- ${k}: """${v.slice(0, 3000)}"""`).join('\n'));
  }
  for (const src of args.sources.slice(0, 4)) {
    parts.push(`SOURCE DOCUMENT "${src.name}":\n"""\n${src.text.slice(0, 25_000)}\n"""`);
  }

  try {
    const chat = await crossProviderChat({
      system: SYSTEM,
      user: parts.join('\n\n'),
      tier: 'sonnet',
      maxTokens: 4096,
      maxRetries: 1,
      definedTerms: args.definedTerms,
    });
    let jsonText = chat.text.trim();
    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonText = fenced[1].trim();
    const braced = jsonText.match(/\{[\s\S]*\}/);
    const parsed = fillSchema.parse(clampSlotFill(JSON.parse(braced ? braced[0] : jsonText)));
    // Only requested slots may fill or rewrite; the model does not get to volunteer.
    const wantFill = new Set(args.missingSlots);
    const wantRewrite = new Set(Object.keys(args.proseSlots));
    parsed.fills = Object.fromEntries(Object.entries(parsed.fills).filter(([k]) => wantFill.has(k)));
    parsed.rewrites = Object.fromEntries(Object.entries(parsed.rewrites).filter(([k]) => wantRewrite.has(k)));
    return { ...enforceFillQuotes(parsed, args.sources), costUsd: chat.cost };
  } catch (err) {
    // Best effort by design: a failed lookup must not fail the claim the
    // lawyer already paid for. The blanks stay blanks, honestly marked.
    logger.warn('Slot fill failed; the claim keeps its [LAWYER: ...] markers', {
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });
    return null;
  }
}
