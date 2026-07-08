/**
 * Case comparables — the internal-research layer of the severance estimate.
 *
 * One corpus, two products: the DemandPay case library (Supabase
 * `legal_cases`, curated and verified by Jordan through the B2C admin UI)
 * serves Starling too. Given a matter's Bardal profile (tenure, age,
 * seniority), this module returns the closest decided Ontario cases and a
 * case-based reasonable-notice range derived from their outcomes — the
 * Fisher/ThaimisAI-style research view, grounded in real decisions rather
 * than a formula.
 *
 * Configuration (Fly secrets; absent = feature quietly off, e.g. OSS local):
 *   DEMANDPAY_CASELAW_URL  — the Supabase project URL
 *   DEMANDPAY_CASELAW_KEY  — service-role key (server-to-server only; this
 *                            code runs on the API server, never the browser)
 *
 * Matching is deterministic and explainable: weighted distance over the
 * structured Bardal columns (no embeddings needed server-side). The range is
 * the interquartile band of the k nearest outcomes — "half of the most
 * similar decided cases landed inside this band."
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('CASE-COMPARABLES');

export interface ComparableCase {
  id: string;
  caseName: string;
  citation: string;
  court: string | null;
  year: number | null;
  summary: string | null;
  yearsOfService: number | null;
  age: number | null;
  seniorityLevel: string | null;
  monthsAwarded: number | null;
  /** 0 = identical profile; larger = further away. */
  distance: number;
}

export interface CaseBasedRange {
  lowMonths: number;
  midMonths: number;
  highMonths: number;
  basedOnCases: number;
}

export function caselawConfigured(): boolean {
  return Boolean(process.env.DEMANDPAY_CASELAW_URL && process.env.DEMANDPAY_CASELAW_KEY);
}

/** Weighted Bardal distance. Pure — unit tested. */
export function bardalDistance(
  profile: { years: number; age?: number | null; seniority?: string | null },
  candidate: { years: number | null; age: number | null; seniority: string | null },
): number {
  // Tenure dominates the Bardal analysis in practice; age matters most at
  // the margins; seniority is a coarse band. Weights reflect that.
  const years = candidate.years ?? profile.years;
  let d = Math.abs(profile.years - years) * 1.0;
  if (profile.age != null && candidate.age != null) {
    d += Math.abs(profile.age - candidate.age) * 0.25;
  } else {
    d += 1.5; // unknown age = mild uncertainty penalty
  }
  if (profile.seniority && candidate.seniority) {
    if (profile.seniority !== candidate.seniority) d += 2.0;
  } else {
    d += 0.75;
  }
  return Math.round(d * 100) / 100;
}

/**
 * Interquartile band over the k nearest outcomes. Pure — unit tested.
 * Zero-month outcomes are excluded from range fuel: in a reasonable-notice
 * case a 0 award nearly always means the claim failed on a threshold issue
 * (misclassification, contract, cause), which is research-relevant but not
 * evidence of what notice is worth. Such cases stay visible in the list.
 */
export function rangeFromComparables(months: number[]): CaseBasedRange | null {
  const sorted = months.filter((m) => Number.isFinite(m) && m > 0).sort((a, b) => a - b);
  if (sorted.length < 5) return null; // too thin to call a "range"
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5))];
  return {
    lowMonths: q(0.25),
    midMonths: q(0.5),
    highMonths: q(0.75),
    basedOnCases: sorted.length,
  };
}

interface RawCase {
  id: string;
  case_name: string;
  citation: string;
  court: string | null;
  year: number | null;
  summary: string | null;
  employee_years_of_service: number | null;
  employee_age: number | null;
  seniority_level: string | null;
  severance_months_awarded: number | null;
}

/**
 * Fetch comparables + case-based range for a Bardal profile.
 * Returns nulls when unconfigured or on failure — the caller renders the
 * formula estimate alone, never an error.
 */
export async function findComparables(
  profile: { years: number; age?: number | null; seniority?: string | null },
  topN = 8,
): Promise<{ comparables: ComparableCase[]; range: CaseBasedRange | null } | null> {
  if (!caselawConfigured()) return null;
  const base = process.env.DEMANDPAY_CASELAW_URL!.replace(/\/$/, '');
  const key = process.env.DEMANDPAY_CASELAW_KEY!;

  try {
    const params = new URLSearchParams({
      select: 'id,case_name,citation,court,year,summary,employee_years_of_service,employee_age,seniority_level,severance_months_awarded',
      citation_categories: 'cs.{reasonable_notice}',
      employee_years_of_service: 'not.is.null',
      severance_months_awarded: 'not.is.null',
      verified: 'is.true',
      is_active: 'is.true',
      limit: '500',
    });
    const res = await fetch(`${base}/rest/v1/legal_cases?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn('Case library query failed', { status: res.status });
      return null;
    }
    const rows = await res.json() as RawCase[];

    const scored: ComparableCase[] = rows.map((r) => ({
      id: r.id,
      caseName: r.case_name,
      citation: r.citation,
      court: r.court,
      year: r.year,
      summary: r.summary,
      yearsOfService: r.employee_years_of_service,
      age: r.employee_age,
      seniorityLevel: r.seniority_level,
      monthsAwarded: r.severance_months_awarded,
      distance: bardalDistance(profile, {
        years: r.employee_years_of_service,
        age: r.employee_age,
        seniority: r.seniority_level,
      }),
    })).sort((a, b) => a.distance - b.distance);

    const nearest = scored.slice(0, Math.max(topN, 12));
    const range = rangeFromComparables(nearest.map((c) => c.monthsAwarded ?? NaN));

    return { comparables: scored.slice(0, topN), range };
  } catch (err) {
    logger.warn('Case comparables unavailable', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
