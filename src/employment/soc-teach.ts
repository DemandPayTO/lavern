/**
 * Teaching the pleading nodes from the firm's own claims.
 *
 * The firm's precedents carry its settled pleading language; the nodes
 * carry the function (triggers, conditionals, slots, order). Teaching
 * takes uploaded claims, clusters their paragraphs by cause of action, and
 * proposes each node's body rewritten IN THE FIRM'S WORDING with the
 * skeleton intact. Extract and approve: nothing here saves anything. The
 * proposals go to the lawyer, through the validation gate, and bind only
 * on approval.
 *
 * MATCHING USES HEADERS AND TOPIC ANCHORS, NOT CASE NAMES. This firm does
 * not cite caselaw in its claims, so matching leans on the section
 * headings pleadings carry and on statutory and topical anchors
 * ("Employment Standards Act", "reasonable notice", "constructive
 * dismissal"). A section that matches nothing is reported as unmatched
 * rather than guessed at.
 *
 * THE SKELETON IS RE-DRESSED, NOT REPLACED. Precedents only show the
 * grounds that fired on those files; a naive learner would lose every
 * {{#if}} wrapper for grounds the twelve claims happened to share. So the
 * model is given the current body and the firm's passages, and told to
 * keep every conditional wrapper and slot while adopting the firm's
 * wording inside them. What the firm pleads that the node lacks comes back
 * separately as additions for the lawyer to place.
 */

import { createLogger } from '../utils/logger.js';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { loadSocNodes, AI_NARRATIVE_BLOCK, type SocNode } from './soc-nodes.js';
import { validateNodeContent, type NodeValidation } from './soc-node-validator.js';

const logger = createLogger('SOC-TEACH');

// ── Clustering: split a claim into headed sections ───────────────────────

export interface ClaimSection {
  heading: string;
  text: string;
}

/**
 * Split a claim's plain text into sections under its headings. Pleadings
 * are headed in capitals; a line that is short, capital and unpunctuated
 * is a heading, and everything to the next heading belongs to it.
 */
export function splitClaimSections(text: string): ClaimSection[] {
  const lines = text.split('\n');
  const sections: ClaimSection[] = [];
  let current: ClaimSection | null = null;
  for (const line of lines) {
    const t = line.trim();
    const isHeading = t.length >= 4 && t.length <= 70
      && t === t.toUpperCase()
      && /[A-Z]/.test(t)
      && !/\d{2,}/.test(t)
      && !/[.;:]$/.test(t)
      && t.split(/\s+/).length <= 10;
    if (isHeading) {
      if (current && current.text.trim()) sections.push(current);
      current = { heading: t, text: '' };
    } else if (current) {
      current.text += line + '\n';
    }
  }
  if (current && current.text.trim()) sections.push(current);
  return sections;
}

// ── Matching: section → node, by header and topic anchors ────────────────

/** Topic anchors per node. Statutes and vocabulary, never case names. */
const NODE_ANCHORS: Record<string, string[]> = {
  SOC_CLAIM_01: ['the plaintiff claims', 'claims against the defendant'],
  SOC_PARTIES_01: ['parties', 'is an individual', 'is a corporation'],
  SOC_EMPLOY_FACTS_01: ['employment history', 'commenced employment', 'position of'],
  SOC_TERMINATION_01: ['termination', 'terminated the plaintiff', 'employment was terminated'],
  SOC_TERM_CLAUSE_01: ['termination clause', 'termination provision', 'void and unenforceable'],
  SOC_NOTICE_01: ['reasonable notice', 'common law notice', 'notice period', 'character of the employment'],
  SOC_BAD_FAITH_01: ['bad faith', 'manner of dismissal', 'aggravated damages', 'punitive damages', 'moral damages'],
  SOC_STATUTE_01: ['courts of justice act', 'pleads and relies'],
  SOC_ESA_01: ['employment standards act', 'termination pay', 'severance pay', 'statutory entitlements'],
  SOC_HRC_01: ['human rights code', 'discriminat', 'protected ground', 'injury to dignity', 'accommodat'],
  SOC_CD_01: ['constructive dismissal', 'constructively dismissed', 'unilateral', 'fundamental breach'],
  SOC_INDUCE_01: ['induce', 'recruited', 'secure employment', 'left secure'],
  SOC_MISREP_01: ['misrepresent', 'negligent misrepresentation', 'representations'],
  SOC_COMMON_EMPLOYER_01: ['common employer', 'related employer', 'common and related'],
  SOC_DEFAM_01: ['defam', 'libel', 'slander', 'false statements'],
  SOC_RESTRICT_01: ['restrictive covenant', 'non-compet', 'non-solicit'],
  SOC_INTRUSION_01: ['intrusion upon seclusion', 'privacy'],
  SOC_IIMS_01: ['intentional infliction', 'mental suffering', 'mental distress'],
  SOC_UNJUST_ENRICHMENT_01: ['unjust enrichment', 'juristic reason', 'corresponding deprivation'],
  SOC_BREACH_CONTRACT_01: ['breach of contract', 'breached the employment agreement', 'express term', 'implied term'],
};

/** Word overlap between a section heading and a node's header. */
function headingScore(sectionHeading: string, nodeHeader: string): number {
  const a = new Set(sectionHeading.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const b = new Set(nodeHeader.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits;
}

export interface MatchedSection extends ClaimSection {
  sourceName: string;
}

/**
 * Assign each section of each claim to at most one node. Header overlap
 * scores double anchors in the body; below the floor, unmatched.
 */
export function matchSections(
  claims: Array<{ name: string; text: string }>,
  nodes: SocNode[],
): { matches: Map<string, MatchedSection[]>; unmatched: MatchedSection[] } {
  const matches = new Map<string, MatchedSection[]>();
  const unmatched: MatchedSection[] = [];

  for (const claim of claims) {
    for (const section of splitClaimSections(claim.text)) {
      const body = section.text.toLowerCase();
      let best: { blockId: string; score: number } | null = null;
      for (const node of nodes) {
        if (node.blockId === AI_NARRATIVE_BLOCK) continue; // facts are per-file, never taught
        let score = headingScore(section.heading, node.sectionHeader || '') * 2;
        for (const anchor of NODE_ANCHORS[node.blockId] ?? []) {
          if (section.heading.toLowerCase().includes(anchor)) score += 2;
          if (body.includes(anchor)) score += 1;
        }
        if (!best || score > best.score) best = { blockId: node.blockId, score };
      }
      const entry: MatchedSection = { ...section, sourceName: claim.name };
      if (best && best.score >= 2) {
        const list = matches.get(best.blockId) ?? [];
        list.push(entry);
        matches.set(best.blockId, list);
      } else {
        unmatched.push(entry);
      }
    }
  }
  return { matches, unmatched };
}

// ── Re-dressing: the firm's words on the existing skeleton ───────────────

const REDRESS_SYSTEM = `You are updating one block of a law firm's Statement of Claim template so that it reads in the firm's own settled language.

You are given the CURRENT TEMPLATE BLOCK and several passages showing how this firm actually pleads this cause, taken from its filed claims.

Your task: rewrite the block's wording to match the firm's, WITHOUT changing its function.

Hard rules, in order of importance:
1. Keep every {{#if ...}}, {{else}} and {{/if}} wrapper exactly where it is, wrapping the same ground it wraps now. The firm's claims only show grounds that applied to those files; a ground's wrapper must survive even when every passage happens to include it.
2. Keep every {{placeholder}} token. Where the firm's passages show a client name, employer name, date, position, dollar figure or clause text, the template keeps the token, not the value. Those passages are other clients' files: no name, date, figure or quoted clause from them may survive into the template.
3. Start every numbered paragraph with {{para}}. exactly as the current block does. Keep lettered sub-grounds lettered.
4. Where the firm's passages and the current block plead the same thing in different words, use the firm's words.
5. Where the current block pleads something the firm's passages never touch, KEEP the current wording for that part unchanged.
6. Where the firm's passages consistently plead something the current block lacks entirely, do NOT fold it in. List it separately as an addition.
7. Do not cite caselaw. This firm does not cite cases in its claims. Statutory references the firm uses stay.
8. Do not use em-dashes. Do not use contractions beyond those in the firm's own passages.

Return JSON only:
{"content": "the full updated block", "additions": [{"summary": "one line on what the firm pleads that the block lacks", "text": "the firm's paragraph, with values replaced by {{placeholder}} tokens"}], "notes": ["anything the lawyer should know about a choice you made"]}`;

export interface NodeProposal {
  blockId: string;
  sectionHeader: string;
  sources: string[];
  current: string;
  proposed: string | null;
  additions: Array<{ summary: string; text: string }>;
  notes: string[];
  validation: NodeValidation | null;
  /** Why there is no proposal, when there is none. */
  skipped?: string;
  costUsd: number;
}

/** Two occurrences is the floor: one letter is a sample, not a pattern. */
const MIN_SOURCES = 2;

export async function proposeNodeUpdates(
  claims: Array<{ name: string; text: string }>,
  customNodes?: SocNode[],
): Promise<{ proposals: NodeProposal[]; unmatched: MatchedSection[]; totalCostUsd: number }> {
  const nodes = customNodes ?? loadSocNodes();
  const { matches, unmatched } = matchSections(claims, nodes);
  const proposals: NodeProposal[] = [];
  let totalCostUsd = 0;

  for (const node of nodes) {
    if (node.blockId === AI_NARRATIVE_BLOCK) continue;
    const sections = matches.get(node.blockId) ?? [];
    const sourceNames = [...new Set(sections.map(s => s.sourceName))];

    if (sourceNames.length < MIN_SOURCES) {
      if (sections.length > 0) {
        proposals.push({
          blockId: node.blockId, sectionHeader: node.sectionHeader, sources: sourceNames,
          current: node.content, proposed: null, additions: [], notes: [],
          validation: null, costUsd: 0,
          skipped: `Only ${sourceNames.length} of your claims plead this. Two is the floor: one claim is a sample, not a pattern.`,
        });
      }
      continue;
    }

    const passages = sections
      .map(s => `--- from ${s.sourceName} ---\n${s.text.trim().slice(0, 6000)}`)
      .join('\n\n');

    try {
      const result = await crossProviderChat({
        system: REDRESS_SYSTEM,
        user: `CURRENT TEMPLATE BLOCK (${node.sectionHeader || node.blockId}):\n\n${node.content}\n\nTHE FIRM'S OWN PASSAGES FOR THIS CAUSE:\n\n${passages}`,
        tier: 'sonnet',
        maxTokens: 8192,
        maxRetries: 2,
      });
      totalCostUsd += result.cost;

      let jsonText = result.text.trim();
      const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) jsonText = fenced[1].trim();
      const braced = jsonText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(braced ? braced[0] : jsonText) as {
        content?: string; additions?: Array<{ summary: string; text: string }>; notes?: string[];
      };
      const proposed = (parsed.content ?? '').trim();

      proposals.push({
        blockId: node.blockId,
        sectionHeader: node.sectionHeader,
        sources: sourceNames,
        current: node.content,
        proposed: proposed || null,
        additions: (parsed.additions ?? []).slice(0, 6),
        notes: (parsed.notes ?? []).slice(0, 6),
        validation: proposed ? validateNodeContent(node.blockId, proposed) : null,
        costUsd: result.cost,
      });
    } catch (err) {
      logger.warn('Node proposal failed', { blockId: node.blockId, error: err instanceof Error ? err.message : String(err) });
      proposals.push({
        blockId: node.blockId, sectionHeader: node.sectionHeader, sources: sourceNames,
        current: node.content, proposed: null, additions: [], notes: [],
        validation: null, costUsd: 0,
        skipped: 'The proposal could not be generated. Try again, or edit the node by hand.',
      });
    }
  }

  return { proposals, unmatched, totalCostUsd };
}
