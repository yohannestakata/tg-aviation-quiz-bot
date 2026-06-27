import type { Bot } from "grammy";
import { getGlobalLeaderboard, type LeaderboardPeriod } from "@aviation/db";
import type { BotContext } from "../types";
import { rankFromPoints } from "../utils/rank";
import { leaderboardPeriodKeyboard } from "../keyboards/quiz.keyboards";
import { showMyStats } from "../services/quiz.service";

export function registerLeaderboardHandlers(bot: Bot<BotContext>) {
  bot.command("mystats", showMyStats);
  bot.callbackQuery("menu:stats", showMyStats);

  bot.command(["leaderboard", "groupleaderboard"], async (ctx) => {
    await replyLeaderboard(ctx, "all");
  });
  bot.callbackQuery("menu:leaderboard", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyLeaderboard(ctx, "all");
  });

  bot.callbackQuery(/^leaderboard:period:(all|week|month)$/, async (ctx) => {
    const period = ctx.match[1] as LeaderboardPeriod;
    await ctx.answerCallbackQuery();
    const rows = await getGlobalLeaderboard(10, period);
    const text = buildLeaderboardText(rows, period);
    await ctx.editMessageText(text, {
      reply_markup: leaderboardPeriodKeyboard(period),
    });
  });
}

async function replyLeaderboard(ctx: BotContext, period: LeaderboardPeriod) {
  const rows = await getGlobalLeaderboard(10, period);
  const text = buildLeaderboardText(rows, period);
  await ctx.reply(text, { reply_markup: leaderboardPeriodKeyboard(period) });
}

function buildLeaderboardText(
  rows: Array<{
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    points: number;
  }>,
  period: LeaderboardPeriod,
) {
  const periodLabel =
    period === "week" ? "This Week" : period === "month" ? "This Month" : "All Time";
  const medals = ["🥇", "🥈", "🥉"];

  if (!rows.length) {
    return `🏆 Leaderboard — ${periodLabel}\n\nNo entries yet. Complete a quiz to appear here.`;
  }

  return [
    `🏆 Leaderboard — ${periodLabel}`,
    "",
    ...rows.map(
      (row, index) =>
        `${medals[index] ?? `${index + 1}.`} ${rankFromPoints(row.points)} ${displayUserName(row)} — ${formatPoints(row.points)} pts`,
    ),
  ].join("\n");
}

function displayUserName(row: {
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}) {
  return (
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
    (row.username ? `@${row.username}` : "Unknown")
  );
}

function formatPoints(points: number) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}
