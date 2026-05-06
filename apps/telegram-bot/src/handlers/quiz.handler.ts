import type { Bot } from "grammy";
import { listCategories } from "@aviation/db";
import type { BotContext } from "../types";
import {
  answerMultipleChoice,
  answerShortText,
  cancelQuiz,
  setQuizCategory,
  setQuizCount,
  setQuizTypeAndStart,
  showQuizCategories
} from "../services/quiz.service";

export function registerQuizHandlers(bot: Bot<BotContext>) {
  bot.command(["quiz", "groupquiz"], showQuizCategories);
  bot.command("cancel", cancelQuiz);

  bot.command("categories", async (ctx) => {
    const categories = await listCategories();
    await ctx.reply(categories.length ? categories.map((category) => category.name).join("\n") : "No active categories yet.");
  });

  bot.callbackQuery("menu:quiz", showQuizCategories);
  bot.callbackQuery(/^quiz:cat:(.+)$/, async (ctx) => setQuizCategory(ctx, ctx.match[1]!));
  bot.callbackQuery(/^quiz:count:(\d+)$/, async (ctx) => setQuizCount(ctx, Number(ctx.match[1]!)));
  bot.callbackQuery(/^quiz:type:(multiple_choice|short_answer|mixed)$/, async (ctx) => {
    await setQuizTypeAndStart(ctx, ctx.match[1]! as "multiple_choice" | "short_answer" | "mixed");
  });

  bot.callbackQuery(/^answer:(\d+)$/, async (ctx) => answerMultipleChoice(ctx, Number(ctx.match[1]!)));

  bot.on("message:text", async (ctx, next) => {
    const handled = await answerShortText(ctx, ctx.message.text);
    if (!handled) await next();
  });
}
