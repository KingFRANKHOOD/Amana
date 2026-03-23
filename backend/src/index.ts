import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { EventListenerService } from "./services/eventListener.service";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

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

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  eventListenerService.stop();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
