/**
 * Integration Tests — intake editing and document lifecycle states,
 * via Fastify inject() over an in-memory database.
 *
 * Pins the two behaviours that make the docket honest:
 *   1. Editing the intake recomputes figures and clocks while preserving
 *      the lawyer's issue approvals.
 *   2. Lifecycle transitions (draft → reviewed → sent/filed) persist with
 *      history, and marking a demand letter sent moves the response
 *      tickler to run from the date of sending.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, saveMatter, getMatterById } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';
import { registerLabourRoutes } from '../../src/api/routes/labour.js';

let app: FastifyInstance;
const USER = 'local-user';

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}
async function get(url: string) {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

function makeMatter(id: string, extra: Record<string, unknown> = {}) {
  saveMatter(USER, id, JSON.stringify({ title: id, ...extra }), 'active');
}

beforeAll(async () => {
  initDatabase(':memory:');
  app = Fastify({ logger: false });
  registerEmploymentIntakeRoutes(app);
  registerLabourRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('intake editing', () => {
  it('recomputes figures and clocks on edit while preserving approvals', async () => {
    makeMatter('m-edit');
    const intakeV1 = {
      client_first_name: 'Rae', client_last_name: 'Sung', client_age: 50,
      employer_legal_name: 'Vantage Logistics Inc', job_title: 'Manager',
      hire_date: '2015-01-05', termination_date: '2026-06-01',
      annual_salary: 100000, was_terminated: true,
    };
    await post('/api/employment/intake', { matterId: 'm-edit', intake: intakeV1 });
    const a1 = await post('/api/employment/analyze', { matterId: 'm-edit' });
    const codes = (a1.body.analysis as Record<string, unknown>).gates as Array<{ triggered: boolean; issueCodes: string[] }>;
    const approved = [...new Set(codes.filter(g => g.triggered).flatMap(g => g.issueCodes))];
    await post('/api/employment/m-edit/issues', { approved, dismissed: [] });

    // Edit: salary correction and a discrimination dimension
    const intakeV2 = { ...intakeV1, annual_salary: 150000, believes_discriminatory_termination: true };
    const save = await post('/api/employment/intake', { matterId: 'm-edit', intake: intakeV2 });
    expect(save.status).toBe(200);
    const a2 = await post('/api/employment/analyze', { matterId: 'm-edit' });

    const d1 = (a1.body.analysis as Record<string, { esaNoticePay: number }>).damagesEstimate;
    const d2 = (a2.body.analysis as Record<string, { esaNoticePay: number }>).damagesEstimate;
    expect(d2.esaNoticePay).toBeGreaterThan(d1.esaNoticePay);

    const after = await get('/api/employment/m-edit');
    const data = after.body.data as { approvedIssues: string[]; timeline: Array<{ label: string }> };
    expect(data.approvedIssues).toEqual(approved);
    expect(data.timeline.some(e => e.label.includes('HRTO'))).toBe(true);
  });

  it('labour intake edits preserve approvals and recompute the clocks', async () => {
    makeMatter('m-lab');
    const intake = {
      grievor_first_name: 'Tess', grievor_last_name: 'Okoye',
      employer_name: 'Harbour Foods', union_name: 'UFCW 175',
      grievance_type: 'discharge', discipline_imposed: 'discharge',
      incident_date: '2026-07-01', filing_deadline_days: 10, filing_deadline_kind: 'calendar',
      grievance_filed: false,
    };
    const r1 = await post('/api/labour/intake', { matterId: 'm-lab', intake });
    const codes = [...new Set((r1.body.gates as Array<{ triggered: boolean; issueCodes: string[] }>).filter(g => g.triggered).flatMap(g => g.issueCodes))];
    await post('/api/labour/m-lab/issues', { approved: codes, dismissed: [] });

    const r2 = await post('/api/labour/intake', { matterId: 'm-lab', intake: { ...intake, filing_deadline_days: 20 } });
    expect(r2.status).toBe(200);
    const deadlines = r2.body.deadlines as Array<{ label: string }>;
    expect(deadlines[0].label).toContain('20 calendar days');

    const after = await get('/api/labour/m-lab');
    expect((after.body.data as { approvedIssues: string[] }).approvedIssues).toEqual(codes);
  });
});

describe('document lifecycle', () => {
  it('summarises generated documents across legacy and pattern keys', async () => {
    makeMatter('m-docs', {
      generatedDemandLetter: { html: '<p>x</p>', generatedAt: '2026-07-01T10:00:00Z', costUsd: 0.4, status: 'draft' },
      generated_mitigation_log: { html: '<p>y</p>', documentTitle: 'Mitigation Log (Client Job-Search Record)', generatedAt: '2026-07-02T10:00:00Z', costUsd: 0, status: 'draft' },
    });
    const res = await get('/api/employment/m-docs');
    const docs = res.body.generatedDocuments as Array<{ docType: string; title: string; status: string }>;
    expect(docs).toHaveLength(2);
    expect(docs[0].docType).toBe('mitigation_log'); // newest first
    expect(docs[1].docType).toBe('demand_letter');
    expect(docs[1].title).toBe('Demand Letter');
    expect(docs.every(d => d.status === 'draft')).toBe(true);
  });

  it('advances status with history and rejects unknown documents', async () => {
    makeMatter('m-status', {
      generated_mitigation_log: { html: '<p>y</p>', generatedAt: '2026-07-02T10:00:00Z', costUsd: 0, status: 'draft' },
    });
    const r1 = await post('/api/employment/m-status/document-status', { docType: 'mitigation_log', status: 'reviewed' });
    expect(r1.status).toBe(200);
    const r2 = await post('/api/employment/m-status/document-status', { docType: 'mitigation_log', status: 'sent', date: '2026-07-04' });
    expect(r2.status).toBe(200);
    const docs = r2.body.generatedDocuments as Array<{ docType: string; status: string; statusDate: string | null }>;
    expect(docs[0].status).toBe('sent');
    expect(docs[0].statusDate).toBe('2026-07-04');

    const row = await getMatterById('m-status', USER);
    const matter = JSON.parse(row!.data_json) as Record<string, Record<string, unknown>>;
    const history = matter.generated_mitigation_log.statusHistory as Array<{ status: string; date: string }>;
    expect(history.map(h => h.status)).toEqual(['reviewed', 'sent']);

    const missing = await post('/api/employment/m-status/document-status', { docType: 'sj_factum', status: 'reviewed' });
    expect(missing.status).toBe(404);
    const invalid = await post('/api/employment/m-status/document-status', { docType: 'mitigation_log', status: 'shredded' });
    expect(invalid.status).toBe(400);
  });

  it('serving the Statement of Claim starts the defence clock; issuing a Notice of Action starts the Form 14D clock', async () => {
    makeMatter('m-chain', {
      generatedSOC: { html: '<p>x</p>', generatedAt: '2026-07-01T10:00:00Z', costUsd: 0.5, status: 'reviewed' },
      generated_notice_of_action: { html: '<p>y</p>', generatedAt: '2026-07-01T09:00:00Z', costUsd: 0.1, status: 'reviewed' },
      employmentData: {
        intake: { client_first_name: 'Rae', client_last_name: 'Sung' },
        gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [],
        timeline: [], analysis: null,
        selectedTone: 'professional', selectedProcedure: null, selectedDocumentType: null, demandAmount: null,
      },
    });

    await post('/api/employment/m-chain/document-status', { docType: 'statement_of_claim', status: 'sent', date: '2026-07-10' });
    await post('/api/employment/m-chain/document-status', { docType: 'notice_of_action', status: 'filed', date: '2026-07-05' });

    const after = await get('/api/employment/m-chain');
    const timeline = (after.body.data as { timeline: Array<{ date: string; label: string }> }).timeline;
    const defence = timeline.find(e => e.label === 'Statement of Defence due');
    expect(defence?.date).toBe('2026-07-30'); // served 07-10 + 20 days
    const form14d = timeline.find(e => e.label.includes('Form 14D'));
    expect(form14d?.date).toBe('2026-08-04'); // issued 07-05 + 30 days
  });

  it('exports the docket as an iCalendar file', async () => {
    // The docket only carries deadlines inside its window (30 days overdue to
    // 180 ahead), so the fixture date must be relative to today, not a literal
    // that eventually falls out of the window.
    const deadlineIso = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const deadlineBasic = deadlineIso.replace(/-/g, '');
    makeMatter('m-ics', {
      employmentData: {
        intake: { client_first_name: 'Cal', client_last_name: 'Ito', employer_legal_name: 'Ito Employer Ltd', received_severance_offer: true, severance_deadline: deadlineIso },
        gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [],
        timeline: [], analysis: null,
        selectedTone: 'professional', selectedProcedure: null, selectedDocumentType: null, demandAmount: null,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/employment/deadlines.ics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.body).toContain('BEGIN:VCALENDAR');
    expect(res.body).toContain('Cal Ito v Ito Employer Ltd');
    expect(res.body).toContain(`DTSTART;VALUE=DATE:${deadlineBasic}`);
  });

  it('records an outcome with a calibration snapshot, resolves the stage, and reopens cleanly', async () => {
    makeMatter('m-outcome', {
      employmentData: {
        intake: { client_first_name: 'Rae', client_last_name: 'Sung' },
        gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [],
        timeline: [], analysis: { gates: [], damagesEstimate: { totalEstimateLow: 40000, totalEstimateHigh: 90000 } },
        selectedTone: 'professional', selectedProcedure: null, selectedDocumentType: null, demandAmount: null,
      },
    });

    const bad = await post('/api/employment/m-outcome/outcome', { resolution: 'shredded', date: '2026-07-05' });
    expect(bad.status).toBe(400);

    const r = await post('/api/employment/m-outcome/outcome', { resolution: 'settled', amount: 85000, date: '2026-07-05', notes: 'settled at mediation' });
    expect(r.status).toBe(200);
    const outcome = r.body.outcome as Record<string, unknown>;
    expect(outcome.predictedLow).toBe(40000);
    expect(outcome.predictedHigh).toBe(90000);

    const after = await get('/api/employment/m-outcome');
    expect((after.body.stage as { stage: string }).stage).toBe('resolution');
    const timeline = (after.body.data as { timeline: Array<{ label: string; description?: string }> }).timeline;
    expect(timeline.some(e => e.label === 'Matter resolved' && (e.description ?? '').includes('$85,000'))).toBe(true);

    const reopen = await app.inject({ method: 'DELETE', url: '/api/employment/m-outcome/outcome' });
    expect(reopen.statusCode).toBe(200);
    const reopened = await get('/api/employment/m-outcome');
    expect((reopened.body.stage as { stage: string }).stage).not.toBe('resolution');
    const reopenAgain = await app.inject({ method: 'DELETE', url: '/api/employment/m-outcome/outcome' });
    expect(reopenAgain.statusCode).toBe(400);
  });

  it('marking a demand letter sent moves the response tickler to the sent date', async () => {
    makeMatter('m-tickler', {
      generatedDemandLetter: {
        html: '<p>x</p>', generatedAt: '2026-07-01T10:00:00Z', costUsd: 0.4,
        status: 'draft', responseDeadlineDays: 14,
      },
      employmentData: {
        intake: { client_first_name: 'Rae', client_last_name: 'Sung' },
        gates: [], approvedIssues: [], dismissedIssues: [],
        documentExtractions: [],
        timeline: [
          { date: '2026-07-15', label: 'Demand letter response due', description: 'from generation', category: 'legal', source: 'system' },
        ],
        analysis: null,
        selectedTone: 'professional', selectedProcedure: null, selectedDocumentType: null, demandAmount: null,
      },
    });

    const res = await post('/api/employment/m-tickler/document-status', { docType: 'demand_letter', status: 'sent', date: '2026-07-10' });
    expect(res.status).toBe(200);

    const after = await get('/api/employment/m-tickler');
    const timeline = (after.body.data as { timeline: Array<{ date: string; label: string }> }).timeline;
    const ticklers = timeline.filter(e => e.label === 'Demand letter response due');
    expect(ticklers).toHaveLength(1);
    expect(ticklers[0].date).toBe('2026-07-24'); // sent 2026-07-10 + 14 days
  });
});

describe('the intake save MERGES: partial saves never erase each other', () => {
  const MID = 'm-merge-1';

  it('two section saves both survive, and the engines read the union', async () => {
    saveMatter(USER, MID, JSON.stringify({ title: MID }), 'active');
    const first = await post('/api/employment/intake', {
      matterId: MID,
      intake: { client_first_name: 'Aisha', client_last_name: 'Osei', hire_date: '2019-09-03' },
    });
    expect(first.status).toBe(200);
    const second = await post('/api/employment/intake', {
      matterId: MID,
      intake: { was_terminated: true, termination_date: '2026-04-20', separation_type: 'CONSTRUCTIVE' },
    });
    expect(second.status).toBe(200);

    const row = getMatterById(MID, USER)!;
    const intake = (JSON.parse(row.data_json).employmentData ?? {}).intake ?? {};
    // The first save's answers survived the second save.
    expect(intake.client_first_name).toBe('Aisha');
    expect(intake.hire_date).toBe('2019-09-03');
    // The second save landed too, and its derivation with it.
    expect(intake.was_terminated).toBe(true);
    expect(intake.is_constructive_dismissal).toBe(true);
  });

  it('an explicit null deletes; an absent key changes nothing', async () => {
    const res = await post('/api/employment/intake', {
      matterId: MID,
      intake: { hire_date: null },
    });
    expect(res.status).toBe(200);
    const intake = (JSON.parse(getMatterById(MID, USER)!.data_json).employmentData ?? {}).intake ?? {};
    expect('hire_date' in intake).toBe(false);
    expect(intake.client_first_name).toBe('Aisha');
  });
});

describe('a rejected save names the field and the rule', () => {
  const MID = 'm-named-400';

  it('an over-long clause paste is refused with the field, the rule, and the size', async () => {
    saveMatter(USER, MID, JSON.stringify({ title: MID }), 'active');
    const res = await post('/api/employment/intake', {
      matterId: MID,
      intake: { client_age: 62, termination_clause_text: 'x'.repeat(25_000) },
    });
    expect(res.status).toBe(400);
    const err = String(res.body.error);
    expect(err).toContain('termination_clause_text');
    expect(err).toContain('25,000 characters');
    expect(err).not.toBe('Invalid intake data');
  });

  it('a clause paste over the old 10k cap but under 20k saves, and the age with it', async () => {
    const res = await post('/api/employment/intake', {
      matterId: MID,
      intake: { client_age: 62, termination_clause_text: 'The Company may terminate. '.repeat(500) },
    });
    expect(res.status).toBe(200);
    const intake = (JSON.parse(getMatterById(MID, USER)!.data_json).employmentData ?? {}).intake ?? {};
    expect(intake.client_age).toBe(62);
    expect(String(intake.termination_clause_text).length).toBeGreaterThan(10_000);
  });
});

describe('the intake inherits the matter\'s own identity', () => {
  it('names the matter title knows never render as PLAINTIFF', async () => {
    const { loadEmploymentData } = await import('../../src/api/routes/employment-intake.js');
    const { employment } = loadEmploymentData(JSON.stringify({
      title: 'Kimberly Botsford v. Hamilton Health Sciences Corporation',
      clientId: 'Kimberly Botsford',
      employmentData: { intake: { annual_salary: 182728 }, timeline: [], gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [], analysis: null },
    }));
    const i = employment.intake as Record<string, unknown>;
    expect(i.client_first_name).toBe('Kimberly');
    expect(i.client_last_name).toBe('Botsford');
    expect(i.employer_legal_name).toBe('Hamilton Health Sciences Corporation');
  });

  it('a typed name always beats the derivation, and an opaque id derives nothing', async () => {
    const { loadEmploymentData } = await import('../../src/api/routes/employment-intake.js');
    const { employment } = loadEmploymentData(JSON.stringify({
      title: 'Osei v. Acme', clientId: 'client-8f2a1',
      employmentData: { intake: { client_first_name: 'Aisha', client_last_name: 'Osei', employer_legal_name: 'Acme Widgets Ltd' }, timeline: [], gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [], analysis: null },
    }));
    const i = employment.intake as Record<string, unknown>;
    expect(i.client_first_name).toBe('Aisha');
    expect(i.employer_legal_name).toBe('Acme Widgets Ltd');
    const { employment: e2 } = loadEmploymentData(JSON.stringify({
      title: 'No versus here', clientId: 'client-8f2a1',
      employmentData: { intake: {}, timeline: [], gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [], analysis: null },
    }));
    expect((e2.intake as Record<string, unknown>).client_first_name).toBeUndefined();
  });
});
