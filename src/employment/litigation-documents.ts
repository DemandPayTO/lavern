/**
 * Litigation Document Generators — Discovery Plan, Affidavit of Documents, Mediation Brief.
 *
 * Phase 2 of the employment law litigation lifecycle. Built on the same
 * patterns as the demand letter and SOC generators (crossProviderChat,
 * anonymisation, citation tracking).
 *
 * 1. Discovery Plan — documents to request, interrogatories, examinations
 * 2. Affidavit of Documents — Schedules A (favourable), B (unfavourable),
 *    C (privileged), D (no longer in possession)
 * 3. Mediation Brief — case summary, issues, positions, settlement range
 */

import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import type { EmploymentIntakeData, IntakeAnalysisResult, SourceCitation } from '../types/employment-intake.js';
import { extractCitations } from './citation-extractor.js';
import { computeBardalFactors } from './timeline-generator.js';

const logger = createLogger('LITIGATION-DOCS');

// ── Types ────────────────────────────────────────────────────────────────

export type LitigationDocumentType = 'discovery_plan' | 'affidavit_of_documents' | 'mediation_brief';

export interface LitigationDocumentRequest {
  intake: EmploymentIntakeData;
  approvedIssues: string[];
  analysis: IntakeAnalysisResult;
  documentType: LitigationDocumentType;
  /** Claim amount (for mediation brief settlement range context). */
  claimAmount?: number;
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  courtLocation?: string;
  /** Uploaded source documents for citation tracking. */
  sourceDocuments?: Array<{ name: string; content: string }>;
  /** Additional context specific to the document type. */
  additionalContext?: string;
}

export interface LitigationDocumentResult {
  html: string;
  documentType: LitigationDocumentType;
  documentTitle: string;
  lawyerReviewFlags: string[];
  citations: SourceCitation[];
  costUsd: number;
}

// ── Prompts ──────────────────────────────────────────────────────────────

function buildSystemPrompt(docType: LitigationDocumentType): string {
  const prompts: Record<LitigationDocumentType, string> = {
    discovery_plan: `You are a senior Ontario litigation lawyer preparing a discovery plan for a wrongful dismissal action.

The discovery plan identifies:
1. DOCUMENTS TO REQUEST from the defendant (Rule 30.02 — request to produce):
   - Employment records (personnel file, performance reviews, disciplinary records)
   - Compensation records (payroll, bonus calculations, commission statements, equity records)
   - Corporate records relevant to the termination (board minutes, restructuring plans, emails about the plaintiff)
   - Policy documents (employee handbook, termination policies, progressive discipline policy)
   - Insurance records (benefits coverage, LTD eligibility)
   - Communication records (emails, texts between management regarding the plaintiff)

2. INTERROGATORIES to serve (Rule 35):
   - Questions about the termination decision (who decided, when, why)
   - Questions about the plaintiff's performance and conduct
   - Questions about replacement hiring or restructuring
   - Questions about the employer's financial position (for severance pay eligibility)
   - Questions about mitigation (what references were provided)

3. EXAMINATIONS FOR DISCOVERY (Rule 31):
   - Who to examine (decision-maker, HR, direct supervisor)
   - Key topics to cover
   - Documents to put to the witness

4. TIMELINE for discovery steps (limitation periods, motion deadlines)

RULES:
- Reference Ontario Rules of Civil Procedure by rule number
- Be specific — name exact document categories and question topics
- Tailor everything to the specific approved issues in this case
- Canadian English spelling throughout

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    affidavit_of_documents: `You are a senior Ontario litigation lawyer preparing an Affidavit of Documents (Form 30A/30B) for a wrongful dismissal action.

The Affidavit of Documents contains four schedules:

SCHEDULE A — Documents favourable to the party's case:
List every document that supports the plaintiff's claims. For each:
- Document number (sequential)
- Description of the document
- Date of the document

SCHEDULE B — Documents unfavourable to the party's case:
List documents that may undermine the plaintiff's position. The duty of disclosure requires listing these. For each:
- Document number (continuing from Schedule A)
- Description
- Date

SCHEDULE C — Documents over which privilege is claimed:
List privileged documents (solicitor-client privilege, litigation privilege). For each:
- Document number
- Brief description (without revealing content)
- Type of privilege claimed

SCHEDULE D — Documents no longer in the party's possession:
List relevant documents the party once had but no longer possesses. For each:
- Document number
- Description
- Date last in possession
- Who now has the document (if known)

RULES:
- Base the schedules on the client's uploaded documents and intake facts
- Be thorough — missing a relevant document is a serious professional obligation issue
- The affidavit must include a sworn statement that the list is complete
- Reference Rule 30.03 (obligation to disclose)
- Canadian English spelling throughout

Output as HTML with h1, h2, tables, and structured lists. No inline styles.`,

    mediation_brief: `You are a senior Ontario employment lawyer preparing a mediation brief for mandatory mediation under Rule 24.1.

The mediation brief should contain:

1. NATURE OF THE ACTION — Brief description of the claim and parties

2. FACTUAL BACKGROUND — Chronological narrative of the employment relationship, termination, and post-termination events. State facts, not arguments.

3. ISSUES IN DISPUTE — List each legal issue, stating the plaintiff's position and the anticipated defence position

4. ATTEMPTS TO RESOLVE — Any settlement offers exchanged, without-prejudice communications

5. LEGAL ISSUES — Brief statement of the applicable legal principles for each issue (Bardal, Waksdale, Honda, etc.)

6. DAMAGES PARTICULARS — Itemised breakdown of the plaintiff's claim with supporting calculations

7. SETTLEMENT RANGE — The plaintiff's realistic assessment of the range of outcomes:
   - Best case (if every issue goes the plaintiff's way)
   - Likely range (most probable outcome range)
   - Floor (minimum acceptable — ESA entitlements as baseline)

8. MEDIATION OBJECTIVES — What the plaintiff hopes to achieve (monetary settlement, reference letter, benefits continuation, non-disparagement, etc.)

9. PRACTICAL CONSIDERATIONS — Factors relevant to settlement (upcoming limitation dates, cost exposure, emotional toll on client, desire for closure)

RULES:
- Be candid about weaknesses — mediators appreciate honest assessments
- Show you understand the other side's likely arguments
- Settlement ranges should be realistic, not aspirational
- Reference specific damages calculations (not just ranges)
- Canadian English spelling throughout

Output as HTML with h1, h2, p, ol, li, strong, tables. No inline styles.`,
  };

  return prompts[docType] + `

CRITICAL:
1. Every factual claim must come from the intake data — never fabricate facts.
2. Use Canadian English spelling throughout.
3. All monetary amounts in Canadian dollars.`;
}

function buildUserPrompt(req: LitigationDocumentRequest): string {
  const intake = req.intake;
  const bardal = computeBardalFactors(intake);
  const damages = req.analysis.damagesEstimate;

  const startDate = intake.hire_date ?? intake.first_day_of_work ?? 'unknown';
  const endDate = intake.termination_date ?? 'unknown';

  const compParts: string[] = [];
  if (intake.annual_salary) compParts.push(`$${intake.annual_salary.toLocaleString('en-CA')}/year`);
  if (intake.has_bonus && intake.bonus_amount) compParts.push(`bonus: $${intake.bonus_amount.toLocaleString('en-CA')}`);
  if (intake.has_commissions && intake.commission_amount) compParts.push(`commissions: $${intake.commission_amount.toLocaleString('en-CA')}`);

  // List uploaded documents for the affidavit
  const uploadedDocs = (req.sourceDocuments ?? []).map((d, i) => `${i + 1}. ${d.name}`).join('\n');

  return `Generate the ${getDocumentTitle(req.documentType)} for this employment case.

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
${req.approvedIssues.map((code, i) => `${i + 1}. ${code}`).join('\n')}

DAMAGES:
- ESA: ${damages.esaNoticeWeeks} weeks notice ($${damages.esaNoticePay.toLocaleString('en-CA')}) + $${damages.esaSeverancePay.toLocaleString('en-CA')} severance
- Common law: ${damages.commonLawLowMonths}–${damages.commonLawHighMonths} months ($${damages.commonLawLowAmount.toLocaleString('en-CA')}–$${damages.commonLawHighAmount.toLocaleString('en-CA')})
${req.claimAmount ? `- Total claimed: $${req.claimAmount.toLocaleString('en-CA')}` : ''}

${uploadedDocs ? `UPLOADED DOCUMENTS:\n${uploadedDocs}` : ''}

FILING DETAILS:
- Lawyer: ${req.lawyerName}, ${req.firmName}
${req.courtLocation ? `- Court: ${req.courtLocation}` : ''}

${req.additionalContext ? `ADDITIONAL CONTEXT:\n${req.additionalContext}` : ''}

Draft the complete document now.`;
}

// ── Main generation function ─────────────────────────────────────────────

export async function generateLitigationDocument(
  req: LitigationDocumentRequest,
  definedTerms?: string[],
): Promise<LitigationDocumentResult> {
  const systemPrompt = buildSystemPrompt(req.documentType);
  const userPrompt = buildUserPrompt(req);

  logger.info('Generating litigation document', {
    documentType: req.documentType,
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
    logger.error('Litigation document generation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Document generation failed. Please try again.');
  }

  let html = text.trim();
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();

  // Citation tracking
  let citations: SourceCitation[] = [];
  let totalCost = cost;
  if (req.sourceDocuments && req.sourceDocuments.length > 0) {
    try {
      const citationResult = await extractCitations(html, req.sourceDocuments, definedTerms);
      citations = citationResult.citations;
      totalCost += citationResult.costUsd;
    } catch (err) {
      logger.warn('Litigation doc citation extraction failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const lawyerReviewFlags = getLawyerReviewFlags(req.documentType);

  logger.info('Litigation document generated', {
    documentType: req.documentType,
    htmlLength: html.length,
    citations: citations.length,
    costUsd: totalCost.toFixed(4),
  });

  return {
    html,
    documentType: req.documentType,
    documentTitle: getDocumentTitle(req.documentType),
    lawyerReviewFlags,
    citations,
    costUsd: totalCost,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function getDocumentTitle(docType: LitigationDocumentType): string {
  switch (docType) {
    case 'discovery_plan': return 'Discovery Plan';
    case 'affidavit_of_documents': return 'Affidavit of Documents';
    case 'mediation_brief': return 'Mediation Brief';
  }
}

function getLawyerReviewFlags(docType: LitigationDocumentType): string[] {
  switch (docType) {
    case 'discovery_plan':
      return ['document_requests', 'interrogatories', 'examination_topics'];
    case 'affidavit_of_documents':
      return ['schedule_a_completeness', 'schedule_b_completeness', 'privilege_claims', 'sworn_statement'];
    case 'mediation_brief':
      return ['factual_accuracy', 'settlement_range', 'weakness_assessment', 'objectives'];
  }
}
