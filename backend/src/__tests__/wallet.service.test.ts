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
});
