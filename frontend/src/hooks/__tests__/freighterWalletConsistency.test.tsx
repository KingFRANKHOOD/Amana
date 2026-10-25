import { act, renderHook, waitFor } from "@testing-library/react";
import * as freighter from "@stellar/freighter-api";
import { readFreighterWalletState, shortenAddress } from "@/lib/freighterWallet";
import { useWalletConnection, shortenAddress as reExportedShorten } from "@/hooks/useWalletConnection";
import {
  __resetFreighterIdentityStoreForTests,
  useFreighterIdentity,
} from "@/hooks/useFreighterIdentity";

jest.mock("@stellar/freighter-api", () => ({
  getAddress: jest.fn(),
  isAllowed: jest.fn(),
  isConnected: jest.fn(),
  requestAccess: jest.fn(),
}));

const ADDRESS = "GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU";
const mocked = freighter as jest.Mocked<typeof freighter>;

function mockFreighter(connected: boolean, allowed: boolean) {
  mocked.isConnected.mockResolvedValue({ isConnected: connected } as never);
  mocked.isAllowed.mockResolvedValue({ isAllowed: allowed } as never);
  mocked.getAddress.mockResolvedValue({ address: ADDRESS } as never);
}

describe("shared Freighter wallet-state logic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetFreighterIdentityStoreForTests();
  });

  it("uses a single shortenAddress implementation", () => {
    expect(reExportedShorten).toBe(shortenAddress);
    expect(shortenAddress(ADDRESS)).toBe(`${ADDRESS.slice(0, 6)}...${ADDRESS.slice(-6)}`);
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("consumers agree for connected=%s allowed=%s", async (connected, allowed) => {
    mockFreighter(connected, allowed);

    const shared = await readFreighterWalletState();

    const connection = renderHook(() => useWalletConnection());
    let viaConnection!: Awaited<ReturnType<typeof readFreighterWalletState>>;
    await act(async () => {
      viaConnection = await connection.result.current.checkWalletState();
    });

    const identity = renderHook(() => useFreighterIdentity());
    await waitFor(() => expect(identity.result.current.isLoading).toBe(false));

    expect(viaConnection).toEqual(shared);
    expect(identity.result.current.isAuthorized).toBe(shared.hasWallet && shared.hasPermission);
    expect(identity.result.current.isWalletDetected).toBe(shared.hasWallet);
    expect(identity.result.current.address).toBe(shared.address);
  });
});
