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

/** Normalizes a Stellar address to lowercase for consistent comparison. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** Returns the set of mediator/arbitrator addresses from the environment, normalized to lowercase. */
export function getMediatorAllowlist(): Set<string> {
  return new Set(
    adminPubkeysRaw()
      .split(",")
      .map((a: string) => normalizeAddress(a))
      .filter(Boolean)
  );
}

/** Case-normalized admin allowlist (same as getMediatorAllowlist after normalization). */
export function getAdminAllowlistLowercase(): Set<string> {
  return getMediatorAllowlist();
}

/** Returns true when `address` appears in the ADMIN_STELLAR_PUBKEYS allowlist. */
export function isMediatorAddress(address: string): boolean {
  return getMediatorAllowlist().has(normalizeAddress(address));
}

/**
 * Returns true when `address` appears in the ADMIN_STELLAR_PUBKEYS allowlist,
 * comparing case-insensitively via the same normalized set used elsewhere
 * (e.g. trade.routes.ts) so admin checks are consistent regardless of the
 * casing a caller's wallet address happens to arrive in.
 */
export function isAdminAddress(address: string): boolean {
  return getAdminAllowlistLowercase().has(normalizeAddress(address));
}

/**
 * Test helper: clears any cached allowlist state.
 *
 * The allowlist is intentionally read fresh from the environment on every
 * call (no module-level cache), so there is nothing to reset in production.
 * This helper exists so tests that mutate `process.env.ADMIN_STELLAR_PUBKEYS`
 * can explicitly signal a reset point and so callers migrating off the old
 * `trade.service.ts` cache keep a stable, no-op API.
 */
export function resetAdminPubkeys(): void {
  // No cache to clear — kept as a test helper for API compatibility.
}
