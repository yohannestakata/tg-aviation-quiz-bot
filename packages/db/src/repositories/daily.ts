import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { dailyChallengeAnswers, questionOptions, questions, users } from "../schema";

export async function getDailyQuestionForDate(date: string) {
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(questions)
    .where(eq(questions.isActive, true));
  const total = countRow?.count ?? 0;
  if (!total) return null;

  const seed = date.replace(/-/g, "").split("").reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7);
  const offset = Math.abs(seed) % total;

  const [q] = await db
    .select()
    .from(questions)
    .where(eq(questions.isActive, true))
    .orderBy(asc(questions.id))
    .offset(offset)
    .limit(1);
  if (!q) return null;

  const opts = await db
    .select()
    .from(questionOptions)
    .where(eq(questionOptions.questionId, q.id))
    .orderBy(asc(questionOptions.displayOrder));

  return { ...q, options: opts };
}

export async function getDailyChallengeAnswer(userId: string, date: string) {
  const [row] = await db
    .select()
    .from(dailyChallengeAnswers)
    .where(
      sql`${dailyChallengeAnswers.userId} = ${userId} AND ${dailyChallengeAnswers.challengeDate} = ${date}`,
    );
  return row ?? null;
}

export async function recordDailyChallengeAnswer(input: {
  userId: string;
  questionId: string;
  challengeDate: string;
  selectedOptionId?: string | null;
  answerText?: string | null;
  isCorrect: boolean;
  elapsedSeconds?: number | null;
}) {
  const [row] = await db
    .insert(dailyChallengeAnswers)
    .values({
      userId: input.userId,
      questionId: input.questionId,
      challengeDate: input.challengeDate,
      selectedOptionId: input.selectedOptionId ?? null,
      answerText: input.answerText ?? null,
      isCorrect: input.isCorrect,
      elapsedSeconds: input.elapsedSeconds ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function getDailyLeaderboard(date: string, limit = 10) {
  return db
    .select({
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      isCorrect: dailyChallengeAnswers.isCorrect,
      elapsedSeconds: dailyChallengeAnswers.elapsedSeconds,
    })
    .from(dailyChallengeAnswers)
    .innerJoin(users, eq(users.id, dailyChallengeAnswers.userId))
    .where(eq(dailyChallengeAnswers.challengeDate, date))
    .orderBy(
      desc(dailyChallengeAnswers.isCorrect),
      asc(dailyChallengeAnswers.elapsedSeconds),
    )
    .limit(limit);
}
