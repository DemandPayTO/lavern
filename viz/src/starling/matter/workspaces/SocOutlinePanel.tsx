// The SOC outline: read, edit, and approve the claim section by section. The
// pleading sections are the firm's nodes, rendered so the lawyer reads the
// exact pleading; the Background Facts is the one section Starling drafts.
// Every section can be read, edited by hand, and approved. Assembly uses the
// approved or edited text where set, and the standard render elsewhere, so the
// flow never forces approving every deterministic node. State lives in parent.

import { useState } from 'react';
import { navy, orange, green, amber, red, muted, border, ink, sans } from '../tokens.js';

export type SocOutlineSectionUI = {
  id: string;
  kind: 'facts' | 'node';
  header: string;
  html: string;
  missing: string[];
  edited: boolean;
  approved: boolean;
  draftStatus: 'not_drafted' | 'rendered' | 'drafted' | 'approved';
  generatedAt?: string;
  reviewFlags?: string[];
  lawyerReview: boolean;
};

export function SocOutlinePanel({
  sections, draftFacts, approveSection, saveSection, clearSection, busyId,
}: {
  sections: SocOutlineSectionUI[];
  draftFacts: (sectionId: string) => Promise<void>;
  approveSection: (sectionId: string, approved: boolean) => Promise<void>;
  saveSection: (sectionId: string, html: string) => Promise<void>;
  clearSection: (sectionId: string) => Promise<void>;
  busyId: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const approved = sections.filter(s => s.approved).length;
  const anyBusy = busyId !== null;

  const startEdit = (s: SocOutlineSectionUI) => { setEditId(s.id); setEditText(s.html ?? ''); setOpenId(s.id); };
  const saveEdit = async (id: string) => {
    if (!editText.trim() || saving) return;
    setSaving(true);
    try { await saveSection(id, editText.trim()); setEditId(null); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>Read the claim section by section</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 12, lineHeight: 1.5 }}>
        Every pleading section, in order. The firm's sections plead in their settled language; read each, edit it by hand where you want to, and approve it. The Background Facts is the one section Starling drafts. Generate uses your approved or edited text where you set it, and the standard version elsewhere, so you never have to approve every section to file.
      </div>
      <div style={{ fontSize: 11.5, color: muted, marginBottom: 10 }}>{approved} of {sections.length} approved</div>

      {sections.map(s => {
        const chip = s.approved ? { label: 'APPROVED', bg: '#e8f2e8', fg: green }
          : s.edited ? { label: 'EDITED', bg: '#fdf0dd', fg: amber }
            : s.draftStatus === 'drafted' ? { label: 'DRAFTED', bg: '#fdf0dd', fg: amber }
              : s.draftStatus === 'not_drafted' ? { label: 'NOT DRAFTED', bg: '#f3f3f3', fg: muted }
                : { label: 'AS PLEADED', bg: '#eef1f6', fg: navy };
        const isBusy = busyId === s.id;
        const isOpen = openId === s.id;
        const isEditing = editId === s.id;
        const flags = s.reviewFlags ?? [];
        const hasText = Boolean(s.html && s.html.trim());
        return (
          <div key={s.id} style={{ padding: '7px 0', borderTop: `1px solid #f0ede8` }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: chip.fg, background: chip.bg, padding: '2px 7px', borderRadius: 2, minWidth: 86, textAlign: 'center', marginTop: 2 }}>{chip.label}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: ink }}>
                <span style={{ fontWeight: 600 }}>{s.header || 'Section'}</span>
                {s.kind === 'facts' && <span style={{ color: muted, fontWeight: 400 }}> · Starling drafts this</span>}
                {s.missing.length > 0 && <span style={{ display: 'block', fontSize: 11.5, color: amber }}>{s.missing.length} blank{s.missing.length === 1 ? '' : 's'} to fill</span>}
                {flags.length > 0 && <span style={{ display: 'block', fontSize: 11.5, color: amber }}>{flags.length} thing{flags.length === 1 ? '' : 's'} to check</span>}
              </span>
              {(hasText || s.kind === 'node') && (
                <button onClick={() => setOpenId(isOpen ? null : s.id)} style={btn(navy)}>{isOpen ? 'hide' : 'read'}</button>
              )}
              {s.kind === 'facts' && (
                <button onClick={() => void draftFacts(s.id)} disabled={anyBusy} style={btn(anyBusy ? muted : navy, anyBusy)}>
                  {isBusy ? 'drafting…' : hasText ? 'redraft' : 'draft'}
                </button>
              )}
              {!s.approved && (hasText || s.kind === 'node') && (
                <button onClick={() => void approveSection(s.id, true)} disabled={anyBusy} style={{ ...btn('#fff', anyBusy), fontWeight: 600, background: green, border: 'none' }}>Approve</button>
              )}
              {s.approved && (
                <button onClick={() => void approveSection(s.id, false)} style={btnGhost} aria-label={`Reopen ${s.header}`}>reopen</button>
              )}
            </div>

            {isOpen && (hasText || s.kind === 'node') && (
              <div style={{ marginTop: 8, marginLeft: 96 }}>
                {flags.length > 0 && (
                  <ul style={{ margin: '0 0 8px', paddingLeft: 16, fontSize: 11.5, color: amber, lineHeight: 1.5 }}>
                    {flags.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                )}
                {isEditing ? (
                  <div>
                    <textarea
                      value={editText} onChange={e => setEditText(e.target.value)} rows={10} aria-label={`Edit ${s.header}`}
                      style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.5, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 11, color: muted, margin: '4px 0 8px' }}>Paragraphs are &lt;p&gt;…&lt;/p&gt;. Paragraph numbers are added when the claim assembles; do not number them here.</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => void saveEdit(s.id)} disabled={!editText.trim() || saving} style={{ ...btn('#fff', !editText.trim() || saving), fontWeight: 600, background: editText.trim() && !saving ? orange : '#b0b0b0', border: 'none', padding: '6px 14px' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                      <button onClick={() => setEditId(null)} style={{ ...btn(navy), padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : hasText ? (
                  <>
                    <div style={{ fontSize: 12.5, color: ink, lineHeight: 1.55, background: '#fbfaf7', border: `1px solid ${border}`, borderRadius: 2, padding: '10px 12px', maxHeight: 300, overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: s.html }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
                      <button onClick={() => startEdit(s)} style={btnText(navy)}>edit by hand</button>
                      {(s.edited || s.approved || s.draftStatus === 'drafted') && (
                        <button onClick={() => void clearSection(s.id)} style={btnText(red)}>{s.kind === 'facts' ? 'Discard' : 'Revert to standard'}</button>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12.5, color: muted }}>Not drafted yet. Use draft to write the Background Facts.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const btn = (color: string, disabled = false): React.CSSProperties => ({ fontSize: 11.5, fontFamily: sans, background: 'none', border: `1px solid ${border}`, color, cursor: disabled ? 'not-allowed' : 'pointer', padding: '3px 9px', borderRadius: 2 });
const btnGhost: React.CSSProperties = { fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '3px 4px' };
const btnText = (color: string): React.CSSProperties => ({ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color, cursor: 'pointer', padding: '2px 0' });
