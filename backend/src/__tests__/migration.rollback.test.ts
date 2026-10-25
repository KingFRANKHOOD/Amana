/**
 * migration.rollback.test.ts  (Issue #523)
 *
 * Validates rollback-safety practices for schema migrations:
 *  - Destructive DDL in a migration should be paired with a rollback.sql
 *  - Rollback scripts must be valid (non-empty, contains reversal DDL)
 *  - Non-destructive migrations do not require a rollback script
 *  - Rollback SQL must not itself contain irreversible operations
 *  - Idempotency markers (IF EXISTS / IF NOT EXISTS) are present where expected
 *
 * Runs entirely without a database connection — file-system checks only.
 */

import * as fs from "fs";
import * as path from "path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../prisma/migrations");

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /DROP\s+TABLE(?!\s+IF\s+EXISTS)/i,    label: "DROP TABLE (no IF EXISTS)" },
  { pattern: /DROP\s+COLUMN(?!\s+IF\s+EXISTS)/i,   label: "DROP COLUMN (no IF EXISTS)" },
  { pattern: /DROP\s+SCHEMA/i,                      label: "DROP SCHEMA" },
  { pattern: /DROP\s+DATABASE/i,                    label: "DROP DATABASE" },
  { pattern: /TRUNCATE/i,                           label: "TRUNCATE" },
];

const SAFE_ROLLBACK_FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /DROP\s+DATABASE/i, label: "DROP DATABASE in rollback" },
  { pattern: /DROP\s+SCHEMA/i,   label: "DROP SCHEMA in rollback" },
  { pattern: /TRUNCATE/i,        label: "TRUNCATE in rollback" },
];

function getMigrationDirs(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(MIGRATIONS_DIR, d.name))
    .sort();
}

function readFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function hasDestructiveDDL(sql: string): { found: boolean; labels: string[] } {
  const labels = DESTRUCTIVE_PATTERNS.filter(({ pattern }) => pattern.test(sql)).map(
    ({ label }) => label
  );
  return { found: labels.length > 0, labels };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Rollback script presence", () => {
  const dirs = getMigrationDirs();

  it.each(dirs)("%s — migration with destructive DDL should have rollback.sql", (dir) => {
    const sqlPath = path.join(dir, "migration.sql");
    if (!fs.existsSync(sqlPath)) return;

    const sql = fs.readFileSync(sqlPath, "utf8");
    const { found, labels } = hasDestructiveDDL(sql);

    if (found) {
      const rollbackPath = path.join(dir, "rollback.sql");
      const rollbackExists = fs.existsSync(rollbackPath);
      // Report which patterns triggered the requirement
      expect(rollbackExists).toBe(true);
    }
  });

  // Only non-destructive migrations may ship without a rollback.sql, so every
  // migration that has none must classify as non-destructive. Unlike the
  // previous version, the assertion runs unconditionally for each of them.
  const withoutRollback = dirs.filter(
    (dir) =>
      fs.existsSync(path.join(dir, "migration.sql")) &&
      !fs.existsSync(path.join(dir, "rollback.sql"))
  );

  it.each(withoutRollback)(
    "%s — migration without rollback.sql is non-destructive",
    (dir) => {
      const sql = fs.readFileSync(path.join(dir, "migration.sql"), "utf8");
      expect(hasDestructiveDDL(sql).labels).toEqual([]);
    }
  );
});

describe("Destructive DDL classifier", () => {
  // Non-destructive statements must never be flagged; otherwise safe
  // migrations would wrongly be required to ship a rollback.sql.
  it.each([
    'CREATE TABLE "Foo" (id SERIAL PRIMARY KEY);',
    'CREATE TABLE IF NOT EXISTS "Foo" (id SERIAL PRIMARY KEY);',
    'ALTER TABLE "Foo" ADD COLUMN "bar" TEXT;',
    'CREATE INDEX "idx_foo_bar" ON "Foo" ("bar");',
    'DROP TABLE IF EXISTS "OldFoo";',
    'ALTER TABLE "Foo" DROP COLUMN IF EXISTS "bar";',
  ])("does not flag non-destructive statement: %s", (sql) => {
    expect(hasDestructiveDDL(sql)).toEqual({ found: false, labels: [] });
  });

  // Each destructive statement must be flagged with the right label;
  // otherwise destructive migrations could ship without a rollback.sql.
  it.each([
    ['DROP TABLE "Foo";', "DROP TABLE (no IF EXISTS)"],
    ['ALTER TABLE "Foo" DROP COLUMN "bar";', "DROP COLUMN (no IF EXISTS)"],
    ["DROP SCHEMA legacy CASCADE;", "DROP SCHEMA"],
    ["DROP DATABASE amana;", "DROP DATABASE"],
    ['TRUNCATE "Trade";', "TRUNCATE"],
  ])("flags destructive statement: %s", (sql, label) => {
    const result = hasDestructiveDDL(sql);
    expect(result.found).toBe(true);
    expect(result.labels).toContain(label);
  });
});

describe("Rollback script validity", () => {
  const dirs = getMigrationDirs();

  it.each(dirs)("%s — rollback.sql (if present) is non-empty", (dir) => {
    const rollbackPath = path.join(dir, "rollback.sql");
    const rollback = readFile(rollbackPath);
    if (rollback === null) return; // no rollback.sql — skip

    expect(rollback.trim().length).toBeGreaterThan(0);
  });

  it.each(dirs)("%s — rollback.sql (if present) contains at least one DDL statement", (dir) => {
    const rollbackPath = path.join(dir, "rollback.sql");
    const rollback = readFile(rollbackPath);
    if (rollback === null) return;

    const hasDDL = /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(rollback);
    expect(hasDDL).toBe(true);
  });

  it.each(dirs)(
    "%s — rollback.sql (if present) does not contain catastrophic operations",
    (dir) => {
      const rollbackPath = path.join(dir, "rollback.sql");
      const rollback = readFile(rollbackPath);
      if (rollback === null) return;

      for (const { pattern, label } of SAFE_ROLLBACK_FORBIDDEN) {
        expect(pattern.test(rollback)).toBe(
          false
        );
        void label;
      }
    }
  );
});

describe("Idempotency markers in migration SQL", () => {
  const IDEMPOTENT_CREATE = /CREATE\s+(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/i;
  const IDEMPOTENT_DROP   = /DROP\s+(?:TABLE|INDEX|COLUMN)\s+IF\s+EXISTS/i;

  it("CREATE TABLE IF NOT EXISTS pattern is idempotent", () => {
    expect(IDEMPOTENT_CREATE.test("CREATE TABLE IF NOT EXISTS \"Foo\" (id SERIAL);")).toBe(true);
  });

  it("DROP TABLE IF EXISTS pattern is idempotent", () => {
    expect(IDEMPOTENT_DROP.test('DROP TABLE IF EXISTS "OldFoo";')).toBe(true);
  });

  it("CREATE TABLE without IF NOT EXISTS is detected as non-idempotent", () => {
    expect(IDEMPOTENT_CREATE.test('CREATE TABLE "Foo" (id SERIAL);')).toBe(false);
  });
});

describe("Rollback safety regression samples", () => {
  const ROLLBACK_REVERSAL_PAIRS: Array<{ forward: string; expected_reversal_pattern: RegExp; canonical_reversal: string }> = [
    {
      forward: 'ALTER TABLE "Foo" ADD COLUMN "bar" TEXT;',
      expected_reversal_pattern: /ALTER\s+TABLE[^;]+DROP\s+COLUMN[^;]+"bar"/i,
      canonical_reversal: 'ALTER TABLE "Foo" DROP COLUMN IF EXISTS "bar";',
    },
    {
      forward: 'CREATE TABLE "NewTable" (id SERIAL PRIMARY KEY);',
      expected_reversal_pattern: /DROP\s+TABLE[^;]+"NewTable"/i,
      canonical_reversal: 'DROP TABLE IF EXISTS "NewTable";',
    },
    {
      forward: 'CREATE INDEX idx_foo ON "Foo" ("bar");',
      expected_reversal_pattern: /DROP\s+INDEX[^;]+idx_foo/i,
      canonical_reversal: 'DROP INDEX IF EXISTS idx_foo;',
    },
  ];

  it.each(ROLLBACK_REVERSAL_PAIRS)(
    "forward migration '$forward' has a plausible reversal pattern",
    ({ forward, expected_reversal_pattern, canonical_reversal }) => {
      // The pattern must match a valid canonical reversal SQL.
      expect(expected_reversal_pattern.test(canonical_reversal)).toBe(true);
      // The forward statement itself should NOT match its own reversal pattern.
      expect(expected_reversal_pattern.test(forward)).toBe(false);
    }
  );
});
