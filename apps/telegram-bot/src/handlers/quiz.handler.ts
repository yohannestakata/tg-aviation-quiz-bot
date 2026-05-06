import type { Bot } from "grammy";
import { listCategories } from "@aviation/db";
import type { BotContext } from "../types";
import {
  answerMultipleChoice,
  answerShortText,
  cancelQuiz,
  handleReportNoteText,
  handleTeamNameText,
  joinTeam,
  setPlayMode,
  setQuizCategory,
  setQuizCount,
  setTeamCount,
  setTeamJoinMode,
  setQuizTypeAndStart,
  showQuizCategories,
  showHint,
  skipReportNote,
  startQuestionReport,
  startTeamQuiz
} from "../services/quiz.service";
import type { QuizPlayMode, TeamJoinMode } from "../types";

export function registerQuizHandlers(bot: Bot<BotContext>) {
  bot.command(["quiz", "groupquiz"], showQuizCategories);
  bot.command("cancel", cancelQuiz);

  bot.command("categories", async (ctx) => {
    const categories = await listCategories();
    await ctx.reply(categories.length ? categories.map((category) => category.name).join("\n") : "No active categories yet.");
  });

  bot.callbackQuery("menu:quiz", showQuizCategories);
  bot.callbackQuery(/^quiz:mode:(individual|free_form|teams)$/, async (ctx) => {
    await setPlayMode(ctx, ctx.match[1]! as QuizPlayMode);
  });
  bot.callbackQuery(/^quiz:teams:(\d+)$/, async (ctx) => setTeamCount(ctx, Number(ctx.match[1]!)));
  bot.callbackQuery(/^quiz:joinmode:(manual|auto_balance)$/, async (ctx) => {
    await setTeamJoinMode(ctx, ctx.match[1]! as TeamJoinMode);
  });
  bot.callbackQuery(/^quiz:cat:(.+)$/, async (ctx) => setQuizCategory(ctx, ctx.match[1]!));
  bot.callbackQuery(/^quiz:count:(\d+)$/, async (ctx) => setQuizCount(ctx, Number(ctx.match[1]!)));
  bot.callbackQuery(/^quiz:type:(multiple_choice|short_answer|mixed)$/, async (ctx) => {
    await setQuizTypeAndStart(ctx, ctx.match[1]! as "multiple_choice" | "short_answer" | "mixed");
  });
  bot.callbackQuery(/^teamjoin:(auto|\d+)$/, async (ctx) => joinTeam(ctx, ctx.match[1]!));
  bot.callbackQuery("quiz:start", startTeamQuiz);

  bot.callbackQuery(/^answer:(\d+)$/, async (ctx) => answerMultipleChoice(ctx, Number(ctx.match[1]!)));
  bot.callbackQuery("question:hint", showHint);
  bot.callbackQuery("question:report", startQuestionReport);
  bot.callbackQuery("report:skip", skipReportNote);

  bot.on("message:text", async (ctx, next) => {
    const handledReport = await handleReportNoteText(ctx, ctx.message.text);
    if (handledReport) return;
    const handledTeamName = await handleTeamNameText(ctx, ctx.message.text);
    if (handledTeamName) return;
    const handled = await answerShortText(ctx, ctx.message.text);
    if (!handled) await next();
  });
}
