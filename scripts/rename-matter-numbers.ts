/**
 * One-time maintenance: rebrand stored matter numbers from the old "SHEM-"
 * codename prefix to the configured firm prefix (STARLING_MATTER_PREFIX,
 * default "DP"). Only the matterNumber string is touched; every other field
 * of the matter is preserved byte for byte.
 *
 * Idempotent: matters whose number does not start with "SHEM-" are skipped,
 * so re-running is safe. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   SHEM_DB_PATH=./data/starling.db npx tsx scripts/rename-matter-numbers.ts          # dry run
 *   SHEM_DB_PATH=./data/starling.db npx tsx scripts/rename-matter-numbers.ts --apply  # write
 */

import { initDatabase, getAllUserIds, getMattersByUser, saveMatter } from '../src/db/database.js';
import { config } from '../src/config.js';

const APPLY = process.argv.includes('--apply');
const PREFIX = (process.env.STARLING_MATTER_PREFIX?.trim() || 'DP');

function main(): void {
  initDatabase(config.dbPath);
  let scanned = 0;
  let renamed = 0;

  for (const userId of getAllUserIds()) {
    for (const row of getMattersByUser(userId)) {
      scanned++;
      let matter: Record<string, unknown>;
      try {
        matter = JSON.parse(row.data_json) as Record<string, unknown>;
      } catch {
        console.warn(`skip ${row.id}: unparseable data_json`);
        continue;
      }
      const num = matter.matterNumber;
      if (typeof num !== 'string' || !num.startsWith('SHEM-')) continue;

      const next = `${PREFIX}-${num.slice('SHEM-'.length)}`;
      console.log(`${APPLY ? 'rename' : 'would rename'}  ${num}  ->  ${next}  (${row.id})`);
      renamed++;

      if (APPLY) {
        matter.matterNumber = next;
        saveMatter(userId, row.id, JSON.stringify(matter), row.status);
      }
    }
  }

  console.log(`\n${scanned} matters scanned, ${renamed} ${APPLY ? 'renamed' : 'to rename'} (prefix ${PREFIX}).`);
  if (!APPLY && renamed > 0) console.log('Dry run. Re-run with --apply to write.');
}

main();
