/**
 * ApprovalsView — the firm review queue ("#/approvals").
 *
 * Two lists: documents awaiting the caller's review, and the caller's own
 * submissions. Selecting a row opens the one-screen approval package:
 * summary chips, the document, what changed since the reviewer last read
 * it, and the actions the caller's role and the review's status allow.
 * Every action here is deterministic and free; the server enforces the
 * state machine and firm scoping.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { navy, orange, cream, frame, green, amber, red, border, ink, muted, serif, sans } from './shared.js';

interface ReviewSummary {
  matterLabel: string;
  citationCount: number;
  reviewFlagCount: number;
  unresolvedMarkers: number;
}

interface QueueRow {
  id: string;
  matterId: string;
  docType: string;
  docTitle: string;
  fileNumber: string;
  status: 'pending' | 'in_review' | 'changes_requested' | 'resubmitted' | 'approved' | 'withdrawn';
  submitterId: string;
  reviewerId: string | null;
  submittedAt: string;
  decidedAt: string | null;
  dueDate: string;
  summary: ReviewSummary;
  changesDescription: string | null;
  versionCount: number;
}

interface DiffSegment { type: 'same' | 'added' | 'removed'; text: string }

interface ReviewDetail extends QueueRow {
  html: string;
  currentVersionKind: string;
  currentVersionHasDocx: boolean;
  reviewNotes: string | null;
  versions: Array<{ at: string; authorId: string; kind: string; filename: string | null }>;
  diff: DiffSegment[] | null;
}

const STATUS_LABELS: Record<QueueRow['status'], string> = {
  pending: 'Awaiting review',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  withdrawn: 'Withdrawn',
};

const STATUS_COLOURS: Record<QueueRow['status'], string> = {
  pending: amber,
  in_review: navy,
  changes_requested: red,
  resubmitted: amber,
  approved: green,
  withdrawn: muted,
};

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function ApprovalsView() {
  const [toReview, setToReview] = useState<QueueRow[]>([]);
  const [mine, setMine] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [role, setRole] = useState<'review' | 'mine'>('review');
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editHtml, setEditHtml] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [changesText, setChangesText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadQueue = useCallback(() => {
    fetch('/api/reviews', { credentials: 'include' })
      .then(async r => {
        // The routes refuse with 404 while the lane is switched off.
        if (r.status === 404) { setDisabled(true); setLoading(false); return; }
        const d = await r.json();
        if (d.ok) { setToReview(d.toReview ?? []); setMine(d.mine ?? []); }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadDetail = useCallback((id: string) => {
    setError(null);
    fetch(`/api/reviews/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.ok) setDetail(d.review); else setError(d.error ?? 'Could not load the review.'); })
      .catch(() => setError('Could not load the review.'));
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  const act = useCallback(async (path: string, options?: RequestInit) => {
    if (!selectedId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(path, { credentials: 'include', method: 'POST', headers: { 'content-type': 'application/json' }, ...options });
      const d = await res.json();
      if (!d.ok) setError(d.error ?? 'The action failed.');
      loadQueue();
      loadDetail(selectedId);
    } catch {
      setError('The action failed.');
    } finally {
      setBusy(false);
    }
  }, [selectedId, loadQueue, loadDetail]);

  const uploadWord = useCallback(async (file: File) => {
    if (!selectedId) return;
    if (!file.name.toLowerCase().endsWith('.docx')) { setError('Upload a .docx file.'); return; }
    setBusy(true); setError(null);
    try {
      const b64 = await fileToBase64(file);
      await act(`/api/reviews/${selectedId}/version`, {
        body: JSON.stringify({ docxBase64: b64, filename: file.name }),
      });
    } catch {
      setError('Could not read that file.');
      setBusy(false);
    }
  }, [selectedId, act]);

  const chip = (label: string, colour: string) => (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: colour, border: `1px solid ${colour}`, borderRadius: 2, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {label}
    </span>
  );

  const overdue = (r: QueueRow) => r.dueDate < new Date().toISOString().slice(0, 10)
    && (r.status === 'pending' || r.status === 'in_review' || r.status === 'resubmitted');

  const queueRow = (r: QueueRow, rowRole: 'review' | 'mine') => (
    <button
      key={r.id}
      onClick={() => { setSelectedId(r.id); setRole(rowRole); setEditing(false); setApproveNote(''); setChangesText(''); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
        background: selectedId === r.id ? '#fff' : cream, border: `1px solid ${selectedId === r.id ? navy : border}`,
        borderRadius: 2, padding: '12px 16px', cursor: 'pointer', fontFamily: sans,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: ink }}>{r.docTitle}</div>
        <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>
          {r.fileNumber} · submitted {r.submittedAt.slice(0, 10)}
          {overdue(r) && <b style={{ color: red }}> · sitting since {r.dueDate}</b>}
        </div>
      </div>
      {chip(STATUS_LABELS[r.status], STATUS_COLOURS[r.status])}
    </button>
  );

  const summaryChips = (d: ReviewDetail) => (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: muted, margin: '10px 0 16px' }}>
      <span><b style={{ color: ink }}>{d.fileNumber}</b></span>
      <span>{d.summary.citationCount} citation{d.summary.citationCount === 1 ? '' : 's'} verified</span>
      <span style={{ color: d.summary.unresolvedMarkers > 0 ? amber : muted }}>
        {d.summary.unresolvedMarkers} unresolved lawyer marker{d.summary.unresolvedMarkers === 1 ? '' : 's'}
      </span>
      <span>{d.summary.reviewFlagCount} review flag{d.summary.reviewFlagCount === 1 ? '' : 's'}</span>
      <span>version {d.versionCount}</span>
      <span>respond by {d.dueDate}</span>
    </div>
  );

  const actionButton = (label: string, onClick: () => void, style?: React.CSSProperties) => (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, fontFamily: sans,
        background: navy, color: '#fff', border: `1px solid ${navy}`, cursor: busy ? 'wait' : 'pointer',
        ...style,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      <header
        style={{ background: navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', height: 64 }}
        role="banner"
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <a href="#/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }} aria-label="DemandPay Starling home">
            <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
            </span>
            <span style={{ fontFamily: serif, lineHeight: 1, letterSpacing: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>DEMAND</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>PAY</span>
            </span>
          </a>
          <span style={{ marginLeft: 14, paddingLeft: 16, borderLeft: '1px solid rgba(255,255,255,0.18)', fontFamily: serif, fontSize: 15, color: '#cfd6e0' }}>
            <b style={{ color: '#fff' }}>Starling</b> &middot; Approvals
          </span>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Main navigation">
          <a href="#/" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>My Cases</a>
          <a href="#/tasks" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>Tasks</a>
          <a href="#/approvals" aria-current="page" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#fff', border: '1px solid rgba(255,255,255,0.25)', textDecoration: 'none' }}>
            Approvals{toReview.length > 0 && (
              <span style={{ marginLeft: 6, background: orange, color: '#fff', borderRadius: 8, padding: '0 6px', fontSize: 11.5, fontWeight: 700 }}>{toReview.length}</span>
            )}
          </a>
          <a href="#/new-matter" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>New Matter</a>
        </nav>
      </header>

      <main id="main-content" style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 28px 64px' }}>
        <h1 style={{ fontFamily: serif, fontSize: 28, fontWeight: 600, margin: '0 0 4px' }}>Approvals</h1>
        <p style={{ fontSize: 14, color: muted, margin: '0 0 24px' }}>
          Documents routed for firm approval. Starling never sends or files; approval here unlocks the submitting lawyer to send.
        </p>

        {!loading && disabled ? (
          <div style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 2, padding: '20px 22px', maxWidth: 620 }}>
            <h2 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 6px' }}>Partner approval is turned off</h2>
            <p style={{ fontSize: 13.5, color: muted, margin: 0 }}>
              It needs a second lawyer at the firm, because nobody can review their own submission. Once a
              colleague is set up, this can be switched back on and drafts can be routed here for sign-off.
            </p>
          </div>
        ) : loading ? (
          <p style={{ color: muted }}>Loading the queue…</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: detail ? 'minmax(280px, 380px) 1fr' : '1fr', gap: 24, alignItems: 'start' }}>
            <div>
              <h2 style={{ fontFamily: serif, fontSize: 18, margin: '0 0 10px' }}>For your review</h2>
              {toReview.length === 0 && <p style={{ fontSize: 13, color: muted }}>Nothing is waiting on you.</p>}
              <div style={{ display: 'grid', gap: 8 }}>{toReview.map(r => queueRow(r, 'review'))}</div>

              <h2 style={{ fontFamily: serif, fontSize: 18, margin: '24px 0 10px' }}>Your submissions</h2>
              {mine.length === 0 && <p style={{ fontSize: 13, color: muted }}>You have not sent anything for approval yet. Use “Send for approval” on a draft.</p>}
              <div style={{ display: 'grid', gap: 8 }}>{mine.map(r => queueRow(r, 'mine'))}</div>
            </div>

            {detail && (
              <section style={{ background: '#fff', border: `1px solid ${border}`, borderRadius: 2, padding: '24px 28px' }} aria-label="Approval package">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <h2 style={{ fontFamily: serif, fontSize: 21, margin: 0 }}>{detail.docTitle}</h2>
                  {chip(STATUS_LABELS[detail.status], STATUS_COLOURS[detail.status])}
                </div>
                {summaryChips(detail)}

                {error && (
                  <div role="alert" style={{ background: '#fdecec', border: `1px solid ${red}`, borderRadius: 2, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{error}</div>
                )}

                {detail.changesDescription && detail.status === 'changes_requested' && (
                  <div style={{ background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>
                    <b>Changes requested:</b> {detail.changesDescription}
                  </div>
                )}
                {detail.reviewNotes && role === 'review' && (
                  <div style={{ background: cream, border: `1px solid ${border}`, borderRadius: 2, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>
                    <b>Reviewer notes (not shown to the submitter):</b> {detail.reviewNotes}
                  </div>
                )}

                {/* What changed since the reviewer last acted */}
                {detail.diff && (
                  <details open style={{ marginBottom: 16 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>
                      What changed since the last review
                    </summary>
                    <div style={{ border: `1px solid ${border}`, borderRadius: 2, padding: '12px 16px', marginTop: 8, fontSize: 13.5, fontFamily: serif, maxHeight: 320, overflowY: 'auto' }}>
                      {detail.diff.filter(s => s.type !== 'same').length === 0 && (
                        <p style={{ color: muted, margin: 0 }}>No text changes.</p>
                      )}
                      {detail.diff.map((s, i) => s.type === 'same' ? null : (
                        <p key={i} style={{
                          margin: '4px 0', padding: '4px 8px', borderRadius: 2,
                          background: s.type === 'added' ? '#e8f6ec' : '#fdecec',
                          textDecoration: s.type === 'removed' ? 'line-through' : 'none',
                          color: s.type === 'removed' ? muted : ink,
                        }}>
                          {s.text}
                        </p>
                      ))}
                    </div>
                  </details>
                )}

                {/* The document */}
                {editing ? (
                  <div style={{ marginBottom: 16 }}>
                    <textarea
                      value={editHtml}
                      onChange={e => setEditHtml(e.target.value)}
                      rows={18}
                      style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, padding: 12, border: `1px solid ${border}`, borderRadius: 2, boxSizing: 'border-box' }}
                      aria-label="Edit document content"
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      {actionButton('Save as new version', () => {
                        void act(`/api/reviews/${detail.id}/version`, { body: JSON.stringify({ html: editHtml }) }).then(() => setEditing(false));
                      })}
                      {actionButton('Cancel', () => setEditing(false), { background: '#fff', color: navy, border: `1px solid ${border}` })}
                    </div>
                  </div>
                ) : (
                  <div
                    className="starling-doc"
                    style={{ background: '#fff', border: `1px solid ${border}`, padding: '24px 28px', fontFamily: serif, fontSize: 14, lineHeight: 1.7, maxHeight: 480, overflowY: 'auto', marginBottom: 16 }}
                    dangerouslySetInnerHTML={{ __html: detail.html }}
                  />
                )}

                {/* Actions by role and state */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <a
                    href={`/api/reviews/${detail.id}/download`}
                    download
                    style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, background: '#fff', color: navy, border: `1px solid ${border}`, textDecoration: 'none', fontFamily: sans }}
                  >
                    Download Word copy
                  </a>

                  {role === 'review' && (detail.status === 'pending' || detail.status === 'resubmitted') &&
                    actionButton('Start review', () => void act(`/api/reviews/${detail.id}/claim`))}

                  {((role === 'review' && detail.status === 'in_review') || (role === 'mine' && detail.status === 'changes_requested')) && (
                    <>
                      {!editing && actionButton('Edit in place', () => { setEditHtml(detail.html); setEditing(true); }, { background: '#fff', color: navy, border: `1px solid ${border}` })}
                      {actionButton('Upload Word version', () => fileInputRef.current?.click(), { background: '#fff', color: navy, border: `1px solid ${border}` })}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".docx"
                        style={{ display: 'none' }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) void uploadWord(f); e.target.value = ''; }}
                        aria-label="Upload a Word version"
                      />
                    </>
                  )}

                  {role === 'mine' && detail.status === 'changes_requested' &&
                    actionButton('Resubmit for approval', () => void act(`/api/reviews/${detail.id}/resubmit`))}

                  {role === 'mine' && detail.status !== 'approved' && detail.status !== 'withdrawn' &&
                    actionButton('Withdraw', () => void act(`/api/reviews/${detail.id}`, { method: 'DELETE', body: undefined }), { background: '#fff', color: red, border: `1px solid ${red}` })}
                </div>

                {role === 'review' && detail.status === 'in_review' && (
                  <div style={{ marginTop: 20, borderTop: `1px solid ${border}`, paddingTop: 16 }}>
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }} htmlFor="approve-note">
                          Note for the record (optional, kept with the review)
                        </label>
                        <input
                          id="approve-note"
                          value={approveNote}
                          onChange={e => setApproveNote(e.target.value)}
                          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${border}`, borderRadius: 2, boxSizing: 'border-box' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {actionButton('Approve', () => void act(`/api/reviews/${detail.id}/approve`, { body: JSON.stringify({ notes: approveNote || undefined }) }), { background: green, border: `1px solid ${green}` })}
                      </div>
                      <div>
                        <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }} htmlFor="changes-text">
                          Or request changes (the submitter sees this)
                        </label>
                        <textarea
                          id="changes-text"
                          value={changesText}
                          onChange={e => setChangesText(e.target.value)}
                          rows={3}
                          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${border}`, borderRadius: 2, boxSizing: 'border-box' }}
                        />
                        <div style={{ marginTop: 6 }}>
                          {actionButton('Request changes', () => {
                            if (!changesText.trim()) { setError('Describe the changes you need.'); return; }
                            void act(`/api/reviews/${detail.id}/request-changes`, { body: JSON.stringify({ changesDescription: changesText }) });
                          }, { background: '#fff', color: red, border: `1px solid ${red}` })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
