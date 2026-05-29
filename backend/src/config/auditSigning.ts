import { env } from './env';

export interface AuditSigningConfig {
  keyId?: string;
  privateKeyPem?: string;
  publicKeyPem?: string;
}

/** Resolve audit signing keys, allowing runtime overrides in tests. */
export function getAuditSigningConfig(): AuditSigningConfig {
  return {
    keyId: process.env.AUDIT_SIGNING_KEY_ID ?? env.AUDIT_SIGNING_KEY_ID,
    privateKeyPem:
      process.env.AUDIT_SIGNING_PRIVATE_KEY_PEM ?? env.AUDIT_SIGNING_PRIVATE_KEY_PEM,
    publicKeyPem:
      process.env.AUDIT_SIGNING_PUBLIC_KEY_PEM ?? env.AUDIT_SIGNING_PUBLIC_KEY_PEM,
  };
}
