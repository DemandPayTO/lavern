/**
 * Application Generator — Drafts Notice of Application, HRTO Application, and ESA Complaint.
 *
 * Three document types:
 *   1. Notice of Application (Form 14E) — Superior Court of Ontario
 *   2. HRTO Application (Form 1) — Human Rights Tribunal of Ontario
 *   3. ESA Complaint — Ministry of Labour, Immigration, Training and Skills Development
 *
 * Uses crossProviderChat (inherits anonymisation + provider routing).
 */

import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import type { EmploymentIntakeData, IntakeAnalysisResult, SourceCitation } from '../types/employment-intake.js';
import { computeBardalFactors, computeLimitationDeadline } from './timeline-generator.js';
import { extractCitations } from './citation-extractor.js';
import { checkCitationIntegrity, checkFillInPlaceholders } from './citation-canon.js';

const logger = createLogger('APP-GEN');

// ── Types ────────────────────────────────────────────────────────────────

export type ApplicationType = 'notice_of_application' | 'hrto_application' | 'esa_complaint';

export interface ApplicationRequest {
  intake: EmploymentIntakeData;
  approvedIssues: string[];
  analysis: IntakeAnalysisResult;
  applicationType: ApplicationType;
  claimAmount?: number;
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  courtLocation?: string;
  /** Uploaded source documents for citation tracking. */
  sourceDocuments?: Array<{ name: string; content: string }>;
}

export interface ApplicationResult {
  html: string;
  applicationType: ApplicationType;
  formName: string;
  lawyerReviewFlags: string[];
  /** Source citations — which document text each section relies on. */
  citations: SourceCitation[];
  costUsd: number;
}

// ── Prompt builders ──────────────────────────────────────────────────────

function buildSystemPrompt(appType: ApplicationType): string {
  const prompts: Record<ApplicationType, string> = {
    notice_of_application: `You are a senior Ontario litigation lawyer drafting a Notice of Application (Form 14E) under the Ontario Rules of Civil Procedure for filing in the Ontario Superior Court of Justice.

DOCUMENT STRUCTURE (Form 14E):
1. Title of Proceedings (court name, file number placeholder, parties — Applicant and Respondent)
2. "THE APPLICANT MAKES APPLICATION FOR:" — itemised list of relief sought (declarations, orders, damages, costs)
3. "THE GROUNDS FOR THE APPLICATION ARE:" — numbered paragraphs with the legal and factual basis
4. "THE FOLLOWING DOCUMENTARY EVIDENCE will be used at the hearing:" — list of affidavits and exhibits
5. Estimated time for oral argument
6. Date, place of filing, lawyer/firm information

RULES:
- Applications are heard on affidavit evidence (no oral testimony unless court orders otherwise)
- Number all paragraphs in the "grounds" section
- Reference specific statutory provisions
- Canadian English spelling throughout`,

    hrto_application: `You are drafting a Human Rights Tribunal of Ontario (HRTO) Application (Form 1) under the Human Rights Code, RSO 1990, c H.19.

DOCUMENT STRUCTURE (HRTO Form 1):
1. Applicant Information (name, address, contact details — use placeholders)
2. Respondent Information (employer name, address, contact details)
3. Protected Ground(s) checked (from the Human Rights Code, s. 5)
4. Social Area: Employment
5. Summary of the Complaint — narrative of events (numbered paragraphs)
6. How the respondent discriminated (connection between protected ground and adverse treatment)
7. Remedy Sought:
   - Monetary compensation for injury to dignity, feelings, and self-respect (s. 45.2)
   - Compensation for lost wages and benefits
   - Reinstatement (if applicable)
   - Policy changes / training orders
   - Public interest remedies
8. Other Proceedings — whether the applicant has filed an ESA complaint, civil action, or other proceeding (s. 34(11) election issue — filing an ESA complaint may bar HRTO)
9. Accommodation needs for the hearing
10. Declaration and signature

IMPORTANT NOTES:
- HRTO has a 1-year limitation period from the last incident of discrimination
- s. 34(11) election: the applicant cannot file both an ESA complaint about the same facts AND an HRTO application
- Remedies can include up to $50,000+ for injury to dignity in serious cases
- Canadian English spelling throughout`,

    esa_complaint: `You are drafting an Employment Standards Act (ESA) complaint to the Ontario Ministry of Labour, Immigration, Training and Skills Development.

DOCUMENT STRUCTURE:
1. Employee Information (name, address, contact — use placeholders)
2. Employer Information (legal name, operating name, address, industry)
3. Employment Details (hire date, termination date, job title, wages, hours)
4. Nature of Complaint — check applicable categories:
   - Unpaid wages
   - Termination pay (s. 54-62)
   - Severance pay (s. 63-66)
   - Overtime pay (s. 22)
   - Vacation pay (s. 33-41)
   - Public holiday pay (s. 24-32)
   - Reprisal (s. 74)
   - Equal pay (s. 42)
   - Lie detector tests (s. 69)
5. Detailed Description of Complaint — narrative of what happened
6. Amount Claimed — itemised breakdown by category
7. Supporting Documents List
8. Whether the employee is still employed
9. Whether the employee has filed a civil claim (ESA complaint may be barred if civil claim filed for same entitlements)
10. Declaration and signature

IMPORTANT NOTES:
- ESA complaint must be filed within 2 years of the violation
- The Ministry can order up to 2 years of back wages
- Severance pay eligibility: 5+ years of service AND employer has payroll of $2.5M+ OR employer terminates 50+ employees in 6 months
- Reprisal complaints have reverse onus on the employer (s. 74(1.1))
- Canadian English spelling throughout`,
  };

  return `${prompts[appType]}

CRITICAL RULES:
1. Every factual claim must come from the intake data — never fabricate facts.
2. Use Canadian English spelling throughout.
3. Reference specific statute sections by number.
4. All monetary amounts in Canadian dollars.

OUTPUT FORMAT:
Produce the document in HTML format with semantic HTML (h1, h2, p, ol, li, strong, hr). No inline styles.`;
}

function buildUserPrompt(req: ApplicationRequest): string {
  const intake = req.intake;
  const bardal = computeBardalFactors(intake);
  const limitation = computeLimitationDeadline(intake.termination_date);
  const startDate = intake.hire_date ?? intake.first_day_of_work ?? 'unknown';
  const endDate = intake.termination_date ?? 'unknown';

  const compParts: string[] = [];
  if (intake.annual_salary) compParts.push(`$${intake.annual_salary.toLocaleString('en-CA')}/year`);
  if (intake.has_bonus && intake.bonus_amount) compParts.push(`bonus: $${intake.bonus_amount.toLocaleString('en-CA')}`);
  if (intake.has_commissions && intake.commission_amount) compParts.push(`commissions: $${intake.commission_amount.toLocaleString('en-CA')}`);

  const discrimGrounds = intake.discrimination_grounds ?? [];
  const damages = req.analysis.damagesEstimate;

  return `Draft the complete ${getApplicationFormName(req.applicationType)} for this case.

APPLICANT/EMPLOYEE:
- Name: ${intake.client_first_name ?? ''} ${intake.client_last_name ?? ''}
- Age: ${bardal.age ?? 'unknown'}

RESPONDENT/EMPLOYER:
- Name: ${intake.employer_legal_name ?? intake.employer_operating_name ?? 'unknown'}
- Industry: ${intake.employer_industry ?? 'unknown'}

EMPLOYMENT:
- Period: ${startDate} to ${endDate}
- Title: ${intake.job_title ?? 'unknown'}
- Compensation: ${compParts.join('; ') || 'not specified'}

TERMINATION:
- Date: ${intake.termination_date ?? 'unknown'}
- Type: ${intake.was_terminated ? 'Terminated' : intake.is_constructive_dismissal ? 'Constructive dismissal' : 'Unknown'}
${intake.termination_reasons ? `- Reason: ${intake.termination_reasons}` : ''}
${intake.employer_alleged_just_cause ? '- Just cause alleged' : ''}

${discrimGrounds.length > 0 ? `DISCRIMINATION GROUNDS: ${discrimGrounds.join(', ')}` : ''}
${intake.discrimination_details ? `DISCRIMINATION DETAILS: ${intake.discrimination_details}` : ''}
${intake.accommodation_denied ? `ACCOMMODATION: Requested and denied. ${intake.accommodation_details ?? ''}` : ''}
${intake.experienced_harassment ? `HARASSMENT: ${intake.harassment_details ?? 'Details to be provided'}` : ''}
${intake.experienced_reprisal ? `REPRISAL: ${intake.reprisal_details ?? 'Details to be provided'}` : ''}

APPROVED ISSUES:
${req.approvedIssues.map((code, i) => `${i + 1}. ${code}`).join('\n')}

${req.claimAmount ? `AMOUNT CLAIMED: $${req.claimAmount.toLocaleString('en-CA')} CAD` : ''}

ESA ENTITLEMENTS:
- Notice pay: ${damages.esaNoticeWeeks} weeks ($${damages.esaNoticePay.toLocaleString('en-CA')})
- Severance pay: $${damages.esaSeverancePay.toLocaleString('en-CA')}

FILING DETAILS:
- Lawyer: ${req.lawyerName}, ${req.firmName}
${req.firmAddress ? `- Address: ${req.firmAddress}` : ''}
${req.courtLocation ? `- Location: ${req.courtLocation}` : ''}
${limitation ? `- Limitation: ${limitation.date} (${limitation.daysRemaining} days remaining)` : ''}

Draft the complete application now.`;
}

// ── Main generation function ─────────────────────────────────────────────

/**
 * Generate an application document (Notice of Application, HRTO, or ESA complaint).
 */
export async function generateApplication(
  req: ApplicationRequest,
  definedTerms?: string[],
): Promise<ApplicationResult> {
  const systemPrompt = buildSystemPrompt(req.applicationType);
  const userPrompt = buildUserPrompt(req);

  logger.info('Generating application', {
    applicationType: req.applicationType,
    approvedIssues: req.approvedIssues.length,
  });

  let text: string;
  let cost: number;
  try {
    const result = await crossProviderChat({
      system: systemPrompt,
      user: userPrompt,
      tier: 'opus',
      maxTokens: 10240,
      maxRetries: 2,
      definedTerms: definedTerms ?? undefined,
    });
    text = result.text;
    cost = result.cost;
  } catch (err) {
    logger.error('Application generation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Document generation failed. Please try again.');
  }

  let html = text.trim();
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();

  const lawyerReviewFlags = [
    'factual_narrative',
    'legal_basis',
    'remedies_sought',
    'other_proceedings_declaration',
    ...checkCitationIntegrity(html, definedTerms ?? []),
    ...checkFillInPlaceholders(html),
  ];

  let citations: SourceCitation[] = [];
  let totalCost = cost;
  if (req.sourceDocuments && req.sourceDocuments.length > 0) {
    try {
      const citationResult = await extractCitations(html, req.sourceDocuments, definedTerms);
      citations = citationResult.citations;
      totalCost += citationResult.costUsd;
    } catch (err) {
      logger.warn('Application citation extraction failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Application generated', {
    applicationType: req.applicationType,
    htmlLength: html.length,
    citations: citations.length,
    costUsd: totalCost.toFixed(4),
  });

  return {
    html,
    applicationType: req.applicationType,
    formName: getApplicationFormName(req.applicationType),
    lawyerReviewFlags,
    citations,
    costUsd: totalCost,
  };
}

/**
 * Get the form name for an application type.
 */
export function getApplicationFormName(appType: ApplicationType): string {
  switch (appType) {
    case 'notice_of_application': return 'Notice of Application (Form 14E)';
    case 'hrto_application': return 'HRTO Application (Form 1)';
    case 'esa_complaint': return 'ESA Complaint — Ministry of Labour';
  }
}
