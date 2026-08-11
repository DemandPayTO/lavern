/**
 * The full intake questionnaire: the firm's DemandPay question bank,
 * rendered as sections a lawyer can work through in any order.
 *
 * Seventeen gate sections, served as data from the server (generated
 * from the firm's own schema workbook). Follow-up questions appear when
 * their condition is met, exactly as the workbook's Show_If column says.
 * Each section saves on its own; answers land on the intake, and the
 * server mirrors them onto the fields the gates and generators read.
 * One sentence after every save says what happened.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { navy, orange, border, ink, muted, serif, sans, green } from './shared.js';

interface Question {
  id: string;
  key: string;
  text: string;
  type: 'date' | 'number' | 'text' | 'textarea' | 'yesno' | 'select' | 'multi';
  optionsRef?: string;
  required: boolean;
  showIf?: string;
  note?: string;
  joinAsString?: boolean;
}

interface Definition {
  sections: Array<{ id: string; title: string; questions: Question[] }>;
  optionSets: Record<string, Array<{ value: string; label: string }>>;
}

/**
 * Evaluate a Show_If condition against the current answers. The grammar
 * is the workbook's: `field = YES`, `field = NO`, `field = VALUE`,
 * `field IS NOT EMPTY`, joined by AND / OR. Unanswered never satisfies
 * a condition.
 */
export function showIfMet(cond: string, values: Record<string, unknown>): boolean {
  const orParts = cond.split(/\s+OR\s+/i);
  return orParts.some(orPart =>
    orPart.split(/\s+AND\s+/i).every(clause => {
      const notEmpty = clause.match(/^\s*([a-z_0-9]+)\s+IS\s+NOT\s+EMPTY\s*$/i);
      if (notEmpty) {
        const v = values[notEmpty[1]];
        return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '';
      }
      const eq = clause.match(/^\s*([a-z_0-9]+)\s*=\s*(.+?)\s*$/i);
      if (!eq) return false;
      const v = values[eq[1]];
      const want = eq[2].trim().toUpperCase();
      if (want === 'YES') return v === true || String(v).toUpperCase() === 'YES';
      if (want === 'NO') return v === false || String(v).toUpperCase() === 'NO';
      return String(v ?? '').toUpperCase() === want;
    }));
}

const inputStyle: React.CSSProperties = {
  fontFamily: sans, fontSize: 13.5, padding: '8px 11px',
  border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink,
  boxSizing: 'border-box',
};

export function QuestionnairePanel({
  intake, onSave,
}: {
  intake: Record<string, unknown>;
  onSave: (edited: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [def, setDef] = useState<Definition | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [sectionMsg, setSectionMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/employment/questionnaire', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json() as { questionnaire?: Definition };
        if (json.questionnaire) setDef(json.questionnaire);
      } catch { /* the quick editor below still works */ }
    })();
  }, []);

  /** Current value: unsaved draft first, then the saved intake. */
  const valueOf = useCallback((key: string): unknown =>
    key in draft ? draft[key] : intake[key], [draft, intake]);

  const values = useMemo(() => {
    const merged: Record<string, unknown> = { ...intake, ...draft };
    return merged;
  }, [intake, draft]);

  const set = (key: string, v: unknown) => setDraft(prev => ({ ...prev, [key]: v }));

  const visibleQuestions = useCallback((qs: Question[]): Question[] =>
    qs.filter(q => !q.showIf || showIfMet(q.showIf, values)), [values]);

  const answered = useCallback((q: Question): boolean => {
    const v = valueOf(q.key);
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '';
  }, [valueOf]);

  const saveSection = async (sectionId: string, qs: Question[]) => {
    const keys = new Set(qs.map(q => q.key));
    const edited: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) if (keys.has(k)) edited[k] = v;
    if (Object.keys(edited).length === 0) {
      setSectionMsg(prev => ({ ...prev, [sectionId]: 'Nothing changed in this section.' }));
      return;
    }
    setSavingSection(sectionId);
    const result = await onSave(edited);
    setSavingSection(null);
    if (result.ok) {
      setDraft(prev => {
        const next = { ...prev };
        for (const k of Object.keys(edited)) delete next[k];
        return next;
      });
      setSectionMsg(prev => ({ ...prev, [sectionId]: `Saved ${Object.keys(edited).length} answer${Object.keys(edited).length === 1 ? '' : 's'}. The analysis, clocks, and claim sections read the updated file.` }));
    } else {
      setSectionMsg(prev => ({ ...prev, [sectionId]: result.error ?? 'The section could not be saved.' }));
    }
  };

  if (!def) return null;

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 20px', marginBottom: 16 }}>
      <div style={{ fontFamily: serif, fontSize: 15, fontWeight: 600, color: navy, marginBottom: 4 }}>
        The full intake
      </div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 12, lineHeight: 1.55 }}>
        The firm&rsquo;s complete question set, in sections. Work through them in any order; follow-up
        questions appear when an answer calls for them. Each section saves on its own, and answers feed
        the analysis, the deadline clocks, the demand letter, and the claim. Documents you upload keep
        proposing answers too; this is the checklist that shows what is still uncovered.
      </div>

      {def.sections.map(section => {
        const vis = visibleQuestions(section.questions);
        const done = vis.filter(answered).length;
        const requiredLeft = vis.filter(q => q.required && !answered(q)).length;
        const open = openSection === section.id;
        return (
          <div key={section.id} style={{ border: `1px solid ${border}`, marginBottom: 6 }}>
            <button
              onClick={() => setOpenSection(open ? null : section.id)}
              aria-expanded={open}
              style={{ width: '100%', display: 'flex', alignItems: 'baseline', gap: 10, textAlign: 'left', background: open ? '#faf8f5' : '#fff', border: 'none', padding: '10px 14px', cursor: 'pointer', fontFamily: sans }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: ink }}>{section.title}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: done === vis.length ? green : muted }}>
                {done}/{vis.length} answered{requiredLeft > 0 ? ` · ${requiredLeft} required open` : ''}
              </span>
            </button>
            {open && (
              <div style={{ padding: '4px 14px 14px' }}>
                {vis.map(q => {
                  const v = valueOf(q.key);
                  const opts = q.optionsRef ? def.optionSets[q.optionsRef] ?? [] : [];
                  return (
                    <div key={q.id} style={{ padding: '8px 0', borderTop: `1px solid #f0ede8` }}>
                      <label style={{ display: 'block', fontSize: 13, color: ink, marginBottom: 5, lineHeight: 1.5 }}>
                        {q.text}{q.required && <span style={{ color: orange }}> *</span>}
                      </label>
                      {q.type === 'yesno' && (
                        <select value={v === true ? 'yes' : v === false ? 'no' : ''} onChange={e => set(q.key, e.target.value === '' ? undefined : e.target.value === 'yes')} style={inputStyle}>
                          <option value="">Not answered</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      )}
                      {q.type === 'select' && (
                        <select value={String(v ?? '')} onChange={e => set(q.key, e.target.value || undefined)} style={inputStyle}>
                          <option value="">Not answered</option>
                          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                      {q.type === 'multi' && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                          {opts.map(o => {
                            const list = q.joinAsString
                              ? String(v ?? '').split(', ').filter(Boolean)
                              : Array.isArray(v) ? v as string[] : [];
                            const has = list.includes(o.value) || list.includes(o.label);
                            return (
                              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ink, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={has}
                                  onChange={() => {
                                    const next = has ? list.filter(x => x !== o.value && x !== o.label) : [...list, o.value];
                                    set(q.key, q.joinAsString ? next.join(', ') : next);
                                  }}
                                  style={{ accentColor: navy }}
                                />
                                {o.label}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {q.type === 'date' && (
                        <input type="date" value={String(v ?? '')} onChange={e => set(q.key, e.target.value || undefined)} style={inputStyle} />
                      )}
                      {q.type === 'number' && (
                        <input type="number" value={v === undefined || v === null ? '' : String(v)} onChange={e => set(q.key, e.target.value === '' ? undefined : Number(e.target.value))} style={{ ...inputStyle, maxWidth: 180 }} />
                      )}
                      {q.type === 'text' && (
                        <input type="text" value={String(v ?? '')} onChange={e => set(q.key, e.target.value || undefined)} style={{ ...inputStyle, width: '100%' }} />
                      )}
                      {q.type === 'textarea' && (
                        <textarea rows={3} value={String(v ?? '')} onChange={e => set(q.key, e.target.value || undefined)} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
                      )}
                      {q.note && <div style={{ fontSize: 11.5, color: muted, marginTop: 4 }}>{q.note}</div>}
                    </div>
                  );
                })}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => void saveSection(section.id, section.questions)}
                    disabled={savingSection === section.id}
                    style={{ background: savingSection === section.id ? '#b0b0b0' : navy, color: '#fff', fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 2, border: 'none', cursor: savingSection === section.id ? 'not-allowed' : 'pointer', fontFamily: sans }}
                  >
                    {savingSection === section.id ? 'Saving…' : 'Save this section'}
                  </button>
                  {sectionMsg[section.id] && <span role="status" style={{ fontSize: 12.5, color: ink }}>{sectionMsg[section.id]}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
