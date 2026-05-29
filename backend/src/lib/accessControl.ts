/**
 * Shared access-control helpers for mediator and arbitrator route guards.
 *
 * Centralises the ADMIN_STELLAR_PUBKEYS check so every controller and service
 * reads the allowlist from the same place rather than duplicating the parsing
 * logic inline.
 */

import { env } from "../config/env";

function adminPubkeysRaw(): string {
  return process.env.ADMIN_STELLAR_PUBKEYS ?? env.ADMIN_STELLAR_PUBKEYS ?? "";
}

/** Returns the set of mediator/arbitrator addresses from the environment. */
export function getMediatorAllowlist(): Set<string> {
  return new Set(
    adminPubkeysRaw()
      .split(",")
      .map((a: string) => a.trim())
      .filter(Boolean)
  );
}

/** Case-normalized admin allowlist for services that compare lowercase addresses. */
export function getAdminAllowlistLowercase(): Set<string> {
  return new Set(
    adminPubkeysRaw()
      .split(",")
      .map((a: string) => a.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Returns true when `address` appears in the ADMIN_STELLAR_PUBKEYS allowlist. */
export function isMediatorAddress(address: string): boolean {
  return getMediatorAllowlist().has(address);
}
