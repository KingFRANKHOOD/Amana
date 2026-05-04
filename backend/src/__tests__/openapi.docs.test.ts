import fs from "fs";
import path from "path";

const YAML = require("yamljs");

type OpenApiOperation = {
  security?: Array<Record<string, unknown>>;
  parameters?: Array<{ name?: string; in?: string }>;
};

type OpenApiPathItem = Partial<Record<"get" | "post" | "put" | "delete" | "patch", OpenApiOperation>>;

describe("OpenAPI documentation coverage", () => {
  const docsDir = path.join(__dirname, "..", "docs");
  const yamlPath = path.join(docsDir, "openapi.yaml");
  const jsonPath = path.join(docsDir, "openapi.json");
  const spec = YAML.load(yamlPath) as { paths: Record<string, OpenApiPathItem> };
  const jsonSpec = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    paths: Record<string, OpenApiPathItem>;
  };

  const liveRouteMap: Record<string, Array<keyof OpenApiPathItem>> = {
    "/health": ["get"],
    "/health/live": ["get"],
    "/health/ready": ["get"],
    "/auth/challenge": ["post"],
    "/auth/verify": ["post"],
    "/auth/logout": ["post"],
    "/wallet/balance": ["get"],
    "/wallet/path-payment-quote": ["get"],
    "/users/me": ["get", "put"],
    "/users/{address}": ["get"],
    "/trades": ["get", "post"],
    "/trades/stats": ["get"],
    "/trades/{id}": ["get"],
    "/trades/{id}/deposit": ["post"],
    "/trades/{id}/confirm": ["post"],
    "/trades/{id}/release": ["post"],
    "/trades/{id}/dispute": ["post"],
    "/trades/{id}/manifest": ["get", "post"],
    "/trades/{id}/evidence": ["get"],
    "/evidence/{cid}/stream": ["get"],
    "/evidence/video": ["post"],
    "/trades/{id}/history": ["get"],
    "/trades/{id}/history/verify": ["get"],
    "/goals": ["get"],
  };

  const protectedOperations = [
    ["/auth/logout", "post"],
    ["/wallet/balance", "get"],
    ["/wallet/path-payment-quote", "get"],
    ["/users/me", "get"],
    ["/users/me", "put"],
    ["/trades", "get"],
    ["/trades", "post"],
    ["/trades/stats", "get"],
    ["/trades/{id}", "get"],
    ["/trades/{id}/deposit", "post"],
    ["/trades/{id}/confirm", "post"],
    ["/trades/{id}/release", "post"],
    ["/trades/{id}/dispute", "post"],
    ["/trades/{id}/manifest", "get"],
    ["/trades/{id}/manifest", "post"],
    ["/trades/{id}/evidence", "get"],
    ["/evidence/{cid}/stream", "get"],
    ["/evidence/video", "post"],
    ["/trades/{id}/history", "get"],
    ["/trades/{id}/history/verify", "get"],
    ["/goals", "get"],
  ] as const;

  const idempotentOperations = [
    ["/trades", "post"],
    ["/trades/{id}/deposit", "post"],
    ["/trades/{id}/release", "post"],
    ["/trades/{id}/dispute", "post"],
    ["/evidence/video", "post"],
  ] as const;

  it("documents every live backend endpoint under backend/src/routes", () => {
    for (const [route, methods] of Object.entries(liveRouteMap)) {
      expect(spec.paths[route]).toBeDefined();

      for (const method of methods) {
        expect(spec.paths[route]?.[method]).toBeDefined();
      }
    }
  });

  it("marks every protected endpoint with bearer authentication", () => {
    for (const [route, method] of protectedOperations) {
      expect(spec.paths[route]?.[method]?.security).toEqual([{ bearerAuth: [] }]);
    }
  });

  it("documents idempotency header support for mutation endpoints that use the middleware", () => {
    for (const [route, method] of idempotentOperations) {
      const parameters = spec.paths[route]?.[method]?.parameters ?? [];
      expect(
        parameters.some((parameter) => parameter.in === "header" && parameter.name === "Idempotency-Key"),
      ).toBe(true);
    }
  });

  it("keeps openapi.json in sync with openapi.yaml", () => {
    expect(jsonSpec).toEqual(spec);
  });
});
