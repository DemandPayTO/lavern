/**
 * LabourMatterDetailView — grievance matter view for the union-side
 * labour vertical. Rendered by MatterDetailView when a matter carries
 * labour (grievance) data.
 *
 * Reuses the shared Starling components (GateApprovalPanel, DraftPreview,
 * StarlingTopBar, FactItem) so the grievance UI matches the employment
 * matter view exactly. Reviewer language throughout — in Ontario,
 * non-lawyer union representatives lawfully represent at arbitration.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useLabourData, useCaProfiles } from './hooks/useLabourApi.js';
import type { LabourGate, GrievanceDeadline, CaProcedureStep, GrievanceStepEvent } from './hooks/useLabourApi.js';
import { useUserProfile } from '../my-page/hooks/useUserProfile.js';
import {
  navy, orange, cream, frame, green, amber, red, border, ink, muted, serif, sans,
  StatusDot, FactItem, ActionButton, StarlingTopBar, GateApprovalPanel, DraftPreview,
  IntakeEditorPanel, GeneratedDocsPanel, NextStepsPanel, CloseMatterPanel,
} from './shared.js';
import type { IntakeFieldDef, GeneratedDocSummary } from './shared.js';

// ── Draft catalogue ─────────────────────────────────────────────────────

interface GrievanceDraftType {
  id: string;
  title: string;
  description: string;
  cost: string;
  section: string;
}

const LABOUR_DRAFT_SECTIONS = [
  'The grievance',
  'Hearing and assessment',
  'Resolution and the member',
  'Board proceedings',
] as const;

const DRAFT_TYPES: GrievanceDraftType[] = [
  // ── The grievance ──────────────────────────────────────────────────────
  {
    id: 'grievance_filing',
    title: 'Grievance',
    description: 'The filing itself: one clear sentence, a broad basket of articles, and a broad remedy clause. Grievances are construed generously; this one is pleaded broadly regardless.',
    cost: '~$3 \u00B7 under 1 min',
    section: 'The grievance',
  },
  {
    id: 'particulars',
    title: 'Particulars of the Grievance',
    description: 'Fair notice of the case the employer must meet, and nothing more: dated allegations tied to articles, with the right to supplement reserved.',
    cost: '~$3 \u00B7 under 1 min',
    section: 'The grievance',
  },
  {
    id: 'production_request',
    title: 'Production Request',
    description: 'The pre-arbitration disclosure demand: the investigation file, the decision trail, and the comparator discipline, tailored to the approved issues.',
    cost: '~$3 \u00B7 under 1 min',
    section: 'The grievance',
  },
  {
    id: 'referral_to_arbitration',
    title: 'Referral to Arbitration',
    description: 'Formal notice advancing the grievance to arbitration under the CA and the LRA, with the arbitrator-appointment mechanism.',
    cost: '~$3 \u00B7 under 1 min',
    section: 'The grievance',
  },
  // ── Hearing and assessment ─────────────────────────────────────────────
  {
    id: 'arbitration_brief',
    title: "Union's Arbitration Brief",
    description: 'The full advocacy brief. The Wm. Scott, KVP, Millhaven, and Parry Sound frameworks, argued from the approved issues only.',
    cost: '~$20\u201340 \u00B7 under 1 min',
    section: 'Hearing and assessment',
  },
  {
    id: 'merits_assessment',
    title: 'Merits Assessment Memorandum',
    description: 'The internal assessment of whether to advance, settle, or decline. The considered-judgment record that answers a s. 74 complaint before it is made.',
    cost: '~$20\u201340 \u00B7 under 1 min',
    section: 'Hearing and assessment',
  },
  {
    id: 'will_say',
    title: 'Will-Say Statements',
    description: 'One factual will-say per witness from the intake witness list, first person, no argument, with confirm-with-witness markers and cross-examination preparation notes.',
    cost: '~$3 \u00B7 under 1 min',
    section: 'Hearing and assessment',
  },
  {
    id: 'agreed_facts',
    title: 'Agreed Statement of Facts',
    description: 'The proposed agreed facts that narrow the hearing: objectively verifiable matters only, with the contested facts listed separately so nothing is conceded by accident.',
    cost: '~$3 \u00B7 under 1 min',
    section: 'Hearing and assessment',
  },
  {
    id: 'closing_argument',
    title: 'Closing Argument Skeleton',
    description: 'The Wm. Scott argument structure with evidence and authority slots left open for what the hearing establishes. Remedy stated precisely, alternatives included.',
    cost: '~$20\u201340 \u00B7 under 1 min',
    section: 'Hearing and assessment',
  },
  {
    id: 'hearing_bundle',
    title: 'Hearing Bundle Skeleton',
    description: 'The binder plan at no cost: tab index in hearing order, witness list, hearing-day checklist, and an explicit list of everything still missing.',
    cost: '$0 \u00B7 instant',
    section: 'Hearing and assessment',
  },
  // ── Resolution and the member ──────────────────────────────────────────
  {
    id: 'settlement_memorandum',
    title: 'Memorandum of Settlement',
    description: 'The binding resolution: terms, the disposition of the discipline record, without-precedent protections, and the Code cautions.',
    cost: '~$20\u201340 \u00B7 under 1 min',
    section: 'Resolution and the member',
  },
  {
    id: 'decline_letter',
    title: 'Decision Letter: Not Advancing',
    description: 'The letter to the grievor where the union declines to advance the grievance, with reasons, the review process, and the internal appeal route.',
    cost: '~$3 \u00B7 under 1 min',
    section: 'Resolution and the member',
  },
  {
    id: 'member_update',
    title: 'Grievor Status Update',
    description: 'A plain-language status letter to the grievor. Regular documented updates are both good representation and the answer to s. 74 scrutiny.',
    cost: '~$0.03 \u00B7 under 1 minute',
    section: 'Resolution and the member',
  },
  {
    id: 'remedy_worksheet',
    title: 'Remedy Worksheet',
    description: 'The make-whole computation: back pay, vacation pay, benefits, and pension contributions, less interim earnings, with every derivation shown.',
    cost: 'no AI cost \u00B7 instant',
    section: 'Resolution and the member',
  },
  // ── Board proceedings ──────────────────────────────────────────────────
  {
    id: 'dfr_response',
    title: 'DFR Response (s. 74, Form A-30)',
    description: "The union's response to a duty of fair representation complaint, presenting the considered-judgment record the Board looks for.",
    cost: '~$20\u201340 \u00B7 under 1 min',
    section: 'Board proceedings',
  },
  {
    id: 'ohsa_reprisal_complaint',
    title: 'OHSA s. 50 Reprisal (Form A-53)',
    description: 'The reprisal application narrative for the Board, built to trigger the s. 50(5) reverse onus. Confirm the forum election first.',
    cost: '~$20\u201340 \u00B7 under 1 min',
    section: 'Board proceedings',
  },
];

const DRAFT_TO_DOWNLOAD: Record<string, string> = {
  grievance_filing: 'grievance-filing',
  referral_to_arbitration: 'referral-to-arbitration',
  arbitration_brief: 'arbitration-brief',
  dfr_response: 'dfr-response',
  merits_assessment: 'merits-assessment',
  decline_letter: 'decline-letter',
  member_update: 'member-update',
  remedy_worksheet: 'remedy-worksheet',
  particulars: 'particulars',
  production_request: 'production-request',
  settlement_memorandum: 'settlement-memorandum',
  ohsa_reprisal_complaint: 'ohsa-reprisal-complaint',
};

type TabKey = 'issues' | 'docs' | 'draft' | 'timeline' | 'intake' | 'notes';

// ── Intake editor fields ────────────────────────────────────────────────

const GRIEVANCE_INTAKE_FIELDS: IntakeFieldDef[] = [
  { key: 'grievor_first_name', label: 'Grievor first name' },
  { key: 'grievor_last_name', label: 'Grievor last name' },
  { key: 'grievor_classification', label: 'Classification / position' },
  { key: 'grievor_seniority_date', label: 'Seniority date', type: 'date' },
  { key: 'union_name', label: 'Union and local' },
  { key: 'employer_name', label: 'Employer' },
  {
    key: 'grievance_type', label: 'Grievance type', type: 'select',
    options: [['discharge', 'Discharge'], ['discipline', 'Discipline'], ['policy', 'Policy'], ['interpretation', 'Interpretation'], ['group', 'Group'], ['human_rights', 'Human rights'], ['health_safety', 'Health and safety'], ['other', 'Other']],
  },
  {
    key: 'discipline_imposed', label: 'Discipline imposed', type: 'select',
    options: [['none', 'None'], ['verbal_warning', 'Verbal warning'], ['written_warning', 'Written warning'], ['suspension_unpaid', 'Suspension (unpaid)'], ['suspension_paid', 'Suspension (paid)'], ['demotion', 'Demotion'], ['transfer', 'Transfer'], ['discharge', 'Discharge'], ['last_chance_agreement', 'Last chance agreement'], ['other', 'Other']],
  },
  { key: 'incident_date', label: 'Incident date', type: 'date' },
  { key: 'knowledge_date', label: 'Union/grievor aware (if different)', type: 'date' },
  { key: 'grievance_filed', label: 'Grievance filed', type: 'checkbox' },
  { key: 'grievance_filed_date', label: 'Filed date', type: 'date' },
  { key: 'grievance_number', label: 'Grievance number' },
  { key: 'last_step_response_date', label: 'Final step response date', type: 'date' },
  { key: 'filing_deadline_days', label: 'Days to file (CA)', type: 'number' },
  { key: 'filing_deadline_kind', label: 'Filing day kind', type: 'select', options: [['calendar', 'Calendar days'], ['working', 'Working days']] },
  { key: 'referral_deadline_days', label: 'Days to refer to arbitration (CA)', type: 'number' },
  { key: 'referral_deadline_kind', label: 'Referral day kind', type: 'select', options: [['calendar', 'Calendar days'], ['working', 'Working days']] },
  { key: 'remedy_sought', label: 'Remedy sought' },
  { key: 'incident_description', label: 'What happened', type: 'textarea' },
];

// ── Component ───────────────────────────────────────────────────────────

export default function LabourMatterDetailView({ sessionId, matterNumber }: { sessionId: string; matterNumber?: string }) {
  const { profile } = useUserProfile();
  const labour = useLabourData(sessionId);
  const [activeTab, setActiveTab] = useState<TabKey>('issues');

  // Draft state
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [genReviewFlags, setGenReviewFlags] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [repName, setRepName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');

  // Docs state
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState('collective_agreement');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [lastExtraction, setLastExtraction] = useState<{
    filename: string;
    keyFindings: string[];
    extractedFields: Record<string, { value: string | number | boolean | null; confidence: string }>;
  } | null>(null);
  const [autoFilled, setAutoFilled] = useState<string[]>([]);
  const caLibrary = useCaProfiles();
  const [librarySaveStatus, setLibrarySaveStatus] = useState<string | null>(null);

  // Remedy worksheet inputs (merged into the intake before generation)
  const [wageRate, setWageRate] = useState('');
  const [wagePeriod, setWagePeriod] = useState('hour');
  const [hoursPerWeek, setHoursPerWeek] = useState('');
  const [vacationPct, setVacationPct] = useState('');
  const [benefitsPct, setBenefitsPct] = useState('');
  const [pensionPct, setPensionPct] = useState('');
  const [interimEarnings, setInterimEarnings] = useState('');

  // Step recording drafts (per-step date inputs before save)
  const [stepDrafts, setStepDrafts] = useState<Record<string, { presented: string; response: string }>>({});
  const [stepSaveStatus, setStepSaveStatus] = useState<string | null>(null);

  // Notes state (matter-level — same store as employment)
  const [notes, setNotes] = useState('');
  const [notesStatus, setNotesStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Draft history (matter-level)
  interface DraftHistoryEntry { docType: string; title: string; html: string; costUsd: number; generatedAt: string }
  const [draftHistory, setDraftHistory] = useState<DraftHistoryEntry[]>([]);
  const refreshDraftHistory = useCallback(() => {
    fetch(`/api/employment/${sessionId}/drafts`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setDraftHistory(d.drafts ?? []); })
      .catch(() => { /* history is best-effort */ });
  }, [sessionId]);
  useEffect(() => { refreshDraftHistory(); }, [refreshDraftHistory]);

  // Matter-level extras: lawyer notes + generated-document lifecycle
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocSummary[]>([]);
  const refreshMatterExtras = useCallback(() => {
    fetch(`/api/employment/${sessionId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (typeof d?.lawyerNotes === 'string' && d.lawyerNotes) setNotes(prev => prev || d.lawyerNotes);
        if (Array.isArray(d?.generatedDocuments)) setGeneratedDocs(d.generatedDocuments);
      })
      .catch(() => { /* best-effort */ });
  }, [sessionId]);
  useEffect(() => { refreshMatterExtras(); }, [refreshMatterExtras]);

  const setDocumentStatus = useCallback(async (docType: string, status: GeneratedDocSummary['status'], date?: string) => {
    try {
      const res = await fetch(`/api/employment/${sessionId}/document-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ docType, status, date }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: (json as { error?: string }).error ?? 'The status could not be updated' };
      if (Array.isArray((json as { generatedDocuments?: GeneratedDocSummary[] }).generatedDocuments)) {
        setGeneratedDocs((json as { generatedDocuments: GeneratedDocSummary[] }).generatedDocuments);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'The status could not be updated' };
    }
  }, [sessionId]);

  const handleNav = useCallback((hash: string) => { window.location.hash = hash; }, []);

  const intake = (labour.data?.intake ?? {}) as Record<string, unknown>;
  const gates = labour.data?.gates ?? [];
  const triggeredGates = gates.filter(g => g.triggered && g.issueCodes.length > 0);
  const structuralGates = gates.filter(g => g.triggered && g.issueCodes.length === 0);
  const deadlines = (labour.data?.analysis?.deadlines ?? []) as GrievanceDeadline[];

  // Sensible defaults for the signature block once data loads
  useEffect(() => {
    if (!repName && (profile.displayName || intake.union_rep_name)) {
      setRepName((intake.union_rep_name as string) || profile.displayName);
    }
    if (!orgName && (intake.union_name || profile.firmName)) {
      setOrgName((intake.union_name as string) || profile.firmName);
    }
    // Remedy inputs prefill from the intake where present
    if (!wageRate && intake.wage_rate) setWageRate(String(intake.wage_rate));
    if (intake.wage_rate_period) setWagePeriod(String(intake.wage_rate_period));
    if (!hoursPerWeek && intake.hours_per_week) setHoursPerWeek(String(intake.hours_per_week));
    if (!vacationPct && intake.vacation_pay_percent) setVacationPct(String(intake.vacation_pay_percent));
    if (!benefitsPct && intake.benefits_load_percent) setBenefitsPct(String(intake.benefits_load_percent));
    if (!pensionPct && intake.pension_contrib_percent) setPensionPct(String(intake.pension_contrib_percent));
    if (!interimEarnings && intake.interim_earnings) setInterimEarnings(String(intake.interim_earnings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labour.data, profile.displayName, profile.firmName]);

  // Default draft selection: filing if not filed, else referral
  useEffect(() => {
    if (selectedDraft === null && labour.data) {
      setSelectedDraft(intake.grievance_filed ? 'referral_to_arbitration' : 'grievance_filing');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labour.data]);

  // Seed the step-recording inputs from events already on file
  useEffect(() => {
    const events = (intake.step_events ?? []) as GrievanceStepEvent[];
    if (!Array.isArray(events) || events.length === 0) return;
    setStepDrafts(prev => {
      const next = { ...prev };
      for (const ev of events) {
        if (!next[ev.step_label]) {
          next[ev.step_label] = { presented: ev.presented_date ?? '', response: ev.response_date ?? '' };
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labour.data]);

  const gateDecision = useCallback((gate: LabourGate): 'approved' | 'dismissed' | 'pending' => {
    if (!labour.data) return 'pending';
    if (gate.issueCodes.some(c => labour.data!.approvedIssues.includes(c))) return 'approved';
    if (gate.issueCodes.some(c => labour.data!.dismissedIssues.includes(c))) return 'dismissed';
    return 'pending';
  }, [labour.data]);

  const setGateDecision = useCallback((gate: LabourGate, decision: 'approve' | 'dismiss') => {
    if (!labour.data) return;
    const approved = new Set(labour.data.approvedIssues);
    const dismissed = new Set(labour.data.dismissedIssues);
    for (const code of gate.issueCodes) {
      if (decision === 'approve') { approved.add(code); dismissed.delete(code); }
      else { dismissed.add(code); approved.delete(code); }
    }
    labour.approveIssues([...approved], [...dismissed]);
  }, [labour]);

  const handleGenerate = useCallback(async () => {
    if (!selectedDraft) return;
    setGenerating(true);
    setGenError(null);

    // The remedy worksheet computes from the intake: persist the
    // compensation inputs first so the figures match what is on file.
    if (selectedDraft === 'remedy_worksheet') {
      const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : undefined; };
      const merged: Record<string, unknown> = { ...intake };
      merged.wage_rate = num(wageRate);
      merged.wage_rate_period = num(wageRate) ? wagePeriod : undefined;
      merged.hours_per_week = num(hoursPerWeek);
      merged.vacation_pay_percent = num(vacationPct);
      merged.benefits_load_percent = num(benefitsPct);
      merged.pension_contrib_percent = num(pensionPct);
      merged.interim_earnings = num(interimEarnings);
      for (const k of Object.keys(merged)) { if (merged[k] === undefined) delete merged[k]; }
      const saved = await labour.saveIntake(merged);
      if (!saved.ok) {
        setGenerating(false);
        setGenError(saved.error ?? 'Could not save the compensation inputs.');
        return;
      }
    }

    const result = await labour.generateDocument(selectedDraft, {
      representativeName: repName || 'Union Representative',
      organizationName: orgName || 'The Union',
      additionalContext: additionalContext || undefined,
    });
    setGenerating(false);
    if (result.ok && result.html) {
      setGeneratedHtml(result.html);
      setGenReviewFlags(result.reviewerFlags ?? []);
      refreshDraftHistory();
    } else {
      setGenError(result.error ?? 'Generation failed.');
    }
  }, [selectedDraft, labour, repName, orgName, additionalContext, refreshDraftHistory, intake, wageRate, wagePeriod, hoursPerWeek, vacationPct, benefitsPct, pensionPct, interimEarnings]);

  // Save the matter's CA terms to the firm's CA library
  const handleSaveToLibrary = useCallback(async () => {
    const name = [intake.union_name, intake.employer_name].filter(Boolean).join(' / ')
      || (intake.ca_title as string)
      || 'Collective agreement';
    const profileData: Record<string, unknown> = {
      name: String(name).slice(0, 200),
      union_name: intake.union_name || undefined,
      employer_name: intake.employer_name || undefined,
      ca_title: intake.ca_title || undefined,
      ca_expiry_date: intake.ca_expiry_date || undefined,
      grievance_procedure_article: intake.grievance_procedure_article || undefined,
      just_cause_article: intake.just_cause_article || undefined,
      filing_deadline_days: intake.filing_deadline_days ?? undefined,
      filing_deadline_kind: intake.filing_deadline_kind ?? undefined,
      referral_deadline_days: intake.referral_deadline_days ?? undefined,
      referral_deadline_kind: intake.referral_deadline_kind ?? undefined,
      time_limits_mandatory: intake.time_limits_mandatory ?? undefined,
      sunset_clause_months: intake.sunset_clause_months ?? undefined,
      procedure_steps: Array.isArray(intake.procedure_steps) && (intake.procedure_steps as unknown[]).length > 0 ? intake.procedure_steps : undefined,
      ca_notes: intake.ca_notes || undefined,
    };
    for (const k of Object.keys(profileData)) { if (profileData[k] === undefined) delete profileData[k]; }
    const result = await caLibrary.save(profileData);
    setLibrarySaveStatus(result.ok
      ? `Saved to the CA library as "${profileData.name}". New grievances can apply it at intake.`
      : result.error ?? 'Could not save the CA profile.');
  }, [intake, caLibrary]);

  // Record a step presentation or response
  const handleStepSave = useCallback(async (stepLabel: string) => {
    const draft = stepDrafts[stepLabel];
    if (!draft || (!draft.presented && !draft.response)) return;
    setStepSaveStatus(null);
    const result = await labour.recordStepEvent({
      step_label: stepLabel,
      presented_date: draft.presented || undefined,
      response_date: draft.response || undefined,
    });
    setStepSaveStatus(result.ok
      ? `${stepLabel} recorded. Clocks and gates recomputed.`
      : result.error ?? 'Could not record the step event.');
  }, [stepDrafts, labour]);

  const handleExtractFile = useCallback(async (file: File) => {
    setExtracting(true);
    setExtractError(null);
    setLastExtraction(null);
    setAutoFilled([]);
    const result = await labour.extractDocument(file, uploadKind);
    setExtracting(false);
    if (result.ok && result.extraction) {
      setLastExtraction(result.extraction);
      setAutoFilled(result.labourAutoFilled ?? []);
    } else {
      setExtractError(result.error ?? 'Extraction failed.');
    }
  }, [labour, uploadKind]);

  // ── Loading / not found ────────────────────────────────────────────────
  if (labour.loading || !labour.data) {
    return (
      <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
        <StarlingTopBar subtitle="Labour &#38; Employment" />
        <main id="main-content" style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 28px 60px' }}>
          <div style={{ padding: '60px 0', textAlign: 'center', color: muted, fontSize: 15 }}>Loading grievance...</div>
        </main>
      </div>
    );
  }

  // ── Header facts ───────────────────────────────────────────────────────
  const grievor = [intake.grievor_first_name, intake.grievor_last_name].filter(Boolean).join(' ') || 'Grievor';
  const employer = (intake.employer_name as string) || 'Employer';
  const union = (intake.union_name as string) || '';
  const title = `${grievor}: Grievance v ${employer}`;
  const nextDeadline = deadlines.find(d => !d.overdue) ?? deadlines[0];
  const overdue = deadlines.some(d => d.overdue);
  const urgent = overdue || deadlines.some(d => d.daysRemaining <= 10 && !d.overdue);
  const statusLabel = overdue ? 'Time limit missed' : urgent ? 'Urgent' : 'Active';
  const statusColour = urgent ? red : navy;
  const statusBg = urgent ? '#fce8e6' : '#eef1f6';

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'issues', label: 'Issues Found', badge: triggeredGates.length || undefined },
    { key: 'docs', label: 'Documents' },
    { key: 'draft', label: 'Draft' },
    { key: 'timeline', label: 'Timeline', badge: labour.data.timeline.length || undefined },
    { key: 'intake', label: 'Intake' },
    { key: 'notes', label: 'Notes' },
  ];

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      <StarlingTopBar subtitle="Labour &#38; Employment" />

      <main id="main-content" style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 28px 60px' }}>
        <a
          href="#/"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: muted, fontSize: 13.5, marginBottom: 16, textDecoration: 'none' }}
          onClick={(e) => { e.preventDefault(); handleNav('#/'); }}
        >
          &larr; My Cases
        </a>

        {/* ── Matter Header ─────────────────────────────────────── */}
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '22px 26px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
            <div>
              <h1 style={{ fontFamily: serif, fontSize: 24, fontWeight: 600, color: navy, margin: 0 }}>
                {title}{' '}
                <span style={{ fontSize: 12.5, color: muted, marginLeft: 4, fontFamily: sans, fontWeight: 400 }}>
                  {matterNumber ? `Matter ${matterNumber}` : ''}
                  {intake.grievance_number ? ` · Grievance #${intake.grievance_number}` : ''}
                </span>
              </h1>
            </div>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600,
                color: statusColour, background: statusBg, border: `1px solid ${border}`,
                padding: '6px 12px', borderRadius: 2, whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              <StatusDot colour={statusColour} />
              {statusLabel}
            </span>
          </div>

          {/* Facts row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginTop: 18, borderTop: `1px solid ${border}`, paddingTop: 16 }}>
            {labour.stage && <FactItem label="Stage" value={labour.stage.label} valueColour={navy} />}
            <FactItem label="Grievor" value={grievor} />
            {union && <FactItem label="Union" value={union} />}
            <FactItem label="Employer" value={employer} />
            <FactItem
              label="Procedure"
              value={intake.grievance_filed ? String(intake.current_step || 'Filed') : 'Not yet filed'}
            />
            <FactItem
              label="Next deadline"
              value={nextDeadline ? `${nextDeadline.date}${nextDeadline.approximate ? ' ~' : ''}` : 'None'}
              valueColour={nextDeadline && (nextDeadline.overdue || nextDeadline.daysRemaining <= 10) ? red : undefined}
              isLast
            />
          </div>

          <NextStepsPanel steps={labour.nextSteps} onGoTo={(tab) => setActiveTab(tab as TabKey)} />

          {/* ── Tabs ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 2, marginTop: 18, borderBottom: `1px solid ${border}` }} role="tablist">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  fontFamily: sans, fontSize: 14, fontWeight: 600,
                  color: activeTab === tab.key ? navy : muted,
                  background: 'transparent', border: 'none', padding: '13px 20px', cursor: 'pointer',
                  borderBottom: `2px solid ${activeTab === tab.key ? orange : 'transparent'}`,
                  marginBottom: -1,
                }}
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls={`panel-${tab.key}`}
              >
                {tab.label}
                {tab.badge != null && (
                  <span style={{
                    fontSize: 11, background: activeTab === tab.key ? orange : cream,
                    border: `1px solid ${activeTab === tab.key ? orange : border}`,
                    color: activeTab === tab.key ? '#fff' : muted,
                    borderRadius: 2, padding: '0 6px', marginLeft: 6,
                  }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Issues ────────────────────────────────────────────── */}
          {activeTab === 'issues' && (
            <div id="panel-issues" role="tabpanel" style={{ paddingTop: 22 }}>
              {/* CA clocks summary */}
              {deadlines.length > 0 && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, borderLeft: `4px solid ${urgent ? red : navy}`, padding: '14px 18px', marginBottom: 16 }}>
                  <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 8 }}>
                    Collective agreement clocks
                  </div>
                  {deadlines.map((d, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13.5 }}>
                      <StatusDot colour={d.overdue ? red : d.daysRemaining <= 10 ? red : d.daysRemaining <= 45 ? amber : muted} size={8} />
                      <span style={{ fontWeight: 700, color: d.overdue || d.daysRemaining <= 10 ? red : ink, minWidth: 100 }}>
                        {d.overdue ? `${-d.daysRemaining}d OVERDUE` : d.daysRemaining === 0 ? 'TODAY' : `in ${d.daysRemaining}d`}
                      </span>
                      <span style={{ color: ink }}>{d.label}</span>
                      <span style={{ color: muted, marginLeft: 'auto', fontFamily: 'monospace' }}>{d.date}</span>
                    </div>
                  ))}
                  {deadlines.some(d => d.approximate) && (
                    <div style={{ fontSize: 12, color: amber, marginTop: 6 }}>
                      ~ Working-day dates exclude weekends but not statutory holidays; verify against the collective agreement.
                    </div>
                  )}
                </div>
              )}

              {/* Procedure step recording — each saved event recomputes the clocks */}
              {Array.isArray(intake.procedure_steps) && (intake.procedure_steps as CaProcedureStep[]).length > 0 && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginBottom: 16 }}>
                  <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                    Grievance procedure
                  </div>
                  <div style={{ fontSize: 12.5, color: muted, marginBottom: 12 }}>
                    Record each presentation and employer response. Every entry recomputes the response,
                    advance, and referral clocks on the docket.
                  </div>
                  {(intake.procedure_steps as CaProcedureStep[]).map(step => {
                    const draft = stepDrafts[step.label] ?? { presented: '', response: '' };
                    const setDraft = (patch: Partial<{ presented: string; response: string }>) =>
                      setStepDrafts(prev => ({ ...prev, [step.label]: { ...draft, ...patch } }));
                    const limits = [
                      step.employer_response_days ? `response ${step.employer_response_days} ${step.day_kind ?? 'calendar'} days` : '',
                      step.advance_days ? `advance ${step.advance_days} ${step.day_kind ?? 'calendar'} days` : '',
                    ].filter(Boolean).join('; ');
                    return (
                      <div key={step.label} style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '10px 0', borderTop: `1px solid ${border}`, flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 140 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>{step.label}</div>
                          {limits && <div style={{ fontSize: 11.5, color: muted }}>{limits}</div>}
                        </div>
                        <div>
                          <div style={{ fontSize: 11.5, color: muted, marginBottom: 3 }}>Presented</div>
                          <input
                            type="date" value={draft.presented}
                            onChange={e => setDraft({ presented: e.target.value })}
                            aria-label={`${step.label} presented date`}
                            style={{ fontFamily: sans, fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 11.5, color: muted, marginBottom: 3 }}>Employer response</div>
                          <input
                            type="date" value={draft.response}
                            onChange={e => setDraft({ response: e.target.value })}
                            aria-label={`${step.label} response date`}
                            style={{ fontFamily: sans, fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
                          />
                        </div>
                        <button
                          onClick={() => handleStepSave(step.label)}
                          disabled={!draft.presented && !draft.response}
                          style={{
                            fontSize: 12.5, fontWeight: 600, padding: '8px 16px', borderRadius: 2, fontFamily: sans,
                            background: (!draft.presented && !draft.response) ? '#f0efec' : navy,
                            color: (!draft.presented && !draft.response) ? muted : '#fff',
                            border: 'none', cursor: (!draft.presented && !draft.response) ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Record
                        </button>
                      </div>
                    );
                  })}
                  {stepSaveStatus && (
                    <div style={{ fontSize: 12.5, color: stepSaveStatus.includes('recomputed') ? green : red, marginTop: 8 }} role="status">
                      {stepSaveStatus}
                    </div>
                  )}
                </div>
              )}

              <GateApprovalPanel
                gates={triggeredGates}
                structuralGates={structuralGates}
                decisionFor={gateDecision}
                onDecision={setGateDecision}
                subheading="Only approved issues are argued in generated documents. Starling drafts nothing you have not approved."
                reviewBadge="REVIEW REQUIRED"
              />

              {triggeredGates.length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>
                  No issues triggered by the intake yet.
                </div>
              )}
            </div>
          )}

          {/* ── Documents ─────────────────────────────────────────── */}
          {activeTab === 'docs' && (
            <div id="panel-docs" role="tabpanel" style={{ paddingTop: 22 }}>
              <GeneratedDocsPanel docs={generatedDocs} onSetStatus={setDocumentStatus} />
              <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px' }}>
                <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                  Upload the collective agreement and Starling fills the clocks
                </div>
                <div style={{ fontSize: 12.5, color: muted, marginBottom: 12 }}>
                  PDF, DOCX, or text. Starling extracts the grievance-procedure article and the filing/referral
                  time limits, and puts them on the docket. Values you entered by hand are never overwritten.
                  Names are anonymised before any AI processing.
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={uploadKind}
                    onChange={e => setUploadKind(e.target.value)}
                    aria-label="Document type"
                    style={{ fontFamily: sans, fontSize: 13.5, padding: '9px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
                  >
                    <option value="collective_agreement">Collective agreement</option>
                    <option value="correspondence">Discipline letter / correspondence</option>
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
                      if (file) handleExtractFile(file);
                      if (uploadInputRef.current) uploadInputRef.current.value = '';
                    }}
                  />
                  <button
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={extracting}
                    style={{
                      background: extracting ? '#b0b0b0' : navy, color: '#fff', fontSize: 13.5, fontWeight: 600,
                      padding: '10px 18px', borderRadius: 2, border: 'none',
                      cursor: extracting ? 'not-allowed' : 'pointer', fontFamily: sans,
                    }}
                  >
                    {extracting ? 'Extracting...' : '+ Upload & extract'}
                  </button>
                </div>

                {extractError && (
                  <div style={{ marginTop: 12, padding: '10px 14px', border: '1px solid #dc2626', borderRadius: 2, background: '#fce8e6', color: '#dc2626', fontSize: 13 }}>
                    {extractError}
                  </div>
                )}

                {autoFilled.length > 0 && (
                  <div style={{ marginTop: 12, padding: '10px 14px', border: `1px solid ${green}`, borderRadius: 2, background: '#e7f6ec', color: green, fontSize: 13, fontWeight: 600 }}>
                    Filled {autoFilled.length} CA field{autoFilled.length === 1 ? '' : 's'} from the agreement:{' '}
                    {autoFilled.map(f => f.replace(/_/g, ' ')).join(', ')}. Clocks and gates recomputed.
                  </div>
                )}

                {/* CA library: reuse this agreement's terms on future grievances */}
                {Boolean(intake.filing_deadline_days || intake.referral_deadline_days || intake.grievance_procedure_article) && (
                  <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <button
                      onClick={handleSaveToLibrary}
                      style={{
                        background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                        padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                      }}
                    >
                      Save this CA to the library
                    </button>
                    <span style={{ fontSize: 12, color: muted }}>
                      One profile per bargaining unit; new grievances apply it at intake.
                    </span>
                    {librarySaveStatus && (
                      <span style={{ fontSize: 12.5, color: librarySaveStatus.startsWith('Saved') ? green : red }} role="status">
                        {librarySaveStatus}
                      </span>
                    )}
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
                    {Object.keys(lastExtraction.extractedFields).length > 0 && (
                      <div style={{ fontSize: 12.5, color: muted }}>
                        {Object.entries(lastExtraction.extractedFields)
                          .filter(([, f]) => f && f.value !== null && f.value !== '')
                          .map(([k, f]) => (
                            <div key={k} style={{ padding: '3px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 600 }}>{k.replace(/_/g, ' ')}:</span>
                              <span style={{ color: ink }}>{String(f.value)}</span>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 2,
                                background: f.confidence === 'high' ? '#e7f6ec' : f.confidence === 'medium' ? '#fdf0dd' : '#f4f1ec',
                                color: f.confidence === 'high' ? green : f.confidence === 'medium' ? amber : muted,
                              }}>
                                {f.confidence}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: amber, marginTop: 8 }}>
                      Verify extracted time limits against the CA text before relying on the docket dates.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Draft ─────────────────────────────────────────────── */}
          {activeTab === 'draft' && (
            <div id="panel-draft" role="tabpanel" style={{ paddingTop: 22 }}>
              <p style={{ fontSize: 13.5, color: muted, marginBottom: 16 }}>
                Pick a document. Starling drafts it from the intake and the issues you approved,
                flags anything that needs verification, and never invents facts or authorities.
              </p>

              {LABOUR_DRAFT_SECTIONS.map(section => (
                <div key={section} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10 }}>
                    {section}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                    {DRAFT_TYPES.filter(dt => dt.section === section).map(dt => {
                      const recommended = (dt.id === 'grievance_filing' && !intake.grievance_filed)
                        || (dt.id === 'referral_to_arbitration' && Boolean(intake.grievance_filed) && Boolean(intake.last_step_response_date));
                      return (
                        <div
                          key={dt.id}
                          onClick={() => setSelectedDraft(dt.id)}
                          style={{
                            background: '#fff',
                            border: `1px solid ${selectedDraft === dt.id ? orange : border}`,
                            padding: 18,
                            cursor: 'pointer',
                            boxShadow: selectedDraft === dt.id ? `0 2px 0 ${orange}` : 'none',
                          }}
                          role="radio"
                          aria-checked={selectedDraft === dt.id}
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDraft(dt.id); } }}
                        >
                          {recommended && (
                            <span style={{
                              fontSize: 10.5, fontWeight: 700, color: '#fff', background: orange,
                              padding: '2px 7px', borderRadius: 2, letterSpacing: '0.04em',
                            }}>
                              RECOMMENDED NEXT
                            </span>
                          )}
                          <h4 style={{ fontFamily: serif, fontSize: 15.5, fontWeight: 600, color: navy, margin: recommended ? '10px 0 5px' : '0 0 5px' }}>
                            {dt.title}
                          </h4>
                          <p style={{ fontSize: 12.5, color: muted, margin: 0 }}>{dt.description}</p>
                          <div style={{ fontSize: 12, color: muted, marginTop: 10 }}>{dt.cost}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* OLRB data files: pre-fill the official Board forms */}
              {(selectedDraft === 'dfr_response' || selectedDraft === 'ohsa_reprisal_complaint') && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16, marginTop: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>
                    {selectedDraft === 'dfr_response'
                      ? 'Form A-30 itself: download the pre-filled data file'
                      : 'Form A-53 itself: download the pre-filled data file'}
                  </div>
                  <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>
                    The Board's forms are locked dynamic PDFs and cannot be filled directly. Starling
                    generates a data file from this matter (style of cause and contact details); open the
                    official form in Acrobat, then <strong>Prepare Form → More → Import Data</strong> and
                    select this file. The narrative questions are left for the generated document, which is
                    filed as the schedule. Review every field.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      href={`/api/labour/${sessionId}/form/${selectedDraft === 'dfr_response' ? 'a30-data' : 'a53-data'}`}
                      download
                      style={{ background: navy, color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, textDecoration: 'none', fontFamily: sans }}
                    >
                      Download {selectedDraft === 'dfr_response' ? 'Form A-30' : 'Form A-53'} data file (.xml)
                    </a>
                    <a
                      href="https://olrb.gov.on.ca/FormsByNumber-EN.asp"
                      target="_blank" rel="noopener noreferrer"
                      style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, textDecoration: 'none', fontFamily: sans }}
                    >
                      Get the official form ↗
                    </a>
                  </div>
                </div>
              )}

              {/* Remedy worksheet inputs — persisted to the intake so the
                  figures always match the file */}
              {selectedDraft === 'remedy_worksheet' && !generatedHtml && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 4, marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Wage rate (CAD)</div>
                    <input type="text" inputMode="decimal" placeholder="e.g., 32.50" value={wageRate} onChange={e => setWageRate(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Rate period</div>
                    <select value={wagePeriod} onChange={e => setWagePeriod(e.target.value)} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}>
                      <option value="hour">per hour</option>
                      <option value="week">per week</option>
                      <option value="year">per year</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Hours per week</div>
                    <input type="text" inputMode="decimal" placeholder="e.g., 40" value={hoursPerWeek} onChange={e => setHoursPerWeek(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Interim earnings (CAD)</div>
                    <input type="text" inputMode="decimal" placeholder="e.g., 2000" value={interimEarnings} onChange={e => setInterimEarnings(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Vacation pay %</div>
                    <input type="text" inputMode="decimal" placeholder="e.g., 4" value={vacationPct} onChange={e => setVacationPct(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Benefits %</div>
                    <input type="text" inputMode="decimal" placeholder="e.g., 10" value={benefitsPct} onChange={e => setBenefitsPct(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Pension %</div>
                    <input type="text" inputMode="decimal" placeholder="e.g., 6" value={pensionPct} onChange={e => setPensionPct(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
                  </div>
                </div>
              )}

              {selectedDraft && !generatedHtml && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14, marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Prepared by</div>
                    <input
                      type="text" placeholder="Representative / counsel name" value={repName}
                      onChange={e => setRepName(e.target.value)}
                      style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Union / firm</div>
                    <input
                      type="text" placeholder="e.g., USW Local 1998" value={orgName}
                      onChange={e => setOrgName(e.target.value)}
                      style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>Anything else the draft should know (optional)</div>
                    <textarea
                      placeholder="e.g., The complaint alleges the union ignored two emails; address that directly."
                      value={additionalContext}
                      onChange={e => setAdditionalContext(e.target.value)}
                      rows={2}
                      style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box', resize: 'vertical' }}
                    />
                  </div>
                </div>
              )}

              {selectedDraft && !generatedHtml && (
                <button
                  onClick={handleGenerate}
                  disabled={generating || !repName.trim() || !orgName.trim() || (selectedDraft === 'remedy_worksheet' && !parseFloat(wageRate))}
                  style={{
                    background: generating || !repName.trim() || !orgName.trim() || (selectedDraft === 'remedy_worksheet' && !parseFloat(wageRate)) ? '#b0b0b0' : orange,
                    color: '#fff', fontSize: 13.5, fontWeight: 600, padding: '11px 18px',
                    borderRadius: 2, border: 'none',
                    cursor: generating ? 'not-allowed' : 'pointer', marginTop: 8, fontFamily: sans,
                  }}
                >
                  {generating ? 'Generating...' : 'Generate Draft'}
                </button>
              )}

              {genError && (
                <div style={{ marginTop: 12, padding: '12px 16px', border: '1px solid #dc2626', borderRadius: 2, background: '#fce8e6', color: '#dc2626', fontSize: 13.5 }}>
                  {genError}
                </div>
              )}

              {generatedHtml && (
                <DraftPreview
                  html={generatedHtml}
                  reviewFlags={genReviewFlags}
                  downloadHref={`/api/employment/${sessionId}/download/${DRAFT_TO_DOWNLOAD[selectedDraft ?? ''] ?? 'grievance-filing'}`}
                  onRegenerate={() => setGeneratedHtml(null)}
                  reviewHeading="Reviewer checklist: verify before use"
                />
              )}

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
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setGeneratedHtml(d.html);
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

          {/* ── Timeline ──────────────────────────────────────────── */}
          {activeTab === 'timeline' && (
            <div id="panel-timeline" role="tabpanel" style={{ paddingTop: 22 }}>
              {labour.data.timeline.length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>No timeline events yet.</div>
              )}
              {labour.data.timeline.length > 0 && (
                <div style={{ position: 'relative', paddingLeft: 24 }}>
                  <div style={{ position: 'absolute', left: 6, top: 4, bottom: 4, width: 2, background: border }} aria-hidden="true" />
                  {labour.data.timeline.map((ev, i) => (
                    <div key={`${ev.date}-${i}`} style={{ position: 'relative', marginBottom: 18 }}>
                      <div
                        style={{
                          position: 'absolute', left: -22, top: 4, width: 10, height: 10, borderRadius: '50%',
                          background: ev.category === 'deadline' ? orange : navy,
                          border: '2px solid #fff', boxShadow: `0 0 0 1px ${border}`,
                        }}
                        aria-hidden="true"
                      />
                      <div style={{ fontSize: 12, color: muted, marginBottom: 2 }}>
                        {ev.date}
                        {ev.category === 'deadline' && (
                          <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: orange, background: '#fdf0dd', padding: '1px 6px', borderRadius: 2 }}>
                            DEADLINE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: ink, fontWeight: 600 }}>{ev.label}</div>
                      {ev.description && <div style={{ fontSize: 13, color: muted }}>{ev.description}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Intake editor ─────────────────────────────────────── */}
          {activeTab === 'intake' && (
            <div id="panel-intake" role="tabpanel" style={{ paddingTop: 22 }}>
              <IntakeEditorPanel
                fields={GRIEVANCE_INTAKE_FIELDS}
                values={intake}
                subheading="Correcting a field recomputes the gates, the timeline, and the CA clocks. Issue approvals, procedure steps, and step events are preserved."
                onSave={async (edited) => {
                  const merged: Record<string, unknown> = { ...intake };
                  for (const [k, v] of Object.entries(edited)) {
                    if (v === undefined) delete merged[k];
                    else merged[k] = v;
                  }
                  return labour.saveIntake(merged);
                }}
              />
            </div>
          )}

          {/* ── Notes ─────────────────────────────────────────────── */}
          {activeTab === 'notes' && (
            <div id="panel-notes" role="tabpanel" style={{ paddingTop: 22 }}>
              <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
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
                  width: '100%', minHeight: 220, fontFamily: sans, fontSize: 14,
                  border: `1px solid ${border}`, borderRadius: 2, padding: 16, lineHeight: 1.6,
                  resize: 'vertical', color: ink, boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button
                  onClick={async () => {
                    setNotesStatus('saving');
                    try {
                      const res = await fetch(`/api/employment/${sessionId}/notes`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ notes }),
                      });
                      setNotesStatus(res.ok ? 'saved' : 'error');
                      if (res.ok) setTimeout(() => setNotesStatus('idle'), 2500);
                    } catch {
                      setNotesStatus('error');
                    }
                  }}
                  disabled={notesStatus === 'saving'}
                  style={{
                    background: notesStatus === 'saving' ? '#b0b0b0' : orange, color: '#fff',
                    fontSize: 13.5, fontWeight: 600, padding: '11px 18px', borderRadius: 2, border: 'none',
                    cursor: notesStatus === 'saving' ? 'not-allowed' : 'pointer', fontFamily: sans,
                  }}
                >
                  {notesStatus === 'saving' ? 'Saving...' : 'Save Notes'}
                </button>
                {notesStatus === 'saved' && <span style={{ fontSize: 13, color: green, fontWeight: 600 }} role="status">Saved</span>}
                {notesStatus === 'error' && <span style={{ fontSize: 13, color: '#dc2626' }} role="alert">The notes could not be saved. Please try again.</span>}
              </div>
            </div>
          )}
        </div>

        {/* ── Action bar ────────────────────────────────────────── */}
        <div style={{
          background: '#fff', border: `1px solid ${border}`, padding: '18px 24px', marginTop: 24,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: serif, fontSize: 13, color: muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>
            Actions
          </span>
          <button
            onClick={() => { setActiveTab('draft'); window.scrollTo(0, 0); }}
            style={{
              background: orange, color: '#fff', fontSize: 13.5, fontWeight: 600,
              padding: '11px 18px', borderRadius: 2, border: 'none', cursor: 'pointer', fontFamily: sans,
            }}
          >
            Draft a Document
          </button>
          <ActionButton label="Upload the CA" onClick={() => { setActiveTab('docs'); window.scrollTo(0, 0); }} />
          <ActionButton label="Review Issues" onClick={() => { setActiveTab('issues'); window.scrollTo(0, 0); }} />
          <CloseMatterPanel
            matterId={sessionId}
            resolved={labour.stage?.stage === 'resolution'}
            onChanged={() => labour.refresh()}
          />
        </div>

        <div style={{ fontSize: 12, color: muted, marginTop: 8 }}>
          Grievance time limits come from the collective agreement; verify every docket date against it.
          Working-day computations exclude weekends but not statutory holidays.
        </div>
      </main>
    </div>
  );
}
