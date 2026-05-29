import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";

export interface DisputeCategoryData {
  name: string;
  description?: string;
  isActive?: boolean;
}

export interface DisputeCategoryResponse {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export class DisputeCategoryNotFoundError extends Error {
  constructor(id: number) {
    super(`Dispute category with id ${id} not found`);
    this.name = "DisputeCategoryNotFoundError";
  }
}

export class DisputeCategoryNameConflictError extends Error {
  constructor(name: string) {
    super(`Dispute category with name "${name}" already exists`);
    this.name = "DisputeCategoryNameConflictError";
  }
}

export class DisputeCategoryService {
  constructor(private prisma: PrismaClient = defaultPrisma) {}

  async createCategory(data: DisputeCategoryData): Promise<DisputeCategoryResponse> {
    const name = this.normalizeName(data.name);
    const existing = await this.prisma.disputeCategory.findUnique({
      where: { name },
    });

    if (existing) {
      throw new DisputeCategoryNameConflictError(name);
    }

    const category = await this.prisma.disputeCategory.create({
      data: {
        name,
        description: data.description ?? null,
        isActive: data.isActive ?? true,
      },
    });

    return this.formatCategory(category);
  }

  async listCategories(includeInactive = false): Promise<DisputeCategoryResponse[]> {
    const categories = await this.prisma.disputeCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: "asc" },
    });

    return categories.map(this.formatCategory);
  }

  async getCategoryById(id: number): Promise<DisputeCategoryResponse> {
    const category = await this.prisma.disputeCategory.findUnique({
      where: { id },
    });

    if (!category) {
      throw new DisputeCategoryNotFoundError(id);
    }

    return this.formatCategory(category);
  }

  async updateCategory(
    id: number,
    data: Partial<DisputeCategoryData>
  ): Promise<DisputeCategoryResponse> {
    const existing = await this.prisma.disputeCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new DisputeCategoryNotFoundError(id);
    }

    const name = data.name !== undefined ? this.normalizeName(data.name) : undefined;

    if (name && name !== existing.name) {
      const nameConflict = await this.prisma.disputeCategory.findUnique({
        where: { name },
      });
      if (nameConflict) {
        throw new DisputeCategoryNameConflictError(name);
      }
    }

    const category = await this.prisma.disputeCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    return this.formatCategory(category);
  }

  async deleteCategory(id: number): Promise<void> {
    const existing = await this.prisma.disputeCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new DisputeCategoryNotFoundError(id);
    }

    await this.prisma.disputeCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async validateCategoryId(categoryId: number): Promise<boolean> {
    const category = await this.prisma.disputeCategory.findFirst({
      where: { id: categoryId, isActive: true },
    });
    return category !== null;
  }

  private formatCategory(category: {
    id: number;
    name: string;
    description: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): DisputeCategoryResponse {
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      isActive: category.isActive,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
    };
  }

  private normalizeName(name: string): string {
    return name.trim();
  }
}
