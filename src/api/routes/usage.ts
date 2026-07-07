/**
 * Usage routes — the usage-based pricing foundation.
 *
 * The ledger (usage_events) records every generation with its LLM cost.
 * These routes turn it into a monthly rollup and an invoice-ready CSV.
 * Pricing knobs live in config.starling.pricing (env-driven, CAD):
 *   STARLING_PRICE_PER_GENERATION_CAD      — per generated document
 *   STARLING_PRICE_PER_MATTER_MONTHLY_CAD  — per matter with activity that month
 * Zero (the default) means "not priced": the summary reports counts and raw
 * LLM cost only, which is the decision-support Jordan needs to set prices.
 *
 *   GET /api/usage/summary?month=YYYY-MM          JSON rollup
 *   GET /api/usage/summary?month=YYYY-MM&format=csv  invoice-ready CSV
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUsageSummary, getMattersByUser } from '../../db/database.js';
import { config } from '../../config.js';

interface MatterRollup {
  matterId: string;
  matterLabel: string;
  generations: number;
  llmCostUsd: number;
  billableCad: number;
}

function matterLabelMap(userId: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of getMattersByUser(userId)) {
    try {
      const matter = JSON.parse(row.data_json) as Record<string, unknown>;
      const intake = ((matter.employmentData ?? matter.labourData) as { intake?: Record<string, unknown> } | undefined)?.intake;
      const client = [intake?.client_first_name, intake?.client_last_name].filter(Boolean).join(' ');
      const employer = String(intake?.employer_legal_name ?? intake?.employer_operating_name ?? '');
      map.set(row.id, client && employer ? `${client} v ${employer}` : client || employer || String(matter.title ?? row.id));
    } catch {
      map.set(row.id, row.id);
    }
  }
  return map;
}

function buildRollup(userId: string, month: string): {
  month: string;
  pricing: { perGenerationCad: number; perActiveMatterMonthlyCad: number };
  byMatter: MatterRollup[];
  totals: { generations: number; activeMatters: number; llmCostUsd: number; billableCad: number };
} {
  const pricing = config.starling.pricing;
  const rows = getUsageSummary(userId, month);
  const labels = matterLabelMap(userId);

  const byMatterMap = new Map<string, MatterRollup>();
  for (const r of rows) {
    const entry = byMatterMap.get(r.matter_id) ?? {
      matterId: r.matter_id,
      matterLabel: labels.get(r.matter_id) ?? r.matter_id,
      generations: 0,
      llmCostUsd: 0,
      billableCad: 0,
    };
    if (r.kind === 'generation') entry.generations += r.events;
    entry.llmCostUsd += r.cost_usd;
    byMatterMap.set(r.matter_id, entry);
  }

  const byMatter = [...byMatterMap.values()].map((m) => ({
    ...m,
    llmCostUsd: Math.round(m.llmCostUsd * 100) / 100,
    billableCad: Math.round(
      (m.generations * pricing.perGenerationCad + pricing.perActiveMatterMonthlyCad) * 100,
    ) / 100,
  })).sort((a, b) => b.billableCad - a.billableCad || b.generations - a.generations);

  const totals = byMatter.reduce(
    (acc, m) => ({
      generations: acc.generations + m.generations,
      activeMatters: acc.activeMatters + 1,
      llmCostUsd: Math.round((acc.llmCostUsd + m.llmCostUsd) * 100) / 100,
      billableCad: Math.round((acc.billableCad + m.billableCad) * 100) / 100,
    }),
    { generations: 0, activeMatters: 0, llmCostUsd: 0, billableCad: 0 },
  );

  return { month, pricing, byMatter, totals };
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function registerUsageRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/usage/summary', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const q = req.query as { month?: string; format?: string };
    const month = /^\d{4}-\d{2}$/.test(q.month ?? '') ? q.month! : new Date().toISOString().slice(0, 7);

    const rollup = buildRollup(userId, month);

    if (q.format === 'csv') {
      const lines = [
        'matter,generations,llm_cost_usd,billable_cad',
        ...rollup.byMatter.map((m) =>
          [csvEscape(m.matterLabel), m.generations, m.llmCostUsd.toFixed(2), m.billableCad.toFixed(2)].join(','),
        ),
        ['TOTAL', rollup.totals.generations, rollup.totals.llmCostUsd.toFixed(2), rollup.totals.billableCad.toFixed(2)].join(','),
      ];
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="starling-usage-${month}.csv"`)
        .send(lines.join('\n') + '\n');
    }

    return reply.send({ ok: true, ...rollup });
  });
}
