# Structured Error Logging & Observability Standards
**Issue Reference:** #1097 No Structured Error Logging for Business Logic Errors

---

## 1. Overview & Objectives
In complex distributed escrow workflows, errors must carry rich, structured context to allow immediate identification and isolation of root causes.

Every business logic error and operational failure in Amana MUST:
1. **Include Structured Business Context**:
   - `tradeId`: Unique ID of the affected escrow/trade (if applicable)
   - `userId` / `actor`: Public key, user UUID, or address triggering the operation
   - `operation`: Logical operation being executed (e.g., `trade.create_pending`, `dispute.resolve`, `escrow.release`)
2. **Carry an Error-Correlation ID**:
   - Every `AppError` generates a distinct `errorCorrelationId` (format `err_<uuid>`)
   - The ID is echoed in the HTTP response header `X-Error-Correlation-Id` and body payload for rapid cross-referencing in log aggregation systems (Loki, Elasticsearch, Datadog).
3. **Use Standard Log Levels**:
   - **`WARN`**: 4xx business rule rejections, client validation errors, expected authorization failures
   - **`ERROR`**: 5xx unhandled exceptions, database timeouts, infrastructure outages, invariant violations

---

## 2. Error Classes & Creating Structured Errors

### 2.1 Throwing `AppError` with Context
```typescript
import { AppError, ErrorCode } from '../errors/errorCodes';

// Method 1: Using fluent context builders
throw new AppError(
  ErrorCode.TRADE_INVALID_STATUS,
  "Trade must be in FUNDED status to submit shipping manifest",
  400
)
  .withTrade(tradeId)
  .withUser(sellerAddress)
  .withOperation("trade.manifest_submit");

// Method 2: Supplying context in details
throw new AppError(
  ErrorCode.DISPUTE_NOT_FOUND,
  "Dispute record not found",
  404,
  {
    tradeId: "TRD-90210",
    userId: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPXD225XZKY5K2SUO",
    operation: "dispute.get_by_id",
  }
);
```

### 2.2 Using `ServiceErrorConverter` for External Dependencies
When calling external infrastructure (Stellar Horizon, IPFS/Pinata, BullMQ, Redis):
```typescript
import { ServiceErrorConverter, ServiceType } from '../errors/serviceErrorConverter';

try {
  await stellarHorizonCall();
} catch (err) {
  throw ServiceErrorConverter.convertToAppError(err, ServiceType.STELLAR, {
    operation: "escrow.fund_stellar_contract",
    tradeId: trade.tradeId,
    userId: trade.buyerAddress,
  });
}
```

---

## 3. Response Schema & Log Format

### 3.1 Client API Response Payload
When an error is returned to the client:
```json
{
  "code": "TRADE_INVALID_STATUS",
  "message": "Trade must be in FUNDED status to submit shipping manifest",
  "details": {
    "tradeId": "TRD-90210",
    "userId": "GA2C5RF...",
    "operation": "trade.manifest_submit"
  },
  "timestamp": "2026-08-30T22:45:00.000Z",
  "errorCorrelationId": "err_550e8400-e29b-41d4-a716-446655440000",
  "tradeId": "TRD-90210",
  "userId": "GA2C5RF...",
  "operation": "POST /api/v1/trades/TRD-90210/manifest",
  "path": "/api/v1/trades/TRD-90210/manifest",
  "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "correlationId": "corr_c12345"
}
```

### 3.2 Structured Pino Log Output (Loki JSON)
```json
{
  "level": 40,
  "time": 1725057900000,
  "errorCorrelationId": "err_550e8400-e29b-41d4-a716-446655440000",
  "code": "TRADE_INVALID_STATUS",
  "message": "Trade must be in FUNDED status to submit shipping manifest",
  "statusCode": 400,
  "tradeId": "TRD-90210",
  "userId": "GA2C5RF...",
  "operation": "POST /api/v1/trades/TRD-90210/manifest",
  "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "correlationId": "corr_c12345",
  "path": "/api/v1/trades/TRD-90210/manifest",
  "method": "POST",
  "msg": "[TRADE_INVALID_STATUS] Business logic error handled"
}
```

---

## 4. Querying Errors in Grafana & Loki

To find all errors associated with a specific trade or user:
- **By Trade ID**:
  ```logql
  {app="amana-backend"} | json | tradeId="TRD-90210"
  ```
- **By User ID**:
  ```logql
  {app="amana-backend"} | json | userId="GA2C5RF..."
  ```
- **By Error Correlation ID (from user bug report or client header)**:
  ```logql
  {app="amana-backend"} | json | errorCorrelationId="err_550e8400-e29b-41d4-a716-446655440000"
  ```

---

## 5. Monitoring Dashboard
The Grafana dashboard at `grafana/provisioning/dashboards/error-monitoring-dashboard.json` (`amana-error-monitoring`) visualizes:
1. Total error rates and 5xx/4xx ratios
2. Error volume categorized by business logic code and external service
3. Top failing routes and operations
4. Direct embedded stream of structured error logs
