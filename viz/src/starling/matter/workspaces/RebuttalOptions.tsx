// Rebuttal workspace options: attach the letter being answered and the
// client's feedback. Extracted verbatim from MatterDetailView.tsx's draft tab.
// State stays in the parent and arrives as props (Option A) so nothing about
// generation changes.

import { navy, red, border, ink, muted, sans } from '../tokens.js';

type SourceRef = { name: string; words: number; savedAt: string } | null;
type SourceSlot = 'rebuttal-source' | 'rebuttal-feedback' | 'soc-source' | 'defence-source' | 'claim-source';

export function RebuttalOptions({
  sessionId, rebuttalSource, rebuttalFeedback, refreshEmployment,
  rebuttalInputRef, feedbackInputRef, rebuttalSaving,
  rebuttalPasting, setRebuttalPasting, rebuttalText, setRebuttalText, rebuttalError,
  feedbackPasting, setFeedbackPasting, feedbackText, setFeedbackText,
  attachRebuttalFile, attachRebuttalText,
}: {
  sessionId: string | null;
  rebuttalSource: SourceRef;
  rebuttalFeedback: SourceRef;
  refreshEmployment: () => void;
  rebuttalInputRef: React.RefObject<HTMLInputElement | null>;
  feedbackInputRef: React.RefObject<HTMLInputElement | null>;
  rebuttalSaving: boolean;
  rebuttalPasting: boolean;
  setRebuttalPasting: React.Dispatch<React.SetStateAction<boolean>>;
  rebuttalText: string;
  setRebuttalText: React.Dispatch<React.SetStateAction<string>>;
  rebuttalError: string | null;
  feedbackPasting: boolean;
  setFeedbackPasting: React.Dispatch<React.SetStateAction<boolean>>;
  feedbackText: string;
  setFeedbackText: React.Dispatch<React.SetStateAction<string>>;
  attachRebuttalFile: (file: File, slot?: SourceSlot) => void;
  attachRebuttalText: (name: string, text: string, slot?: SourceSlot) => void;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>The letter you are responding to</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.55 }}>
        Upload or paste opposing counsel&rsquo;s letter. The reply is drafted against its actual words, so this is required.
        Your client&rsquo;s corrections go in the direction box below; they override everything else.
      </div>
      {rebuttalSource ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13, color: ink }}>
          <span><b>{rebuttalSource.name}</b> · {rebuttalSource.words} words · attached {new Date(rebuttalSource.savedAt).toLocaleDateString()}</span>
          <button
            onClick={() => { void (async () => { await fetch(`/api/employment/${sessionId}/rebuttal-source`, { method: 'DELETE', credentials: 'include' }); refreshEmployment(); })(); }}
            style={{ background: 'none', border: `1px solid ${border}`, color: muted, cursor: 'pointer', fontSize: 12.5, fontFamily: sans, padding: '4px 10px', borderRadius: 2 }}
          >
            Discard
          </button>
          <span style={{ fontSize: 12, color: muted }}>Discarding removes the attachment only. Attach another to replace it.</span>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={rebuttalInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.rtf"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void attachRebuttalFile(f); e.target.value = ''; }}
              aria-label="Upload the letter from opposing counsel"
            />
            <button
              onClick={() => rebuttalInputRef.current?.click()}
              disabled={rebuttalSaving}
              style={{ background: '#fff', color: navy, border: `1px solid ${navy}`, fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, cursor: rebuttalSaving ? 'not-allowed' : 'pointer', fontFamily: sans }}
            >
              {rebuttalSaving ? 'Reading…' : 'Upload their letter'}
            </button>
            <button
              onClick={() => setRebuttalPasting(v => !v)}
              style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
            >
              Paste the text
            </button>
          </div>
          {rebuttalPasting && (
            <div style={{ marginTop: 10 }}>
              <textarea
                value={rebuttalText}
                onChange={e => setRebuttalText(e.target.value)}
                rows={5}
                placeholder="Paste opposing counsel's letter here."
                aria-label="Paste the letter from opposing counsel"
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
              />
              <button
                onClick={() => { if (rebuttalText.trim().length >= 50) void attachRebuttalText('Letter from opposing counsel (pasted)', rebuttalText); }}
                disabled={rebuttalSaving || rebuttalText.trim().length < 50}
                style={{ marginTop: 8, background: rebuttalSaving || rebuttalText.trim().length < 50 ? '#b0b0b0' : navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 2, border: 'none', cursor: rebuttalSaving || rebuttalText.trim().length < 50 ? 'not-allowed' : 'pointer', fontFamily: sans }}
              >
                {rebuttalSaving ? 'Saving…' : 'Attach their letter'}
              </button>
              {rebuttalText.trim().length < 50 && !rebuttalSaving && (
                <span style={{ fontSize: 12.5, color: muted, marginLeft: 10 }}>Paste the letter first.</span>
              )}
            </div>
          )}
          {rebuttalError && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: red }}>{rebuttalError}</div>}
        </div>
      )}

      <div style={{ borderTop: `1px solid ${border}`, marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>The client&rsquo;s feedback (optional)</div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.55 }}>
          Upload or paste the client&rsquo;s reply as it arrived. Starling reads it directly while drafting: instructions are followed, facts correct the record, and anything said in confidence is kept out of the letter and flagged for your check.
        </div>
        {rebuttalFeedback ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13, color: ink }}>
            <span><b>{rebuttalFeedback.name}</b> · {rebuttalFeedback.words} words · attached {new Date(rebuttalFeedback.savedAt).toLocaleDateString()}</span>
            <button
              onClick={() => { void (async () => { await fetch(`/api/employment/${sessionId}/rebuttal-feedback`, { method: 'DELETE', credentials: 'include' }); refreshEmployment(); })(); }}
              style={{ background: 'none', border: `1px solid ${border}`, color: muted, cursor: 'pointer', fontSize: 12.5, fontFamily: sans, padding: '4px 10px', borderRadius: 2 }}
            >
              Discard
            </button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                ref={feedbackInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt,.md,.rtf"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) void attachRebuttalFile(f, 'rebuttal-feedback'); e.target.value = ''; }}
                aria-label="Upload the client's feedback"
              />
              <button
                onClick={() => feedbackInputRef.current?.click()}
                disabled={rebuttalSaving}
                style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: rebuttalSaving ? 'not-allowed' : 'pointer', fontFamily: sans }}
              >
                Upload the client&rsquo;s feedback
              </button>
              <button
                onClick={() => setFeedbackPasting(v => !v)}
                style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
              >
                Paste it
              </button>
            </div>
            {feedbackPasting && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                  rows={5}
                  placeholder="Paste the client's feedback here, as it arrived."
                  aria-label="Paste the client's feedback"
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
                />
                <button
                  onClick={() => { if (feedbackText.trim().length >= 50) { void attachRebuttalText('Client feedback (pasted)', feedbackText, 'rebuttal-feedback'); setFeedbackText(''); setFeedbackPasting(false); } }}
                  disabled={rebuttalSaving || feedbackText.trim().length < 50}
                  style={{ marginTop: 8, background: rebuttalSaving || feedbackText.trim().length < 50 ? '#b0b0b0' : navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 2, border: 'none', cursor: rebuttalSaving || feedbackText.trim().length < 50 ? 'not-allowed' : 'pointer', fontFamily: sans }}
                >
                  {rebuttalSaving ? 'Saving…' : 'Attach the feedback'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
