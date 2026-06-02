# Trades API Schema Validation - Issues #669 & #670

## Overview

This document describes the implementation of comprehensive API schema validation tests for the `/trades` endpoints to guard against OpenAPI drift.

## Problem Statement

The `/trades` endpoints needed robust validation tests to ensure that:
1. API response contracts remain consistent with OpenAPI documentation
2. Schema drift is detected early through automated tests
3. Breaking changes to the API are caught before deployment

## Solution

Added 25 comprehensive validation tests in `backend/src/__tests__/openapi.drift.test.ts` that validate:

### 1. Core Schema Definitions

- **TradeMutationResponse**: Validates required fields (tradeId, unsignedXdr)
- **TradeListResponse**: Validates items array and pagination structure
- **TradeSummary**: Validates required trade fields (tradeId, buyerAddress, sellerAddress, amountUsdc, status)
- **TradeMutationRequest**: Validates required fields and constraints
- **UnsignedXdrResponse**: Validates XDR response format
- **TradeStatsResponse**: Validates stats endpoint schema

### 2. Request Validation

- Loss basis points validation (0-10000 range for buyer and seller)
- Amount USDC field accepts both string and number types
- Dispute reason minimum length requirement (10 characters)
- Required fields validation for trade creation

### 3. Response Status Codes

Tests verify correct HTTP status codes for:
- `POST /trades` returns 201 on successful creation
- `GET /trades` returns 200 with TradeListResponse
- `GET /trades/:id` returns 200 with TradeSummary
- `POST /trades/:id/deposit` returns 200 with UnsignedXdrResponse
- `POST /trades/:id/confirm` returns 200 with UnsignedXdrResponse
- `POST /trades/:id/release` returns 200 with UnsignedXdrResponse
- `POST /trades/:id/dispute` returns 200 with UnsignedXdrResponse

### 4. Authentication & Authorization

- All mutation endpoints require `bearerAuth` security scheme
- All endpoints document 401 unauthorized responses
- Security requirements are properly defined in OpenAPI spec

### 5. Related Endpoint Validation

- `/trades/:id/manifest` returns ManifestView
- `/trades/:id/evidence` returns EvidenceListResponse
- `/trades/:id/history` returns AuditHistoryResponse

### 6. Idempotency Support

Tests verify idempotency header support for:
- `POST /trades`
- `POST /trades/:id/deposit`
- `POST /trades/:id/release`
- `POST /trades/:id/dispute`

### 7. Error Response Schemas

- Validates proper error schemas are documented
- Tests AppErrorResponse format for validation errors
- Verifies error responses include proper status codes

### 8. Query Parameters

- Status filter enum validation (CREATED, FUNDED, DISPUTED, etc.)
- Pagination parameters (page, limit, sort)
- Parameter constraints properly documented

## Test Coverage

The implementation adds the following test categories:

1. **Schema Structure Tests** (8 tests)
   - Validate core schema definitions match expected structure
   - Ensure required fields are properly marked

2. **Request/Response Contract Tests** (10 tests)
   - Verify endpoint responses match documented schemas
   - Validate request body requirements

3. **Security Tests** (2 tests)
   - Validate authentication requirements
   - Verify authorization header documentation

4. **Parameter Validation Tests** (3 tests)
   - Validate query parameters
   - Verify path parameters
   - Test parameter constraints

5. **Error Handling Tests** (2 tests)
   - Validate error response formats
   - Verify error status codes

## Files Modified

- `backend/src/__tests__/openapi.drift.test.ts`
  - Added 25 new test cases
  - Updated test suite description to reference #669 and #670
  - Enhanced validation coverage for all /trades endpoints

## Testing

The tests can be run with:

```bash
cd backend
npm test -- openapi.drift.test.ts
```

## Benefits

1. **Early Detection**: Schema drift is caught during CI/CD pipeline
2. **Documentation Accuracy**: Ensures OpenAPI spec matches implementation
3. **API Stability**: Prevents breaking changes to public API contracts
4. **Developer Confidence**: Clear test failures guide developers when making changes
5. **Consumer Protection**: API consumers can trust the documented contracts

## Future Enhancements

Consider adding:
1. Runtime response validation middleware
2. Contract testing with consumer-driven contracts
3. Automated OpenAPI spec generation from code
4. Schema versioning support

## References

- GitHub Issue #669: Audit API schema drift for /trades
- GitHub Issue #670: Audit API schema drift for /trades
- OpenAPI Specification: `backend/src/docs/openapi.yaml`
- Trade Routes: `backend/src/routes/trade.routes.ts`
- Trade Controller: `backend/src/controllers/trade.controller.ts`
