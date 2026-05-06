import type { Bot } from "grammy";
import type { BotContext } from "../types";
import { mainMenuKeyboard } from "../keyboards/quiz.keyboards";
import { ensureTelegramUser } from "../services/telegram-user.service";

export function registerStartHandlers(bot: Bot<BotContext>) {
  bot.command("start", async (ctx) => {
    await ensureTelegramUser(ctx);
    await ctx.reply(
      [
        "Welcome to Aviation Quiz Bot.",
        "",
        "Practice aviation topics, test your knowledge, and compare results with others.",
        "",
        "Choose an option below:"
      ].join("\n"),
      { reply_markup: mainMenuKeyboard() }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Commands",
        "/quiz - Start a quiz",
        "/categories - Show categories",
        "/leaderboard - Show leaderboard",
        "/mystats - Show personal stats",
        "/cancel - Cancel current quiz"
      ].join("\n")
    );
  });
}
