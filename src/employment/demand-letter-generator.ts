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
import { enforceHouseStyle } from '../utils/house-style.js';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import type { EmploymentIntakeData, GateResult, IntakeAnalysisResult, SourceCitation } from '../types/employment-intake.js';
import { TONE_OPTIONS } from '../types/employment-intake.js';
import { computeBardalFactors, computeLimitationDeadline } from './timeline-generator.js';
import { extractCitations } from './citation-extractor.js';
import { checkCitationIntegrity, checkFillInPlaceholders } from './citation-canon.js';
import { buildDemandOpening, buildDemandSignature, buildDemandDamagesTable, scrubDemandBody, insertDamagesTable } from './demand-letter-parts.js';
import { checkCanonTextIntegrity } from './canon-verifier.js';

const logger = createLogger('DEMAND-LETTER');

// ── Types ────────────────────────────────────────────────────────────────

export type DemandLetterTone = typeof TONE_OPTIONS[number];

export interface DemandLetterRequest {
  /** Who the letter is addressed to; counsel where known. */
  recipientName?: string;
  /** The firm's own file number for the Re: block. */
  fileNumber?: string;
  /** Heads of damage the lawyer chose, overriding the analysis defaults. */
  damageHeads?: Array<{ label: string; amount?: number | null; basis?: string }>;
  /** Amounts already paid, netted off the claim. */
  amountsPaid?: Array<{ label: string; amount: number }>;
  /** Mitigation earnings to date, netted off the claim. */
  mitigationEarnings?: number | null;
  /** The firm's style context from a style profile, folded into the prompt. */
  styleContext?: string;
  /** Firm depth from the style profile; scales the output budget. */
  styleTypicalWords?: number;
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
  /**
   * The case documents on the file, already formatted for the prompt by
   * demand-sources.ts. Lets the letter quote the clause the parties signed
   * rather than argue from the intake form's paraphrase of it.
   */
  caseDocumentContext?: string;
  /**
   * What the lawyer and the partner said this draft should do, from
   * direction.ts. It governs: an instruction that narrows the letter
   * narrows it, including the heads the damages table itemises.
   */
  directionContext?: string;
  /**
   * The firm's own letter, learned from its precedents. When present, the
   * opening and closing are the FIRM's rather than Starling's, and the
   * drafting instruction becomes reproduce rather than imitate.
   */
  houseForm?: {
    openingHtml?: string;
    closingHtml?: string;
    context?: string;
  };
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
1. Every factual claim must come from the intake data provided; never fabricate facts.
2. Case law citations must be accurate and real Ontario/SCC cases. Use only well-known precedents:
   - Bardal v Globe & Mail, [1960] OJ No 149 (reasonable notice factors)
   - Waksdale v Swegon North America Inc, 2020 ONCA 391 (termination clause invalidity)
   - Honda Canada Inc v Keays, 2008 SCC 39 (bad faith damages)
   - McKinley v BC Tel, 2001 SCC 38 (just cause proportionality)
   - Potter v New Brunswick Legal Aid, 2015 SCC 10 (constructive dismissal)
   - Matthews v Ocean Nutrition Canada Ltd, 2020 SCC 26 (bonus through notice)
   - Machtinger v HOJ Industries Ltd, [1992] 1 SCR 986 (below-ESA clauses void)
   - Ceccol v Ontario Gymnastics Federation, 2001 CanLII 8589 (ONCA) (successive fixed-term contracts treated as indefinite employment)
   - Wallace v United Grain Growers Ltd, [1997] 3 SCR 701 (inducement as a notice factor; on bad-faith DAMAGES it is superseded by Honda v Keays, so do not cite Wallace for a damages award)
   - Shafron v KRG Insurance Brokers, 2009 SCC 6 (restrictive covenant enforceability)
3. Do NOT invent case citations. If unsure about a citation, omit it rather than guess.
4. Use Canadian English spelling throughout (honour, labour, behaviour, etc.).
5. Reference specific ESA sections by number (e.g. "section 57 of the Employment Standards Act, 2000").
6. All monetary amounts in Canadian dollars.
7. Write in the professional register of Ontario legal practice. Do not use em dashes anywhere in the document; use commas, colons, semicolons, or parentheses instead.
8. ESA SEVERANCE PAY is not automatic: it requires five or more years of employment AND an employer payroll of $2.5 million or more (or a severance of 50 or more employees in six months). If the payroll condition is not established in the facts given, claim it conditionally ("if the employer's payroll meets the threshold in section 64") rather than asserting entitlement, or mark it "[LAWYER: confirm payroll threshold]".
9. Cite an authority only for what it actually decides. Do not attach a case to a proposition it does not support.

OUTPUT FORMAT:
Produce the letter in HTML format. Use semantic HTML:
- <h1> for the letter title (not displayed; use as the document title)
- <p> for paragraphs
- <strong> for emphasis
- <ol> and <li> for numbered lists (e.g. damages particulars)
- No inline styles, no classes; clean semantic HTML only.

Do NOT include letterhead, the date, the address block, the "Without prejudice" marking, the "Re:" line, the salutation, or the signature block: every one of those is added automatically. Do not write "Dear ...", do not write "Yours truly", do not write "Re: ...". Begin with the first substantive paragraph of the letter and end with the last.

THE DAMAGES TABLE IS ALSO ADDED AUTOMATICALLY, built from the matter record. Under the Damages Quantification heading, write NOTHING: the heading and the table are inserted for you. Refer to the figures elsewhere in the letter naturally ("as itemised below"), but never restate the itemisation and never state a total of your own.`;
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
      wrongful_dismissal: 'Wrongful dismissal: common law reasonable notice (Bardal factors)',
      termination_clause_invalidity: 'Termination clause is invalid or unenforceable',
      waksdale_at_any_time: 'Termination clause contains "at any time" language (Waksdale / Dufault risk)',
      machtinger_below_esa: 'Termination clause provides less than ESA minimums (Machtinger)',
      no_fresh_consideration: 'Termination clause added mid-employment without fresh consideration',
      dufault_language: 'Termination clause language fails Dufault analysis',
      termination_for_cause: 'Employer alleged just cause; challenge under McKinley proportionality',
      constructive_dismissal: 'Constructive dismissal (Potter test)',
      inducement: 'Client was induced from secure prior employment (Wallace/Ceccol)',
      successor_employer: 'Successor employer: tenure includes predecessor service',
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
      fixed_term_contract: 'Fixed-term contract: entitled to the balance of the term',
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
${intake.clause_added_mid_employment ? 'This clause was added AFTER the initial hiring; fresh consideration is an issue.' : ''}
${intake.termination_clause_text?.toLowerCase().includes('at any time') ? 'The clause contains "at any time" language; the Waksdale / Dufault analysis applies.' : ''}
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
- Response deadline: ${req.responseDeadlineDays} days from today, which is ${new Date(Date.now() + req.responseDeadlineDays * 86_400_000).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}. STATE THAT CALENDAR DATE in the closing demand, not only the number of days: a date cannot be argued about later, and it is the date the file is diarised against.
${limitation ? `- Limitation period expires: ${limitation.date} (${limitation.daysRemaining} days remaining${limitation.urgent ? '; URGENT' : ''})` : ''}

${req.houseForm?.context ? `STRUCTURE. This firm's own letter is set out below, and ITS parts and ITS headings govern. Use the firm's headings exactly as the firm writes them, including their capitalisation, in the firm's order. Do not impose the section names a demand letter usually carries, and do not add a title heading: the firm's letters do not have one.

Every approved issue still has to be argued, within whichever of the firm's parts it belongs to.` : `STRUCTURE. Use these EXACT h2 headings, in this order, so that the letter can
be placed into a firm's own template section by section. Do not rename,
merge, or omit a heading; where a section does not apply, keep the heading
and state the position briefly.
1. Opening paragraph (no heading): who acts, for whom, and the purpose of the letter
2. <h2>Employment Background</h2>: brief chronology
3. <h2>Termination Facts</h2>: what happened
4. <h2>Legal Analysis</h2>: one subsection per approved issue (cite relevant case law)
5. <h2>Demand</h2>: the terms on which the client will resolve, and the response deadline as a calendar date. State the demand figure once; the itemisation is in the table above it.
6. <h2>Closing</h2>: consequences of non-response, and the without-prejudice reservation`}

Do NOT write a Damages Quantification section: the heading and its table are inserted automatically.

Write the complete letter now.`;
}

// ── Lawyer review flag detection ─────────────────────────────────────────

/**
 * Issues that always require lawyer review before the letter is sent, and
 * what to check for each.
 *
 * The flag is the last thing between a draft and a served letter, so it
 * says what to look at. A bare issue name ("constructive_dismissal") tells
 * the lawyer only what they already told Starling.
 */
const REVIEW_REQUIRED_ISSUES: Record<string, string> = {
  termination_clause_invalidity:
    'The letter argues the termination clause is unenforceable. Read the clause against the contract itself before sending, since the argument stands or falls on its exact words.',
  waksdale_at_any_time:
    'The letter relies on a Waksdale argument. Confirm the for cause provision in the contract actually contravenes the ESA, and that the version you are reading is the operative one.',
  machtinger_below_esa:
    'The letter argues the clause contracts below the ESA minimum. Verify the entitlement calculation against the ESA before asserting it.',
  no_fresh_consideration:
    'The letter argues the clause fails for want of fresh consideration. Confirm the timing of the signature against the start of employment and any promotion.',
  termination_for_cause:
    'Cause is alleged on the file. Confirm what the employer has actually asserted in writing before the letter answers it.',
  constructive_dismissal:
    'The letter pleads constructive dismissal. Confirm the client did not condone the change by continuing to work beyond a reasonable period, and check the date they treated the employment as at an end.',
  human_rights_overlay:
    'The letter asserts a Human Rights Code claim. Confirm the protected ground and the connection to the termination, and consider whether an Application to the Tribunal is being preserved.',
  disability_accommodation:
    'The letter asserts a failure to accommodate. Confirm what the employer knew about the restriction and when, and that the medical documentation on file supports it.',
  bad_faith_dismissal:
    'The letter claims moral damages for the manner of dismissal. Confirm the conduct alleged is documented, since these damages are compensatory and require evidence of the harm.',
  punitive_damages:
    'The letter claims punitive damages. Confirm the conduct alleged meets the independent actionable wrong threshold before asserting it.',
  ohsa_reprisal:
    'The letter alleges a reprisal. Confirm the protected activity and its proximity to the termination, and note the Board has exclusive jurisdiction over an OHSA reprisal complaint.',
};

function computeReviewFlags(approvedIssues: string[]): string[] {
  return approvedIssues
    .map(i => REVIEW_REQUIRED_ISSUES[i])
    .filter((f): f is string => Boolean(f));
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
  // The case documents come after the instructions and before the style
  // guide: the words the parties used matter more than the firm's house
  // voice, and the last thing in the prompt should be how to write, not
  // what to write about.
  // The direction comes LAST, after the instructions, the documents and
  // the style. It is the thing that overrides the others, so it is the
  // thing the model reads with the instructions still in view.
  const userPrompt = [
    buildUserPrompt(req),
    req.caseDocumentContext,
    // The house form REPLACES the prose style guide where it exists: one
    // says reproduce the firm's wording, the other says write in the
    // firm's voice, and giving the model both is giving it a choice.
    req.houseForm?.context || req.styleContext,
    req.directionContext,
  ].filter(Boolean).join('\n\n');

  logger.info('Generating demand letter', {
    tone: req.tone,
    approvedIssues: req.approvedIssues.length,
    demandAmount: req.demandAmount,
  });

  let text: string;
  let cost: number;
  try {
    const result = await crossProviderChat({
    system: systemPrompt,
    user: userPrompt,
    tier: 'opus',    // Use strongest model for legal drafting
    maxTokens: req.styleTypicalWords ? Math.min(30_000, Math.max(8192, Math.ceil(req.styleTypicalWords * 3))) : 8192,
    extendOnTruncation: true,
    maxRetries: 2,
    definedTerms: definedTerms ?? undefined,
  });
    text = result.text;
    cost = result.cost;
  } catch (err) {
    logger.error('Demand letter generation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Document generation failed. Please try again.');
  }

  // Extract HTML — Claude may wrap in markdown fences
  let html = enforceHouseStyle(text.trim());
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();

  // The integrity checks read the MODEL's prose. The furniture and the
  // damages table are deterministic, so canon-checking them would only
  // produce noise.
  const narrativeHtml = html;

  // Assemble: furniture, body, deterministic table, signature. The table
  // is inserted before the Demand section so the letter reads
  // itemisation-then-demand, as a demand letter does.
  const damages = buildDemandDamagesTable({
    intake: req.intake,
    analysis: req.analysis,
    heads: req.damageHeads,
    amountsPaid: req.amountsPaid,
    mitigationEarnings: req.mitigationEarnings,
    demandAmount: req.demandAmount,
  });
  const furnitureInput = {
    intake: req.intake,
    lawyerName: req.lawyerName,
    firmName: req.firmName,
    firmAddress: req.firmAddress,
    recipientName: req.recipientName,
    fileNumber: req.fileNumber,
  };
  // The table's heading is ours, and it sits among the firm's. Where the
  // firm writes its headings in capitals, so does this one: a letter with
  // BACKGROUND, ENTITLEMENT and then "Damages Quantification" reads as two
  // documents spliced together.
  const scrubbed = scrubDemandBody(html);
  // Only the FIRM's headings count. Ours are the damages heading, which
  // the model writes despite being told not to, and the note to the
  // lawyer, which the house form invites. Either one, in our casing, was
  // enough to conclude the firm does not use capitals.
  const OUR_HEADINGS = /^(damages\b|note to the lawyer)/i;
  const firmHeadings = [...scrubbed.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/gi)]
    .map(m => m[1].trim())
    .filter(h => !OUR_HEADINGS.test(h));
  const firmUsesCaps = firmHeadings.length >= 2
    && firmHeadings.every(h => h === h.toUpperCase());
  const inserted = insertDamagesTable(scrubbed, damages.html);
  // Applied to the ASSEMBLED body, not just to our table: where the model
  // wrote its own damages heading, the table goes under THAT one, and it
  // arrives in whatever case the model chose.
  const withTable = firmUsesCaps
    ? inserted.replace(/(<h2[^>]*>)([^<]+)(<\/h2>)/g, (_m, a, text, b) => `${a}${String(text).toUpperCase()}${b}`)
    : inserted;
  // The firm's own opening and sign-off where it has taught them. Its
  // form is the point: a bold "RE: client v. employer" is not the same
  // document as "Re: client and employer", however close the prose.
  html = [
    req.houseForm?.openingHtml || buildDemandOpening(furnitureInput),
    withTable,
    req.houseForm?.closingHtml || buildDemandSignature(furnitureInput),
  ].filter(Boolean).join('\n\n');

  // Compute review flags + citation integrity check (flags any case name
  // outside the known canon, and canon cases with mismatched citations)
  const lawyerReviewFlags = [
    ...computeReviewFlags(req.approvedIssues),
    ...damages.flags,
    ...checkCitationIntegrity(narrativeHtml, definedTerms ?? []),
    ...checkCanonTextIntegrity(narrativeHtml),
    ...checkFillInPlaceholders(narrativeHtml),
  ];
  // Every AI draft carries at least one review reminder — Rule 26 posture
  if (lawyerReviewFlags.length === 0) {
    lawyerReviewFlags.push('Verify all facts, dates, and dollar amounts against the client file before sending.');
  }

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
