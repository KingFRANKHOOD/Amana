/**
 * infra.config.regression.test.ts
 *
 * Static regression checks for infrastructure/config fixes that cannot be
 * exercised from the backend test suite directly:
 *   - #1480 NetworkPolicies must allow worker -> redis/postgres (ingress)
 *           and worker egress to redis/postgres/external endpoints.
 *   - #1478 worker-deployment must run the real backend image / worker
 *           entrypoint (not a busybox sleep loop) with env + resources, and
 *           every BullMQ queue must have a consumer in source.
 *   - #1555 docker-compose must not pin unpublished grafana image tags.
 *   - #1474 RDS module must use the caller-supplied kms_key_id and must not
 *           create/shadow it with an internal key.
 *
 * These read files relative to the repo root; pure file assertions, no side
 * effects.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../../');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

const K8S = 'infra/k8s';

describe('#1480 worker NetworkPolicies', () => {
  const policies = read(`${K8S}/network-policies.yaml`);

  it('allows worker ingress to PostgreSQL and Redis', () => {
    expect(policies).toContain('name: allow-worker-to-postgres');
    expect(policies).toContain('name: allow-worker-to-redis');
  });

  it('grants worker egress to Redis, PostgreSQL and external endpoints', () => {
    expect(policies).toContain('name: allow-worker-external-egress');
  });

  it('selects app=worker pods as the source for the data-store ingress rules', () => {
    // Both worker->db policies must list app: worker as the ingress source.
    const workerMentions = policies.match(/app: worker/g) ?? [];
    expect(workerMentions.length).toBeGreaterThanOrEqual(3);
  });
});

describe('#1478 worker deployment runs real BullMQ workers', () => {
  const workerYaml = read(`${K8S}/worker-deployment.yaml`);

  it('no longer runs a busybox sleep loop', () => {
    expect(workerYaml).not.toContain('busybox');
    expect(workerYaml).not.toContain('sleep 3600');
  });

  it('uses the amana backend image and the worker-only entrypoint', () => {
    expect(workerYaml).toContain('kingfrankhood/amana-backend');
    expect(workerYaml).toContain('dist/worker.js');
  });

  it('provides DATABASE_URL and REDIS_URL', () => {
    expect(workerYaml).toContain('DATABASE_URL');
    expect(workerYaml).toContain('REDIS_URL');
    expect(workerYaml).toContain('postgres-service:5432');
    expect(workerYaml).toContain('redis-service:6379');
  });

  it('defines resource requests and limits', () => {
    expect(workerYaml).toContain('resources:');
    expect(workerYaml).toMatch(/requests:\s/);
    expect(workerYaml).toMatch(/limits:\s/);
  });

  it('has a worker entrypoint file that boots the shared worker registry', () => {
    expect(exists('backend/src/worker.ts')).toBe(true);
    const entry = read('backend/src/worker.ts');
    expect(entry).toContain('createAllWorkers');
  });

  it('every worker module instantiates a Worker for its queue', () => {
    const workerFiles: Array<[string, string]> = [
      ['webhook.worker.ts', 'webhooks'],
      ['notification.worker.ts', 'notifications'],
      ['export.worker.ts', 'exports'],
      ['evidence-verification.worker.ts', 'evidence-verification'],
      ['trust-score-recalculation.worker.ts', 'trust-score-recalculation'],
      ['idempotency-cleanup.worker.ts', 'idempotency-cleanup'],
      ['audit-log-retention.worker.ts', 'audit-log-retention'],
      ['data-retention-cleanup.worker.ts', 'data-retention-cleanup'],
      ['data-archival.worker.ts', 'data-archival'],
    ];

    for (const [file, queueName] of workerFiles) {
      const src = read(`backend/src/jobs/workers/${file}`);
      expect(src).toContain('new Worker');
      const usesLiteral =
        src.includes(`'${queueName}'`) || src.includes(`"${queueName}"`);
      expect(usesLiteral).toBe(true);
    }
  });

  it('the API process also starts the webhook/notification/export workers', () => {
    const index = read('backend/src/index.ts');
    expect(index).toContain('createWebhookWorker');
    expect(index).toContain('createNotificationWorker');
    expect(index).toContain('createExportWorker');
  });
});

describe('#1555 docker-compose pins published grafana image tags', () => {
  const compose = read('docker-compose.yml');

  it('uses full semver tags for loki and promtail', () => {
    expect(compose).toContain('grafana/loki:3.0.0');
    expect(compose).toContain('grafana/promtail:3.0.0');
  });

  it('does not pin the unpublished bare major.minor tags', () => {
    expect(compose).not.toMatch(/grafana\/loki:3\.0(\s|$)/m);
    expect(compose).not.toMatch(/grafana\/promtail:3\.0(\s|$)/m);
  });
});

describe('#1474 RDS module uses the caller-supplied KMS key', () => {
  const rds = read('infra/terraform/modules/rds/main.tf');

  it('does not create an internal, policy-less KMS key', () => {
    expect(rds).not.toContain('resource "aws_kms_key" "rds"');
    expect(rds).not.toContain('aws_kms_alias" "rds"');
  });

  it('wires the caller-supplied kms_key_id onto the cluster', () => {
    expect(rds).toMatch(
      /kms_key_id\s*=\s*var\.storage_encrypted\s*\?\s*var\.kms_key_id\s*:\s*null/,
    );
  });

  it('does not shadow the variable with an internal key assignment', () => {
    expect(rds).not.toContain('aws_kms_key.rds.arn');
  });
});
