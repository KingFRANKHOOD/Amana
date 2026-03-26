import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { prisma } from "./lib/db";
import userRoutes from "./routes/user.routes";
import { EventListenerService } from "./services/eventListener.service";
import { tradeRoutes } from "./routes/trade.routes";
import { walletRoutes } from "./routes/wallet.routes";

dotenv.config();

const app = createApp();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());
app.use("/trades", tradeRoutes);
app.use("/wallet", walletRoutes);

const docsDir = path.join(__dirname, "docs");
const openapiYamlPath = path.join(docsDir, "openapi.yaml");
const openapiJsonPath = path.join(docsDir, "openapi.json");

let openapiSpec: unknown = null;
try {
  openapiSpec = YAML.load(openapiYamlPath);
} catch (error) {
  console.warn("OpenAPI spec could not be loaded:", error);
}

if (process.env.NODE_ENV !== "production" && openapiSpec) {
  try {
    fs.writeFileSync(openapiJsonPath, JSON.stringify(openapiSpec, null, 2));
  } catch (error) {
    console.warn("OpenAPI spec could not be exported:", error);
  }

  app.get("/api/docs/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
}

app.use("/users", userRoutes);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "amana-backend",
    timestamp: new Date().toISOString(),
  });
});

const eventListenerService = new EventListenerService(prisma);

app.listen(port, async () => {
  console.log(`Amana backend listening on port ${port}`);

  try {
    await eventListenerService.start();
    console.log("EventListenerService started successfully");
  } catch (error) {
    console.error("Failed to start EventListenerService:", error);
  }
});

const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  eventListenerService.stop();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
