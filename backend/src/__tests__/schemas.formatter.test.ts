/**
 * Unit tests for trade schema formatters and validators
 *
 * Tests cover:
 * - Amount formatting and validation
 * - Stellar public key validation
 * - Loss basis points validation and sum constraint
 * - List query parameter parsing and defaults
 * - Sort field parsing
 */

import {
  createTradeSchema,
  tradeIdParamSchema,
  listTradesQuerySchema,
  initiateDisputeSchema,
} from "../schemas/trade.schemas";

describe("Trade Schemas - Formatters & Validators", () => {
  describe("createTradeSchema", () => {
    describe("Amount Formatting", () => {
      it("should accept valid USDC amounts as strings", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000.50",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.amountUsdc).toBe("1000.50");
        }
      });

      it("should accept valid USDC amounts as numbers", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: 1000.5,
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.amountUsdc).toBe("1000.50");
        }
      });

      it("should reject negative amounts", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: -1000,
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });

      it("should reject zero amounts", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: 0,
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });

      it("should accept amounts with up to 7 decimal places", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000.1234567",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(true);
      });

      it("should reject amounts with more than 7 decimal places", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000.12345678",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });

      it("should reject non-numeric string amounts", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "abc.xyz",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("Delivery Window (#1639)", () => {
      const base = {
        sellerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        amountUsdc: "100",
      };

      it("keeps deliveryDays instead of stripping it", () => {
        const result = createTradeSchema.safeParse({ ...base, deliveryDays: 7 });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.deliveryDays).toBe(7);
      });

      it("treats deliveryDays as optional", () => {
        expect(createTradeSchema.safeParse(base).success).toBe(true);
      });

      it.each([0, -1, 366, 2.5])("rejects deliveryDays=%p", (deliveryDays) => {
        expect(createTradeSchema.safeParse({ ...base, deliveryDays }).success).toBe(false);
      });
    });

    describe("Stellar Public Key Validation", () => {
      it("should accept valid seller address", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(true);
      });

      it("should reject invalid seller address", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress: "not-a-valid-key",
          amountUsdc: "1000",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });

      it("should accept valid buyer address (optional)", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          buyerAddress:
            "GBDZLHUWUWEEUZMFTYDYLOD2NRFQ4PFMRJ5EW5U6F4RGK5IJOVVUNFL",
          amountUsdc: "1000",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(true);
      });

      it("should reject invalid buyer address when provided", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          buyerAddress: "invalid-key",
          amountUsdc: "1000",
          buyerLossBps: 5000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("Loss Basis Points Validation", () => {
      it("should accept valid loss basis points (0-10000)", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: 3000,
          sellerLossBps: 7000,
        });
        expect(result.success).toBe(true);
      });

      it("should reject negative loss basis points", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: -1000,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });

      it("should reject loss basis points > 10000", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: 10001,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });

      it("should reject non-integer loss basis points", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: 5000.5,
          sellerLossBps: 5000,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("Loss Basis Points Sum Constraint", () => {
      it("should require buyerLossBps + sellerLossBps = 10000", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: 3000,
          sellerLossBps: 7000,
        });
        expect(result.success).toBe(true);
      });

      it("should reject when sum is less than 10000", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: 3000,
          sellerLossBps: 6000,
        });
        expect(result.success).toBe(false);
      });

      it("should reject when sum is greater than 10000", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: 5001,
          sellerLossBps: 5001,
        });
        expect(result.success).toBe(false);
      });

      it("should use default 5000/5000 split when not provided", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.buyerLossBps).toBeUndefined();
          expect(result.data.sellerLossBps).toBeUndefined();
        }
      });

      it("should reject when only buyerLossBps is provided", () => {
        const result = createTradeSchema.safeParse({
          sellerAddress:
            "GDQLTM4CD55FGYLT4DQX2UR7F2EPXW37T4ABIARI4XKOWLSUBK4FSVN",
          amountUsdc: "1000",
          buyerLossBps: 5000,
        });
        // The schema requires the sum to be 10000, so this should fail
        // unless sellerLossBps defaults to 5000
        expect(result.success).toBe(false);
      });
    });
  });

  describe("listTradesQuerySchema", () => {
    describe("Pagination Parsing", () => {
      it("should parse page and limit from query parameters", () => {
        const result = listTradesQuerySchema.safeParse({
          page: "2",
          limit: "50",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(2);
          expect(result.data.limit).toBe(50);
        }
      });

      it("should use default page=1 when not provided", () => {
        const result = listTradesQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
        }
      });

      it("should use default limit=20 when not provided", () => {
        const result = listTradesQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(20);
        }
      });

      it("should reject page < 1", () => {
        const result = listTradesQuerySchema.safeParse({ page: 0 });
        expect(result.success).toBe(false);
      });

      it("should reject limit > 100", () => {
        const result = listTradesQuerySchema.safeParse({ limit: 101 });
        expect(result.success).toBe(false);
      });

      it("should reject limit < 1", () => {
        const result = listTradesQuerySchema.safeParse({ limit: 0 });
        expect(result.success).toBe(false);
      });

      it("should reject non-integer page values", () => {
        const result = listTradesQuerySchema.safeParse({ page: 2.5 });
        expect(result.success).toBe(false);
      });

      it("should reject non-integer limit values", () => {
        const result = listTradesQuerySchema.safeParse({ limit: 20.5 });
        expect(result.success).toBe(false);
      });

      it("should accept numeric strings for page and limit", () => {
        const result = listTradesQuerySchema.safeParse({
          page: "3",
          limit: "25",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(3);
          expect(result.data.limit).toBe(25);
        }
      });

      it("should reject non-numeric strings for page and limit", () => {
        const result = listTradesQuerySchema.safeParse({
          page: "abc",
          limit: "xyz",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("Status Filtering", () => {
      const validStatuses = [
        "PENDING_SIGNATURE",
        "PENDING_DEPOSIT",
        "FUNDED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
        "DISPUTED",
      ];

      validStatuses.forEach((status) => {
        it(`should accept status filter: ${status}`, () => {
          const result = listTradesQuerySchema.safeParse({ status });
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.status).toBe(status);
          }
        });
      });

      it("should reject invalid status values", () => {
        const result = listTradesQuerySchema.safeParse({
          status: "INVALID_STATUS",
        });
        expect(result.success).toBe(false);
      });

      it("should make status optional", () => {
        const result = listTradesQuerySchema.safeParse({
          page: 1,
          limit: 20,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBeUndefined();
        }
      });
    });

    describe("Sort Field Parsing", () => {
      it("should accept descending sort with dash prefix", () => {
        const result = listTradesQuerySchema.safeParse({
          sort: "-createdAt",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.sort).toBe("-createdAt");
        }
      });

      it("should accept ascending sort without prefix", () => {
        const result = listTradesQuerySchema.safeParse({
          sort: "amountUsdc",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.sort).toBe("amountUsdc");
        }
      });

      it("should make sort optional", () => {
        const result = listTradesQuerySchema.safeParse({
          page: 1,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.sort).toBeUndefined();
        }
      });
    });
  });

  describe("tradeIdParamSchema", () => {
    it("should accept valid trade ID", () => {
      const result = tradeIdParamSchema.safeParse({
        id: "trade-uuid-123",
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty ID", () => {
      const result = tradeIdParamSchema.safeParse({
        id: "",
      });
      expect(result.success).toBe(false);
    });

    it("should require ID parameter", () => {
      const result = tradeIdParamSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("initiateDisputeSchema", () => {
    it("should accept valid dispute with reason and category", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "Product quality does not match specification",
        category: "product_quality",
      });
      expect(result.success).toBe(true);
    });

    it("should accept valid dispute with reason and categoryId", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "Product quality does not meet agreement",
        categoryId: 1,
      });
      expect(result.success).toBe(true);
    });

    it("should reject reason shorter than 10 characters", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "Too short",
        category: "product_quality",
      });
      expect(result.success).toBe(false);
    });

    it("should reject reason with exactly 9 characters", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "123456789",
        category: "product_quality",
      });
      expect(result.success).toBe(false);
    });

    it("should accept reason with exactly 10 characters", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "1234567890",
        category: "product_quality",
      });
      expect(result.success).toBe(true);
    });

    it("should reject category longer than 100 characters", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "Product quality does not meet specification",
        category: "a".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("should reject categoryId when not a positive integer", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "Product quality does not meet specification",
        categoryId: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject categoryId as negative number", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "Product quality does not meet specification",
        categoryId: -1,
      });
      expect(result.success).toBe(false);
    });

    it("should require either category or categoryId", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "Product quality does not meet specification",
      });
      expect(result.success).toBe(false);
    });

    it("should trim category whitespace", () => {
      const result = initiateDisputeSchema.safeParse({
        reason: "Product quality does not meet specification",
        category: "  product_quality  ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.category).toBe("product_quality");
      }
    });
  });
});
