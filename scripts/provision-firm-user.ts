/**
 * Manual firm-user provisioning — securely onboard the pilot firm's lawyers
 * without open self-signup.
 *
 * Creates one lawyer account under a shared firm id, with a temporary
 * password and email pre-verified (so they can log in before Resend is even
 * live). Run once per lawyer, reusing the SAME --firm-id so both lawyers
 * share one firm (firm-scoped templates, CA library). The lawyer changes the
 * password on first login.
 *
 * Matters are scoped per user, so each lawyer sees only their own files (the
 * shared-firm oversight view is a separate, deferred build).
 *
 * Usage (run from repo root, against the live DB):
 *   # First lawyer — omit --firm-id to mint one; the script prints it.
 *   SHEM_DB_PATH=./data/starling.db npx tsx scripts/provision-firm-user.ts \
 *     --email jane@smithlaw.ca --name "Jane Smith" --firm "Smith Law"
 *
 *   # Second lawyer — reuse the firm id the first run printed.
 *   SHEM_DB_PATH=./data/starling.db npx tsx scripts/provision-firm-user.ts \
 *     --email raj@smithlaw.ca --name "Raj Patel" --firm "Smith Law" --firm-id firm-....
 *
 * A random temporary password is generated and printed (never stored in
 * plaintext) unless you pass --password.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { initDatabase, getDb, getUserByEmail, createUser, hashPassword } from '../src/db/database.js';
import { config } from '../src/config.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email')?.toLowerCase().trim();
  const name = arg('name')?.trim();
  const firm = arg('firm')?.trim();
  let firmId = arg('firm-id')?.trim();
  const password = arg('password') ?? `DP-${randomBytes(6).toString('base64url')}`;

  if (!email || !name || !firm) {
    console.error('Required: --email <e> --name <n> --firm <firm name>  [--firm-id <id>] [--password <pw>]');
    process.exit(2);
  }

  initDatabase(config.dbPath);

  if (getUserByEmail(email)) {
    console.error(`A user with ${email} already exists. Aborting (no changes made).`);
    process.exit(1);
  }

  if (!firmId) {
    firmId = `firm-${randomUUID().slice(0, 12)}`;
    console.log(`No --firm-id given: minted a new firm id for "${firm}".`);
  }

  const passwordHash = await hashPassword(password);
  // createUser assigns a fresh firm id when none is given; passing firmId
  // explicitly is how the firm's second and later lawyers join the first
  // lawyer's firm.
  const user = createUser(email, passwordHash, name, firm, firmId);

  // Pre-verify the email so login works before transactional email is
  // configured. Password reset still works once Resend is live.
  getDb().prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);

  console.log('\nProvisioned:');
  console.log(`  email:    ${email}`);
  console.log(`  name:     ${name}`);
  console.log(`  firm:     ${firm}`);
  console.log(`  firm id:  ${firmId}   <-- reuse this for the firm's other lawyers`);
  console.log(`  password: ${password}   <-- give to the lawyer; they change it on first login`);
  console.log('\nemail is pre-verified; they can log in now.');
}

main().catch((err) => { console.error(err); process.exit(1); });
