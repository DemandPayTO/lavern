// Demand-letter "documents this letter argues from" options: the attached
// sources with per-document checkboxes and the attach control. Extracted
// verbatim from MatterDetailView.tsx's draft tab (Option A).

import { navy, red, border, ink, muted, sans } from '../tokens.js';
import { DEMAND_SOURCE_KIND_LABELS } from '../constants.js';

type StoredSource = { id: string; name: string; words: number; kind?: string };

export function DemandSourcesOptions({
  storedSources, dlSourceIds, setDlSourceIds, dlUploadKind, setDlUploadKind,
  dlSourceInputRef, attachBriefSource, sourceParsing, sourceError,
  sessionId, refreshEmployment,
}: {
  storedSources: StoredSource[];
  dlSourceIds: Set<string>;
  setDlSourceIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  dlUploadKind: string;
  setDlUploadKind: React.Dispatch<React.SetStateAction<string>>;
  dlSourceInputRef: React.RefObject<HTMLInputElement | null>;
  attachBriefSource: (file: File, kind?: string) => void;
  sourceParsing: boolean;
  sourceError: string | null;
  sessionId: string | null;
  refreshEmployment: () => void;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>Documents this letter argues from</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
        A demand letter turns on specific words: the clause the parties signed, the reason the employer put in writing. Attach those documents and the letter quotes them instead of paraphrasing. Say what each one is, because the letter reads the employment agreement differently from a policy manual.
      </div>

      {storedSources.length === 0 && (
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, fontStyle: 'italic' }}>
          Nothing attached. The letter will argue from the intake alone.
        </div>
      )}
      {storedSources.map(sd => (
        <label key={sd.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: ink, marginBottom: 5, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={dlSourceIds.has(sd.id)}
            onChange={() => setDlSourceIds(prev => {
              const next = new Set(prev);
              if (next.has(sd.id)) next.delete(sd.id); else next.add(sd.id);
              return next;
            })}
            style={{ accentColor: navy }}
          />
          <span style={{ flex: 1 }}>
            {sd.name}
            <span style={{ color: muted, fontSize: 12 }}> · {DEMAND_SOURCE_KIND_LABELS[sd.kind ?? 'other'] ?? 'Other'} · {sd.words.toLocaleString('en-CA')} words</span>
          </span>
          <button
            onClick={async (e) => {
              e.preventDefault();
              if (!sessionId) return;
              await fetch(`/api/employment/${sessionId}/brief-sources/${sd.id}`, { method: 'DELETE', credentials: 'include' });
              refreshEmployment();
            }}
            style={{ fontSize: 12, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '0 4px' }}
          >
            remove
          </button>
        </label>
      ))}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <select
          value={dlUploadKind}
          onChange={e => setDlUploadKind(e.target.value)}
          aria-label="What kind of document you are attaching"
          style={{ fontFamily: sans, fontSize: 13, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
        >
          {Object.entries(DEMAND_SOURCE_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          ref={dlSourceInputRef}
          type="file"
          accept=".pdf,.docx,.md,.txt"
          multiple
          style={{ display: 'none' }}
          onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void (async () => { for (const f of fs) await attachBriefSource(f, dlUploadKind); })(); }}
          aria-label="Attach a document for the demand letter"
        />
        <button
          onClick={() => dlSourceInputRef.current?.click()}
          disabled={sourceParsing}
          style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
        >
          {sourceParsing ? 'Reading…' : 'Attach a document'}
        </button>
      </div>
      {sourceError && <div role="alert" style={{ fontSize: 12.5, color: red, marginTop: 6 }}>{sourceError}</div>}
    </div>
  );
}
