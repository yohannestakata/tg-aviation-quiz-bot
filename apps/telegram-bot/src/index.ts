import { Bot } from "grammy";
import type { BotContext } from "./types";
import { registerLeaderboardHandlers } from "./handlers/leaderboard.handler";
import { registerQuizHandlers } from "./handlers/quiz.handler";
import { registerStartHandlers } from "./handlers/start.handler";
import { registerDailyHandlers } from "./handlers/daily.handler";
import { registerDuelHandlers } from "./handlers/duel.handler";
import { registerDuelStatsHandlers } from "./handlers/duel-stats.handler";

const BOT_COMMANDS = [
  { command: "start", description: "Start the bot and see the welcome message" },
  { command: "help", description: "Show help and available commands" },
  { command: "quiz", description: "Start a private quiz" },
  { command: "groupquiz", description: "Start a quiz in a group" },
  { command: "categories", description: "List quiz categories" },
  { command: "mystats", description: "View your quiz statistics" },
  { command: "leaderboard", description: "View the global leaderboard" },
  { command: "groupleaderboard", description: "View group leaderboard" },
  { command: "daily", description: "Answer today's daily aviation challenge" },
  { command: "duel", description: "Challenge another player to a duel (reply to their message)" },
  { command: "duelstats", description: "View your all-time duel statistics" },
  { command: "duelboard", description: "View the all-time duel leaderboard" },
  { command: "subscribe", description: "Subscribe this group to the daily challenge (group only)" },
  { command: "unsubscribe", description: "Unsubscribe this group from the daily challenge (group only)" },
  { command: "cancel", description: "Cancel your current quiz" },
] as const;

export function createAviationBot(token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }

  const bot = new Bot<BotContext>(token);

  bot.catch((error) => {
    console.error("Telegram bot error", error);
  });

  registerStartHandlers(bot);
  registerLeaderboardHandlers(bot);
  registerDailyHandlers(bot);
  registerDuelHandlers(bot);
  registerDuelStatsHandlers(bot);
  registerQuizHandlers(bot);
  void syncTelegramCommandMenu(bot);

  bot.callbackQuery("menu:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      [
        "Use /quiz to start, /mystats to check your progress, and /leaderboard to compare scores.",
        "",
        "Made by @teddy444 and @yohannestakata.",
      ].join("\n"),
    );
  });

  return bot;
}

async function syncTelegramCommandMenu(bot: Bot<BotContext>) {
  try {
    await bot.api.setMyCommands(BOT_COMMANDS);
    await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
  } catch (error) {
    console.error("Failed to sync Telegram command menu", error);
  }
}

export type { BotContext };
