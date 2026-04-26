import { scrubProperties } from "@/lib/analytics";

describe("analytics scrubProperties", () => {
  it("should redact sensitive keys", () => {
    const input = {
      email: "alice@example.com",
      firstName: "Alice",
      walletAddress: "0x1234567890123456789012345678901234567890",
      safeValue: "hello",
    };

    const output = scrubProperties(input);

    expect(output.email).toBe("[REDACTED]");
    expect(output.firstName).toBe("[REDACTED]");
    expect(output.walletAddress).toBe("[REDACTED]");
    expect(output.safeValue).toBe("hello");
  });

  it("should redact embedded PII patterns", () => {
    const input = {
      message: "Contact bob@domain.com for support",
      ip: "192.168.0.1",
      nested: {
        wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      },
    };

    const output = scrubProperties(input);

    expect(output.message).toBe("[REDACTED]");
    expect(output.ip).toBe("[REDACTED]");
    expect((output.nested as { wallet: string }).wallet).toBe("[REDACTED]");
  });
});
