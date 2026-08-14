/**
 * RevisionPanel — apply a client's or the partner's feedback to a draft.
 *
 * Paste the feedback, review what Starling proposes to do with each piece of
 * it, approve item by item, then apply. Nothing changes until the lawyer
 * approves, paragraphs that were not approved cannot be altered, and a
 * factual correction updates the matter as well as the sentence.
 */

import { useCallback, useRef, useState } from 'react';
import { navy, cream, green, amber, red, border, ink, muted, serif, sans } from './shared.js';

type RevisionKind = 'factual_correction' | 'position_change' | 'wording' | 'needs_lawyer';

interface RevisionItem {
  id: string;
  feedback: string;
  kind: RevisionKind;
  paragraphIndices: number[];
  proposal: string;
  intakeField?: string;
  intakeValue?: string | number | boolean;
  reason?: string;
  /** Review findings only: what kind of problem it is. */
  category?: string;
  /** checked = computed from the record; judgment = Starling's opinion. */
  basis?: 'checked' | 'judgment';
}

const CATEGORY_LABEL: Record<string, string> = {
  figure_mismatch: 'Figure not supported by the file',
  record_contradiction: 'Contradicts the record',
  unsupported_assertion: 'Unsupported assertion',
  missing_point: 'Missing point',
  thin_section: 'Thin section',
  style_divergence: 'Departs from your style',
};

interface Plan {
  docType: string;
  paragraphs: Array<{ index: number; text: string }>;
  items: RevisionItem[];
  warnings: string[];
  costUsd: number;
}

const KIND_LABEL: Record<RevisionKind, string> = {
  factual_correction: 'Corrects a fact',
  position_change: 'Changes our position',
  wording: 'Wording',
  needs_lawyer: 'Needs your judgment',
};

const KIND_COLOUR: Record<RevisionKind, string> = {
  factual_correction: navy,
  position_change: amber,
  wording: muted,
  needs_lawyer: red,
};

export interface RevisionPanelProps {
  matterId: string;
  docType: string;
  docTitle: string;
  /** Prefills the box when the partner asked for changes. */
  initialFeedback?: string;
  source?: 'client' | 'partner' | 'lawyer';
  /** Section headings of the document; enables the section-scoped redraft picker. */
  sections?: string[];
  /** Preselects a section for redraft. */
  initialSection?: string;
  /** Review the draft against this firm style as well as the record. */
  styleProfileId?: string;
  /** Stored sources on the matter (research, case lists) the rewrite may ground itself in. */
  briefSources?: Array<{ id: string; name: string; words: number }>;
  onApplied: (revisedHtml?: string) => void;
  onClose: () => void;
}

export function RevisionPanel({
  matterId, docType, docTitle, initialFeedback, source = 'client', sections, initialSection, styleProfileId, briefSources, onApplied, onClose,
}: RevisionPanelProps) {
  const [feedback, setFeedback] = useState(initialFeedback ?? '');
  const [researchIds, setResearchIds] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [section, setSection] = useState(initialSection ?? '');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [confirmedJudgment, setConfirmedJudgment] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [cleanNotice, setCleanNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ changed: number; intakeApplied: string[]; analysisStale: boolean } | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /** Take back a Word file the client edited: read its comments and
   *  tracked changes into the feedback box, where they are reviewed like
   *  any other feedback. */
  const readWordFile = useCallback(async (file: File) => {
    setBusy(true); setError(null); setUploadNote(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const res = await fetch(`/api/employment/${matterId}/revision/upload`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, docxBase64: btoa(binary), filename: file.name }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? 'Could not read that file.'); return; }
      if (d.clean) {
        setUploadNote('That file has no comments or tracked changes. If the client edited the text directly, paste what they asked for below.');
        return;
      }
      setFeedback(f => (f.trim() ? `${f.trim()}\n${d.feedback}` : d.feedback));
      const who = (d.authors as string[]).filter(Boolean).join(', ');
      setUploadNote(
        `Read ${d.comments} comment${d.comments === 1 ? '' : 's'} and ${d.trackedChanges} tracked change${d.trackedChanges === 1 ? '' : 's'}`
        + `${who ? ` from ${who}` : ''}. Review them below before anything changes.`,
      );
    } catch {
      setError('Could not read that file.');
    } finally { setBusy(false); }
  }, [matterId, docType]);

  // Ask Starling what is wrong with the document as it stands. The
  // findings arrive in the same item shape, so the approval gate below is
  // unchanged: Starling proposes, the lawyer decides.
  const runReview = useCallback(async () => {
    setReviewing(true); setError(null);
    try {
      const res = await fetch(`/api/employment/${matterId}/draft/review`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, ...(styleProfileId ? { styleProfileId } : {}), ...(researchIds.size ? { sourceIds: [...researchIds] } : {}) }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? 'The review could not be completed.'); return; }
      if ((d.items as RevisionItem[]).length === 0) {
        setCleanNotice('Starling found nothing to raise. That is a real answer, not a failure.');
        return;
      }
      setPlan({ docType, paragraphs: d.paragraphs ?? [], items: d.items ?? [], warnings: [], costUsd: d.costUsd ?? 0 });
      setApproved({});
      setConfirmedJudgment({});
    } catch {
      setError('The review could not be completed.');
    } finally { setReviewing(false); }
  }, [matterId, docType, styleProfileId]);

  const buildPlan = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/employment/${matterId}/revision/plan`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, feedback, source, ...(section ? { section } : {}), ...(researchIds.size ? { sourceIds: [...researchIds] } : {}) }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? 'Could not read that feedback.'); return; }
      setPlan(d as Plan);
      // Everything the lawyer must judge starts unapproved.
      setApproved(Object.fromEntries(
        (d.items as RevisionItem[]).map(i => [i.id, i.kind !== 'needs_lawyer']),
      ));
    } catch {
      setError('Could not read that feedback.');
    } finally { setBusy(false); }
  }, [matterId, docType, feedback, source, section, researchIds]);

  const apply = useCallback(async () => {
    if (!plan) return;
    // Confirmed judgment items ride along, promoted to wording changes:
    // the lawyer's explicit confirmation IS the judgment they needed.
    const confirmed = plan.items
      .filter(i => i.kind === 'needs_lawyer' && confirmedJudgment[i.id] && i.paragraphIndices.length > 0)
      .map(i => ({ ...i, kind: 'wording' as RevisionKind }));
    const items = [
      ...plan.items.filter(i => approved[i.id] && i.kind !== 'needs_lawyer'),
      ...confirmed,
    ];
    if (items.length === 0) { setError('Approve at least one change to apply.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/employment/${matterId}/revision/apply`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, approved: items, ...(researchIds.size ? { sourceIds: [...researchIds] } : {}) }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? 'Could not apply the revisions.'); return; }
      setResult({
        changed: (d.changedParagraphs as number[])?.length ?? 0,
        intakeApplied: (d.intakeApplied as string[]) ?? [],
        analysisStale: Boolean(d.analysisStale),
      });
      onApplied(typeof d.html === 'string' ? d.html : undefined);
    } catch {
      setError('Could not apply the revisions.');
    } finally { setBusy(false); }
  }, [plan, approved, confirmedJudgment, matterId, docType, researchIds, onApplied]);

  const box = { background: '#fff', border: `1px solid ${border}`, borderRadius: 2, padding: '18px 20px', marginBottom: 16 };
  const btn = (primary = false) => ({
    fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans,
    background: primary ? navy : '#fff', color: primary ? '#fff' : navy,
    border: `1px solid ${primary ? navy : border}`, cursor: busy ? 'wait' : 'pointer',
  });

  if (result) {
    return (
      <div style={box}>
        <h3 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 6px' }}>Feedback applied</h3>
        <p style={{ fontSize: 13, color: ink, margin: '0 0 8px' }}>
          {result.changed} paragraph{result.changed === 1 ? '' : 's'} revised. The previous version is kept in this
          document's history.
        </p>
        {result.intakeApplied.length > 0 && (
          <p style={{ fontSize: 13, color: ink, margin: '0 0 8px' }}>
            The matter was corrected too ({result.intakeApplied.join(', ')}), so later documents and the deadline
            calculations use the corrected facts.
          </p>
        )}
        {result.analysisStale && (
          <p role="status" style={{ fontSize: 12.5, color: amber, margin: '0 0 10px' }}>
            That correction feeds the damages and limitation analysis. Run the analysis again before relying on the
            figures.
          </p>
        )}
        <button onClick={onClose} style={btn(true)}>Done</button>
      </div>
    );
  }

  if (!plan) {
    return (
      <div style={box}>
        <h3 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 4px' }}>
          {section ? `Redraft one section of the ${docTitle.toLowerCase()}` : `Apply feedback to the ${docTitle.toLowerCase()}`}
        </h3>
        <p style={{ fontSize: 13, color: muted, margin: '0 0 12px' }}>
          {source === 'lawyer'
            ? 'Say what you want changed, in your own words. Starling'
            : `Paste the ${source === 'partner' ? 'reviewing lawyer' : 'client'}\u2019s feedback as it arrived. Starling`} 
          works out which paragraphs each point affects and proposes what to change. Nothing is edited until you
          approve it.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".docx"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void readWordFile(f); e.target.value = ''; }}
          aria-label="Upload the edited Word file"
        />
        {(sections?.length ?? 0) > 0 && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12.5, color: muted, fontWeight: 600, marginRight: 8 }}>
              Scope
              <select
                value={section}
                onChange={e => setSection(e.target.value)}
                aria-label="Limit the redraft to one section"
                style={{ marginLeft: 8, fontFamily: sans, fontSize: 13, padding: '7px 10px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff' }}
              >
                <option value="">Whole document</option>
                {sections!.map(h => <option key={h} value={h}>Only: {h}</option>)}
              </select>
            </label>
            {section && (
              <span style={{ fontSize: 12, color: muted, marginLeft: 8 }}>
                Every other section stays byte-identical; that is verified, not assumed.
              </span>
            )}
          </div>
        )}
        <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => void runReview()} disabled={busy || reviewing} style={{ ...btn(true), background: reviewing ? muted : navy }}>
            {reviewing ? 'Reading the document…' : 'Ask Starling to review it'}
          </button>
          <span style={{ fontSize: 12.5, color: muted }}>or</span>
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={btn()}>
            Upload the edited Word file
          </button>
          <span style={{ fontSize: 12.5, color: muted, marginLeft: 10 }}>
            or paste the feedback below
          </span>
        </div>
        {uploadNote && (
          <p role="status" style={{ fontSize: 12.5, color: navy, margin: '0 0 8px' }}>{uploadNote}</p>
        )}
        <textarea
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          rows={8}
          placeholder="Paste the email or notes here."
          style={{ width: '100%', fontSize: 13, padding: 12, border: `1px solid ${border}`, borderRadius: 2, boxSizing: 'border-box', fontFamily: sans }}
          aria-label="Feedback"
        />
        {(briefSources?.length ?? 0) > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: ink, marginBottom: 4 }}>
              Ground the rewrite in research on this matter
            </div>
            <div style={{ fontSize: 12, color: muted, marginBottom: 6 }}>
              Tick a source and the rewrite may cite and quote from it: a case list here is how the case table populates. Cases not in a ticked source or the document do not exist to the rewrite. Attach more in the brief&rsquo;s Sources panel.
            </div>
            {briefSources!.map(src => (
              <label key={src.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ink, cursor: 'pointer', padding: '2px 0' }}>
                <input
                  type="checkbox"
                  checked={researchIds.has(src.id)}
                  onChange={() => setResearchIds(prev => { const next = new Set(prev); if (next.has(src.id)) next.delete(src.id); else next.add(src.id); return next; })}
                  style={{ accentColor: navy }}
                />
                {src.name} <span style={{ color: muted }}>({src.words} words)</span>
              </label>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => void buildPlan()} disabled={busy || !feedback.trim()} style={btn(true)}>
            {busy ? 'Reading the feedback…' : 'Review what would change'}
          </button>
          <button onClick={onClose} style={{ ...btn(), border: 'none', background: 'none', color: muted }}>Cancel</button>
        </div>
        {error && <p role="alert" style={{ fontSize: 12.5, color: red, margin: '8px 0 0' }}>{error}</p>}
        {cleanNotice && <p role="status" style={{ fontSize: 12.5, color: green, margin: '8px 0 0' }}>{cleanNotice}</p>}
      </div>
    );
  }

  const needsJudgment = plan.items.filter(i => i.kind === 'needs_lawyer');
  const actionable = plan.items.filter(i => i.kind !== 'needs_lawyer');

  return (
    <div style={box}>
      <h3 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 4px' }}>Review what would change</h3>
      <p style={{ fontSize: 13, color: muted, margin: '0 0 12px' }}>
        {actionable.length} change{actionable.length === 1 ? '' : 's'} proposed
        {needsJudgment.length > 0 && `, ${needsJudgment.length} left for you`}.
      </p>
      {plan.warnings.map(w => (
        <p key={w} role="status" style={{ fontSize: 12.5, color: amber, margin: '0 0 8px' }}>{w}</p>
      ))}

      <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
        {plan.items.map(it => {
          const isJudgment = it.kind === 'needs_lawyer';
          return (
            <div key={it.id} style={{
              border: `1px solid ${isJudgment ? red : border}`, borderRadius: 2, padding: '12px 14px',
              background: isJudgment ? '#fdecec' : cream,
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {!isJudgment && (
                  <input
                    type="checkbox"
                    checked={Boolean(approved[it.id])}
                    onChange={e => setApproved(a => ({ ...a, [it.id]: e.target.checked }))}
                    style={{ marginTop: 3 }}
                    aria-label={`Approve: ${it.proposal}`}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, color: it.basis === 'checked' ? navy : KIND_COLOUR[it.kind], textTransform: 'uppercase' as const,
                    letterSpacing: 0.4,
                  }}>
                    {it.category ? (CATEGORY_LABEL[it.category] ?? it.category) : KIND_LABEL[it.kind]}
                  </span>
                  {it.basis && (
                    <span style={{
                      marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 2,
                      background: it.basis === 'checked' ? '#e7f6ec' : '#f4f1ec',
                      color: it.basis === 'checked' ? green : muted,
                    }}>
                      {it.basis === 'checked' ? 'CHECKED' : 'JUDGMENT'}
                    </span>
                  )}
                  <div style={{ fontSize: 13, color: ink, marginTop: 4, fontFamily: serif }}>
                    &ldquo;{it.feedback}&rdquo;
                  </div>
                  <div style={{ fontSize: 12.5, color: muted, marginTop: 4 }}>
                    {isJudgment
                      ? (it.reason ?? 'Starling will not act on this without you.')
                      : it.proposal}
                  </div>
                  {it.paragraphIndices.length > 0 && (
                    <div style={{ fontSize: 11.5, color: muted, marginTop: 4 }}>
                      Paragraph{it.paragraphIndices.length === 1 ? '' : 's'} {it.paragraphIndices.map(i => i + 1).join(', ')}
                    </div>
                  )}
                  {isJudgment && it.paragraphIndices.length > 0 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12.5, color: ink, cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(confirmedJudgment[it.id])}
                        onChange={e => setConfirmedJudgment(c => ({ ...c, [it.id]: e.target.checked }))}
                        style={{ accentColor: red }}
                        aria-label={`I have considered this and want it applied: ${it.feedback}`}
                      />
                      I have considered this. Apply it as written.
                    </label>
                  )}
                  {isJudgment && it.paragraphIndices.length === 0 && (
                    <div style={{ fontSize: 11.5, color: muted, marginTop: 6 }}>
                      This point names no paragraph, so nothing can be applied automatically. Restate it in the feedback box naming what to change, or edit the document directly.
                    </div>
                  )}
                  {it.intakeField && (
                    <div style={{ fontSize: 11.5, color: navy, marginTop: 4 }}>
                      Also corrects the matter: {it.intakeField} &rarr; {String(it.intakeValue)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => void apply()} disabled={busy} style={{ ...btn(true), background: green, border: `1px solid ${green}` }}>
          {busy ? 'Applying…' : 'Apply the approved changes'}
        </button>
        <button onClick={() => { setPlan(null); setError(null); }} style={btn()}>Back</button>
        <button onClick={onClose} style={{ ...btn(), border: 'none', background: 'none', color: muted }}>Cancel</button>
      </div>
      {error && <p role="alert" style={{ fontSize: 12.5, color: red, margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
