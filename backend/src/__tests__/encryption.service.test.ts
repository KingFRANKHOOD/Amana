import { EncryptionService } from "../services/encryption.service";

describe("EncryptionService", () => {
  const service = new EncryptionService("test-master-secret-value-with-minimum-length-32");

  it("encrypts and decrypts text for a specific trade", () => {
    const plaintext = "Sensitive note content";

    const ciphertext = service.encrypt(plaintext, "trade-123");

    expect(ciphertext).not.toEqual(plaintext);
    expect(service.decrypt(ciphertext, "trade-123")).toEqual(plaintext);
  });

  it("rejects tampered ciphertext", () => {
    const ciphertext = service.encrypt("Sensitive note content", "trade-123");
    const tampered = ciphertext.slice(0, -1) + (ciphertext.at(-1) === "A" ? "B" : "A");

    expect(() => service.decrypt(tampered, "trade-123")).toThrow();
  });

  it("rotates ciphertext to a new key version", () => {
    const ciphertext = service.encrypt("Need rotation", "trade-456", "v1");

    const rotated = service.rotateCiphertext(ciphertext, "trade-456", "v2");

    expect(rotated).toContain("v2:");
    expect(service.decrypt(rotated, "trade-456")).toEqual("Need rotation");
  });
});
