/**
 * CaseFileDropPanel — the bulk case file drop (Phase 3).
 *
 * Drop up to 30 documents at once: each is parsed, its type detected, and
 * extracted in parallel (three at a time, failures isolated per file). The
 * panel then shows the deterministic cross-document review — the master
 * chronology with every entry cited to its source document(s), and the
 * fields on which documents disagree, side by side for the lawyer to pick.
 * One button generates the source-cited case review memo (the only LLM
 * pass beyond the per-document extractions). Nothing reaches the intake or
 * the timeline without a click.
 */

import { useState, useCallback, useRef } from 'react';
import type { ChronologyEntry, FieldConflict, ApplyExtractionResult } from './hooks/useStarlingApi.js';
import { DocumentHtml } from './DocumentHtml.js';

const navy = '#0f1a2e';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const green = '#16a34a';
const amber = '#d97706';
const red = '#dc2626';
const sans = "system-ui, -apple-system, sans-serif";

const MAX_FILES = 30;
const CONCURRENCY = 3;

interface FileJob {
  name: string;
  status: 'queued' | 'reading' | 'extracting' | 'done' | 'failed';
  kind?: string;
  error?: string;
}

interface Props {
  classifyDocument: (file: File) => Promise<{ ok: boolean; error?: string; kind?: string; confidence?: string; fallback?: boolean; content?: string; name?: string; definedTerms?: string[] }>;
  extractParsed: (content: string, name: string, kind: string, definedTerms?: string[]) => Promise<{ ok: boolean; error?: string }>;
  getCaseReview: () => Promise<{ ok: boolean; error?: string; chronology?: ChronologyEntry[]; conflicts?: FieldConflict[]; extractionCount?: number }>;
  applyChronology: (events: Array<{ date: string; label: string; category: string; sourceDoc: string }>) => Promise<{ ok: boolean; error?: string; added?: Array<{ date: string; label: string }> }>;
  generateCaseSynthesis: () => Promise<{ ok: boolean; error?: string; document?: { html: string; documentTitle: string; lawyerReviewFlags?: string[] } }>;
  applyExtraction: (extractionId: string, fields: string[], overwrite: string[]) => Promise<ApplyExtractionResult>;
  /**
   * The deep read (summary, standing checks, questions, comparison), which
   * also proposes intake facts server-side. When absent the deep-read
   * option is not offered and every document goes through extractParsed.
   */
  analyzeDocument?: (args: {
    docName: string; kind: string; docText: string; questions?: string[];
    comparisonName?: string; comparisonText?: string; definedTerms?: string[];
  }) => Promise<{ ok: boolean; error?: string; factsProposed?: number }>;
  onDone: () => void;
}

/** Classifier kinds map onto the deep read's narrower kind set. */
const ANALYSIS_KIND: Record<string, string> = {
  employment_agreement: 'employment_agreement',
  termination_letter: 'termination_letter',
  pay_stub: 'pay_stub',
};

const chronKey = (c: ChronologyEntry): string => `${c.field}|${c.date}`;

export function CaseFileDropPanel({ classifyDocument, extractParsed, getCaseReview, applyChronology, generateCaseSynthesis, applyExtraction, analyzeDocument, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const compareRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [running, setRunning] = useState(false);
  const [deepRead, setDeepRead] = useState(false);
  const [questionsText, setQuestionsText] = useState('');
  const [compareDoc, setCompareDoc] = useState<{ name: string; text: string } | null>(null);
  const [compareParsing, setCompareParsing] = useState(false);
  const [review, setReview] = useState<{ chronology: ChronologyEntry[]; conflicts: FieldConflict[]; extractionCount: number } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chronMsg, setChronMsg] = useState<string | null>(null);
  const [conflictBusy, setConflictBusy] = useState<string | null>(null);
  const [memo, setMemo] = useState<{ html: string; title: string; flags: string[] } | null>(null);
  const [memoBusy, setMemoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReview = useCallback(async () => {
    setReviewBusy(true);
    const r = await getCaseReview();
    setReviewBusy(false);
    if (!r.ok) { setError(r.error ?? 'Could not load the case review.'); return; }
    const chron = r.chronology ?? [];
    setReview({ chronology: chron, conflicts: r.conflicts ?? [], extractionCount: r.extractionCount ?? 0 });
    setSelected(new Set(chron.filter(c => !c.onTimeline).map(chronKey)));
    setError(null);
  }, [getCaseReview]);

  const handleFiles = useCallback(async (list: FileList) => {
    const files = Array.from(list).slice(0, MAX_FILES);
    if (files.length === 0) return;
    setError(list.length > MAX_FILES ? `Only the first ${MAX_FILES} files were queued.` : null);
    setReview(null);
    setMemo(null);
    setChronMsg(null);
    setJobs(files.map(f => ({ name: f.name, status: 'queued' as const })));
    setRunning(true);

    const setJob = (i: number, patch: Partial<FileJob>): void => {
      setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, ...patch } : j));
    };

    // The deep read applies per document; the comparison only makes sense
    // against a single main document, so it is skipped (and said so) when
    // several are dropped at once.
    const questions = questionsText.split('\n').map(q => q.trim().slice(0, 600)).filter(Boolean).slice(0, 12);
    const wantDeep = deepRead && Boolean(analyzeDocument);
    const withCompare = wantDeep && compareDoc && files.length === 1;

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const i = next; next += 1;
        const file = files[i];
        try {
          setJob(i, { status: 'reading' });
          const c = await classifyDocument(file);
          if (!c.ok || !c.content || !c.name) { setJob(i, { status: 'failed', error: c.error ?? 'Could not read the file.' }); continue; }
          const kind = c.fallback || !c.kind ? 'other' : c.kind;
          setJob(i, { status: 'extracting', kind });
          if (wantDeep && analyzeDocument) {
            const r = await analyzeDocument({
              docName: c.name, kind: ANALYSIS_KIND[kind] ?? 'other', docText: c.content,
              questions,
              comparisonName: withCompare ? compareDoc!.name : undefined,
              comparisonText: withCompare ? compareDoc!.text : undefined,
              definedTerms: c.definedTerms,
            });
            setJob(i, r.ok ? { status: 'done' } : { status: 'failed', error: r.error ?? 'The read failed.' });
          } else {
            const r = await extractParsed(c.content, c.name, kind, c.definedTerms);
            setJob(i, r.ok ? { status: 'done' } : { status: 'failed', error: r.error ?? 'Extraction failed.' });
          }
        } catch (err) {
          setJob(i, { status: 'failed', error: err instanceof Error ? err.message : 'Failed.' });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()));
    setRunning(false);
    onDone();
    await loadReview();
  }, [classifyDocument, extractParsed, analyzeDocument, deepRead, questionsText, compareDoc, loadReview, onDone]);

  const handleApplyChronology = useCallback(async () => {
    if (!review) return;
    const events = review.chronology
      .filter(c => selected.has(chronKey(c)))
      .map(c => ({ date: c.date, label: c.label, category: c.category, sourceDoc: c.sources.map(s => s.filename).join(', ') }));
    if (events.length === 0) return;
    const r = await applyChronology(events);
    if (!r.ok) { setError(r.error ?? 'Could not update the timeline.'); return; }
    setChronMsg(`Added ${r.added?.length ?? 0} event${(r.added?.length ?? 0) === 1 ? '' : 's'} to the timeline.`);
    await loadReview();
  }, [review, selected, applyChronology, loadReview]);

  const handlePickConflict = useCallback(async (field: string, extractionId: string) => {
    setConflictBusy(field);
    const r = await applyExtraction(extractionId, [field], [field]);
    setConflictBusy(null);
    if (!r.ok) { setError(r.error ?? 'Could not apply the value.'); return; }
    onDone();
    await loadReview();
  }, [applyExtraction, loadReview, onDone]);

  const handleMemo = useCallback(async () => {
    setMemoBusy(true);
    const r = await generateCaseSynthesis();
    setMemoBusy(false);
    if (!r.ok || !r.document) { setError(r.error ?? 'The memo could not be generated.'); return; }
    setMemo({ html: r.document.html, title: r.document.documentTitle, flags: r.document.lawyerReviewFlags ?? [] });
  }, [generateCaseSynthesis]);

  const doneCount = jobs.filter(j => j.status === 'done').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;

  return (
    <div style={{ marginTop: 18, borderTop: `2px solid ${border}`, paddingTop: 16, fontFamily: sans }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: ink }}>Add documents to this matter</div>
          <div style={{ fontSize: 12.5, color: muted, marginTop: 2 }}>
            One document or the whole file, up to {MAX_FILES} at once. Starling detects each type, reads it, and
            proposes the facts it finds for your review; it builds the chronology and flags where the documents
            disagree. Names are anonymised before any AI processing. Nothing reaches the intake without your approval.
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.rtf"
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) void handleFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={running}
          style={{ marginLeft: 'auto', background: running ? '#b0b0b0' : navy, color: '#fff', fontSize: 13.5, fontWeight: 600, padding: '10px 18px', borderRadius: 2, border: 'none', cursor: running ? 'not-allowed' : 'pointer' }}
        >
          {running ? `Processing ${doneCount + failedCount}/${jobs.length}...` : '+ Add documents'}
        </button>
        {jobs.length === 0 && !review && (
          <button
            onClick={() => { void loadReview(); }}
            disabled={reviewBusy}
            style={{ background: 'none', color: navy, fontSize: 13, fontWeight: 600, padding: '10px 6px', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {reviewBusy ? 'Loading...' : 'Review already-uploaded documents'}
          </button>
        )}
      </div>

      {analyzeDocument && (
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ink, cursor: 'pointer' }}>
            <input type="checkbox" checked={deepRead} onChange={e => setDeepRead(e.target.checked)} style={{ accentColor: navy }} />
            Also summarize each document, run its standing checks, and answer my questions. The read is saved under Saved reads below.
          </label>
          {deepRead && (
            <div style={{ marginTop: 8, paddingLeft: 22 }}>
              <textarea
                value={questionsText}
                onChange={e => setQuestionsText(e.target.value)}
                rows={2}
                placeholder="Questions to answer about the documents, one per line. Leave blank for the summary and checks alone."
                aria-label="Questions to answer about the documents"
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '8px 10px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12.5, color: muted }}>
                <input
                  ref={compareRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md,.rtf"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setCompareParsing(true);
                      void classifyDocument(f).then(c => {
                        setCompareParsing(false);
                        if (c.ok && c.content && c.name) setCompareDoc({ name: c.name, text: c.content });
                      });
                    }
                    if (compareRef.current) compareRef.current.value = '';
                  }}
                />
                {compareDoc ? (
                  <span>
                    Comparing against <b style={{ color: ink }}>{compareDoc.name}</b>
                    <button onClick={() => setCompareDoc(null)} style={{ marginLeft: 8, background: 'none', border: `1px solid ${border}`, color: muted, cursor: 'pointer', fontSize: 12, fontFamily: sans, padding: '2px 8px', borderRadius: 2 }}>Discard</button>
                  </span>
                ) : (
                  <button
                    onClick={() => compareRef.current?.click()}
                    disabled={compareParsing}
                    style={{ background: 'none', border: `1px solid ${border}`, color: navy, cursor: compareParsing ? 'not-allowed' : 'pointer', fontSize: 12.5, fontFamily: sans, padding: '5px 10px', borderRadius: 2 }}
                  >
                    {compareParsing ? 'Reading…' : 'Compare against a second document'}
                  </button>
                )}
                <span>The comparison applies when one document is added at a time; it is skipped on a multi-document drop.</span>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ marginTop: 10, fontSize: 13, color: red }}>{error}</div>}

      {/* Per-file progress */}
      {jobs.length > 0 && (
        <div role="list" aria-label="Case file processing" style={{ marginTop: 12, border: `1px solid ${border}`, background: '#fff' }}>
          {jobs.map((j, i) => (
            <div key={`${j.name}-${i}`} role="listitem" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: i < jobs.length - 1 ? `1px solid ${border}` : 'none', fontSize: 12.5 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: j.status === 'done' ? green : j.status === 'failed' ? red : j.status === 'queued' ? '#c8c2b8' : amber,
              }} aria-hidden="true" />
              <span style={{ color: ink, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{j.name}</span>
              {j.kind && <span style={{ color: muted }}>{j.kind.replace(/_/g, ' ')}</span>}
              <span style={{ marginLeft: 'auto', color: j.status === 'failed' ? red : muted }}>
                {j.status === 'queued' ? 'queued' : j.status === 'reading' ? 'detecting type...' : j.status === 'extracting' ? 'extracting facts...' : j.status === 'done' ? 'done' : (j.error ?? 'failed')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Cross-document review */}
      {review && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: ink }}>
            Chronology <span style={{ fontWeight: 400, color: muted }}>({review.chronology.length} dated facts across {review.extractionCount} documents)</span>
          </div>
          {review.chronology.length === 0 ? (
            <div style={{ fontSize: 13, color: muted, marginTop: 6 }}>No dated facts were extracted.</div>
          ) : (
            <>
              <div style={{ marginTop: 8, border: `1px solid ${border}`, background: '#fff' }}>
                {review.chronology.map(c => {
                  const key = chronKey(c);
                  return (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: `1px solid ${border}`, fontSize: 12.5, cursor: c.onTimeline ? 'default' : 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        disabled={c.onTimeline}
                        onChange={e => {
                          setSelected(prev => {
                            const nxt = new Set(prev);
                            if (e.target.checked) nxt.add(key); else nxt.delete(key);
                            return nxt;
                          });
                        }}
                        style={{ accentColor: navy }}
                        aria-label={`Add to timeline: ${c.label} ${c.date}`}
                      />
                      <span style={{ fontFamily: 'ui-monospace, monospace', color: muted }}>{c.date}</span>
                      <span style={{ color: ink, fontWeight: 600 }}>{c.label}</span>
                      <span style={{ color: muted, marginLeft: 'auto', textAlign: 'right' }}>
                        {c.sources.map(s => s.filename).join(', ')}
                        {c.sources.length > 1 && <b style={{ color: green }}> ·{c.sources.length} sources</b>}
                        {c.sources.some(s => s.verified) && <span style={{ color: green }}> ✓</span>}
                      </span>
                      {c.onTimeline && <span style={{ fontSize: 11, color: muted }}>on timeline</span>}
                    </label>
                  );
                })}
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  onClick={() => { void handleApplyChronology(); }}
                  disabled={[...selected].length === 0}
                  style={{ background: [...selected].length ? navy : '#b0b0b0', color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, border: 'none', cursor: [...selected].length ? 'pointer' : 'not-allowed' }}
                >
                  Add {[...selected].length} to the timeline
                </button>
                {chronMsg && <span style={{ fontSize: 12.5, color: green }}>{chronMsg}</span>}
              </div>
            </>
          )}

          <div style={{ fontSize: 13.5, fontWeight: 700, color: review.conflicts.length ? red : ink, marginTop: 16 }}>
            Conflicts <span style={{ fontWeight: 400, color: muted }}>({review.conflicts.length})</span>
          </div>
          {review.conflicts.length === 0 ? (
            <div style={{ fontSize: 13, color: muted, marginTop: 6 }}>The documents agree with each other and the intake.</div>
          ) : (
            <div style={{ marginTop: 8, border: `1px solid ${red}`, background: '#fff' }}>
              {review.conflicts.map(c => (
                <div key={c.field} style={{ padding: '10px 12px', borderBottom: `1px solid ${border}`, fontSize: 12.5 }}>
                  <div style={{ fontWeight: 700, color: ink }}>{c.field.replace(/_/g, ' ')}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                    <span style={{ border: `1px solid ${border}`, padding: '3px 8px', borderRadius: 2, color: muted }}>
                      intake: <b style={{ color: ink }}>{c.current === null ? 'blank' : String(c.current)}</b>
                    </span>
                    {c.candidates.map((cand, i) => (
                      <span key={i} style={{ border: `1px solid ${border}`, padding: '3px 8px', borderRadius: 2, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <b style={{ color: ink }}>{String(cand.value)}</b>
                        <span style={{ color: muted }}>{cand.filename} · {cand.confidence}{cand.verified ? ' ✓' : ''}</span>
                        <button
                          onClick={() => { void handlePickConflict(c.field, cand.extractionId); }}
                          disabled={conflictBusy === c.field}
                          style={{ background: navy, color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 2, border: 'none', cursor: 'pointer' }}
                        >
                          {conflictBusy === c.field ? '...' : 'Use'}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={() => { void handleMemo(); }}
              disabled={memoBusy || review.extractionCount === 0}
              style={{ background: memoBusy ? '#b0b0b0' : navy, color: '#fff', fontSize: 13.5, fontWeight: 600, padding: '10px 16px', borderRadius: 2, border: 'none', cursor: memoBusy ? 'not-allowed' : 'pointer' }}
            >
              {memoBusy ? 'Writing the memo...' : 'Generate case review memo'}
            </button>
            <span style={{ fontSize: 12.5, color: muted }}>One model pass over the extracted facts; every claim cites its source document.</span>
          </div>

          {memo && (
            <div style={{ marginTop: 14 }}>
              {memo.flags.map((f, i) => (
                <div key={i} style={{ fontSize: 12.5, color: amber, marginBottom: 4 }}>⚑ {f}</div>
              ))}
              <DocumentHtml className="starling-doc" style={{ border: `1px solid ${border}`, background: '#fff', padding: '18px 22px', marginTop: 6 }}
                html={memo.html} />
              <div style={{ fontSize: 12, color: muted, marginTop: 6 }}>
                Saved to this matter's draft history as {memo.title}.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
