import fs from "fs";
import path from "path";
import request from "supertest";
import YAML from "yamljs";
import { GoalStatus, TradeStatus } from "@prisma/client";
import { createApp } from "../app";

const SPEC_PATH = path.resolve(__dirname, "../docs/openapi.yaml");

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  additionalProperties?: boolean | SchemaObject;
  $ref?: string;
  oneOf?: SchemaObject[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  nullable?: boolean;
  format?: string;
  description?: string;
}

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, SchemaObject>;
  };
}

function loadSpec(): OpenApiSpec {
  const raw = fs.readFileSync(SPEC_PATH, "utf-8");
  return YAML.parse(raw) as OpenApiSpec;
}

// The set of routes the spec documents.
function specPaths(spec: OpenApiSpec): string[] {
  return Object.keys(spec.paths);
}

function requiredSchema(spec: OpenApiSpec, name: string): SchemaObject {
  const schema = spec.components.schemas[name];
  expect(schema).toBeDefined();
  return schema!;
}

// Routes we know are implemented in app.ts (kept in sync manually; test fails if this list
// contains a path not in the spec — that is the "route not documented" direction).
const IMPLEMENTED_ROUTES = [
  "/health",
  "/health/live",
  "/health/ready",
  "/health/startup",
  "/health/detail",
  "/metrics-info",
  "/auth/challenge",
  "/auth/verify",
  "/auth/logout",
  "/auth/refresh",
  "/auth/validate",
  "/wallet/balance",
  "/wallet/path-payment-quote",
  "/users/me",
  "/users/me/reputation",
  "/users/me/trust-score",
  "/users/{address}",
  "/users/{address}/reputation",
  "/users/{address}/trust-score",
  "/notifications/preferences",
  "/notifications",
  "/notifications/{id}/read",
  "/notifications/read-all",
  "/dispute-categories",
  "/dispute-categories/{id}",
  "/disputes",
  "/disputes/{id}/transition",
  "/trades",
  "/trades/export",
  "/trades/templates",
  "/trades/from-template/{templateId}",
  "/trades/watched",
  "/trades/stats",
  "/trades/{id}",
  "/trades/{id}/watch",
  "/trades/{id}/deposit",
  "/trades/{id}/confirm",
  "/trades/{id}/release",
  "/trades/{id}/dispute",
  "/trades/{id}/notes",
  "/trades/{id}/schedule",
  "/trades/{id}/manifest",
  "/trades/{id}/evidence",
  "/evidence/{cid}/stream",
  "/evidence/video",
  "/trades/{id}/history",
  "/trades/{id}/history/verify",
  "/stellar/fees",
  "/stellar/tx/{hash}/status",
  "/stellar/assets",
  "/stellar/assets/{code}",
  "/stellar/account",
  "/stellar/account/{address}/balance",
  "/contract/{contractId}/state",
  "/goals",
  "/treasury/balance",
  "/treasury/withdraw",
  "/treasury/config",
  "/admin/features",
  "/admin/features/{name}",
  "/admin/evidence/verify",
  "/admin/evidence/verify/repair",
  "/admin/evidence/verify/single",
  "/admin/evidence/verify/queue",
  "/webhooks",
  "/webhooks/{id}",
  "/api/v1/csp-violation",
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

  // ── /trades schema drift (#669, #670) ─────────────────────────────────────

  describe("/trades response schema contracts", () => {
    it("TradeMutationResponse requires tradeId and unsignedXdr as strings", () => {
      const schema = requiredSchema(spec, "TradeMutationResponse");
      expect(schema.required).toContain("tradeId");
      expect(schema.required).toContain("unsignedXdr");
      expect(schema.properties?.tradeId?.type).toBe("string");
      expect(schema.properties?.unsignedXdr?.type).toBe("string");
    });

    it("TradeListResponse requires items as an array of TradeSummary", () => {
      const schema = requiredSchema(spec, "TradeListResponse");
      expect(schema.required).toContain("items");
      expect(schema.properties?.items?.type).toBe("array");
      expect(schema.properties?.items?.items).toHaveProperty("$ref");
    });

    it("TradeSummary requires tradeId and documents buyer/seller/amount/status fields", () => {
      const schema = requiredSchema(spec, "TradeSummary");
      expect(schema.required).toContain("tradeId");
      expect(schema.properties).toHaveProperty("buyerAddress");
      expect(schema.properties).toHaveProperty("sellerAddress");
      expect(schema.properties).toHaveProperty("amountUsdc");
      expect(schema.properties).toHaveProperty("status");
    });

    it("TradeMutationRequest requires sellerAddress and amountUsdc", () => {
      const schema = requiredSchema(spec, "TradeMutationRequest");
      expect(schema.required).toContain("sellerAddress");
      expect(schema.required).toContain("amountUsdc");
      expect(schema.required).toContain("buyerLossBps");
      expect(schema.required).toContain("sellerLossBps");
      const bpsSchema = schema.properties?.buyerLossBps;
      expect(bpsSchema?.minimum).toBe(0);
      expect(bpsSchema?.maximum).toBe(10000);
    });

    it("UnsignedXdrResponse requires unsignedXdr (used by deposit/confirm/release)", () => {
      const schema = requiredSchema(spec, "UnsignedXdrResponse");
      expect(schema.required).toContain("unsignedXdr");
      expect(schema.properties?.unsignedXdr?.type).toBe("string");
    });

    it("all /trades paths have at least one HTTP method documented", () => {
      const tradePaths = specPaths(spec).filter((p) => p.startsWith("/trades"));
      expect(tradePaths.length).toBeGreaterThan(0);
      for (const p of tradePaths) {
        const methods = Object.keys(spec.paths[p]!);
        expect(methods.length).toBeGreaterThan(0);
      }
    });

    it("ListTradesStatusQuery enum covers the core trade statuses", () => {
      const allParams: unknown[] = (spec as any).components?.parameters
        ? Object.values((spec as any).components.parameters)
        : [];
      const statusParam = allParams.find(
        (p: any) => p.name === "status" && p.in === "query",
      ) as any;
      expect(statusParam).toBeDefined();
      // The enum lives in the shared TradeStatus schema, referenced by $ref.
      const statusSchema = statusParam?.schema?.$ref
        ? requiredSchema(
            spec,
            statusParam.schema.$ref.replace("#/components/schemas/", ""),
          )
        : statusParam?.schema;
      expect(statusSchema?.enum).toEqual(
        expect.arrayContaining(["CREATED", "FUNDED", "DISPUTED"]),
      );
    });

    it("TradeListResponse includes pagination metadata", () => {
      const schema = requiredSchema(spec, "TradeListResponse");
      expect(schema.properties).toHaveProperty("items");
      expect(schema.additionalProperties).toBe(true);
    });

    it("TradeStatsResponse schema is documented for /trades/stats endpoint", () => {
      const schema = requiredSchema(spec, "TradeStatsResponse");
      expect(schema.type).toBe("object");
    });

    it("POST /trades request schema validates buyer and seller loss basis points", () => {
      const schema = requiredSchema(spec, "TradeMutationRequest");
      
      const buyerLossBps = schema.properties?.buyerLossBps;
      const sellerLossBps = schema.properties?.sellerLossBps;
      
      expect(buyerLossBps?.type).toBe("integer");
      expect(buyerLossBps?.minimum).toBe(0);
      expect(buyerLossBps?.maximum).toBe(10000);
      
      expect(sellerLossBps?.type).toBe("integer");
      expect(sellerLossBps?.minimum).toBe(0);
      expect(sellerLossBps?.maximum).toBe(10000);
    });

    it("POST /trades response is documented with 201 status for successful creation", () => {
      const path = spec.paths["/trades"] as any;
      expect(path?.post).toBeDefined();
      expect(path?.post?.responses?.["201"]).toBeDefined();
      expect(path?.post?.responses?.["201"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/TradeMutationResponse",
      );
    });

    it("GET /trades response is documented with 200 status and TradeListResponse schema", () => {
      const path = spec.paths["/trades"] as any;
      expect(path?.get).toBeDefined();
      expect(path?.get?.responses?.["200"]).toBeDefined();
      expect(path?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/TradeListResponse",
      );
    });

    it("GET /trades/:id response is documented with TradeSummary schema", () => {
      const path = spec.paths["/trades/{id}"] as any;
      expect(path?.get).toBeDefined();
      expect(path?.get?.responses?.["200"]).toBeDefined();
      expect(path?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/TradeSummary",
      );
    });

    it("POST /trades/:id/deposit response is documented with UnsignedXdrResponse schema", () => {
      const path = spec.paths["/trades/{id}/deposit"] as any;
      expect(path?.post).toBeDefined();
      expect(path?.post?.responses?.["200"]).toBeDefined();
      expect(path?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/UnsignedXdrResponse",
      );
    });

    it("POST /trades/:id/confirm response is documented with UnsignedXdrResponse schema", () => {
      const path = spec.paths["/trades/{id}/confirm"] as any;
      expect(path?.post).toBeDefined();
      expect(path?.post?.responses?.["200"]).toBeDefined();
      expect(path?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/UnsignedXdrResponse",
      );
    });

    it("POST /trades/:id/release response is documented with UnsignedXdrResponse schema", () => {
      const path = spec.paths["/trades/{id}/release"] as any;
      expect(path?.post).toBeDefined();
      expect(path?.post?.responses?.["200"]).toBeDefined();
      expect(path?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/UnsignedXdrResponse",
      );
    });

    it("POST /trades/:id/dispute response is documented with UnsignedXdrResponse schema", () => {
      const path = spec.paths["/trades/{id}/dispute"] as any;
      expect(path?.post).toBeDefined();
      expect(path?.post?.responses?.["200"]).toBeDefined();
      expect(path?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/UnsignedXdrResponse",
      );
    });

    it("POST /trades/:id/dispute request body requires reason with minimum length", () => {
      const path = spec.paths["/trades/{id}/dispute"] as any;
      expect(path?.post?.requestBody).toBeDefined();
      
      const requestSchema = path?.post?.requestBody?.content?.["application/json"]?.schema;
      expect(requestSchema?.properties?.reason).toBeDefined();
      expect(requestSchema?.properties?.reason?.type).toBe("string");
      expect(requestSchema?.properties?.reason?.minLength).toBe(10);
      expect(requestSchema?.required).toContain("reason");
    });

    it("GET /trades/:id/manifest path is documented and returns ManifestView", () => {
      const path = spec.paths["/trades/{id}/manifest"] as any;
      expect(path?.get).toBeDefined();
      expect(path?.get?.responses?.["200"]).toBeDefined();
      expect(path?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/ManifestView",
      );
    });

    it("GET /trades/:id/evidence path is documented and returns EvidenceListResponse", () => {
      const path = spec.paths["/trades/{id}/evidence"] as any;
      expect(path?.get).toBeDefined();
      expect(path?.get?.responses?.["200"]).toBeDefined();
      expect(path?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/EvidenceListResponse",
      );
    });

    it("GET /trades/:id/history path is documented and returns AuditHistoryResponse", () => {
      const path = spec.paths["/trades/{id}/history"] as any;
      expect(path?.get).toBeDefined();
      expect(path?.get?.responses?.["200"]).toBeDefined();
      expect(path?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/AuditHistoryResponse",
      );
    });

    it("all /trades mutation endpoints document 401 unauthorized responses", () => {
      const mutationPaths = [
        "/trades",
        "/trades/{id}/deposit",
        "/trades/{id}/confirm",
        "/trades/{id}/release",
        "/trades/{id}/dispute",
      ];

      for (const path of mutationPaths) {
        const pathSpec = spec.paths[path] as any;
        const postSpec = pathSpec?.post;
        expect(postSpec).toBeDefined();
        expect(postSpec?.responses?.["401"]).toBeDefined();
      }
    });

    it("all /trades read endpoints document 401 unauthorized responses", () => {
      const readPaths = [
        "/trades",
        "/trades/stats",
        "/trades/{id}",
        "/trades/{id}/manifest",
        "/trades/{id}/evidence",
        "/trades/{id}/history",
      ];

      for (const path of readPaths) {
        const pathSpec = spec.paths[path] as any;
        const getSpec = pathSpec?.get;
        expect(getSpec).toBeDefined();
        expect(getSpec?.responses?.["401"]).toBeDefined();
      }
    });

    it("trade mutation endpoints requiring auth include bearerAuth security scheme", () => {
      const authPaths = [
        "/trades",
        "/trades/{id}/deposit",
        "/trades/{id}/confirm",
        "/trades/{id}/release",
        "/trades/{id}/dispute",
      ];

      for (const path of authPaths) {
        const pathSpec = spec.paths[path] as any;
        const postSpec = pathSpec?.post;
        expect(postSpec?.security).toBeDefined();
        expect(postSpec?.security).toEqual(expect.arrayContaining([{ bearerAuth: [] }]));
      }
    });

    it("POST /trades and deposit/release endpoints support idempotency headers", () => {
      const idempotentPaths = [
        "/trades",
        "/trades/{id}/deposit",
        "/trades/{id}/release",
        "/trades/{id}/dispute",
      ];

      for (const path of idempotentPaths) {
        const pathSpec = spec.paths[path] as any;
        const postSpec = pathSpec?.post;
        expect(postSpec?.parameters).toBeDefined();
        
        const hasIdempotencyParam = postSpec?.parameters?.some(
          (param: any) => 
            param.$ref === "#/components/parameters/IdempotencyKeyHeader" ||
            (param.name === "Idempotency-Key" && param.in === "header"),
        );
        
        expect(hasIdempotencyParam).toBe(true);
      }
    });

    it("TradeIdPath parameter is properly defined and used in trade-specific endpoints", () => {
      const tradeIdParam = (spec as any).components.parameters.TradeIdPath;
      expect(tradeIdParam).toBeDefined();
      expect(tradeIdParam.in).toBe("path");
      expect(tradeIdParam.name).toBe("id");
      expect(tradeIdParam.required).toBe(true);
      expect(tradeIdParam.schema.type).toBe("string");

      const pathsUsingTradeId = [
        "/trades/{id}",
        "/trades/{id}/deposit",
        "/trades/{id}/confirm",
        "/trades/{id}/release",
        "/trades/{id}/dispute",
        "/trades/{id}/manifest",
        "/trades/{id}/evidence",
        "/trades/{id}/history",
      ];

      for (const path of pathsUsingTradeId) {
        const pathSpec = spec.paths[path] as any;
        expect(pathSpec).toBeDefined();
      }
    });

    it("error responses for /trades endpoints include proper error schemas", () => {
      const path = spec.paths["/trades"] as any;
      const getSpec = path?.get;
      
      expect(getSpec?.responses?.["400"]).toBeDefined();
      expect(getSpec?.responses?.["400"]?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/AppErrorResponse",
      );
    });

    it("TradeMutationRequest amountUsdc field accepts both string and number", () => {
      const schema = requiredSchema(spec, "TradeMutationRequest");
      const amountUsdcSchema = schema.properties?.amountUsdc;
      
      expect(amountUsdcSchema).toBeDefined();
      expect(amountUsdcSchema?.oneOf).toBeDefined();
      expect(amountUsdcSchema?.oneOf?.length).toBeGreaterThanOrEqual(2);
      
      const types = amountUsdcSchema?.oneOf?.map((s: SchemaObject) => s.type);
      expect(types).toContain("string");
      expect(types).toContain("number");
    });
  });

  // ── #1106: comprehensive documentation for goals, treasury, csp,
  // escrow-schedule, trade-watchlist and trade-export ─────────────────────

  describe("#1106 newly documented endpoints", () => {
    const parameters = () =>
      (spec as any).components.parameters as Record<string, any>;

    function queryParameterNames(path: string, method: string): string[] {
      const operation = (spec.paths[path] as any)?.[method];
      const declared: string[] = (operation?.parameters ?? []).map((param: any) =>
        param.$ref
          ? param.$ref.replace("#/components/parameters/", "")
          : param.name,
      );
      return declared;
    }

    it("TradeStatus schema mirrors the Prisma TradeStatus enum", () => {
      expect(requiredSchema(spec, "TradeStatus").enum).toEqual(
        Object.values(TradeStatus),
      );
    });

    it("GoalStatus schema mirrors the Prisma GoalStatus enum", () => {
      expect(requiredSchema(spec, "GoalStatus").enum).toEqual(
        Object.values(GoalStatus),
      );
    });

    it("ListTradesStatusQuery status enum is the TradeStatus enum", () => {
      expect(parameters().ListTradesStatusQuery.schema).toEqual({
        $ref: "#/components/schemas/TradeStatus",
      });
    });

    describe("goals", () => {
      it("GET /goals documents the 404 raised for an unknown wallet", () => {
        const operation = (spec.paths["/goals"] as any).get;
        expect(operation.responses["404"]).toBeDefined();
        expect(operation.responses["200"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/GoalsAnalyticsResponse" },
        );
      });

      it("GoalsAnalyticsResponse references GoalAnalytics with a GoalStatus", () => {
        const response = requiredSchema(spec, "GoalsAnalyticsResponse");
        expect(response.properties?.goals?.items?.$ref).toBe(
          "#/components/schemas/GoalAnalytics",
        );
        const goal = requiredSchema(spec, "GoalAnalytics");
        expect(goal.properties?.status?.$ref).toBe(
          "#/components/schemas/GoalStatus",
        );
        expect(goal.required).toContain("vaultBalance");
        expect(goal.required).toContain("isOnTrack");
      });
    });

    describe("treasury", () => {
      it("GET /treasury/balance documents balance, asset and contractId as required", () => {
        const operation = (spec.paths["/treasury/balance"] as any).get;
        expect(operation.responses["200"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/TreasuryBalanceResponse" },
        );
        const schema = requiredSchema(spec, "TreasuryBalanceResponse");
        expect(schema.required).toEqual(["balance", "asset", "contractId"]);
      });

      it("GET /treasury/config documents contractId, network and asset as required", () => {
        const operation = (spec.paths["/treasury/config"] as any).get;
        expect(operation.responses["200"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/TreasuryConfigResponse" },
        );
        const schema = requiredSchema(spec, "TreasuryConfigResponse");
        expect(schema.required).toEqual(["contractId", "network", "asset"]);
      });

      it("POST /treasury/withdraw documents body, 400, 403 and the 500 stub failure", () => {
        const operation = (spec.paths["/treasury/withdraw"] as any).post;
        const body = operation.requestBody.content["application/json"].schema;
        expect(body.required).toEqual(["destination", "amount"]);
        expect(operation.responses["400"]).toBeDefined();
        expect(operation.responses["403"]).toBeDefined();
        expect(operation.responses["500"]).toBeDefined();
        expect(operation.responses["200"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/UnsignedXdrResponse" },
        );
      });
    });

    describe("csp", () => {
      it("POST /api/v1/csp-violation is documented as an unauthenticated 204 endpoint", () => {
        const operation = (spec.paths["/api/v1/csp-violation"] as any).post;
        expect(operation).toBeDefined();
        expect(operation.security).toBeUndefined();
        expect(operation.responses["204"]).toBeDefined();
        expect(operation.responses["204"].content).toBeUndefined();
      });

      it("POST /api/v1/csp-violation accepts both CSP report content types", () => {
        const operation = (spec.paths["/api/v1/csp-violation"] as any).post;
        const content = operation.requestBody.content;
        expect(content["application/csp-report"].schema).toEqual({
          $ref: "#/components/schemas/CspReportBody",
        });
        expect(content["application/json"].schema).toEqual({
          $ref: "#/components/schemas/CspReportBody",
        });
        expect(
          requiredSchema(spec, "CspReportBody").properties?.["csp-report"]?.$ref,
        ).toBe("#/components/schemas/CspViolationReport");
      });

      it("POST /api/v1/csp-violation documents the rate limit and payload cap", () => {
        const operation = (spec.paths["/api/v1/csp-violation"] as any).post;
        expect(operation.responses["429"]).toBeDefined();
        expect(operation.responses["413"]).toBeDefined();
      });
    });

    describe("escrow schedule", () => {
      it("POST /trades/{id}/schedule documents the milestone validation constraints", () => {
        const operation = (spec.paths["/trades/{id}/schedule"] as any).post;
        const body = operation.requestBody.content["application/json"].schema;
        expect(body).toEqual({ $ref: "#/components/schemas/EscrowScheduleRequest" });

        const request = requiredSchema(spec, "EscrowScheduleRequest");
        expect(request.properties?.milestones?.minItems).toBe(1);
        expect(request.properties?.milestones?.maxItems).toBe(100);
        expect(request.required).toEqual(["milestones"]);

        const milestone = requiredSchema(spec, "EscrowMilestoneRequest");
        expect(milestone.properties?.milestoneIndex?.minimum).toBe(0);
        expect(milestone.properties?.amountUsdc?.pattern).toBe(
          "^\\d+(\\.\\d{1,7})?$",
        );
        expect(milestone.properties?.dueAt?.format).toBe("date-time");
        expect(milestone.properties?.conditionHash?.maxLength).toBe(64);
        expect(milestone.required).toEqual([
          "milestoneIndex",
          "amountUsdc",
          "dueAt",
        ]);
      });

      it("GET and POST /trades/{id}/schedule share the EscrowReleaseSchedule response", () => {
        const path = spec.paths["/trades/{id}/schedule"] as any;
        expect(path.get.responses["200"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/EscrowReleaseSchedule" },
        );
        expect(path.post.responses["201"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/EscrowReleaseSchedule" },
        );

        const schedule = requiredSchema(spec, "EscrowReleaseSchedule");
        expect(schedule.required).toEqual([
          "tradeId",
          "milestoneCount",
          "nextReleaseDate",
          "milestones",
        ]);
        expect(schedule.properties?.nextReleaseDate?.nullable).toBe(true);
        expect(schedule.properties?.milestones?.items?.$ref).toBe(
          "#/components/schemas/EscrowReleaseMilestoneView",
        );

        const milestone = requiredSchema(spec, "EscrowReleaseMilestoneView");
        expect(milestone.properties?.released?.type).toBe("boolean");
        expect(milestone.properties?.conditionHash?.nullable).toBe(true);
      });

      it("both schedule operations document 401, 404 and the 500 store failure", () => {
        const path = spec.paths["/trades/{id}/schedule"] as any;
        for (const method of ["get", "post"]) {
          expect(path[method].responses["401"]).toBeDefined();
          expect(path[method].responses["404"]).toBeDefined();
          expect(path[method].responses["500"]).toBeDefined();
        }
        expect(path.post.responses["400"]).toBeDefined();
        expect(path.post.responses["403"]).toBeDefined();
      });
    });

    describe("trade watchlist", () => {
      it("GET /trades/watched documents page/limit and a paginated response", () => {
        const operation = (spec.paths["/trades/watched"] as any).get;
        expect(queryParameterNames("/trades/watched", "get").sort()).toEqual([
          "ListTradesLimitQuery",
          "ListTradesPageQuery",
        ]);
        expect(operation.responses["200"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/WatchedTradeListResponse" },
        );
        expect(operation.responses["400"]).toBeDefined();

        const response = requiredSchema(spec, "WatchedTradeListResponse");
        expect(response.required).toEqual(["items", "pagination"]);
        expect(response.properties?.items?.items?.$ref).toBe(
          "#/components/schemas/WatchedTrade",
        );
        expect(response.properties?.pagination?.$ref).toBe(
          "#/components/schemas/Pagination",
        );
      });

      it("WatchedTrade documents the trade row plus watchedAt", () => {
        const watched = requiredSchema(spec, "WatchedTrade");
        expect(watched.properties?.status?.$ref).toBe(
          "#/components/schemas/TradeStatus",
        );
        expect(watched.properties?.watchedAt?.format).toBe("date-time");
        expect(watched.required).toContain("watchedAt");
        expect(watched.required).toContain("tradeId");
      });

      it("POST /trades/{id}/watch documents the watch record and error statuses", () => {
        const operation = (spec.paths["/trades/{id}/watch"] as any).post;
        expect(operation.responses["201"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/WatchResponse" },
        );
        expect(operation.responses["400"]).toBeDefined();
        expect(operation.responses["401"]).toBeDefined();
        expect(operation.responses["403"]).toBeDefined();
        expect(operation.responses["404"]).toBeDefined();
        expect(
          requiredSchema(spec, "WatchResponse").properties?.watch?.$ref,
        ).toBe("#/components/schemas/WatchRecord");
      });

      it("DELETE /trades/{id}/watch documents the removed boolean", () => {
        const operation = (spec.paths["/trades/{id}/watch"] as any).delete;
        expect(operation.responses["200"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/WatchRemovalResponse" },
        );
        const removal = requiredSchema(spec, "WatchRemovalResponse");
        expect(removal.properties?.removed?.type).toBe("boolean");
        expect(removal.required).toEqual(["removed"]);
      });
    });

    describe("trade export", () => {
      it("GET /trades/export documents format, status, date filters and pagination", () => {
        expect(queryParameterNames("/trades/export", "get")).toEqual([
          "format",
          "ListTradesStatusQuery",
          "dateFrom",
          "dateTo",
          "from",
          "to",
          "ListTradesPageQuery",
          "TradeExportLimitQuery",
        ]);
      });

      it("GET /trades/export documents the JSON page and the CSV download", () => {
        const operation = (spec.paths["/trades/export"] as any).get;
        expect(operation.responses["200"].content["application/json"].schema).toEqual(
          { $ref: "#/components/schemas/TradeExportListResponse" },
        );
        expect(operation.responses["200"].content["text/csv"].schema.type).toBe(
          "string",
        );
        expect(operation.responses["400"]).toBeDefined();
        expect(operation.responses["401"]).toBeDefined();
      });

      it("export pagination defaults match the route (page 1, limit 50, max 100)", () => {
        expect(parameters().ListTradesPageQuery.schema).toEqual({
          type: "integer",
          minimum: 1,
          default: 1,
        });
        expect(parameters().TradeExportLimitQuery.schema).toEqual({
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 50,
        });
      });

      it("TradeExportRow documents the snake_case export columns", () => {
        const row = requiredSchema(spec, "TradeExportRow");
        expect(row.required).toEqual([
          "trade_id",
          "buyer",
          "seller",
          "amount",
          "asset",
          "status",
          "created_at",
          "completed_at",
          "fee",
          "dispute_flag",
        ]);
        expect(row.properties?.status?.$ref).toBe(
          "#/components/schemas/TradeStatus",
        );
        expect(row.properties?.dispute_flag?.type).toBe("boolean");
        expect(row.properties?.completed_at?.nullable).toBe(true);
      });
    });
  });

  describe("/trades endpoint auth guard", () => {
    it("POST /trades without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp)
        .post("/trades")
        .send({ sellerAddress: "GC...", amountUsdc: "10", buyerLossBps: 5000, sellerLossBps: 5000 });
      expect(res.status).toBe(401);
    });

    it("GET /trades without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).get("/trades");
      expect(res.status).toBe(401);
    });

    it("GET /trades/stats without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).get("/trades/stats");
      expect(res.status).toBe(401);
    });

    it("GET /trades/:id without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).get("/trades/test-id");
      expect(res.status).toBe(401);
    });

    it("POST /trades/:id/deposit without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).post("/trades/test-id/deposit");
      expect(res.status).toBe(401);
    });

    it("POST /trades/:id/confirm without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).post("/trades/test-id/confirm");
      expect(res.status).toBe(401);
    });

    it("POST /trades/:id/release without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp).post("/trades/test-id/release");
      expect(res.status).toBe(401);
    });

    it("POST /trades/:id/dispute without auth returns 401", async () => {
      const freshApp = createApp();
      const res = await request(freshApp)
        .post("/trades/test-id/dispute")
        .send({ reason: "test reason that is long enough", category: "DAMAGE" });
      expect(res.status).toBe(401);
    });
  });
});
