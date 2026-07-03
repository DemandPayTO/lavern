/**
 * Eval Battery — runs real Ontario employment fact patterns through the
 * full Starling pipeline (matter → intake → 16-gate analysis → document
 * generation) against a LOCAL server, and scores the outputs.
 *
 * Usage:
 *   npm run serve            # in one terminal (LOCAL mode, port 3000)
 *   npx tsx scripts/eval-battery.ts [--budget 12]
 *
 * Budget: HARD CAP on API spend (default $12). Every generation's actual
 * costUsd is tallied; the battery stops before any call that could
 * plausibly exceed the cap (reserve = $1.50/generation).
 *
 * Outputs: eval-results/<timestamp>/
 *   - <pattern>-<doc>.html        generated documents
 *   - REPORT.md                   pass/fail checks, flags, costs
 *
 * Automated checks per document:
 *   - no anonymisation placeholder leakage ([PARTY_1], [SIN_1], ...)
 *   - client + employer names present (de-anonymisation worked)
 *   - substantive length (> 2,000 chars)
 *   - citation-canon flags surfaced (counted, not failed — lawyer reviews)
 *   - lawyer review flags present
 * The REPORT is the artifact Jordan (as the lawyer) scores by hand.
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const budgetArg = process.argv.indexOf('--budget');
const BUDGET_USD = budgetArg > -1 ? parseFloat(process.argv[budgetArg + 1]) : 12;
const RESERVE_PER_GEN = 1.5;

let spentUsd = 0;

// ── Fact patterns ────────────────────────────────────────────────────────

interface Pattern {
  key: string;
  title: string;
  intake: Record<string, unknown>;
  clientName: string;
  employerName: string;
  documents: Array<
    | { kind: 'demand'; body: Record<string, unknown> }
    | { kind: 'soc'; body: Record<string, unknown> }
    | { kind: 'application'; body: Record<string, unknown> }
    | { kind: 'litigation'; body: Record<string, unknown> }
  >;
}

const LAWYER = { lawyerName: 'Jordan Whitfield', firmName: 'Whitfield Employment Law' };

const PATTERNS: Pattern[] = [
  {
    key: 'p1-wrongful',
    title: 'Standard wrongful dismissal — long service, ESA-minimums clause',
    clientName: 'Marcus Webb',
    employerName: 'Cadence Manufacturing Ltd',
    intake: {
      client_first_name: 'Marcus', client_last_name: 'Webb',
      client_age: 54,
      employer_legal_name: 'Cadence Manufacturing Ltd',
      job_title: 'Plant Operations Manager',
      hire_date: '2011-04-11', termination_date: '2026-05-15',
      annual_salary: 128000, has_bonus: true, bonus_amount: 15000,
      was_terminated: true,
      termination_reasons_provided: true, termination_reasons: 'restructuring',
      termination_clause_exists: true,
      termination_clause_text: 'The Company may terminate your employment at any time without cause upon providing you with the minimum notice or pay in lieu required by the Employment Standards Act, 2000, and nothing more.',
      received_severance_offer: true, severance_weeks_offered: 15,
    },
    documents: [
      { kind: 'demand', body: { tone: 'firm', demandAmount: 190000, responseDeadlineDays: 14, ...LAWYER } },
      { kind: 'soc', body: { procedureType: 'simplified', claimAmount: 190000, courtLocation: 'Toronto', ...LAWYER } },
      { kind: 'litigation', body: { documentType: 'mediation_brief', claimAmount: 190000, courtLocation: 'Toronto', ...LAWYER } },
    ],
  },
  {
    key: 'p2-constructive-hr',
    title: 'Constructive dismissal + disability discrimination overlay',
    clientName: 'Aisha Osei',
    employerName: 'Brightpath Financial Group Inc',
    intake: {
      client_first_name: 'Aisha', client_last_name: 'Osei',
      client_age: 41,
      employer_legal_name: 'Brightpath Financial Group Inc',
      job_title: 'Senior Client Advisor',
      hire_date: '2019-09-03', termination_date: '2026-04-20',
      annual_salary: 92000, has_commissions: true, commission_amount: 22000,
      was_terminated: false, resigned: true,
      is_constructive_dismissal: true,
      constructive_dismissal_grounds: ['cd_duties', 'cd_pay'],
      constructive_dismissal_details: 'After returning from medical leave, client was moved to a junior desk, lost her book of clients, and her commission structure was cut roughly in half.',
      believes_discriminatory_termination: true,
      discrimination_grounds: ['disability'],
      discrimination_details: 'Adverse treatment began two weeks after disclosing an anxiety disorder and requesting a gradual return-to-work schedule.',
      has_known_medical_condition: true, was_on_medical_leave: true,
      accommodation_requested: true, accommodation_denied: true,
      accommodation_details: 'Written request for a four-day week during the first month back; denied by email without discussion.',
    },
    documents: [
      { kind: 'demand', body: { tone: 'professional', demandAmount: 120000, responseDeadlineDays: 14, ...LAWYER } },
      { kind: 'application', body: { applicationType: 'hrto_application', claimAmount: 120000, ...LAWYER } },
    ],
  },
  {
    key: 'p3-short-service',
    title: 'Short service, modest claim — ESA baseline + common law',
    clientName: 'Devon Tran',
    employerName: 'Orchard Lane Bistro Ltd',
    intake: {
      client_first_name: 'Devon', client_last_name: 'Tran',
      client_age: 29,
      employer_legal_name: 'Orchard Lane Bistro Ltd',
      job_title: 'Assistant Manager',
      hire_date: '2024-11-04', termination_date: '2026-06-12',
      annual_salary: 52000,
      was_terminated: true,
      termination_reasons_provided: false,
      termination_clause_exists: false,
    },
    documents: [
      { kind: 'demand', body: { tone: 'professional', demandAmount: 18000, responseDeadlineDays: 14, ...LAWYER } },
    ],
  },
  {
    key: 'p4-just-cause',
    title: 'Just cause alleged — McKinley proportionality, long service',
    clientName: 'Helena Kovacs',
    employerName: 'Stellar Freight Systems Inc',
    intake: {
      client_first_name: 'Helena', client_last_name: 'Kovacs',
      client_age: 58,
      employer_legal_name: 'Stellar Freight Systems Inc',
      job_title: 'Director of Dispatch',
      hire_date: '2007-02-19', termination_date: '2026-03-30',
      annual_salary: 143000, has_pension: true, has_health_benefits: true,
      was_terminated: true,
      employer_alleged_just_cause: true,
      cause_allegations: 'A single expense-report error of $340, self-reported and repaid; no prior discipline in 19 years.',
      termination_clause_exists: false,
      humiliating_termination: true,
      humiliating_termination_details: 'Escorted from the building in front of her team; internal email announced she was terminated "for cause" the same afternoon.',
    },
    documents: [
      { kind: 'soc', body: { procedureType: 'ordinary', claimAmount: 320000, courtLocation: 'Toronto', ...LAWYER } },
    ],
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

// Anonymisation placeholders are upper-case with a numeric index
// ([PARTY_1], [SIN_2]) — matching that exact shape avoids false positives
// on the model's legitimate fill-ins like "[Address]" in signature blocks
// (those are surfaced separately as lawyer review flags).
const PLACEHOLDER_RE = /\[[A-Z]+_\d+\]/;

interface DocResult {
  pattern: string;
  doc: string;
  ok: boolean;
  costUsd: number;
  htmlLength: number;
  checks: Record<string, boolean>;
  reviewFlags: string[];
  canonFlags: string[];
  citations: number;
  error?: string;
  file?: string;
}

function docEndpoint(matterId: string, kind: string): string {
  switch (kind) {
    case 'demand': return `/api/employment/${matterId}/demand-letter`;
    case 'soc': return `/api/employment/${matterId}/statement-of-claim`;
    case 'application': return `/api/employment/${matterId}/application`;
    case 'litigation': return `/api/employment/${matterId}/litigation-document`;
    default: throw new Error(`unknown doc kind ${kind}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join('eval-results', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const results: DocResult[] = [];
  const patternNotes: string[] = [];

  console.log(`Eval battery — budget cap $${BUDGET_USD.toFixed(2)}, output ${outDir}\n`);

  for (const pattern of PATTERNS) {
    console.log(`── ${pattern.key}: ${pattern.title}`);

    // 1. Create matter
    const matter = await api('POST', '/api/matters', {
      clientName: pattern.clientName,
      matterTitle: `${pattern.clientName} v. ${pattern.employerName}`,
      matterDescription: `[EVAL] ${pattern.title}`,
      matterType: 'employment_agreement',
      jurisdiction: 'CA',
    });
    const matterId = matter.matterId as string;

    // 2. Intake + analysis (deterministic, no API cost)
    await api('POST', '/api/employment/intake', { matterId, intake: pattern.intake });
    const analysis = await api('POST', '/api/employment/analyze', { matterId });
    const gates = ((analysis.analysis as Record<string, unknown>)?.gates ?? []) as Array<{ gate: string; triggered: boolean; issueCodes: string[] }>;
    const triggered = gates.filter(g => g.triggered);
    const issueCodes = [...new Set(triggered.flatMap(g => g.issueCodes))];
    await api('POST', `/api/employment/${matterId}/issues`, { approved: issueCodes, dismissed: [] });

    patternNotes.push(
      `### ${pattern.key} — ${pattern.title}\n` +
      `Triggered gates: ${triggered.map(g => g.gate).join(', ') || 'none'}\n` +
      `Approved issue codes: ${issueCodes.join(', ') || 'none'}`,
    );
    console.log(`   gates: ${triggered.map(g => g.gate).join(', ')} (${issueCodes.length} issue codes approved)`);

    // 3. Generate documents (budget-guarded)
    for (const doc of pattern.documents) {
      if (spentUsd + RESERVE_PER_GEN > BUDGET_USD) {
        console.log(`   ⚠ SKIP ${doc.kind} — budget guard ($${spentUsd.toFixed(2)} spent, $${RESERVE_PER_GEN} reserve would exceed $${BUDGET_USD})`);
        results.push({ pattern: pattern.key, doc: doc.kind, ok: false, costUsd: 0, htmlLength: 0, checks: {}, reviewFlags: [], canonFlags: [], citations: 0, error: 'skipped: budget guard' });
        continue;
      }

      const label = doc.kind === 'application' ? String((doc.body as { applicationType?: string }).applicationType) : doc.kind === 'litigation' ? String((doc.body as { documentType?: string }).documentType) : doc.kind;
      process.stdout.write(`   generating ${label}... `);
      const t0 = Date.now();
      try {
        const gen = await api('POST', docEndpoint(matterId, doc.kind), doc.body);
        const cost = Number(gen.costUsd ?? 0);
        spentUsd += cost;
        const html = String(gen.html ?? '');
        const flags = (gen.lawyerReviewFlags ?? []) as string[];
        const canonFlags = flags.filter(f => /canon|Citation mismatch/i.test(f));
        const citations = Array.isArray(gen.citations) ? gen.citations.length : 0;

        const checks: Record<string, boolean> = {
          'no placeholder leakage': !PLACEHOLDER_RE.test(html),
          'no em-dashes (house style)': !html.includes('—'),
          'client name present': html.includes(pattern.intake.client_last_name as string),
          'employer name present': html.includes(pattern.employerName.split(' ')[0]),
          'substantive length (>2k chars)': html.length > 2000,
          'review flags present': flags.length > 0,
        };

        const file = `${pattern.key}-${label}.html`;
        fs.writeFileSync(path.join(outDir, file), html);
        results.push({ pattern: pattern.key, doc: label, ok: Object.values(checks).every(Boolean), costUsd: cost, htmlLength: html.length, checks, reviewFlags: flags, canonFlags, citations, file });
        console.log(`$${cost.toFixed(2)}, ${(Date.now() - t0) / 1000 | 0}s, ${html.length} chars, ${canonFlags.length} canon flag(s) — total $${spentUsd.toFixed(2)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${msg}`);
        results.push({ pattern: pattern.key, doc: label, ok: false, costUsd: 0, htmlLength: 0, checks: {}, reviewFlags: [], canonFlags: [], citations: 0, error: msg });
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length;
  const lines: string[] = [
    '# Starling Eval Battery Report',
    '',
    `Run: ${stamp} · Spend: $${spentUsd.toFixed(2)} of $${BUDGET_USD.toFixed(2)} cap · ${passed}/${results.length} documents passed automated checks`,
    '',
    '> Automated checks catch wiring failures (placeholder leakage, missing parties,',
    '> empty output). LEGAL QUALITY requires lawyer review of each HTML file below —',
    '> score facts accuracy, entitlement math, citation correctness, and tone.',
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
    if (r.file) lines.push(`File: ${r.file} · $${r.costUsd.toFixed(2)} · ${r.htmlLength} chars · ${r.citations} citations`);
    for (const [check, ok] of Object.entries(r.checks)) {
      lines.push(`- [${ok ? 'x' : ' '}] ${check}`);
    }
    if (r.canonFlags.length > 0) {
      lines.push('', '**Citation-canon flags (verify these):**');
      for (const f of r.canonFlags) lines.push(`- ${f}`);
    }
    if (r.reviewFlags.length > 0) {
      lines.push('', `Review flags: ${r.reviewFlags.filter(f => !r.canonFlags.includes(f)).join('; ')}`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), lines.join('\n'));

  console.log(`\nDone. Spend $${spentUsd.toFixed(2)} · ${passed}/${results.length} passed automated checks`);
  console.log(`Report: ${path.join(outDir, 'REPORT.md')}`);
  if (passed < results.length) process.exitCode = 1;
}

main().catch(err => {
  console.error('Eval battery failed:', err);
  process.exit(1);
});
