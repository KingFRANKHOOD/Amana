# E2E Testing Strategy

Amana is a multi-stack monorepo (frontend, backend, mobile, contracts). Each stack has its own E2E layer. This document explains the overall strategy, what is covered today, where the gaps are, and how to add new tests.

---

## Table of Contents

1. [Philosophy and Scope](#1-philosophy-and-scope)
2. [Technology Stack per Layer](#2-technology-stack-per-layer)
3. [Test Locations](#3-test-locations)
4. [Covered Scenarios](#4-covered-scenarios)
5. [Coverage Gaps](#5-coverage-gaps)
6. [Running E2E Tests](#6-running-e2e-tests)
7. [Writing New E2E Tests](#7-writing-new-e2e-tests)
8. [Test-Data Management](#8-test-data-management)
9. [CI/CD Integration](#9-cicd-integration)
10. [Troubleshooting Guide](#10-troubleshooting-guide)

---

## 1. Philosophy and Scope

### What "E2E" means in Amana

E2E tests exercise user-facing flows from the outside — they call real UI or real HTTP endpoints and validate the result without mocking application internals. They sit above integration tests in the pyramid.

| Layer | Scope |
|---|---|
| **Unit** | A single function or class in isolation |
| **Integration** | Multiple modules wired together; external services mocked |
| **E2E** | A complete user flow against a running application; only third-party services (Stellar mainnet, Pinata IPFS) may be stubbed |

### What E2E tests are _not_ responsible for

- Exhaustive input validation (that belongs to unit / integration tests)
- Visual pixel accuracy (covered by `docs/VISUAL_REGRESSION_TESTING.md`)
- Load / performance benchmarks (covered by `k6/`)

### Rule: one E2E test per critical user journey

Keep the E2E suite small and fast. Add a test when:

- A new end-to-end user journey is introduced
- A critical security boundary (authentication, fund release) has no coverage
- A regression has occurred because no E2E existed

---

## 2. Technology Stack per Layer

| Stack | Runner | Config |
|---|---|---|
| **Frontend** | Playwright | `frontend/playwright.config.ts` |
| **Mobile** | Jest + `jest-expo` + `@testing-library/react-native` | `mobile/e2e/jest.e2e.config.cjs` |
| **Backend** | Jest + `supertest` | `backend/jest.config.js` |
| **Contracts** | Rust `cargo test` with Soroban `Env` test harness | `contracts/amana_escrow/Cargo.toml` |

### Why not a single runner for everything?

- The frontend is a browser app — Playwright gives real browser semantics.
- The mobile app cannot run inside a browser — the React Native test library provides device-like rendering.
- The backend is a Node.js HTTP server — supertest calls it in-process, avoiding the overhead of a real server for most tests.
- The smart contract runs on the Soroban VM, which only exists inside the Rust test harness.

---

## 3. Test Locations

```
frontend/
  tests/
    e2e/                        ← Playwright browser E2E tests
      trade-lifecycle.spec.ts
      dispute-resolution.spec.ts
      wallet-connect.spec.ts
    visual/                     ← Visual regression (see VISUAL_REGRESSION_TESTING.md)

mobile/
  e2e/                          ← Device-level E2E tests
    jest.e2e.config.cjs         ← Dedicated Jest config for E2E suite
    trade-creation.e2e.test.ts
    pod-upload.e2e.test.ts
    notifications.e2e.test.ts

backend/
  src/
    __tests__/
      auth.e2e.test.ts          ← Backend auth flow E2E (supertest)

contracts/
  amana_escrow/
    tests/
      dispute_flow.rs           ← Contract-level E2E scenarios
      state_machine_fuzz_tests.rs
      event_emission_tests.rs
```

---

## 4. Covered Scenarios

### 4.1 Frontend E2E (Playwright)

File: `frontend/tests/e2e/`

| Scenario | File | Notes |
|---|---|---|
| Redirect to login when wallet not connected | `wallet-connect.spec.ts` | Validates auth guard |
| Connect Freighter wallet and store JWT in sessionStorage | `wallet-connect.spec.ts` | Mocks Freighter browser extension and `/auth/challenge` + `/auth/verify` endpoints |
| Display wallet address in header once connected | `wallet-connect.spec.ts` | |
| Create a trade (full 3-step form: details → negotiation → review) | `trade-lifecycle.spec.ts` | Mocks backend trade creation endpoint |
| Deposit funds into an existing trade | `trade-lifecycle.spec.ts` | |
| Confirm delivery on a funded trade | `trade-lifecycle.spec.ts` | |
| Initiate a dispute from the vault manage page | `trade-lifecycle.spec.ts` | Asserts request body contains dispute reason |
| Upload Proof-of-Delivery video evidence | `trade-lifecycle.spec.ts` | |
| Complete full trade lifecycle (create → confirm) | `trade-lifecycle.spec.ts` | Smoke test for the happy path |
| Display open disputes on the mediator dashboard | `dispute-resolution.spec.ts` | |
| Resolve a dispute with equal split (50/50) | `dispute-resolution.spec.ts` | Mocks evidence and dispute endpoints |
| Submit evidence via the mediator panel | `dispute-resolution.spec.ts` | |

All frontend E2E tests use **route interception** (`page.route()`) to mock the backend API and Stellar RPC. They do **not** require a running backend.

### 4.2 Mobile E2E (Jest + react-testing-library/react-native)

File: `mobile/e2e/`

| Scenario | File | Notes |
|---|---|---|
| Render create-trade form (step 1) | `trade-creation.e2e.test.ts` | |
| Advance through steps 1 → 2 → 3 with valid inputs | `trade-creation.e2e.test.ts` | Includes loss-ratio and delivery-window fields |
| Back button on step 2 returns to step 1 | `trade-creation.e2e.test.ts` | |
| Submit trade and call `POST /trades` with correct body | `trade-creation.e2e.test.ts` | |
| Disable Continue button when seller address is invalid | `trade-creation.e2e.test.ts` | Validates client-side guard |
| Render evidence capture screen with type selector | `pod-upload.e2e.test.ts` | |
| Switch between video and photo evidence types | `pod-upload.e2e.test.ts` | |
| Show guidance text per evidence type | `pod-upload.e2e.test.ts` | |
| Upload evidence to API and show success | `pod-upload.e2e.test.ts` | |
| Register for push notifications and return token | `notifications.e2e.test.ts` | |
| Return null token when permissions denied | `notifications.e2e.test.ts` | |
| Schedule a local notification with trade metadata | `notifications.e2e.test.ts` | |
| Schedule notification with dispute metadata | `notifications.e2e.test.ts` | |
| Set up foreground notification handler | `notifications.e2e.test.ts` | |
| Handle tap-to-navigate notification response | `notifications.e2e.test.ts` | |

Mobile tests mock `expo-notifications`, `expo-secure-store`, and the API client. They do not require a physical device or emulator.

### 4.3 Backend Auth E2E (supertest)

File: `backend/src/__tests__/auth.e2e.test.ts`

| Scenario | Notes |
|---|---|
| `POST /auth/challenge` returns unique challenge string | |
| `POST /auth/verify` validates Ed25519 signature, returns JWT | Uses real `Keypair` from `@stellar/stellar-sdk` |
| JWT claims: `walletAddress`, `iat`, `exp`, `iss`, `aud`, `jti`, `nbf` | |
| Challenge stored in Redis after `/challenge` call | |
| Replay protection: challenge deleted after first verify | |
| Protected route: valid JWT → 200 + walletAddress extracted | |
| Invalid signature → 401 | |
| Expired JWT → 401 | |
| Missing JWT → 401 | |
| `POST /auth/logout` revokes token; subsequent request → 401 | |
| Rate limiting: 11th request in window → 429 | |

Backend auth tests use an in-memory Redis mock and do not require a running database.

### 4.4 Smart Contract E2E (Rust / Soroban)

File: `contracts/amana_escrow/tests/`

| Scenario | File |
|---|---|
| Full deposit → release flow | `dispute_flow.rs` |
| Full deposit → dispute → split payout | `dispute_flow.rs` |
| State machine transitions under random input | `state_machine_fuzz_tests.rs` |
| Event emission for all contract actions | `event_emission_tests.rs` |
| Buyer cancellation before funding | `buyer_cancel_tests.rs` |
| Trade expiration and deadline extension | `expiration_tests.rs` / `extend_deadline_tests.rs` |
| Upgrade path / version gate | `upgrade_tests.rs` |
| Authorization matrix (who can call what) | `auth_matrix_tests.rs` |
| Property-based randomized inputs | `property_tests.rs` |

Contract tests run inside the Soroban `Env` test harness — no live Stellar network required.

---

## 5. Coverage Gaps

The following critical scenarios have no E2E coverage as of August 2026. They are ordered by business risk.

| Priority | Gap | Suggested Location | Rationale |
|---|---|---|---|
| 🔴 Critical | **Full cross-stack auth flow**: wallet connect → backend JWT → trade create | `frontend/tests/e2e/` | Auth and trade creation each tested in isolation; no test spans both |
| 🔴 Critical | **Stellar Path Payment E2E**: buyer pays in NGN, escrow receives cNGN | `backend/src/__tests__/` | `pathPayment.service.ts` has no test at any level (see TEST_COVERAGE_MATRIX.md) |
| 🔴 Critical | **Trust score update after completed trade** | `backend/src/__tests__/` | `trustScore.service.ts` has unit coverage but no E2E through the trade → settlement → score pipeline |
| 🟠 High | **Mobile: wallet connect + JWT storage** | `mobile/e2e/` | Only native trade creation is tested; wallet auth initiation on mobile is untested |
| 🟠 High | **Contract-to-frontend integration**: contract event → backend listener → UI state update | Full stack | No test validates that a Soroban contract event propagates to the frontend in real time |
| 🟠 High | **Mediator resolution flow** (fund split): dispute → mediator decision → payout XDR signed | `frontend/tests/e2e/` | Mediator dashboard tests check UI display but do not assert the settlement XDR is correctly formed |
| 🟡 Medium | **IPFS evidence round-trip**: upload video → pin on IPFS → retrieve CID from trade | `backend/src/__tests__/` | `ipfs.service.ts` is unit tested with mocks; no test calls a real (or stubbed) IPFS endpoint |
| 🟡 Medium | **Notification deep-link navigation**: tap notification → land on correct trade screen | `mobile/e2e/` | Notification scheduling is tested; tap handling with actual screen navigation is not |
| 🟡 Medium | **Export trade history CSV/PDF** | `backend/src/__tests__/` | `trade.export.routes.test.ts` exists but tests HTTP scaffolding, not the full file generation pipeline |
| 🟡 Medium | **Webhook delivery end-to-end** | `backend/src/__tests__/` | Webhook routes are unit tested; actual HTTP delivery to an external endpoint is not |
| 🟢 Low | **Driver manifest round-trip** | `backend/src/__tests__/` | Manifest service and routes have integration tests; no E2E that mirrors the full form submission |

---

## 6. Running E2E Tests

### Frontend (Playwright)

```bash
cd frontend

# Run all Playwright tests (includes both E2E and visual)
pnpm test:visual

# Run only the E2E tests (excludes *.visual.spec.ts)
npx playwright test tests/e2e/

# Run a single file
npx playwright test tests/e2e/trade-lifecycle.spec.ts

# Run with a visible browser for debugging
npx playwright test tests/e2e/ --headed

# Run against a specific environment
PLAYWRIGHT_BASE_URL=https://staging.amana.app npx playwright test tests/e2e/
```

The frontend E2E tests mock the backend API via `page.route()`. They do **not** require the backend to be running.

### Mobile (Jest + jest-expo)

The mobile package does not yet have a `test:e2e` script. Run E2E tests directly with the dedicated config:

```bash
cd mobile

# Run all E2E tests
npx jest --config e2e/jest.e2e.config.cjs

# Run a specific file
npx jest --config e2e/jest.e2e.config.cjs e2e/trade-creation.e2e.test.ts

# Watch mode
npx jest --config e2e/jest.e2e.config.cjs --watch

# CI mode (single run, JUnit output)
CI=true npx jest --config e2e/jest.e2e.config.cjs
```

> **Tip**: Add a `test:e2e` script to `mobile/package.json` to make this discoverable:
> ```json
> "test:e2e": "jest --config e2e/jest.e2e.config.cjs"
> ```

### Backend (Jest + supertest)

The backend auth E2E test runs as part of the normal test suite because it uses an in-memory Redis mock and does not need the database. For tests that do need the database, start the test infrastructure first:

```bash
# Start ephemeral postgres + redis
./scripts/test-up.sh

# Run all backend tests (including E2E)
cd backend
DATABASE_URL=postgresql://postgres:password@localhost:5433/amana_test \
REDIS_URL=redis://localhost:6381 \
pnpm test

# Run only the auth E2E test
pnpm test -- auth.e2e.test.ts

# Tear down infrastructure
./scripts/test-up.sh --down
```

### Contracts (Rust)

```bash
cd contracts/amana_escrow

# Run all contract tests
cargo test

# Run a specific test file
cargo test --test dispute_flow

# Run with output
cargo test -- --nocapture
```

---

## 7. Writing New E2E Tests

### 7.1 Frontend E2E (Playwright)

#### Step 1 — Create the file

```
frontend/tests/e2e/my-feature.spec.ts
```

#### Step 2 — Write the test

Use the helpers from existing tests (`seedAuthenticatedWallet`, `mockStellarRpc`) to reduce boilerplate.

```typescript
import { expect, test, type Page } from '@playwright/test';

const BUYER_ADDRESS = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';

function testJwt(walletAddress: string) {
  const payload = { exp: Math.floor(Date.now() / 1000) + 3600, walletAddress };
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'e2e',
  ].join('.');
}

async function seedAuthenticatedWallet(page: Page, address = BUYER_ADDRESS) {
  await page.addInitScript(
    ({ token, addr }) => {
      window.sessionStorage.setItem('amana_jwt', token);
      const freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        getAddress: async () => ({ address: addr }),
        requestAccess: async () => ({ address: addr }),
        signMessage: async () => ({ signedMessage: 'signed' }),
        signTransaction: async (xdr: string) => ({ signedTxXdr: `signed-${xdr}` }),
      };
      Object.assign(window, { freighter, freighterApi: freighter });
    },
    { token: testJwt(address), addr: address },
  );
}

test.describe('My Feature', () => {
  test('does the right thing', async ({ page }) => {
    await seedAuthenticatedWallet(page);

    // Mock backend endpoints used by this feature
    await page.route('http://localhost:4000/my-endpoint', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: 'ok' }),
      });
    });

    await page.goto('/my-feature');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Expected content')).toBeVisible();
  });
});
```

#### Best practices

- Use `data-testid` attributes to select elements rather than CSS classes or text that may change.
- Use `page.waitForLoadState('networkidle')` before asserting on API-driven content.
- Use `page.route()` to intercept backend calls; never rely on a running backend.
- Keep each `test.describe` block focused on one user journey.
- Prefer `getByRole` locators for accessibility-friendly selection.
- Disable animations if they cause flakiness: `await page.emulateMedia({ reducedMotion: 'reduce' })`.

#### Step 3 — Run locally

```bash
cd frontend
npx playwright test tests/e2e/my-feature.spec.ts --headed
```

### 7.2 Mobile E2E (Jest)

#### Step 1 — Create the file

```
mobile/e2e/my-feature.e2e.test.ts
```

#### Step 2 — Write the test

```typescript
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

// Mock external dependencies
jest.mock('../src/api/client', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const Stack = createStackNavigator();
const mockApiClient = jest.requireMock('../src/api/client').default;

describe('My Feature E2E', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the screen', () => {
    const MyScreen = require('../src/screens/MyScreen').default;
    const { getByText } = render(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="My" component={MyScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
    expect(getByText('My Screen Title')).toBeTruthy();
  });

  it('calls the API on submit', async () => {
    mockApiClient.post.mockResolvedValueOnce({ data: { id: 'abc' } });

    const MyScreen = require('../src/screens/MyScreen').default;
    const { getByText } = render(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="My" component={MyScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );

    fireEvent.press(getByText('Submit'));

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith('/my-endpoint', expect.any(Object));
    });
  });
});
```

#### Best practices

- Mock `../src/api/client`, `expo-secure-store`, `expo-notifications`, and `react-native-safe-area-context` at the top of every E2E test file.
- Use `waitFor` to handle async state updates.
- Do not mock internal screen components — let them render.
- Test file naming: `*.e2e.test.ts` (matches the Jest config pattern).

### 7.3 Backend E2E (supertest)

Use supertest to call the Express app in-process. The auth E2E test is the canonical example.

```typescript
import request from 'supertest';
import { app } from '../app';

describe('My API flow E2E', () => {
  it('creates a resource and returns it', async () => {
    const res = await request(app)
      .post('/my-resource')
      .set('Authorization', `Bearer ${validJwt}`)
      .send({ name: 'Test' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });
});
```

When your test needs a real database:

1. Start the test stack: `./scripts/test-up.sh`
2. Set `DATABASE_URL` and `REDIS_URL` in your shell before running `pnpm test`.
3. Use `beforeEach` to reset relevant tables (or use transactions that roll back).

### 7.4 Contract E2E (Rust)

Add a new test file under `contracts/amana_escrow/tests/`:

```rust
#[cfg(test)]
mod my_scenario_tests {
    use soroban_sdk::{testutils::Address as _, Address, Env};
    use crate::AmanaEscrow;

    #[test]
    fn test_my_scenario() {
        let env = Env::default();
        let contract_id = env.register_contract(None, AmanaEscrow);
        let client = AmanaEscrowClient::new(&env, &contract_id);

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);

        // Arrange: set up state
        // Act: call contract function
        // Assert: verify state or events
    }
}
```

Register new test files in `contracts/amana_escrow/Cargo.toml` under `[[test]]` if needed, or place them in the existing `tests/` directory which is auto-discovered by Cargo.

---

## 8. Test-Data Management

### 8.1 Frontend: seeded in-browser state

Frontend E2E tests use `page.addInitScript()` to inject a pre-signed JWT and a mock Freighter wallet into the browser's global scope. This avoids a real authentication round-trip.

```typescript
// Inject auth state before page loads
await page.addInitScript(({ token, addr }) => {
  window.sessionStorage.setItem('amana_jwt', token);
  Object.assign(window, { freighter: { getAddress: async () => ({ address: addr }) } });
}, { token: testJwt(BUYER_ADDRESS), addr: BUYER_ADDRESS });
```

API responses are mocked inline with `page.route()`. No shared fixture files are used — this keeps tests isolated and avoids ordering dependencies.

### 8.2 Mobile: mocked API and secure store

Mobile E2E tests inject mock return values at the Jest module level:

```typescript
// In jest.mock() at the top of the file
jest.mock('../src/api/client', () => ({
  default: { post: jest.fn(), get: jest.fn(), ... },
}));

// In beforeEach or the individual test
mockApiClient.post.mockResolvedValueOnce({ data: { tradeId: 'test-001' } });
```

Use `beforeEach(() => jest.clearAllMocks())` to reset mock state between tests.

### 8.3 Backend: ephemeral database

For tests that need real DB access, the `test-up.sh` script starts isolated Docker containers (Postgres on port 5433, Redis on port 6381) so tests never touch the development database.

```bash
./scripts/test-up.sh          # start postgres-test + redis-test
cd backend
pnpm test                      # runs against amana_test database
./scripts/test-up.sh --down   # tear down
```

The `backend/prisma/seed.ts` script can be run after migrations for a baseline data set. For E2E tests that need predictable IDs, create fixtures inside the test's `beforeAll` block and clean up in `afterAll`.

### 8.4 Contracts: deterministic addresses

The Soroban `Env` test harness provides `Address::generate(&env)` to produce deterministic test addresses that are isolated per test environment instance. Each `Env::default()` call gives a fresh, clean environment with no shared state.

### 8.5 Stellar test addresses

Frontend and backend tests share two canonical addresses that appear in multiple test files:

```typescript
// Buyer
const BUYER_ADDRESS  = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';
// Seller
const SELLER_ADDRESS = 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3';
```

These are test-only keypairs with no real funds. Do not use real Stellar mainnet addresses in test files.

### 8.6 Environment variables

E2E tests should not require secrets. If a test file would need a real API key, mock the service instead. For tests that do require environment configuration (e.g., `DATABASE_URL` for backend DB tests), copy values from the example files:

```bash
cd backend && cp .env.example .env
cd frontend && cp .env.example .env.local
cd mobile && cp .env.example .env.local
```

---

## 9. CI/CD Integration

### Current CI behaviour

E2E tests are run as part of the standard stack CI gates defined in `.github/workflows/ci.yml`.

| Stack | CI command | E2E included? |
|---|---|---|
| Frontend | `pnpm test` → Jest unit tests; `pnpm test:visual` → Playwright | Yes — `pnpm test:visual` runs both visual and E2E specs |
| Mobile | `pnpm type-check && pnpm lint` | **No** — mobile E2E tests are not part of the current CI gate |
| Backend | `pnpm test` | Yes — `auth.e2e.test.ts` is in the same Jest run |
| Contracts | `cargo test` | Yes — all test files under `tests/` run |

### Adding mobile E2E to CI

To include mobile E2E in CI, add a `test:e2e` script to `mobile/package.json` and a step to the `mobile` CI job:

```yaml
- name: Mobile E2E tests
  if: matrix.stack == 'mobile'
  run: npx jest --config e2e/jest.e2e.config.cjs
  working-directory: mobile
```

### Playwright report artifact

When frontend tests run in CI, the HTML report is stored in `frontend/playwright-report/`. Add it as a CI artifact to inspect failures:

```yaml
- name: Upload Playwright report
  if: failure() && matrix.stack == 'frontend'
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: frontend/playwright-report/
    retention-days: 7
```

### Test infrastructure for backend DB tests in CI

If you add backend E2E tests that need a real database, use the `test` Docker Compose profile:

```yaml
- name: Start test infrastructure
  run: ./scripts/test-up.sh
  if: matrix.stack == 'backend'

- name: Run backend tests
  run: pnpm test
  working-directory: backend
  if: matrix.stack == 'backend'
  env:
    DATABASE_URL: postgresql://postgres:password@localhost:5433/amana_test
    REDIS_URL: redis://localhost:6381
```

---

## 10. Troubleshooting Guide

### Frontend / Playwright

**Test fails with "Page is still loading" or timeout**

The page likely has pending network requests. Wait explicitly:

```typescript
await page.waitForLoadState('networkidle');
// Or wait for a specific element
await page.waitForSelector('[data-testid="trade-list"]');
```

**`page.route()` handler is never called**

Check the exact URL in the handler matches what the application sends. Use `page.on('request', r => console.log(r.url()))` to inspect outbound requests during debugging.

**Snapshots differ between local and CI**

Visual tests use system fonts. If you see font-related diffs, see `docs/VISUAL_REGRESSION_TESTING.md` for the snapshot update workflow. E2E tests should not use `toHaveScreenshot()` — use text or role assertions instead.

**`freighter is not defined` errors in the browser console**

The `addInitScript` hook must be called _before_ `page.goto()`. Ensure the helper function is awaited before navigation.

**CI Playwright tests run in serial**

CI sets `workers: 1` to ensure consistency (`playwright.config.ts`). Local runs use multiple workers. If a test passes locally but fails in CI, check for shared state across tests.

---

### Mobile / Jest

**`Cannot find module '../src/screens/MyScreen'`**

The Jest config uses `rootDir` pointing to the monorepo root and `roots: ['<rootDir>/e2e']`. Ensure the module path is relative to `mobile/` (the working directory). Also check that `transformIgnorePatterns` in `jest.e2e.config.cjs` allows the relevant Expo packages to be transformed.

**`act(...)` warning about state updates**

Wrap interactions that trigger state updates in `act()`:

```typescript
import { act } from '@testing-library/react-native';

await act(async () => {
  fireEvent.press(getByText('Submit'));
});
```

**Mock not being called / returning undefined**

Ensure `jest.clearAllMocks()` is in `beforeEach`, and that `mockResolvedValueOnce` is set up before the action that triggers the call. Each `Once` mock is consumed after the first call.

---

### Backend / supertest

**`ECONNREFUSED` or port conflict**

The `test-up.sh` script uses ports 5433 (Postgres) and 6381 (Redis) by default to avoid conflicts with the development stack (5432/6379). If those ports are busy, override with environment variables:

```bash
TEST_POSTGRES_PORT=5444 TEST_REDIS_PORT=6389 ./scripts/test-up.sh
```

**`PrismaClientKnownRequestError`: table not found**

Migrations haven't been applied to the test database. Run:

```bash
DATABASE_URL=postgresql://postgres:password@localhost:5433/amana_test \
  npx prisma migrate deploy
```

**JWT validation fails with `invalid signature`**

The auth E2E tests sign challenges with a generated `Keypair`. If you see signature failures, check that the test is using `Keypair.random()` and that the wallet address in the JWT payload matches the address used to generate the challenge.

---

### Contracts / Rust

**`cargo test` fails with `error: failed to run custom build command`**

Install the Soroban target:

```bash
rustup target add wasm32-unknown-unknown
```

**Test panics with `HostError`**

Soroban `HostError` typically means the contract returned an error code. Check the test setup: the calling address must match the role expected by the contract (buyer, seller, or mediator). Use `auth_matrix_tests.rs` as a reference for authorized callers.

**Snapshot tests fail after storage struct changes**

`storage_golden_tests.rs` and `storage_struct_golden_tests.rs` verify that serialized storage layout does not change unexpectedly (migration safety). If you intentionally changed a storage struct, update the golden files by running:

```bash
UPDATE_SNAPSHOTS=1 cargo test storage_golden
```

Then commit both the struct change and the updated snapshot.

---

## Related Documentation

- [Visual Regression Testing](./VISUAL_REGRESSION_TESTING.md)
- [Flaky Tests Policy](./flaky-tests-policy.md)
- [Test Failure Triage Runbook](./runbooks/test-failure-triage.md)
- [Contributor Onboarding Guide](./CONTRIBUTOR_ONBOARDING.md)
- [Architecture Overview](./architecture.md)
- [Backend Quick Start Testing](../backend/QUICK_START_TESTING.md)
- [Sequence Diagrams](./sequence-diagrams.md) — useful for understanding what a given E2E scenario should verify
