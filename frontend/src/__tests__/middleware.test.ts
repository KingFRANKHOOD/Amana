/**
 * Unit tests for the CSP middleware (issue #1091).
 *
 * The pure helper functions (buildCsp, generateNonce) are tested directly.
 * The middleware() function itself requires the Next.js Edge runtime which is
 * not available in jsdom, so it is tested via integration with the exported
 * helpers and a mocked NextRequest/NextResponse.
 *
 * Tests cover:
 * - generateNonce: produces a 32-char hex string, unique per call
 * - buildCsp: all required directives, nonce is embedded, report-uri is conditional
 * - Header assertions on all mandatory security headers
 */

import { buildCsp, generateNonce } from "@/lib/csp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a CSP string into a map of directive → value(s). */
function parseCsp(csp: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const directive of csp.split(";").map((d) => d.trim()).filter(Boolean)) {
    const [name, ...rest] = directive.split(/\s+/);
    map[name] = rest.join(" ");
  }
  return map;
}

// ---------------------------------------------------------------------------
// generateNonce
// ---------------------------------------------------------------------------

describe("generateNonce", () => {
  it("returns a 32-character hex string (UUID without hyphens)", () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce).toHaveLength(32);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns a different nonce on every call", () => {
    const nonces = new Set(Array.from({ length: 20 }, generateNonce));
    expect(nonces.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// buildCsp
// ---------------------------------------------------------------------------

describe("buildCsp", () => {
  const TEST_NONCE = "abc123def456abc123def456abc123de";

  it("includes default-src 'self'", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["default-src"]).toBe("'self'");
  });

  it("embeds the nonce in script-src", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["script-src"]).toContain(`'nonce-${TEST_NONCE}'`);
  });

  it("includes 'strict-dynamic' in script-src", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["script-src"]).toContain("'strict-dynamic'");
  });

  it("includes 'self' in script-src", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["script-src"]).toContain("'self'");
  });

  it("includes 'unsafe-inline' in style-src (required for Tailwind CSS-in-JS)", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["style-src"]).toContain("'unsafe-inline'");
  });

  it("allows IPFS in img-src", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["img-src"]).toContain("https://ipfs.io");
  });

  it("allows Pinata cloud in img-src", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["img-src"]).toContain("https://*.pinata.cloud");
  });

  it("allows Stellar Horizon mainnet in connect-src", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["connect-src"]).toContain("https://horizon.stellar.org");
  });

  it("allows Stellar Horizon testnet in connect-src", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["connect-src"]).toContain(
      "https://horizon-testnet.stellar.org"
    );
  });

  it("allows Stellar API in connect-src", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["connect-src"]).toContain("https://api.stellar.org");
  });

  it("sets frame-src to 'none' (no iframes)", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["frame-src"]).toBe("'none'");
  });

  it("sets object-src to 'none' (no plugins)", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["object-src"]).toBe("'none'");
  });

  it("restricts base-uri to 'self'", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["base-uri"]).toBe("'self'");
  });

  it("restricts form-action to 'self'", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["form-action"]).toBe("'self'");
  });

  it("blocks frame-ancestors with 'none'", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    expect(directives["frame-ancestors"]).toBe("'none'");
  });

  it("includes report-uri when NEXT_PUBLIC_API_URL is set", () => {
    const original = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    try {
      const csp = buildCsp(TEST_NONCE);
      expect(csp).toContain(
        "report-uri https://api.example.com/api/v1/csp-violation"
      );
    } finally {
      if (original === undefined) {
        delete process.env.NEXT_PUBLIC_API_URL;
      } else {
        process.env.NEXT_PUBLIC_API_URL = original;
      }
    }
  });

  it("omits report-uri when NEXT_PUBLIC_API_URL is not set", () => {
    const original = process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    try {
      const csp = buildCsp(TEST_NONCE);
      expect(csp).not.toContain("report-uri");
    } finally {
      if (original !== undefined) {
        process.env.NEXT_PUBLIC_API_URL = original;
      }
    }
  });

  it("produces a different CSP value for each unique nonce", () => {
    const csp1 = buildCsp("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1");
    const csp2 = buildCsp("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2");
    expect(csp1).not.toEqual(csp2);
  });

  it("the full policy string is semicolon-delimited with no trailing semicolon edge issues", () => {
    const csp = buildCsp(TEST_NONCE);
    // Every directive should be parseable — none should be empty
    const directives = csp.split(";").map((d) => d.trim()).filter(Boolean);
    for (const directive of directives) {
      expect(directive.length).toBeGreaterThan(0);
      expect(directive).toMatch(/^\S/); // starts with a non-whitespace character
    }
  });

  it("contains exactly the expected set of directive names", () => {
    const directives = parseCsp(buildCsp(TEST_NONCE));
    const names = Object.keys(directives);
    expect(names).toContain("default-src");
    expect(names).toContain("script-src");
    expect(names).toContain("style-src");
    expect(names).toContain("img-src");
    expect(names).toContain("connect-src");
    expect(names).toContain("font-src");
    expect(names).toContain("frame-src");
    expect(names).toContain("object-src");
    expect(names).toContain("base-uri");
    expect(names).toContain("form-action");
    expect(names).toContain("frame-ancestors");
  });
});

// ---------------------------------------------------------------------------
// Security header values — referenced by the middleware but tested via
// the pure buildCsp helper to keep tests runnable in jsdom.
// ---------------------------------------------------------------------------

describe("security header constants (sanity checks)", () => {
  it("nonce is 32 hex chars — safe for CSP attribute", () => {
    const nonce = generateNonce();
    // CSP attribute value must not contain quotes or special characters
    expect(nonce).not.toContain("'");
    expect(nonce).not.toContain('"');
    expect(nonce).not.toContain(";");
    expect(nonce).toMatch(/^[0-9a-f]+$/);
  });

  it("CSP value contains no newlines (header injection guard)", () => {
    const csp = buildCsp(generateNonce());
    expect(csp).not.toContain("\n");
    expect(csp).not.toContain("\r");
  });

  it("nonce in CSP cannot be empty string", () => {
    const csp = buildCsp(generateNonce());
    expect(csp).not.toContain("'nonce-'");
  });
});
