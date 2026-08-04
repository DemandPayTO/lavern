/**
 * Integration Tests — precedent alignment routes.
 *
 * Upload several real DOCX precedents, get a reviewable proposal back, save
 * the reviewed result as a template variant. The properties pinned here:
 * the firm's boilerplate survives verbatim, placeholders come back named
 * from matter data where it is available, and the saved template is a real
 * DOCX carrying those placeholders.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { initDatabase, createUser, saveMatter, getFirmTemplate } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';

let app: FastifyInstance;
let userId = '';
let firmId = '';
const HEADERS: Record<string, string> = {};

const BOILERPLATE =
  'At the time of termination our client was on an approved medical leave of absence, which engages the Human Rights Code.';

async function precedentDocx(client: string, employer: string, title: string): Promise<string> {
  const lines = [
    'EVANS LAW FIRM',
    'WITHOUT PREJUDICE',
    `We are counsel to ${client}. Our client was employed by ${employer} as a ${title}.`,
    BOILERPLATE,
    'Yours truly,',
  ];
  const doc = new Document({
    sections: [{ children: lines.map(l => new Paragraph({ children: [new TextRun(l)] })) }],
  });
  return (await Packer.toBuffer(doc)).toString('base64');
}

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, headers: HEADERS, payload: payload as Record<string, unknown> });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  initDatabase(':memory:');
  const user = createUser('align@evans.test', 'x', 'Jordan Haworth', 'Evans Law Firm');
  userId = user.id;
  firmId = user.firm_id!;

  app = Fastify({ logger: false });
  app.addHook('preHandler', async (req) => {
    (req as { userId?: string }).userId = userId;
    (req as { firmId?: string }).firmId = firmId;
  });
  registerEmploymentIntakeRoutes(app);
  await app.ready();

  // A matter the first precedent came from, so classification has real data.
  saveMatter(userId, 'm-align-1', JSON.stringify({
    title: 'Nunes v Halcyon',
    employmentData: {
      intake: {
        client_first_name: 'Vera', client_last_name: 'Nunes',
        employer_legal_name: 'Halcyon Retail Inc', job_title: 'Buyer',
      },
      timeline: [],
    },
  }));
});

afterAll(async () => { await app.close(); });

describe('POST /api/employment/templates/align', () => {
  it('refuses fewer than three precedents', async () => {
    const res = await post('/api/employment/templates/align', {
      documentType: 'demand_letter',
      precedents: [
        { name: 'one', docxBase64: await precedentDocx('A B', 'C Inc', 'Buyer') },
        { name: 'two', docxBase64: await precedentDocx('D E', 'F Inc', 'Manager') },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a file that is not a Word document', async () => {
    const res = await post('/api/employment/templates/align', {
      documentType: 'demand_letter',
      precedents: [
        { name: 'broken', docxBase64: Buffer.from('not a docx').toString('base64') },
        { name: 'two', docxBase64: await precedentDocx('D E', 'F Inc', 'Manager') },
        { name: 'three', docxBase64: await precedentDocx('G H', 'I Inc', 'Supervisor') },
      ],
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('broken');
  });

  it('aligns three precedents, keeping boilerplate and naming placeholders', async () => {
    const res = await post('/api/employment/templates/align', {
      documentType: 'demand_letter',
      precedents: [
        { name: 'Nunes', docxBase64: await precedentDocx('Vera Nunes', 'Halcyon Retail Inc', 'Buyer'), matterId: 'm-align-1' },
        { name: 'Vega', docxBase64: await precedentDocx('Tess Vega', 'Northwind Freight Inc', 'Manager') },
        { name: 'Diallo', docxBase64: await precedentDocx('Marcus Diallo', 'Lakeshore Foundry Inc', 'Supervisor') },
      ],
    });
    expect(res.status).toBe(200);
    const alignment = res.body.alignment as {
      lines: Array<{ skeleton: string; stable: boolean }>;
      slots: Array<{ id: string; observedValues: string[]; suggestedPlaceholder: string | null }>;
    };

    // The firm's legal sentence is held whole.
    expect(alignment.lines.filter(l => l.stable).map(l => l.skeleton)).toContain(BOILERPLATE);

    // Each variable is its own slot with one value per precedent.
    expect(alignment.slots.length).toBeGreaterThanOrEqual(3);
    for (const slot of alignment.slots) expect(slot.observedValues).toHaveLength(3);

    const clientSlot = alignment.slots.find(s => s.observedValues.some(v => v.includes('Vera Nunes')));
    expect(clientSlot?.suggestedPlaceholder).toBe('CLIENT_NAME');
  });
});

describe('POST /api/employment/templates/align/save', () => {
  it('saves the reviewed alignment as a template variant', async () => {
    const aligned = await post('/api/employment/templates/align', {
      documentType: 'demand_letter',
      precedents: [
        { name: 'Nunes', docxBase64: await precedentDocx('Vera Nunes', 'Halcyon Retail Inc', 'Buyer'), matterId: 'm-align-1' },
        { name: 'Vega', docxBase64: await precedentDocx('Tess Vega', 'Northwind Freight Inc', 'Manager') },
        { name: 'Diallo', docxBase64: await precedentDocx('Marcus Diallo', 'Lakeshore Foundry Inc', 'Supervisor') },
      ],
    });
    const alignment = aligned.body.alignment as { slots: Array<{ id: string; suggestedPlaceholder: string | null }> };
    const decisions = Object.fromEntries(alignment.slots.map(s => [s.id, s.suggestedPlaceholder]));

    const saved = await post('/api/employment/templates/align/save', {
      documentType: 'demand_letter',
      variantLabel: 'Medical leave',
      alignment: aligned.body.alignment,
      decisions,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.variantLabel).toBe('Medical leave');
    expect(saved.body.placeholders as string[]).toContain('CLIENT_NAME');

    // It is stored as a real DOCX carrying the firm's words and the markers.
    const stored = getFirmTemplate(firmId, 'demand_letter', saved.body.variantId as string);
    expect(stored).toBeDefined();
    const buffer = Buffer.from(stored!.template_b64, 'base64');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
    const text = xml.replace(/<[^>]+>/g, '');
    expect(text).toContain('WITHOUT PREJUDICE');
    expect(text).toContain('{{CLIENT_NAME}}');
    // One case's facts must not be baked into the firm's template.
    expect(text).not.toContain('Vera Nunes');
  });
});
