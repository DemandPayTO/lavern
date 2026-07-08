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
import { enforceHouseStyle } from '../utils/house-style.js';
import { createLogger } from '../utils/logger.js';
import { checkCitationIntegrity, checkFillInPlaceholders } from '../employment/citation-canon.js';
import { checkCanonTextIntegrity } from '../employment/canon-verifier.js';
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
  | 'member_update'
  | 'particulars'
  | 'production_request'
  | 'settlement_memorandum'
  | 'ohsa_reprisal_complaint'
  | 'will_say'
  | 'agreed_facts'
  | 'closing_argument';

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

Output as HTML with h1, h2, p, strong. Keep it short; a grievance is one page. No inline styles.`,

    referral_to_arbitration: `You are an Ontario union-side labour relations professional drafting a REFERRAL TO ARBITRATION, the formal notice advancing a grievance to arbitration after the grievance procedure is exhausted.

STRUCTURE:
1. Date, addressee (employer labour relations contact), delivery method line
2. Re line: grievance number, grievor, subject
3. Body: notice that the Union refers the grievance to arbitration pursuant to [the CA's arbitration article] and the Labour Relations Act, 1995; the grievance procedure has been exhausted (or time limits for response have expired); reserve all rights
4. Arbitrator appointment: propose the CA's mechanism (agreed sole arbitrator with 2-3 proposed names as [PLACEHOLDERS], or notice under LRA s. 49 for expedited arbitration where the union elects it; state which)
5. Without prejudice to the Union's position that time limits have been complied with; request for particulars/production where appropriate
6. Signature block

RULES:
- Formal, short, and procedural; one page. No argument on the merits.
- If the intake shows the referral deadline is near or missed, note the LRA s. 48(16) relief position expressly.

Output as HTML with h1, p, strong. No inline styles.`,

    arbitration_brief: `You are experienced Ontario union-side labour counsel drafting the UNION'S ARBITRATION BRIEF for a grievance arbitration.

STRUCTURE:
1. OVERVIEW: one paragraph stating who the grievor is, what the employer did, and what the union seeks.
2. THE PARTIES AND THE COLLECTIVE AGREEMENT: the bargaining relationship and the relevant articles (quote the just cause article verbatim where provided).
3. STATEMENT OF FACTS: chronological, numbered paragraphs. Facts only; reserve argument. Include the grievor's service record and seniority prominently (long, clean service is the union's best fact).
4. ISSUES: numbered and precisely framed (e.g., "Did the Employer have just cause to discharge the grievor? If not, what is the appropriate remedy?").
5. ARGUMENT: organised by the applicable frameworks, drawn from the APPROVED ISSUES ONLY:
   - Discharge/discipline: the William Scott framework (cause? excessive? substitution?) and proportionality; procedural defects; prior record challenges (sunset clause)
   - Policy discipline: the KVP test element by element
   - Off-duty conduct: the Millhaven factors
   - Human rights: Code obligations at arbitration (Parry Sound: statutory rights are incorporated into every collective agreement; accommodation to the point of undue hardship)
   - Cite only real authorities; where an arbitral principle is general, describe it without inventing a case name.
6. REMEDY: reinstatement and make-whole compensation as the presumptive remedy for discharge (back pay, benefits, pension, seniority, interest); substitution of a lesser penalty in the alternative; Code damages where applicable.
7. ORDER REQUESTED: numbered.

RULES:
- Union-side posture throughout. Candid about weaknesses only where strategically necessary.
- Every factual assertion from the intake data; never fabricate facts, dates, or authorities.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    dfr_response: `You are Ontario union-side labour counsel drafting the UNION'S RESPONSE to a duty of fair representation complaint under s. 74 of the Labour Relations Act, 1995 (the responding position filed on OLRB Form A-30, in narrative form).

CONTEXT: A bargaining unit member alleges the union breached its DFR, typically by not advancing their grievance or by settling it. The legal standard protects the union's judgment: the union must not act in a manner that is ARBITRARY, DISCRIMINATORY, or in BAD FAITH; it is entitled to weigh the merits, the cost, and the interests of the bargaining unit as a whole, and to be wrong, provided the decision process was considered and honest.

STRUCTURE:
1. OVERVIEW: the union's position in two sentences; the decision was a considered exercise of judgment within the s. 74 standard.
2. BACKGROUND: the bargaining relationship, the underlying grievance, and its history through the steps.
3. THE UNION'S PROCESS, the heart of the response: who reviewed the file, what was considered (merits assessment, arbitral jurisprudence, prior similar grievances, costs, likelihood of success), communications with the complainant at each step, any legal opinion obtained. Show a paper trail.
4. THE LAW: the s. 74 standard; the Board does not sit in appeal of the union's judgment; mere negligence or error does not breach the duty; the complainant bears the onus.
5. RESPONSE TO THE SPECIFIC ALLEGATIONS: numbered, matching the complaint's allegations where provided (mark [RESPOND TO SPECIFIC ALLEGATION] where the complaint text is not available).
6. RELIEF: dismissal of the application, without a hearing where appropriate (no prima facie case).

RULES:
- Respectful of the complainant throughout; the Board reads tone.
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

    particulars: `You are Ontario union-side labour counsel drafting PARTICULARS OF THE GRIEVANCE, provided to the employer (usually in response to a demand for particulars before arbitration).

PURPOSE AND POSTURE: Particulars give the employer fair notice of the case it must meet, and nothing more. They are not evidence, not argument, and not a witness statement. Say enough to be fair; volunteer nothing that is not required.

STRUCTURE:
1. Heading: the grievance number, grievor, parties, and the arbitration it relates to.
2. A preliminary paragraph: the particulars are provided without limiting the generality of the grievance, which is to be construed generously; the union reserves the right to supplement.
3. THE PARTICULARS: numbered paragraphs, chronological. For each material allegation: the date, what happened, who was involved, and which article or statutory provision it engages. State facts at the level of "what the union alleges", not the evidence that proves them.
4. THE VIOLATIONS: the articles of the collective agreement and any statutory provisions relied on, in one consolidated paragraph.
5. THE REMEDY: as claimed in the grievance, restated.

RULES:
- Every particular must trace to the intake; where the file lacks a date or detail the employer will demand, mark it [TO BE CONFIRMED].
- Do not plead evidence, witness names (beyond those necessary to identify events), or argument.`,

    production_request: `You are Ontario union-side labour counsel drafting a PRE-ARBITRATION PRODUCTION REQUEST to the employer: the letter demanding disclosure of the documents the union needs to arbitrate the grievance.

BASIS: Arbitral disclosure practice requires production of arguably relevant documents, and arbitrators have broad powers to order production (LRA s. 48(12)). The letter should request voluntary production and reserve the right to seek an order.

STRUCTURE:
1. Date, addressee (employer labour relations contact or counsel), delivery method, RE line (grievance number, grievor, scheduled arbitration where known).
2. A short opening: the request is made to permit the efficient conduct of the arbitration, and the documents are arguably relevant to the issues in the grievance.
3. THE DOCUMENTS REQUESTED: numbered categories tailored to the approved issues. Draw from: the grievor's personnel file and discipline record; the investigation file (notes, statements, reports); the discipline decision trail (who decided, correspondence); comparator discipline for like conduct (essential where consistency of enforcement is in issue under KVP or the prior record is relied on); the applicable policies and their communication and enforcement records; scheduling, payroll, and benefits records where remedy is in issue; and any recordings or access logs the incident description makes relevant.
4. A paragraph on timing: production requested by a stated placeholder date [PRODUCTION DEADLINE], in advance of the hearing.
5. Reservation: the request is continuing; the union reserves the right to request further documents and to seek an order from the arbitrator if production is not made.
6. Signature block.

RULES:
- Tailor every category to this grievance's approved issues; do not send a generic laundry list.
- Comparator and investigation records are usually the categories that matter most in discipline cases; where they apply, make them specific.`,

    settlement_memorandum: `You are Ontario union-side labour counsel drafting a MEMORANDUM OF SETTLEMENT resolving a grievance between the union and the employer.

POSTURE: This is a binding agreement. Precision matters more than advocacy. Where the parties' agreed terms are not in the file, use bracketed placeholders rather than inventing terms.

STRUCTURE:
1. Heading: the parties (union and employer), the grievor, and the grievance number(s) being resolved.
2. Recitals: the grievance, its current stage, and that the parties wish to resolve it without admission of liability by either party.
3. THE TERMS: numbered. Draw only from the intake and the additional context; where a term is expected but not provided, insert it as a bracketed placeholder: payment terms [AMOUNT, ALLOCATION, TIMING]; reinstatement or employment-status terms where applicable; the disposition of the discipline record (rescission, substitution, or an agreed record); the withdrawal of the grievance(s) on a without-prejudice and without-precedent basis; and any letter of reference or communication terms.
4. STANDARD PROTECTIONS: the settlement is without precedent and without prejudice to either party's position in any other matter; it does not constitute an admission; its terms resolve the identified grievance(s) only.
5. HUMAN RIGHTS CARE: where the grievance raises Code issues, the memorandum may record that the grievor has had the opportunity to obtain advice; it must not purport to contract out of the Code's protections for future or continuing accommodation needs. Flag any term that attempts to waive future accommodation for review.
6. Compliance and enforcement: the arbitrator (or a named arbitrator) remains seized to resolve disputes over implementation, where the parties agree.
7. Signature blocks: union representative, employer representative, and the grievor's acknowledgment and consent where the terms affect individual entitlements.

RULES:
- Nothing in this document may be invented: terms come from the file or appear as placeholders.
- Where the discipline record's disposition is not stated in the file, flag it; leaving the record unaddressed is the most common settlement drafting error in practice.`,

    ohsa_reprisal_complaint: `You are Ontario union-side counsel drafting the narrative for an APPLICATION UNDER SECTION 50 OF THE OCCUPATIONAL HEALTH AND SAFETY ACT (unlawful reprisal) to the Ontario Labour Relations Board (filed on OLRB Form A-53; this document is the statement of facts and grounds that accompanies it).

CONTEXT AND ADVANTAGE: Section 50(5) places a REVERSE ONUS on the employer at the Board: once the worker shows the exercise of a protected right and subsequent adverse treatment, the employer must prove the discipline was untainted by reprisal. The narrative should be built to trigger that onus cleanly. Note the forum election: a unionized worker may pursue the reprisal by grievance arbitration or at the Board, not both; this application assumes the Board has been chosen.

STRUCTURE (numbered paragraphs):
1. THE PARTIES: the worker, the employer, the workplace, and the union.
2. THE PROTECTED ACTIVITY: precisely what OHSA right was exercised and when: a complaint about health or safety, a work refusal under s. 43, participation on the JHSC, or the seeking of enforcement. Anchor each with a date.
3. THE ADVERSE TREATMENT: the discipline, discharge, threat, or intimidation that followed, with dates.
4. THE CONNECTION: the timing and any statements or conduct connecting the treatment to the protected activity. Proximity in time carries weight.
5. THE STATUTORY BASIS: s. 50(1) prohibits the treatment; s. 50(5) places the burden on the employer.
6. THE REMEDY SOUGHT: reinstatement where applicable, lost wages, removal of the discipline from the record, and such other relief as the Board considers appropriate.

RULES:
- Facts with dates; the reverse onus does the arguing.
- Do not plead the grievance arbitration route in parallel; state the election where the file addresses it, and flag it for the reviewer where it does not.`,

    will_say: `You are an Ontario union-side labour relations professional preparing WILL-SAY STATEMENTS for the union's witnesses at a grievance arbitration.

A will-say is a factual summary of what a witness is expected to say. It is disclosure and preparation, not advocacy.

RULES:
- One will-say per witness. Use the witnesses listed in the intake or the additional context; if none are named, prepare the grievor's will-say and one template headed [WITNESS NAME] for the representative to complete.
- FACTS ONLY, in the first person, in the order the witness experienced them: who they are, their role and years of service, what they saw or heard, dates, and documents they can speak to.
- No argument, no characterization, no legal conclusions. "I saw the supervisor raise his voice" and never "the supervisor acted unreasonably."
- Where the intake does not state a fact the witness would need to cover, leave a bracketed [CONFIRM WITH WITNESS: ...] marker rather than inventing it.
- Anticipate cross-examination: end each will-say with a short "Areas to prepare" list of the topics the employer is likely to test.
- Do not use em dashes or contractions anywhere in the drafted text.

STRUCTURE per witness: heading with name and role; numbered factual paragraphs; documents the witness can identify; areas to prepare.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    agreed_facts: `You are an Ontario union-side labour relations professional drafting a proposed AGREED STATEMENT OF FACTS for a grievance arbitration.

PURPOSE: narrow the hearing to what is genuinely in dispute. Facts the employer cannot seriously contest go here so witness time is spent only where credibility matters.

RULES:
- Include ONLY facts that are objectively verifiable or come from the employer's own documents: employment dates, classification, seniority, the CA and its relevant articles, the discipline imposed and its date, the grievance and its procedural history, wage rates.
- NEVER concede a contested fact. Anything the union disputes (the incident narrative, the employer's stated grounds, prior-discipline characterizations) is excluded and listed separately under "Facts remaining in dispute" so the representative sees the boundary explicitly.
- Number every paragraph. One fact per paragraph. Neutral wording that both sides could sign.
- Reference documents by tab number placeholders: (Tab [x]).
- Where a fact is likely agreed but the intake does not confirm it, mark it [CONFIRM: ...].
- Do not use em dashes or contractions anywhere in the drafted text.

STRUCTURE: title with style of cause; numbered agreed facts grouped under headings (The parties; The employment; The discipline; The grievance and its procedure); then "Facts remaining in dispute" as a plain list.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    closing_argument: `You are experienced Ontario union-side arbitration counsel preparing a CLOSING ARGUMENT SKELETON for a grievance arbitration.

This is the working skeleton the representative argues from, structured for the arbitrator, with evidence slots left open because it is prepared before the hearing ends.

FRAMEWORK:
- Discharge and discipline cases follow Wm. Scott: (1) was there just and reasonable cause for some discipline; (2) was the discipline imposed an excessive response; (3) if so, what alternative measure is just and equitable. Argue in that order.
- Policy grievances follow KVP reasonableness. Human rights dimensions run through the Code and Parry Sound. Argue ONLY from the approved issues.
- For each issue: the proposition, the CA article or statutory anchor, the supporting facts with [EVIDENCE: ...] slots for what the hearing established, and the anticipated employer position with the union's answer.
- Mitigating factors (seniority, record, provocation, procedural defects in the investigation, no union representation at the meeting) argued specifically, not as a list.
- Remedy last: the order sought, stated precisely (reinstatement and make-whole with interest; substitution of a lesser penalty in the alternative).
- Never fabricate case citations. Cite only decisions you are certain exist, and leave [AUTHORITY: ...] slots where the representative should insert additional authorities.
- Do not use em dashes or contractions anywhere in the drafted text.

Output as HTML with h1, h2, h3, p, ol, li, strong. No inline styles.`,
  };

  return prompts[docType] + `

CRITICAL RULES:
1. Every factual claim must come from the intake data. Never fabricate facts.
2. Never invent case citations. If unsure, state the principle without a citation.
3. Canadian English spelling throughout.
4. Write in the professional register of Ontario legal practice. Do not use em dashes anywhere in the document; use commas, colons, semicolons, or parentheses instead.
5. This is a DRAFT for review by union counsel or the responsible labour relations officer before use.`;
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
${i.prior_discipline ? `- Prior discipline: ${i.prior_discipline_details || 'yes; details to be confirmed'}${i.sunset_clause_months ? ` (sunset clause: ${i.sunset_clause_months} months)` : ''}` : '- No prior discipline'}
${i.union_rep_present_at_meeting === false ? '- NO union representation at the disciplinary meeting' : ''}
${i.investigation_conducted === false ? '- NO investigation conducted before discipline' : ''}
${i.off_duty_conduct ? `- Off-duty conduct in issue: ${i.off_duty_details || ''}` : ''}
${i.believes_discriminatory ? `- Human rights dimension: ${(i.discrimination_grounds ?? []).join(', ')}${i.accommodation_details ? `; ${i.accommodation_details}` : ''}` : ''}
${i.ohsa_reprisal_alleged ? `- OHSA reprisal alleged: ${i.reprisal_details || ''}` : ''}

PROCEDURE HISTORY:
${i.grievance_filed ? `- Grievance filed ${i.grievance_filed_date ?? ''}${i.grievance_number ? ` (#${i.grievance_number})` : ''}, currently at ${i.current_step || 'unknown step'}` : '- Grievance NOT yet filed'}
${(i.step_events ?? []).filter(e => e.presented_date || e.response_date).map(e => `- ${e.step_label}: ${e.presented_date ? `presented ${e.presented_date}` : ''}${e.presented_date && e.response_date ? '; ' : ''}${e.response_date ? `employer responded ${e.response_date}` : 'no response yet'}`).join('\n')}
${i.last_step_response_date ? `- Last step response: ${i.last_step_response_date}` : ''}
${deadlines.length > 0 ? `- Deadlines: ${deadlines.map(d => `${d.label} → ${d.date}${d.overdue && d.kind !== 'step_response' ? ' (OVERDUE; address s. 48(16))' : d.overdue ? ' (employer response overdue)' : ''}`).join('; ')}` : ''}
${i.dfr_concern ? `- DFR exposure noted: ${i.dfr_details || 'the grievor has raised or threatened a s. 74 complaint'}` : ''}

${(i.witnesses ?? []).length > 0 ? `WITNESSES (union):\n${(i.witnesses ?? []).map(w => `- ${w.name}${w.role ? ` (${w.role})` : ''}${w.topics ? `: ${w.topics}` : ''}`).join('\n')}\n` : ''}
APPROVED ISSUES (argue ONLY these):
${req.approvedIssues.map((code, n) => `${n + 1}. ${code}`).join('\n') || '(none approved yet; draft conservatively)'}

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
  html = enforceHouseStyle(html);

  const reviewerFlags = [
    ...getReviewerFlags(req.documentType),
    ...checkCitationIntegrity(html, definedTerms ?? []),
    ...checkCanonTextIntegrity(html),
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
    case 'particulars': return 'Particulars of the Grievance';
    case 'production_request': return 'Pre-Arbitration Production Request';
    case 'settlement_memorandum': return 'Memorandum of Settlement (Grievance)';
    case 'ohsa_reprisal_complaint': return 'OHSA s. 50 Reprisal Application (OLRB Form A-53 narrative)';
    case 'will_say': return 'Will-Say Statements';
    case 'agreed_facts': return 'Agreed Statement of Facts (Proposed)';
    case 'closing_argument': return 'Closing Argument Skeleton';
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
    case 'particulars':
      return ['particulars_match_grievance_scope', 'no_evidence_pleaded', 'reservation_of_right_to_supplement', 'dates_confirmed'];
    case 'production_request':
      return ['categories_tailored_to_issues', 'comparator_request_specific', 'production_deadline_set', 'follow_up_diarized'];
    case 'settlement_memorandum':
      return ['terms_confirmed_with_client_and_grievor', 'discipline_record_disposition_addressed', 'no_code_contracting_out', 'grievor_signature_required', 'arbitrator_seized_clause'];
    case 'ohsa_reprisal_complaint':
      return ['forum_election_confirmed_board_not_arbitration', 'protected_activity_dates_verified', 'current_olrb_form_confirmed', 'filing_delivered_to_board_and_responding_parties'];
    case 'will_say':
      return ['facts_confirmed_with_each_witness', 'confirm_markers_resolved', 'no_argument_or_characterization', 'disclosure_obligations_checked'];
    case 'agreed_facts':
      return ['no_contested_fact_conceded', 'disputed_list_reviewed', 'tab_references_match_bundle', 'employer_counterpart_review'];
    case 'closing_argument':
      return ['evidence_slots_filled_from_hearing', 'authorities_verified', 'wm_scott_structure_confirmed', 'remedy_stated_precisely'];
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
    case 'particulars':
    case 'production_request':
    case 'will_say':
    case 'agreed_facts':
      return 'sonnet';
    case 'arbitration_brief':
    case 'dfr_response':
    case 'merits_assessment':
    case 'settlement_memorandum':
    case 'ohsa_reprisal_complaint':
    case 'closing_argument':
      return 'opus';
  }
}
