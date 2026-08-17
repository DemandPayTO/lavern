// The submitter's side of the firm approval queue, shown under a draft's
// status row: send for approval, see feedback, resubmit, withdraw. Extracted
// from MatterDetailView.tsx; self-contained (owns its own fetches).

import { useState, useCallback, useEffect } from 'react';
import { navy, green, amber, red, border, ink, muted, sans } from './tokens.js';

const OPEN_REVIEW_STATUSES = ['pending', 'in_review', 'changes_requested', 'resubmitted'];

interface ReviewRowLite {
  id: string;
  matterId: string;
  docType: string;
  status: string;
  changesDescription: string | null;
  dueDate: string;
}

export function ReviewLaneControls({ matterId, docType, onApplyFeedback }: { matterId: string; docType: string; onApplyFeedback?: (feedback: string) => void }) {
  const [review, setReview] = useState<ReviewRowLite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/reviews', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return;
        const rows = (d.mine ?? []) as ReviewRowLite[];
        const forDoc = rows.filter(r => r.matterId === matterId && r.docType === docType);
        setReview(forDoc.find(r => OPEN_REVIEW_STATUSES.includes(r.status)) ?? forDoc.find(r => r.status === 'approved') ?? null);
      })
      .catch(() => { /* the panel is optional chrome; the queue view is authoritative */ });
  }, [matterId, docType]);
  useEffect(() => { load(); }, [load]);

  const run = async (method: 'POST' | 'DELETE', path: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(path, { method, credentials: 'include', headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ docType }) : undefined });
      const d = await res.json();
      if (!d.ok) setError(d.error ?? 'The action failed.');
      load();
    } catch { setError('The action failed.'); } finally { setBusy(false); }
  };

  const chipStyle = (colour: string) => ({
    fontSize: 11.5, fontWeight: 700, color: colour, border: `1px solid ${colour}`,
    borderRadius: 2, padding: '2px 8px', textTransform: 'uppercase' as const, letterSpacing: 0.4,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: muted }}>Approval:</span>
      {!review && (
        <button
          onClick={() => void run('POST', `/api/employment/${matterId}/reviews`)}
          disabled={busy}
          style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: busy ? 'wait' : 'pointer' }}
        >
          Send for approval
        </button>
      )}
      {review?.status === 'approved' && <span style={chipStyle(green)}>Approved</span>}
      {review && review.status !== 'approved' && (
        <>
          <span style={chipStyle(review.status === 'changes_requested' ? red : amber)}>
            {review.status === 'changes_requested' ? 'Changes requested' : review.status === 'in_review' ? 'In review' : 'Awaiting review'}
          </span>
          {review.status === 'changes_requested' && (
            <button
              onClick={() => void run('POST', `/api/reviews/${review.id}/resubmit`)}
              disabled={busy}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans, background: navy, color: '#fff', border: `1px solid ${navy}`, cursor: busy ? 'wait' : 'pointer' }}
            >
              Resubmit
            </button>
          )}
          <button
            onClick={() => void run('DELETE', `/api/reviews/${review.id}`)}
            disabled={busy}
            style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans, background: '#fff', color: red, border: `1px solid ${red}`, cursor: busy ? 'wait' : 'pointer' }}
          >
            Withdraw
          </button>
          <a href="#/approvals" style={{ fontSize: 12, color: navy }}>Open queue</a>
        </>
      )}
      {review?.status === 'changes_requested' && review.changesDescription && (
        <span style={{ flexBasis: '100%', fontSize: 12.5, color: ink, background: '#fdf0dd', border: `1px solid ${amber}`, borderRadius: 2, padding: '8px 12px' }}>
          <b>Reviewer feedback:</b> {review.changesDescription}
          {onApplyFeedback && (
            <button
              onClick={() => onApplyFeedback(review.changesDescription ?? '')}
              style={{
                marginLeft: 10, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 2,
                fontFamily: sans, background: navy, color: '#fff', border: `1px solid ${navy}`, cursor: 'pointer',
              }}
            >
              Apply this feedback
            </button>
          )}
        </span>
      )}
      {error && <span role="alert" style={{ flexBasis: '100%', fontSize: 12.5, color: red }}>{error}</span>}
    </div>
  );
}
