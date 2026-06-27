import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../client";
import { categories, questions, quizAnswers, quizSessions, users } from "../schema";

export async function getPersonalStats(userId: string) {
  const [[stats], [userData]] = await Promise.all([
    db
      .select({
        quizzesCompleted: sql<number>`count(distinct ${quizSessions.id})::int`,
        questionsAnswered: sql<number>`count(${quizAnswers.id})::int`,
        correctAnswers: sql<number>`coalesce(sum(case when ${quizAnswers.isCorrect} then 1 else 0 end), 0)::int`,
      })
      .from(quizSessions)
      .leftJoin(quizAnswers, eq(quizAnswers.quizSessionId, quizSessions.id))
      .where(eq(quizSessions.userId, userId)),
    db.select({ playStreak: users.playStreak }).from(users).where(eq(users.id, userId)),
  ]);

  const base = stats ?? { quizzesCompleted: 0, questionsAnswered: 0, correctAnswers: 0 };
  return {
    ...base,
    accuracy: base.questionsAnswered ? Math.round((base.correctAnswers / base.questionsAnswered) * 100) : 0,
    playStreak: userData?.playStreak ?? 0,
  };
}

export type LeaderboardPeriod = "all" | "week" | "month";

export async function getGlobalLeaderboard(limit = 10, period: LeaderboardPeriod = "all") {
  const periodStart =
    period === "week"
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      : period === "month"
        ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        : null;

  const whereClause = periodStart ? gte(quizAnswers.answeredAt, periodStart) : undefined;

  return db
    .select({
      userId: users.id,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      points: sql<number>`coalesce(sum(${quizAnswers.pointsAwarded}), 0)::float8`,
      answered: sql<number>`count(${quizAnswers.id})::int`,
      correct: sql<number>`coalesce(sum(case when ${quizAnswers.isCorrect} then 1 else 0 end), 0)::int`,
    })
    .from(quizAnswers)
    .innerJoin(users, eq(users.id, quizAnswers.userId))
    .where(whereClause)
    .groupBy(users.id)
    .orderBy(desc(sql`coalesce(sum(${quizAnswers.pointsAwarded}), 0)`))
    .limit(limit);
}

export async function updatePlayStreak(userId: string): Promise<number> {
  const [userData] = await db
    .select({ playStreak: users.playStreak, lastPlayedDate: users.lastPlayedDate })
    .from(users)
    .where(eq(users.id, userId));

  if (!userData) return 0;

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  let newStreak: number;
  if (userData.lastPlayedDate === today) {
    newStreak = userData.playStreak;
  } else if (userData.lastPlayedDate === yesterday) {
    newStreak = userData.playStreak + 1;
  } else {
    newStreak = 1;
  }

  await db
    .update(users)
    .set({ playStreak: newStreak, lastPlayedDate: today, updatedAt: sql`now()` })
    .where(eq(users.id, userId));

  return newStreak;
}

export async function getTotalPointsForUser(userId: string) {
  const [row] = await db
    .select({ points: sql<number>`coalesce(sum(${quizAnswers.pointsAwarded}), 0)::float8` })
    .from(quizAnswers)
    .where(eq(quizAnswers.userId, userId));
  return row?.points ?? 0;
}

export async function getCategoryMasteryForUser(userId: string) {
  return db
    .select({
      categoryName: categories.name,
      answered: sql<number>`count(${quizAnswers.id})::int`,
      correct: sql<number>`coalesce(sum(case when ${quizAnswers.isCorrect} then 1 else 0 end), 0)::int`
    })
    .from(quizAnswers)
    .innerJoin(questions, eq(questions.id, quizAnswers.questionId))
    .innerJoin(categories, eq(categories.id, questions.categoryId))
    .where(eq(quizAnswers.userId, userId))
    .groupBy(categories.name)
    .orderBy(desc(sql`count(${quizAnswers.id})`));
}

export async function getOverviewAnalytics() {
  const [overview] = await db.execute<{
    total_questions: number;
    total_categories: number;
    total_users: number;
    total_quizzes_completed: number;
  }>(sql`
    select
      (select count(*)::int from questions) as total_questions,
      (select count(*)::int from categories) as total_categories,
      (select count(*)::int from users) as total_users,
      (select count(*)::int from quiz_sessions where status = 'completed') as total_quizzes_completed
  `);

  return {
    totalQuestions: overview?.total_questions ?? 0,
    totalCategories: overview?.total_categories ?? 0,
    totalUsers: overview?.total_users ?? 0,
    totalQuizzesCompleted: overview?.total_quizzes_completed ?? 0
  };
}
