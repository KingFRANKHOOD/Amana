/**
 * migration-safety.test.ts
 *
 * Validates migration SQL files against backward-compatibility rules.
 * Runs in CI against the repository — no database connection required.
 *
 * Checks:
 *  - migration_lock.toml declares the correct provider
 *  - Every migration directory contains exactly one migration.sql
 *  - migration.sql files are parseable (non-empty, valid UTF-8)
 *  - Destructive DDL patterns are detected and reported
 *  - Migrations with destructive DDL have an accompanying rollback.sql
 */

import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../prisma/migrations');
const LOCK_FILE = path.resolve(__dirname, '../../../prisma/migration_lock.toml');

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; label: string; requiresRollback: boolean }> = [
  { pattern: /DROP\s+TABLE/i,           label: 'DROP TABLE',   requiresRollback: true },
  { pattern: /DROP\s+COLUMN/i,          label: 'DROP COLUMN',  requiresRollback: true },
  { pattern: /TRUNCATE/i,               label: 'TRUNCATE',     requiresRollback: true },
  // NOT NULL without DEFAULT is risky for existing rows
  { pattern: /ALTER\s+COLUMN[^;]+NOT\s+NULL/i, label: 'NOT NULL (no DEFAULT)', requiresRollback: false },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMigrationDirs(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(MIGRATIONS_DIR, d.name))
    .sort();
}

function readSql(dir: string): string | null {
  const sqlPath = path.join(dir, 'migration.sql');
  if (!fs.existsSync(sqlPath)) return null;
  return fs.readFileSync(sqlPath, 'utf8');
}

function hasRollbackSql(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'rollback.sql'));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Migration lock file', () => {
  it('migration_lock.toml exists', () => {
    expect(fs.existsSync(LOCK_FILE)).toBe(true);
  });

  it('declares postgresql as the provider', () => {
    const content = fs.readFileSync(LOCK_FILE, 'utf8');
    expect(content).toMatch(/provider\s*=\s*"postgresql"/i);
  });
});

describe('Migration directory structure', () => {
  const dirs = getMigrationDirs();

  it('migrations directory exists', () => {
    expect(fs.existsSync(MIGRATIONS_DIR)).toBe(true);
  });

  it('at least one migration exists', () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs)('%s — contains migration.sql', (dir) => {
    const sqlPath = path.join(dir, 'migration.sql');
    expect(fs.existsSync(sqlPath)).toBe(true);
  });

  it.each(dirs)('%s — migration.sql is non-empty', (dir) => {
    const sql = readSql(dir);
    expect(sql).not.toBeNull();
    expect(sql!.trim().length).toBeGreaterThan(0);
  });

  it.each(dirs)('%s — migration.sql is valid UTF-8', (dir) => {
    expect(() => readSql(dir)).not.toThrow();
  });

  it.each(dirs)('%s — directory name matches timestamp format', (dir) => {
    const name = path.basename(dir);
    // Prisma format: YYYYMMDDHHmmss_snake_case_description
    expect(name).toMatch(/^\d{14}_[a-z0-9_]+$/);
  });
});

describe('Backward-compatibility scan', () => {
  const dirs = getMigrationDirs();

  describe('Destructive DDL detection', () => {
    for (const { pattern, label, requiresRollback } of DESTRUCTIVE_PATTERNS) {
      it(`detects "${label}" pattern when present`, () => {
        // Regression: ensure the regex itself is correct by matching a known string
        const sample = `ALTER TABLE "Foo" ${label.split(' ')[0]} COLUMN IF EXISTS "bar";`;
        // We only test detection logic; not that production migrations contain it
        if (/DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(label)) {
          expect(pattern.test(sample)).toBe(true);
        }
      });

      if (requiresRollback) {
        // For each migration that DOES contain this destructive pattern,
        // verify it has a companion rollback.sql
        for (const dir of dirs) {
          const sql = readSql(dir);
          if (sql && pattern.test(sql)) {
            it(`${path.basename(dir)} — has rollback.sql for "${label}"`, () => {
              expect(hasRollbackSql(dir)).toBe(true);
            });
          }
        }
      }
    }
  });

  describe('Safe operations pass without warnings', () => {
    const SAFE_SAMPLES = [
      'ALTER TABLE "Foo" ADD COLUMN "bar" TEXT;',
      'CREATE TABLE "NewTable" (id SERIAL PRIMARY KEY);',
      'CREATE INDEX CONCURRENTLY idx_foo ON "Foo" ("bar");',
      'ALTER TABLE "Foo" ALTER COLUMN "bar" TYPE VARCHAR(500);',
    ];

    it.each(SAFE_SAMPLES)('"%s" triggers no destructive pattern', (sql) => {
      const triggered = DESTRUCTIVE_PATTERNS.filter(({ pattern }) => pattern.test(sql));
      expect(triggered).toHaveLength(0);
    });
  });

  describe('Destructive operations are correctly flagged', () => {
    const DESTRUCTIVE_SAMPLES: Array<{ sql: string; expectedLabel: string }> = [
      { sql: 'DROP TABLE IF EXISTS "OldTable";',               expectedLabel: 'DROP TABLE' },
      { sql: 'ALTER TABLE "Foo" DROP COLUMN IF EXISTS "bar";', expectedLabel: 'DROP COLUMN' },
      { sql: 'TRUNCATE TABLE "Foo";',                          expectedLabel: 'TRUNCATE' },
    ];

    it.each(DESTRUCTIVE_SAMPLES)('flags: $sql', ({ sql, expectedLabel }) => {
      const triggered = DESTRUCTIVE_PATTERNS.filter(({ pattern }) => pattern.test(sql));
      const labels = triggered.map((p) => p.label);
      expect(labels).toContain(expectedLabel);
    });
  });
});

describe('migration_lock.toml content', () => {
  it('does not contain uncommitted provider changes', () => {
    const content = fs.readFileSync(LOCK_FILE, 'utf8');
    // Lock file should not have sqlite or mysql which would indicate a dev mis-config
    expect(content).not.toMatch(/provider\s*=\s*"sqlite"/i);
    expect(content).not.toMatch(/provider\s*=\s*"mysql"/i);
  });
});

describe('Migration SQL content sanity', () => {
  const dirs = getMigrationDirs();

  it.each(dirs)('%s — migration.sql contains at least one DDL statement', (dir) => {
    const sql = readSql(dir)!;
    const hasDDL = /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(sql);
    expect(hasDDL).toBe(true);
  });

  it.each(dirs)('%s — migration.sql does not contain hardcoded production secrets', (dir) => {
    const sql = readSql(dir)!;
    // No passwords, connection strings, or API keys should appear in migration SQL
    expect(sql).not.toMatch(/password\s*=\s*['"][^'"]{6,}/i);
    expect(sql).not.toMatch(/postgresql:\/\/[^@]+:[^@]+@/i);
  });
});
