import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import {
  DisputeCategoryService,
  DisputeCategoryNotFoundError,
  DisputeCategoryNameConflictError,
} from "../services/disputeCategory.service";
import { isMediatorAddress } from "../lib/accessControl";

const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be 100 characters or fewer"),
  description: z.string().trim().max(1000, "Description must be 1000 characters or fewer").optional(),
  isActive: z.boolean().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().optional(),
});

const categoryIdParamSchema = z.object({
  id: z.coerce.number().int().positive("ID must be a positive integer"),
});

const listCategoriesQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .transform((v: string) => v === "true")
    .optional(),
});

export class DisputeCategoryController {
  constructor(private categoryService: DisputeCategoryService) {}

  public createCategory = async (req: AuthRequest, res: Response): Promise<Response | void> => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isMediatorAddress(callerAddress)) {
      return res.status(403).json({ error: "Forbidden: mediator access required" });
    }

    try {
      const category = await this.categoryService.createCategory(req.body);
      return res.status(201).json(category);
    } catch (error) {
      if (error instanceof DisputeCategoryNameConflictError) {
        return res.status(409).json({ error: error.message });
      }
      console.error("Create dispute category failed:", error);
      return res.status(500).json({ error: "Failed to create dispute category" });
    }
  };

  public listCategories = async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const includeInactive = (req.query as any).includeInactive === true;
      const callerAddress = req.user?.walletAddress?.trim();
      if (includeInactive && (!callerAddress || !isMediatorAddress(callerAddress))) {
        return res.status(403).json({ error: "Forbidden: mediator access required" });
      }

      const categories = await this.categoryService.listCategories(includeInactive);
      return res.status(200).json({ items: categories });
    } catch (error) {
      console.error("List dispute categories failed:", error);
      return res.status(500).json({ error: "Failed to list dispute categories" });
    }
  };

  public getCategoryById = async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const id = Number((req.params as any).id);
      const category = await this.categoryService.getCategoryById(id);
      return res.status(200).json(category);
    } catch (error) {
      if (error instanceof DisputeCategoryNotFoundError) {
        return res.status(404).json({ error: error.message });
      }
      console.error("Get dispute category failed:", error);
      return res.status(500).json({ error: "Failed to get dispute category" });
    }
  };

  public updateCategory = async (req: AuthRequest, res: Response): Promise<Response | void> => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isMediatorAddress(callerAddress)) {
      return res.status(403).json({ error: "Forbidden: mediator access required" });
    }

    try {
      const id = Number((req.params as any).id);
      const category = await this.categoryService.updateCategory(id, req.body);
      return res.status(200).json(category);
    } catch (error) {
      if (error instanceof DisputeCategoryNotFoundError) {
        return res.status(404).json({ error: error.message });
      }
      if (error instanceof DisputeCategoryNameConflictError) {
        return res.status(409).json({ error: error.message });
      }
      console.error("Update dispute category failed:", error);
      return res.status(500).json({ error: "Failed to update dispute category" });
    }
  };

  public deleteCategory = async (req: AuthRequest, res: Response): Promise<Response | void> => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!isMediatorAddress(callerAddress)) {
      return res.status(403).json({ error: "Forbidden: mediator access required" });
    }

    try {
      const id = Number((req.params as any).id);
      await this.categoryService.deleteCategory(id);
      return res.status(204).send();
    } catch (error) {
      if (error instanceof DisputeCategoryNotFoundError) {
        return res.status(404).json({ error: error.message });
      }
      console.error("Delete dispute category failed:", error);
      return res.status(500).json({ error: "Failed to delete dispute category" });
    }
  };
}

export function createDisputeCategoryRouter(prisma = defaultPrisma) {
  const router = Router();
  const categoryService = new DisputeCategoryService(prisma);
  const categoryController = new DisputeCategoryController(categoryService);

  router.get(
    "/",
    authMiddleware,
    validateRequest({ query: listCategoriesQuerySchema }),
    categoryController.listCategories
  );

  router.post(
    "/",
    authMiddleware,
    validateRequest({ body: createCategorySchema }),
    categoryController.createCategory
  );

  router.get(
    "/:id",
    authMiddleware,
    validateRequest({ params: categoryIdParamSchema }),
    categoryController.getCategoryById
  );

  router.patch(
    "/:id",
    authMiddleware,
    validateRequest({ params: categoryIdParamSchema, body: updateCategorySchema }),
    categoryController.updateCategory
  );

  router.delete(
    "/:id",
    authMiddleware,
    validateRequest({ params: categoryIdParamSchema }),
    categoryController.deleteCategory
  );

  return router;
}
