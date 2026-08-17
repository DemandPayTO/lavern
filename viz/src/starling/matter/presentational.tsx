// Pure presentational pieces of the Starling matter workspace, extracted from
// MatterDetailView.tsx. No matter state of their own — tokens in, props in,
// markup out.

import { navy, orange, cream, green, amber, border, ink, muted, serif, sans } from './tokens.js';
import type { DocItem } from './types.js';

// ── Review-flag triage ──────────────────────────────────────────────────

export function triageFlag(flag: string): 'fix' | 'check' | 'fyi' {
  if (/departs from your direction|has no amount|differs materially|\[LAWYER:|needs:|could not|no closing|left standing|is not a field|would break/i.test(flag)) return 'fix';
  if (/read it against a recent example|style profiles guide|verify all facts|itemises the heads from your direction|drafted in the firm style/i.test(flag)) return 'fyi';
  return 'check';
}

const FLAG_GROUPS: Array<{ key: 'fix' | 'check' | 'fyi'; label: string; colour: string; bg: string }> = [
  { key: 'fix', label: 'Fix before sending', colour: '#b3372f', bg: '#fbeae8' },
  { key: 'check', label: 'Check against the file', colour: '#b8860b', bg: '#fdf0dd' },
  { key: 'fyi', label: 'For the record', colour: '#5b6472', bg: '#f4f1ec' },
];

export function TriagedFlags({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  const grouped = FLAG_GROUPS
    .map(g => ({ ...g, items: flags.filter(f => triageFlag(f) === g.key) }))
    .filter(g => g.items.length > 0);
  return (
    <div style={{ marginTop: 12 }}>
      {grouped.map(g => (
        <div key={g.key} style={{ background: g.bg, border: `1px solid ${g.colour}33`, borderRadius: 2, padding: '10px 16px', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: g.colour, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {g.label} ({g.items.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: ink, lineHeight: 1.65 }}>
            {g.items.map((flag, i) => <li key={i}>{flag}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

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

// ── Colour-coded dot ────────────────────────────────────────────────────

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

// ── Source tag with coloured dot ─────────────────────────────────────────

export function SourceTag({ label, type }: { label: string; type: 'verified' | 'statute' | 'web' | 'ai' }) {
  const style = getSourceStyle(type);
  const dotColour = type === 'verified' ? green : type === 'web' ? amber : type === 'statute' ? navy : muted;

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

// ── Matter top bar (reused in loading / not-found states) ────────────────

export function MatterDetailTopBar() {
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

// ── Header fact cell ─────────────────────────────────────────────────────

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

// ── Document list row ────────────────────────────────────────────────────

export function DocRow({ doc }: { doc: DocItem }) {
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

// ── Bottom action-bar button ─────────────────────────────────────────────

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

/** Render text with specified substrings bolded. */
export function renderBoldText(text: string, boldParts: string[]): React.ReactNode {
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
