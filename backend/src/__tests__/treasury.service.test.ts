import { TreasuryService } from "../services/treasury.service";

jest.mock("../services/stellar.service", () => {
  const mockGetAccountBalance = jest.fn();
  return {
    StellarService: jest.fn().mockImplementation(() => ({
      getAccountBalance: mockGetAccountBalance,
    })),
  };
});

jest.mock("../lib/accessControl", () => ({
  isMediatorAddress: jest.fn(),
}));

const { isMediatorAddress } = jest.requireMock("../lib/accessControl");

describe("TreasuryService", () => {
  let treasuryService: TreasuryService;

  beforeEach(() => {
    jest.clearAllMocks();
    treasuryService = new TreasuryService();
  });

  describe("getBalance", () => {
    it("should return balance with asset and contract id", async () => {
      const { StellarService } = jest.requireMock("../services/stellar.service");
      const mockInstance = StellarService.mock.results[0].value;
      mockInstance.getAccountBalance.mockResolvedValue("5000.50");

      const result = await treasuryService.getBalance();

      expect(result).toHaveProperty("balance", "5000.50");
      expect(result).toHaveProperty("asset");
      expect(result).toHaveProperty("contractId");
    });

    it("should return zero balance when account has no funds", async () => {
      const { StellarService } = jest.requireMock("../services/stellar.service");
      const mockInstance = StellarService.mock.results[0].value;
      mockInstance.getAccountBalance.mockResolvedValue("0");

      const result = await treasuryService.getBalance();

      expect(result.balance).toBe("0");
    });
  });

  describe("withdraw", () => {
    it("should reject withdrawal from non-admin caller", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);

      await expect(
        treasuryService.withdraw("GABCDEST", "100", "GNONADMIN"),
      ).rejects.toThrow("Only admin can withdraw treasury funds");
    });

    it("should accept withdrawal from admin caller", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(true);

      await expect(
        treasuryService.withdraw("GABCDEST", "100", "GADMIN"),
      ).rejects.toThrow("Treasury withdrawal is not yet implemented");
    });
  });

  describe("getConfig", () => {
    it("should return configuration object", () => {
      const config = treasuryService.getConfig();

      expect(config).toHaveProperty("contractId");
      expect(config).toHaveProperty("network");
      expect(config).toHaveProperty("asset");
    });
  });
});
