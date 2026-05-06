import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  questionOptions,
  questions,
  quizAnswers,
  quizSessionQuestions,
  quizSessions,
  telegramGroups,
  users
} from "../schema";

export async function upsertTelegramUser(input: {
  telegramUserId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
}) {
  const [user] = await db
    .insert(users)
    .values(input)
    .onConflictDoUpdate({
      target: users.telegramUserId,
      set: {
        username: input.username ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        languageCode: input.languageCode ?? null,
        updatedAt: sql`now()`
      }
    })
    .returning();
  return user;
}

export async function upsertTelegramGroup(input: { telegramChatId: string; title?: string | null; type?: string | null }) {
  const [group] = await db
    .insert(telegramGroups)
    .values(input)
    .onConflictDoUpdate({
      target: telegramGroups.telegramChatId,
      set: {
        title: input.title ?? null,
        type: input.type ?? null,
        updatedAt: sql`now()`
      }
    })
    .returning();
  return group;
}

export async function createQuizSession(input: {
  userId: string;
  groupId?: string | null;
  categoryId?: string | null;
  questionType?: "multiple_choice" | "short_answer" | null;
  totalQuestions: number;
  questionIds: string[];
  mode?: "private" | "group";
}) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(quizSessions)
      .values({
        mode: input.mode ?? "private",
        userId: input.userId,
        groupId: input.groupId ?? null,
        categoryId: input.categoryId ?? null,
        questionType: input.questionType ?? null,
        totalQuestions: input.totalQuestions
      })
      .returning();
    if (!session) throw new Error("Failed to create quiz session");

    await tx.insert(quizSessionQuestions).values(
      input.questionIds.map((questionId, position) => ({
        quizSessionId: session.id,
        questionId,
        position
      }))
    );

    return session;
  });
}

export async function getSessionQuestion(sessionId: string, position: number) {
  const [row] = await db
    .select({
      sessionQuestionId: quizSessionQuestions.id,
      question: questions,
      option: questionOptions
    })
    .from(quizSessionQuestions)
    .innerJoin(questions, eq(questions.id, quizSessionQuestions.questionId))
    .leftJoin(questionOptions, eq(questionOptions.questionId, questions.id))
    .where(and(eq(quizSessionQuestions.quizSessionId, sessionId), eq(quizSessionQuestions.position, position)))
    .orderBy(asc(questionOptions.displayOrder));

  if (!row) return null;

  const options = await db
    .select()
    .from(questionOptions)
    .where(eq(questionOptions.questionId, row.question.id))
    .orderBy(asc(questionOptions.displayOrder));

  return { ...row.question, options };
}

export async function recordAnswer(input: {
  quizSessionId: string;
  questionId: string;
  userId: string;
  selectedOptionId?: string | null;
  answerText?: string | null;
  isCorrect: boolean;
}) {
  const [answer] = await db
    .insert(quizAnswers)
    .values({
      quizSessionId: input.quizSessionId,
      questionId: input.questionId,
      userId: input.userId,
      selectedOptionId: input.selectedOptionId ?? null,
      answerText: input.answerText ?? null,
      isCorrect: input.isCorrect,
      pointsAwarded: input.isCorrect ? 1 : 0
    })
    .returning();
  return answer;
}

export async function advanceQuizSession(sessionId: string, nextIndex: number, completed = false) {
  const [session] = await db
    .update(quizSessions)
    .set({
      currentQuestionIndex: nextIndex,
      status: completed ? "completed" : "active",
      completedAt: completed ? sql`now()` : null
    })
    .where(eq(quizSessions.id, sessionId))
    .returning();
  return session ?? null;
}

export async function cancelActiveQuizForUser(userId: string) {
  await db
    .update(quizSessions)
    .set({ status: "cancelled", completedAt: sql`now()` })
    .where(and(eq(quizSessions.userId, userId), eq(quizSessions.status, "active")));
}

export async function getQuizScore(sessionId: string) {
  const [score] = await db
    .select({
      correct: sql<number>`coalesce(sum(case when ${quizAnswers.isCorrect} then 1 else 0 end), 0)::int`,
      answered: sql<number>`count(${quizAnswers.id})::int`
    })
    .from(quizAnswers)
    .where(eq(quizAnswers.quizSessionId, sessionId));
  return score ?? { correct: 0, answered: 0 };
}
