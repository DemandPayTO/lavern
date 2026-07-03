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
import { useLabourData } from './hooks/useLabourApi.js';
import type { LabourGate, GrievanceDeadline } from './hooks/useLabourApi.js';
import { useUserProfile } from '../my-page/hooks/useUserProfile.js';
import {
  navy, orange, cream, frame, green, amber, red, border, ink, muted, serif, sans,
  StatusDot, FactItem, ActionButton, StarlingTopBar, GateApprovalPanel, DraftPreview,
} from './shared.js';

// ── Draft catalogue ─────────────────────────────────────────────────────

interface GrievanceDraftType {
  id: string;
  title: string;
  description: string;
  cost: string;
}

const DRAFT_TYPES: GrievanceDraftType[] = [
  {
    id: 'grievance_filing',
    title: 'Grievance',
    description: 'The filing itself — one clear sentence, broad articles basket, broad remedy clause. Construed generously, pleaded broadly anyway.',
    cost: '~$0.05 -- under 1 min',
  },
  {
    id: 'referral_to_arbitration',
    title: 'Referral to Arbitration',
    description: 'Formal notice advancing the grievance to arbitration under the CA and the LRA, with the arbitrator-appointment mechanism.',
    cost: '~$0.05 -- under 1 min',
  },
  {
    id: 'arbitration_brief',
    title: "Union's Arbitration Brief",
    description: 'Full advocacy brief — Wm Scott, KVP, Millhaven, Parry Sound frameworks argued from the approved issues only.',
    cost: '~$0.30–0.60 -- 2–5 min',
  },
  {
    id: 'dfr_response',
    title: 'DFR Response (s. 74)',
    description: "The union's response to a duty of fair representation complaint — the considered-judgment paper trail the Board looks for.",
    cost: '~$0.30–0.60 -- 2–5 min',
  },
];

const DRAFT_TO_DOWNLOAD: Record<string, string> = {
  grievance_filing: 'grievance-filing',
  referral_to_arbitration: 'referral-to-arbitration',
  arbitration_brief: 'arbitration-brief',
  dfr_response: 'dfr-response',
};

type TabKey = 'issues' | 'docs' | 'draft' | 'timeline' | 'notes';

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

  // Load notes once
  useEffect(() => {
    fetch(`/api/employment/${sessionId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (typeof d?.lawyerNotes === 'string' && d.lawyerNotes) setNotes(d.lawyerNotes); })
      .catch(() => { /* notes are best-effort */ });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labour.data, profile.displayName, profile.firmName]);

  // Default draft selection: filing if not filed, else referral
  useEffect(() => {
    if (selectedDraft === null && labour.data) {
      setSelectedDraft(intake.grievance_filed ? 'referral_to_arbitration' : 'grievance_filing');
    }
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
  }, [selectedDraft, labour, repName, orgName, additionalContext, refreshDraftHistory]);

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
  const title = `${grievor} — Grievance v ${employer}`;
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
            <FactItem label="Grievor" value={grievor} />
            {union && <FactItem label="Union" value={union} />}
            <FactItem label="Employer" value={employer} />
            <FactItem
              label="Procedure"
              value={intake.grievance_filed ? String(intake.current_step || 'Filed') : 'Not yet filed'}
            />
            <FactItem
              label="Next deadline"
              value={nextDeadline ? `${nextDeadline.date}${nextDeadline.approximate ? ' ~' : ''}` : '—'}
              valueColour={nextDeadline && (nextDeadline.overdue || nextDeadline.daysRemaining <= 10) ? red : undefined}
              isLast
            />
          </div>

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
                      ~ Working-day dates exclude weekends but not statutory holidays — verify against the CA.
                    </div>
                  )}
                </div>
              )}

              <GateApprovalPanel
                gates={triggeredGates}
                structuralGates={structuralGates}
                decisionFor={gateDecision}
                onDecision={setGateDecision}
                subheading="Only approved issues are argued in generated documents. Your call — Starling drafts nothing you haven't approved."
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
              <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px' }}>
                <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                  Upload the collective agreement — Starling fills the clocks
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
                    {autoFilled.map(f => f.replace(/_/g, ' ')).join(', ')} — clocks and gates recomputed.
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

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 8 }}>
                {DRAFT_TYPES.map(dt => {
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
                      placeholder="e.g., The complaint text alleges the union ignored two emails — address that directly."
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
                  disabled={generating || !repName.trim() || !orgName.trim()}
                  style={{
                    background: generating || !repName.trim() || !orgName.trim() ? '#b0b0b0' : orange,
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
                  reviewHeading="Reviewer checklist — verify before use"
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

          {/* ── Notes ─────────────────────────────────────────────── */}
          {activeTab === 'notes' && (
            <div id="panel-notes" role="tabpanel" style={{ paddingTop: 22 }}>
              <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Private to you — not processed by AI, not included in any deliverable.
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
                {notesStatus === 'error' && <span style={{ fontSize: 13, color: '#dc2626' }} role="alert">Could not save — try again.</span>}
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
        </div>

        <div style={{ fontSize: 12, color: muted, marginTop: 8 }}>
          Grievance time limits come from the collective agreement — verify every docket date against the CA.
          Working-day computations exclude weekends but not statutory holidays.
        </div>
      </main>
    </div>
  );
}
