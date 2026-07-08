/**
 * Grievance Eval Battery — runs real Ontario union-side fact patterns
 * through the labour pipeline (matter → grievance intake → 11-gate
 * analysis → document generation) against a LOCAL server, and scores
 * the outputs. The labour sibling of scripts/eval-battery.ts.
 *
 * Usage:
 *   npm run serve                              # in one terminal
 *   npx tsx scripts/grievance-eval-battery.ts [--budget 4]
 *
 * Budget: HARD CAP on API spend (default $4). Filings/referrals are
 * sonnet (~$0.02–0.05); briefs and DFR responses are opus (~$0.30–0.60).
 *
 * Outputs: eval-results/grievance-<timestamp>/
 *   - <pattern>-<doc>.html        generated documents
 *   - REPORT.md                   pass/fail checks, flags, costs
 *
 * Automated checks per document:
 *   - no anonymisation placeholder leakage ([PARTY_1], ...)
 *   - grievor + employer names present (de-anonymisation worked)
 *   - substantive length (per-document threshold — a grievance is 1 page,
 *     a brief is not)
 *   - citation-canon flags surfaced (counted, not failed — reviewer checks)
 *   - reviewer flags present
 * The REPORT is the artifact Jordan (as the reviewer) scores by hand.
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const budgetArg = process.argv.indexOf('--budget');
const BUDGET_USD = budgetArg > -1 ? parseFloat(process.argv[budgetArg + 1]) : 4;
const patternArg = process.argv.indexOf('--pattern');
const ONLY_PATTERN = patternArg > -1 ? process.argv[patternArg + 1] : null;
/** Reserve per generation: briefs/DFR are the expensive ones. */
const RESERVE: Record<string, number> = {
  grievance_filing: 0.15,
  referral_to_arbitration: 0.15,
  arbitration_brief: 1.0,
  dfr_response: 1.0,
  merits_assessment: 1.0,
  decline_letter: 0.15,
  member_update: 0.15,
  remedy_worksheet: 0,
  particulars: 0.15,
  production_request: 0.15,
  settlement_memorandum: 1.0,
  ohsa_reprisal_complaint: 1.0,
  will_say: 0.15,
  agreed_facts: 0.15,
  closing_argument: 1.0,
  hearing_bundle: 0,
};
/** Filings and referrals are deliberately one page; briefs are not. */
const MIN_LENGTH: Record<string, number> = {
  grievance_filing: 800,
  referral_to_arbitration: 800,
  arbitration_brief: 3500,
  dfr_response: 3000,
  merits_assessment: 3000,
  decline_letter: 1000,
  member_update: 600,
  remedy_worksheet: 500,
  particulars: 1200,
  production_request: 1200,
  settlement_memorandum: 2000,
  ohsa_reprisal_complaint: 2000,
  will_say: 1500,
  agreed_facts: 1200,
  closing_argument: 3000,
  hearing_bundle: 500,
};

let spentUsd = 0;

// ── Fact patterns ────────────────────────────────────────────────────────

interface Pattern {
  key: string;
  title: string;
  grievorLastName: string;
  employerFirstWord: string;
  intake: Record<string, unknown>;
  documents: string[];
  additionalContext?: string;
}

const REP = { representativeName: 'Jordan Whitfield', organizationName: 'Whitfield Labour Law' };

const PATTERNS: Pattern[] = [
  {
    key: 'g1-discharge',
    title: 'Long-service discharge — procedural defects, stale prior record, Wm Scott',
    grievorLastName: 'Boisvert',
    employerFirstWord: 'Trillium',
    intake: {
      grievor_first_name: 'Claude', grievor_last_name: 'Boisvert',
      grievor_classification: 'Millwright', grievor_department: 'Maintenance',
      grievor_seniority_date: '2008-03-17',
      union_name: 'IAM Local 235', union_rep_name: 'P. Nguyen',
      employer_name: 'Trillium Paper Products Inc', workplace_location: 'Cornwall mill',
      ca_title: '2023–2026 Collective Agreement',
      grievance_procedure_article: 'Article 11', just_cause_article: 'Article 5.02',
      filing_deadline_days: 10, filing_deadline_kind: 'working',
      referral_deadline_days: 30, referral_deadline_kind: 'calendar',
      time_limits_mandatory: true,
      grievance_type: 'discharge', discipline_imposed: 'discharge',
      incident_date: '2026-06-24', discipline_letter_date: '2026-06-26',
      incident_description: 'Discharged for allegedly falsifying a lockout verification record on one occasion. Grievor has 18 years of service. The discharge meeting lasted four minutes.',
      employer_stated_grounds: 'Falsification of safety documentation',
      grievance_filed: false,
      prior_discipline: true,
      prior_discipline_details: 'One written warning in 2019 for late reporting (not grieved)',
      sunset_clause_months: 24,
      union_rep_present_at_meeting: false,
      investigation_conducted: false,
      remedy_sought: 'Reinstatement with full back pay, benefits, and seniority',
      back_pay_estimate: 96000,
      wage_rate: 42.5, wage_rate_period: 'hour', hours_per_week: 40,
      vacation_pay_percent: 6, benefits_load_percent: 12, pension_contrib_percent: 7,
      interim_earnings: 8000,
      witnesses: [
        { name: 'Claude Boisvert', role: 'Grievor', topics: 'The incident, the investigation meeting, and his record' },
        { name: 'Devon Price', role: 'Steward', topics: 'The disciplinary meeting and what the supervisor said' },
        { name: 'Alia Rahman', role: 'Coworker', topics: 'What she observed on the floor before the incident' },
      ],
    },
    documents: ['grievance_filing', 'particulars', 'production_request', 'merits_assessment', 'remedy_worksheet', 'arbitration_brief', 'will_say', 'agreed_facts', 'closing_argument', 'hearing_bundle'],
  },
  {
    key: 'g2-hr-suspension',
    title: 'Suspension with Code overlay — accommodation, Parry Sound, referral stage',
    grievorLastName: 'Mensah',
    employerFirstWord: 'Georgian',
    intake: {
      grievor_first_name: 'Abena', grievor_last_name: 'Mensah',
      grievor_classification: 'Registered Practical Nurse',
      grievor_seniority_date: '2016-09-06',
      union_name: 'ONA Local 75',
      employer_name: 'Georgian Shores Long-Term Care Ltd',
      ca_title: '2024–2027 Collective Agreement',
      grievance_procedure_article: 'Article 9', just_cause_article: 'Article 8.01',
      filing_deadline_days: 9, filing_deadline_kind: 'calendar',
      referral_deadline_days: 21, referral_deadline_kind: 'calendar',
      grievance_type: 'human_rights', discipline_imposed: 'suspension_unpaid',
      incident_date: '2026-05-11',
      incident_description: 'Three-day unpaid suspension for attendance after absences related to a documented chronic condition. Employer refused a modified schedule recommended by her physician.',
      employer_stated_grounds: 'Innocent absenteeism — attendance management program step 3',
      believes_discriminatory: true,
      discrimination_grounds: ['disability'],
      accommodation_involved: true,
      accommodation_details: 'Physician recommended a fixed day-shift schedule during treatment; employer refused without explanation.',
      grievance_filed: true, grievance_filed_date: '2026-05-15',
      grievance_number: '2026-ONA-031', current_step: 'Step 2',
      last_step_response_date: '2026-06-25',
      procedure_steps: [
        { label: 'Step 1', employer_response_days: 5, advance_days: 5, day_kind: 'calendar' },
        { label: 'Step 2', employer_response_days: 10, day_kind: 'calendar' },
      ],
      step_events: [
        { step_label: 'Step 1', presented_date: '2026-05-15', response_date: '2026-05-20' },
        { step_label: 'Step 2', presented_date: '2026-05-25', response_date: '2026-06-25' },
      ],
      union_rep_present_at_meeting: true, investigation_conducted: true,
      prior_discipline: false,
      remedy_sought: 'Rescind the suspension, make whole, accommodate per medical restrictions, Code damages',
    },
    documents: ['referral_to_arbitration', 'settlement_memorandum'],
  },
  {
    key: 'g3-dfr',
    title: 'DFR response — union declined to arbitrate a discharge after legal opinion',
    grievorLastName: 'Kowalski',
    employerFirstWord: 'Bayfront',
    intake: {
      grievor_first_name: 'Marek', grievor_last_name: 'Kowalski',
      grievor_classification: 'Warehouse Associate',
      grievor_seniority_date: '2022-01-10',
      union_name: 'Teamsters Local 419',
      employer_name: 'Bayfront Distribution Centres Inc',
      grievance_procedure_article: 'Article 7',
      grievance_type: 'discharge', discipline_imposed: 'discharge',
      incident_date: '2026-02-03',
      incident_description: 'Discharged after a positive post-incident drug test following a forklift collision. Grievance filed and advanced to Step 2; union obtained a legal opinion assessing poor prospects and declined to refer to arbitration after a bargaining-unit committee review. Grievor filed a s. 74 DFR application.',
      employer_stated_grounds: 'Impairment at work — zero tolerance policy',
      grievance_filed: true, grievance_filed_date: '2026-02-06',
      grievance_number: '2026-419-008', current_step: 'Step 2 (final)',
      last_step_response_date: '2026-03-12',
      union_rep_present_at_meeting: true, investigation_conducted: true,
      prior_discipline: true,
      prior_discipline_details: 'Verbal warning 2024 (safety), written warning 2025 (near-miss)',
      dfr_concern: true,
      dfr_details: 'Grievor alleges the union "did nothing" and settled cheap; committee minutes, the legal opinion, and four written updates to the grievor exist.',
      remedy_sought: 'Dismissal of the s. 74 application',
    },
    documents: ['decline_letter', 'member_update', 'dfr_response'],
    additionalContext: 'The complaint alleges: (1) the union ignored two emails from the grievor in March 2026; (2) the decision was made to save money; (3) a steward called the grievor "a lost cause" in front of coworkers. Respond to each.',
  },
  {
    key: 'g4-kvp-policy',
    title: 'Policy grievance — unilateral biometric scanning rule, KVP',
    grievorLastName: 'policy',
    employerFirstWord: 'Norfolk',
    intake: {
      union_name: 'UFCW Local 175',
      employer_name: 'Norfolk Cold Storage Ltd',
      ca_title: '2025–2028 Collective Agreement',
      grievance_procedure_article: 'Article 6',
      filing_deadline_days: 15, filing_deadline_kind: 'calendar',
      grievance_type: 'policy',
      incident_date: '2026-06-20',
      knowledge_date: '2026-06-27',
      incident_description: 'Employer unilaterally introduced mandatory fingerprint biometric time clocks with discipline up to discharge for refusal. No consultation with the union; policy posted on a lunchroom wall.',
      employer_stated_grounds: 'Time theft prevention policy',
      grievance_filed: false,
      remedy_sought: 'Rescind the policy, destroy collected biometric data, cease and desist',
    },
    documents: ['grievance_filing'],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${(json as { error?: string }).error ?? 'unknown'}`);
  }
  return json as Record<string, unknown>;
}

const PLACEHOLDER_RE = /\[[A-Z]+_\d+\]/;

interface DocResult {
  pattern: string;
  doc: string;
  ok: boolean;
  costUsd: number;
  htmlLength: number;
  checks: Record<string, boolean>;
  reviewerFlags: string[];
  canonFlags: string[];
  error?: string;
  file?: string;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join('eval-results', `grievance-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const results: DocResult[] = [];
  const patternNotes: string[] = [];

  console.log(`Grievance eval battery — budget cap $${BUDGET_USD.toFixed(2)}, output ${outDir}\n`);

  for (const pattern of PATTERNS) {
    if (ONLY_PATTERN && pattern.key !== ONLY_PATTERN) continue;
    console.log(`── ${pattern.key}: ${pattern.title}`);

    // 1. Create matter
    const grievor = [pattern.intake.grievor_first_name, pattern.intake.grievor_last_name].filter(Boolean).join(' ') || 'Union policy grievance';
    const matter = await api('POST', '/api/matters', {
      clientName: grievor,
      matterTitle: `[EVAL] ${grievor} — Grievance v ${pattern.intake.employer_name}`,
      matterDescription: `[EVAL] ${pattern.title}`,
      matterType: 'employment_agreement',
      jurisdiction: 'CA',
    });
    const matterId = matter.matterId as string;

    // 2. Grievance intake (deterministic gates + clocks, no API cost)
    const intakeRes = await api('POST', '/api/labour/intake', { matterId, intake: pattern.intake });
    const gates = (intakeRes.gates ?? []) as Array<{ gate: string; triggered: boolean; issueCodes: string[] }>;
    const triggered = gates.filter(g => g.triggered);
    const issueCodes = [...new Set(triggered.flatMap(g => g.issueCodes))];
    await api('POST', `/api/labour/${matterId}/issues`, { approved: issueCodes, dismissed: [] });
    const deadlines = (intakeRes.deadlines ?? []) as Array<{ label: string; date: string }>;

    patternNotes.push(
      `### ${pattern.key} — ${pattern.title}\n` +
      `Triggered gates: ${triggered.map(g => g.gate).join(', ') || 'none'}\n` +
      `Approved issue codes: ${issueCodes.join(', ') || 'none'}\n` +
      `Deadlines: ${deadlines.map(d => `${d.label} → ${d.date}`).join('; ') || 'none'}`,
    );
    console.log(`   gates: ${triggered.map(g => g.gate).join(', ')} (${issueCodes.length} issue codes approved)`);

    // 3. Generate documents (budget-guarded)
    for (const docType of pattern.documents) {
      const reserve = RESERVE[docType] ?? 1.0;
      if (spentUsd + reserve > BUDGET_USD) {
        console.log(`   ⚠ SKIP ${docType} — budget guard ($${spentUsd.toFixed(2)} spent, $${reserve} reserve would exceed $${BUDGET_USD})`);
        results.push({ pattern: pattern.key, doc: docType, ok: false, costUsd: 0, htmlLength: 0, checks: {}, reviewerFlags: [], canonFlags: [], error: 'skipped: budget guard' });
        continue;
      }

      process.stdout.write(`   generating ${docType}... `);
      const t0 = Date.now();
      try {
        const gen = await api('POST', `/api/labour/${matterId}/document`, {
          documentType: docType,
          ...REP,
          additionalContext: pattern.additionalContext,
        });
        const cost = Number(gen.costUsd ?? 0);
        spentUsd += cost;
        const html = String(gen.html ?? '');
        const flags = (gen.reviewerFlags ?? []) as string[];
        const canonFlags = flags.filter(f => /canon|Citation mismatch/i.test(f));

        const grievorPresent = pattern.grievorLastName === 'policy'
          ? /policy grievance/i.test(html)
          : html.includes(pattern.grievorLastName);
        const checks: Record<string, boolean> = {
          'no placeholder leakage': !PLACEHOLDER_RE.test(html),
          'no em-dashes (house style)': !html.includes('—'),
          'grievor identified': grievorPresent,
          'employer name present': html.includes(pattern.employerFirstWord),
          [`substantive length (>${MIN_LENGTH[docType]} chars)`]: html.length > (MIN_LENGTH[docType] ?? 800),
          'reviewer flags present': flags.length > 0,
        };

        const file = `${pattern.key}-${docType}.html`;
        fs.writeFileSync(path.join(outDir, file), html);
        results.push({ pattern: pattern.key, doc: docType, ok: Object.values(checks).every(Boolean), costUsd: cost, htmlLength: html.length, checks, reviewerFlags: flags, canonFlags, file });
        console.log(`$${cost.toFixed(2)}, ${(Date.now() - t0) / 1000 | 0}s, ${html.length} chars, ${canonFlags.length} canon flag(s) — total $${spentUsd.toFixed(2)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${msg}`);
        results.push({ pattern: pattern.key, doc: docType, ok: false, costUsd: 0, htmlLength: 0, checks: {}, reviewerFlags: [], canonFlags: [], error: msg });
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length;
  const lines: string[] = [
    '# Starling Grievance Eval Battery Report',
    '',
    `Run: ${stamp} · Spend: $${spentUsd.toFixed(2)} of $${BUDGET_USD.toFixed(2)} cap · ${passed}/${results.length} documents passed automated checks`,
    '',
    '> Automated checks catch wiring failures (placeholder leakage, missing parties,',
    '> empty output). LEGAL QUALITY requires reviewer scoring of each HTML file —',
    '> facts accuracy, framework selection (Wm Scott / KVP / Millhaven / Parry Sound),',
    '> CA article usage, remedy breadth, and tone. A grievance filing should volunteer',
    '> NO evidence or argument; a DFR response should admit NO process gaps.',
    '',
    '## Fact patterns',
    '',
    ...patternNotes,
    '',
    '## Documents',
    '',
  ];
  for (const r of results) {
    lines.push(`### ${r.pattern} / ${r.doc} — ${r.ok ? 'PASS' : r.error ? `FAIL (${r.error})` : 'CHECK FAILURES'}`);
    if (r.file) lines.push(`File: ${r.file} · $${r.costUsd.toFixed(2)} · ${r.htmlLength} chars`);
    for (const [check, ok] of Object.entries(r.checks)) {
      lines.push(`- [${ok ? 'x' : ' '}] ${check}`);
    }
    if (r.canonFlags.length > 0) {
      lines.push('', '**Citation-canon flags (verify these):**');
      for (const f of r.canonFlags) lines.push(`- ${f}`);
    }
    if (r.reviewerFlags.length > 0) {
      lines.push('', `Reviewer flags: ${r.reviewerFlags.filter(f => !r.canonFlags.includes(f)).join('; ')}`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), lines.join('\n'));

  console.log(`\nDone. Spend $${spentUsd.toFixed(2)} · ${passed}/${results.length} passed automated checks`);
  console.log(`Report: ${path.join(outDir, 'REPORT.md')}`);
  if (passed < results.length) process.exitCode = 1;
}

main().catch(err => {
  console.error('Grievance eval battery failed:', err);
  process.exit(1);
});
