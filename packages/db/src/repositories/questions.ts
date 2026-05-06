import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { categories, questionOptions, questions, type NewQuestion } from "../schema";

export type QuestionType = "multiple_choice" | "short_answer";
export type DifficultyLevel = "easy" | "medium" | "hard";

export type QuestionOptionInput = {
  optionText: string;
  isCorrect?: boolean;
  displayOrder?: number;
};

export type QuestionInput = Omit<
  NewQuestion,
  "id" | "createdAt" | "updatedAt" | "acceptedKeywords" | "isActive" | "difficulty"
> & {
  difficulty?: DifficultyLevel;
  acceptedKeywords?: string[];
  isActive?: boolean;
  options?: QuestionOptionInput[];
};

export type QuestionFilter = {
  categoryId?: string;
  questionType?: QuestionType;
  difficulty?: DifficultyLevel;
  isActive?: boolean;
  search?: string;
};

function buildQuestionFilters(filters: QuestionFilter) {
  const clauses = [];
  if (filters.categoryId) clauses.push(eq(questions.categoryId, filters.categoryId));
  if (filters.questionType) clauses.push(eq(questions.questionType, filters.questionType));
  if (filters.difficulty) clauses.push(eq(questions.difficulty, filters.difficulty));
  if (typeof filters.isActive === "boolean") clauses.push(eq(questions.isActive, filters.isActive));
  if (filters.search) clauses.push(ilike(questions.questionText, `%${filters.search}%`));
  return clauses.length ? and(...clauses) : undefined;
}

export async function listQuestions(filters: QuestionFilter = {}) {
  return db
    .select({
      id: questions.id,
      categoryId: questions.categoryId,
      categoryName: categories.name,
      questionText: questions.questionText,
      questionType: questions.questionType,
      difficulty: questions.difficulty,
      imageUrl: questions.imageUrl,
      cloudinaryPublicId: questions.cloudinaryPublicId,
      correctAnswerText: questions.correctAnswerText,
      acceptedKeywords: questions.acceptedKeywords,
      explanation: questions.explanation,
      isActive: questions.isActive,
      createdAt: questions.createdAt,
      updatedAt: questions.updatedAt
    })
    .from(questions)
    .leftJoin(categories, eq(categories.id, questions.categoryId))
    .where(buildQuestionFilters(filters))
    .orderBy(desc(questions.createdAt));
}

export async function getQuestionById(id: string) {
  const [question] = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
  if (!question) return null;

  const options = await db
    .select()
    .from(questionOptions)
    .where(eq(questionOptions.questionId, id))
    .orderBy(asc(questionOptions.displayOrder));

  return { ...question, options };
}

export async function createQuestion(input: QuestionInput) {
  return db.transaction(async (tx) => {
    const [question] = await tx
      .insert(questions)
      .values({
        categoryId: input.categoryId,
        questionText: input.questionText,
        questionType: input.questionType,
        difficulty: input.difficulty ?? "medium",
        imageUrl: input.imageUrl ?? null,
        cloudinaryPublicId: input.cloudinaryPublicId ?? null,
        correctAnswerText: input.correctAnswerText ?? null,
        acceptedKeywords: input.acceptedKeywords ?? [],
        explanation: input.explanation ?? null,
        isActive: input.isActive ?? true
      })
      .returning();

    if (!question) throw new Error("Failed to create question");

    const options = input.options?.length
      ? await tx.insert(questionOptions).values(
        input.options.map((option, index) => ({
          questionId: question.id,
          optionText: option.optionText,
          isCorrect: option.isCorrect ?? false,
          displayOrder: option.displayOrder ?? index
        }))
      ).returning()
      : [];

    return { ...question, options };
  });
}

export async function createQuestionIfMissing(input: QuestionInput) {
  const [existing] = await db.select().from(questions).where(eq(questions.questionText, input.questionText)).limit(1);
  if (existing) return getQuestionById(existing.id);
  return createQuestion(input);
}

export async function updateQuestion(id: string, input: Partial<QuestionInput>) {
  return db.transaction(async (tx) => {
    const [question] = await tx
      .update(questions)
      .set({
        categoryId: input.categoryId,
        questionText: input.questionText,
        questionType: input.questionType,
        difficulty: input.difficulty,
        imageUrl: input.imageUrl,
        cloudinaryPublicId: input.cloudinaryPublicId,
        correctAnswerText: input.correctAnswerText,
        acceptedKeywords: input.acceptedKeywords,
        explanation: input.explanation,
        isActive: input.isActive,
        updatedAt: sql`now()`
      })
      .where(eq(questions.id, id))
      .returning();

    if (!question) return null;

    if (input.options) {
      await tx.delete(questionOptions).where(eq(questionOptions.questionId, id));
      if (input.options.length) {
        await tx.insert(questionOptions).values(
          input.options.map((option, index) => ({
            questionId: id,
            optionText: option.optionText,
            isCorrect: option.isCorrect ?? false,
            displayOrder: option.displayOrder ?? index
          }))
        );
      }
    }

    const options = await tx
      .select()
      .from(questionOptions)
      .where(eq(questionOptions.questionId, id))
      .orderBy(asc(questionOptions.displayOrder));

    return { ...question, options };
  });
}

export async function archiveQuestion(id: string) {
  return updateQuestion(id, { isActive: false });
}

export async function listQuestionsForQuiz(input: {
  categoryId?: string;
  questionType?: QuestionType;
  limit: number;
}) {
  const filters = [eq(questions.isActive, true)];
  if (input.categoryId) filters.push(eq(questions.categoryId, input.categoryId));
  if (input.questionType) filters.push(eq(questions.questionType, input.questionType));

  const selected = await db
    .select()
    .from(questions)
    .where(and(...filters))
    .orderBy(sql`random()`)
    .limit(input.limit);

  if (!selected.length) return [];

  const options = await db
    .select()
    .from(questionOptions)
    .where(
      inArray(
        questionOptions.questionId,
        selected.map((question) => question.id)
      )
    )
    .orderBy(asc(questionOptions.displayOrder));

  return selected.map((question) => ({
    ...question,
    options: options.filter((option) => option.questionId === question.id)
  }));
}
