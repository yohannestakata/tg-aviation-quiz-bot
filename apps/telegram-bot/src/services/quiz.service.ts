import {
  advanceQuizSession,
  cancelActiveQuizForUser,
  checkAndAwardBadges,
  createQuestionReport,
  createQuizSession,
  getCategoryMasteryForUser,
  getPersonalStats,
  getQuestionsByIds,
  getQuizScore,
  getSessionParticipantScores,
  getSessionQuestion,
  getTeamScores,
  getTotalPointsForUser,
  getUserBadges,
  getWrongQuestionIds,
  listCategories,
  listQuestionsForQuiz,
  recordAnswer,
  updatePlayStreak,
  type Category,
  type QuestionOption,
} from "@aviation/db";
import { rankFromPoints } from "../utils/rank";
import { formatBadgeAnnouncement, formatBadgeList } from "../utils/badge-meta";
import { retryWrongKeyboard } from "../keyboards/quiz.keyboards";
import type {
  ActiveQuiz,
  BotContext,
  QuizPlayMode,
  TeamJoinMode,
  TeamMember,
} from "../types";
import {
  answerKeyboard,
  categoriesKeyboard,
  countKeyboard,
  playModeKeyboard,
  questionActionsKeyboard,
  reportNoteKeyboard,
  teamCountKeyboard,
  teamJoinModeKeyboard,
  teamLobbyKeyboard,
  typeKeyboard,
} from "../keyboards/quiz.keyboards";
import {
  ensureTelegramGroup,
  ensureTelegramUser,
} from "./telegram-user.service";
import { isShortAnswerCorrect } from "../utils/normalize-answer";

type DraftQuiz = {
  creatorTelegramUserId: number;
  playMode: QuizPlayMode;
  categoryId?: string;
  count?: number;
  questionType?: "multiple_choice" | "short_answer";
  teamCount?: number;
  teamNames: string[];
  teamJoinMode?: TeamJoinMode;
  teamMembers: Record<number, TeamMember>;
};

type PendingReport = {
  questionId: string;
  quizSessionId: string;
  userId: string;
};

const drafts = new Map<number, DraftQuiz>();
const activeQuizzes = new Map<number, ActiveQuiz>();
const pendingReports = new Map<string, PendingReport>();

function chatKey(ctx: BotContext) {
  return ctx.chat?.id ?? ctx.from?.id;
}

function requireKey(ctx: BotContext) {
  const key = chatKey(ctx);
  if (!key) throw new Error("Unable to determine Telegram chat");
  return key;
}

function isGroupChat(ctx: BotContext) {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function isCreator(
  ctx: BotContext,
  draftOrActive: {
    creatorTelegramUserId?: number;
    starterTelegramUserId?: number;
  },
) {
  const creatorId =
    draftOrActive.creatorTelegramUserId ?? draftOrActive.starterTelegramUserId;
  return Boolean(ctx.from?.id && creatorId === ctx.from.id);
}

function displayName(ctx: BotContext) {
  const from = ctx.from;
  if (!from) return "Player";
  return (
    [from.first_name, from.last_name].filter(Boolean).join(" ") ||
    (from.username ? `@${from.username}` : "Player")
  );
}

export async function showQuizCategories(ctx: BotContext) {
  if (!ctx.from) {
    await ctx.reply(
      "👤 I couldn't identify your account. Please send /start and try again.",
    );
    return;
  }

  const key = requireKey(ctx);
  if (isGroupChat(ctx)) {
    drafts.set(key, {
      creatorTelegramUserId: ctx.from.id,
      playMode: "individual",
      teamNames: [],
      teamMembers: {},
    });
    await ctx.reply("🎮 Choose how this group quiz should be played:", {
      reply_markup: playModeKeyboard(),
    });
    return;
  }

  drafts.set(key, {
    creatorTelegramUserId: ctx.from.id,
    playMode: "individual",
    teamNames: [],
    teamMembers: {},
  });
  await showCategoryStep(ctx);
}

export async function setPlayMode(ctx: BotContext, playMode: QuizPlayMode) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (!draft || !isCreator(ctx, draft)) {
    await ctx.answerCallbackQuery("Only the quiz creator can choose this.");
    return;
  }

  drafts.set(key, { ...draft, playMode });
  await ctx.answerCallbackQuery();

  if (playMode === "teams") {
    await ctx.reply("👥 How many teams?", {
      reply_markup: teamCountKeyboard(),
    });
    return;
  }

  await showCategoryStep(ctx);
}

export async function setTeamCount(ctx: BotContext, teamCount: number) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (!draft || !isCreator(ctx, draft)) {
    await ctx.answerCallbackQuery("Only the quiz creator can choose this.");
    return;
  }

  drafts.set(key, { ...draft, teamCount, teamNames: [], teamMembers: {} });
  await ctx.answerCallbackQuery();
  await ctx.reply("🏷️ Send the name for Team 1.");
}

export async function handleTeamNameText(ctx: BotContext, text: string) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (!draft || draft.playMode !== "teams" || !draft.teamCount) return false;
  if (draft.teamNames.length >= draft.teamCount) return false;
  if (!isCreator(ctx, draft)) return true;

  const teamName = text.trim().slice(0, 32);
  if (!teamName) {
    await ctx.reply("🏷️ Team name cannot be empty.");
    return true;
  }

  const teamNames = [...draft.teamNames, teamName];
  drafts.set(key, { ...draft, teamNames });

  if (teamNames.length < draft.teamCount) {
    await ctx.reply(`🏷️ Send the name for Team ${teamNames.length + 1}.`);
    return true;
  }

  await ctx.reply("👥 How should players join teams?", {
    reply_markup: teamJoinModeKeyboard(),
  });
  return true;
}

export async function setTeamJoinMode(
  ctx: BotContext,
  teamJoinMode: TeamJoinMode,
) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (!draft || !isCreator(ctx, draft)) {
    await ctx.answerCallbackQuery("Only the quiz creator can choose this.");
    return;
  }

  drafts.set(key, { ...draft, teamJoinMode });
  await ctx.answerCallbackQuery();
  await showCategoryStep(ctx);
}

export async function setQuizCategory(ctx: BotContext, categoryId: string) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (draft && !isCreator(ctx, draft)) {
    await ctx.answerCallbackQuery("Only the quiz creator can configure this.");
    return;
  }

  drafts.set(key, {
    ...(draft ?? {
      creatorTelegramUserId: ctx.from?.id ?? 0,
      playMode: "individual" as const,
      teamNames: [],
      teamMembers: {},
    }),
    categoryId: categoryId === "mixed" ? undefined : categoryId,
  });
  await ctx.answerCallbackQuery();
  await ctx.reply("🔢 How many questions?", { reply_markup: countKeyboard() });
}

export async function setQuizCount(ctx: BotContext, count: number) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (draft && !isCreator(ctx, draft)) {
    await ctx.answerCallbackQuery("Only the quiz creator can configure this.");
    return;
  }

  drafts.set(key, { ...(draft ?? baseDraft(ctx)), count });
  await ctx.answerCallbackQuery();
  await ctx.reply("🧩 Choose question type:", { reply_markup: typeKeyboard() });
}

export async function setQuizTypeAndStart(
  ctx: BotContext,
  type: "multiple_choice" | "short_answer" | "mixed",
) {
  const key = requireKey(ctx);
  const draft = drafts.get(key) ?? baseDraft(ctx);
  if (!isCreator(ctx, draft)) {
    await ctx.answerCallbackQuery("Only the quiz creator can configure this.");
    return;
  }

  const questionType = type === "mixed" ? undefined : type;
  drafts.set(key, { ...draft, questionType });
  await ctx.answerCallbackQuery();

  if (draft.playMode === "teams") {
    await showTeamLobby(ctx);
    return;
  }

  await startConfiguredQuiz(ctx);
}

export async function joinTeam(ctx: BotContext, target: string) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (!draft || draft.playMode !== "teams" || !draft.teamJoinMode) {
    await ctx.answerCallbackQuery("No team lobby is open.");
    return;
  }

  const user = await ensureTelegramUser(ctx);
  if (!user || !ctx.from) {
    await ctx.answerCallbackQuery("Unable to join.");
    return;
  }

  const teamName =
    target === "auto" ? smallestTeam(draft) : draft.teamNames[Number(target)];
  if (!teamName) {
    await ctx.answerCallbackQuery("Team not found.");
    return;
  }

  const teamMembers = {
    ...draft.teamMembers,
    [ctx.from.id]: {
      telegramUserId: ctx.from.id,
      userId: user.id,
      displayName: displayName(ctx),
      teamName,
    },
  };
  drafts.set(key, { ...draft, teamMembers });

  await ctx.answerCallbackQuery(`Joined ${teamName}`);
  await ctx.reply(
    `✅ ${displayName(ctx)} joined ${teamName}.\n\n${formatTeams(teamMembers, draft.teamNames)}`,
  );
}

export async function startTeamQuiz(ctx: BotContext) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (!draft || draft.playMode !== "teams") {
    await ctx.answerCallbackQuery("No team quiz is ready.");
    return;
  }
  if (!isCreator(ctx, draft)) {
    await ctx.answerCallbackQuery("Only the quiz creator can start.");
    return;
  }
  if (!Object.keys(draft.teamMembers).length) {
    await ctx.answerCallbackQuery("At least one player must join.");
    return;
  }

  await ctx.answerCallbackQuery();
  await startConfiguredQuiz(ctx);
}

export async function sendCurrentQuestion(ctx: BotContext) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) {
    await ctx.reply("No active quiz. Use /quiz to start one.");
    return;
  }

  active.answeredUserIds = new Set();
  active.questionStartedAt = new Date();
  active.wrongAnswerCount = 0;
  const question = await getSessionQuestion(
    active.sessionId,
    active.currentIndex,
  );
  if (!question) {
    await finishQuiz(ctx);
    return;
  }

  const header = `✈️ Q${active.currentIndex + 1}/${active.totalQuestions}  [${progressBar(active.currentIndex, active.totalQuestions)}]`;
  const audience =
    active.playMode === "teams"
      ? `👥 Team turn: ${currentTeam(active) ?? "Unknown"}`
      : active.playMode === "free_form"
        ? "🙋 Free Form: anyone can answer."
        : active.playMode === "race"
          ? "🏁 Race: first correct answer wins the point!"
          : "👤 Individual: only the quiz creator can answer.";
  const text = `${header}\n${audience}\n\n${question.questionText}`;
  const replyMarkup =
    question.questionType === "multiple_choice"
      ? answerKeyboard(question.options)
      : questionActionsKeyboard();

  if (question.imageUrl) {
    await ctx.replyWithPhoto(question.imageUrl, {
      caption: text,
      reply_markup: replyMarkup,
    });
    return;
  }

  await ctx.reply(text, { reply_markup: replyMarkup });
}

export async function showHint(ctx: BotContext) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) {
    await ctx.answerCallbackQuery("No active question.");
    return;
  }

  const permission = await resolveAnswerer(ctx, active);
  if (!permission.allowed) {
    await ctx.answerCallbackQuery(permission.reason);
    return;
  }

  const question = await getSessionQuestion(
    active.sessionId,
    active.currentIndex,
  );
  if (!question) {
    await ctx.answerCallbackQuery("No active question.");
    return;
  }

  active.hintedQuestionIndexes.add(active.currentIndex);
  await ctx.answerCallbackQuery(
    "Hint ready. Correct answers are worth 0.5 pts now.",
  );
  await ctx.reply(
    buildHint(
      question.correctAnswerText,
      question.questionType,
      question.options,
    ),
  );
}

export async function startQuestionReport(ctx: BotContext) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  const user = await ensureTelegramUser(ctx);
  if (!active || !user) {
    await ctx.answerCallbackQuery("No active question.");
    return;
  }

  const question = await getSessionQuestion(
    active.sessionId,
    active.currentIndex,
  );
  if (!question) {
    await ctx.answerCallbackQuery("No active question.");
    return;
  }

  pendingReports.set(reportKey(ctx), {
    questionId: question.id,
    quizSessionId: active.sessionId,
    userId: user.id,
  });
  await ctx.answerCallbackQuery("Report started");
  await ctx.reply("🚩 Send an optional note about this question, or skip.", {
    reply_markup: reportNoteKeyboard(),
  });
}

export async function skipReportNote(ctx: BotContext) {
  const pending = pendingReports.get(reportKey(ctx));
  if (!pending) {
    await ctx.answerCallbackQuery("No report note pending.");
    return;
  }

  await createQuestionReport(pending);
  pendingReports.delete(reportKey(ctx));
  await ctx.answerCallbackQuery("Report saved");
  await ctx.reply("🚩 Report saved. Thanks for helping improve the quiz.");
}

export async function handleReportNoteText(ctx: BotContext, note: string) {
  const key = reportKey(ctx);
  const pending = pendingReports.get(key);
  if (!pending) return false;

  await createQuestionReport({ ...pending, note });
  pendingReports.delete(key);
  await ctx.reply(
    "🚩 Report saved with your note. Thanks for helping improve the quiz.",
  );
  return true;
}

export async function answerMultipleChoice(
  ctx: BotContext,
  optionIndex: number,
) {
  await recordMultipleChoiceSelection(ctx, optionIndex, "callback");
}

async function recordMultipleChoiceSelection(
  ctx: BotContext,
  optionIndex: number,
  source: "callback" | "message",
) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) {
    if (source === "callback") await ctx.answerCallbackQuery("No active quiz.");
    return;
  }

  const permission = await resolveAnswerer(ctx, active);
  if (!permission.allowed) {
    if (source === "callback") await ctx.answerCallbackQuery(permission.reason);
    else await ctx.reply(permission.reason);
    return;
  }

  const question = await getSessionQuestion(
    active.sessionId,
    active.currentIndex,
  );
  const selected = question?.options[optionIndex] as QuestionOption | undefined;
  if (!question || !selected) {
    if (source === "callback")
      await ctx.answerCallbackQuery("That answer is no longer available.");
    return;
  }

  if (active.answeredUserIds.has(ctx.from!.id)) {
    if (source === "callback")
      await ctx.answerCallbackQuery("Your answer is already recorded.");
    else await ctx.reply("Your answer is already recorded.");
    return;
  }

  const isCorrect = selected.isCorrect;
  const { points: pointsAwarded, elapsedSeconds } = answerPoints(active, isCorrect);
  await recordAnswer({
    quizSessionId: active.sessionId,
    questionId: question.id,
    userId: permission.userId,
    selectedOptionId: selected.id,
    answerText: selected.optionText,
    teamName: permission.teamName,
    isCorrect,
    pointsAwarded,
  });

  active.answeredUserIds.add(ctx.from!.id);
  if (isCorrect && elapsedSeconds <= 10) active.fastAnswerCount++;
  active.correctStreak = isCorrect ? active.correctStreak + 1 : 0;
  const streak = isCorrect ? streakMessage(active.correctStreak) : null;

  if (active.playMode === "race") {
    if (source === "callback") await ctx.answerCallbackQuery(isCorrect ? "Correct!" : "Wrong!");
    if (!isCorrect) {
      active.wrongAnswerCount++;
      const hint = active.wrongAnswerCount >= 3 ? " Quiz creator can /cancel if everyone is stuck." : "";
      await ctx.reply(`❌ ${displayName(ctx)} guessed wrong.${hint}`);
      return;
    }
    await ctx.reply(
      `🏁 ${displayName(ctx)} got it!\n\n${formatFeedback(true, null, question.explanation, pointsAwarded, elapsedSeconds)}${streak ? `\n\n${streak}` : ""}`,
    );
    await moveNext(ctx, active);
    return;
  }

  if (active.playMode === "teams") {
    if (source === "callback")
      await ctx.answerCallbackQuery(isCorrect ? "Correct" : "Not quite");
    await ctx.reply(
      `👥 ${permission.teamName} answered.\n\n${formatFeedback(isCorrect, question.correctAnswerText, question.explanation, pointsAwarded, elapsedSeconds)}${streak ? `\n\n${streak}` : ""}`,
    );
    await moveNext(ctx, active);
    return;
  }

  if (source === "callback")
    await ctx.answerCallbackQuery(isCorrect ? "Correct" : "Not quite");
  await ctx.reply(
    `${formatFeedback(isCorrect, question.correctAnswerText, question.explanation, pointsAwarded, elapsedSeconds)}${streak ? `\n\n${streak}` : ""}`,
  );
  await moveNext(ctx, active);
}

export async function answerShortText(ctx: BotContext, answerText: string) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) return false;

  const question = await getSessionQuestion(
    active.sessionId,
    active.currentIndex,
  );
  if (!question) return false;

  if (question.questionType === "multiple_choice") {
    const optionIndex = parseOptionIndex(answerText, question.options);
    if (optionIndex === null) return false;
    await recordMultipleChoiceSelection(ctx, optionIndex, "message");
    return true;
  }

  if (question.questionType !== "short_answer") return false;

  const permission = await resolveAnswerer(ctx, active);
  if (!permission.allowed) {
    await ctx.reply(permission.reason);
    return true;
  }
  if (active.answeredUserIds.has(ctx.from!.id)) {
    await ctx.reply("Your answer is already recorded.");
    return true;
  }

  const isCorrect = isShortAnswerCorrect(
    answerText,
    question.correctAnswerText,
    question.acceptedKeywords,
  );
  const { points: pointsAwarded, elapsedSeconds } = answerPoints(active, isCorrect);
  await recordAnswer({
    quizSessionId: active.sessionId,
    questionId: question.id,
    userId: permission.userId,
    answerText,
    teamName: permission.teamName,
    isCorrect,
    pointsAwarded,
  });

  active.answeredUserIds.add(ctx.from!.id);
  if (isCorrect && elapsedSeconds <= 10) active.fastAnswerCount++;
  active.correctStreak = isCorrect ? active.correctStreak + 1 : 0;
  const streak = isCorrect ? streakMessage(active.correctStreak) : null;

  if (active.playMode === "race") {
    if (!isCorrect) {
      active.wrongAnswerCount++;
      const hint = active.wrongAnswerCount >= 3 ? " Quiz creator can /cancel if everyone is stuck." : "";
      await ctx.reply(`❌ ${displayName(ctx)} guessed wrong.${hint}`);
      return true;
    }
    await ctx.reply(
      `🏁 ${displayName(ctx)} got it!\n\n${formatFeedback(true, null, question.explanation, pointsAwarded, elapsedSeconds)}${streak ? `\n\n${streak}` : ""}`,
    );
    await moveNext(ctx, active);
    return true;
  }

  if (active.playMode === "teams") {
    await ctx.reply(
      `👥 ${permission.teamName} answered.\n\n${formatFeedback(isCorrect, question.correctAnswerText, question.explanation, pointsAwarded, elapsedSeconds)}${streak ? `\n\n${streak}` : ""}`,
    );
    await moveNext(ctx, active);
    return true;
  }

  await ctx.reply(
    `${formatFeedback(isCorrect, question.correctAnswerText, question.explanation, pointsAwarded, elapsedSeconds)}${streak ? `\n\n${streak}` : ""}`,
  );
  await moveNext(ctx, active);
  return true;
}

export async function startRetryQuiz(ctx: BotContext, sessionId: string) {
  const user = await ensureTelegramUser(ctx);
  if (!user || !ctx.from) {
    await ctx.answerCallbackQuery("Unable to identify your account.");
    return;
  }

  const wrongIds = await getWrongQuestionIds(sessionId, user.id);
  if (!wrongIds.length) {
    await ctx.answerCallbackQuery("No wrong answers to retry!");
    return;
  }

  const questionObjects = await getQuestionsByIds(wrongIds);
  if (!questionObjects.length) {
    await ctx.answerCallbackQuery("Could not load those questions.");
    return;
  }

  await ctx.answerCallbackQuery();
  const key = requireKey(ctx);
  const group = await ensureTelegramGroup(ctx);
  await cancelActiveQuizForUser(user.id);
  const session = await createQuizSession({
    userId: user.id,
    groupId: group?.id ?? null,
    playMode: "individual",
    totalQuestions: questionObjects.length,
    questionIds: questionObjects.map((q) => q.id),
    mode: group ? "group" : "private",
  });

  activeQuizzes.set(key, {
    sessionId: session.id,
    userId: user.id,
    starterTelegramUserId: ctx.from.id,
    playMode: "individual",
    teamNames: [],
    teamMembers: {},
    answeredUserIds: new Set(),
    hintedQuestionIndexes: new Set(),
    currentTeamIndex: 0,
    totalQuestions: questionObjects.length,
    currentIndex: 0,
    questionStartedAt: new Date(),
    correctStreak: 0,
  });

  await ctx.reply(
    `🔁 Retry session started — ${questionObjects.length} question${questionObjects.length === 1 ? "" : "s"} you got wrong.`,
  );
  await sendCurrentQuestion(ctx);
}

export async function cancelQuiz(ctx: BotContext) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  drafts.delete(key);
  if (!active) {
    await ctx.reply("No active quiz to cancel.");
    return;
  }

  activeQuizzes.delete(key);
  pendingReports.delete(reportKey(ctx));
  await advanceQuizSession(active.sessionId, active.currentIndex, true);
  await ctx.reply("🛑 Quiz cancelled.");
}

export async function showMyStats(ctx: BotContext) {
  const user = await ensureTelegramUser(ctx);
  if (!user) return;

  const [stats, totalPoints, mastery, badges] = await Promise.all([
    getPersonalStats(user.id),
    getTotalPointsForUser(user.id),
    getCategoryMasteryForUser(user.id),
    getUserBadges(user.id),
  ]);

  const rank = rankFromPoints(totalPoints);
  const badgeLine = badges.length ? `🏅 Badges: ${formatBadgeList(badges)}` : null;
  const masteryLines = mastery.slice(0, 6).map((cat) => {
    const pct = cat.answered ? Math.round((cat.correct / cat.answered) * 100) : 0;
    const filled = Math.round(pct / 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    return `${cat.categoryName}\n[${bar}] ${pct}% (${cat.correct}/${cat.answered})`;
  });

  const streakLine = stats.playStreak >= 2
    ? `🗓️ Daily streak: ${stats.playStreak} days`
    : stats.playStreak === 1
      ? `🗓️ Daily streak: 1 day — come back tomorrow to keep it going!`
      : null;

  await ctx.reply(
    [
      "📊 Your Stats",
      `🏅 Rank: ${rank}`,
      `⭐ Total points: ${formatPoints(totalPoints)}`,
      ...(badgeLine ? [badgeLine] : []),
      ...(streakLine ? [streakLine] : []),
      "",
      `Quizzes completed: ${stats.quizzesCompleted}`,
      `Questions answered: ${stats.questionsAnswered}`,
      `Correct answers: ${stats.correctAnswers}`,
      `Accuracy: ${stats.accuracy}%`,
      ...(masteryLines.length
        ? ["", "📚 Category Mastery:", ...masteryLines]
        : []),
    ].join("\n"),
  );
}

async function showCategoryStep(ctx: BotContext) {
  const categories = await listCategories();
  if (!categories.length) {
    await ctx.reply("📭 No active categories are available yet.");
    return;
  }

  await ctx.reply("📚 Choose a category:", {
    reply_markup: categoriesKeyboard(categories as Category[]),
  });
}

function baseDraft(ctx: BotContext): DraftQuiz {
  return {
    creatorTelegramUserId: ctx.from?.id ?? 0,
    playMode: "individual",
    teamNames: [],
    teamMembers: {},
  };
}

async function showTeamLobby(ctx: BotContext) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (!draft || draft.playMode !== "teams" || !draft.teamJoinMode) return;

  await ctx.reply(
    [
      "🎮 Team lobby is open.",
      draft.teamJoinMode === "auto_balance"
        ? "⚖️ Players can join and will be auto-assigned."
        : "✋ Players can choose a team.",
      "",
      formatTeams(draft.teamMembers, draft.teamNames),
    ].join("\n"),
    { reply_markup: teamLobbyKeyboard(draft.teamNames, draft.teamJoinMode) },
  );
}

async function startConfiguredQuiz(ctx: BotContext) {
  const key = requireKey(ctx);
  const user = await ensureTelegramUser(ctx);
  if (!user || !ctx.from) {
    await ctx.reply(
      "👤 I couldn't identify your account. Please send /start and try again.",
    );
    return;
  }

  const group = await ensureTelegramGroup(ctx);
  const draft = drafts.get(key) ?? baseDraft(ctx);
  const requestedQuestions = draft.count ?? 5;
  const totalQuestions =
    draft.playMode === "teams"
      ? requestedQuestions * draft.teamNames.length
      : requestedQuestions;
  const selectedQuestions = await listQuestionsForQuiz({
    categoryId: draft.categoryId,
    questionType: draft.questionType,
    limit: totalQuestions,
  });

  if (selectedQuestions.length < totalQuestions) {
    const unit =
      draft.playMode === "teams" ? ` (${requestedQuestions} per team)` : "";
    await ctx.reply(
      `📭 Only ${selectedQuestions.length} matching questions are available. This quiz needs ${totalQuestions}${unit}. Try another category or question type.`,
    );
    return;
  }

  await cancelActiveQuizForUser(user.id);
  const session = await createQuizSession({
    userId: user.id,
    groupId: group?.id ?? null,
    categoryId: draft.categoryId,
    questionType: draft.questionType,
    playMode: draft.playMode,
    teamNames: draft.teamNames,
    teamJoinMode: draft.teamJoinMode ?? null,
    teamMembers: draft.teamMembers,
    totalQuestions,
    questionIds: selectedQuestions.map((question) => question.id),
    mode: group ? "group" : "private",
  });

  activeQuizzes.set(key, {
    sessionId: session.id,
    userId: user.id,
    starterTelegramUserId: draft.creatorTelegramUserId || ctx.from.id,
    playMode: draft.playMode,
    teamNames: draft.teamNames,
    teamMembers: draft.teamMembers,
    answeredUserIds: new Set(),
    hintedQuestionIndexes: new Set(),
    currentTeamIndex: 0,
    categoryId: draft.categoryId,
    questionType: draft.questionType,
    totalQuestions,
    currentIndex: 0,
    questionStartedAt: new Date(),
    correctStreak: 0,
    fastAnswerCount: 0,
    wrongAnswerCount: 0,
  });
  drafts.delete(key);

  await ctx.reply(
    draft.playMode === "teams"
      ? `🚀 Quiz started. Each team gets ${requestedQuestions} questions.`
      : "🚀 Quiz started.",
  );
  await sendCurrentQuestion(ctx);
}

async function resolveAnswerer(ctx: BotContext, active: ActiveQuiz) {
  const user = await ensureTelegramUser(ctx);
  if (!user || !ctx.from)
    return { allowed: false as const, reason: "Unable to identify user." };

  if (
    active.playMode === "individual" &&
    ctx.from.id !== active.starterTelegramUserId
  ) {
    return {
      allowed: false as const,
      reason: "Only the quiz creator can answer this quiz.",
    };
  }

  if (active.playMode === "teams") {
    const member = active.teamMembers[ctx.from.id];
    if (!member)
      return {
        allowed: false as const,
        reason: "Join a team before answering.",
      };
    const teamTurn = currentTeam(active);
    if (member.teamName !== teamTurn)
      return { allowed: false as const, reason: `It is ${teamTurn}'s turn.` };
    return {
      allowed: true as const,
      userId: user.id,
      teamName: member.teamName,
    };
  }

  return { allowed: true as const, userId: user.id, teamName: null };
}

async function moveNext(ctx: BotContext, active: ActiveQuiz) {
  const nextIndex = active.currentIndex + 1;
  if (nextIndex >= active.totalQuestions) {
    await finishQuiz(ctx);
    return;
  }

  active.currentIndex = nextIndex;
  active.answeredUserIds = new Set();
  if (active.playMode === "teams" && active.teamNames.length) {
    active.currentTeamIndex =
      (active.currentTeamIndex + 1) % active.teamNames.length;
  }
  await advanceQuizSession(active.sessionId, nextIndex);
  await sendCurrentQuestion(ctx);
}

async function finishQuiz(ctx: BotContext) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) return;

  await advanceQuizSession(active.sessionId, active.totalQuestions, true);
  activeQuizzes.delete(key);

  if (active.playMode === "teams") {
    const scores = await getTeamScores(active.sessionId);
    await sendCelebrationForTeamWinner(ctx, active, scores);
    await ctx.reply(
      [
        "🏁 Quiz complete.",
        "",
        "👥 Team scores:",
        ...scores.map(
          (score, index) =>
            `${index + 1}. ${score.teamName ?? "Unknown"} - ${formatPoints(score.points)} pts`,
        ),
      ].join("\n"),
    );
    return;
  }

  if (active.playMode === "free_form") {
    const scores = await getSessionParticipantScores(active.sessionId);
    await sendCelebrationForPlayerWinner(ctx, scores);
    await ctx.reply(
      [
        "🏁 Quiz complete.",
        "",
        "🙋 Player scores:",
        ...scores.map(
          (score, index) =>
            `${index + 1}. ${displayScoreName(score)} - ${formatPoints(score.points)} pts`,
        ),
      ].join("\n"),
    );
    return;
  }

  const [score, newStreak, wrongIds, stats, mastery, totalPoints] = await Promise.all([
    getQuizScore(active.sessionId),
    updatePlayStreak(active.userId),
    getWrongQuestionIds(active.sessionId, active.userId),
    getPersonalStats(active.userId),
    getCategoryMasteryForUser(active.userId),
    getTotalPointsForUser(active.userId),
  ]);
  const accuracy = active.totalQuestions
    ? Math.round((score.correct / active.totalQuestions) * 100)
    : 0;

  const newBadges = await checkAndAwardBadges(active.userId, {
    correct: score.correct,
    answered: active.totalQuestions,
    playStreak: newStreak,
    fastAnswerCount: active.fastAnswerCount,
    totalQuestionsAnswered: stats.questionsAnswered,
    accuracy: stats.accuracy,
    categoriesAnswered: mastery.length,
  });

  await sendCelebrationForSinglePlayer(ctx, active, score.correct, active.totalQuestions);

  const streakLine = newStreak >= 2 ? `🗓️ ${newStreak}-day streak! Keep it up!` : null;
  const summaryLines = [
    "🏁 Quiz Complete!",
    "",
    `Score: ${score.correct}/${active.totalQuestions}`,
    `Accuracy: ${accuracy}%`,
    ...(streakLine ? [streakLine] : []),
    "",
    "─────────────────",
    "✈️ Aviation Quiz Result",
    `📊 ${score.correct}/${active.totalQuestions} | ${accuracy}% accuracy`,
    `🏅 Rank: ${rankFromPoints(totalPoints)}`,
    "─────────────────",
  ];

  if (wrongIds.length > 0) {
    await ctx.reply(summaryLines.join("\n"), {
      reply_markup: retryWrongKeyboard(active.sessionId),
    });
  } else {
    summaryLines.push("", "Perfect score! Use /quiz to try another topic.");
    await ctx.reply(summaryLines.join("\n"));
  }

  for (const badge of newBadges) {
    await ctx.reply(formatBadgeAnnouncement(badge));
  }
}

async function sendCelebrationForSinglePlayer(
  ctx: BotContext,
  active: ActiveQuiz,
  correct: number,
  total: number,
) {
  await sendCelebrationBurst(ctx);
  const points = formatPoints(correct);
  const ratio = total > 0 ? correct / total : 0;
  const headline = celebrationHeadline(ratio);
  const mvpLine = celebrationMvpLine(ratio);
  const caption = [
    headline,
    "",
    `🏆 Winner: ${displayName(ctx)}`,
    `⭐ Final score: ${points}/${total}`,
    mvpLine,
    "",
    "Amazing flying, Captain! ✈️",
  ].join("\n");
  await sendWinnerPhotoCard(ctx, active.starterTelegramUserId, caption);
}

async function sendCelebrationForPlayerWinner(
  ctx: BotContext,
  scores: Array<{
    telegramUserId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    points: number;
  }>,
) {
  if (!scores.length) return;
  await sendCelebrationBurst(ctx);
  const winner = scores[0]!;
  const winnerName = displayScoreName(winner);
  const podium = buildPodiumLines(
    scores.map((score) => ({
      label: displayScoreName(score),
      points: score.points,
    })),
  );
  const winnerPoints = winner.points;
  const secondPoints = scores[1]?.points ?? 0;
  const gap = winnerPoints - secondPoints;
  const mvpLine =
    gap >= 3
      ? "🔥 MVP performance with a commanding lead!"
      : "💪 MVP performance under pressure!";
  const caption = [
    "🎉🎊 CHAMPION CROWNED! 🎊🎉",
    "",
    `🏆 Winner: ${winnerName}`,
    `⭐ Final score: ${formatPoints(winnerPoints)} pts`,
    mvpLine,
    "",
    "🥇🥈🥉 Podium:",
    ...podium,
    "",
    "Brilliant performance! ✈️",
  ].join("\n");
  await sendWinnerPhotoCard(ctx, Number(winner.telegramUserId), caption);
}

async function sendCelebrationForTeamWinner(
  ctx: BotContext,
  active: ActiveQuiz,
  scores: Array<{ teamName: string | null; points: number }>,
) {
  if (!scores.length) return;
  await sendCelebrationBurst(ctx);
  const winner = scores[0]!;
  const winnerTeamName = winner.teamName ?? "Unknown Team";
  const podium = buildPodiumLines(
    scores.map((score) => ({
      label: score.teamName ?? "Unknown Team",
      points: score.points,
    })),
  );
  const winnerPoints = winner.points;
  const secondPoints = scores[1]?.points ?? 0;
  const gap = winnerPoints - secondPoints;
  const mvpLine =
    gap >= 3
      ? "🔥 Team MVP energy all the way to the finish!"
      : "💪 Team MVP grind secured the win!";
  const representative = Object.values(active.teamMembers).find(
    (member) => member.teamName === winnerTeamName,
  );
  const caption = [
    "🎉🎊 TEAM VICTORY! 🎊🎉",
    "",
    `🏆 Winning Team: ${winnerTeamName}`,
    `⭐ Final score: ${formatPoints(winnerPoints)} pts`,
    mvpLine,
    representative ? `🙌 Team rep: ${representative.displayName}` : "",
    "",
    "🥇🥈🥉 Podium:",
    ...podium,
    "",
    "What a finish! ✈️",
  ]
    .filter(Boolean)
    .join("\n");
  await sendWinnerPhotoCard(ctx, representative?.telegramUserId, caption);
}

async function sendWinnerPhotoCard(
  ctx: BotContext,
  telegramUserId: number | undefined,
  caption: string,
) {
  if (!telegramUserId || !ctx.chat?.id) {
    await ctx.reply(caption);
    return;
  }

  try {
    const photos = await ctx.api.getUserProfilePhotos(telegramUserId, {
      limit: 1,
    });
    const bestPhoto = photos.photos[0]?.[photos.photos[0].length - 1];
    if (bestPhoto) {
      await ctx.api.sendPhoto(ctx.chat.id, bestPhoto.file_id, { caption });
      return;
    }
  } catch (error) {
    console.error("Unable to load winner profile photo", error);
  }

  await ctx.reply(caption);
}

async function sendCelebrationBurst(ctx: BotContext) {
  try {
    await ctx.replyWithDice("🎯");
  } catch {
    // Ignore animation failures and continue with celebration.
  }
  await ctx.reply("🎉🎉🎉 Let the celebration begin! 🎉🎉🎉");
}

function smallestTeam(draft: DraftQuiz) {
  return draft.teamNames
    .map((teamName) => ({
      teamName,
      count: Object.values(draft.teamMembers).filter(
        (member) => member.teamName === teamName,
      ).length,
    }))
    .sort((a, b) => a.count - b.count)[0]?.teamName;
}

function currentTeam(active: ActiveQuiz) {
  return active.teamNames[
    active.currentTeamIndex % Math.max(active.teamNames.length, 1)
  ];
}

function reportKey(ctx: BotContext) {
  return `${ctx.chat?.id ?? "private"}:${ctx.from?.id ?? "unknown"}`;
}

function buildHint(
  correctAnswer: string | null,
  questionType: "multiple_choice" | "short_answer",
  options: Array<{ optionText: string }>,
) {
  if (!correctAnswer) return "💡 Hint: No hint is available for this question.";
  const trimmed = correctAnswer.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const firstLetter = trimmed[0]?.toUpperCase() ?? "?";

  if (questionType === "multiple_choice") {
    return `💡 Hint: The correct option starts with "${firstLetter}". There are ${options.length} options.`;
  }

  const shape = words
    .map(
      (word) =>
        `${word[0]?.toUpperCase() ?? "?"}${"_".repeat(Math.max(word.length - 1, 0))}`,
    )
    .join(" ");
  return `💡 Hint: ${words.length} word${words.length === 1 ? "" : "s"}, starts with "${firstLetter}".\n${shape}`;
}

function parseOptionIndex(
  answerText: string,
  options: Array<{ optionText: string }>,
) {
  const normalized = answerText.trim().toLowerCase();
  if (!normalized) return null;

  const letterMatch = normalized.match(/^([a-z])(?:[).:\s]|$)/);
  if (letterMatch) {
    const index = letterMatch[1]!.charCodeAt(0) - "a".charCodeAt(0);
    if (index >= 0 && index < options.length) return index;
  }

  const numberMatch = normalized.match(/^(\d+)(?:[).:\s]|$)/);
  if (numberMatch) {
    const index = Number(numberMatch[1]) - 1;
    if (index >= 0 && index < options.length) return index;
  }

  const exactIndex = options.findIndex(
    (option) => option.optionText.trim().toLowerCase() === normalized,
  );
  return exactIndex >= 0 ? exactIndex : null;
}

function formatTeams(
  teamMembers: Record<number, TeamMember>,
  teamNames: string[],
) {
  return teamNames
    .map((teamName) => {
      const members = Object.values(teamMembers)
        .filter((member) => member.teamName === teamName)
        .map((member) => member.displayName);
      return `👥 ${teamName}: ${members.length ? members.join(", ") : "No players yet"}`;
    })
    .join("\n");
}

function answerPoints(active: ActiveQuiz, isCorrect: boolean): { points: number; elapsedSeconds: number } {
  const elapsedSeconds = Math.round((Date.now() - active.questionStartedAt.getTime()) / 1000);
  if (!isCorrect) return { points: 0, elapsedSeconds };

  const hinted = active.hintedQuestionIndexes.has(active.currentIndex);
  const basePoints = elapsedSeconds <= 10 ? 3 : elapsedSeconds <= 25 ? 2 : 1;
  return { points: hinted ? basePoints * 0.5 : basePoints, elapsedSeconds };
}

function progressBar(current: number, total: number): string {
  const filled = Math.round((current / total) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function streakMessage(streak: number): string | null {
  if (streak === 3) return "🔥 3 in a row!";
  if (streak === 5) return "🔥🔥 5 in a row! You're on fire!";
  if (streak === 10) return "🔥🔥🔥 10 in a row! Unstoppable!";
  if (streak > 10 && streak % 5 === 0) return `🔥🔥🔥 ${streak} in a row! Legendary!`;
  return null;
}

function formatPoints(points: number) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

function formatFeedback(
  isCorrect: boolean,
  correctAnswer?: string | null,
  explanation?: string | null,
  pointsAwarded?: number,
  elapsedSeconds?: number,
) {
  const lines = [isCorrect ? "✅ Correct." : "❌ Not quite."];
  if (typeof pointsAwarded === "number") {
    const speedTag = elapsedSeconds !== undefined
      ? elapsedSeconds <= 10 ? " ⚡ Fast!" : elapsedSeconds <= 25 ? " 👍 Good" : ""
      : "";
    lines.push(`🏅 +${formatPoints(pointsAwarded)} pts${speedTag}`);
  }
  if (!isCorrect && correctAnswer)
    lines.push(`✅ Correct answer: ${correctAnswer}`);
  if (explanation) lines.push(`💡 ${explanation}`);
  return lines.join("\n\n");
}

function displayScoreName(row: {
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}) {
  return (
    [row.firstName, row.lastName].filter(Boolean).join(" ") ||
    (row.username ? `@${row.username}` : "Player")
  );
}

function celebrationHeadline(ratio: number) {
  if (ratio >= 0.9) return "🎉🎊 LEGENDARY WIN! 🎊🎉";
  if (ratio >= 0.75) return "🎉🎊 OUTSTANDING WIN! 🎊🎉";
  if (ratio >= 0.5) return "🎉🎊 GREAT WIN! 🎊🎉";
  return "🎉🎊 WIN SECURED! 🎊🎉";
}

function celebrationMvpLine(ratio: number) {
  if (ratio >= 0.9) return "👑 MVP level unlocked: Aviation Legend!";
  if (ratio >= 0.75) return "🏅 MVP level: Top-tier performance!";
  if (ratio >= 0.5) return "🥇 MVP level: Strong finish!";
  return "🥈 MVP level: Clutch finish!";
}

function buildPodiumLines(rows: Array<{ label: string; points: number }>) {
  const medals = ["🥇", "🥈", "🥉"];
  return rows
    .slice(0, 3)
    .map(
      (row, index) =>
        `${medals[index] ?? "🏅"} ${row.label} — ${formatPoints(row.points)} pts`,
    );
}
