import { EncryptionService } from "../services/encryption.service";

const encryptionService = new EncryptionService();

export async function encrypt(plaintext: string, tradeId = "default"): Promise<string> {
  return encryptionService.encrypt(plaintext, tradeId);
}

export async function decrypt(ciphertext: string, tradeId = "default"): Promise<string> {
  return encryptionService.decrypt(ciphertext, tradeId);
}
