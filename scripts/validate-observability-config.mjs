#!/usr/bin/env node
// Guards the Loki and Promtail configuration against the failure in #1457:
// both files were committed as the 7-byte literal "content", so neither tool
// had a usable config. Nothing validated them, and the staging containers
// silently ran on image defaults.
//
// This asserts the configs are real, parseable, and internally consistent with
// what the rest of the repo expects of them (the retention target in
// docs/LOGGING_STANDARDS.md, the app label its LogQL queries select on, and the
// push endpoint the two services share). It needs no Docker daemon.
//
// Usage: node scripts/validate-observability-config.mjs
// Exit codes: 0 all checks passed, 1 one or more checks failed

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOKI_CONFIG = 'loki/config.yml';
const PROMTAIL_CONFIG = 'promtail/config.yml';
const LOGGING_STANDARDS = 'docs/LOGGING_STANDARDS.md';

// The label every documented LogQL query and dashboard panel selects on.
const BACKEND_APP_LABEL = 'amana-backend';
// docs/LOGGING_STANDARDS.md section 10: 90 days of backend logs in Loki.
const MIN_RETENTION_DAYS = 90;

let passed = 0;
const failures = [];

function check(ok, message) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(message);
  }
}

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// A config that parses to a bare scalar ("content") is the exact shape of the
// #1457 regression, so it is rejected before any key assertions run.
function loadConfig(relativePath) {
  const raw = readRepoFile(relativePath);
  const parsed = yaml.load(raw);

  check(
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed),
    `${relativePath}: must parse to a YAML mapping, got ${describe(parsed)}. ` +
      `A scalar body (e.g. the literal "content") means the file is a placeholder, not a config.`
  );
  check(
    raw.trim().length > 0,
    `${relativePath}: is empty`
  );

  return parsed;
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return `the scalar ${JSON.stringify(value)}`;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// YAML resolves an unquoted 2024-01-01 to a Date rather than a string, so
// normalise before checking.
function normaliseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

// Prometheus-style durations: 2160h, 90d, 30m, 1w.
function durationToHours(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)([smhdwy])$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 's': return amount / 3600;
    case 'm': return amount / 60;
    case 'h': return amount;
    case 'd': return amount * 24;
    case 'w': return amount * 168;
    case 'y': return amount * 8760;
    default: return null;
  }
}

function validateLoki(config) {
  if (!isPlainObject(config)) return;

  check(config.auth_enabled === false, `${LOKI_CONFIG}: auth_enabled must be false (staging is single-tenant, no gateway in front)`);

  check(
    isPlainObject(config.server) && config.server.http_listen_port === 3100,
    `${LOKI_CONFIG}: server.http_listen_port must be 3100, the port docker-compose.yml and promtail push to`
  );

  const common = config.common;
  check(isPlainObject(common), `${LOKI_CONFIG}: missing "common" block (path_prefix, storage, replication_factor)`);
  if (isPlainObject(common)) {
    check(typeof common.path_prefix === 'string' && common.path_prefix.length > 0, `${LOKI_CONFIG}: common.path_prefix must be set`);
    check(
      isPlainObject(common.storage) && isPlainObject(common.storage.filesystem),
      `${LOKI_CONFIG}: common.storage.filesystem must be set (single-binary staging mode stores chunks on disk)`
    );
    check(
      typeof common.replication_factor === 'number' && common.replication_factor >= 1,
      `${LOKI_CONFIG}: common.replication_factor must be >= 1`
    );
  }

  // schema_config is what makes logs queryable at all; without it Loki refuses
  // to start.
  const schemaEntries = isPlainObject(config.schema_config) ? config.schema_config.configs : null;
  check(
    Array.isArray(schemaEntries) && schemaEntries.length > 0,
    `${LOKI_CONFIG}: schema_config.configs must be a non-empty list (Loki will not start without it)`
  );
  if (Array.isArray(schemaEntries)) {
    schemaEntries.forEach((entry, index) => {
      const at = `${LOKI_CONFIG}: schema_config.configs[${index}]`;
      if (!isPlainObject(entry)) {
        check(false, `${at} must be a mapping`);
        return;
      }
      check(normaliseDate(entry.from) !== null, `${at}.from must be an ISO date (YYYY-MM-DD)`);
      check(typeof entry.store === 'string' && entry.store.length > 0, `${at}.store must be set`);
      check(typeof entry.object_store === 'string' && entry.object_store.length > 0, `${at}.object_store must be set`);
      check(typeof entry.schema === 'string' && entry.schema.length > 0, `${at}.schema must be set`);
    });

    // The earliest entry has to be in the past or every write is rejected as
    // too new/old relative to the schema window.
    const earliest = schemaEntries
      .map((entry) => (isPlainObject(entry) ? normaliseDate(entry.from) : null))
      .filter((value) => value !== null)
      .sort()[0];
    if (earliest !== undefined) {
      check(
        Date.parse(earliest) < Date.now(),
        `${LOKI_CONFIG}: earliest schema_config.from (${earliest}) must be in the past`
      );
    }
  }

  const limits = config.limits_config;
  check(isPlainObject(limits), `${LOKI_CONFIG}: missing "limits_config" block`);
  if (isPlainObject(limits)) {
    const retentionHours = durationToHours(limits.retention_period);
    check(
      retentionHours !== null,
      `${LOKI_CONFIG}: limits_config.retention_period must be a duration (e.g. 2160h), got ${JSON.stringify(limits.retention_period)}`
    );
    if (retentionHours !== null) {
      check(
        retentionHours >= MIN_RETENTION_DAYS * 24,
        `${LOKI_CONFIG}: limits_config.retention_period is ${retentionHours}h, but docs/LOGGING_STANDARDS.md requires at least ${MIN_RETENTION_DAYS * 24}h`
      );
    }
  }

  // A retention_period with no compactor is silently ignored, which is the
  // kind of config that looks correct and stores forever.
  const compactor = config.compactor;
  check(isPlainObject(compactor), `${LOKI_CONFIG}: missing "compactor" block (required to enforce retention)`);
  if (isPlainObject(compactor)) {
    check(
      compactor.retention_enabled === true,
      `${LOKI_CONFIG}: compactor.retention_enabled must be true, otherwise limits_config.retention_period is a no-op`
    );
    check(
      typeof compactor.delete_request_store === 'string' && compactor.delete_request_store.length > 0,
      `${LOKI_CONFIG}: compactor.delete_request_store must be set for filesystem retention`
    );
  }

  check(isPlainObject(config.ruler), `${LOKI_CONFIG}: missing "ruler" block (Loki 3.x requires it to be present)`);
}

// Which labels a scrape config ends up attaching to every stream it produces.
function labelsProducedBy(scrapeConfig) {
  const produced = new Set();

  for (const staticConfig of scrapeConfig.static_configs ?? []) {
    if (isPlainObject(staticConfig) && isPlainObject(staticConfig.labels)) {
      for (const label of Object.keys(staticConfig.labels)) {
        if (label !== '__path__') produced.add(label);
      }
    }
  }

  for (const relabel of scrapeConfig.relabel_configs ?? []) {
    if (isPlainObject(relabel) && typeof relabel.target_label === 'string') {
      produced.add(relabel.target_label);
    }
  }

  for (const stage of scrapeConfig.pipeline_stages ?? []) {
    if (!isPlainObject(stage)) continue;
    if (isPlainObject(stage.labels)) {
      for (const label of Object.keys(stage.labels)) produced.add(label);
    }
    if (isPlainObject(stage.template) && typeof stage.template.template === 'string') {
      const named = /\{\{\s*\.(\w+)\s*\}\}/.exec(stage.template.template);
      if (named) produced.add(named[1]);
    }
  }

  return produced;
}

// Literal values a config pins a label to, e.g. replacement: amana-backend.
function pinnedLabelValues(scrapeConfig) {
  const values = [];
  for (const relabel of scrapeConfig.relabel_configs ?? []) {
    if (isPlainObject(relabel) && typeof relabel.replacement === 'string') {
      values.push(relabel.replacement);
    }
  }
  for (const staticConfig of scrapeConfig.static_configs ?? []) {
    if (isPlainObject(staticConfig) && isPlainObject(staticConfig.labels)) {
      values.push(...Object.values(staticConfig.labels).filter((v) => typeof v === 'string'));
    }
  }
  return values;
}

function validatePromtail(config) {
  if (!isPlainObject(config)) return;

  check(
    isPlainObject(config.server) && config.server.http_listen_port === 9080,
    `${PROMTAIL_CONFIG}: server.http_listen_port must be 9080 (promtail's default; the dashboards assume the metrics endpoint is there)`
  );

  check(
    isPlainObject(config.positions) && typeof config.positions.filename === 'string' && config.positions.filename.length > 0,
    `${PROMTAIL_CONFIG}: positions.filename must be set, otherwise offsets are not tracked between restarts`
  );

  const clients = config.clients;
  check(
    Array.isArray(clients) && clients.length > 0,
    `${PROMTAIL_CONFIG}: clients must be a non-empty list, otherwise nothing is ever shipped to Loki`
  );
  if (Array.isArray(clients)) {
    clients.forEach((client, index) => {
      const at = `${PROMTAIL_CONFIG}: clients[${index}]`;
      if (!isPlainObject(client)) {
        check(false, `${at} must be a mapping`);
        return;
      }
      check(typeof client.url === 'string' && client.url.length > 0, `${at}.url must be set`);
      if (typeof client.url === 'string') {
        check(
          client.url.endsWith('/loki/api/v1/push'),
          `${at}.url must be Loki's push endpoint (/loki/api/v1/push), got ${client.url}`
        );
        check(
          !/localhost|127\.0\.0\.1/.test(client.url),
          `${at}.url must not target the promtail container itself (${client.url})`
        );
      }
    });
  }

  const scrapeConfigs = config.scrape_configs;
  check(
    Array.isArray(scrapeConfigs) && scrapeConfigs.length > 0,
    `${PROMTAIL_CONFIG}: scrape_configs must be a non-empty list, otherwise promtail tails nothing`
  );
  if (!Array.isArray(scrapeConfigs)) return;

  const jobNames = new Set();
  let producesBackendLabel = false;

  scrapeConfigs.forEach((scrapeConfig, index) => {
    const at = `${PROMTAIL_CONFIG}: scrape_configs[${index}]`;
    if (!isPlainObject(scrapeConfig)) {
      check(false, `${at} must be a mapping`);
      return;
    }

    check(
      typeof scrapeConfig.job_name === 'string' && scrapeConfig.job_name.length > 0,
      `${at}.job_name must be set`
    );
    if (typeof scrapeConfig.job_name === 'string') {
      check(!jobNames.has(scrapeConfig.job_name), `${at}.job_name "${scrapeConfig.job_name}" is duplicated`);
      jobNames.add(scrapeConfig.job_name);
    }

    // A job has to discover files somehow.
    const hasDiscovery = ['static_configs', 'file_sd_configs', 'docker_sd_configs'].some((key) =>
      Array.isArray(scrapeConfig[key]) && scrapeConfig[key].length > 0
    );
    check(hasDiscovery, `${at}: needs one of static_configs, file_sd_configs or docker_sd_configs to discover log files`);

    const hasPath = (scrapeConfig.static_configs ?? []).some(
      (staticConfig) => isPlainObject(staticConfig) && isPlainObject(staticConfig.labels) && typeof staticConfig.labels.__path__ === 'string'
    );
    check(
      hasPath || Array.isArray(scrapeConfig.docker_sd_configs) || Array.isArray(scrapeConfig.file_sd_configs),
      `${at}: discovers containers/files but never sets __path__, so no log file is actually tailed`
    );

    // Docker service discovery hands back a per-container symlink; tail the
    // real log file or the container id becomes a label.
    for (const relabel of scrapeConfig.relabel_configs ?? []) {
      if (isPlainObject(relabel) && relabel.target_label === '__path__' && typeof relabel.replacement === 'string') {
        check(
          relabel.replacement.includes('*'),
          `${at}: relabel rewriting __path__ to "${relabel.replacement}" has no glob, so it cannot match a log file`
        );
      }
    }

    const produced = labelsProducedBy(scrapeConfig);
    check(
      produced.has('app') || produced.has('job'),
      `${at}: must label streams with "app" or "job" so they are selectable in Loki`
    );

    if (pinnedLabelValues(scrapeConfig).includes(BACKEND_APP_LABEL)) {
      producesBackendLabel = true;
    }
  });

  check(
    producesBackendLabel,
    `${PROMTAIL_CONFIG}: no scrape config pins a stream to app="${BACKEND_APP_LABEL}", ` +
      `which is the label the documented LogQL queries select on`
  );

  // Keep promtail and the docs from drifting apart: every {app="..."} the
  // logging standards query by has to be a label promtail actually produces.
  let standards = '';
  try {
    standards = readRepoFile(LOGGING_STANDARDS);
  } catch {
    failures.push(`${LOGGING_STANDARDS}: could not be read, cannot cross-check the documented log labels`);
    return;
  }

  const documented = new Set(
    [...standards.matchAll(/\{\s*app\s*=\s*"([^"]+)"\s*\}/g)].map((match) => match[1])
  );
  check(
    documented.has(BACKEND_APP_LABEL),
    `${LOGGING_STANDARDS}: expected to document queries against {app="${BACKEND_APP_LABEL}"}`
  );

  const producedValues = new Set();
  for (const scrapeConfig of scrapeConfigs) {
    if (!isPlainObject(scrapeConfig)) continue;
    for (const value of pinnedLabelValues(scrapeConfig)) producedValues.add(value);
  }

  for (const app of documented) {
    check(
      producedValues.has(app),
      `${PROMTAIL_CONFIG}: docs query {app="${app}"} but no scrape config pins an "app" label to that value`
    );
  }
}

function main() {
  validateLoki(loadConfig(LOKI_CONFIG));
  validatePromtail(loadConfig(PROMTAIL_CONFIG));

  console.log(`Observability config validation: ${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${LOKI_CONFIG} and ${PROMTAIL_CONFIG} are valid Loki/Promtail configurations.`);
}

main();
