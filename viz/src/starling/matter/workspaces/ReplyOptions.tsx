// Reply (Form 25A) workspace options: the Small Claims no-Reply notice, the
// Statement of Defence attachment, and the read-the-Defence-against-the-Claim
// comparison with its selectable new matters. Extracted verbatim from
// MatterDetailView.tsx's draft tab; state stays in the parent (Option A).

import { navy, border, ink, muted, sans } from '../tokens.js';
import { useEmploymentData } from '../../hooks/useStarlingApi.js';

type Employment = ReturnType<typeof useEmploymentData>;
type SourceSlot = 'rebuttal-source' | 'rebuttal-feedback' | 'soc-source' | 'defence-source' | 'claim-source';

export function ReplyOptions({
  employment, sessionId, isSmallClaimsMatter,
  defenceInputRef, claimSourceInputRef, rebuttalSaving,
  attachRebuttalFile, attachRebuttalText,
  defencePasting, setDefencePasting, defenceText, setDefenceText,
  runReplyComparison, comparing, comparisonMsg,
  replySelections, setReplySelections,
}: {
  employment: Employment;
  sessionId: string | null;
  isSmallClaimsMatter: boolean;
  defenceInputRef: React.RefObject<HTMLInputElement | null>;
  claimSourceInputRef: React.RefObject<HTMLInputElement | null>;
  rebuttalSaving: boolean;
  attachRebuttalFile: (file: File, slot?: SourceSlot) => void;
  attachRebuttalText: (name: string, text: string, slot?: SourceSlot) => void;
  defencePasting: boolean;
  setDefencePasting: React.Dispatch<React.SetStateAction<boolean>>;
  defenceText: string;
  setDefenceText: React.Dispatch<React.SetStateAction<string>>;
  runReplyComparison: () => void;
  comparing: boolean;
  comparisonMsg: string | null;
  replySelections: Set<string>;
  setReplySelections: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  return (
    <>
      {isSmallClaimsMatter && (
        <div style={{ background: '#fdf6ec', border: '1px solid #e8d9bd', padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>There is no Reply in the Small Claims Court</div>
          <div style={{ fontSize: 12.5, color: ink, lineHeight: 1.6 }}>
            This matter is in the Small Claims Court, and the Rules of the Small Claims Court provide no Reply to a Defence: the pleadings end with the Defence, and the Defence is answered at the settlement conference.
            If the Defendant has served a Defendant&rsquo;s Claim against your client, the answer to that is a Defence (Form 9A), served and filed within 20 days of service, not a Reply.
            You can still read the Defence against the Claim below: the sorted issues are useful preparation for the settlement conference, and the Settlement Conference Brief in this tab can be generated from the same file.
            If this matter is not in fact in the Small Claims Court, set the procedure on the Statement of Claim options and the Reply becomes available.
          </div>
        </div>
      )}

      <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>The Statement of Defence you are replying to</div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.55 }}>
          Upload or paste the Defence. The Reply answers the new matters it actually raises, citing its paragraph numbers, so this is required.
          Your own or the client&rsquo;s comments go in the direction box below; they bind the drafting.
        </div>
        {employment.defenceSource ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13, color: ink }}>
            <span>{"✓"} <b>{employment.defenceSource.name}</b> {"·"} {employment.defenceSource.words} words {"·"} attached {new Date(employment.defenceSource.savedAt).toLocaleDateString()}</span>
            <button
              onClick={() => { void (async () => { await fetch(`/api/employment/${sessionId}/defence-source`, { method: 'DELETE', credentials: 'include' }); void employment.refresh(); })(); }}
              style={{ background: 'none', border: `1px solid ${border}`, color: muted, cursor: 'pointer', fontSize: 12.5, fontFamily: sans, padding: '4px 10px', borderRadius: 2 }}
            >
              Discard
            </button>
            <span style={{ fontSize: 12, color: muted }}>Discarding removes the attachment only. Attach another to replace it.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={defenceInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.rtf"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void attachRebuttalFile(f, 'defence-source'); e.target.value = ''; }}
              aria-label="Upload the Statement of Defence"
            />
            <button
              onClick={() => defenceInputRef.current?.click()}
              disabled={rebuttalSaving}
              style={{ background: '#fff', color: navy, border: `1px solid ${navy}`, fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 2, cursor: rebuttalSaving ? 'not-allowed' : 'pointer', fontFamily: sans }}
            >
              {rebuttalSaving ? 'Reading…' : 'Upload the Defence'}
            </button>
            <button
              onClick={() => setDefencePasting(v => !v)}
              style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: sans }}
            >
              Paste the text
            </button>
          </div>
        )}
        {defencePasting && !employment.defenceSource && (
          <div style={{ marginTop: 10 }}>
            <textarea
              value={defenceText}
              onChange={e => setDefenceText(e.target.value)}
              rows={5}
              placeholder="Paste the Statement of Defence here."
              aria-label="Paste the Statement of Defence"
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: sans, fontSize: 13, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
            />
            <button
              onClick={() => { if (defenceText.trim().length >= 50) { void attachRebuttalText('Statement of Defence (pasted)', defenceText, 'defence-source'); setDefenceText(''); setDefencePasting(false); } }}
              disabled={rebuttalSaving || defenceText.trim().length < 50}
              style={{ marginTop: 8, background: rebuttalSaving || defenceText.trim().length < 50 ? '#b0b0b0' : navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 2, border: 'none', cursor: rebuttalSaving || defenceText.trim().length < 50 ? 'not-allowed' : 'pointer', fontFamily: sans }}
            >
              {rebuttalSaving ? 'Saving…' : 'Attach the Defence'}
            </button>
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>Read the Defence against the Claim</div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.55 }}>
          Starling reads both pleadings and sorts the Defence into admissions, bare denials (deemed denied; a Reply adds nothing), and the new matters you may answer, each quoting the Defence.
          You pick which new matters the Reply addresses; new matters arrive ticked, everything else is for the record.
          {employment.claimOnFile
            ? ' The claim on this matter is compared automatically.'
            : ' No claim is on this matter yet: attach the as-filed claim below.'}
        </div>
        {!employment.claimOnFile && !employment.claimSource && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input
              ref={claimSourceInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.rtf"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void attachRebuttalFile(f, 'claim-source'); e.target.value = ''; }}
              aria-label="Upload the as-filed Statement of Claim"
            />
            <button
              onClick={() => claimSourceInputRef.current?.click()}
              disabled={rebuttalSaving}
              style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 13, padding: '8px 14px', borderRadius: 2, cursor: rebuttalSaving ? 'not-allowed' : 'pointer', fontFamily: sans }}
            >
              {rebuttalSaving ? 'Reading…' : 'Attach the as-filed claim'}
            </button>
          </div>
        )}
        {employment.claimSource && (
          <div style={{ fontSize: 13, color: ink, marginBottom: 10 }}>
            ✓ <b>{employment.claimSource.name}</b> · {employment.claimSource.words} words
            <button
              onClick={() => { void (async () => { await fetch(`/api/employment/${sessionId}/claim-source`, { method: 'DELETE', credentials: 'include' }); void employment.refresh(); })(); }}
              style={{ marginLeft: 10, background: 'none', border: `1px solid ${border}`, color: muted, cursor: 'pointer', fontSize: 12, fontFamily: sans, padding: '3px 9px', borderRadius: 2 }}
            >
              Discard
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => void runReplyComparison()}
            disabled={comparing || !employment.defenceSource}
            style={{ background: comparing || !employment.defenceSource ? '#b0b0b0' : navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 2, border: 'none', cursor: comparing || !employment.defenceSource ? 'not-allowed' : 'pointer', fontFamily: sans }}
          >
            {comparing ? 'Reading…' : 'Read the Defence against the Claim'}
          </button>
          {!employment.defenceSource && !comparing && (
            <span style={{ fontSize: 12.5, color: muted }}>Attach the Statement of Defence above first.</span>
          )}
          {comparisonMsg && <span role="status" style={{ fontSize: 12.5, color: ink }}>{comparisonMsg}</span>}
        </div>
        {employment.replyComparison && employment.replyComparison.items.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              {employment.replyComparison.defenceName} against {employment.replyComparison.claimName}
            </div>
            {employment.replyComparison.items.map(item => {
              const chip = item.kind === 'new_matter' ? { label: 'NEW MATTER', bg: '#fdf0dd', fg: '#b8860b' }
                : item.kind === 'admission' ? { label: 'ADMISSION', bg: '#e7f6ec', fg: '#1a7a3a' }
                : item.kind === 'denial' ? { label: 'DENIAL', bg: '#f4f1ec', fg: muted }
                : { label: 'OTHER', bg: '#f4f1ec', fg: muted };
              const selectable = item.kind === 'new_matter';
              return (
                <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid #f0ede8' }}>
                  {selectable ? (
                    <input
                      type="checkbox"
                      checked={replySelections.has(item.id)}
                      onChange={() => setReplySelections(prev => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}
                      aria-label={`Address Defence paragraph ${item.defenceParagraph} in the Reply`}
                      style={{ accentColor: navy, marginTop: 3 }}
                    />
                  ) : <span style={{ width: 13 }} />}
                  <span style={{ fontSize: 10, fontWeight: 700, color: chip.fg, background: chip.bg, padding: '2px 7px', borderRadius: 2, minWidth: 78, textAlign: 'center', marginTop: 2 }}>{chip.label}</span>
                  <span style={{ flex: 1, fontSize: 12.5, color: ink, lineHeight: 1.5 }}>
                    <b>Para {item.defenceParagraph}:</b> {item.summary}
                    {item.why && <span style={{ display: 'block', color: muted }}>{item.why}</span>}
                    <span style={{ display: 'block', fontSize: 11.5, color: muted, fontStyle: 'italic' }}>&ldquo;{item.quote.length > 160 ? item.quote.slice(0, 160) + '…' : item.quote}&rdquo;</span>
                  </span>
                </div>
              );
            })}
            <div style={{ fontSize: 12, color: muted, marginTop: 8 }}>
              The Reply will address the {replySelections.size} ticked new matter{replySelections.size === 1 ? '' : 's'} and nothing else. Your comments in the direction box below still bind the drafting.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
