import fs from "fs";
import path from "path";

const YAML = require("yamljs");

type OpenApiOperation = {
  security?: Array<Record<string, unknown>>;
  parameters?: Array<{ name?: string; in?: string; $ref?: string }>;
};

type OpenApiPathItem = Partial<
  Record<"get" | "post" | "put" | "delete" | "patch", OpenApiOperation>
>;

describe("OpenAPI documentation coverage", () => {
  const docsDir = path.join(__dirname, "..", "docs");
  const yamlPath = path.join(docsDir, "openapi.yaml");
  const jsonPath = path.join(docsDir, "openapi.json");
  const spec = YAML.load(yamlPath) as {
    paths: Record<string, OpenApiPathItem>;
  };
  const jsonSpec = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    paths: Record<string, OpenApiPathItem>;
  };

  function resolvesHeaderParameter(
    parameter: { name?: string; in?: string; $ref?: string },
    name: string,
  ) {
    if (parameter.in === "header" && parameter.name === name) {
      return true;
    }

    const refName = parameter.$ref?.replace("#/components/parameters/", "");
    return refName === name || refName === `${name.replace(/-/g, "")}Header`;
  }

  const liveRouteMap: Record<string, Array<keyof OpenApiPathItem>> = {
    "/health": ["get"],
    "/health/live": ["get"],
    "/health/ready": ["get"],
    "/health/startup": ["get"],
    "/health/detail": ["get"],
    "/metrics-info": ["get"],
    "/auth/challenge": ["post"],
    "/auth/verify": ["post"],
    "/auth/logout": ["post"],
    "/auth/refresh": ["post"],
    "/auth/validate": ["get"],
    "/wallet/balance": ["get"],
    "/wallet/path-payment-quote": ["get"],
    "/users/me": ["get", "put"],
    "/users/me/reputation": ["get"],
    "/users/me/trust-score": ["get"],
    "/users/{address}": ["get"],
    "/users/{address}/reputation": ["get"],
    "/users/{address}/trust-score": ["get"],
    "/notifications/preferences": ["get", "put"],
    "/notifications": ["get"],
    "/notifications/{id}/read": ["patch"],
    "/notifications/read-all": ["post"],
    "/disputes": ["get"],
    "/disputes/{id}/transition": ["post"],
    "/dispute-categories": ["get", "post"],
    "/dispute-categories/{id}": ["get", "patch", "delete"],
    "/trades": ["get", "post"],
    "/trades/export": ["get"],
    "/trades/templates": ["get", "post"],
    "/trades/from-template/{templateId}": ["post"],
    "/trades/watched": ["get"],
    "/trades/stats": ["get"],
    "/trades/{id}": ["get"],
    "/trades/{id}/watch": ["post", "delete"],
    "/trades/{id}/deposit": ["post"],
    "/trades/{id}/confirm": ["post"],
    "/trades/{id}/release": ["post"],
    "/trades/{id}/dispute": ["post"],
    "/trades/{id}/notes": ["get", "post"],
    "/trades/{id}/schedule": ["get", "post"],
    "/trades/{id}/manifest": ["get", "post"],
    "/trades/{id}/evidence": ["get"],
    "/evidence/{cid}/stream": ["get"],
    "/evidence/video": ["post"],
    "/trades/{id}/history": ["get"],
    "/trades/{id}/history/verify": ["get"],
    "/stellar/fees": ["get"],
    "/stellar/tx/{hash}/status": ["get"],
    "/stellar/assets": ["get"],
    "/stellar/assets/{code}": ["get"],
    "/stellar/account": ["post"],
    "/stellar/account/{address}/balance": ["get"],
    "/contract/{contractId}/state": ["get"],
    "/treasury/balance": ["get"],
    "/treasury/withdraw": ["post"],
    "/treasury/config": ["get"],
    "/admin/features": ["get"],
    "/admin/features/{name}": ["patch"],
    "/admin/evidence/verify": ["post"],
    "/admin/evidence/verify/repair": ["post"],
    "/admin/evidence/verify/single": ["post"],
    "/admin/evidence/verify/queue": ["post"],
    "/webhooks": ["get", "post"],
    "/webhooks/{id}": ["delete"],
    "/goals": ["get"],
    "/api/v1/csp-violation": ["post"],
  };

  const protectedOperations = [
    ["/auth/logout", "post"],
    ["/auth/refresh", "post"],
    ["/auth/validate", "get"],
    ["/wallet/balance", "get"],
    ["/wallet/path-payment-quote", "get"],
    ["/users/me", "get"],
    ["/users/me", "put"],
    ["/users/me/reputation", "get"],
    ["/users/me/trust-score", "get"],
    ["/notifications/preferences", "get"],
    ["/notifications/preferences", "put"],
    ["/notifications", "get"],
    ["/notifications/{id}/read", "patch"],
    ["/notifications/read-all", "post"],
    ["/disputes", "get"],
    ["/disputes/{id}/transition", "post"],
    ["/dispute-categories", "get"],
    ["/dispute-categories", "post"],
    ["/dispute-categories/{id}", "get"],
    ["/dispute-categories/{id}", "patch"],
    ["/dispute-categories/{id}", "delete"],
    ["/trades", "get"],
    ["/trades", "post"],
    ["/trades/export", "get"],
    ["/trades/templates", "get"],
    ["/trades/templates", "post"],
    ["/trades/from-template/{templateId}", "post"],
    ["/trades/watched", "get"],
    ["/trades/stats", "get"],
    ["/trades/{id}", "get"],
    ["/trades/{id}/watch", "post"],
    ["/trades/{id}/watch", "delete"],
    ["/trades/{id}/deposit", "post"],
    ["/trades/{id}/confirm", "post"],
    ["/trades/{id}/release", "post"],
    ["/trades/{id}/dispute", "post"],
    ["/trades/{id}/notes", "get"],
    ["/trades/{id}/notes", "post"],
    ["/trades/{id}/schedule", "get"],
    ["/trades/{id}/schedule", "post"],
    ["/trades/{id}/manifest", "get"],
    ["/trades/{id}/manifest", "post"],
    ["/trades/{id}/evidence", "get"],
    ["/evidence/{cid}/stream", "get"],
    ["/evidence/video", "post"],
    ["/trades/{id}/history", "get"],
    ["/trades/{id}/history/verify", "get"],
    ["/treasury/balance", "get"],
    ["/treasury/withdraw", "post"],
    ["/treasury/config", "get"],
    ["/admin/features", "get"],
    ["/admin/features/{name}", "patch"],
    ["/admin/evidence/verify", "post"],
    ["/admin/evidence/verify/repair", "post"],
    ["/admin/evidence/verify/single", "post"],
    ["/admin/evidence/verify/queue", "post"],
    ["/webhooks", "get"],
    ["/webhooks", "post"],
    ["/webhooks/{id}", "delete"],
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

  it("marks every protected endpoint with cookie authentication", () => {
    for (const [route, method] of protectedOperations) {
      expect(spec.paths[route]?.[method]?.security).toEqual([
        { cookieAuth: [] },
      ]);
    }
  });

  it("documents idempotency header support for mutation endpoints that use the middleware", () => {
    for (const [route, method] of idempotentOperations) {
      const parameters = spec.paths[route]?.[method]?.parameters ?? [];
      expect(
        parameters.some((parameter) =>
          resolvesHeaderParameter(parameter, "Idempotency-Key"),
        ),
      ).toBe(true);
    }
  });

  it("keeps openapi.json in sync with openapi.yaml", () => {
    // Strip operationIds (auto-generated at runtime) for comparison
    function stripOperationIds(obj: unknown): unknown {
      if (Array.isArray(obj)) return obj.map(stripOperationIds);
      if (obj && typeof obj === "object") {
        const copy: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(
          obj as Record<string, unknown>,
        )) {
          if (key === "operationId") continue;
          copy[key] = stripOperationIds(value);
        }
        return copy;
      }
      return obj;
    }
    expect(stripOperationIds(jsonSpec)).toEqual(stripOperationIds(spec));
  });
});
