const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');

const bash = process.platform === 'win32'
  ? join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  : 'bash';

test('db-restore preserves an explicitly provided DATABASE_URL over root .env', (t) => {
  assert.ok(existsSync(bash), `Bash executable not found: ${bash}`);

  const tempRoot = mkdtempSync(join(tmpdir(), 'db-restore-env-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  const scriptsDir = join(tempRoot, 'scripts');
  mkdirSync(scriptsDir);
  cpSync(join(__dirname, 'db-restore.sh'), join(scriptsDir, 'db-restore.sh'));
  writeFileSync(
    join(tempRoot, '.env'),
    [
      'DATABASE_URL=postgres://production/db',
      'S3_BUCKET=dotenv-bucket',
      '',
    ].join('\n'),
  );

  const restoreScript = join(scriptsDir, 'db-restore.sh');
  const scriptArgument = process.platform === 'win32'
    ? restoreScript.replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replace(/\\/g, '/')
    : restoreScript;
  const result = spawnSync(
    bash,
    [
      '--noprofile',
      '--norc',
      scriptArgument,
      '--key=backups/daily/test.sql.gz.gpg',
      '--dry-run',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://scratch/verify',
        S3_BUCKET: 'caller-bucket',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /would restore .* to postgres:\/\/scratch\/verify/);
  assert.doesNotMatch(result.stdout, /postgres:\/\/production\/db/);
});
