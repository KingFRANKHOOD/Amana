/** Minimal env for unit tests (config/env is parsed at import time). */
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "0".repeat(32);
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/amana_test";
process.env.AMANA_ESCROW_CONTRACT_ID =
  process.env.AMANA_ESCROW_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
process.env.USDC_CONTRACT_ID =
  process.env.USDC_CONTRACT_ID ??
  "CBIELTK6YBZJU5UP2WWQEUCY7PUJE7R6OB3NIUJKL5UH4WJQJ6HVHKX";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
