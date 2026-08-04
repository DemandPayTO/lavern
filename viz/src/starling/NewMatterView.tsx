/**
 * NewMatterView — New matter intake form for DemandPay Starling.
 *
 * Collects client/employer info, situation description, document uploads,
 * and key dates. Automatically calculates limitation deadlines from the
 * termination date.
 *
 * Ontario employment law vocabulary (ESA, Bardal, Waksdale, HRTO).
 * Canadian spelling throughout (analyse, licenced).
 */

import { useState, useCallback, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import { useMatterCreate, usePracticeMode } from './hooks/useStarlingApi.js';

const GrievanceNewMatter = lazy(() => import('./GrievanceNewMatter.js'));

// ── Design Tokens ───────────────────────────────────────────────────────
const navy = '#0f1a2e';
const orange = '#ea580c';
const cream = '#faf8f5';
const frame = '#e8e5e0';
const green = '#16a34a';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const serif = "Georgia, 'Palatino Linotype', serif";
const sans = "system-ui, -apple-system, sans-serif";

// ── Types ───────────────────────────────────────────────────────────────


// ── Helpers ─────────────────────────────────────────────────────────────

/** Parse the date input's ISO value into a Date, or return null. */
function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/** Format a Date as "Month Day, Year" (en-CA style). */
function formatDateLong(date: Date): string {
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Add N years to a date. */
function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

/** File extension to display label. */
function getFileTypeLabel(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase() ?? '';
  if (ext === 'PDF') return 'PDF';
  if (ext === 'DOCX' || ext === 'DOC') return 'DOCX';
  if (ext === 'TXT') return 'TXT';
  if (ext === 'PNG' || ext === 'JPG' || ext === 'JPEG') return 'IMG';
  return ext || 'FILE';
}

// ── Component ───────────────────────────────────────────────────────────

export default function NewMatterView() {
  const practiceMode = usePracticeMode();
  const [practiceArea, setPracticeArea] = useState<'employment' | 'labour'>('employment');
  // A single-vertical firm never sees the toggle; lock the practice area to
  // its mode. Only 'both' firms choose per matter.
  useEffect(() => {
    if (practiceMode === 'employment') setPracticeArea('employment');
    else if (practiceMode === 'labour') setPracticeArea('labour');
  }, [practiceMode]);
  const [clientName, setClientName] = useState('');
  // Firm-wide duplicate warning: another lawyer may already have this
  // client. Warns and links rather than blocking, since a second matter
  // for the same client can be legitimate.
  const [duplicates, setDuplicates] = useState<Array<{ matterId: string; matterNumber: string; openedBy: string }>>([]);

  const checkForDuplicates = useCallback(async () => {
    const wanted = clientName.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!wanted) { setDuplicates([]); return; }
    try {
      const res = await fetch('/api/matters', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json() as { matters?: Array<{ matterId: string; matterNumber?: string; clientId?: string; status?: string; openedBy?: string; openedByMe?: boolean }> };
      setDuplicates((json.matters ?? [])
        .filter(m => String(m.clientId ?? '').toLowerCase().replace(/\s+/g, ' ').trim() === wanted)
        .filter(m => m.status !== 'closed')
        .map(m => ({
          matterId: m.matterId,
          matterNumber: m.matterNumber ?? '',
          openedBy: m.openedByMe === false ? (m.openedBy ?? '') : '',
        })));
    } catch { /* the server-side conflict check still records it */ }
  }, [clientName]);
  const [employerName, setEmployerName] = useState('');
  const [situation, setSituation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [terminationDate, setTerminationDate] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [salary, setSalary] = useState('');
  const [justCause, setJustCause] = useState(false);
  const [constructiveDismissal, setConstructiveDismissal] = useState(false);
  const [terminationReason, setTerminationReason] = useState('');
  const { createMatter, uploading, error } = useMatterCreate();

  // Parse termination date for deadline calculations
  const termDate = useMemo(() => parseIsoDate(terminationDate), [terminationDate]);
  const limitationDate = useMemo(() => termDate ? addYears(termDate, 2) : null, [termDate]);
  const hrtoDate = useMemo(() => termDate ? addYears(termDate, 1) : null, [termDate]);

  const handleNav = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);



  const handleSubmit = useCallback(async () => {
    try {
      const result = await createMatter({
        clientName,
        employerName,
        situation,
        startDate: startDate || undefined,
        termDate: terminationDate || undefined,
        // Employment-specific fields
        jobTitle: jobTitle || undefined,
        salary: salary ? parseFloat(salary) : undefined,
        justCause,
        constructiveDismissal,
        terminationReason: terminationReason || undefined,
      });
      // new=1 opens the file on its Documents tab with a one-time pointer.
      handleNav(`#/matter-detail/${result.matterId ?? result.sessionId}?new=1`);
    } catch {
      // error is already set by the hook
    }
  }, [createMatter, clientName, employerName, situation, startDate, terminationDate, jobTitle, salary, justCause, constructiveDismissal, terminationReason, handleNav]);

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      {/* ── Top Bar ──────────────────────────────────────────────── */}
      <header
        style={{
          background: navy,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          height: 64,
        }}
        role="banner"
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <a
            href="#/"
            style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
            aria-label="DemandPay Starling home"
          >
            <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
            </span>
            <span style={{ fontFamily: serif, lineHeight: 1, letterSpacing: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>DEMAND</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>PAY</span>
            </span>
          </a>
          <span
            style={{
              marginLeft: 14,
              paddingLeft: 16,
              borderLeft: '1px solid rgba(255,255,255,0.18)',
              fontFamily: serif,
              fontSize: 15,
              color: '#cfd6e0',
            }}
          >
            <b style={{ color: '#fff' }}>Starling</b> &middot; Employment Law
          </span>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Main navigation">
          <a
            href="#/"
            style={{
              padding: '8px 14px',
              borderRadius: 2,
              fontSize: 14,
              color: '#cfd6e0',
              border: '1px solid transparent',
              textDecoration: 'none',
            }}
          >
            My Cases
          </a>
        </nav>
      </header>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main
        id="main-content"
        style={{
          maxWidth: 760,
          margin: '0 auto',
          padding: '24px 28px 64px',
        }}
      >
        {/* Back link */}
        <a
          href="#/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            color: muted,
            fontSize: 13.5,
            marginBottom: 18,
            textDecoration: 'none',
          }}
          onClick={(e) => { e.preventDefault(); handleNav('#/'); }}
        >
          &larr; My Cases
        </a>

        {/* Form card */}
        <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '34px 38px 32px' }}>
          <h1 style={{ fontFamily: serif, fontSize: 25, fontWeight: 600, color: navy, margin: '0 0 4px' }}>
            New Matter
          </h1>
          <p style={{ color: muted, fontSize: 14, margin: '0 0 20px' }}>
            {practiceArea === 'employment'
              ? 'Give Starling the basics. It will extract dates, identify employment law issues, and flag missing documents automatically.'
              : 'Capture the grievance. Starling runs the 11-gate labour analysis (Wm Scott, KVP, Weber, DFR) and puts the CA time limits on the docket instantly.'}
          </p>

          {/* Practice area — shown only when the firm runs both verticals */}
          {practiceMode === 'both' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 26 }} role="radiogroup" aria-label="Practice area">
            {([
              ['employment', 'Employment', 'Plaintiff-side: wrongful dismissal, ESA, HRTO'],
              ['labour', 'Union Grievance', 'Union-side: discharge, discipline, policy, arbitration'],
            ] as const).map(([key, title, sub]) => (
              <button
                key={key}
                onClick={() => setPracticeArea(key)}
                role="radio"
                aria-checked={practiceArea === key}
                style={{
                  flex: 1, textAlign: 'left', padding: '12px 14px', borderRadius: 2, cursor: 'pointer',
                  fontFamily: sans, background: practiceArea === key ? '#fff' : cream,
                  border: `1px solid ${practiceArea === key ? orange : border}`,
                  boxShadow: practiceArea === key ? `0 2px 0 ${orange}` : 'none',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: navy }}>{title}</div>
                <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>{sub}</div>
              </button>
            ))}
          </div>
          )}

          {practiceArea === 'labour' && (
            <Suspense fallback={<div style={{ padding: '40px 0', textAlign: 'center', color: muted, fontSize: 14 }}>Loading grievance intake...</div>}>
              <GrievanceNewMatter onNav={handleNav} />
            </Suspense>
          )}

          {practiceArea === 'employment' && (<>
          {/* Client Name */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: navy, marginBottom: 7 }}>
              Client Name
            </label>
            <input
              type="text"
              placeholder="e.g., Jane Smith"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              onBlur={() => { void checkForDuplicates(); }}
              style={{
                width: '100%',
                fontFamily: sans,
                fontSize: 14,
                color: ink,
                border: `1px solid ${border}`,
                borderRadius: 2,
                padding: '11px 13px',
                background: '#fff',
                boxSizing: 'border-box',
              }}
            />
            {duplicates.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: '#8a5a00', background: '#fdf4e3', border: '1px solid #e8cf9f', borderRadius: 2, padding: '8px 11px' }}>
                The firm already has {duplicates.length === 1 ? 'an open file' : `${duplicates.length} open files`} for {clientName.trim()}:{' '}
                {duplicates.map((d, i) => (
                  <span key={d.matterId}>
                    {i > 0 && ', '}
                    <a href={`#/matter-detail/${d.matterId}`} style={{ color: '#8a5a00', fontWeight: 600 }}>
                      {d.matterNumber || 'open it'}
                    </a>
                    {d.openedBy ? ` (opened by ${d.openedBy})` : ''}
                  </span>
                ))}
                . If this is the same engagement, work on that file instead of creating a second one.
              </div>
            )}
          </div>

          {/* Employer Name */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: navy, marginBottom: 7 }}>
              Employer Name
            </label>
            <input
              type="text"
              placeholder="e.g., Acme Corporation"
              value={employerName}
              onChange={(e) => setEmployerName(e.target.value)}
              style={{
                width: '100%',
                fontFamily: sans,
                fontSize: 14,
                color: ink,
                border: `1px solid ${border}`,
                borderRadius: 2,
                padding: '11px 13px',
                background: '#fff',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Situation */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: navy, marginBottom: 7 }}>
              Describe the situation
            </label>
            <textarea
              placeholder="e.g., Client terminated after 8 years as a marketing manager. Employer offered 4 weeks. Client believes they were let go shortly after requesting a disability accommodation."
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              rows={4}
              style={{
                width: '100%',
                fontFamily: sans,
                fontSize: 14,
                color: ink,
                border: `1px solid ${border}`,
                borderRadius: 2,
                padding: '11px 13px',
                background: '#fff',
                resize: 'vertical',
                minHeight: 104,
                lineHeight: 1.55,
                boxSizing: 'border-box',
              }}
            />
            <div
              style={{
                display: 'flex',
                gap: 10,
                background: '#eef1f6',
                border: `1px solid ${border}`,
                borderLeft: `3px solid ${navy}`,
                padding: '12px 14px',
                fontSize: 12.5,
                color: muted,
                marginTop: 8,
                borderRadius: 2,
              }}
            >
              <span style={{ fontSize: 14, color: navy, fontWeight: 700, flexShrink: 0, lineHeight: 1.4 }}>i</span>
              <span>
                Plain language is fine. Starling will identify the legal issues:{' '}
                <b style={{ color: navy }}>wrongful dismissal, ESA entitlements, Waksdale termination-clause analysis, Human Rights Code</b> claims, and limitation periods.
              </span>
            </div>
          </div>

          {/* Employment Details (collapsible) */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: navy, marginBottom: 7 }}>
              Employment Details
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 400, color: muted, fontSize: 12.5, marginBottom: 6 }}>
                  Job Title
                </div>
                <input
                  type="text"
                  placeholder="e.g., Senior Marketing Manager"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  style={{
                    width: '100%', fontFamily: sans, fontSize: 14, color: ink,
                    border: `1px solid ${border}`, borderRadius: 2,
                    padding: '11px 13px', background: '#fff', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 400, color: muted, fontSize: 12.5, marginBottom: 6 }}>
                  Annual Salary (CAD)
                </div>
                <input
                  type="text"
                  placeholder="e.g., 95000"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value.replace(/[^\d.]/g, ''))}
                  style={{
                    width: '100%', fontFamily: sans, fontSize: 14, color: ink,
                    border: `1px solid ${border}`, borderRadius: 2,
                    padding: '11px 13px', background: '#fff', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* Termination reason */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 400, color: muted, fontSize: 12.5, marginBottom: 6 }}>
                Reason given for termination
              </div>
              <input
                type="text"
                placeholder="e.g., restructuring, performance, no reason given"
                value={terminationReason}
                onChange={(e) => setTerminationReason(e.target.value)}
                style={{
                  width: '100%', fontFamily: sans, fontSize: 14, color: ink,
                  border: `1px solid ${border}`, borderRadius: 2,
                  padding: '11px 13px', background: '#fff', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Flags */}
            <div style={{ display: 'flex', gap: 24, marginTop: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: ink, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={justCause}
                  onChange={(e) => setJustCause(e.target.checked)}
                  style={{ accentColor: orange }}
                />
                Employer alleged just cause
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: ink, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={constructiveDismissal}
                  onChange={(e) => setConstructiveDismissal(e.target.checked)}
                  style={{ accentColor: orange }}
                />
                Constructive dismissal
              </label>
            </div>
          </div>

          {/* Documents are NOT uploaded here. They were parsed and then
              discarded, so the box promised something it never did. Uploading
              happens on the matter's Documents tab, where extraction proposes
              facts for the lawyer to review and apply. */}
          <div style={{ marginBottom: 22, background: cream, border: `1px solid ${border}`, borderRadius: 2, padding: '14px 16px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: navy, marginBottom: 4 }}>
              Documents come next
            </div>
            <div style={{ fontSize: 12.5, color: muted }}>
              Open the file first, then add the termination letter, employment agreement, pay records and
              anything else on its Documents tab. Starling reads each one and proposes the facts it finds,
              with the quote it came from, for you to check before anything is saved to the file.
            </div>
          </div>

          {/* Key dates */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: navy, marginBottom: 7 }}>
              Key dates{' '}
              <span
                style={{
                  fontWeight: 400,
                  color: muted,
                  fontSize: 12,
                  background: cream,
                  border: `1px solid ${border}`,
                  padding: '1px 7px',
                  borderRadius: 2,
                  marginLeft: 6,
                }}
              >
                optional; Starling extracts these from documents
              </span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 400, color: muted, fontSize: 12.5, marginBottom: 6 }}>
                  Employment start date
                </div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{
                    width: '100%',
                    fontFamily: sans,
                    fontSize: 14,
                    color: ink,
                    border: `1px solid ${border}`,
                    borderRadius: 2,
                    padding: '11px 13px',
                    background: '#fff',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 400, color: muted, fontSize: 12.5, marginBottom: 6 }}>
                  Termination date
                </div>
                <input
                  type="date"
                  value={terminationDate}
                  onChange={(e) => setTerminationDate(e.target.value)}
                  style={{
                    width: '100%',
                    fontFamily: sans,
                    fontSize: 14,
                    color: ink,
                    border: `1px solid ${border}`,
                    borderRadius: 2,
                    padding: '11px 13px',
                    background: '#fff',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {/* Deadline calculations */}
            {termDate && limitationDate && hrtoDate && (
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  background: '#eef1f6',
                  border: `1px solid ${border}`,
                  borderLeft: `3px solid ${navy}`,
                  padding: '12px 14px',
                  fontSize: 12.5,
                  color: muted,
                  marginTop: 8,
                  borderRadius: 2,
                }}
              >
                {/* Clock icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>
                  From a termination date of <b style={{ color: navy }}>{formatDateLong(termDate)}</b>,
                  Starling will track the <b style={{ color: navy }}>2-year limitation</b> (Limitations Act)
                  to {formatDateLong(limitationDate)}, and
                  the <b style={{ color: navy }}>1-year HRTO limitation</b> to {formatDateLong(hrtoDate)}.
                </span>
              </div>
            )}
          </div>

          {/* Submit bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 30,
              paddingTop: 22,
              borderTop: `1px solid ${border}`,
            }}
          >
            <div style={{ fontSize: 13, color: muted }}>
              Estimated cost: <b style={{ color: ink }}>~$0.50{'\u2013'}1.00</b> for intake analysis
            </div>
            <div>
              <button
                onClick={() => handleNav('#/')}
                style={{
                  background: '#fff',
                  color: navy,
                  border: `1px solid ${border}`,
                  fontSize: 14,
                  padding: '13px 20px',
                  borderRadius: 2,
                  cursor: 'pointer',
                  marginRight: 10,
                  fontFamily: sans,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={uploading}
                style={{
                  background: uploading ? '#b0b0b0' : orange,
                  color: '#fff',
                  fontSize: 14.5,
                  fontWeight: 600,
                  padding: '13px 24px',
                  borderRadius: 2,
                  border: 'none',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  fontFamily: sans,
                }}
              >
                {uploading ? 'Creating matter...' : <>Create Matter &amp; Analyse &rarr;</>}
              </button>
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div
              style={{
                marginTop: 14,
                padding: '12px 16px',
                border: `1px solid #dc2626`,
                borderRadius: 2,
                background: '#fce8e6',
                color: '#dc2626',
                fontSize: 13.5,
              }}
            >
              {error}
            </div>
          )}
          </>)}
        </div>
      </main>
    </div>
  );
}
