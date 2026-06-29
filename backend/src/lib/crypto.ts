import { EncryptionService } from "../services/encryption.service";

const encryptionService = new EncryptionService();

export function encrypt(plaintext: string, tradeId = "default"): string {
  return encryptionService.encrypt(plaintext, tradeId);
}

export function decrypt(ciphertext: string, tradeId = "default"): string {
  return encryptionService.decrypt(ciphertext, tradeId);
}
