/**
 * Document analysis panel — ask Starling to read a document.
 *
 * The lawyer picks a document (bonus plan, employment agreement,
 * termination letter, pay stub, or a written summary from the client),
 * optionally asks their own questions, optionally attaches a second
 * document to compare against (a case, an earlier version), and clicks
 * Read this document. The result is a summary, the standing checks for
 * that kind of document with verbatim quotes, answers to the questions,
 * and the comparison. Everything is stored on the matter, so a read from
 * last month is still there when the file heats up.
 *
 * Canon: the AI action is "Read", rejection is "Discard", every finding
 * that claims the document says something carries the quote, and the
 * disabled button says why it is disabled.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { navy, amber, red, border, ink, muted, serif, sans } from './shared.js';

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'bonus_plan', label: 'Bonus or incentive plan' },
  { value: 'employment_agreement', label: 'Employment agreement' },
  { value: 'termination_letter', label: 'Termination letter' },
  { value: 'pay_stub', label: 'Pay stub' },
  { value: 'client_summary', label: 'Written summary from the client' },
  { value: 'other', label: 'Other document' },
];

interface ChecklistFinding {
  id: string;
  status: 'present' | 'absent' | 'unclear';
  finding: string;
  quote?: string;
}

interface StoredAnalysis {
  id: string;
  createdAt: string;
  docName: string;
  kind: string;
  questions: string[];
  comparisonName?: string;
  deterministicNotes: string[];
  result: {
    summary: string;
    checklist: ChecklistFinding[];
    answers: Array<{ question: string; answer: string; quote?: string }>;
    comparison?: { commonGround: string[]; differences: string[]; takeaway: string } | null;
    redFlags: string[];
  };
  costUsd: number;
}

const STATUS_STYLE: Record<ChecklistFinding['status'], { label: string; color: string; bg: string }> = {
  present: { label: 'Found', color: '#1a7a3a', bg: '#e7f6ec' },
  absent: { label: 'Not there', color: muted, bg: '#f4f1ec' },
  unclear: { label: 'Unclear', color: amber, bg: '#fdf0dd' },
};

async function parseFile(file: File): Promise<{ text: string; definedTerms: string[] } | { error: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/documents/parse', { method: 'POST', credentials: 'include', body: formData });
  if (!res.ok) return { error: 'Could not read the file. Supported: PDF, DOCX, Markdown, plain text.' };
  const parsed = await res.json() as { fullText?: string; definedTerms?: string[] };
  if (!parsed.fullText?.trim()) return { error: 'No text could be read from this file.' };
  return { text: parsed.fullText.slice(0, 100_000), definedTerms: (parsed.definedTerms ?? []).slice(0, 20) };
}

export function DocAnalysisPanel({ matterId }: { matterId: string }) {
  const [analyses, setAnalyses] = useState<StoredAnalysis[]>([]);
  const [kind, setKind] = useState('employment_agreement');
  const [mainDoc, setMainDoc] = useState<{ name: string; text: string; definedTerms: string[] } | null>(null);
  const [compareDoc, setCompareDoc] = useState<{ name: string; text: string } | null>(null);
  const [questionsText, setQuestionsText] = useState('');
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [docPasting, setDocPasting] = useState(false);
  const [docPasteText, setDocPasteText] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const compareInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/employment/${matterId}/doc-analyses`, { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json() as { analyses?: StoredAnalysis[] };
      setAnalyses(json.analyses ?? []);
    } catch { /* the list is a convenience; a failed load leaves it empty */ }
  }, [matterId]);

  useEffect(() => { void load(); }, [load]);

  const pickFile = async (file: File, target: 'main' | 'compare') => {
    setErrorMsg(null);
    const parsed = await parseFile(file);
    if ('error' in parsed) { setErrorMsg(parsed.error); return; }
    if (target === 'main') setMainDoc({ name: file.name, text: parsed.text, definedTerms: parsed.definedTerms });
    else setCompareDoc({ name: file.name, text: parsed.text });
  };

  const blockedReason = !mainDoc ? 'Choose or paste the document first.' : null;

  const read = async () => {
    if (!mainDoc || reading) return;
    setReading(true);
    setMessage(null);
    setErrorMsg(null);
    try {
      const questions = questionsText.split('\n').map(q => q.trim()).filter(Boolean).slice(0, 12);
      const res = await fetch(`/api/employment/${matterId}/doc-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          docName: mainDoc.name,
          kind,
          docText: mainDoc.text,
          questions,
          comparisonName: compareDoc?.name,
          comparisonText: compareDoc?.text,
          definedTerms: mainDoc.definedTerms,
        }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; analysis?: StoredAnalysis; error?: string };
      if (!res.ok || !json.analysis) {
        setErrorMsg(json.error ?? 'The read could not be completed. Try again.');
        return;
      }
      setAnalyses(prev => [json.analysis!, ...prev]);
      setOpenId(json.analysis.id);
      const bits = [`Read ${mainDoc.name}.`];
      const found = json.analysis.result.checklist.filter(c => c.status === 'present').length;
      if (found > 0) bits.push(`${found} of the standing checks found something, each with the quote it came from.`);
      if (questions.length > 0) bits.push(`Your ${questions.length === 1 ? 'question is' : `${questions.length} questions are`} answered below.`);
      if (compareDoc) bits.push(`Compared against ${compareDoc.name}.`);
      bits.push('The read is saved on this matter.');
      setMessage(bits.join(' '));
      setMainDoc(null);
      setCompareDoc(null);
      setQuestionsText('');
    } catch {
      setErrorMsg('The read could not be completed. Try again.');
    } finally {
      setReading(false);
    }
  };

  const discard = async (id: string) => {
    try {
      const res = await fetch(`/api/employment/${matterId}/doc-analyses/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setAnalyses(prev => prev.filter(a => a.id !== id));
        setMessage('The read was discarded. The document itself is untouched.');
      }
    } catch { /* leave the row; nothing worse than a stale list */ }
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginTop: 16 }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        Ask Starling to read a document
      </div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 12, lineHeight: 1.55 }}>
        A bonus plan, an agreement, a termination letter, a pay stub, or the client&rsquo;s written summary.
        Starling summarizes it, runs the checks that always matter for that kind of document, answers your
        questions, and can compare it against a second document such as a case. Every finding quotes the line
        it came from. Reads are saved on this matter. Names are anonymised before any AI processing.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select
          value={kind}
          onChange={e => setKind(e.target.value)}
          aria-label="What kind of document is this"
          style={{ fontFamily: sans, fontSize: 13.5, padding: '9px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
        >
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          ref={mainInputRef} type="file" accept=".pdf,.docx,.doc,.txt,.md,.rtf" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void pickFile(f, 'main'); if (mainInputRef.current) mainInputRef.current.value = ''; }}
        />
        <button
          onClick={() => mainInputRef.current?.click()}
          style={{ background: '#fff', color: navy, fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 2, border: `1px solid ${navy}`, cursor: 'pointer', fontFamily: sans }}
        >
          {mainDoc ? `Document: ${mainDoc.name}` : 'Choose the document'}
        </button>
        <button
          onClick={() => setDocPasting(v => !v)}
          style={{ background: '#fff', color: navy, fontSize: 13, padding: '9px 14px', borderRadius: 2, border: `1px solid ${border}`, cursor: 'pointer', fontFamily: sans }}
        >
          Paste the text instead
        </button>
        <input
          ref={compareInputRef} type="file" accept=".pdf,.docx,.doc,.txt,.md,.rtf" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void pickFile(f, 'compare'); if (compareInputRef.current) compareInputRef.current.value = ''; }}
        />
        <button
          onClick={() => compareInputRef.current?.click()}
          style={{ background: '#fff', color: muted, fontSize: 13, padding: '9px 14px', borderRadius: 2, border: `1px solid ${border}`, cursor: 'pointer', fontFamily: sans }}
        >
          {compareDoc ? `Comparing against: ${compareDoc.name}` : 'Compare against a second document (optional)'}
        </button>
        {compareDoc && (
          <button onClick={() => setCompareDoc(null)} aria-label="Remove the comparison document" style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer', fontSize: 12.5, fontFamily: sans }}>
            Remove
          </button>
        )}
      </div>

      {docPasting && !mainDoc && (
        <div style={{ marginBottom: 10 }}>
          <textarea
            value={docPasteText}
            onChange={e => setDocPasteText(e.target.value)}
            rows={6}
            placeholder="Paste the document or the client's written summary here. This is the text Starling reads."
            aria-label="Paste the document to read"
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
          />
          <button
            onClick={() => {
              if (docPasteText.trim().length < 20) return;
              setMainDoc({ name: 'Pasted text', text: docPasteText.slice(0, 100_000), definedTerms: [] });
              setDocPasting(false);
              setDocPasteText('');
            }}
            disabled={docPasteText.trim().length < 20}
            style={{ marginTop: 8, background: docPasteText.trim().length < 20 ? '#b0b0b0' : navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 2, border: 'none', cursor: docPasteText.trim().length < 20 ? 'not-allowed' : 'pointer', fontFamily: sans }}
          >
            Use this text as the document
          </button>
          {docPasteText.trim().length < 20 && (
            <span style={{ fontSize: 12.5, color: muted, marginLeft: 10 }}>Paste the text first. The box above this one is where the document goes; the box below is for your questions.</span>
          )}
        </div>
      )}

      <textarea
        value={questionsText}
        onChange={e => setQuestionsText(e.target.value)}
        placeholder={'Your questions, one per line (optional). For example:\nDoes the plan cut off the bonus during the notice period?\nIs vacation pay calculated on commissions?'}
        aria-label="Your questions, one per line"
        rows={3}
        style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical', marginBottom: 10 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => void read()}
          disabled={reading || Boolean(blockedReason)}
          style={{
            background: reading || blockedReason ? '#b0b0b0' : navy, color: '#fff', fontSize: 13.5, fontWeight: 600,
            padding: '10px 18px', borderRadius: 2, border: 'none',
            cursor: reading || blockedReason ? 'not-allowed' : 'pointer', fontFamily: sans,
          }}
        >
          {reading ? 'Reading…' : 'Read this document'}
        </button>
        {blockedReason && !reading && <span style={{ fontSize: 12.5, color: muted }}>{blockedReason}</span>}
      </div>

      {errorMsg && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: red }}>{errorMsg}</div>}
      {message && <div role="status" style={{ marginTop: 10, fontSize: 13, color: ink, background: '#faf8f5', border: `1px solid ${border}`, padding: '10px 12px' }}>{message}</div>}

      {analyses.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Saved reads on this matter
          </div>
          {analyses.map(a => {
            const open = openId === a.id;
            const kindLabel = KIND_OPTIONS.find(o => o.value === a.kind)?.label ?? a.kind.replace(/_/g, ' ');
            return (
              <div key={a.id} style={{ border: `1px solid ${border}`, marginBottom: 8 }}>
                <button
                  onClick={() => setOpenId(open ? null : a.id)}
                  aria-expanded={open}
                  style={{ width: '100%', textAlign: 'left', background: open ? '#faf8f5' : '#fff', border: 'none', padding: '10px 14px', cursor: 'pointer', fontFamily: sans, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>{a.docName}</span>
                  <span style={{ fontSize: 12, color: muted }}>{kindLabel}</span>
                  {a.comparisonName && <span style={{ fontSize: 12, color: muted }}>compared with {a.comparisonName}</span>}
                  <span style={{ fontSize: 12, color: muted, marginLeft: 'auto' }}>{new Date(a.createdAt).toLocaleDateString()}</span>
                </button>
                {open && (
                  <div style={{ padding: '4px 14px 14px', fontSize: 13, color: ink, lineHeight: 1.6 }}>
                    <div style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{a.result.summary}</div>

                    {a.deterministicNotes.length > 0 && (
                      <div style={{ background: '#faf8f5', border: `1px solid ${border}`, padding: '8px 12px', marginBottom: 10 }}>
                        {a.deterministicNotes.map((n, i) => <div key={i} style={{ fontSize: 12.5 }}>{n}</div>)}
                      </div>
                    )}

                    {a.result.checklist.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                          The standing checks for a {kindLabel.toLowerCase()}
                        </div>
                        {a.result.checklist.map(c => {
                          const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.unclear;
                          return (
                            <div key={c.id} style={{ padding: '6px 0', borderBottom: `1px solid ${border}` }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 2, background: st.bg, color: st.color, marginRight: 8 }}>{st.label}</span>
                              <span>{c.finding}</span>
                              {c.quote && (
                                <blockquote style={{ margin: '6px 0 0 0', paddingLeft: 10, borderLeft: `3px solid ${border}`, fontSize: 12.5, color: muted, fontStyle: 'italic' }}>
                                  &ldquo;{c.quote}&rdquo;
                                </blockquote>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {a.result.answers.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Your questions</div>
                        {a.result.answers.map((ans, i) => (
                          <div key={i} style={{ padding: '6px 0' }}>
                            <div style={{ fontWeight: 600 }}>{ans.question}</div>
                            <div>{ans.answer}</div>
                            {ans.quote && (
                              <blockquote style={{ margin: '6px 0 0 0', paddingLeft: 10, borderLeft: `3px solid ${border}`, fontSize: 12.5, color: muted, fontStyle: 'italic' }}>
                                &ldquo;{ans.quote}&rdquo;
                              </blockquote>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {a.result.comparison && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                          Against {a.comparisonName ?? 'the comparison document'}
                        </div>
                        {a.result.comparison.commonGround.length > 0 && (
                          <div><b>Common ground:</b>{' '}{a.result.comparison.commonGround.join(' ')}</div>
                        )}
                        {a.result.comparison.differences.length > 0 && (
                          <div><b>Differences:</b>{' '}{a.result.comparison.differences.join(' ')}</div>
                        )}
                        <div style={{ marginTop: 4 }}>{a.result.comparison.takeaway}</div>
                      </div>
                    )}

                    {a.result.redFlags.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: red, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Do not miss</div>
                        {a.result.redFlags.map((f, i) => <div key={i} style={{ padding: '2px 0' }}>{f}</div>)}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button
                        onClick={() => void discard(a.id)}
                        style={{ background: 'none', border: `1px solid ${border}`, color: muted, cursor: 'pointer', fontSize: 12.5, fontFamily: sans, padding: '5px 12px', borderRadius: 2 }}
                      >
                        Discard
                      </button>
                      <span style={{ fontSize: 12, color: muted }}>Discarding removes this read only. The document itself is untouched.</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
