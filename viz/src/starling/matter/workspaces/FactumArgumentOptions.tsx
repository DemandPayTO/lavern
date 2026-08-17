// Factum argument picker: which of the firm's Part III argument sections this
// factum will argue, driven by the matter's approved issues, with force on/off.
// Mirrors the SOC pleading picker. State stays in the parent (Option A).

import { useState } from 'react';
import { navy, orange, green, amber, red, border, ink, muted, sans } from '../tokens.js';

export type FactumSection = {
  blockId: string;
  sectionHeader: string;
  issueLabel: string;
  authorities: string;
  status: 'firing' | 'eligible_unapproved' | 'off' | 'forced_on' | 'forced_off';
  reason: string;
  forceable: boolean;
  lawyerReview: boolean;
  custom: boolean;
};

export function FactumArgumentOptions({
  sections, setFactumOverride, addCustomSection, removeCustomSection,
}: {
  sections: FactumSection[];
  setFactumOverride: (blockId: string, override: 'on' | 'off' | null) => void;
  addCustomSection: (sectionHeader: string, guidance: string, authorities: string) => Promise<void>;
  removeCustomSection: (blockId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newHeader, setNewHeader] = useState('');
  const [newGuidance, setNewGuidance] = useState('');
  const [newAuthorities, setNewAuthorities] = useState('');
  const [busy, setBusy] = useState(false);
  const canAdd = newHeader.trim().length >= 2 && newGuidance.trim().length >= 10;

  const submit = async () => {
    if (!canAdd || busy) return;
    setBusy(true);
    try {
      await addCustomSection(newHeader.trim(), newGuidance.trim(), newAuthorities.trim());
      setNewHeader(''); setNewGuidance(''); setNewAuthorities(''); setAdding(false);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>What this factum argues (Part III)</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
        This is the factum's outline. Each legal issue is argued in the firm's settled way, selected by the facts on file and your approved issues. Turn one on that the intake never raised to include it, or add your own section below. The firm's argument language for each is under Teach the argument.
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
            {s.custom && (
              <button
                onClick={() => removeCustomSection(s.blockId)}
                aria-label={`Remove ${s.sectionHeader} from the firm library`}
                title="Remove this custom section from the firm library"
                style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: red, cursor: 'pointer', padding: '3px 4px' }}
              >
                remove
              </button>
            )}
          </div>
        );
      })}

      {/* Add your own section to the outline. It is saved to the firm library
          and reusable on future factums. */}
      <div style={{ borderTop: `1px solid ${border}`, marginTop: 10, paddingTop: 10 }}>
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
          >
            Add a section
          </button>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: muted, marginBottom: 8, lineHeight: 1.5 }}>
              State a section the factum must address and what it should argue. Starling writes it into Part III with the others, and saves it to the firm library so it is one click on the next factum.
            </div>
            <input
              value={newHeader}
              onChange={e => setNewHeader(e.target.value)}
              placeholder="Section heading, e.g. Fixed-term contract: no duty to mitigate"
              aria-label="Section heading"
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13.5, padding: '9px 11px', border: `1px solid ${border}`, borderRadius: 2, color: ink, marginBottom: 8 }}
            />
            <textarea
              value={newGuidance}
              onChange={e => setNewGuidance(e.target.value)}
              rows={4}
              placeholder="What this section should argue: the test, the key authorities, and how it applies to this plaintiff."
              aria-label="What the section argues"
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical', marginBottom: 8 }}
            />
            <input
              value={newAuthorities}
              onChange={e => setNewAuthorities(e.target.value)}
              placeholder="Authorities to cite (optional), e.g. Howard v Benson Group Inc, 2016 ONCA 256"
              aria-label="Authorities"
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 12.5, padding: '8px 11px', border: `1px solid ${border}`, borderRadius: 2, color: ink, marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => void submit()}
                disabled={!canAdd || busy}
                style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 16px', borderRadius: 2, fontFamily: sans, background: canAdd && !busy ? orange : '#b0b0b0', color: '#fff', border: 'none', cursor: canAdd && !busy ? 'pointer' : 'not-allowed' }}
              >
                {busy ? 'Adding…' : 'Add to the factum'}
              </button>
              <button
                onClick={() => { setAdding(false); setNewHeader(''); setNewGuidance(''); setNewAuthorities(''); }}
                style={{ fontSize: 12.5, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
              >
                Cancel
              </button>
              {!canAdd && (newHeader || newGuidance) && (
                <span style={{ fontSize: 11.5, color: muted }}>A heading and a note on what it argues are both needed.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
