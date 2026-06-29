# Security Scanning

Amana runs automated dependency vulnerability scanning on every CI run and provides a local script for ad-hoc scans.

## CI Pipeline

Security audits run in the existing CI jobs (`.github/workflows/ci.yml`) and **fail the build** on any **high** or **critical** severity vulnerability.

| Job | Tool | Command | Fail threshold |
|-----|------|---------|----------------|
| `frontend` | npm audit | `npm audit --audit-level=high` | high + critical |
| `backend` | npm audit | `npm audit --audit-level=high` | high + critical |
| `contracts` | cargo audit | `cargo audit` | any advisory |

Docker image scanning via Trivy can be added once the project ships Dockerfiles (see [docker-profiles.md](docker-profiles.md)).

## Running Scans Locally

```bash
# Run all scanners and write reports to security-reports/
bash scripts/security-scan.sh

# Override report directory
REPORT_DIR=/tmp/my-scan bash scripts/security-scan.sh
```

The script auto-skips tools that are not installed and summarises results in `security-reports/summary.txt`.

## Fixing Vulnerabilities

1. **npm** — Run `npm audit fix` in the affected workspace (`frontend/` or `backend/`). For breaking changes use `npm audit fix --force` and test thoroughly.
2. **cargo** — Update the affected crate in `Cargo.toml` and run `cargo update`.
3. If no fix is available, open a tracking issue and add an advisory exception in `contracts/.cargo/audit.toml` with a justification comment.

## Installing Optional Scanners

```bash
# cargo-audit (Rust advisories)
cargo install cargo-audit --locked

# Trivy (filesystem + container image scanning)
# https://aquasecurity.github.io/trivy/latest/getting-started/installation/
brew install trivy          # macOS
sudo apt install trivy      # Debian/Ubuntu
```
