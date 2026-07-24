import type { Context } from "grammy";

export type BotContext = Context;

export type QuizPlayMode = "individual" | "free_form" | "teams" | "race";
export type TeamJoinMode = "manual" | "auto_balance";

export type TeamMember = {
  telegramUserId: number;
  userId: string;
  displayName: string;
  teamName: string;
};

export type ActiveQuiz = {
  sessionId: string;
  userId: string;
  starterTelegramUserId: number;
  playMode: QuizPlayMode;
  teamNames: string[];
  teamMembers: Record<number, TeamMember>;
  answeredUserIds: Set<number>;
  hintLevels: Map<number, number>;
  currentTeamIndex: number;
  categoryId?: string;
  questionType?: "multiple_choice" | "short_answer";
  totalQuestions: number;
  currentIndex: number;
  questionStartedAt: Date;
  correctStreak: number;
  fastAnswerCount: number;
  wrongAnswerCount: number;
  questionTimeout?: ReturnType<typeof setTimeout> | null;
  advancing?: boolean;
};
