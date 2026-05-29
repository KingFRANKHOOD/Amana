import { PrismaClient } from "@prisma/client";
import {
  DisputeCategoryNameConflictError,
  DisputeCategoryNotFoundError,
  DisputeCategoryService,
} from "../services/disputeCategory.service";

function createMockPrisma() {
  return {
    disputeCategory: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as PrismaClient;
}

const mockDate = new Date("2026-05-27T00:00:00.000Z");

describe("DisputeCategoryService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: DisputeCategoryService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new DisputeCategoryService(prisma);
  });

  it("creates an active dispute category with a trimmed unique name", async () => {
    prisma.disputeCategory.findUnique = jest.fn().mockResolvedValue(null);
    prisma.disputeCategory.create = jest.fn().mockResolvedValue({
      id: 1,
      name: "DAMAGE",
      description: "Goods damaged",
      isActive: true,
      createdAt: mockDate,
      updatedAt: mockDate,
    });

    const category = await service.createCategory({
      name: " DAMAGE ",
      description: "Goods damaged",
    });

    expect(prisma.disputeCategory.findUnique).toHaveBeenCalledWith({
      where: { name: "DAMAGE" },
    });
    expect(prisma.disputeCategory.create).toHaveBeenCalledWith({
      data: {
        name: "DAMAGE",
        description: "Goods damaged",
        isActive: true,
      },
    });
    expect(category).toMatchObject({
      id: 1,
      name: "DAMAGE",
      isActive: true,
      createdAt: "2026-05-27T00:00:00.000Z",
    });
  });

  it("rejects duplicate category names", async () => {
    prisma.disputeCategory.findUnique = jest.fn().mockResolvedValue({ id: 1, name: "DAMAGE" });

    await expect(service.createCategory({ name: "DAMAGE" })).rejects.toBeInstanceOf(
      DisputeCategoryNameConflictError,
    );
  });

  it("lists only active categories by default", async () => {
    prisma.disputeCategory.findMany = jest.fn().mockResolvedValue([]);

    await service.listCategories();

    expect(prisma.disputeCategory.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
  });

  it("deactivates a category instead of deleting it", async () => {
    prisma.disputeCategory.findUnique = jest.fn().mockResolvedValue({ id: 1, name: "DAMAGE" });
    prisma.disputeCategory.update = jest.fn().mockResolvedValue({});

    await service.deleteCategory(1);

    expect(prisma.disputeCategory.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false },
    });
  });

  it("throws when deactivating an unknown category", async () => {
    prisma.disputeCategory.findUnique = jest.fn().mockResolvedValue(null);

    await expect(service.deleteCategory(404)).rejects.toBeInstanceOf(DisputeCategoryNotFoundError);
  });
});
