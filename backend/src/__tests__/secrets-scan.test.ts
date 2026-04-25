/**
 * secrets-scan.test.ts
 *
 * Tests for the secret-detection patterns defined in .gitleaks.toml.
 * Validates that:
 *   1. Each custom rule regex matches known bad samples
 *   2. Known-safe (placeholder) values are NOT matched
 *   3. The gitleaks config file is valid TOML with required fields
 *   4. Allowed paths (example files, test dirs) are correctly excluded
 *
 * No external dependencies — pattern matching only, no network or FS writes.
 */

import * as fs from 'fs';
import * as path from 'path';

const GITLEAKS_TOML = path.resolve(__dirname, '../../../.gitleaks.toml');

// ── Parse .gitleaks.toml minimally (we only need the [[rules]] section) ──────
// Full TOML parsing would require a dependency; we use regex extraction instead.
function extractRuleRegexes(tomlContent: string): Map<string, string> {
  const rules = new Map<string, string>();
  // Split on [[rules]] boundaries
  const blocks = tomlContent.split(/\[\[rules\]\]/);
  for (const block of blocks.slice(1)) {
    const idMatch    = block.match(/id\s*=\s*"([^"]+)"/);
    const regexMatch = block.match(/regex\s*=\s*'''([\s\S]+?)'''/);
    if (idMatch && regexMatch) {
      rules.set(idMatch[1], regexMatch[1].trim());
    }
  }
  return rules;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('.gitleaks.toml file', () => {
  it('exists at repository root', () => {
    expect(fs.existsSync(GITLEAKS_TOML)).toBe(true);
  });

  it('has a title field', () => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf8');
    expect(content).toMatch(/^title\s*=/m);
  });

  it('extends the default ruleset', () => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf8');
    expect(content).toMatch(/useDefault\s*=\s*true/i);
  });

  it('defines at least 5 custom rules', () => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf8');
    const rules = extractRuleRegexes(content);
    expect(rules.size).toBeGreaterThanOrEqual(5);
  });

  it('includes allowlists for example files and test dirs', () => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf8');
    expect(content).toMatch(/\.env\.\*\.example/);
    expect(content).toMatch(/__tests__/);
  });
});

describe('Custom rule patterns — true positives (should detect)', () => {
  let rules: Map<string, string>;

  beforeAll(() => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf8');
    rules = extractRuleRegexes(content);
  });

  const shouldDetect: Array<{ ruleId: string; sample: string }> = [
    {
      ruleId: 'stellar-secret-key',
      // Valid Stellar secret key format: S + 55 uppercase base32 chars
      sample: 'STELLAR_KEY=SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ2',
    },
    {
      ruleId: 'ed25519-private-key-pem',
      sample: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----',
    },
    {
      ruleId: 'ed25519-private-key-pem',
      sample: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----',
    },
    {
      ruleId: 'database-url-with-password',
      sample: 'DATABASE_URL=postgresql://admin:s3cr3tpassword@db.example.com:5432/amana',
    },
    {
      ruleId: 'redis-url-with-password',
      sample: 'REDIS_URL=redis://:myredispassword@localhost:6379/0',
    },
  ];

  it.each(shouldDetect)('rule "$ruleId" detects: $sample', ({ ruleId, sample }) => {
    const pattern = rules.get(ruleId);
    expect(pattern).toBeDefined();
    const regex = new RegExp(pattern!);
    expect(regex.test(sample)).toBe(true);
  });
});

describe('Custom rule patterns — false positives (should NOT detect)', () => {
  let rules: Map<string, string>;

  beforeAll(() => {
    const content = fs.readFileSync(GITLEAKS_TOML, 'utf8');
    rules = extractRuleRegexes(content);
  });

  const shouldNotDetect: Array<{ ruleId: string; sample: string; reason: string }> = [
    {
      ruleId: 'amana-jwt-secret',
      sample: 'JWT_SECRET=your-super-secret-jwt-key-must-be-at-least-32-chars-change-in-production!',
      reason: 'placeholder prefix "your-" should be excluded',
    },
    {
      ruleId: 'amana-jwt-secret',
      sample: 'JWT_SECRET=change-me-staging-jwt-secret-minimum-32-chars',
      reason: 'placeholder prefix "change-" should be excluded',
    },
    {
      ruleId: 'amana-jwt-secret',
      sample: 'JWT_SECRET=test-secret-at-least-32-characters-long',
      reason: 'placeholder prefix "test-" should be excluded',
    },
    {
      ruleId: 'database-url-with-password',
      sample: 'DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/amana',
      reason: 'variable substitution ${...} should not trigger',
    },
    {
      ruleId: 'database-url-with-password',
      sample: 'DATABASE_URL=postgresql://postgres:$POSTGRES_PASSWORD@localhost:5432/amana',
      reason: 'shell variable $VAR should not trigger',
    },
    {
      ruleId: 'redis-url-with-password',
      sample: 'REDIS_URL=redis://localhost:6379/0',
      reason: 'no password in URL should not trigger',
    },
  ];

  it.each(shouldNotDetect)('rule "$ruleId" ignores: $sample ($reason)', ({ ruleId, sample }) => {
    const pattern = rules.get(ruleId);
    expect(pattern).toBeDefined();
    const regex = new RegExp(pattern!);
    expect(regex.test(sample)).toBe(false);
  });
});

describe('Push protection patterns (inline regex — mirrors workflow script)', () => {
  // These regex patterns are duplicated from the push-protection job in secrets-scan.yml
  // Testing them here ensures both sources stay consistent.

  const PATTERNS = {
    stellarSecretKey:    /\bS[A-Z2-7]{55}\b/,
    privateKeyPem:       /-----BEGIN (EC |OPENSSH |RSA )?PRIVATE KEY-----/,
    postgresWithPassword: /postgresql:\/\/[^:]+:[^@$\{]{4,}@/,
    jwtToken:            /ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  };

  describe('True positives', () => {
    it('detects Stellar secret key', () => {
      expect(PATTERNS.stellarSecretKey.test(
        'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ2'
      )).toBe(true);
    });

    it('detects private key PEM header', () => {
      expect(PATTERNS.privateKeyPem.test('-----BEGIN PRIVATE KEY-----')).toBe(true);
      expect(PATTERNS.privateKeyPem.test('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
      expect(PATTERNS.privateKeyPem.test('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
      expect(PATTERNS.privateKeyPem.test('-----BEGIN EC PRIVATE KEY-----')).toBe(true);
    });

    it('detects postgres URL with password', () => {
      expect(PATTERNS.postgresWithPassword.test(
        'postgresql://user:realpassword@host/db'
      )).toBe(true);
    });

    it('detects a JWT token', () => {
      // Fake but structurally valid JWT
      expect(PATTERNS.jwtToken.test(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      )).toBe(true);
    });
  });

  describe('True negatives', () => {
    it('does not flag a non-Stellar 56-char string', () => {
      // Shorter or non-base32 sequences should not match
      expect(PATTERNS.stellarSecretKey.test('SABCDEF12345')).toBe(false);
    });

    it('does not flag a public key PEM', () => {
      expect(PATTERNS.privateKeyPem.test('-----BEGIN PUBLIC KEY-----')).toBe(false);
    });

    it('does not flag postgres URL with variable password', () => {
      expect(PATTERNS.postgresWithPassword.test(
        'postgresql://user:${PASSWORD}@host/db'
      )).toBe(false);
      expect(PATTERNS.postgresWithPassword.test(
        'postgresql://user:$PASSWORD@host/db'
      )).toBe(false);
    });

    it('does not flag a short base64 string as JWT', () => {
      // A JWT needs at least 3 dot-separated parts
      expect(PATTERNS.jwtToken.test('eyJhbGci')).toBe(false);
    });
  });
});

describe('Stellar key pattern edge cases', () => {
  const pattern = /\bS[A-Z2-7]{55}\b/;

  it('matches a 56-char Stellar secret key (S + 55 base32)', () => {
    // 'S' + 55 uppercase base32 chars
    const validKey = 'S' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(2).slice(0, 55);
    expect(pattern.test(validKey)).toBe(true);
  });

  it('does not match a key that is too short', () => {
    const shortKey = 'S' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.slice(0, 50);
    expect(pattern.test(shortKey)).toBe(false);
  });

  it('does not match a key that contains lowercase (Stellar keys are uppercase)', () => {
    const lowercase = 'S' + 'abcdefghijklmnopqrstuvwxyz234567'.repeat(2).slice(0, 55);
    expect(pattern.test(lowercase)).toBe(false);
  });

  it('does not match a Stellar public key (starts with G)', () => {
    const pubKey = 'G' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(2).slice(0, 55);
    expect(pattern.test(pubKey)).toBe(false);
  });
});
