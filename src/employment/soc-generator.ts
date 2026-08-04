/**
 * Statement of Claim Generator — Drafts full SOC for Ontario employment law matters.
 *
 * Supports three procedure types:
 *   - Small Claims Court (Form 7A) — claims ≤ $50,000
 *   - Simplified Procedure (Rule 76, Form 14A) — claims $50,001–$200,000
 *   - Ordinary Procedure (Form 14A) — claims > $200,000
 *
 * Each procedure type has different formatting, language, and procedural
 * requirements. The generator adapts the output accordingly.
 *
 * Uses crossProviderChat (inherits anonymisation + provider routing).
 */

import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { enforceHouseStyle } from '../utils/house-style.js';
import { createLogger } from '../utils/logger.js';
import type { EmploymentIntakeData, IntakeAnalysisResult, SourceCitation } from '../types/employment-intake.js';
import { PROCEDURE_TYPES } from '../types/employment-intake.js';
import { computeBardalFactors, computeLimitationDeadline } from './timeline-generator.js';
import { extractCitations } from './citation-extractor.js';
import { checkCitationIntegrity, checkFillInPlaceholders } from './citation-canon.js';
import { checkCanonTextIntegrity } from './canon-verifier.js';

const logger = createLogger('SOC-GEN');

// ── Types ────────────────────────────────────────────────────────────────

export type ProcedureType = typeof PROCEDURE_TYPES[number];

export interface SOCRequest {
  /** The firm's style context from a style profile, folded into the prompt. */
  styleContext?: string;
  /** Firm depth from the style profile; scales the output budget. */
  styleTypicalWords?: number;
  intake: EmploymentIntakeData;
  approvedIssues: string[];
  analysis: IntakeAnalysisResult;
  procedureType: ProcedureType;
  /** Total damages claimed. */
  claimAmount: number;
  /** Lawyer and firm details. */
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  /** Court location (e.g. "Toronto", "Ottawa", "Hamilton"). */
  courtLocation: string;
  /** Uploaded source documents for citation tracking. */
  sourceDocuments?: Array<{ name: string; content: string }>;
}

export interface SOCResult {
  /** The generated SOC in HTML format. */
  html: string;
  /** Procedure type used. */
  procedureType: ProcedureType;
  /** Sections that require lawyer review. */
  lawyerReviewFlags: string[];
  /** Source citations — which document text each section relies on. */
  citations: SourceCitation[];
  /** Cost of generation in USD. */
  costUsd: number;
}

// ── Prompt builders ──────────────────────────────────────────────────────

function buildSystemPrompt(procedureType: ProcedureType): string {
  const procedureInstructions: Record<ProcedureType, string> = {
    small_claims: `You are drafting a Plaintiff's Claim (Form 7A) for the Small Claims Court of Ontario.

PROCEDURE-SPECIFIC RULES:
- Maximum claim: $50,000 (exclusive of interest and costs)
- Language should be clear and accessible (the Small Claims Court is designed to be accessible to self-represented parties, although counsel also appear there)
- No discovery, no jury
- Numbered paragraphs for facts
- Simpler structure than Superior Court
- Use "Plaintiff's Claim" as the document title
- Court: Small Claims Court, [location] Region`,

    simplified: `You are drafting a Statement of Claim (Form 14A) under the Simplified Procedure (Rule 76) of the Ontario Rules of Civil Procedure.

PROCEDURE-SPECIFIC RULES:
- Claims between $50,001 and $200,000
- Must include a Rule 76 compliance statement
- Affidavit of documents due within 10 days of close of pleadings
- No examinations for discovery without leave of the court
- Jury notice may be filed
- Numbered paragraphs for facts
- Use "Statement of Claim" as the document title
- Court: Ontario Superior Court of Justice, [location]`,

    ordinary: `You are drafting a Statement of Claim (Form 14A) under the ordinary procedure of the Ontario Rules of Civil Procedure.

PROCEDURE-SPECIFIC RULES:
- Claims exceeding $200,000
- Full discovery rights (documentary + oral examinations)
- Jury notice may be filed
- Standard 5-year timeline to trial
- Numbered paragraphs for facts
- Use "Statement of Claim" as the document title
- Court: Ontario Superior Court of Justice, [location]`,
  };

  return `You are a senior Ontario litigation lawyer drafting court documents for filing.

${procedureInstructions[procedureType]}

CRITICAL RULES:
1. Every factual allegation must come from the intake data; never fabricate facts.
2. Use only real, well-known Ontario/SCC case citations. If unsure about a citation, omit it.
3. Canadian English spelling throughout (honour, labour, behaviour, etc.).
4. Reference specific statute sections by number (ESA s. 57, Human Rights Code s. 5, etc.).
5. All monetary amounts in Canadian dollars.
6. Number every paragraph of the facts section sequentially (1, 2, 3...).
7. Plead material facts, not evidence. State WHAT happened, not HOW you will prove it.
8. The prayer for relief should be specific and itemised.
9. Write in the professional register of Ontario legal practice. Do not use em dashes anywhere in the document; use commas, colons, semicolons, or parentheses instead.

OUTPUT FORMAT:
Produce the document in HTML format. Use semantic HTML:
- <h1> for the document title
- <h2> for major sections (CLAIM, FACTS, etc.)
- <p> for paragraphs (use class="numbered" for numbered paragraphs)
- <ol> and <li> for numbered lists (prayer for relief, damages particulars)
- <strong> for emphasis and defined terms
- <hr> for section dividers
- No inline styles; clean semantic HTML only.`;
}

function buildUserPrompt(req: SOCRequest): string {
  const intake = req.intake;
  const bardal = computeBardalFactors(intake);
  const limitation = computeLimitationDeadline(intake.termination_date);

  const startDate = intake.hire_date ?? intake.first_day_of_work ?? 'unknown';
  const endDate = intake.termination_date ?? 'unknown';

  let tenurePhrase = '';
  if (bardal.tenureYears) {
    const y = Math.floor(bardal.tenureYears);
    const m = Math.round((bardal.tenureYears - y) * 12);
    tenurePhrase = m > 0 ? `${y} years and ${m} months` : `${y} years`;
  }

  // Build compensation description
  const compParts: string[] = [];
  if (intake.annual_salary) compParts.push(`base salary of $${intake.annual_salary.toLocaleString('en-CA')} per annum`);
  if (intake.has_bonus && intake.bonus_amount) compParts.push(`annual bonus of $${intake.bonus_amount.toLocaleString('en-CA')}`);
  if (intake.has_commissions && intake.commission_amount) compParts.push(`commissions of approximately $${intake.commission_amount.toLocaleString('en-CA')} per annum`);
  if (intake.has_equity) compParts.push('equity compensation');
  if (intake.has_pension) compParts.push('pension/RRSP matching');
  if (intake.has_health_benefits) compParts.push('extended health and dental benefits');

  // Build issue descriptions for the legal basis section
  const issueDescriptions = req.approvedIssues.map(code => {
    const map: Record<string, string> = {
      wrongful_dismissal: 'Wrongful dismissal: the Plaintiff is entitled to common law reasonable notice based on the Bardal factors',
      termination_clause_invalidity: 'The termination clause in the employment agreement is invalid and unenforceable',
      waksdale_at_any_time: 'The termination clause contains language that violates the ESA (Waksdale v Swegon North America Inc, 2020 ONCA 391)',
      machtinger_below_esa: 'The termination clause provides less than ESA minimums (Machtinger v HOJ Industries Ltd, [1992] 1 SCR 986)',
      no_fresh_consideration: 'The termination clause was introduced without fresh consideration after the employment relationship began',
      termination_for_cause: 'The Defendant has failed to establish just cause under the McKinley proportionality standard (McKinley v BC Tel, 2001 SCC 38)',
      constructive_dismissal: 'The Defendant constructively dismissed the Plaintiff (Potter v New Brunswick Legal Aid, 2015 SCC 10)',
      inducement: 'The Plaintiff was induced to leave secure prior employment (Wallace v United Grain Growers Ltd, [1997] 3 SCR 701; Ceccol v Ontario Gymnastics Federation, 2001 CanLII 8589 (ONCA))',
      successor_employer: 'The Plaintiff\'s service with the predecessor employer should be counted for notice purposes',
      esa_severance: 'The Defendant has failed to provide the Plaintiff\'s statutory entitlements under the Employment Standards Act, 2000',
      human_rights_overlay: 'The Defendant discriminated against the Plaintiff contrary to the Human Rights Code, RSO 1990, c H.19',
      disability_accommodation: 'The Defendant failed to accommodate the Plaintiff\'s disability to the point of undue hardship',
      workplace_harassment: 'The Plaintiff was subjected to workplace harassment',
      bad_faith_dismissal: 'The Defendant acted in bad faith in the manner of dismissal (Honda Canada Inc v Keays, 2008 SCC 39)',
      roe_bad_faith: 'The Defendant issued an inaccurate Record of Employment',
      punitive_damages: 'The Defendant\'s conduct warrants an award of punitive damages (Whiten v Pilot Insurance Co, 2002 SCC 18)',
      matthews_bonus_rsu: 'The Plaintiff is entitled to bonus, commission, and/or equity compensation through the reasonable notice period (Matthews v Ocean Nutrition Canada Ltd, 2020 SCC 26)',
      non_compete_void: 'The non-competition clause is void and unenforceable (ESA, s. 67.2)',
      non_solicitation_unenforceable: 'The non-solicitation clause is unreasonable and unenforceable (Shafron v KRG Insurance Brokers, 2009 SCC 6)',
      ohsa_reprisal: 'The Defendant engaged in reprisal contrary to the Occupational Health and Safety Act, s. 50',
      esa_reprisal: 'The Defendant engaged in reprisal contrary to the Employment Standards Act, 2000, s. 74',
    };
    return map[code] ?? code;
  });

  // Damages breakdown
  const damages = req.analysis.damagesEstimate;

  // Termination clause details
  let clauseSection = '';
  if (intake.termination_clause_text) {
    clauseSection = `\nTERMINATION CLAUSE (verbatim from the employment agreement):\n"${intake.termination_clause_text}"`;
  }

  // Constructive dismissal details
  let cdSection = '';
  if (req.approvedIssues.includes('constructive_dismissal')) {
    const grounds = intake.constructive_dismissal_grounds ?? [];
    cdSection = `\nCONSTRUCTIVE DISMISSAL GROUNDS: ${grounds.join(', ')}\n${intake.constructive_dismissal_details ?? ''}`;
  }

  // Human rights details
  let hrSection = '';
  if (req.approvedIssues.some(i => ['human_rights_overlay', 'disability_accommodation', 'workplace_harassment'].includes(i))) {
    const grounds = intake.discrimination_grounds ?? [];
    hrSection = `\nHUMAN RIGHTS GROUNDS: ${grounds.join(', ')}\n${intake.discrimination_details ?? ''}\n${intake.accommodation_details ?? ''}\n${intake.harassment_details ?? ''}`;
  }

  const courtName = req.procedureType === 'small_claims'
    ? `Small Claims Court, ${req.courtLocation} Region`
    : `Ontario Superior Court of Justice, ${req.courtLocation}`;

  return `Draft a complete ${req.procedureType === 'small_claims' ? "Plaintiff's Claim (Form 7A)" : 'Statement of Claim (Form 14A)'} for this employment case.

COURT: ${courtName}

PARTIES:
- Plaintiff: ${intake.client_first_name ?? ''} ${intake.client_last_name ?? ''} (the terminated employee)
- Defendant: ${intake.employer_legal_name ?? intake.employer_operating_name ?? 'unknown'} (the employer)

CASE FACTS:
- Employment period: ${startDate} to ${endDate} (${tenurePhrase || 'unknown'})
- Job title: ${intake.job_title ?? 'unknown'}
- Age at termination: ${bardal.age ?? 'unknown'}
- Compensation: ${compParts.join('; ') || 'not specified'}
- Termination: ${intake.was_terminated ? 'Terminated' : intake.is_constructive_dismissal ? 'Constructively dismissed' : 'Unknown'}
${intake.termination_reasons ? `- Stated reason: ${intake.termination_reasons}` : ''}
${intake.employer_alleged_just_cause ? '- Employer alleged just cause' : ''}
${clauseSection}${cdSection}${hrSection}

LEGAL CLAIMS (include ALL):
${issueDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

DAMAGES:
- ESA notice: ${damages.esaNoticeWeeks} weeks ($${damages.esaNoticePay.toLocaleString('en-CA')})
- ESA severance: $${damages.esaSeverancePay.toLocaleString('en-CA')}
- Common law notice: ${damages.commonLawLowMonths}–${damages.commonLawHighMonths} months ($${damages.commonLawLowAmount.toLocaleString('en-CA')}–$${damages.commonLawHighAmount.toLocaleString('en-CA')})
- Total claimed: $${req.claimAmount.toLocaleString('en-CA')} CAD

${req.procedureType === 'small_claims' ? `NOTE: The Small Claims Court monetary limit is $50,000. If the claim exceeds this amount, the Plaintiff abandons the excess pursuant to the Courts of Justice Act, s. 23.` : ''}
${req.procedureType === 'simplified' ? `NOTE: Include Rule 76 compliance statement. This proceeding is brought under the Simplified Procedure (Rule 76).` : ''}

FILING DETAILS:
- Lawyer: ${req.lawyerName}, ${req.firmName}
${req.firmAddress ? `- Firm address: ${req.firmAddress}` : ''}
${limitation ? `- Limitation: ${limitation.date} (${limitation.daysRemaining} days remaining)` : ''}

DOCUMENT STRUCTURE. Emit each numbered section below as an <h2> heading
using the EXACT wording given, so that the pleading can be placed into a
firm's own template section by section. Do not rename, merge, or omit a
heading.
1. <h2>Title of Proceedings</h2> (court name, file number placeholder, parties)
2. <h2>Claim</h2>: "The Plaintiff claims:" followed by itemised relief sought
3. <h2>Facts</h2>: Numbered paragraphs setting out the material facts in chronological order
4. <h2>Legal Basis</h2>: Statutory and common law grounds for each claim
5. <h2>Damages Particulars</h2>: Itemised breakdown with amounts
6. ${req.procedureType === 'simplified' ? 'RULE 76 COMPLIANCE STATEMENT' : 'DATE AND PLACE OF ISSUE'}
7. Lawyer/firm information and service address

Draft the complete document now.`;
}

// ── Main generation function ─────────────────────────────────────────────

/**
 * Generate a Statement of Claim from intake data and approved issues.
 */
export async function generateStatementOfClaim(
  req: SOCRequest,
  definedTerms?: string[],
): Promise<SOCResult> {
  const systemPrompt = buildSystemPrompt(req.procedureType);
  const userPrompt = req.styleContext ? `${buildUserPrompt(req)}\n\n${req.styleContext}` : buildUserPrompt(req);

  logger.info('Generating SOC', {
    procedureType: req.procedureType,
    approvedIssues: req.approvedIssues.length,
    claimAmount: req.claimAmount,
  });

  let text: string;
  let cost: number;
  try {
    const result = await crossProviderChat({
      system: systemPrompt,
      user: userPrompt,
      tier: 'opus',
      maxTokens: req.styleTypicalWords ? Math.min(30_000, Math.max(12288, Math.ceil(req.styleTypicalWords * 3))) : 12288,
    extendOnTruncation: true,
      maxRetries: 2,
      definedTerms: definedTerms ?? undefined,
    });
    text = result.text;
    cost = result.cost;
  } catch (err) {
    logger.error('SOC generation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Document generation failed. Please try again.');
  }

  let html = enforceHouseStyle(text.trim());
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();

  // Review flags — all SOC sections need lawyer review; plus citation
  // integrity (unknown case names / mismatched citations)
  const lawyerReviewFlags = [
    'facts_section',
    'legal_basis',
    'damages_particulars',
    'prayer_for_relief',
    ...checkCitationIntegrity(html, definedTerms ?? []),
    ...checkCanonTextIntegrity(html),
    ...checkFillInPlaceholders(html),
  ];

  // Extract source citations if uploaded documents available
  let citations: SourceCitation[] = [];
  let totalCost = cost;
  if (req.sourceDocuments && req.sourceDocuments.length > 0) {
    try {
      const citationResult = await extractCitations(html, req.sourceDocuments, definedTerms);
      citations = citationResult.citations;
      totalCost += citationResult.costUsd;
    } catch (err) {
      logger.warn('SOC citation extraction failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('SOC generated', {
    procedureType: req.procedureType,
    htmlLength: html.length,
    citations: citations.length,
    costUsd: totalCost.toFixed(4),
  });

  return {
    html,
    procedureType: req.procedureType,
    lawyerReviewFlags,
    citations,
    costUsd: totalCost,
  };
}

/**
 * Get the form name for a procedure type.
 */
export function getFormName(procedureType: ProcedureType): string {
  switch (procedureType) {
    case 'small_claims': return "Plaintiff's Claim (Form 7A)";
    case 'simplified': return 'Statement of Claim (Form 14A, Simplified Procedure, Rule 76)';
    case 'ordinary': return 'Statement of Claim (Form 14A)';
  }
}

/**
 * Get the court name for a procedure type and location.
 */
export function getCourtName(procedureType: ProcedureType, location: string): string {
  if (procedureType === 'small_claims') {
    return `Small Claims Court, ${location} Region`;
  }
  return `Ontario Superior Court of Justice, ${location}`;
}
