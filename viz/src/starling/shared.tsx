/**
 * shared.tsx — Starling design tokens and components shared between the
 * employment matter view and the labour (grievance) matter view.
 *
 * Extracted from MatterDetailView so the labour vertical reuses the same
 * gate-approval and draft-preview UI instead of forking it.
 */

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
  subheading = "Only approved issues are included in generated documents. Your call — Starling drafts nothing you haven't approved.",
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
                  <div style={{ fontSize: 11.5, color: muted }}>{c.sourceType} — {c.trustLevel} trust</div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
