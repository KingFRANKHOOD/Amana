export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTH_ERROR = "AUTH_ERROR",
  DOMAIN_ERROR = "DOMAIN_ERROR",
  INFRA_ERROR = "INFRA_ERROR",
  NOT_FOUND = "NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public message: string,
    public statusCode: number = 400,
    public details: any = {}
  ) {
    super(message);
    this.name = "AppError";
  }
}
