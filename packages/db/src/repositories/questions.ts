import { and, asc, desc, eq, ilike, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../client";
import { categories, questionOptions, questions, quizAnswers, type NewQuestion } from "../schema";

export type QuestionType = "multiple_choice" | "short_answer";
export type DifficultyLevel = "easy" | "medium" | "hard";

export type QuestionOptionInput = {
  id?: string;
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
    const updateValues = stripUndefined({
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
    });

    const [question] = await tx
      .update(questions)
      .set(updateValues)
      .where(eq(questions.id, id))
      .returning();

    if (!question) return null;

    if (input.options) {
      const existingOptions = await tx
        .select()
        .from(questionOptions)
        .where(eq(questionOptions.questionId, id))
        .orderBy(asc(questionOptions.displayOrder));

      for (const [index, option] of input.options.entries()) {
        const displayOrder = option.displayOrder ?? index;
        const existing =
          existingOptions.find((item) => option.id && item.id === option.id) ??
          existingOptions.find((item) => item.displayOrder === displayOrder);

        if (existing) {
          await tx
            .update(questionOptions)
            .set({
              optionText: option.optionText,
              isCorrect: option.isCorrect ?? false,
              displayOrder,
              updatedAt: sql`now()`
            })
            .where(eq(questionOptions.id, existing.id));
        } else {
          await tx.insert(questionOptions).values({
            questionId: id,
            optionText: option.optionText,
            isCorrect: option.isCorrect ?? false,
            displayOrder
          });
        }
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

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export async function getQuestionsByIds(ids: string[]) {
  if (!ids.length) return [];
  const selected = await db
    .select()
    .from(questions)
    .where(and(inArray(questions.id, ids), eq(questions.isActive, true)));
  if (!selected.length) return [];
  const options = await db
    .select()
    .from(questionOptions)
    .where(inArray(questionOptions.questionId, selected.map((q) => q.id)))
    .orderBy(asc(questionOptions.displayOrder));
  return selected.map((q) => ({
    ...q,
    options: options.filter((o) => o.questionId === q.id),
  }));
}

export async function archiveQuestion(id: string) {
  return updateQuestion(id, { isActive: false });
}

export async function getRandomShortAnswerQuestion(
  excludeIds: string[] = [],
  categoryId?: string,
  difficulty?: DifficultyLevel,
) {
  const filters = [
    eq(questions.questionType, "short_answer"),
    eq(questions.isActive, true),
    ...(excludeIds.length ? [notInArray(questions.id, excludeIds)] : []),
    ...(categoryId ? [eq(questions.categoryId, categoryId)] : []),
    ...(difficulty ? [eq(questions.difficulty, difficulty)] : []),
  ];
  const [q] = await db
    .select()
    .from(questions)
    .where(and(...filters))
    .orderBy(sql`random()`)
    .limit(1);
  return q ?? null;
}

export async function listQuestionsForQuiz(input: {
  categoryId?: string;
  questionType?: QuestionType;
  difficulty?: DifficultyLevel;
  limit: number;
  userId?: string;
  excludeQuestionIds?: string[];
}) {
  const baseFilters = [eq(questions.isActive, true)];
  if (input.categoryId) baseFilters.push(eq(questions.categoryId, input.categoryId));
  if (input.questionType) baseFilters.push(eq(questions.questionType, input.questionType));
  // baseFilters feeds every query below, including the fallbacks, so a
  // difficulty choice is never quietly widened when the pool runs short.
  if (input.difficulty) baseFilters.push(eq(questions.difficulty, input.difficulty));

  let srIds: string[] = [];       // previously wrong — interleave for spaced repetition
  let excludeIds: string[] = [];  // recently correct — skip to avoid boring repeats

  if (input.userId) {
    const recent = await db
      .select({ questionId: quizAnswers.questionId, isCorrect: quizAnswers.isCorrect })
      .from(quizAnswers)
      .where(eq(quizAnswers.userId, input.userId))
      .orderBy(desc(quizAnswers.answeredAt))
      .limit(60);

    excludeIds = [...new Set(recent.filter((a) => a.isCorrect).map((a) => a.questionId))].slice(0, 40);

    const wrongIds = [...new Set(recent.filter((a) => !a.isCorrect).map((a) => a.questionId))];
    const srTarget = Math.min(Math.floor(input.limit * 0.4), wrongIds.length);
    if (srTarget > 0) {
      const srRows = await db
        .select({ id: questions.id })
        .from(questions)
        .where(and(...baseFilters, inArray(questions.id, wrongIds)))
        .orderBy(sql`random()`)
        .limit(srTarget);
      srIds = srRows.map((r) => r.id);
    }
  }

  // Callers may pass an additional exclusion set (e.g. per-chat recent history) that
  // should not affect SR — SR is per-user, this cache is per-chat/session.
  const callerExclude = input.excludeQuestionIds ?? [];

  // Fetch fresh questions — exclude recently-correct, already-picked SR, and caller exclusions
  const freshExclude = [...new Set([...excludeIds, ...srIds, ...callerExclude])];
  const freshFilters = [...baseFilters, ...(freshExclude.length ? [notInArray(questions.id, freshExclude)] : [])];
  const freshLimit = input.limit - srIds.length;

  let fresh = await db
    .select()
    .from(questions)
    .where(and(...freshFilters))
    .orderBy(
      sql`CASE ${questions.difficulty} WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 WHEN 'hard' THEN 3 END`,
      sql`random()`,
    )
    .limit(freshLimit);

  // Fallback: if the pool is small and we excluded too many, pull from user's recently-correct.
  // Still honour the caller's exclusion (per-chat recent history) unless we're totally stuck.
  if (fresh.length < freshLimit && (excludeIds.length > 0 || callerExclude.length > 0)) {
    const alreadyPicked = new Set([...srIds, ...fresh.map((q) => q.id)]);
    const softExclude = [...new Set([...alreadyPicked, ...callerExclude])];
    const fallbackFilters = [...baseFilters, ...(softExclude.length ? [notInArray(questions.id, softExclude)] : [])];
    const fallback = await db
      .select()
      .from(questions)
      .where(and(...fallbackFilters))
      .orderBy(sql`random()`)
      .limit(freshLimit - fresh.length);
    fresh = [...fresh, ...fallback];
  }

  // Last-resort fallback: if still short and caller exclusion is starving us, ignore it.
  if (fresh.length < freshLimit && callerExclude.length > 0) {
    const alreadyPicked = new Set([...srIds, ...fresh.map((q) => q.id)]);
    const hardFilters = [...baseFilters, ...(alreadyPicked.size ? [notInArray(questions.id, [...alreadyPicked])] : [])];
    const extra = await db
      .select()
      .from(questions)
      .where(and(...hardFilters))
      .orderBy(sql`random()`)
      .limit(freshLimit - fresh.length);
    fresh = [...fresh, ...extra];
  }

  // Fetch full rows for SR questions and interleave them randomly into the fresh set
  let allSelected = fresh;
  if (srIds.length > 0) {
    const srFull = await db.select().from(questions).where(inArray(questions.id, srIds));
    const combined = [...fresh];
    for (const srQ of srFull) {
      combined.splice(Math.floor(Math.random() * (combined.length + 1)), 0, srQ);
    }
    allSelected = combined;
  }

  if (!allSelected.length) return [];

  const opts = await db
    .select()
    .from(questionOptions)
    .where(inArray(questionOptions.questionId, allSelected.map((q) => q.id)))
    .orderBy(asc(questionOptions.displayOrder));

  return allSelected.map((question) => ({
    ...question,
    options: opts.filter((o) => o.questionId === question.id),
  }));
}
