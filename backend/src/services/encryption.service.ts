import crypto from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const DEFAULT_KEY_VERSION = "v1";

export class EncryptionService {
  constructor(private readonly masterSecret: string = env.JWT_SECRET) {}

  encrypt(plaintext: string, tradeId: string, keyVersion: string = DEFAULT_KEY_VERSION): string {
    const key = this.deriveKey(tradeId, keyVersion);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      keyVersion,
      this.saltFor(tradeId, keyVersion).toString("hex"),
      iv.toString("hex"),
      encrypted.toString("hex"),
      tag.toString("hex"),
    ].join(":");
  }

  decrypt(ciphertext: string, tradeId: string): string {
    const payload = this.parsePayload(ciphertext);
    const key = this.deriveKey(tradeId, payload.keyVersion);
    const iv = Buffer.from(payload.ivHex, "hex");
    const tag = Buffer.from(payload.tagHex, "hex");
    const cipherText = Buffer.from(payload.ciphertextHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
  }

  rotateCiphertext(ciphertext: string, tradeId: string, newVersion: string = "v2"): string {
    if (!this.isEncryptedPayload(ciphertext)) {
      return this.encrypt(ciphertext, tradeId, newVersion);
    }

    const plaintext = this.decrypt(ciphertext, tradeId);
    return this.encrypt(plaintext, tradeId, newVersion);
  }

  private deriveKey(tradeId: string, keyVersion: string): Buffer {
    const salt = this.saltFor(tradeId, keyVersion);
    return crypto.pbkdf2Sync(this.masterSecret, salt, 200_000, 32, "sha256");
  }

  private saltFor(tradeId: string, keyVersion: string): Buffer {
    return crypto.createHash("sha256").update(`${this.masterSecret}:${tradeId}:${keyVersion}`).digest();
  }

  private parsePayload(ciphertext: string): {
    keyVersion: string;
    saltHex: string;
    ivHex: string;
    ciphertextHex: string;
    tagHex: string;
  } {
    const parts = ciphertext.split(":");
    if (parts.length !== 5) {
      throw new Error("Invalid encrypted payload");
    }

    const [keyVersion, saltHex, ivHex, ciphertextHex, tagHex] = parts;
    if (!keyVersion || !saltHex || !ivHex || !ciphertextHex || !tagHex) {
      throw new Error("Invalid encrypted payload");
    }

    return { keyVersion, saltHex, ivHex, ciphertextHex, tagHex };
  }

  private isEncryptedPayload(value: string): boolean {
    return /^v\d+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value);
  }
}
