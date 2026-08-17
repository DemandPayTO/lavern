// Statement of Claim workspace options: what the claim reads before it drafts
// (the demand letter on file plus an optional attached source), and the
// pleading picker showing each cause of action's status with force-on/off.
// Extracted verbatim from MatterDetailView.tsx's draft tab (Option A).

import { navy, green, amber, border, ink, muted, sans } from '../tokens.js';
import { useEmploymentData } from '../../hooks/useStarlingApi.js';

type Employment = ReturnType<typeof useEmploymentData>;
type SourceSlot = 'rebuttal-source' | 'rebuttal-feedback' | 'soc-source' | 'defence-source' | 'claim-source';
type SocNode = {
  blockId: string; sectionHeader: string; tier: 1 | 2; lawyerReview: boolean;
  status: 'firing' | 'eligible_unapproved' | 'off' | 'forced_on' | 'forced_off';
  forceable?: boolean; reason: string; unanswered: string[];
};

export function SocPleadingOptions({
  employment, sessionId, socSourceInputRef, rebuttalSaving, attachRebuttalFile,
  socNodes, setSocOverride,
}: {
  employment: Employment;
  sessionId: string | null;
  socSourceInputRef: React.RefObject<HTMLInputElement | null>;
  rebuttalSaving: boolean;
  attachRebuttalFile: (file: File, slot?: SourceSlot) => void;
  socNodes: SocNode[];
  setSocOverride: (blockId: string, override: 'on' | 'off' | null) => void;
}) {
  return (
    <>
      <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>What the claim reads before it drafts</div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.55 }}>
          Blanks the intake cannot fill are looked up in these documents; every fill carries the quote it came from as a review flag, and anything no document answers stays marked [LAWYER: ...] rather than guessed.
        </div>
        <div style={{ fontSize: 13, color: ink, marginBottom: 8 }}>
          {employment.demandLetterOnFile
            ? '✓ The demand letter on this matter is included automatically.'
            : 'No demand letter is on this matter yet. Generate one, or adopt yours in the Demand Letter workspace, and the claim will read it.'}
        </div>
        {employment.socSource ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13, color: ink }}>
            <span>{"✓"} <b>{employment.socSource.name}</b> {"·"} {employment.socSource.words} words {"·"} attached {new Date(employment.socSource.savedAt).toLocaleDateString()}</span>
            <button
              onClick={() => { void (async () => { await fetch(`/api/employment/${sessionId}/soc-source`, { method: 'DELETE', credentials: 'include' }); void employment.refresh(); })(); }}
              style={{ background: 'none', border: `1px solid ${border}`, color: muted, cursor: 'pointer', fontSize: 12.5, fontFamily: sans, padding: '4px 10px', borderRadius: 2 }}
            >
              Discard
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={socSourceInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.rtf"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void attachRebuttalFile(f, 'soc-source'); e.target.value = ''; }}
              aria-label="Attach a document for the claim to read"
            />
            <button
              onClick={() => socSourceInputRef.current?.click()}
              disabled={rebuttalSaving}
              style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: rebuttalSaving ? 'not-allowed' : 'pointer', fontFamily: sans }}
            >
              {rebuttalSaving ? 'Reading…' : (employment.socSource ? 'Replace the attached document' : 'Attach a document (optional)')}
            </button>
          </div>
        )}
      </div>

      {socNodes.length > 0 && (
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>What this claim pleads</div>
          <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
            Each cause of action is a section in the firm's settled language, selected by the facts on file and your approved issues. Turning one on that the intake never asked about gives you the structure with [LAWYER: ...] markers, never invented facts.
          </div>
          {socNodes.map(n => {
            const on = n.status === 'firing' || n.status === 'forced_on';
            const chip = n.status === 'firing' ? { label: 'PLEADED', bg: '#e8f2e8', fg: green }
              : n.status === 'forced_on' ? { label: 'FORCED ON', bg: '#e8f2e8', fg: green }
              : n.status === 'eligible_unapproved' ? { label: 'FACTS SUPPORT IT', bg: '#fdf0dd', fg: amber }
              : n.status === 'forced_off' ? { label: 'FORCED OFF', bg: '#f3f3f3', fg: muted }
              : { label: 'OFF', bg: '#f3f3f3', fg: muted };
            return (
              <div key={n.blockId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', borderTop: `1px solid #f0ede8` }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: chip.fg, background: chip.bg, padding: '2px 7px', borderRadius: 2, minWidth: 86, textAlign: 'center', marginTop: 2 }}>{chip.label}</span>
                <span style={{ flex: 1, fontSize: 12.5, color: on ? ink : muted }}>
                  <span style={{ fontWeight: 600 }}>{n.sectionHeader}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: muted, lineHeight: 1.45 }}>{n.reason}</span>
                </span>
                {n.status !== 'firing' && (n.forceable ?? n.tier === 2) && (
                  <button
                    onClick={() => void setSocOverride(n.blockId, n.status === 'forced_on' || n.status === 'forced_off' ? null : 'on')}
                    style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: `1px solid ${border}`, color: navy, cursor: 'pointer', padding: '3px 9px', borderRadius: 2 }}
                  >
                    {n.status === 'forced_on' || n.status === 'forced_off' ? 'reset' : 'force on'}
                  </button>
                )}
                {(n.status === 'firing' || n.status === 'eligible_unapproved') && (n.forceable ?? n.tier === 2) && (
                  <button
                    onClick={() => void setSocOverride(n.blockId, 'off')}
                    aria-label={`Turn off ${n.sectionHeader}`}
                    style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '3px 4px' }}
                  >
                    turn off
                  </button>
                )}
                {n.status === 'forced_off' && !((n.forceable ?? n.tier === 2)) && (
                  <button
                    onClick={() => void setSocOverride(n.blockId, null)}
                    aria-label={`Turn ${n.sectionHeader} back on`}
                    style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: `1px solid ${border}`, color: navy, cursor: 'pointer', padding: '3px 9px', borderRadius: 2 }}
                  >
                    turn back on
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
