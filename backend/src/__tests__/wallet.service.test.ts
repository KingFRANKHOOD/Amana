import { WalletService } from "../services/wallet.service";
import { StellarService } from "../services/stellar.service";
import { TOKEN_CONFIG } from "../config/token";

describe("WalletService", () => {
  const walletAddress =
    "GABCD1234EFGH5678IJKL9012MNOP3456QRST7890UVWXYZABCD1234";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("delegates getUsdcBalance to StellarService with configured token symbol", async () => {
    const getAccountBalance = jest
      .spyOn(StellarService.prototype, "getAccountBalance")
      .mockResolvedValue("77.5");

    const walletService = new WalletService();
    await expect(walletService.getUsdcBalance(walletAddress)).resolves.toBe("77.5");

    expect(getAccountBalance).toHaveBeenCalledWith(walletAddress, TOKEN_CONFIG.symbol);
  });

  it("delegates getTokenBalance to StellarService", async () => {
    const getAccountBalance = jest
      .spyOn(StellarService.prototype, "getAccountBalance")
      .mockResolvedValue("1000");

    const walletService = new WalletService();
    await expect(walletService.getTokenBalance(walletAddress)).resolves.toBe("1000");

    expect(getAccountBalance).toHaveBeenCalledWith(walletAddress, TOKEN_CONFIG.symbol);
  });

  describe("failure matrix — provider errors propagate", () => {
    it("getUsdcBalance propagates a network failure from StellarService", async () => {
      jest
        .spyOn(StellarService.prototype, "getAccountBalance")
        .mockRejectedValue(new Error("Network request failed"));

      const walletService = new WalletService();
      await expect(walletService.getUsdcBalance(walletAddress)).rejects.toThrow(
        "Network request failed"
      );
    });

    it("getTokenBalance propagates a provider failure from StellarService", async () => {
      jest
        .spyOn(StellarService.prototype, "getAccountBalance")
        .mockRejectedValue(new Error("RPC provider timeout"));

      const walletService = new WalletService();
      await expect(walletService.getTokenBalance(walletAddress)).rejects.toThrow(
        "RPC provider timeout"
      );
    });

    it("getUsdcBalance propagates rejection when account does not exist on-chain", async () => {
      jest
        .spyOn(StellarService.prototype, "getAccountBalance")
        .mockRejectedValue(new Error("Account not found"));

      const walletService = new WalletService();
      await expect(walletService.getUsdcBalance(walletAddress)).rejects.toThrow(
        "Account not found"
      );
    });

    it("getTokenBalance passes the caller-supplied address directly to StellarService", async () => {
      const spy = jest
        .spyOn(StellarService.prototype, "getAccountBalance")
        .mockResolvedValue("0");

      const walletService = new WalletService();
      const unusualAddress = "G" + "X".repeat(55);
      await walletService.getTokenBalance(unusualAddress);

      expect(spy).toHaveBeenCalledWith(unusualAddress, TOKEN_CONFIG.symbol);
    });
  });
});
