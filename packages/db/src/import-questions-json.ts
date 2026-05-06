import { eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { categories, questions } from "./schema";

type JsonQuestion = {
  question: string;
  answer: string;
  category: string;
  explanation?: string;
  difficulty?: string;
  acceptable_answers?: string[];
};

type Difficulty = "easy" | "medium" | "hard";

const inputPath = process.argv[2] ?? "../../questions.json";
const data = (await Bun.file(inputPath).json()) as JsonQuestion[];

if (!Array.isArray(data) || !data.length) {
  throw new Error(`No questions found in ${inputPath}`);
}

const normalized = data.map((item, index) => {
  if (!item.question?.trim()) throw new Error(`Question ${index + 1} is missing question text`);
  if (!item.answer?.trim()) throw new Error(`Question ${index + 1} is missing answer`);
  if (!item.category?.trim()) throw new Error(`Question ${index + 1} is missing category`);

  return {
    questionText: item.question.trim(),
    correctAnswerText: item.answer.trim(),
    categoryName: item.category.trim(),
    explanation: item.explanation?.trim() || null,
    difficulty: normalizeDifficulty(item.difficulty),
    acceptedKeywords: [...new Set((item.acceptable_answers ?? []).map((answer) => answer.trim()).filter(Boolean))]
  };
});

const categoryNames = [...new Set(normalized.map((item) => item.categoryName))];
const categorySlugs = categoryNames.map(slugify);

await db.transaction(async (tx) => {
  await tx.update(questions).set({ isActive: false, updatedAt: sql`now()` });
  await tx.update(categories).set({ isActive: false, updatedAt: sql`now()` });

  const categoryIds = new Map<string, string>();

  for (const [index, categoryName] of categoryNames.entries()) {
    const slug = categorySlugs[index]!;
    const [category] = await tx
      .insert(categories)
      .values({
        name: categoryName,
        slug,
        description: `${categoryName} questions imported from questions.json`,
        isActive: true,
        displayOrder: index
      })
      .onConflictDoUpdate({
        target: categories.slug,
        set: {
          name: categoryName,
          description: `${categoryName} questions imported from questions.json`,
          isActive: true,
          displayOrder: index,
          updatedAt: sql`now()`
        }
      })
      .returning();

    if (!category) throw new Error(`Failed to upsert category ${categoryName}`);
    categoryIds.set(categoryName, category.id);
  }

  for (const chunk of chunks(normalized, 500)) {
    await tx.insert(questions).values(
      chunk.map((item) => ({
        categoryId: categoryIds.get(item.categoryName)!,
        questionText: item.questionText,
        questionType: "short_answer" as const,
        difficulty: item.difficulty,
        imageUrl: null,
        cloudinaryPublicId: null,
        correctAnswerText: item.correctAnswerText,
        acceptedKeywords: item.acceptedKeywords,
        explanation: item.explanation,
        isActive: true
      }))
    );
  }
});

const [activeCount] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(questions)
  .where(eq(questions.isActive, true));

const activeCategories = await db
  .select({ name: categories.name })
  .from(categories)
  .where(inArray(categories.slug, categorySlugs));

console.log(
  JSON.stringify(
    {
      importedQuestions: normalized.length,
      activeQuestions: activeCount?.count ?? 0,
      activeCategories: activeCategories.map((category) => category.name)
    },
    null,
    2
  )
);

process.exit(0);

function normalizeDifficulty(value: string | undefined): Difficulty {
  if (value === "easy" || value === "medium" || value === "hard") return value;
  return "medium";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
