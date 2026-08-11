/**
 * One-time migration: push every stored matter's SAVED questionnaire
 * answers through the engine bridge (deriveEngineFields + aliases) and
 * re-evaluate the gates, so nobody has to re-save sections they already
 * filled before the bridge existed.
 *
 * Same guarantees as the save path: a derivation only lands where the
 * stored intake has no direct answer, so nothing a lawyer set by hand
 * is ever overwritten. Dry run by default; --apply writes.
 *
 *   SHEM_DB_PATH=/data/starling.db npx tsx scripts/migrate-questionnaire-derivations.ts --apply
 */

import Database from 'better-sqlite3';
import { applyQuestionnaireAliases } from '../src/employment/intake-questionnaire.js';
import { evaluateGates } from '../src/employment/gate-evaluator.js';

const apply = process.argv.includes('--apply');
const db = new Database(process.env.SHEM_DB_PATH ?? './starling.db');

const rows = db.prepare('SELECT id, user_id, data_json FROM matters').all() as Array<{ id: string; user_id: string; data_json: string }>;
let touched = 0;

for (const row of rows) {
  let matter: Record<string, unknown>;
  try { matter = JSON.parse(row.data_json); } catch { continue; }
  const employment = matter.employmentData as { intake?: Record<string, unknown>; gates?: unknown } | undefined;
  if (!employment?.intake || Object.keys(employment.intake).length === 0) continue;

  const before = employment.intake;
  const after = applyQuestionnaireAliases(before);
  const added = Object.keys(after).filter(k => !(k in before) && after[k] !== undefined);
  if (added.length === 0) continue;

  touched++;
  console.log(`${row.id}: derives ${added.join(', ')}`);
  if (apply) {
    employment.intake = after;
    employment.gates = evaluateGates(after as never);
    db.prepare('UPDATE matters SET data_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(matter), new Date().toISOString(), row.id);
  }
}

console.log(`${apply ? 'Migrated' : 'Would migrate'} ${touched} of ${rows.length} matters.${apply ? '' : ' Run with --apply to write.'}`);
