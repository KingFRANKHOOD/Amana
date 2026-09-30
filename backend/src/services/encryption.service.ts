import crypto from "crypto";
import { env } from "../config/env";
import { ErrorCode } from '../errors/errorCodes';
import { AppError } from '../errors/appError';

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 200_000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = "sha256";
const DEFAULT_KEY_VERSION = "v1";
const SUPPORTED_KEY_VERSIONS = new Set(["v1", "v2"]);

export class EncryptionService {
  constructor(private readonly masterSecret: string = env.TRADE_NOTES_ENCRYPTION_KEY ?? "") {
    if (!masterSecret.trim()) {
      throw new AppError(
        ErrorCode.INFRA_ERROR,
        "TRADE_NOTES_ENCRYPTION_KEY is required for trade note encryption",
        500,
      );
    }
  }

  async encrypt(plaintext: string, tradeId: string, keyVersion: string = DEFAULT_KEY_VERSION): Promise<string> {
    this.assertSupportedKeyVersion(keyVersion);
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = await this.deriveKey(salt, keyVersion);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      keyVersion,
      salt.toString("hex"),
      iv.toString("hex"),
      encrypted.toString("hex"),
      tag.toString("hex"),
    ].join(":");
  }

  async decrypt(ciphertext: string, tradeId: string): Promise<string> {
    const payload = this.parsePayload(ciphertext);
    this.assertSupportedKeyVersion(payload.keyVersion);
    const salt = Buffer.from(payload.saltHex, "hex");
    const key = await this.deriveKey(salt, payload.keyVersion);
    const iv = Buffer.from(payload.ivHex, "hex");
    const tag = Buffer.from(payload.tagHex, "hex");
    const cipherText = Buffer.from(payload.ciphertextHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
  }

  async rotateCiphertext(ciphertext: string, tradeId: string, newVersion: string = "v2"): Promise<string> {
    this.assertSupportedKeyVersion(newVersion);
    if (!this.isEncryptedPayload(ciphertext)) {
      return this.encrypt(ciphertext, tradeId, newVersion);
    }

    const plaintext = await this.decrypt(ciphertext, tradeId);
    return this.encrypt(plaintext, tradeId, newVersion);
  }

  private deriveKey(salt: Buffer, keyVersion: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        this.masterSecret,
        salt,
        PBKDF2_ITERATIONS,
        PBKDF2_KEY_LENGTH,
        PBKDF2_DIGEST,
        (err, derivedKey) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(derivedKey);
        },
      );
    });
  }

  private assertSupportedKeyVersion(keyVersion: string): void {
    if (!SUPPORTED_KEY_VERSIONS.has(keyVersion)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Unsupported encryption key version: ${keyVersion}`,
        400,
      );
    }
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
