/**
 * Teach the factum argument library from the firm's own factums.
 *
 * The lawyer uploads one or more of the firm's wrongful-dismissal factums; the
 * model reads how the firm argues each issue and proposes updated argument
 * guidance for the matching library sections. Nothing changes until the lawyer
 * approves a proposal, section by section (the route persists it).
 */

import { createLogger } from '../utils/logger.js';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { loadFactumNodes, type FactumNode } from './factum-nodes.js';

const logger = createLogger('FACTUM-TEACH');

export interface FactumArgumentProposal {
  blockId: string;
  sectionHeader: string;
  issueLabel: string;
  sources: string[];
  current: string;
  proposed: string | null;
  notes: string[];
  skipped?: string;
}

const SYSTEM = `You are a senior Ontario employment litigator distilling a firm's own factums into reusable argument guidance.

You are given the firm's factums and a list of argument sections (one per legal issue in a wrongful dismissal factum). For each section, extract HOW THIS FIRM ARGUES THAT ISSUE from the factums, and propose updated guidance that captures the firm's structure, emphasis and phrasing.

RULES:
- The guidance is instruction for drafting a future factum's Part III, not the argument itself. Write it as guidance ("Argue that ...; rely on ...; apply ... to the plaintiff"), in the firm's approach.
- Keep the same legal test and authorities that the section already cites; do not invent new case law. If the firm's factums cite an authority the section does not, you may note it, but do not add it to the guidance unless it plainly belongs.
- Only propose a change for a section the factums actually argue. If the factums do not argue an issue, skip it.
- Canadian English. No em-dashes. No contractions.
- Return ONLY JSON: {"proposals":[{"blockId":"...","proposed":"...","notes":["..."],"skipped":"..."}]}. Use "proposed" when you have an updated guidance; use "skipped" (and omit "proposed") when the factums do not argue that issue.`;

export async function proposeFactumArgumentUpdates(
  factums: Array<{ name: string; text: string }>,
  customNodes?: FactumNode[],
): Promise<{ proposals: FactumArgumentProposal[]; totalCostUsd: number }> {
  const nodes = customNodes ?? loadFactumNodes();
  const usable = factums.filter(f => f.text.trim().length >= 200);
  if (usable.length === 0) {
    return { proposals: [], totalCostUsd: 0 };
  }

  const factumText = usable
    .map(f => `--- FACTUM: ${f.name} ---\n${f.text.trim().slice(0, 24000)}`)
    .join('\n\n');
  const sectionList = nodes
    .map(n => `- ${n.blockId} (${n.sectionHeader}), currently: ${n.guidance.trim().slice(0, 400)}`)
    .join('\n');

  let totalCostUsd = 0;
  let byId = new Map<string, { proposed?: string; notes?: string[]; skipped?: string }>();
  try {
    const result = await crossProviderChat({
      system: SYSTEM,
      user: `THE FIRM'S FACTUMS:\n\n${factumText}\n\nARGUMENT SECTIONS TO UPDATE:\n${sectionList}`,
      tier: 'sonnet',
      maxTokens: 12000,
      maxRetries: 2,
    });
    totalCostUsd = result.cost;
    let jsonText = result.text.trim();
    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonText = fenced[1].trim();
    const braced = jsonText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(braced ? braced[0] : jsonText) as {
      proposals?: Array<{ blockId?: string; proposed?: string; notes?: string[]; skipped?: string }>;
    };
    byId = new Map((parsed.proposals ?? []).filter(p => p.blockId).map(p => [p.blockId!, p]));
  } catch (err) {
    logger.warn('Factum argument proposal failed', { error: err instanceof Error ? err.message : String(err) });
    return {
      proposals: nodes.map(n => ({
        blockId: n.blockId, sectionHeader: n.sectionHeader, issueLabel: n.issueLabel,
        sources: usable.map(f => f.name), current: n.guidance, proposed: null, notes: [],
        skipped: 'The proposals could not be generated. Try again, or edit the section by hand.',
      })),
      totalCostUsd: 0,
    };
  }

  const proposals: FactumArgumentProposal[] = nodes.map(node => {
    const hit = byId.get(node.blockId);
    const proposed = (hit?.proposed ?? '').trim();
    return {
      blockId: node.blockId,
      sectionHeader: node.sectionHeader,
      issueLabel: node.issueLabel,
      sources: usable.map(f => f.name),
      current: node.guidance,
      proposed: proposed || null,
      notes: (hit?.notes ?? []).slice(0, 6),
      skipped: proposed ? undefined : (hit?.skipped ?? 'Your factums did not argue this issue.'),
    };
  });

  return { proposals, totalCostUsd };
}
