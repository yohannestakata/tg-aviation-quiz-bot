import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "../client";
import { duels, users } from "../schema";

export async function recordDuelResult(input: {
  challengerId: string;
  targetId: string;
  winnerId: string | null;
  challengerScore: number;
  targetScore: number;
  challengerCorrect: number;
  targetCorrect: number;
  totalQuestions: number;
  challengerFastestSecs?: number | null;
  targetFastestSecs?: number | null;
}) {
  const [row] = await db
    .insert(duels)
    .values({
      challengerId: input.challengerId,
      targetId: input.targetId,
      winnerId: input.winnerId,
      challengerScore: input.challengerScore,
      targetScore: input.targetScore,
      challengerCorrect: input.challengerCorrect,
      targetCorrect: input.targetCorrect,
      totalQuestions: input.totalQuestions,
      challengerFastestSecs: input.challengerFastestSecs ?? null,
      targetFastestSecs: input.targetFastestSecs ?? null,
    })
    .returning();
  return row;
}

export async function getHeadToHead(userAId: string, userBId: string) {
  const rows = await db
    .select()
    .from(duels)
    .where(
      or(
        and(eq(duels.challengerId, userAId), eq(duels.targetId, userBId)),
        and(eq(duels.challengerId, userBId), eq(duels.targetId, userAId)),
      ),
    )
    .orderBy(desc(duels.playedAt));

  const total = rows.length;
  const aWins = rows.filter((d) => d.winnerId === userAId).length;
  const bWins = rows.filter((d) => d.winnerId === userBId).length;
  const ties = rows.filter((d) => d.winnerId === null).length;

  return { aWins, bWins, ties, total };
}

export async function getDuelStats(userId: string) {
  const rows = await db
    .select()
    .from(duels)
    .where(or(eq(duels.challengerId, userId), eq(duels.targetId, userId)))
    .orderBy(desc(duels.playedAt));

  const total = rows.length;
  let wins = 0, losses = 0, ties = 0;
  let totalScore = 0, totalCorrect = 0, totalQs = 0;

  for (const d of rows) {
    const isChallenger = d.challengerId === userId;
    totalScore += isChallenger ? d.challengerScore : d.targetScore;
    totalCorrect += isChallenger ? d.challengerCorrect : d.targetCorrect;
    totalQs += d.totalQuestions;

    if (d.winnerId === userId) wins++;
    else if (d.winnerId === null) ties++;
    else losses++;
  }

  // Current win streak (newest first)
  let currentStreak = 0;
  for (const d of rows) {
    if (d.winnerId === userId) currentStreak++;
    else break;
  }

  // Best win streak (oldest first)
  let maxStreak = 0, tempStreak = 0;
  for (const d of [...rows].reverse()) {
    if (d.winnerId === userId) { tempStreak++; maxStreak = Math.max(maxStreak, tempStreak); }
    else tempStreak = 0;
  }

  return {
    total,
    wins,
    losses,
    ties,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    avgScore: total > 0 ? Math.round(totalScore / total) : 0,
    avgAccuracy: totalQs > 0 ? Math.round((totalCorrect / totalQs) * 100) : 0,
    currentStreak,
    maxStreak,
  };
}

export async function getDuelLeaderboard(limit = 10) {
  const rows = await db.execute(sql`
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.username,
      COUNT(d.id)::int AS total_duels,
      COUNT(d.id) FILTER (WHERE d.winner_id = u.id)::int AS wins,
      COUNT(d.id) FILTER (WHERE d.winner_id IS NULL)::int AS ties,
      ROUND(
        COUNT(d.id) FILTER (WHERE d.winner_id = u.id)::numeric
        / NULLIF(COUNT(d.id), 0) * 100
      )::int AS win_rate
    FROM users u
    INNER JOIN duels d ON d.challenger_id = u.id OR d.target_id = u.id
    GROUP BY u.id, u.first_name, u.last_name, u.username
    ORDER BY wins DESC, win_rate DESC, total_duels DESC
    LIMIT ${limit}
  `);
  return rows as unknown as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
    total_duels: number;
    wins: number;
    ties: number;
    win_rate: number;
  }>;
}
