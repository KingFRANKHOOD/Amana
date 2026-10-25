import request from "supertest";
import { createApp } from "../app";
import express from "express";

// Mock Keypair so we get deterministic values
const MOCK_PUBLIC_KEY = "GDDD3FRCH55BSYNKISYY242HQNIBOH35CQP42NSJABR62XK2JOV5MED6";
const MOCK_SECRET = "SCZANGBA568CEBM44VKXRP22KO6J53ZVACQZ4WFWRSYTH3BQMVQN4YL";

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Keypair: {
      ...actual.Keypair,
      random: jest.fn().mockReturnValue({
        publicKey: () => MOCK_PUBLIC_KEY,
        secret: () => MOCK_SECRET,
      }),
    },
  };
});

const mockAxiosGet = jest.fn();
jest.mock("axios", () => ({
  get: (...args: any[]) => mockAxiosGet(...args),
}));

// Mock encrypt so tests don't depend on JWT_SECRET value
jest.mock("../lib/crypto", () => ({
  encrypt: jest.fn().mockResolvedValue("encrypted-secret-key"),
  decrypt: jest.fn(),
}));

jest.mock("../config/stellar", () => ({
  horizonServer: {},
  sorobanRpcClient: {},
  networkPassphrase: "Test SDF Network ; September 2015",
}));

describe("POST /stellar/account/create", () => {
  let app: express.Application;

  beforeEach(() => {
    mockAxiosGet.mockReset();
    app = createApp();
  });

  it("creates an account and returns publicKey and encryptedSecretKey", async () => {
    const res = await request(app).post("/stellar/account/create").send({});

    expect(res.status).toBe(201);
    expect(res.body.publicKey).toBe(MOCK_PUBLIC_KEY);
    expect(res.body.encryptedSecretKey).toBe("encrypted-secret-key");
    expect(res.body.funded).toBe(false);
  });

  it("funds the account via friendbot on testnet when fund=true", async () => {
    mockAxiosGet.mockResolvedValue({ status: 200, data: {} });

    const res = await request(app)
      .post("/stellar/account/create")
      .send({ fund: true });

    expect(res.status).toBe(201);
    expect(res.body.publicKey).toBe(MOCK_PUBLIC_KEY);
    expect(res.body.funded).toBe(true);
    expect(mockAxiosGet).toHaveBeenCalledWith(
      "https://friendbot.stellar.org",
      expect.objectContaining({ params: { addr: MOCK_PUBLIC_KEY } })
    );
  });

  it("still returns 201 if friendbot fails (funded=false)", async () => {
    mockAxiosGet.mockRejectedValue(new Error("Friendbot unavailable"));

    const res = await request(app)
      .post("/stellar/account/create")
      .send({ fund: true });

    expect(res.status).toBe(201);
    expect(res.body.publicKey).toBe(MOCK_PUBLIC_KEY);
    expect(res.body.funded).toBe(false);
    expect(res.body.encryptedSecretKey).toBe("encrypted-secret-key");
  });

  it("does not call friendbot when fund is not set", async () => {
    const res = await request(app).post("/stellar/account/create").send({});

    expect(res.status).toBe(201);
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(res.body.funded).toBe(false);
  });
});
