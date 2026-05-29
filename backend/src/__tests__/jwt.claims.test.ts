/**
 * Tests for JWT claims validation helpers (Issue #527)
 *
 * Verifies that validateJwtClaims and assertJwtClaims correctly enforce the
 * presence of required claims before service logic executes.
 */
import { validateJwtClaims, assertJwtClaims, requireWalletAddress } from "../lib/jwtClaims";
import { JWTPayload } from "../services/auth.service";
import { ErrorCode } from "../errors/errorCodes";

const NOW = Math.floor(Date.now() / 1000);

function validPayload(overrides: Partial<JWTPayload> = {}): JWTPayload {
  return {
    sub: "gaddr",
    walletAddress: "GADDR_VALID",
    jti: "test-jti-abc",
    iat: NOW,
    exp: NOW + 86400,
    ...overrides,
  };
}

// ── validateJwtClaims ────────────────────────────────────────────────────────

describe("validateJwtClaims", () => {
  it("returns valid=true for a complete payload", () => {
    const result = validateJwtClaims(validPayload());
    expect(result.valid).toBe(true);
    expect(result.missingClaims).toEqual([]);
  });

  it("returns valid=false and lists 'sub' when sub is missing", () => {
    const { sub: _sub, ...rest } = validPayload();
    const result = validateJwtClaims(rest as Partial<JWTPayload>);
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("sub");
  });

  it("returns valid=false and lists 'walletAddress' when walletAddress is missing", () => {
    const { walletAddress: _w, ...rest } = validPayload();
    const result = validateJwtClaims(rest as Partial<JWTPayload>);
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("walletAddress");
  });

  it("returns valid=false and lists 'jti' when jti is missing", () => {
    const { jti: _jti, ...rest } = validPayload();
    const result = validateJwtClaims(rest as Partial<JWTPayload>);
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("jti");
  });

  it("returns valid=false and lists 'iat' when iat is missing", () => {
    const { iat: _iat, ...rest } = validPayload();
    const result = validateJwtClaims(rest as Partial<JWTPayload>);
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("iat");
  });

  it("returns valid=false and lists 'exp' when exp is missing", () => {
    const { exp: _exp, ...rest } = validPayload();
    const result = validateJwtClaims(rest as Partial<JWTPayload>);
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("exp");
  });

  it("reports all missing claims when multiple claims are absent", () => {
    const result = validateJwtClaims({});
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("sub");
    expect(result.missingClaims).toContain("walletAddress");
    expect(result.missingClaims).toContain("jti");
    expect(result.missingClaims).toContain("iat");
    expect(result.missingClaims).toContain("exp");
  });

  it("treats an empty string walletAddress as missing", () => {
    const result = validateJwtClaims(validPayload({ walletAddress: "" }));
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("walletAddress");
  });

  it("treats an empty string jti as missing", () => {
    const result = validateJwtClaims(validPayload({ jti: "" }));
    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain("jti");
  });

  it("does not mutate the input payload", () => {
    const payload = validPayload();
    const copy = { ...payload };
    validateJwtClaims(payload);
    expect(payload).toEqual(copy);
  });
});

// ── assertJwtClaims ──────────────────────────────────────────────────────────

describe("assertJwtClaims", () => {
  it("does not throw for a complete valid payload", () => {
    expect(() => assertJwtClaims(validPayload())).not.toThrow();
  });

  it("throws AUTH_ERROR (401) when payload is undefined", () => {
    expect(() => assertJwtClaims(undefined)).toThrow(
      expect.objectContaining({
        code: ErrorCode.AUTH_ERROR,
        statusCode: 401,
      })
    );
  });

  it("throws AUTH_ERROR (401) when a required claim is missing", () => {
    const { jti: _jti, ...rest } = validPayload();
    expect(() => assertJwtClaims(rest as Partial<JWTPayload>)).toThrow(
      expect.objectContaining({
        code: ErrorCode.AUTH_ERROR,
        statusCode: 401,
      })
    );
  });

  it("error message names the missing claims", () => {
    const { jti: _jti, ...rest } = validPayload();
    let caught: Error | undefined;
    try {
      assertJwtClaims(rest as Partial<JWTPayload>);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/jti/);
  });

  it("error details contains missingClaims array", () => {
    const { sub: _sub, walletAddress: _w, ...rest } = validPayload();
    let caught: any;
    try {
      assertJwtClaims(rest as Partial<JWTPayload>);
    } catch (e) {
      caught = e;
    }
    expect(caught?.details?.missingClaims).toEqual(
      expect.arrayContaining(["sub", "walletAddress"])
    );
  });
});

// ── requireWalletAddress ─────────────────────────────────────────────────────

describe("requireWalletAddress", () => {
  it("returns the trimmed walletAddress for a valid payload", () => {
    const addr = requireWalletAddress(validPayload({ walletAddress: "  GADDR_VALID  " }));
    expect(addr).toBe("GADDR_VALID");
  });

  it("throws AUTH_ERROR (401) when payload is undefined", () => {
    expect(() => requireWalletAddress(undefined)).toThrow(
      expect.objectContaining({ code: ErrorCode.AUTH_ERROR, statusCode: 401 })
    );
  });

  it("throws AUTH_ERROR (401) when walletAddress is missing", () => {
    const { walletAddress: _w, ...rest } = validPayload();
    expect(() => requireWalletAddress(rest as Partial<JWTPayload>)).toThrow(
      expect.objectContaining({ code: ErrorCode.AUTH_ERROR, statusCode: 401 })
    );
  });

  it("throws AUTH_ERROR (401) when walletAddress is empty", () => {
    expect(() => requireWalletAddress(validPayload({ walletAddress: "" }))).toThrow(
      expect.objectContaining({ code: ErrorCode.AUTH_ERROR, statusCode: 401 })
    );
  });

  it("throws AUTH_ERROR (401) when walletAddress is whitespace only", () => {
    expect(() => requireWalletAddress(validPayload({ walletAddress: "   " }))).toThrow(
      expect.objectContaining({ code: ErrorCode.AUTH_ERROR, statusCode: 401 })
    );
  });
});
