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
    await ctx.reply("No leaderboard entries yet. Complete a quiz first.");
    return;
  }

  await ctx.reply(
    rows
      .map((row, index) => {
        const displayName = row.username ? `@${row.username}` : [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unknown";
        return `${index + 1}. ${displayName} - ${row.points} pts`;
      })
      .join("\n")
  );
}
