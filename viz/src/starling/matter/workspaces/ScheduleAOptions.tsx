// HRTO Schedule "A" / Form 1 options: download the pre-filled Form 1 data file
// and a link to the official SmartForm. Extracted verbatim from
// MatterDetailView.tsx's draft tab (Option A).

import { navy, border, ink, muted, sans } from '../tokens.js';

export function ScheduleAOptions({ sessionId }: { sessionId: string | null }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>
        Form 1 itself: download the pre-filled data file
      </div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>
        The HRTO SmartForm cannot be filled directly (it is a locked dynamic form), but Starling
        generates a data file from this matter (applicant, respondent, grounds, date of last
        incident, representative). Open the official Form 1 in Acrobat, then{' '}
        <strong>Prepare Form → More → Import Data</strong> and select this file. Review every
        field; Starling deliberately leaves narrative questions for Schedule "A".
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a
          href={`/api/employment/${sessionId}/form/hrto-form1-data`}
          download
          style={{ background: navy, color: '#fff', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, textDecoration: 'none', fontFamily: sans }}
        >
          Download Form 1 data file (.xml)
        </a>
        <a
          href="https://tribunalsontario.ca/documents/hrto/SmartForms/Form%201%20-%20apply.pdf"
          target="_blank" rel="noopener noreferrer"
          style={{ background: '#fff', color: navy, border: `1px solid ${border}`, fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, textDecoration: 'none', fontFamily: sans }}
        >
          Get the official Form 1 ↗
        </a>
      </div>
    </div>
  );
}
