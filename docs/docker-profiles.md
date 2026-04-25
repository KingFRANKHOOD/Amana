# Docker Compose Profiles

Amana uses [Docker Compose profiles](https://docs.docker.com/compose/profiles/) to give each environment a consistent, isolated set of services.

## Profiles at a Glance

| Profile   | Services                        | Port (PG) | Port (Redis) | Data          |
|-----------|---------------------------------|-----------|--------------|---------------|
| `dev`     | postgres, redis                 | 5432      | 6379         | persistent    |
| `staging` | postgres-staging, redis-staging | 5434      | 6380         | persistent    |
| `test`    | postgres-test, redis-test       | 5433      | 6381         | tmpfs (ephemeral) |

## Quick Start

Helper scripts handle startup, migration, and (for staging) seed:

```bash
# Local development
./scripts/dev-up.sh

# Staging (mirrors production topology)
cp .env.staging.example .env.staging   # fill in values first
./scripts/staging-up.sh

# Test / CI (ephemeral, no persistent state)
./scripts/test-up.sh
```

## Manual Usage

```bash
# Bring up a specific profile
docker compose --profile dev     up -d
docker compose --profile staging up -d
docker compose --profile test    up -d

# Tear down (keep volumes)
docker compose --profile dev down

# Tear down and wipe data
docker compose --profile dev down -v
```

## Environment Variables

Each profile honours environment variables with profile-specific prefixes:

| Variable                  | Default                    | Profile  |
|---------------------------|----------------------------|----------|
| `POSTGRES_USER`           | `postgres`                 | dev      |
| `POSTGRES_PASSWORD`       | `password`                 | dev      |
| `POSTGRES_DB`             | `amana`                    | dev      |
| `POSTGRES_PORT`           | `5432`                     | dev      |
| `REDIS_PORT`              | `6379`                     | dev      |
| `STAGING_POSTGRES_USER`   | `postgres`                 | staging  |
| `STAGING_POSTGRES_PASSWORD`| `staging-password`        | staging  |
| `STAGING_POSTGRES_DB`     | `amana_staging`            | staging  |
| `STAGING_POSTGRES_PORT`   | `5434`                     | staging  |
| `STAGING_REDIS_PASSWORD`  | `staging-redis-pass`       | staging  |
| `STAGING_REDIS_PORT`      | `6380`                     | staging  |
| `TEST_POSTGRES_PORT`      | `5433`                     | test     |
| `TEST_REDIS_PORT`         | `6381`                     | test     |

Copy `.env.staging.example` to `.env.staging` to override staging defaults. Never commit `.env.staging`.

## Validating Profile Config

```bash
# Validates compose file structure without starting containers
./scripts/test-compose-profiles.sh
```

## Production Notes

- Production infrastructure is managed externally (cloud-managed postgres, redis cluster).
- The `staging` profile is the closest local approximation: same image tags, password-protected redis, named volume for data persistence.
- The `test` profile uses `tmpfs` so data is never written to disk — suitable for parallel CI runners on the same host.

## Adding a New Service

1. Add the service block to `docker-compose.yml` with the appropriate `profiles:` list.
2. Add connection details to `.env.staging.example` (staging) or the dev defaults.
3. Update `scripts/dev-up.sh` / `scripts/staging-up.sh` if the service needs an ordering dependency.
4. Add an assertion to `scripts/test-compose-profiles.sh`.
