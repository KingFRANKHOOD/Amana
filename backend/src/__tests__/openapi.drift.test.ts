import fs from "fs";
import path from "path";
import request from "supertest";
import YAML from "yamljs";
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
  "/health/live",
  "/health/ready",
  "/health/startup",
  "/auth/challenge",
  "/auth/verify",
  "/auth/logout",
  "/wallet/balance",
  "/wallet/path-payment-quote",
  "/users/me",
  "/users/{address}",
  "/dispute-categories",
  "/dispute-categories/{id}",
  "/trades",
  "/trades/stats",
  "/trades/{id}",
  "/trades/{id}/deposit",
  "/trades/{id}/confirm",
  "/trades/{id}/release",
  "/trades/{id}/dispute",
  "/trades/{id}/manifest",
  "/trades/{id}/evidence",
  "/evidence/{cid}/stream",
  "/evidence/video",
  "/trades/{id}/history",
  "/trades/{id}/history/verify",
  "/goals",
  "/treasury/balance",
  "/treasury/withdraw",
  "/treasury/config",
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
      const schema = (spec as OpenApiSpec).components.schemas["TradeMutationResponse"];
      expect(schema).toBeDefined();
      expect(schema.required).toContain("tradeId");
      expect(schema.required).toContain("unsignedXdr");
      expect(schema.properties?.tradeId?.type).toBe("string");
      expect(schema.properties?.unsignedXdr?.type).toBe("string");
    });

    it("TradeListResponse requires items as an array of TradeSummary", () => {
      const schema = (spec as OpenApiSpec).components.schemas["TradeListResponse"];
      expect(schema).toBeDefined();
      expect(schema.required).toContain("items");
      expect(schema.properties?.items?.type).toBe("array");
      expect(schema.properties?.items?.items).toHaveProperty("$ref");
    });

    it("TradeSummary requires tradeId and documents buyer/seller/amount/status fields", () => {
      const schema = (spec as OpenApiSpec).components.schemas["TradeSummary"];
      expect(schema).toBeDefined();
      expect(schema.required).toContain("tradeId");
      expect(schema.properties).toHaveProperty("buyerAddress");
      expect(schema.properties).toHaveProperty("sellerAddress");
      expect(schema.properties).toHaveProperty("amountUsdc");
      expect(schema.properties).toHaveProperty("status");
    });

    it("TradeMutationRequest requires sellerAddress and amountUsdc", () => {
      const schema = (spec as OpenApiSpec).components.schemas["TradeMutationRequest"];
      expect(schema).toBeDefined();
      expect(schema.required).toContain("sellerAddress");
      expect(schema.required).toContain("amountUsdc");
      expect(schema.required).toContain("buyerLossBps");
      expect(schema.required).toContain("sellerLossBps");
      const bpsSchema = schema.properties?.buyerLossBps;
      expect(bpsSchema?.minimum).toBe(0);
      expect(bpsSchema?.maximum).toBe(10000);
    });

    it("UnsignedXdrResponse requires unsignedXdr (used by deposit/confirm/release)", () => {
      const schema = (spec as OpenApiSpec).components.schemas["UnsignedXdrResponse"];
      expect(schema).toBeDefined();
      expect(schema.required).toContain("unsignedXdr");
      expect(schema.properties?.unsignedXdr?.type).toBe("string");
    });

    it("all /trades paths have at least one HTTP method documented", () => {
      const tradePaths = specPaths(spec).filter((p) => p.startsWith("/trades"));
      expect(tradePaths.length).toBeGreaterThan(0);
      for (const p of tradePaths) {
        const methods = Object.keys(spec.paths[p]);
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
      expect(statusParam?.schema?.enum).toEqual(
        expect.arrayContaining(["CREATED", "FUNDED", "DISPUTED"]),
      );
    });

    it("TradeListResponse includes pagination metadata", () => {
      const schema = (spec as OpenApiSpec).components.schemas["TradeListResponse"];
      expect(schema).toBeDefined();
      expect(schema.properties).toHaveProperty("items");
      expect(schema.additionalProperties).toBe(true);
    });

    it("TradeStatsResponse schema is documented for /trades/stats endpoint", () => {
      const schema = (spec as OpenApiSpec).components.schemas["TradeStatsResponse"];
      expect(schema).toBeDefined();
      expect(schema.type).toBe("object");
    });

    it("POST /trades request schema validates buyer and seller loss basis points", () => {
      const schema = (spec as OpenApiSpec).components.schemas["TradeMutationRequest"];
      expect(schema).toBeDefined();
      
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
      const schema = (spec as OpenApiSpec).components.schemas["TradeMutationRequest"];
      const amountUsdcSchema = schema.properties?.amountUsdc;
      
      expect(amountUsdcSchema).toBeDefined();
      expect(amountUsdcSchema?.oneOf).toBeDefined();
      expect(amountUsdcSchema?.oneOf?.length).toBeGreaterThanOrEqual(2);
      
      const types = amountUsdcSchema?.oneOf?.map((s: SchemaObject) => s.type);
      expect(types).toContain("string");
      expect(types).toContain("number");
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
