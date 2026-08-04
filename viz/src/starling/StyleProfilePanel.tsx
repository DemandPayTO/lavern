/**
 * StyleProfilePanel — teach Starling how the firm writes a document type.
 *
 * The lawyer gathers two or more precedents (added across several picks,
 * since they live in different matter folders), names the profile for the
 * kind of case it represents ("Termination on medical leave"), and
 * Starling reads them ONCE into a style guide: section flow, voice,
 * recurring firm language. Drafting can then follow that style for any
 * matter, with a deterministic scan flagging any precedent value that
 * leaks into a new draft.
 *
 * This is the flexible complement to "Build from precedents" (the
 * placeholder template): templates fix wording and fill in data; a style
 * profile guides a fresh narrative written for this matter's facts.
 */

import { useState, useRef, useEffect, useCallback } from 'react';

const navy = '#0f1a2e';
const green = '#16a34a';
const amber = '#d97706';
const red = '#dc2626';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const sans = "system-ui, -apple-system, sans-serif";
const serif = "'Cormorant Garamond', Georgia, serif";

export interface StyleProfileSummary {
  id: string;
  documentType: string;
  label: string;
  sourceCount: number;
  createdAt: string;
}

interface BuiltGuide {
  flow: Array<{ heading: string; purpose: string }>;
  voice: string;
  recurringLanguage: string[];
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function useStyleProfiles(documentType: string | undefined) {
  const [profiles, setProfiles] = useState<StyleProfileSummary[]>([]);
  const refresh = useCallback(() => {
    if (!documentType) { setProfiles([]); return; }
    fetch(`/api/employment/style-profiles?documentType=${encodeURIComponent(documentType)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.ok) setProfiles(d.profiles ?? []); })
      .catch(() => { /* list is best-effort */ });
  }, [documentType]);
  useEffect(() => { refresh(); }, [refresh]);
  return { profiles, refresh };
}

export function StyleProfilePanel({ documentType, documentLabel, onChanged, onClose }: {
  documentType: string;
  documentLabel: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<{ label: string; guide: BuiltGuide; costUsd: number } | null>(null);

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const precedents = await Promise.all(files.map(async f => ({ name: f.name, docxBase64: await fileToBase64(f) })));
      const res = await fetch('/api/employment/style-profiles/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ documentType, label: label.trim(), precedents }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { setError(d.error ?? 'The precedents could not be analysed.'); return; }
      setBuilt({ label: d.label, guide: d.guide, costUsd: d.costUsd ?? 0 });
      setFiles([]);
      setLabel('');
      onChanged();
    } catch {
      setError('Could not read those files.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ fontFamily: sans, border: `1px solid ${border}`, background: '#fff', padding: '16px 20px', marginBottom: 16 }}>
      <h3 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 4px', color: navy }}>Teach Starling your {documentLabel.toLowerCase()} style</h3>
      <p style={{ fontSize: 13, color: muted, margin: '0 0 10px' }}>
        Add two or more of your own {documentLabel.toLowerCase()}s for the same kind of case, from any
        folders, one pick at a time. Starling studies how they flow, the voice they use, and the
        language that recurs, and saves that as a named style. New drafts then follow your style while
        using only this matter's facts, and every draft is scanned so no name or figure from the
        precedents can slip through unflagged. Redacted copies work.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          const picked = [...(e.target.files ?? [])];
          setFiles(prev => {
            const seen = new Set(prev.map(f => `${f.name}|${f.size}`));
            return [...prev, ...picked.filter(f => !seen.has(`${f.name}|${f.size}`))];
          });
          e.target.value = '';
        }}
        aria-label="Choose precedent files for the style profile"
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => inputRef.current?.click()}
          style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
        >
          Add files
        </button>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Name this style (e.g. Termination on medical leave)"
          aria-label="Style profile name"
          style={{ flex: 1, minWidth: 240, fontSize: 13, fontFamily: sans, padding: '8px 11px', border: `1px solid ${border}`, borderRadius: 2 }}
        />
        <button
          onClick={() => void build()}
          disabled={files.length < 2 || !label.trim() || busy}
          style={{
            fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans,
            background: files.length >= 2 && label.trim() && !busy ? navy : '#fff',
            color: files.length >= 2 && label.trim() && !busy ? '#fff' : muted,
            border: `1px solid ${files.length >= 2 && label.trim() && !busy ? navy : border}`,
            cursor: files.length >= 2 && label.trim() && !busy ? 'pointer' : 'default',
          }}
        >
          {busy ? 'Reading your precedents…' : 'Learn the style'}
        </button>
        <button onClick={onClose} style={{ fontSize: 13, padding: '8px 14px', fontFamily: sans, background: 'none', color: muted, border: 'none', cursor: 'pointer' }}>
          Close
        </button>
      </div>

      {files.length > 0 && (
        <ul style={{ fontSize: 12.5, color: ink, margin: '10px 0 0', paddingLeft: 18 }}>
          {files.map(f => (
            <li key={`${f.name}|${f.size}`}>
              {f.name}
              <button
                onClick={() => setFiles(prev => prev.filter(x => !(x.name === f.name && x.size === f.size)))}
                aria-label={`Remove ${f.name}`}
                style={{ marginLeft: 8, fontSize: 11.5, color: muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length === 1 && (
        <p style={{ fontSize: 12.5, color: amber, margin: '8px 0 0' }}>Add at least one more; a single document shows a draft, not a style.</p>
      )}
      {error && <p role="alert" style={{ fontSize: 12.5, color: red, margin: '8px 0 0' }}>{error}</p>}

      {built && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${border}`, paddingTop: 10 }} role="status">
          <div style={{ fontSize: 13, fontWeight: 700, color: green }}>
            Learned “{built.label}” (${built.costUsd.toFixed(2)}). Starling read your flow as:
          </div>
          <ol style={{ fontSize: 12.5, color: ink, margin: '6px 0 0', paddingLeft: 20 }}>
            {built.guide.flow.map((f, i) => <li key={i}><b>{f.heading}</b> — {f.purpose}</li>)}
          </ol>
          {built.guide.recurringLanguage.length > 0 && (
            <div style={{ fontSize: 12.5, color: muted, marginTop: 6 }}>
              Your recurring language, kept: {built.guide.recurringLanguage.slice(0, 3).map(p => `“${p}”`).join(' · ')}
              {built.guide.recurringLanguage.length > 3 ? ' …' : ''}
            </div>
          )}
          <div style={{ fontSize: 12.5, color: muted, marginTop: 6 }}>
            Pick this style beside the Generate button whenever it fits the case.
          </div>
        </div>
      )}
    </div>
  );
}
