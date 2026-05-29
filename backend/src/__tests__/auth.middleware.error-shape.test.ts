import express, { Request, Response } from "express";
import request from "supertest";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthService } from "../services/auth.service";

// Fully control AuthService.validateToken so we can exercise the middleware's
// error-handling branch in isolation.
jest.mock("../services/auth.service", () => ({
  AuthService: { validateToken: jest.fn() },
}));

const mockedValidateToken = AuthService.validateToken as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", authMiddleware, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

describe("authMiddleware — failed-authorization error shape (#545)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("preserves the status code and message of an AppError that fails `instanceof`", async () => {
    // Simulate an AppError that crossed a module/async boundary: it carries the
    // AppError shape (name + statusCode + message) but is not `instanceof AppError`.
    // Before the fix this was masked as a generic 401 "Unauthorized".
    mockedValidateToken.mockRejectedValue({
      name: "AppError",
      statusCode: 503,
      message: "Authentication service dependency failure",
    });

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Bearer some.jwt.token");

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/dependency failure/i);
  });

  it("still surfaces a genuine `instanceof` AppError with its own status and message", async () => {
    const { AppError, ErrorCode } = jest.requireActual("../errors/errorCodes");
    mockedValidateToken.mockRejectedValue(
      new AppError(ErrorCode.AUTH_ERROR, "Unauthorized: token has been revoked", 401)
    );

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Bearer some.jwt.token");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it("masks unexpected non-AppError errors as a generic 401", async () => {
    mockedValidateToken.mockRejectedValue(new Error("unexpected boom"));

    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Bearer some.jwt.token");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });
});
