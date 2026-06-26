import { AppError } from "./errorCodes";

export interface ClassifiedServiceErrorOptions {
  code: string;
  message: string;
  httpStatus: number;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class ClassifiedServiceError extends AppError {
  public readonly retryable: boolean;

  constructor(
    public readonly service: "stellar" | "database" | "ipfs" | "cache",
    options: ClassifiedServiceErrorOptions,
  ) {
    super(options.code, options.message, options.httpStatus, {
      service,
      retryable: options.retryable,
      ...(options.details ?? {}),
    });
    this.name = this.constructor.name;
    this.retryable = options.retryable;
  }
}

export class StellarError extends ClassifiedServiceError {
  constructor(options: ClassifiedServiceErrorOptions) {
    super("stellar", options);
  }
}

export class DatabaseError extends ClassifiedServiceError {
  constructor(options: ClassifiedServiceErrorOptions) {
    super("database", options);
  }
}

export class IpfsError extends ClassifiedServiceError {
  constructor(options: ClassifiedServiceErrorOptions) {
    super("ipfs", options);
  }
}

export class CacheError extends ClassifiedServiceError {
  constructor(options: ClassifiedServiceErrorOptions) {
    super("cache", options);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const shaped = error as { message?: unknown; error?: unknown };
    if (typeof shaped.message === "string") return shaped.message;
    if (typeof shaped.error === "string") return shaped.error;
  }
  return "Unknown service error";
}

function responseStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : undefined;
}

function errorCode(error: unknown): string | number | undefined {
  return typeof error === "object" && error !== null
    ? (error as { code?: string | number }).code
    : undefined;
}

export function classifyHorizonResultCode(code: string, error?: unknown): StellarError {
  switch (code) {
    case "op_underfunded":
    case "tx_insufficient_balance":
      return new StellarError({
        code: "STELLAR_INSUFFICIENT_BALANCE",
        message: "Stellar account has insufficient balance",
        httpStatus: 402,
        retryable: false,
        details: { horizonCode: code },
      });
    case "tx_bad_seq":
      return new StellarError({
        code: "STELLAR_BAD_SEQUENCE",
        message: "Stellar transaction sequence is stale",
        httpStatus: 409,
        retryable: true,
        details: { horizonCode: code },
      });
    case "tx_too_late":
    case "tx_too_early":
      return new StellarError({
        code: "STELLAR_TRANSACTION_TIMING",
        message: "Stellar transaction is outside its valid time bounds",
        httpStatus: 409,
        retryable: true,
        details: { horizonCode: code },
      });
    case "op_no_destination":
    case "op_no_trust":
      return new StellarError({
        code: "STELLAR_ACCOUNT_NOT_FOUND",
        message: "Stellar destination account or trustline was not found",
        httpStatus: 404,
        retryable: false,
        details: { horizonCode: code },
      });
    default:
      return new StellarError({
        code: "STELLAR_UNKNOWN_ERROR",
        message: errorMessage(error),
        httpStatus: 502,
        retryable: true,
        details: { horizonCode: code },
      });
  }
}

export function classifyStellarServiceError(error: unknown): StellarError {
  const status = responseStatus(error);
  const code = errorCode(error);
  const message = errorMessage(error);

  if (typeof code === "string" && code.startsWith("tx_")) {
    return classifyHorizonResultCode(code, error);
  }

  if (status === 404 || /not found/i.test(message)) {
    return new StellarError({
      code: "STELLAR_CONTRACT_NOT_FOUND",
      message: "Soroban contract data was not found",
      httpStatus: 404,
      retryable: false,
    });
  }

  if (status === 429 || /rate limit|try_again_later/i.test(message)) {
    return new StellarError({
      code: "STELLAR_RATE_LIMITED",
      message: "Stellar service rate limit exceeded",
      httpStatus: 429,
      retryable: true,
    });
  }

  if (/timeout|timed out|deadline/i.test(message)) {
    return new StellarError({
      code: "STELLAR_TIMEOUT",
      message: "Stellar service timed out",
      httpStatus: 504,
      retryable: true,
    });
  }

  return new StellarError({
    code: "STELLAR_UNKNOWN_ERROR",
    message,
    httpStatus: 502,
    retryable: true,
  });
}

export function classifyDatabaseServiceError(error: unknown): DatabaseError {
  const code = errorCode(error);
  if (code === "P2002") {
    return new DatabaseError({
      code: "DATABASE_UNIQUE_CONSTRAINT",
      message: "Database unique constraint violated",
      httpStatus: 409,
      retryable: false,
    });
  }

  return new DatabaseError({
    code: "DATABASE_UNKNOWN_ERROR",
    message: errorMessage(error),
    httpStatus: 500,
    retryable: false,
  });
}

export function classifyIpfsServiceError(error: unknown): IpfsError {
  const status = responseStatus(error);
  return new IpfsError({
    code: status === 404 ? "IPFS_NOT_FOUND" : "IPFS_UNKNOWN_ERROR",
    message: status === 404 ? "IPFS content was not found" : errorMessage(error),
    httpStatus: status === 404 ? 404 : 502,
    retryable: status !== 404,
  });
}

export function classifyCacheServiceError(error: unknown): CacheError {
  const message = errorMessage(error);
  return new CacheError({
    code: /timeout|timed out/i.test(message) ? "CACHE_TIMEOUT" : "CACHE_UNKNOWN_ERROR",
    message,
    httpStatus: 503,
    retryable: true,
  });
}
