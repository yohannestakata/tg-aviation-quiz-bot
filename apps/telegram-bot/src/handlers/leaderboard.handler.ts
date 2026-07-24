import type { Bot } from "grammy";
import {
  getGlobalLeaderboard,
  type LeaderboardMode,
  type LeaderboardPeriod,
} from "@aviation/db";
import type { BotContext } from "../types";
import { rankFromPoints } from "../utils/rank";
import { leaderboardKeyboard } from "../keyboards/quiz.keyboards";
import { showMyStats } from "../services/quiz.service";

const PERIOD_TITLE: Record<LeaderboardPeriod, string> = {
  all: "All Time",
  week: "This Week",
  month: "This Month",
};

const MODE_TITLE: Record<LeaderboardMode, string> = {
  all: "All",
  solo: "Solo",
  free_form: "Free-form",
  race: "Race",
  teams: "Teams",
  duels: "Duels",
};

function isPeriod(v: string): v is LeaderboardPeriod {
  return v === "all" || v === "week" || v === "month";
}
function isMode(v: string): v is LeaderboardMode {
  return v === "all" || v === "solo" || v === "free_form" || v === "race" || v === "teams" || v === "duels";
}

export function registerLeaderboardHandlers(bot: Bot<BotContext>) {
  bot.command("mystats", showMyStats);
  bot.callbackQuery("menu:stats", showMyStats);

  bot.command(["leaderboard", "groupleaderboard"], async (ctx) => {
    await replyLeaderboard(ctx, "all", "all");
  });
  bot.callbackQuery("menu:leaderboard", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyLeaderboard(ctx, "all", "all");
  });

  // Combined callback: leaderboard:set:<period>:<mode>
  bot.callbackQuery(/^leaderboard:set:([a-z_]+):([a-z_]+)$/, async (ctx) => {
    const [, p, m] = ctx.match;
    if (!p || !m || !isPeriod(p) || !isMode(m)) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const rows = await getGlobalLeaderboard(10, p, m);
    const text = buildLeaderboardText(rows, p, m);
    await ctx.editMessageText(text, {
      reply_markup: leaderboardKeyboard(p, m),
    }).catch(() => {});
  });

  // Backwards-compat: old period-only callback data still received in flight
  bot.callbackQuery(/^leaderboard:period:(all|week|month)$/, async (ctx) => {
    const period = ctx.match[1] as LeaderboardPeriod;
    await ctx.answerCallbackQuery();
    const rows = await getGlobalLeaderboard(10, period, "all");
    const text = buildLeaderboardText(rows, period, "all");
    await ctx.editMessageText(text, {
      reply_markup: leaderboardKeyboard(period, "all"),
    }).catch(() => {});
  });
}

async function replyLeaderboard(
  ctx: BotContext,
  period: LeaderboardPeriod,
  mode: LeaderboardMode,
) {
  const rows = await getGlobalLeaderboard(10, period, mode);
  const text = buildLeaderboardText(rows, period, mode);
  await ctx.reply(text, { reply_markup: leaderboardKeyboard(period, mode) });
}

function buildLeaderboardText(
  rows: Array<{
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    points: number;
  }>,
  period: LeaderboardPeriod,
  mode: LeaderboardMode,
) {
  const header = `🏆 Leaderboard — ${MODE_TITLE[mode]} · ${PERIOD_TITLE[period]}`;
  const medals = ["🥇", "🥈", "🥉"];

  if (!rows.length) {
    const hint = mode === "duels"
      ? "No duels recorded in this range yet."
      : mode === "all"
        ? "No entries yet. Play a quiz or duel to appear here."
        : `No ${MODE_TITLE[mode]} scores in this range yet.`;
    return `${header}\n\n${hint}`;
  }

  return [
    header,
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
