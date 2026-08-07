/**
 * shared.tsx — Starling design tokens and components shared between the
 * employment matter view and the labour (grievance) matter view.
 *
 * Extracted from MatterDetailView so the labour vertical reuses the same
 * gate-approval and draft-preview UI instead of forking it.
 */

import { useState, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// ── Design Tokens ───────────────────────────────────────────────────────
export const navy = '#0f1a2e';
export const orange = '#ea580c';
export const cream = '#faf8f5';
export const frame = '#e8e5e0';
export const green = '#16a34a';
export const amber = '#d97706';
export const red = '#dc2626';
export const border = 'rgba(15,26,46,0.12)';
export const ink = '#0f1a2e';
export const muted = '#5a6472';
export const serif = "Georgia, 'Palatino Linotype', serif";
export const sans = "system-ui, -apple-system, sans-serif";

// ── Primitives ──────────────────────────────────────────────────────────

export function StatusDot({ colour, size = 8 }: { colour: string; size?: number }) {
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

export function FactItem({ label, value, isLast, valueColour }: { label: string; value: string; isLast?: boolean; valueColour?: string }) {
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

export function ActionButton({ label, onClick }: { label: string; onClick?: () => void }) {
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

/** Navy top bar with the DemandPay Starling wordmark. */
export function StarlingTopBar({ subtitle = 'Employment Law' }: { subtitle?: string }) {
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
          <b style={{ color: '#fff' }}>Starling</b> &middot; {subtitle}
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
  );
}

// ── Gate approval panel ─────────────────────────────────────────────────

export interface GateLike {
  gate: string;
  triggered: boolean;
  reason: string;
  issueCodes: string[];
  requiresLawyerReview: boolean;
}

export interface GateApprovalPanelProps {
  /** Triggered gates with issue codes — the reviewer's decisions. */
  gates: GateLike[];
  /** Triggered gates with no issue codes — applied automatically. */
  structuralGates: GateLike[];
  decisionFor: (gate: GateLike) => 'approved' | 'dismissed' | 'pending';
  onDecision: (gate: GateLike, decision: 'approve' | 'dismiss') => void;
  heading?: string;
  subheading?: string;
  /** "REVIEW REQUIRED" badge text — labour matters say "reviewer", not "lawyer". */
  reviewBadge?: string;
}

export function GateApprovalPanel({
  gates, structuralGates, decisionFor, onDecision,
  heading = 'Approve issues for drafting',
  subheading = "Only approved issues are included in generated documents. Starling drafts nothing you have not approved.",
  reviewBadge = 'REVIEW REQUIRED',
}: GateApprovalPanelProps) {
  if (gates.length === 0) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginBottom: 18 }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        {heading}
      </div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 14 }}>
        {subheading}
      </div>
      {gates.map(gate => {
        const decision = decisionFor(gate);
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
                    {reviewBadge}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: muted }}>
                Gate {gate.gate} · {gate.issueCodes.map(c => c.replace(/_/g, ' ')).join(', ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => onDecision(gate, 'approve')}
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
                onClick={() => onDecision(gate, 'dismiss')}
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
  );
}

// ── Generated draft preview ─────────────────────────────────────────────

export interface DraftCitation {
  citation: string;
  sourceType: string;
  trustLevel: 'high' | 'medium' | 'low';
}

export interface DraftPreviewProps {
  html: string;
  reviewFlags: string[];
  citations?: DraftCitation[];
  /** DOCX download URL; omit to hide the button. */
  downloadHref?: string;
  onRegenerate: () => void;
  reviewHeading?: string;
}

export function DraftPreview({ html, reviewFlags, citations = [], downloadHref, onRegenerate, reviewHeading = 'Review before sending' }: DraftPreviewProps) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontFamily: serif, fontSize: 17, fontWeight: 600, color: navy, margin: 0 }}>
          Generated Draft
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onRegenerate}
            style={{
              background: '#fff', color: navy, border: `1px solid ${border}`,
              fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans,
            }}
          >
            Regenerate
          </button>
          {downloadHref && (
            <a
              href={downloadHref}
              download
              style={{
                background: navy, color: '#fff',
                fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2,
                textDecoration: 'none', display: 'inline-block', fontFamily: sans,
              }}
            >
              Download DOCX
            </a>
          )}
        </div>
      </div>
      <div
        style={{
          background: '#fff', border: `1px solid ${border}`, padding: '28px 32px',
          fontFamily: serif, fontSize: 14, lineHeight: 1.7, color: ink,
          maxHeight: 600, overflowY: 'auto',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {reviewFlags.length > 0 && (
        <div style={{ marginTop: 12, background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2, padding: '12px 16px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: amber, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {reviewHeading}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: ink, lineHeight: 1.7 }}>
            {reviewFlags.map((flag, i) => <li key={i}>{flag}</li>)}
          </ul>
        </div>
      )}

      {citations.length > 0 && (
        <details style={{ marginTop: 12, background: '#fff', border: `1px solid ${border}`, borderRadius: 2 }}>
          <summary style={{ cursor: 'pointer', padding: '12px 16px', fontSize: 13, fontWeight: 600, color: navy, fontFamily: sans }}>
            Source citations ({citations.length})
          </summary>
          <div style={{ padding: '0 16px 12px' }}>
            {citations.map((c, i) => (
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
  );
}

// ── Intake editor ───────────────────────────────────────────────────────
// A matter's intake must be correctable after creation: a wrong salary or
// date silently poisons every figure and deadline downstream. The editor
// merges into the existing intake; fields it does not show are preserved,
// and clearing a field removes it.

export interface IntakeFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  options?: Array<[string, string]>;
  placeholder?: string;
}

export interface IntakeEditorPanelProps {
  fields: IntakeFieldDef[];
  /** Current intake values (only the listed keys are read). */
  values: Record<string, unknown>;
  /**
   * Receives the edited fields, converted per type: numbers parsed,
   * checkboxes boolean, cleared fields as undefined (caller deletes the
   * key from the merged intake).
   */
  onSave: (edited: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  heading?: string;
  subheading?: string;
}

export function IntakeEditorPanel({
  fields, values, onSave,
  heading = 'Intake',
  subheading = 'Correcting a field recomputes the analysis, the entitlement figures, and the deadline clocks. Issue approvals are preserved.',
}: IntakeEditorPanelProps) {
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Seed from the intake whenever it changes on the server
  useEffect(() => {
    const seeded: Record<string, string | boolean> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === 'checkbox') seeded[f.key] = Boolean(v);
      else seeded[f.key] = v === null || v === undefined ? '' : String(v);
    }
    setDraft(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fields.map(f => values[f.key]))]);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    const edited: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = draft[f.key];
      if (f.type === 'checkbox') { edited[f.key] = Boolean(raw); continue; }
      const s = String(raw ?? '').trim();
      if (s === '') { edited[f.key] = undefined; continue; }
      if (f.type === 'number') {
        const n = parseFloat(s.replace(/[^\d.-]/g, ''));
        edited[f.key] = Number.isFinite(n) ? n : undefined;
        continue;
      }
      edited[f.key] = s;
    }
    const result = await onSave(edited);
    setSaving(false);
    setStatus(result.ok ? 'Saved. Analysis and clocks recomputed.' : result.error ?? 'The intake could not be saved.');
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px' }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>{heading}</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 14 }}>{subheading}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {fields.map(f => (
          <div key={f.key} style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : f.type === 'checkbox' ? { display: 'flex', alignItems: 'flex-end' } : undefined}>
            {f.type === 'checkbox' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: ink, cursor: 'pointer', paddingBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={Boolean(draft[f.key])}
                  onChange={e => setDraft(prev => ({ ...prev, [f.key]: e.target.checked }))}
                  style={{ accentColor: orange }}
                />
                {f.label}
              </label>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>{f.label}</div>
                {f.type === 'select' ? (
                  <select
                    value={String(draft[f.key] ?? '')}
                    onChange={e => setDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
                  >
                    <option value="">Not set</option>
                    {(f.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea
                    value={String(draft[f.key] ?? '')}
                    placeholder={f.placeholder}
                    onChange={e => setDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                    rows={3}
                    style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box', resize: 'vertical' }}
                  />
                ) : (
                  <input
                    type={f.type === 'date' ? 'date' : 'text'}
                    inputMode={f.type === 'number' ? 'decimal' : undefined}
                    value={String(draft[f.key] ?? '')}
                    placeholder={f.placeholder}
                    onChange={e => setDraft(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
                  />
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: saving ? '#b0b0b0' : orange, color: '#fff', fontSize: 13.5, fontWeight: 600,
            padding: '11px 18px', borderRadius: 2, border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: sans,
          }}
        >
          {saving ? 'Saving...' : 'Save and recompute'}
        </button>
        {status && (
          <span style={{ fontSize: 13, color: status.startsWith('Saved') ? green : red, fontWeight: 600 }} role="status">
            {status}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Generated documents with lifecycle status ───────────────────────────

export interface GeneratedDocSummary {
  docType: string;
  title: string;
  status: 'draft' | 'reviewed' | 'sent' | 'filed';
  generatedAt: string | null;
  statusDate: string | null;
  costUsd: number;
}

const STATUS_COLOURS: Record<GeneratedDocSummary['status'], { fg: string; bg: string }> = {
  draft: { fg: muted, bg: '#f4f1ec' },
  reviewed: { fg: navy, bg: '#eef1f6' },
  sent: { fg: green, bg: '#e7f6ec' },
  filed: { fg: green, bg: '#e7f6ec' },
};

export interface GeneratedDocsPanelProps {
  docs: GeneratedDocSummary[];
  onSetStatus: (docType: string, status: GeneratedDocSummary['status'], date?: string) => Promise<{ ok: boolean; error?: string }>;
  /** Open the saved draft in the Draft tab. Returns false when no saved copy exists. */
  onOpen?: (docType: string) => boolean;
  /** DOCX download URL for a document, or null when it has no download route. */
  downloadHref?: (docType: string) => string | null;
  /** Extra per-row controls, e.g. the approval-lane strip. */
  renderExtra?: (docType: string) => ReactNode;
}

export function GeneratedDocsPanel({ docs, onSetStatus, onOpen, downloadHref, renderExtra }: GeneratedDocsPanelProps) {
  const [eventDate, setEventDate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (docs.length === 0) return null;

  const advance = async (docType: string, status: GeneratedDocSummary['status']) => {
    setBusy(docType);
    setMessage(null);
    const result = await onSetStatus(docType, status, (status === 'sent' || status === 'filed') && eventDate ? eventDate : undefined);
    setBusy(null);
    setMessage(result.ok ? null : result.error ?? 'The status could not be updated.');
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginBottom: 16 }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        Generated documents
      </div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 6 }}>
        Track each document from draft to reviewed to sent or filed. Marking a demand letter sent
        starts the response clock from the date of sending.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: muted }}>Date for sent/filed:</span>
        <input
          type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}
          aria-label="Date sent or filed"
          style={{ fontFamily: sans, fontSize: 12.5, padding: '5px 8px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
        />
        <span style={{ fontSize: 12, color: muted }}>(blank = today)</span>
      </div>
      {docs.map(doc => {
        const colours = STATUS_COLOURS[doc.status];
        return (
          <div key={doc.docType} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${border}`, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>{doc.title}</span>
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 2, color: colours.fg, background: colours.bg, textTransform: 'uppercase' as const }}>
                {doc.status}{doc.statusDate && doc.status !== 'draft' ? ` · ${doc.statusDate}` : ''}
              </span>
              {doc.generatedAt && (
                <div style={{ fontSize: 11.5, color: muted }}>
                  Generated {new Date(doc.generatedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {onOpen && (
                <button
                  onClick={() => {
                    if (!onOpen(doc.docType)) setMessage('No saved copy of that draft remains. Generate it again from the Draft tab.');
                  }}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
                >
                  Open
                </button>
              )}
              {downloadHref && downloadHref(doc.docType) && (
                <a
                  href={downloadHref(doc.docType)!}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, textDecoration: 'none', display: 'inline-block' }}
                >
                  Download DOCX
                </a>
              )}
              {(['reviewed', 'sent', 'filed'] as const).map(next => (
                <button
                  key={next}
                  onClick={() => advance(doc.docType, next)}
                  disabled={busy === doc.docType || doc.status === next}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans,
                    background: doc.status === next ? navy : '#fff',
                    color: doc.status === next ? '#fff' : navy,
                    border: `1px solid ${doc.status === next ? navy : border}`,
                    cursor: busy === doc.docType || doc.status === next ? 'default' : 'pointer',
                  }}
                >
                  {next.charAt(0).toUpperCase() + next.slice(1)}
                </button>
              ))}
            </div>
            {renderExtra && <div style={{ flexBasis: '100%' }}>{renderExtra(doc.docType)}</div>}
          </div>
        );
      })}
      {message && <div style={{ fontSize: 12.5, color: red, marginTop: 8 }} role="alert">{message}</div>}
    </div>
  );
}

// ── Next steps panel ────────────────────────────────────────────────────

export interface NextStepItem {
  action: string;
  reason: string;
  urgency: 'urgent' | 'now' | 'soon';
  goTo?: string;
}

const NEXT_URGENCY: Record<NextStepItem['urgency'], { fg: string; label: string }> = {
  urgent: { fg: red, label: 'URGENT' },
  now: { fg: amber, label: 'NOW' },
  soon: { fg: muted, label: 'SOON' },
};

export function NextStepsPanel({ steps, onGoTo }: { steps: NextStepItem[]; onGoTo?: (tab: string) => void }) {
  if (steps.length === 0) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, borderLeft: `4px solid ${steps.some(s => s.urgency === 'urgent') ? red : navy}`, padding: '14px 18px', marginTop: 16 }}>
      <div style={{ fontFamily: serif, fontSize: 14, fontWeight: 600, color: navy, marginBottom: 6 }}>
        Next steps
      </div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: NEXT_URGENCY[s.urgency].fg, minWidth: 48 }}>
            {NEXT_URGENCY[s.urgency].label}
          </span>
          {s.goTo && onGoTo ? (
            <button
              onClick={() => onGoTo(s.goTo!)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: ink, textAlign: 'left' as const, textDecoration: 'underline', textDecorationColor: border }}
            >
              {s.action}
            </button>
          ) : (
            <span style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>{s.action}</span>
          )}
          <span style={{ fontSize: 12.5, color: muted }}>{s.reason}</span>
        </div>
      ))}
    </div>
  );
}

// ── Close matter (outcome capture) ──────────────────────────────────────

const RESOLUTION_OPTIONS: Array<[string, string]> = [
  ['settled', 'Settled'],
  ['judgment', 'Judgment'],
  ['tribunal_decision', 'Tribunal decision'],
  ['discontinued', 'Discontinued'],
  ['abandoned', 'Abandoned'],
  ['grievance_allowed', 'Grievance allowed'],
  ['grievance_dismissed', 'Grievance dismissed'],
  ['grievance_withdrawn', 'Grievance withdrawn'],
  ['other', 'Other'],
];

export function CloseMatterPanel({ matterId, resolved, onChanged }: {
  matterId: string;
  resolved: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState('settled');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const close = async () => {
    setBusy(true);
    setMessage(null);
    const body: Record<string, unknown> = { resolution, date: date || new Date().toISOString().slice(0, 10) };
    const amt = parseFloat(amount.replace(/[^\d.]/g, ''));
    if (Number.isFinite(amt) && amt >= 0 && amount.trim() !== '') body.amount = amt;
    if (notes.trim()) body.notes = notes.trim();
    try {
      const res = await fetch(`/api/employment/${matterId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage((json as { error?: string }).error ?? 'The outcome could not be recorded.'); }
      else { setOpen(false); onChanged(); }
    } catch {
      setMessage('The outcome could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  const [confirmingReopen, setConfirmingReopen] = useState(false);

  const reopen = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/employment/${matterId}/outcome`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (resolved) {
    if (confirmingReopen) {
      return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: muted }}>Reopen this file and clear its recorded outcome?</span>
          <button
            onClick={reopen}
            disabled={busy}
            style={{ background: navy, color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
          >
            {busy ? 'Reopening...' : 'Yes, reopen'}
          </button>
          <button
            onClick={() => setConfirmingReopen(false)}
            style={{ background: '#fff', color: muted, border: `1px solid ${border}`, fontSize: 13, padding: '9px 16px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
          >
            Cancel
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => setConfirmingReopen(true)}
        style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13.5, fontWeight: 600, padding: '11px 18px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
      >
        Reopen matter
      </button>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13.5, fontWeight: 600, padding: '11px 18px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
      >
        Close matter with outcome
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', background: cream, border: `1px solid ${border}`, borderRadius: 2, padding: '10px 12px' }}>
      <div>
        <div style={{ fontSize: 11.5, color: muted, marginBottom: 4, fontWeight: 600 }}>Resolution</div>
        <select value={resolution} onChange={e => setResolution(e.target.value)} style={{ fontFamily: sans, fontSize: 13, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}>
          {RESOLUTION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: muted, marginBottom: 4, fontWeight: 600 }}>Amount (optional)</div>
        <input type="text" inputMode="decimal" placeholder="e.g., 85000" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 110, fontFamily: sans, fontSize: 13, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }} />
      </div>
      <div>
        <div style={{ fontSize: 11.5, color: muted, marginBottom: 4, fontWeight: 600 }}>Date</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ fontFamily: sans, fontSize: 13, padding: '7px 10px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }} />
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 11.5, color: muted, marginBottom: 4, fontWeight: 600 }}>Notes (optional)</div>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g., settled at mediation" style={{ width: '100%', fontFamily: sans, fontSize: 13, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }} />
      </div>
      <button onClick={close} disabled={busy} style={{ background: busy ? '#b0b0b0' : orange, color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 2, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: sans }}>
        {busy ? 'Recording...' : 'Record and close'}
      </button>
      <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: muted, fontSize: 13, cursor: 'pointer', fontFamily: sans }}>
        Cancel
      </button>
      {message && <span style={{ fontSize: 12.5, color: red }} role="alert">{message}</span>}
    </div>
  );
}

// ── Client correspondence (scheduled emails, lawyer sends) ──────────────

export interface CorrespondenceItemShape {
  id: string;
  sequence: string;
  step: number;
  title: string;
  dueDate: string;
  status: 'scheduled' | 'drafted' | 'sent' | 'skipped';
  draft?: { subject: string; body: string; attachmentHint?: string };
}

const CORR_STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  scheduled: { label: 'SCHEDULED', fg: navy, bg: '#eef1f6' },
  drafted: { label: 'DRAFT READY', fg: '#8a5a00', bg: '#fdf0dd' },
  sent: { label: 'SENT', fg: green, bg: '#e7f6ec' },
  skipped: { label: 'SKIPPED', fg: muted, bg: '#f4f1ec' },
};

/**
 * CorrespondencePanel — the scheduled client-email series on a matter.
 * Starling drafts and alerts; the lawyer reviews, copies into their own
 * email client (or uses the mailto link), and marks the item sent. Nothing
 * here transmits mail.
 */
export function CorrespondencePanel({ matterId, clientEmail }: {
  matterId: string;
  clientEmail?: string;
}) {
  const [items, setItems] = useState<CorrespondenceItemShape[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [weeks, setWeeks] = useState(6);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  const refresh = async () => {
    try {
      const res = await fetch(`/api/employment/${matterId}/correspondence`);
      const json = await res.json();
      if (json.ok) {
        setItems(json.correspondence ?? []);
        if (json.config?.followUpWeeks) setWeeks(json.config.followUpWeeks);
      }
    } catch { /* transient */ }
    setLoaded(true);
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [matterId]);

  const call = async (path: string, options?: RequestInit) => {
    setBusy(true); setMessage('');
    try {
      const res = await fetch(path, options);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setMessage(json.error ?? 'The request failed.');
      await refresh();
    } catch {
      setMessage('The request failed. Check the connection and retry.');
    } finally {
      setBusy(false);
    }
  };

  const start = () => call(`/api/employment/${matterId}/correspondence/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sequence: 'mitigation', followUpWeeks: weeks }),
  });

  const buildDraft = (id: string) => call(`/api/employment/${matterId}/correspondence/${id}/draft`, { method: 'POST' });

  const saveDraft = async (id: string) => {
    await call(`/api/employment/${matterId}/correspondence/${id}/draft`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: editSubject, body: editBody }),
    });
    setEditing(null);
  };

  const setStatus = (id: string, status: 'sent' | 'skipped') =>
    call(`/api/employment/${matterId}/correspondence/${id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

  const copyDraft = async (item: CorrespondenceItemShape) => {
    if (!item.draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${item.draft.subject}\n\n${item.draft.body}`);
      setMessage('Draft copied to the clipboard.');
    } catch {
      setMessage('Copy failed; select the text manually.');
    }
  };

  const mailtoHref = (item: CorrespondenceItemShape) => {
    if (!item.draft) return undefined;
    const to = clientEmail ? encodeURIComponent(clientEmail) : '';
    return `mailto:${to}?subject=${encodeURIComponent(item.draft.subject)}&body=${encodeURIComponent(item.draft.body)}`;
  };

  if (!loaded) return <p style={{ color: muted, fontSize: 13 }}>Loading correspondence…</p>;

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px' }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        Client correspondence
      </div>
      <p style={{ fontSize: 12.5, color: muted, margin: '0 0 12px' }}>
        Starling drafts and tracks the schedule; every email is reviewed and sent by the lawyer.
        Due items appear on the docket, in the weekly digest, and under next steps.
      </p>

      {items.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: ink }}>
            Follow-up window{' '}
            <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} style={{ fontFamily: sans, fontSize: 13, padding: '4px 6px' }}>
              <option value={6}>6 weeks</option>
              <option value={7}>7 weeks</option>
              <option value={8}>8 weeks</option>
            </select>
          </label>
          <ActionButton label={busy ? 'Starting…' : 'Start the mitigation email series'} onClick={busy ? undefined : start} />
        </div>
      )}

      {items.map(item => (
        <div key={item.id} style={{ border: `1px solid ${border}`, padding: '12px 14px', marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 3, color: CORR_STATUS[item.status].fg, background: CORR_STATUS[item.status].bg }}>
              {CORR_STATUS[item.status].label}
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>{item.title}</span>
            <span style={{ fontSize: 12.5, color: muted }}>due {item.dueDate}</span>
          </div>

          {editing === item.id ? (
            <div style={{ marginTop: 10 }}>
              <input
                value={editSubject}
                onChange={e => setEditSubject(e.target.value)}
                style={{ width: '100%', fontFamily: sans, fontSize: 13, padding: '6px 8px', border: `1px solid ${border}`, boxSizing: 'border-box', marginBottom: 6 }}
                aria-label="Email subject"
              />
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                style={{ width: '100%', minHeight: 220, fontFamily: sans, fontSize: 13, lineHeight: 1.5, padding: '8px 10px', border: `1px solid ${border}`, boxSizing: 'border-box' }}
                aria-label="Email body"
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <ActionButton label="Save draft" onClick={() => void saveDraft(item.id)} />
                <ActionButton label="Cancel" onClick={() => setEditing(null)} />
              </div>
            </div>
          ) : item.draft ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: navy }}>Subject: {item.draft.subject}</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: sans, fontSize: 13, lineHeight: 1.55, color: ink, background: '#faf9f7', border: `1px solid ${border}`, padding: '10px 12px', marginTop: 6, maxHeight: 260, overflowY: 'auto' }}>
                {item.draft.body}
              </pre>
              {item.draft.attachmentHint && (
                <p style={{ fontSize: 12.5, color: '#8a5a00', background: '#fdf0dd', padding: '6px 10px', margin: '6px 0 0' }}>
                  Attachment: {item.draft.attachmentHint}
                </p>
              )}
            </div>
          ) : null}

          {item.status !== 'sent' && item.status !== 'skipped' && editing !== item.id && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {!item.draft && <ActionButton label={busy ? 'Working…' : 'Draft this email'} onClick={busy ? undefined : () => void buildDraft(item.id)} />}
              {item.draft && (
                <>
                  <ActionButton label="Copy" onClick={() => void copyDraft(item)} />
                  <a href={mailtoHref(item)} style={{ fontSize: 12.5, fontWeight: 600, color: navy, textDecoration: 'underline', alignSelf: 'center' }}>
                    Open in email client
                  </a>
                  <ActionButton label="Edit" onClick={() => { setEditing(item.id); setEditSubject(item.draft!.subject); setEditBody(item.draft!.body); }} />
                  <ActionButton label="Mark sent" onClick={() => void setStatus(item.id, 'sent')} />
                </>
              )}
              <ActionButton label="Skip" onClick={() => void setStatus(item.id, 'skipped')} />
            </div>
          )}
        </div>
      ))}

      {message && <p style={{ fontSize: 12.5, color: muted, marginTop: 8 }} role="status">{message}</p>}
    </div>
  );
}

// ── Case comparables (internal research: closest decided cases) ─────────

interface ComparableCaseShape {
  id: string;
  caseName: string;
  citation: string;
  court: string | null;
  year: number | null;
  yearsOfService: number | null;
  age: number | null;
  monthsAwarded: number | null;
}

/**
 * ComparablesPanel — the closest decided Ontario cases to this matter's
 * Bardal profile plus the case-based notice range, from the shared
 * DemandPay case library. Renders nothing when the library is not
 * configured; renders guidance when intake lacks tenure.
 */
export function ComparablesPanel({ matterId }: { matterId: string }) {
  const [data, setData] = useState<{
    configured: boolean;
    reason?: string;
    profile?: { years: number; age: number | null };
    range?: { lowMonths: number; midMonths: number; highMonths: number; basedOnCases: number } | null;
    comparables?: ComparableCaseShape[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/employment/${matterId}/comparables`)
      .then(r => r.json())
      .then(json => { if (!cancelled && json.ok) setData(json); })
      .catch(() => { /* silent: research view is best-effort */ });
    return () => { cancelled = true; };
  }, [matterId]);

  if (!data || !data.configured) return null;

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginTop: 16 }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        Comparable decisions
      </div>
      <p style={{ fontSize: 12.5, color: muted, margin: '0 0 10px' }}>
        The closest decided cases in the firm's library to this matter's profile
        {data.profile ? ` (${data.profile.years} years${data.profile.age ? `, age ${data.profile.age}` : ''})` : ''}.
        Research aid only; every case should be read before it is relied on.
      </p>

      {data.range && (
        <div style={{ background: '#eef1f6', borderLeft: `3px solid ${navy}`, padding: '10px 14px', marginBottom: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: navy }}>
            Case-based range: {data.range.lowMonths}{'–'}{data.range.highMonths} months
          </span>
          <span style={{ fontSize: 12.5, color: muted }}>
            {' '}(median {data.range.midMonths}; middle band of the {data.range.basedOnCases} nearest outcomes)
          </span>
        </div>
      )}

      {(data.comparables ?? []).length === 0 && (
        <p style={{ fontSize: 12.5, color: muted }}>{data.reason ?? 'No sufficiently similar cases in the library yet.'}</p>
      )}

      {(data.comparables ?? []).map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderTop: `1px solid ${border}`, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: ink }}>{c.caseName}</span>
          <span style={{ fontSize: 12, color: muted }}>{c.citation}{c.year ? ` (${c.year})` : ''}</span>
          <span style={{ fontSize: 12, color: muted }}>
            {c.yearsOfService != null ? `${c.yearsOfService} yrs` : ''}{c.age != null ? `, age ${c.age}` : ''}
          </span>
          {c.monthsAwarded != null && (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: navy, marginLeft: 'auto' }}>
              {c.monthsAwarded} months
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Negotiation ledger ───────────────────────────────────────────────────

interface NegotiationEntryShape {
  id: string;
  date: string;
  party: 'employer' | 'client';
  kind: string;
  amountCad: number | null;
  terms?: string;
  note?: string;
}

interface NegotiationSummaryShape {
  latestEmployerOffer: { amountCad: number; date: string } | null;
  offerVsRange: {
    esaFloorCad: number | null;
    assessedLowCad: number | null;
    assessedHighCad: number | null;
    gapToLowCad: number | null;
    positionInRange: number | null;
  } | null;
  employerMovementCad: number | null;
  awaitingResponseFrom: 'employer' | 'client' | null;
}

const cad = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;

/**
 * NegotiationPanel — every offer and counter on the matter, tracked against
 * the assessed entitlement range. Facts only; strategy stays with the lawyer.
 */
// ── Matter Debrief ────────────────────────────────────────────────────────

interface DebriefActionItem {
  id: string;
  task: string;
  owner: 'lawyer' | 'client' | 'other';
  dueDate: string | null;
  kind: 'task' | 'email' | 'call' | 'filing' | 'document';
  context: string;
  status: 'open' | 'done';
  emailSubject?: string;
  emailBody?: string;
}
interface DebriefEntryShape {
  id: string;
  createdAt: string;
  callType: string;
  summary: string;
  actionItems: DebriefActionItem[];
}
// The reviewable proposal (no ids/status yet).
type ProposedItem = Omit<DebriefActionItem, 'id' | 'status'>;

const KIND_LABEL: Record<DebriefActionItem['kind'], string> = {
  task: 'Task', email: 'Email', call: 'Call', filing: 'Filing', document: 'Document',
};

/**
 * Fields whose approval makes a cause of action pleadable in the claim.
 * Shared by the extraction review and the debrief, so ticking one says the
 * same thing wherever it happens.
 */
export const CAUSE_TRIGGER_LABELS: Record<string, string> = {
  defamatory_statements: 'Defamation',
  privacy_breach: 'Intrusion upon Seclusion',
  common_employer: 'Common Employer liability',
  unjust_enrichment: 'Unjust Enrichment',
  iims: 'Intentional Infliction of Mental Suffering',
  employer_initiated_recruitment: 'Inducement',
  had_prior_secure_employment: 'Inducement',
  promises_not_fulfilled: 'Negligent Misrepresentation',
  false_cause_alleged: 'Bad Faith (false cause)',
  clause_cause_broader: 'the Termination Clause attack (cause standard ground)',
  clause_no_benefits: 'the Termination Clause attack (benefits ground)',
  clause_limits_below_esa: 'the Termination Clause attack (ESA minimum ground)',
};

export function DebriefPanel({ matterId, clientEmail }: { matterId: string; clientEmail?: string }) {
  const [debriefs, setDebriefs] = useState<DebriefEntryShape[]>([]);
  const [notes, setNotes] = useState('');
  const [callType, setCallType] = useState('client');
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState('');
  // Review state: the proposed summary + items, editable before saving.
  const [review, setReview] = useState<{
    summary: string;
    items: ProposedItem[];
    direction: Array<{ text: string; kind: string; checked: boolean }>;
    fields: Array<{ name: string; value: string | number | boolean; sourceQuote?: string; checked: boolean }>;
  } | null>(null);

  const inputStyle: CSSProperties = { fontSize: 13, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink };
  const btn = (bg: string): CSSProperties => ({ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, border: 'none', background: bg, color: '#fff', cursor: 'pointer' });

  const refresh = async () => {
    try {
      const res = await fetch(`/api/employment/${matterId}`);
      const json = await res.json();
      if (json.ok) setDebriefs(json.debriefs ?? []);
    } catch { /* transient */ }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [matterId]);

  const analyze = async () => {
    if (notes.trim().length === 0) return;
    setAnalyzing(true); setMessage('');
    try {
      const res = await fetch(`/api/employment/${matterId}/debrief/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawNotes: notes, callType }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setMessage(json.error ?? 'Could not analyze the notes.'); setAnalyzing(false); return; }
      setReview({
        summary: json.proposed.summary,
        items: json.proposed.actionItems.map((it: ProposedItem) => ({ ...it })),
        // Both streams arrive UNCHECKED: an instruction heard on a call is
        // one click from binding every draft, and a cause-trigger fact is
        // one click from a pleadable claim. Those clicks are the lawyer's.
        direction: (json.proposed.proposedDirection ?? []).map((d: { text: string; kind: string }) => ({ ...d, checked: false })),
        fields: Object.entries(json.proposed.proposedIntakeFields ?? {}).map(([name, f]) => {
          const field = f as { value: string | number | boolean; sourceQuote?: string };
          return { name, value: field.value, sourceQuote: field.sourceQuote, checked: false };
        }),
      });
    } catch { setMessage('Could not analyze the notes.'); }
    setAnalyzing(false);
  };

  const updateItem = (idx: number, patch: Partial<ProposedItem>) => {
    setReview(r => r ? { ...r, items: r.items.map((it, i) => i === idx ? { ...it, ...patch } : it) } : r);
  };
  const removeItem = (idx: number) => setReview(r => r ? { ...r, items: r.items.filter((_, i) => i !== idx) } : r);
  const addItem = () => setReview(r => r ? { ...r, items: [...r.items, { task: '', owner: 'lawyer', dueDate: null, kind: 'task', context: '' }] } : r);

  const approve = async () => {
    if (!review) return;
    setMessage('');
    const items = review.items.filter(it => it.task.trim().length > 0);
    try {
      const res = await fetch(`/api/employment/${matterId}/debrief`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callType, summary: review.summary, actionItems: items,
          directionInstructions: review.direction.filter(d => d.checked).map(d => ({ text: d.text, kind: d.kind })),
          intakeFields: Object.fromEntries(review.fields.filter(f => f.checked).map(f => [f.name, f.value])),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) { setMessage(json.error ?? 'Could not save the debrief.'); return; }
      setReview(null); setNotes('');
      const bits = [`${json.scheduled} item${json.scheduled === 1 ? '' : 's'} on the docket`];
      if (json.emailDrafts) bits.push(`${json.emailDrafts} email draft${json.emailDrafts === 1 ? '' : 's'}`);
      if (json.directionAdded) bits.push(`${json.directionAdded} direction instruction${json.directionAdded === 1 ? '' : 's'} now binding every draft`);
      if ((json.fieldsApplied ?? []).length) bits.push(`${json.fieldsApplied.length} fact${json.fieldsApplied.length === 1 ? '' : 's'} on the client file`);
      setMessage(`Saved. ${bits.join(', ')}.${json.analysisStale ? ' The analysis is now stale; re-run it when convenient.' : ''}`);
      await refresh();
    } catch { setMessage('Could not save the debrief.'); }
  };

  const toggle = async (itemId: string, status: 'open' | 'done') => {
    await fetch(`/api/employment/${matterId}/debrief/${itemId}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }).catch(() => undefined);
    await refresh();
  };

  const mailto = (subject?: string, body?: string) =>
    `mailto:${clientEmail ?? ''}?subject=${encodeURIComponent(subject ?? '')}&body=${encodeURIComponent(body ?? '')}`;

  return (
    <div>
      <p style={{ fontSize: 12.5, color: '#5b6472', marginBottom: 14 }}>
        Paste your notes from a call. Starling proposes a summary and action items with dates for you to review. Nothing is scheduled or sent until you approve it.
      </p>

      {!review && (
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: 16, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <select value={callType} onChange={e => setCallType(e.target.value)} style={inputStyle}>
              <option value="client">Client call</option>
              <option value="opposing">Opposing counsel</option>
              <option value="internal">Internal</option>
              <option value="other">Other</option>
            </select>
          </div>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)} rows={7}
            placeholder="e.g. Spoke with Dana. She wants to counter the 12-week offer. Employer alleged cause but has no warning letters. Send counter by next Friday. She will send her job-search log this week..."
            style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ marginTop: 10 }}>
            <button onClick={analyze} disabled={analyzing || notes.trim().length === 0} style={{ ...btn(navy), opacity: analyzing || notes.trim().length === 0 ? 0.5 : 1 }}>
              {analyzing ? 'Analyzing...' : 'Summarize and extract action items'}
            </button>
          </div>
        </div>
      )}

      {review && (
        <div style={{ background: '#fff', border: `1px solid ${orange}`, padding: 16, marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: orange, letterSpacing: 0.5, marginBottom: 10 }}>REVIEW BEFORE SAVING</div>
          <label style={{ fontSize: 12, fontWeight: 600, color: ink }}>Summary</label>
          <textarea value={review.summary} onChange={e => setReview(r => r ? { ...r, summary: e.target.value } : r)} rows={3}
            style={{ ...inputStyle, width: '100%', margin: '4px 0 16px', resize: 'vertical', fontFamily: 'inherit' }} />

          <div style={{ fontSize: 12, fontWeight: 600, color: ink, marginBottom: 8 }}>Action items</div>
          {review.items.map((it, idx) => (
            <div key={idx} style={{ border: `1px solid ${border}`, borderRadius: 2, padding: 12, marginBottom: 10 }}>
              <input value={it.task} onChange={e => updateItem(idx, { task: e.target.value })} placeholder="Task" style={{ ...inputStyle, width: '100%', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <select value={it.owner} onChange={e => updateItem(idx, { owner: e.target.value as ProposedItem['owner'] })} style={inputStyle}>
                  <option value="lawyer">Lawyer</option><option value="client">Client</option><option value="other">Other</option>
                </select>
                <select value={it.kind} onChange={e => updateItem(idx, { kind: e.target.value as ProposedItem['kind'] })} style={inputStyle}>
                  <option value="task">Task</option><option value="email">Email</option><option value="call">Call</option><option value="filing">Filing</option><option value="document">Document</option>
                </select>
                <input type="date" value={it.dueDate ?? ''} onChange={e => updateItem(idx, { dueDate: e.target.value || null })} style={inputStyle} />
                <button onClick={() => removeItem(idx)} style={{ ...btn('#fff'), color: red, border: `1px solid ${border}` }}>Remove</button>
              </div>
              {it.context && <div style={{ fontSize: 12, color: '#5b6472', marginBottom: it.kind === 'email' ? 8 : 0 }}>{it.context}</div>}
              {it.kind === 'email' && (
                <div style={{ background: cream, padding: 10, borderRadius: 2 }}>
                  <input value={it.emailSubject ?? ''} onChange={e => updateItem(idx, { emailSubject: e.target.value })} placeholder="Email subject" style={{ ...inputStyle, width: '100%', marginBottom: 6 }} />
                  <textarea value={it.emailBody ?? ''} onChange={e => updateItem(idx, { emailBody: e.target.value })} rows={4} placeholder="Draft (you review and send)" style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                </div>
              )}
            </div>
          ))}
          <button onClick={addItem} style={{ ...btn('#fff'), color: navy, border: `1px solid ${border}`, marginBottom: 12 }}>+ Add item</button>

          {review.direction.length > 0 && (
            <div style={{ borderTop: `1px solid ${border}`, paddingTop: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: ink, marginBottom: 3 }}>Direction heard on the call</div>
              <div style={{ fontSize: 11.5, color: '#5b6472', marginBottom: 8, lineHeight: 1.5 }}>
                Ticked instructions join the file's standing direction and bind every draft on this matter. Unticked ones are dropped.
              </div>
              {review.direction.map((d, i) => (
                <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: ink, marginBottom: 5, cursor: 'pointer' }}>
                  <input
                    type="checkbox" checked={d.checked}
                    onChange={() => setReview(r => r ? { ...r, direction: r.direction.map((x, j) => j === i ? { ...x, checked: !x.checked } : x) } : r)}
                    style={{ accentColor: navy, marginTop: 2 }}
                  />
                  <span>{d.text}</span>
                </label>
              ))}
            </div>
          )}

          {review.fields.length > 0 && (
            <div style={{ borderTop: `1px solid ${border}`, paddingTop: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: ink, marginBottom: 3 }}>Facts heard on the call</div>
              <div style={{ fontSize: 11.5, color: '#5b6472', marginBottom: 8, lineHeight: 1.5 }}>
                Ticked facts go on the client file, filling blanks only, with the quote from your notes as their source.
              </div>
              {review.fields.map((f, i) => (
                <label key={f.name} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: ink, marginBottom: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox" checked={f.checked}
                    onChange={() => setReview(r => r ? { ...r, fields: r.fields.map((x, j) => j === i ? { ...x, checked: !x.checked } : x) } : r)}
                    style={{ accentColor: navy, marginTop: 2 }}
                  />
                  <span style={{ flex: 1 }}>
                    <b>{f.name.replace(/_/g, ' ')}</b> = {String(f.value)}
                    {CAUSE_TRIGGER_LABELS[f.name] && f.value === true && (
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#b8860b' }}>
                        Approving this makes {CAUSE_TRIGGER_LABELS[f.name]} pleadable in the claim
                      </span>
                    )}
                    {f.sourceQuote && (
                      <span style={{ display: 'block', fontSize: 11.5, color: '#5b6472', fontStyle: 'italic' }}>"{f.sourceQuote}"</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={approve} style={btn(green)}>Approve and schedule</button>
            <button onClick={() => setReview(null)} style={{ ...btn('#fff'), color: '#5b6472', border: `1px solid ${border}` }}>Discard</button>
          </div>
        </div>
      )}

      {message && <div style={{ fontSize: 12.5, color: '#5b6472', marginBottom: 14 }}>{message}</div>}

      {debriefs.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: ink, letterSpacing: 0.4, margin: '4px 0 10px' }}>PAST DEBRIEFS</div>
          {[...debriefs].reverse().map(d => (
            <div key={d.id} style={{ background: '#fff', border: `1px solid ${border}`, padding: 16, marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#8a929e', marginBottom: 6 }}>{new Date(d.createdAt).toLocaleDateString()} · {d.callType} call</div>
              <div style={{ fontSize: 13, color: ink, marginBottom: 12 }}>{d.summary}</div>
              {d.actionItems.map(it => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderTop: `1px solid ${border}` }}>
                  <input type="checkbox" checked={it.status === 'done'} onChange={e => toggle(it.id, e.target.checked ? 'done' : 'open')} style={{ marginTop: 3 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: ink, textDecoration: it.status === 'done' ? 'line-through' : 'none', opacity: it.status === 'done' ? 0.55 : 1 }}>
                      {it.task}
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#5b6472', background: cream, padding: '2px 6px', borderRadius: 2 }}>{KIND_LABEL[it.kind]}</span>
                      {it.dueDate && <span style={{ marginLeft: 6, fontSize: 11, color: amber }}>due {it.dueDate}</span>}
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#8a929e' }}>· {it.owner}</span>
                    </div>
                    {it.kind === 'email' && it.emailBody && it.status !== 'done' && (
                      <a href={mailto(it.emailSubject, it.emailBody)} style={{ fontSize: 11.5, color: orange, textDecoration: 'none' }}>Open email draft</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NegotiationPanel({ matterId }: { matterId: string }) {
  const [entries, setEntries] = useState<NegotiationEntryShape[]>([]);
  const [summary, setSummary] = useState<NegotiationSummaryShape | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), party: 'employer', kind: 'offer', amount: '', terms: '' });

  const refresh = async () => {
    try {
      const res = await fetch(`/api/employment/${matterId}/negotiation`);
      const json = await res.json();
      if (json.ok) { setEntries(json.entries ?? []); setSummary(json.summary ?? null); }
    } catch { /* transient */ }
    setLoaded(true);
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [matterId]);

  const add = async () => {
    setMessage('');
    const amountNum = parseFloat(form.amount.replace(/[^\d.]/g, ''));
    try {
      const res = await fetch(`/api/employment/${matterId}/negotiation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date, party: form.party, kind: form.kind,
          amountCad: Number.isFinite(amountNum) ? amountNum : null,
          ...(form.terms.trim() ? { terms: form.terms.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setMessage(json.error ?? 'The entry could not be saved.'); return; }
      setForm(f => ({ ...f, amount: '', terms: '' }));
      await refresh();
    } catch { setMessage('The entry could not be saved.'); }
  };

  const remove = async (id: string) => {
    await fetch(`/api/employment/${matterId}/negotiation/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await refresh();
  };

  if (!loaded) return <p style={{ color: muted, fontSize: 13 }}>Loading negotiation…</p>;

  const r = summary?.offerVsRange;
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px' }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        Negotiation ledger
      </div>
      <p style={{ fontSize: 12.5, color: muted, margin: '0 0 12px' }}>
        Every offer and counter, against the assessed entitlement. Entries also appear on the timeline.
      </p>

      {summary?.latestEmployerOffer && (
        <div style={{ background: '#eef1f6', borderLeft: `3px solid ${navy}`, padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: navy }}>
            Latest employer offer: {cad(summary.latestEmployerOffer.amountCad)} ({summary.latestEmployerOffer.date})
          </div>
          {r && (
            <div style={{ fontSize: 12.5, color: ink, marginTop: 4 }}>
              {r.esaFloorCad != null && <>ESA floor {cad(r.esaFloorCad)} · </>}
              {r.assessedLowCad != null && r.assessedHighCad != null && (
                <>assessed range {cad(r.assessedLowCad)}{'–'}{cad(r.assessedHighCad)}
                {r.gapToLowCad != null && r.gapToLowCad > 0 && <> · <b style={{ color: red }}>{cad(r.gapToLowCad)} below the low end</b></>}
                {r.positionInRange != null && r.positionInRange >= 0 && <> · at {Math.round(r.positionInRange * 100)}% of the range</>}
                </>
              )}
            </div>
          )}
          {summary.employerMovementCad != null && (
            <div style={{ fontSize: 12.5, color: muted, marginTop: 2 }}>
              Employer movement to date: {summary.employerMovementCad >= 0 ? '+' : ''}{cad(summary.employerMovementCad)}
            </div>
          )}
          {summary.awaitingResponseFrom && (
            <div style={{ fontSize: 12.5, color: '#8a5a00', marginTop: 2 }}>
              Awaiting a move from the {summary.awaitingResponseFrom === 'client' ? 'client side' : 'employer'}.
            </div>
          )}
        </div>
      )}

      {entries.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderTop: `1px solid ${border}`, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: muted, minWidth: 78 }}>{e.date}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: e.party === 'employer' ? red : green, minWidth: 70 }}>
            {e.party.toUpperCase()}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: ink }}>
            {e.kind}{e.amountCad != null ? `: ${cad(e.amountCad)}` : ''}
          </span>
          {e.terms && <span style={{ fontSize: 12.5, color: muted }}>{e.terms}</span>}
          <button onClick={() => void remove(e.id)} aria-label={`Delete entry ${e.date}`} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: muted, cursor: 'pointer', fontSize: 12 }}>
            remove
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center', borderTop: `1px solid ${border}`, paddingTop: 12 }}>
        <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} aria-label="Entry date" style={{ fontFamily: sans, fontSize: 12.5, padding: '6px' }} />
        <select value={form.party} onChange={e => setForm(f => ({ ...f, party: e.target.value }))} aria-label="Party" style={{ fontFamily: sans, fontSize: 12.5, padding: '6px' }}>
          <option value="employer">Employer</option>
          <option value="client">Client</option>
        </select>
        <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} aria-label="Kind" style={{ fontFamily: sans, fontSize: 12.5, padding: '6px' }}>
          <option value="offer">Offer</option>
          <option value="counter">Counter</option>
          <option value="demand">Demand</option>
          <option value="acceptance">Acceptance</option>
          <option value="rejection">Rejection</option>
        </select>
        <input placeholder="Amount (CAD)" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} aria-label="Amount" style={{ fontFamily: sans, fontSize: 12.5, padding: '6px', width: 110 }} />
        <input placeholder="Terms (optional)" value={form.terms} onChange={e => setForm(f => ({ ...f, terms: e.target.value }))} aria-label="Terms" style={{ fontFamily: sans, fontSize: 12.5, padding: '6px', flex: 1, minWidth: 140 }} />
        <ActionButton label="Record" onClick={() => void add()} />
      </div>
      {message && <p style={{ fontSize: 12.5, color: red, marginTop: 6 }} role="alert">{message}</p>}
    </div>
  );
}

// ── Net-settlement calculator ───────────────────────────────────────────

interface NetSettlementLineShape {
  key: string;
  label: string;
  grossCad: number;
  withholdingCad: number | null;
  netCad: number | null;
  treatment: string;
}

interface NetSettlementResultShape {
  lines: NetSettlementLineShape[];
  totals: {
    grossSettlementCad: number;
    eligibleRrspRoomCad: number;
    appliedRrspTransferCad: number;
    withholdingCad: number;
    cashBeforeFeesCad: number;
    feeCad: number;
    feeHstCad: number;
    clientPaysFeesCad: number;
    netCashCad: number;
    netValueCad: number;
  };
  lumpSumWithholdingRatePct: number | null;
  flags: string[];
  notes: string[];
}

const numOrZero = (s: string): number => {
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function NetSettlementPanel({ matterId }: { matterId: string }) {
  const [result, setResult] = useState<NetSettlementResultShape | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    retiringAllowance: '', salaryContinuance: '', generalDamages: '',
    legalFeeContribution: '', rrspTransfer: '', yearsBefore1996: '',
    effectiveTaxRate: '', feePct: '',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/employment/${matterId}/net-settlement`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          if (json.result) setResult(json.result);
          if (json.inputs) {
            const i = json.inputs;
            setForm({
              retiringAllowance: i.allocation?.retiringAllowanceCad ? String(i.allocation.retiringAllowanceCad) : '',
              salaryContinuance: i.allocation?.salaryContinuanceCad ? String(i.allocation.salaryContinuanceCad) : '',
              generalDamages: i.allocation?.generalDamagesCad ? String(i.allocation.generalDamagesCad) : '',
              legalFeeContribution: i.allocation?.legalFeeContributionCad ? String(i.allocation.legalFeeContributionCad) : '',
              rrspTransfer: i.allocation?.rrspTransferCad ? String(i.allocation.rrspTransferCad) : '',
              yearsBefore1996: i.yearsBefore1996 ? String(i.yearsBefore1996) : '',
              effectiveTaxRate: i.effectiveTaxRatePct != null ? String(i.effectiveTaxRatePct) : '',
              feePct: i.feePct != null ? String(i.feePct) : '',
            });
          }
        }
      } catch { /* transient */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [matterId]);

  const calculate = async () => {
    setMessage('');
    const body: Record<string, unknown> = {
      allocation: {
        retiringAllowanceCad: numOrZero(form.retiringAllowance),
        salaryContinuanceCad: numOrZero(form.salaryContinuance),
        generalDamagesCad: numOrZero(form.generalDamages),
        legalFeeContributionCad: numOrZero(form.legalFeeContribution),
        ...(form.rrspTransfer.trim() ? { rrspTransferCad: numOrZero(form.rrspTransfer) } : {}),
      },
      ...(form.yearsBefore1996.trim() ? { yearsBefore1996: numOrZero(form.yearsBefore1996) } : {}),
      ...(form.effectiveTaxRate.trim() ? { effectiveTaxRatePct: numOrZero(form.effectiveTaxRate) } : {}),
      ...(form.feePct.trim() ? { feePct: numOrZero(form.feePct) } : {}),
    };
    try {
      const res = await fetch(`/api/employment/${matterId}/net-settlement`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setMessage(json.error ?? 'The calculation could not be saved.'); return; }
      setResult(json.result);
    } catch { setMessage('The calculation could not be saved.'); }
  };

  if (!loaded) return <p style={{ color: muted, fontSize: 13 }}>Loading net settlement…</p>;

  const fieldStyle = { fontFamily: sans, fontSize: 12.5, padding: '6px', width: 130 } as const;
  const t = result?.totals;

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginTop: 16 }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        Net settlement to the client
      </div>
      <p style={{ fontSize: 12.5, color: muted, margin: '0 0 12px' }}>
        Withholding at source, RRSP transfer room, and fees. A cash-flow estimate for negotiation planning, not tax advice.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        {([
          ['retiringAllowance', 'Lump-sum severance (CAD)'],
          ['salaryContinuance', 'Salary continuance (CAD)'],
          ['generalDamages', 'General damages (CAD)'],
          ['legalFeeContribution', 'Employer pays legal fees (CAD)'],
          ['rrspTransfer', 'RRSP transfer (CAD)'],
          ['yearsBefore1996', 'Years before 1996'],
          ['effectiveTaxRate', 'Effective tax rate %'],
          ['feePct', 'Fee %'],
        ] as Array<[keyof typeof form, string]>).map(([key, label]) => (
          <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: muted }}>
            {label}
            <input
              inputMode="decimal"
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              style={fieldStyle}
            />
          </label>
        ))}
        <ActionButton label="Calculate" onClick={() => void calculate()} />
      </div>

      {message && <p style={{ fontSize: 12.5, color: red, marginTop: 6 }} role="alert">{message}</p>}

      {result && t && (
        <>
          <div style={{ background: '#eef1f6', borderLeft: `3px solid ${navy}`, padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: navy }}>
              Net cash to client: {cad(t.netCashCad)}
              {t.appliedRrspTransferCad > 0 && <> · plus {cad(t.appliedRrspTransferCad)} to RRSP = {cad(t.netValueCad)} total value</>}
            </div>
            <div style={{ fontSize: 12.5, color: ink, marginTop: 4 }}>
              Gross {cad(t.grossSettlementCad)} · withholding {cad(t.withholdingCad)}
              {t.clientPaysFeesCad > 0 && <> · client pays the firm {cad(t.clientPaysFeesCad)} (fee {cad(t.feeCad)} + HST {cad(t.feeHstCad)})</>}
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: muted }}>
                <th style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>Component</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Gross</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Withholding</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map(line => (
                <tr key={line.key} style={{ borderTop: `1px solid ${border}` }} title={line.treatment}>
                  <td style={{ padding: '6px 8px 6px 0', color: ink }}>{line.label}</td>
                  <td style={{ padding: '6px 8px' }}>{cad(line.grossCad)}</td>
                  <td style={{ padding: '6px 8px' }}>{line.withholdingCad != null ? cad(line.withholdingCad) : 'payroll'}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{line.netCad != null ? cad(line.netCad) : 'depends on payroll'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.flags.map((flag, i) => (
            <p key={`flag-${i}`} style={{ fontSize: 12.5, color: '#8a5a00', background: '#fdf6e7', padding: '8px 12px', margin: '10px 0 0' }}>
              {flag}
            </p>
          ))}
          {result.notes.map((note, i) => (
            <p key={`note-${i}`} style={{ fontSize: 12, color: muted, margin: '8px 0 0' }}>
              {note}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
