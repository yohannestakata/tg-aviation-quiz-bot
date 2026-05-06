import {
  advanceQuizSession,
  cancelActiveQuizForUser,
  createQuizSession,
  getPersonalStats,
  getQuizScore,
  getSessionQuestion,
  listCategories,
  listQuestionsForQuiz,
  recordAnswer,
  type Category,
  type QuestionOption
} from "@aviation/db";
import type { BotContext, ActiveQuiz } from "../types";
import { answerKeyboard, categoriesKeyboard, countKeyboard, typeKeyboard } from "../keyboards/quiz.keyboards";
import { ensureTelegramGroup, ensureTelegramUser } from "./telegram-user.service";
import { isShortAnswerCorrect } from "../utils/normalize-answer";

type DraftQuiz = {
  categoryId?: string;
  count?: number;
  questionType?: "multiple_choice" | "short_answer";
};

const drafts = new Map<number, DraftQuiz>();
const activeQuizzes = new Map<number, ActiveQuiz>();

function chatKey(ctx: BotContext) {
  return ctx.chat?.id ?? ctx.from?.id;
}

function requireKey(ctx: BotContext) {
  const key = chatKey(ctx);
  if (!key) throw new Error("Unable to determine Telegram chat");
  return key;
}

export async function showQuizCategories(ctx: BotContext) {
  const categories = await listCategories();
  if (!categories.length) {
    await ctx.reply("No active categories are available yet.");
    return;
  }

  drafts.set(requireKey(ctx), {});
  await ctx.reply("Choose a category:", { reply_markup: categoriesKeyboard(categories as Category[]) });
}

export async function setQuizCategory(ctx: BotContext, categoryId: string) {
  const key = requireKey(ctx);
  drafts.set(key, { ...(drafts.get(key) ?? {}), categoryId: categoryId === "mixed" ? undefined : categoryId });
  await ctx.answerCallbackQuery();
  await ctx.reply("How many questions?", { reply_markup: countKeyboard() });
}

export async function setQuizCount(ctx: BotContext, count: number) {
  const key = requireKey(ctx);
  drafts.set(key, { ...(drafts.get(key) ?? {}), count });
  await ctx.answerCallbackQuery();
  await ctx.reply("Choose question type:", { reply_markup: typeKeyboard() });
}

export async function setQuizTypeAndStart(ctx: BotContext, type: "multiple_choice" | "short_answer" | "mixed") {
  const key = requireKey(ctx);
  const user = await ensureTelegramUser(ctx);
  if (!user) {
    await ctx.reply("I need a Telegram user to start a quiz.");
    return;
  }

  const group = await ensureTelegramGroup(ctx);
  const draft = drafts.get(key) ?? {};
  const totalQuestions = draft.count ?? 5;
  const questionType = type === "mixed" ? undefined : type;
  const selectedQuestions = await listQuestionsForQuiz({
    categoryId: draft.categoryId,
    questionType,
    limit: totalQuestions
  });

  await ctx.answerCallbackQuery();
  if (selectedQuestions.length < totalQuestions) {
    await ctx.reply(`Only ${selectedQuestions.length} matching questions are available. Try another category or question type.`);
    return;
  }

  await cancelActiveQuizForUser(user.id);
  const session = await createQuizSession({
    userId: user.id,
    groupId: group?.id ?? null,
    categoryId: draft.categoryId,
    questionType,
    totalQuestions,
    questionIds: selectedQuestions.map((question) => question.id),
    mode: group ? "group" : "private"
  });

  activeQuizzes.set(key, {
    sessionId: session.id,
    userId: user.id,
    categoryId: draft.categoryId,
    questionType,
    totalQuestions,
    currentIndex: 0
  });
  drafts.delete(key);

  await ctx.reply("Quiz started.");
  await sendCurrentQuestion(ctx);
}

export async function sendCurrentQuestion(ctx: BotContext) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) {
    await ctx.reply("No active quiz. Use /quiz to start one.");
    return;
  }

  const question = await getSessionQuestion(active.sessionId, active.currentIndex);
  if (!question) {
    await finishQuiz(ctx);
    return;
  }

  const header = `Question ${active.currentIndex + 1} of ${active.totalQuestions}`;
  const text = `${header}\n\n${question.questionText}`;
  if (question.imageUrl) {
    await ctx.replyWithPhoto(question.imageUrl, {
      caption: text,
      reply_markup: question.questionType === "multiple_choice" ? answerKeyboard(question.options) : undefined
    });
    return;
  }

  await ctx.reply(text, {
    reply_markup: question.questionType === "multiple_choice" ? answerKeyboard(question.options) : undefined
  });
}

export async function answerMultipleChoice(ctx: BotContext, optionIndex: number) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) {
    await ctx.answerCallbackQuery("No active quiz.");
    return;
  }

  const question = await getSessionQuestion(active.sessionId, active.currentIndex);
  const selected = question?.options[optionIndex] as QuestionOption | undefined;
  if (!question || !selected) {
    await ctx.answerCallbackQuery("That answer is no longer available.");
    return;
  }

  const isCorrect = selected.isCorrect;
  await recordAnswer({
    quizSessionId: active.sessionId,
    questionId: question.id,
    userId: active.userId,
    selectedOptionId: selected.id,
    answerText: selected.optionText,
    isCorrect
  });

  await ctx.answerCallbackQuery(isCorrect ? "Correct" : "Not quite");
  await ctx.reply(formatFeedback(isCorrect, question.correctAnswerText, question.explanation));
  await moveNext(ctx, active);
}

export async function answerShortText(ctx: BotContext, answerText: string) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) return false;

  const question = await getSessionQuestion(active.sessionId, active.currentIndex);
  if (!question || question.questionType !== "short_answer") return false;

  const isCorrect = isShortAnswerCorrect(answerText, question.correctAnswerText, question.acceptedKeywords);
  await recordAnswer({
    quizSessionId: active.sessionId,
    questionId: question.id,
    userId: active.userId,
    answerText,
    isCorrect
  });

  await ctx.reply(formatFeedback(isCorrect, question.correctAnswerText, question.explanation));
  await moveNext(ctx, active);
  return true;
}

export async function cancelQuiz(ctx: BotContext) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) {
    await ctx.reply("No active quiz to cancel.");
    return;
  }

  activeQuizzes.delete(key);
  await advanceQuizSession(active.sessionId, active.currentIndex, true);
  await ctx.reply("Quiz cancelled.");
}

export async function showMyStats(ctx: BotContext) {
  const user = await ensureTelegramUser(ctx);
  if (!user) return;
  const stats = await getPersonalStats(user.id);
  await ctx.reply(
    [
      "Your stats",
      `Quizzes completed: ${stats.quizzesCompleted}`,
      `Questions answered: ${stats.questionsAnswered}`,
      `Correct answers: ${stats.correctAnswers}`,
      `Accuracy: ${stats.accuracy}%`
    ].join("\n")
  );
}

async function moveNext(ctx: BotContext, active: ActiveQuiz) {
  const nextIndex = active.currentIndex + 1;
  if (nextIndex >= active.totalQuestions) {
    await finishQuiz(ctx);
    return;
  }

  active.currentIndex = nextIndex;
  await advanceQuizSession(active.sessionId, nextIndex);
  await sendCurrentQuestion(ctx);
}

async function finishQuiz(ctx: BotContext) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) return;

  const score = await getQuizScore(active.sessionId);
  await advanceQuizSession(active.sessionId, active.totalQuestions, true);
  activeQuizzes.delete(key);

  const accuracy = active.totalQuestions ? Math.round((score.correct / active.totalQuestions) * 100) : 0;
  await ctx.reply([`Quiz complete`, `Score: ${score.correct}/${active.totalQuestions}`, `Accuracy: ${accuracy}%`, "Use /quiz to practice again."].join("\n"));
}

function formatFeedback(isCorrect: boolean, correctAnswer?: string | null, explanation?: string | null) {
  const lines = [isCorrect ? "Correct." : "Not quite."];
  if (!isCorrect && correctAnswer) lines.push(`Correct answer: ${correctAnswer}`);
  if (explanation) lines.push(`Explanation: ${explanation}`);
  return lines.join("\n\n");
}
