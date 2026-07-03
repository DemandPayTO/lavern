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
import { useMatterDetail, useEmploymentData, useFirmTemplates } from './hooks/useStarlingApi.js';
import type { SourceCitation, DocumentExtraction } from './hooks/useStarlingApi.js';
import { useUserProfile } from '../my-page/hooks/useUserProfile.js';
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

type TabKey = 'issues' | 'docs' | 'draft' | 'timeline' | 'notes';

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
  recommended?: boolean;
  alreadyDrafted?: boolean;
}

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
      { label: 'statute -- ESA s. 57', type: 'statute' },
      { label: 'verified -- case_db', type: 'verified' },
    ],
  },
  {
    id: 'termination-clause',
    title: 'Termination clause likely void',
    strength: 'strong',
    description: 'The for-cause provision uses "just cause" rather than the ESA "wilful misconduct" standard. Under Waksdale v Swegon (2020 ONCA 391), if any part of the termination clause violates the ESA, the entire clause is void \u2014 defaulting Ms. Smith to common law notice.',
    descriptionBold: ['Waksdale v Swegon (2020 ONCA 391)', 'entire clause is void'],
    sources: [
      { label: 'verified -- case_db', type: 'verified' },
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
      { label: 'web source -- verify', type: 'web' },
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
      { label: 'verified -- case_db', type: 'verified' },
    ],
  },
];

const DEMO_DOCS: DocItem[] = [
  {
    id: 'd1',
    name: 'Smith_Termination_Letter.pdf',
    meta: 'Uploaded Jun 18 -- facts extracted -- termination date, offer of 4 weeks',
    group: 'uploaded',
    actions: [{ label: 'View', variant: 'default' }, { label: 'Extract data', variant: 'default' }],
  },
  {
    id: 'd2',
    name: 'Smith_Employment_Agreement_2018.pdf',
    meta: 'Uploaded Jun 18 -- termination clause flagged (Waksdale)',
    group: 'uploaded',
    actions: [{ label: 'View', variant: 'default' }, { label: 'Review', variant: 'default' }],
  },
  {
    id: 'd3',
    name: 'Record_of_Employment.pdf',
    meta: 'Uploaded Jun 18 -- salary $95,000 + benefits confirmed',
    group: 'uploaded',
    actions: [{ label: 'View', variant: 'default' }],
  },
  {
    id: 'd4',
    name: 'Demand Letter \u2014 Smith v Acme Corp',
    meta: 'Generated Jun 22 -- Quality 92/100 -- PASS -- 8 verification passes',
    group: 'generated',
    actions: [{ label: 'Open', variant: 'gen' }, { label: 'Results', variant: 'default' }],
  },
  {
    id: 'd5',
    name: 'Entitlements Summary (ESA + Bardal)',
    meta: 'Generated Jun 22 -- CSV / DOCX -- per-cell source citations',
    group: 'generated',
    actions: [{ label: 'Open', variant: 'default' }],
  },
];

const DEMO_DRAFT_TYPES: DraftType[] = [
  {
    id: 'soc',
    title: 'Statement of Claim',
    description: 'File in the Superior Court of Justice for wrongful dismissal and Code damages.',
    cost: '~$3\u20138 -- 3\u20138 min',
    recommended: true,
  },
  {
    id: 'mediation',
    title: 'Mediation Brief',
    description: 'Rule 24.1 mandatory mediation brief with entitlement analysis and settlement range.',
    cost: '~$3\u20138 -- 3\u20138 min',
  },
  {
    id: 'settlement',
    title: 'Settlement Conference Brief',
    description: 'Position summary for a settlement conference, with supporting authorities.',
    cost: '~$3\u20138 -- 3\u20138 min',
  },
  {
    id: 'counter',
    title: 'Counter-Offer Letter',
    description: 'Respond to the employer\u2019s severance offer with a reasoned counter-position.',
    cost: '~$2\u20134 -- 2\u20135 min',
  },
  {
    id: 'demand',
    title: 'Demand Letter',
    description: 'Demand to the employer\u2019s counsel with entitlements, deadline, and settlement position.',
    cost: '~$3\u20138 -- 3\u20138 min',
  },
  {
    id: 'motion',
    title: 'Motion Materials',
    description: 'Notice of motion, supporting affidavit, and factum for an interlocutory motion.',
    cost: '~$5\u20138 -- 5\u201310 min',
  },
];

const DEMO_TIMELINE: TimelineEvent[] = [
  {
    id: 't1',
    date: 'Jun 22, 2026 -- 2:14 PM',
    title: 'Demand letter drafted \u2014 Quality 92/100, PASS',
    subtitle: 'Adversarial workflow -- 8 verification passes -- cost $3.47',
    isCurrent: true,
  },
  {
    id: 't2',
    date: 'Jun 22, 2026 -- 2:02 PM',
    title: 'Entitlements calculated (ESA + Bardal)',
    subtitle: 'ESA notice 8 weeks; common law 10\u201314 months',
  },
  {
    id: 't3',
    date: 'Jun 18, 2026 -- 4:40 PM',
    title: 'Issue analysis complete \u2014 4 issues identified',
    subtitle: '2 strong, 2 moderate -- termination clause flagged under Waksdale',
  },
  {
    id: 't4',
    date: 'Jun 18, 2026 -- 4:35 PM',
    title: '3 documents uploaded & facts extracted',
    subtitle: 'Termination letter, employment agreement, ROE',
  },
  {
    id: 't5',
    date: 'Jun 18, 2026 -- 4:30 PM',
    title: 'Matter created',
    subtitle: 'Client: Jane Smith -- Employer: Acme Corporation',
  },
];

const DEMO_NOTES = `Client call Jun 20: Jane very keen to avoid litigation if possible \u2014 prefers a strong demand letter first, mediation second. Confirm accommodation request was emailed to her manager (Rajiv) on May 28, 3 days before termination \u2014 pull the email for the HRC claim. Acme's HR contact is Susan Bell.`;

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
  const [activeTab, setActiveTab] = useState<TabKey>('issues');
  const [notes, setNotes] = useState(DEMO_NOTES);
  const [notesStatus, setNotesStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedDraft, setSelectedDraft] = useState<string | null>('soc');
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [genCitations, setGenCitations] = useState<SourceCitation[]>([]);
  const [genReviewFlags, setGenReviewFlags] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genTone, setGenTone] = useState('professional');
  const [genDemandAmount, setGenDemandAmount] = useState('');
  const [genCourtLocation, setGenCourtLocation] = useState(profile.defaultCourtLocation || 'Toronto');
  const [genProcedure, setGenProcedure] = useState('simplified');
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
  const templateInputRef = useRef<HTMLInputElement>(null);

  const handleNav = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  // Extract sessionId from hash
  const rawSid = window.location.hash.match(/#\/matter-detail\/(.+)/)?.[1] ?? null;
  const sessionId = rawSid?.replace(/\s+/g, '') ?? null;

  // Wire hook data
  const { matter, loading, error } = useMatterDetail(sessionId);
  const employment = useEmploymentData(sessionId);

  // Sync lawyer notes from the server once loaded (demo text remains the
  // fallback until real data arrives)
  useEffect(() => {
    if (employment.lawyerNotes !== null && employment.lawyerNotes !== '') {
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


  // Docs tab: handle file selection → parse → Claude extraction
  const handleExtractFile = useCallback(async (file: File) => {
    setExtracting(true);
    setExtractError(null);
    setLastExtraction(null);
    const result = await employment.extractDocument(file, uploadKind);
    setExtracting(false);
    if (result.ok && result.extraction) {
      setLastExtraction(result.extraction);
    } else {
      setExtractError(result.error ?? 'Extraction failed.');
    }
  }, [employment, uploadKind]);

  // Firm template upload for the selected draft type
  const TEMPLATE_DOC_TYPES: Record<string, string> = {
    demand: 'demand_letter',
    soc: 'statement_of_claim',
    mediation: 'mediation_brief',
  };
  const selectedTemplateDocType = selectedDraft ? TEMPLATE_DOC_TYPES[selectedDraft] : undefined;
  const currentTemplate = selectedTemplateDocType
    ? firmTemplates.templates.find(t => t.documentType === selectedTemplateDocType)
    : undefined;

  const handleTemplateUpload = useCallback(async (file: File) => {
    if (!selectedTemplateDocType) return;
    setTemplateStatus('Uploading...');
    const result = await firmTemplates.upload(file, selectedTemplateDocType);
    setTemplateStatus(result.ok
      ? `Template saved — ${result.placeholders?.length ?? 0} placeholder${(result.placeholders?.length ?? 0) === 1 ? '' : 's'} detected. Used for all matters.`
      : result.error ?? 'Upload failed.');
  }, [firmTemplates, selectedTemplateDocType]);

  // Compute tab badge counts from hook data
  const issueCount = matter?.issues.length ?? 0;
  const docCount = matter?.documents.length ?? 0;
  const dynamicTabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'issues', label: 'Issues Found', badge: issueCount || undefined },
    { key: 'docs', label: 'Documents', badge: docCount || undefined },
    { key: 'draft', label: 'Draft' },
    { key: 'timeline', label: 'Timeline' },
    { key: 'notes', label: 'Notes' },
  ];

  // Loading state
  if (loading) {
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
                <span style={{ fontSize: 12.5, color: muted, marginLeft: 4, fontFamily: sans, fontWeight: 400 }}>
                  Matter {matter!.number}
                </span>
              </h1>
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
            <FactItem label="Client" value={matter!.client} />
            <FactItem label="Employer" value={matter!.employer} />
            {matter!.dates.termination && <FactItem label="Terminated" value={matter!.dates.termination} />}
            {matter!.dates.start && <FactItem label="Start date" value={matter!.dates.start} />}
            {matter!.dates.limitation && <FactItem label="Limitation" value={matter!.dates.limitation} isLast />}
            {!matter!.dates.limitation && !matter!.dates.start && <FactItem label="" value="" isLast />}
          </div>

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
                  are included in generated documents */}
              {triggeredGates.length > 0 && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginBottom: 18 }}>
                  <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                    Approve issues for drafting
                  </div>
                  <div style={{ fontSize: 12.5, color: muted, marginBottom: 14 }}>
                    Only approved issues are included in demand letters, pleadings, and applications. Your call — Starling drafts nothing you haven't approved.
                  </div>
                  {triggeredGates.map(gate => {
                    const decision = gateDecision(gate);
                    return (
                      <div
                        key={gate.gate}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
                          borderTop: `1px solid ${border}`, flexWrap: 'wrap',
                        }}
                      >
                        <StatusDot colour={decision === 'approved' ? green : decision === 'dismissed' ? muted : amber} size={8} />
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>
                            {gate.reason.replace(/\.$/, '')}
                            {gate.requiresLawyerReview && (
                              <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: amber, background: '#fdf0dd', padding: '2px 7px', borderRadius: 2 }}>
                                REVIEW REQUIRED
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: muted }}>
                            Gate {gate.gate} · {gate.issueCodes.map(c => c.replace(/_/g, ' ')).join(', ')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setGateDecision(gate, 'approve')}
                            style={{
                              fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                              background: decision === 'approved' ? green : '#fff',
                              color: decision === 'approved' ? '#fff' : green,
                              border: `1px solid ${green}`,
                            }}
                            aria-pressed={decision === 'approved'}
                          >
                            {decision === 'approved' ? 'Approved' : 'Approve'}
                          </button>
                          <button
                            onClick={() => setGateDecision(gate, 'dismiss')}
                            style={{
                              fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                              background: decision === 'dismissed' ? muted : '#fff',
                              color: decision === 'dismissed' ? '#fff' : muted,
                              border: `1px solid ${muted}`,
                            }}
                            aria-pressed={decision === 'dismissed'}
                          >
                            {decision === 'dismissed' ? 'Dismissed' : 'Dismiss'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {structuralGates.length > 0 && (
                    <div style={{ borderTop: `1px solid ${border}`, paddingTop: 10, fontSize: 12, color: muted }}>
                      Also applied automatically:{' '}
                      {structuralGates.map(g => g.reason.replace(/\.$/, '')).join(' · ')}
                    </div>
                  )}
                </div>
              )}

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
                    <DocRow key={doc.id} doc={{ ...doc, actions: [{ label: 'View', variant: 'default' }] }} />
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
                    <DocRow key={doc.id} doc={{ ...doc, actions: [{ label: 'Open', variant: 'gen' }] }} />
                  ))}
                </>
              )}

              {matter!.documents.length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>No documents yet.</div>
              )}

              {/* Upload & extract */}
              <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginTop: 16 }}>
                <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
                  Upload a document — Starling extracts the facts
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
                    {extracting ? 'Extracting facts...' : '+ Upload & extract'}
                  </button>
                </div>
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
                      Review these facts before relying on them — extraction is a starting point, not a finding.
                    </div>
                  </div>
                )}
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

              {/* Firm template for the selected document type */}
              {selectedTemplateDocType && (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>
                      Firm template
                      {currentTemplate && (
                        <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: green, background: '#e7f6ec', padding: '2px 7px', borderRadius: 2 }}>
                          ACTIVE — {currentTemplate.name}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: muted }}>
                      {currentTemplate
                        ? 'Downloads use your firm’s letterhead and formatting for every matter.'
                        : 'Upload your firm’s DOCX template with {{PLACEHOLDER}} markers — it becomes the default for this document type on all matters.'}
                    </div>
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
                      if (file) handleTemplateUpload(file);
                      if (templateInputRef.current) templateInputRef.current.value = '';
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => templateInputRef.current?.click()}
                      style={{
                        background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600,
                        padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
                      }}
                    >
                      {currentTemplate ? 'Replace template' : 'Upload template'}
                    </button>
                    {currentTemplate && (
                      <button
                        onClick={async () => {
                          const result = await firmTemplates.remove(selectedTemplateDocType);
                          setTemplateStatus(result.ok ? 'Template removed — downloads use Starling default formatting.' : result.error ?? 'Failed to remove.');
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 8 }}>
                {DEMO_DRAFT_TYPES.map(dt => (
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
              {/* Generation options */}
              {selectedDraft && !generatedHtml && (
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

              {selectedDraft && !generatedHtml && (
                <button
                  onClick={async () => {
                    setGenerating(true);
                    setGenError(null);
                    const amount = parseInt(genDemandAmount) || 100000;
                    const result = await employment.generateDocument(
                      selectedDraft === 'demand' ? 'demand_letter'
                        : selectedDraft === 'soc' ? 'statement_of_claim'
                        : selectedDraft === 'mediation' ? 'mediation_brief'
                        : 'demand_letter',
                      {
                        tone: genTone,
                        demandAmount: amount,
                        claimAmount: amount,
                        procedureType: genProcedure,
                        lawyerName: profile.displayName || 'Lawyer Name',
                        firmName: profile.firmName || 'Firm Name',
                        courtLocation: genCourtLocation,
                        responseDeadlineDays: 14,
                      },
                    );
                    setGenerating(false);
                    if (result.ok && result.html) {
                      setGeneratedHtml(result.html);
                      setGenCitations(result.citations ?? []);
                      setGenReviewFlags(result.reviewFlags ?? []);
                    } else {
                      setGenError(result.error ?? 'Generation failed. Check that at least one legal issue is approved.');
                    }
                  }}
                  disabled={generating || !genDemandAmount}
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
                        Regenerate
                      </button>
                      <a
                        href={`/api/employment/${sessionId}/download/${selectedDraft === 'demand' ? 'demand-letter' : selectedDraft === 'soc' ? 'statement-of-claim' : 'mediation-brief'}`}
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
                  <div
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
                              <div style={{ fontSize: 11.5, color: muted }}>{c.sourceType} — {c.trustLevel} trust</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Timeline */}
          {activeTab === 'timeline' && (
            <div id="panel-timeline" role="tabpanel" style={{ paddingTop: 22 }}>
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
                    <div style={{ fontSize: 14, color: ink, fontWeight: 600 }}>{ev.title}</div>
                    <div style={{ fontSize: 13, color: muted }}>{ev.subtitle}</div>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

          {/* Notes */}
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
                Private to you — not processed by AI, not included in any deliverable.
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
                  <span style={{ fontSize: 13, color: '#dc2626' }} role="alert">Could not save — try again.</span>
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
            onClick={() => handleNav('#/processing')}
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
            Draft Statement of Claim
          </button>
          <ActionButton label="Open Demand Letter" onClick={() => handleNav(`#/results/${sessionId ?? ''}`)} />
          <ActionButton label="Upload More Docs" />
          <ActionButton label="Run Case Assessment" />
          <ActionButton label="Analyse Settlement Offer" />
          <ActionButton label="Export Summary" />
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
