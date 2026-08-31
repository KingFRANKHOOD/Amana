import type { NextConfig } from "next";

/**
 * Next.js configuration for Amana frontend.
 *
 * Content Security Policy (CSP)
 * ─────────────────────────────
 * The primary, nonce-based CSP is enforced by `src/middleware.ts` which runs
 * on every HTML page response in the Edge runtime. The middleware generates a
 * fresh nonce per request, injects it into the CSP header, and passes it to
 * the React render tree via the `x-nonce` request header so `app/layout.tsx`
 * can attach it to inline <script> tags.
 *
 * The static `headers()` block below sets baseline security headers for
 * paths that bypass the middleware (e.g. /_next/static chunks). These
 * headers intentionally do NOT include a CSP because static assets are not
 * HTML documents and have no scripts to constrain.
 *
 * See docs/SECURITY_HEADERS.md for the full policy rationale.
 */

const nextConfig: NextConfig = {
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },

  experimental: {
    optimizePackageImports: ["@stellar/stellar-sdk", "lucide-react"],
  },

  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
  },

  turbopack: {},

  /**
   * Static security headers applied to all routes.
   *
   * These complement — not replace — the middleware CSP. The middleware
   * sets the full CSP with a per-request nonce; these headers cover baseline
   * hardening for static assets and act as a fallback if the middleware path
   * is ever bypassed.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Deny framing (clickjacking defence)
          { key: "X-Frame-Options", value: "DENY" },
          // HSTS — 1 year, include subdomains
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          // Referrer policy
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Cross-Origin policies
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          // DNS prefetch control
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default async function config() {
  if (process.env.ANALYZE !== "true") {
    return nextConfig;
  }

  const bundleAnalyzerPackage = "@next/bundle-analyzer";
  const withBundleAnalyzer = (await import(bundleAnalyzerPackage)).default({
    enabled: true,
  });
  return withBundleAnalyzer(nextConfig);
}
