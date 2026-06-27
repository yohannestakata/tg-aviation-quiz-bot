import { eq, and } from "drizzle-orm";
import { db } from "../client";
import { userBadges } from "../schema";

export async function awardBadge(userId: string, badge: string): Promise<boolean> {
  const result = await db
    .insert(userBadges)
    .values({ userId, badge })
    .onConflictDoNothing()
    .returning();
  return result.length > 0;
}

export async function getUserBadges(userId: string): Promise<string[]> {
  const rows = await db
    .select({ badge: userBadges.badge })
    .from(userBadges)
    .where(eq(userBadges.userId, userId));
  return rows.map((r) => r.badge);
}

export async function checkAndAwardBadges(
  userId: string,
  stats: {
    correct: number;
    answered: number;
    playStreak: number;
    fastAnswerCount: number;
    totalQuestionsAnswered: number;
    accuracy: number;
    categoriesAnswered: number;
  },
): Promise<string[]> {
  const checks: Array<[string, boolean]> = [
    ["perfect_flight", stats.answered >= 10 && stats.correct === stats.answered],
    ["speed_demon", stats.fastAnswerCount >= 5],
    ["daily_grinder", stats.playStreak >= 7],
    ["scholar", stats.categoriesAnswered >= 5],
    ["centurion", stats.totalQuestionsAnswered >= 100],
    ["sharp_shooter", stats.totalQuestionsAnswered >= 50 && stats.accuracy >= 90],
  ];

  const earned: string[] = [];
  for (const [badge, condition] of checks) {
    if (condition) {
      const isNew = await awardBadge(userId, badge);
      if (isNew) earned.push(badge);
    }
  }
  return earned;
}
