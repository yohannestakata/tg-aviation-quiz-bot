import type { Bot } from "grammy";
import { getDuelStats, getDuelLeaderboard, findUserByTelegramId } from "@aviation/db";
import type { BotContext } from "../types";

function tgName(first?: string | null, last?: string | null, username?: string | null): string {
  return [first, last].filter(Boolean).join(" ") || (username ? `@${username}` : "Player");
}

export function registerDuelStatsHandlers(bot: Bot<BotContext>) {
  bot.command("duelstats", handleDuelStats);
  bot.command("duelboard", handleDuelBoard);
}

async function handleDuelStats(ctx: BotContext) {
  if (!ctx.from) return;

  const user = await findUserByTelegramId(String(ctx.from.id));
  if (!user) {
    await ctx.reply("You haven't started the bot yet. Send /start first.");
    return;
  }

  const stats = await getDuelStats(user.id);

  if (stats.total === 0) {
    await ctx.reply(
      "You haven't played any duels yet!\nUse /duel in a group by replying to someone's message to challenge them.",
    );
    return;
  }

  const streakLabel =
    stats.currentStreak >= 5 ? `${stats.currentStreak}W 🔥🔥` :
    stats.currentStreak >= 3 ? `${stats.currentStreak}W 🔥` :
    stats.currentStreak >= 1 ? `${stats.currentStreak}W ⚡` : "—";

  const record = `${stats.wins}W – ${stats.losses}L – ${stats.ties}T`;
  const lines = [
    "🥊 Your Duel Record",
    "",
    `Record: ${record} (${stats.total} total)`,
    `Win Rate: ${stats.winRate}%`,
    "",
    `Current Streak: ${streakLabel}`,
    `Best Streak: ${stats.maxStreak > 0 ? `${stats.maxStreak}W` : "—"} 🏆`,
    "",
    `Avg Score: ${stats.avgScore} pts/duel`,
    `Avg Accuracy: ${stats.avgAccuracy}%`,
  ];

  await ctx.reply(lines.join("\n"));
}

async function handleDuelBoard(ctx: BotContext) {
  const rows = await getDuelLeaderboard(10);

  if (!rows.length) {
    await ctx.reply("No duel history yet — use /duel in a group to challenge someone!");
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.map((r, i) => {
    const name = tgName(r.first_name, r.last_name, r.username);
    const rank = medals[i] ?? `${i + 1}.`;
    const tieNote = r.ties > 0 ? ` · ${r.ties}T` : "";
    return `${rank} ${name} — ${r.wins}W${tieNote} · ${r.win_rate}% WR (${r.total_duels} duels)`;
  });

  const msg = [
    "🏆 All-Time Duel Leaderboard",
    "",
    ...lines,
    "",
    "Use /duelstats to see your personal record.",
  ].join("\n");

  await ctx.reply(msg);
}
