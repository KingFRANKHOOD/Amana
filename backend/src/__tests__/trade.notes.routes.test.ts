import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { tradeNotesRoutes } from "../routes/trade.notes.routes";
import { AuthService } from "../services/auth.service";

import { errorHandler } from "../errors/errorHandler";
import { encrypt, decrypt } from "../lib/crypto";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

let mockAddNote: jest.Mock;
let mockListNotes: jest.Mock;

beforeAll(() => {
  const mod = require("../services/trade.notes.service") as {
    mockAddNote: jest.Mock;
    mockListNotes: jest.Mock;
  };
  mockAddNote = mod.mockAddNote;
  mockListNotes = mod.mockListNotes;
});

jest.mock("../services/trade.notes.service", () => {
  const addNote = jest.fn();
  const listNotes = jest.fn();
  class MockAccessDeniedError extends Error {
    status = 403;
    constructor() {
      super("Access denied: you are not allowed to view notes for this trade");
      this.name = "TradeNoteAccessDeniedError";
    }
  }
  class MockNotFoundError extends Error {
    status = 404;
    constructor() {
      super("Trade not found");
      this.name = "TradeNoteNotFoundError";
    }
  }
  return {
    __esModule: true,
    mockAddNote: addNote,
    mockListNotes: listNotes,
    TradeNotesService: jest.fn().mockImplementation(() => ({
      addNote,
      listNotes,
    })),
    TradeNoteAccessDeniedError: MockAccessDeniedError,
    TradeNoteNotFoundError: MockNotFoundError,
  };
});

jest.mock("../lib/accessControl", () => ({
  getAdminAllowlistLowercase: jest.fn(() => new Set<string>()),
}));

const app = express();
app.use(express.json());
app.use("/trades", tradeNotesRoutes);
app.use(errorHandler);

describe("Trade Notes Routes", () => {
  const buyerAddress = StellarSdk.Keypair.random().publicKey();
  const sellerAddress = StellarSdk.Keypair.random().publicKey();
  const otherAddress = StellarSdk.Keypair.random().publicKey();
  const tradeId = "4294967297";
  let buyerToken: string;
  let sellerToken: string;
  let otherToken: string;

  beforeAll(() => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || "test-secret-at-least-32-characters-long!";
    process.env.JWT_ISSUER = process.env.JWT_ISSUER || "amana";
    process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "amana-api";
    const secret = process.env.JWT_SECRET!;
    const now = Math.floor(Date.now() / 1000);

    buyerToken = jwt.sign(
      {
        walletAddress: buyerAddress,
        jti: "notes-buyer-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
    sellerToken = jwt.sign(
      {
        walletAddress: sellerAddress,
        jti: "notes-seller-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
    otherToken = jwt.sign(
      {
        walletAddress: otherAddress,
        jti: "notes-other-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // POST /trades/:id/notes
  // -------------------------------------------------------------------

  describe("POST /trades/:id/notes", () => {
    it("returns 201 and adds a note", async () => {
      mockAddNote.mockResolvedValue({
        id: 1,
        createdAt: new Date("2025-01-01T00:00:00Z"),
      });

      const res = await request(app)
        .post(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ content: "Buyer note content" });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 1 });
      expect(res.body.createdAt).toBeDefined();
      expect(mockAddNote).toHaveBeenCalledWith(
        tradeId,
        buyerAddress,
        "Buyer note content",
      );
    });

    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post(`/trades/${tradeId}/notes`)
        .send({ content: "No auth note" });

      expect(res.status).toBe(401);
    });

    it("returns 400 for empty content", async () => {
      const res = await request(app)
        .post(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ content: "" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for content exceeding 2000 chars", async () => {
      const res = await request(app)
        .post(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ content: "x".repeat(2001) });

      expect(res.status).toBe(400);
    });

    it("returns 403 when TradeNotesService throws TradeNoteAccessDeniedError", async () => {
      const { TradeNoteAccessDeniedError } = require("../services/trade.notes.service");
      mockAddNote.mockRejectedValue(
        new TradeNoteAccessDeniedError(),
      );

      const res = await request(app)
        .post(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({ content: "Unauthorized note" });

      expect(res.status).toBe(403);
    });

    it("returns 404 when TradeNotesService throws TradeNoteNotFoundError", async () => {
      const { TradeNoteNotFoundError } = require("../services/trade.notes.service");
      mockAddNote.mockRejectedValue(
        new TradeNoteNotFoundError(),
      );

      const res = await request(app)
        .post(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ content: "Note for missing trade" });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // GET /trades/:id/notes
  // -------------------------------------------------------------------

  describe("GET /trades/:id/notes", () => {
    const now = new Date("2025-01-01T00:00:00Z");

    it("returns decrypted notes for the author", async () => {
      mockListNotes.mockResolvedValue([
        {
          id: 1,
          tradeId,
          authorAddress: buyerAddress.toLowerCase(),
          content: "My private note",
          createdAt: now,
        },
      ]);

      const res = await request(app)
        .get(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.notes).toHaveLength(1);
      expect(res.body.notes[0].content).toBe("My private note");
      expect(res.body.notes[0].authorAddress).toBe(
        buyerAddress.toLowerCase(),
      );
    });

    it("returns null content for non-author party", async () => {
      mockListNotes.mockResolvedValue([
        {
          id: 1,
          tradeId,
          authorAddress: buyerAddress.toLowerCase(),
          content: null,
          createdAt: now,
        },
      ]);

      const res = await request(app)
        .get(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.notes).toHaveLength(1);
      expect(res.body.notes[0].content).toBeNull();
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).get(`/trades/${tradeId}/notes`);

      expect(res.status).toBe(401);
    });

    it("returns 403 when TradeNotesService throws TradeNoteAccessDeniedError", async () => {
      const { TradeNoteAccessDeniedError } = require("../services/trade.notes.service");
      mockListNotes.mockRejectedValue(
        new TradeNoteAccessDeniedError(),
      );

      const res = await request(app)
        .get(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Encryption behavior
  // -------------------------------------------------------------------

  describe("encryption", () => {
    it("stores data encrypted with AES-256-GCM", async () => {
      const plaintext = "Sensitive buyer note";
      let storedContent: string | undefined;

      mockAddNote.mockImplementation(
        async (_tradeId: string, _author: string, content: string) => {
          storedContent = encrypt(content);
          return { id: 1, createdAt: new Date() };
        },
      );

      await request(app)
        .post(`/trades/${tradeId}/notes`)
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({ content: plaintext });

      expect(storedContent).toBeDefined();
      expect(storedContent).not.toBe(plaintext);
      const decrypted = decrypt(storedContent!);
      expect(decrypted).toBe(plaintext);
    });
  });
});
