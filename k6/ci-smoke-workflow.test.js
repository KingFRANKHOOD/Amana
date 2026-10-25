const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'k6.yml'),
  'utf8'
);
const smokeScript = fs.readFileSync(path.join(__dirname, 'ci-smoke.js'), 'utf8');

test('k6 smoke workflow starts a local backend when no external URL is configured', () => {
  assert.match(workflow, /if: \$\{\{ !vars\.K6_BASE_URL \}\}/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm dev/);
  assert.match(workflow, /http:\/\/127\.0\.0\.1:3001\/health\/live/);
  assert.match(workflow, /JWT_SECRET: test-jwt-secret-value-with-minimum-length-32/);
  assert.match(workflow, /AMANA_ESCROW_CONTRACT_ID: test-escrow-contract/);
  assert.match(workflow, /USDC_CONTRACT_ID: test-usdc-contract/);
  assert.match(workflow, /TRADE_NOTES_ENCRYPTION_KEY: test-trade-notes-encryption-key-base64-32chr/);
  assert.match(
    workflow,
    /BASE_URL: \$\{\{ vars\.K6_BASE_URL \|\| 'http:\/\/127\.0\.0\.1:3001' \}\}/
  );

  const backendStartup = workflow.indexOf('Start backend for local smoke test');
  const k6Run = workflow.indexOf('Run k6 smoke test');
  assert.ok(backendStartup >= 0 && k6Run > backendStartup);
  assert.match(smokeScript, /`\$\{baseUrl\}\/health\/live`/);
});
