/**
 * Reading the Defence against the Claim: what is actually NEW.
 *
 * Rule 25.08 lets a Reply respond only to new matters raised in the
 * Defence, and "new" is relative to the Claim. This pass reads both
 * pleadings and returns the Defence's substance sorted: admissions,
 * bare denials (already deemed denied; a Reply adds nothing), and NEW
 * MATTERS (cause particulars, mitigation allegations, after-acquired
 * cause, set-off, limitation defences) that the Plaintiff may need to
 * answer. Every item quotes the Defence, and the quote must string-
 * verify or the item is dropped: an issues list that misquotes the
 * pleading it summarizes is worse than no list.
 *
 * The output is a REVIEW artifact: the lawyer picks which new matters
 * the Reply addresses before anything is drafted.
 */

import { z } from 'zod';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('reply-comparison');

const itemSchema = z.object({
  id: z.string().max(40),
  defenceParagraph: z.string().max(40),
  kind: z.enum(['new_matter', 'denial', 'admission', 'other']).catch('other'),
  summary: z.string().min(1).max(600),
  needsReply: z.boolean().catch(false),
  why: z.string().max(600).optional(),
  quote: z.string().min(8).max(800),
});

export const comparisonSchema = z.object({
  items: z.array(itemSchema).max(40),
});

export type ReplyComparison = z.infer<typeof comparisonSchema>;
export type ComparisonItem = z.infer<typeof itemSchema>;

const SYSTEM = `You are an Ontario litigation lawyer's junior, reading a Statement of Defence against the Statement of Claim it answers, under Rule 25.08 of the Rules of Civil Procedure.

For each substantive point in the Defence, produce one item:
- kind "admission": the Defence admits an allegation of the Claim.
- kind "denial": a bare denial of what the Claim pleaded. These are already deemed denied and a Reply adds nothing; needsReply is false.
- kind "new_matter": something the Claim did not plead and the Plaintiff may need to answer: just cause particulars, failure to mitigate, after-acquired cause, set-off, a limitation defence, condonation, res judicata, release. needsReply is true where the Plaintiff has or likely has an answer the Reply should plead.
- kind "other": anything substantive that fits none of the above.

Rules:
- defenceParagraph is the Defence's own paragraph number where it gives one, or a short locator.
- quote is a VERBATIM sentence from the Defence. Every item requires one; an item you cannot quote does not exist.
- summary states the point in one plain sentence. why (for needsReply items) says in one sentence what the answer would address.
- id: n1, n2, n3... in document order.
- No em-dashes. No contractions. Return strict JSON only: {"items": [...]}.`;

export function clampComparison(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(r.items)) {
    const clampStr = (v: unknown, max: number) => typeof v === 'string' && v.length > max ? v.slice(0, max - 1) : v;
    r.items = r.items.slice(0, 40).map((item, n) => {
      if (typeof item !== 'object' || item === null) return item;
      const i = { ...(item as Record<string, unknown>) };
      if (typeof i.id !== 'string' || !i.id) i.id = `n${n + 1}`;
      i.id = clampStr(i.id, 40);
      i.defenceParagraph = clampStr(i.defenceParagraph ?? '', 40);
      i.summary = clampStr(i.summary, 600);
      i.why = clampStr(i.why, 600);
      if (i.why == null || i.why === '') delete i.why;
      i.quote = clampStr(i.quote, 800);
      return i;
    });
  }
  return r;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

export function enforceComparisonQuotes(result: ReplyComparison, defenceText: string): { kept: ReplyComparison; dropped: number } {
  const hay = norm(defenceText);
  const kept = result.items.filter(i => hay.includes(norm(i.quote)));
  return { kept: { items: kept }, dropped: result.items.length - kept.length };
}

export async function compareClaimDefence(args: {
  claimText: string;
  defenceText: string;
  definedTerms?: string[];
}): Promise<{ kept: ReplyComparison; dropped: number; costUsd: number }> {
  const user = [
    'THE STATEMENT OF CLAIM:',
    '"""',
    args.claimText.slice(0, 40_000),
    '"""',
    '',
    'THE STATEMENT OF DEFENCE:',
    '"""',
    args.defenceText.slice(0, 40_000),
    '"""',
  ].join('\n');

  const chat = await crossProviderChat({
    system: SYSTEM,
    user,
    tier: 'sonnet',
    maxTokens: 6144,
    extendOnTruncation: true,
    maxRetries: 1,
    definedTerms: args.definedTerms,
  });
  let jsonText = chat.text.trim();
  const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonText = fenced[1].trim();
  const braced = jsonText.match(/\{[\s\S]*\}/);
  const parsed = comparisonSchema.parse(clampComparison(JSON.parse(braced ? braced[0] : jsonText)));
  const { kept, dropped } = enforceComparisonQuotes(parsed, args.defenceText);
  if (dropped > 0) logger.warn('Comparison items dropped: quotes did not verify against the Defence', { dropped });
  return { kept, dropped, costUsd: chat.cost };
}
