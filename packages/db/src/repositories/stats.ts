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
export type LeaderboardMode = "all" | "solo" | "free_form" | "race" | "teams" | "duels";

export type LeaderboardRow = {
  userId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  points: number;
};

function periodStartFor(period: LeaderboardPeriod): Date | null {
  if (period === "week") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (period === "month") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

export async function getGlobalLeaderboard(
  limit = 10,
  period: LeaderboardPeriod = "all",
  mode: LeaderboardMode = "all",
): Promise<LeaderboardRow[]> {
  const start = periodStartFor(period);
  const startIso = start ? start.toISOString() : null;

  // Duels-only: sum challenger_score for challenger and target_score for target
  if (mode === "duels") {
    const rows = await db.execute<{
      user_id: string;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      points: number;
    }>(sql`
      WITH duel_points AS (
        SELECT challenger_id AS user_id, challenger_score AS pts FROM duels
        WHERE ${startIso ? sql`played_at >= ${startIso}::timestamptz` : sql`true`}
        UNION ALL
        SELECT target_id AS user_id, target_score AS pts FROM duels
        WHERE ${startIso ? sql`played_at >= ${startIso}::timestamptz` : sql`true`}
      )
      SELECT u.id AS user_id, u.username, u.first_name, u.last_name,
             COALESCE(SUM(dp.pts), 0)::float8 AS points
      FROM users u
      JOIN duel_points dp ON dp.user_id = u.id
      GROUP BY u.id
      HAVING COALESCE(SUM(dp.pts), 0) > 0
      ORDER BY points DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      points: Number(r.points),
    }));
  }

  // Quiz-mode filter (solo/free_form/race/teams) — join quiz_sessions and filter by play_mode
  const playModeFilter =
    mode === "solo" ? "individual"
    : mode === "free_form" ? "free_form"
    : mode === "race" ? "race"
    : mode === "teams" ? "teams"
    : null; // "all" → include every play_mode

  // "all": combine quiz points (across all modes) with duel points
  if (mode === "all") {
    const rows = await db.execute<{
      user_id: string;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      points: number;
    }>(sql`
      WITH quiz_points AS (
        SELECT qa.user_id, SUM(qa.points_awarded)::float8 AS pts
        FROM quiz_answers qa
        WHERE ${startIso ? sql`qa.answered_at >= ${startIso}::timestamptz` : sql`true`}
        GROUP BY qa.user_id
      ),
      duel_points AS (
        SELECT user_id, SUM(pts)::float8 AS pts FROM (
          SELECT challenger_id AS user_id, challenger_score AS pts FROM duels
          WHERE ${startIso ? sql`played_at >= ${startIso}::timestamptz` : sql`true`}
          UNION ALL
          SELECT target_id AS user_id, target_score AS pts FROM duels
          WHERE ${startIso ? sql`played_at >= ${startIso}::timestamptz` : sql`true`}
        ) src
        GROUP BY user_id
      ),
      combined AS (
        SELECT user_id, pts FROM quiz_points
        UNION ALL
        SELECT user_id, pts FROM duel_points
      )
      SELECT u.id AS user_id, u.username, u.first_name, u.last_name,
             COALESCE(SUM(c.pts), 0)::float8 AS points
      FROM users u
      JOIN combined c ON c.user_id = u.id
      GROUP BY u.id
      HAVING COALESCE(SUM(c.pts), 0) > 0
      ORDER BY points DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      points: Number(r.points),
    }));
  }

  // solo / free_form / race / teams — quiz_answers joined to quiz_sessions
  const filters = [eq(quizSessions.playMode, playModeFilter as "individual" | "free_form" | "race" | "teams")];
  if (start) filters.push(gte(quizAnswers.answeredAt, start));

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      points: sql<number>`coalesce(sum(${quizAnswers.pointsAwarded}), 0)::float8`,
    })
    .from(quizAnswers)
    .innerJoin(users, eq(users.id, quizAnswers.userId))
    .innerJoin(quizSessions, eq(quizSessions.id, quizAnswers.quizSessionId))
    .where(and(...filters))
    .groupBy(users.id)
    .having(sql`coalesce(sum(${quizAnswers.pointsAwarded}), 0) > 0`)
    .orderBy(desc(sql`coalesce(sum(${quizAnswers.pointsAwarded}), 0)`))
    .limit(limit);

  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    firstName: r.firstName,
    lastName: r.lastName,
    points: Number(r.points),
  }));
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
