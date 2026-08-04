/**
 * Unit Tests — firm-wide matter scoping (2026-08-04).
 *
 * A matter belongs to the firm's file room, not the drawer of the lawyer
 * who opened it. The security property under test: firm visibility NEVER
 * widens beyond the server-assigned firm_id, NULL never acts as a
 * wildcard, and destructive rights stay narrower than read rights.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  initDatabase, createUser, saveMatter, getMattersByUser, getMatterById,
  deleteMatter, getDb,
} from '../../src/db/database.js';

let evansA: string;   // opened the shared matter
let evansB: string;   // colleague, same firm
let rival: string;    // different firm entirely

beforeAll(() => {
  initDatabase(':memory:');
  const a = createUser('a@evans.test', 'hash', 'Jordan Haworth', 'Evans Law Firm');
  const b = createUser('b@evans.test', 'hash', 'Sam Partner', 'Evans Law Firm', a.firm_id);
  const r = createUser('r@rival.test', 'hash', 'Rival Lawyer', 'Rival LLP');
  evansA = a.id; evansB = b.id; rival = r.id;

  saveMatter(evansA, 'matter-shared-1', JSON.stringify({ clientName: 'Jane Smith' }), 'active');
});

describe('firm visibility', () => {
  it('shows a colleague the matter, in the list and by id', () => {
    expect(getMattersByUser(evansB).map(m => m.id)).toContain('matter-shared-1');
    expect(getMatterById('matter-shared-1', evansB)).toBeDefined();
  });

  it('carries attribution: who opened the file, by name', () => {
    const row = getMatterById('matter-shared-1', evansB)!;
    expect(row.user_id).toBe(evansA);
    expect(row.owner_name).toBe('Jordan Haworth');
  });

  it('shows a lawyer at another firm nothing', () => {
    expect(getMattersByUser(rival).map(m => m.id)).not.toContain('matter-shared-1');
    expect(getMatterById('matter-shared-1', rival)).toBeUndefined();
  });

  it('keeps a matter with no firm private to its owner', () => {
    // Simulate a pre-migration row: owner exists but the matter's firm is
    // cleared. NULL must mean private, never wildcard.
    saveMatter(evansA, 'matter-firmless', JSON.stringify({}), 'active');
    getDb().prepare(`UPDATE matters SET firm_id = NULL WHERE id = 'matter-firmless'`).run();
    expect(getMatterById('matter-firmless', evansA)).toBeDefined();
    expect(getMatterById('matter-firmless', evansB)).toBeUndefined();
  });
});

describe('firm writes', () => {
  it('lets a colleague update the matter without taking it over', () => {
    saveMatter(evansB, 'matter-shared-1', JSON.stringify({ clientName: 'Jane Smith', note: 'from B' }), 'active');
    const row = getMatterById('matter-shared-1', evansA)!;
    expect(JSON.parse(row.data_json).note).toBe('from B');
    // Opened-by never changes; the write is attributed instead.
    expect(row.user_id).toBe(evansA);
    expect(row.last_modified_by).toBe(evansB);
  });

  it('refuses an outsider write even when called directly (defence in depth)', () => {
    saveMatter(rival, 'matter-shared-1', JSON.stringify({ clientName: 'OVERWRITTEN' }), 'active');
    const row = getMatterById('matter-shared-1', evansA)!;
    expect(JSON.parse(row.data_json).clientName).toBe('Jane Smith');
    expect(row.user_id).toBe(evansA);
  });
});

describe('deletion stays owner-only', () => {
  it('refuses a colleague, allows the owner', () => {
    expect(deleteMatter('matter-shared-1', evansB)).toBe(false);
    expect(getMatterById('matter-shared-1', evansB)).toBeDefined();
    expect(deleteMatter('matter-shared-1', evansA)).toBe(true);
    expect(getMatterById('matter-shared-1', evansA)).toBeUndefined();
  });
});
