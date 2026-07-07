/**
 * Integration Tests — usage ledger + summary route (usage-based pricing).
 *
 * Events accumulate durably; the monthly rollup groups per matter, applies
 * the configured prices, and the CSV export is invoice-shaped.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, saveMatter, recordUsageEvent, getUsageSummary } from '../../src/db/database.js';
import { registerUsageRoutes } from '../../src/api/routes/usage.js';
import { config } from '../../src/config.js';

let app: FastifyInstance;
const USER = 'local-user';
const MONTH = new Date().toISOString().slice(0, 7);

beforeAll(async () => {
  initDatabase(':memory:');
  app = Fastify({ logger: false });
  registerUsageRoutes(app);
  await app.ready();

  saveMatter(USER, 'm-usage-1', JSON.stringify({
    title: 'm-usage-1',
    employmentData: { intake: { client_first_name: 'Ana', client_last_name: 'Reyes', employer_legal_name: 'Beta Inc' } },
  }), 'active');
  saveMatter(USER, 'm-usage-2', JSON.stringify({ title: 'Untitled matter two' }), 'active');

  recordUsageEvent(USER, 'm-usage-1', 'generation', 'demand_letter', 0.17);
  recordUsageEvent(USER, 'm-usage-1', 'generation', 'severance_assessment', 0.07);
  recordUsageEvent(USER, 'm-usage-2', 'generation', 'mitigation_log', 0);
  recordUsageEvent('someone-else', 'm-other', 'generation', 'demand_letter', 0.2);
});

afterAll(async () => {
  await app.close();
});

describe('usage ledger', () => {
  it('rolls up per matter for the month and scopes by user', () => {
    const rows = getUsageSummary(USER, MONTH);
    const matters = new Set(rows.map(r => r.matter_id));
    expect(matters).toEqual(new Set(['m-usage-1', 'm-usage-2']));
    const m1 = rows.filter(r => r.matter_id === 'm-usage-1');
    expect(m1.reduce((n, r) => n + r.events, 0)).toBe(2);
  });

  it('summary route returns labelled rollup with pricing applied', async () => {
    config.starling.pricing.perGenerationCad = 25;
    config.starling.pricing.perActiveMatterMonthlyCad = 50;
    try {
      const res = await app.inject({ method: 'GET', url: `/api/usage/summary?month=${MONTH}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        byMatter: Array<{ matterId: string; matterLabel: string; generations: number; billableCad: number }>;
        totals: { generations: number; activeMatters: number; billableCad: number; llmCostUsd: number };
      };
      const m1 = body.byMatter.find(m => m.matterId === 'm-usage-1')!;
      expect(m1.matterLabel).toBe('Ana Reyes v Beta Inc');
      expect(m1.generations).toBe(2);
      expect(m1.billableCad).toBe(2 * 25 + 50);
      expect(body.totals.generations).toBe(3);
      expect(body.totals.activeMatters).toBe(2);
      expect(body.totals.billableCad).toBe(100 + 75);
      expect(body.totals.llmCostUsd).toBeCloseTo(0.24, 2);
    } finally {
      config.starling.pricing.perGenerationCad = 0;
      config.starling.pricing.perActiveMatterMonthlyCad = 0;
    }
  });

  it('CSV export is invoice-shaped with a TOTAL row', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/usage/summary?month=${MONTH}&format=csv` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('matter,generations,llm_cost_usd,billable_cad');
    expect(lines[lines.length - 1].startsWith('TOTAL,3,')).toBe(true);
  });

  it('an empty month returns an empty rollup, not an error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/usage/summary?month=1999-01' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { byMatter: unknown[]; totals: { generations: number } };
    expect(body.byMatter).toEqual([]);
    expect(body.totals.generations).toBe(0);
  });
});
