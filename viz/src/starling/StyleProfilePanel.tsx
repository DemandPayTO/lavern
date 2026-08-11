/**
 * StyleProfilePanel — teach Starling how the firm writes a document type.
 *
 * The lawyer gathers three or more precedents (added across several picks,
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
const cream = '#faf8f5';

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
  /** A letter style also returns the boilerplate it will reproduce. */
  documentKind?: 'prose' | 'form' | 'letter';
  openingBlock?: string[];
  closingBlock?: string[];
  fixedClauses?: Array<{ part: string; text: string }>;
}

interface FullGuide {
  flow: Array<{ heading: string; purpose: string }>;
  voice: string;
  recurringLanguage: string[];
  factWeaving: string;
  notes: string[];
  typicalWords?: number;
  profileTableRows?: string[];
  /** Letter styles carry the firm's boilerplate, reproduced word for word. */
  documentKind?: 'prose' | 'form' | 'letter';
  openingBlock?: string[];
  closingBlock?: string[];
  fixedClauses?: Array<{ part: string; text: string }>;
  formStructure?: string[];
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

const FORM_DOCUMENT_TYPES = new Set([
  'sp_timetable_motion', 'consent_timetable_order', 'timetable_order',
  'sj_notice_of_motion', 'affidavit_of_service', 'rule49_offer',
  'rule49_withdrawal', 'rule49_acceptance', 'costs_outline',
  'esa_filing_sheet', 'scc_filing_sheet', 'notice_of_action',
  'settlement_minutes', 'undertakings_answers',
]);

export function StyleProfilePanel({ documentType, documentLabel, profiles, onChanged, onClose }: {
  documentType: string;
  documentLabel: string;
  /** Existing profiles for this document type, for the tweak-and-save editor. */
  profiles: StyleProfileSummary[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeIssues, setTypeIssues] = useState<string[]>([]);
  const [built, setBuilt] = useState<{ label: string; guide: BuiltGuide; costUsd: number } | null>(null);
  // The editor: the tweak that persists. Load the full guide, edit any
  // part of it, save; the profile improves for every later draft.
  const [editing, setEditing] = useState<{ id: string; label: string; guide: FullGuide } | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);

  const openEditor = async (id: string) => {
    setError(null); setEditStatus(null);
    const res = await fetch(`/api/employment/style-profiles/${encodeURIComponent(id)}`, { credentials: 'include' });
    const d = await res.json();
    if (!d.ok || !d.profile?.guide) { setError(d.error ?? 'The profile could not be loaded.'); return; }
    setEditing({ id, label: d.profile.label, guide: d.profile.guide as FullGuide });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/employment/style-profiles/${encodeURIComponent(editing.id)}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editing.label.trim(), guide: editing.guide }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? 'The changes could not be saved.'); return; }
      setEditStatus('Saved. Every draft from now on uses the tweaked style.');
      onChanged();
    } finally { setBusy(false); }
  };

  const setGuide = (patch: Partial<FullGuide>) =>
    setEditing(e => (e ? { ...e, guide: { ...e.guide, ...patch } } : e));

  const build = async (ignoreTypeMismatch = false) => {
    setBusy(true);
    setError(null);
    if (!ignoreTypeMismatch) setTypeIssues([]);
    try {
      const precedents = await Promise.all(files.map(async f => ({ name: f.name, docxBase64: await fileToBase64(f) })));
      const res = await fetch('/api/employment/style-profiles/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ documentType, label: label.trim(), precedents, ...(ignoreTypeMismatch ? { ignoreTypeMismatch: true } : {}) }),
      });
      const d = await res.json();
      if (res.status === 409 && Array.isArray(d.typeIssues)) {
        setTypeIssues(d.typeIssues as string[]);
        return;
      }
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

  const ta = (rows: number) => ({ width: '100%', fontFamily: sans, fontSize: 12.5, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, boxSizing: 'border-box' as const, resize: 'vertical' as const, minHeight: rows * 18 });

  if (editing) {
    return (
      <div style={{ fontFamily: sans, border: `1px solid ${border}`, background: '#fff', padding: '16px 20px', marginBottom: 16 }}>
        <h3 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 4px', color: navy }}>Tweak “{editing.label}”</h3>
        <p style={{ fontSize: 13, color: muted, margin: '0 0 12px' }}>
          Change anything below and save. The tweak persists: every later draft in this style uses it,
          so a correction never has to be repeated.
        </p>

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>Name</label>
        <input value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })}
          style={{ width: '100%', fontFamily: sans, fontSize: 13, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, boxSizing: 'border-box', marginBottom: 10 }} />

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>Flow (one section per line: Heading — purpose)</label>
        <textarea
          value={editing.guide.flow.map(f => `${f.heading} — ${f.purpose}`).join('\n')}
          onChange={e => setGuide({ flow: e.target.value.split('\n').map(l => {
            const idx = l.indexOf('—');
            const heading = (idx >= 0 ? l.slice(0, idx) : l).trim();
            const purpose = (idx >= 0 ? l.slice(idx + 1) : '').trim();
            return heading ? { heading, purpose } : null;
          }).filter((x): x is { heading: string; purpose: string } => x !== null) })}
          style={{ ...ta(editing.guide.flow.length + 1), marginBottom: 10 }}
        />

        {/* The boilerplate. For a letter style these are the fields with
            direct effect on the page: they are reproduced word for word
            into a document that gets sent, so they are the ones most worth
            reading before the first draft and correcting after it. */}
        {editing.guide.documentKind === 'letter' && (
          <div style={{ border: `1px solid ${border}`, padding: '12px 14px', marginBottom: 12, background: '#fbfaf8' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>
              Your boilerplate, reproduced word for word
            </div>
            <div style={{ fontSize: 11.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
              These go into every letter exactly as written, with [SLOT] markers filled from the matter. Read them before you draft: what is here is what gets sent. Pronoun slots ([SUBJECT], [OBJECT], [POSSESSIVE]) fill from the pronouns recorded on each client.
            </div>

            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>Opening block (one line per line of the letter)</label>
            <textarea
              value={(editing.guide.openingBlock ?? []).join('\n')}
              onChange={e => setGuide({ openingBlock: e.target.value.split('\n').map(l => l.trim()).filter(Boolean) })}
              style={{ ...ta(Math.max(4, (editing.guide.openingBlock ?? []).length)), marginBottom: 10 }}
            />

            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>Closing block</label>
            <textarea
              value={(editing.guide.closingBlock ?? []).join('\n')}
              onChange={e => setGuide({ closingBlock: e.target.value.split('\n').map(l => l.trim()).filter(Boolean) })}
              style={{ ...ta(Math.max(3, (editing.guide.closingBlock ?? []).length)), marginBottom: 10 }}
            />

            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>
              Standard passages (one per block, first line is the part it belongs to)
            </label>
            <textarea
              value={(editing.guide.fixedClauses ?? []).map(c => `${c.part}\n${c.text}`).join('\n\n')}
              onChange={e => setGuide({
                fixedClauses: e.target.value.split(/\n\s*\n/).map(blockText => {
                  const [part, ...rest] = blockText.split('\n');
                  return { part: (part ?? '').trim().slice(0, 120), text: rest.join(' ').trim().slice(0, 2000) };
                }).filter(c => c.part && c.text),
              })}
              style={{ ...ta(Math.max(6, (editing.guide.fixedClauses ?? []).length * 3)), marginBottom: 4 }}
            />
            <div style={{ fontSize: 11.5, color: muted }}>
              Separate passages with a blank line. Delete a passage you have outgrown and it stops appearing.
            </div>
          </div>
        )}

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>Voice</label>
        <textarea value={editing.guide.voice} onChange={e => setGuide({ voice: e.target.value })} style={{ ...ta(3), marginBottom: 10 }} />

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>Recurring firm language (one phrasing per line)</label>
        <textarea
          value={editing.guide.recurringLanguage.join('\n')}
          onChange={e => setGuide({ recurringLanguage: e.target.value.split('\n').map(l => l.trim()).filter(Boolean) })}
          style={{ ...ta(Math.max(3, editing.guide.recurringLanguage.length)), marginBottom: 10 }}
        />

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>How facts are woven in</label>
        <textarea value={editing.guide.factWeaving} onChange={e => setGuide({ factWeaving: e.target.value })} style={{ ...ta(2), marginBottom: 10 }} />

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: navy, marginBottom: 4 }}>Other habits (one per line)</label>
        <textarea
          value={(editing.guide.notes ?? []).join('\n')}
          onChange={e => setGuide({ notes: e.target.value.split('\n').map(l => l.trim()).filter(Boolean) })}
          style={{ ...ta(2), marginBottom: 10 }}
        />

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: navy }}>
            Typical length (words)
            <input
              type="number" min={100} max={30000}
              value={editing.guide.typicalWords ?? ''}
              onChange={e => setGuide({ typicalWords: e.target.value ? Math.max(100, Math.min(30000, parseInt(e.target.value))) : undefined })}
              style={{ display: 'block', marginTop: 4, fontFamily: sans, fontSize: 13, padding: '7px 10px', border: `1px solid ${border}`, borderRadius: 2, width: 140 }}
            />
          </label>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: navy, flex: 1, minWidth: 240 }}>
            Opening table rows (one label per line)
            <textarea
              value={(editing.guide.profileTableRows ?? []).join('\n')}
              onChange={e => setGuide({ profileTableRows: e.target.value.split('\n').map(l => l.trim()).filter(Boolean) })}
              style={{ ...ta(Math.max(3, (editing.guide.profileTableRows ?? []).length)), marginTop: 4 }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void saveEdit()} disabled={busy || !editing.label.trim()}
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 2, fontFamily: sans, background: navy, color: '#fff', border: 'none', cursor: 'pointer' }}>
            {busy ? 'Saving…' : 'Save the tweaks'}
          </button>
          <button onClick={() => { setEditing(null); setEditStatus(null); }}
            style={{ fontSize: 13, padding: '8px 14px', fontFamily: sans, background: 'none', color: muted, border: `1px solid ${border}`, borderRadius: 2, cursor: 'pointer' }}>
            Back
          </button>
          {editStatus && <span role="status" style={{ fontSize: 12.5, color: green, fontWeight: 600 }}>{editStatus}</span>}
        </div>
        {error && <p role="alert" style={{ fontSize: 12.5, color: red, margin: '8px 0 0' }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: sans, border: `1px solid ${border}`, background: '#fff', padding: '16px 20px', marginBottom: 16 }}>
      <h3 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 4px', color: navy }}>
        Teach Starling your {documentLabel.toLowerCase()} style
      </h3>
      <div style={{ fontSize: 12.5, color: ink, background: cream, border: `1px solid ${border}`, borderRadius: 2, padding: '7px 11px', margin: '0 0 10px' }}>
        Upload precedents of this document only: <b>{documentLabel}</b>. Each document type has its own
        style, so the other timetable documents are taught on their own cards.
      </div>
      <p style={{ fontSize: 13, color: muted, margin: '0 0 10px' }}>
        {FORM_DOCUMENT_TYPES.has(documentType) ? (
          <>
            This is a court form, so Starling reads your precedents differently: it takes the parts in
            your order and your fixed wording <b>verbatim</b>, clause by clause, and fills only the
            values from this matter. Add three or more of your own {documentLabel.toLowerCase()}s. Any
            party name or figure inside a clause is replaced with a placeholder, and every draft is
            scanned so nothing from another client can slip through unflagged.
          </>
        ) : (
          <>
            Add three or more of your own {documentLabel.toLowerCase()}s for the same kind of case, from any
            folders, one pick at a time. Starling studies how they flow, the voice they use, and the
            language that recurs, and saves that as a named style. New drafts then follow your style while
            using only this matter's facts, and every draft is scanned so no name or figure from the
            precedents can slip through unflagged. Redacted copies work.
          </>
        )}
      </p>

      {profiles.length > 0 && (
        <div style={{ marginBottom: 12, borderBottom: `1px solid ${border}`, paddingBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Your saved styles
          </div>
          {profiles.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
              <span style={{ fontSize: 13, color: ink, flex: 1 }}>
                <b>{p.label}</b> <span style={{ color: muted, fontSize: 12 }}>from {p.sourceCount} precedents</span>
              </span>
              <button onClick={() => void openEditor(p.id)}
                style={{ fontSize: 12, fontWeight: 600, color: navy, background: '#fff', border: `1px solid ${border}`, borderRadius: 2, padding: '4px 10px', cursor: 'pointer' }}>
                Tweak
              </button>
              <button
                onClick={async () => {
                  const res = await fetch(`/api/employment/style-profiles/${encodeURIComponent(p.id)}`, { method: 'DELETE', credentials: 'include' });
                  if (res.ok) onChanged();
                }}
                style={{ fontSize: 12, color: muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                delete
              </button>
            </div>
          ))}
        </div>
      )}

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
          onClick={() => void build(false)}
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
      {files.length === 2 && (
        <p style={{ fontSize: 12.5, color: muted, margin: '8px 0 0' }}>Two examples work; three or more teach the style more reliably. Read what was learned before you draft with it.</p>
      )}
      {error && <p role="alert" style={{ fontSize: 12.5, color: red, margin: '8px 0 0' }}>{error}</p>}

      {typeIssues.length > 0 && (
        <div role="alert" style={{ marginTop: 10, background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2, padding: '10px 13px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: amber, marginBottom: 4 }}>
            {typeIssues.length === 1 ? 'One file does not look like this document' : 'Some files do not look like this document'}
          </div>
          <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12.5, color: ink }}>
            {typeIssues.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          <div style={{ fontSize: 12.5, color: muted, marginBottom: 8 }}>
            Teaching this style from the wrong document would shape every later draft of
            <b> {documentLabel}</b>. Remove them, or continue if the reading is wrong.
          </div>
          <button
            onClick={() => { setTypeIssues([]); void build(true); }}
            disabled={busy}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
          >
            These are the right precedents; continue
          </button>
        </div>
      )}

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
          {built.guide.documentKind === 'letter' && (
            <div style={{ marginTop: 10, border: `1px solid ${border}`, padding: '10px 12px', background: '#fbfaf8' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: ink, marginBottom: 5 }}>
                Read this before you draft: it goes into every letter word for word
              </div>
              {(built.guide.openingBlock ?? []).length > 0 && (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: navy, marginTop: 6 }}>Opening</div>
                  <pre style={{ fontSize: 12, color: ink, whiteSpace: 'pre-wrap', margin: '3px 0 0', fontFamily: sans }}>
                    {(built.guide.openingBlock ?? []).join('\n')}
                  </pre>
                </>
              )}
              {(built.guide.fixedClauses ?? []).length > 0 && (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: navy, marginTop: 8 }}>
                    Standard passages ({(built.guide.fixedClauses ?? []).length})
                  </div>
                  {(built.guide.fixedClauses ?? []).map((c, i) => (
                    <div key={i} style={{ fontSize: 12, color: ink, marginTop: 4 }}>
                      <b>{c.part}:</b> {c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text}
                    </div>
                  ))}
                </>
              )}
              {(built.guide.closingBlock ?? []).length > 0 && (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: navy, marginTop: 8 }}>Closing</div>
                  <pre style={{ fontSize: 12, color: ink, whiteSpace: 'pre-wrap', margin: '3px 0 0', fontFamily: sans }}>
                    {(built.guide.closingBlock ?? []).join('\n')}
                  </pre>
                </>
              )}
              <div style={{ fontSize: 11.5, color: muted, marginTop: 8, lineHeight: 1.5 }}>
                Anything wrong here reaches a letter you send. Use Edit above to fix wording, delete a passage you have outgrown, or correct a [SLOT] that means something different at your firm.
              </div>
            </div>
          )}
          <div style={{ fontSize: 12.5, color: muted, marginTop: 6 }}>
            Pick this style beside the Generate button whenever it fits the case. It stays on the firm and applies to every future matter without re-teaching.
          </div>
        </div>
      )}
    </div>
  );
}
