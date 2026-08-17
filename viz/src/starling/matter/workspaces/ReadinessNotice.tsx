// The "before you generate" readiness checklist for the demand letter and
// mediation brief: triaged items with a jump-to-fix link. Extracted verbatim
// from MatterDetailView.tsx's draft tab (Option A).

import { orange, green, amber, border, ink, muted, sans } from '../tokens.js';

type TabKey = 'issues' | 'docs' | 'draft' | 'timeline' | 'intake' | 'client' | 'negotiation' | 'debrief' | 'notes';
type ReadinessItem = { level: 'ok' | 'warn' | 'info'; label: string; hint?: string; goTo?: string };

export function ReadinessNotice({
  readiness, setActiveTab,
}: {
  readiness: ReadinessItem[];
  setActiveTab: React.Dispatch<React.SetStateAction<TabKey>>;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 6 }}>
        Before you generate
        {readiness.some(r => r.level === 'warn') && (
          <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: amber, background: '#fdf0dd', padding: '2px 7px', borderRadius: 2 }}>
            {readiness.filter(r => r.level === 'warn').length} TO FIX
          </span>
        )}
      </div>
      {readiness.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0', fontSize: 12.5 }}>
          <span aria-hidden="true" style={{ color: r.level === 'ok' ? green : r.level === 'warn' ? amber : muted, fontWeight: 700, minWidth: 14 }}>
            {r.level === 'ok' ? '✓' : r.level === 'warn' ? '!' : '·'}
          </span>
          <span style={{ color: r.level === 'warn' ? ink : muted, flex: 1 }}>
            <span style={{ fontWeight: r.level === 'warn' ? 600 : 400 }}>{r.label}</span>
            {r.hint && <span> {r.hint}</span>}
            {r.goTo && r.level !== 'ok' && (
              <button
                onClick={() => setActiveTab(r.goTo as TabKey)}
                style={{ marginLeft: 6, fontSize: 12, color: orange, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontFamily: sans }}
              >
                fix it
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
