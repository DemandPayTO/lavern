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

import { useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useMatterCreate } from './hooks/useStarlingApi.js';

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

interface UploadedFile {
  id: string;
  name: string;
  type: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Parse dd/mm/yyyy into a Date, or return null. */
function parseDateDMY(value: string): Date | null {
  const parts = value.trim().split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  const day = parseInt(dd, 10);
  const month = parseInt(mm, 10);
  const year = parseInt(yyyy, 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return null;
  return new Date(year, month - 1, day);
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
  const [practiceArea, setPracticeArea] = useState<'employment' | 'labour'>('employment');
  const [clientName, setClientName] = useState('');
  const [employerName, setEmployerName] = useState('');
  const [situation, setSituation] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [rawFiles, setRawFiles] = useState<File[]>([]);
  const [startDate, setStartDate] = useState('');
  const [terminationDate, setTerminationDate] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [salary, setSalary] = useState('');
  const [justCause, setJustCause] = useState(false);
  const [constructiveDismissal, setConstructiveDismissal] = useState(false);
  const [terminationReason, setTerminationReason] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { createMatter, uploading, error } = useMatterCreate();

  // Parse termination date for deadline calculations
  const termDate = useMemo(() => parseDateDMY(terminationDate), [terminationDate]);
  const limitationDate = useMemo(() => termDate ? addYears(termDate, 2) : null, [termDate]);
  const hrtoDate = useMemo(() => termDate ? addYears(termDate, 1) : null, [termDate]);

  const handleNav = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const newFiles: UploadedFile[] = incoming.map(f => ({
      id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name,
      type: getFileTypeLabel(f.name),
    }));
    setFiles(prev => [...prev, ...newFiles]);
    setRawFiles(prev => [...prev, ...incoming]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => {
      const idx = prev.findIndex(f => f.id === id);
      if (idx !== -1) {
        setRawFiles(rf => rf.filter((_, i) => i !== idx));
      }
      return prev.filter(f => f.id !== id);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleSubmit = useCallback(async () => {
    try {
      const result = await createMatter({
        clientName,
        employerName,
        situation,
        files: rawFiles.length > 0 ? rawFiles : undefined,
        startDate: startDate || undefined,
        termDate: terminationDate || undefined,
        // Employment-specific fields
        jobTitle: jobTitle || undefined,
        salary: salary ? parseFloat(salary) : undefined,
        justCause,
        constructiveDismissal,
        terminationReason: terminationReason || undefined,
      });
      handleNav(`#/matter-detail/${result.matterId ?? result.sessionId}`);
    } catch {
      // error is already set by the hook
    }
  }, [createMatter, clientName, employerName, situation, rawFiles, startDate, terminationDate, jobTitle, salary, justCause, constructiveDismissal, terminationReason, handleNav]);

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

          {/* Practice area */}
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

          {/* Upload documents */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: navy, marginBottom: 7 }}>
              Upload documents{' '}
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
                optional
              </span>
            </label>

            {/* Drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              style={{
                border: `1.5px dashed ${isDragOver ? orange : border}`,
                borderRadius: 2,
                background: cream,
                padding: 24,
                textAlign: 'center',
                color: isDragOver ? ink : muted,
                cursor: 'pointer',
              }}
              role="button"
              tabIndex={0}
              aria-label="Drop files here or click to browse"
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            >
              {/* Upload icon as SVG */}
              <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.7 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div style={{ fontSize: 14, color: ink, fontWeight: 600, marginBottom: 4 }}>
                Drop files here or click to browse
              </div>
              <div style={{ fontSize: 12.5 }}>
                Employment agreement, termination letter, ROE, pay stubs, severance offer, intake notes
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => addFiles(e.target.files)}
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
            />

            {/* File list */}
            {files.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {files.map(f => (
                  <div
                    key={f.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 13,
                      border: `1px solid ${border}`,
                      borderRadius: 2,
                      padding: '8px 11px',
                      background: '#fff',
                    }}
                  >
                    {/* Document icon */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>{f.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: muted,
                        background: cream,
                        padding: '1px 6px',
                        borderRadius: 2,
                        border: `1px solid ${border}`,
                      }}
                    >
                      {f.type}
                    </span>
                    <span style={{ color: green, fontSize: 12 }}>
                      {/* Checkmark */}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {' '}ready
                    </span>
                    <span
                      style={{ marginLeft: 'auto', color: muted, cursor: 'pointer', fontSize: 14 }}
                      onClick={() => removeFile(f.id)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${f.name}`}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeFile(f.id); } }}
                    >
                      x
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                  type="text"
                  placeholder="dd/mm/yyyy"
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
                  type="text"
                  placeholder="dd/mm/yyyy"
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
