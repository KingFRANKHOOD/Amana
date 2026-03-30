# Testing Strategy

## Overview
This document outlines testing approaches across frontend, backend, and smart contracts.

---

## Coverage Goals
- Frontend: 70%
- Backend: 80%
- Contract: 90%

---

## Test Types

### Backend
- Unit tests (services, handlers)
- Integration tests (DB + APIs)

### Frontend
- Component tests
- UI interaction tests

### Contract
- Function-level tests
- Edge case coverage

---

## Mocking Strategy
- Stellar RPC: mock responses
- IPFS: stub upload/download
- Freighter: mock wallet provider

---

## Test Data
- Use fixtures for consistent data
- Factories for dynamic test generation

---

## Integration Testing
- Use TestContainers / docker-compose
- Spin up DB + services

---

## E2E Testing
- Start server
- Run flows (auth, transactions, etc.)
- Cleanup after tests

---

## CI/CD
- Tests run via GitHub Actions
- Command: `pnpm test` / `cargo test`

---

## Local Setup
```bash
pnpm install
pnpm test
cargo test
```

Done.
