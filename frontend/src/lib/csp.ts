/**
 * Pure CSP utility functions — no next/server dependency.
 *
 * Extracted from src/middleware.ts so they can be unit-tested in a jsdom
 * (Jest) environment without requiring the Edge runtime.
 *
 * Consumed by:
 *   - src/middleware.ts  (runtime CSP generation)
 *   - src/__tests__/csp.test.ts (unit tests)
 */

/**
 * Build the Content-Security-Policy header value for a given nonce.
 */
export function buildCsp(nonce: string): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

  const directives: string[] = [
    `default-src 'self'`,
    `script-src 'self' 'strict-dynamic' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https://ipfs.io https://*.pinata.cloud`,
    `connect-src 'self' https://api.stellar.org https://horizon.stellar.org https://horizon-testnet.stellar.org`,
    `font-src 'self'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(apiUrl ? [`report-uri ${apiUrl}/api/v1/csp-violation`] : []),
  ];

  return directives.join("; ");
}

/**
 * Generate a random nonce string (32 hex characters).
 * Uses the Web Crypto API (available in both Node.js ≥18 and the Edge runtime).
 */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
