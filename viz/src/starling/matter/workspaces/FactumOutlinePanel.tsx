// Factum outline: the section-by-section drafting surface. Each part of the
// factum (Overview, Facts, each Part III argument, the Order) is a section the
// lawyer drafts, reads, edits, and approves. Draft one or draft them all, read
// each below, adjust the text by hand where needed, then Approve it. Approved
// sections assemble into the numbered factum. State stays in the parent.

import { useState } from 'react';
import { navy, orange, green, amber, red, muted, border, ink, sans } from '../tokens.js';
import { DocumentHtml } from '../../DocumentHtml.js';

export type FactumOutlineSectionUI = {
  id: string;
  kind: 'overview' | 'facts' | 'argument' | 'order';
  partLabel: string;
  header: string;
  guidance?: string;
  authorities?: string;
  custom: boolean;
  draftStatus: 'not_drafted' | 'drafted' | 'approved';
  hasDraft: boolean;
  approved: boolean;
  generatedAt?: string;
  html?: string;
  reviewFlags?: string[];
};

export function FactumOutlinePanel({
  sections, draftSection, draftAll, approveSection, saveSection, clearSection, busyId, draftingAll,
}: {
  sections: FactumOutlineSectionUI[];
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

  const startEdit = (s: FactumOutlineSectionUI) => {
    setEditId(s.id);
    setEditText(s.html ?? '');
    setOpenId(s.id);
  };
  const saveEdit = async (id: string) => {
    if (!editText.trim() || saving) return;
    setSaving(true);
    try { await saveSection(id, editText.trim()); setEditId(null); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>Draft the factum section by section</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>
        Each part of the factum is a section you draft, read, and approve: the Overview, the Facts, each argument, and the Order. Draft one to read it on its own, or draft them all, then read each below and edit it by hand where you want to. Approve locks the section into the factum; Discard removes the draft. The Schedule of Authorities is built from the arguments you keep.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button
          onClick={() => void draftAll()}
          disabled={anyBusy}
          style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 2, fontFamily: sans, background: anyBusy ? '#b0b0b0' : orange, color: '#fff', border: 'none', cursor: anyBusy ? 'not-allowed' : 'pointer' }}
        >
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
                <span style={{ fontSize: 10.5, fontWeight: 700, color: muted, letterSpacing: 0.4 }}>{s.partLabel.toUpperCase()}</span>
                <span style={{ fontWeight: 600, display: 'block' }}>{s.header}{s.custom && <span style={{ color: muted, fontWeight: 400 }}> · your section</span>}</span>
                {s.authorities && s.kind === 'argument' && <span style={{ display: 'block', fontSize: 11.5, color: muted, lineHeight: 1.45 }}>{s.authorities}</span>}
                {flags.length > 0 && (
                  <span style={{ display: 'block', fontSize: 11.5, color: amber, marginTop: 3 }}>
                    {flags.length} thing{flags.length === 1 ? '' : 's'} to check
                  </span>
                )}
              </span>
              {s.hasDraft && (
                <button
                  onClick={() => setOpenId(isOpen ? null : s.id)}
                  style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: `1px solid ${border}`, color: navy, cursor: 'pointer', padding: '3px 9px', borderRadius: 2 }}
                >
                  {isOpen ? 'hide' : 'read'}
                </button>
              )}
              {s.hasDraft && !s.approved && (
                <button
                  onClick={() => void approveSection(s.id, true)}
                  disabled={anyBusy}
                  style={{ fontSize: 11.5, fontWeight: 600, fontFamily: sans, background: green, border: 'none', color: '#fff', cursor: anyBusy ? 'not-allowed' : 'pointer', padding: '3px 11px', borderRadius: 2 }}
                >
                  Approve
                </button>
              )}
              {s.approved && (
                <button
                  onClick={() => void approveSection(s.id, false)}
                  aria-label={`Reopen ${s.header}`}
                  title="Reopen this section to change it"
                  style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '3px 4px' }}
                >
                  reopen
                </button>
              )}
              <button
                onClick={() => void draftSection(s.id)}
                disabled={anyBusy}
                style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: `1px solid ${border}`, color: anyBusy ? muted : navy, cursor: anyBusy ? 'not-allowed' : 'pointer', padding: '3px 9px', borderRadius: 2, minWidth: 66 }}
              >
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
                    <textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      rows={12}
                      aria-label={`Edit ${s.header}`}
                      style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.5, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 11, color: muted, margin: '4px 0 8px' }}>Paragraphs are &lt;p&gt;…&lt;/p&gt;. Saving re-checks the section and reopens it for a final read before you approve it.</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        onClick={() => void saveEdit(s.id)}
                        disabled={!editText.trim() || saving}
                        style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 2, fontFamily: sans, background: editText.trim() && !saving ? orange : '#b0b0b0', color: '#fff', border: 'none', cursor: editText.trim() && !saving ? 'pointer' : 'not-allowed' }}
                      >
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        style={{ fontSize: 12, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <DocumentHtml
                      style={{ fontSize: 12.5, color: ink, lineHeight: 1.55, background: '#fbfaf7', border: `1px solid ${border}`, borderRadius: 2, padding: '10px 12px', maxHeight: 320, overflowY: 'auto' }}
                      html={s.html ?? ''}
                    />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
                      <button
                        onClick={() => startEdit(s)}
                        style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: navy, cursor: 'pointer', padding: '2px 0' }}
                      >
                        edit by hand
                      </button>
                      <button
                        onClick={() => void clearSection(s.id)}
                        style={{ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: red, cursor: 'pointer', padding: '2px 0' }}
                      >
                        Discard
                      </button>
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
