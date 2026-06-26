import {
  CacheError,
  DatabaseError,
  IpfsError,
  StellarError,
  classifyCacheServiceError,
  classifyDatabaseServiceError,
  classifyHorizonResultCode,
  classifyIpfsServiceError,
  classifyStellarServiceError,
} from "../errors/service.errors";

describe("service error classification", () => {
  it("maps Horizon insufficient balance codes to StellarError", () => {
    const error = classifyHorizonResultCode("op_underfunded");

    expect(error).toBeInstanceOf(StellarError);
    expect(error.code).toBe("STELLAR_INSUFFICIENT_BALANCE");
    expect(error.statusCode).toBe(402);
    expect(error.retryable).toBe(false);
  });

  it("maps Stellar not-found errors", () => {
    const error = classifyStellarServiceError({ response: { status: 404 } });

    expect(error.code).toBe("STELLAR_CONTRACT_NOT_FOUND");
    expect(error.statusCode).toBe(404);
    expect(error.retryable).toBe(false);
  });

  it("maps Prisma unique violations to DatabaseError", () => {
    const error = classifyDatabaseServiceError({ code: "P2002" });

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.code).toBe("DATABASE_UNIQUE_CONSTRAINT");
    expect(error.statusCode).toBe(409);
  });

  it("maps IPFS 404 errors to IpfsError", () => {
    const error = classifyIpfsServiceError({ response: { status: 404 } });

    expect(error).toBeInstanceOf(IpfsError);
    expect(error.code).toBe("IPFS_NOT_FOUND");
    expect(error.retryable).toBe(false);
  });

  it("maps Redis/cache timeouts to CacheError", () => {
    const error = classifyCacheServiceError(new Error("redis timeout"));

    expect(error).toBeInstanceOf(CacheError);
    expect(error.code).toBe("CACHE_TIMEOUT");
    expect(error.retryable).toBe(true);
  });

  it("falls back to typed unknown service errors", () => {
    const error = classifyStellarServiceError(new Error("unmodeled provider failure"));

    expect(error).toBeInstanceOf(StellarError);
    expect(error.code).toBe("STELLAR_UNKNOWN_ERROR");
    expect(error.statusCode).toBe(502);
    expect(error.retryable).toBe(true);
  });
});
