// Draft-tab data: the draftable-document catalogue, the id<->docType<->download
// maps, court-form field definitions, direction shapes, and small lookups.
// Extracted from MatterDetailView.tsx; pure data and types.

import type { DraftType } from './types.js';

/** Draft tab section order. */
export const DRAFT_SECTIONS = [
  'Advice and negotiation',
  'Pleadings and applications',
  'Motions and hearings',
  'Offers and settlement',
  'Court forms and service (no AI cost)',
] as const;


export const DEMO_DRAFT_TYPES: DraftType[] = [
  // ── Advice and negotiation ─────────────────────────────────────────────
  {
    id: 'severance',
    title: 'Severance Offer Assessment',
    description: 'Offer vs. ESA floor vs. common-law range, with a recommendation. Internal memo.',
    cost: '~$5 · 2 to 4 min',
    section: 'Advice and negotiation',
  },
  {
    id: 'counter',
    title: 'Counter-Offer Letter',
    description: 'Respond to the employer\u2019s severance offer with a reasoned counter-position.',
    cost: '~$10 · under 1 min',
    section: 'Advice and negotiation',
  },
  {
    id: 'rebuttal',
    title: 'Reply to Opposing Counsel',
    description: 'Answer their response letter point by point, correcting the record on your client\u2019s instructions.',
    cost: '~$5 \u00b7 2 to 4 min',
    section: 'Advice and negotiation',
  },
  {
    id: 'demand',
    title: 'Demand Letter',
    description: 'Demand to the employer\u2019s counsel with entitlements, deadline, and settlement position.',
    cost: '~$14 · under 1 min',
    section: 'Advice and negotiation',
  },
  {
    id: 'retainer',
    title: 'Retainer Agreement',
    description: 'Plain-language engagement agreement. Contingency matters use the mandatory standard-form CFA.',
    cost: '~$6 · under 1 min',
    section: 'Advice and negotiation',
  },
  {
    id: 'mitigation',
    title: 'Mitigation Log',
    description: 'Client-facing job-search record with instructions: the damages evidence that supports the notice claim.',
    cost: 'no charge · instant',
    section: 'Advice and negotiation',
  },
  // ── Pleadings and applications ─────────────────────────────────────────
  {
    id: 'soc',
    title: 'Statement of Claim',
    description: 'File in the Superior Court of Justice for wrongful dismissal and Code damages.',
    cost: '~$19 · under 1 min',
    section: 'Pleadings and applications',

  },
  {
    id: 'noa',
    title: 'Notice of Action (Form 14C)',
    description: 'Stops the limitation clock when there is no time to plead; the Statement of Claim follows within thirty days.',
    cost: '~$8 · under 1 min',
    section: 'Pleadings and applications',
  },
  {
    id: 'noticearb',
    title: 'Notice of Arbitration',
    description: 'Commences private arbitration under the employment contract’s arbitration clause and the Arbitration Act, 1991.',
    cost: '~$8 · under 1 min',
    section: 'Pleadings and applications',
  },
  {
    id: 'reply',
    title: 'Reply (Form 25A)',
    description: 'Respond to new matters in the Statement of Defence: cause allegations, mitigation, limitations.',
    cost: '~$11 · under 1 min',
    section: 'Pleadings and applications',
  },
  {
    id: 'schedulea',
    title: 'HRTO Schedule "A"',
    description: 'The narrative of allegations that accompanies Form 1: chronology, grounds, impact, s. 45.2 remedies.',
    cost: '~$10 · under 1 min',
    section: 'Pleadings and applications',
  },
  // ── Motions and hearings ───────────────────────────────────────────────
  {
    id: 'sjmotion',
    title: 'SJ Notice of Motion (Form 37A)',
    description: 'The Rule 20 summary judgment motion: relief and grounds tracking the approved issues.',
    cost: '~$9 · under 1 min',
    section: 'Motions and hearings',
  },
  {
    id: 'sjaffidavit',
    title: 'SJ Affidavit (Form 4D)',
    description: 'The plaintiff\u2019s sworn evidence from the intake facts. Every paragraph must be verified with the client before swearing.',
    cost: '~$14 · under 1 min',
    section: 'Motions and hearings',
  },
  {
    id: 'sjfactum',
    title: 'SJ Factum',
    description: 'The argument: Hryniak, Bardal, Waksdale, and the issue-specific authorities, from the approved issues only.',
    cost: '~$18 · 2 to 4 min',
    section: 'Motions and hearings',
  },
  {
    id: 'timetable',
    title: 'Timetable Package',
    description: 'The motion, the consent order and the draft order from one schedule, with the supporting affidavit. Simplified or ordinary procedure.',
    cost: '~$25 · about 1 min',
    section: 'Motions and hearings',
  },
  {
    id: 'undertakings',
    title: 'Answers to Undertakings',
    description: 'Answers, advisements, and refusals from the plaintiff\u2019s discovery, in numbered form.',
    cost: '~$12 · under 1 min',
    section: 'Motions and hearings',
  },
  {
    id: 'mediation',
    title: 'Mediation Brief',
    description: 'Rule 24.1 mandatory mediation brief with entitlement analysis and settlement range.',
    cost: '~$17 · 2 to 4 min',
    section: 'Motions and hearings',
  },
  {
    id: 'confbrief',
    title: 'Settlement Conference Brief',
    description: 'Rule 13 (Small Claims) or Rule 50 pre-trial brief; adapts to the matter\u2019s forum automatically.',
    cost: '~$14 · 2 to 4 min',
    section: 'Motions and hearings',
  },
  // ── Offers and settlement ──────────────────────────────────────────────
  {
    id: 'rule49',
    title: 'Offer to Settle (Form 49A)',
    description: 'Rule 49 offer with cost consequences: partial indemnity to the offer, substantial after.',
    cost: '~$7 · under 1 min',
    section: 'Offers and settlement',
  },
  {
    id: 'rule49acceptance',
    title: 'Acceptance of Offer (Form 49C)',
    description: 'Accepts the other side\u2019s Rule 49 offer and creates a binding settlement. Written client instructions first.',
    cost: 'no charge · instant',
    section: 'Offers and settlement',
  },
  {
    id: 'rule49withdrawal',
    title: 'Withdrawal of Offer (Form 49B)',
    description: 'Withdraws an outstanding offer and ends its cost consequences from the date of withdrawal.',
    cost: 'no charge · instant',
    section: 'Offers and settlement',
  },
  {
    id: 'minutes',
    title: 'Minutes of Settlement & Release',
    description: 'Settlement terms plus a full and final release with the carve-outs that must survive.',
    cost: '~$10 · under 1 min',
    section: 'Offers and settlement',
  },
  // ── Court forms and service ────────────────────────────────────────────
  {
    id: 'aos',
    title: 'Affidavit of Service (Form 16B)',
    description: 'Proof of service from the service details you enter. Sworn before a commissioner.',
    cost: 'no AI cost \u00B7 instant',
    section: 'Court forms and service (no AI cost)',
  },
  {
    id: 'costsoutline',
    title: 'Costs Outline (Form 57B)',
    description: 'The rule 57.01 costs claim from your rates, hours, and disbursements, with the arithmetic shown.',
    cost: 'no AI cost \u00B7 instant',
    section: 'Court forms and service (no AI cost)',
  },
  {
    id: 'esasheet',
    title: 'ESA Claim Filing Sheet',
    description: 'Every value the Ministry\u2019s online claim asks for, in one sheet, with the ss. 97/98 election caution.',
    cost: 'no AI cost \u00B7 instant',
    section: 'Court forms and service (no AI cost)',
  },
  {
    id: 'sccsheet',
    title: 'Small Claims Filing Sheet',
    description: 'The data-entry values for the online Form 7A filing, with the $50,000 limit checked against the claim.',
    cost: 'no AI cost \u00B7 instant',
    section: 'Court forms and service (no AI cost)',
  },
];


// ── Draft card → backend document type / download slug ─────────────────

export const DRAFT_TO_DOCTYPE: Record<string, string> = {
  demand: 'demand_letter',
  soc: 'statement_of_claim',
  mediation: 'mediation_brief',
  severance: 'severance_assessment',
  counter: 'counter_offer',
  rebuttal: 'rebuttal_letter',
  reply: 'reply',
  rule49: 'rule49_offer',
  minutes: 'settlement_minutes',
  retainer: 'retainer_agreement',
  mitigation: 'mitigation_log',
  confbrief: 'settlement_conference_brief',
  schedulea: 'hrto_schedule_a',
  noa: 'notice_of_action',
  noticearb: 'notice_of_arbitration',
  sjmotion: 'sj_notice_of_motion',
  sjaffidavit: 'sj_affidavit',
  sjfactum: 'sj_factum',
  timetable: 'sp_timetable_motion',
  undertakings: 'undertakings_answers',
  aos: 'affidavit_of_service',
  rule49withdrawal: 'rule49_withdrawal',
  rule49acceptance: 'rule49_acceptance',
  costsoutline: 'costs_outline',
  esasheet: 'esa_filing_sheet',
  sccsheet: 'scc_filing_sheet',
};


/** Structured inputs for the deterministic court forms. */
export interface CourtFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'date' | 'select' | 'textarea';
  options?: Array<[string, string]>;
  required?: boolean;
}


// The timetable steps, in the order they must occur. Unlike a deponent's
// name, these dates carry consequences: Starling checks their ordering and
// the Rule 48.14 window, writes them into Schedule A, and puts them on the
// docket, so they are worth collecting rather than leaving as placeholders.
// Every step a timetable might fix. All optional: fill what this action
// needs and the schedule carries exactly those, in this order.

export const COURT_FORM_FIELDS: Record<string, CourtFieldDef[]> = {
  mediation: [
    { key: 'mediation_date', label: 'Mediation date (goes on your docket)', type: 'date' },
    { key: 'mediator_name', label: 'Mediator', placeholder: 'e.g., R. Fisher' },
  ],
  // The three timetable cards use the custom-rows editor instead.
  aos: [
    { key: 'document_served', label: 'Document served', placeholder: 'e.g., Statement of Claim', required: true },
    { key: 'served_party', label: 'Party served', placeholder: 'e.g., the defendant corporation', required: true },
    { key: 'service_date', label: 'Date of service', type: 'date', required: true },
    {
      key: 'service_method', label: 'Method of service', type: 'select', required: true,
      options: [['personal', 'Personal service'], ['mail', 'Mail'], ['courier', 'Courier'], ['email', 'Email'], ['alternative', 'Alternative to personal service']],
    },
    { key: 'server_name', label: 'Served by (deponent)', placeholder: 'Name of the person who served', required: true },
    { key: 'server_city', label: 'Deponent’s city', placeholder: 'e.g., City of Toronto', required: true },
    { key: 'service_address', label: 'Address of service (optional)', placeholder: 'Where service was made' },
  ],
  rule49acceptance: [
    { key: 'offer_date', label: 'Date the offer was served', type: 'date', required: true },
    {
      key: 'offering_party', label: 'Whose offer is accepted', type: 'select', required: true,
      options: [['defendant', 'The defendant’s offer'], ['plaintiff', 'The plaintiff’s offer']],
    },
  ],
  rule49withdrawal: [
    { key: 'offer_date', label: 'Date our offer was served', type: 'date', required: true },
  ],
  costsoutline: [
    { key: 'actual_rate', label: 'Actual hourly rate (CAD)', placeholder: 'e.g., 450', required: true },
    { key: 'hours_total', label: 'Total hours', placeholder: 'e.g., 38.5', required: true },
    { key: 'partial_indemnity_rate', label: 'Partial indemnity rate (optional)', placeholder: 'defaults to 60% of actual' },
    { key: 'lawyer_year_of_call', label: 'Year of call', placeholder: 'e.g., 2015' },
    { key: 'step_description', label: 'Step in the proceeding', placeholder: 'e.g., the motion for summary judgment' },
    { key: 'disbursements', label: 'Disbursements (one per line, ending with the amount)', type: 'textarea', placeholder: 'Filing fees $229\nProcess server $150' },
  ],
};


export const DRAFT_TO_DOWNLOAD: Record<string, string> = {
  demand: 'demand-letter',
  soc: 'statement-of-claim',
  mediation: 'mediation-brief',
  severance: 'severance-assessment',
  counter: 'counter-offer',
  rebuttal: 'rebuttal-letter',
  reply: 'reply',
  rule49: 'rule49-offer',
  minutes: 'settlement-minutes',
  retainer: 'retainer-agreement',
  mitigation: 'mitigation-log',
  confbrief: 'settlement-conference-brief',
  schedulea: 'hrto-schedule-a',
  noa: 'notice-of-action',
  noticearb: 'notice-of-arbitration',
  sjmotion: 'sj-notice-of-motion',
  sjaffidavit: 'sj-affidavit',
  sjfactum: 'sj-factum',
  timetable: 'sp-timetable-motion',
  undertakings: 'undertakings-answers',
  aos: 'affidavit-of-service',
  rule49withdrawal: 'rule49-withdrawal',
  rule49acceptance: 'rule49-acceptance',
  costsoutline: 'costs-outline',
  esasheet: 'esa-filing-sheet',
  sccsheet: 'scc-filing-sheet',
};


/** Backend docType → draft card id, for reopening a document from the Documents tab. */
export const DOCTYPE_TO_DRAFT: Record<string, string> = Object.fromEntries(
  Object.entries(DRAFT_TO_DOCTYPE).map(([card, dt]) => [dt, card]),
);


/** Backend docType → DOCX download slug (the download route uses hyphens). */
export function downloadSlugFor(docType: string): string | null {
  const card = DOCTYPE_TO_DRAFT[docType];
  if (card && DRAFT_TO_DOWNLOAD[card]) return DRAFT_TO_DOWNLOAD[card];
  if (docType === 'hrto_application') return 'application';
  if (docType === 'demand_letter') return 'demand-letter';
  if (docType === 'statement_of_claim') return 'statement-of-claim';
  return null;
}


/** The documents the timetable package produces, each taught separately. */
export const PACKAGE_DOCS: Array<{ type: string; label: string }> = [
  { type: 'sp_timetable_motion', label: 'Notice of Motion (Timetable)' },
  { type: 'consent_timetable_order', label: 'Consent Order (Timetable)' },
  { type: 'timetable_order', label: 'Order (Timetable)' },
  { type: 'motion_affidavit', label: 'Affidavit in support' },
];


/** Cards that need a dollar amount before Generate makes sense. */
export interface DirectionInstructionUi {
  id?: string;
  text: string;
  kind: string;
  mustInclude?: string[];
  mustNotInclude?: string[];
}


export interface DirectionRecord {
  notes?: string;
  instructions: DirectionInstructionUi[];
  withheld?: string[];
  proposedHeads?: Array<{ label: string; basis?: string; amount?: number | null }>;
  updatedAt?: string;
  updatedByName?: string;
}


export interface DirectionProposal {
  instructions: DirectionInstructionUi[];
  withheld?: string[];
  proposedHeads?: Array<{ label: string; basis?: string; amount?: number | null }>;
}


/**
 * Triage for review flags. A flat wall of eleven flags gets three read; a
 * triaged list gets the red ones read first, which is the point. FIX is
 * something wrong on the page; CHECK is something to verify against the
 * file; FYI is standing ritual.
 */
export const DEMAND_SOURCE_KIND_LABELS: Record<string, string> = {
  employment_agreement: 'Employment agreement',
  termination_letter: 'Termination letter',
  roe: 'Record of employment',
  correspondence: 'Correspondence',
  policy_document: 'Policy document',
  other: 'Other',
};


export const DRAFTS_NEEDING_AMOUNT = new Set(['demand', 'soc', 'counter', 'rule49']);

