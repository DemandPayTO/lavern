/**
 * Merge fields into one user's profile, by email. Used over fly ssh to
 * set per-account document furniture (firm address, the lawyer block for
 * court documents) without touching any other account.
 *
 * Usage:
 *   SHEM_DB_PATH=/data/starling.db npx tsx scripts/set-user-profile.ts \
 *     --email jhaworth@evanslawfirm.ca \
 *     --firm "Evans Law Firm" \
 *     --set firmAddress="15 Prince Arthur Avenue, Toronto ON M5R 1B2" \
 *     --set lawyerBlock="John Evans\nJordan Haworth"
 *
 * --set values accept \n for line breaks. --firm updates firm_name (the
 * display name only; firm_id, the tenancy key, is never touched).
 */

import { initDatabase, getUserByEmail, updateUserProfile } from '../src/db/database.js';

function parseArgs(argv: string[]): { email: string; firm?: string; sets: Record<string, string> } {
  let email = '';
  let firm: string | undefined;
  const sets: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--email') email = argv[++i] ?? '';
    else if (argv[i] === '--firm') firm = argv[++i];
    else if (argv[i] === '--set') {
      const kv = argv[++i] ?? '';
      const eq = kv.indexOf('=');
      if (eq > 0) sets[kv.slice(0, eq)] = kv.slice(eq + 1).replace(/\\n/g, '\n');
    }
  }
  if (!email) throw new Error('--email is required');
  return { email, firm, sets };
}

const { email, firm, sets } = parseArgs(process.argv);
initDatabase(process.env.SHEM_DB_PATH ?? './starling.db');

const user = getUserByEmail(email);
if (!user) {
  console.error(`No account for ${email}. Nothing changed.`);
  process.exit(1);
}

let profile: Record<string, unknown> = {};
try { profile = JSON.parse(user.profile_json || '{}'); } catch { /* start clean */ }
const merged = { ...profile, ...sets };

updateUserProfile(user.id, {
  profileJson: JSON.stringify(merged),
  ...(firm ? { firmName: firm } : {}),
});

console.log(`Updated ${email}:`);
if (firm) console.log(`  firm_name: ${firm}`);
for (const [k, v] of Object.entries(sets)) console.log(`  ${k}: ${JSON.stringify(v)}`);
