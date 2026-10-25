const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifestDirectory = __dirname;

function readManifestDocument(fileName, kind, name) {
  const contents = fs.readFileSync(path.join(manifestDirectory, fileName), 'utf8');
  const document = contents
    .split(/^---\s*$/m)
    .find((candidate) =>
      new RegExp(`^kind: ${kind}$`, 'm').test(candidate) &&
      new RegExp(`^  name: ${name}$`, 'm').test(candidate)
    );

  assert.ok(document, `Expected ${kind} ${name} in ${fileName}`);
  return document;
}

function readIntegerField(document, field) {
  const value = document.match(new RegExp(`^  ${field}:\\s*(\\d+)\\s*$`, 'm'));
  return value ? Number(value[1]) : null;
}

test('postgres PDB allows voluntary disruption of the single StatefulSet replica', () => {
  const pdb = readManifestDocument(
    'pod-disruption-budgets.yaml',
    'PodDisruptionBudget',
    'postgres-pdb'
  );
  const statefulSet = readManifestDocument(
    'postgres-statefulset.yaml',
    'StatefulSet',
    'postgres'
  );
  const replicas = readIntegerField(statefulSet, 'replicas');
  const maxUnavailable = readIntegerField(pdb, 'maxUnavailable');
  const minAvailable = readIntegerField(pdb, 'minAvailable');

  assert.match(pdb, /^      app: postgres$/m);
  assert.equal(replicas, 1, 'the test covers the single-replica PostgreSQL workload');
  assert.ok(
    maxUnavailable !== null || minAvailable !== null,
    'the PostgreSQL PDB must specify an availability constraint'
  );

  const allowedDisruptions =
    maxUnavailable !== null ? maxUnavailable : replicas - minAvailable;
  assert.ok(
    allowedDisruptions > 0,
    'the PDB must allow at least one voluntary disruption'
  );
});
