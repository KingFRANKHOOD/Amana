import { formatUsdc, formatXlm, formatStroops } from "@/lib/stellar/format";

describe("formatUsdc", () => {
  it("formats zero", () => {
    expect(formatUsdc(0)).toBe("$0.00");
  });

  it("formats 1 USDC (10_000_000 stroops)", () => {
    expect(formatUsdc(10_000_000)).toBe("$1.00");
  });

  it("formats $1,234.56", () => {
    expect(formatUsdc(12_345_600_000)).toBe("$1,234.56");
  });

  it("formats large value with thousands separator", () => {
    expect(formatUsdc(1_000_000_000_000)).toBe("$100,000.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatUsdc(10_500_000)).toBe("$1.05");
  });

  it("formats fractional cents", () => {
    expect(formatUsdc(1_000_000)).toBe("$0.10");
  });
});

describe("formatXlm", () => {
  it("formats zero", () => {
    expect(formatXlm(0)).toBe("0.0000 XLM");
  });

  it("formats 1 XLM (10_000_000 stroops)", () => {
    expect(formatXlm(10_000_000)).toBe("1.0000 XLM");
  });

  it("formats fractional XLM with 4 decimal places", () => {
    expect(formatXlm(12_345_678)).toBe("1.2346 XLM");
  });

  it("formats large XLM with thousands separator", () => {
    expect(formatXlm(10_000_000_000)).toBe("1,000.0000 XLM");
  });

  it("includes XLM suffix", () => {
    expect(formatXlm(10_000_000)).toMatch(/XLM$/);
  });
});

describe("formatStroops", () => {
  it("formats with 7 decimals (standard Stellar)", () => {
    expect(formatStroops(10_000_000, 7)).toBe("1.0000000");
  });

  it("formats with 2 decimals", () => {
    expect(formatStroops(12345, 2)).toBe("123.45");
  });

  it("formats zero", () => {
    expect(formatStroops(0, 7)).toBe("0.0000000");
  });

  it("pads fractional part", () => {
    expect(formatStroops(10_000_001, 7)).toBe("1.0000001");
  });

  it("formats large value with separator", () => {
    expect(formatStroops(1_000_000_000_000, 7)).toBe("100,000.0000000");
  });
});
