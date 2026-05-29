import "./config/loadEnv";
import express from "express";
import fs from "fs";
import path from "path";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { prisma } from "./lib/db";
import { EventListenerService } from "./services/eventListener.service";
import { createApp } from "./app";
import { env } from "./config/env";
import { appLogger } from "./middleware/logger";
import { initializeTracing } from "./config/tracing";

env; // Validate early

// Initialize distributed tracing before any other imports
initializeTracing();

const app = createApp();
const port = env.PORT;

const docsDir = path.join(__dirname, "docs");
const openapiYamlPath = path.join(docsDir, "openapi.yaml");
const openapiJsonPath = path.join(docsDir, "openapi.json");

let openapiSpec: Record<string, unknown> | null = null;
try {
  openapiSpec = YAML.load(openapiYamlPath) as Record<string, unknown>;
} catch (error) {
  appLogger.warn({ error }, "OpenAPI spec could not be loaded");
}

if (env.NODE_ENV !== "production" && openapiSpec) {
  // Override server URL from env so Try It Out links work in deployed environments
  if (env.API_PUBLIC_URL && Array.isArray(openapiSpec.servers)) {
    openapiSpec.servers = [{ url: env.API_PUBLIC_URL }];
  }

  // Auto-generate stable operationId for every operation so generated docs
  // have consistent anchor links and code-gen-friendly function names
  if (typeof openapiSpec.paths === "object" && openapiSpec.paths) {
    for (const [path, methods] of Object.entries(
      openapiSpec.paths as Record<string, unknown>,
    )) {
      for (const [method, operation] of Object.entries(
        methods as Record<string, unknown>,
      )) {
        if (typeof operation === "object" && operation !== null && !(operation as Record<string, unknown>).operationId) {
          const safePath = path
            .replace(/[{}]/g, "")
            .replace(/[^a-zA-Z0-9_/]/g, "_")
            .replace(/\/+/g, ".")
            .replace(/^\.|\.$/g, "")
            .replace(/\.+/g, ".");
          (operation as Record<string, unknown>).operationId = `${method}${safePath ? `.${safePath}` : ""}`;
        }
      }
    }
  }

  try {
    fs.writeFileSync(openapiJsonPath, JSON.stringify(openapiSpec, null, 2));
  } catch (error) {
    appLogger.warn({ error }, "OpenAPI spec could not be exported");
  }

  app.get("/api/docs/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
}

const eventListenerService = new EventListenerService(prisma);

app.listen(port, async () => {
  appLogger.info({ port }, "Amana backend listening");

  try {
    await eventListenerService.start();
    appLogger.info("EventListenerService started successfully");
  } catch (error) {
    appLogger.error({ error }, "Failed to start EventListenerService");
  }
});

const shutdown = async (signal: string) => {
  appLogger.info({ signal }, "Received shutdown signal. Shutting down gracefully...");
  eventListenerService.stop();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
