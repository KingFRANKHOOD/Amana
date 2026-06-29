import {
  TradeSchema,
  WalletSchema,
  DisputeSchema,
  ManifestSchema,
  NotificationPreferencesSchema,
} from "@/lib/validation/schemas";

// ── TradeSchema ───────────────────────────────────────────────────────────────

describe("TradeSchema", () => {
  const valid = {
    tradeId: "trade-001",
    buyerAddress: "GABCDEF1234567890",
    sellerAddress: "GXYZABC9876543210",
    amountCngn: "1000.50",
    buyerLossBps: 200,
    sellerLossBps: 300,
    status: "FUNDED",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  };

  it("accepts valid trade data", () => {
    expect(() => TradeSchema.parse(valid)).not.toThrow();
  });

  it("accepts integer amounts", () => {
    expect(() => TradeSchema.parse({ ...valid, amountCngn: "1000" })).not.toThrow();
  });

  it("rejects empty tradeId", () => {
    const result = TradeSchema.safeParse({ ...valid, tradeId: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/required/i);
    }
  });

  it("rejects non-numeric amountCngn", () => {
    const result = TradeSchema.safeParse({ ...valid, amountCngn: "not-a-number" });
    expect(result.success).toBe(false);
  });

  it("rejects negative amountCngn", () => {
    const result = TradeSchema.safeParse({ ...valid, amountCngn: "-50" });
    expect(result.success).toBe(false);
  });

  it("rejects buyerLossBps above 10000", () => {
    const result = TradeSchema.safeParse({ ...valid, buyerLossBps: 10001 });
    expect(result.success).toBe(false);
  });

  it("rejects negative sellerLossBps", () => {
    const result = TradeSchema.safeParse({ ...valid, sellerLossBps: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects fractional bps values", () => {
    const result = TradeSchema.safeParse({ ...valid, buyerLossBps: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { tradeId: _omit, ...rest } = valid;
    const result = TradeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts 0 bps values (edge case)", () => {
    expect(() =>
      TradeSchema.parse({ ...valid, buyerLossBps: 0, sellerLossBps: 0 })
    ).not.toThrow();
  });

  it("accepts max bps value 10000", () => {
    expect(() =>
      TradeSchema.parse({ ...valid, buyerLossBps: 10000, sellerLossBps: 10000 })
    ).not.toThrow();
  });
});

// ── WalletSchema ──────────────────────────────────────────────────────────────

describe("WalletSchema", () => {
  const valid = { balance: "250.00", asset: "cNGN" };

  it("accepts valid wallet data", () => {
    expect(() => WalletSchema.parse(valid)).not.toThrow();
  });

  it("accepts zero balance", () => {
    expect(() => WalletSchema.parse({ ...valid, balance: "0" })).not.toThrow();
  });

  it("rejects negative balance", () => {
    const result = WalletSchema.safeParse({ ...valid, balance: "-10" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric balance", () => {
    const result = WalletSchema.safeParse({ ...valid, balance: "abc" });
    expect(result.success).toBe(false);
  });

  it("rejects empty asset code", () => {
    const result = WalletSchema.safeParse({ ...valid, asset: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing balance", () => {
    const { balance: _omit, ...rest } = valid;
    const result = WalletSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ── DisputeSchema ─────────────────────────────────────────────────────────────

describe("DisputeSchema", () => {
  const valid = {
    tradeId: "trade-001",
    reason: "The goods were damaged beyond agreed loss ratios.",
    category: "quality" as const,
  };

  it("accepts valid dispute data", () => {
    expect(() => DisputeSchema.parse(valid)).not.toThrow();
  });

  it("accepts all valid categories", () => {
    const categories = ["quality", "delivery", "payment", "fraud", "other"] as const;
    for (const category of categories) {
      expect(() => DisputeSchema.parse({ ...valid, category })).not.toThrow();
    }
  });

  it("accepts optional evidenceCids", () => {
    expect(() =>
      DisputeSchema.parse({ ...valid, evidenceCids: ["bafkreiabc123"] })
    ).not.toThrow();
  });

  it("rejects reason shorter than 10 characters", () => {
    const result = DisputeSchema.safeParse({ ...valid, reason: "short" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/10 characters/i);
    }
  });

  it("rejects reason longer than 500 characters", () => {
    const result = DisputeSchema.safeParse({ ...valid, reason: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = DisputeSchema.safeParse({ ...valid, category: "unknown" });
    expect(result.success).toBe(false);
  });

  it("rejects empty tradeId", () => {
    const result = DisputeSchema.safeParse({ ...valid, tradeId: "" });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 10-character reason (boundary)", () => {
    expect(() => DisputeSchema.parse({ ...valid, reason: "1234567890" })).not.toThrow();
  });
});

// ── ManifestSchema ────────────────────────────────────────────────────────────

describe("ManifestSchema", () => {
  const valid = {
    driverName: "Amina Khalid",
    driverPhone: "+234 803 000 0000",
    licensePlate: "GEG 1123 H",
  };

  it("accepts valid manifest data", () => {
    expect(() => ManifestSchema.parse(valid)).not.toThrow();
  });

  it("accepts optional vehicleType and notes", () => {
    expect(() =>
      ManifestSchema.parse({ ...valid, vehicleType: "Truck", notes: "Handle with care" })
    ).not.toThrow();
  });

  it("rejects driverName shorter than 2 characters", () => {
    const result = ManifestSchema.safeParse({ ...valid, driverName: "A" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/2 characters/i);
    }
  });

  it("rejects driverName longer than 100 characters", () => {
    const result = ManifestSchema.safeParse({ ...valid, driverName: "A".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid phone number", () => {
    const result = ManifestSchema.safeParse({ ...valid, driverPhone: "not-a-phone" });
    expect(result.success).toBe(false);
  });

  it("accepts phone without country code", () => {
    expect(() => ManifestSchema.parse({ ...valid, driverPhone: "08030000000" })).not.toThrow();
  });

  it("rejects licensePlate shorter than 2 characters", () => {
    const result = ManifestSchema.safeParse({ ...valid, licensePlate: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects notes longer than 500 characters", () => {
    const result = ManifestSchema.safeParse({ ...valid, notes: "x".repeat(501) });
    expect(result.success).toBe(false);
  });
});

// ── NotificationPreferencesSchema ─────────────────────────────────────────────

describe("NotificationPreferencesSchema", () => {
  const valid = {
    email: true,
    sms: false,
    push: true,
    tradeUpdates: true,
    disputeAlerts: true,
    settlementAlerts: false,
  };

  it("accepts valid preferences", () => {
    expect(() => NotificationPreferencesSchema.parse(valid)).not.toThrow();
  });

  it("defaults marketingEmails to false when omitted", () => {
    const result = NotificationPreferencesSchema.parse(valid);
    expect(result.marketingEmails).toBe(false);
  });

  it("accepts explicit marketingEmails value", () => {
    const result = NotificationPreferencesSchema.parse({ ...valid, marketingEmails: true });
    expect(result.marketingEmails).toBe(true);
  });

  it("rejects non-boolean email field", () => {
    const result = NotificationPreferencesSchema.safeParse({ ...valid, email: "yes" });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { email: _omit, ...rest } = valid;
    const result = NotificationPreferencesSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("accepts all-false preferences", () => {
    const allFalse = {
      email: false,
      sms: false,
      push: false,
      tradeUpdates: false,
      disputeAlerts: false,
      settlementAlerts: false,
    };
    expect(() => NotificationPreferencesSchema.parse(allFalse)).not.toThrow();
  });
});
