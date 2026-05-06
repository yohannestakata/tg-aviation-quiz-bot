import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../client";
import { categories, type NewCategory } from "../schema";

export type CategoryInput = Pick<NewCategory, "name" | "slug"> &
  Partial<Pick<NewCategory, "description" | "isActive" | "displayOrder">>;

export async function listCategories(options: { includeInactive?: boolean; search?: string } = {}) {
  const filters = [];
  if (!options.includeInactive) filters.push(eq(categories.isActive, true));
  if (options.search) filters.push(ilike(categories.name, `%${options.search}%`));

  return db
    .select()
    .from(categories)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(categories.displayOrder), asc(categories.name));
}

export async function getCategoryById(id: string) {
  const [category] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return category ?? null;
}

export async function createCategory(input: CategoryInput) {
  const [category] = await db
    .insert(categories)
    .values({
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
      displayOrder: input.displayOrder ?? 0
    })
    .returning();
  return category;
}

export async function updateCategory(id: string, input: Partial<CategoryInput>) {
  const [category] = await db
    .update(categories)
    .set({ ...input, updatedAt: sql`now()` })
    .where(eq(categories.id, id))
    .returning();
  return category ?? null;
}

export async function archiveCategory(id: string) {
  return updateCategory(id, { isActive: false });
}
