import { TradeNotesService, TradeNoteNotFoundError, TradeNoteAccessDeniedError } from "../services/trade.notes.service";

describe("TradeNotesService", () => {
  const buyerAddress = "GBUYER12345678901234567890123456789012345678901234567890";
  const sellerAddress = "GSELLER1234567890123456789012345678901234567890123456789";
  const otherAddress = "GOTHER12345678901234567890123456789012345678901234567890";
  const tradeId = "trade-test-01";

  const mockTrade = {
    tradeId,
    buyerAddress,
    sellerAddress,
  };

  let mockPrisma: any;
  let service: TradeNotesService;

  beforeEach(() => {
    mockPrisma = {
      trade: {
        findUnique: jest.fn().mockResolvedValue(mockTrade),
      },
      tradeNote: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 1,
          ...data,
          createdAt: new Date(),
        })),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new TradeNotesService(mockPrisma);
  });

  describe("addNote", () => {
    it("persists encrypted string (not a Promise or [object Promise]) to prisma.tradeNote.create", async () => {
      const plaintext = "Confidential trade details";
      const result = await service.addNote(tradeId, buyerAddress, plaintext);

      expect(mockPrisma.tradeNote.create).toHaveBeenCalledTimes(1);
      const callArg = mockPrisma.tradeNote.create.mock.calls[0][0];

      expect(callArg.data.tradeId).toBe(tradeId);
      expect(callArg.data.authorAddress).toBe(buyerAddress.toLowerCase());

      // Ensure content is a string and not a Promise or stringified '[object Promise]'
      expect(typeof callArg.data.content).toBe("string");
      expect(callArg.data.content).not.toBe(plaintext);
      expect(callArg.data.content).not.toBe("[object Promise]");
      expect(callArg.data.content).not.toBeInstanceOf(Promise);

      expect(result.id).toBe(1);
    });

    it("throws TradeNoteNotFoundError if trade does not exist", async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(null);

      await expect(
        service.addNote("non-existent", buyerAddress, "Hello"),
      ).rejects.toThrow(TradeNoteNotFoundError);
    });

    it("throws TradeNoteAccessDeniedError if caller is not buyer or seller", async () => {
      await expect(
        service.addNote(tradeId, otherAddress, "Hello"),
      ).rejects.toThrow(TradeNoteAccessDeniedError);
    });
  });

  describe("listNotes", () => {
    it("decrypts note content for the note author", async () => {
      const plaintext = "Author private message";
      // First encrypt note via addNote to have valid ciphertext
      await service.addNote(tradeId, buyerAddress, plaintext);
      const savedCiphertext = mockPrisma.tradeNote.create.mock.calls[0][0].data.content;

      mockPrisma.tradeNote.findMany.mockResolvedValue([
        {
          id: 1,
          tradeId,
          authorAddress: buyerAddress.toLowerCase(),
          content: savedCiphertext,
          createdAt: new Date(),
        },
      ]);

      const notes = await service.listNotes(tradeId, buyerAddress);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.content).toBe(plaintext);
    });

    it("returns null content for non-author party", async () => {
      const plaintext = "Buyer-only private message";
      await service.addNote(tradeId, buyerAddress, plaintext);
      const savedCiphertext = mockPrisma.tradeNote.create.mock.calls[0][0].data.content;

      mockPrisma.tradeNote.findMany.mockResolvedValue([
        {
          id: 1,
          tradeId,
          authorAddress: buyerAddress.toLowerCase(),
          content: savedCiphertext,
          createdAt: new Date(),
        },
      ]);

      // Seller reads the notes
      const notes = await service.listNotes(tradeId, sellerAddress);
      expect(notes).toHaveLength(1);
      expect(notes[0]!.content).toBeNull();
    });
  });
});
