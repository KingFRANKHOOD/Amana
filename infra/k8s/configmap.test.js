const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const configMap = fs.readFileSync(path.join(__dirname, 'configmap.yaml'), 'utf8');

function readConfigValue(key) {
  const value = configMap.match(new RegExp(`^  ${key}: "([^"]*)"$`, 'm'));
  assert.ok(value, `Expected ${key} in amana-config ConfigMap`);
  return value[1];
}

test('production ConfigMap connects to Stellar mainnet', () => {
  assert.equal(readConfigValue('NODE_ENV'), 'production');
  assert.equal(readConfigValue('STELLAR_NETWORK'), 'mainnet');
  assert.equal(readConfigValue('STELLAR_RPC_URL'), 'https://soroban-rpc.stellar.org');
});
