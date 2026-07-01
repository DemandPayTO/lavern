/**
 * Demand Letter Generator — Assembles employment law demand letters for Starling.
 *
 * Takes structured intake data, approved legal issues, tone selection, and
 * produces a complete demand letter via Claude. The prompt encodes the same
 * Ontario employment law framework as DemandPay's language node system
 * (Bardal, Waksdale, Honda, McKinley, ESA, etc.) but produces fluid prose
 * tailored to the specific case facts.
 *
 * The lawyer reviews and edits the draft before finalising.
 *
 * Uses crossProviderChat (inherits anonymisation + provider routing).
 */

import { z } from 'zod';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import type { EmploymentIntakeData, GateResult, IntakeAnalysisResult, SourceCitation } from '../types/employment-intake.js';
import { TONE_OPTIONS } from '../types/employment-intake.js';
import { computeBardalFactors, computeLimitationDeadline } from './timeline-generator.js';
import { extractCitations } from './citation-extractor.js';

const logger = createLogger('DEMAND-LETTER');

// ── Types ────────────────────────────────────────────────────────────────

export type DemandLetterTone = typeof TONE_OPTIONS[number];

export interface DemandLetterRequest {
  intake: EmploymentIntakeData;
  gates: GateResult[];
  approvedIssues: string[];
  analysis: IntakeAnalysisResult;
  tone: DemandLetterTone;
  demandAmount: number;
  /** Lawyer name and firm details for the closing. */
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  /** Response deadline in days from the date of the letter. */
  responseDeadlineDays: number;
  /** Uploaded source documents (content + name) for citation tracking. */
  sourceDocuments?: Array<{ name: string; content: string }>;
}

export interface DemandLetterResult {
  /** The generated letter in HTML format. */
  html: string;
  /** Sections that require lawyer review before sending. */
  lawyerReviewFlags: string[];
  /** Source citations — which document text each section relies on. */
  citations: SourceCitation[];
  /** Cost of generation in USD. */
  costUsd: number;
}

// ── Prompt builders ──────────────────────────────────────────────────────

function buildSystemPrompt(tone: DemandLetterTone): string {
  const toneInstructions: Record<DemandLetterTone, string> = {
    professional: `Tone: Professional and measured. State entitlements clearly and firmly but without hostility. This is a business communication from one professional to another. Use phrases like "our client is entitled to", "we trust this can be resolved amicably", "we look forward to your prompt response."`,
    firm: `Tone: Firm and assertive. Make clear the strength of the client's position and the weakness of the employer's. Use phrases like "your client's conduct falls well short of", "the law is clear on this point", "our client will not hesitate to pursue all available remedies." Do not be hostile, but leave no ambiguity about the consequences of non-compliance.`,
    aggressive: `Tone: Strong and aggressive. Emphasise every vulnerability in the employer's position. Use phrases like "your client's egregious conduct", "flagrant disregard for statutory obligations", "we are prepared to commence proceedings immediately." This letter should convey that litigation is the next step if a satisfactory resolution is not reached promptly.`,
  };

  return `You are a senior Ontario employment lawyer drafting a demand letter on behalf of a terminated employee. You are writing to the employer's counsel (or directly to the employer if no counsel is known).

${toneInstructions[tone]}

CRITICAL RULES:
1. Every factual claim must come from the intake data provided — never fabricate facts.
2. Case law citations must be accurate and real Ontario/SCC cases. Use only well-known precedents:
   - Bardal v Globe & Mail, [1960] OJ No 149 (reasonable notice factors)
   - Waksdale v Swegon North America Inc, 2020 ONCA 391 (termination clause invalidity)
   - Honda Canada Inc v Keays, 2008 SCC 39 (bad faith damages)
   - McKinley v BC Tel, 2001 SCC 38 (just cause proportionality)
   - Potter v New Brunswick Legal Aid, 2015 SCC 10 (constructive dismissal)
   - Matthews v Ocean Nutrition Canada Ltd, 2020 SCC 26 (bonus through notice)
   - Machtinger v HOJ Industries Ltd, [1992] 1 SCR 986 (below-ESA clauses void)
   - Ceccol v Ontario Gymnastics Federation, 2001 CanLII 8589 (ONCA) (inducement)
   - Wallace v United Grain Growers Ltd, [1997] 3 SCR 701 (inducement factor)
   - Shafron v KRG Insurance Brokers, 2009 SCC 6 (restrictive covenant enforceability)
3. Do NOT invent case citations. If unsure about a citation, omit it rather than guess.
4. Use Canadian English spelling throughout (honour, labour, behaviour, etc.).
5. Reference specific ESA sections by number (e.g. "section 57 of the Employment Standards Act, 2000").
6. All monetary amounts in Canadian dollars.

OUTPUT FORMAT:
Produce the letter in HTML format. Use semantic HTML:
- <h1> for the letter title (not displayed — use as document title)
- <p> for paragraphs
- <strong> for emphasis
- <ol> and <li> for numbered lists (e.g. damages particulars)
- No inline styles, no classes — clean semantic HTML only.

Do NOT include letterhead, date, or address block — those come from the firm's template. Start with the salutation ("Dear [name/counsel]") and end with the signature block.`;
}

function buildUserPrompt(req: DemandLetterRequest): string {
  const intake = req.intake;
  const bardal = computeBardalFactors(intake);
  const limitation = computeLimitationDeadline(intake.termination_date);

  // Build the case facts section
  const startDate = intake.hire_date ?? intake.first_day_of_work ?? 'unknown';
  const endDate = intake.termination_date ?? 'unknown';

  let tenurePhrase = '';
  if (startDate !== 'unknown' && endDate !== 'unknown') {
    const years = bardal.tenureYears ?? 0;
    const y = Math.floor(years);
    const m = Math.round((years - y) * 12);
    tenurePhrase = m > 0 ? `${y} years and ${m} months` : `${y} years`;
  }

  // Build approved issues description
  const issueDescriptions = req.approvedIssues.map(code => {
    const descriptions: Record<string, string> = {
      wrongful_dismissal: 'Wrongful dismissal — common law reasonable notice (Bardal factors)',
      termination_clause_invalidity: 'Termination clause is invalid or unenforceable',
      waksdale_at_any_time: 'Termination clause contains "at any time" language (Waksdale / Dufault risk)',
      machtinger_below_esa: 'Termination clause provides less than ESA minimums (Machtinger)',
      no_fresh_consideration: 'Termination clause added mid-employment without fresh consideration',
      dufault_language: 'Termination clause language fails Dufault analysis',
      termination_for_cause: 'Employer alleged just cause — challenge under McKinley proportionality',
      constructive_dismissal: 'Constructive dismissal (Potter test)',
      inducement: 'Client was induced from secure prior employment (Wallace/Ceccol)',
      successor_employer: 'Successor employer — tenure includes predecessor service',
      esa_severance: 'ESA statutory entitlements (notice pay, severance pay)',
      human_rights_overlay: 'Human rights violation (discrimination, Code-protected grounds)',
      disability_accommodation: 'Failure to accommodate disability (duty to accommodate to point of undue hardship)',
      workplace_harassment: 'Workplace harassment',
      bad_faith_dismissal: 'Bad faith in manner of dismissal (Honda v Keays damages)',
      roe_bad_faith: 'False or misleading Record of Employment',
      matthews_bonus_rsu: 'Bonus/commission/equity recovery through notice period (Matthews)',
      commission_through_notice: 'Commission entitlement through reasonable notice period',
      non_compete_void: 'Non-compete clause void (ESA s. 67.2 or common law unreasonableness)',
      non_solicitation_unenforceable: 'Non-solicitation clause unenforceable (Shafron test)',
      ohsa_reprisal: 'OHSA reprisal (s. 50 reverse onus)',
      fixed_term_contract: 'Fixed-term contract — entitled to balance of term',
      esa_reprisal: 'ESA reprisal (s. 74 reverse onus)',
      punitive_damages: 'Punitive damages',
      age_elongation: 'Age as a Bardal factor extending notice period',
    };
    return descriptions[code] ?? code;
  });

  // Damages breakdown
  const damages = req.analysis.damagesEstimate;

  // Compensation details
  const compParts: string[] = [];
  if (intake.annual_salary) compParts.push(`Base salary: $${intake.annual_salary.toLocaleString('en-CA')}/year`);
  if (intake.has_bonus && intake.bonus_amount) compParts.push(`Bonus: $${intake.bonus_amount.toLocaleString('en-CA')}/year`);
  if (intake.has_commissions && intake.commission_amount) compParts.push(`Commissions: $${intake.commission_amount.toLocaleString('en-CA')}/year`);
  if (intake.has_equity && intake.equity_value) compParts.push(`Equity: $${intake.equity_value.toLocaleString('en-CA')}`);
  if (intake.has_pension) compParts.push('Pension/RRSP matching');
  if (intake.has_health_benefits) compParts.push('Extended health benefits');

  // Termination clause details
  let clauseSection = '';
  if (req.approvedIssues.some(i => i.startsWith('termination_clause') || i.startsWith('waksdale') || i.startsWith('machtinger') || i === 'no_fresh_consideration' || i === 'dufault_language')) {
    clauseSection = `
TERMINATION CLAUSE ANALYSIS:
The employment agreement contains a termination clause. The clause text is:
"${intake.termination_clause_text ?? '[not provided]'}"
${intake.clause_added_mid_employment ? 'This clause was added AFTER the initial hiring — fresh consideration is an issue.' : ''}
${intake.termination_clause_text?.toLowerCase().includes('at any time') ? 'The clause contains "at any time" language — Waksdale / Dufault analysis applies.' : ''}
Argue that this clause is invalid/unenforceable based on the approved issues.`;
  }

  // Constructive dismissal details
  let cdSection = '';
  if (req.approvedIssues.includes('constructive_dismissal')) {
    const grounds = intake.constructive_dismissal_grounds ?? [];
    cdSection = `
CONSTRUCTIVE DISMISSAL:
The client was constructively dismissed. Grounds: ${grounds.join(', ') || 'see details below'}.
${intake.constructive_dismissal_details ?? ''}
Apply the Potter test (two branches: unilateral fundamental breach OR course of conduct).`;
  }

  // Human rights details
  let hrSection = '';
  if (req.approvedIssues.some(i => ['human_rights_overlay', 'disability_accommodation', 'workplace_harassment'].includes(i))) {
    const grounds = intake.discrimination_grounds ?? [];
    hrSection = `
HUMAN RIGHTS:
Protected grounds: ${grounds.join(', ') || 'see details'}.
${intake.discrimination_details ?? ''}
${intake.accommodation_denied ? 'Accommodation was requested and denied.' : ''}
${intake.accommodation_details ?? ''}
${intake.experienced_harassment ? `Harassment details: ${intake.harassment_details ?? 'see details'}` : ''}`;
  }

  // Bad faith details
  let bfSection = '';
  if (req.approvedIssues.some(i => ['bad_faith_dismissal', 'roe_bad_faith', 'punitive_damages'].includes(i))) {
    const conduct = intake.bad_faith_conduct ?? [];
    bfSection = `
BAD FAITH / PUNITIVE:
Conduct: ${conduct.join(', ') || 'see details'}.
${intake.bad_faith_details ?? ''}
${intake.humiliating_termination ? `Humiliating termination: ${intake.humiliating_termination_details ?? 'see details'}` : ''}
${intake.roe_wrong_or_missing ? 'ROE is wrong or missing.' : ''}`;
  }

  // Severance offer (if any)
  let offerSection = '';
  if (intake.received_severance_offer) {
    offerSection = `
EMPLOYER'S SEVERANCE OFFER:
The employer offered ${intake.severance_weeks_offered ?? '?'} weeks of severance.
${intake.severance_offer_details ?? ''}
This offer is inadequate. The letter should explain why.`;
  }

  return `Draft a demand letter for this employment law case.

CASE FACTS:
- Client name: ${intake.client_first_name ?? ''} ${intake.client_last_name ?? ''}
- Age at termination: ${bardal.age ?? 'unknown'}
- Employer: ${intake.employer_legal_name ?? intake.employer_operating_name ?? 'unknown'}
- Job title: ${intake.job_title ?? 'unknown'}
- Employment period: ${startDate} to ${endDate} (${tenurePhrase || 'unknown tenure'})
- Compensation: ${compParts.join('; ') || 'not specified'}
- Termination date: ${intake.termination_date ?? 'unknown'}
- Terminated: ${intake.was_terminated ? 'Yes' : intake.is_constructive_dismissal ? 'Constructive dismissal' : intake.resigned ? 'Resigned' : 'Unknown'}
${intake.termination_reasons ? `- Stated reason: ${intake.termination_reasons}` : ''}
${intake.employer_alleged_just_cause ? '- Employer alleged just cause' : ''}

APPROVED LEGAL ISSUES (include ALL of these in the letter):
${issueDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

DAMAGES ESTIMATE:
- ESA notice pay: ${damages.esaNoticeWeeks} weeks ($${damages.esaNoticePay.toLocaleString('en-CA')})
- ESA severance pay: $${damages.esaSeverancePay.toLocaleString('en-CA')}
- Common law reasonable notice: ${damages.commonLawLowMonths}–${damages.commonLawHighMonths} months ($${damages.commonLawLowAmount.toLocaleString('en-CA')}–$${damages.commonLawHighAmount.toLocaleString('en-CA')})

DEMAND AMOUNT: $${req.demandAmount.toLocaleString('en-CA')} CAD
${clauseSection}${cdSection}${hrSection}${bfSection}${offerSection}

LETTER METADATA:
- Lawyer: ${req.lawyerName}
- Firm: ${req.firmName}
${req.firmAddress ? `- Firm address: ${req.firmAddress}` : ''}
- Response deadline: ${req.responseDeadlineDays} days from the date of the letter
${limitation ? `- Limitation period expires: ${limitation.date} (${limitation.daysRemaining} days remaining${limitation.urgent ? ' — URGENT' : ''})` : ''}

STRUCTURE:
1. Salutation
2. Opening paragraph — identify the firm, the client, and the purpose
3. Employment background — brief chronology
4. Termination facts — what happened
5. Legal analysis — one section per approved issue (cite relevant case law)
6. Damages quantification — itemised list with amounts
7. Demand — state the specific amount and terms
8. Closing — response deadline, consequences of non-response, without-prejudice reservation
9. Signature block — lawyer name and firm

Write the complete letter now.`;
}

// ── Lawyer review flag detection ─────────────────────────────────────────

/** Issues that always require lawyer review before the letter is sent. */
const REVIEW_REQUIRED_ISSUES = new Set([
  'termination_clause_invalidity',
  'waksdale_at_any_time',
  'machtinger_below_esa',
  'no_fresh_consideration',
  'termination_for_cause',
  'constructive_dismissal',
  'human_rights_overlay',
  'disability_accommodation',
  'bad_faith_dismissal',
  'punitive_damages',
  'ohsa_reprisal',
]);

function computeReviewFlags(approvedIssues: string[]): string[] {
  return approvedIssues.filter(i => REVIEW_REQUIRED_ISSUES.has(i));
}

// ── Main generation function ─────────────────────────────────────────────

/**
 * Generate a demand letter from intake data, approved issues, and tone.
 *
 * @param req The demand letter request with all case data.
 * @param definedTerms Optional party names for anonymisation.
 * @returns The generated letter HTML, review flags, and cost.
 */
export async function generateDemandLetter(
  req: DemandLetterRequest,
  definedTerms?: string[],
): Promise<DemandLetterResult> {
  const systemPrompt = buildSystemPrompt(req.tone);
  const userPrompt = buildUserPrompt(req);

  logger.info('Generating demand letter', {
    tone: req.tone,
    approvedIssues: req.approvedIssues.length,
    demandAmount: req.demandAmount,
  });

  const { text, cost } = await crossProviderChat({
    system: systemPrompt,
    user: userPrompt,
    tier: 'opus',    // Use strongest model for legal drafting
    maxTokens: 8192,
    maxRetries: 2,
    definedTerms: definedTerms ?? undefined,
  });

  // Extract HTML — Claude may wrap in markdown fences
  let html = text.trim();
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();

  // Compute review flags
  const lawyerReviewFlags = computeReviewFlags(req.approvedIssues);

  // Extract source citations if uploaded documents are available
  let citations: SourceCitation[] = [];
  let totalCost = cost;
  if (req.sourceDocuments && req.sourceDocuments.length > 0) {
    try {
      const citationResult = await extractCitations(
        html,
        req.sourceDocuments,
        definedTerms,
      );
      citations = citationResult.citations;
      totalCost += citationResult.costUsd;
    } catch (err) {
      // Citation extraction is non-fatal — the letter is still usable without citations
      logger.warn('Citation extraction failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Demand letter generated', {
    htmlLength: html.length,
    reviewFlags: lawyerReviewFlags.length,
    citations: citations.length,
    costUsd: totalCost.toFixed(4),
  });

  return {
    html,
    lawyerReviewFlags,
    citations,
    costUsd: totalCost,
  };
}

/**
 * Build the prompt sections list for testing/validation.
 * Returns which sections the letter should contain based on approved issues.
 */
export function getExpectedSections(approvedIssues: string[]): string[] {
  const sections: string[] = [
    'salutation',
    'employment_background',
    'termination_facts',
  ];

  // Map issues to sections
  const issueToSection: Record<string, string> = {
    wrongful_dismissal: 'reasonable_notice_analysis',
    termination_clause_invalidity: 'termination_clause_analysis',
    waksdale_at_any_time: 'termination_clause_analysis',
    machtinger_below_esa: 'termination_clause_analysis',
    no_fresh_consideration: 'termination_clause_analysis',
    termination_for_cause: 'just_cause_analysis',
    constructive_dismissal: 'constructive_dismissal_analysis',
    inducement: 'inducement_analysis',
    successor_employer: 'successor_employer_analysis',
    esa_severance: 'esa_entitlements',
    human_rights_overlay: 'human_rights_analysis',
    disability_accommodation: 'human_rights_analysis',
    workplace_harassment: 'human_rights_analysis',
    bad_faith_dismissal: 'bad_faith_analysis',
    roe_bad_faith: 'bad_faith_analysis',
    punitive_damages: 'bad_faith_analysis',
    matthews_bonus_rsu: 'compensation_claims',
    commission_through_notice: 'compensation_claims',
    non_compete_void: 'restrictive_covenant_analysis',
    non_solicitation_unenforceable: 'restrictive_covenant_analysis',
    ohsa_reprisal: 'ohsa_reprisal_analysis',
  };

  const addedSections = new Set<string>();
  for (const issue of approvedIssues) {
    const section = issueToSection[issue];
    if (section && !addedSections.has(section)) {
      sections.push(section);
      addedSections.add(section);
    }
  }

  sections.push('damages_quantification', 'demand', 'closing');
  return sections;
}
