/**
 * Grievance Document Generators — union-side labour documents.
 *
 * Same pipeline discipline as the employment generators: crossProviderChat
 * (anonymisation inherited), citation-canon integrity check, fill-in
 * placeholder detection, reviewer flags on every draft.
 *
 * Reviewer language: the user may be union counsel OR a labour relations
 * officer — in Ontario, non-lawyer union representatives lawfully
 * represent at grievance arbitration.
 */

import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import { checkCitationIntegrity, checkFillInPlaceholders } from '../employment/citation-canon.js';
import { computeGrievanceDeadlines } from './gate-evaluator.js';
import type { GrievanceIntakeData } from '../types/labour-intake.js';

const logger = createLogger('GRIEVANCE-DOCS');

// ── Types ────────────────────────────────────────────────────────────────

export type GrievanceDocumentType =
  | 'grievance_filing'
  | 'referral_to_arbitration'
  | 'arbitration_brief'
  | 'dfr_response';

export interface GrievanceDocumentRequest {
  intake: GrievanceIntakeData;
  approvedIssues: string[];
  documentType: GrievanceDocumentType;
  /** Union rep or counsel preparing the document. */
  representativeName: string;
  /** Union / local or firm name. */
  organizationName: string;
  additionalContext?: string;
}

export interface GrievanceDocumentResult {
  html: string;
  documentType: GrievanceDocumentType;
  documentTitle: string;
  reviewerFlags: string[];
  costUsd: number;
}

// ── Prompts ──────────────────────────────────────────────────────────────

function buildSystemPrompt(docType: GrievanceDocumentType): string {
  const prompts: Record<GrievanceDocumentType, string> = {
    grievance_filing: `You are an experienced Ontario union-side labour relations professional drafting a GRIEVANCE for filing under a collective agreement.

DRAFTING PRINCIPLES (these matter enormously in practice):
- Grievances are construed GENEROUSLY, but plead broadly anyway: "and any other relevant articles of the Collective Agreement, and any applicable statute including the Human Rights Code and the Employment Standards Act, 2000."
- State the grievance in ONE clear sentence; particulars can follow at later steps. Never volunteer evidence or argument at filing.
- The remedy clause is broad by design: "full redress, including but not limited to..." plus the specific remedy (reinstatement and make-whole for discharge; rescission of discipline; cease-and-desist for policy).

STRUCTURE:
1. Header: Grievance number [to be assigned], date, union and local, employer, workplace
2. Grievor (or "Union policy grievance" / "Group grievance" as applicable)
3. Statement of grievance: "The Union grieves that the Employer violated [articles], including but not limited to..., when it [one-sentence description]."
4. Articles violated: the just-cause article, any specific articles, plus the standard broad basket clause
5. Remedy requested: specific + "and such other relief as is just," made whole in all respects
6. Signature blocks: grievor (where applicable), union representative, date; employer acknowledgment of receipt line

Output as HTML with h1, h2, p, strong. Short — a grievance is one page. No inline styles.`,

    referral_to_arbitration: `You are an Ontario union-side labour relations professional drafting a REFERRAL TO ARBITRATION — the formal notice advancing a grievance to arbitration after the grievance procedure is exhausted.

STRUCTURE:
1. Date, addressee (employer labour relations contact), delivery method line
2. Re line: grievance number, grievor, subject
3. Body: notice that the Union refers the grievance to arbitration pursuant to [the CA's arbitration article] and the Labour Relations Act, 1995; the grievance procedure has been exhausted (or time limits for response have expired); reserve all rights
4. Arbitrator appointment: propose the CA's mechanism (agreed sole arbitrator with 2-3 proposed names as [PLACEHOLDERS], or notice under LRA s. 49 for expedited arbitration where the union elects it — state which)
5. Without prejudice to the Union's position that time limits have been complied with; request for particulars/production where appropriate
6. Signature block

RULES:
- Formal, short, procedural — one page. No argument on the merits.
- If the intake shows the referral deadline is near or missed, note the LRA s. 48(16) relief position expressly.

Output as HTML with h1, p, strong. No inline styles.`,

    arbitration_brief: `You are experienced Ontario union-side labour counsel drafting the UNION'S ARBITRATION BRIEF for a grievance arbitration.

STRUCTURE:
1. OVERVIEW — one paragraph: who the grievor is, what the employer did, what the union seeks.
2. THE PARTIES AND THE COLLECTIVE AGREEMENT — bargaining relationship, relevant articles (quote the just-cause article verbatim where provided).
3. STATEMENT OF FACTS — chronological, numbered paragraphs. Facts only; save argument. Include the grievor's service record and seniority prominently (long, clean service is the union's best fact).
4. ISSUES — numbered, precisely framed (e.g., "Did the Employer have just cause to discharge the grievor? If not, what is the appropriate remedy?").
5. ARGUMENT — organised by the applicable frameworks from the APPROVED ISSUES ONLY:
   - Discharge/discipline: the William Scott framework (cause? excessive? substitution?) and proportionality; procedural defects; prior record challenges (sunset clause)
   - Policy discipline: the KVP test element by element
   - Off-duty conduct: the Millhaven factors
   - Human rights: Code obligations at arbitration (Parry Sound — statutory rights are incorporated into every CA; accommodation to undue hardship)
   - Cite only real authorities; where an arbitral principle is general, describe it without inventing a case name.
6. REMEDY — reinstatement and make-whole as the presumptive remedy for discharge (back pay, benefits, pension, seniority, interest); substitution of a lesser penalty in the alternative; Code damages where applicable.
7. ORDER REQUESTED — numbered.

RULES:
- Union-side posture throughout. Candid about weaknesses only where strategically necessary.
- Every factual assertion from the intake data; never fabricate facts, dates, or authorities.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    dfr_response: `You are Ontario union-side labour counsel drafting the UNION'S RESPONSE to a duty of fair representation complaint under s. 74 of the Labour Relations Act, 1995 (an OLRB Form A-114 responding position, in narrative form).

CONTEXT: A bargaining unit member alleges the union breached its DFR — typically for not advancing or settling their grievance. The legal standard protects the union's judgment: the union must not act in a manner that is ARBITRARY, DISCRIMINATORY, or in BAD FAITH; it is entitled to weigh the merits, the cost, and the interests of the bargaining unit as a whole, and to be wrong, provided the decision process was considered and honest.

STRUCTURE:
1. OVERVIEW — the union's position in two sentences: the decision was a considered exercise of judgment within the s. 74 standard.
2. BACKGROUND — bargaining relationship; the underlying grievance and its history through the steps.
3. THE UNION'S PROCESS — the heart of the response: who reviewed the file, what was considered (merits assessment, arbitral jurisprudence, prior similar grievances, costs, likelihood of success), communications with the complainant at each step, any legal opinion obtained. Show a paper trail.
4. THE LAW — s. 74 standard; the Board does not sit in appeal of the union's judgment; mere negligence or error does not breach the duty; the complainant bears the onus.
5. RESPONSE TO THE SPECIFIC ALLEGATIONS — numbered, matching the complaint's allegations where provided (mark [RESPOND TO SPECIFIC ALLEGATION] where the complaint text is not available).
6. RELIEF — dismissal of the application, without a hearing where appropriate (no prima facie case).

RULES:
- Respectful of the complainant throughout — the Board reads tone.
- Never admit process gaps; where the intake reveals one, flag it for the reviewer as [REVIEW: PROCESS GAP] rather than papering over it.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,
  };

  return prompts[docType] + `

CRITICAL RULES:
1. Every factual claim must come from the intake data — never fabricate facts.
2. Never invent case citations — if unsure, state the principle without a citation.
3. Canadian English spelling throughout.
4. This is a DRAFT for review by union counsel or the responsible labour relations officer before use.`;
}

function buildUserPrompt(req: GrievanceDocumentRequest): string {
  const i = req.intake;
  const deadlines = computeGrievanceDeadlines(i);
  const grievor = [i.grievor_first_name, i.grievor_last_name].filter(Boolean).join(' ') || '[Grievor]';

  return `Draft the ${getGrievanceDocumentTitle(req.documentType)} for this grievance.

GRIEVOR:
- Name: ${grievor}${i.grievor_classification ? `, ${i.grievor_classification}` : ''}${i.grievor_department ? `, ${i.grievor_department}` : ''}
${i.grievor_seniority_date ? `- Seniority date: ${i.grievor_seniority_date}` : ''}
${i.grievor_employee_id ? `- Employee ID: ${i.grievor_employee_id}` : ''}

UNION / EMPLOYER:
- Union: ${i.union_name || '[Union]'}${i.union_local ? `, Local ${i.union_local}` : ''}
- Employer: ${i.employer_name || '[Employer]'}${i.workplace_location ? ` (${i.workplace_location})` : ''}

COLLECTIVE AGREEMENT:
${i.ca_title ? `- Agreement: ${i.ca_title}` : ''}
${i.grievance_procedure_article ? `- Grievance procedure: ${i.grievance_procedure_article}` : ''}
${i.just_cause_article ? `- Just cause article: ${i.just_cause_article}` : ''}
${i.time_limits_mandatory != null ? `- Time limits stated as ${i.time_limits_mandatory ? 'MANDATORY' : 'directory'}` : ''}

THE GRIEVANCE:
- Type: ${i.grievance_type ?? 'unspecified'}
${i.incident_date ? `- Incident date: ${i.incident_date}` : ''}
${i.incident_description ? `- What happened: ${i.incident_description}` : ''}
${i.discipline_imposed && i.discipline_imposed !== 'none' ? `- Discipline imposed: ${i.discipline_imposed}${i.discipline_letter_date ? ` (letter dated ${i.discipline_letter_date})` : ''}` : ''}
${i.employer_stated_grounds ? `- Employer's stated grounds: ${i.employer_stated_grounds}` : ''}
${i.prior_discipline ? `- Prior discipline: ${i.prior_discipline_details || 'yes — details to be confirmed'}${i.sunset_clause_months ? ` (sunset clause: ${i.sunset_clause_months} months)` : ''}` : '- No prior discipline'}
${i.union_rep_present_at_meeting === false ? '- NO union representation at the disciplinary meeting' : ''}
${i.investigation_conducted === false ? '- NO investigation conducted before discipline' : ''}
${i.off_duty_conduct ? `- Off-duty conduct in issue: ${i.off_duty_details || ''}` : ''}
${i.believes_discriminatory ? `- Human rights dimension: ${(i.discrimination_grounds ?? []).join(', ')}${i.accommodation_details ? ` — ${i.accommodation_details}` : ''}` : ''}
${i.ohsa_reprisal_alleged ? `- OHSA reprisal alleged: ${i.reprisal_details || ''}` : ''}

PROCEDURE HISTORY:
${i.grievance_filed ? `- Grievance filed ${i.grievance_filed_date ?? ''}${i.grievance_number ? ` (#${i.grievance_number})` : ''}, currently at ${i.current_step || 'unknown step'}` : '- Grievance NOT yet filed'}
${i.last_step_response_date ? `- Last step response: ${i.last_step_response_date}` : ''}
${deadlines.length > 0 ? `- Deadlines: ${deadlines.map(d => `${d.label} → ${d.date}${d.overdue ? ' (OVERDUE — address s. 48(16))' : ''}`).join('; ')}` : ''}

APPROVED ISSUES (argue ONLY these):
${req.approvedIssues.map((code, n) => `${n + 1}. ${code}`).join('\n') || '(none approved yet — draft conservatively)'}

REMEDY SOUGHT: ${i.remedy_sought || (i.grievance_type === 'discharge' ? 'Reinstatement and make-whole' : 'Full redress')}
${i.back_pay_estimate ? `- Back pay estimate: $${Number(i.back_pay_estimate).toLocaleString('en-CA')}` : ''}

PREPARED BY: ${req.representativeName}, ${req.organizationName}
${req.additionalContext ? `\nADDITIONAL CONTEXT:\n${req.additionalContext}` : ''}

Draft the complete document now.`;
}

// ── Main ─────────────────────────────────────────────────────────────────

export async function generateGrievanceDocument(
  req: GrievanceDocumentRequest,
  definedTerms?: string[],
): Promise<GrievanceDocumentResult> {
  logger.info('Generating grievance document', {
    documentType: req.documentType,
    approvedIssues: req.approvedIssues.length,
  });

  let text: string;
  let cost: number;
  try {
    const result = await crossProviderChat({
      system: buildSystemPrompt(req.documentType),
      user: buildUserPrompt(req),
      tier: getGrievanceModelTier(req.documentType),
      maxTokens: 10240,
      maxRetries: 2,
      definedTerms: definedTerms ?? undefined,
    });
    text = result.text;
    cost = result.cost;
  } catch (err) {
    logger.error('Grievance document generation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Document generation failed. Please try again.');
  }

  let html = text.trim();
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();

  const reviewerFlags = [
    ...getReviewerFlags(req.documentType),
    ...checkCitationIntegrity(html, definedTerms ?? []),
    ...checkFillInPlaceholders(html),
  ];

  logger.info('Grievance document generated', {
    documentType: req.documentType,
    htmlLength: html.length,
    costUsd: cost.toFixed(4),
  });

  return {
    html,
    documentType: req.documentType,
    documentTitle: getGrievanceDocumentTitle(req.documentType),
    reviewerFlags,
    costUsd: cost,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function getGrievanceDocumentTitle(docType: GrievanceDocumentType): string {
  switch (docType) {
    case 'grievance_filing': return 'Grievance';
    case 'referral_to_arbitration': return 'Referral to Arbitration';
    case 'arbitration_brief': return "Union's Arbitration Brief";
    case 'dfr_response': return 'DFR Response (LRA s. 74)';
  }
}

function getReviewerFlags(docType: GrievanceDocumentType): string[] {
  switch (docType) {
    case 'grievance_filing':
      return ['articles_cited_match_CA', 'remedy_clause_breadth', 'filing_deadline_confirmed'];
    case 'referral_to_arbitration':
      return ['referral_deadline_confirmed', 'arbitration_article_cited', 'arbitrator_mechanism'];
    case 'arbitration_brief':
      return ['facts_verified_against_file', 'ca_articles_quoted_verbatim', 'authorities_verified', 'remedy_quantification'];
    case 'dfr_response':
      return ['process_paper_trail_attached', 'allegations_matched_to_complaint', 'no_admissions', 'counsel_review_required'];
  }
}

function getGrievanceModelTier(docType: GrievanceDocumentType): 'opus' | 'sonnet' {
  // Filings and referrals are short procedural documents; the brief and
  // a Board response are substantive advocacy.
  return docType === 'grievance_filing' || docType === 'referral_to_arbitration' ? 'sonnet' : 'opus';
}
