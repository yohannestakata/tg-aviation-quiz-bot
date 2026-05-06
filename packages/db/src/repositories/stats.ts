import { desc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { quizAnswers, quizSessions, users } from "../schema";

export async function getPersonalStats(userId: string) {
  const [stats] = await db
    .select({
      quizzesCompleted: sql<number>`count(distinct ${quizSessions.id})::int`,
      questionsAnswered: sql<number>`count(${quizAnswers.id})::int`,
      correctAnswers: sql<number>`coalesce(sum(case when ${quizAnswers.isCorrect} then 1 else 0 end), 0)::int`
    })
    .from(quizSessions)
    .leftJoin(quizAnswers, eq(quizAnswers.quizSessionId, quizSessions.id))
    .where(eq(quizSessions.userId, userId));

  const base = stats ?? { quizzesCompleted: 0, questionsAnswered: 0, correctAnswers: 0 };
  return {
    ...base,
    accuracy: base.questionsAnswered ? Math.round((base.correctAnswers / base.questionsAnswered) * 100) : 0
  };
}

export async function getGlobalLeaderboard(limit = 10) {
  return db
    .select({
      userId: users.id,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      points: sql<number>`coalesce(sum(${quizAnswers.pointsAwarded}), 0)::float8`,
      answered: sql<number>`count(${quizAnswers.id})::int`,
      correct: sql<number>`coalesce(sum(case when ${quizAnswers.isCorrect} then 1 else 0 end), 0)::int`
    })
    .from(quizAnswers)
    .innerJoin(users, eq(users.id, quizAnswers.userId))
    .groupBy(users.id)
    .orderBy(desc(sql`coalesce(sum(${quizAnswers.pointsAwarded}), 0)`))
    .limit(limit);
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
