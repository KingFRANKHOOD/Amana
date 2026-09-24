import request from "supertest";
import { createApp } from "../app";

describe("app routes", () => {
  const app = createApp();

  it("serves fee accounting routes under the versioned API", async () => {
    const res = await request(app).get("/api/v1/fees");

    expect(res.status).not.toBe(404);
  });

  it("does not serve fee accounting routes at the unversioned path", async () => {
    const res = await request(app).get("/fees");

    expect(res.status).toBe(404);
  });
});
