import request from "supertest";
import express from "express";
import { buildApiRouter } from "../app";

// Issue #1226: fee accounting routes must be mounted inside the versioned
// API router so they are reachable at /api/v1/fees, consistent with the
// other versioned routes.
describe("fee accounting routes (versioned API)", () => {
  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use("/api/v1", buildApiRouter());
    return app;
  };

  it("exposes the fee accounting router at /api/v1/fees", async () => {
    const app = buildApp();

    const res = await request(app).get("/api/v1/fees");

    // The route must be mounted (not a 404 from an unmounted router).
    expect(res.status).not.toBe(404);
  });

  it("does not expose the fee accounting router at the unversioned /fees path", async () => {
    const app = buildApp();

    const res = await request(app).get("/fees");

    expect(res.status).toBe(404);
  });
});
