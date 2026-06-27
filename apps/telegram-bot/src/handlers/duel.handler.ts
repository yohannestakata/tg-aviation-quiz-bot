import { randomUUID } from "crypto";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { findUserByTelegramId, listQuestionsForQuiz } from "@aviation/db";
import type { BotContext } from "../types";

type QuestionData = {
  id: string;
  questionText: string;
  options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
};

type DuelInvite = {
  duelId: string;
  challengerTgId: number;
  challengerName: string;
  targetTgId: number;
  targetName: string;
  groupChatId: number;
  inviteMessageId: number;
  questions: QuestionData[];
};

type RoundAnswer = {
  isCorrect: boolean;
  elapsedSeconds: number;
  points: number;
};

type DuelState = {
  duelId: string;
  challengerTgId: number;
  challengerName: string;
  targetTgId: number;
  targetName: string;
  groupChatId: number;
  questions: QuestionData[];
  currentIndex: number;
  scores: Record<number, number>;
  roundAnswers: Partial<Record<number, RoundAnswer>>;
  questionStartedAt: Date;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
};

const pendingInvites = new Map<string, DuelInvite>();
const activeDuels = new Map<string, DuelState>();
const userToDuelId = new Map<number, string>();

const DUEL_QUESTIONS = 5;
const QUESTION_TIMEOUT_MS = 30_000;
const INVITE_EXPIRY_MS = 5 * 60 * 1000;

function tgName(first?: string | null, last?: string | null, username?: string | null): string {
  return [first, last].filter(Boolean).join(" ") || (username ? `@${username}` : "Player");
}

function pointsForSpeed(elapsed: number): number {
  if (elapsed <= 10) return 3;
  if (elapsed <= 30) return 2;
  return 1;
}

function duelAnswerKeyboard(duelId: string, options: QuestionData["options"]): InlineKeyboard {
  const kb = new InlineKeyboard();
  options.forEach((opt, i) => kb.text(opt.optionText, `duel:answer:${duelId}:${i}`).row());
  return kb;
}

export function registerDuelHandlers(bot: Bot<BotContext>) {
  bot.command("duel", (ctx) => handleDuelCommand(ctx, bot));
  bot.callbackQuery(/^duel:accept:(.+)$/, (ctx) => handleDuelAccept(ctx, bot));
  bot.callbackQuery(/^duel:decline:(.+)$/, handleDuelDecline);
  bot.callbackQuery(/^duel:answer:([^:]+):(\d+)$/, (ctx) => handleDuelAnswer(ctx, bot));
}

async function handleDuelCommand(ctx: BotContext, bot: Bot<BotContext>) {
  const chat = ctx.chat;
  if (!chat || chat.type === "private") {
    await ctx.reply("Use /duel in a group by replying to another player's message.");
    return;
  }
  if (!ctx.from) return;

  const replyTarget = ctx.message?.reply_to_message?.from;
  if (!replyTarget) {
    await ctx.reply("Reply to someone's message and send /duel to challenge them.");
    return;
  }
  if (replyTarget.id === ctx.from.id) {
    await ctx.reply("You can't duel yourself.");
    return;
  }
  if (replyTarget.is_bot) {
    await ctx.reply("You can't challenge a bot.");
    return;
  }
  if (userToDuelId.has(ctx.from.id)) {
    await ctx.reply("You're already in an active duel!");
    return;
  }
  if (userToDuelId.has(replyTarget.id)) {
    await ctx.reply("That player is already in a duel.");
    return;
  }

  const targetUser = await findUserByTelegramId(String(replyTarget.id));
  if (!targetUser) {
    const name = tgName(replyTarget.first_name, replyTarget.last_name, replyTarget.username);
    await ctx.reply(`${name} hasn't started the bot yet — ask them to send /start first.`);
    return;
  }

  const rawQuestions = await listQuestionsForQuiz({ questionType: "multiple_choice", limit: DUEL_QUESTIONS });
  if (rawQuestions.length < DUEL_QUESTIONS) {
    await ctx.reply("Not enough questions available right now. Try again later.");
    return;
  }

  const questions: QuestionData[] = rawQuestions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    options: q.options.map((o) => ({ id: o.id, optionText: o.optionText, isCorrect: o.isCorrect })),
  }));

  const duelId = randomUUID();
  const challengerName = tgName(ctx.from.first_name, ctx.from.last_name, ctx.from.username);
  const targetName = tgName(replyTarget.first_name, replyTarget.last_name, replyTarget.username);

  const sent = await ctx.reply(
    `⚔️ ${challengerName} challenges ${targetName} to a duel!\n\n${DUEL_QUESTIONS} questions · fastest correct answers win\n\n${targetName}, do you accept?`,
    {
      reply_markup: new InlineKeyboard()
        .text("⚔️ Accept", `duel:accept:${duelId}`)
        .text("❌ Decline", `duel:decline:${duelId}`),
    },
  );

  pendingInvites.set(duelId, {
    duelId,
    challengerTgId: ctx.from.id,
    challengerName,
    targetTgId: replyTarget.id,
    targetName,
    groupChatId: chat.id,
    inviteMessageId: sent.message_id,
    questions,
  });

  setTimeout(() => {
    if (!pendingInvites.has(duelId)) return;
    pendingInvites.delete(duelId);
    bot.api
      .editMessageText(chat.id, sent.message_id, "⚔️ Duel challenge expired.")
      .catch(() => {});
  }, INVITE_EXPIRY_MS);
}

async function handleDuelAccept(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const invite = pendingInvites.get(duelId);

  if (!invite) {
    await ctx.answerCallbackQuery("This invite has expired.");
    return;
  }
  if (ctx.from.id !== invite.targetTgId) {
    await ctx.answerCallbackQuery("This challenge isn't for you.");
    return;
  }

  await ctx.answerCallbackQuery("Duel accepted! Check your DMs.");
  pendingInvites.delete(duelId);

  await ctx.editMessageText(
    `⚔️ ${invite.challengerName} vs ${invite.targetName} — Duel accepted! Check your DMs.`,
  ).catch(() => {});

  const duel: DuelState = {
    duelId,
    challengerTgId: invite.challengerTgId,
    challengerName: invite.challengerName,
    targetTgId: invite.targetTgId,
    targetName: invite.targetName,
    groupChatId: invite.groupChatId,
    questions: invite.questions,
    currentIndex: 0,
    scores: { [invite.challengerTgId]: 0, [invite.targetTgId]: 0 },
    roundAnswers: {},
    questionStartedAt: new Date(),
    timeoutHandle: null,
  };

  activeDuels.set(duelId, duel);
  userToDuelId.set(invite.challengerTgId, duelId);
  userToDuelId.set(invite.targetTgId, duelId);

  // Try to DM both — if either fails, the user hasn't started the bot in private
  const [cOk, tOk] = await Promise.all([
    bot.api.sendMessage(invite.challengerTgId, `⚔️ Duel vs ${invite.targetName} starting! Get ready…`).then(() => true).catch(() => false),
    bot.api.sendMessage(invite.targetTgId, `⚔️ Duel vs ${invite.challengerName} starting! Get ready…`).then(() => true).catch(() => false),
  ]);

  if (!cOk || !tOk) {
    activeDuels.delete(duelId);
    userToDuelId.delete(invite.challengerTgId);
    userToDuelId.delete(invite.targetTgId);
    const who = !cOk ? invite.challengerName : invite.targetName;
    await bot.api
      .sendMessage(invite.groupChatId, `⚔️ Duel cancelled — couldn't DM ${who}. Ask them to start the bot in private first.`)
      .catch(() => {});
    return;
  }

  await sendDuelQuestion(bot, duel);
}

async function handleDuelDecline(ctx: BotContext) {
  if (!ctx.from) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const invite = pendingInvites.get(duelId);
  if (!invite) { await ctx.answerCallbackQuery(); return; }

  if (ctx.from.id !== invite.targetTgId) {
    await ctx.answerCallbackQuery("This challenge isn't for you.");
    return;
  }

  await ctx.answerCallbackQuery("Declined.");
  pendingInvites.delete(duelId);
  await ctx.editMessageText(`⚔️ ${invite.targetName} declined the duel.`).catch(() => {});
}

async function handleDuelAnswer(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const optionIndex = Number(ctx.match[2]);
  const duel = activeDuels.get(duelId);

  if (!duel) { await ctx.answerCallbackQuery("This duel is no longer active."); return; }
  if (ctx.from.id !== duel.challengerTgId && ctx.from.id !== duel.targetTgId) {
    await ctx.answerCallbackQuery();
    return;
  }
  if (duel.roundAnswers[ctx.from.id] !== undefined) {
    await ctx.answerCallbackQuery("You already answered this question!");
    return;
  }

  const q = duel.questions[duel.currentIndex]!;
  const selected = q.options[optionIndex];
  if (!selected) { await ctx.answerCallbackQuery(); return; }

  const elapsed = Math.round((Date.now() - duel.questionStartedAt.getTime()) / 1000);
  const isCorrect = selected.isCorrect;
  const points = isCorrect ? pointsForSpeed(elapsed) : 0;

  duel.roundAnswers[ctx.from.id] = { isCorrect, elapsedSeconds: elapsed, points };
  if (isCorrect) duel.scores[ctx.from.id] = (duel.scores[ctx.from.id] ?? 0) + points;

  await ctx.answerCallbackQuery(isCorrect ? `✅ Correct! +${points} pts` : "❌ Wrong.");
  // Remove buttons so they can't answer again
  await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => {});

  const bothAnswered =
    duel.roundAnswers[duel.challengerTgId] !== undefined &&
    duel.roundAnswers[duel.targetTgId] !== undefined;

  if (bothAnswered) {
    if (duel.timeoutHandle) { clearTimeout(duel.timeoutHandle); duel.timeoutHandle = null; }
    await processRound(bot, duel);
  }
}

async function sendDuelQuestion(bot: Bot<BotContext>, duel: DuelState) {
  const q = duel.questions[duel.currentIndex]!;
  duel.roundAnswers = {};
  duel.questionStartedAt = new Date();

  const header = `⚔️ Question ${duel.currentIndex + 1} / ${duel.questions.length}`;
  const text = `${header}\n\n${q.questionText}`;
  const keyboard = duelAnswerKeyboard(duel.duelId, q.options);

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, text, { reply_markup: keyboard }).catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, text, { reply_markup: keyboard }).catch(() => {}),
  ]);

  duel.timeoutHandle = setTimeout(async () => {
    const current = activeDuels.get(duel.duelId);
    if (!current) return;
    for (const tgId of [duel.challengerTgId, duel.targetTgId]) {
      if (current.roundAnswers[tgId] === undefined) {
        current.roundAnswers[tgId] = { isCorrect: false, elapsedSeconds: QUESTION_TIMEOUT_MS / 1000, points: 0 };
        await bot.api.sendMessage(tgId, "⏱️ Time's up for that question!").catch(() => {});
      }
    }
    await processRound(bot, current);
  }, QUESTION_TIMEOUT_MS);
}

async function processRound(bot: Bot<BotContext>, duel: DuelState) {
  const q = duel.questions[duel.currentIndex]!;
  const correctOption = q.options.find((o) => o.isCorrect);
  const cAns = duel.roundAnswers[duel.challengerTgId];
  const tAns = duel.roundAnswers[duel.targetTgId];

  const cScore = duel.scores[duel.challengerTgId] ?? 0;
  const tScore = duel.scores[duel.targetTgId] ?? 0;

  const roundSummary = [
    `📊 Q${duel.currentIndex + 1} result`,
    `${cAns?.isCorrect ? "✅" : "❌"} ${duel.challengerName}: ${cAns?.elapsedSeconds ?? "—"}s${cAns?.isCorrect ? ` +${cAns.points}` : ""}`,
    `${tAns?.isCorrect ? "✅" : "❌"} ${duel.targetName}: ${tAns?.elapsedSeconds ?? "—"}s${tAns?.isCorrect ? ` +${tAns.points}` : ""}`,
    correctOption ? `✅ ${correctOption.optionText}` : "",
    "",
    `Score: ${duel.challengerName} ${cScore} – ${tScore} ${duel.targetName}`,
  ].filter((l) => l !== undefined).join("\n");

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, roundSummary).catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, roundSummary).catch(() => {}),
  ]);

  duel.currentIndex++;

  if (duel.currentIndex < duel.questions.length) {
    await new Promise<void>((r) => setTimeout(r, 1500));
    await sendDuelQuestion(bot, duel);
  } else {
    await finishDuel(bot, duel);
  }
}

async function finishDuel(bot: Bot<BotContext>, duel: DuelState) {
  activeDuels.delete(duel.duelId);
  userToDuelId.delete(duel.challengerTgId);
  userToDuelId.delete(duel.targetTgId);

  const cScore = duel.scores[duel.challengerTgId] ?? 0;
  const tScore = duel.scores[duel.targetTgId] ?? 0;

  let winnerLine: string;
  let winnerTgId: number | null = null;
  if (cScore > tScore) { winnerLine = `🏆 ${duel.challengerName} wins!`; winnerTgId = duel.challengerTgId; }
  else if (tScore > cScore) { winnerLine = `🏆 ${duel.targetName} wins!`; winnerTgId = duel.targetTgId; }
  else winnerLine = "🤝 It's a tie!";

  const groupAnnouncement = [
    `⚔️ Duel: ${duel.challengerName} vs ${duel.targetName}`,
    "",
    winnerLine,
    `${duel.challengerName}: ${cScore} pts`,
    `${duel.targetName}: ${tScore} pts`,
  ].join("\n");

  await Promise.all([
    bot.api.sendMessage(
      duel.challengerTgId,
      `⚔️ Duel over!\n\n${winnerLine}\nYour score: ${cScore} pts` + (winnerTgId === duel.challengerTgId ? " 🏆" : ""),
    ).catch(() => {}),
    bot.api.sendMessage(
      duel.targetTgId,
      `⚔️ Duel over!\n\n${winnerLine}\nYour score: ${tScore} pts` + (winnerTgId === duel.targetTgId ? " 🏆" : ""),
    ).catch(() => {}),
    bot.api.sendMessage(duel.groupChatId, groupAnnouncement).catch(() => {}),
  ]);
}
