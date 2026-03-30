import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import cors from "cors";
import { prisma } from "./lib/db";
import userRoutes from "./routes/user.routes";
import { EventListenerService } from "./services/eventListener.service";
import { createTradeRouter } from "./routes/trade.routes";
import { walletRoutes } from "./routes/wallet.routes";
import { authRoutes } from "./routes/auth.routes";
import { createManifestRouter } from "./routes/manifest.routes";
import { createEvidenceRouter } from "./routes/evidence.routes";
import { createAuditTrailRouter } from "./routes/auditTrail.routes";
import { createApp } from "./app";
import { env } from "./config/env";
import { appLogger } from "./middleware/logger";

env; // Validate early

const app = createApp();
const port = Number(process.env.PORT || 4000);

const docsDir = path.join(__dirname, "docs");
const openapiYamlPath = path.join(docsDir, "openapi.yaml");
const openapiJsonPath = path.join(docsDir, "openapi.json");

let openapiSpec: unknown = null;
try {
  openapiSpec = YAML.load(openapiYamlPath);
} catch (error) {
  appLogger.warn({ error }, "OpenAPI spec could not be loaded");
}

if (process.env.NODE_ENV !== "production" && openapiSpec) {
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

app.use("/users", userRoutes);

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
