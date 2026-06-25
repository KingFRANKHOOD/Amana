import { classifyStellarError, StellarErrorCategory } from "../services/stellar.service";

describe("classifyStellarError", () => {
  it("classifies timeout errors with ETIMEDOUT code", () => {
    const error = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" });
    const result = classifyStellarError(error);
    expect(result.category).toBe("timeout");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies timeout errors with ECONNABORTED code", () => {
    const error = Object.assign(new Error("socket hang up"), { code: "ECONNABORTED" });
    const result = classifyStellarError(error);
    expect(result.category).toBe("timeout");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies timeout errors by message pattern", () => {
    const error = new Error("Request timeout after 30000ms");
    const result = classifyStellarError(error);
    expect(result.category).toBe("timeout");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies deadline exceeded as timeout", () => {
    const error = new Error("deadline exceeded after 10s");
    const result = classifyStellarError(error);
    expect(result.category).toBe("timeout");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies connection refused errors", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const result = classifyStellarError(error);
    expect(result.category).toBe("connection_refused");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies 404 errors as not found", () => {
    const error = { response: { status: 404 } };
    const result = classifyStellarError(error);
    expect(result.category).toBe("not_found");
    expect(result.isRetryable).toBe(false);
  });

  it("classifies rate limit errors (429)", () => {
    const error = { response: { status: 429 } };
    const result = classifyStellarError(error);
    expect(result.category).toBe("rate_limited");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies TRY_AGAIN_LATER as rate limited", () => {
    const error = new Error("TRY_AGAIN_LATER");
    const result = classifyStellarError(error);
    expect(result.category).toBe("rate_limited");
    expect(result.isRetryable).toBe(true);
  });

  it("classifies invalid XDR errors", () => {
    const error = new Error("Invalid transaction XDR format");
    const result = classifyStellarError(error);
    expect(result.category).toBe("invalid_xdr");
    expect(result.isRetryable).toBe(false);
  });

  it("classifies contract panic errors", () => {
    const error = new Error("Contract Panic: escrow_locked");
    const result = classifyStellarError(error);
    expect(result.category).toBe("contract_panic");
    expect(result.isRetryable).toBe(false);
  });

  it("classifies RPC errors", () => {
    const error = new Error("RPC Error: 503");
    const result = classifyStellarError(error);
    expect(result.category).toBe("rpc_error");
    expect(result.isRetryable).toBe(false);
  });

  it("classifies unknown errors as network_error", () => {
    const error = new Error("something unexpected happened");
    const result = classifyStellarError(error);
    expect(result.category).toBe("network_error");
    expect(result.isRetryable).toBe(true);
  });

  it("handles non-Error inputs", () => {
    const result = classifyStellarError("string error");
    expect(result.category).toBe("network_error");
    expect(result.isRetryable).toBe(true);
  });
});
