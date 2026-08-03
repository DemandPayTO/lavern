/**
 * Unit Tests — firm tenancy assignment (2026-08-03 security review, Vuln 1).
 *
 * The tenant key must be a server-assigned firm_id, never the user-editable
 * firm_name. Two accounts typing the same firm name are NOT the same tenant,
 * and accounts with no firm name must not collapse into one shared bucket.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, createUser, updateUserProfile, getUserById } from '../../src/db/database.js';

beforeAll(() => {
  initDatabase(':memory:');
});

describe('firm_id assignment', () => {
  it('assigns a distinct server-generated firm_id to every new account', () => {
    const a = createUser('a@example.test', 'hash', 'A', 'Evans Law Firm');
    const b = createUser('b@example.test', 'hash', 'B', 'Evans Law Firm');
    expect(a.firm_id).toBeTruthy();
    expect(b.firm_id).toBeTruthy();
    // Same firm NAME must not mean same firm ID.
    expect(a.firm_id).not.toBe(b.firm_id);
  });

  it('does not collapse accounts with no firm name into one tenant', () => {
    const a = createUser('c@example.test', 'hash', 'C');
    const b = createUser('d@example.test', 'hash', 'D');
    expect(a.firm_id).toBeTruthy();
    expect(b.firm_id).toBeTruthy();
    expect(a.firm_id).not.toBe(b.firm_id);
    expect(a.firm_id).not.toBe('');
  });

  it('honours an explicit firm id so colleagues can share a firm', () => {
    const first = createUser('e@example.test', 'hash', 'E', 'Evans Law Firm');
    const second = createUser('f@example.test', 'hash', 'F', 'Evans Law Firm', first.firm_id);
    expect(second.firm_id).toBe(first.firm_id);
  });

  it('keeps firm_id immutable through profile updates', () => {
    const user = createUser('g@example.test', 'hash', 'G', 'Original Firm');
    const originalFirmId = user.firm_id;
    updateUserProfile(user.id, { firmName: 'Evans Law Firm' });
    const after = getUserById(user.id)!;
    // The display name changed; the tenant key did not.
    expect(after.firm_name).toBe('Evans Law Firm');
    expect(after.firm_id).toBe(originalFirmId);
  });
});
