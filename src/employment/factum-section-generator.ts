/**
 * Factum section generator — drafts one section of a summary-judgment factum.
 *
 * The whole-factum generator (litigation-documents.ts, sj_factum) writes the
 * document in a single call. This drafts ONE section at a time, so the lawyer
 * controls each: draft it, read it, adjust its guidance, regenerate it, approve
 * it. Each section returns only its <p> paragraphs, without a heading and
 * without paragraph numbers; the heading and consecutive numbering are applied
 * deterministically at assembly (factum-assemble.ts).
 *
 * Structural sections (Overview, Facts, Order) draft from the matter facts.
 * Argument sections (Part III) draft from the firm's settled argument for the
 * issue plus the matter facts, citing only the section's listed authorities.
 */

import { enforceHouseStyle } from '../utils/house-style.js';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import { pronounInstruction } from './house-form.js';
import { computeBardalFactors } from './timeline-generator.js';
import { checkCitationIntegrity, checkFillInPlaceholders } from './citation-canon.js';
import { checkCanonTextIntegrity } from './canon-verifier.js';
import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';
import type { FactumSectionKind } from './factum-outline.js';

const logger = createLogger('FACTUM-SECTION');

export interface FactumSectionRequest {
  kind: FactumSectionKind;
  /** The section heading (an argument section's, or the structural header). */
  sectionHeader: string;
  /** Argument sections: the firm's settled argument for this issue. */
  guidance?: string;
  /** Argument sections: the authorities to cite (semicolon separated). */
  authorities?: string;
  intake: EmploymentIntakeData;
  analysis: IntakeAnalysisResult;
  approvedIssues: string[];
  claimAmount?: number;
  lawyerName?: string;
  firmName?: string;
}

export interface FactumSectionResult {
  html: string;
  reviewFlags: string[];
  costUsd: number;
  truncated: boolean;
}

// ── Shared matter facts ────────────────────────────────────────────────────

/** The compact factual context every section is drafted against. Mirrors the
 *  whole-factum prompt so a section agrees with the assembled document. */
function matterFactsBlock(req: FactumSectionRequest): string {
  const intake = req.intake;
  const bardal = computeBardalFactors(intake);
  const damages = req.analysis.damagesEstimate;

  const startDate = intake.hire_date ?? intake.first_day_of_work ?? 'unknown';
  const endDate = intake.termination_date ?? 'unknown';

  const compParts: string[] = [];
  if (intake.annual_salary) compParts.push(`$${intake.annual_salary.toLocaleString('en-CA')}/year`);
  if (intake.has_bonus && intake.bonus_amount) compParts.push(`bonus: $${intake.bonus_amount.toLocaleString('en-CA')}`);
  if (intake.has_commissions && intake.commission_amount) compParts.push(`commissions: $${intake.commission_amount.toLocaleString('en-CA')}`);

  return `THIS MATTER:

PARTIES:
- Plaintiff: ${intake.client_first_name ?? ''} ${intake.client_last_name ?? ''}
- Defendant: ${intake.employer_legal_name ?? intake.employer_operating_name ?? 'unknown'}

EMPLOYMENT:
- Period: ${startDate} to ${endDate}
- Title: ${intake.job_title ?? 'unknown'}
- Age: ${bardal.age ?? 'unknown'}
- Compensation: ${compParts.join('; ') || 'not specified'}

TERMINATION:
- Type: ${intake.was_terminated ? 'Terminated' : intake.is_constructive_dismissal ? 'Constructive dismissal' : 'Unknown'}
${intake.termination_reasons ? `- Reason: ${intake.termination_reasons}` : ''}
${intake.employer_alleged_just_cause ? '- Just cause alleged' : ''}

APPROVED LEGAL ISSUES:
${req.approvedIssues.map((code, i) => `${i + 1}. ${code}`).join('\n') || '(none approved yet)'}

DAMAGES:
- ESA: ${damages.esaNoticeWeeks} weeks notice ($${damages.esaNoticePay.toLocaleString('en-CA')}) + $${damages.esaSeverancePay.toLocaleString('en-CA')} severance
- Common law: ${damages.commonLawLowMonths}-${damages.commonLawHighMonths} months ($${damages.commonLawLowAmount.toLocaleString('en-CA')}-$${damages.commonLawHighAmount.toLocaleString('en-CA')})
${req.claimAmount ? `- Total claimed: $${req.claimAmount.toLocaleString('en-CA')}` : ''}`;
}

// ── Section prompts ─────────────────────────────────────────────────────────

const COMMON_RULES = `
OUTPUT RULES (identical for every section, so the sections assemble cleanly):
- Output ONLY <p> paragraphs, with <strong> where a defined term genuinely needs it. No heading, no <h1>, no <h2>, no list, no table.
- Do NOT write the section heading or the Part label; they are added at assembly.
- Do NOT number the paragraphs; consecutive numbering is applied across the whole factum at assembly. One point per paragraph, two to four sentences.
- Every factual claim must come from the matter facts above. Never fabricate facts. Where an evidentiary reference is needed, use an [Affidavit, para X] placeholder for counsel to complete.
- Canadian English spelling throughout. Do not use em dashes anywhere; use commas, colons, semicolons, or parentheses instead.`;

function systemPromptFor(req: FactumSectionRequest): string {
  const role = 'You are a senior Ontario employment litigation lawyer drafting one section of the PLAINTIFF\'S FACTUM for a motion for summary judgment under Rule 20 in a wrongful dismissal action.';

  if (req.kind === 'overview') {
    return `${role}

Draft PART I: OVERVIEW. Two or three paragraphs stating what the motion seeks and why there is no genuine issue requiring a trial (Rule 20.04; Hryniak v Mauldin, 2014 SCC 7 for the culture shift, cited sparingly). This is the opening the motion judge reads first: it frames the case and the relief. State the theory of the case plainly; do not argue the issues in detail here (Part III does that).
${COMMON_RULES}`;
  }

  if (req.kind === 'facts') {
    return `${role}

Draft PART II: THE FACTS. A concise, chronological statement of the material facts: the employment, the compensation, the dismissal, and the post-termination events that matter to the motion. State facts, not argument, and not legal conclusions. Include only facts that bear on the relief. Use [Affidavit, para X] placeholders where a fact needs an evidentiary reference, so counsel can complete them against the sworn record.
${COMMON_RULES}`;
  }

  if (req.kind === 'order') {
    return `${role}

Draft PART IV: THE ORDER REQUESTED. State the relief the plaintiff seeks on this motion, one item per paragraph: summary judgment for damages for wrongful dismissal in the amount claimed; any Human Rights Code or moral damages the approved issues support; prejudgment and postjudgment interest under the Courts of Justice Act; and costs. Claim only relief the approved issues above support. Do not argue; state the order sought.
${COMMON_RULES}`;
  }

  // argument
  const cites = req.authorities?.trim()
    ? `Cite ONLY these authorities, and no others: ${req.authorities.trim()}. Do not add authorities beyond this list.`
    : 'Cite only authorities the approved issues and facts clearly raise. Never invent a citation.';
  return `${role}

Draft this PART III (Issues and the Law) argument section, headed "${req.sectionHeader}". Argue it in the firm's settled way, applying the matter facts above to the firm's argument. The firm's settled argument for this issue:

${(req.guidance ?? '').trim() || '(no firm guidance recorded; argue this issue in the standard Ontario way for a plaintiff on this motion.)'}

${cites}
${COMMON_RULES}`;
}

function sectionUserPrompt(req: FactumSectionRequest): string {
  const facts = matterFactsBlock(req);
  return `${facts}

REFERRING TO THE CLIENT: ${pronounInstruction(req.intake.client_pronouns)}

Draft the section now, following the output rules exactly.`;
}

// ── Generation ──────────────────────────────────────────────────────────────

export async function generateFactumSection(
  req: FactumSectionRequest,
  definedTerms?: string[],
): Promise<FactumSectionResult> {
  const system = systemPromptFor(req);
  const user = sectionUserPrompt(req);

  logger.info('Drafting factum section', { kind: req.kind, header: req.sectionHeader });

  let text: string;
  let cost: number;
  let truncated = false;
  try {
    const result = await crossProviderChat({
      system,
      user,
      tier: 'opus',
      // Sections are short: a Part III argument runs a few hundred words. A
      // generous ceiling covers a dense facts section without ever needing the
      // whole-document budget.
      maxTokens: 6_000,
      maxRetries: 2,
      timeoutMs: 240_000,
      definedTerms: definedTerms ?? undefined,
      extendOnTruncation: true,
    });
    text = result.text;
    cost = result.cost;
    truncated = Boolean(result.truncated);
  } catch (err) {
    logger.error('Factum section generation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('This section could not be drafted. Please try again.');
  }

  let html = enforceHouseStyle(text.trim());
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();
  // Sections must not carry their own heading or numbers; strip any the model
  // emitted despite the instruction, so assembly stays deterministic.
  html = html.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, '').trim();

  const reviewFlags = [
    ...(truncated ? ['This section hit the output limit and may end abruptly. Regenerate it before relying on it.'] : []),
    ...checkCitationIntegrity(html, definedTerms ?? []),
    ...checkCanonTextIntegrity(html),
    ...checkFillInPlaceholders(html),
  ];

  logger.info('Factum section drafted', { kind: req.kind, htmlLength: html.length, costUsd: cost.toFixed(4) });
  return { html, reviewFlags, costUsd: cost, truncated };
}
