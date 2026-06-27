import { Router } from "express";
import { archiveCategory, createCategory, getCategoryById, listCategories, updateCategory } from "@aviation/db";
import { asyncHandler } from "../../middleware/async-handler";
import { requireAdmin } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validate.middleware";
import { categorySchema, updateCategorySchema } from "./category.schemas";

export const categoryRouter = Router();

categoryRouter.use(requireAdmin);

function idParam(req: { params: { id?: string } }) {
  if (!req.params.id) throw new Error("Missing id parameter");
  return req.params.id;
}

categoryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await listCategories({
      includeInactive: req.query.includeInactive === "true",
      search: typeof req.query.search === "string" ? req.query.search : undefined
    });
    res.json({ categories });
  })
);

categoryRouter.post(
  "/",
  validateBody(categorySchema),
  asyncHandler(async (req, res) => {
    const category = await createCategory(req.body);
    res.status(201).json({ category });
  })
);

categoryRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const category = await getCategoryById(idParam(req));
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    res.json({ category });
  })
);

categoryRouter.patch(
  "/:id",
  validateBody(updateCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await updateCategory(idParam(req), req.body);
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    res.json({ category });
  })
);

categoryRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const category = await archiveCategory(idParam(req));
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    res.json({ category });
  })
);
