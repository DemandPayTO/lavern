/**
 * Unit Tests — status monitor tenant scoping.
 *
 * Regression guard for the cross-tenant leak on GET /api/starling/status:
 * inferMatterStatuses(userId) must return only that user's matters, and the
 * admin digest's ALL_USERS path must span every user. A session title carries
 * client context and a session id is a capability token, so an unscoped read
 * would leak both across firms.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDb } from '../../src/db/database.js';
import { inferMatterStatuses, ALL_USERS } from '../../src/starling/status-monitor.js';

function seedUser(id: string): void {
  getDb().prepare(`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, 'x', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
  `).run(id, `${id}@example.com`);
}

function seedSession(id: string, userId: string | null, title: string): void {
  getDb().prepare(`
    INSERT INTO session_archive (id, user_id, title, status, cost_usd, findings_count, created_at, completed_at)
    VALUES (?, ?, ?, 'completed', 1.5, 0, ?, ?)
  `).run(id, userId, title, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
}

describe('inferMatterStatuses scoping', () => {
  beforeEach(() => {
    initDatabase(':memory:');
    seedUser('alice');
    seedUser('bob');
    seedSession('s-alice', 'alice', 'Nadia v Acme — wrongful dismissal');
    seedSession('s-bob', 'bob', 'Okoro v Globex — constructive dismissal');
    seedSession('s-anon', null, 'Anonymous QuickStart run');
  });

  it('returns only the scoped user\'s matters', () => {
    const alice = inferMatterStatuses('alice');
    const titles = alice.map(m => m.title);
    expect(titles).toContain('Nadia v Acme — wrongful dismissal');
    expect(titles).not.toContain('Okoro v Globex — constructive dismissal');
    expect(titles).not.toContain('Anonymous QuickStart run');
  });

  it('does not leak another user\'s session id (capability token)', () => {
    const alice = inferMatterStatuses('alice');
    const ids = alice.map(m => m.id);
    expect(ids).toContain('s-alice');
    expect(ids).not.toContain('s-bob');
  });

  it('returns nothing for a user with no matters', () => {
    expect(inferMatterStatuses('carol')).toHaveLength(0);
  });

  it('ALL_USERS spans every user for the admin digest', () => {
    const all = inferMatterStatuses(ALL_USERS);
    const titles = all.map(m => m.title);
    expect(titles).toContain('Nadia v Acme — wrongful dismissal');
    expect(titles).toContain('Okoro v Globex — constructive dismissal');
  });
});
