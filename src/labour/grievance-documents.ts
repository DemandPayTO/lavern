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
  | 'dfr_response'
  | 'merits_assessment'
  | 'decline_letter'
  | 'member_update';

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

    merits_assessment: `You are experienced Ontario union-side labour counsel preparing a MERITS ASSESSMENT MEMORANDUM on a grievance, for the union's grievance committee or the responsible labour relations officer. This memorandum is the considered-judgment record that protects the union under s. 74 of the Labour Relations Act, 1995: the decision whether to advance the grievance may be right or wrong, but it must be honest, considered, and documented. Write it accordingly.

STRUCTURE:
1. RE line and date; state that the memorandum is prepared for the union's internal deliberations and is privileged.
2. QUESTION PRESENTED. Whether the union should advance the grievance to the next step or to arbitration, settle, or decline to proceed.
3. SUMMARY OF ASSESSMENT. Two or three sentences stating the recommendation and the principal reasons.
4. FACTS. Chronological and neutral. Distinguish established facts from allegations. Mark anything unverified as [TO BE CONFIRMED].
5. ANALYSIS. Apply only the frameworks raised by the APPROVED ISSUES: William Scott for discipline and discharge; KVP for rules and policies; Millhaven for off-duty conduct; the Human Rights Code and Parry Sound where a Code dimension arises; procedural and time-limit questions including s. 48(16) where relevant. For each issue, state the union's best position, the employer's likely response, and an assessment of relative strength in qualitative terms (strong, arguable, weak). Do not express numeric probabilities.
6. EVIDENCE. What the file contains, what is missing, and what must be obtained before hearing.
7. REMEDY PROSPECTS. What an arbitrator could realistically award, including reinstatement and make-whole for discharge, substitution of a lesser penalty, or compliance relief for a policy grievance.
8. CONSIDERATIONS BEYOND THE MERITS. Cost and length of arbitration, the interests of the bargaining unit as a whole, precedential effect on the agreement, and the grievor's circumstances. These are legitimate considerations under s. 74 and should be stated openly.
9. DUTY OF FAIR REPRESENTATION. Note the s. 74 standard, and record the process followed: who reviewed the file, what was considered, and how the grievor has been kept informed.
10. RECOMMENDATION. State it plainly, with conditions or alternatives where the facts warrant. The recommendation is subject to the committee's decision and, where applicable, review by counsel.

RULES:
- Candour is the point of this document. State weaknesses plainly; an assessment that overstates the case protects no one.
- Every fact from the intake data. Never invent facts, dates, or authorities. Where an arbitral principle is general, state it without inventing a case name.`,

    decline_letter: `You are drafting, for union counsel or the responsible labour relations officer, a LETTER TO THE GRIEVOR advising that the union has decided not to advance the grievance (to the next step or to arbitration, as the context indicates). This letter is part of the union's duty of fair representation record: it must show that the decision was considered, honest, and communicated with reasons.

STRUCTURE:
1. Date, delivery method, RE line identifying the grievance.
2. The decision, stated plainly and early. Do not bury it.
3. The process. What the union reviewed: the grievance file, the collective agreement, the investigation, comparable cases and arbitral outcomes, and any legal opinion obtained (where the intake indicates one).
4. The reasons. Explain in plain language why the grievance is not being advanced, drawing on the file. Acknowledge the grievor's position respectfully before explaining the assessment.
5. What was weighed. Note that the union must weigh the merits, the evidence, the cost of arbitration, and the interests of the bargaining unit as a whole.
6. Next steps. The internal avenue of appeal or review available under the union's constitution or bylaws, marked as [CONFIRM APPEAL ROUTE UNDER THE UNION'S CONSTITUTION], and any applicable internal deadline as [CONFIRM INTERNAL DEADLINE].
7. An invitation to contact the representative with questions, and a closing that is respectful of the grievor.

RULES:
- Respectful and plain throughout. The grievor is a member the union continues to represent.
- Do not disparage the grievor's position, and do not overstate the weaknesses of the case; state the assessment soberly.
- Make no admissions about the union's process. Where the intake reveals a gap in the process, do not paper over it; mark it [REVIEW: PROCESS GAP] for the reviewer.
- Do not give the grievor legal advice about claims against the union; if the letter must reference the right to complain to the Ontario Labour Relations Board, state it neutrally.`,

    member_update: `You are drafting, for union counsel or the responsible labour relations officer, a STATUS UPDATE LETTER to the grievor about their grievance. Regular, documented updates at each stage are both good representation and the union's protection under s. 74 of the Labour Relations Act, 1995.

STRUCTURE:
1. RE line identifying the grievance.
2. Where the grievance stands: the current step, what has happened since the last update, and any employer response received.
3. What happens next: the next procedural step and any dates the intake discloses, including deadlines on the union's docket.
4. What the union is doing, stated concretely.
5. Anything needed from the grievor (documents, availability, updated contact or employment information), or a statement that nothing is needed at this time.
6. An invitation to contact the representative with questions.

RULES:
- Plain language; the reader is a bargaining unit member, not a lawyer.
- Report the status accurately; make no predictions about the outcome and no promises.
- Keep it to one page.`,
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
${(i.step_events ?? []).filter(e => e.presented_date || e.response_date).map(e => `- ${e.step_label}: ${e.presented_date ? `presented ${e.presented_date}` : ''}${e.presented_date && e.response_date ? '; ' : ''}${e.response_date ? `employer responded ${e.response_date}` : 'no response yet'}`).join('\n')}
${i.last_step_response_date ? `- Last step response: ${i.last_step_response_date}` : ''}
${deadlines.length > 0 ? `- Deadlines: ${deadlines.map(d => `${d.label} → ${d.date}${d.overdue && d.kind !== 'step_response' ? ' (OVERDUE — address s. 48(16))' : d.overdue ? ' (employer response overdue)' : ''}`).join('; ')}` : ''}
${i.dfr_concern ? `- DFR exposure noted: ${i.dfr_details || 'the grievor has raised or threatened a s. 74 complaint'}` : ''}

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
    case 'merits_assessment': return 'Merits Assessment Memorandum';
    case 'decline_letter': return 'Letter to Grievor: Decision Not to Advance';
    case 'member_update': return 'Grievor Status Update';
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
    case 'merits_assessment':
      return ['facts_verified_against_file', 'assessment_reviewed_by_decision_maker', 'grievor_communications_documented', 'keep_privileged_internal'];
    case 'decline_letter':
      return ['reasons_match_merits_assessment', 'appeal_route_confirmed', 'internal_deadline_confirmed', 'decision_maker_signoff'];
    case 'member_update':
      return ['status_accurate_against_file', 'dates_match_docket', 'copy_retained_on_file'];
  }
}

function getGrievanceModelTier(docType: GrievanceDocumentType): 'opus' | 'sonnet' {
  // Short procedural documents and member correspondence run on sonnet;
  // substantive advocacy and the merits assessment run on opus.
  switch (docType) {
    case 'grievance_filing':
    case 'referral_to_arbitration':
    case 'decline_letter':
    case 'member_update':
      return 'sonnet';
    case 'arbitration_brief':
    case 'dfr_response':
    case 'merits_assessment':
      return 'opus';
  }
}
