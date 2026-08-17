/**
 * Mediation section generator — drafts one section of the mediation brief's
 * narrative. Mirrors the factum section generator: a focused per-section call
 * against the matter facts (and, where they matter, the negotiation state and
 * the matter's positions). Returns bare <p> paragraphs with no heading and no
 * numbers, so the sections assemble cleanly and numbering is applied once at
 * assembly.
 */

import { enforceHouseStyle } from '../utils/house-style.js';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import { pronounInstruction } from './house-form.js';
import { computeBardalFactors } from './timeline-generator.js';
import { checkCitationIntegrity, checkFillInPlaceholders } from './citation-canon.js';
import { checkCanonTextIntegrity } from './canon-verifier.js';
import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';

const logger = createLogger('MEDIATION-SECTION');

export interface MediationSectionRequest {
  header: string;
  guidance: string;
  intake: EmploymentIntakeData;
  analysis: IntakeAnalysisResult;
  approvedIssues: string[];
  claimAmount?: number;
  /** The state of play from the negotiation ledger; the settlement position
   *  must account for it. */
  negotiationStateText?: string;
  /** The matter's positions (demand letter, statement of claim) as text, so
   *  the brief tells the same story. */
  positionsText?: string;
}

export interface MediationSectionResult {
  html: string;
  reviewFlags: string[];
  costUsd: number;
  truncated: boolean;
}

function matterFactsBlock(req: MediationSectionRequest): string {
  const intake = req.intake;
  const bardal = computeBardalFactors(intake);
  const damages = req.analysis.damagesEstimate;
  const comp: string[] = [];
  if (intake.annual_salary) comp.push(`$${intake.annual_salary.toLocaleString('en-CA')}/year`);
  if (intake.has_bonus && intake.bonus_amount) comp.push(`bonus: $${intake.bonus_amount.toLocaleString('en-CA')}`);
  if (intake.has_commissions && intake.commission_amount) comp.push(`commissions: $${intake.commission_amount.toLocaleString('en-CA')}`);

  return `THIS MATTER:

PARTIES:
- Plaintiff: ${intake.client_first_name ?? ''} ${intake.client_last_name ?? ''}
- Defendant: ${intake.employer_legal_name ?? intake.employer_operating_name ?? 'unknown'}

EMPLOYMENT:
- Period: ${intake.hire_date ?? intake.first_day_of_work ?? 'unknown'} to ${intake.termination_date ?? 'unknown'}
- Title: ${intake.job_title ?? 'unknown'}
- Age: ${bardal.age ?? 'unknown'}
- Compensation: ${comp.join('; ') || 'not specified'}

TERMINATION:
- Type: ${intake.was_terminated ? 'Terminated' : intake.is_constructive_dismissal ? 'Constructive dismissal' : 'Unknown'}
${intake.termination_reasons ? `- Reason: ${intake.termination_reasons}` : ''}
${intake.employer_alleged_just_cause ? '- Just cause alleged' : ''}

APPROVED LEGAL ISSUES:
${req.approvedIssues.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(none approved yet)'}

DAMAGES:
- ESA: ${damages.esaNoticeWeeks} weeks notice ($${damages.esaNoticePay.toLocaleString('en-CA')}) + $${damages.esaSeverancePay.toLocaleString('en-CA')} severance
- Common law: ${damages.commonLawLowMonths}-${damages.commonLawHighMonths} months ($${damages.commonLawLowAmount.toLocaleString('en-CA')}-$${damages.commonLawHighAmount.toLocaleString('en-CA')})
${req.claimAmount ? `- Realistic settlement figure the lawyer is seeking: $${req.claimAmount.toLocaleString('en-CA')}` : ''}`;
}

const SYSTEM = `You are a senior Ontario employment lawyer drafting ONE section of a plaintiff's mediation brief for mandatory mediation under Rule 24.1. The true audience is the opposing party and its counsel; the mediator is being educated.

WHAT IS ALREADY IN THE DOCUMENT: deterministic tables (the plaintiff profile, the damages, the comparable cases, the negotiation history), a cover page, and a sign-off. Do NOT reproduce any table or its numbers in detail, do NOT write a cover or a sign-off, and do NOT write an h1 title. The comparable-case table carries the notice-range argument, so do not recite Bardal or settled principles every employment lawyer knows.

OUTPUT RULES (identical for every section, so the sections assemble cleanly):
- Output ONLY <p> paragraphs, with <strong> only where a defined term needs it. No heading, no h1, no h2, no list, no table.
- Do NOT write the section heading; it is added at assembly. Do NOT number the paragraphs; numbering is applied across the whole brief at assembly. One point per paragraph, two to four sentences.
- CONCISE. Every sentence earns its place; mediators stop absorbing long briefs.
- Candid about weaknesses; measured register. Do not fabricate facts, offers, or mitigation details. Where something material is unknown, note it for counsel in square brackets [LAWYER: ...].
- Canadian English spelling. Do not use em dashes; use commas, colons, semicolons, or parentheses.`;

export async function generateMediationSection(
  req: MediationSectionRequest,
  definedTerms?: string[],
): Promise<MediationSectionResult> {
  const parts = [
    matterFactsBlock(req),
    req.negotiationStateText ? `NEGOTIATION STATE (the settlement position MUST account for this; never propose a range at or beneath the employer's standing offer):\n${req.negotiationStateText}` : undefined,
    req.positionsText ? `THE MATTER'S POSITIONS (the brief must tell the same story and take the same positions):\n${req.positionsText.slice(0, 12_000)}` : undefined,
    `REFERRING TO THE CLIENT: ${pronounInstruction(req.intake.client_pronouns)}`,
    `Write ONLY the section titled "${req.header}". ${req.guidance}`,
    'Draft the section now, following the output rules exactly.',
  ].filter(Boolean);

  logger.info('Drafting mediation section', { header: req.header });

  let text: string;
  let cost: number;
  let truncated = false;
  try {
    const result = await crossProviderChat({
      system: SYSTEM,
      user: parts.join('\n\n'),
      tier: 'opus',
      maxTokens: 4_000,
      maxRetries: 2,
      timeoutMs: 240_000,
      definedTerms: definedTerms ?? undefined,
      extendOnTruncation: true,
    });
    text = result.text;
    cost = result.cost;
    truncated = Boolean(result.truncated);
  } catch (err) {
    logger.error('Mediation section generation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('This section could not be drafted. Please try again.');
  }

  let html = enforceHouseStyle(text.trim());
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();
  html = html.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, '').trim();

  const reviewFlags = [
    ...(truncated ? ['This section hit the output limit and may end abruptly. Regenerate it before relying on it.'] : []),
    ...checkCitationIntegrity(html, definedTerms ?? []),
    ...checkCanonTextIntegrity(html),
    ...checkFillInPlaceholders(html),
  ];
  return { html, reviewFlags, costUsd: cost, truncated };
}

/** Recompute flags for a hand-edited section. */
export function mediationSectionReviewFlags(html: string, definedTerms?: string[]): string[] {
  return [
    ...checkCitationIntegrity(html, definedTerms ?? []),
    ...checkCanonTextIntegrity(html),
    ...checkFillInPlaceholders(html),
  ];
}
