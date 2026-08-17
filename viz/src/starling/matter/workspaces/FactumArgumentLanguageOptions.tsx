// Factum argument library: teach the firm's argument for each issue from its
// own factums, review the proposals, and approve them section by section.
// Mirrors the SOC pleading-language teacher. State stays in the parent.

import { navy, orange, border, ink, muted, sans } from '../tokens.js';
import { TEXT_UPLOAD_ACCEPT } from '../../shared.js';

type FactumLibNode = {
  blockId: string; sectionHeader: string; content: string;
  provenance: 'default' | 'edited' | 'learned'; version: number;
};
type FactumProposal = {
  blockId: string; sectionHeader: string; issueLabel: string; sources: string[];
  current: string; proposed: string | null; notes: string[]; skipped?: string;
};

export function FactumArgumentLanguageOptions({
  factumTeachInputRef, teachFactumSections, factumTeachBusy, factumTeachMsg,
  factumLib, factumProposals, setFactumProposals, approveFactumProposal,
}: {
  factumTeachInputRef: React.RefObject<HTMLInputElement | null>;
  teachFactumSections: (files: File[]) => void;
  factumTeachBusy: boolean;
  factumTeachMsg: string | null;
  factumLib: FactumLibNode[];
  factumProposals: FactumProposal[] | null;
  setFactumProposals: React.Dispatch<React.SetStateAction<FactumProposal[] | null>>;
  approveFactumProposal: (blockId: string, content: string) => void;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>Teach the argument</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
        Each issue is argued in settled guidance. Upload the firm's own factums and Starling proposes each section rewritten to argue the way your firm argues it, structure and authorities intact. Nothing changes until you approve it, section by section. Names, dates and figures from the factums never enter the guidance.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          ref={factumTeachInputRef}
          type="file" accept={TEXT_UPLOAD_ACCEPT} multiple style={{ display: 'none' }}
          onChange={e => { const fs = [...(e.target.files ?? [])]; if (fs.length) void teachFactumSections(fs); e.target.value = ''; }}
          aria-label="Upload the firm's factums"
        />
        <button
          onClick={() => factumTeachInputRef.current?.click()}
          disabled={factumTeachBusy}
          style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: factumTeachBusy ? '#b0b0b0' : navy, color: '#fff', border: 'none', cursor: factumTeachBusy ? 'not-allowed' : 'pointer' }}
        >
          {factumTeachBusy ? 'Reading…' : 'Read your factums'}
        </button>
        <span style={{ fontSize: 11.5, color: muted }}>
          {factumLib.filter(n => n.provenance !== 'default').length > 0
            ? `${factumLib.filter(n => n.provenance === 'learned').length} learned, ${factumLib.filter(n => n.provenance === 'edited').length} edited, rest on defaults.`
            : 'All sections on the default argument.'}
        </span>
      </div>
      {factumTeachMsg && <div style={{ fontSize: 12.5, color: ink, marginTop: 8 }}>{factumTeachMsg}</div>}

      {factumProposals && factumProposals.filter(p => p.proposed || p.skipped).map(p => (
        <div key={p.blockId} style={{ borderTop: `1px solid #f0ede8`, marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: ink }}>
            {p.sectionHeader || p.blockId}
            <span style={{ fontWeight: 400, color: muted }}> · from {p.sources.join(', ') || 'no matching factums'}</span>
          </div>
          {p.skipped && <div style={{ fontSize: 12, color: muted, marginTop: 3 }}>{p.skipped}</div>}
          {p.proposed && (
            <>
              {p.notes.map((note, i) => (
                <div key={i} style={{ fontSize: 11.5, color: muted, marginTop: 3 }}>{note}</div>
              ))}
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 12, color: navy, cursor: 'pointer' }}>Read the proposed argument guidance</summary>
                <div style={{ fontSize: 12, color: ink, background: '#fbfaf8', border: `1px solid ${border}`, padding: '8px 10px', marginTop: 5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {p.proposed}
                </div>
              </details>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => approveFactumProposal(p.blockId, p.proposed!)}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: orange, color: '#fff', border: 'none', cursor: 'pointer' }}
                >
                  Approve
                </button>
                <span style={{ fontSize: 11.5, color: muted, alignSelf: 'center' }}>
                  Approving argues this issue in these words on every future factum.
                </span>
                <button
                  onClick={() => setFactumProposals(prev => prev ? prev.filter(x => x.blockId !== p.blockId) : prev)}
                  style={{ fontSize: 12, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
                >
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
