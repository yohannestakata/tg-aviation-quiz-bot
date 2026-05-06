import type { Context } from "grammy";

export type BotContext = Context;

export type ActiveQuiz = {
  sessionId: string;
  userId: string;
  categoryId?: string;
  questionType?: "multiple_choice" | "short_answer";
  totalQuestions: number;
  currentIndex: number;
};
