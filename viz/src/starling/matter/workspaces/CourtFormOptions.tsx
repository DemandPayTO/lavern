// The deterministic court-form field grid: for documents whose data are
// entered as fields (service details, offer dates, costs figures). Extracted
// verbatim from MatterDetailView.tsx's draft tab (Option A).

import { border, ink, muted, sans } from '../tokens.js';
import { COURT_FORM_FIELDS } from '../constants.js';

export function CourtFormOptions({
  selectedDraft, courtFields, setCourtFields,
}: {
  selectedDraft: string;
  courtFields: Record<string, string>;
  setCourtFields: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14, marginTop: 8 }}>
      {COURT_FORM_FIELDS[selectedDraft].map(f => (
        <div key={f.key} style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
          <div style={{ fontSize: 12.5, color: muted, marginBottom: 5, fontWeight: 600 }}>
            {f.label}{f.required ? ' *' : ''}
          </div>
          {f.type === 'select' ? (
            <select
              value={courtFields[f.key] ?? ''}
              onChange={e => setCourtFields(prev => ({ ...prev, [f.key]: e.target.value }))}
              style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink }}
            >
              <option value="">Select</option>
              {(f.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea
              value={courtFields[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={e => setCourtFields(prev => ({ ...prev, [f.key]: e.target.value }))}
              rows={3}
              style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box', resize: 'vertical' }}
            />
          ) : (
            <input
              type={f.type ?? 'text'}
              value={courtFields[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={e => setCourtFields(prev => ({ ...prev, [f.key]: e.target.value }))}
              style={{ width: '100%', fontFamily: sans, fontSize: 14, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: ink, boxSizing: 'border-box' }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
