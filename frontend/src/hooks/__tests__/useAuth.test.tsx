/**
 * Integration tests for useAuth — the frontend JWT challenge-verify flow.
 *
 * Covers:
 *  - Freighter installed detection (isWalletDetected)
 *  - connectWallet: requestAccess → address stored in state
 *  - authenticate: POST /auth/challenge → sign → POST /auth/verify → JWT stored
 *  - Subsequent authenticated request carries JWT in Authorization header
 *  - logout: clears JWT from sessionStorage and state
 *  - Error path: authenticate with no wallet connected
 *  - Error path: API challenge call fails
 *  - Error path: signMessage fails
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import {
  getAddress,
  isAllowed,
  isConnected,
  requestAccess,
  signMessage,
} from "@stellar/freighter-api";
import { AuthProvider, useAuth } from "../useAuth";
import { api, ApiError } from "@/lib/api";

// ── Mock @stellar/freighter-api ───────────────────────────────────────────────
jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  getAddress: jest.fn(),
  requestAccess: jest.fn(),
  signMessage: jest.fn(),
}));

const mockedIsConnected = isConnected as jest.MockedFunction<typeof isConnected>;
const mockedIsAllowed = isAllowed as jest.MockedFunction<typeof isAllowed>;
const mockedGetAddress = getAddress as jest.MockedFunction<typeof getAddress>;
const mockedRequestAccess = requestAccess as jest.MockedFunction<typeof requestAccess>;
const mockedSignMessage = signMessage as jest.MockedFunction<typeof signMessage>;

// ── Mock API client ───────────────────────────────────────────────────────────
jest.mock("@/lib/api", () => ({
  api: {
    auth: {
      challenge: jest.fn(),
      verify: jest.fn(),
      logout: jest.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  },
}));

const mockedChallenge = api.auth.challenge as jest.MockedFunction<typeof api.auth.challenge>;
const mockedVerify = api.auth.verify as jest.MockedFunction<typeof api.auth.verify>;
const mockedLogout = api.auth.logout as jest.MockedFunction<typeof api.auth.logout>;

// ── Freighter response builders ───────────────────────────────────────────────
type IsConnectedResponse = Awaited<ReturnType<typeof isConnected>>;
type IsAllowedResponse = Awaited<ReturnType<typeof isAllowed>>;
type GetAddressResponse = Awaited<ReturnType<typeof getAddress>>;
type RequestAccessResponse = Awaited<ReturnType<typeof requestAccess>>;
type SignMessageResponse = Awaited<ReturnType<typeof signMessage>>;

const connectedRes = (v: boolean): IsConnectedResponse =>
  ({ isConnected: v } as IsConnectedResponse);
const allowedRes = (v: boolean): IsAllowedResponse =>
  ({ isAllowed: v } as IsAllowedResponse);
const addressRes = (addr: string): GetAddressResponse =>
  ({ address: addr } as GetAddressResponse);
const requestAccessRes = (addr: string): RequestAccessResponse =>
  ({ address: addr } as RequestAccessResponse);
const requestAccessErr = (msg = "User denied access"): RequestAccessResponse =>
  ({ error: { message: msg } } as unknown as RequestAccessResponse);
const signMessageRes = (signed: string): SignMessageResponse =>
  ({ signedMessage: signed } as unknown as SignMessageResponse);
const signMessageErr = (msg = "User cancelled"): SignMessageResponse =>
  ({ error: { message: msg } } as unknown as SignMessageResponse);

// ── Constants ─────────────────────────────────────────────────────────────────
const WALLET_ADDRESS = "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12";
const CHALLENGE_STRING = "dGVzdC1jaGFsbGVuZ2UtcmFuZG9tLWJ5dGVz";
const SIGNED_CHALLENGE = "c2lnbmVkLWNoYWxsZW5nZS1iYXNlNjR1cmw";
const JWT_TOKEN =
  // walletAddress=gabcdef..., exp = far future
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  btoa(
    JSON.stringify({
      sub: WALLET_ADDRESS.toLowerCase(),
      walletAddress: WALLET_ADDRESS.toLowerCase(),
      jti: "test-jti-001",
      iss: "amana",
      aud: "amana-api",
      iat: Math.floor(Date.now() / 1000) - 60,
      nbf: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 86400,
    })
  ).replace(/=/g, "") +
  ".mock-signature";

// ── Setup ─────────────────────────────────────────────────────────────────────

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

// Silence React act() warnings during async operations
beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
});

// Default: wallet not installed / not connected
function mockWalletAbsent() {
  mockedIsConnected.mockResolvedValue(connectedRes(false));
  mockedIsAllowed.mockResolvedValue(allowedRes(false));
}

function mockWalletConnected(address = WALLET_ADDRESS) {
  mockedIsConnected.mockResolvedValue(connectedRes(true));
  mockedIsAllowed.mockResolvedValue(allowedRes(true));
  mockedGetAddress.mockResolvedValue(addressRes(address));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Wallet detection
// ─────────────────────────────────────────────────────────────────────────────

describe("Freighter wallet detection", () => {
  it("sets isWalletDetected=true when Freighter is installed", async () => {
    mockedIsConnected.mockResolvedValue(connectedRes(true));
    mockedIsAllowed.mockResolvedValue(allowedRes(false)); // installed but not yet permitted

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isWalletDetected).toBe(true);
    expect(result.current.isWalletConnected).toBe(false);
  });

  it("sets isWalletDetected=false when Freighter is not installed", async () => {
    mockWalletAbsent();

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isWalletDetected).toBe(false);
  });

  it("sets isWalletConnected=true and exposes address when Freighter is connected", async () => {
    mockWalletConnected();

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isWalletConnected).toBe(true);
    expect(result.current.address).toBe(WALLET_ADDRESS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. connectWallet
// ─────────────────────────────────────────────────────────────────────────────

describe("connectWallet", () => {
  it("requests access from Freighter and updates address in state", async () => {
    mockWalletAbsent();
    mockedRequestAccess.mockResolvedValue(requestAccessRes(WALLET_ADDRESS));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.address).toBe(WALLET_ADDRESS);
    expect(result.current.isWalletConnected).toBe(true);
    expect(result.current.isWalletDetected).toBe(true);
  });

  it("sets error state when Freighter access is denied", async () => {
    mockWalletAbsent();
    mockedRequestAccess.mockResolvedValue(requestAccessErr());

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(result.current.address).toBeNull();
    expect(result.current.error).toMatch(/denied|failed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. authenticate — full challenge-sign-verify flow
// ─────────────────────────────────────────────────────────────────────────────

describe("authenticate — challenge-verify flow", () => {
  it("completes the full flow and stores the JWT", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockResolvedValue({ token: JWT_TOKEN });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe(JWT_TOKEN);
  });

  it("calls POST /auth/challenge with the wallet address", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockResolvedValue({ token: JWT_TOKEN });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(mockedChallenge).toHaveBeenCalledWith(WALLET_ADDRESS);
  });

  it("calls POST /auth/verify with the wallet address and signed challenge", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockResolvedValue({ token: JWT_TOKEN });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(mockedVerify).toHaveBeenCalledWith(
      WALLET_ADDRESS,
      SIGNED_CHALLENGE
    );
  });

  it("persists the JWT to sessionStorage", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockResolvedValue({ token: JWT_TOKEN });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(sessionStorage.getItem("amana_jwt")).toBe(JWT_TOKEN);
  });

  it("sets error state when wallet is not connected", async () => {
    mockWalletAbsent();

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toMatch(/not connected|wallet/i);
  });

  it("sets error state when challenge API call fails", async () => {
    mockWalletConnected();
    mockedChallenge.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toMatch(/network error/i);
  });

  it("sets error state when Freighter rejects signing", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageErr("User cancelled"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toMatch(/cancelled|sign/i);
  });

  it("sets error state when verify returns an invalid signature error (400)", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockRejectedValue(new (ApiError as any)(400, "Invalid signature"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toMatch(/invalid signature/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Subsequent requests carry JWT in Authorization header
// ─────────────────────────────────────────────────────────────────────────────

describe("Subsequent authenticated request", () => {
  it("exposes the JWT token in state for use in Authorization headers", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockResolvedValue({ token: JWT_TOKEN });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    // The token is available for consumers to attach as Authorization: Bearer <token>
    expect(result.current.token).toBe(JWT_TOKEN);
    expect(result.current.isAuthenticated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. logout
// ─────────────────────────────────────────────────────────────────────────────

describe("logout", () => {
  it("calls POST /auth/logout and clears token from state and sessionStorage", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockResolvedValue({ token: JWT_TOKEN });
    mockedLogout.mockResolvedValue({ message: "Logged out successfully" });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(sessionStorage.getItem("amana_jwt")).toBeNull();
  });

  it("calls the logout API with the current token", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockResolvedValue({ token: JWT_TOKEN });
    mockedLogout.mockResolvedValue({ message: "Logged out successfully" });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(mockedLogout).toHaveBeenCalledWith(JWT_TOKEN);
  });

  it("clears token even when the logout API call fails", async () => {
    mockWalletConnected();
    mockedChallenge.mockResolvedValue({ challenge: CHALLENGE_STRING });
    mockedSignMessage.mockResolvedValue(signMessageRes(SIGNED_CHALLENGE));
    mockedVerify.mockResolvedValue({ token: JWT_TOKEN });
    mockedLogout.mockRejectedValue(new Error("Server error"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.authenticate();
    });

    await act(async () => {
      await result.current.logout();
    });

    // Token must be cleared client-side even if server returns an error
    expect(result.current.token).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(sessionStorage.getItem("amana_jwt")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Session restoration from sessionStorage
// ─────────────────────────────────────────────────────────────────────────────

describe("Session restoration", () => {
  it("restores authentication from a valid stored JWT on mount", async () => {
    sessionStorage.setItem("amana_jwt", JWT_TOKEN);
    mockWalletConnected();

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe(JWT_TOKEN);
  });

  it("ignores an expired stored JWT on mount", async () => {
    // Build an expired JWT with a past exp
    const now = Math.floor(Date.now() / 1000);
    const expiredToken =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      btoa(
        JSON.stringify({
          sub: "test",
          walletAddress: "test",
          iat: now - 200,
          exp: now - 100, // already expired
        })
      ).replace(/=/g, "") +
      ".mock-signature";

    sessionStorage.setItem("amana_jwt", expiredToken);
    mockWalletConnected();

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
  });
});
