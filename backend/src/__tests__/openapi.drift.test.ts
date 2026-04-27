import fs from "fs";
import path from "path";
import request from "supertest";
import YAML from "yamljs";
import { createApp } from "../app";

const SPEC_PATH = path.resolve(__dirname, "../docs/openapi.yaml");

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
}

function loadSpec(): OpenApiSpec {
  const raw = fs.readFileSync(SPEC_PATH, "utf-8");
  return YAML.parse(raw) as OpenApiSpec;
}

// Convert OpenAPI path template (/trades/{id}/history) to a concrete test URL.
function templateToUrl(template: string): string {
  return template.replace(/\{[^}]+\}/g, "test-id");
}

// The set of routes the spec documents.
function specPaths(spec: OpenApiSpec): string[] {
  return Object.keys(spec.paths);
}

// Routes we know are implemented in app.ts (kept in sync manually; test fails if this list
// contains a path not in the spec — that is the "route not documented" direction).
const IMPLEMENTED_ROUTES = [
  "/health",
  "/wallet/balance",
  "/wallet/path-payment-quote",
  "/trades/{id}/history",
  "/trades/{id}/history/verify",
];

describe("OpenAPI drift detection", () => {
  let spec: OpenApiSpec;

  beforeAll(() => {
    spec = loadSpec();
  });

  it("spec file exists and is parseable", () => {
    expect(fs.existsSync(SPEC_PATH)).toBe(true);
    expect(spec).toBeDefined();
    expect(spec.paths).toBeDefined();
  });

  it("every path in the spec is present in the implemented routes list", () => {
    const documented = specPaths(spec);
    const missing = documented.filter((p) => !IMPLEMENTED_ROUTES.includes(p));
    expect(missing).toEqual([]);
  });

  it("every implemented route is documented in the spec", () => {
    const documented = specPaths(spec);
    const undocumented = IMPLEMENTED_ROUTES.filter((r) => !documented.includes(r));
    expect(undocumented).toEqual([]);
  });

  describe("contract-critical endpoint response shapes", () => {
    let app: ReturnType<typeof createApp>;

    beforeAll(() => {
      // Isolate the app instance so database / external services are not hit.
      jest.mock("../middleware/auth.middleware", () => ({
        authMiddleware: (_req: any, _res: any, next: any) => next(),
      }));
      app = createApp();
    });

    it("GET /health returns status and timestamp fields (200 when healthy, 503 when degraded)", async () => {
      const res = await request(app).get("/health");
      // Health endpoint returns 200 (healthy) or 503 (unhealthy/degraded) — both are valid
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty("status");
      expect(res.body).toHaveProperty("timestamp");
    });

    it("GET /wallet/balance without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).get("/wallet/balance");
      expect(res.status).toBe(401);
    });

    it("GET /wallet/path-payment-quote without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).get("/wallet/path-payment-quote");
      expect(res.status).toBe(401);
    });

    it("GET /trades/:id/history without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).get("/trades/test-id/history");
      expect(res.status).toBe(401);
    });
  });
});
