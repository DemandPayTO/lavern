/**
 * PrecedentAlignPanel — build a firm template from several precedents.
 *
 * The lawyer uploads three or more precedents of the same document type.
 * Starling diffs them: text that recurs is the firm's boilerplate and is
 * kept verbatim, text that varies becomes a placeholder. Nothing is saved
 * until every proposed placeholder has been accepted, renamed, or rejected.
 *
 * The alignment runs on the server and involves no model call; the
 * precedents never leave the firm's own deployment.
 */

import { useCallback, useRef, useState } from 'react';
import { navy, cream, green, amber, red, border, ink, muted, serif, sans } from './shared.js';

interface AlignedSlot {
  id: string;
  kind: string;
  lineIndex: number;
  observedValues: string[];
  suggestedPlaceholder: string | null;
  basis: 'matter_data' | 'pattern' | 'unclassified';
}

interface AlignedLine {
  index: number;
  presentIn: number[];
  skeleton: string;
  stable: boolean;
}

interface Alignment {
  lines: AlignedLine[];
  slots: AlignedSlot[];
  stableLineCount: number;
  optionalLineCount: number;
  precedentNames: string[];
  warnings: string[];
}

/** Facts Starling fills from the matter's own record. */
const DATA_FIELDS = [
  'CLIENT_NAME', 'CLIENT_FIRST_NAME', 'CLIENT_LAST_NAME', 'CLIENT_ADDRESS',
  'EMPLOYER_NAME', 'EMPLOYER_ADDRESS', 'JOB_TITLE', 'HIRE_DATE',
  'TERMINATION_DATE', 'ANNUAL_SALARY', 'AMOUNT',
  'FIRM_NAME', 'LAWYER_NAME', 'FIRM_ADDRESS', 'DATE', 'FILE_NUMBER',
  'COURT_NAME', 'COURT_FILE_NUMBER',
];

/** Passages Starling writes for the matter and places at this point. */
const WRITTEN_SECTIONS = [
  'EMPLOYMENT_BACKGROUND', 'TERMINATION_FACTS', 'FACTS_SECTION',
  'LEGAL_ANALYSIS', 'LEGAL_BASIS', 'DAMAGES_SECTION', 'DAMAGES_PARTICULARS',
  'DEMAND', 'RELIEF_SOUGHT', 'CLAIM', 'CLOSING', 'TITLE_OF_PROCEEDINGS',
  'OFFER_SUMMARY', 'STATUTORY_FLOOR', 'NOTICE_RANGE', 'CLAUSE_ANALYSIS',
  'GAP_ANALYSIS', 'OTHER_FACTORS', 'RECOMMENDATION',
];

const BASIS_LABEL: Record<AlignedSlot['basis'], string> = {
  matter_data: 'matched to matter data',
  pattern: 'recognised by shape',
  unclassified: 'needs a name',
};

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export interface PrecedentAlignPanelProps {
  documentType: string;
  documentLabel: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function PrecedentAlignPanel({ documentType, documentLabel, onSaved, onCancel }: PrecedentAlignPanelProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string | null>>({});
  const [variantLabel, setVariantLabel] = useState('');
  const [includeOptional, setIncludeOptional] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const runAlignment = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const precedents = await Promise.all(files.map(async f => ({
        name: f.name, docxBase64: await fileToBase64(f),
      })));
      const res = await fetch('/api/employment/templates/align', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType, precedents }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? 'Alignment failed.'); return; }
      const result = d.alignment as Alignment;
      setAlignment(result);
      setDecisions(Object.fromEntries(result.slots.map(s => [s.id, s.suggestedPlaceholder])));
    } catch {
      setError('Could not read those files.');
    } finally { setBusy(false); }
  }, [files, documentType]);

  const save = useCallback(async () => {
    if (!alignment) return;
    if (!variantLabel.trim()) { setError('Name this template first.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/employment/templates/align/save', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType, variantLabel: variantLabel.trim(),
          alignment, decisions, includeOptionalLines: includeOptional,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? 'Could not save the template.'); return; }
      onSaved();
    } catch {
      setError('Could not save the template.');
    } finally { setBusy(false); }
  }, [alignment, decisions, documentType, variantLabel, includeOptional, onSaved]);

  const undecided = alignment
    ? alignment.slots.filter(s => decisions[s.id] === null || decisions[s.id] === undefined).length
    : 0;

  const box = { background: '#fff', border: `1px solid ${border}`, borderRadius: 2, padding: '18px 20px' };

  // ── Step 1: choose precedents ─────────────────────────────────────────
  if (!alignment) {
    return (
      <div style={{ ...box, marginBottom: 16 }}>
        <h3 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 4px' }}>
          Build a template from your precedents
        </h3>
        <p style={{ fontSize: 13, color: muted, margin: '0 0 14px' }}>
          Upload three or more of your own {documentLabel.toLowerCase()}s for the same kind of case.
          Starling compares them: wording that appears in all of them is your firm's language and is
          kept exactly as written, and the parts that differ between cases become the fields it fills
          in. This runs entirely on your own server and uses no AI.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".docx"
          multiple
          style={{ display: 'none' }}
          onChange={e => { setFiles([...(e.target.files ?? [])]); e.target.value = ''; }}
          aria-label="Choose precedent files"
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => inputRef.current?.click()}
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
          >
            Choose files
          </button>
          <button
            onClick={() => void runAlignment()}
            disabled={files.length < 3 || busy}
            style={{
              fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans,
              background: files.length >= 3 && !busy ? navy : '#fff',
              color: files.length >= 3 && !busy ? '#fff' : muted,
              border: `1px solid ${files.length >= 3 && !busy ? navy : border}`,
              cursor: files.length >= 3 && !busy ? 'pointer' : 'default',
            }}
          >
            {busy ? 'Comparing…' : 'Compare precedents'}
          </button>
          <button
            onClick={onCancel}
            style={{ fontSize: 13, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: 'none', color: muted, border: 'none', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>

        {files.length > 0 && (
          <ul style={{ fontSize: 12.5, color: ink, margin: '12px 0 0', paddingLeft: 18 }}>
            {files.map(f => <li key={f.name}>{f.name}</li>)}
          </ul>
        )}
        {files.length > 0 && files.length < 3 && (
          <p style={{ fontSize: 12.5, color: amber, margin: '8px 0 0' }}>
            Three or more are needed. With only two, wording that happens to appear in both cannot be
            told apart from your standard language.
          </p>
        )}
        {error && <p role="alert" style={{ fontSize: 12.5, color: red, margin: '8px 0 0' }}>{error}</p>}
      </div>
    );
  }

  // ── Step 2: review the proposal ───────────────────────────────────────
  return (
    <div style={{ ...box, marginBottom: 16 }}>
      <h3 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 4px' }}>Review the template</h3>
      <p style={{ fontSize: 13, color: muted, margin: '0 0 6px' }}>
        Compared {alignment.precedentNames.length} precedents.{' '}
        <b style={{ color: ink }}>{alignment.stableLineCount}</b> paragraphs were identical in all of
        them and are kept word for word.{' '}
        <b style={{ color: ink }}>{alignment.slots.length}</b> spots differ between cases.
      </p>
      {alignment.warnings.map(w => (
        <p key={w} role="status" style={{ fontSize: 12.5, color: amber, margin: '0 0 8px' }}>{w}</p>
      ))}

      {/* The skeleton, with slots inline */}
      <div style={{ border: `1px solid ${border}`, borderRadius: 2, padding: '14px 16px', maxHeight: 300, overflowY: 'auto', background: cream, fontFamily: serif, fontSize: 13.5, lineHeight: 1.7, margin: '10px 0 16px' }}>
        {alignment.lines.map(line => {
          const optional = !line.stable && line.presentIn.length < alignment.precedentNames.length;
          const rendered = line.skeleton.replace(/‹slot:(s\d+)›/g, (_m, id: string) => {
            const chosen = decisions[id];
            return chosen ? `{{${chosen}}}` : '[…]';
          });
          return (
            <p key={line.index} style={{ margin: '0 0 6px', color: optional ? muted : ink }}>
              {rendered}
              {optional && (
                <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: amber }}>
                  ONLY IN SOME
                </span>
              )}
            </p>
          );
        })}
      </div>

      {/* Slot decisions */}
      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        {alignment.slots.map(slot => (
          <div key={slot.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px solid ${border}`, paddingBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 12.5, color: ink }}>
                {slot.observedValues.map((v, i) => (
                  <span key={i}>
                    {i > 0 && <span style={{ color: muted }}> · </span>}
                    <span style={{ fontFamily: serif }}>{v || '(blank)'}</span>
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: slot.basis === 'unclassified' ? amber : muted, marginTop: 2 }}>
                {BASIS_LABEL[slot.basis]}
              </div>
            </div>
            <select
              value={decisions[slot.id] ?? ''}
              onChange={e => setDecisions(d => ({ ...d, [slot.id]: e.target.value || null }))}
              style={{ fontSize: 12.5, padding: '6px 8px', border: `1px solid ${border}`, borderRadius: 2, minWidth: 190, fontFamily: sans }}
              aria-label={`Field for ${slot.observedValues[0] || 'this spot'}`}
            >
              <option value="">Keep the original wording</option>
              <optgroup label="Facts from the matter">
                {DATA_FIELDS.map(p => <option key={p} value={p}>{p}</option>)}
              </optgroup>
              <optgroup label="Passages Starling writes">
                {WRITTEN_SECTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </optgroup>
            </select>
          </div>
        ))}
      </div>

      {alignment.optionalLineCount > 0 && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: ink, marginBottom: 12 }}>
          <input type="checkbox" checked={includeOptional} onChange={e => setIncludeOptional(e.target.checked)} />
          Keep the {alignment.optionalLineCount} paragraph{alignment.optionalLineCount === 1 ? '' : 's'} that
          appeared in only some of the precedents
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={variantLabel}
          onChange={e => setVariantLabel(e.target.value)}
          placeholder="Name this template, e.g. Medical leave"
          style={{ fontSize: 13, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, minWidth: 260, fontFamily: sans }}
          aria-label="Template name"
        />
        <button
          onClick={() => void save()}
          disabled={busy}
          style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: green, color: '#fff', border: `1px solid ${green}`, cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? 'Saving…' : 'Save as template'}
        </button>
        <button
          onClick={() => { setAlignment(null); setFiles([]); }}
          style={{ fontSize: 13, padding: '8px 14px', borderRadius: 2, fontFamily: sans, background: 'none', color: muted, border: 'none', cursor: 'pointer' }}
        >
          Start over
        </button>
      </div>
      {undecided > 0 && (
        <p style={{ fontSize: 12.5, color: muted, margin: '8px 0 0' }}>
          {undecided} spot{undecided === 1 ? '' : 's'} will keep the wording from your first precedent.
          Choose a field for any that should change per case.
        </p>
      )}
      {error && <p role="alert" style={{ fontSize: 12.5, color: red, margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
