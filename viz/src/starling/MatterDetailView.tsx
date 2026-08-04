/**
 * MatterDetailView — Matter detail view for DemandPay Starling.
 *
 * Displays matter header with status badge, fact row, and five tabs:
 * Issues Found, Documents, Draft, Timeline, Notes.
 *
 * Context-sensitive action bar at the bottom changes based on matter state.
 * All demo data matches the Smith v Acme Corp scenario.
 *
 * Ontario employment law vocabulary (ESA, Bardal, Waksdale, HRTO).
 * Canadian spelling throughout (analyse, licenced).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMatterDetail, useEmploymentData, useFirmTemplates, useApprovalsEnabled } from './hooks/useStarlingApi.js';
import { ExtractionReviewPanel } from './ExtractionReviewPanel.js';
import { StyleProfilePanel, useStyleProfiles } from './StyleProfilePanel.js';
import { CaseFileDropPanel } from './CaseFileDropPanel.js';
import { PrecedentAlignPanel } from './PrecedentAlignPanel.js';
import { RevisionPanel } from './RevisionPanel.js';
import type { SourceCitation, DocumentExtraction } from './hooks/useStarlingApi.js';
import { useUserProfile } from '../my-page/hooks/useUserProfile.js';
import { useLabourData } from './hooks/useLabourApi.js';
import LabourMatterDetailView from './LabourMatterDetailView.js';
import { GateApprovalPanel, IntakeEditorPanel, GeneratedDocsPanel, NextStepsPanel, CloseMatterPanel, CorrespondencePanel, ComparablesPanel, NegotiationPanel, NetSettlementPanel, DebriefPanel } from './shared.js';
import type { IntakeFieldDef } from './shared.js';
// stepMapping.js exports (SOURCE_TAGS, SEVERITY_CONFIG) available for future use with live API data

// ── Design Tokens ───────────────────────────────────────────────────────
const navy = '#0f1a2e';
const orange = '#ea580c';
const cream = '#faf8f5';
const frame = '#e8e5e0';
const green = '#16a34a';
const amber = '#d97706';
const red = '#dc2626';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const serif = "Georgia, 'Palatino Linotype', serif";
const sans = "system-ui, -apple-system, sans-serif";

// ── Types ───────────────────────────────────────────────────────────────

type TabKey = 'issues' | 'docs' | 'draft' | 'timeline' | 'intake' | 'client' | 'negotiation' | 'debrief' | 'notes';

interface Issue {
  id: string;
  title: string;
  strength: 'strong' | 'moderate';
  description: string;
  descriptionBold: string[];
  sources: { label: string; type: 'verified' | 'statute' | 'web' | 'ai' }[];
}

interface DocItem {
  id: string;
  name: string;
  meta: string;
  group: 'uploaded' | 'generated';
  actions: { label: string; variant: 'default' | 'gen' }[];
}

interface DraftType {
  id: string;
  title: string;
  description: string;
  cost: string;
  section: string;
  recommended?: boolean;
  alreadyDrafted?: boolean;
}

/** Draft tab section order. */
const DRAFT_SECTIONS = [
  'Advice and negotiation',
  'Pleadings and applications',
  'Motions and hearings',
  'Offers and settlement',
  'Court forms and service (no AI cost)',
] as const;

interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  isCurrent?: boolean;
}

// ── Demo Data ───────────────────────────────────────────────────────────

const DEMO_ISSUES: Issue[] = [
  {
    id: 'wrongful-dismissal',
    title: 'Wrongful dismissal (without cause)',
    strength: 'strong',
    description: 'ESA statutory notice: 8 weeks (s. 57). Common law reasonable notice range under Bardal: 10-14 months given age, 8.3 years\u2019 service, managerial character, and limited comparable roles.',
    descriptionBold: ['8 weeks', 'Bardal', '10\u201314 months'],
    sources: [
      { label: 'statute · ESA s. 57', type: 'statute' },
      { label: 'verified · case_db', type: 'verified' },
    ],
  },
  {
    id: 'termination-clause',
    title: 'Termination clause likely void',
    strength: 'strong',
    description: 'The for-cause provision uses "just cause" rather than the ESA "wilful misconduct" standard. Under Waksdale v Swegon (2020 ONCA 391), if any part of the termination clause violates the ESA, the entire clause is void \u2014 defaulting Ms. Smith to common law notice.',
    descriptionBold: ['Waksdale v Swegon (2020 ONCA 391)', 'entire clause is void'],
    sources: [
      { label: 'verified · case_db', type: 'verified' },
      { label: 'ESA s. 5(1)', type: 'statute' },
    ],
  },
  {
    id: 'disability-discrimination',
    title: 'Possible disability discrimination',
    strength: 'moderate',
    description: 'Termination followed shortly after a disability accommodation request. Potential Human Rights Code claim (failure to accommodate / reprisal). Requires further evidence on timing and decision-makers.',
    descriptionBold: ['Human Rights Code'],
    sources: [
      { label: 'web source · verify', type: 'web' },
      { label: 'ai_knowledge', type: 'ai' },
    ],
  },
  {
    id: 'bad-faith',
    title: 'Bad faith \u2014 manner of dismissal',
    strength: 'moderate',
    description: 'Client terminated the same day as the accommodation request, with no notice or explanation. Potential aggravated/moral damages under Honda v Keays (2008 SCC 39).',
    descriptionBold: ['same day', 'Honda v Keays (2008 SCC 39)'],
    sources: [
      { label: 'verified · case_db', type: 'verified' },
    ],
  },
];

const DEMO_DOCS: DocItem[] = [
  {
    id: 'd1',
    name: 'Smith_Termination_Letter.pdf',
    meta: 'Uploaded Jun 18 · facts extracted · termination date, offer of 4 weeks',
    group: 'uploaded',
    actions: [{ label: 'View', variant: 'default' }, { label: 'Extract data', variant: 'default' }],
  },
  {
    id: 'd2',
    name: 'Smith_Employment_Agreement_2018.pdf',
    meta: 'Uploaded Jun 18 · termination clause flagged (Waksdale)',
    group: 'uploaded',
    actions: [{ label: 'View', variant: 'default' }, { label: 'Review', variant: 'default' }],
  },
  {
    id: 'd3',
    name: 'Record_of_Employment.pdf',
    meta: 'Uploaded Jun 18 · salary $95,000 + benefits confirmed',
    group: 'uploaded',
    actions: [{ label: 'View', variant: 'default' }],
  },
  {
    id: 'd4',
    name: 'Demand Letter \u2014 Smith v Acme Corp',
    meta: 'Generated Jun 22 · Quality 92/100 · PASS · 8 verification passes',
    group: 'generated',
    actions: [{ label: 'Open', variant: 'gen' }, { label: 'Results', variant: 'default' }],
  },
  {
    id: 'd5',
    name: 'Entitlements Summary (ESA + Bardal)',
    meta: 'Generated Jun 22 · CSV / DOCX · per-cell source citations',
    group: 'generated',
    actions: [{ label: 'Open', variant: 'default' }],
  },
];

const DEMO_DRAFT_TYPES: DraftType[] = [
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
    recommended: true,
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
    id: 'sptimetable',
    title: 'Timetable Motion (Simplified Procedure)',
    description: 'Rule 76 motion to fix dates for the remaining steps, with a proposed timetable schedule.',
    cost: '~$9 · under 1 min',
    section: 'Motions and hearings',
  },
  {
    id: 'consenttimetable',
    title: 'Consent Order (Timetable)',
    description: 'The order for signature by all counsel on consent, with the agreed dates.',
    cost: '~$7 · under 1 min',
    section: 'Motions and hearings',
  },
  {
    id: 'timetableorder',
    title: 'Order (Timetable)',
    description: 'The draft order to place before the court on a contested timetable motion.',
    cost: '~$7 · under 1 min',
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

const DEMO_TIMELINE: TimelineEvent[] = [
  {
    id: 't1',
    date: 'Jun 22, 2026 · 2:14 PM',
    title: 'Demand letter drafted \u2014 Quality 92/100, PASS',
    subtitle: 'Adversarial workflow · 8 verification passes · cost $3.47',
    isCurrent: true,
  },
  {
    id: 't2',
    date: 'Jun 22, 2026 · 2:02 PM',
    title: 'Entitlements calculated (ESA + Bardal)',
    subtitle: 'ESA notice 8 weeks; common law 10\u201314 months',
  },
  {
    id: 't3',
    date: 'Jun 18, 2026 · 4:40 PM',
    title: 'Issue analysis complete \u2014 4 issues identified',
    subtitle: '2 strong, 2 moderate · termination clause flagged under Waksdale',
  },
  {
    id: 't4',
    date: 'Jun 18, 2026 · 4:35 PM',
    title: '3 documents uploaded & facts extracted',
    subtitle: 'Termination letter, employment agreement, ROE',
  },
  {
    id: 't5',
    date: 'Jun 18, 2026 · 4:30 PM',
    title: 'Matter created',
    subtitle: 'Client: Jane Smith · Employer: Acme Corporation',
  },
];

// ── Draft card → backend document type / download slug ─────────────────

const DRAFT_TO_DOCTYPE: Record<string, string> = {
  demand: 'demand_letter',
  soc: 'statement_of_claim',
  mediation: 'mediation_brief',
  severance: 'severance_assessment',
  counter: 'counter_offer',
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
  sptimetable: 'sp_timetable_motion',
  consenttimetable: 'consent_timetable_order',
  timetableorder: 'timetable_order',
  undertakings: 'undertakings_answers',
  aos: 'affidavit_of_service',
  rule49withdrawal: 'rule49_withdrawal',
  rule49acceptance: 'rule49_acceptance',
  costsoutline: 'costs_outline',
  esasheet: 'esa_filing_sheet',
  sccsheet: 'scc_filing_sheet',
};

/** Structured inputs for the deterministic court forms. */
interface CourtFieldDef {
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
const TIMETABLE_FIELDS: CourtFieldDef[] = [
  { key: 'affidavits_of_documents', label: 'Affidavits of documents exchanged', type: 'date' },
  { key: 'productions', label: 'Documentary productions delivered', type: 'date' },
  { key: 'examinations', label: 'Examinations for discovery completed', type: 'date' },
  { key: 'mediation', label: 'Mediation completed', type: 'date' },
  { key: 'set_down', label: 'Action set down for trial', type: 'date' },
  { key: 'pre_trial', label: 'Pre-trial conference', type: 'date' },
  { key: 'trial', label: 'Trial', type: 'date' },
];

const COURT_FORM_FIELDS: Record<string, CourtFieldDef[]> = {
  mediation: [
    { key: 'mediation_date', label: 'Mediation date (goes on your docket)', type: 'date' },
    { key: 'mediator_name', label: 'Mediator', placeholder: 'e.g., R. Fisher' },
  ],
  sptimetable: TIMETABLE_FIELDS,
  consenttimetable: TIMETABLE_FIELDS,
  timetableorder: TIMETABLE_FIELDS,
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

const DRAFT_TO_DOWNLOAD: Record<string, string> = {
  demand: 'demand-letter',
  soc: 'statement-of-claim',
  mediation: 'mediation-brief',
  severance: 'severance-assessment',
  counter: 'counter-offer',
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
  sptimetable: 'sp-timetable-motion',
  consenttimetable: 'consent-timetable-order',
  timetableorder: 'timetable-order',
  undertakings: 'undertakings-answers',
  aos: 'affidavit-of-service',
  rule49withdrawal: 'rule49-withdrawal',
  rule49acceptance: 'rule49-acceptance',
  costsoutline: 'costs-outline',
  esasheet: 'esa-filing-sheet',
  sccsheet: 'scc-filing-sheet',
};

/** Backend docType → draft card id, for reopening a document from the Documents tab. */
const DOCTYPE_TO_DRAFT: Record<string, string> = Object.fromEntries(
  Object.entries(DRAFT_TO_DOCTYPE).map(([card, dt]) => [dt, card]),
);

/** Backend docType → DOCX download slug (the download route uses hyphens). */
function downloadSlugFor(docType: string): string | null {
  const card = DOCTYPE_TO_DRAFT[docType];
  if (card && DRAFT_TO_DOWNLOAD[card]) return DRAFT_TO_DOWNLOAD[card];
  if (docType === 'hrto_application') return 'application';
  if (docType === 'demand_letter') return 'demand-letter';
  if (docType === 'statement_of_claim') return 'statement-of-claim';
  return null;
}

/** Cards that need a dollar amount before Generate makes sense. */
const DRAFTS_NEEDING_AMOUNT = new Set(['demand', 'soc', 'counter', 'rule49']);

// ── Review lane controls ────────────────────────────────────────────────
// The submitter's side of the firm approval queue, shown under the draft's
// status row: send for approval, see feedback, resubmit, withdraw.

const OPEN_REVIEW_STATUSES = ['pending', 'in_review', 'changes_requested', 'resubmitted'];

interface ReviewRowLite {
  id: string;
  matterId: string;
  docType: string;
  status: string;
  changesDescription: string | null;
  dueDate: string;
}

function ReviewLaneControls({ matterId, docType, onApplyFeedback }: { matterId: string; docType: string; onApplyFeedback?: (feedback: string) => void }) {
  const [review, setReview] = useState<ReviewRowLite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/reviews', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return;
        const rows = (d.mine ?? []) as ReviewRowLite[];
        const forDoc = rows.filter(r => r.matterId === matterId && r.docType === docType);
        setReview(forDoc.find(r => OPEN_REVIEW_STATUSES.includes(r.status)) ?? forDoc.find(r => r.status === 'approved') ?? null);
      })
      .catch(() => { /* the panel is optional chrome; the queue view is authoritative */ });
  }, [matterId, docType]);
  useEffect(() => { load(); }, [load]);

  const run = async (method: 'POST' | 'DELETE', path: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(path, { method, credentials: 'include', headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ docType }) : undefined });
      const d = await res.json();
      if (!d.ok) setError(d.error ?? 'The action failed.');
      load();
    } catch { setError('The action failed.'); } finally { setBusy(false); }
  };

  const chipStyle = (colour: string) => ({
    fontSize: 11.5, fontWeight: 700, color: colour, border: `1px solid ${colour}`,
    borderRadius: 2, padding: '2px 8px', textTransform: 'uppercase' as const, letterSpacing: 0.4,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: muted }}>Approval:</span>
      {!review && (
        <button
          onClick={() => void run('POST', `/api/employment/${matterId}/reviews`)}
          disabled={busy}
          style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: busy ? 'wait' : 'pointer' }}
        >
          Send for approval
        </button>
      )}
      {review?.status === 'approved' && <span style={chipStyle(green)}>Approved</span>}
      {review && review.status !== 'approved' && (
        <>
          <span style={chipStyle(review.status === 'changes_requested' ? red : amber)}>
            {review.status === 'changes_requested' ? 'Changes requested' : review.status === 'in_review' ? 'In review' : 'Awaiting review'}
          </span>
          {review.status === 'changes_requested' && (
            <button
              onClick={() => void run('POST', `/api/reviews/${review.id}/resubmit`)}
              disabled={busy}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans, background: navy, color: '#fff', border: `1px solid ${navy}`, cursor: busy ? 'wait' : 'pointer' }}
            >
              Resubmit
            </button>
          )}
          <button
            onClick={() => void run('DELETE', `/api/reviews/${review.id}`)}
            disabled={busy}
            style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans, background: '#fff', color: red, border: `1px solid ${red}`, cursor: busy ? 'wait' : 'pointer' }}
          >
            Withdraw
          </button>
          <a href="#/approvals" style={{ fontSize: 12, color: navy }}>Open queue</a>
        </>
      )}
      {review?.status === 'changes_requested' && review.changesDescription && (
        <span style={{ flexBasis: '100%', fontSize: 12.5, color: ink, background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2, padding: '8px 12px' }}>
          <b>Reviewer feedback:</b> {review.changesDescription}
          {onApplyFeedback && (
            <button
              onClick={() => onApplyFeedback(review.changesDescription ?? '')}
              style={{
                marginLeft: 10, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 2,
                fontFamily: sans, background: navy, color: '#fff', border: `1px solid ${navy}`, cursor: 'pointer',
              }}
            >
              Apply this feedback
            </button>
          )}
        </span>
      )}
      {error && <span role="alert" style={{ flexBasis: '100%', fontSize: 12.5, color: red }}>{error}</span>}
    </div>
  );
}

// ── Intake editor fields ────────────────────────────────────────────────
// The core analysis-driving fields. The editor merges into the existing
// intake, so fields it does not show are preserved.

const EMPLOYMENT_INTAKE_FIELDS: IntakeFieldDef[] = [
  { key: 'client_first_name', label: 'Client first name' },
  { key: 'client_last_name', label: 'Client last name' },
  { key: 'client_age', label: 'Client age', type: 'number' },
  { key: 'employer_legal_name', label: 'Employer legal name' },
  { key: 'job_title', label: 'Job title' },
  { key: 'annual_salary', label: 'Annual salary (CAD)', type: 'number' },
  { key: 'hire_date', label: 'Hire date', type: 'date' },
  { key: 'termination_date', label: 'Termination date', type: 'date' },
  { key: 'termination_reasons', label: 'Stated reason for termination' },
  { key: 'was_terminated', label: 'Terminated by the employer', type: 'checkbox' },
  { key: 'is_constructive_dismissal', label: 'Constructive dismissal', type: 'checkbox' },
  { key: 'employer_alleged_just_cause', label: 'Employer alleged just cause', type: 'checkbox' },
  { key: 'believes_discriminatory_termination', label: 'Discrimination dimension (starts the HRTO clock)', type: 'checkbox' },
  { key: 'received_severance_offer', label: 'Severance offer received', type: 'checkbox' },
  { key: 'severance_weeks_offered', label: 'Severance weeks offered', type: 'number' },
  { key: 'severance_deadline', label: 'Severance offer deadline', type: 'date' },
];

// ── Tab definitions ─────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string; badge?: number }[] = [
  { key: 'issues', label: 'Issues Found', badge: 4 },
  { key: 'docs', label: 'Documents', badge: 5 },
  { key: 'draft', label: 'Draft' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'notes', label: 'Notes' },
];

// ── Source tag styles ───────────────────────────────────────────────────

function getSourceStyle(type: 'verified' | 'statute' | 'web' | 'ai'): React.CSSProperties {
  switch (type) {
    case 'verified':
      return { background: '#e7f6ec', color: green };
    case 'statute':
      return { background: '#eef1f6', color: navy };
    case 'web':
      return { background: '#fdf0dd', color: amber };
    case 'ai':
      return { background: '#f4f1ec', color: muted };
  }
}

function getSourcePrefix(type: 'verified' | 'statute' | 'web' | 'ai'): string {
  switch (type) {
    case 'verified': return '';
    case 'statute': return '';
    case 'web': return '';
    case 'ai': return '';
  }
}

// ── Colour-coded dot component ──────────────────────────────────────────

function StatusDot({ colour, size = 8 }: { colour: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: colour,
        display: 'inline-block',
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

// ── Source tag with coloured dot ─────────────────────────────────────────

function SourceTag({ label, type }: { label: string; type: 'verified' | 'statute' | 'web' | 'ai' }) {
  const style = getSourceStyle(type);
  const dotColour = type === 'verified' ? green : type === 'web' ? amber : type === 'statute' ? navy : muted;
  const prefix = type === 'verified' ? 'verified' : type === 'web' ? 'web source' : type === 'statute' ? 'statute' : '';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 2,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <StatusDot colour={dotColour} size={6} />
      {label}
    </span>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export default function MatterDetailView() {
  // Lawyer/firm details from the Starling Profile — flow into generated documents
  const { profile } = useUserProfile();
  // A matter opened straight after creation lands on Documents, because the
  // next real step is adding the client's paperwork. The New Matter form no
  // longer takes uploads, so without this the lawyer is left on Issues with
  // nothing to act on and no hint where the documents go.
  const openedFresh = window.location.hash.includes('new=1');
  const [activeTab, setActiveTab] = useState<TabKey>(openedFresh ? 'docs' : 'issues');
  const [showDocsHint, setShowDocsHint] = useState(openedFresh);
  const [editingFileNumber, setEditingFileNumber] = useState(false);
  const [fileNumberDraft, setFileNumberDraft] = useState('');
  const [keyDate, setKeyDate] = useState({ date: '', label: '', category: 'legal', courtDeadline: true });
  const [keyDateSaving, setKeyDateSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesStatus, setNotesStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedDraft, setSelectedDraft] = useState<string | null>('soc');
  const [draftFilter, setDraftFilter] = useState('');
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [genCitations, setGenCitations] = useState<SourceCitation[]>([]);
  const [genReviewFlags, setGenReviewFlags] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genNotice, setGenNotice] = useState<string | null>(null);
  const [genTone, setGenTone] = useState('professional');
  const [genDemandAmount, setGenDemandAmount] = useState('');
  const [genCourtLocation, setGenCourtLocation] = useState(profile.defaultCourtLocation || 'Toronto');
  const [genProcedure, setGenProcedure] = useState('simplified');
  // Structured inputs for the deterministic court forms
  const [courtFields, setCourtFields] = useState<Record<string, string>>({});
  // Client intake portal (lawyer side)
  const [intakeLink, setIntakeLink] = useState<string | null>(null);
  const [intakeLinkCopied, setIntakeLinkCopied] = useState(false);
  const [pendingClient, setPendingClient] = useState<{ data?: Record<string, unknown>; submittedAt?: string; appliedAt?: string } | null>(null);
  const [portalMessage, setPortalMessage] = useState<string | null>(null);
  const refreshPendingClient = useCallback(() => {
    const sid = window.location.hash.split('?')[0].match(/#\/matter-detail\/(.+)/)?.[1]?.replace(/\s+/g, '');
    if (!sid) return;
    fetch(`/api/employment/${sid}/client-intake`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setPendingClient(d.pending ?? null); })
      .catch(() => { /* best-effort */ });
  }, []);
  useEffect(() => { refreshPendingClient(); }, [refreshPendingClient]);
  // Docs tab: upload & extract
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState('employment_agreement');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [lastExtraction, setLastExtraction] = useState<DocumentExtraction | null>(null);
  // Analysis empty state
  const [analysing, setAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState<string | null>(null);
  // Firm templates
  const firmTemplates = useFirmTemplates();
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [pendingTemplateFile, setPendingTemplateFile] = useState<File | null>(null);
  const [pendingTemplateLabel, setPendingTemplateLabel] = useState('');
  const templateInputRef = useRef<HTMLInputElement>(null);
  // Draft version history
  interface DraftHistoryEntry { docType: string; title: string; html: string; costUsd: number; generatedAt: string; meta?: Record<string, unknown> }
  const [draftHistory, setDraftHistory] = useState<DraftHistoryEntry[]>([]);
  const refreshDraftHistory = useCallback(() => {
    const sid = window.location.hash.split('?')[0].match(/#\/matter-detail\/(.+)/)?.[1]?.replace(/\s+/g, '');
    if (!sid) return;
    fetch(`/api/employment/${sid}/drafts`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setDraftHistory(d.drafts ?? []); })
      .catch(() => { /* history is best-effort */ });
  }, []);
  useEffect(() => { refreshDraftHistory(); }, [refreshDraftHistory]);

  // Client update draft
  const [clientUpdateHtml, setClientUpdateHtml] = useState<string | null>(null);
  const [clientUpdateLoading, setClientUpdateLoading] = useState(false);
  const [clientUpdateError, setClientUpdateError] = useState<string | null>(null);
  const [clientUpdateCopied, setClientUpdateCopied] = useState(false);

  const handleNav = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  // Extract sessionId from hash
  const rawSid = window.location.hash.split('?')[0].match(/#\/matter-detail\/(.+)/)?.[1] ?? null;
  const sessionId = rawSid?.replace(/\s+/g, '') ?? null;

  // Wire hook data
  const { matter, loading, error, refresh: refreshMatter } = useMatterDetail(sessionId);
  const employment = useEmploymentData(sessionId);
  // Labour (grievance) matters render the labour view instead — detected
  // by the presence of grievance data on the matter
  const labour = useLabourData(sessionId);
  const isLabourMatter = Boolean(labour.data && Object.keys(labour.data.intake ?? {}).length > 0);

  // Sync lawyer notes from the server once loaded. Notes start empty: a new
  // file must never open pre-filled with another client's facts.
  useEffect(() => {
    if (employment.lawyerNotes !== null) {
      setNotes(employment.lawyerNotes);
    }
  }, [employment.lawyerNotes]);

  // Gate approve/dismiss — a gate is "approved" when its issue codes are in
  // the approved list. Toggling recomputes both lists and syncs to the server.
  // Gates with no issue codes (e.g. G16 "closing block") are structural
  // directives, not lawyer decisions — no approve/dismiss for those.
  const triggeredGates = employment.data?.gates?.filter(g => g.triggered && g.issueCodes.length > 0) ?? [];
  const structuralGates = employment.data?.gates?.filter(g => g.triggered && g.issueCodes.length === 0) ?? [];
  const gateDecision = useCallback((gate: { issueCodes: string[] }): 'approved' | 'dismissed' | 'pending' => {
    if (!employment.data) return 'pending';
    if (gate.issueCodes.some(c => employment.data!.approvedIssues.includes(c))) return 'approved';
    if (gate.issueCodes.some(c => employment.data!.dismissedIssues.includes(c))) return 'dismissed';
    return 'pending';
  }, [employment.data]);

  const setGateDecision = useCallback((gate: { issueCodes: string[] }, decision: 'approve' | 'dismiss') => {
    if (!employment.data) return;
    const approved = new Set(employment.data.approvedIssues);
    const dismissed = new Set(employment.data.dismissedIssues);
    for (const code of gate.issueCodes) {
      if (decision === 'approve') { approved.add(code); dismissed.delete(code); }
      else { dismissed.add(code); approved.delete(code); }
    }
    employment.approveIssues([...approved], [...dismissed]);
  }, [employment]);


  // Draft a plain-language client status update (lawyer reviews + sends)
  const handleClientUpdate = useCallback(async () => {
    if (!sessionId || clientUpdateLoading) return;
    setClientUpdateLoading(true);
    setClientUpdateError(null);
    try {
      const res = await fetch(`/api/employment/${sessionId}/client-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) {
        setClientUpdateError(json.error ?? 'Draft generation failed.');
      } else {
        setClientUpdateHtml(json.html);
      }
    } catch {
      setClientUpdateError('Could not reach the server.');
    } finally {
      setClientUpdateLoading(false);
    }
  }, [sessionId, clientUpdateLoading]);

  // Docs tab: file selection → parse + detect type → lawyer confirms → extract.
  // The detected kind pre-selects the dropdown; extraction never runs on an
  // unconfirmed type (a wrong classification costs one click, not a wrong fact).
  const [pendingUpload, setPendingUpload] = useState<{
    content: string; name: string; definedTerms?: string[];
    detectedKind?: string; confidence?: 'high' | 'medium' | 'low'; fallback?: boolean;
  } | null>(null);
  const [classifying, setClassifying] = useState(false);

  const handleClassifyFile = useCallback(async (file: File) => {
    setClassifying(true);
    setExtractError(null);
    setLastExtraction(null);
    setPendingUpload(null);
    const result = await employment.classifyDocument(file);
    setClassifying(false);
    if (!result.ok || !result.content || !result.name) {
      setExtractError(result.error ?? 'Could not read the document.');
      return;
    }
    if (result.kind && !result.fallback) setUploadKind(result.kind);
    setPendingUpload({
      content: result.content, name: result.name, definedTerms: result.definedTerms,
      detectedKind: result.kind, confidence: result.confidence, fallback: result.fallback,
    });
  }, [employment]);

  const handleExtractConfirmed = useCallback(async () => {
    if (!pendingUpload) return;
    setExtracting(true);
    setExtractError(null);
    const result = await employment.extractParsed(pendingUpload.content, pendingUpload.name, uploadKind, pendingUpload.definedTerms);
    setExtracting(false);
    setPendingUpload(null);
    if (result.ok && result.extraction) {
      setLastExtraction(result.extraction);
    } else {
      setExtractError(result.error ?? 'Extraction failed.');
    }
  }, [employment, uploadKind, pendingUpload]);

  // Firm templates for the selected draft type. A firm may hold several
  // variants per type (constructive dismissal, medical leave, and so on);
  // the lawyer picks one and the download renders on it.
  const selectedTemplateDocType = selectedDraft ? DRAFT_TO_DOCTYPE[selectedDraft] : undefined;
  const styleProfiles = useStyleProfiles(selectedTemplateDocType);
  // Changing document type invalidates the picked style.
  useEffect(() => { setStyleProfileId(''); }, [selectedTemplateDocType]);
  const variantsForType = selectedTemplateDocType
    ? firmTemplates.templates.filter(t => t.documentType === selectedTemplateDocType)
    : [];
  const [chosenVariantId, setChosenVariantId] = useState<string | null>(null);
  const [buildingTemplate, setBuildingTemplate] = useState(false);
  const [buildingStyle, setBuildingStyle] = useState(false);
  const [styleProfileId, setStyleProfileId] = useState('');
  const approvalsEnabled = useApprovalsEnabled();
  const [revising, setRevising] = useState<null | { source: 'client' | 'partner'; initial?: string }>(null);

  // Reset the choice when the document type changes, and keep a stale id
  // (deleted or renamed variant) from lingering.
  useEffect(() => { setChosenVariantId(null); }, [selectedTemplateDocType]);

  const activeVariant = variantsForType.find(t => t.variantId === chosenVariantId)
    ?? variantsForType.find(t => t.isDefault)
    ?? variantsForType[0];
  const currentTemplate = activeVariant;

  const handleTemplateUpload = useCallback(async (file: File, label?: string) => {
    if (!selectedTemplateDocType) return;
    setTemplateStatus('Uploading...');
    const result = await firmTemplates.upload(file, selectedTemplateDocType, label ? { label } : undefined);
    setTemplateStatus(result.ok
      ? `Template saved. ${result.placeholders?.length ?? 0} placeholder${(result.placeholders?.length ?? 0) === 1 ? '' : 's'} detected.`
      : result.error ?? 'Upload failed.');
  }, [firmTemplates, selectedTemplateDocType]);

  // ── Deep Analysis — launch a multi-agent session pre-filled from this
  // matter. Seeds the same sessionStorage keys the engagement flow reads
  // (briefing memo, config, team), then enters at Strategy.
  const DEEP_ANALYSES: Record<string, {
    label: string; workflowId: string; intensity: string; budgetUsd: number;
    matterType: string; team: string[]; question: string;
  }> = {
    second_opinion: {
      label: 'Second Opinion', workflowId: 'counsel', intensity: 'standard', budgetUsd: 10,
      matterType: 'case_assessment',
      team: ['employment-counsel'],
      question: 'Provide a second opinion on this matter: the merits, the entitlements analysis, and the strategy. Identify anything the analysis to date has missed or overstated.',
    },
    moot: {
      label: "Moot the Employer's Response", workflowId: 'adversarial', intensity: 'thorough', budgetUsd: 25,
      matterType: 'case_assessment',
      team: ['employment-counsel', 'litigation-partner', 'red-team', 'synthesis-editor'],
      question: "Anticipate the employer's strongest response. Attack our position exactly as employer's counsel would (termination clause enforceability, mitigation, cause allegations, quantum), then assess how our claims hold up and how to shore up the weak points before we send anything.",
    },
    assessment: {
      label: 'Full Case Assessment', workflowId: 'review', intensity: 'thorough', budgetUsd: 25,
      matterType: 'case_assessment',
      team: ['employment-counsel', 'contract-reviewer', 'legal-researcher', 'evaluator'],
      question: 'Full case assessment: merits of each claim, realistic damages range, procedural strategy (forum, timing, limitation pressure), litigation risks, and recommended next steps.',
    },
    settlement: {
      label: 'Settlement Valuation', workflowId: 'roundtable', intensity: 'standard', budgetUsd: 20,
      matterType: 'settlement',
      team: ['employment-counsel', 'litigation-partner', 'arbitration-specialist', 'synthesis-editor'],
      question: 'Value this case for settlement: realistic outcome range, the ESA floor, adjustments for litigation cost and risk, tax-effective structuring options, and a negotiation strategy.',
    },
  };

  const launchDeepAnalysis = useCallback((key: string) => {
    const spec = DEEP_ANALYSES[key];
    if (!spec || !sessionId) return;
    const intake = (employment.data?.intake ?? {}) as Record<string, unknown>;
    const analysis = employment.data?.analysis as Record<string, unknown> | null;
    const clientName = [intake.client_first_name, intake.client_last_name].filter(Boolean).join(' ') || matter?.client || 'Client';
    const employerName = (intake.employer_legal_name as string) || matter?.employer || 'Employer';
    const title = `${spec.label}: ${clientName} v ${employerName}`;

    // Build the briefing memo from what Starling already knows
    const lines: string[] = [
      `# Deep Analysis: ${spec.label}`,
      `Matter: ${clientName} v ${employerName}`,
      '',
      '## Question for the team',
      spec.question,
      '',
      '## Intake facts',
      `- Client: ${clientName}${intake.job_title ? `, ${intake.job_title}` : ''}`,
      `- Employer: ${employerName}`,
      intake.annual_salary ? `- Annual salary: $${Number(intake.annual_salary).toLocaleString('en-CA')}` : '',
      intake.hire_date ? `- Employment: ${intake.hire_date} to ${intake.termination_date ?? 'present'}` : '',
      intake.termination_reasons ? `- Stated reason for termination: ${intake.termination_reasons}` : '',
      intake.employer_alleged_just_cause ? '- Employer alleges just cause' : '',
      intake.is_constructive_dismissal ? '- Constructive dismissal claimed' : '',
    ];
    const gates = employment.data?.gates?.filter(g => g.triggered) ?? [];
    if (gates.length > 0) {
      lines.push('', '## Issues identified (16-gate analysis)');
      for (const g of gates) {
        const approved = g.issueCodes.some(c => employment.data!.approvedIssues.includes(c));
        lines.push(`- [${approved ? 'APPROVED' : 'pending'}] ${g.reason}`);
      }
    }
    if (analysis) {
      const dmg = analysis.damagesEstimate as Record<string, unknown> | undefined;
      const lim = analysis.limitationDeadline as Record<string, unknown> | undefined;
      lines.push('', '## Analysis to date');
      if (dmg) {
        lines.push(`- ESA notice: ${dmg.esaNoticeWeeks} weeks ($${Number(dmg.esaNoticePay ?? 0).toLocaleString('en-CA')}); ESA severance: $${Number(dmg.esaSeverancePay ?? 0).toLocaleString('en-CA')}`);
        lines.push(`- Common law range: ${dmg.commonLawLowMonths}–${dmg.commonLawHighMonths} months ($${Number(dmg.commonLawLowAmount ?? 0).toLocaleString('en-CA')}–$${Number(dmg.commonLawHighAmount ?? 0).toLocaleString('en-CA')})`);
      }
      if (lim?.date) lines.push(`- Limitation deadline: ${lim.date} (${lim.daysRemaining} days remaining${lim.urgent ? '; URGENT' : ''})`);
      if (analysis.recommendedProcedure) lines.push(`- Recommended procedure: ${analysis.recommendedProcedure}`);
    }
    const timeline = employment.data?.timeline ?? [];
    if (timeline.length > 0) {
      lines.push('', '## Timeline');
      for (const ev of timeline.slice(0, 12)) lines.push(`- ${ev.date}: ${ev.label}`);
    }

    sessionStorage.setItem('shem-matter-id', sessionId);
    sessionStorage.setItem('shem-matter-data', JSON.stringify({
      matterId: sessionId,
      matterNumber: matter?.number ?? sessionId,
      clientName,
      matterTitle: title,
      matterType: spec.matterType,
      jurisdiction: 'Ontario',
      response: {
        conflictCheck: { conflictFound: false },
        kyc: { clientVerified: true, riskLevel: 'low', flags: [] },
        engagementLetter: {
          scope: spec.question,
          feeStructure: 'fixed',
          estimatedBudget: { min: spec.budgetUsd, max: spec.budgetUsd, currency: 'USD' },
          accepted: true,
        },
      },
    }));
    sessionStorage.setItem('shem-briefing-memo', lines.filter(l => l !== '').join('\n'));
    sessionStorage.setItem('shem-briefing-config', JSON.stringify({
      workflowId: spec.workflowId,
      intensity: spec.intensity,
      budgetUsd: spec.budgetUsd,
      yoloMode: false,
      verification: spec.workflowId !== 'counsel',
      provider: 'anthropic',
    }));
    sessionStorage.setItem('shem-briefing-team', JSON.stringify(spec.team));

    // Record the launch on the matter timeline (fire-and-forget) so the
    // matter file shows when analyses were commissioned
    fetch(`/api/employment/${sessionId}/timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        label: `Deep Analysis launched: ${spec.label}`,
        description: 'Results appear in My Cases when the session completes.',
        category: 'legal',
      }),
    }).catch(() => { /* non-fatal */ });

    window.location.hash = '#/strategy';
  }, [employment.data, matter, sessionId]);

  // Compute tab badge counts from hook data
  const issueCount = matter?.issues.length ?? 0;
  const docCount = matter?.documents.length ?? 0;
  const dynamicTabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'issues', label: 'Issues Found', badge: issueCount || undefined },
    { key: 'docs', label: 'Documents', badge: docCount || undefined },
    { key: 'draft', label: 'Draft' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'intake', label: 'Intake' },
    { key: 'client', label: 'Client' },
    { key: 'negotiation', label: 'Negotiation' },
    { key: 'debrief', label: 'Debrief' },
    { key: 'notes', label: 'Notes' },
  ];

  // Labour matters get the grievance view (same shell, labour tabs)
  if (isLabourMatter && sessionId) {
    return <LabourMatterDetailView sessionId={sessionId} matterNumber={matter?.number} />;
  }

  // Loading state — wait for the labour probe too, so grievance matters
  // don't flash the employment view before switching
  if (loading || labour.loading) {
    return (
      <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
        <MatterDetailTopBar />
        <main id="main-content" style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 28px 60px' }}>
          <a href="#/" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: muted, fontSize: 13.5, marginBottom: 16, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); handleNav('#/'); }}>
            &larr; My Cases
          </a>
          <div style={{ padding: '60px 0', textAlign: 'center', color: muted, fontSize: 15 }}>Loading matter...</div>
        </main>
      </div>
    );
  }

  // Not found state
  if (!matter && !loading) {
    return (
      <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
        <MatterDetailTopBar />
        <main id="main-content" style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 28px 60px' }}>
          <a href="#/" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: muted, fontSize: 13.5, marginBottom: 16, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); handleNav('#/'); }}>
            &larr; My Cases
          </a>
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 16, color: ink, fontWeight: 600, marginBottom: 8 }}>Matter not found</div>
            <div style={{ fontSize: 13.5, color: muted, marginBottom: 14 }}>{error || 'The requested matter could not be loaded.'}</div>
            <a href="#/" style={{ fontSize: 13.5, fontWeight: 600, color: orange, textDecoration: 'none' }} onClick={(e) => { e.preventDefault(); handleNav('#/'); }}>
              &larr; Back to dashboard
            </a>
          </div>
        </main>
      </div>
    );
  }

  // Status display helpers
  const statusLabel = matter!.status === 'urgent' ? 'Urgent' : matter!.status === 'stale' ? 'Needs attention' : matter!.status === 'complete' ? 'Complete' : 'Active';
  const statusColour = matter!.status === 'urgent' ? red : matter!.status === 'stale' ? amber : matter!.status === 'complete' ? green : navy;
  const statusBg = matter!.status === 'urgent' ? '#fce8e6' : matter!.status === 'stale' ? '#fdf0dd' : matter!.status === 'complete' ? '#e7f6ec' : '#eef1f6';

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      {/* ── Top Bar ──────────────────────────────────────────────── */}
      <header
        style={{
          background: navy,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          height: 64,
        }}
        role="banner"
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <a
            href="#/"
            style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
            aria-label="DemandPay Starling home"
          >
            <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
            </span>
            <span style={{ fontFamily: serif, lineHeight: 1, letterSpacing: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>DEMAND</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>PAY</span>
            </span>
          </a>
          <span
            style={{
              marginLeft: 14,
              paddingLeft: 16,
              borderLeft: '1px solid rgba(255,255,255,0.18)',
              fontFamily: serif,
              fontSize: 15,
              color: '#cfd6e0',
            }}
          >
            <b style={{ color: '#fff' }}>Starling</b> &middot; Employment Law
          </span>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Main navigation">
          <a
            href="#/"
            style={{
              padding: '8px 14px',
              borderRadius: 2,
              fontSize: 14,
              color: '#cfd6e0',
              border: '1px solid transparent',
              textDecoration: 'none',
            }}
          >
            My Cases
          </a>
        </nav>
      </header>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main
        id="main-content"
        style={{
          maxWidth: 1080,
          margin: '0 auto',
          padding: '20px 28px 60px',
        }}
      >
        {/* Back link */}
        <a
          href="#/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            color: muted,
            fontSize: 13.5,
            marginBottom: 16,
            textDecoration: 'none',
          }}
          onClick={(e) => { e.preventDefault(); handleNav('#/'); }}
        >
          &larr; My Cases
        </a>

        {/* ── Matter Header ─────────────────────────────────────── */}
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '22px 26px' }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
            <div>
              <h1 style={{ fontFamily: serif, fontSize: 24, fontWeight: 600, color: navy, margin: 0 }}>
                {matter!.name}{' '}
                {editingFileNumber ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                    <input
                      autoFocus
                      value={fileNumberDraft}
                      onChange={(e) => setFileNumberDraft(e.target.value)}
                      placeholder="Your file number"
                      onKeyDown={(e) => { if (e.key === 'Enter') { void employment.saveFileNumber(fileNumberDraft.trim()).then(() => setEditingFileNumber(false)); } if (e.key === 'Escape') setEditingFileNumber(false); }}
                      style={{ fontSize: 12.5, fontFamily: sans, padding: '3px 7px', border: `1px solid ${border}`, borderRadius: 2, width: 150 }}
                    />
                    <button onClick={() => { void employment.saveFileNumber(fileNumberDraft.trim()).then(() => setEditingFileNumber(false)); }}
                      style={{ fontSize: 11, fontFamily: sans, border: 'none', background: navy, color: '#fff', padding: '4px 9px', borderRadius: 2, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditingFileNumber(false)}
                      style={{ fontSize: 11, fontFamily: sans, border: 'none', background: 'none', color: muted, cursor: 'pointer' }}>Cancel</button>
                  </span>
                ) : (
                  <span style={{ fontSize: 12.5, color: muted, marginLeft: 4, fontFamily: sans, fontWeight: 400 }}>
                    {employment.firmFileNumber ? `File ${employment.firmFileNumber}` : `Matter ${matter!.number}`}
                    <button
                      onClick={() => { setFileNumberDraft(employment.firmFileNumber ?? ''); setEditingFileNumber(true); }}
                      title="Set your firm's file number"
                      style={{ fontSize: 11, fontFamily: sans, border: 'none', background: 'none', color: orange, cursor: 'pointer', marginLeft: 6, padding: 0 }}
                    >
                      {employment.firmFileNumber ? 'edit' : 'add file number'}
                    </button>
                  </span>
                )}
              </h1>
              {!employment.attribution.openedByMe && employment.attribution.openedBy && (
                <div style={{ fontSize: 12, color: muted, fontFamily: sans, marginTop: 3 }}>
                  Opened by {employment.attribution.openedBy}
                  {employment.attribution.lastModifiedByName && employment.attribution.lastModifiedByName !== employment.attribution.openedBy
                    ? ` · last updated by ${employment.attribution.lastModifiedByName}` : ''}
                </div>
              )}
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 13,
                fontWeight: 600,
                color: statusColour,
                background: statusBg,
                border: `1px solid ${border}`,
                padding: '6px 12px',
                borderRadius: 2,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <StatusDot colour={statusColour} />
              {statusLabel}
            </span>
          </div>

          {/* Facts row */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0,
              marginTop: 18,
              borderTop: `1px solid ${border}`,
              paddingTop: 16,
            }}
          >
            {employment.stage && <FactItem label="Stage" value={employment.stage.label} valueColour={navy} />}
            <FactItem label="Client" value={matter!.client} />
            <FactItem label="Employer" value={matter!.employer} />
            {matter!.dates.termination && <FactItem label="Terminated" value={matter!.dates.termination} />}
            {matter!.dates.start && <FactItem label="Start date" value={matter!.dates.start} />}
            {matter!.dates.limitation && <FactItem label="Limitation" value={matter!.dates.limitation} isLast />}
            {!matter!.dates.limitation && !matter!.dates.start && <FactItem label="" value="" isLast />}
          </div>

          <NextStepsPanel steps={employment.nextSteps} onGoTo={(tab) => setActiveTab(tab as TabKey)} />

          {/* ── Tabs ─────────────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              marginTop: 18,
              borderBottom: `1px solid ${border}`,
            }}
            role="tablist"
          >
            {dynamicTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  fontFamily: sans,
                  fontSize: 14,
                  fontWeight: 600,
                  color: activeTab === tab.key ? navy : muted,
                  background: 'transparent',
                  border: 'none',
                  padding: '13px 20px',
                  cursor: 'pointer',
                  borderBottom: `2px solid ${activeTab === tab.key ? orange : 'transparent'}`,
                  marginBottom: -1,
                }}
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls={`panel-${tab.key}`}
              >
                {tab.label}
                {tab.badge != null && (
                  <span
                    style={{
                      fontSize: 11,
                      background: activeTab === tab.key ? orange : cream,
                      border: `1px solid ${activeTab === tab.key ? orange : border}`,
                      color: activeTab === tab.key ? '#fff' : muted,
                      borderRadius: 2,
                      padding: '0 6px',
                      marginLeft: 6,
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab Panels ────────────────────────────────────────── */}

          {/* Issues Found */}
          {activeTab === 'issues' && (
            <div id="panel-issues" role="tabpanel" style={{ paddingTop: 22 }}>
              {/* Comparable decisions — internal research from the shared case library */}
              {employment.data?.analysis != null && <ComparablesPanel matterId={sessionId!} />}
              {/* Run Analysis empty state — employment data exists but analysis hasn't run */}
              {employment.data && !employment.data.analysis && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '22px 24px', marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, color: navy, marginBottom: 6 }}>
                    Analysis not run yet
                  </div>
                  <div style={{ fontSize: 13.5, color: muted, marginBottom: 14 }}>
                    Run the 16-gate legal issue analysis to identify claims, calculate ESA and common law entitlements, and check limitation deadlines.
                  </div>
                  <button
                    onClick={async () => {
                      setAnalysing(true);
                      setAnalyseError(null);
                      const result = await employment.runAnalysis();
                      setAnalysing(false);
                      if (!result.ok) setAnalyseError(result.error ?? 'Analysis failed.');
                    }}
                    disabled={analysing}
                    style={{
                      background: analysing ? '#b0b0b0' : orange, color: '#fff', fontSize: 13.5, fontWeight: 600,
                      padding: '11px 22px', borderRadius: 2, border: 'none', cursor: analysing ? 'not-allowed' : 'pointer', fontFamily: sans,
                    }}
                  >
                    {analysing ? 'Analysing...' : 'Run Analysis'}
                  </button>
                  {analyseError && (
                    <div style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>{analyseError}</div>
                  )}
                </div>
              )}

              {/* Lawyer decisions on triggered gates — controls which issues
                  are included in generated documents (shared with the labour view) */}
              <GateApprovalPanel
                gates={triggeredGates}
                structuralGates={structuralGates}
                decisionFor={gateDecision}
                onDecision={setGateDecision}
                subheading="Only approved issues are included in demand letters, pleadings, and applications. Starling drafts nothing you have not approved."
              />

              {matter!.issues.length === 0 && triggeredGates.length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>No issues found yet.</div>
              )}
              {matter!.issues.map(issue => (
                <div
                  key={issue.id}
                  style={{
                    background: '#fff',
                    border: `1px solid ${border}`,
                    borderLeft: `4px solid ${issue.strength === 'strong' ? green : amber}`,
                    padding: '16px 20px',
                    marginBottom: 12,
                  }}
                >
                  {/* Issue header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <StatusDot colour={issue.strength === 'strong' ? green : amber} size={10} />
                    <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, color: navy }}>
                      {issue.title}
                    </span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: '3px 9px',
                        borderRadius: 2,
                        background: issue.strength === 'strong' ? '#e7f6ec' : '#fdf0dd',
                        color: issue.strength === 'strong' ? green : amber,
                      }}
                    >
                      {issue.strength === 'strong' ? 'Strong' : 'Moderate'}
                    </span>
                  </div>
                  {/* Description */}
                  <div style={{ fontSize: 13.5, color: muted, marginBottom: 10 }}>
                    {renderBoldText(issue.description, issue.descriptionBold)}
                  </div>
                  {/* Sources */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {issue.sources.map((src, i) => (
                      <SourceTag key={i} label={src.label} type={src.type} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Documents */}
          {activeTab === 'docs' && (
            <div id="panel-docs" role="tabpanel" style={{ paddingTop: 22 }}>
              {/* One-time pointer for a just-created file: says what to do
                  next and what will happen, then dismisses for good. */}
              {showDocsHint && (
                <div
                  role="status"
                  style={{
                    background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2,
                    padding: '14px 18px', marginBottom: 16,
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: ink, marginBottom: 4 }}>
                      Start here: add {String(employment.data?.intake?.client_first_name ?? 'the client')}&rsquo;s documents
                    </div>
                    <div style={{ fontSize: 13, color: ink, lineHeight: 1.6 }}>
                      Upload the termination letter, employment agreement, ROE, pay records and severance offer.
                      Starling reads each one and proposes the facts it finds, quoting the line it took them from.
                      You review each proposal and choose what to apply, so nothing reaches the file until you say so.
                      Then run the analysis from the Issues tab.
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDocsHint(false)}
                    style={{
                      background: 'none', border: 'none', color: muted, cursor: 'pointer',
                      fontSize: 12.5, fontFamily: sans, padding: '2px 4px', flexShrink: 0,
                    }}
                    aria-label="Dismiss this tip"
                  >
                    Got it
                  </button>
                </div>
              )}

              {/* Generated documents and their lifecycle */}
              <GeneratedDocsPanel
                docs={employment.generatedDocuments}
                onSetStatus={employment.setDocumentStatus}
                onOpen={(dt) => {
                  const entry = draftHistory.find(d => d.docType === dt);
                  if (!entry) return false;
                  const card = DOCTYPE_TO_DRAFT[dt];
                  if (card) setSelectedDraft(card);
                  setGeneratedHtml(entry.html);
                  setGenCitations([]);
                  setGenReviewFlags([]);
                  setActiveTab('draft');
                  window.scrollTo(0, 0);
                  return true;
                }}
                downloadHref={(dt) => {
                  const slug = downloadSlugFor(dt);
                  if (!slug || !sessionId) return null;
                  // The variant picked on the Draft tab travels with the
                  // download; other types render on their default template.
                  const variant = dt === selectedTemplateDocType && activeVariant
                    ? `?templateVariantId=${encodeURIComponent(activeVariant.variantId)}` : '';
                  return `/api/employment/${sessionId}/download/${slug}${variant}`;
                }}
                renderExtra={approvalsEnabled && sessionId
                  ? (dt) => (
                      <ReviewLaneControls
                        matterId={sessionId}
                        docType={dt}
                        onApplyFeedback={(text) => {
                          const entry = draftHistory.find(d => d.docType === dt);
                          if (entry) {
                            const card = DOCTYPE_TO_DRAFT[dt];
                            if (card) setSelectedDraft(card);
                            setGeneratedHtml(entry.html);
                            setActiveTab('draft');
                          }
                          setRevising({ source: 'partner', initial: text });
                        }}
                      />
                    )
                  : undefined}
              />

              {/* Uploaded */}
              {matter!.documents.filter(d => d.group === 'uploaded').length > 0 && (
                <>
                  <h3
                    style={{
                      fontSize: 14,
                      margin: '4px 0 12px',
                      color: muted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily: serif,
                    }}
                  >
                    Uploaded documents
                  </h3>
                  {matter!.documents.filter(d => d.group === 'uploaded').map(doc => (
                    <DocRow key={doc.id} doc={{ ...doc, actions: [] }} />
                  ))}
                </>
              )}

              {/* Generated */}
              {matter!.documents.filter(d => d.group === 'generated').length > 0 && (
                <>
                  <h3
                    style={{
                      fontSize: 14,
                      margin: '22px 0 12px',
                      color: muted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily: serif,
                    }}
                  >
                    Generated by Starling
                  </h3>
                  {matter!.documents.filter(d => d.group === 'generated').map(doc => (
                    <DocRow key={doc.id} doc={{ ...doc, actions: [] }} />
                  ))}
                </>
              )}

              {matter!.documents.length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>No documents yet.</div>
              )}

              {/* Upload & extract */}
              <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginTop: 16 }}>
                <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                  Upload a document and Starling extracts the facts
                </div>
                <div style={{ fontSize: 12.5, color: muted, marginBottom: 12 }}>
                  PDF, DOCX, or text. Names and identifiers are anonymised before any AI processing. You review every extracted fact before it's used.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={uploadKind}
                    onChange={e => setUploadKind(e.target.value)}
                    aria-label="Document type"
                    style={{ fontFamily: sans, fontSize: 13.5, padding: '9px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
                  >
                    <option value="employment_agreement">Employment agreement</option>
                    <option value="termination_letter">Termination letter</option>
                    <option value="roe">Record of Employment</option>
                    <option value="t4">T4</option>
                    <option value="pay_stub">Pay stub</option>
                    <option value="correspondence">Correspondence</option>
                    <option value="performance_review">Performance review</option>
                    <option value="policy_document">Policy document</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.txt,.md,.rtf"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) void handleClassifyFile(file);
                      if (uploadInputRef.current) uploadInputRef.current.value = '';
                    }}
                  />
                  <button
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={extracting || classifying}
                    style={{
                      background: (extracting || classifying) ? '#b0b0b0' : navy, color: '#fff', fontSize: 13.5, fontWeight: 600,
                      padding: '10px 18px', borderRadius: 2, border: 'none',
                      cursor: (extracting || classifying) ? 'not-allowed' : 'pointer', fontFamily: sans,
                    }}
                  >
                    {classifying ? 'Detecting type...' : extracting ? 'Extracting facts...' : '+ Upload & detect'}
                  </button>
                </div>
                {pendingUpload && !extracting && (
                  <div style={{ marginTop: 12, padding: '12px 14px', border: `1px solid ${border}`, background: '#faf8f5', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }} role="status">
                    <span style={{ fontSize: 13, color: ink }}>
                      <b>{pendingUpload.name}</b>{' — '}
                      {pendingUpload.fallback ? (
                        <span style={{ color: amber }}>could not detect the type; confirm it in the dropdown.</span>
                      ) : (
                        <>
                          detected: <b>{(pendingUpload.detectedKind ?? '').replace(/_/g, ' ')}</b>
                          <span style={{
                            marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 2,
                            background: pendingUpload.confidence === 'high' ? '#e7f6ec' : pendingUpload.confidence === 'medium' ? '#fdf0dd' : '#f4f1ec',
                            color: pendingUpload.confidence === 'high' ? green : pendingUpload.confidence === 'medium' ? amber : muted,
                          }}>
                            {pendingUpload.confidence}
                          </span>
                          {' '}<span style={{ color: muted }}>— change the dropdown if wrong.</span>
                        </>
                      )}
                    </span>
                    <button
                      onClick={() => { void handleExtractConfirmed(); }}
                      style={{ background: navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, border: 'none', cursor: 'pointer', fontFamily: sans }}
                    >
                      Extract as {uploadKind.replace(/_/g, ' ')}
                    </button>
                    <button
                      onClick={() => setPendingUpload(null)}
                      style={{ background: 'none', color: muted, fontSize: 13, padding: '8px 6px', border: 'none', cursor: 'pointer', fontFamily: sans }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {extractError && (
                  <div style={{ marginTop: 12, padding: '10px 14px', border: '1px solid #dc2626', borderRadius: 2, background: '#fce8e6', color: '#dc2626', fontSize: 13 }}>
                    {extractError}
                  </div>
                )}
                {lastExtraction && (
                  <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 6 }}>
                      Extracted from {lastExtraction.filename}
                    </div>
                    {lastExtraction.keyFindings.length > 0 && (
                      <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13, color: ink, lineHeight: 1.7 }}>
                        {lastExtraction.keyFindings.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    )}
                    {lastExtraction.documentType === 'collective_agreement' ? (
                      <div style={{ fontSize: 12.5, color: muted }}>
                        Collective agreement fields apply to the grievance clocks automatically; review them on the Intake tab.
                      </div>
                    ) : (
                      <ExtractionReviewPanel
                        extraction={lastExtraction}
                        intake={(employment.data?.intake ?? {}) as Record<string, unknown>}
                        onApply={employment.applyExtraction}
                        onDone={employment.refresh}
                      />
                    )}
                  </div>
                )}
                {/* Stored extractions from earlier sessions that were never applied */}
                {!lastExtraction && (employment.data?.documentExtractions ?? [])
                  .map((ext, i) => ({ ext, key: ext.id ?? `idx-${i}` }))
                  .filter(({ ext }) => !ext.appliedAt && ext.documentType !== 'collective_agreement'
                    && Object.values(ext.extractedFields).some(f => f && f.value !== null && f.value !== ''))
                  .slice(-2)
                  .map(({ ext, key }) => (
                    <div key={key} style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 6 }}>
                        Extracted earlier from {ext.filename} — not yet applied
                      </div>
                      <ExtractionReviewPanel
                        extraction={{ ...ext, id: key }}
                        intake={(employment.data?.intake ?? {}) as Record<string, unknown>}
                        onApply={employment.applyExtraction}
                        onDone={employment.refresh}
                      />
                    </div>
                  ))}
                <CaseFileDropPanel
                  classifyDocument={employment.classifyDocument}
                  extractParsed={employment.extractParsed}
                  getCaseReview={employment.getCaseReview}
                  applyChronology={employment.applyChronology}
                  generateCaseSynthesis={employment.generateCaseSynthesis}
                  applyExtraction={employment.applyExtraction}
                  onDone={employment.refresh}
                />
              </div>
            </div>
          )}

          {/* Draft */}
          {activeTab === 'draft' && (
            <div id="panel-draft" role="tabpanel" style={{ paddingTop: 22 }}>
              <p style={{ fontSize: 13.5, color: muted, marginBottom: 16 }}>
                Pick a document type. Starling drafts it, stress-tests it from the employer's perspective,
                runs 8 verification passes, and returns a court-ready draft with inline source attribution.
              </p>

              {/* HRTO Form 1 data file — populates the official SmartForm */}
              {selectedDraft === 'schedulea' && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>
                    Form 1 itself: download the pre-filled data file
                  </div>
                  <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>
                    The HRTO SmartForm cannot be filled directly (it is a locked dynamic form), but Starling
                    generates a data file from this matter (applicant, respondent, grounds, date of last
                    incident, representative). Open the official Form 1 in Acrobat, then{' '}
                    <strong>Prepare Form → More → Import Data</strong> and select this file. Review every
                    field; Starling deliberately leaves narrative questions for Schedule "A".
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      href={`/api/employment/${sessionId}/form/hrto-form1-data`}
                      download
                      style={{ background: navy, color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, textDecoration: 'none', fontFamily: sans }}
                    >
                      Download Form 1 data file (.xml)
                    </a>
                    <a
                      href="https://tribunalsontario.ca/documents/hrto/SmartForms/Form%201%20-%20apply.pdf"
                      target="_blank" rel="noopener noreferrer"
                      style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, textDecoration: 'none', fontFamily: sans }}
                    >
                      Get the official Form 1 ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Firm template for the selected document type */}
              {selectedTemplateDocType && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>
                      Firm template
                      {currentTemplate && (
                        <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: green, background: '#e7f6ec', padding: '2px 7px', borderRadius: 2 }}>
                          ACTIVE · {currentTemplate.variantLabel}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: muted }}>
                      {currentTemplate
                        ? 'Downloads use your firm’s letterhead and formatting.'
                        : 'Upload your firm’s DOCX template with {{PLACEHOLDER}} markers. You can keep several for one document type, for example one for constructive dismissal and one for termination during medical leave.'}
                    </div>

                    {/* Variant picker — hidden when the firm has only one,
                        so the common case gains no extra step. */}
                    {variantsForType.length > 1 && (
                      <div style={{ marginTop: 10 }} role="radiogroup" aria-label="Firm template to draft on">
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: muted, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6 }}>
                          Draft on
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {variantsForType.map(v => {
                            const active = activeVariant?.variantId === v.variantId;
                            return (
                              <button
                                key={v.variantId}
                                role="radio"
                                aria-checked={active}
                                onClick={() => setChosenVariantId(v.variantId)}
                                style={{
                                  fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans,
                                  background: active ? navy : '#fff',
                                  color: active ? '#fff' : navy,
                                  border: `1px solid ${active ? navy : border}`,
                                  cursor: 'pointer',
                                }}
                              >
                                {v.variantLabel}
                                {v.isDefault && !active && (
                                  <span style={{ marginLeft: 6, fontSize: 10, color: muted }}>default</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {templateStatus && (
                      <div style={{ fontSize: 12.5, color: navy, marginTop: 4 }}>{templateStatus}</div>
                    )}
                  </div>
                  <input
                    ref={templateInputRef}
                    type="file"
                    accept=".docx"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        // A second template for the same type needs a label so
                        // the lawyer can tell them apart in the picker. Ask
                        // inline: window.prompt is blocked in some browsers
                        // and cancelling it silently dropped the chosen file.
                        if (variantsForType.length > 0) {
                          setPendingTemplateFile(file);
                          setPendingTemplateLabel('');
                        } else {
                          void handleTemplateUpload(file, undefined);
                        }
                      }
                      if (templateInputRef.current) templateInputRef.current.value = '';
                    }}
                  />
                  {pendingTemplateFile && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, color: ink }}>Name this template:</span>
                      <input
                        autoFocus
                        value={pendingTemplateLabel}
                        onChange={e => setPendingTemplateLabel(e.target.value)}
                        placeholder="e.g. Constructive dismissal"
                        onKeyDown={e => {
                          if (e.key === 'Enter' && pendingTemplateLabel.trim()) {
                            void handleTemplateUpload(pendingTemplateFile, pendingTemplateLabel.trim());
                            setPendingTemplateFile(null);
                          }
                          if (e.key === 'Escape') setPendingTemplateFile(null);
                        }}
                        style={{ fontSize: 12.5, fontFamily: sans, padding: '6px 9px', border: `1px solid ${border}`, borderRadius: 2, width: 220 }}
                      />
                      <button
                        disabled={!pendingTemplateLabel.trim()}
                        onClick={() => {
                          void handleTemplateUpload(pendingTemplateFile, pendingTemplateLabel.trim());
                          setPendingTemplateFile(null);
                        }}
                        style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: pendingTemplateLabel.trim() ? navy : '#c8ccd4', color: '#fff', border: 'none', cursor: pendingTemplateLabel.trim() ? 'pointer' : 'default' }}
                      >
                        Save template
                      </button>
                      <button
                        onClick={() => setPendingTemplateFile(null)}
                        style={{ fontSize: 12, color: muted, background: 'none', border: `1px solid ${border}`, borderRadius: 2, padding: '6px 12px', cursor: 'pointer', fontFamily: sans }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => templateInputRef.current?.click()}
                      style={{
                        background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                        padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                      }}
                    >
                      {currentTemplate ? 'Add another' : 'Upload template'}
                    </button>
                    <button
                      onClick={() => setBuildingTemplate(v => !v)}
                      style={{
                        background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                        padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                      }}
                    >
                      {buildingTemplate ? 'Close builder' : 'Build from precedents'}
                    </button>
                    <button
                      onClick={() => setBuildingStyle(v => !v)}
                      style={{
                        background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                        padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                      }}
                    >
                      {buildingStyle ? 'Close style teacher' : 'Teach your style'}
                    </button>
                    {currentTemplate && activeVariant && !activeVariant.isDefault && (
                      <button
                        onClick={async () => {
                          const result = await firmTemplates.setDefault(selectedTemplateDocType, activeVariant.variantId);
                          setTemplateStatus(result.ok
                            ? `“${activeVariant.variantLabel}” is now the default for this document type.`
                            : result.error ?? 'Failed to set the default.');
                        }}
                        style={{
                          background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                          padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        Make default
                      </button>
                    )}
                    {currentTemplate && activeVariant && (
                      <button
                        onClick={async () => {
                          const result = await firmTemplates.remove(selectedTemplateDocType, activeVariant.variantId);
                          setChosenVariantId(null);
                          setTemplateStatus(result.ok
                            ? `“${activeVariant.variantLabel}” removed.`
                            : result.error ?? 'Failed to remove.');
                        }}
                        style={{
                          background: '#fff', color: muted, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                          padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
              {buildingTemplate && selectedTemplateDocType && (
                <PrecedentAlignPanel
                  documentType={selectedTemplateDocType}
                  documentLabel={DEMO_DRAFT_TYPES.find(d => d.id === selectedDraft)?.title ?? 'document'}
                  onSaved={() => { setBuildingTemplate(false); firmTemplates.refresh(); setTemplateStatus('Template built from your precedents and saved.'); }}
                  onCancel={() => setBuildingTemplate(false)}
                />
              )}
              {buildingStyle && selectedTemplateDocType && (
                <StyleProfilePanel
                  documentType={selectedTemplateDocType}
                  documentLabel={DEMO_DRAFT_TYPES.find(d => d.id === selectedDraft)?.title ?? 'document'}
                  onChanged={() => styleProfiles.refresh()}
                  onClose={() => setBuildingStyle(false)}
                />
              )}
              <input
                type="search"
                value={draftFilter}
                onChange={e => setDraftFilter(e.target.value)}
                placeholder="Filter documents… (e.g. mediation, timetable, offer)"
                aria-label="Filter the document catalogue"
                style={{ width: '100%', maxWidth: 420, fontFamily: sans, fontSize: 13.5, padding: '9px 12px', border: `1px solid ${border}`, borderRadius: 2, marginBottom: 16, boxSizing: 'border-box' as const }}
              />
              {DRAFT_SECTIONS.map(section => {
                const sectionCards = DEMO_DRAFT_TYPES.filter(dt => dt.section === section)
                  .filter(dt => !draftFilter.trim()
                    || `${dt.title} ${dt.description ?? ''}`.toLowerCase().includes(draftFilter.trim().toLowerCase()));
                if (sectionCards.length === 0) return null;
                return (
                <div key={section} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10 }}>
                    {section}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                    {sectionCards.map(dt => (
                      <div
                        key={dt.id}
                        onClick={() => setSelectedDraft(dt.id)}
                        style={{
                          background: '#fff',
                          border: `1px solid ${selectedDraft === dt.id || dt.recommended ? orange : border}`,
                          padding: 18,
                          cursor: 'pointer',
                          boxShadow: selectedDraft === dt.id || dt.recommended ? `0 2px 0 ${orange}` : 'none',
                        }}
                        role="radio"
                        aria-checked={selectedDraft === dt.id}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDraft(dt.id); } }}
                      >
                        {dt.recommended && (
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: '#fff',
                              background: orange,
                              padding: '2px 7px',
                              borderRadius: 2,
                              letterSpacing: '0.04em',
                            }}
                          >
                            RECOMMENDED NEXT
                          </span>
                        )}
                        <h4 style={{ fontFamily: serif, fontSize: 15.5, fontWeight: 600, color: navy, margin: dt.recommended ? '10px 0 5px' : '0 0 5px' }}>
                          {dt.title}
                        </h4>
                        <p style={{ fontSize: 12.5, color: dt.alreadyDrafted ? green : muted, margin: 0 }}>
                          {dt.alreadyDrafted && (
                            <>
                              <StatusDot colour={green} size={6} />{' '}
                            </>
                          )}
                          {dt.description}
                        </p>
                        <div style={{ fontSize: 12, color: muted, marginTop: 10 }}>{dt.cost}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );})}

              {/* Court-form inputs: the deterministic forms are data, and
                  these fields are that data */}
              {selectedDraft && COURT_FORM_FIELDS[selectedDraft] && !generatedHtml && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14, marginTop: 8 }}>
                  {COURT_FORM_FIELDS[selectedDraft].map(f => (
                    <div key={f.key} style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
                      <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>
                        {f.label}{f.required ? ' *' : ''}
                      </div>
                      {f.type === 'select' ? (
                        <select
                          value={courtFields[f.key] ?? ''}
                          onChange={e => setCourtFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                          style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
                        >
                          <option value="">Select</option>
                          {(f.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea
                          value={courtFields[f.key] ?? ''}
                          placeholder={f.placeholder}
                          onChange={e => setCourtFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                          rows={3}
                          style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box', resize: 'vertical' }}
                        />
                      ) : (
                        <input
                          type={f.type ?? 'text'}
                          value={courtFields[f.key] ?? ''}
                          placeholder={f.placeholder}
                          onChange={e => setCourtFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                          style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* Generation options */}
              {selectedDraft && !COURT_FORM_FIELDS[selectedDraft] && !generatedHtml && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14, marginTop: 8 }}>
                  {(selectedDraft === 'demand') && (
                    <>
                      <div>
                        <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Tone</div>
                        <select value={genTone} onChange={e => setGenTone(e.target.value)} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}>
                          <option value="professional">Professional</option>
                          <option value="firm">Firm</option>
                          <option value="aggressive">Aggressive</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Demand Amount (CAD)</div>
                        <input type="text" placeholder="e.g., 150000" value={genDemandAmount} onChange={e => setGenDemandAmount(e.target.value.replace(/[^\d]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                      </div>
                    </>
                  )}
                  {(selectedDraft === 'soc') && (
                    <>
                      <div>
                        <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Procedure Type</div>
                        <select value={genProcedure} onChange={e => setGenProcedure(e.target.value)} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}>
                          <option value="small_claims">Small Claims (≤$50K)</option>
                          <option value="simplified">Simplified ($50K–$200K)</option>
                          <option value="ordinary">Ordinary (&gt;$200K)</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Court Location</div>
                        <input type="text" placeholder="e.g., Toronto" value={genCourtLocation} onChange={e => setGenCourtLocation(e.target.value)} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                      </div>
                    </>
                  )}
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Claim Amount (CAD)</div>
                    <input type="text" placeholder="e.g., 150000" value={genDemandAmount} onChange={e => setGenDemandAmount(e.target.value.replace(/[^\d]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                  </div>
                </div>
              )}

              {selectedDraft && !generatedHtml && styleProfiles.profiles.length > 0 && (
                <div style={{ margin: '0 0 12px' }}>
                  <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Draft in your firm's style</div>
                  <select
                    value={styleProfileId}
                    onChange={e => setStyleProfileId(e.target.value)}
                    aria-label="Firm style for this draft"
                    style={{ fontFamily: sans, fontSize: 13.5, padding: '9px 11px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, minWidth: 280 }}
                  >
                    <option value="">Standard Starling drafting</option>
                    {styleProfiles.profiles.map(sp => (
                      <option key={sp.id} value={sp.id}>{sp.label} (from {sp.sourceCount} precedents)</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedDraft && !generatedHtml && (
                <button
                  onClick={async () => {
                    setGenerating(true);
                    setGenError(null);
                    const amount = parseInt(genDemandAmount) || 100000;
                    const fieldDefs = COURT_FORM_FIELDS[selectedDraft ?? ''];
                    const formFields = fieldDefs
                      ? Object.fromEntries(fieldDefs
                          .map(f => [f.key, (courtFields[f.key] ?? '').trim()])
                          .filter(([, v]) => v !== ''))
                      : undefined;
                    const result = await employment.generateDocument(
                      DRAFT_TO_DOCTYPE[selectedDraft ?? ''] ?? 'demand_letter',
                      {
                        tone: genTone,
                        demandAmount: amount,
                        claimAmount: amount,
                        procedureType: genProcedure,
                        formFields,
                        lawyerName: profile.displayName || 'Lawyer Name',
                        firmName: profile.firmName || 'Firm Name',
                        // Composed contact block — the generators accept a single
                        // firmAddress string and the model fills the signature
                        // block from it instead of leaving [Address] fill-ins
                        firmAddress: [
                          profile.firmAddress,
                          profile.firmPhone && `Tel: ${profile.firmPhone}`,
                          profile.firmEmail && `Email: ${profile.firmEmail}`,
                          profile.lsoNumber && `LSO# ${profile.lsoNumber}`,
                        ].filter(Boolean).join(' · ') || undefined,
                        courtLocation: genCourtLocation,
                        responseDeadlineDays: 14,
                        ...(styleProfileId ? { styleProfileId } : {}),
                      },
                    );
                    setGenerating(false);
                    if (result.ok && result.html) {
                      setGeneratedHtml(result.html);
                      setGenCitations(result.citations ?? []);
                      setGenReviewFlags(result.reviewFlags ?? []);
                      // Tell the lawyer their dates reached the docket, and
                      // pass on any Rule 48.14 caution.
                      const notes: string[] = [];
                      if (result.docketedDates) {
                        notes.push(`${result.docketedDates} timetable date${result.docketedDates === 1 ? '' : 's'} added to your docket.`);
                      }
                      if (result.cautions?.length) notes.push(...result.cautions);
                      setGenNotice(notes.length > 0 ? notes.join(' ') : null);
                      void employment.refresh();
                      refreshDraftHistory();
                    } else {
                      setGenNotice(null);
                      setGenError(result.error ?? 'Generation failed. Check that at least one legal issue is approved.');
                    }
                  }}
                  disabled={generating
                    || (DRAFTS_NEEDING_AMOUNT.has(selectedDraft ?? '') && !genDemandAmount)
                    || Boolean(COURT_FORM_FIELDS[selectedDraft ?? '']?.some(f => f.required && !(courtFields[f.key] ?? '').trim()))}
                  style={{
                    background: generating ? '#b0b0b0' : orange,
                    color: '#fff',
                    fontSize: 13.5,
                    fontWeight: 600,
                    padding: '11px 18px',
                    borderRadius: 2,
                    border: 'none',
                    cursor: generating ? 'not-allowed' : 'pointer',
                    marginTop: 8,
                    fontFamily: sans,
                  }}
                >
                  {generating ? 'Generating...' : 'Generate Draft'}
                </button>
              )}

              {genNotice && (
                <div role="status" style={{ background: '#e7f6ec', border: `1px solid ${green}`, borderRadius: 2, padding: '10px 14px', fontSize: 12.5, color: ink, marginBottom: 12 }}>
                  {genNotice}
                </div>
              )}
              {genError && (
                <div style={{ marginTop: 12, padding: '12px 16px', border: '1px solid #dc2626', borderRadius: 2, background: '#fce8e6', color: '#dc2626', fontSize: 13.5 }}>
                  {genError}
                </div>
              )}

              {/* Document Preview */}
              {generatedHtml && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h3 style={{ fontFamily: serif, fontSize: 17, fontWeight: 600, color: navy, margin: 0 }}>
                      Generated Draft
                    </h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setGeneratedHtml(null)}
                        style={{
                          background: '#fff', color: navy, border: `1px solid ${border}`,
                          fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        Change options
                      </button>
                      <button
                        onClick={() => setRevising({ source: 'client' })}
                        style={{
                          background: '#fff', color: navy, border: `1px solid ${border}`,
                          fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                        }}
                      >
                        Apply feedback
                      </button>
                      <a
                        href={`/api/employment/${sessionId}/download/${DRAFT_TO_DOWNLOAD[selectedDraft ?? ''] ?? 'demand-letter'}${activeVariant ? `?templateVariantId=${encodeURIComponent(activeVariant.variantId)}` : ''}`}
                        download
                        style={{
                          background: navy, color: '#fff',
                          fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2,
                          textDecoration: 'none', display: 'inline-block', fontFamily: sans,
                        }}
                      >
                        Download DOCX
                      </a>
                    </div>
                  </div>
                  {/* Lifecycle status, right where the draft is generated (also
                      manageable on the Documents tab). Sent/Filed start the
                      downstream ticklers (e.g. SOC sent -> Defence due). */}
                  {(() => {
                    const dt = DRAFT_TO_DOCTYPE[selectedDraft ?? ''] ?? '';
                    const cur = employment.generatedDocuments.find(d => d.docType === dt);
                    const today = new Date().toISOString().slice(0, 10);
                    const revisedAt = employment.data?.intakeRevisedAt;
                    const stale = Boolean(revisedAt && cur?.generatedAt && cur.generatedAt < revisedAt);
                    return (
                      <>
                      {stale && (
                        <div style={{ marginBottom: 10, background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2, padding: '10px 14px', fontSize: 13, color: ink }} role="status">
                          <b style={{ color: amber }}>Facts changed after this draft was generated.</b>{' '}
                          The intake was revised (document facts applied or edited) since this document was drafted — regenerate it before relying on the figures or dates.
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: muted }}>Status:</span>
                        {(['reviewed', 'sent', 'filed'] as const).map(next => (
                          <button
                            key={next}
                            onClick={() => void employment.setDocumentStatus(dt, next, (next === 'sent' || next === 'filed') ? today : undefined)}
                            disabled={cur?.status === next}
                            style={{
                              fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans,
                              background: cur?.status === next ? navy : '#fff',
                              color: cur?.status === next ? '#fff' : navy,
                              border: `1px solid ${cur?.status === next ? navy : border}`,
                              cursor: cur?.status === next ? 'default' : 'pointer',
                              textTransform: 'capitalize' as const,
                            }}
                          >
                            {cur?.status === next ? `✓ ${next}` : `Mark ${next}`}
                          </button>
                        ))}
                        {cur?.status && cur.status !== 'draft' && (
                          <span style={{ fontSize: 11.5, color: green, fontWeight: 600 }}>
                            {cur.status}{cur.statusDate ? ` · ${cur.statusDate}` : ''}
                          </span>
                        )}
                      </div>
                      {approvalsEnabled && dt && cur && sessionId && <ReviewLaneControls matterId={sessionId} docType={dt} onApplyFeedback={(text) => setRevising({ source: 'partner', initial: text })} />}
                      {revising && dt && sessionId && (
                        <RevisionPanel
                          matterId={sessionId}
                          docType={dt}
                          docTitle={DEMO_DRAFT_TYPES.find(d => d.id === selectedDraft)?.title ?? 'document'}
                          initialFeedback={revising.initial}
                          source={revising.source}
                          onApplied={() => { void employment.refresh(); }}
                          onClose={() => setRevising(null)}
                        />
                      )}
                      </>
                    );
                  })()}
                  <div
                    className="starling-doc"
                    style={{
                      background: '#fff', border: `1px solid ${border}`, padding: '28px 32px',
                      fontFamily: serif, fontSize: 14, lineHeight: 1.7, color: ink,
                      maxHeight: 600, overflowY: 'auto',
                    }}
                    dangerouslySetInnerHTML={{ __html: generatedHtml }}
                  />

                  {/* Lawyer review flags — sections the model wants checked */}
                  {genReviewFlags.length > 0 && (
                    <div style={{ marginTop: 12, background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2, padding: '12px 16px' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: amber, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Review before sending
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: ink, lineHeight: 1.7 }}>
                        {genReviewFlags.map((flag, i) => <li key={i}>{flag}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Source citations — what each section relies on */}
                  {genCitations.length > 0 && (
                    <details style={{ marginTop: 12, background: '#fff', border: `1px solid ${border}`, borderRadius: 2 }}>
                      <summary style={{ cursor: 'pointer', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: navy, fontFamily: sans }}>
                        Source citations ({genCitations.length})
                      </summary>
                      <div style={{ padding: '0 16px 12px' }}>
                        {genCitations.map((c, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderTop: i > 0 ? `1px solid ${border}` : 'none' }}>
                            <StatusDot colour={c.trustLevel === 'high' ? green : c.trustLevel === 'medium' ? amber : muted} size={7} />
                            <div>
                              <div style={{ fontSize: 13, color: ink }}>{c.citation}</div>
                              <div style={{ fontSize: 11.5, color: muted }}>{c.sourceType} · {c.trustLevel} trust</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {/* Previous drafts — regeneration never destroys a version */}
              {draftHistory.length > 0 && (
                <details style={{ marginTop: 16, background: '#fff', border: `1px solid ${border}`, borderRadius: 2 }}>
                  <summary style={{ cursor: 'pointer', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: navy, fontFamily: sans }}>
                    Previous drafts ({draftHistory.length})
                  </summary>
                  <div style={{ padding: '0 16px 12px' }}>
                    {draftHistory.map((d, i) => (
                      <div key={`${d.generatedAt}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i > 0 ? `1px solid ${border}` : 'none' }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: ink }}>{d.title}</span>
                          <span style={{ fontSize: 12, color: muted, marginLeft: 8 }}>
                            {new Date(d.generatedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            {d.meta?.tone ? ` · ${String(d.meta.tone)}` : ''}
                            {d.meta?.demandAmount ? ` · $${Number(d.meta.demandAmount).toLocaleString('en-CA')}` : ''}
                            {d.meta?.claimAmount ? ` · $${Number(d.meta.claimAmount).toLocaleString('en-CA')}` : ''}
                          </span>
                          {employment.data?.intakeRevisedAt && d.generatedAt < employment.data.intakeRevisedAt && (
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: amber, background: '#fdf0dd', padding: '1px 6px', borderRadius: 2, marginLeft: 8 }}>
                              FACTS CHANGED SINCE
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setGeneratedHtml(d.html);
                            setGenCitations([]);
                            setGenReviewFlags([]);
                            window.scrollTo(0, 0);
                          }}
                          style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
                        >
                          View
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Timeline */}
          {activeTab === 'timeline' && (
            <div id="panel-timeline" role="tabpanel" style={{ paddingTop: 22 }}>
              {/* Add a key date. Court/statutory deadlines drive the red band. */}
              <div style={{ background: '#fff', border: `1px solid ${border}`, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: navy, letterSpacing: 0.3, marginBottom: 10 }}>ADD A KEY DATE</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input type="date" value={keyDate.date} onChange={e => setKeyDate(k => ({ ...k, date: e.target.value }))}
                    style={{ fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2, fontFamily: sans }} />
                  <input value={keyDate.label} onChange={e => setKeyDate(k => ({ ...k, label: e.target.value }))}
                    placeholder="e.g. Settlement conference, trial date, motion return"
                    style={{ flex: 1, minWidth: 220, fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2, fontFamily: sans }} />
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ink, whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={keyDate.courtDeadline} onChange={e => setKeyDate(k => ({ ...k, courtDeadline: e.target.checked }))} />
                    Court / statutory deadline
                  </label>
                  <button
                    disabled={keyDateSaving || !keyDate.date || keyDate.label.trim().length === 0}
                    onClick={async () => {
                      setKeyDateSaving(true);
                      try {
                        await fetch(`/api/employment/${sessionId}/timeline`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                          body: JSON.stringify({ date: keyDate.date, label: keyDate.label.trim(), category: keyDate.category, courtDeadline: keyDate.courtDeadline }),
                        });
                        setKeyDate({ date: '', label: '', category: 'legal', courtDeadline: true });
                        await refreshMatter();
                        void employment.refresh();
                      } catch { /* transient */ }
                      setKeyDateSaving(false);
                    }}
                    style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, border: 'none', background: navy, color: '#fff', cursor: 'pointer', opacity: (!keyDate.date || !keyDate.label.trim()) ? 0.5 : 1 }}
                  >
                    {keyDateSaving ? 'Adding...' : 'Add'}
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: muted, marginTop: 8 }}>
                  Court and statutory deadlines show in red on the docket when they are overdue or within a business week. Untick for a non-court date (a reminder, a call).
                </div>
              </div>
              {matter!.timeline.length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>No timeline events yet.</div>
              )}
              {matter!.timeline.length > 0 && (
              <div style={{ position: 'relative', paddingLeft: 24 }}>
                {/* Vertical line */}
                <div
                  style={{
                    position: 'absolute',
                    left: 6,
                    top: 4,
                    bottom: 4,
                    width: 2,
                    background: border,
                  }}
                  aria-hidden="true"
                />
                {matter!.timeline.map(ev => (
                  <div key={ev.id} style={{ position: 'relative', marginBottom: 18 }}>
                    {/* Dot */}
                    <div
                      style={{
                        position: 'absolute',
                        left: -22,
                        top: 4,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: ev.isCurrent ? orange : navy,
                        border: '2px solid #fff',
                        boxShadow: `0 0 0 1px ${border}`,
                      }}
                      aria-hidden="true"
                    />
                    <div style={{ fontSize: 12, color: muted, marginBottom: 2 }}>{ev.date}</div>
                    <div style={{ fontSize: 14, color: ink, fontWeight: 600 }}>
                      {ev.title}
                      {ev.courtDeadline && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fce8e6', padding: '2px 7px', borderRadius: 2, verticalAlign: 'middle' }}>COURT DEADLINE</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: muted }}>{ev.subtitle}</div>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

          {/* Intake editor */}
          {activeTab === 'intake' && (
            <div id="panel-intake" role="tabpanel" style={{ paddingTop: 22 }}>
              {/* The lawyer's own record comes first. The client portal
                  used to sit on top of it, which made the intake look as
                  though it could only be filled by sending the client a
                  link. */}

              <IntakeEditorPanel
                fields={EMPLOYMENT_INTAKE_FIELDS}
                values={(employment.data?.intake ?? {}) as Record<string, unknown>}
                onSave={async (edited) => {
                  const merged: Record<string, unknown> = { ...((employment.data?.intake ?? {}) as Record<string, unknown>) };
                  for (const [k, v] of Object.entries(edited)) {
                    if (v === undefined) delete merged[k];
                    else merged[k] = v;
                  }
                  return employment.saveIntake(merged);
                }}
              />

              {/* Client intake portal */}
              <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginBottom: 16 }}>
                <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                  Client intake link
                </div>
                <div style={{ fontSize: 12.5, color: muted, marginBottom: 12 }}>
                  Send the client a link to answer the intake questions themselves. Their answers arrive
                  here for your review; nothing changes on the matter until you apply them, and your own
                  entries are never overwritten.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={async () => {
                      setPortalMessage(null);
                      try {
                        const res = await fetch(`/api/employment/${sessionId}/intake-link`, { method: 'POST', credentials: 'include' });
                        const json = await res.json();
                        if (!res.ok) { setPortalMessage(json.error ?? 'The link could not be generated.'); return; }
                        const url = `${window.location.origin}${json.path}`;
                        setIntakeLink(url);
                        try { await navigator.clipboard.writeText(url); setIntakeLinkCopied(true); setTimeout(() => setIntakeLinkCopied(false), 2500); } catch { /* clipboard optional */ }
                      } catch {
                        setPortalMessage('The link could not be generated.');
                      }
                    }}
                    style={{ background: navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 2, border: 'none', cursor: 'pointer', fontFamily: sans }}
                  >
                    Generate client link
                  </button>
                  {intakeLink && (
                    <span style={{ fontSize: 12.5, color: ink, wordBreak: 'break-all' as const }}>
                      {intakeLink} {intakeLinkCopied && <b style={{ color: green }}>Copied</b>}
                    </span>
                  )}
                  {portalMessage && <span style={{ fontSize: 12.5, color: red }} role="alert">{portalMessage}</span>}
                </div>
                {pendingClient?.data && !pendingClient.appliedAt && (
                  <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 6 }}>
                      Client submission received{pendingClient.submittedAt ? ` ${new Date(pendingClient.submittedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
                    </div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>
                      {Object.entries(pendingClient.data).filter(([k, v]) => k !== 'client_narrative' && v !== '' && v != null).map(([k, v]) => (
                        <div key={k} style={{ padding: '2px 0' }}>
                          <span style={{ fontWeight: 600 }}>{k.replace(/_/g, ' ')}:</span> <span style={{ color: ink }}>{String(v)}</span>
                        </div>
                      ))}
                      {typeof pendingClient.data.client_narrative === 'string' && pendingClient.data.client_narrative && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontWeight: 600 }}>In their words:</span>{' '}
                          <span style={{ color: ink }}>{String(pendingClient.data.client_narrative)}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={async () => {
                          const res = await fetch(`/api/employment/${sessionId}/apply-client-intake`, { method: 'POST', credentials: 'include' });
                          const json = await res.json().catch(() => ({}));
                          setPortalMessage(res.ok
                            ? `Applied ${(json.appliedFields ?? []).length} field(s); blank fields only. Review the intake below and re-run the analysis.`
                            : json.error ?? 'The submission could not be applied.');
                          refreshPendingClient();
                          employment.refresh();
                        }}
                        style={{ background: orange, color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, border: 'none', cursor: 'pointer', fontFamily: sans }}
                      >
                        Apply to the intake
                      </button>
                      <button
                        onClick={async () => {
                          await fetch(`/api/employment/${sessionId}/client-intake`, { method: 'DELETE', credentials: 'include' });
                          refreshPendingClient();
                        }}
                        style={{ background: '#fff', color: muted, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {activeTab === 'client' && (
            <div id="panel-client" role="tabpanel" style={{ paddingTop: 22 }}>
              <CorrespondencePanel
                matterId={sessionId!}
                clientEmail={String((employment.data?.intake as Record<string, unknown> | undefined)?.client_email ?? '') || undefined}
              />
            </div>
          )}

          {activeTab === 'negotiation' && (
            <div id="panel-negotiation" role="tabpanel" style={{ paddingTop: 22 }}>
              <NegotiationPanel matterId={sessionId!} />
              <NetSettlementPanel matterId={sessionId!} />
            </div>
          )}

          {activeTab === 'debrief' && (
            <div id="panel-debrief" role="tabpanel" style={{ paddingTop: 22 }}>
              <DebriefPanel matterId={sessionId!} clientEmail={String((employment.data?.intake as Record<string, unknown> | undefined)?.client_email ?? '') || undefined} />
            </div>
          )}

          {activeTab === 'notes' && (
            <div id="panel-notes" role="tabpanel" style={{ paddingTop: 22 }}>
              <div
                style={{
                  fontSize: 12.5,
                  color: muted,
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                {/* Lock icon */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Private to you. Not processed by AI and not included in any deliverable.
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 220,
                  fontFamily: sans,
                  fontSize: 14,
                  border: `1px solid ${border}`,
                  borderRadius: 2,
                  padding: 16,
                  lineHeight: 1.6,
                  resize: 'vertical',
                  color: ink,
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button
                  onClick={async () => {
                    setNotesStatus('saving');
                    const result = await employment.saveNotes(notes);
                    setNotesStatus(result.ok ? 'saved' : 'error');
                    if (result.ok) setTimeout(() => setNotesStatus('idle'), 2500);
                  }}
                  disabled={notesStatus === 'saving'}
                  style={{
                    background: notesStatus === 'saving' ? '#b0b0b0' : orange,
                    color: '#fff',
                    fontSize: 13.5,
                    fontWeight: 600,
                    padding: '11px 18px',
                    borderRadius: 2,
                    border: 'none',
                    cursor: notesStatus === 'saving' ? 'not-allowed' : 'pointer',
                    fontFamily: sans,
                  }}
                >
                  {notesStatus === 'saving' ? 'Saving...' : 'Save Notes'}
                </button>
                {notesStatus === 'saved' && (
                  <span style={{ fontSize: 13, color: green, fontWeight: 600 }} role="status">Saved</span>
                )}
                {notesStatus === 'error' && (
                  <span style={{ fontSize: 13, color: '#dc2626' }} role="alert">The notes could not be saved. Please try again.</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Context-sensitive Action Bar ────────────────────────── */}
        <div
          style={{
            background: '#fff',
            border: `1px solid ${border}`,
            padding: '18px 24px',
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: serif,
              fontSize: 13,
              color: muted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginRight: 6,
            }}
          >
            Actions
          </span>
          <button
            onClick={() => { setActiveTab('draft'); window.scrollTo(0, 0); }}
            style={{
              background: orange,
              color: '#fff',
              fontSize: 13.5,
              fontWeight: 600,
              padding: '11px 18px',
              borderRadius: 2,
              border: 'none',
              cursor: 'pointer',
              fontFamily: sans,
            }}
          >
            Draft a Document
          </button>
          <ActionButton label="Upload Documents" onClick={() => { setActiveTab('docs'); window.scrollTo(0, 0); }} />

          <span
            style={{
              fontFamily: serif,
              fontSize: 13,
              color: muted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '0 6px 0 14px',
            }}
          >
            Deep Analysis
          </span>
          <ActionButton label="Second Opinion" onClick={() => launchDeepAnalysis('second_opinion')} />
          <ActionButton label="Moot Employer's Response" onClick={() => launchDeepAnalysis('moot')} />
          <ActionButton label="Full Case Assessment" onClick={() => launchDeepAnalysis('assessment')} />
          <ActionButton label="Settlement Valuation" onClick={() => launchDeepAnalysis('settlement')} />
          <ActionButton
            label={clientUpdateLoading ? 'Drafting update...' : 'Draft Client Update'}
            onClick={handleClientUpdate}
          />
          {sessionId && (
            <CloseMatterPanel
              matterId={sessionId}
              resolved={employment.stage?.stage === 'resolution'}
              onChanged={() => employment.refresh()}
            />
          )}
        </div>

        {/* Client update draft — plain-language status email for lawyer review */}
        {(clientUpdateHtml || clientUpdateError) && (
          <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '18px 24px', marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, color: navy, margin: 0 }}>
                Client Update: Draft
              </h3>
              {clientUpdateHtml && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      const tmp = document.createElement('div');
                      tmp.innerHTML = clientUpdateHtml;
                      navigator.clipboard.writeText(tmp.innerText);
                      setClientUpdateCopied(true);
                      setTimeout(() => setClientUpdateCopied(false), 2000);
                    }}
                    style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
                  >
                    {clientUpdateCopied ? 'Copied ✓' : 'Copy text'}
                  </button>
                  <button
                    onClick={() => { setClientUpdateHtml(null); }}
                    style={{ background: '#fff', color: muted, border: `1px solid ${border}`, fontSize: 12.5, padding: '7px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
            {clientUpdateError && (
              <div style={{ color: '#dc2626', fontSize: 13.5 }}>{clientUpdateError}</div>
            )}
            {clientUpdateHtml && (
              <>
                <div style={{ fontSize: 12, color: amber, marginBottom: 10 }}>
                  Review and edit before sending; Starling never contacts your clients.
                </div>
                <div
                  style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.7, color: ink, maxHeight: 380, overflowY: 'auto', borderTop: `1px solid ${border}`, paddingTop: 12 }}
                  dangerouslySetInnerHTML={{ __html: clientUpdateHtml }}
                />
              </>
            )}
          </div>
        )}
        <div style={{ fontSize: 12, color: muted, marginTop: 8 }}>
          Deep Analysis convenes a multi-agent team pre-briefed with this matter's facts, issues,
          and entitlements. You confirm the approach and roster before anything runs.
        </div>
      </main>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

/** Top bar extracted for reuse in loading/error states. */
function MatterDetailTopBar() {
  return (
    <header
      style={{
        background: navy,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        height: 64,
      }}
      role="banner"
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <a
          href="#/"
          style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
          aria-label="DemandPay Starling home"
        >
          <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
          </span>
          <span style={{ fontFamily: serif, lineHeight: 1, letterSpacing: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>DEMAND</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>PAY</span>
          </span>
        </a>
        <span
          style={{
            marginLeft: 14,
            paddingLeft: 16,
            borderLeft: '1px solid rgba(255,255,255,0.18)',
            fontFamily: serif,
            fontSize: 15,
            color: '#cfd6e0',
          }}
        >
          <b style={{ color: '#fff' }}>Starling</b> &middot; Employment Law
        </span>
      </div>
    </header>
  );
}

function FactItem({ label, value, isLast, valueColour }: { label: string; value: string; isLast?: boolean; valueColour?: string }) {
  return (
    <div
      style={{
        paddingRight: isLast ? 0 : 28,
        marginRight: isLast ? 0 : 28,
        borderRight: isLast ? 'none' : `1px solid ${border}`,
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: muted, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: valueColour ?? ink }}>
        {value}
      </div>
    </div>
  );
}

function DocRow({ doc }: { doc: DocItem }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: '#fff',
        border: `1px solid ${border}`,
        padding: '14px 18px',
        marginBottom: 10,
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 2,
          background: cream,
          border: `1px solid ${border}`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {doc.group === 'generated' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}
      </div>
      {/* Info */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: navy }}>{doc.name}</div>
        <div style={{ fontSize: 12.5, color: muted }}>{doc.meta}</div>
      </div>
      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        {doc.actions.map((action, i) => (
          <button
            key={i}
            style={{
              fontSize: 12.5,
              color: action.variant === 'gen' ? green : navy,
              background: action.variant === 'gen' ? '#e7f6ec' : '#fff',
              border: `1px solid ${action.variant === 'gen' ? '#bfe3cb' : border}`,
              padding: '6px 12px',
              borderRadius: 2,
              cursor: 'pointer',
              fontFamily: sans,
            }}
          >
            {action.variant === 'gen' && (
              <>
                <StatusDot colour={green} size={5} />{' '}
              </>
            )}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: '#fff',
        color: navy,
        border: `1px solid ${border}`,
        fontSize: 13.5,
        fontWeight: 600,
        padding: '11px 18px',
        borderRadius: 2,
        cursor: 'pointer',
        fontFamily: sans,
      }}
    >
      {label}
    </button>
  );
}

/** Render text with specified substrings bolded. */
function renderBoldText(text: string, boldParts: string[]): React.ReactNode {
  if (!boldParts.length) return text;

  // Build a regex that matches any of the bold parts
  const escaped = boldParts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (boldParts.includes(part)) {
      return <b key={i} style={{ color: ink }}>{part}</b>;
    }
    return <span key={i}>{part}</span>;
  });
}
