import { test, expect } from "@playwright/test";

/**
 * Clickjacking / security-header verification for issue #1092.
 *
 * Verifies that HTML responses from the Next.js app carry the security
 * headers added by the proxy middleware (frontend/src/proxy.ts): an
 * `X-Frame-Options: DENY` header and a Content-Security-Policy with
 * `frame-ancestors 'none'`. Together these tell browsers not to render
 * Amana pages inside an iframe on a third-party origin, which is the
 * defence against clickjacking / UI-redressing attacks.
 *
 * The headers are applied by middleware before the route handler runs, so
 * we assert on the headers rather than on the page status code. This keeps
 * the test deterministic whether or not the surrounding services (and thus
 * the page's SSR data) are available in a given CI job.
 */
function assertClickjackingProtection(csp: string | undefined): void {
  expect(csp ?? "").toContain("frame-ancestors 'none'");
  // Defence-in-depth: also forbid framing via the old `frame-src` directive.
  expect(csp ?? "").toContain("frame-src 'none'");
}

test.describe("Security headers (issue #1092)", () => {
  test("home page blocks iframe embedding via X-Frame-Options and CSP", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response).not.toBeNull();
    const headers = await response!.allHeaders();

    // Clickjacking: the primary defence instructs the browser to refuse
    // embedding in any frame.
    expect(headers["x-frame-options"]).toBe("DENY");

    // Defence-in-depth: CSP frame-ancestors 'none' (modern browsers).
    assertClickjackingProtection(headers["content-security-policy"]);

    // Headers set by the same middleware for completeness.
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-xss-protection"]).toBe("1; mode=block");
  });

  test("secondary route also sends clickjacking protections", async ({
    page,
  }) => {
    const response = await page.goto("/offline");
    expect(response).not.toBeNull();
    const headers = await response!.allHeaders();

    expect(headers["x-frame-options"]).toBe("DENY");
    assertClickjackingProtection(headers["content-security-policy"]);
  });

  test("every script gets the middleware nonce (strict CSP is functional)", async ({
    page,
  }) => {
    // If the nonce didn't reach the layout, the theme bootstrap inline
    // script would be blocked by the strict CSP and the page would fail
    // to hydrate. At minimum, the response must expose a script-src nonce.
    const response = await page.goto("/");
    expect(response).not.toBeNull();
    const csp = (await response!.allHeaders())["content-security-policy"] ?? "";

    // strict-dynamic ensures Next.js bootstrap can run under the nonce.
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toMatch(/nonce-[0-9a-f]{32}/);
  });
});