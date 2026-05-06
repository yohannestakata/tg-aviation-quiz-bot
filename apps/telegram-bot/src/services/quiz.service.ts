import {
  advanceQuizSession,
  cancelActiveQuizForUser,
  createQuizSession,
  getPersonalStats,
  getQuizScore,
  getSessionParticipantScores,
  getSessionQuestion,
  getTeamScores,
  listCategories,
  listQuestionsForQuiz,
  recordAnswer,
  type Category,
  type QuestionOption
} from "@aviation/db";
import type { ActiveQuiz, BotContext, QuizPlayMode, TeamJoinMode, TeamMember } from "../types";
import {
  answerKeyboard,
  categoriesKeyboard,
  countKeyboard,
  playModeKeyboard,
  teamCountKeyboard,
  teamJoinModeKeyboard,
  teamLobbyKeyboard,
  typeKeyboard
} from "../keyboards/quiz.keyboards";
import { ensureTelegramGroup, ensureTelegramUser } from "./telegram-user.service";
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

function isGroupChat(ctx: BotContext) {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function isCreator(ctx: BotContext, draftOrActive: { creatorTelegramUserId?: number; starterTelegramUserId?: number }) {
  const creatorId = draftOrActive.creatorTelegramUserId ?? draftOrActive.starterTelegramUserId;
  return Boolean(ctx.from?.id && creatorId === ctx.from.id);
}

function displayName(ctx: BotContext) {
  const from = ctx.from;
  if (!from) return "Player";
  return [from.first_name, from.last_name].filter(Boolean).join(" ") || (from.username ? `@${from.username}` : "Player");
}

export async function showQuizCategories(ctx: BotContext) {
  if (!ctx.from) {
    await ctx.reply("👤 I need a Telegram user to start a quiz.");
    return;
  }

  const key = requireKey(ctx);
  if (isGroupChat(ctx)) {
    drafts.set(key, {
      creatorTelegramUserId: ctx.from.id,
      playMode: "individual",
      teamNames: [],
      teamMembers: {}
    });
    await ctx.reply("🎮 Choose how this group quiz should be played:", { reply_markup: playModeKeyboard() });
    return;
  }

  drafts.set(key, {
    creatorTelegramUserId: ctx.from.id,
    playMode: "individual",
    teamNames: [],
    teamMembers: {}
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
    await ctx.reply("👥 How many teams?", { reply_markup: teamCountKeyboard() });
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

  await ctx.reply("👥 How should players join teams?", { reply_markup: teamJoinModeKeyboard() });
  return true;
}

export async function setTeamJoinMode(ctx: BotContext, teamJoinMode: TeamJoinMode) {
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
      teamMembers: {}
    }),
    categoryId: categoryId === "mixed" ? undefined : categoryId
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

export async function setQuizTypeAndStart(ctx: BotContext, type: "multiple_choice" | "short_answer" | "mixed") {
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

  const teamName = target === "auto" ? smallestTeam(draft) : draft.teamNames[Number(target)];
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
      teamName
    }
  };
  drafts.set(key, { ...draft, teamMembers });

  await ctx.answerCallbackQuery(`Joined ${teamName}`);
  await ctx.reply(`✅ ${displayName(ctx)} joined ${teamName}.\n\n${formatTeams(teamMembers, draft.teamNames)}`);
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
  const question = await getSessionQuestion(active.sessionId, active.currentIndex);
  if (!question) {
    await finishQuiz(ctx);
    return;
  }

  const header = `✈️ Question ${active.currentIndex + 1} of ${active.totalQuestions}`;
  const audience =
    active.playMode === "teams"
      ? `👥 Team turn: ${currentTeam(active) ?? "Unknown"}`
      : active.playMode === "free_form"
        ? "🙋 Free Form: anyone can answer."
        : "👤 Individual: only the quiz creator can answer.";
  const text = `${header}\n${audience}\n\n${question.questionText}`;
  const replyMarkup = question.questionType === "multiple_choice" ? answerKeyboard(question.options) : undefined;

  if (question.imageUrl) {
    await ctx.replyWithPhoto(question.imageUrl, { caption: text, reply_markup: replyMarkup });
    return;
  }

  await ctx.reply(text, { reply_markup: replyMarkup });
}

export async function answerMultipleChoice(ctx: BotContext, optionIndex: number) {
  await recordMultipleChoiceSelection(ctx, optionIndex, "callback");
}

async function recordMultipleChoiceSelection(ctx: BotContext, optionIndex: number, source: "callback" | "message") {
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

  const question = await getSessionQuestion(active.sessionId, active.currentIndex);
  const selected = question?.options[optionIndex] as QuestionOption | undefined;
  if (!question || !selected) {
    if (source === "callback") await ctx.answerCallbackQuery("That answer is no longer available.");
    return;
  }

  if (active.answeredUserIds.has(ctx.from!.id)) {
    if (source === "callback") await ctx.answerCallbackQuery("Your answer is already recorded.");
    else await ctx.reply("Your answer is already recorded.");
    return;
  }

  const isCorrect = selected.isCorrect;
  await recordAnswer({
    quizSessionId: active.sessionId,
    questionId: question.id,
    userId: permission.userId,
    selectedOptionId: selected.id,
    answerText: selected.optionText,
    teamName: permission.teamName,
    isCorrect
  });

  active.answeredUserIds.add(ctx.from!.id);

  if (active.playMode === "teams") {
    if (source === "callback") await ctx.answerCallbackQuery(isCorrect ? "Correct" : "Not quite");
    await ctx.reply(`👥 ${permission.teamName} answered.\n\n${formatFeedback(isCorrect, question.correctAnswerText, question.explanation)}`);
    await moveNext(ctx, active);
    return;
  }

  if (source === "callback") await ctx.answerCallbackQuery(isCorrect ? "Correct" : "Not quite");
  await ctx.reply(formatFeedback(isCorrect, question.correctAnswerText, question.explanation));
  await moveNext(ctx, active);
}

export async function answerShortText(ctx: BotContext, answerText: string) {
  const key = requireKey(ctx);
  const active = activeQuizzes.get(key);
  if (!active) return false;

  const question = await getSessionQuestion(active.sessionId, active.currentIndex);
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

  const isCorrect = isShortAnswerCorrect(answerText, question.correctAnswerText, question.acceptedKeywords);
  await recordAnswer({
    quizSessionId: active.sessionId,
    questionId: question.id,
    userId: permission.userId,
    answerText,
    teamName: permission.teamName,
    isCorrect
  });

  active.answeredUserIds.add(ctx.from!.id);

  if (active.playMode === "teams") {
    await ctx.reply(`👥 ${permission.teamName} answered.\n\n${formatFeedback(isCorrect, question.correctAnswerText, question.explanation)}`);
    await moveNext(ctx, active);
    return true;
  }

  await ctx.reply(formatFeedback(isCorrect, question.correctAnswerText, question.explanation));
  await moveNext(ctx, active);
  return true;
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
  await advanceQuizSession(active.sessionId, active.currentIndex, true);
  await ctx.reply("🛑 Quiz cancelled.");
}

export async function showMyStats(ctx: BotContext) {
  const user = await ensureTelegramUser(ctx);
  if (!user) return;
  const stats = await getPersonalStats(user.id);
  await ctx.reply(
    [
      "📊 Your stats",
      `Quizzes completed: ${stats.quizzesCompleted}`,
      `Questions answered: ${stats.questionsAnswered}`,
      `Correct answers: ${stats.correctAnswers}`,
      `Accuracy: ${stats.accuracy}%`
    ].join("\n")
  );
}

async function showCategoryStep(ctx: BotContext) {
  const categories = await listCategories();
  if (!categories.length) {
    await ctx.reply("📭 No active categories are available yet.");
    return;
  }

  await ctx.reply("📚 Choose a category:", { reply_markup: categoriesKeyboard(categories as Category[]) });
}

function baseDraft(ctx: BotContext): DraftQuiz {
  return {
    creatorTelegramUserId: ctx.from?.id ?? 0,
    playMode: "individual",
    teamNames: [],
    teamMembers: {}
  };
}

async function showTeamLobby(ctx: BotContext) {
  const key = requireKey(ctx);
  const draft = drafts.get(key);
  if (!draft || draft.playMode !== "teams" || !draft.teamJoinMode) return;

  await ctx.reply(
    [
      "🎮 Team lobby is open.",
      draft.teamJoinMode === "auto_balance" ? "⚖️ Players can join and will be auto-assigned." : "✋ Players can choose a team.",
      "",
      formatTeams(draft.teamMembers, draft.teamNames)
    ].join("\n"),
    { reply_markup: teamLobbyKeyboard(draft.teamNames, draft.teamJoinMode) }
  );
}

async function startConfiguredQuiz(ctx: BotContext) {
  const key = requireKey(ctx);
  const user = await ensureTelegramUser(ctx);
  if (!user || !ctx.from) {
    await ctx.reply("👤 I need a Telegram user to start a quiz.");
    return;
  }

  const group = await ensureTelegramGroup(ctx);
  const draft = drafts.get(key) ?? baseDraft(ctx);
  const requestedQuestions = draft.count ?? 5;
  const totalQuestions = draft.playMode === "teams" ? requestedQuestions * draft.teamNames.length : requestedQuestions;
  const selectedQuestions = await listQuestionsForQuiz({
    categoryId: draft.categoryId,
    questionType: draft.questionType,
    limit: totalQuestions
  });

  if (selectedQuestions.length < totalQuestions) {
    const unit = draft.playMode === "teams" ? ` (${requestedQuestions} per team)` : "";
    await ctx.reply(`📭 Only ${selectedQuestions.length} matching questions are available. This quiz needs ${totalQuestions}${unit}. Try another category or question type.`);
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
    mode: group ? "group" : "private"
  });

  activeQuizzes.set(key, {
    sessionId: session.id,
    userId: user.id,
    starterTelegramUserId: draft.creatorTelegramUserId || ctx.from.id,
    playMode: draft.playMode,
    teamNames: draft.teamNames,
    teamMembers: draft.teamMembers,
    answeredUserIds: new Set(),
    currentTeamIndex: 0,
    categoryId: draft.categoryId,
    questionType: draft.questionType,
    totalQuestions,
    currentIndex: 0
  });
  drafts.delete(key);

  await ctx.reply(draft.playMode === "teams" ? `🚀 Quiz started. Each team gets ${requestedQuestions} questions.` : "🚀 Quiz started.");
  await sendCurrentQuestion(ctx);
}

async function resolveAnswerer(ctx: BotContext, active: ActiveQuiz) {
  const user = await ensureTelegramUser(ctx);
  if (!user || !ctx.from) return { allowed: false as const, reason: "Unable to identify user." };

  if (active.playMode === "individual" && ctx.from.id !== active.starterTelegramUserId) {
    return { allowed: false as const, reason: "Only the quiz creator can answer this quiz." };
  }

  if (active.playMode === "teams") {
    const member = active.teamMembers[ctx.from.id];
    if (!member) return { allowed: false as const, reason: "Join a team before answering." };
    const teamTurn = currentTeam(active);
    if (member.teamName !== teamTurn) return { allowed: false as const, reason: `It is ${teamTurn}'s turn.` };
    return { allowed: true as const, userId: user.id, teamName: member.teamName };
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
    active.currentTeamIndex = (active.currentTeamIndex + 1) % active.teamNames.length;
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
    await ctx.reply(["🏁 Quiz complete.", "", "👥 Team scores:", ...scores.map((score, index) => `${index + 1}. ${score.teamName ?? "Unknown"} - ${score.points} pts`)].join("\n"));
    return;
  }

  if (active.playMode === "free_form") {
    const scores = await getSessionParticipantScores(active.sessionId);
    await ctx.reply(["🏁 Quiz complete.", "", "🙋 Player scores:", ...scores.map((score, index) => `${index + 1}. ${displayScoreName(score)} - ${score.points} pts`)].join("\n"));
    return;
  }

  const score = await getQuizScore(active.sessionId);
  const accuracy = active.totalQuestions ? Math.round((score.correct / active.totalQuestions) * 100) : 0;
  await ctx.reply([`🏁 Quiz complete`, `Score: ${score.correct}/${active.totalQuestions}`, `Accuracy: ${accuracy}%`, "Use /quiz to practice again."].join("\n"));
}

function smallestTeam(draft: DraftQuiz) {
  return draft.teamNames
    .map((teamName) => ({
      teamName,
      count: Object.values(draft.teamMembers).filter((member) => member.teamName === teamName).length
    }))
    .sort((a, b) => a.count - b.count)[0]?.teamName;
}

function currentTeam(active: ActiveQuiz) {
  return active.teamNames[active.currentTeamIndex % Math.max(active.teamNames.length, 1)];
}

function parseOptionIndex(answerText: string, options: Array<{ optionText: string }>) {
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

  const exactIndex = options.findIndex((option) => option.optionText.trim().toLowerCase() === normalized);
  return exactIndex >= 0 ? exactIndex : null;
}

function formatTeams(teamMembers: Record<number, TeamMember>, teamNames: string[]) {
  return teamNames
    .map((teamName) => {
      const members = Object.values(teamMembers)
        .filter((member) => member.teamName === teamName)
        .map((member) => member.displayName);
      return `👥 ${teamName}: ${members.length ? members.join(", ") : "No players yet"}`;
    })
    .join("\n");
}

function formatFeedback(isCorrect: boolean, correctAnswer?: string | null, explanation?: string | null) {
  const lines = [isCorrect ? "✅ Correct." : "❌ Not quite."];
  if (!isCorrect && correctAnswer) lines.push(`✅ Correct answer: ${correctAnswer}`);
  if (explanation) lines.push(`💡 Explanation: ${explanation}`);
  return lines.join("\n\n");
}

function displayScoreName(row: { username: string | null; firstName: string | null; lastName: string | null }) {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || (row.username ? `@${row.username}` : "Player");
}
