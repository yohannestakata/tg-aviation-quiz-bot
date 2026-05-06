import type { Bot } from "grammy";
import { getGlobalLeaderboard } from "@aviation/db";
import type { BotContext } from "../types";
import { showMyStats } from "../services/quiz.service";

export function registerLeaderboardHandlers(bot: Bot<BotContext>) {
  bot.command("mystats", showMyStats);
  bot.callbackQuery("menu:stats", showMyStats);

  bot.command(["leaderboard", "groupleaderboard"], showLeaderboard);
  bot.callbackQuery("menu:leaderboard", showLeaderboard);
}

async function showLeaderboard(ctx: BotContext) {
  const rows = await getGlobalLeaderboard(10);
  if (!rows.length) {
    await ctx.reply("🏆 No leaderboard entries yet. Complete a quiz first.");
    return;
  }

  await ctx.reply(
    ["🏆 Leaderboard", "", ...rows.map((row, index) => `${index + 1}. ${displayUserName(row)} - ${formatPoints(row.points)} pts`)].join("\n")
  );
}

function displayUserName(row: { username: string | null; firstName: string | null; lastName: string | null }) {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || (row.username ? `@${row.username}` : "Unknown");
}

function formatPoints(points: number) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}
