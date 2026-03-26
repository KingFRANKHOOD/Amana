import type { Request, Response } from "express";
import { tradeRepository } from "../repositories/trade.repository";
import {
  buildConfirmDeliveryTx,
  buildReleaseFundsTx,
} from "../services/contract.service";

const CALLER_HEADER = "x-stellar-address";

export function getCallerStellarAddress(req: Request): string | undefined {
  const raw = req.headers[CALLER_HEADER];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (Array.isArray(raw) && raw[0]) {
    return String(raw[0]).trim();
  }
  return undefined;
}

function parseAdminPubkeys(): Set<string> {
  const raw = process.env.ADMIN_STELLAR_PUBKEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isBuyer(tradeBuyer: string, caller: string): boolean {
  return tradeBuyer === caller;
}

export function isSeller(tradeSeller: string, caller: string): boolean {
  return tradeSeller === caller;
}

export function isBuyerOrAdmin(
  tradeBuyer: string,
  caller: string,
  admins: Set<string> = parseAdminPubkeys(),
): boolean {
  return tradeBuyer === caller || admins.has(caller);
}

export async function confirmDeliveryHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const caller = getCallerStellarAddress(req);
  if (!caller) {
    res.status(401).json({ error: "Missing X-Stellar-Address header" });
    return;
  }

  const trade = tradeRepository.getById(id);
  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }

  if (trade.status !== "FUNDED") {
    res.status(400).json({
      error: `Trade must be FUNDED to confirm delivery (current: ${trade.status})`,
    });
    return;
  }

  if (!isBuyer(trade.buyerStellarAddress, caller)) {
    res.status(403).json({ error: "Only the buyer may confirm delivery" });
    return;
  }

  try {
    const unsignedXdr = await buildConfirmDeliveryTx(trade, caller);
    res.status(200).json({ unsignedXdr });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
}

export async function releaseFundsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const caller = getCallerStellarAddress(req);
  if (!caller) {
    res.status(401).json({ error: "Missing X-Stellar-Address header" });
    return;
  }

  const trade = tradeRepository.getById(id);
  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }

  if (trade.status !== "DELIVERED") {
    res.status(400).json({
      error: `Trade must be DELIVERED to release funds (current: ${trade.status})`,
    });
    return;
  }

  if (!isBuyerOrAdmin(trade.buyerStellarAddress, caller)) {
    res
      .status(403)
      .json({ error: "Only the buyer or an admin may release funds" });
    return;
  }

  try {
    const unsignedXdr = await buildReleaseFundsTx(trade, caller);
    res.status(200).json({ unsignedXdr });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
}
