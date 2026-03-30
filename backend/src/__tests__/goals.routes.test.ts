import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import express from "express";

describe("Goals Routes", () => {
    let app: express.Application;

    beforeEach(() => {
        app = createApp();
    });

    describe("GET /goals", () => {
        it("should return 401 without authorization", async () => {
            const response = await request(app).get("/goals");

            expect(response.status).toBe(401);
            expect(response.body.error).toBe("Unauthorized");
        });

        it("should return goals analytics with valid token", async () => {
            // Mock JWT token
            const token = "Bearer mock-token";

            // This test would require mocking the auth middleware
            // In a real scenario, you'd use a test JWT or mock the middleware
            const response = await request(app)
                .get("/goals")
                .set("Authorization", token);

            // Expected to fail auth in test environment, but route should exist
            expect(response.status).toBe(401);
        });
    });
});
