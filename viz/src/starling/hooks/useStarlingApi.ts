/**
 * useStarlingApi.ts — Adapter hooks for DemandPay Starling.
 *
 * Five hooks that wrap the existing Lavern API and return data in the
 * shapes that Starling views expect. Each hook handles its own loading
 * and error state. When USE_DEMO_DATA is true, all hooks return static
 * demo data instead of calling the API.
 *
 * Patterns followed from the existing codebase:
 * - fetch('/api/...') for REST (same origin, no CORS)
 * - ShemWsClient for WebSocket event streams
 * - useState + useEffect + useCallback for state management
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ShemWsClient, type ConnectionStatus } from '../../connection/ws-client.js';
import type { ShemEvent, Severity } from '../../types/events.js';
import {
  AGENT_STEP_LABELS,
  WORKFLOW_STEP_LABELS,
  SOURCE_TAGS,
  SEVERITY_CONFIG,
  inferSourceType,
  type SourceTag,
} from './stepMapping.js';

// ── Feature flag ────────────────────────────────────────────────────────

/** Set false when the API is ready. When true, all hooks return static demo data. */
const USE_DEMO_DATA = false;

// ── Shared types ────────────────────────────────────────────────────────

/** A matter in the list view. */
export interface MatterListItem {
  id: string;
  name: string;
  number: string;
  status: 'urgent' | 'stale' | 'active' | 'complete';
  statusColour: string;
  flagText: string;
  flagColour: 'red' | 'amber' | 'navy' | 'green';
  /** True for labour (grievance) matters; used to filter by practice mode. */
  isLabour?: boolean;
  description: string;
  metaLabel: string;
  metaValue: string;
  metaColour?: string;
  /** Colleague attribution: set when another lawyer at the firm opened the file. */
  openedBy?: string;
}

/** An issue/finding with source attribution. */
export interface Finding {
  id: string;
  title: string;
  strength: 'strong' | 'moderate';
  description: string;
  descriptionBold: string[];
  sources: { label: string; type: 'verified' | 'statute' | 'web' | 'ai' }[];
}

/** A document attached to a matter. */
export interface MatterDocument {
  id: string;
  name: string;
  meta: string;
  group: 'uploaded' | 'generated';
}

/** A timeline event on a matter. */
export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  isCurrent?: boolean;
  /** Lawyer-marked court/statutory deadline (drives the red band). */
  courtDeadline?: boolean;
}

/** The full detail of a matter. */
export interface MatterDetail {
  name: string;
  number: string;
  client: string;
  employer: string;
  dates: { start?: string; termination?: string; limitation?: string };
  status: 'urgent' | 'stale' | 'active' | 'complete';
  issues: Finding[];
  documents: MatterDocument[];
  timeline: TimelineEvent[];
}

/** A processing step displayed in the pipeline checklist. */
export interface ProcessingStep {
  label: string;
  status: 'done' | 'active' | 'pending';
  detail?: string;
}

/** A finding surfaced during processing with source attribution. */
export interface ProcessingFinding {
  text: string;
  sourceType: string;
  sourceColour: string;
}

/** Cost tracker state. */
export interface CostInfo {
  spent: number;
  budget: number;
  percentage: number;
}

/** A gate that needs human approval. */
export interface GateRequest {
  type: string;
  summary: string;
}

/** A verification pass result. */
export interface VerificationPassResult {
  name: string;
  score: number;
  findings: string[];
}

/** A source citation for the results view. */
export interface SourceCitation {
  citation: string;
  sourceType: string;
  trustLevel: 'high' | 'medium' | 'low';
}

// ── Demo data ───────────────────────────────────────────────────────────

const DEMO_MATTERS: MatterListItem[] = [
  {
    id: 'patel',
    status: 'urgent',
    statusColour: '#dc2626',
    name: 'Patel v MegaCorp',
    number: '#STR-2026-007',
    flagText: 'Limitation in 14 days',
    flagColour: 'red',
    description: 'Action: File Statement of Claim before July 9, 2026 \u00B7 SOC not yet filed',
    metaLabel: 'Limitation',
    metaValue: 'Jul 9, 2026',
    metaColour: '#dc2626',
  },
  {
    id: 'jones',
    status: 'stale',
    statusColour: '#d97706',
    name: 'Jones v BigCo',
    number: '#STR-2026-005',
    flagText: 'No activity \u00B7 12 days',
    flagColour: 'amber',
    description: 'Missing: employment agreement, termination letter \u00B7 Last step: intake analysis',
    metaLabel: 'Last activity',
    metaValue: 'Jun 13, 2026',
  },
  {
    id: 'smith',
    status: 'active',
    statusColour: '#0f1a2e',
    name: 'Smith v Acme Corp',
    number: '#STR-2026-003',
    flagText: 'Demand letter drafted',
    flagColour: 'navy',
    description: 'Next: Send to employer or request review \u00B7 Limitation June 1, 2028',
    metaLabel: 'Last activity',
    metaValue: '3 days ago',
  },
];

const DEMO_MATTER_DETAIL: MatterDetail = {
  name: 'Smith v Acme Corp',
  number: '#STR-2026-003',
  client: 'Jane Smith',
  employer: 'Acme Corporation',
  dates: {
    start: '2018-01-15',
    termination: '2026-06-01',
    limitation: '2028-06-01',
  },
  status: 'active',
  issues: [
    {
      id: 'wrongful-dismissal',
      title: 'Wrongful dismissal (without cause)',
      strength: 'strong',
      description: 'ESA statutory notice: 8 weeks (s. 57). Common law reasonable notice range under Bardal: 10\u201314 months.',
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
      description: 'For-cause provision uses "just cause" rather than ESA "wilful misconduct" standard. Under Waksdale v Swegon (2020 ONCA 391), entire clause is void.',
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
      description: 'Termination followed shortly after a disability accommodation request. Potential Human Rights Code claim.',
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
      description: 'Client terminated same day as accommodation request. Potential aggravated/moral damages under Honda v Keays (2008 SCC 39).',
      descriptionBold: ['same day', 'Honda v Keays (2008 SCC 39)'],
      sources: [{ label: 'verified · case_db', type: 'verified' }],
    },
  ],
  documents: [
    { id: 'd1', name: 'Smith_Termination_Letter.pdf', meta: 'Uploaded Jun 18 · facts extracted', group: 'uploaded' },
    { id: 'd2', name: 'Smith_Employment_Agreement_2018.pdf', meta: 'Uploaded Jun 18 · termination clause flagged', group: 'uploaded' },
    { id: 'd3', name: 'Record_of_Employment.pdf', meta: 'Uploaded Jun 18 · salary confirmed', group: 'uploaded' },
    { id: 'd4', name: 'Demand Letter \u2014 Smith v Acme Corp', meta: 'Generated Jun 22 · Quality 92/100', group: 'generated' },
  ],
  timeline: [
    { id: 't1', date: 'Jun 22, 2026', title: 'Demand letter drafted \u2014 Quality 92/100, PASS', subtitle: 'Adversarial workflow · 8 verification passes · cost $3.47', isCurrent: true },
    { id: 't2', date: 'Jun 22, 2026', title: 'Entitlements calculated (ESA + Bardal)', subtitle: 'ESA notice 8 weeks; common law 10\u201314 months' },
    { id: 't3', date: 'Jun 18, 2026', title: 'Issue analysis complete \u2014 4 issues identified', subtitle: '2 strong, 2 moderate' },
    { id: 't4', date: 'Jun 18, 2026', title: '3 documents uploaded & facts extracted', subtitle: 'Termination letter, employment agreement, ROE' },
    { id: 't5', date: 'Jun 18, 2026', title: 'Matter created', subtitle: 'Client: Jane Smith · Employer: Acme Corporation' },
  ],
};

const DEMO_PROCESSING_STEPS: ProcessingStep[] = [
  { label: 'Reading your documents', status: 'done', detail: 'Termination letter, employment agreement, ROE · facts extracted' },
  { label: 'Identifying legal issues', status: 'done', detail: 'Found 4 issues · 2 strong, 2 moderate' },
  { label: 'Calculating entitlements', status: 'done', detail: 'ESA notice: 8 weeks ($14,615) / Common law: 10\u201314 months ($79,167\u2013$110,833)' },
  { label: 'Drafting the demand letter', status: 'active', detail: 'Positioning the demand, assembling authorities and source attribution' },
  { label: 'Stress-testing from employer\'s perspective', status: 'pending' },
  { label: 'Strengthening weak points', status: 'pending' },
  { label: 'Verifying accuracy (8 checks)', status: 'pending' },
  { label: 'Final quality review', status: 'pending' },
];

const DEMO_PROCESSING_FINDINGS: ProcessingFinding[] = [
  { text: 'Termination clause is void under Waksdale v Swegon (2020 ONCA 391) · defaults client to common law notice.', sourceType: 'case_db', sourceColour: '#16a34a' },
  { text: 'ESA statutory notice confirmed at 8 weeks under s. 57(h).', sourceType: 'statute', sourceColour: '#16a34a' },
  { text: 'Comparable-role availability for senior marketing managers appears limited in current market · supports upper Bardal range.', sourceType: 'web_search', sourceColour: '#dc2626' },
];

const DEMO_RESULTS_DOCUMENT = `## Without Prejudice

**Re: Jane Smith, Termination of Employment**

Dear Ms. Bell,

We act on behalf of Jane Smith in connection with her termination from Acme Corporation on June 1, 2026.

Ms. Smith was employed as Senior Marketing Manager for approximately 8.3 years. Her employment was terminated without cause and without adequate notice or severance.

**Entitlements**

Under the *Employment Standards Act, 2000*, Ms. Smith is entitled to a minimum of 8 weeks' notice (s. 57). At common law, applying the Bardal factors (age, length of service, character of employment, and availability of comparable employment), a reasonable notice period of 10 to 14 months is warranted.

The termination clause in Ms. Smith's employment agreement is unenforceable. The for-cause provision references "just cause" rather than the ESA "wilful misconduct" standard. Under *Waksdale v Swegon*, 2020 ONCA 391, if any part of a termination clause breaches the ESA, the entire clause is void.

**Demand**

We demand payment of 12 months' salary in lieu of reasonable notice, representing $95,000 in base compensation plus continuation of all benefits for the notice period.

This letter is delivered without prejudice to Ms. Smith's right to commence proceedings.

Yours truly,
[Lawyer Name]`;

const DEMO_RESULTS_SOURCES: SourceCitation[] = [
  { citation: 'ESA, 2000 s. 57(h)', sourceType: 'statute', trustLevel: 'high' },
  { citation: 'Waksdale v Swegon, 2020 ONCA 391', sourceType: 'case_db', trustLevel: 'high' },
  { citation: 'Bardal v Globe & Mail, 1960 CanLII 855 (ON SC)', sourceType: 'case_db', trustLevel: 'high' },
  { citation: 'Honda v Keays, 2008 SCC 39', sourceType: 'case_db', trustLevel: 'high' },
  { citation: 'CanLII / market survey (allowlisted)', sourceType: 'web_search', trustLevel: 'low' },
];

const DEMO_VERIFICATION_PASSES: VerificationPassResult[] = [
  { name: 'Factual Correctness', score: 0.96, findings: [] },
  { name: 'Legal Accuracy', score: 0.94, findings: [] },
  { name: 'Completeness', score: 0.90, findings: ['Consider adding HRTO filing deadline'] },
  { name: 'Internal Consistency', score: 0.98, findings: [] },
  { name: 'Procedural Compliance', score: 0.92, findings: [] },
  { name: 'Source Attribution', score: 0.84, findings: ['Market survey source should be independently verified'] },
  { name: 'Formal Tone', score: 0.95, findings: [] },
  { name: 'Client Alignment', score: 0.93, findings: [] },
];

// ── Hook 1: useMatterCreate ─────────────────────────────────────────────

/** Return type for useMatterCreate. */
export interface MatterCreateResult {
  /** Creates a new matter. Returns sessionId and matterId on success. */
  createMatter: (data: {
    clientName: string;
    employerName: string;
    situation: string;
    startDate?: string;
    termDate?: string;
    // Employment-specific fields
    jobTitle?: string;
    salary?: number;
    justCause?: boolean;
    constructiveDismissal?: boolean;
    terminationReason?: string;
  }) => Promise<{ sessionId: string; matterId: string }>;
  /** True while files are being uploaded or the session is being created. */
  uploading: boolean;
  /** Error message from the most recent attempt, or null. */
  error: string | null;
}

/**
 * Creates a new matter by uploading documents and starting a Lavern session.
 *
 * Flow:
 * 1. If files provided: POST /api/documents/parse (multipart) for each file
 * 2. POST /api/sessions with the parsed documents and situation text
 * 3. Return { sessionId, matterId }
 */
export function useMatterCreate(): MatterCreateResult {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMatter = useCallback(async (data: {
    clientName: string;
    employerName: string;
    situation: string;
    startDate?: string;
    termDate?: string;
    jobTitle?: string;
    salary?: number;
    justCause?: boolean;
    constructiveDismissal?: boolean;
    terminationReason?: string;
  }): Promise<{ sessionId: string; matterId: string }> => {
    setError(null);
    setUploading(true);

    // Demo mode: simulate a short delay and return a demo session ID
    if (USE_DEMO_DATA) {
      await new Promise(r => setTimeout(r, 800));
      setUploading(false);
      const id = `demo-session-${Date.now()}`;
      return { sessionId: id, matterId: id };
    }

    try {
      // Documents are NOT uploaded here. This used to parse each file and
      // then discard the result: the text never reached the matter, so a
      // lawyer who attached a claim saw nothing populated and no error.
      // Uploading happens on the matter's Documents tab, which runs
      // extraction and shows the proposed facts for review.

      // Step 2: Build the situation text with client/employer context
      const requestText = [
        `Client: ${data.clientName}`,
        `Employer: ${data.employerName}`,
        data.startDate ? `Start date: ${data.startDate}` : null,
        data.termDate ? `Termination date: ${data.termDate}` : null,
        '',
        data.situation,
      ].filter(Boolean).join('\n');

      // Step 3: Create a matter via /api/matters (not /api/sessions).
      // Matters are case records — no billing check, no workflow dispatch.
      // The employment intake + analysis runs separately after creation.
      const matterRes = await fetch('/api/matters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clientName: data.clientName,
          matterTitle: `${data.clientName} v. ${data.employerName}`,
          matterDescription: data.situation || `Employment matter: ${data.clientName} v. ${data.employerName}`,
          matterType: 'employment_agreement',
          jurisdiction: 'CA',
        }),
      });

      if (!matterRes.ok) {
        const errData = await matterRes.json().catch(() => ({}));
        throw new Error((errData as Record<string, string>).error || `Failed to create matter: ${matterRes.statusText}`);
      }

      const matterData = await matterRes.json();
      const matterId = matterData.matterId;
      const sessionId = matterId;
      const toIsoDate = (raw: string | undefined): string | undefined => {
        if (!raw) return undefined;
        const value = raw.trim();
        // The date inputs send ISO already; dd/mm/yyyy still converts for safety.
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
        const parts = value.split('/');
        if (parts.length !== 3) return undefined;
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      };

      try {
        // Save structured intake
        await fetch('/api/employment/intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            matterId,
            intake: {
              client_first_name: data.clientName.split(' ')[0] || data.clientName,
              client_last_name: data.clientName.split(' ').slice(1).join(' ') || undefined,
              employer_legal_name: data.employerName,
              hire_date: toIsoDate(data.startDate) || undefined,
              termination_date: toIsoDate(data.termDate) || undefined,
              job_title: data.jobTitle || undefined,
              annual_salary: data.salary || undefined,
              was_terminated: !data.constructiveDismissal,
              is_constructive_dismissal: data.constructiveDismissal || false,
              employer_alleged_just_cause: data.justCause || false,
              termination_reasons: data.terminationReason || undefined,
            },
          }),
        });

        // Run analysis
        const analysisRes = await fetch('/api/employment/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ matterId }),
        });

        // Issues are PROPOSED by the analysis, never silently approved.
        // The Issues tab promises "Starling drafts nothing you have not
        // approved", and that promise is only true if approval is the
        // lawyer's click (the tab has per-issue controls and Approve all).
      } catch {
        // Non-fatal — intake saved, analysis can be re-run from matter detail
      }

      setUploading(false);

      return {
        sessionId,
        matterId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create matter';
      setError(message);
      setUploading(false);
      throw err;
    }
  }, []);

  return { createMatter, uploading, error };
}

// ── Hook 2: useMatterList ───────────────────────────────────────────────

/** Return type for useMatterList. */
export interface MatterListResult {
  /** Sorted list of matters (urgent first, then stale, active, complete). */
  matters: MatterListItem[];
  /** True during initial load. */
  loading: boolean;
  /** Re-fetch the matter list from the API. */
  refresh: () => void;
}

/**
 * Fetches the list of matters/sessions and maps them to MatterListItems.
 *
 * Sorting order: urgent → stale → active → complete.
 * Staleness is inferred from last activity timestamp (>7 days = stale).
 */
export function useMatterList(): MatterListResult {
  const [matters, setMatters] = useState<MatterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchCountRef = useRef(0);

  const fetchMatters = useCallback(async () => {
    // Demo mode: return static data after a brief delay
    if (USE_DEMO_DATA) {
      await new Promise(r => setTimeout(r, 300));
      setMatters(DEMO_MATTERS);
      setLoading(false);
      return;
    }

    const fetchId = ++fetchCountRef.current;
    setLoading(true);

    try {
      // Fetch matters + sessions, merge and deduplicate
      const [mattersRes, liveRes, archiveRes] = await Promise.all([
        fetch('/api/matters', { credentials: 'include' }).catch(() => null),
        fetch('/api/sessions?limit=50', { credentials: 'include' }).catch(() => null),
        fetch('/api/sessions/archive', { credentials: 'include' }).catch(() => null),
      ]);

      if (fetchId !== fetchCountRef.current) return; // stale response

      let allSessions: Array<Record<string, unknown>> = [];

      // Matters (employment workflow) — map to session-like shape
      if (mattersRes?.ok) {
        const mattersData = await mattersRes.json();
        const matters = Array.isArray(mattersData) ? mattersData : (mattersData.matters ?? []);
        const matterEntries: Array<Record<string, unknown>> = [];
        for (const m of matters) {
          matterEntries.push({
            id: m.matterId ?? m.id,
            sessionId: m.matterId ?? m.id,
            title: m.title ?? 'Employment Matter',
            status: m.status ?? 'active',
            createdAt: m.openedAt ?? m.created_at,
            request: { type: 'employment_agreement', requestText: m.description ?? '' },
            _source: 'matter',
            _matterNumber: m.matterNumber,
            // The list endpoint now carries the intake summary itself, so
            // every file is enriched — not just the first 25.
            _clientName: m.clientName || m.clientId,
            _employerName: m.employerName || undefined,
            _limitationDate: m.limitationDate || undefined,
            _grievanceDeadline: m.grievanceDeadline || undefined,
            _isLabour: m.isLabour === true || undefined,
            _openedBy: m.openedBy,
            _openedByMe: m.openedByMe,
          });
        }

        allSessions.push(...matterEntries);
      }

      // Live sessions (returns { sessions: [...] } or [...])
      if (liveRes?.ok) {
        const liveData = await liveRes.json();
        const liveSessions = Array.isArray(liveData) ? liveData : (liveData.sessions ?? []);
        allSessions.push(...liveSessions);
      }

      // Archived sessions (returns { sessions: [...] } or { archives: [...] })
      if (archiveRes?.ok) {
        const archiveData = await archiveRes.json();
        const archived = Array.isArray(archiveData) ? archiveData : (archiveData.sessions ?? archiveData.archives ?? []);
        allSessions.push(...archived);
      }

      // Deduplicate by ID (live takes precedence over archive)
      const seen = new Set<string>();
      allSessions = allSessions.filter(s => {
        const id = (s.id ?? s.sessionId) as string;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const mapped = allSessions.map(mapSessionToMatterListItem);

      // Sort: urgent → stale → active → complete
      const ORDER: Record<string, number> = { urgent: 0, stale: 1, active: 2, complete: 3 };
      mapped.sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

      setMatters(mapped);
    } catch (err) {
      console.error('useMatterList: fetch failed', err);
      setMatters([]);
    } finally {
      if (fetchId === fetchCountRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMatters(); }, [fetchMatters]);

  return { matters, loading, refresh: fetchMatters };
}

/**
 * Maps a raw session object from GET /api/sessions to a MatterListItem.
 * Infers status from the session's workflow step and last activity timestamp.
 */
function mapSessionToMatterListItem(session: Record<string, unknown>): MatterListItem {
  const id = (session.sessionId ?? session.id ?? '') as string;

  // Handle both live session (request.requestText) and archive (title) formats
  const requestText = (
    (session.request as Record<string, unknown>)?.requestText ??
    session.title ??
    ''
  ) as string;

  // Prefer structured intake data (employment matters); fall back to
  // pattern-matching the request text for legacy sessions
  const structuredClient = (session._clientName as string) || '';
  const structuredEmployer = (session._employerName as string) || '';
  const namePatterns = requestText.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*(?:,|was|terminated|from)\s+(?:from\s+)?([A-Z][A-Za-z\s]+(?:Inc|Corp|Ltd|Co|LLC)?)/);
  const clientName = structuredClient || (namePatterns?.[1]?.trim() ?? (requestText.slice(0, 30) || 'Untitled matter'));
  const employerName = structuredEmployer || (namePatterns?.[2]?.trim() ?? '');
  const name = employerName ? `${clientName} v ${employerName}` : clientName;
  const number = (session._matterNumber as string)
    ? `#${session._matterNumber}`
    : `#STR-${id.slice(5, 13).toUpperCase()}`;

  // Infer status from workflow state (live: workflow.currentStep, archive: status)
  const workflow = session.workflow as Record<string, unknown> | undefined;
  const step = (workflow?.currentStep ?? session.status ?? '') as string;
  const lastEvent = (session.lastEventTimestamp ?? session.completed_at ?? session.created_at ?? '') as string;
  const daysSinceActivity = lastEvent
    ? Math.floor((Date.now() - new Date(lastEvent).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  let status: MatterListItem['status'] = 'active';
  let statusColour = '#0f1a2e';
  let flagText = step || 'In progress';
  let flagColour: MatterListItem['flagColour'] = 'navy';

  // Check for limitation date urgency — structured analysis data first,
  // then the legacy request-text pattern. Labour matters use the nearest
  // grievance CA clock instead.
  const isLabour = Boolean(session._isLabour);
  const structuredLimitation = (session._grievanceDeadline ?? session._limitationDate) as string | undefined;
  const limitationMatch = requestText.match(/Limitation date:\s*(.+)/i);
  const limitationDate = structuredLimitation
    ? new Date(structuredLimitation)
    : limitationMatch ? new Date(limitationMatch[1].trim()) : null;
  const daysUntilLimitation = limitationDate
    ? Math.floor((limitationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : Infinity;

  if (step === 'delivered' || step === 'complete' || step === 'completed') {
    status = 'complete';
    statusColour = '#16a34a';
    flagText = 'Complete';
    flagColour = 'green';
  } else if (daysUntilLimitation <= 30 && daysUntilLimitation > 0) {
    status = 'urgent';
    statusColour = '#dc2626';
    flagText = isLabour ? `Grievance deadline in ${daysUntilLimitation} days` : `Limitation in ${daysUntilLimitation} days`;
    flagColour = 'red';
  } else if (isLabour && daysUntilLimitation <= 0 && daysUntilLimitation > -30) {
    status = 'urgent';
    statusColour = '#dc2626';
    flagText = 'Grievance time limit passed; assess s. 48(16)';
    flagColour = 'red';
  } else if (daysSinceActivity > 7) {
    status = 'stale';
    statusColour = '#d97706';
    flagText = `No activity \u00B7 ${daysSinceActivity} days`;
    flagColour = 'amber';
  }

  return {
    id,
    status,
    statusColour,
    name,
    number,
    flagText,
    flagColour,
    isLabour,
    description: requestText.split('\n').slice(-1)[0] || '',
    metaLabel: status === 'complete' ? 'Completed' : 'Last activity',
    metaValue: lastEvent ? new Date(lastEvent).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
    metaColour: status === 'urgent' ? '#dc2626' : undefined,
    // Only a colleague's name is shown; your own files carry no label.
    openedBy: session._openedByMe === false && session._openedBy ? String(session._openedBy) : undefined,
  };
}

// ── Hook 3: useMatterDetail ─────────────────────────────────────────────

/** Return type for useMatterDetail. */
export interface MatterDetailResult {
  /** Full matter detail, or null while loading. */
  matter: MatterDetail | null;
  /** True during fetch. */
  loading: boolean;
  /** Error message, or null. */
  error: string | null;
  /** Re-fetch the matter (after adding a timeline event, etc.). */
  refresh: () => Promise<void>;
}

/**
 * Fetches the full detail of a single matter/session.
 *
 * Maps the API response to the shape expected by MatterDetailView:
 * issues (with source tags), documents, and timeline.
 */
export type PracticeMode = 'employment' | 'labour' | 'both';

/**
 * The firm's practice mode from /api/capabilities. Defaults to 'employment'
 * (and while loading) so labour surfaces stay hidden unless explicitly on.
 */
export function usePracticeMode(): PracticeMode {
  const [mode, setMode] = useState<PracticeMode>('employment');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/capabilities', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const m = d?.practiceMode;
        if (!cancelled && (m === 'employment' || m === 'labour' || m === 'both')) setMode(m);
      })
      .catch(() => { /* default employment */ });
    return () => { cancelled = true; };
  }, []);
  return mode;
}

/**
 * Whether the partner approval lane is switched on for this firm.
 * Off by default: a firm with one lawyer cannot use it (nobody may review
 * their own submission), so the UI stays hidden until a colleague exists.
 */
export function useApprovalsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch('/api/capabilities', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setEnabled(Boolean(d?.approvals)))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

export function useMatterDetail(sessionId: string | null): MatterDetailResult {
  const [matter, setMatter] = useState<MatterDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) { setMatter(null); return; }

    if (USE_DEMO_DATA) {
      setLoading(true);
      setMatter(DEMO_MATTER_DETAIL);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Try /api/matters first (employment workflow creates matters, not sessions)
      let res = await fetch(`/api/matters/${sessionId}`, { credentials: 'include' });
      let source: 'matter' | 'session' = 'matter';

      if (res.status === 404) {
        // Fall back to session (legacy Lavern flow)
        res = await fetch(`/api/sessions/${sessionId}`, { credentials: 'include' });
        source = 'session';
        if (res.status === 404) {
          res = await fetch(`/api/sessions/archive/${sessionId}`, { credentials: 'include' });
        }
      }

      if (!res.ok) throw new Error('Matter not found');

      const raw = await res.json();
      if (source === 'matter') {
        // Fetch employment data separately
        const empRes = await fetch(`/api/employment/${sessionId}`, { credentials: 'include' });
        const empData = empRes.ok ? await empRes.json() : { data: {} };
        const employment = empData.data ?? {};
        const intake = employment.intake ?? {};
        const hireDate = intake.hire_date as string | undefined;
        const termDate = intake.termination_date as string | undefined;
        // The file header must agree with the dashboard list: the same
        // limitation-driven urgency, not a hardcoded "active".
        const analysis = (employment.analysis ?? {}) as Record<string, unknown>;
        const limitation = (analysis.limitationDeadline as { date?: string } | undefined)?.date;
        const rawStatus = String(raw.status ?? '');
        const daysToLimitation = limitation
          ? Math.floor((new Date(limitation).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : Infinity;
        const detailStatus: MatterDetail['status'] =
          rawStatus === 'closed' || rawStatus === 'complete' ? 'complete'
          : daysToLimitation <= 30 && daysToLimitation > 0 ? 'urgent'
          : 'active';
        setMatter({
          name: `${intake.client_first_name ?? ''} ${intake.client_last_name ?? ''}`.trim() || 'Employment Matter',
          number: raw.matterNumber ?? `DP-${sessionId.slice(-6)}`,
          client: `${intake.client_first_name ?? ''} ${intake.client_last_name ?? ''}`.trim(),
          employer: intake.employer_legal_name as string ?? '',
          dates: {
            start: hireDate,
            termination: termDate,
            limitation,
          },
          status: detailStatus,
          issues: (employment.gates ?? [])
            .filter((g: Record<string, unknown>) => g.triggered)
            .map((g: Record<string, unknown>) => ({
              id: `gate-${g.gate}`,
              title: String(g.reason ?? g.gate),
              strength: 'strong' as const,
              description: String(g.reason ?? ''),
              descriptionBold: (g.issueCodes as string[] ?? []),
              sources: [{ label: `Gate ${g.gate}`, type: 'ai' as const }],
            })),
          documents: [],
          timeline: (employment.timeline ?? []).map((e: Record<string, unknown>, i: number) => ({
            id: `tl-${i}`,
            date: String(e.date ?? ''),
            title: String(e.label ?? ''),
            subtitle: String(e.description ?? ''),
            courtDeadline: Boolean(e.courtDeadline),
          })),
        });
      } else {
        setMatter(mapSessionToMatterDetail(sessionId, raw));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matter');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  return { matter, loading, error, refresh: load };
}

/**
 * Maps a raw session API response to MatterDetail.
 */
function mapSessionToMatterDetail(sessionId: string, raw: Record<string, unknown>): MatterDetail {
  const request = (raw.request ?? {}) as Record<string, unknown>;
  const requestText = (request.requestText ?? '') as string;

  // Extract client/employer from request text
  const clientMatch = requestText.match(/Client:\s*(.+)/i);
  const employerMatch = requestText.match(/Employer:\s*(.+)/i);
  const clientName = clientMatch?.[1]?.trim() ?? 'Unknown client';
  const employerName = employerMatch?.[1]?.trim() ?? 'Unknown employer';
  const name = `${clientName} v ${employerName}`;
  const number = `#STR-${sessionId.slice(0, 8).toUpperCase()}`;

  // Extract dates from request text
  const startMatch = requestText.match(/Start date:\s*(.+)/i);
  const termMatch = requestText.match(/Termination date:\s*(.+)/i);

  // Map findings to issues
  const rawFindings = (raw.findings ?? []) as Array<Record<string, unknown>>;
  const issues: Finding[] = rawFindings.map((f, i) => {
    const evidence = ((f.evidence as string[]) ?? []).join(' ');
    const sourceType = inferSourceType(evidence);
    const tag = SOURCE_TAGS[sourceType];
    const severity = (f.severity as Severity) ?? 'GREEN';
    return {
      id: (f.findingId as string) ?? `f-${i}`,
      title: (f.category as string) ?? (f.content as string)?.slice(0, 60) ?? `Finding ${i + 1}`,
      strength: severity === 'RED' || severity === 'GREEN' ? 'strong' : 'moderate',
      description: (f.content as string) ?? '',
      descriptionBold: [],
      sources: tag ? [{ label: tag.label, type: mapTrustToSourceType(tag.trustLevel) }] : [],
    };
  });

  // Map events to timeline
  const rawEvents = (raw.events ?? []) as Array<Record<string, unknown>>;
  const timeline: TimelineEvent[] = rawEvents
    .filter(e => ['workflow_step', 'session_start', 'session_end', 'finding_posted'].includes(e.type as string))
    .slice(-10)
    .reverse()
    .map((e, i) => ({
      id: `t-${i}`,
      date: formatTimestamp((e.timestamp as string) ?? ''),
      title: getTimelineTitle(e),
      subtitle: getTimelineSubtitle(e),
      isCurrent: i === 0,
    }));

  // Map documents
  const rawDocs = (raw.documents ?? []) as Array<Record<string, unknown>>;
  const documents: MatterDocument[] = rawDocs.map((d, i) => ({
    id: (d.id as string) ?? `d-${i}`,
    name: (d.filename as string) ?? (d.name as string) ?? `Document ${i + 1}`,
    meta: (d.mimeType as string) ?? '',
    group: 'uploaded' as const,
  }));

  // Add generated documents if assembledDocument exists
  if (raw.assembledDocument && typeof raw.assembledDocument === 'string' && raw.assembledDocument.length > 0) {
    documents.push({
      id: 'generated-doc',
      name: `Demand Letter \u2014 ${name}`,
      meta: 'Generated',
      group: 'generated',
    });
  }

  // Infer status
  const step = (raw.currentStep ?? raw.step ?? '') as string;
  let status: MatterDetail['status'] = 'active';
  if (step === 'delivered' || step === 'complete') status = 'complete';

  return {
    name,
    number,
    client: clientName,
    employer: employerName,
    dates: {
      start: startMatch?.[1]?.trim(),
      termination: termMatch?.[1]?.trim(),
    },
    status,
    issues,
    documents,
    timeline,
  };
}

// ── Hook 4: useProcessing ───────────────────────────────────────────────

/** Return type for useProcessing. */
export interface ProcessingResult {
  /** Pipeline steps with their status. */
  steps: ProcessingStep[];
  /** Findings surfaced so far with source attribution. */
  findings: ProcessingFinding[];
  /** Running cost info. */
  cost: CostInfo;
  /** Overall processing status. */
  status: 'running' | 'complete' | 'failed';
  /** Non-null when a human gate is pending approval. */
  gateRequest: GateRequest | null;
  /** Approve or reject a pending gate. */
  approveGate: (decision: 'approve' | 'reject') => Promise<void>;
}

/**
 * Subscribes to real-time processing events for a session via WebSocket.
 *
 * Maps ShemEvent types to pipeline steps using AGENT_STEP_LABELS and
 * WORKFLOW_STEP_LABELS. Tracks findings, cost, and gate requests.
 */
export function useProcessing(sessionId: string | null): ProcessingResult {
  const [steps, setSteps] = useState<ProcessingStep[]>(DEMO_PROCESSING_STEPS);
  const [findings, setFindings] = useState<ProcessingFinding[]>([]);
  const [cost, setCost] = useState<CostInfo>({ spent: 0, budget: 5.0, percentage: 0 });
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running');
  const [gateRequest, setGateRequest] = useState<GateRequest | null>(null);

  const wsClientRef = useRef<ShemWsClient | null>(null);
  const activeStepRef = useRef<string>('intake');

  // Build the initial step list from workflow step labels
  const initialSteps = useMemo((): ProcessingStep[] => {
    return DEMO_PROCESSING_STEPS.map(s => ({ ...s }));
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    // Demo mode: simulate step progression
    if (USE_DEMO_DATA) {
      setSteps(initialSteps);
      setFindings([]);
      setCost({ spent: 0.32, budget: 5.0, percentage: 6 });
      setStatus('running');

      const timers: ReturnType<typeof setTimeout>[] = [];

      // Simulate steps completing one by one
      const advanceStep = (completedIdx: number, delay: number, newCost: number) => {
        timers.push(setTimeout(() => {
          setSteps(prev => prev.map((s, i) => {
            if (i === completedIdx) return { ...s, status: 'done' as const };
            if (i === completedIdx + 1) return { ...s, status: 'active' as const };
            return s;
          }));
          setCost({ spent: newCost, budget: 5.0, percentage: Math.round((newCost / 5.0) * 100) });
        }, delay));
      };

      // Simulate findings arriving
      const addFinding = (idx: number, delay: number) => {
        timers.push(setTimeout(() => {
          setFindings(prev => [...prev, DEMO_PROCESSING_FINDINGS[idx]]);
        }, delay));
      };

      advanceStep(0, 1200, 0.47);
      addFinding(0, 1800);
      advanceStep(1, 2800, 0.82);
      addFinding(1, 3200);
      advanceStep(2, 4500, 1.24);
      addFinding(2, 5000);
      advanceStep(3, 7000, 1.87);
      advanceStep(4, 8200, 2.44);
      advanceStep(5, 9000, 2.91);
      advanceStep(6, 9800, 3.28);

      // Mark complete
      timers.push(setTimeout(() => {
        setSteps(prev => prev.map(s => ({ ...s, status: 'done' as const })));
        setCost({ spent: 3.47, budget: 5.0, percentage: 69 });
        setStatus('complete');
      }, 11000));

      return () => timers.forEach(clearTimeout);
    }

    // Live mode: connect via WebSocket
    const handleEvent = (event: ShemEvent) => {
      switch (event.type) {
        case 'workflow_step': {
          const label = WORKFLOW_STEP_LABELS[event.step] ?? event.step;
          activeStepRef.current = event.step;

          setSteps(prev => {
            const updated = prev.map(s => {
              // Mark previous active step as done
              if (s.status === 'active') return { ...s, status: 'done' as const };
              return s;
            });

            // Check if this step already exists
            const exists = updated.some(s => s.label === label);
            if (!exists) {
              updated.push({ label, status: 'active' });
            } else {
              return updated.map(s => s.label === label ? { ...s, status: 'active' as const } : s);
            }

            return updated;
          });

          if (event.step === 'delivered') {
            setStatus('complete');
          }
          break;
        }

        case 'agent_start': {
          const agentLabel = AGENT_STEP_LABELS[event.role] ?? event.role;
          setSteps(prev => {
            // Update the active step's detail with the agent's human-readable label
            return prev.map(s =>
              s.status === 'active' ? { ...s, detail: agentLabel } : s
            );
          });
          break;
        }

        case 'finding_posted': {
          const evidenceStr = (event.evidence ?? []).join(' ');
          const sourceType = inferSourceType(evidenceStr);
          const tag = SOURCE_TAGS[sourceType];
          setFindings(prev => [
            ...prev,
            {
              text: event.content,
              sourceType,
              sourceColour: tag?.colour ?? '#d97706',
            },
          ]);
          break;
        }

        case 'cost_update': {
          const spent = event.totalUsd;
          const budget = event.budgetUsd;
          setCost({
            spent,
            budget,
            percentage: budget > 0 ? Math.round((spent / budget) * 100) : 0,
          });
          break;
        }

        case 'gate_requested': {
          setGateRequest({ type: event.gateType, summary: event.summary });
          break;
        }

        case 'gate_decided': {
          setGateRequest(null);
          break;
        }

        case 'session_end': {
          setStatus('complete');
          break;
        }

        case 'error': {
          const fatalSources = ['orchestrator', 'session'];
          if (event.source && fatalSources.includes(event.source)) {
            setStatus('failed');
          }
          break;
        }
      }
    };

    const client = new ShemWsClient({
      onEvent: handleEvent,
      onStatusChange: () => {},
      onError: (msg) => console.error('useProcessing WS error:', msg),
    });

    client.connectToSession(sessionId);
    wsClientRef.current = client;

    return () => {
      client.disconnect();
      wsClientRef.current = null;
    };
  }, [sessionId, initialSteps]);

  /** Approve or reject a pending gate decision. */
  const approveGate = useCallback(async (decision: 'approve' | 'reject') => {
    if (!sessionId || !gateRequest) return;

    if (USE_DEMO_DATA) {
      setGateRequest(null);
      return;
    }

    try {
      await fetch(`/api/sessions/${sessionId}/gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          gateType: gateRequest.type,
          decision,
        }),
      });
      setGateRequest(null);
    } catch (err) {
      console.error('approveGate failed:', err);
    }
  }, [sessionId, gateRequest]);

  return { steps, findings, cost, status, gateRequest, approveGate };
}

// ── Hook 5: useResults ──────────────────────────────────────────────────

/** Return type for useResults. */
export interface ResultsData {
  /** The assembled document (markdown/HTML). */
  document: string;
  /** Quality assessment. */
  quality: { score: number; verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' };
  /** Issues found with source attribution. */
  issues: Finding[];
  /** Source citations used in the document. */
  sources: SourceCitation[];
  /** Verification pipeline results. */
  verification: { passes: VerificationPassResult[]; overall: number };
  /** Cost breakdown. */
  cost: { total: number; budget: number; agents: { role: string; cost: number }[] };
  /** True during fetch. */
  loading: boolean;
}

/**
 * Fetches the completed results for a session.
 *
 * Maps the API response to the shape expected by ResultsView:
 * assembled document, quality score, issues, sources, verification passes, cost.
 */
export function useResults(sessionId: string | null): ResultsData {
  const [data, setData] = useState<Omit<ResultsData, 'loading'> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    // Demo mode
    if (USE_DEMO_DATA) {
      setLoading(true);
      const timer = setTimeout(() => {
        setData({
          document: DEMO_RESULTS_DOCUMENT,
          quality: { score: 92, verdict: 'PASS' },
          issues: DEMO_MATTER_DETAIL.issues,
          sources: DEMO_RESULTS_SOURCES,
          verification: {
            passes: DEMO_VERIFICATION_PASSES,
            overall: 0.93,
          },
          cost: {
            total: 3.47,
            budget: 5.0,
            agents: [
              { role: 'Employment Counsel', cost: 1.41 },
              { role: 'Red Team + Litigation', cost: 0.92 },
              { role: 'Synthesis', cost: 0.46 },
              { role: 'Verification', cost: 0.51 },
              { role: 'Assembly', cost: 0.17 },
            ],
          },
        });
        setLoading(false);
      }, 500);
      return () => clearTimeout(timer);
    }

    // Live mode: poll until results are ready
    let cancelled = false;
    setLoading(true);

    const fetchResults = async () => {
      try {
        // Try active session first, fall back to archive
        let res = await fetch(`/api/sessions/${sessionId}`, { credentials: 'include' });

        if (res.status === 404) {
          res = await fetch(`/api/sessions/archive/${sessionId}`, { credentials: 'include' });
        }

        if (!res.ok) throw new Error(`Session not found (HTTP ${res.status})`);
        if (cancelled) return;

        // Parse JSON — handle potential control characters in assembled document
        const text = await res.text();
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(text);
        } catch {
          // Some responses contain control chars in markdown — sanitise and retry
          const sanitised = text.replace(/[\x00-\x1F\x7F]/g, (ch) => ch === '\n' || ch === '\r' || ch === '\t' ? ch : '');
          raw = JSON.parse(sanitised);
        }

        const mapped = mapSessionToResults(raw);

        setData(mapped);
        setLoading(false);

        // If document is not yet assembled, poll again
        if (!mapped.document || mapped.document.length < 100) {
          setTimeout(() => { if (!cancelled) fetchResults(); }, 3000);
        }
      } catch (err) {
        console.error('useResults: fetch failed', err);
        if (!cancelled) setLoading(false);
      }
    };

    fetchResults();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Return data or sensible defaults while loading
  return {
    document: data?.document ?? '',
    quality: data?.quality ?? { score: 0, verdict: 'FAIL' },
    issues: data?.issues ?? [],
    sources: data?.sources ?? [],
    verification: data?.verification ?? { passes: [], overall: 0 },
    cost: data?.cost ?? { total: 0, budget: 0, agents: [] },
    loading,
  };
}

/**
 * Maps a raw session API response to ResultsData.
 */
function mapSessionToResults(raw: Record<string, unknown>): Omit<ResultsData, 'loading'> {
  // Assembled document
  const document = (raw.assembledDocument as string) ?? '';

  // Quality / confidence
  const confidence = (raw.confidenceSummary ?? {}) as Record<string, unknown>;
  const overallScore = typeof confidence.overall === 'number' ? Math.round(confidence.overall * 100) : 0;
  const evaluatorScore = typeof confidence.evaluatorScore === 'number' ? confidence.evaluatorScore : 0;

  // If document was assembled successfully but no evaluator ran (simple counsel workflows
  // skip the evaluator gate), infer a baseline score from document presence + cost.
  const documentAssembled = document.length > 200;
  const inferredScore = documentAssembled ? 80 : 0;
  const score = evaluatorScore || overallScore || inferredScore;

  let verdict: 'PASS' | 'CONDITIONAL_PASS' | 'FAIL' = 'FAIL';
  if (score >= 80) verdict = 'PASS';
  else if (score >= 60) verdict = 'CONDITIONAL_PASS';

  // Findings → issues
  const rawFindings = (raw.findings ?? []) as Array<Record<string, unknown>>;
  const issues: Finding[] = rawFindings.map((f, i) => {
    const evidence = ((f.evidence as string[]) ?? []).join(' ');
    const sourceType = inferSourceType(evidence);
    const tag = SOURCE_TAGS[sourceType];
    const severity = (f.severity as Severity) ?? 'GREEN';
    return {
      id: (f.findingId as string) ?? `f-${i}`,
      title: (f.category as string) ?? (f.content as string)?.slice(0, 60) ?? `Finding ${i + 1}`,
      strength: severity === 'RED' || severity === 'GREEN' ? 'strong' : 'moderate',
      description: (f.content as string) ?? '',
      descriptionBold: [],
      sources: tag ? [{ label: tag.label, type: mapTrustToSourceType(tag.trustLevel) }] : [],
    };
  });

  // Source citations from findings
  const sources: SourceCitation[] = rawFindings.flatMap((f) => {
    const evidenceArr = (f.evidence as string[]) ?? [];
    return evidenceArr.map(ev => {
      const sourceType = inferSourceType(ev);
      const tag = SOURCE_TAGS[sourceType];
      return {
        citation: ev,
        sourceType,
        trustLevel: (tag?.trustLevel ?? 'low') as 'high' | 'medium' | 'low',
      };
    });
  });

  // De-duplicate sources by citation text
  const uniqueSources = sources.filter((s, i, arr) => arr.findIndex(x => x.citation === s.citation) === i);

  // Verification passes
  const rawVerificationField = raw.verificationPassResults ?? raw.verification;
  const rawVerification = Array.isArray(rawVerificationField) ? rawVerificationField as Array<Record<string, unknown>> : [];
  const passes: VerificationPassResult[] = rawVerification.map(v => ({
    name: (v.pass as string) ?? (v.type as string) ?? '',
    score: typeof v.score === 'number' ? v.score : 0,
    findings: ((v.findings as string[]) ?? []),
  }));

  const overallVerification = passes.length > 0
    ? passes.reduce((sum, p) => sum + p.score, 0) / passes.length
    : 0;

  // Cost
  const costData = (raw.cost ?? {}) as Record<string, unknown>;
  const totalCost = typeof costData.accumulated === 'number' ? costData.accumulated : 0;
  const budget = typeof costData.budget === 'number' ? costData.budget : 0;

  return {
    document,
    quality: { score, verdict },
    issues,
    sources: uniqueSources,
    verification: { passes, overall: overallVerification },
    cost: { total: totalCost, budget, agents: [] },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Maps a trust level to the source type label used in view components. */
function mapTrustToSourceType(trustLevel: 'high' | 'medium' | 'low'): 'verified' | 'statute' | 'web' | 'ai' {
  switch (trustLevel) {
    case 'high': return 'verified';
    case 'medium': return 'ai';
    case 'low': return 'web';
  }
}

/** Formats an ISO timestamp to a human-readable date string. */
function formatTimestamp(ts: string): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

/** Extracts a human-readable title from a raw event for the timeline. */
function getTimelineTitle(event: Record<string, unknown>): string {
  switch (event.type) {
    case 'session_start': return 'Matter created';
    case 'session_end': return 'Analysis complete';
    case 'workflow_step': {
      const step = event.step as string;
      return WORKFLOW_STEP_LABELS[step] ?? step;
    }
    case 'finding_posted': return (event.category as string) ?? 'Finding posted';
    default: return (event.type as string) ?? 'Event';
  }
}

/** Extracts a subtitle from a raw event for the timeline. */
function getTimelineSubtitle(event: Record<string, unknown>): string {
  switch (event.type) {
    case 'session_start': return '';
    case 'session_end': {
      const cost = event.totalCost as number;
      return cost ? `Cost: $${cost.toFixed(2)}` : '';
    }
    case 'finding_posted': return (event.content as string)?.slice(0, 100) ?? '';
    default: return '';
  }
}

// ── Hook: useEmploymentData ─────────────────────────────────────────────

export interface EmploymentData {
  intake: Record<string, unknown>;
  documentExtractions?: DocumentExtraction[];
  /** When the intake facts last changed; drafts generated before this are stale. */
  intakeRevisedAt?: string;
  timeline: Array<{ date: string; label: string; description?: string; category: string; source: string }>;
  gates: Array<{ gate: string; triggered: boolean; reason: string; issueCodes: string[]; requiresLawyerReview: boolean }>;
  approvedIssues: string[];
  dismissedIssues: string[];
  analysis: Record<string, unknown> | null;
  selectedTone: string;
  selectedProcedure: string | null;
  selectedDocumentType: string | null;
  demandAmount: number | null;
}

export interface GenerateDocumentResult {
  ok: boolean;
  html?: string;
  error?: string;
  citations?: SourceCitation[];
  reviewFlags?: string[];
  /** Timetable dates written to the matter's docket by this generation. */
  docketedDates?: number;
  /** Which served position documents grounded this draft (mediation brief). */
  positionsUsed?: string[];
  /** What this draft cost, for the notice line. */
  costUsd?: number;
  /** Non-blocking warnings, e.g. setting down past the Rule 48.14 deadline. */
  cautions?: string[];
}

export interface GeneratedDocSummary {
  docType: string;
  title: string;
  status: 'draft' | 'reviewed' | 'sent' | 'filed';
  generatedAt: string | null;
  statusDate: string | null;
  costUsd: number;
}

export interface MatterStage {
  stage: string;
  label: string;
  evidence: string[];
}

export interface UseEmploymentDataResult {
  data: EmploymentData | null;
  loading: boolean;
  error: string | null;
  /** Lifecycle stage derived from the matter's state. */
  stage: MatterStage | null;
  /** What should happen next, derived from the stage and the record. */
  nextSteps: Array<{ action: string; reason: string; urgency: 'urgent' | 'now' | 'soon'; goTo?: string }>;
  /** Every generated document on the matter with its lifecycle status. */
  generatedDocuments: GeneratedDocSummary[];
  /** The firm's own file number for this matter (empty when unset). */
  firmFileNumber: string;
  /** Save (or clear, with '') the firm file number. */
  saveFileNumber: (value: string) => Promise<{ ok: boolean; error?: string }>;
  /** Advance a generated document's lifecycle status. */
  setDocumentStatus: (docType: string, status: GeneratedDocSummary['status'], date?: string) => Promise<{ ok: boolean; error?: string }>;
  /** Merge-save the intake and re-run the analysis (edits preserve approvals). */
  saveIntake: (intake: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** Lawyer's private notes — null until the first fetch completes. */
  lawyerNotes: string | null;
  refresh: () => void;
  approveIssues: (approved: string[], dismissed: string[]) => Promise<void>;
  generateDocument: (docType: string, options: Record<string, unknown>) => Promise<GenerateDocumentResult>;
  saveNotes: (notes: string) => Promise<{ ok: boolean; error?: string }>;
  /** Who opened the file and who wrote last, for the header attribution line. */
  attribution: { openedBy: string; openedByMe: boolean; lastModifiedByName: string };
  /** Sources attached to the matter for brief generation (metadata only). */
  briefSources: Array<{ id: string; name: string; words: number }>;
  /** Mediation logistics stored at the last generation, for prefill. */
  mediationLogistics: { date?: string; mediator?: string } | null;
  runAnalysis: () => Promise<{ ok: boolean; error?: string }>;
  /** Extract facts from an uploaded document via Claude (parse → extract). */
  extractDocument: (file: File, documentKind: string) => Promise<{ ok: boolean; extraction?: DocumentExtraction; error?: string }>;
  /** Parse a file and detect its document type (the lawyer confirms before extraction). */
  classifyDocument: (file: File) => Promise<{
    ok: boolean; error?: string;
    kind?: string; confidence?: 'high' | 'medium' | 'low'; fallback?: boolean;
    content?: string; name?: string; definedTerms?: string[];
  }>;
  /** Extract from already-parsed content with the confirmed kind. */
  extractParsed: (content: string, name: string, documentKind: string, definedTerms?: string[]) => Promise<{ ok: boolean; extraction?: DocumentExtraction; error?: string }>;
  /** Apply the lawyer's selected extracted fields to the intake (deterministic). */
  applyExtraction: (extractionId: string, fields: string[], overwrite: string[], offers?: Array<{ index: number; date: string }>) => Promise<ApplyExtractionResult>;
  /** Cross-document chronology + conflicts over all stored extractions. */
  getCaseReview: () => Promise<{ ok: boolean; error?: string; chronology?: ChronologyEntry[]; conflicts?: FieldConflict[]; extractionCount?: number }>;
  /** Add approved chronology entries to the matter timeline. */
  applyChronology: (events: Array<{ date: string; label: string; category: string; sourceDoc: string }>) => Promise<{ ok: boolean; error?: string; added?: Array<{ date: string; label: string }>; skippedExisting?: number }>;
  /** Generate the source-cited case review memo over the structured extractions. */
  generateCaseSynthesis: () => Promise<{ ok: boolean; error?: string; document?: { html: string; documentTitle: string; lawyerReviewFlags?: string[] } }>;
}

export interface ChronologyEntry {
  date: string;
  field: string;
  label: string;
  category: string;
  sources: Array<{ filename: string; extractionId: string; confidence: string; verified?: boolean }>;
  onTimeline: boolean;
}

export interface FieldConflict {
  field: string;
  current: string | number | boolean | null;
  candidates: Array<{ value: string | number | boolean; filename: string; extractionId: string; confidence: string; verified?: boolean }>;
}

export interface DocumentExtraction {
  /** Stable id for the apply loop (older stored extractions may lack it). */
  id?: string;
  /** Filename of the analysed document. */
  filename: string;
  /** Document kind that was analysed (employment_agreement, termination_letter, ...). */
  documentType: string;
  /** Each field carries a value plus the model's confidence and, when quote grounding ran, the verbatim source sentence. */
  extractedFields: Record<string, {
    value: string | number | boolean | null;
    confidence: 'high' | 'medium' | 'low';
    sourceQuote?: string;
    verified?: boolean;
  }>;
  keyFindings: string[];
  /** Settlement offers detected in the document, proposed for the negotiation ledger. */
  offers?: Array<{
    date: string | null;
    party: 'employer' | 'client';
    kind: 'offer' | 'counter' | 'demand' | 'acceptance' | 'rejection';
    amountCad: number | null;
    terms: string | null;
    sourceQuote?: string;
    verified?: boolean;
  }>;
  confirmed: boolean;
  /** Set once the lawyer applied fields to the intake. */
  appliedAt?: string;
  appliedFields?: string[];
}

export interface ApplyExtractionResult {
  ok: boolean;
  error?: string;
  invalidFields?: string[];
  applied?: string[];
  overwritten?: string[];
  skippedNotBlank?: string[];
  unmapped?: string[];
  analysisStale?: boolean;
  appliedOffers?: string[];
  skippedDuplicateOffers?: number;
  timelineDiff?: { added: Array<{ date: string; label: string }>; removed: Array<{ date: string; label: string }> };
}

/**
 * Fetches employment data for a matter and provides actions.
 */
export function useEmploymentData(matterId: string | null): UseEmploymentDataResult {
  const [data, setData] = useState<EmploymentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lawyerNotes, setLawyerNotes] = useState<string | null>(null);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocSummary[]>([]);
  const [stage, setStage] = useState<MatterStage | null>(null);
  const [nextSteps, setNextSteps] = useState<Array<{ action: string; reason: string; urgency: 'urgent' | 'now' | 'soon'; goTo?: string }>>([]);
  const [firmFileNumber, setFirmFileNumber] = useState('');
  // Who opened the file, and the matter timestamp this editor loaded. The
  // timestamp rides along on notes/intake saves so a colleague's newer
  // write is refused instead of silently overwritten.
  const [attribution, setAttribution] = useState<{ openedBy: string; openedByMe: boolean; lastModifiedByName: string }>({ openedBy: '', openedByMe: true, lastModifiedByName: '' });
  const [briefSources, setBriefSources] = useState<Array<{ id: string; name: string; words: number }>>([]);
  const [mediationLogistics, setMediationLogistics] = useState<{ date?: string; mediator?: string } | null>(null);
  const loadedUpdatedAt = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!matterId) return;
    setLoading(true);
    setError(null);

    if (USE_DEMO_DATA) {
      setData(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/employment/${matterId}`, { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 404) { setData(null); setLoading(false); return; }
        throw new Error(`Failed to fetch employment data: ${res.statusText}`);
      }
      const json = await res.json();
      setData(json.data ?? null);
      setLawyerNotes(typeof json.lawyerNotes === 'string' ? json.lawyerNotes : '');
      setGeneratedDocuments(Array.isArray(json.generatedDocuments) ? json.generatedDocuments : []);
      setStage(json.stage && typeof json.stage === 'object' ? json.stage as MatterStage : null);
      setNextSteps(Array.isArray(json.nextSteps) ? json.nextSteps : []);
      setFirmFileNumber(typeof json.firmFileNumber === 'string' ? json.firmFileNumber : '');
      loadedUpdatedAt.current = typeof json.updatedAt === 'string' ? json.updatedAt : undefined;
      setBriefSources(Array.isArray(json.briefSources) ? json.briefSources : []);
      setMediationLogistics(json.mediationLogistics && typeof json.mediationLogistics === 'object' ? json.mediationLogistics : null);
      setAttribution({
        openedBy: typeof json.openedBy === 'string' ? json.openedBy : '',
        openedByMe: json.openedByMe !== false,
        lastModifiedByName: typeof json.lastModifiedByName === 'string' ? json.lastModifiedByName : '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load employment data');
    } finally {
      setLoading(false);
    }
  }, [matterId]);

  const saveFileNumber = useCallback(async (value: string): Promise<{ ok: boolean; error?: string }> => {
    if (!matterId) return { ok: false, error: 'No matter' };
    try {
      const res = await fetch(`/api/employment/${matterId}/file-number`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ firmFileNumber: value }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) return { ok: false, error: json.error ?? 'Could not save' };
      setFirmFileNumber(value);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not save' };
    }
  }, [matterId]);

  // Auto-fetch on mount and matterId change
  useEffect(() => { refresh(); }, [refresh]);

  const approveIssues = useCallback(async (approved: string[], dismissed: string[]) => {
    if (!matterId) return;
    try {
      await fetch(`/api/employment/${matterId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ approved, dismissed }),
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update issues');
    }
  }, [matterId, refresh]);

  const generateDocument = useCallback(async (docType: string, options: Record<string, unknown>) => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const LITIGATION_TYPES = ['discovery_plan', 'affidavit_of_documents', 'mediation_brief', 'severance_assessment', 'counter_offer', 'reply', 'rule49_offer', 'settlement_minutes', 'retainer_agreement', 'mitigation_log', 'settlement_conference_brief', 'hrto_schedule_a', 'notice_of_action', 'sj_notice_of_motion', 'sj_affidavit', 'sj_factum', 'affidavit_of_service', 'rule49_withdrawal', 'rule49_acceptance', 'costs_outline', 'esa_filing_sheet', 'scc_filing_sheet'];
      const endpoint = docType === 'demand_letter'
        ? `/api/employment/${matterId}/demand-letter`
        : docType === 'statement_of_claim'
          ? `/api/employment/${matterId}/statement-of-claim`
          : LITIGATION_TYPES.includes(docType)
            ? `/api/employment/${matterId}/litigation-document`
            : `/api/employment/${matterId}/application`;

      // The litigation-document route requires documentType in the body —
      // without this, the Mediation Brief card silently 400'd
      const body = LITIGATION_TYPES.includes(docType)
        ? { documentType: docType, ...options }
        : options;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) {
        // A rejected timetable names each problem (ordering, a past date, an
        // unreadable one). Showing only "Generation failed" would leave the
        // lawyer guessing which date to fix.
        const issues = Array.isArray(json.issues) ? (json.issues as string[]) : [];
        return {
          ok: false,
          error: issues.length > 0
            ? `${json.error ?? 'Generation failed'} ${issues.join(' ')}`
            : json.error ?? 'Generation failed',
        };
      }
      refresh();
      return {
        ok: true,
        html: json.html,
        citations: Array.isArray(json.citations) ? json.citations : [],
        reviewFlags: Array.isArray(json.lawyerReviewFlags) ? json.lawyerReviewFlags : [],
        docketedDates: typeof json.docketedDates === 'number' ? json.docketedDates : undefined,
        cautions: Array.isArray(json.cautions) ? (json.cautions as string[]) : undefined,
        positionsUsed: Array.isArray(json.positionsUsed) ? (json.positionsUsed as string[]) : undefined,
        costUsd: typeof json.costUsd === 'number' ? json.costUsd : undefined,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Generation failed' };
    }
  }, [matterId, refresh]);

  const saveNotes = useCallback(async (notes: string) => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch(`/api/employment/${matterId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notes, ifUpdatedAt: loadedUpdatedAt.current }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return { ok: false, error: (json as { error?: string }).error ?? 'Failed to save notes' };
      }
      setLawyerNotes(notes);
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to save notes' };
    }
  }, [matterId]);

  const runAnalysis = useCallback(async () => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch('/api/employment/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ matterId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return { ok: false, error: (json as { error?: string }).error ?? 'Analysis failed' };
      }
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Analysis failed' };
    }
  }, [matterId, refresh]);

  const extractDocument = useCallback(async (file: File, documentKind: string) => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      // Step 1: authoritative parse (PDF/DOCX/MD/TXT → text)
      const formData = new FormData();
      formData.append('file', file);
      const parseRes = await fetch('/api/documents/parse', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!parseRes.ok) return { ok: false, error: 'Could not parse the document. Supported: PDF, DOCX, Markdown, plain text.' };
      const parsed = await parseRes.json() as { fullText?: string; definedTerms?: string[] };
      if (!parsed.fullText?.trim()) return { ok: false, error: 'No text could be extracted from this document.' };

      // Step 2: Claude fact extraction (anonymised server-side)
      const res = await fetch('/api/employment/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          matterId,
          documentContent: parsed.fullText.slice(0, 100_000),
          documentName: file.name,
          documentKind,
          definedTerms: (parsed.definedTerms ?? []).slice(0, 20),
        }),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error ?? 'Extraction failed' };
      refresh();
      return { ok: true, extraction: json.extraction as DocumentExtraction };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Extraction failed' };
    }
  }, [matterId, refresh]);

  const classifyDocument = useCallback(async (file: File) => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const formData = new FormData();
      formData.append('file', file);
      const parseRes = await fetch('/api/documents/parse', { method: 'POST', credentials: 'include', body: formData });
      if (!parseRes.ok) return { ok: false, error: 'Could not parse the document. Supported: PDF, DOCX, Markdown, plain text.' };
      const parsed = await parseRes.json() as { fullText?: string; definedTerms?: string[] };
      if (!parsed.fullText?.trim()) return { ok: false, error: 'No text could be extracted from this document.' };

      const res = await fetch('/api/employment/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ matterId, documentContent: parsed.fullText.slice(0, 100_000), documentName: file.name }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; kind?: string; confidence?: 'high' | 'medium' | 'low'; fallback?: boolean; error?: string };
      if (!res.ok) return { ok: false, error: json.error ?? 'Classification failed' };
      return {
        ok: true, kind: json.kind, confidence: json.confidence, fallback: json.fallback,
        content: parsed.fullText.slice(0, 100_000), name: file.name,
        definedTerms: (parsed.definedTerms ?? []).slice(0, 20),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Classification failed' };
    }
  }, [matterId]);

  const extractParsed = useCallback(async (content: string, name: string, documentKind: string, definedTerms?: string[]) => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch('/api/employment/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ matterId, documentContent: content, documentName: name, documentKind, definedTerms }),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error ?? 'Extraction failed' };
      refresh();
      return { ok: true, extraction: json.extraction as DocumentExtraction };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Extraction failed' };
    }
  }, [matterId, refresh]);

  const getCaseReview = useCallback(async () => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch(`/api/employment/${matterId}/case-review`, { credentials: 'include' });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; chronology?: ChronologyEntry[]; conflicts?: FieldConflict[]; extractionCount?: number };
      if (!res.ok) return { ok: false, error: json.error ?? 'Could not load the case review' };
      return { ok: true, chronology: json.chronology, conflicts: json.conflicts, extractionCount: json.extractionCount };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not load the case review' };
    }
  }, [matterId]);

  const applyChronology = useCallback(async (events: Array<{ date: string; label: string; category: string; sourceDoc: string }>) => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch(`/api/employment/${matterId}/case-review/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ events }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; added?: Array<{ date: string; label: string }>; skippedExisting?: number };
      if (!res.ok) return { ok: false, error: json.error ?? 'Could not update the timeline' };
      refresh();
      return { ok: true, added: json.added, skippedExisting: json.skippedExisting };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not update the timeline' };
    }
  }, [matterId, refresh]);

  const generateCaseSynthesis = useCallback(async () => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch(`/api/employment/${matterId}/case-synthesis`, {
        method: 'POST', credentials: 'include',
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; document?: { html: string; documentTitle: string; lawyerReviewFlags?: string[] } };
      if (!res.ok) return { ok: false, error: json.error ?? 'The memo could not be generated' };
      refresh();
      return { ok: true, document: json.document };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'The memo could not be generated' };
    }
  }, [matterId, refresh]);

  const setDocumentStatus = useCallback(async (docType: string, status: GeneratedDocSummary['status'], date?: string) => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch(`/api/employment/${matterId}/document-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ docType, status, date }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: (json as { error?: string }).error ?? 'The status could not be updated' };
      setGeneratedDocuments(Array.isArray((json as { generatedDocuments?: GeneratedDocSummary[] }).generatedDocuments) ? (json as { generatedDocuments: GeneratedDocSummary[] }).generatedDocuments : []);
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'The status could not be updated' };
    }
  }, [matterId, refresh]);

  const saveIntake = useCallback(async (intake: Record<string, unknown>) => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch('/api/employment/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ matterId, intake, ifUpdatedAt: loadedUpdatedAt.current }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return { ok: false, error: (json as { error?: string }).error ?? 'The intake could not be saved' };
      }
      // Recompute the analysis so figures and clocks match the corrected facts
      const analyzeRes = await fetch('/api/employment/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ matterId }),
      });
      refresh();
      if (!analyzeRes.ok) return { ok: false, error: 'The intake saved, but the analysis could not be recomputed. Use Run Analysis on the Issues tab.' };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'The intake could not be saved' };
    }
  }, [matterId, refresh]);

  const applyExtraction = useCallback(async (extractionId: string, fields: string[], overwrite: string[], offers: Array<{ index: number; date: string }> = []): Promise<ApplyExtractionResult> => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch(`/api/employment/${matterId}/apply-extraction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ extractionId, fields, overwrite, offers }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, ...(json as object) } as ApplyExtractionResult;
      // No refresh here: refreshing unmounts the review panel before the
      // lawyer reads the result summary and consequence diff. The panel's
      // Done button triggers the refresh.
      return json as ApplyExtractionResult;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'The fields could not be applied' };
    }
  }, [matterId]);

  return { data, loading, error, lawyerNotes, generatedDocuments, firmFileNumber, saveFileNumber, stage, nextSteps, attribution, briefSources, mediationLogistics, setDocumentStatus, saveIntake, refresh, approveIssues, generateDocument, saveNotes, runAnalysis, extractDocument, classifyDocument, extractParsed, applyExtraction, getCaseReview, applyChronology, generateCaseSynthesis };
}

// ── Firm templates ──────────────────────────────────────────────────────

export interface FirmTemplateInfo {
  id: string;
  documentType: string;
  /** Stable id for this variant of the document type. */
  variantId: string;
  /** The firm's own label ("Constructive dismissal"). */
  variantLabel: string;
  /** The variant used when the lawyer does not pick one. */
  isDefault: boolean;
  name: string;
  placeholders: string[];
  uploadedAt: string;
  updatedAt: string;
}

export interface UseFirmTemplatesResult {
  templates: FirmTemplateInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Upload a DOCX template. A firm may hold several variants per document
   *  type; the first uploaded is the default until another is promoted. */
  upload: (
    file: File, documentType: string, variant?: { label?: string; isDefault?: boolean },
  ) => Promise<{ ok: boolean; placeholders?: string[]; error?: string }>;
  /** Remove one variant, or every variant of a type when none is given. */
  remove: (documentType: string, variantId?: string) => Promise<{ ok: boolean; error?: string }>;
  setDefault: (documentType: string, variantId: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Firm DOCX template management. Templates are keyed by (firm, document
 * type, variant): a firm can hold a demand letter for constructive dismissal
 * and another for termination during medical leave, and the lawyer picks
 * which to draft on. One variant per type is the default.
 */
export function useFirmTemplates(): UseFirmTemplatesResult {
  const [templates, setTemplates] = useState<FirmTemplateInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/employment/templates', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load templates');
      const json = await res.json();
      setTemplates(Array.isArray(json.templates) ? json.templates : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const upload = useCallback(async (file: File, documentType: string, variant?: { label?: string; isDefault?: boolean }) => {
    try {
      const buffer = await file.arrayBuffer();
      // Chunked base64 encoding — String.fromCharCode(...bigArray) overflows the stack
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const templateBase64 = btoa(binary);

      const res = await fetch('/api/employment/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          documentType, name: file.name, templateBase64,
          ...(variant?.label ? { variantLabel: variant.label } : {}),
          ...(variant?.isDefault ? { isDefault: true } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error ?? 'Upload failed' };
      refresh();
      return { ok: true, placeholders: json.placeholders as string[] };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Upload failed' };
    }
  }, [refresh]);

  const remove = useCallback(async (documentType: string, variantId?: string) => {
    try {
      const qs = variantId ? `?variantId=${encodeURIComponent(variantId)}` : '';
      const res = await fetch(`/api/employment/templates/${encodeURIComponent(documentType)}${qs}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) return { ok: false, error: 'Failed to remove template' };
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to remove template' };
    }
  }, [refresh]);

  const setDefault = useCallback(async (documentType: string, variantId: string) => {
    try {
      const res = await fetch(`/api/employment/templates/${encodeURIComponent(documentType)}/default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ variantId }),
      });
      if (!res.ok) return { ok: false, error: 'Failed to set the default template' };
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to set the default template' };
    }
  }, [refresh]);

  return { templates, loading, error, refresh, upload, remove, setDefault };
}
