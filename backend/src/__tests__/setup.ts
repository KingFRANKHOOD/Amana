// Set required env vars before any module is loaded
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
process.env.AMANA_ESCROW_CONTRACT_ID = process.env.AMANA_ESCROW_CONTRACT_ID || "CTEST00000000000000000000000000000000000000000000000000000";
process.env.USDC_CONTRACT_ID = process.env.USDC_CONTRACT_ID || "CUSDC00000000000000000000000000000000000000000000000000000";
process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
process.env.TRADE_NOTES_ENCRYPTION_KEY = process.env.TRADE_NOTES_ENCRYPTION_KEY || "test-trade-notes-encryption-key-base64-32chr";

process.on("unhandledRejection", (reason: any) => {
  if (reason?.code === "ECONNREFUSED" || reason?.message?.includes("ECONNREFUSED")) {
    return;
  }
});
