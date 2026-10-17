/**
 * CSRF Protection Middleware
 *
 * Implements an Origin/Referer header validation strategy suited to a
 * stateless JWT-bearer API.  Cookie-based CSRF tokens (e.g. csurf) are not
 * appropriate here because the API currently does not use cookies for
 * authentication.  Should cookie-based auth ever be introduced, this
 * middleware already provides the guard layer — and this file documents the
 * policy that MUST be followed at that point.
 *
 * ## Protection Strategy
 *
 * For every state-changing HTTP method (POST, PUT, PATCH, DELETE) the
 * middleware validates that the request originates from a permitted host by
 * inspecting the `Origin` and/or `Referer` headers.
 *
 * Rules:
 *  1. Requests with no Origin AND no Referer are allowed by default (covers
 *     legitimate server-to-server calls and curl/Postman clients used during
 *     development).  Set CSRF_ALLOW_MISSING_ORIGIN=false to harden this.
 *  2. If Origin is present, it must match one of the allowed origins
 *     (CORS_ORIGINS env var, same list used by the CORS middleware).
 *  3. If Origin is absent but Referer is present, the Referer host must
 *     match one of the allowed origins.
 *  4. GET, HEAD, and OPTIONS are exempt (safe methods per RFC 7231 §4.2.1).
 *  5. The middleware is gated behind the `CSRF_PROTECTION` feature flag so it
 *     can be enabled incrementally via the admin feature-flag API without a
 *     deployment.
 *
 * ## Cookie Policy (forward-looking)
 *
 * Any auth cookie introduced in the future MUST be set with:
 *   - SameSite=Strict  (or Lax for cross-site navigation flows)
 *   - HttpOnly=true
 *   - Secure=true  (HTTPS only)
 *
 * SameSite alone is a defence-in-depth measure.  It does NOT replace this
 * Origin/Referer check — both layers MUST remain active.
 *
 * See: https://github.com/KingFRANKHOOD/Amana/issues/1024
 */

import type { Request, Response, NextFunction } from "express";
import { featureFlagService } from "../services/feature-flags.service";
import { appLogger } from "../middleware/logger";
import { env } from "../config/env";
import { hasAuthCookie } from "../lib/authCookies";

/** Feature-flag name that controls whether CSRF protection is enforced. */
export const CSRF_FEATURE_FLAG = "CSRF_PROTECTION";

/** HTTP methods that mutate server state and therefore require origin validation. */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Builds the list of allowed origins from the CORS_ORIGINS env variable.
 * Falls back to an empty array (= all origins blocked when allowMissingOrigin
 * is false) so the behaviour is always explicit.
 */
function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? env.CORS_ORIGINS ?? "";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Extracts the origin (scheme + host, no trailing slash) from a full URL
 * string such as a Referer header value.
 *
 * Returns `null` if the value is not a valid absolute URL.
 */
function extractOriginFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Returns true if `requestOrigin` is in the permitted origins list.
 *
 * When `allowedOrigins` is empty the request is allowed only when
 * `CORS_ORIGINS` is unconfigured (development mode), matching the behaviour
 * of the CORS middleware itself.
 */
function isOriginAllowed(requestOrigin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.length === 0) {
    // Permissive — no allow-list configured (development only)
    return true;
  }
  return allowedOrigins.includes(requestOrigin);
}

/**
 * Core validation logic (exported separately to make it unit-testable without
 * needing an HTTP server).
 *
 * @returns null when the request is allowed, or an error string when it
 * should be rejected.
 */
export function validateCsrfOrigin(
  method: string,
  originHeader: string | undefined,
  refererHeader: string | undefined,
  allowedOrigins: string[],
  allowMissingOrigin = true,
): string | null {
  // Safe methods are always exempt.
  if (!STATE_CHANGING_METHODS.has(method.toUpperCase())) {
    return null;
  }

  const origin = originHeader?.trim();
  const referer = refererHeader?.trim();

  // No origin info at all.
  if (!origin && !referer) {
    return allowMissingOrigin
      ? null
      : "CSRF: state-changing request missing Origin and Referer headers";
  }

  // Validate Origin header when present.
  if (origin) {
    return isOriginAllowed(origin, allowedOrigins)
      ? null
      : `CSRF: request origin '${origin}' is not in the allowed origins list`;
  }

  // Fall back to Referer when Origin is absent.
  if (referer) {
    const refererOrigin = extractOriginFromUrl(referer);
    if (!refererOrigin) {
      return `CSRF: malformed Referer header value '${referer}'`;
    }
    return isOriginAllowed(refererOrigin, allowedOrigins)
      ? null
      : `CSRF: referer origin '${refererOrigin}' is not in the allowed origins list`;
  }

  return null;
}

/**
 * Express middleware factory.
 *
 * The middleware checks the `CSRF_PROTECTION` feature flag on every
 * state-changing request.  When the flag is disabled the middleware is a
 * transparent pass-through, allowing zero-downtime activation.
 *
 * @param options.allowMissingOrigin - When `true` (default), requests without
 *   both Origin and Referer headers are allowed.  Set to `false` to require
 *   at least one header on all state-changing requests.
 */
export function csrfProtection(options: { allowMissingOrigin?: boolean } = {}) {
  const { allowMissingOrigin = true } = options;

  return async function csrfMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    // Cookie-authenticated mutations must always be protected. The feature
    // flag continues to support incremental enforcement for bearer clients.
    const cookieAuthenticated = hasAuthCookie(req);
    const flagEnabled = cookieAuthenticated
      ? false
      : await featureFlagService.isEnabled(CSRF_FEATURE_FLAG);
    if (!flagEnabled && !cookieAuthenticated) {
      return next();
    }

    const allowedOrigins = getAllowedOrigins();
    const error = validateCsrfOrigin(
      req.method,
      req.headers["origin"],
      req.headers["referer"],
      allowedOrigins,
      cookieAuthenticated ? false : allowMissingOrigin,
    );

    if (error) {
      appLogger.warn(
        {
          method: req.method,
          path: req.path,
          origin: req.headers["origin"],
          referer: req.headers["referer"],
          ip: req.ip,
        },
        error,
      );
      res.status(403).json({
        code: "CSRF_VIOLATION",
        error: "Forbidden: cross-origin request rejected",
      });
      return;
    }

    return next();
  };
}
