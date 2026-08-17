// Timetable-package workspace options: the ordered step list, the procedure
// choice, per-document firm wording, the supporting-affidavit inputs, and the
// generate-the-package button. Extracted verbatim from MatterDetailView.tsx's
// draft tab; state stays in the parent (Option A).

import { navy, orange, green, border, ink, muted, sans } from '../tokens.js';
import { PACKAGE_DOCS } from '../constants.js';
import { StyleProfilePanel } from '../../StyleProfilePanel.js';

type TtRow = { label: string; date: string };
type Profile = { id: string; documentType: string; label: string; sourceCount: number; createdAt: string };

export function TimetablePackageOptions({
  ttRows, setTtRows,
  pkgProcedure, setPkgProcedure,
  pkgProfiles, pkgStyleIds, setPkgStyleIds,
  teachingDocType, setTeachingDocType, refreshPkgProfiles,
  pkgAffidavit, setPkgAffidavit, pkgDeponent, setPkgDeponent,
  pkgCapacity, setPkgCapacity, pkgBasis, setPkgBasis, pkgSource, setPkgSource,
  pkgBusy, pkgResult, generatePackage, profileDisplayName,
}: {
  ttRows: TtRow[];
  setTtRows: React.Dispatch<React.SetStateAction<TtRow[]>>;
  pkgProcedure: 'simplified' | 'ordinary';
  setPkgProcedure: React.Dispatch<React.SetStateAction<'simplified' | 'ordinary'>>;
  pkgProfiles: Record<string, Profile[]>;
  pkgStyleIds: Record<string, string>;
  setPkgStyleIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  teachingDocType: string | null;
  setTeachingDocType: React.Dispatch<React.SetStateAction<string | null>>;
  refreshPkgProfiles: () => void;
  pkgAffidavit: boolean;
  setPkgAffidavit: React.Dispatch<React.SetStateAction<boolean>>;
  pkgDeponent: string;
  setPkgDeponent: React.Dispatch<React.SetStateAction<string>>;
  pkgCapacity: 'lawyer' | 'plaintiff' | 'law_clerk';
  setPkgCapacity: React.Dispatch<React.SetStateAction<'lawyer' | 'plaintiff' | 'law_clerk'>>;
  pkgBasis: 'personal' | 'information_and_belief' | 'mixed';
  setPkgBasis: React.Dispatch<React.SetStateAction<'personal' | 'information_and_belief' | 'mixed'>>;
  pkgSource: string;
  setPkgSource: React.Dispatch<React.SetStateAction<string>>;
  pkgBusy: boolean;
  pkgResult: string | null;
  generatePackage: () => void;
  profileDisplayName: string;
}) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>The timetable</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>
        Write each step in your own words, in the order the schedule should read. Starling
        reproduces them exactly, checks the dates are readable, future, and consistent with
        the order you listed, and puts them on your docket.
      </div>
      {ttRows.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: muted, width: 18, textAlign: 'right' }}>{i + 1}.</span>
          <input
            type="date"
            value={row.date}
            onChange={e => setTtRows(rows => rows.map((r, j) => j === i ? { ...r, date: e.target.value } : r))}
            aria-label={`Date for step ${i + 1}`}
            style={{ fontFamily: sans, fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2 }}
          />
          <input
            type="text"
            value={row.label}
            onChange={e => setTtRows(rows => rows.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
            placeholder="e.g. Defendants to deliver Affidavit of Documents"
            aria-label={`Step ${i + 1}`}
            style={{ flex: 1, minWidth: 260, fontFamily: sans, fontSize: 13, padding: '7px 10px', border: `1px solid ${border}`, borderRadius: 2 }}
          />
          <button
            onClick={() => setTtRows(rows => rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
            aria-label={`Remove step ${i + 1}`}
            style={{ fontSize: 11.5, color: muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            remove
          </button>
        </div>
      ))}
      <button
        onClick={() => setTtRows(rows => [...rows, { label: '', date: '' }])}
        style={{ marginTop: 4, fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
      >
        Add a step
      </button>

      <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 6 }}>Procedure</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {([['simplified', 'Simplified Procedure (Rule 76)'], ['ordinary', 'Ordinary Procedure']] as const).map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setPkgProcedure(val)}
              role="radio"
              aria-checked={pkgProcedure === val}
              style={{
                fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 2, fontFamily: sans,
                background: pkgProcedure === val ? navy : '#fff',
                color: pkgProcedure === val ? '#fff' : navy,
                border: `1px solid ${pkgProcedure === val ? navy : border}`, cursor: 'pointer',
              }}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>Your firm's wording</div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 8 }}>
          Each document has its own precedents and its own style. Teach them one at a time.
        </div>
        {PACKAGE_DOCS.map(doc => {
          const profilesFor = pkgProfiles[doc.type] ?? [];
          return (
            <div key={doc.type} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: ink, minWidth: 210 }}>{doc.label}</span>
              <select
                value={pkgStyleIds[doc.type] ?? ''}
                onChange={e => setPkgStyleIds(prev => ({ ...prev, [doc.type]: e.target.value }))}
                aria-label={`Style for ${doc.label}`}
                style={{ fontFamily: sans, fontSize: 12.5, padding: '6px 9px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', minWidth: 190 }}
              >
                <option value="">Starling's default form</option>
                {profilesFor.map(pr => <option key={pr.id} value={pr.id}>{pr.label}</option>)}
              </select>
              <button
                onClick={() => setTeachingDocType(teachingDocType === doc.type ? null : doc.type)}
                style={{ fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 2, fontFamily: sans, background: '#fff', color: navy, border: `1px solid ${border}`, cursor: 'pointer' }}
              >
                {teachingDocType === doc.type ? 'Close' : profilesFor.length ? 'Teach another' : 'Teach from precedents'}
              </button>
            </div>
          );
        })}
        {teachingDocType && (
          <div style={{ marginTop: 10 }}>
            <StyleProfilePanel
              documentType={teachingDocType}
              documentLabel={PACKAGE_DOCS.find(d => d.type === teachingDocType)?.label ?? 'document'}
              profiles={pkgProfiles[teachingDocType] ?? []}
              onChanged={() => refreshPkgProfiles()}
              onClose={() => setTeachingDocType(null)}
            />
          </div>
        )}

        <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, margin: '14px 0 4px' }}>Draft the whole package</div>
        <div style={{ fontSize: 12.5, color: muted, marginBottom: 10 }}>
          The motion, the consent order and the draft order from this one schedule, so their
          terms cannot disagree. Each arrives as its own document on the Documents tab.
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: ink, marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={pkgAffidavit} onChange={() => setPkgAffidavit(v => !v)} style={{ accentColor: navy }} />
          Include the supporting affidavit for the motion
        </label>
        {pkgAffidavit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input
              value={pkgDeponent}
              onChange={e => setPkgDeponent(e.target.value)}
              placeholder={`Deponent (default: ${profileDisplayName || 'you'})`}
              aria-label="Deponent name"
              style={{ flex: 1, minWidth: 190, fontFamily: sans, fontSize: 13, padding: '7px 10px', border: `1px solid ${border}`, borderRadius: 2 }}
            />
            <select value={pkgCapacity} onChange={e => setPkgCapacity(e.target.value as typeof pkgCapacity)} aria-label="Deponent capacity"
              style={{ fontFamily: sans, fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff' }}>
              <option value="lawyer">Lawyer with carriage</option>
              <option value="law_clerk">Law clerk</option>
              <option value="plaintiff">The plaintiff</option>
            </select>
            <select value={pkgBasis} onChange={e => setPkgBasis(e.target.value as typeof pkgBasis)} aria-label="Knowledge basis"
              style={{ fontFamily: sans, fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff' }}>
              <option value="information_and_belief">Information and belief (Rule 39.01(4))</option>
              <option value="personal">Personal knowledge</option>
              <option value="mixed">Mixed</option>
            </select>
            {pkgBasis === 'information_and_belief' && (
              <input
                value={pkgSource}
                onChange={e => setPkgSource(e.target.value)}
                placeholder="Source of the information (named, as the rule requires)"
                aria-label="Source of information"
                style={{ flex: 1, minWidth: 240, fontFamily: sans, fontSize: 13, padding: '7px 10px', border: `1px solid ${border}`, borderRadius: 2 }}
              />
            )}
          </div>
        )}
        <button
          onClick={() => { void generatePackage(); }}
          disabled={pkgBusy || ttRows.filter(r => r.label.trim() && r.date.trim()).length === 0}
          style={{
            fontSize: 13.5, fontWeight: 600, padding: '10px 18px', borderRadius: 2, fontFamily: sans,
            background: pkgBusy ? muted : orange, color: '#fff', border: 'none',
            cursor: pkgBusy ? 'wait' : 'pointer',
          }}
        >
          {pkgBusy ? 'Drafting the package…' : `Generate the timetable package${pkgAffidavit ? ' (4 documents)' : ' (3 documents)'}`}
        </button>
        {pkgResult && <div role="status" style={{ fontSize: 12.5, color: green, marginTop: 8 }}>{pkgResult}</div>}
      </div>
    </div>
  );
}
