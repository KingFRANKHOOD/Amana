import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createManifestRouter } from "../routes/manifest.routes";

describe("Manifest Routes", () => {
  const walletAddress = "G" + "A".repeat(55);
  let token: string;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    token = jwt.sign({ walletAddress }, process.env.JWT_SECRET as string);
  });

  it("reads :id from parent route params when posting manifest", async () => {
    const submitManifest = jest.fn().mockResolvedValue({
      manifestId: 123,
      driverNameHash: "hash-name",
      driverIdHash: "hash-id",
    });
    const buildSubmitManifestTx = jest.fn().mockResolvedValue({
      unsignedXdr: "AAAA-test-xdr",
    });

    const app = express();
    app.use(express.json());
    app.use(
      "/trades/:id/manifest",
      createManifestRouter(
        { submitManifest } as any,
        { buildSubmitManifestTx } as any,
      ),
    );

    const response = await request(app)
      .post("/trades/test-id/manifest")
      .set("Authorization", `Bearer ${token}`)
      .send({
        driverName: "Driver Name",
        driverIdNumber: "DRV-12345",
        vehicleRegistration: "ABC-123XY",
        routeDescription: "Farm to depot",
        expectedDeliveryAt: "2026-03-28T12:00:00.000Z",
      });

    expect(response.status).toBe(201);
    expect(submitManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: "test-id",
      }),
    );
  });
});
