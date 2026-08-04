/**
 * Unit Tests — firm template variants (precedent-templates spec, Phase 1).
 *
 * A firm holds several templates per document type (a demand letter for
 * constructive dismissal, another for termination during medical leave).
 * Exactly one per type is the default, a type is never left without one,
 * and an unknown variant falls back to the default rather than silently
 * producing an untemplated document.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initDatabase, getDb, saveFirmTemplate, getFirmTemplate, getFirmTemplates,
  setDefaultFirmTemplate, deleteFirmTemplate,
} from '../../src/db/database.js';

const FIRM = 'firm-evans';
const OTHER_FIRM = 'firm-rival';
const TYPE = 'demand_letter';

function save(variantId: string, label: string, isDefault?: boolean, firmId = FIRM) {
  saveFirmTemplate(
    `tpl-${variantId}-${firmId}`, firmId, TYPE, `${label} template`,
    Buffer.from(`BODY-${variantId}`).toString('base64'), ['CLIENT_NAME'],
    { variantId, variantLabel: label, isDefault },
  );
}

beforeEach(() => {
  initDatabase(':memory:');
  getDb().prepare('DELETE FROM firm_templates').run();
});

describe('variant storage', () => {
  it('holds several variants for one document type', () => {
    save('constructive', 'Constructive dismissal');
    save('medical-leave', 'Medical leave');
    save('just-cause', 'Just cause alleged');

    const all = getFirmTemplates(FIRM).filter(t => t.document_type === TYPE);
    expect(all).toHaveLength(3);
    expect(all.map(t => t.variant_label).sort()).toEqual(
      ['Constructive dismissal', 'Just cause alleged', 'Medical leave'],
    );
  });

  it('makes the first variant the default and keeps exactly one', () => {
    save('constructive', 'Constructive dismissal');
    expect(getFirmTemplate(FIRM, TYPE)?.variant_id).toBe('constructive');

    // A later variant does not steal the default unless it asks to.
    save('medical-leave', 'Medical leave');
    expect(getFirmTemplate(FIRM, TYPE)?.variant_id).toBe('constructive');

    save('just-cause', 'Just cause alleged', true);
    const defaults = getFirmTemplates(FIRM).filter(t => t.document_type === TYPE && t.is_default === 1);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].variant_id).toBe('just-cause');
  });

  it('replaces a variant in place rather than duplicating it', () => {
    save('constructive', 'Constructive dismissal');
    save('constructive', 'Constructive dismissal (2026 revision)');
    const all = getFirmTemplates(FIRM).filter(t => t.document_type === TYPE);
    expect(all).toHaveLength(1);
    expect(all[0].variant_label).toBe('Constructive dismissal (2026 revision)');
  });
});

describe('selection', () => {
  beforeEach(() => {
    save('constructive', 'Constructive dismissal');
    save('medical-leave', 'Medical leave');
  });

  it('returns the requested variant', () => {
    const picked = getFirmTemplate(FIRM, TYPE, 'medical-leave');
    expect(picked?.variant_id).toBe('medical-leave');
    expect(Buffer.from(picked!.template_b64, 'base64').toString()).toBe('BODY-medical-leave');
  });

  it('falls back to the default for an unknown or stale variant', () => {
    expect(getFirmTemplate(FIRM, TYPE, 'deleted-variant')?.variant_id).toBe('constructive');
    expect(getFirmTemplate(FIRM, TYPE)?.variant_id).toBe('constructive');
  });

  it('returns nothing for a type the firm has no template for', () => {
    expect(getFirmTemplate(FIRM, 'statement_of_claim')).toBeUndefined();
  });

  it('never crosses firms', () => {
    save('constructive', 'Their constructive dismissal', undefined, OTHER_FIRM);
    const ours = getFirmTemplate(FIRM, TYPE, 'constructive');
    expect(Buffer.from(ours!.template_b64, 'base64').toString()).toBe('BODY-constructive');
    expect(getFirmTemplates(OTHER_FIRM)).toHaveLength(1);
    expect(getFirmTemplate('firm-nobody', TYPE)).toBeUndefined();
  });
});

describe('default management and deletion', () => {
  it('changes the default only to a variant that exists', () => {
    save('constructive', 'Constructive dismissal');
    save('medical-leave', 'Medical leave');

    expect(setDefaultFirmTemplate(FIRM, TYPE, 'medical-leave')).toBe(true);
    expect(getFirmTemplate(FIRM, TYPE)?.variant_id).toBe('medical-leave');

    expect(setDefaultFirmTemplate(FIRM, TYPE, 'does-not-exist')).toBe(false);
    expect(getFirmTemplate(FIRM, TYPE)?.variant_id).toBe('medical-leave');
  });

  it('promotes a survivor when the default is deleted', () => {
    save('constructive', 'Constructive dismissal');
    save('medical-leave', 'Medical leave');
    deleteFirmTemplate(FIRM, TYPE, 'constructive');

    const remaining = getFirmTemplates(FIRM).filter(t => t.document_type === TYPE);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].is_default).toBe(1);
    expect(getFirmTemplate(FIRM, TYPE)?.variant_id).toBe('medical-leave');
  });

  it('deletes every variant of a type when no variant is named', () => {
    save('constructive', 'Constructive dismissal');
    save('medical-leave', 'Medical leave');
    deleteFirmTemplate(FIRM, TYPE);
    expect(getFirmTemplates(FIRM).filter(t => t.document_type === TYPE)).toHaveLength(0);
  });
});

describe('migration from the single-template schema', () => {
  it('carries an existing template forward as the Standard default', () => {
    // A file-backed database, so re-initialising reopens the SAME data and
    // the migration runs for real. (Each ':memory:' open is a fresh DB.)
    const dbPath = path.join(os.tmpdir(), `starling-tpl-migration-${Date.now()}.db`);
    initDatabase(dbPath);

    const db = getDb();
    db.exec('DROP TABLE firm_templates');
    db.exec(`
      CREATE TABLE firm_templates (
        id TEXT PRIMARY KEY, firm_id TEXT NOT NULL, document_type TEXT NOT NULL,
        name TEXT NOT NULL, template_b64 TEXT NOT NULL, placeholders TEXT DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(firm_id, document_type)
      );
    `);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO firm_templates (id, firm_id, document_type, name, template_b64, placeholders, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('tpl-legacy', FIRM, TYPE, 'Legacy letterhead', Buffer.from('LEGACY').toString('base64'), '[]', now, now);

    // Reopen: the variant migration should run against the legacy table.
    initDatabase(dbPath);

    const migrated = getFirmTemplate(FIRM, TYPE);
    expect(migrated?.variant_id).toBe('standard');
    expect(migrated?.variant_label).toBe('Standard');
    expect(migrated?.is_default).toBe(1);
    expect(Buffer.from(migrated!.template_b64, 'base64').toString()).toBe('LEGACY');

    // And a second variant can now be added alongside it.
    save('medical-leave', 'Medical leave');
    expect(getFirmTemplates(FIRM).filter(t => t.document_type === TYPE)).toHaveLength(2);

    fs.rmSync(dbPath, { force: true });
  });
});

describe('placeholder detection (2026-08-04 fix)', () => {
  it('reads markers from inside the DOCX zip, not the raw bytes', async () => {
    const { Document, Packer, Paragraph, TextRun } = await import('docx');
    const { detectPlaceholders } = await import('../../src/employment/firm-templates.js');
    const JSZip = (await import('jszip')).default;

    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun('Re: {{CLIENT_NAME}} and {{EMPLOYER_NAME}}')] }),
      new Paragraph({ children: [new TextRun('{{LEGAL_ANALYSIS}}')] }),
    ] }] });
    const buffer = await Packer.toBuffer(doc);

    // The old path: reading the compressed bytes as text finds nothing.
    expect(detectPlaceholders(buffer.toString('utf-8'))).toHaveLength(0);

    // The fixed path: unzip first.
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('string');
    const found = detectPlaceholders(xml);
    expect(found).toContain('CLIENT_NAME');
    expect(found).toContain('EMPLOYER_NAME');
    expect(found).toContain('LEGAL_ANALYSIS');
  });
});
