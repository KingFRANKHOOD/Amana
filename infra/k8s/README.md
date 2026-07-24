# Amana Kubernetes Deployments

This directory contains Kubernetes manifests for deploying Amana services (backend, frontend, and dependencies) to a Kubernetes cluster.

## Prerequisites

- Kubernetes cluster (v1.24+)
- `kubectl` configured with cluster access
- `kustomize` (or `kubectl` v1.14+ built-in)

## Quick Start

Apply all manifests using Kustomize:

```bash
# Preview all resources
kubectl kustomize infra/k8s/

# Apply all resources
kubectl apply -k infra/k8s/

# Verify deployment
kubectl get all -n amana
kubectl get ingress -n amana
```

## Architecture

| Service | Type | Port | Replicas | Image |
|---|---|---|---|---|
| **Backend** | Deployment (API) | 4000 | 2 (HPA: 2–10) | `ghcr.io/kingfrankhood/amana/backend:latest` |
| **Frontend** | Deployment (Next.js) | 3000 | 2 (HPA: 2–5) | `ghcr.io/kingfrankhood/amana/frontend:latest` |
| **Redis** | Deployment (Cache/Queue) | 6379 | 1 | `redis:7-alpine` |
| **PostgreSQL** | StatefulSet (Database) | 5432 | 1 | `postgres:17-alpine` |

## Component Details

### Configuration

- **ConfigMap** (`configmap.yaml`): Non-sensitive environment variables (network settings, API URLs)
- **Secret** (`secrets.yaml`): Sensitive credentials — **must replace placeholder values** before deploying

### Secrets Management

The `secrets.yaml` file contains placeholder values. Before deploying to a production cluster:

1. **Replace placeholder values** with actual secrets (base64-encoded)
2. **Use External Secrets Operator** or **Sealed Secrets** for GitOps workflows
3. **Never commit raw secrets** to version control

```bash
# Create secrets from environment file
kubectl create secret generic amana-secrets -n amana \
  --from-env-file=./.env.production \
  --dry-run=client -o yaml > infra/k8s/secrets.yaml
```

### Auto-scaling

HorizontalPodAutoscalers are configured for:

- **Backend**: CPU 75% / Memory 80% utilization target, 2–10 replicas
- **Frontend**: CPU 80% / Memory 85% utilization target, 2–5 replicas

### High Availability

PodDisruptionBudgets ensure:

- **Backend**: At least 1 pod always available
- **Frontend**: At least 1 pod always available
- **Redis/PostgreSQL**: No strict PDB (single-replica stateful services)

### Network Security

NetworkPolicies enforce least-privilege communication:

- Default deny all ingress traffic
- Frontend accessible from namespace ingress
- Backend accessible from frontend pods and ingress
- Redis accessible only from backend pods
- PostgreSQL accessible only from backend pods

## Customizing Deployments

### Override image tags

```bash
kubectl set image deployment/backend -n amana \
  backend=ghcr.io/kingfrankhood/amana/backend:v1.2.3
```

### Scale manually

```bash
kubectl scale deployment/backend -n amana --replicas=3
```

## Database Backups

Automated backups run via CronJobs:

| Schedule | Type | Retention |
|---|---|---|
| Daily at 02:00 | Daily backup | 3 successful runs |
| Sunday at 03:00 | Weekly backup | 2 successful runs |
| 1st of month at 04:00 | Monthly backup | 2 successful runs |

Backup secrets must be created separately:

```bash
kubectl create secret generic db-backup-secret -n amana \
  --from-literal=DATABASE_URL=postgresql://... \
  --from-literal=S3_BUCKET=amana-backups \
  --from-literal=AWS_ACCESS_KEY_ID=... \
  --from-literal=AWS_SECRET_ACCESS_KEY=... \
  --from-literal=AWS_DEFAULT_REGION=us-east-1
```

## Building Docker Images

### Backend

```bash
# Build (context is the backend directory)
docker build -t ghcr.io/kingfrankhood/amana/backend:latest ./backend

# Push
docker push ghcr.io/kingfrankhood/amana/backend:latest
```

### Frontend

```bash
# Build with required build-time variables
# (NEXT_PUBLIC_* vars are inlined by Next.js at build time)
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.amanavault.com \
  --build-arg NEXT_PUBLIC_STELLAR_NETWORK=testnet \
  --build-arg NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org \
  -t ghcr.io/kingfrankhood/amana/frontend:latest \
  ./frontend

# Push
docker push ghcr.io/kingfrankhood/amana/frontend:latest
```

> **Note:** Both Dockerfiles expect to be run from their respective subdirectory (not the repo root).
> The build context is the service directory itself since each has its own `package.json`.
> A lockfile will be generated during the build process.

> **Registry:** Container images are hosted on GitHub Container Registry (`ghcr.io`).
> If you need Docker Hub images, adjust the image tags in the deployment manifests.

## Monitoring & Debugging

```bash
# Check pod status
kubectl get pods -n amana -w

# View logs
kubectl logs -n amana deployment/backend --tail=100 -f
kubectl logs -n amana deployment/frontend --tail=100 -f

# Port-forward for local access
kubectl port-forward -n amana service/backend-service 4000:4000
kubectl port-forward -n amana service/frontend-service 3000:80

# Describe resources
kubectl describe pod -n amana -l app=backend
