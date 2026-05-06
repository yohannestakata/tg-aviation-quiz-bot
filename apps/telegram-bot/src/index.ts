import { Bot } from "grammy";
import type { BotContext } from "./types";
import { registerLeaderboardHandlers } from "./handlers/leaderboard.handler";
import { registerQuizHandlers } from "./handlers/quiz.handler";
import { registerStartHandlers } from "./handlers/start.handler";

const BOT_COMMANDS = [
  { command: "start", description: "Start the bot and see the welcome message" },
  { command: "help", description: "Show help and available commands" },
  { command: "quiz", description: "Start a private quiz" },
  { command: "groupquiz", description: "Start a quiz in a group" },
  { command: "categories", description: "List quiz categories" },
  { command: "mystats", description: "View your quiz statistics" },
  { command: "leaderboard", description: "View the global leaderboard" },
  { command: "groupleaderboard", description: "View group leaderboard" },
  { command: "cancel", description: "Cancel your current quiz" }
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
  registerQuizHandlers(bot);
  void syncTelegramCommandMenu(bot);

  bot.callbackQuery("menu:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Use /quiz to start, /mystats for your stats, and /leaderboard to compare scores.");
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
