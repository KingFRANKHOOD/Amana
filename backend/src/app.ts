import cors from "cors";
import express from "express";
import tradeRoutes from "./routes/trade.routes";

export function createApp(): express.Application {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "amana-backend",
      timestamp: new Date().toISOString(),
    });
  });
  app.use(tradeRoutes);
  return app;
}
