/**
 * Unit tests for the frontend security middleware (src/proxy.ts).
 *
 * Issue #1092 — Frontend Missing X-Frame-Options Header. The middleware is
 * wired up via Next.js 16's proxy convention (the successor to middleware.ts)
 * so that every HTML response is protected against clickjacking with
 * `X-Frame-Options: DENY` and a CSP `frame-ancestors 'none'` directive.
 *
 * These tests lock in the clickjacking protections and exercise the edge
 * cases around nonce generation and the CSP violation-report endpoint.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { config, proxy } from "@/proxy";

/**
 * Runtime shim for `NextResponse.next`. Next.js middleware can't boot under
 * plain jsdom, so we swap in a minimal double that records the forwarded
 * request headers and exposes a `Headers` map for asserting the response
 * security headers.
 */
const mockNext = jest.fn<
  { headers: Headers; _nextInput?: { request?: { headers: Headers } } },
  [{ request?: { headers: Headers } }]
>();

jest.mock("next/server", () => {
  return {
    NextRequest: class {},
    NextResponse: class NextResponseMock {
      headers!: Headers;
      _nextInput?: { request?: { headers: Headers } };
      static next(input?: { request?: { headers: Headers } }) {
        mockNext(input);
        const instance = new (this as unknown as typeof NextResponseMock)();
        instance.headers = new Headers();
        instance._nextInput = input;
        return instance;
      }
    },
  };
});

const HEX_32 = /^[0-9a-f]{32}$/;

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  const h = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    h.set(key, value);
  }
  return { headers: h } as unknown as NextRequest;
}

function responseHeaders(result: NextResponse): Headers {
  return (result as unknown as { headers: Headers }).headers;
}

function forwardedRequestHeaders(result: NextResponse): Headers | undefined {
  return (result as unknown as { _nextInput?: { request?: { headers: Headers } } })
    ?._nextInput?.request?.headers;
}

describe("proxy security middleware (issue #1092)", () => {
  let nonceCounter = 0;
  const mockUuid = jest.fn(() => {
    nonceCounter += 1;
    return nonceCounter.toString(16).padStart(32, "0");
  });

  const originalCrypto = globalThis.crypto;

  beforeEach(() => {
    mockNext.mockClear();
    mockUuid.mockClear();
    nonceCounter = 0;
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: mockUuid },
      configurable: true,
    });
    delete process.env.NEXT_PUBLIC_API_URL;
  });

  afterAll(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
  });

  describe("clickjacking protection headers", () => {
    it("sets X-Frame-Options: DENY", () => {
      const result = proxy(makeRequest());

      expect(responseHeaders(result).get("X-Frame-Options")).toBe("DENY");
    });

    it("sets CSP frame-ancestors 'none' on the response", () => {
      const result = proxy(makeRequest());
      const csp = responseHeaders(result).get("Content-Security-Policy") ?? "";

      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("frame-src 'none'");
    });

    it("emits the full set of hardening headers", () => {
      const headers = responseHeaders(proxy(makeRequest()));

      expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headers.get("X-XSS-Protection")).toBe("1; mode=block");
      expect(headers.get("X-Frame-Options")).toBe("DENY");
      expect(headers.get("Content-Security-Policy")).toContain(
        "default-src 'self'",
      );
      expect(headers.get("Content-Security-Policy")).toContain(
        "object-src 'none'",
      );
      expect(headers.get("Content-Security-Policy")).toContain(
        "base-uri 'self'",
      );
      expect(headers.get("Content-Security-Policy")).toContain(
        "form-action 'self'",
      );
    });
  });

  describe("script nonce", () => {
    it("generates a 32-char lowercase hex nonce and pins it in script-src", () => {
      const result = proxy(makeRequest());
      const csp = responseHeaders(result).get("Content-Security-Policy") ?? "";

      const nonce = mockUuid.mock.results[0].value as string;
      expect(nonce).toMatch(HEX_32);
      expect(csp).toContain(`'strict-dynamic' 'nonce-${nonce}'`);
    });

    it("forwards the nonce to the request as x-nonce", () => {
      const result = proxy(makeRequest());
      const forwarded = forwardedRequestHeaders(result);

      const nonce = mockUuid.mock.results[0].value as string;
      expect(forwarded?.get("x-nonce")).toBe(nonce);
    });

    it("generates a unique nonce per request (blocks nonce reuse)", () => {
      const first = proxy(makeRequest());
      const second = proxy(makeRequest());

      const firstNonce = mockUuid.mock.results[0].value as string;
      const secondNonce = mockUuid.mock.results[1].value as string;
      expect(firstNonce).not.toBe(secondNonce);
      expect(
        responseHeaders(first).get("Content-Security-Policy"),
      ).toContain(firstNonce);
      expect(
        responseHeaders(second).get("Content-Security-Policy"),
      ).toContain(secondNonce);
    });
  });

  describe("request header forwarding", () => {
    it("sets content-security-policy on the forwarded request headers", () => {
      const result = proxy(makeRequest());
      const forwarded = forwardedRequestHeaders(result);

      expect(forwarded?.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
    });

    it("preserves pre-existing request header casing", () => {
      const result = proxy(makeRequest({ "x-forwarded-for": "10.0.0.1" }));
      const forwarded = forwardedRequestHeaders(result);

      expect(forwarded?.get("x-forwarded-for")).toBe("10.0.0.1");
    });
  });

  describe("CSP violation report endpoint (edge cases)", () => {
    it("points report-uri at the API endpoint when NEXT_PUBLIC_API_URL is set", () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.amana.example";

      const csp = responseHeaders(proxy(makeRequest())).get(
        "Content-Security-Policy",
      );
      expect(csp).toContain(
        "report-uri https://api.amana.example/api/v1/csp-violation",
      );
    });

    it("falls back to a path-relative report-uri when NEXT_PUBLIC_API_URL is empty", () => {
      // Edge case: env var present but undefined/empty string.
      process.env.NEXT_PUBLIC_API_URL = "";

      const csp = responseHeaders(proxy(makeRequest())).get(
        "Content-Security-Policy",
      );
      expect(csp).toContain("report-uri /api/v1/csp-violation");
    });

    it("falls back to a path-relative report-uri when NEXT_PUBLIC_API_URL is missing", () => {
      // Edge case: env var is entirely unset -> `?? ""` must not throw.
      const csp = responseHeaders(proxy(makeRequest())).get(
        "Content-Security-Policy",
      );
      expect(csp).toContain("report-uri /api/v1/csp-violation");
    });
  });

  describe("middleware matcher", () => {
    it("excludes API and static asset requests from the proxy", () => {
      const matchers = Array.isArray(config.matcher)
        ? config.matcher
        : [config.matcher];
      const all = matchers.join(" ");

      expect(all).toContain("api");
      expect(all).toContain("_next/static");
      expect(all).toContain("_next/image");
      expect(all).toContain("favicon.ico");
    });
  });
});