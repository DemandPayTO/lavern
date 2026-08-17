// Factum argument picker: which of the firm's Part III argument sections this
// factum will argue, driven by the matter's approved issues, with force on/off.
// Mirrors the SOC pleading picker. State stays in the parent (Option A).

import { navy, green, amber, border, ink, muted, sans } from '../tokens.js';

export type FactumSection = {
  blockId: string;
  sectionHeader: string;
  issueLabel: string;
  authorities: string;
  status: 'firing' | 'eligible_unapproved' | 'off' | 'forced_on' | 'forced_off';
  reason: string;
  forceable: boolean;
  lawyerReview: boolean;
};

export function FactumArgumentOptions({
  sections, setFactumOverride,
}: {
  sections: FactumSection[];
  setFactumOverride: (blockId: string, override: 'on' | 'off' | null) => void;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>What this factum argues (Part III)</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
        Each legal issue is argued in the firm's settled way, selected by the facts on file and your approved issues. Turning one on that the intake never raised gives you the argument structure to complete, never invented facts. The firm's argument language for each is under Teach the argument below.
      </div>
      {sections.map(s => {
        const on = s.status === 'firing' || s.status === 'forced_on';
        const chip = s.status === 'firing' ? { label: 'ARGUED', bg: '#e8f2e8', fg: green }
          : s.status === 'forced_on' ? { label: 'FORCED ON', bg: '#e8f2e8', fg: green }
          : s.status === 'eligible_unapproved' ? { label: 'FACTS SUPPORT IT', bg: '#fdf0dd', fg: amber }
          : s.status === 'forced_off' ? { label: 'FORCED OFF', bg: '#f3f3f3', fg: muted }
          : { label: 'OFF', bg: '#f3f3f3', fg: muted };
        return (
          <div key={s.blockId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', borderTop: `1px solid #f0ede8` }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: chip.fg, background: chip.bg, padding: '2px 7px', borderRadius: 2, minWidth: 86, textAlign: 'center', marginTop: 2 }}>{chip.label}</span>
            <span style={{ flex: 1, fontSize: 12.5, color: on ? ink : muted }}>
              <span style={{ fontWeight: 600 }}>{s.sectionHeader}</span>
              {s.authorities && <span style={{ color: muted }}> · {s.authorities}</span>}
              <span style={{ display: 'block', fontSize: 11.5, color: muted, lineHeight: 1.45 }}>{s.reason}</span>
            </span>
            {s.status !== 'firing' && s.forceable && (
              <button
                onClick={() => setFactumOverride(s.blockId, s.status === 'forced_on' || s.status === 'forced_off' ? null : 'on')}
                style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: `1px solid ${border}`, color: navy, cursor: 'pointer', padding: '3px 9px', borderRadius: 2 }}
              >
                {s.status === 'forced_on' || s.status === 'forced_off' ? 'reset' : 'force on'}
              </button>
            )}
            {(s.status === 'firing' || s.status === 'eligible_unapproved') && s.forceable && (
              <button
                onClick={() => setFactumOverride(s.blockId, 'off')}
                aria-label={`Turn off ${s.sectionHeader}`}
                style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '3px 4px' }}
              >
                turn off
              </button>
            )}
            {s.status === 'forced_off' && (
              <button
                onClick={() => setFactumOverride(s.blockId, null)}
                aria-label={`Turn ${s.sectionHeader} back on`}
                style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: `1px solid ${border}`, color: navy, cursor: 'pointer', padding: '3px 9px', borderRadius: 2 }}
              >
                turn back on
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
