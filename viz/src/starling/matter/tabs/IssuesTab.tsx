// The Issues tab: comparables, the run-analysis empty state, the gate
// approval panel, and the found-issues list. Extracted from
// MatterDetailView.tsx. The gate decisions and the analysis-running state
// derive only from the employment data, so they live here.

import { useState, useCallback } from 'react';
import { navy, orange, green, amber, red, border, ink, muted, serif, sans } from '../tokens.js';
import { ComparablesPanel, GateApprovalPanel } from '../../shared.js';
import { ApprovedIssuesEditor } from './ApprovedIssuesEditor.js';
import { StatusDot, SourceTag, renderBoldText } from '../presentational.js';
import type { Issue } from '../types.js';
import { useEmploymentData } from '../../hooks/useStarlingApi.js';

type Employment = ReturnType<typeof useEmploymentData>;

export function IssuesTab({ employment, issues, sessionId }: {
  employment: Employment;
  issues: Issue[];
  sessionId: string | null;
}) {
  const [analysing, setAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState<string | null>(null);

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

  return (
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
            <div style={{ marginTop: 10, color: red, fontSize: 13 }}>{analyseError}</div>
          )}
        </div>
      )}

      {/* Lawyer decisions on triggered gates — controls which issues
          are included in generated documents (shared with the labour view) */}
      {(() => {
        const pending = triggeredGates.filter(g => gateDecision(g) === 'pending');
        if (pending.length === 0) return null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2, padding: '10px 14px', marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: ink }}>
              <b>{pending.length} issue{pending.length === 1 ? '' : 's'} await{pending.length === 1 ? 's' : ''} your decision.</b>{' '}
              Documents argue only approved issues.
            </span>
            <button
              onClick={() => {
                const approvedSet = new Set(employment.data?.approvedIssues ?? []);
                for (const g of pending) for (const c of g.issueCodes) approvedSet.add(c);
                void employment.approveIssues([...approvedSet], employment.data?.dismissedIssues ?? []);
              }}
              style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 2, fontFamily: sans, background: navy, color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Approve all {pending.length}
            </button>
          </div>
        );
      })()}
      <GateApprovalPanel
        gates={triggeredGates}
        structuralGates={structuralGates}
        decisionFor={gateDecision}
        onDecision={setGateDecision}
        subheading="Only approved issues are included in demand letters, pleadings, and applications. Starling drafts nothing you have not approved."
      />

      {/* The editable list of issues on the file: correct the approved
          issues, remove a wrong one, add one the analysis did not raise. */}
      {employment.data?.analysis != null && (
        <ApprovedIssuesEditor
          approvedIssues={employment.data.approvedIssues}
          dismissedIssues={employment.data.dismissedIssues}
          raisedCodes={triggeredGates.flatMap(g => g.issueCodes)}
          setIssues={(approved, dismissed) => { void employment.approveIssues(approved, dismissed); }}
        />
      )}

      {issues.length === 0 && triggeredGates.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>No issues found yet.</div>
      )}
      {issues.map(issue => (
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
  );
}
