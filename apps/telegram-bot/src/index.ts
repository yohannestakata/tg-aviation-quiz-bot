import { Bot } from "grammy";
import type { BotContext } from "./types";
import { registerLeaderboardHandlers } from "./handlers/leaderboard.handler";
import { registerQuizHandlers } from "./handlers/quiz.handler";
import { registerStartHandlers } from "./handlers/start.handler";

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

  bot.callbackQuery("menu:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Use /quiz to start, /mystats for your stats, and /leaderboard to compare scores.");
  });

  return bot;
}

export type { BotContext };
