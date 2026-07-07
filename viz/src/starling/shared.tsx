/**
 * shared.tsx — Starling design tokens and components shared between the
 * employment matter view and the labour (grievance) matter view.
 *
 * Extracted from MatterDetailView so the labour vertical reuses the same
 * gate-approval and draft-preview UI instead of forking it.
 */

import { useState, useEffect } from 'react';

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
}

export function GeneratedDocsPanel({ docs, onSetStatus }: GeneratedDocsPanelProps) {
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
            <div style={{ display: 'flex', gap: 6 }}>
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
    return (
      <button
        onClick={reopen}
        disabled={busy}
        style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13.5, fontWeight: 600, padding: '11px 18px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
      >
        {busy ? 'Reopening...' : 'Reopen matter'}
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
