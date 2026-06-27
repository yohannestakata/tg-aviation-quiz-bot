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
        "✈️",
        "",
        "Practice aviation topics, test your knowledge, and compare results with others.",
        "",
        "Choose an option below:",
      ].join("\n"),
      { reply_markup: mainMenuKeyboard() },
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "🧭 How to use this bot",
        "Use these commands anytime:",
        "/quiz - Start a quiz",
        "/categories - Browse quiz categories",
        "/leaderboard - See top scores",
        "/mystats - Check your progress",
        "/cancel - Stop your current quiz",
        "",
        "Group tip: if answers are not being picked up in a group, ask your group admin to enable full message access for the bot.",
        "",
        "Made by @teddy444 and @yohannestakata.",
      ].join("\n"),
    );
  });
}
