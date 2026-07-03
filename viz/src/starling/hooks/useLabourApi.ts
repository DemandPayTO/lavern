/**
 * useLabourApi.ts — Adapter hooks for the union-side labour vertical.
 *
 * Mirrors useStarlingApi's patterns on the /api/labour routes. A matter is
 * a labour matter when GET /api/labour/:matterId returns grievance data —
 * the matter detail view uses that to switch to the grievance UI.
 */

import { useState, useEffect, useCallback } from 'react';

// ── Types (mirror src/types/labour-intake.ts) ───────────────────────────

export interface LabourGate {
  gate: string;
  triggered: boolean;
  reason: string;
  issueCodes: string[];
  requiresLawyerReview: boolean;
}

export interface LabourTimelineEvent {
  date: string;
  label: string;
  description?: string;
  category: 'incident' | 'grievance' | 'deadline' | 'other';
  source: string;
}

export interface GrievanceDeadline {
  date: string;
  label: string;
  kind: 'filing' | 'referral';
  daysRemaining: number;
  overdue: boolean;
  approximate: boolean;
}

export interface CaProcedureStep {
  label: string;
  employer_response_days?: number | null;
  advance_days?: number | null;
  day_kind?: 'calendar' | 'working' | null;
}

export interface GrievanceStepEvent {
  step_label: string;
  presented_date?: string;
  response_date?: string;
}

export interface LabourData {
  intake: Record<string, unknown>;
  gates: LabourGate[];
  approvedIssues: string[];
  dismissedIssues: string[];
  timeline: LabourTimelineEvent[];
  analysis: { deadlines?: GrievanceDeadline[]; evaluatedAt?: string } | null;
}

export interface CaProfileSummary {
  id: string;
  name: string;
  updatedAt: string;
  data: Record<string, unknown>;
}

export interface GrievanceGenerateResult {
  ok: boolean;
  html?: string;
  documentTitle?: string;
  reviewerFlags?: string[];
  error?: string;
}

export interface CaExtractionOutcome {
  ok: boolean;
  extraction?: {
    filename: string;
    documentType: string;
    extractedFields: Record<string, { value: string | number | boolean | null; confidence: 'high' | 'medium' | 'low' }>;
    keyFindings: string[];
  };
  /** Labour intake fields auto-filled from a collective agreement. */
  labourAutoFilled?: string[];
  error?: string;
}

// ── useLabourData ───────────────────────────────────────────────────────

export interface UseLabourDataResult {
  /** Grievance data, or null when this matter is not a labour matter. */
  data: LabourData | null;
  /** True until the first fetch resolves — callers should wait before deciding the matter type. */
  loading: boolean;
  refresh: () => void;
  approveIssues: (approved: string[], dismissed: string[]) => Promise<void>;
  generateDocument: (docType: string, options: {
    representativeName: string;
    organizationName: string;
    additionalContext?: string;
  }) => Promise<GrievanceGenerateResult>;
  /** Parse an uploaded document and extract facts (CA fills the grievance clocks). */
  extractDocument: (file: File, documentKind: string) => Promise<CaExtractionOutcome>;
  /** Record a presentation or employer response at a procedure step. */
  recordStepEvent: (event: GrievanceStepEvent) => Promise<{ ok: boolean; error?: string }>;
  /** Save the full intake (used to merge remedy inputs before generating the worksheet). */
  saveIntake: (intake: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}

export function useLabourData(matterId: string | null): UseLabourDataResult {
  const [data, setData] = useState<LabourData | null>(null);
  const [loading, setLoading] = useState(Boolean(matterId));

  const refresh = useCallback(async () => {
    if (!matterId) { setData(null); setLoading(false); return; }
    try {
      const res = await fetch(`/api/labour/${encodeURIComponent(matterId)}`, { credentials: 'include' });
      if (!res.ok) { setData(null); return; }
      const json = await res.json();
      setData((json.data as LabourData) ?? null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [matterId]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  const approveIssues = useCallback(async (approved: string[], dismissed: string[]) => {
    if (!matterId) return;
    try {
      await fetch(`/api/labour/${encodeURIComponent(matterId)}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ approved, dismissed }),
      });
      refresh();
    } catch { /* refresh next interaction */ }
  }, [matterId, refresh]);

  const generateDocument = useCallback(async (docType: string, options: {
    representativeName: string;
    organizationName: string;
    additionalContext?: string;
  }): Promise<GrievanceGenerateResult> => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch(`/api/labour/${encodeURIComponent(matterId)}/document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ documentType: docType, ...options }),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error ?? 'Generation failed' };
      refresh();
      return {
        ok: true,
        html: json.html,
        documentTitle: json.documentTitle,
        reviewerFlags: Array.isArray(json.reviewerFlags) ? json.reviewerFlags : [],
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Generation failed' };
    }
  }, [matterId, refresh]);

  const extractDocument = useCallback(async (file: File, documentKind: string): Promise<CaExtractionOutcome> => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
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
      return {
        ok: true,
        extraction: json.extraction,
        labourAutoFilled: Array.isArray(json.labourAutoFilled) ? json.labourAutoFilled : [],
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Extraction failed' };
    }
  }, [matterId, refresh]);

  const recordStepEvent = useCallback(async (event: GrievanceStepEvent): Promise<{ ok: boolean; error?: string }> => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch(`/api/labour/${encodeURIComponent(matterId)}/step-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(event),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: (json as { error?: string }).error ?? 'Could not record the step event' };
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not record the step event' };
    }
  }, [matterId, refresh]);

  const saveIntake = useCallback(async (intake: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    if (!matterId) return { ok: false, error: 'No matter ID' };
    try {
      const res = await fetch('/api/labour/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ matterId, intake }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: (json as { error?: string }).error ?? 'Could not save the intake' };
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not save the intake' };
    }
  }, [matterId, refresh]);

  return { data, loading, refresh, approveIssues, generateDocument, extractDocument, recordStepEvent, saveIntake };
}

// ── CA library ──────────────────────────────────────────────────────────

export interface UseCaProfilesResult {
  profiles: CaProfileSummary[];
  loading: boolean;
  refresh: () => void;
  save: (profile: Record<string, unknown>, id?: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

/** The firm's CA library: one profile per bargaining unit. */
export function useCaProfiles(): UseCaProfilesResult {
  const [profiles, setProfiles] = useState<CaProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/labour/ca-profiles', { credentials: 'include' });
      if (!res.ok) { setProfiles([]); return; }
      const json = await res.json();
      setProfiles(Array.isArray(json.profiles) ? json.profiles : []);
    } catch {
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (profile: Record<string, unknown>, id?: string) => {
    try {
      const res = await fetch('/api/labour/ca-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, profile }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: (json as { error?: string }).error ?? 'Could not save the CA profile' };
      refresh();
      return { ok: true, id: (json as { id?: string }).id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not save the CA profile' };
    }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/labour/ca-profiles/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) return { ok: false, error: 'Could not delete the CA profile' };
      refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not delete the CA profile' };
    }
  }, [refresh]);

  return { profiles, loading, refresh, save, remove };
}

// ── createGrievanceMatter ───────────────────────────────────────────────

export interface GrievanceCreateResult {
  createGrievance: (intake: Record<string, unknown>) => Promise<{ matterId: string }>;
  creating: boolean;
  error: string | null;
}

/**
 * Creates a labour matter: POST /api/matters, then saves the grievance
 * intake (gates + timeline + CA clocks evaluated server-side), then
 * auto-approves triggered issue codes so drafting works immediately —
 * the reviewer can dismiss issues from the matter view.
 */
export function useGrievanceCreate(): GrievanceCreateResult {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createGrievance = useCallback(async (intake: Record<string, unknown>): Promise<{ matterId: string }> => {
    setError(null);
    setCreating(true);
    try {
      const grievor = [intake.grievor_first_name, intake.grievor_last_name].filter(Boolean).join(' ') || 'Grievor';
      const employer = (intake.employer_name as string) || 'Employer';

      const matterRes = await fetch('/api/matters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          clientName: grievor,
          matterTitle: `${grievor}: Grievance v ${employer}`,
          matterDescription: (intake.incident_description as string) || `Grievance: ${grievor} v ${employer}`,
          matterType: 'employment_agreement',
          jurisdiction: 'CA',
        }),
      });
      if (!matterRes.ok) {
        const errData = await matterRes.json().catch(() => ({}));
        throw new Error((errData as Record<string, string>).error || `Failed to create matter: ${matterRes.statusText}`);
      }
      const matterData = await matterRes.json();
      const matterId = matterData.matterId as string;

      const intakeRes = await fetch('/api/labour/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ matterId, intake }),
      });
      if (!intakeRes.ok) {
        const errData = await intakeRes.json().catch(() => ({}));
        throw new Error((errData as Record<string, string>).error || 'Failed to save grievance intake');
      }

      // Auto-approve triggered issues (reviewer can dismiss later)
      try {
        const intakeJson = await intakeRes.json();
        const triggeredCodes = ((intakeJson.gates ?? []) as LabourGate[])
          .filter(g => g.triggered)
          .flatMap(g => g.issueCodes);
        if (triggeredCodes.length > 0) {
          await fetch(`/api/labour/${encodeURIComponent(matterId)}/issues`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ approved: [...new Set(triggeredCodes)], dismissed: [] }),
          });
        }
      } catch { /* non-fatal — approvals can be set from the matter view */ }

      setCreating(false);
      return { matterId };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create grievance matter');
      setCreating(false);
      throw err;
    }
  }, []);

  return { createGrievance, creating, error };
}
