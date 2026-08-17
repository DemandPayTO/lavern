// The mediation brief outline: draft, read, edit, and approve each narrative
// section. Like the factum, every section is model-drafted; the deterministic
// tables, cover, and sign-off are added when the brief assembles. State lives
// in the parent (Option A).

import { useState } from 'react';
import { navy, orange, green, amber, red, muted, border, ink, sans } from '../tokens.js';

export type MediationOutlineSectionUI = {
  id: string;
  header: string;
  guidance: string;
  draftStatus: 'not_drafted' | 'drafted' | 'approved';
  hasDraft: boolean;
  approved: boolean;
  generatedAt?: string;
  html?: string;
  reviewFlags?: string[];
};

export function MediationOutlinePanel({
  sections, draftSection, draftAll, approveSection, saveSection, clearSection, busyId, draftingAll,
}: {
  sections: MediationOutlineSectionUI[];
  draftSection: (sectionId: string) => Promise<void>;
  draftAll: () => Promise<void>;
  approveSection: (sectionId: string, approved: boolean) => Promise<void>;
  saveSection: (sectionId: string, html: string) => Promise<void>;
  clearSection: (sectionId: string) => Promise<void>;
  busyId: string | null;
  draftingAll: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const drafted = sections.filter(s => s.hasDraft).length;
  const approved = sections.filter(s => s.approved).length;
  const anyBusy = busyId !== null || draftingAll;

  const startEdit = (s: MediationOutlineSectionUI) => { setEditId(s.id); setEditText(s.html ?? ''); setOpenId(s.id); };
  const saveEdit = async (id: string) => {
    if (!editText.trim() || saving) return;
    setSaving(true);
    try { await saveSection(id, editText.trim()); setEditId(null); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>Draft the brief section by section</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
        Each section of the narrative, in order. Draft one to read it on its own, or draft them all, then read each below and edit it by hand where you want to. Approve locks the section in; Discard removes the draft. The profile, damages, comparable-case and negotiation tables, the cover, and the sign-off are added when the brief assembles.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={() => void draftAll()} disabled={anyBusy}
          style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 2, fontFamily: sans, background: anyBusy ? '#b0b0b0' : orange, color: '#fff', border: 'none', cursor: anyBusy ? 'not-allowed' : 'pointer' }}>
          {draftingAll ? 'Drafting every section…' : drafted === 0 ? 'Draft all sections' : 'Draft any not yet drafted'}
        </button>
        <span style={{ fontSize: 11.5, color: muted }}>{drafted} of {sections.length} drafted · {approved} approved</span>
      </div>

      {sections.map(s => {
        const chip = s.draftStatus === 'approved' ? { label: 'APPROVED', bg: '#e8f2e8', fg: green }
          : s.draftStatus === 'drafted' ? { label: 'DRAFTED', bg: '#fdf0dd', fg: amber }
            : { label: 'NOT DRAFTED', bg: '#f3f3f3', fg: muted };
        const isBusy = busyId === s.id || draftingAll;
        const isOpen = openId === s.id;
        const isEditing = editId === s.id;
        const flags = s.reviewFlags ?? [];
        return (
          <div key={s.id} style={{ padding: '7px 0', borderTop: `1px solid #f0ede8` }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: chip.fg, background: chip.bg, padding: '2px 7px', borderRadius: 2, minWidth: 92, textAlign: 'center', marginTop: 2 }}>{chip.label}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: ink }}>
                <span style={{ fontWeight: 600 }}>{s.header}</span>
                {flags.length > 0 && <span style={{ display: 'block', fontSize: 11.5, color: amber, marginTop: 3 }}>{flags.length} thing{flags.length === 1 ? '' : 's'} to check</span>}
              </span>
              {s.hasDraft && <button onClick={() => setOpenId(isOpen ? null : s.id)} style={btn(navy)}>{isOpen ? 'hide' : 'read'}</button>}
              {s.hasDraft && !s.approved && (
                <button onClick={() => void approveSection(s.id, true)} disabled={anyBusy} style={{ ...btn('#fff', anyBusy), fontWeight: 600, background: green, border: 'none' }}>Approve</button>
              )}
              {s.approved && <button onClick={() => void approveSection(s.id, false)} style={btnGhost} aria-label={`Reopen ${s.header}`}>reopen</button>}
              <button onClick={() => void draftSection(s.id)} disabled={anyBusy} style={{ ...btn(anyBusy ? muted : navy, anyBusy), minWidth: 66 }}>
                {isBusy ? 'drafting…' : s.hasDraft ? 'redraft' : 'draft'}
              </button>
            </div>

            {isOpen && s.hasDraft && (
              <div style={{ marginTop: 8, marginLeft: 102 }}>
                {flags.length > 0 && (
                  <ul style={{ margin: '0 0 8px', paddingLeft: 16, fontSize: 11.5, color: amber, lineHeight: 1.5 }}>
                    {flags.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                )}
                {isEditing ? (
                  <div>
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={10} aria-label={`Edit ${s.header}`}
                      style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.5, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }} />
                    <div style={{ fontSize: 11, color: muted, margin: '4px 0 8px' }}>Paragraphs are &lt;p&gt;…&lt;/p&gt;. Paragraph numbers are added when the brief assembles.</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => void saveEdit(s.id)} disabled={!editText.trim() || saving} style={{ ...btn('#fff', !editText.trim() || saving), fontWeight: 600, background: editText.trim() && !saving ? orange : '#b0b0b0', border: 'none', padding: '6px 14px' }}>{saving ? 'Saving…' : 'Save changes'}</button>
                      <button onClick={() => setEditId(null)} style={{ ...btn(navy), padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, color: ink, lineHeight: 1.55, background: '#fbfaf7', border: `1px solid ${border}`, borderRadius: 2, padding: '10px 12px', maxHeight: 320, overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: s.html ?? '' }} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
                      <button onClick={() => startEdit(s)} style={btnText(navy)}>edit by hand</button>
                      <button onClick={() => void clearSection(s.id)} style={btnText(red)}>Discard</button>
                      {s.generatedAt && <span style={{ fontSize: 10.5, color: muted }}>Drafted {new Date(s.generatedAt).toLocaleString('en-CA')}</span>}
                    </div>
                  </>
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
