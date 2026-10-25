import { NextRequest, NextResponse } from "next/server";
import { buildCsp, generateNonce } from "@/lib/csp";

/**
 * Content Security Policy + Security Headers middleware (issue #1091).
 *
 * Runs on every HTML page response. Responsibilities:
 *
 * 1. Generate a fresh, cryptographically random nonce on every request.
 * 2. Build a strict nonce-based CSP that allows Next.js App Router inline
 *    bootstrap scripts without requiring `'unsafe-inline'`.
 * 3. Forward the nonce to the React render via the `x-nonce` request header
 *    so `app/layout.tsx` can attach `nonce={nonce}` to the theme-bootstrap
 *    <script> tag.
 * 4. Set the compiled CSP as a response header alongside a full suite of
 *    additional security headers (X-Frame-Options, HSTS, Permissions-Policy,
 *    Referrer-Policy, etc.).
 *
 * All directives mirror the backend's Helmet configuration in
 * `backend/src/app.ts` so both surfaces enforce the same policy.
 *
 * Nonce strategy
 * --------------
 * `'strict-dynamic'` + a per-request nonce is the only reliable way to
 * allow Next.js App Router's generated inline scripts while blocking
 * injected scripts. A hash-based approach is impractical because the hashes
 * change with every build. See:
 * https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
 *
 * Pure helper functions (buildCsp, generateNonce) live in src/lib/csp.ts so
 * they can be unit-tested without requiring the Edge runtime.
 */

export function middleware(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Forward nonce to the React render tree via a request header.
  // layout.tsx reads this with: const nonce = (await headers()).get('x-nonce')
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // ── Security response headers ────────────────────────────────────────────

  // Content Security Policy (primary defence against XSS)
  response.headers.set("Content-Security-Policy", csp);

  // Prevent MIME-type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Deny framing completely (clickjacking defence, belt-and-suspenders with frame-ancestors)
  response.headers.set("X-Frame-Options", "DENY");

  // Legacy XSS filter (for older browsers; harmless on modern ones)
  response.headers.set("X-XSS-Protection", "1; mode=block");

  // Strict Transport Security — 1 year, include subdomains
  // NOTE: only effective over HTTPS; the header is ignored on HTTP.
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload"
  );

  // Referrer policy — send origin only on cross-origin requests
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions Policy — disable all APIs the app does not need.
  response.headers.set(
    "Permissions-Policy",
    [
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "battery=()",
      "camera=()",
      "cross-origin-isolated=()",
      "display-capture=()",
      "document-domain=()",
      "encrypted-media=()",
      "fullscreen=()",
      "geolocation=()",
      "gyroscope=()",
      "keyboard-map=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-get=()",
      "screen-wake-lock=()",
      "sync-xhr=()",
      "usb=()",
      "web-share=()",
      "xr-spatial-tracking=()",
    ].join(", ")
  );

  // Cross-Origin policies (COEP / COOP / CORP)
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");

  // DNS prefetch control
  response.headers.set("X-DNS-Prefetch-Control", "off");

  return response;
}

// ---------------------------------------------------------------------------
// Re-export helpers so tests that import from middleware still work
// ---------------------------------------------------------------------------
export { buildCsp, generateNonce };

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    /*
     * Run on all HTML page requests.
     * Exclude:
     *   - /api/*         → proxied to backend; backend sets its own CSP via Helmet
     *   - /_next/static  → static asset chunks (no HTML)
     *   - /_next/image   → Next.js image optimisation endpoint
     *   - /favicon.ico   → static favicon
     *   - Common static  → fonts, icons, manifests, service-worker
     */
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|js\\.map)).*)",
  ],
};
