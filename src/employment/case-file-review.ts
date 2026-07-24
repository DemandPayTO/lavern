/**
 * Case file review — cross-document aggregation for the bulk drop (Phase 3).
 *
 * Deterministic by design. After N documents have been classified and
 * extracted, this module makes sense of them WITHOUT another LLM call:
 *
 *   - Master chronology: every date-valued extracted fact across every
 *     document, each entry citing its source document(s). Proposed to the
 *     matter timeline behind the lawyer's approve gate.
 *   - Conflicts: fields where two documents disagree (or a document
 *     disagrees with the intake). Surfaced side by side with confidence
 *     and quote-verification signals; the lawyer picks. Never first-wins.
 *
 * The synthesis memo (the one LLM pass) lives in case-synthesis.ts.
 * See docs/specs/document-extraction-apply-2026-07.md (Phase 3).
 */

import { APPLYABLE_INTAKE_FIELDS } from './extraction-apply.js';
import type { DocumentExtractionResult, EmploymentIntakeData, TimelineEvent } from '../types/employment-intake.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Human labels for date-valued fields; anything unknown gets a humanized name. */
const DATE_FIELD_LABELS: Record<string, { label: string; category: TimelineEvent['category'] }> = {
  hire_date: { label: 'Hire date', category: 'employment' },
  contract_signed_date: { label: 'Employment contract signed', category: 'employment' },
  first_day_of_work: { label: 'First day of work', category: 'employment' },
  clause_signed_date: { label: 'Termination clause signed', category: 'employment' },
  acquisition_date: { label: 'Employer acquisition', category: 'employment' },
  termination_date: { label: 'Employment terminated', category: 'termination' },
  last_day_worked: { label: 'Last day worked', category: 'termination' },
  severance_deadline: { label: 'Severance offer deadline', category: 'legal' },
  new_employment_start_date: { label: 'New employment started', category: 'mitigation' },
};

function humanize(field: string): string {
  return field.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

export interface ChronologyEntry {
  date: string;
  field: string;
  label: string;
  category: TimelineEvent['category'];
  /** Documents that state this date (corroboration when > 1). */
  sources: Array<{ filename: string; extractionId: string; confidence: string; verified?: boolean }>;
  /** True when this (date, label) already exists on the matter timeline. */
  onTimeline: boolean;
}

/**
 * Build the master chronology: every ISO-dated extracted value across all
 * documents, one entry per (field, date), sources merged for corroboration.
 */
export function buildChronology(
  extractions: DocumentExtractionResult[],
  existingTimeline: TimelineEvent[] | undefined,
): ChronologyEntry[] {
  const byKey = new Map<string, ChronologyEntry>();
  extractions.forEach((ext, i) => {
    const extractionId = ext.id ?? `idx-${i}`;
    for (const [field, f] of Object.entries(ext.extractedFields)) {
      if (typeof f.value !== 'string' || !ISO_DATE.test(f.value)) continue;
      const meta = DATE_FIELD_LABELS[field] ?? { label: humanize(field), category: 'other' as const };
      const key = `${field}|${f.value}`;
      const entry = byKey.get(key) ?? {
        date: f.value, field, label: meta.label, category: meta.category, sources: [], onTimeline: false,
      };
      entry.sources.push({ filename: ext.filename, extractionId, confidence: f.confidence, verified: f.verified });
      byKey.set(key, entry);
    }
  });
  const timelineKeys = new Set((existingTimeline ?? []).map(e => `${e.date}|${e.label}`));
  const entries = [...byKey.values()];
  for (const e of entries) e.onTimeline = timelineKeys.has(`${e.date}|${e.label}`);
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  return entries;
}

export interface FieldConflict {
  field: string;
  /** What the intake holds today (null when blank). */
  current: string | number | boolean | null;
  /** The disagreeing extracted values, one per document that states one. */
  candidates: Array<{
    value: string | number | boolean;
    filename: string;
    extractionId: string;
    confidence: string;
    verified?: boolean;
  }>;
}

function normalize(v: string | number | boolean): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : String(v);
}

/**
 * Cross-document disagreements on applyable intake fields. A conflict exists
 * when documents state more than one distinct value, or when the single
 * extracted value contradicts a non-blank intake value. Agreements (all
 * sources match the intake, or state the one same value) are not conflicts.
 */
export function findConflicts(
  extractions: DocumentExtractionResult[],
  intake: EmploymentIntakeData,
): FieldConflict[] {
  const byField = new Map<string, FieldConflict['candidates']>();
  extractions.forEach((ext, i) => {
    const extractionId = ext.id ?? `idx-${i}`;
    for (const [field, f] of Object.entries(ext.extractedFields)) {
      if (!APPLYABLE_INTAKE_FIELDS.has(field)) continue;
      if (f.value === null || f.value === undefined || f.value === '') continue;
      const list = byField.get(field) ?? [];
      list.push({ value: f.value, filename: ext.filename, extractionId, confidence: f.confidence, verified: f.verified });
      byField.set(field, list);
    }
  });

  const conflicts: FieldConflict[] = [];
  const intakeRec = intake as Record<string, unknown>;
  for (const [field, candidates] of byField) {
    const distinct = new Set(candidates.map(c => normalize(c.value)));
    const current = intakeRec[field];
    const hasCurrent = !(current === undefined || current === null || current === '');
    const disagreesWithIntake = hasCurrent && ![...distinct].every(v => v === normalize(current as string | number | boolean));
    if (distinct.size > 1 || disagreesWithIntake) {
      conflicts.push({
        field,
        current: hasCurrent ? (current as string | number | boolean) : null,
        candidates,
      });
    }
  }
  conflicts.sort((a, b) => a.field.localeCompare(b.field));
  return conflicts;
}
