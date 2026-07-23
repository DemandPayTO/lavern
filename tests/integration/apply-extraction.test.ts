/**
 * Integration Tests — the extraction apply loop end to end
 * (docs/specs/document-extraction-apply-2026-07.md, Phase 1).
 *
 * Pins the properties that make the loop safe:
 *   - the lawyer's selections are the only thing that changes the intake
 *     (blanks fill, non-blank needs per-field overwrite)
 *   - downstream surfaces update through the shared recompute (timeline
 *     gains the limitation clock; the consequence diff reports it)
 *   - the audit event and the staleness stamp land on the matter
 *   - lawyer-entered timeline events SURVIVE the apply (the wipe fix)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, saveMatter, getMatterById } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';

let app: FastifyInstance;
const USER = 'local-user';
const MID = 'm-apply-1';

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

function readMatter() {
  const row = getMatterById(MID, USER)!;
  const matter = JSON.parse(row.data_json) as Record<string, unknown>;
  return matter.employmentData as {
    intake: Record<string, unknown>;
    timeline: Array<{ date: string; label: string; source: string }>;
    intakeRevisedAt?: string;
    documentExtractions: Array<Record<string, unknown>>;
  };
}

beforeAll(async () => {
  initDatabase(':memory:');
  app = Fastify({ logger: false });
  registerEmploymentIntakeRoutes(app);
  await app.ready();

  // A matter with an intake (no termination date yet), a lawyer-entered
  // court date, and a stored extraction from a termination letter.
  saveMatter(USER, MID, JSON.stringify({
    title: MID,
    employmentData: {
      intake: {
        client_first_name: 'Ana', client_last_name: 'Reyes',
        employer_legal_name: 'Beta Inc', annual_salary: 90000, was_terminated: true,
      },
      timeline: [
        { date: '2026-11-02', label: 'Settlement conference', category: 'legal', source: 'lawyer_entry', courtDeadline: true },
      ],
      gates: [], approvedIssues: [], dismissedIssues: [],
      documentExtractions: [{
        id: 'ext-t1', documentType: 'termination_letter', filename: 'letter.pdf',
        extractedFields: {
          termination_date: { value: '2026-05-15', confidence: 'high', sourceQuote: 'terminate effective May 15, 2026', verified: true },
          annual_salary: { value: 105000, confidence: 'medium' },
          severance_weeks_offered: { value: 8, confidence: 'high' },
        },
        keyFindings: [], confirmed: false,
      }, {
        id: 'ext-ca', documentType: 'collective_agreement', filename: 'ca.pdf',
        extractedFields: { termination_date: { value: '2026-01-01', confidence: 'high' } },
        keyFindings: [], confirmed: false,
      }],
      analysis: null,
    },
  }), 'active');
});

afterAll(async () => {
  await app.close();
});

describe('POST /:matterId/apply-extraction', () => {
  it('applies selected blanks, keeps unselected and non-overwritten values, stamps and audits', async () => {
    const { status, body } = await post(`/api/employment/${MID}/apply-extraction`, {
      extractionId: 'ext-t1',
      fields: ['termination_date', 'annual_salary', 'severance_weeks_offered'],
      overwrite: [], // salary NOT opted in
    });
    expect(status).toBe(200);
    expect(body.applied).toEqual(['termination_date', 'severance_weeks_offered']);
    expect(body.skippedNotBlank).toEqual(['annual_salary']);
    expect(body.analysisStale).toBe(true);

    const emp = readMatter();
    expect(emp.intake.termination_date).toBe('2026-05-15');
    expect(emp.intake.annual_salary).toBe(90000);              // lawyer's value kept
    expect(emp.intake.severance_weeks_offered).toBe(8);
    expect(emp.intakeRevisedAt).toBeTruthy();                  // staleness stamp

    // Downstream: the limitation clock derived from the new date...
    const labels = emp.timeline.map(e => `${e.date}|${e.label}`);
    expect(labels).toContain('2028-05-15|Limitation period expires');
    // ...the lawyer's court date SURVIVED the recompute (the wipe fix)...
    expect(labels).toContain('2026-11-02|Settlement conference');
    // ...and the audit event landed.
    expect(emp.timeline.some(e => e.source === 'document_extraction' && /Facts applied from letter\.pdf/.test(e.label))).toBe(true);

    // Consequence diff reported the new clock.
    const diff = body.timelineDiff as { added: Array<{ label: string }> };
    expect(diff.added.some(d => d.label === 'Limitation period expires')).toBe(true);

    // The extraction records what it contributed.
    const ext = emp.documentExtractions.find(e => e.id === 'ext-t1')!;
    expect(ext.appliedAt).toBeTruthy();
    expect(ext.appliedFields).toEqual(['termination_date', 'severance_weeks_offered']);
  });

  it('overwrites only with explicit per-field opt-in', async () => {
    const { status, body } = await post(`/api/employment/${MID}/apply-extraction`, {
      extractionId: 'ext-t1',
      fields: ['annual_salary'],
      overwrite: ['annual_salary'],
    });
    expect(status).toBe(200);
    expect(body.overwritten).toEqual(['annual_salary']);
    expect(readMatter().intake.annual_salary).toBe(105000);
  });

  it('rejects collective agreements (they auto-apply at extraction time)', async () => {
    const { status } = await post(`/api/employment/${MID}/apply-extraction`, {
      extractionId: 'ext-ca', fields: ['termination_date'], overwrite: [],
    });
    expect(status).toBe(400);
  });

  it('404s an unknown extraction and scopes by user', async () => {
    const { status } = await post(`/api/employment/${MID}/apply-extraction`, {
      extractionId: 'ext-nope', fields: ['termination_date'], overwrite: [],
    });
    expect(status).toBe(404);
    const other = await post('/api/employment/m-not-mine/apply-extraction', {
      extractionId: 'ext-t1', fields: ['termination_date'], overwrite: [],
    });
    expect(other.status).toBe(404);
  });
});
