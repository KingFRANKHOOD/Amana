import express from "express";
import request from "supertest";
import { z } from "zod";
import { validateRequest } from "../middleware/validateRequest";
import { updateProfileSchema } from "../validators/user.validators";

describe("validateRequest middleware", () => {
  it("parses and reassigns body/params for valid payloads", async () => {
    const app = express();
    app.use(express.json());

    app.post(
      "/users/:id",
      validateRequest({
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ count: z.coerce.number().int().positive() }),
      }),
      (req, res) => {
        res.status(200).json({
          params: req.params,
          body: req.body,
        });
      },
    );

    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const res = await request(app)
      .post(`/users/${userId}`)
      .send({ count: "3" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      params: { id: userId },
      body: { count: 3 },
    });
  });

  it("returns 400 with documented error payload on zod validation failures", async () => {
    const app = express();
    app.use(express.json());

    app.post(
      "/items",
      validateRequest({
        body: z.object({ quantity: z.number().int().positive() }),
      }),
      (_req, res) => res.status(201).json({ ok: true }),
    );

    const res = await request(app).post("/items").send({ quantity: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: expect.stringMatching(/^quantity:/),
    });
  });

  it("forwards non-zod failures to next(error)", async () => {
    const app = express();
    app.use(express.json());

    const schema = {
      body: {
        parseAsync: jest.fn().mockRejectedValue(new Error("unexpected parse failure")),
      },
    } as any;

    app.post(
      "/boom",
      validateRequest(schema),
      (_req, res) => res.status(200).json({ ok: true }),
    );

    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ message: err.message });
    });

    const res = await request(app).post("/boom").send({});

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "unexpected parse failure" });
  });
});

describe("updateProfileSchema boundaries and middleware interaction", () => {
  const setupApp = () => {
    const app = express();
    app.use(express.json());

    app.patch(
      "/profile",
      validateRequest({ body: updateProfileSchema }),
      (req, res) => res.status(200).json({ profile: req.body }),
    );

    return app;
  };

  it("accepts empty payload because all fields are optional", async () => {
    const res = await request(setupApp()).patch("/profile").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profile: {} });
  });

  it("accepts displayName at minimum and maximum length boundaries", async () => {
    const app = setupApp();

    const minRes = await request(app).patch("/profile").send({
      displayName: "ab",
    });
    const maxRes = await request(app).patch("/profile").send({
      displayName: "a".repeat(32),
    });

    expect(minRes.status).toBe(200);
    expect(minRes.body.profile.displayName).toBe("ab");
    expect(maxRes.status).toBe(200);
    expect(maxRes.body.profile.displayName).toBe("a".repeat(32));
  });

  it("rejects displayName below minimum and above maximum length", async () => {
    const app = setupApp();

    const tooShort = await request(app).patch("/profile").send({ displayName: "a" });
    const tooLong = await request(app)
      .patch("/profile")
      .send({ displayName: "a".repeat(33) });

    expect(tooShort.status).toBe(400);
    expect(tooShort.body).toEqual({
      error: "displayName: Display name must be at least 2 characters",
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({
      error: "displayName: Display name must be 32 characters or fewer",
    });
  });

  it("rejects displayName with invalid characters", async () => {
    const res = await request(setupApp()).patch("/profile").send({
      displayName: "Jane<3",
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "displayName: Display name contains invalid characters",
    });
  });

  it("accepts valid avatarUrl and rejects malformed avatarUrl", async () => {
    const app = setupApp();

    const valid = await request(app).patch("/profile").send({
      avatarUrl: "https://cdn.example.com/avatar.png",
    });
    const invalid = await request(app).patch("/profile").send({
      avatarUrl: "not-a-url",
    });

    expect(valid.status).toBe(200);
    expect(valid.body.profile.avatarUrl).toBe("https://cdn.example.com/avatar.png");
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({
      error: "avatarUrl: Invalid URL",
    });
  });

  it("strips unknown fields to remain forward-compatible with schema evolution", async () => {
    const res = await request(setupApp()).patch("/profile").send({
      displayName: "Valid_Name",
      futureField: "client-added-field",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: {
        displayName: "Valid_Name",
      },
    });
  });
});
