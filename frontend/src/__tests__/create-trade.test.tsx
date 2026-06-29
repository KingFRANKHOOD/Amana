import { validateStep1, validateStep2, step1Schema, step2Schema } from "../app/trades/create/validation";

describe("Create Trade Validation", () => {
  describe("step1Schema", () => {
    it("accepts valid step 1 data", () => {
      const data = {
        commodity: "Maize",
        quantity: "500",
        unit: "kg",
        pricePerUnit: "450",
        currency: "NGN",
        sellerAddress: "GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU",
      };
      const result = step1Schema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects empty commodity", () => {
      const data = {
        commodity: "",
        quantity: "500",
        unit: "kg",
        pricePerUnit: "450",
        currency: "NGN",
        sellerAddress: "GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU",
      };
      const result = step1Schema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("rejects zero quantity", () => {
      const data = {
        commodity: "Maize",
        quantity: "0",
        unit: "kg",
        pricePerUnit: "450",
        currency: "NGN",
        sellerAddress: "GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU",
      };
      const result = step1Schema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("rejects invalid seller address", () => {
      const data = {
        commodity: "Maize",
        quantity: "500",
        unit: "kg",
        pricePerUnit: "450",
        currency: "NGN",
        sellerAddress: "invalid-address",
      };
      const result = step1Schema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe("step2Schema", () => {
    it("accepts valid step 2 data", () => {
      const data = {
        buyerRatio: 50,
        sellerRatio: 50,
        deliveryDays: "7",
      };
      const result = step2Schema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects delivery days outside range", () => {
      const data = {
        buyerRatio: 50,
        sellerRatio: 50,
        deliveryDays: "100",
      };
      const result = step2Schema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe("validateStep1", () => {
    it("returns empty errors for valid data", () => {
      const errors = validateStep1({
        commodity: "Maize",
        quantity: "500",
        unit: "kg",
        pricePerUnit: "450",
        currency: "NGN",
        sellerAddress: "GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU",
      });
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it("returns errors for invalid data", () => {
      const errors = validateStep1({
        commodity: "",
        quantity: "0",
        unit: "kg",
        pricePerUnit: "450",
        currency: "NGN",
        sellerAddress: "invalid",
      });
      expect(Object.keys(errors).length).toBeGreaterThan(0);
    });
  });

  describe("validateStep2", () => {
    it("returns empty errors for valid data", () => {
      const errors = validateStep2({
        buyerRatio: 50,
        sellerRatio: 50,
        deliveryDays: "7",
      });
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it("returns error when ratios do not sum to 100", () => {
      const errors = validateStep2({
        buyerRatio: 60,
        sellerRatio: 30,
        deliveryDays: "7",
      });
      expect(errors.sum).toBeDefined();
    });
  });
});
