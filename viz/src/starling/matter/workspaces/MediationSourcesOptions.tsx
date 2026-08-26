// "Sources for this document" options: the generated demand/claim toggles,
// the attached sources with checkboxes, and the attach control. Extracted
// verbatim from MatterDetailView.tsx's draft tab (Option A).
//
// Shared by the mediation brief and Schedule "A": both are drawn from the
// positions already taken in the matter, so both attach the same documents
// from the same store. Only the wording differs, since the brief argues the
// positions while Schedule "A" takes its allegations from them.

import { navy, red, border, ink, muted, sans } from '../tokens.js';
import { useEmploymentData } from '../../hooks/useStarlingApi.js';

type Employment = ReturnType<typeof useEmploymentData>;
type StoredSource = { id: string; name: string; words: number; kind?: string };

export function MediationSourcesOptions({
  generatedDocuments, includeGenDemand, setIncludeGenDemand, includeGenSoc, setIncludeGenSoc,
  storedSources, selectedSourceIds, setSelectedSourceIds, removeBriefSource,
  briefSourceInputRef, attachBriefSource, sourceParsing, sourceError,
  heading = 'Sources for this brief',
  description = 'The brief argues the positions in these documents and cites back to them. Attach what was drafted outside Starling: the statement of claim, the demand letter, a list of cases. Up to roughly 40 pages per document is read in full.',
}: {
  generatedDocuments: Employment['generatedDocuments'];
  includeGenDemand: boolean;
  setIncludeGenDemand: React.Dispatch<React.SetStateAction<boolean>>;
  includeGenSoc: boolean;
  setIncludeGenSoc: React.Dispatch<React.SetStateAction<boolean>>;
  storedSources: StoredSource[];
  selectedSourceIds: Set<string>;
  setSelectedSourceIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  removeBriefSource: (id: string) => void;
  briefSourceInputRef: React.RefObject<HTMLInputElement | null>;
  attachBriefSource: (file: File, kind?: string) => void;
  sourceParsing: boolean;
  sourceError: string | null;
  heading?: string;
  description?: string;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>{heading}</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>{description}</div>
      {generatedDocuments.some(d => d.docType === 'demand_letter') && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: ink, marginBottom: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeGenDemand} onChange={() => setIncludeGenDemand(v => !v)} style={{ accentColor: navy }} />
          Demand Letter (generated in Starling)
        </label>
      )}
      {generatedDocuments.some(d => d.docType === 'statement_of_claim') && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: ink, marginBottom: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeGenSoc} onChange={() => setIncludeGenSoc(v => !v)} style={{ accentColor: navy }} />
          Statement of Claim (generated in Starling)
        </label>
      )}
      {storedSources.map(sd => (
        <div key={sd.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ink, padding: '3px 0' }}>
          <input
            type="checkbox"
            checked={selectedSourceIds.has(sd.id)}
            onChange={() => setSelectedSourceIds(prev => { const next = new Set(prev); if (next.has(sd.id)) next.delete(sd.id); else next.add(sd.id); return next; })}
            aria-label={`Use ${sd.name} for this draft`}
            style={{ accentColor: navy }}
          />
          <span style={{ flex: 1 }}>{sd.name} <span style={{ color: muted, fontSize: 12 }}>({Number(sd.words).toLocaleString('en-CA')} words)</span></span>
          <button
            onClick={() => void removeBriefSource(sd.id)}
            aria-label={`Remove ${sd.name} from the matter`}
            style={{ fontSize: 11.5, color: muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            remove
          </button>
        </div>
      ))}
      {storedSources.length > 0 && (
        <div style={{ fontSize: 11.5, color: muted, marginTop: 2 }}>Attached sources stay on the matter for every regeneration.</div>
      )}
      <input
        ref={briefSourceInputRef}
        type="file"
        accept=".pdf,.docx,.md,.txt"
        multiple
        style={{ display: 'none' }}
        onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void (async () => { for (const f of fs) await attachBriefSource(f); })(); }}
        aria-label="Attach a source document for the brief"
      />
      <button
        onClick={() => briefSourceInputRef.current?.click()}
        disabled={sourceParsing}
        style={{ marginTop: 6, fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
      >
        {sourceParsing ? 'Reading…' : 'Attach a document'}
      </button>
      {sourceError && <div role="alert" style={{ fontSize: 12.5, color: red, marginTop: 6 }}>{sourceError}</div>}
    </div>
  );
}
