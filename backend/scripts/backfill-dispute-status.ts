/**
 * backfill-dispute-status.ts
 *
 * Idempotent backfill script: corrects Trade rows that were incorrectly written
 * as CANCELLED after a dispute was resolved (should be COMPLETED).
 *
 * The bug: the DisputeResolved → COMPLETED mapping was missing, so trades that
 * went through dispute resolution were persisted with status CANCELLED instead.
 *
 * Safe to re-run: the WHERE clause targets only trades still in CANCELLED status
 * that have a linked Dispute record with status RESOLVED, so already-fixed rows
 * are never touched again.
 *
 * Usage:
 *   npx tsx scripts/backfill-dispute-status.ts [--dry-run]
 *
 * Rollback notes:
 *   To undo, run the following SQL (keep a snapshot of affected tradeIds first):
 *     UPDATE "Trade" SET status = 'CANCELLED', "updatedAt" = now()
 *     WHERE "tradeId" IN (<list of tradeIds logged by the script>);
 */

import { PrismaClient, TradeStatus, DisputeStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("=== Dispute Status Backfill ===");
  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log();

  // 1. Find all CANCELLED trades that have a RESOLVED dispute record.
  //    These are the incorrectly-written rows.
  const affected = await prisma.trade.findMany({
    where: {
      status: TradeStatus.CANCELLED,
      dispute: {
        status: DisputeStatus.RESOLVED,
      },
    },
    select: {
      id: true,
      tradeId: true,
      status: true,
      updatedAt: true,
      dispute: {
        select: { id: true, status: true, resolvedAt: true },
      },
    },
  });

  console.log(`Rows matching criteria (CANCELLED + RESOLVED dispute): ${affected.length}`);

  if (affected.length === 0) {
    console.log("Nothing to backfill. Exiting.");
    return;
  }

  console.log("\nAffected tradeIds:");
  for (const t of affected) {
    console.log(
      `  tradeId=${t.tradeId}  currentStatus=${t.status}  disputeResolvedAt=${t.dispute?.resolvedAt?.toISOString() ?? "null"}`
    );
  }

  if (dryRun) {
    console.log("\nDRY RUN: skipping writes. Re-run without --dry-run to apply.");
    return;
  }

  // 2. Update in a single batch inside a transaction for atomicity.
  const tradeIds = affected.map((t) => t.tradeId);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.trade.updateMany({
      where: {
        tradeId: { in: tradeIds },
        // Guard: only touch rows still CANCELLED so a concurrent fix isn't overwritten
        status: TradeStatus.CANCELLED,
      },
      data: {
        status: TradeStatus.COMPLETED,
        updatedAt: new Date(),
      },
    });
    return updated;
  });

  console.log(`\nRows updated: ${result.count}`);
  console.log(`Rows skipped (already changed by concurrent process): ${affected.length - result.count}`);
  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  console.log(
    "\nRollback SQL (save this before discarding):\n" +
      `  UPDATE "Trade" SET status = 'CANCELLED', "updatedAt" = now()\n` +
      `  WHERE "tradeId" IN (${tradeIds.map((id) => `'${id}'`).join(", ")});`
  );
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
