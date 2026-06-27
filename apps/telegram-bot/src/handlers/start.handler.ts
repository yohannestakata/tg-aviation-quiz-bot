import type { Bot } from "grammy";
import type { BotContext } from "../types";
import { mainMenuKeyboard } from "../keyboards/quiz.keyboards";
import { ensureTelegramUser } from "../services/telegram-user.service";
import { subscribeGroupToDaily, unsubscribeGroupFromDaily } from "@aviation/db";

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

  bot.command("subscribe", async (ctx) => {
    const chatType = ctx.chat?.type;
    if (chatType === "private") {
      await ctx.reply("This command is only available in groups.");
      return;
    }
    const chatId = String(ctx.chat!.id);
    await subscribeGroupToDaily(chatId);
    await ctx.reply("✅ This group is now subscribed to the daily aviation challenge at 08:00 UTC.");
  });

  bot.command("unsubscribe", async (ctx) => {
    const chatType = ctx.chat?.type;
    if (chatType === "private") {
      await ctx.reply("This command is only available in groups.");
      return;
    }
    const chatId = String(ctx.chat!.id);
    await unsubscribeGroupFromDaily(chatId);
    await ctx.reply("🔕 This group has been unsubscribed from the daily challenge.");
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
