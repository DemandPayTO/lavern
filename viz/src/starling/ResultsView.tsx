/**
 * ResultsView -- Starling document delivery with quality score.
 *
 * Tabbed view: Document, Issues, Source Map, Verification, Cost.
 * Inline source indicators use colour-coded dots (green=verified,
 * amber=web source). Static demo data matching the approved mockup.
 *
 * Ontario employment law vocabulary. Canadian spelling throughout.
 */

import { useState, useCallback } from 'react';

// -- Design Tokens --------------------------------------------------------
const navy = '#0f1a2e';
const orange = '#ea580c';
const cream = '#faf8f5';
const frame = '#e8e5e0';
const green = '#16a34a';
const amber = '#d97706';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const serif = "Georgia, 'Palatino Linotype', serif";
const sans = "system-ui, -apple-system, sans-serif";

// -- Types ----------------------------------------------------------------

type TabKey = 'document' | 'issues' | 'sourcemap' | 'verification' | 'cost';

interface IssueItem {
  title: string;
  strength: 'Strong' | 'Moderate';
  description: string;
  tags: { label: string; type: 'verified' | 'web' | 'statute' }[];
}

interface SourceMapRow {
  claim: string;
  source: string;
  type: string;
  typeClass: 'verified' | 'web' | 'statute' | 'ai';
  trust: string;
  trustLevel: 'high' | 'med' | 'low';
}

interface VerificationPass {
  dimension: string;
  weight: string;
  score: number;
  barColour?: string;
}

interface CostRow {
  stage: string;
  detail: string;
  cost: string;
}

// -- Demo Data ------------------------------------------------------------

const TABS: { key: TabKey; label: string }[] = [
  { key: 'document', label: 'Document' },
  { key: 'issues', label: 'Issues' },
  { key: 'sourcemap', label: 'Source Map' },
  { key: 'verification', label: 'Verification' },
  { key: 'cost', label: 'Cost' },
];

const ISSUES: IssueItem[] = [
  {
    title: 'Wrongful dismissal -- without cause',
    strength: 'Strong',
    description: 'ESA notice 8 weeks; common law 10\u201314 months under Bardal. Addressed in paragraphs 2\u20134 of the letter.',
    tags: [
      { label: '\u00A7 ESA s. 57', type: 'statute' },
      { label: 'case_db', type: 'verified' },
    ],
  },
  {
    title: 'Termination clause void (Waksdale)',
    strength: 'Strong',
    description: '"Just cause" language fails ESA "wilful misconduct" standard -- entire clause void. Addressed in paragraph 3.',
    tags: [
      { label: 'case_db \u00B7 Waksdale 2020 ONCA 391', type: 'verified' },
    ],
  },
  {
    title: 'Disability discrimination (Human Rights Code)',
    strength: 'Moderate',
    description: 'Raised in paragraph 5 as a preserved claim. Recommend pulling the May 28 accommodation email before relying on this in pleadings.',
    tags: [
      { label: 'ai_knowledge \u00B7 verify', type: 'web' },
    ],
  },
  {
    title: 'Bad faith / aggravated damages (Honda v Keays)',
    strength: 'Moderate',
    description: 'Same-day termination supports a Honda claim. Referenced in paragraph 5.',
    tags: [
      { label: 'case_db \u00B7 Honda 2008 SCC 39', type: 'verified' },
    ],
  },
];

const SOURCE_MAP: SourceMapRow[] = [
  { claim: "8 weeks' ESA notice entitlement", source: 'ESA, 2000 s. 57(h)', type: 'statute', typeClass: 'statute', trust: 'Highest', trustLevel: 'high' },
  { claim: 'Termination clause void if any part breaches ESA', source: 'Waksdale v Swegon, 2020 ONCA 391', type: 'case_db', typeClass: 'verified', trust: 'High', trustLevel: 'high' },
  { claim: 'Common law reasonable notice via Bardal factors', source: 'Bardal v Globe & Mail, 1960 CanLII 855 (ON SC)', type: 'case_db', typeClass: 'verified', trust: 'High', trustLevel: 'high' },
  { claim: 'Aggravated damages for manner of dismissal', source: 'Honda v Keays, 2008 SCC 39', type: 'case_db', typeClass: 'verified', trust: 'High', trustLevel: 'high' },
  { claim: 'Limited availability of comparable senior marketing roles', source: 'CanLII / market survey (allowlisted)', type: 'web_search', typeClass: 'web', trust: 'Medium \u00B7 verify', trustLevel: 'med' },
  { claim: 'Termination timing supports Code reprisal inference', source: 'Model knowledge -- not independently verified', type: 'ai_knowledge', typeClass: 'ai', trust: 'Verify before use', trustLevel: 'low' },
];

const VERIFICATION_PASSES: VerificationPass[] = [
  { dimension: 'Factual Correctness', weight: '0.15', score: 0.96 },
  { dimension: 'Legal Accuracy', weight: '0.20', score: 0.94 },
  { dimension: 'Completeness', weight: '0.15', score: 0.90 },
  { dimension: 'Internal Consistency', weight: '0.10', score: 0.98 },
  { dimension: 'Procedural Compliance', weight: '0.15', score: 0.92 },
  { dimension: 'Source Attribution', weight: '0.10', score: 0.84, barColour: amber },
  { dimension: 'Formal Tone', weight: '0.10', score: 0.95 },
  { dimension: 'Client Alignment', weight: '0.05', score: 0.93 },
];

const COST_ROWS: CostRow[] = [
  { stage: 'Drafting', detail: 'Employment Counsel -- issue analysis, entitlements, draft', cost: '$1.41' },
  { stage: 'Adversarial test', detail: "Red Team + Litigation Partner -- employer-side stress test", cost: '$0.92' },
  { stage: 'Strengthening', detail: 'Employment Counsel -- response to challenges', cost: '$0.46' },
  { stage: 'Verification', detail: '8-pass evaluation + independent ESA recalculation', cost: '$0.51' },
  { stage: 'Synthesis', detail: 'Final assembly + audit bundle', cost: '$0.17' },
];

// -- Component ------------------------------------------------------------

export default function ResultsView() {
  const [activeTab, setActiveTab] = useState<TabKey>('document');

  const handleNav = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' as const }}>
      {/* -- Top Bar ---------------------------------------------------- */}
      <TopBar />

      {/* -- Main Content ----------------------------------------------- */}
      <main id="main-content" style={{ maxWidth: 980, margin: '0 auto', padding: '24px 28px 60px' }}>
        {/* Breadcrumb */}
        <nav style={{ color: muted, fontSize: 13, marginBottom: 14 }} aria-label="Breadcrumb">
          <a href="#/" style={{ color: 'inherit', textDecoration: 'none' }} onClick={() => handleNav('#/')}>My Matters</a>
          {' > '}
          <a href="#/matter-detail" style={{ color: 'inherit', textDecoration: 'none' }}>Smith v Acme Corp</a>
          {' > '}
          <span>Demand Letter</span>
        </nav>

        {/* Result header */}
        <div style={{
          background: '#fff',
          border: `1px solid ${border}`,
          padding: '20px 26px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
        }}>
          <div>
            <h1 style={{ fontFamily: serif, fontWeight: 600, fontSize: 22, color: navy, margin: 0 }}>
              Demand Letter -- Smith v Acme Corp
            </h1>
            <div style={{ fontSize: 12.5, color: muted, marginTop: 2 }}>
              Generated June 25, 2026 &middot; Adversarial workflow &middot; 8 verification passes
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {/* Quality score */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: muted }}>Quality</div>
              <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 600, color: navy }}>
                92<span style={{ fontSize: 14, color: muted }}>/100</span>
              </div>
            </div>
            {/* Cost */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: muted }}>Cost</div>
              <div style={{ fontFamily: serif, fontSize: 22, fontWeight: 600, color: navy }}>$3.47</div>
            </div>
            {/* PASS badge */}
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              background: '#e7f6ec',
              color: green,
              fontSize: 13,
              fontWeight: 700,
              padding: '8px 14px',
              borderRadius: 2,
              border: '1px solid #bfe3cb',
            }}>
              {/* Green dot instead of emoji */}
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: green, display: 'inline-block' }} />
              PASS
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: 2,
          marginTop: 18,
          borderBottom: `1px solid ${border}`,
          background: '#fff',
          border: `1px solid ${border}`,
          borderBottomWidth: 0,
        }}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                fontFamily: sans,
                fontSize: 13.5,
                fontWeight: 600,
                color: activeTab === tab.key ? navy : muted,
                background: 'transparent',
                border: 'none',
                padding: '13px 20px',
                cursor: 'pointer',
                borderBottom: `2px solid ${activeTab === tab.key ? orange : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Panel wrap */}
        <div style={{ background: '#fff', border: `1px solid ${border}`, borderTop: 'none' }}>
          {activeTab === 'document' && <DocumentPanel />}
          {activeTab === 'issues' && <IssuesPanel />}
          {activeTab === 'sourcemap' && <SourceMapPanel />}
          {activeTab === 'verification' && <VerificationPanel />}
          {activeTab === 'cost' && <CostPanel />}
        </div>

        {/* Human gate disclaimer */}
        <div style={{
          display: 'flex',
          gap: 10,
          background: '#eef1f6',
          border: `1px solid ${border}`,
          borderLeft: `3px solid ${navy}`,
          padding: '12px 16px',
          margin: '20px 0 0',
          fontSize: 13,
          color: muted,
        }}>
          {/* Scale SVG icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={navy} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
            <path d="M12 3v18M3 7l9-4 9 4M3 7l3 9h0a5 5 0 0 0 6 0h0l3-9M15 7l3 9h0a5 5 0 0 0 6 0h0l3-9" />
          </svg>
          <span>
            <b style={{ color: navy }}>Human review required.</b> This draft has not been sent. Review and approve before it reaches the employer or the court -- a human gate is mandatory on every Starling deliverable.
          </span>
        </div>

        {/* Export bar */}
        <div style={{
          position: 'sticky',
          bottom: 0,
          background: '#fff',
          border: `1px solid ${border}`,
          padding: '16px 24px',
          marginTop: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{ fontSize: 12.5, color: muted, marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Green dot */}
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: green, display: 'inline-block' }} />
            Saved to matter &middot; Quality 92/100 PASS
          </div>
          <button
            style={{
              background: orange,
              color: '#fff',
              fontSize: 13.5,
              fontWeight: 600,
              padding: '11px 20px',
              borderRadius: 2,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Download DOCX
          </button>
          <button
            style={{
              background: '#fff',
              color: navy,
              border: `1px solid ${border}`,
              fontSize: 13.5,
              fontWeight: 600,
              padding: '11px 18px',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            Download PDF
          </button>
          <button
            onClick={() => { window.location.hash = '#/'; }}
            style={{
              background: '#fff',
              color: navy,
              border: `1px solid ${border}`,
              fontSize: 13.5,
              fontWeight: 600,
              padding: '11px 18px',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            Save to Matter
          </button>
        </div>
      </main>
    </div>
  );
}

// -- Sub-components -------------------------------------------------------

/** Top navigation bar -- shared Starling pattern. */
function TopBar() {
  return (
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
    </header>
  );
}

// -- Inline source indicator dots -----------------------------------------

/** Green verified dot. */
function VerifiedDot({ title }: { title: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: green,
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        cursor: 'help',
        marginLeft: 3,
        verticalAlign: 'middle',
      }}
      aria-label={`Verified: ${title}`}
    >
      <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Amber web-source dot. */
function WebDot({ title }: { title: string }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: amber,
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        cursor: 'help',
        marginLeft: 3,
        verticalAlign: 'middle',
      }}
      aria-label={`Web source: ${title}`}
    >
      !
    </span>
  );
}

/** Highlighted key figure span. */
function Mark({ children }: { children: React.ReactNode }) {
  return <mark style={{ background: 'rgba(234,88,12,0.10)', padding: '0 2px' }}>{children}</mark>;
}

// -- Tab Panels -----------------------------------------------------------

/** Document tab -- rendered demand letter with inline source indicators. */
function DocumentPanel() {
  return (
    <div style={{ padding: '36px 56px', maxWidth: 760, margin: '0 auto', fontSize: 14, lineHeight: 1.75, color: '#1a2433' }}>
      <div style={{ fontFamily: serif, fontWeight: 700, letterSpacing: '0.06em', color: navy, marginBottom: 18 }}>
        WITHOUT PREJUDICE
      </div>

      <p style={{ marginBottom: 14 }}>June 25, 2026</p>

      <p style={{ marginBottom: 14 }}>
        Human Resources Department<br />
        Acme Corporation
      </p>

      <p style={{ fontWeight: 700, marginBottom: 14 }}>Re: Termination of Jane Smith</p>

      <p style={{ marginBottom: 14 }}>
        We are counsel for Jane Smith in connection with the termination of her employment with Acme Corporation on June 1, 2026.
        <VerifiedDot title="Verified against intake data" />
      </p>

      <p style={{ marginBottom: 14 }}>
        Ms. Smith was employed for <Mark>8.3 years</Mark> as a Marketing Manager. Under the <em>Employment Standards Act, 2000</em>, ss. 57{'\u2013'}58, she is entitled to a minimum of <Mark>8 weeks&apos;</Mark> notice of termination.
        <VerifiedDot title="Verified: statute -- ESA s.57(h)" />
      </p>

      <p style={{ marginBottom: 14 }}>
        The termination provision in Ms. Smith&apos;s 2018 employment agreement purports to limit her entitlements to the statutory minimum. That provision is unenforceable. Its &ldquo;just cause&rdquo; language fails to meet the ESA &ldquo;wilful misconduct&rdquo; standard, and under <em>Waksdale v Swegon Power &amp; Cooling Systems Inc.</em>, 2020 ONCA 391, the entire termination clause is void.
        <VerifiedDot title="Verified: case_db -- Waksdale 2020 ONCA 391" />
      </p>

      <p style={{ marginBottom: 14 }}>
        Ms. Smith is therefore entitled to common law reasonable notice. Applying the <em>Bardal</em> factors -- her age, 8.3 years of service, the managerial character of her role, and the limited availability of comparable employment
        <WebDot title="Web source -- verify current market conditions" />
        {' '}-- reasonable notice falls in the range of <Mark>10 to 14 months</Mark>, or approximately <Mark>$79,167 to $110,833</Mark>.
        <VerifiedDot title="Verified: case_db -- Bardal v Globe & Mail" />
      </p>

      <p style={{ marginBottom: 14 }}>
        We further note that Ms. Smith&apos;s termination followed within days of a disability accommodation request, raising potential claims under the <em>Human Rights Code</em> and for aggravated damages per <em>Honda Canada Inc. v Keays</em>, 2008 SCC 39.
        <VerifiedDot title="Verified: case_db -- Honda v Keays 2008 SCC 39" />
      </p>

      <p style={{ marginBottom: 14 }}>
        We invite Acme Corporation to respond with a reasonable severance proposal within <Mark>14 days</Mark> of the date of this letter, failing which we are instructed to commence proceedings in the Superior Court of Justice.
        <VerifiedDot title="Verified: correct forum" />
      </p>

      <p style={{ marginBottom: 14 }}>
        Yours truly,<br /><br />
        DemandPay Starling -- for review by counsel
      </p>

      {/* Legend */}
      <div style={{
        marginTop: 28,
        paddingTop: 16,
        borderTop: `1px solid ${border}`,
        fontSize: 12,
        color: muted,
        display: 'flex',
        gap: 22,
      }}>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: green, marginRight: 4, verticalAlign: 'middle' }} />
          <b style={{ fontWeight: 600 }}>verified</b> -- statute or case database
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: amber, marginRight: 4, verticalAlign: 'middle' }} />
          <b style={{ fontWeight: 600 }}>web source</b> -- verify before sending
        </span>
        <span>
          <mark style={{ background: 'rgba(234,88,12,0.10)', padding: '0 3px' }}>highlight</mark> -- key figure, check against file
        </span>
      </div>
    </div>
  );
}

/** Issues tab -- list of legal issues with strength ratings. */
function IssuesPanel() {
  return (
    <div style={{ padding: '24px 28px' }}>
      {ISSUES.map((issue, i) => {
        const isModerate = issue.strength === 'Moderate';
        const borderLeftColour = isModerate ? amber : green;
        const strengthBg = isModerate ? '#fdf0dd' : '#e7f6ec';
        const strengthColour = isModerate ? amber : green;

        return (
          <div key={i} style={{
            border: `1px solid ${border}`,
            borderLeft: `4px solid ${borderLeftColour}`,
            padding: '14px 18px',
            marginBottom: 10,
          }}>
            <h4 style={{
              fontFamily: serif,
              fontWeight: 600,
              fontSize: 15,
              color: navy,
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              margin: '0 0 4px 0',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Status dot */}
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isModerate ? amber : green,
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
                {issue.title}
              </span>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 2,
                background: strengthBg,
                color: strengthColour,
                flexShrink: 0,
              }}>
                {issue.strength}
              </span>
            </h4>
            <p style={{ fontSize: 13, color: muted, margin: 0 }}>{issue.description}</p>
            <div style={{ marginTop: 8, display: 'flex', gap: 7 }}>
              {issue.tags.map((tag, j) => {
                let bg: string;
                let tagColour: string;
                let dotColour: string;
                if (tag.type === 'statute') {
                  bg = '#eef1f6'; tagColour = navy; dotColour = navy;
                } else if (tag.type === 'verified') {
                  bg = '#e7f6ec'; tagColour = green; dotColour = green;
                } else {
                  bg = '#fdf0dd'; tagColour = amber; dotColour = amber;
                }
                return (
                  <span key={j} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 2,
                    background: bg,
                    color: tagColour,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColour, display: 'inline-block' }} />
                    {tag.label}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Source Map tab -- table of every citation with trust level. */
function SourceMapPanel() {
  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '11px 14px',
    borderBottom: `1px solid ${border}`,
    verticalAlign: 'top',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: muted,
    fontWeight: 600,
    background: cream,
  };

  const tdStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '11px 14px',
    borderBottom: `1px solid ${border}`,
    verticalAlign: 'top',
    fontSize: 13,
  };

  return (
    <div style={{ padding: '24px 28px' }}>
      <p style={{ fontSize: 13, color: muted, marginBottom: 14 }}>
        Every legal proposition in the letter, traced to its source. Web and AI-knowledge items are flagged for your verification before sending.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: '46%' }}>Claim</th>
            <th style={thStyle}>Source</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Trust</th>
          </tr>
        </thead>
        <tbody>
          {SOURCE_MAP.map((row, i) => {
            let typeBg: string;
            let typeColour: string;
            let dotColour: string;
            if (row.typeClass === 'statute') {
              typeBg = '#eef1f6'; typeColour = navy; dotColour = navy;
            } else if (row.typeClass === 'verified') {
              typeBg = '#e7f6ec'; typeColour = green; dotColour = green;
            } else if (row.typeClass === 'web') {
              typeBg = '#fdf0dd'; typeColour = amber; dotColour = amber;
            } else {
              typeBg = '#f4f1ec'; typeColour = muted; dotColour = muted;
            }

            let trustBg: string;
            let trustColour: string;
            if (row.trustLevel === 'high') {
              trustBg = '#e7f6ec'; trustColour = green;
            } else if (row.trustLevel === 'med') {
              trustBg = '#fdf0dd'; trustColour = amber;
            } else {
              trustBg = '#f4f1ec'; trustColour = muted;
            }

            return (
              <tr key={i}>
                <td style={{ ...tdStyle, color: ink }}>{row.claim}</td>
                <td style={tdStyle}>{row.source}</td>
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 2,
                    background: typeBg,
                    color: typeColour,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColour, display: 'inline-block' }} />
                    {row.type}
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: 2,
                    background: trustBg,
                    color: trustColour,
                  }}>
                    {row.trust}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Verification tab -- 8 passes with weighted scores. */
function VerificationPanel() {
  // Calculate weighted total
  const weightedTotal = VERIFICATION_PASSES.reduce((sum, p) => {
    const w = parseFloat(p.weight);
    return sum + w * p.score;
  }, 0);
  const overallScore = Math.round(weightedTotal * 100);

  let verdict: string;
  let verdictColour: string;
  if (overallScore >= 85) {
    verdict = 'PASS';
    verdictColour = green;
  } else if (overallScore >= 70) {
    verdict = 'CONDITIONAL_PASS';
    verdictColour = amber;
  } else {
    verdict = 'FAIL';
    verdictColour = '#dc2626';
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <p style={{ fontSize: 13, color: muted, marginBottom: 16 }}>
        All 8 verification passes ran. The Evaluator (Opus) recalculated every ESA figure independently. Weighted score:{' '}
        <b style={{ color: navy }}>{overallScore} / 100 -- {verdict}</b>.
      </p>

      {VERIFICATION_PASSES.map((pass, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 0',
          borderBottom: i === VERIFICATION_PASSES.length - 1 ? 'none' : `1px solid ${border}`,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: ink, width: 200, flexShrink: 0 }}>{pass.dimension}</span>
          <span style={{ fontSize: 11.5, color: muted, width: 60, flexShrink: 0 }}>{pass.weight}</span>
          <div style={{ flex: 1, height: 8, background: cream, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
            <span style={{
              display: 'block',
              height: '100%',
              width: `${pass.score * 100}%`,
              background: pass.barColour || green,
            }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, width: 48, textAlign: 'right', flexShrink: 0 }}>
            {pass.score.toFixed(2)}
          </span>
        </div>
      ))}

      {/* Weighted total */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 0 0',
        borderTop: `2px solid ${border}`,
        marginTop: 8,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: navy, width: 200, flexShrink: 0 }}>Weighted Total</span>
        <span style={{ fontSize: 11.5, color: muted, width: 60, flexShrink: 0 }}>1.00</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: verdictColour }}>
          {overallScore}/100
        </span>
        <span style={{
          fontSize: 12,
          fontWeight: 700,
          padding: '4px 10px',
          borderRadius: 2,
          background: verdictColour === green ? '#e7f6ec' : verdictColour === amber ? '#fdf0dd' : '#fce8e6',
          color: verdictColour,
          marginLeft: 4,
        }}>
          {verdict}
        </span>
      </div>
    </div>
  );
}

/** Cost tab -- breakdown by agent stage. */
function CostPanel() {
  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '11px 14px',
    borderBottom: `1px solid ${border}`,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: muted,
    fontWeight: 600,
    background: cream,
  };

  const tdStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '11px 14px',
    borderBottom: `1px solid ${border}`,
    fontSize: 13,
  };

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <div style={{ border: `1px solid ${border}`, padding: '16px 18px' }}>
          <div style={{ fontSize: 12, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total cost</div>
          <div style={{ fontFamily: serif, fontSize: 24, color: navy, fontWeight: 600, marginTop: 4 }}>$3.47</div>
        </div>
        <div style={{ border: `1px solid ${border}`, padding: '16px 18px' }}>
          <div style={{ fontSize: 12, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Session budget</div>
          <div style={{ fontFamily: serif, fontSize: 24, color: navy, fontWeight: 600, marginTop: 4 }}>$5.00</div>
        </div>
        <div style={{ border: `1px solid ${border}`, padding: '16px 18px' }}>
          <div style={{ fontSize: 12, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Time</div>
          <div style={{ fontFamily: serif, fontSize: 24, color: navy, fontWeight: 600, marginTop: 4 }}>6m 12s</div>
        </div>
      </div>

      {/* Cost breakdown table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thStyle}>Stage</th>
            <th style={thStyle}>Detail</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {COST_ROWS.map((row, i) => (
            <tr key={i}>
              <td style={tdStyle}>{row.stage}</td>
              <td style={tdStyle}>{row.detail}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{row.cost}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} style={{ ...tdStyle, fontWeight: 600 }}>Total</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>$3.47</td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: 11.5, color: muted, marginTop: 12 }}>
        Full cost log ships with the audit bundle for this deliverable.
      </p>
    </div>
  );
}
