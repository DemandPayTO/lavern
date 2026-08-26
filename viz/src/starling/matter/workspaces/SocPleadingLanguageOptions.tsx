// Statement of Claim "the firm's pleading language" options: teach nodes from
// the firm's own claims (or import the spreadsheet), then review and approve
// each proposed node. Extracted verbatim from MatterDetailView.tsx's draft tab
// (Option A).

import { navy, orange, amber, border, ink, muted, sans } from '../tokens.js';
import { DocumentHtml } from '../../DocumentHtml.js';
import { TEXT_UPLOAD_ACCEPT } from '../../shared.js';

type SocLibNode = {
  blockId: string; sectionHeader: string; content: string;
  provenance: 'default' | 'edited' | 'learned'; version: number;
};
type SocProposal = {
  blockId: string; sectionHeader: string; sources: string[];
  current: string; proposed: string | null;
  additions: Array<{ summary: string; text: string }>;
  notes: string[]; skipped?: string;
  validation: { ok: boolean; errors: string[]; warnings: string[]; renderAllOn: string; renderAllOff: string } | null;
};

export function SocPleadingLanguageOptions({
  socTeachInputRef, socImportInputRef, teachSocNodes, importSocNodes,
  socTeachBusy, socTeachMsg, socLib, socProposals, setSocProposals, approveSocProposal,
}: {
  socTeachInputRef: React.RefObject<HTMLInputElement | null>;
  socImportInputRef: React.RefObject<HTMLInputElement | null>;
  teachSocNodes: (files: File[]) => void;
  importSocNodes: (file: File) => void;
  socTeachBusy: boolean;
  socTeachMsg: string | null;
  socLib: SocLibNode[];
  socProposals: SocProposal[] | null;
  setSocProposals: React.Dispatch<React.SetStateAction<SocProposal[] | null>>;
  approveSocProposal: (blockId: string, content: string, provenance: 'edited' | 'learned') => void;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>The firm's pleading language</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
        Each cause is pleaded in settled language. Upload two or more of the firm's own claims and Starling proposes each node rewritten in your wording, structure intact. Nothing changes until you approve it, node by node. Names, dates and figures from the claims never enter the templates.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          ref={socTeachInputRef}
          type="file" accept={TEXT_UPLOAD_ACCEPT} multiple style={{ display: 'none' }}
          onChange={e => { const fs = [...(e.target.files ?? [])]; if (fs.length) void teachSocNodes(fs); e.target.value = ''; }}
          aria-label="Upload the firm's statements of claim"
        />
        <button
          onClick={() => socTeachInputRef.current?.click()}
          disabled={socTeachBusy}
          style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: socTeachBusy ? '#b0b0b0' : navy, color: '#fff', border: 'none', cursor: socTeachBusy ? 'not-allowed' : 'pointer' }}
        >
          {socTeachBusy ? 'Reading…' : 'Read your claims'}
        </button>
        <input
          ref={socImportInputRef}
          type="file" accept=".xlsx" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void importSocNodes(f); e.target.value = ''; }}
          aria-label="Import the node spreadsheet"
        />
        <button
          onClick={() => socImportInputRef.current?.click()}
          disabled={socTeachBusy}
          style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: socTeachBusy ? 'not-allowed' : 'pointer' }}
        >
          Import the language spreadsheet
        </button>
        <span style={{ fontSize: 11.5, color: muted }}>
          {socLib.filter(n => n.provenance !== 'default').length > 0
            ? `${socLib.filter(n => n.provenance === 'learned').length} learned, ${socLib.filter(n => n.provenance === 'edited').length} edited, rest on defaults.`
            : 'All nodes on the ported defaults.'}
        </span>
      </div>
      {socTeachMsg && <div style={{ fontSize: 12.5, color: ink, marginTop: 8 }}>{socTeachMsg}</div>}

      {socProposals && socProposals.filter(p => p.proposed || p.skipped).map(p => (
        <div key={p.blockId} style={{ borderTop: `1px solid #f0ede8`, marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: ink }}>
            {p.sectionHeader || p.blockId}
            <span style={{ fontWeight: 400, color: muted }}> · from {p.sources.join(', ') || 'no matching claims'}</span>
          </div>
          {p.skipped && <div style={{ fontSize: 12, color: muted, marginTop: 3 }}>{p.skipped}</div>}
          {p.proposed && (
            <>
              {(p.validation?.warnings ?? []).map((w, i) => (
                <div key={i} style={{ fontSize: 11.5, color: amber, marginTop: 3 }}>{w}</div>
              ))}
              {p.notes.map((note, i) => (
                <div key={i} style={{ fontSize: 11.5, color: muted, marginTop: 3 }}>{note}</div>
              ))}
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 12, color: navy, cursor: 'pointer' }}>Read it as it would plead</summary>
                <DocumentHtml style={{ fontSize: 12, color: ink, background: '#fbfaf8', border: `1px solid ${border}`, padding: '8px 10px', marginTop: 5, lineHeight: 1.55 }}
                  html={p.validation?.renderAllOn ?? ''} />
              </details>
              {p.additions.length > 0 && (
                <div style={{ fontSize: 11.5, color: muted, marginTop: 5 }}>
                  Your claims also plead, and this node does not: {p.additions.map(a => a.summary).join('; ')}. Approve the node first, then add these by editing it.
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => void approveSocProposal(p.blockId, p.proposed!, 'learned')}
                  disabled={!p.validation?.ok}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: p.validation?.ok ? orange : '#b0b0b0', color: '#fff', border: 'none', cursor: p.validation?.ok ? 'pointer' : 'not-allowed' }}
                >
                  Approve
                </button>
                <span style={{ fontSize: 11.5, color: muted, alignSelf: 'center' }}>
                  Approving pleads this cause in these words on every future claim.
                </span>
                <button
                  onClick={() => setSocProposals(prev => prev ? prev.filter(x => x.blockId !== p.blockId) : prev)}
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
