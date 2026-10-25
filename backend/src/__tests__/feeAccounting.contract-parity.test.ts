/**
 * Cross-service drift guard: the backend's fee accounting bounds and default
 * must match the Soroban contract and the deploy script. If someone changes
 * MIN_FEE_BPS / MAX_FEE_BPS in lib.rs or the default FEE_BPS in the deploy
 * script, this test fails until the backend is updated too.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_FEE_BPS,
  MAX_FEE_BPS,
  MIN_FEE_BPS,
} from "../services/feeAccounting.service";

const repoRoot = join(__dirname, "..", "..", "..");

function readConst(source: string, name: string): number {
  const match = source.match(
    new RegExp(`pub const ${name}:\\s*u32\\s*=\\s*(\\d+)\\s*;`),
  );
  if (!match) throw new Error(`${name} not found in contract source`);
  return Number(match[1]);
}

describe("fee accounting ↔ contract parity", () => {
  const contractSrc = readFileSync(
    join(repoRoot, "contracts", "amana_escrow", "src", "lib.rs"),
    "utf8",
  );

  it("MIN_FEE_BPS matches contract", () => {
    expect(MIN_FEE_BPS).toBe(readConst(contractSrc, "MIN_FEE_BPS"));
  });

  it("MAX_FEE_BPS matches contract", () => {
    expect(MAX_FEE_BPS).toBe(readConst(contractSrc, "MAX_FEE_BPS"));
  });

  it("DEFAULT_FEE_BPS matches deploy script initial FEE_BPS", () => {
    const script = readFileSync(
      join(repoRoot, "scripts", "deploy-contract-local.sh"),
      "utf8",
    );
    const match = script.match(/^FEE_BPS="(\d+)"/m);
    expect(match).not.toBeNull();
    expect(DEFAULT_FEE_BPS).toBe(Number(match![1]));
  });

  it("contract emits FeeRateUpdated which the backend handles (not a noop)", () => {
    expect(contractSrc).toMatch(/struct FeeRateUpdatedEvent\s*\{[^}]*new_fee_bps/);
    const handlersSrc = readFileSync(
      join(__dirname, "..", "services", "eventHandlers.ts"),
      "utf8",
    );
    expect(handlersSrc).toMatch(
      /\[EventType\.FeeRateUpdated\]:\s*handleFeeRateUpdated/,
    );
    expect(handlersSrc).toMatch(/event\.data\.new_fee_bps/);
  });
});
