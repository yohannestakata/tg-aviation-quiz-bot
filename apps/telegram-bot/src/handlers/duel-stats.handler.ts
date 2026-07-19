import type { Bot } from "grammy";
import { getDuelStats, getDuelLeaderboard, getHeadToHead, findUserByTelegramId, findUserByUsername } from "@aviation/db";
import type { BotContext } from "../types";

function tgName(first?: string | null, last?: string | null, username?: string | null): string {
  return [first, last].filter(Boolean).join(" ") || (username ? `@${username}` : "Player");
}

export function registerDuelStatsHandlers(bot: Bot<BotContext>) {
  bot.command("duelstats", handleDuelStats);
  bot.command("duelboard", handleDuelBoard);
  bot.command("duelh2h", handleDuelH2H);
}

async function handleDuelStats(ctx: BotContext) {
  if (!ctx.from) return;

  try {
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
  } catch (err) {
    console.error("duelstats error", err);
    await ctx.reply("Could not load duel stats right now. Try again shortly.").catch(() => {});
  }
}

async function handleDuelBoard(ctx: BotContext) {
  try {
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
      "Use /duelstats for your personal record.",
    ].join("\n");

    await ctx.reply(msg);
  } catch (err) {
    console.error("duelboard error", err);
    await ctx.reply("Could not load the leaderboard right now. Try again shortly.").catch(() => {});
  }
}

async function resolveH2HTarget(ctx: BotContext): Promise<
  { id: number; first_name: string; last_name?: string | null; username?: string | null } | "not_found" | "show_help"
> {
  // Priority 1: reply
  const replyFrom = ctx.message?.reply_to_message?.from;
  if (replyFrom && !replyFrom.is_bot) return replyFrom;

  // Priority 2: text_mention (no @username needed)
  // Priority 3: @mention
  const entities = ctx.message?.entities ?? [];
  const text = ctx.message?.text ?? "";
  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user && !entity.user.is_bot) {
      return entity.user;
    }
    if (entity.type === "mention") {
      const username = text.slice(entity.offset + 1, entity.offset + entity.length);
      const found = await findUserByUsername(username);
      if (!found) return "not_found";
      return {
        id: Number(found.telegramUserId),
        first_name: found.firstName ?? username,
        last_name: found.lastName,
        username: found.username,
      };
    }
  }

  return "show_help";
}

async function handleDuelH2H(ctx: BotContext) {
  if (!ctx.from) return;

  const resolved = await resolveH2HTarget(ctx);

  if (resolved === "show_help") {
    await ctx.reply(
      "Reply to someone's message with /duelh2h, or mention them — e.g. /duelh2h @username — to see your head-to-head record.",
    );
    return;
  }
  if (resolved === "not_found") {
    await ctx.reply("That player hasn't used the bot yet.");
    return;
  }

  const replyTarget = resolved;

  if (replyTarget.id === ctx.from.id) {
    await ctx.reply("You can't check H2H with yourself.");
    return;
  }

  try {
    const [myUser, theirUser] = await Promise.all([
      findUserByTelegramId(String(ctx.from.id)),
      findUserByTelegramId(String(replyTarget.id)),
    ]);

    if (!myUser) {
      await ctx.reply("You haven't started the bot yet. Send /start first.");
      return;
    }
    if (!theirUser) {
      const name = tgName(replyTarget.first_name, replyTarget.last_name, replyTarget.username);
      await ctx.reply(`${name} hasn't used the bot yet — they need to send /start first.`);
      return;
    }

    const myName = tgName(ctx.from.first_name, ctx.from.last_name, ctx.from.username);
    const theirName = tgName(replyTarget.first_name, replyTarget.last_name, replyTarget.username);

    const h2h = await getHeadToHead(myUser.id, theirUser.id);

    if (h2h.total === 0) {
      await ctx.reply(
        `⚔️ ${myName} vs ${theirName}\n\nYou two have never dueled yet — challenge them with /duel!`,
      );
      return;
    }

    const myWins = h2h.aWins;
    const theirWins = h2h.bWins;

    const leaderLine =
      myWins > theirWins ? `${myName} leads overall` :
      theirWins > myWins ? `${theirName} leads overall` :
      "Perfectly even — all square!";

    const lines = [
      `⚔️ ${myName} vs ${theirName} — Head to Head`,
      "",
      `${myName}: ${myWins}W`,
      `${theirName}: ${theirWins}W`,
      ...(h2h.ties > 0 ? [`Ties: ${h2h.ties}`] : []),
      `Total duels: ${h2h.total}`,
      "",
      leaderLine,
    ];

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    console.error("duelh2h error", err);
    await ctx.reply("Could not load H2H record right now. Try again shortly.").catch(() => {});
  }
}
