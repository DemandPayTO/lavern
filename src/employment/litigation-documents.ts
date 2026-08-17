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

import fs from 'node:fs';
import { enforceHouseStyle } from '../utils/house-style.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import { pronounInstruction } from './house-form.js';
import type { EmploymentIntakeData, IntakeAnalysisResult, SourceCitation } from '../types/employment-intake.js';
import { extractCitations } from './citation-extractor.js';
import { checkCitationIntegrity, checkFillInPlaceholders } from './citation-canon.js';
import { checkCanonTextIntegrity } from './canon-verifier.js';
import { computeBardalFactors } from './timeline-generator.js';
import { buildAffidavitOfService, buildOfferWithdrawal, buildOfferAcceptance, buildCostsOutline, buildEsaFilingSheet, buildSccFilingSheet } from './court-forms.js';
import type { CourtFormFields } from './court-forms.js';
import { buildMediationFrontMatter, buildMediationCover, buildMediationSignOff, numberNarrativeParagraphs, scrubNarrative, esc } from './mediation-brief-tables.js';
import { buildAffidavitOpening, buildJurat, buildExhibitBlock, scrubAffidavitBody } from './affidavit-furniture.js';
import type { ComparableCase, CaseBasedRange } from './case-comparables.js';
import type { NegotiationEntry } from './negotiation.js';

const logger = createLogger('LITIGATION-DOCS');

// ── Types ────────────────────────────────────────────────────────────────

export type LitigationDocumentType =
  | 'discovery_plan'
  | 'affidavit_of_documents'
  | 'motion_affidavit'
  | 'mediation_brief'
  | 'severance_assessment'
  | 'counter_offer'
  | 'rebuttal_letter'
  | 'reply'
  | 'rule49_offer'
  | 'settlement_minutes'
  | 'retainer_agreement'
  | 'mitigation_log'
  | 'settlement_conference_brief'
  | 'hrto_schedule_a'
  | 'notice_of_action'
  | 'notice_of_arbitration'
  | 'sj_notice_of_motion'
  | 'sj_affidavit'
  | 'sj_factum'
  | 'sp_timetable_motion'
  | 'consent_timetable_order'
  | 'timetable_order'
  | 'undertakings_answers'
  | 'affidavit_of_service'
  | 'rule49_withdrawal'
  | 'rule49_acceptance'
  | 'costs_outline'
  | 'esa_filing_sheet'
  | 'scc_filing_sheet';

export interface LitigationDocumentRequest {
  intake: EmploymentIntakeData;
  approvedIssues: string[];
  analysis: IntakeAnalysisResult;
  documentType: LitigationDocumentType;
  /**
   * The positions already served in this matter (the demand letter, the
   * statement of claim), as text. The mediation brief must tell the same
   * story and take the same positions as these documents.
   */
  positionDocuments?: Array<{ title: string; text: string }>;
  /** Firm style depth: typical word count learned from the precedents. Scales the output budget. */
  styleTypicalWords?: number;
  /** Firm opening-table row labels from the style profile (mediation brief). */
  styleProfileTableRows?: string[] | null;
  /** The firm's own section headings from the style profile flow; when present they replace the pinned h2 list. */
  styleFlowHeadings?: string[] | null;
  /** Which procedure the action is under; the timetable motion adapts. */
  procedureType?: 'simplified' | 'ordinary';
  /** Affidavit furniture inputs (motion_affidavit). */
  affidavit?: import('./affidavit-furniture.js').AffidavitFurnitureInput & {
    exhibits?: Array<{ letter?: string; description: string }>;
    title?: string;
  };
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
  /** sj_factum only: the firm's argument sections for Part III, selected from
   *  the factum argument library by the matter's approved issues. The model
   *  writes Part III following these; it does not invent argument outside them. */
  factumArgumentGuidance?: string;
  /** mediation_brief only: the narrative assembled from the lawyer's approved
   *  section-by-section drafts. When present the model is not called; this
   *  narrative is wrapped in the deterministic cover, tables, and sign-off. */
  mediationNarrativeOverride?: string;
  /** Structured inputs for the deterministic court forms (service details,
   *  offer dates, costs figures). Each builder validates its own fields. */
  formFields?: CourtFormFields;
  /** Mediation brief only: comparables from the case library and the matter's
   *  negotiation ledger, loaded by the route. Rendered into deterministic
   *  front-matter tables; the model never touches these numbers. */
  comparables?: ComparableCase[] | null;
  comparableRange?: CaseBasedRange | null;
  negotiationEntries?: NegotiationEntry[] | null;
  negotiationSummary?: import('./negotiation.js').NegotiationSummary | null;
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
1. DOCUMENTS TO REQUEST from the defendant (Rule 30.02: request to produce):
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
- Reference the Ontario Rules of Civil Procedure by rule number
- Be specific: name exact document categories and question topics
- Tailor everything to the specific approved issues in this case
- Canadian English spelling throughout

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    affidavit_of_documents: `You are a senior Ontario litigation lawyer preparing an Affidavit of Documents (Form 30A/30B) for a wrongful dismissal action.

The Affidavit of Documents contains four schedules:

SCHEDULE A: Documents favourable to the party's case.
List every document that supports the plaintiff's claims. For each:
- Document number (sequential)
- Description of the document
- Date of the document

SCHEDULE B: Documents unfavourable to the party's case.
List documents that may undermine the plaintiff's position. The duty of disclosure requires listing these. For each:
- Document number (continuing from Schedule A)
- Description
- Date

SCHEDULE C: Documents over which privilege is claimed.
List privileged documents (solicitor-client privilege, litigation privilege). For each:
- Document number
- Brief description (without revealing content)
- Type of privilege claimed

SCHEDULE D: Documents no longer in the party's possession.
List relevant documents the party once had but no longer possesses. For each:
- Document number
- Description
- Date last in possession
- Who now has the document (if known)

RULES:
- Base the schedules on the client's uploaded documents and intake facts
- Be thorough; omitting a relevant document is a serious professional obligation issue
- The affidavit must include a sworn statement that the list is complete
- Reference Rule 30.03 (obligation to disclose)
- Canadian English spelling throughout

Output as HTML with h1, h2, tables, and structured lists. No inline styles.`,

    motion_affidavit: `You are a senior Ontario employment litigation lawyer drafting the BODY of an affidavit in support of a motion.

IMPORTANT: The opening block (who is swearing, in what capacity, on what knowledge basis), the jurat, the exhibit index and the exhibit stamps are added automatically. Do NOT write any of them. In particular do NOT open with "I am the solicitor for the plaintiff" or "I have personal knowledge of the matters deposed to": those paragraphs already exist above yours and repeating them reads as carelessness in a sworn document. Do not write "I, [name], MAKE OATH AND SAY", do not write a jurat, do not write "SWORN BEFORE ME", and do not number your paragraphs (numbering is applied automatically). Begin with the first substantive paragraph.

WHAT AN AFFIDAVIT IS: evidence, not argument. Facts the deponent can swear to, in short numbered paragraphs, in chronological order. No submissions, no characterisation of the other side's conduct, no legal conclusions. If a proposition needs argument, it belongs in the factum, not here.

STRUCTURE:
1. The background the motion needs: the action, the parties, the step the motion concerns, and the dates that matter, drawn from the matter record.
2. What has happened on the point, in order: what was requested, when, of whom, and what response came back. Where correspondence is relied on, refer to it as an exhibit ("attached as Exhibit "A" is a copy of my letter to opposing counsel dated ...").
3. Why the relief is needed, expressed as FACTS: what remains outstanding, what the consequence of the delay is. Never as argument.
4. A closing paragraph in the conventional form: that the affidavit is made in support of the motion and for no improper purpose.

RULES:
- Only facts the deponent could actually swear to. Where a fact comes from another person or a document, say so in the paragraph itself.
- Do not invent correspondence, dates, or exhibits. Where the record does not supply something the affidavit needs, write "[LAWYER: ...]" naming what is required.
- Do not plead law or cite cases.
- One fact per paragraph, two to four sentences.
- Canadian English. No em dashes.

Output as HTML with <p> for each paragraph, <strong> only where a defined term needs it. No headings, no tables, no inline styles.`,

    mediation_brief: `You are a senior Ontario employment lawyer preparing a plaintiff's mediation brief for mandatory mediation under Rule 24.1. You are writing a persuasive narrative, not filling out Form 24.1C, and not reciting a pleading. The true audience is the opposing party and its counsel; the mediator is being educated. This design follows the published guidance of Ontario's leading employment mediators (Fisher, Rudner, Rose).

IMPORTANT: The document may begin with deterministic tables prepared from the matter record; the user message names EXACTLY which are present under "TABLES ALREADY IN THE DOCUMENT". Do NOT reproduce those tables, do NOT restate their numbers in detail, and do NOT output an h1 title. Refer only to tables that list names; never refer to a table the list does not contain. Begin directly with the first h2 section.

{{SECTION_INSTRUCTION}}

1. OVERVIEW: Two or three sentences: who the plaintiff is, what happened, and what this case is really about. A mediator should understand the case from this paragraph alone.

2. FACTUAL BACKGROUND: Chronological narrative of the employment relationship, the dismissal, and post-termination events. State facts, not arguments. Keep it tight; facts that do not move the assessment do not belong.

3. ISSUES IN DISPUTE: Each live issue with the plaintiff's position AND the anticipated defence position, stated fairly. Do not argue settled law: no Bardal quotation, no recitation of principles every employment lawyer knows. The comparable cases above carry the notice-range argument. Spend legal analysis only on genuinely contested questions (for example an enforceability challenge to a termination clause).

4. RESPONSE TO ANTICIPATED DEFENCES: Address the real weaknesses head-on and first. If just cause is alleged, put the plaintiff's version on the table squarely; ignoring it costs credibility when the defence brief raises it. Where a position is weak, be candid; where a defence position is weak, say why calmly.

5. MITIGATION: Summarize the plaintiff's mitigation efforts and any earnings to date. If a mitigation log or chart exists, refer to it as an attachment. Never overstate.

6. SETTLEMENT POSITION: Tie the numbers to the litigation alternative: where the action stands, what steps and costs lie ahead for both sides, and why resolving now beats that alternative. Present the plaintiff's realistic range grounded in the damages table and comparable cases, with statutory entitlements as the floor. Realistic, not aspirational. If the negotiation history above shows no real negotiations, acknowledge that honestly.

7. MEDIATION OBJECTIVES: What the plaintiff seeks, monetary and non-monetary (reference letter, benefits continuation, non-disparagement, tax structuring of the settlement).

8. PRACTICAL CONSIDERATIONS: Anything that genuinely bears on settlement (limitation or scheduling pressure, cost exposure, the client's circumstances and desire for closure).

RULES:
- CONCISE. The narrative must not exceed roughly 2,000 words; mediators say they stop absorbing long briefs. Every sentence earns its place.
- SHORT NUMBERED PARAGRAPHS: one point per paragraph, two to four sentences, each in its own <p>. NEVER merge several points into one long paragraph; the paragraphs are numbered and cited by number, so a merged paragraph breaks the convention counsel relies on. Do NOT write paragraph numbers yourself; numbering is applied automatically after generation.
- THE FURNITURE IS NOT YOURS TO WRITE: the cover page (parties, title, counsel), the closing (ALL OF WHICH IS RESPECTFULLY SUBMITTED, the signature block), and any party block are added automatically. NEVER write any of them, anywhere, even if the source materials or the firm's precedents contain them. The narrative begins at the first section heading and ends with the final section's last substantive paragraph.
- NO PSEUDO-HEADINGS: never open a paragraph with a bold phrase standing in for a heading. Structure comes from the <h2> sections only; within a section, plain prose.
- Candid about weaknesses; mediators reward honest assessments and discount inflated ones.
- Credible, measured register. Inflammatory language impedes settlement.
- Do not fabricate facts, offers, or mitigation details not provided. If something material is unknown, note it for counsel in square brackets [LAWYER: ...].
- Canadian English spelling throughout.

Output as HTML with h2, p, ol, li, strong only. No h1, no tables, no inline styles.`,

    severance_assessment: `You are a senior Ontario employment lawyer preparing a SEVERANCE OFFER ASSESSMENT: an internal advice memo comparing the employer's severance offer against the client's statutory and common law entitlements.

STRUCTURE:

Emit each numbered section below as an <h2> heading using the EXACT wording
given (without the number), so the memo can be placed into a firm template
section by section.

1. THE OFFER: What the employer has offered (weeks/amount, payment structure, deadline to accept, release required), stated plainly.

2. THE STATUTORY FLOOR: ESA termination pay and (if eligible) severance pay. The offer can NEVER lawfully be below this floor; if it is, say so prominently.

3. THE COMMON LAW RANGE: Reasonable notice under Bardal (age, length of service, character of employment, availability of similar employment), expressed in months and dollars, including compensation beyond base salary (bonus, commissions, benefits, pension) through the notice period per Matthews v Ocean Nutrition.

4. TERMINATION CLAUSE ANALYSIS: Does a termination clause purport to limit entitlements? Assess enforceability (Waksdale, Machtinger, De Castro). If the clause is likely void, the common law range governs the negotiation.

5. THE GAP: A simple table: offer vs. ESA floor vs. common law low vs. common law high. State the shortfall in dollars.

6. OTHER FACTORS: Deadline pressure (an offer deadline should never rush the client into an ill-considered decision: ESA entitlements do not expire with the offer), release scope, benefits continuation, reference letter, mitigation obligations and clawback structures, tax treatment options (salary continuance vs lump sum, allocation, RRSP transfer eligibility for retiring allowance where applicable; flag for accountant confirmation).

7. RECOMMENDATION: One of: ACCEPT (rare; explain why the offer is adequate), COUNTER (state the recommended counter range and rationale), or LITIGATE (when the gap and facts justify it). Give next steps and what further information would sharpen the assessment.

RULES:
- This is an internal memo for the lawyer and client: candid, plain language, numbers first.
- Never advise accepting anything below the ESA floor.
- Flag any deadline within 14 days as urgent.

Output as HTML with h1, h2, p, ol, li, strong, and a comparison table. No inline styles.`,

    counter_offer: `You are a senior Ontario employment lawyer drafting a COUNTER-OFFER LETTER to the employer's counsel (or HR, if unrepresented) in response to a severance offer, on behalf of a terminated employee.

STRUCTURE:

1. HEADER: "WITHOUT PREJUDICE" prominently. Date, addressee, re-line (client name, former employer).

2. ACKNOWLEDGMENT: Confirm receipt of the offer and its terms (weeks/amount, deadline) accurately and neutrally.
   Emit sections 2 to 5 as <h2> headings using the EXACT wording given
   (without the number), so the letter can be placed into a firm template
   section by section.

3. WHY THE OFFER IS INADEQUATE: The entitlements analysis: ESA floor, then the common law reasonable notice range under Bardal with the client's specific factors; compensation components beyond salary (Matthews v Ocean Nutrition for bonus/commission/equity through notice); termination clause enforceability where applicable (Waksdale line). Cite only real authorities.

4. THE COUNTER-POSITION: State the counter amount clearly, with its composition (months of notice, benefits continuation, bonus, reference letter, legally required minimums paid regardless). Explain briefly why it reflects a reasonable settlement discount from full entitlements.

5. TERMS: Response deadline, willingness to discuss, reservation of rights (including the right to commence proceedings and that limitation periods continue to run), no admission.

RULES:
- Professional and firm in tone: this letter is designed to advance the negotiation, not to inflame it.
- Every factual claim must come from the intake data. Never invent case citations.
- The counter amount is the claim amount provided in the filing details.
- Canadian spelling.

Output as HTML with h1, h2, p, strong. Letter format, no tables. No inline styles.`,

    rebuttal_letter: `You are a senior Ontario employment lawyer drafting a LETTER TO OPPOSING COUNSEL answering their response to your demand letter, on behalf of a terminated employee. Their letter is provided in the source documents. Your client's instructions arrive as drafting direction and override everything else.

STRUCTURE:

1. HEADER: "WITHOUT PREJUDICE" prominently. Date, addressee, re-line (client name, former employer).

2. ACKNOWLEDGMENT: One sentence confirming receipt of their letter by its date. No summary of it.
   Emit sections 2 to 5 as <h2> headings using the EXACT wording given
   (without the number), so the letter can be placed into a firm template
   section by section.

3. THE POINTS THAT REQUIRE CORRECTION: Take each substantive assertion in their letter that is wrong on the facts or the law and answer it in one short paragraph: state their assertion accurately in a clause, then the correction, grounded in the intake facts or the client's instructions. Where their letter mischaracterizes a document, say what the document says. Do NOT respond to rhetoric, only to substance. Where their point cannot be answered from the record, write "[LAWYER: their assertion that ... is not answered by the file]" rather than inventing an answer.

4. THE POSITION MAINTAINED: Restate the client's position and entitlements briefly. Do not re-argue the whole demand letter: assert, do not argue. Where their letter contained an offer, address it in one paragraph (accepted, rejected, or countered per the direction).

5. TERMS: Response deadline, reservation of rights, limitation periods continue to run, no admission.

RULES:
- One to three pages. Less is more: every paragraph earns its place.
- Never concede a point unless the direction says to.
- Every factual statement must come from the intake data, the source documents, or the direction. Never invent case citations.
- Characterize their letter accurately: paraphrase tightly or quote exactly. A rebuttal that misstates what it rebuts loses the reader.
- Professional and firm. This letter advances the file, it does not inflame it.
- Canadian spelling.

Output as HTML with h1, h2, p, strong. Letter format, no tables. No inline styles.`,

    reply: `You are a senior Ontario litigation lawyer drafting the pleading paragraphs of a REPLY (Form 25A) under Rule 25.08 of the Rules of Civil Procedure, on behalf of the Plaintiff in a wrongful dismissal action.

PURPOSE AND DISCIPLINE:
A Reply responds ONLY to new matters raised in the Statement of Defence that the Plaintiff must answer: allegations of just cause particulars, failure to mitigate, after-acquired cause, set-off claims, or limitation defences. Everything in the Defence not admitted is already deemed denied; do NOT restate the claim, do NOT plead new causes of action, and keep it SHORT. An overlong Reply reflects poorly on the drafter.

THE COURT SHELL IS NOT YOURS TO WRITE. The system assembles the general heading, the title, the date line, the lawyer block, the TO: block, and the backsheet after you draft, and it numbers the paragraphs mechanically. You write ONLY the pleading paragraphs.

STRUCTURE (Form 25A):
First, the form's canonical opening paragraphs, each in its own <p>, in this order, drawn from the Defence in front of you. Include only the ones that apply; omit any that has no paragraphs to cite:
- "The Plaintiff admits the allegations contained in paragraphs [list the paragraph numbers] of the Statement of Defence." (allegations that are true and safe to admit: formal matters, party descriptions, dates the Plaintiff does not dispute)
- "The Plaintiff denies the allegations contained in paragraphs [list the paragraph numbers] of the Statement of Defence." (the contested substance: cause allegations, mitigation allegations, and every paragraph the responsive paragraphs below answer)
- "The Plaintiff has no knowledge in respect of the allegations contained in paragraphs [list the paragraph numbers] of the Statement of Defence." (matters within the Defendant's knowledge only)
Where you cannot confidently sort a paragraph of the Defence, place it in the denial paragraph and add one inline marker: [LAWYER: confirm paragraphs admitted and denied against the Defence].

Then, for each NEW matter being answered: separate paragraphs pleading each allegation of material fact relied on by way of reply, citing the Defence paragraph being answered (e.g. "In reply to paragraph 14 of the Statement of Defence, ..."). State the material facts (mitigation efforts made; why the alleged cause fails McKinley proportionality; why the limitation defence fails), one allegation of material fact per paragraph, short paragraphs.

FORMAT RULES:
- Output ONLY <p> paragraphs, with <strong> where emphasis is genuinely needed. No h1, no h2, no lists, no title, no parties block, no date, no signature block, no TO: block. The system adds all of that.
- Do NOT number the paragraphs and do NOT write "1." or similar at the start of any paragraph. Numbering is applied mechanically after you draft.
- If, unusually, no Defence text is provided in the source documents, draft to the anticipated defences evident from the intake and mark each such paragraph with [CONFIRM AGAINST DEFENCE].

Output as HTML with p and strong only. No inline styles.`,

    rule49_offer: `You are a senior Ontario litigation lawyer drafting an OFFER TO SETTLE (Form 49A) under Rule 49 of the Rules of Civil Procedure, served by the Plaintiff in a wrongful dismissal action.

WHY RULE 49 MATTERS (reflect this in drafting, not in commentary):
A plaintiff's offer engages r. 49.10(1): if the judgment is as favourable or more favourable than the offer, the plaintiff presumptively gets partial indemnity costs to the date of the offer and SUBSTANTIAL indemnity costs from that date. The offer must therefore be (a) genuinely capable of acceptance, (b) clear enough that a court can later compare it to the judgment, and (c) made early to maximise the costs period.

STRUCTURE (Form 49A):
1. Title of proceedings (court file number placeholder, parties)
2. "The Plaintiff offers to settle this proceeding on the following terms:", followed by numbered terms:
   - Payment of the settlement amount (state the figure; specify treatment as damages for loss of employment; allocation between pay in lieu of notice and general damages where appropriate, with tax withholding treatment flagged)
   - Pre-judgment interest under the Courts of Justice Act to the date of the offer
   - Partial indemnity costs and disbursements to the date of acceptance (or as agreed/assessed)
   - Dismissal of the action on consent, without costs, upon payment
   - Mutual releases in a form satisfactory to counsel
3. Time for acceptance: open for acceptance until one minute after the commencement of the hearing, unless earlier revoked in writing (preserves full r. 49.10 effect)
4. Date, lawyer/firm block, "TO:" defendant's counsel block

RULES:
- Use EXACTLY the offer amount stated in the filing details; the lawyer has already chosen the strategic figure. Never substitute your own number. Allocation between notice damages and general damages may be proposed within that exact total.
- Precise and formal, with no argument or narrative: this is an offer, not a letter.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    settlement_minutes: `You are a senior Ontario employment lawyer drafting MINUTES OF SETTLEMENT with an attached FULL AND FINAL RELEASE for a wrongful dismissal matter, prepared from the plaintiff's side.

PART A: MINUTES OF SETTLEMENT (numbered terms):
1. Parties and recitals (the dispute, without admissions)
2. Payment terms: total amount, allocation (pay in lieu of notice subject to statutory withholdings; general damages portion where supportable, noting that the allocation must be defensible; retiring allowance/RRSP transfer eligibility where applicable [flag for accountant]); payment deadline and method; ESA minimums acknowledged as paid regardless of the release
3. Non-monetary terms the plaintiff should secure: agreed reference letter (attached as a schedule placeholder) or agreed reference protocol; benefits continuation end date; confirmation of ROE amendment if needed; return of property both ways
4. Confidentiality (mutual, with carve-outs: immediate family, professional advisors, as required by law) and mutual non-disparagement
5. If a proceeding exists: dismissal/discontinuance on consent without costs
6. Entire agreement, governing law (Ontario), counterparts/electronic signatures

PART B: FULL AND FINAL RELEASE:
- Releasor/Releasee definitions (including officers, directors, employees, successors)
- Release of all claims arising from employment and its termination, including ESA (acknowledging statutory payments received), common law, and Human Rights Code claims. For Code claims: include the specific acknowledgment that the releasor understands they are releasing human rights claims and does so voluntarily with advice; a bare general release is vulnerable
- Carve-outs that MUST survive: statutory entitlements that cannot be released, CPP/EI, vested pension entitlements, WSIB where applicable, claims that cannot be released at law
- No-assignment representation, no-admission clause
- Independent legal advice acknowledgment

RULES:
- Plaintiff-side posture: the release is the employer's consideration; keep it no broader than necessary and preserve the carve-outs.
- Canadian spelling. Numbered paragraphs throughout.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    retainer_agreement: `You are drafting a RETAINER AGREEMENT for an Ontario plaintiff-side employment law firm to send a new client.

CRITICAL REGULATORY CONSTRAINT (must shape the output):
For CONTINGENCY fee arrangements with most individual clients, Ontario mandates the STANDARD FORM Contingency Fee Agreement prescribed under the Solicitors Act (O. Reg. 563/20) together with the mandatory "Contingency Fees: What You Need to Know" rights guide; a custom-drafted CFA is NOT permitted for those clients. Therefore:
- If the fee structure is contingency: DO NOT draft a bespoke CFA. Produce a cover letter + completion checklist for the standard form (the firm-specific variables: the contingency percentage, how disbursements are treated, scope of the matter, HST) and state prominently that the prescribed standard form and rights guide must be used and provided.
- If hourly or flat/blended: draft the full engagement agreement.

FULL ENGAGEMENT AGREEMENT STRUCTURE (hourly/flat):
1. Identification of client and matter scope (this employment dispute; what is included and excluded, e.g., appeals excluded unless separately retained)
2. Fees: hourly rates by timekeeper (placeholders), or flat fee; disbursements; HST; interim billing frequency
3. Retainer deposit: amount placeholder, held in trust, applied to accounts, replenishment
4. Client responsibilities: honest and complete information, timely instructions, mitigation efforts and records
5. Communication expectations and file updates
6. Termination: client may terminate anytime; firm withdrawal per the Rules of Professional Conduct; fees to date payable
7. Assessment rights: client's right to have accounts assessed under the Solicitors Act
8. LawPRO insurance disclosure; complaints process; privacy/file retention
9. Signature blocks (client + lawyer), dated

RULES:
- Plain language throughout: a retainer the client can read and understand.
- Placeholders in [square brackets] for firm-specific figures.
- This document defines the lawyer-client relationship: flag EVERYTHING variable for review.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    mitigation_log: 'DETERMINISTIC; never sent to the model.',

    settlement_conference_brief: `You are a senior Ontario employment lawyer drafting a SETTLEMENT CONFERENCE / PRE-TRIAL BRIEF for the plaintiff in a wrongful dismissal matter.

FORUM ADAPTATION (the filing details state the procedure type; structure the brief accordingly):
- SMALL CLAIMS COURT: the mandatory settlement conference under Rule 13 of the Small Claims Court Rules. Include: concise statement of the issues, admitted vs disputed facts, the plaintiff's position with supporting documents identified, proposed witnesses at trial, and a realistic settlement position. Tone: practical; the deputy judge wants to settle the case.
- SIMPLIFIED / ORDINARY PROCEDURE: the pre-trial conference brief under Rule 50.04. Include: nature of the proceeding and status, admitted/agreed facts, contested issues of fact and law (with the plaintiff's position on each), damages summary with the entitlements math, settlement history (WITHOUT disclosing without-prejudice amounts unless instructed), estimated trial length and witnesses, and the relief sought.

CONTENT PRINCIPLES:
- Numbers first: the ESA floor, the common-law range, and what the plaintiff realistically seeks.
- Candid issue framing; pre-trial judges reward realism and penalise puffery.
- Identify the true obstacles to settlement in one short section.
- Cite only real authorities (Bardal for notice; issue-specific canon where approved).

Output as HTML with h1, h2, p, ol, li, strong, tables for the damages summary. No inline styles.`,

    hrto_schedule_a: `You are a senior Ontario human rights lawyer drafting SCHEDULE "A" to an HRTO Application (Form 1), the detailed narrative of allegations that accompanies the form, on behalf of the applicant employee.

STRUCTURE (numbered paragraphs throughout):
1. OVERVIEW: the applicant, the respondent(s), the Code grounds engaged (s. 5 employment), and the discrimination alleged, in three or four paragraphs.
2. THE PARTIES: the applicant's employment history with the respondent; each personal respondent's role (name individuals only where their conduct grounds liability).
3. THE FACTS: strict chronology, one event per paragraph, dates first. Draw the connection between the protected ground and each adverse treatment explicitly ("Two weeks after disclosing her disability, ...").
4. THE DISCRIMINATION: organised by Code section engaged: discrimination in employment (s. 5(1)), harassment (s. 5(2)) where applicable, failure to accommodate to the point of undue hardship (s. 11 / s. 17), reprisal (s. 8) where applicable.
5. IMPACT ON THE APPLICANT: dignity, feelings and self-respect; health; financial.
6. REMEDIES SOUGHT (s. 45.2): monetary compensation for injury to dignity (state a figure consistent with current HRTO ranges for comparable conduct), lost wages, and public interest remedies (policy, training).

RULES:
- The narrative must stand alone; the adjudicator may read Schedule A before anything else.
- Every date and fact must come from the intake; nothing may be invented.
- The one-year limitation (s. 34(1)): state the date of the last incident in the series prominently in the overview.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    notice_of_action: `You are a senior Ontario litigation lawyer drafting a NOTICE OF ACTION (Form 14C, Rules of Civil Procedure) for a wrongful dismissal action. A Notice of Action is issued when the limitation period leaves insufficient time to prepare a full Statement of Claim; the Statement of Claim (Form 14D) must then be filed within thirty days.

STRUCTURE:
1. General heading: court, court file number placeholder, parties (plaintiff and defendant with full legal names).
2. A single placeholder for the form's printed notice text: "[STANDARD FORM 14C NOTICE AND WARNINGS TO THE DEFENDANT, PER THE OFFICIAL FORM]". Do not compose or reproduce the official warning text; counsel prepares this document on the official form, which carries it.
3. The section this document exists for, headed "STATEMENT OF THE NATURE OF THE CLAIM": a SHORT AND CONCISE statement in two or three numbered paragraphs identifying the parties, the employment, the termination, and the relief claimed (damages for wrongful dismissal, Human Rights Code damages where approved, aggravated or punitive damages where approved, interest, and costs). Include the amounts from the damages analysis. This is a summary, not the pleading; the full claim follows in the Statement of Claim (Form 14D) within thirty days.
4. Date, court address placeholder, and the plaintiff's lawyer's name, firm, and contact block.

RULES:
- This document exists to stop the limitation clock. State the relief in terms broad enough to cover the claims the Statement of Claim will plead.
- Claim only the causes of action supported by the APPROVED ISSUES.`,

    notice_of_arbitration: `You are a senior Ontario employment lawyer drafting a NOTICE OF ARBITRATION commencing a private arbitration under an arbitration agreement in an employment contract, for a non-unionized employee. The Arbitration Act, 1991, S.O. 1991, c. 17 governs unless the agreement provides otherwise.

STRUCTURE:
1. Heading "NOTICE OF ARBITRATION", the parties with full legal names (the claimant employee and the respondent employer), and the date.
2. THE ARBITRATION AGREEMENT: identify the employment agreement by date, identify the arbitration clause by section number where the intake provides it, and quote the clause verbatim where its text appears in the intake. State that the claimant demands arbitration of the dispute under the agreement, consistent with section 23 of the Arbitration Act, 1991. Where the clause text is not in the intake, insert "[LAWYER: insert the arbitration clause verbatim from the employment agreement]".
3. THE DISPUTE: a concise numbered statement of the nature of the dispute: the employment, the termination, and each claim advanced (damages in lieu of reasonable notice; statutory entitlements; Human Rights Code damages where approved; aggravated or punitive damages where approved), with the amounts from the damages analysis. This is a commencement notice, not a pleading; two to five paragraphs.
4. RELIEF SOUGHT: the remedies claimed, prejudgment and postjudgment interest, and the costs of the arbitration.
5. APPOINTMENT OF THE ARBITRATOR: follow the mechanism in the clause where the intake states it; otherwise propose that the parties agree on a sole arbitrator within a stated number of days, failing which the claimant will apply to the Superior Court of Justice under section 10 of the Arbitration Act, 1991 for an appointment. Name no specific arbitrator; insert "[LAWYER: proposed arbitrator, roster, or appointing institution, per the clause and client instructions]".
6. Service statement, the lawyer's name, firm, and contact block.

RULES:
- The procedure in the arbitration clause governs. Where the clause prescribes a different commencement step (for example, a named institution's rules), say so in a bracketed lawyer note rather than assuming this notice suffices.
- Do not opine on the enforceability of the arbitration clause in the document; that assessment belongs to the lawyer, outside this notice.
- Claim only the causes of action supported by the APPROVED ISSUES.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    sj_notice_of_motion: `You are a senior Ontario employment litigation lawyer drafting a NOTICE OF MOTION (Form 37A) for the plaintiff's motion for summary judgment under Rule 20 in a wrongful dismissal action.

STRUCTURE:
1. General heading (court, file number placeholder, parties).
2. The moving party and the hearing details as placeholders ([DATE], [TIME], [COURT ADDRESS], method of hearing to be confirmed).
3. THE MOTION IS FOR: numbered relief: summary judgment for damages for wrongful dismissal in the amount claimed; any Code or moral damages the approved issues support; prejudgment and postjudgment interest under the Courts of Justice Act; costs; such further relief as counsel may advise.
4. THE GROUNDS FOR THE MOTION ARE: numbered grounds tracking the approved issues: there is no genuine issue requiring a trial (Rule 20.04; Hryniak v Mauldin, 2014 SCC 7); the employment and dismissal are not in dispute; the termination clause is unenforceable where that issue is approved (Waksdale v Swegon North America Inc, 2020 ONCA 391); the only real issue is the quantum of reasonable notice, which is a question the motion judge can decide on a paper record (Bardal factors); and the specific grounds arising from the approved issues.
5. THE FOLLOWING DOCUMENTARY EVIDENCE will be used: the affidavit of the plaintiff, the pleadings, and the exhibits.
6. Date and the lawyer's contact block; TO: the defendant's lawyer placeholder.

RULES:
- Wrongful dismissal actions are well suited to summary judgment and the courts have said so; the grounds should reflect that confidence without overstatement.
- Relief and grounds must track the APPROVED ISSUES only.`,

    sj_affidavit: `You are a senior Ontario employment litigation lawyer drafting the PLAINTIFF'S AFFIDAVIT (Form 4D) in support of a motion for summary judgment under Rule 20 in a wrongful dismissal action. The affiant is the plaintiff. This is sworn evidence: every paragraph must state a fact the plaintiff can swear to from personal knowledge, in the first person, one fact per numbered paragraph.

STRUCTURE:
1. Style of proceeding heading; the affiant's full name, city, and the opening: "I, [name], of the City of [city], MAKE OATH AND SAY (or AFFIRM):".
2. Introduction: who the affiant is and that the affidavit is made in support of the motion for summary judgment, with the basis of knowledge stated.
3. THE EMPLOYMENT: hire date, position(s), compensation (salary, bonus, benefits, pension), reporting structure, and tenure, in chronological numbered paragraphs.
4. THE TERMINATION: the date, how it was communicated, the stated reason, what was offered, and the circumstances the approved issues make relevant (manner of dismissal facts only where a moral damages issue is approved).
5. THE EMPLOYMENT AGREEMENT: whether a written agreement exists and the termination clause verbatim where the record contains it, referring to it as an exhibit placeholder ([EXHIBIT A]).
6. MITIGATION: the job search efforts, applications, interviews, and any new employment with dates and compensation, referring to the mitigation log as an exhibit placeholder.
7. DAMAGES: the plaintiff's losses in plain factual terms (lost salary, benefits, bonus), without legal argument.
8. The jurat block: "SWORN (or AFFIRMED) before me at ... on [DATE]" with signature lines for the commissioner and the affiant.

RULES:
- Facts only; no argument, no law, no conclusions ("I was wrongfully dismissed" is argument; "my employment was terminated on [date] without notice" is fact).
- Mark every exhibit as a lettered placeholder and every fact the intake does not establish as [TO BE CONFIRMED WITH THE CLIENT].
- Never put words in the affiant's mouth that the intake does not support.`,

    sj_factum: `You are a senior Ontario employment litigation lawyer drafting the PLAINTIFF'S FACTUM for a motion for summary judgment under Rule 20 in a wrongful dismissal action.

STRUCTURE (numbered paragraphs throughout):
PART I: OVERVIEW. Two or three paragraphs: what the motion seeks and why there is no genuine issue requiring a trial.
PART II: THE FACTS. Concise statement of the material facts with references to the plaintiff's affidavit ([Affidavit, para X] placeholders).
PART III: THE ISSUES AND THE LAW. Organised by issue, drawn from the APPROVED ISSUES ONLY:
1. Summary judgment is appropriate: Rule 20.04 and Hryniak v Mauldin, 2014 SCC 7 (the culture shift; a trial is not required where the motion record permits a fair and just adjudication). Wrongful dismissal actions turning on notice period are repeatedly held suitable for summary judgment.
2. Where the termination clause issue is approved: the clause is unenforceable (Waksdale v Swegon North America Inc, 2020 ONCA 391; Machtinger v HOJ Industries Ltd, [1992] 1 SCR 986), so common law reasonable notice applies.
3. Reasonable notice: the Bardal factors (Bardal v Globe & Mail) applied to this plaintiff's age, tenure, character of employment, and the availability of comparable employment, supporting the range in the damages analysis.
4. Where a cause allegation is approved as an issue: the employer bears the onus and McKinley v BC Tel, 2001 SCC 38 requires a contextual and proportionate analysis.
5. Where moral or Code damages are approved: Honda Canada Inc v Keays, 2008 SCC 39 for the manner-of-dismissal framework; the Code analysis where discrimination is an approved issue.
6. Mitigation: the plaintiff's efforts were reasonable; the employer bears the onus of proving failure to mitigate.
PART IV: THE ORDER REQUESTED. Numbered.
SCHEDULE A: LIST OF AUTHORITIES (only the cases actually cited).

RULES:
- Cite ONLY the authorities named above plus authorities the intake or approved issues specifically raise; never invent additional citations.
- Where a factual reference is needed, use [Affidavit, para X] placeholders for counsel to complete.
- Persuasive, measured, and short: the best factums in this class are under twenty pages.`,

    sp_timetable_motion: `You are a senior Ontario employment litigation lawyer drafting a MOTION FOR A TIMETABLE ORDER, brought by the plaintiff.

{{PROCEDURE_CONTEXT}}

CONTEXT: the parties need fixed dates for the remaining steps (documentary discovery, examinations, mediation, setting the action down for trial, and the pre-trial). A timetable also protects against dismissal for delay under Rule 48.14.

STRUCTURE:
1. General heading: court, court file number placeholder, parties.
2. NOTICE OF MOTION heading, the moving party, and the hearing details as placeholders ([DATE], [TIME], [METHOD OF HEARING], [COURT ADDRESS]). Insert "{{FORM_MARKER}}".
3. THE MOTION IS FOR: (a) an order fixing a timetable for the remaining steps in the action, in the terms set out in Schedule A; (b) if necessary, an order extending the time to set the action down for trial under Rule 48.14; (c) costs of the motion only if opposed; (d) such further relief as counsel may advise.
4. THE GROUNDS FOR THE MOTION ARE: the procedure the action is under, as stated above; the steps completed to date and the dates on which they occurred, taken from the matter timeline; the steps remaining; why the proposed dates are reasonable and proportionate to a simplified-procedure action; the prejudice to the plaintiff of continued delay (a dismissed employee is without income while the action is pending); and, where the other side has not consented, the requests made and the response received.
5. THE FOLLOWING DOCUMENTARY EVIDENCE will be used: the pleadings, correspondence between counsel, and the affidavit of [LAWYER: deponent].
6. SCHEDULE A: PROPOSED TIMETABLE as a table with two columns, Step and Date. Where a PROPOSED TIMETABLE is supplied in the context below, REPRODUCE IT EXACTLY: the same steps, in the same order, with the same dates, adding nothing and omitting nothing. Use a [DATE] placeholder ONLY for a step the supplied timetable leaves blank. Where no timetable is supplied, list the steps a simplified-procedure action requires with [DATE] placeholders. Steps, in this order, including only those the supplied timetable dates or the matter requires: discovery plan agreed (Rule 29.1); affidavits of documents exchanged (Rule 30.03); documentary productions delivered; examinations for discovery completed; answers to undertakings delivered; any motions arising from discovery heard; plaintiff expert reports delivered (Rule 53.03); responding expert reports delivered; mediation completed (Rule 24.1); action set down for trial (Rule 48.14); pre-trial conference scheduled (the date by which the parties request a pre-trial date); pre-trial conference held; trial.
7. Date and the lawyer's name, firm, and contact block; TO: the defendant's lawyer placeholder.

RULES:
- Do not invent form numbers or regional practice requirements; where a form number or local practice is needed, use a "[LAWYER: ...]" marker.
- The tone should be brisk and practical, not adversarial: a timetable motion asks the court to keep the action moving.
- THE RULES ARE IN TRANSITION: amendments to the Rules of Civil Procedure took effect during 2026 and further phases were expected. Do not assert that a particular step is or is not required by the current rules, and do not state discovery time limits or monetary thresholds as fact. Where currency matters, add "[LAWYER: confirm against the amendments in force and the regional practice direction]".

Output as HTML with h1, h2, p, ol, li, strong, and a table for Schedule A. No inline styles.`,

    consent_timetable_order: `You are a senior Ontario employment litigation lawyer drafting a CONSENT ORDER fixing a timetable in a wrongful dismissal action, for signature by counsel for all parties and submission to the court on consent.

STRUCTURE:
1. General heading: court, court file number placeholder, parties.
2. Title: "ORDER (Timetable, on consent)".
3. The recital block: "THIS MOTION, made on consent of the parties, for an order fixing a timetable for the remaining steps in this action, was read this [DATE] without the appearance of counsel." Include "[LAWYER: confirm the local practice for submitting consent orders in this region, including whether a requisition or a basket motion is required.]".
4. ON READING the consent of the parties, filed.
5. THE COURT ORDERS as numbered paragraphs: (1) the timetable in the attached schedule is fixed for the remaining steps; (2) where applicable, the time to set the action down for trial is extended to the date in the schedule; (3) any party may move to vary the timetable on notice; (4) no costs of this motion.
6. THE TIMETABLE as a table with two columns, Step and Date. Where a PROPOSED TIMETABLE is supplied in the context below, REPRODUCE IT EXACTLY: the same steps, in the same order, with the same dates, adding nothing and omitting nothing. Otherwise draw from the matter timeline and use [DATE] where no date exists. Steps, in this order, including only those the supplied timetable dates or the matter requires: discovery plan agreed (Rule 29.1); affidavits of documents exchanged (Rule 30.03); documentary productions delivered; examinations for discovery completed; answers to undertakings delivered; any motions arising from discovery heard; plaintiff expert reports delivered (Rule 53.03); responding expert reports delivered; mediation completed (Rule 24.1); action set down for trial (Rule 48.14); pre-trial conference scheduled (the date by which the parties request a pre-trial date); pre-trial conference held; trial.
7. A signature block for the judge or associate judge ([LAWYER: judge or associate judge, per the region]), and a consent block listing each party's counsel with name, firm, LSO number placeholder, and a signature line.

RULES:
- An order speaks in the operative voice of the court ("THE COURT ORDERS"), never in argument. No submissions, no reasons.
- THE RULES ARE IN TRANSITION: amendments to the Rules of Civil Procedure took effect during 2026 and further phases were expected. Do not assert that a particular step is or is not required by the current rules, and do not state discovery time limits or monetary thresholds as fact. Where currency matters, add "[LAWYER: confirm against the amendments in force and the regional practice direction]".
- Do not invent form numbers or local filing requirements; use "[LAWYER: ...]" markers.

Output as HTML with h1, h2, p, ol, li, strong, and a table for the timetable. No inline styles.`,

    timetable_order: `You are a senior Ontario employment litigation lawyer drafting a DRAFT ORDER fixing a timetable in a wrongful dismissal action, to be placed before the court on a contested motion (the form of order the moving party asks the court to grant).

STRUCTURE:
1. General heading: court, court file number placeholder, parties.
2. Title: "ORDER (Timetable)".
3. The recital block: "THIS MOTION, made by the plaintiff for an order fixing a timetable for the remaining steps in this action, was heard this [DATE] at [COURT ADDRESS]."
4. ON READING the motion record of the plaintiff and the materials filed by the responding party, and on hearing the submissions of counsel for the parties.
5. THE COURT ORDERS as numbered paragraphs: (1) the timetable set out below is fixed for the remaining steps; (2) where applicable, the time to set the action down for trial is extended to the date stated; (3) a party who fails to comply may be subject to the consequences the court considers just, including costs; (4) any party may move to vary the timetable on notice; (5) costs of the motion, with "[LAWYER: costs disposition sought]".
6. THE TIMETABLE as a table with two columns, Step and Date. Where a PROPOSED TIMETABLE is supplied in the context below, REPRODUCE IT EXACTLY: the same steps, in the same order, with the same dates, adding nothing and omitting nothing. Otherwise draw from the matter timeline and use [DATE] where no date exists. Steps, in this order, including only those the supplied timetable dates or the matter requires: discovery plan agreed (Rule 29.1); affidavits of documents exchanged (Rule 30.03); documentary productions delivered; examinations for discovery completed; answers to undertakings delivered; any motions arising from discovery heard; plaintiff expert reports delivered (Rule 53.03); responding expert reports delivered; mediation completed (Rule 24.1); action set down for trial (Rule 48.14); pre-trial conference scheduled (the date by which the parties request a pre-trial date); pre-trial conference held; trial.
7. Signature line for the judge or associate judge ([LAWYER: judge or associate judge, per the region]).

RULES:
- Operative court language only; no argument and no reasons.
- THE RULES ARE IN TRANSITION: amendments to the Rules of Civil Procedure took effect during 2026 and further phases were expected. Do not assert that a particular step is or is not required by the current rules, and do not state discovery time limits or monetary thresholds as fact. Where currency matters, add "[LAWYER: confirm against the amendments in force and the regional practice direction]".
- Do not invent form numbers or local practice requirements; use "[LAWYER: ...]" markers.

Output as HTML with h1, h2, p, ol, li, strong, and a table for the timetable. No inline styles.`,

    undertakings_answers: `You are a senior Ontario employment litigation lawyer preparing ANSWERS TO UNDERTAKINGS given at the examination for discovery of the plaintiff in a wrongful dismissal action.

CONTEXT: at discovery, counsel gives undertakings to provide information or documents. This document answers them in an organised, numbered form, and records refusals and items taken under advisement separately so that the record is clear if a refusals motion follows.

STRUCTURE:
1. Title block: "ANSWERS TO UNDERTAKINGS", the parties, the court file number placeholder, the date of the examination ([LAWYER: date of examination]), and the name of the person examined.
2. A short introductory paragraph: these answers are given without prejudice to the plaintiff's right to supplement them, and documents produced with these answers are listed in the schedule.
3. PART 1: UNDERTAKINGS. A numbered list. For each item, state the undertaking as given (with a "[Transcript p. X, q. Y]" placeholder), then "ANSWER:" followed by the answer. Where the intake supplies the underlying facts (employment dates, compensation, mitigation efforts, medical or accommodation history where those are approved issues), draft a responsive answer from those facts. Where it does not, write "[LAWYER: answer required — the file does not contain this information]". Never invent an answer.
4. PART 2: ITEMS TAKEN UNDER ADVISEMENT. Same numbered format, each with the position taken and "[LAWYER: confirm the position]".
5. PART 3: REFUSALS. Same format, each with the ground of refusal stated neutrally (relevance, privilege, proportionality) and "[LAWYER: confirm the ground and whether it is maintained]".
6. SCHEDULE: DOCUMENTS PRODUCED WITH THESE ANSWERS, a numbered list with "[LAWYER: list documents]" where unknown.
7. Date and the lawyer's name, firm, and contact block; TO: the defendant's lawyer placeholder.

RULES:
- Mitigation undertakings are the most common in this class of case: where the file contains a mitigation record, answer from it and cross-reference the mitigation log rather than restating every entry.
- Answers are evidence. Draft nothing that the intake does not support, and mark every gap with a "[LAWYER: ...]" marker.
- Neutral, factual register; an answer to an undertaking is not the place for argument.

Output as HTML with h1, h2, p, ol, li, strong. No inline styles.`,

    affidavit_of_service: 'DETERMINISTIC; never sent to the model.',
    rule49_withdrawal: 'DETERMINISTIC; never sent to the model.',
    rule49_acceptance: 'DETERMINISTIC; never sent to the model.',
    costs_outline: 'DETERMINISTIC; never sent to the model.',
    esa_filing_sheet: 'DETERMINISTIC; never sent to the model.',
    scc_filing_sheet: 'DETERMINISTIC; never sent to the model.',
  };

  return prompts[docType] + `

CRITICAL:
0. Where the STRUCTURE above names sections, emit each as an <h2> heading using that exact wording. Firm templates place documents section by section, and a missing or renamed heading sends a section to the wrong place.
1. Every factual claim must come from the intake data; never fabricate facts.
2. Use Canadian English spelling throughout.
3. All monetary amounts in Canadian dollars.
4. Write in the professional register of Ontario legal practice. Do not use em dashes anywhere in the document; use commas, colons, semicolons, or parentheses instead.`;
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

  // Severance offer details — the core input for assessment + counter-offer
  const offerParts: string[] = [];
  if (intake.received_severance_offer) {
    if (intake.severance_weeks_offered) offerParts.push(`- Offered: ${intake.severance_weeks_offered} weeks`);
    if (intake.severance_payment_type) offerParts.push(`- Payment structure: ${intake.severance_payment_type}`);
    if (intake.severance_deadline) offerParts.push(`- Acceptance deadline: ${intake.severance_deadline}`);
    if (intake.severance_offer_details) offerParts.push(`- Details: ${intake.severance_offer_details}`);
    if (intake.signed_release !== undefined && intake.signed_release !== null) {
      offerParts.push(`- Release signed: ${intake.signed_release ? 'YES; flag immediately' : 'no'}`);
    }
  }
  const offerSection = offerParts.length > 0
    ? `SEVERANCE OFFER:\n${offerParts.join('\n')}`
    : (req.documentType === 'severance_assessment' || req.documentType === 'counter_offer' || req.documentType === 'rebuttal_letter')
      ? 'SEVERANCE OFFER: details not captured in the intake; state clearly that the offer terms must be confirmed before this document is used.'
      : '';

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
${req.documentType === 'sj_factum' && req.factumArgumentGuidance ? `
FIRM ARGUMENT SECTIONS FOR PART III:
Organise Part III (Issues and the Law) using these argument sections, in this order, as the firm's settled way of arguing each issue. Argue each one in the firm's voice, applying the facts above to it. Cite the authorities listed for each section and do not add other authorities. Do not argue an issue that is not listed here.
${req.factumArgumentGuidance}
` : ''}
DAMAGES:
- ESA: ${damages.esaNoticeWeeks} weeks notice ($${damages.esaNoticePay.toLocaleString('en-CA')}) + $${damages.esaSeverancePay.toLocaleString('en-CA')} severance
- Common law: ${damages.commonLawLowMonths}–${damages.commonLawHighMonths} months ($${damages.commonLawLowAmount.toLocaleString('en-CA')}–$${damages.commonLawHighAmount.toLocaleString('en-CA')})
${req.claimAmount ? `- Total claimed: $${req.claimAmount.toLocaleString('en-CA')}` : ''}

${offerSection}

${uploadedDocs ? `UPLOADED DOCUMENTS:\n${uploadedDocs}` : ''}

FILING DETAILS:
- Lawyer: ${req.lawyerName}, ${req.firmName}
${req.claimAmount && req.documentType === 'counter_offer' ? `- Counter-offer amount: $${req.claimAmount.toLocaleString('en-CA')}` : ''}
${req.claimAmount && req.documentType === 'rule49_offer' ? `- OFFER AMOUNT (use exactly this figure): $${req.claimAmount.toLocaleString('en-CA')}` : ''}
${req.courtLocation ? `- Court: ${req.courtLocation}` : ''}

${req.additionalContext ? `ADDITIONAL CONTEXT:\n${req.additionalContext}` : ''}

Draft the complete document now.`;
}

// ── Main generation function ─────────────────────────────────────────────

export async function generateLitigationDocument(
  req: LitigationDocumentRequest,
  definedTerms?: string[],
): Promise<LitigationDocumentResult> {
  // Mitigation log is deterministic — identical client-facing template
  // every time, no model call, zero cost.
  if (req.documentType === 'mitigation_log') {
    return {
      html: buildMitigationLog(String(req.intake.client_first_name ?? '')),
      documentType: req.documentType,
      documentTitle: getDocumentTitle(req.documentType),
      lawyerReviewFlags: getLawyerReviewFlags(req.documentType),
      citations: [],
      costUsd: 0,
    };
  }

  // Court forms are deterministic: their content is data, and a wrong
  // figure or date has consequences. Builders validate their own fields
  // and throw a plain message the route returns as a 400.
  const COURT_FORM_TYPES: LitigationDocumentType[] = ['affidavit_of_service', 'rule49_withdrawal', 'rule49_acceptance', 'costs_outline', 'esa_filing_sheet', 'scc_filing_sheet'];
  if (COURT_FORM_TYPES.includes(req.documentType)) {
    const fields = req.formFields ?? {};
    const built =
      req.documentType === 'affidavit_of_service' ? buildAffidavitOfService(req.intake, fields, req.courtLocation)
        : req.documentType === 'rule49_withdrawal' ? buildOfferWithdrawal(req.intake, fields, req.lawyerName, req.firmName, req.courtLocation)
          : req.documentType === 'rule49_acceptance' ? buildOfferAcceptance(req.intake, fields, req.lawyerName, req.firmName, req.courtLocation)
            : req.documentType === 'esa_filing_sheet' ? buildEsaFilingSheet(req.intake, req.analysis)
              : req.documentType === 'scc_filing_sheet' ? buildSccFilingSheet(req.intake, req.claimAmount)
                : buildCostsOutline(req.intake, fields, req.lawyerName, req.firmName, req.courtLocation);
    return {
      html: built.html,
      documentType: req.documentType,
      documentTitle: built.documentTitle,
      lawyerReviewFlags: built.lawyerReviewFlags,
      citations: [],
      costUsd: 0,
    };
  }

  // Mediation brief: deterministic front matter (profile/Bardal, damages,
  // comparables, negotiation history) built from the matter record. The
  // model writes the narrative around these tables and never composes them.
  const frontMatter = req.documentType === 'mediation_brief'
    ? buildMediationFrontMatter({
        intake: req.intake,
        analysis: req.analysis,
        comparables: req.comparables,
        comparableRange: req.comparableRange,
        negotiationEntries: req.negotiationEntries,
        negotiationSummary: req.negotiationSummary,
        profileTableRows: req.styleProfileTableRows,
      })
    : null;

  let systemPrompt = buildSystemPrompt(req.documentType);
  if (req.documentType === 'sp_timetable_motion') {
    systemPrompt = systemPrompt.replace('{{FORM_MARKER}}', req.procedureType === 'ordinary'
      ? '[LAWYER: confirm the motion form and whether the motion may proceed in writing or requires an appearance in the region.]'
      : '[LAWYER: confirm the motion form and whether the motion proceeds in writing under Rule 76 as amended, or requires an appearance in the region.]');
    systemPrompt = systemPrompt.replace('{{PROCEDURE_CONTEXT}}', req.procedureType === 'ordinary'
      ? 'THE ACTION IS UNDER THE ORDINARY PROCEDURE. Do not refer to Rule 76, to the simplified procedure, or to any limit on examinations that belongs to it. Title the document "NOTICE OF MOTION".'
      : 'THE ACTION IS UNDER THE SIMPLIFIED PROCEDURE (Rule 76 of the Rules of Civil Procedure). Say so in the grounds, and keep the relief proportionate to a simplified-procedure action. Note that a step or limit particular to Rule 76 should be marked "[LAWYER: confirm against the amendments in force]" rather than stated as settled.');
  }
  if (req.documentType === 'mediation_brief') {
    const firmHeadings = (req.styleFlowHeadings ?? []).filter(h => h && h.trim());
    systemPrompt = systemPrompt.replace('{{SECTION_INSTRUCTION}}', firmHeadings.length >= 3
      ? `Use the FIRM'S OWN section headings, in this order, each as an <h2> with the EXACT wording given:\n${firmHeadings.map((h, i) => `${i + 1}. ${h}`).join('\n')}\nCover the substance of the numbered components below within that structure (a component may live inside whichever firm section fits it; omit none):`
      : 'Write these sections, each as an <h2> using the EXACT heading wording given\n(without the number), so each section can be placed into a firm template:');
  }
  // How to refer to the client, from the client file rather than guessed.
  // Every document on a matter has to agree with every other one.
  let userPrompt = `${buildUserPrompt(req)}\n\nREFERRING TO THE CLIENT: ${pronounInstruction(req.intake.client_pronouns)}`;
  if (frontMatter) {
    userPrompt += `\n\nTABLES ALREADY IN THE DOCUMENT (do not reproduce): ${frontMatter.included.join(', ') || 'none'}.`;
  }
  // The settlement position must be drafted knowing the state of play: a
  // range proposed beneath an offer already on the table embarrasses
  // counsel. Deterministic summary, computed from the ledger.
  const nsOffer = req.documentType === 'mediation_brief' ? req.negotiationSummary?.latestEmployerOffer : null;
  if (nsOffer && req.negotiationSummary) {
    const ns = req.negotiationSummary;
    const lines = [`- The employer's latest offer: $${nsOffer.amountCad.toLocaleString('en-CA')} (${nsOffer.date})`];
    if (ns.latestClientPosition) lines.push(`- The plaintiff's latest position: $${ns.latestClientPosition.amountCad.toLocaleString('en-CA')} (${ns.latestClientPosition.kind}, ${ns.latestClientPosition.date})`);
    if (ns.offerVsRange?.gapToLowCad != null) lines.push(`- Gap between the employer's offer and the low end of the assessed range: $${ns.offerVsRange.gapToLowCad.toLocaleString('en-CA')}`);
    if (ns.employerMovementCad != null) lines.push(`- Employer movement since its first offer: $${ns.employerMovementCad.toLocaleString('en-CA')}`);
    userPrompt += `\n\nNEGOTIATION STATE (the settlement position MUST account for this; never propose a range at or beneath the employer's standing offer):\n${lines.join('\n')}`;
  }
  if (req.documentType === 'mediation_brief' && req.positionDocuments?.length) {
    // Titles are lawyer-supplied filenames and bodies are parsed uploads;
    // both are data. Quotes are stripped from the attribute and any
    // closing-tag lookalike in a body is defanged so an attached file
    // cannot break out of its frame and read as instructions.
    const positions = req.positionDocuments
      .map(d => `<position_document title="${d.title.replace(/["<>]/g, ' ')}">\n${d.text.replace(/<\/?position_document/gi, '[position document tag removed]')}\n</position_document>`)
      .join('\n\n');
    userPrompt += `\n\nTHE POSITIONS AND SUPPORTING MATERIALS FOR THIS MATTER:
These documents ground the brief. For position documents (a demand letter, a statement of claim): the brief MUST tell the same story and take the same positions — the same characterisation of the dismissal, the same legal issues, the same or updated figures. Reuse their framing where it fits a mediation audience. Never contradict them; where the position has genuinely moved since (for example a later offer), present the current position and note the change for counsel in [LAWYER: ...]. For a list of authorities or case law: rely on it for the legal framing, cite ONLY cases that appear in it or in the comparable-case table above, and never state a holding the material does not give you. For research memos: use their analysis, not their prose.

${positions}`;
  }

  logger.info('Generating litigation document', {
    documentType: req.documentType,
    approvedIssues: req.approvedIssues.length,
  });

  let text: string;
  let cost: number;
  let outputTruncated = false;
  // Section-by-section mediation brief: the narrative is the lawyer's approved
  // sections, so no model call is made; the deterministic furniture below
  // still wraps it (cover, tables, numbering, sign-off).
  if (req.documentType === 'mediation_brief' && req.mediationNarrativeOverride) {
    text = req.mediationNarrativeOverride;
    cost = 0;
  } else try {
    const result = await crossProviderChat({
      system: systemPrompt,
      user: userPrompt,
      tier: getModelTier(req.documentType),
      // Legal prose with HTML runs ~3 tokens per word; the old 2.2x cut
      // firm-depth briefs off mid-sentence.
      maxTokens: req.styleTypicalWords
        ? Math.min(30_000, Math.max(10_240, Math.ceil(req.styleTypicalWords * 3)))
        : 10_240,
      maxRetries: 2,
      timeoutMs: getTimeoutMs(req.documentType),
      definedTerms: definedTerms ?? undefined,
      extendOnTruncation: true,
    });
    text = result.text;
    cost = result.cost;
    outputTruncated = Boolean(result.truncated);
  } catch (err) {
    logger.error('Litigation document generation failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Document generation failed. Please try again.');
  }

  let html = enforceHouseStyle(text.trim());
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1].trim();

  // Notice of Action: replace the placeholder with the pinned official
  // notice text (RCP-E 14C, June 9, 2014; src/assets/forms). The official
  // wording is injected deterministically, never composed by the model.
  if (req.documentType === 'notice_of_action') {
    html = injectForm14cNotice(html);
  }

  // Affidavit: the model wrote the body; every fixed part is assembled
  // here so a jurat can never come out malformed.
  if (req.documentType === 'motion_affidavit') {
    const a = req.affidavit;
    const deponent = a?.deponentName ?? '';
    const sworn = a?.sworn ?? 'sworn';
    const exhibits = a?.exhibits ?? [];
    const opening = a
      ? buildAffidavitOpening(a)
      : buildAffidavitOpening({ deponentName: '', capacity: 'lawyer', knowledgeBasis: 'mixed', sworn: 'sworn' });
    const { index, stamps } = buildExhibitBlock(exhibits, deponent, sworn);
    const title = `<h1>${esc(a?.title ?? 'Affidavit')}</h1>`;
    // Numbering starts at the capacity paragraph; the "I, NAME ... MAKE
    // OATH AND SAY:" preamble is not paragraph 1.
    const numbered = numberNarrativeParagraphs([opening.numbered, scrubAffidavitBody(html)].join('\n'));
    html = [title, opening.preamble, numbered, index, buildJurat({ sworn, deponentName: deponent }), stamps]
      .filter(Boolean).join('\n\n');
  }

  // Mediation brief: prepend the deterministic title block and tables.
  // Integrity checks below run on the model narrative only: the tables are
  // deterministic and the comparable cases come from the verified library,
  // so canon-checking them would produce false "unknown case" flags.
  const narrativeHtml = html;
  if (frontMatter) {
    // Escape the name: it can originate from the public intake portal
    // (client-controlled), and the assembled HTML is rendered in the
    // dashboard via dangerouslySetInnerHTML.
    const mediationDate = typeof req.formFields?.mediation_date === 'string' ? req.formFields.mediation_date : '';
    const mediatorName = typeof req.formFields?.mediator_name === 'string' ? req.formFields.mediator_name : '';
    // Cover, tables, numbered narrative, sign-off. Cover and sign-off are
    // the parts that never vary by case, so they are deterministic; the
    // sign-off rides after numbering so its paragraphs stay unnumbered.
    const cover = buildMediationCover({
      intake: req.intake,
      lawyerName: req.lawyerName ?? '[LAWYER: name]',
      firmName: req.firmName ?? '[LAWYER: firm]',
      firmAddress: req.firmAddress,
      mediationDate,
      mediatorName,
    });
    const signOff = buildMediationSignOff({
      lawyerName: req.lawyerName ?? '[LAWYER: name]',
      firmName: req.firmName ?? '[LAWYER: firm]',
      firmAddress: req.firmAddress,
    });
    // The cover already carries the title; a title heading the model
    // emitted anyway (they sometimes do, whatever the instruction) would
    // duplicate it, so it is stripped deterministically.
    const narrative = scrubNarrative(
      html.replace(/^\s*<h[12][^>]*>\s*MEDIATION BRIEF[^<]*<\/h[12]>\s*/i, ''),
      {
        plaintiff: [req.intake.client_first_name, req.intake.client_last_name].filter(Boolean).join(' '),
        defendant: req.intake.employer_legal_name ?? req.intake.employer_operating_name ?? undefined,
      },
    );
    html = [cover, frontMatter.html, numberNarrativeParagraphs(narrative), signOff].filter(Boolean).join('\n\n');
  }

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

  const lawyerReviewFlags = [
    ...(outputTruncated ? ['INCOMPLETE DRAFT: the document hit the output limit even after an extended attempt and likely ends abruptly. Shorten the style depth or generate again; do not serve this version.'] : []),
    ...getLawyerReviewFlags(req.documentType),
    ...(frontMatter?.flags ?? []),
    ...checkCitationIntegrity(narrativeHtml, definedTerms ?? []),
    ...checkCanonTextIntegrity(narrativeHtml),
    ...checkFillInPlaceholders(narrativeHtml),
  ];

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
    case 'motion_affidavit': return 'Affidavit';
    case 'mediation_brief': return 'Mediation Brief';
    case 'severance_assessment': return 'Severance Offer Assessment';
    case 'counter_offer': return 'Counter-Offer Letter';
    case 'rebuttal_letter': return 'Reply to Opposing Counsel';
    case 'reply': return 'Reply (Form 25A)';
    case 'rule49_offer': return 'Offer to Settle (Form 49A)';
    case 'settlement_minutes': return 'Minutes of Settlement & Release';
    case 'retainer_agreement': return 'Retainer Agreement';
    case 'mitigation_log': return 'Mitigation Log (Client Job-Search Record)';
    case 'settlement_conference_brief': return 'Settlement Conference / Pre-Trial Brief';
    case 'hrto_schedule_a': return 'HRTO Schedule "A" (Narrative of Allegations)';
    case 'notice_of_action': return 'Notice of Action (Form 14C)';
    case 'notice_of_arbitration': return 'Notice of Arbitration (Private Arbitration)';
    case 'sj_notice_of_motion': return 'Notice of Motion for Summary Judgment (Form 37A)';
    case 'sj_affidavit': return "Plaintiff's Affidavit for Summary Judgment (Form 4D)";
    case 'sj_factum': return "Plaintiff's Factum (Summary Judgment)";
    case 'sp_timetable_motion': return 'Notice of Motion (Timetable)';
    case 'consent_timetable_order': return 'Consent Order (Timetable)';
    case 'timetable_order': return 'Order (Timetable)';
    case 'undertakings_answers': return 'Answers to Undertakings';
    case 'affidavit_of_service': return 'Affidavit of Service (Form 16B)';
    case 'rule49_withdrawal': return 'Notice of Withdrawal of Offer (Form 49B)';
    case 'rule49_acceptance': return 'Acceptance of Offer (Form 49C)';
    case 'costs_outline': return 'Costs Outline (Form 57B)';
    case 'esa_filing_sheet': return 'ESA Claim Filing Sheet';
    case 'scc_filing_sheet': return "Small Claims Filing Sheet (Form 7A)";
  }
}

/** Codes become sentences at the boundary: "weakness_assessment" is not
 *  lawyer-facing copy. A flag that already reads as a sentence passes
 *  through untouched. */
function humanizeFlag(code: string): string {
  if (/\s/.test(code)) return code;
  return `Check ${code.replace(/_/g, ' ')}.`;
}

function getLawyerReviewFlags(docType: LitigationDocumentType): string[] {
  return rawReviewFlags(docType).map(humanizeFlag);
}

function rawReviewFlags(docType: LitigationDocumentType): string[] {
  switch (docType) {
    case 'motion_affidavit':
      return ['deponent_knowledge', 'exhibits_attached', 'swearing_arrangements'];
    case 'discovery_plan':
      return ['document_requests', 'interrogatories', 'examination_topics'];
    case 'affidavit_of_documents':
      return ['schedule_a_completeness', 'schedule_b_completeness', 'privilege_claims', 'sworn_statement'];
    case 'mediation_brief':
      return ['factual_accuracy', 'settlement_range', 'weakness_assessment', 'objectives'];
    case 'severance_assessment':
      return ['offer_terms_confirmed', 'entitlement_math', 'recommendation', 'tax_treatment_flag_for_accountant'];
    case 'counter_offer':
      return ['counter_amount', 'entitlement_analysis', 'deadline_terms', 'without_prejudice_header'];
    case 'rebuttal_letter':
      return ['every_assertion_answered_or_flagged', 'characterizations_verified_against_their_letter', 'client_instructions_followed', 'without_prejudice_header'];
    case 'reply':
      return ['confirm_against_actual_defence', 'no_new_causes_of_action', 'responsive_paragraphs_only'];
    case 'rule49_offer':
      return ['offer_amount_strategy', 'allocation_and_tax_treatment', 'acceptance_window', 'costs_terms'];
    case 'settlement_minutes':
      return ['payment_allocation_defensible', 'release_scope_and_carveouts', 'human_rights_release_acknowledgment', 'reference_letter_schedule', 'confidentiality_carveouts'];
    case 'retainer_agreement':
      return ['fee_structure_and_rates', 'contingency_standard_form_required_if_CFA', 'scope_inclusions_exclusions', 'retainer_deposit_amount'];
    case 'mitigation_log':
      return ['client_instructions_cover_note'];
    case 'settlement_conference_brief':
      return ['forum_and_rule_confirmed', 'settlement_position_authorized', 'without_prejudice_disclosure_check', 'witness_list'];
    case 'hrto_schedule_a':
      return ['last_incident_date_within_limitation', 'grounds_match_form_selections', 'respondents_named_deliberately', 'dignity_quantum_range'];
    case 'notice_of_action':
      return ['limitation_date_confirmed', 'relief_broad_enough_for_the_claim', 'statement_of_claim_due_30_days_after_issuance', 'court_file_number'];
    case 'notice_of_arbitration':
      return ['arbitration_clause_enforceability', 'clause_commencement_procedure_matches_this_notice', 'appointment_mechanism_and_response_days', 'limitation_and_commencement_date'];
    case 'sj_notice_of_motion':
      return ['relief_matches_factum_and_affidavit', 'hearing_details_placeholders', 'grounds_track_approved_issues'];
    case 'sj_affidavit':
      return ['every_paragraph_verified_with_the_client_before_swearing', 'exhibits_assembled_and_lettered', 'no_argument_in_the_affidavit', 'commissioner_for_swearing'];
    case 'sj_factum':
      return ['affidavit_paragraph_references_completed', 'authorities_verified_and_scheduled', 'quantum_matches_damages_analysis', 'length_and_court_requirements'];
    case 'sp_timetable_motion':
      return ['motion_form_and_regional_practice_confirmed', 'proposed_dates_realistic_and_agreed_where_possible', 'rule_48_14_deadline_checked', 'deponent_and_evidence_identified'];
    case 'consent_timetable_order':
      return ['all_parties_consent_obtained_in_writing', 'regional_submission_practice_confirmed', 'dates_match_the_signed_consent', 'judge_or_associate_judge_correct'];
    case 'timetable_order':
      return ['dates_match_the_notice_of_motion', 'costs_disposition_confirmed', 'judge_or_associate_judge_correct', 'endorsement_reflected_before_entry'];
    case 'undertakings_answers':
      return ['every_answer_verified_with_the_client', 'transcript_references_completed', 'refusals_and_advisements_confirmed_with_counsel', 'privilege_reviewed_before_production', 'documents_schedule_complete'];
    // Deterministic court forms carry their own flags from the builder.
    case 'affidavit_of_service':
    case 'rule49_withdrawal':
    case 'rule49_acceptance':
    case 'costs_outline':
    case 'esa_filing_sheet':
    case 'scc_filing_sheet':
      return [];
  }
}

/** Inject the pinned official Form 14C notice text in place of the
 *  model's placeholder. Falls back to leaving the placeholder (which the
 *  fill-in check flags) if the asset cannot be read. */
export function injectForm14cNotice(html: string): string {
  const placeholderRe = /(?:<p>\s*)?\[STANDARD FORM 14C[^\]]*\](?:\s*<\/p>)?/i;
  if (!placeholderRe.test(html)) return html;
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const raw = fs.readFileSync(path.resolve(dir, '../assets/forms/form-14c-notice.txt'), 'utf8');
    const noticeHtml = raw.trim().split(/\n\s*\n/)
      .map(p => `<p>${p.replace(/\n/g, ' ').trim()}</p>`)
      .join('\n');
    return html.replace(placeholderRe, noticeHtml);
  } catch {
    return html;
  }
}

/** Deterministic mitigation log — a client-facing job-search record.
 *  No model call: identical output every time, zero cost. */
function buildMitigationLog(clientFirstName: string): string {
  const row = `<tr><td style="height:2em"></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  return `<h1>Job Search Record: Mitigation Log</h1>
<p><strong>Why this matters:</strong> After a termination, the law requires you to make reasonable efforts to find comparable work ("mitigation"). The employer may argue that your compensation should be reduced if you did not. This log is your evidence that you did. <strong>Fill it in as you go; do not reconstruct it from memory later.</strong></p>
<h2>How to use this log</h2>
<ol>
<li>Record <strong>every</strong> application, call, interview, networking contact, job fair, recruiter conversation, and training course, including brief ones.</li>
<li>Keep copies: job postings, application confirmations, rejection emails. Save them in one folder.</li>
<li>Aim for consistent weekly activity. Gaps are what opposing counsel looks for.</li>
<li>You are <strong>not</strong> required to take a substantially worse job; the obligation is to seek comparable work in role, pay, and location. If you are unsure whether a role qualifies, record it and ask us.</li>
<li>Send us this log and your folder every month.</li>
</ol>
<h2>Job search entries</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
<tr><th>Date</th><th>Employer / Contact</th><th>Position</th><th>How applied / contacted</th><th>Response / status</th><th>Documents kept?</th></tr>
${row.repeat(15)}
</table>
<h2>Other efforts (courses, networking events, recruiters, career counselling)</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
<tr><th>Date</th><th>Activity</th><th>Details</th></tr>
${row.repeat(6)}
</table>
<p>Prepared for ${esc(clientFirstName) || 'the client'}. If anything is unclear, contact the firm; do not guess.</p>`;
}

/** Model tier per document type — internal memos and plain-language
 *  client documents run on sonnet (fast, cheap); court filings and
 *  binding settlement documents get the strongest model. */
/**
 * Per-document generation timeout.
 *
 * The default 240s suits a letter, but several of these documents are long
 * structured memos: a severance assessment runs seven sections plus a
 * comparison table and measured 157s for a REDUCED prompt in testing, so the
 * real one (full intake, comparables, negotiation history) exceeded 240s and
 * failed outright. A timeout that fires on a document that was going to
 * succeed is worse than waiting, because the lawyer gets nothing and the
 * spend is already incurred.
 *
 * These are ceilings, not delays: a generation that finishes early returns
 * immediately. Timeouts are deliberately not retried (see cross-provider-chat)
 * because on a document this size a timeout is genuine rather than transient.
 */
function getTimeoutMs(docType: LitigationDocumentType): number {
  switch (docType) {
    // Long structured memos and briefs: several sections, tables, authorities.
    case 'severance_assessment':
    case 'mediation_brief':
    case 'settlement_conference_brief':
    case 'sj_factum':
    case 'sj_affidavit':
    case 'retainer_agreement':
    case 'settlement_minutes':
      return 600_000;
    default:
      return 240_000;
  }
}

function getModelTier(docType: LitigationDocumentType): 'opus' | 'sonnet' {
  switch (docType) {
    case 'severance_assessment':
    case 'retainer_agreement':
      return 'sonnet';
    default:
      return 'opus';
  }
}
