const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const workflow = readFileSync(join(__dirname, '../.github/workflows/ci.yml'), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const e2eStep = workflow.split('- name: Run Playwright E2E tests\n')[1]?.split(
  '- name: Upload Playwright reports\n',
)[0];

test('Playwright E2E config uses its supported JUnit output variable', () => {
  assert.ok(e2eStep, 'E2E test step should exist in the CI workflow');
  assert.match(e2eStep, /PLAYWRIGHT_JUNIT_OUTPUT_NAME:\s*test-results\/e2e-junit\.xml/);
  assert.doesNotMatch(e2eStep, /PLAYWRIGHT_JUNIT_OUTPUT_FILE/);
  assert.match(e2eStep, /--reporter=line,html,junit/);
});
