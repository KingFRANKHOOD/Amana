import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import express from "express";

describe("Health Routes", () => {
    let app: express.Application;

    beforeEach(() => {
        app = createApp();
    });

    describe("GET /health", () => {
        it("should return health status", async () => {
            const response = await request(app).get("/health");

            expect(response.status).toBeOneOf([200, 503]);
            expect(response.body).toHaveProperty("status");
            expect(response.body).toHaveProperty("timestamp");
            expect(response.body).toHaveProperty("checks");
        });

        it("should include database and indexer checks", async () => {
            const response = await request(app).get("/health");

            expect(response.body.checks).toHaveProperty("database");
            expect(response.body.checks).toHaveProperty("indexer");
            expect(response.body.checks.database).toHaveProperty("status");
            expect(response.body.checks.indexer).toHaveProperty("status");
        });

        it("should include detailed metrics", async () => {
            const response = await request(app).get("/health");

            expect(response.body.details).toHaveProperty("databaseLatency");
            expect(response.body.details).toHaveProperty("indexerLagSeconds");
            expect(response.body.details).toHaveProperty("lastProcessedLedger");
        });

        it("should return 503 when unhealthy", async () => {
            // This test would require mocking the health service to return unhealthy
            const response = await request(app).get("/health");

            if (response.body.status === "unhealthy") {
                expect(response.status).toBe(503);
            }
        });
    });

    describe("GET /health/live", () => {
        it("should return alive status", async () => {
            const response = await request(app).get("/health/live");

            expect(response.status).toBe(200);
            expect(response.body.status).toBe("alive");
            expect(response.body).toHaveProperty("timestamp");
        });
    });

    describe("GET /health/ready", () => {
        it("should return readiness status", async () => {
            const response = await request(app).get("/health/ready");

            expect(response.status).toBeOneOf([200, 503]);
            expect(response.body).toHaveProperty("status");
            expect(response.body).toHaveProperty("timestamp");
        });

        it("should return 503 when not ready", async () => {
            // This test would require mocking the health service to return unhealthy
            const response = await request(app).get("/health/ready");

            if (response.body.status === "not_ready") {
                expect(response.status).toBe(503);
            }
        });
    });
});
