import { PrismaClient, TradeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { encrypt, decrypt } from "../lib/crypto";
import { getAdminAllowlistLowercase } from "../lib/accessControl";

export class TradeNoteAccessDeniedError extends Error {
  status = 403;
  constructor() {
    super("Access denied: you are not allowed to view notes for this trade");
    this.name = "TradeNoteAccessDeniedError";
  }
}

export class TradeNoteNotFoundError extends Error {
  status = 404;
  constructor() {
    super("Trade not found");
    this.name = "TradeNoteNotFoundError";
  }
}

type NotesDatabase = Pick<PrismaClient, "trade" | "tradeNote">;

export class TradeNotesService {
  constructor(
    private readonly prisma: NotesDatabase = defaultPrisma,
  ) {}

  async addNote(tradeId: string, authorAddress: string, content: string) {
    const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
    if (!trade) throw new TradeNoteNotFoundError();

    const caller = authorAddress.toLowerCase();
    const isParty =
      trade.buyerAddress.toLowerCase() === caller ||
      trade.sellerAddress.toLowerCase() === caller;
    if (!isParty) throw new TradeNoteAccessDeniedError();

    const encrypted = encrypt(content);

    return this.prisma.tradeNote.create({
      data: {
        tradeId,
        authorAddress: caller,
        content: encrypted,
      },
    });
  }

  async listNotes(tradeId: string, callerAddress: string) {
    const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
    if (!trade) throw new TradeNoteNotFoundError();

    const caller = callerAddress.toLowerCase();
    const isAdmin = getAdminAllowlistLowercase().has(caller);
    const isParty =
      trade.buyerAddress.toLowerCase() === caller ||
      trade.sellerAddress.toLowerCase() === caller;
    if (!isParty && !isAdmin) throw new TradeNoteAccessDeniedError();

    const notes = await this.prisma.tradeNote.findMany({
      where: { tradeId },
      orderBy: { createdAt: "desc" },
    });

    return notes.map((note) => ({
      id: note.id,
      tradeId: note.tradeId,
      authorAddress: note.authorAddress,
      content:
        note.authorAddress === caller || isAdmin
          ? decrypt(note.content)
          : null,
      createdAt: note.createdAt,
    }));
  }
}
