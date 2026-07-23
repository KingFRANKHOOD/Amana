## Summary
Resolves issues #873, #872, #870, and #871 across mobile, backend, and frontend packages.

## Changes

### 1. Mobile Dependencies & Testing Framework (#873)
- Updated `axios` to `^1.16.0` to address high-severity vulnerability CVEs.
- Updated `react` to `^19.0.0` and `react-native` to `^0.76.6`.
- Added `@testing-library/react-native` and `@testing-library/jest-native` to `devDependencies`.

### 2. Backend EventListener Outbox Detection (#872)
- Added explicit warning log in `supportsOutboxPersistence()` (`EventListenerService`) when `chainEventOutbox` is unavailable on `PrismaClient` before falling back to non-outbox atomic event processing.

### 3. Frontend Trade Detail Page Rendering & Error Handling (#870)
- Implemented `formatDetails` helper in trade details page to safely render object details without `[object Object]`.
- Created `frontend/src/app/trades/[id]/loading.tsx` skeleton UI component.
- Updated `useTradeDetail` hook to explicitly handle HTTP 404 responses with `"Trade not found"`.

### 4. Frontend Wallet & Auth Hook Refactoring (#871)
- Extracted wallet detection and connection state logic into dedicated `useWalletConnection` hook.
- Composed `useWalletConnection` within `useAuth` while exporting both for modular testing against wallet APIs.

## Validation
- `npm --prefix frontend run test -- --runInBand src/hooks/__tests__/useAuth.test.tsx` (Passed)
- `npm --prefix frontend run test -- --runInBand src/hooks/__tests__/useWalletConnection.test.tsx` (Passed)

closes #873, closes #872, closes #870, closes #871
