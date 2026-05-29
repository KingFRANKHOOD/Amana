/**
 * JWT claims validation helpers.
 *
 * Centralises pre-service claim checks so route handlers and service methods
 * can validate required JWT fields before executing business logic, rather than
 * scattering individual `if (!payload.xyz)` guards across files.
 */

import { AppError, ErrorCode } from "../errors/errorCodes";
import { JWTPayload } from "../services/auth.service";

export interface ClaimsValidationResult {
  valid: boolean;
  missingClaims: string[];
}

/** Required claims that every authenticated request must carry. */
const REQUIRED_CLAIMS: ReadonlyArray<keyof JWTPayload> = [
  "sub",
  "walletAddress",
  "jti",
  "iat",
  "exp",
];

/**
 * Validates that all required claims are present and non-empty on a decoded
 * JWT payload.  Returns a result object so callers can inspect which claims
 * failed without catching an exception.
 */
export function validateJwtClaims(payload: Partial<JWTPayload>): ClaimsValidationResult {
  const missingClaims: string[] = [];

  for (const claim of REQUIRED_CLAIMS) {
    const value = payload[claim];
    if (value === undefined || value === null || value === "") {
      missingClaims.push(claim);
    }
  }

  return { valid: missingClaims.length === 0, missingClaims };
}

/**
 * Asserts that all required JWT claims are present.
 * Throws AUTH_ERROR (401) with the list of missing claims when validation fails.
 * Intended to be called at the top of service methods that require an
 * authenticated caller, before any database access.
 */
export function assertJwtClaims(payload: Partial<JWTPayload> | undefined): asserts payload is JWTPayload {
  if (!payload) {
    throw new AppError(ErrorCode.AUTH_ERROR, "Unauthorized: missing JWT payload", 401);
  }

  const { valid, missingClaims } = validateJwtClaims(payload);
  if (!valid) {
    throw new AppError(
      ErrorCode.AUTH_ERROR,
      `Unauthorized: missing required JWT claims: ${missingClaims.join(", ")}`,
      401,
      { missingClaims }
    );
  }
}

/**
 * Extracts and validates the walletAddress claim from a request's JWT payload.
 * Throws AUTH_ERROR (401) when the claim is absent or empty.
 */
export function requireWalletAddress(payload: Partial<JWTPayload> | undefined): string {
  assertJwtClaims(payload);
  const addr = payload.walletAddress.trim();
  if (!addr) {
    throw new AppError(ErrorCode.AUTH_ERROR, "Unauthorized: walletAddress claim is empty", 401);
  }
  return addr;
}
