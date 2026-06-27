import type { Bot } from "grammy";
import {
  getDailyChallengeAnswer,
  getDailyLeaderboard,
  getDailyQuestionForDate,
  recordDailyChallengeAnswer,
} from "@aviation/db";
import type { BotContext } from "../types";
import { ensureTelegramUser } from "../services/telegram-user.service";
import { isShortAnswerCorrect } from "../utils/normalize-answer";
import { dailyAnswerKeyboard, dailyResultKeyboard } from "../keyboards/quiz.keyboards";

type PendingDaily = {
  questionId: string;
  questionType: "multiple_choice" | "short_answer";
  options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
  correctAnswerText: string | null;
  acceptedKeywords: string[];
  explanation: string | null;
  startedAt: Date;
};

const pendingDailyAnswers = new Map<number, PendingDaily>();

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerDailyHandlers(bot: Bot<BotContext>) {
  bot.command("daily", handleDailyCommand);
  bot.callbackQuery("daily:leaderboard", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendDailyLeaderboard(ctx);
  });
  bot.callbackQuery(/^daily:mc:(\d+)$/, async (ctx) => {
    await answerDailyMultipleChoice(ctx, Number(ctx.match[1]!));
  });
}

async function handleDailyCommand(ctx: BotContext) {
  const user = await ensureTelegramUser(ctx);
  if (!user || !ctx.from) return;

  const today = todayDate();
  const existing = await getDailyChallengeAnswer(user.id, today);

  if (existing) {
    const icon = existing.isCorrect ? "✅" : "❌";
    const speed = existing.elapsedSeconds != null ? ` in ${existing.elapsedSeconds}s` : "";
    await ctx.reply(
      `📅 You already answered today's challenge${speed}.\n${icon} ${existing.isCorrect ? "Correct!" : "Wrong."}`,
      { reply_markup: dailyResultKeyboard() },
    );
    return;
  }

  const question = await getDailyQuestionForDate(today);
  if (!question) {
    await ctx.reply("No daily question available yet. Check back later.");
    return;
  }

  pendingDailyAnswers.set(ctx.from.id, {
    questionId: question.id,
    questionType: question.questionType,
    options: question.options.map((o) => ({
      id: o.id,
      optionText: o.optionText,
      isCorrect: o.isCorrect,
    })),
    correctAnswerText: question.correctAnswerText,
    acceptedKeywords: question.acceptedKeywords,
    explanation: question.explanation,
    startedAt: new Date(),
  });

  const header = `📅 Daily Challenge — ${today}`;
  const body = question.questionText;

  if (question.questionType === "multiple_choice" && question.options.length) {
    await ctx.reply(`${header}\n\n${body}`, {
      reply_markup: dailyAnswerKeyboard(question.options),
    });
  } else {
    await ctx.reply(`${header}\n\n${body}\n\n✍️ Type your answer:`);
  }
}

async function answerDailyMultipleChoice(ctx: BotContext, optionIndex: number) {
  const user = await ensureTelegramUser(ctx);
  if (!user || !ctx.from) {
    await ctx.answerCallbackQuery("Unable to identify account.");
    return;
  }

  const pending = pendingDailyAnswers.get(ctx.from.id);
  if (!pending) {
    await ctx.answerCallbackQuery("Send /daily first.");
    return;
  }

  const selected = pending.options[optionIndex];
  if (!selected) {
    await ctx.answerCallbackQuery("Invalid option.");
    return;
  }

  const elapsed = Math.round((Date.now() - pending.startedAt.getTime()) / 1000);
  const isCorrect = selected.isCorrect;
  pendingDailyAnswers.delete(ctx.from.id);

  await recordDailyChallengeAnswer({
    userId: user.id,
    questionId: pending.questionId,
    challengeDate: todayDate(),
    selectedOptionId: selected.id,
    answerText: selected.optionText,
    isCorrect,
    elapsedSeconds: elapsed,
  });

  await ctx.answerCallbackQuery(isCorrect ? "Correct!" : "Wrong!");
  await ctx.reply(buildDailyFeedback(isCorrect, pending, elapsed), {
    reply_markup: dailyResultKeyboard(),
  });
}

export async function handleDailyTextAnswer(ctx: BotContext, text: string): Promise<boolean> {
  if (!ctx.from) return false;
  const pending = pendingDailyAnswers.get(ctx.from.id);
  if (!pending || pending.questionType !== "short_answer") return false;

  const user = await ensureTelegramUser(ctx);
  if (!user) return false;

  const elapsed = Math.round((Date.now() - pending.startedAt.getTime()) / 1000);
  const isCorrect = isShortAnswerCorrect(text, pending.correctAnswerText, pending.acceptedKeywords);
  pendingDailyAnswers.delete(ctx.from.id);

  await recordDailyChallengeAnswer({
    userId: user.id,
    questionId: pending.questionId,
    challengeDate: todayDate(),
    answerText: text,
    isCorrect,
    elapsedSeconds: elapsed,
  });

  await ctx.reply(buildDailyFeedback(isCorrect, pending, elapsed), {
    reply_markup: dailyResultKeyboard(),
  });
  return true;
}

async function sendDailyLeaderboard(ctx: BotContext) {
  const today = todayDate();
  const rows = await getDailyLeaderboard(today, 10);
  if (!rows.length) {
    await ctx.reply("📅 No answers yet today. Be the first!");
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.map((r, i) => {
    const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || (r.username ? `@${r.username}` : "Player");
    const icon = r.isCorrect ? "✅" : "❌";
    const speed = r.elapsedSeconds != null ? ` ${r.elapsedSeconds}s` : "";
    return `${medals[i] ?? `${i + 1}.`} ${name} ${icon}${speed}`;
  });
  await ctx.reply([`📅 Daily Challenge — ${today}`, "", ...lines].join("\n"));
}

function buildDailyFeedback(isCorrect: boolean, pending: PendingDaily, elapsed: number): string {
  const lines = [isCorrect ? "✅ Correct!" : "❌ Wrong."];
  lines.push(`⏱️ Time: ${elapsed}s`);
  if (!isCorrect && pending.correctAnswerText) {
    lines.push(`✅ Answer: ${pending.correctAnswerText}`);
  }
  if (pending.explanation) lines.push(`💡 ${pending.explanation}`);
  return lines.join("\n\n");
}
