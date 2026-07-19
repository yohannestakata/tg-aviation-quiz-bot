import { randomUUID } from "crypto";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { findUserByTelegramId, listQuestionsForQuiz } from "@aviation/db";
import type { BotContext } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

type QuestionData = {
  id: string;
  questionText: string;
  options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
};

type DuelSetup = {
  duelId: string;
  challengerTgId: number;
  challengerName: string;
  targetTgId: number;
  targetName: string;
  groupChatId: number;
  setupMessageId: number;
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
  correctCount: Record<number, number>;
  fastestSecs: Partial<Record<number, number>>;
};

// ── State ─────────────────────────────────────────────────────────────────────

const pendingSetups = new Map<string, DuelSetup>();
const pendingInvites = new Map<string, DuelInvite>();
const activeDuels = new Map<string, DuelState>();
const userToDuelId = new Map<number, string>();
const usersInSetup = new Set<number>();

// ── Constants ─────────────────────────────────────────────────────────────────

const COUNT_OPTIONS = [5, 10, 15, 20, 30] as const;
const QUESTION_TIMEOUT_MS = 60_000;
const INVITE_EXPIRY_MS = 5 * 60 * 1000;
const SETUP_EXPIRY_MS = 2 * 60 * 1000;

// ── Utilities ─────────────────────────────────────────────────────────────────

function tgName(first?: string | null, last?: string | null, username?: string | null): string {
  return [first, last].filter(Boolean).join(" ") || (username ? `@${username}` : "Player");
}

function shortName(full: string): string {
  return full.split(" ")[0]!.slice(0, 12);
}

function pointsForSpeed(elapsed: number): number {
  if (elapsed <= 10) return 3;
  if (elapsed <= 30) return 2;
  return 1;
}

function formatPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function scoreBar(cScore: number, tScore: number): string {
  const total = cScore + tScore;
  const W = 10;
  const cFill = total === 0 ? W / 2 : Math.round((cScore / total) * W);
  return "▓".repeat(Math.round(cFill)) + "░".repeat(W - Math.round(cFill));
}

function commentary(
  cName: string, cScore: number,
  tName: string, tScore: number,
  questionsLeft: number,
): string {
  const diff = cScore - tScore;
  const abs = Math.abs(diff);
  const leader = diff > 0 ? shortName(cName) : shortName(tName);
  const trailer = diff > 0 ? shortName(tName) : shortName(cName);

  if (questionsLeft === 0) return "";
  if (questionsLeft === 1) {
    if (diff === 0) return "🔥 Final question — winner takes all!";
    return `🎯 ${trailer} needs ${abs + 1}+ pts — ${leader} just has to hold on!`;
  }
  if (diff === 0) return questionsLeft <= 3 ? "⚖️ Perfectly level — going to the wire!" : "⚖️ All square!";
  if (abs >= 9) return `🏇 ${leader} is running away with it!`;
  if (abs >= 6) return `📈 ${leader} has a commanding lead`;
  if (questionsLeft <= 3) return `🎯 ${trailer} needs to dig deep!`;
  if (abs <= 2) return `🔥 ${leader} just noses ahead!`;
  return `💪 ${leader} building momentum`;
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function countKeyboard(duelId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  COUNT_OPTIONS.forEach((n) => kb.text(`${n} qs`, `duel:count:${duelId}:${n}`));
  return kb;
}

function inviteKeyboard(duelId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("⚔️ Accept", `duel:accept:${duelId}`)
    .text("❌ Decline", `duel:decline:${duelId}`);
}

function answerKeyboard(duelId: string, options: QuestionData["options"]): InlineKeyboard {
  const kb = new InlineKeyboard();
  options.forEach((opt, i) => kb.text(opt.optionText, `duel:answer:${duelId}:${i}`).row());
  return kb;
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerDuelHandlers(bot: Bot<BotContext>) {
  bot.command("duel", (ctx) => handleDuelCommand(ctx, bot));
  bot.callbackQuery(/^duel:count:([^:]+):(\d+)$/, (ctx) => handleDuelCount(ctx, bot));
  bot.callbackQuery(/^duel:accept:(.+)$/, (ctx) => handleDuelAccept(ctx, bot));
  bot.callbackQuery(/^duel:decline:(.+)$/, handleDuelDecline);
  bot.callbackQuery(/^duel:answer:([^:]+):(\d+)$/, (ctx) => handleDuelAnswer(ctx, bot));
}

// ── Command: /duel ────────────────────────────────────────────────────────────

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
  if (replyTarget.id === ctx.from.id) { await ctx.reply("You can't duel yourself."); return; }
  if (replyTarget.is_bot) { await ctx.reply("You can't challenge a bot."); return; }

  if (userToDuelId.has(ctx.from.id) || usersInSetup.has(ctx.from.id)) {
    await ctx.reply("You're already in a duel or setting one up!");
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

  const duelId = randomUUID();
  const challengerName = tgName(ctx.from.first_name, ctx.from.last_name, ctx.from.username);
  const targetName = tgName(replyTarget.first_name, replyTarget.last_name, replyTarget.username);

  const sent = await ctx.reply(
    `⚔️ ${challengerName} wants to duel ${targetName}!\n\n${shortName(challengerName)}, choose how many questions:`,
    { reply_markup: countKeyboard(duelId) },
  );

  pendingSetups.set(duelId, {
    duelId,
    challengerTgId: ctx.from.id,
    challengerName,
    targetTgId: replyTarget.id,
    targetName,
    groupChatId: chat.id,
    setupMessageId: sent.message_id,
  });
  usersInSetup.add(ctx.from.id);

  setTimeout(() => {
    const setup = pendingSetups.get(duelId);
    if (!setup) return;
    pendingSetups.delete(duelId);
    usersInSetup.delete(setup.challengerTgId);
    bot.api.editMessageText(chat.id, sent.message_id, "⚔️ Duel setup timed out.").catch(() => {});
  }, SETUP_EXPIRY_MS);
}

// ── Count selection ───────────────────────────────────────────────────────────

async function handleDuelCount(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const count = Number(ctx.match[2]);
  const setup = pendingSetups.get(duelId);

  if (!setup) { await ctx.answerCallbackQuery("This setup has expired."); return; }
  if (ctx.from.id !== setup.challengerTgId) {
    await ctx.answerCallbackQuery("Only the challenger can choose the question count.");
    return;
  }

  pendingSetups.delete(duelId);
  usersInSetup.delete(setup.challengerTgId);

  const rawQuestions = await listQuestionsForQuiz({ questionType: "multiple_choice", limit: count });
  if (rawQuestions.length < count) {
    await ctx.answerCallbackQuery("Not enough questions available right now.");
    await ctx.editMessageText("⚔️ Not enough questions available. Try again later.").catch(() => {});
    return;
  }

  const questions: QuestionData[] = rawQuestions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    options: q.options.map((o) => ({ id: o.id, optionText: o.optionText, isCorrect: o.isCorrect })),
  }));

  await ctx.answerCallbackQuery(`${count} questions — let's go!`);

  const edited = await ctx.editMessageText(
    [
      `⚔️ ${setup.challengerName} challenges ${setup.targetName} to a duel!`,
      "",
      `📋 ${count} questions · speed scoring · fastest correct wins`,
      "",
      `${setup.targetName}, do you accept?`,
    ].join("\n"),
    { reply_markup: inviteKeyboard(duelId) },
  ).catch(() => null);

  pendingInvites.set(duelId, {
    duelId,
    challengerTgId: setup.challengerTgId,
    challengerName: setup.challengerName,
    targetTgId: setup.targetTgId,
    targetName: setup.targetName,
    groupChatId: setup.groupChatId,
    inviteMessageId: setup.setupMessageId,
    questions,
  });

  setTimeout(() => {
    if (!pendingInvites.has(duelId)) return;
    pendingInvites.delete(duelId);
    bot.api.editMessageText(
      setup.groupChatId,
      setup.setupMessageId,
      `⚔️ ${setup.challengerName} vs ${setup.targetName} — challenge expired.`,
    ).catch(() => {});
  }, INVITE_EXPIRY_MS);
}

// ── Accept / Decline ──────────────────────────────────────────────────────────

async function handleDuelAccept(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const invite = pendingInvites.get(duelId);

  if (!invite) { await ctx.answerCallbackQuery("This invite has expired."); return; }
  if (ctx.from.id !== invite.targetTgId) {
    await ctx.answerCallbackQuery("This challenge isn't for you.");
    return;
  }

  await ctx.answerCallbackQuery("Duel accepted! Check your DMs ⚔️");
  pendingInvites.delete(duelId);

  await ctx.editMessageText(
    `⚔️ ${invite.challengerName} vs ${invite.targetName} — Duel on! Check your DMs.`,
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
    correctCount: { [invite.challengerTgId]: 0, [invite.targetTgId]: 0 },
    fastestSecs: {},
  };

  activeDuels.set(duelId, duel);
  userToDuelId.set(invite.challengerTgId, duelId);
  userToDuelId.set(invite.targetTgId, duelId);

  // Verify both players can receive DMs
  const [cOk, tOk] = await Promise.all([
    bot.api.sendMessage(invite.challengerTgId, `⚔️ Duel vs ${invite.targetName} — get ready!`).then(() => true).catch(() => false),
    bot.api.sendMessage(invite.targetTgId, `⚔️ Duel vs ${invite.challengerName} — get ready!`).then(() => true).catch(() => false),
  ]);

  if (!cOk || !tOk) {
    activeDuels.delete(duelId);
    userToDuelId.delete(invite.challengerTgId);
    userToDuelId.delete(invite.targetTgId);
    const who = !cOk ? invite.challengerName : invite.targetName;
    await bot.api.sendMessage(
      invite.groupChatId,
      `⚔️ Duel cancelled — couldn't DM ${who}. Ask them to send /start to the bot first.`,
    ).catch(() => {});
    return;
  }

  await sendCountdown(bot, duel);
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
  await ctx.editMessageText(`⚔️ ${invite.targetName} declined the challenge.`).catch(() => {});
}

// ── Answer ────────────────────────────────────────────────────────────────────

async function handleDuelAnswer(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const optionIndex = Number(ctx.match[2]);
  const duel = activeDuels.get(duelId);

  if (!duel) { await ctx.answerCallbackQuery("This duel is no longer active."); return; }
  if (ctx.from.id !== duel.challengerTgId && ctx.from.id !== duel.targetTgId) {
    await ctx.answerCallbackQuery(); return;
  }
  if (duel.roundAnswers[ctx.from.id] !== undefined) {
    await ctx.answerCallbackQuery("Already locked in — waiting for opponent…");
    return;
  }

  const q = duel.questions[duel.currentIndex]!;
  const selected = q.options[optionIndex];
  if (!selected) { await ctx.answerCallbackQuery(); return; }

  const elapsed = Math.round((Date.now() - duel.questionStartedAt.getTime()) / 1000);
  const isCorrect = selected.isCorrect;
  const points = isCorrect ? pointsForSpeed(elapsed) : 0;

  duel.roundAnswers[ctx.from.id] = { isCorrect, elapsedSeconds: elapsed, points };

  if (isCorrect) {
    duel.scores[ctx.from.id] = (duel.scores[ctx.from.id] ?? 0) + points;
    duel.correctCount[ctx.from.id] = (duel.correctCount[ctx.from.id] ?? 0) + 1;
  }
  const prev = duel.fastestSecs[ctx.from.id];
  if (prev === undefined || elapsed < prev) duel.fastestSecs[ctx.from.id] = elapsed;

  // Toast with result
  await ctx.answerCallbackQuery(
    isCorrect ? `✅ Correct! +${formatPts(points)} pts (${elapsed}s)` : `❌ Wrong. (${elapsed}s)`,
  );

  // Transform the question message into a "locked in" status
  const opponentName = ctx.from.id === duel.challengerTgId
    ? shortName(duel.targetName)
    : shortName(duel.challengerName);
  const msgId = ctx.callbackQuery.message?.message_id;
  const chatId = ctx.callbackQuery.message?.chat.id;
  if (msgId && chatId) {
    const lockLine = isCorrect
      ? `✅ Locked in! +${formatPts(points)} pts · ${elapsed}s`
      : `❌ Locked in. Wrong answer · ${elapsed}s`;
    await bot.api.editMessageText(chatId, msgId, `${lockLine}\n\n⏳ Waiting for ${opponentName}…`).catch(() => {});
  }

  const bothAnswered =
    duel.roundAnswers[duel.challengerTgId] !== undefined &&
    duel.roundAnswers[duel.targetTgId] !== undefined;

  if (bothAnswered) {
    if (duel.timeoutHandle) { clearTimeout(duel.timeoutHandle); duel.timeoutHandle = null; }
    await processRound(bot, duel);
  }
}

// ── Question flow ─────────────────────────────────────────────────────────────

async function sendCountdown(bot: Bot<BotContext>, duel: DuelState): Promise<void> {
  const steps = ["🔟", "9️⃣", "8️⃣", "7️⃣", "6️⃣", "5️⃣", "4️⃣", "3️⃣", "2️⃣", "1️⃣", "🚀 GO!"];
  const intro = [
    `⚔️ ${shortName(duel.challengerName)} vs ${shortName(duel.targetName)}`,
    `${duel.questions.length} questions · speed scoring · 60s per question`,
    "",
  ].join("\n");

  const [cMsg, tMsg] = await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, intro + steps[0]!).catch(() => null),
    bot.api.sendMessage(duel.targetTgId, intro + steps[0]!).catch(() => null),
  ]);

  for (let i = 1; i < steps.length; i++) {
    await pause(900);
    await Promise.all([
      cMsg ? bot.api.editMessageText(duel.challengerTgId, cMsg.message_id, intro + steps[i]!).catch(() => {}) : Promise.resolve(),
      tMsg ? bot.api.editMessageText(duel.targetTgId, tMsg.message_id, intro + steps[i]!).catch(() => {}) : Promise.resolve(),
    ]);
  }
  await pause(600);
}

async function sendDuelQuestion(bot: Bot<BotContext>, duel: DuelState): Promise<void> {
  const q = duel.questions[duel.currentIndex]!;
  duel.roundAnswers = {};
  duel.questionStartedAt = new Date();

  const total = duel.questions.length;
  const num = duel.currentIndex + 1;
  const isLast = num === total;
  const isSecondHalf = total >= 10 && num === Math.floor(total / 2) + 1;

  const prefix = isLast
    ? `🔔 FINAL QUESTION! (${num}/${total})`
    : isSecondHalf
      ? `⚔️ Second half! Q${num}/${total}`
      : `⚔️ Q${num} / ${total}`;

  const cScore = duel.scores[duel.challengerTgId] ?? 0;
  const tScore = duel.scores[duel.targetTgId] ?? 0;
  const bar = scoreBar(cScore, tScore);
  const scoreHeader = `${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`;

  const text = [prefix, scoreHeader, "", q.questionText].join("\n");
  const keyboard = answerKeyboard(duel.duelId, q.options);

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
        await bot.api.sendMessage(tgId, "⏱️ Time's up! (60s elapsed — no answer recorded)").catch(() => {});
      }
    }
    await processRound(bot, current);
  }, QUESTION_TIMEOUT_MS);
}

async function processRound(bot: Bot<BotContext>, duel: DuelState): Promise<void> {
  const q = duel.questions[duel.currentIndex]!;
  const correctOption = q.options.find((o) => o.isCorrect);
  const cAns = duel.roundAnswers[duel.challengerTgId];
  const tAns = duel.roundAnswers[duel.targetTgId];
  const cScore = duel.scores[duel.challengerTgId] ?? 0;
  const tScore = duel.scores[duel.targetTgId] ?? 0;
  const questionsLeft = duel.questions.length - duel.currentIndex - 1;

  const bar = scoreBar(cScore, tScore);
  const note = commentary(duel.challengerName, cScore, duel.targetName, tScore, questionsLeft);

  const summary = [
    `📊 Q${duel.currentIndex + 1} result`,
    "",
    `${cAns?.isCorrect ? "✅" : "❌"} ${shortName(duel.challengerName)}: ${cAns?.elapsedSeconds ?? "—"}s${cAns?.isCorrect ? `  +${formatPts(cAns.points)}pts` : ""}`,
    `${tAns?.isCorrect ? "✅" : "❌"} ${shortName(duel.targetName)}: ${tAns?.elapsedSeconds ?? "—"}s${tAns?.isCorrect ? `  +${formatPts(tAns.points)}pts` : ""}`,
    correctOption ? `\n✅ ${correctOption.optionText}` : "",
    `\n${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`,
    note ? `\n${note}` : "",
  ].filter(Boolean).join("\n");

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, summary).catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, summary).catch(() => {}),
  ]);

  duel.currentIndex++;

  if (duel.currentIndex >= duel.questions.length) {
    await finishDuel(bot, duel);
    return;
  }

  // Halftime summary for 10+ question duels
  const half = Math.floor(duel.questions.length / 2);
  if (duel.questions.length >= 10 && duel.currentIndex === half) {
    await pause(800);
    await sendHalftimeSummary(bot, duel);
    await pause(3000);
  } else {
    await pause(1500);
  }

  await sendDuelQuestion(bot, duel);
}

async function sendHalftimeSummary(bot: Bot<BotContext>, duel: DuelState): Promise<void> {
  const half = Math.floor(duel.questions.length / 2);
  const cScore = duel.scores[duel.challengerTgId] ?? 0;
  const tScore = duel.scores[duel.targetTgId] ?? 0;
  const cCorrect = duel.correctCount[duel.challengerTgId] ?? 0;
  const tCorrect = duel.correctCount[duel.targetTgId] ?? 0;
  const bar = scoreBar(cScore, tScore);

  const closer =
    cScore > tScore ? `${shortName(duel.challengerName)} leads going into the second half!` :
    tScore > cScore ? `${shortName(duel.targetName)} leads going into the second half!` :
    "Dead level at halftime — second half decides it!";

  const msg = [
    `⏸️ Halftime — ${half} / ${duel.questions.length} done`,
    "",
    `${shortName(duel.challengerName)}: ${cScore}pts  (${cCorrect}/${half} correct)`,
    `${shortName(duel.targetName)}: ${tScore}pts  (${tCorrect}/${half} correct)`,
    "",
    `${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`,
    "",
    closer,
  ].join("\n");

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, msg).catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, msg).catch(() => {}),
  ]);
}

// ── Finish ────────────────────────────────────────────────────────────────────

async function finishDuel(bot: Bot<BotContext>, duel: DuelState): Promise<void> {
  activeDuels.delete(duel.duelId);
  userToDuelId.delete(duel.challengerTgId);
  userToDuelId.delete(duel.targetTgId);

  const total = duel.questions.length;
  const cScore = duel.scores[duel.challengerTgId] ?? 0;
  const tScore = duel.scores[duel.targetTgId] ?? 0;
  const cCorrect = duel.correctCount[duel.challengerTgId] ?? 0;
  const tCorrect = duel.correctCount[duel.targetTgId] ?? 0;
  const cFastest = duel.fastestSecs[duel.challengerTgId];
  const tFastest = duel.fastestSecs[duel.targetTgId];
  const bar = scoreBar(cScore, tScore);

  let headline: string;
  let cTag = "", tTag = "";
  if (cScore > tScore) { headline = `🏆 ${duel.challengerName} wins!`; cTag = " 🏆"; }
  else if (tScore > cScore) { headline = `🏆 ${duel.targetName} wins!`; tTag = " 🏆"; }
  else headline = "🤝 A perfectly matched duel — it's a tie!";

  const statLine = (name: string, score: number, correct: number, fastest?: number, tag = "") =>
    [
      `${name}${tag}`,
      `  Score: ${score} pts`,
      `  Accuracy: ${correct}/${total} correct`,
      fastest !== undefined ? `  Fastest answer: ${fastest}s` : "",
    ].filter(Boolean).join("\n");

  const dmResult = (isChallengerDm: boolean) => [
    "⚔️ Duel complete!",
    "",
    headline,
    "",
    `${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`,
    "",
    statLine(duel.challengerName, cScore, cCorrect, cFastest, cTag),
    "",
    statLine(duel.targetName, tScore, tCorrect, tFastest, tTag),
  ].join("\n");

  const groupResult = [
    `⚔️ Duel: ${duel.challengerName} vs ${duel.targetName}`,
    "",
    headline,
    "",
    `${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`,
    "",
    `${duel.challengerName}: ${cScore}pts · ${cCorrect}/${total} correct`,
    `${duel.targetName}: ${tScore}pts · ${tCorrect}/${total} correct`,
  ].join("\n");

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, dmResult(true)).catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, dmResult(false)).catch(() => {}),
    bot.api.sendMessage(duel.groupChatId, groupResult).catch(() => {}),
  ]);
}
