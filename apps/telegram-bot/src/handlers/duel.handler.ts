import { randomUUID } from "crypto";
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  findUserByTelegramId,
  findUserByUsername,
  getHeadToHead,
  getRandomShortAnswerQuestion,
  listCategories,
  listQuestionsForQuiz,
  recordDuelResult,
} from "@aviation/db";
import { isShortAnswerCorrect } from "../utils/normalize-answer";
import type { BotContext } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

type QuestionData = {
  id: string;
  questionText: string;
  questionType: "multiple_choice" | "short_answer";
  correctAnswerText?: string | null;
  acceptedKeywords?: string[];
  options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
};

type CategoryEntry = { id: string; name: string };

type DuelSetup = {
  duelId: string;
  challengerTgId: number;
  challengerName: string;
  targetTgId: number;
  targetName: string;
  groupChatId: number;
  setupMessageId: number;
  count?: number;
  questionType?: "mc" | "sa" | "mx" | "any";
  categoryId?: string | null;
  categories?: CategoryEntry[];
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
  questionType: "mc" | "sa" | "mx" | "any";
  categoryId: string | null;
  categoryName: string | null;
};

type RoundAnswer = {
  isCorrect: boolean;
  elapsedSeconds: number;
  points: number;
};

type TiebreakerState = {
  question: {
    id: string;
    questionText: string;
    correctAnswerText: string;
    acceptedKeywords: string[];
  };
  round: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  hintLevels: Record<number, number>;
};

type DuelState = {
  duelId: string;
  challengerTgId: number;
  challengerName: string;
  challengerUserId: string | null;
  targetTgId: number;
  targetName: string;
  targetUserId: string | null;
  groupChatId: number;
  questions: QuestionData[];
  duelQuestionType: "mc" | "sa" | "mx" | "any";
  categoryId: string | null;
  currentIndex: number;
  scores: Record<number, number>;
  roundAnswers: Partial<Record<number, RoundAnswer>>;
  questionStartedAt: Date;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  correctCount: Record<number, number>;
  fastestSecs: Partial<Record<number, number>>;
  finished: boolean;
  saHintLevels: Record<number, number>;
  tiebreaker?: TiebreakerState;
};

// ── State ─────────────────────────────────────────────────────────────────────

const pendingSetups = new Map<string, DuelSetup>();
const pendingInvites = new Map<string, DuelInvite>();
const activeDuels = new Map<string, DuelState>();
const userToDuelId = new Map<number, string>();
const usersInSetup = new Set<number>();
const usersInSAQuestion = new Map<number, string>(); // tgId → duelId
const tiebreakerUsers = new Map<number, string>();   // tgId → duelId

// ── Constants ─────────────────────────────────────────────────────────────────

const COUNT_OPTIONS = [5, 10, 15, 20, 30] as const;
const QUESTION_TIMEOUT_MS = 60_000;
const TIEBREAKER_TIMEOUT_MS = 60_000;
const INVITE_EXPIRY_MS = 5 * 60 * 1000;
const SETUP_EXPIRY_MS = 5 * 60 * 1000;

// ── Utilities ─────────────────────────────────────────────────────────────────

function tgName(first?: string | null, last?: string | null, username?: string | null): string {
  return [first, last].filter(Boolean).join(" ") || (username ? `@${username}` : "Player");
}

function shortName(full: string): string {
  return full.split(" ")[0]!.slice(0, 12);
}

function pointsForSpeed(elapsed: number): number {
  if (elapsed <= 15) return 3;
  if (elapsed <= 40) return 2;
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

function questionTypeLabel(type: "mc" | "sa" | "mx" | "any"): string {
  if (type === "mc") return "Multiple Choice";
  if (type === "sa") return "Short Answer";
  if (type === "mx") return "Mixed (MC + SA)";
  return "Any Type";
}

function buildSAHint(answer: string, level: number): string {
  const VOWELS = new Set("aeiouAEIOU");
  const words = answer.trim().split(/\s+/).filter(Boolean);
  const maskChar = (c: string, i: number): string => {
    if (i === 0) return c.toUpperCase();
    if (level >= 2 && VOWELS.has(c)) return c.toUpperCase();
    if (level >= 3 && i % 2 === 0) return c.toUpperCase();
    return "_ ";
  };
  const shape = words.map((w) => w.split("").map(maskChar).join("")).join("   ");
  const desc = level === 1 ? "letters" : level === 2 ? "vowels revealed" : "more letters";
  return [
    `💡 Hint ${level}/3 (${desc}) — ${words.length} word${words.length !== 1 ? "s" : ""}`,
    shape,
  ].join("\n");
}

// ── Keyboards ─────────────────────────────────────────────────────────────────

function countKeyboard(duelId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  COUNT_OPTIONS.forEach((n) => kb.text(`${n} qs`, `duel:count:${duelId}:${n}`));
  return kb;
}

function typeKeyboard(duelId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🎲 Any Mix", `duel:type:${duelId}:any`).row()
    .text("🔵 Multiple Choice", `duel:type:${duelId}:mc`).row()
    .text("📝 Short Answer", `duel:type:${duelId}:sa`).row()
    .text("🔀 Mixed (MC + SA)", `duel:type:${duelId}:mx`);
}

function categoryKeyboard(duelId: string, cats: CategoryEntry[]): InlineKeyboard {
  const kb = new InlineKeyboard().text("🌍 All Categories", `duel:cat:${duelId}:all`).row();
  for (let i = 0; i < cats.length; i += 2) {
    kb.text(cats[i]!.name, `duel:cat:${duelId}:${i}`);
    if (cats[i + 1]) kb.text(cats[i + 1]!.name, `duel:cat:${duelId}:${i + 1}`);
    kb.row();
  }
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
  kb.text("🏳️ Forfeit", `duel:quit:${duelId}`);
  return kb;
}

function saKeyboard(duelId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("💡 Hint", `duel:hint:${duelId}`)
    .text("🏳️ Forfeit", `duel:quit:${duelId}`);
}

function tbKeyboard(duelId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("💡 Hint", `duel:tbhint:${duelId}`)
    .text("🏳️ Forfeit", `duel:quit:${duelId}`);
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerDuelHandlers(bot: Bot<BotContext>) {
  bot.command("duel", (ctx) => handleDuelCommand(ctx, bot));
  bot.command("forfeit", (ctx) => handleForfeitCommand(ctx, bot));
  bot.callbackQuery(/^duel:count:([^:]+):(\d+)$/, (ctx) => handleDuelCount(ctx, bot));
  bot.callbackQuery(/^duel:type:([^:]+):(\w+)$/, (ctx) => handleDuelType(ctx, bot));
  bot.callbackQuery(/^duel:cat:([^:]+):(\w+)$/, (ctx) => handleDuelCategory(ctx, bot));
  bot.callbackQuery(/^duel:accept:(.+)$/, (ctx) => handleDuelAccept(ctx, bot));
  bot.callbackQuery(/^duel:decline:(.+)$/, handleDuelDecline);
  bot.callbackQuery(/^duel:answer:([^:]+):(\d+)$/, (ctx) => handleDuelAnswer(ctx, bot));
  bot.callbackQuery(/^duel:hint:([^:]+)$/, (ctx) => handleDuelHint(ctx, bot));
  bot.callbackQuery(/^duel:tbhint:([^:]+)$/, (ctx) => handleTiebreakerHint(ctx, bot));
  bot.callbackQuery(/^duel:quit:([^:]+)$/, (ctx) => handleForfeitRequest(ctx, bot));
  bot.callbackQuery(/^duel:quit:yes:(.+)$/, (ctx) => handleForfeitConfirm(ctx, bot));
  bot.callbackQuery(/^duel:quit:no:(.+)$/, handleForfeitCancel);

  bot.on("message:text", async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== "private") { await next(); return; }
    const handled = await routeDuelTextAnswer(bot, ctx.from.id, ctx.message.text).catch(() => false);
    if (!handled) await next();
  });
}

// ── Command: /duel ────────────────────────────────────────────────────────────

type PartialUser = { id: number; first_name: string; last_name?: string | null; username?: string | null; is_bot?: boolean };

async function resolveDuelTarget(ctx: BotContext): Promise<PartialUser | "not_found" | "show_help"> {
  const replyFrom = ctx.message?.reply_to_message?.from;
  if (replyFrom) return replyFrom;

  const entities = ctx.message?.entities ?? [];
  const text = ctx.message?.text ?? "";
  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user) return entity.user;
    if (entity.type === "mention") {
      const username = text.slice(entity.offset + 1, entity.offset + entity.length);
      const found = await findUserByUsername(username);
      if (!found) return "not_found";
      return {
        id: Number(found.telegramUserId),
        first_name: found.firstName ?? username,
        last_name: found.lastName,
        username: found.username,
      };
    }
  }
  return "show_help";
}

async function handleDuelCommand(ctx: BotContext, bot: Bot<BotContext>) {
  const chat = ctx.chat;
  if (!chat || chat.type === "private") {
    await ctx.reply("Use /duel in a group by replying to or mentioning another player.");
    return;
  }
  if (!ctx.from) return;

  const resolved = await resolveDuelTarget(ctx);

  if (resolved === "show_help") {
    await ctx.reply(
      "How to challenge someone:\n" +
      "• Reply to their message and type /duel\n" +
      "• Type /duel @username\n" +
      "• Type /duel then tap @ to pick anyone from the group list (works even without a username)",
    );
    return;
  }
  if (resolved === "not_found") {
    await ctx.reply("That player hasn't used the bot yet — ask them to send /start first.");
    return;
  }

  const replyTarget = resolved;
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
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const count = Number(ctx.match[2]);
  const setup = pendingSetups.get(duelId);

  if (!setup) { await ctx.answerCallbackQuery("This setup has expired."); return; }
  if (ctx.from.id !== setup.challengerTgId) {
    await ctx.answerCallbackQuery("Only the challenger can choose the question count.");
    return;
  }

  setup.count = count;
  await ctx.answerCallbackQuery(`${count} questions — now pick the type:`);

  await ctx.editMessageText(
    [
      `⚔️ ${setup.challengerName} vs ${setup.targetName}`,
      `📋 ${count} questions`,
      "",
      `${shortName(setup.challengerName)}, choose question type:`,
    ].join("\n"),
    { reply_markup: typeKeyboard(duelId) },
  ).catch(() => {});
}

// ── Type selection ────────────────────────────────────────────────────────────

async function handleDuelType(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const typeCode = ctx.match[2] as "mc" | "sa" | "mx" | "any";
  const setup = pendingSetups.get(duelId);

  if (!setup) { await ctx.answerCallbackQuery("This setup has expired."); return; }
  if (ctx.from.id !== setup.challengerTgId) {
    await ctx.answerCallbackQuery("Only the challenger can choose the type.");
    return;
  }

  setup.questionType = typeCode;

  let cats: CategoryEntry[] = [];
  try {
    const rows = await listCategories();
    cats = rows.map((r) => ({ id: r.id, name: r.name }));
  } catch {
    // continue without categories
  }
  setup.categories = cats;

  await ctx.answerCallbackQuery(`${questionTypeLabel(typeCode)} — now pick category:`);

  await ctx.editMessageText(
    [
      `⚔️ ${setup.challengerName} vs ${setup.targetName}`,
      `📋 ${setup.count} questions · ${questionTypeLabel(typeCode)}`,
      "",
      `${shortName(setup.challengerName)}, choose a category:`,
    ].join("\n"),
    { reply_markup: categoryKeyboard(duelId, cats) },
  ).catch(() => {});
}

// ── Category selection ────────────────────────────────────────────────────────

async function handleDuelCategory(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const catArg = ctx.match[2]!; // "all" or numeric index
  const setup = pendingSetups.get(duelId);

  if (!setup) { await ctx.answerCallbackQuery("This setup has expired."); return; }
  if (ctx.from.id !== setup.challengerTgId) {
    await ctx.answerCallbackQuery("Only the challenger can choose the category.");
    return;
  }

  const count = setup.count ?? 10;
  const typeCode = setup.questionType ?? "any";

  let categoryId: string | null = null;
  let categoryName: string | null = null;
  if (catArg !== "all") {
    const idx = Number(catArg);
    const cat = setup.categories?.[idx];
    if (cat) { categoryId = cat.id; categoryName = cat.name; }
  }

  // Clean up setup
  pendingSetups.delete(duelId);
  usersInSetup.delete(setup.challengerTgId);

  // Fetch questions
  let questions: QuestionData[];
  try {
    questions = await fetchDuelQuestions(count, typeCode, categoryId);
  } catch {
    await ctx.answerCallbackQuery("Failed to load questions. Try again.");
    await ctx.editMessageText("⚔️ Couldn't load questions. Try /duel again.").catch(() => {});
    return;
  }

  if (questions.length < count) {
    await ctx.answerCallbackQuery("Not enough questions available right now.");
    await ctx.editMessageText(
      "⚔️ Not enough questions available for that combination. Try a different type or category.",
    ).catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery("Set up! Sending invite...");

  const descParts = [String(count) + " questions", questionTypeLabel(typeCode)];
  if (categoryName) descParts.push(categoryName);

  await ctx.editMessageText(
    [
      `⚔️ ${setup.challengerName} challenges ${setup.targetName} to a duel!`,
      "",
      `📋 ${descParts.join(" · ")}`,
      "Fastest correct answer wins",
      "",
      `${setup.targetName}, do you accept?`,
    ].join("\n"),
    { reply_markup: inviteKeyboard(duelId) },
  ).catch(() => {});

  pendingInvites.set(duelId, {
    duelId,
    challengerTgId: setup.challengerTgId,
    challengerName: setup.challengerName,
    targetTgId: setup.targetTgId,
    targetName: setup.targetName,
    groupChatId: setup.groupChatId,
    inviteMessageId: setup.setupMessageId,
    questions,
    questionType: typeCode,
    categoryId,
    categoryName,
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

// ── Question fetching ─────────────────────────────────────────────────────────

async function fetchDuelQuestions(
  count: number,
  typeCode: "mc" | "sa" | "mx" | "any",
  categoryId: string | null,
): Promise<QuestionData[]> {
  const base = { categoryId: categoryId ?? undefined, limit: count };

  if (typeCode === "mx") {
    const half = Math.floor(count / 2);
    const rest = count - half;
    const [mcRaw, saRaw] = await Promise.all([
      listQuestionsForQuiz({ ...base, questionType: "multiple_choice", limit: half }),
      listQuestionsForQuiz({ ...base, questionType: "short_answer", limit: rest }),
    ]);
    const combined: QuestionData[] = [];
    const maxLen = Math.max(mcRaw.length, saRaw.length);
    for (let i = 0; i < maxLen; i++) {
      const mc = mcRaw[i];
      const sa = saRaw[i];
      if (mc) combined.push(toQD(mc));
      if (sa) combined.push(toQD(sa));
    }
    return combined.slice(0, count);
  }

  const qType = typeCode === "mc" ? "multiple_choice" : typeCode === "sa" ? "short_answer" : undefined;
  const raw = await listQuestionsForQuiz({ ...base, questionType: qType });
  return raw.map(toQD);
}

function toQD(q: Awaited<ReturnType<typeof listQuestionsForQuiz>>[number]): QuestionData {
  return {
    id: q.id,
    questionText: q.questionText,
    questionType: q.questionType as "multiple_choice" | "short_answer",
    correctAnswerText: q.correctAnswerText ?? null,
    acceptedKeywords: (q.acceptedKeywords ?? []) as string[],
    options: q.options.map((o) => ({ id: o.id, optionText: o.optionText, isCorrect: o.isCorrect })),
  };
}

// ── Accept / Decline ──────────────────────────────────────────────────────────

async function handleDuelAccept(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const invite = pendingInvites.get(duelId);

  if (!invite) { await ctx.answerCallbackQuery("This invite has expired."); return; }
  if (ctx.from.id !== invite.targetTgId) {
    await ctx.answerCallbackQuery("This challenge isn't for you.");
    return;
  }

  await ctx.answerCallbackQuery("Duel accepted! Check your DMs ⚔️");
  pendingInvites.delete(duelId);

  const [cUser, tUser] = await Promise.all([
    findUserByTelegramId(String(invite.challengerTgId)).catch(() => null),
    findUserByTelegramId(String(invite.targetTgId)).catch(() => null),
  ]);
  const challengerUserId = cUser?.id ?? null;
  const targetUserId = tUser?.id ?? null;

  let h2hLine = "✨ First time these two have faced off!";
  if (challengerUserId && targetUserId) {
    const h2h = await getHeadToHead(challengerUserId, targetUserId).catch(() => null);
    if (h2h && h2h.total > 0) {
      h2hLine = `🔁 H2H history: ${shortName(invite.challengerName)} ${h2h.aWins} – ${h2h.bWins} ${shortName(invite.targetName)} (${h2h.total} duels)`;
    }
  }

  const descParts = [questionTypeLabel(invite.questionType)];
  if (invite.categoryName) descParts.push(invite.categoryName);

  await ctx.editMessageText(
    [
      `⚔️ ${invite.challengerName} vs ${invite.targetName} — Duel on! Check your DMs.`,
      `🎮 ${invite.questions.length} questions · ${descParts.join(" · ")}`,
      h2hLine,
    ].join("\n"),
  ).catch(() => {});

  const duel: DuelState = {
    duelId,
    challengerTgId: invite.challengerTgId,
    challengerName: invite.challengerName,
    challengerUserId,
    targetTgId: invite.targetTgId,
    targetName: invite.targetName,
    targetUserId,
    groupChatId: invite.groupChatId,
    questions: invite.questions,
    duelQuestionType: invite.questionType,
    categoryId: invite.categoryId,
    currentIndex: 0,
    scores: { [invite.challengerTgId]: 0, [invite.targetTgId]: 0 },
    roundAnswers: {},
    questionStartedAt: new Date(),
    timeoutHandle: null,
    correctCount: { [invite.challengerTgId]: 0, [invite.targetTgId]: 0 },
    fastestSecs: {},
    finished: false,
    saHintLevels: {},
  };

  activeDuels.set(duelId, duel);
  userToDuelId.set(invite.challengerTgId, duelId);
  userToDuelId.set(invite.targetTgId, duelId);

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
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }

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

// ── MC Answer ─────────────────────────────────────────────────────────────────

async function handleDuelAnswer(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }

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
  if (q.questionType === "short_answer") { await ctx.answerCallbackQuery(); return; }

  const selected = q.options[optionIndex];
  if (!selected) { await ctx.answerCallbackQuery(); return; }

  const elapsed = Math.round((Date.now() - duel.questionStartedAt.getTime()) / 1000);
  const isCorrect = selected.isCorrect;
  const points = isCorrect ? pointsForSpeed(elapsed) : 0;

  duel.roundAnswers[ctx.from.id] = { isCorrect, elapsedSeconds: elapsed, points };

  if (isCorrect) {
    duel.scores[ctx.from.id] = (duel.scores[ctx.from.id] ?? 0) + points;
    duel.correctCount[ctx.from.id] = (duel.correctCount[ctx.from.id] ?? 0) + 1;
    const prev = duel.fastestSecs[ctx.from.id];
    if (prev === undefined || elapsed < prev) duel.fastestSecs[ctx.from.id] = elapsed;
  }

  await ctx.answerCallbackQuery(
    isCorrect ? `✅ Correct! +${formatPts(points)} pts (${elapsed}s)` : `❌ Wrong. (${elapsed}s)`,
  );

  const opponentName = ctx.from.id === duel.challengerTgId
    ? shortName(duel.targetName)
    : shortName(duel.challengerName);
  const msgId = ctx.callbackQuery?.message?.message_id;
  const chatId = ctx.callbackQuery?.message?.chat.id;
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

// ── SA Hint (main duel) ───────────────────────────────────────────────────────

async function handleDuelHint(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const duel = activeDuels.get(duelId);
  if (!duel || duel.finished) { await ctx.answerCallbackQuery("Duel is over."); return; }

  const tgId = ctx.from.id;
  if (tgId !== duel.challengerTgId && tgId !== duel.targetTgId) {
    await ctx.answerCallbackQuery(); return;
  }
  if (!usersInSAQuestion.has(tgId)) {
    await ctx.answerCallbackQuery("No active short answer question.");
    return;
  }

  const q = duel.questions[duel.currentIndex]!;
  if (!q.correctAnswerText) {
    await ctx.answerCallbackQuery("No hint available.");
    return;
  }

  const currentLevel = duel.saHintLevels[tgId] ?? 0;
  if (currentLevel >= 3) {
    await ctx.answerCallbackQuery("No more hints available!");
    return;
  }

  const newLevel = currentLevel + 1;
  duel.saHintLevels[tgId] = newLevel;
  const hintText = buildSAHint(q.correctAnswerText, newLevel);
  await ctx.answerCallbackQuery(`Hint ${newLevel}/3`);

  const msgId = ctx.callbackQuery?.message?.message_id;
  const chatId = ctx.callbackQuery?.message?.chat.id;
  if (msgId && chatId) {
    const cScore = duel.scores[duel.challengerTgId] ?? 0;
    const tScore = duel.scores[duel.targetTgId] ?? 0;
    const bar = scoreBar(cScore, tScore);
    const scoreHeader = `${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`;
    const total = duel.questions.length;
    const num = duel.currentIndex + 1;
    const isLast = num === total;
    const isSecondHalf = total >= 10 && num === Math.floor(total / 2) + 1;
    const prefix = isLast ? `🔔 FINAL QUESTION! (${num}/${total})` : isSecondHalf ? `⚔️ Second half! Q${num}/${total}` : `⚔️ Q${num} / ${total}`;
    const newText = [prefix, scoreHeader, "", q.questionText, "", "📝 Type your answer in chat · 60s", "", hintText].join("\n");
    await bot.api.editMessageText(chatId, msgId, newText, { reply_markup: saKeyboard(duelId) }).catch(() => {});
  }
}

// ── Tiebreaker Hint ───────────────────────────────────────────────────────────

async function handleTiebreakerHint(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }

  const duelId = ctx.match[1]!;
  const duel = activeDuels.get(duelId);
  if (!duel?.tiebreaker || duel.finished) { await ctx.answerCallbackQuery("Tiebreaker is over."); return; }

  const tgId = ctx.from.id;
  if (tgId !== duel.challengerTgId && tgId !== duel.targetTgId) {
    await ctx.answerCallbackQuery(); return;
  }

  const tb = duel.tiebreaker;
  const currentLevel = tb.hintLevels[tgId] ?? 0;
  if (currentLevel >= 3) {
    await ctx.answerCallbackQuery("No more hints!");
    return;
  }

  const newLevel = currentLevel + 1;
  tb.hintLevels[tgId] = newLevel;
  const hintText = buildSAHint(tb.question.correctAnswerText, newLevel);
  await ctx.answerCallbackQuery(`Hint ${newLevel}/3`);

  const msgId = ctx.callbackQuery?.message?.message_id;
  const chatId = ctx.callbackQuery?.message?.chat.id;
  if (msgId && chatId) {
    const newText = [
      `🔥 TIEBREAKER — Round ${tb.round}/3`,
      "",
      tb.question.questionText,
      "",
      "First to answer correctly wins! Type your answer.",
      "⏱️ 60 seconds",
      "",
      hintText,
    ].join("\n");
    await bot.api.editMessageText(chatId, msgId, newText, { reply_markup: tbKeyboard(duelId) }).catch(() => {});
  }
}

// ── Text answer routing ───────────────────────────────────────────────────────

async function routeDuelTextAnswer(bot: Bot<BotContext>, tgId: number, text: string): Promise<boolean> {
  // Tiebreaker takes priority
  if (tiebreakerUsers.has(tgId)) {
    await handleTiebreakerText(bot, tgId, text);
    return true;
  }
  if (usersInSAQuestion.has(tgId)) {
    await handleSADuelText(bot, tgId, text);
    return true;
  }
  return false;
}

async function handleTiebreakerText(bot: Bot<BotContext>, tgId: number, text: string): Promise<void> {
  const duelId = tiebreakerUsers.get(tgId);
  if (!duelId) return;

  const duel = activeDuels.get(duelId);
  if (!duel?.tiebreaker || duel.finished) return;

  const tb = duel.tiebreaker;
  const correct = isShortAnswerCorrect(text, tb.question.correctAnswerText, tb.question.acceptedKeywords);

  if (!correct) {
    await bot.api.sendMessage(tgId, "❌ Not quite — keep trying!").catch(() => {});
    return;
  }

  if (tb.timeoutHandle) { clearTimeout(tb.timeoutHandle); tb.timeoutHandle = null; }
  tiebreakerUsers.delete(duel.challengerTgId);
  tiebreakerUsers.delete(duel.targetTgId);

  const winnerName = tgId === duel.challengerTgId ? duel.challengerName : duel.targetName;
  const loserId = tgId === duel.challengerTgId ? duel.targetTgId : duel.challengerTgId;

  await bot.api.sendMessage(tgId, "✅ Correct! You win the tiebreaker! 🏆").catch(() => {});
  await bot.api.sendMessage(loserId, `❌ ${shortName(winnerName)} answered first — they win the tiebreaker!`).catch(() => {});

  await finishDuel(bot, duel, { tiebreakerWinnerTgId: tgId });
}

async function handleSADuelText(bot: Bot<BotContext>, tgId: number, text: string): Promise<void> {
  const duelId = usersInSAQuestion.get(tgId);
  if (!duelId) return;

  const duel = activeDuels.get(duelId);
  if (!duel || duel.finished) return;

  if (duel.roundAnswers[tgId] !== undefined) return; // already locked in

  const q = duel.questions[duel.currentIndex]!;
  if (q.questionType !== "short_answer") return;

  const correct = isShortAnswerCorrect(text, q.correctAnswerText, q.acceptedKeywords ?? []);

  if (!correct) {
    await bot.api.sendMessage(tgId, "❌ Not quite — keep trying!").catch(() => {});
    return;
  }

  const elapsed = Math.round((Date.now() - duel.questionStartedAt.getTime()) / 1000);
  const points = pointsForSpeed(elapsed);

  duel.roundAnswers[tgId] = { isCorrect: true, elapsedSeconds: elapsed, points };
  duel.scores[tgId] = (duel.scores[tgId] ?? 0) + points;
  duel.correctCount[tgId] = (duel.correctCount[tgId] ?? 0) + 1;
  const prev = duel.fastestSecs[tgId];
  if (prev === undefined || elapsed < prev) duel.fastestSecs[tgId] = elapsed;

  usersInSAQuestion.delete(tgId);

  const opponentName = tgId === duel.challengerTgId ? shortName(duel.targetName) : shortName(duel.challengerName);
  await bot.api.sendMessage(
    tgId,
    `✅ Correct! +${formatPts(points)} pts (${elapsed}s)\n⏳ Waiting for ${opponentName}…`,
  ).catch(() => {});

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
    `${duel.questions.length} questions · ≤15s = 3pts · ≤40s = 2pts · else 1pt`,
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
  duel.saHintLevels = {};

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
  const baseText = [prefix, scoreHeader, "", q.questionText].join("\n");

  if (q.questionType === "short_answer") {
    const saText = baseText + "\n\n📝 Type your answer in chat · 60s";
    const hintKb = saKeyboard(duel.duelId);
    usersInSAQuestion.set(duel.challengerTgId, duel.duelId);
    usersInSAQuestion.set(duel.targetTgId, duel.duelId);
    await Promise.all([
      bot.api.sendMessage(duel.challengerTgId, saText, { reply_markup: hintKb }).catch(() => {}),
      bot.api.sendMessage(duel.targetTgId, saText, { reply_markup: hintKb }).catch(() => {}),
    ]);
  } else {
    const keyboard = answerKeyboard(duel.duelId, q.options);
    await Promise.all([
      bot.api.sendMessage(duel.challengerTgId, baseText, { reply_markup: keyboard }).catch(() => {}),
      bot.api.sendMessage(duel.targetTgId, baseText, { reply_markup: keyboard }).catch(() => {}),
    ]);
  }

  const questionIndex = duel.currentIndex;
  duel.timeoutHandle = setTimeout(async () => {
    const current = activeDuels.get(duel.duelId);
    if (!current || current.currentIndex !== questionIndex || current.finished) return;

    if (q.questionType === "short_answer") {
      usersInSAQuestion.delete(duel.challengerTgId);
      usersInSAQuestion.delete(duel.targetTgId);
    }

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
  if (duel.finished) return;

  const q = duel.questions[duel.currentIndex]!;
  const cAns = duel.roundAnswers[duel.challengerTgId];
  const tAns = duel.roundAnswers[duel.targetTgId];
  const cScore = duel.scores[duel.challengerTgId] ?? 0;
  const tScore = duel.scores[duel.targetTgId] ?? 0;
  const questionsLeft = duel.questions.length - duel.currentIndex - 1;

  const correctDisplay = q.questionType === "short_answer"
    ? (q.correctAnswerText ?? null)
    : (q.options.find((o) => o.isCorrect)?.optionText ?? null);

  const bar = scoreBar(cScore, tScore);
  const note = commentary(duel.challengerName, cScore, duel.targetName, tScore, questionsLeft);

  const summary = [
    `📊 Q${duel.currentIndex + 1} result`,
    "",
    `${cAns?.isCorrect ? "✅" : "❌"} ${shortName(duel.challengerName)}: ${cAns?.elapsedSeconds ?? "—"}s${cAns?.isCorrect ? `  +${formatPts(cAns.points)}pts` : ""}`,
    `${tAns?.isCorrect ? "✅" : "❌"} ${shortName(duel.targetName)}: ${tAns?.elapsedSeconds ?? "—"}s${tAns?.isCorrect ? `  +${formatPts(tAns.points)}pts` : ""}`,
    correctDisplay ? `\n✅ ${correctDisplay}` : "",
    `\n${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`,
    note ? `\n${note}` : "",
  ].filter(Boolean).join("\n");

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, summary).catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, summary).catch(() => {}),
  ]);

  duel.currentIndex++;

  if (duel.currentIndex >= duel.questions.length) {
    const finalC = duel.scores[duel.challengerTgId] ?? 0;
    const finalT = duel.scores[duel.targetTgId] ?? 0;
    if (finalC === finalT) {
      await startTiebreakerSequence(bot, duel);
    } else {
      await finishDuel(bot, duel);
    }
    return;
  }

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

// ── Tiebreaker ────────────────────────────────────────────────────────────────

async function startTiebreakerSequence(bot: Bot<BotContext>, duel: DuelState): Promise<void> {
  const usedIds = duel.questions.map((q) => q.id);
  const tbQ = await getRandomShortAnswerQuestion(usedIds, duel.categoryId ?? undefined).catch(() => null);

  if (!tbQ || !tbQ.correctAnswerText) {
    await Promise.all([
      bot.api.sendMessage(duel.challengerTgId, "⚖️ No tiebreaker question available — registering as a tie.").catch(() => {}),
      bot.api.sendMessage(duel.targetTgId, "⚖️ No tiebreaker question available — registering as a tie.").catch(() => {}),
    ]);
    await finishDuel(bot, duel, { tiebreakerWinnerTgId: null });
    return;
  }

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, "⚖️ It's a tie! Preparing tiebreaker…").catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, "⚖️ It's a tie! Preparing tiebreaker…").catch(() => {}),
  ]);
  await pause(1500);

  await sendTiebreakerRound(bot, duel, {
    id: tbQ.id,
    questionText: tbQ.questionText,
    correctAnswerText: tbQ.correctAnswerText,
    acceptedKeywords: (tbQ.acceptedKeywords ?? []) as string[],
  }, 1, usedIds);
}

async function sendTiebreakerRound(
  bot: Bot<BotContext>,
  duel: DuelState,
  question: { id: string; questionText: string; correctAnswerText: string; acceptedKeywords: string[] },
  round: number,
  allUsedIds: string[],
): Promise<void> {
  duel.tiebreaker = {
    question,
    round,
    timeoutHandle: null,
    hintLevels: {},
  };

  tiebreakerUsers.set(duel.challengerTgId, duel.duelId);
  tiebreakerUsers.set(duel.targetTgId, duel.duelId);

  const tbText = [
    `🔥 TIEBREAKER — Round ${round}/3`,
    "",
    question.questionText,
    "",
    "First to answer correctly wins! Type your answer.",
    "⏱️ 60 seconds",
  ].join("\n");

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, tbText, { reply_markup: tbKeyboard(duel.duelId) }).catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, tbText, { reply_markup: tbKeyboard(duel.duelId) }).catch(() => {}),
  ]);

  const newUsedIds = [...allUsedIds, question.id];

  duel.tiebreaker.timeoutHandle = setTimeout(async () => {
    if (!duel.tiebreaker || duel.tiebreaker.round !== round || duel.finished) return;

    tiebreakerUsers.delete(duel.challengerTgId);
    tiebreakerUsers.delete(duel.targetTgId);

    if (round >= 3) {
      await Promise.all([
        bot.api.sendMessage(duel.challengerTgId, "⏱️ Time's up — nobody answered. Registering as a tie.").catch(() => {}),
        bot.api.sendMessage(duel.targetTgId, "⏱️ Time's up — nobody answered. Registering as a tie.").catch(() => {}),
      ]);
      await finishDuel(bot, duel, { tiebreakerWinnerTgId: null });
    } else {
      await Promise.all([
        bot.api.sendMessage(duel.challengerTgId, `⏱️ Round ${round} expired — next tiebreaker question coming…`).catch(() => {}),
        bot.api.sendMessage(duel.targetTgId, `⏱️ Round ${round} expired — next tiebreaker question coming…`).catch(() => {}),
      ]);
      await pause(1500);

      const nextQ = await getRandomShortAnswerQuestion(newUsedIds, duel.categoryId ?? undefined).catch(() => null);
      if (!nextQ || !nextQ.correctAnswerText) {
        await finishDuel(bot, duel, { tiebreakerWinnerTgId: null });
        return;
      }
      await sendTiebreakerRound(bot, duel, {
        id: nextQ.id,
        questionText: nextQ.questionText,
        correctAnswerText: nextQ.correctAnswerText,
        acceptedKeywords: (nextQ.acceptedKeywords ?? []) as string[],
      }, round + 1, newUsedIds);
    }
  }, TIEBREAKER_TIMEOUT_MS);
}

// ── Finish ────────────────────────────────────────────────────────────────────

async function finishDuel(
  bot: Bot<BotContext>,
  duel: DuelState,
  opts?: { tiebreakerWinnerTgId?: number | null; forfeitedByTgId?: number },
): Promise<void> {
  if (duel.finished) return;
  duel.finished = true;

  // Clear tiebreaker timeout if running
  if (duel.tiebreaker?.timeoutHandle) {
    clearTimeout(duel.tiebreaker.timeoutHandle);
    duel.tiebreaker.timeoutHandle = null;
  }

  activeDuels.delete(duel.duelId);
  userToDuelId.delete(duel.challengerTgId);
  userToDuelId.delete(duel.targetTgId);
  usersInSAQuestion.delete(duel.challengerTgId);
  usersInSAQuestion.delete(duel.targetTgId);
  tiebreakerUsers.delete(duel.challengerTgId);
  tiebreakerUsers.delete(duel.targetTgId);

  const total = duel.questions.length;
  const cScore = duel.scores[duel.challengerTgId] ?? 0;
  const tScore = duel.scores[duel.targetTgId] ?? 0;
  const cCorrect = duel.correctCount[duel.challengerTgId] ?? 0;
  const tCorrect = duel.correctCount[duel.targetTgId] ?? 0;
  const cFastest = duel.fastestSecs[duel.challengerTgId];
  const tFastest = duel.fastestSecs[duel.targetTgId];
  const bar = scoreBar(cScore, tScore);
  const cAccuracy = Math.round((cCorrect / total) * 100);
  const tAccuracy = Math.round((tCorrect / total) * 100);
  const cFastestLine = cFastest !== undefined ? ` · fastest ${cFastest}s` : "";
  const tFastestLine = tFastest !== undefined ? ` · fastest ${tFastest}s` : "";

  const isForfeit = opts?.forfeitedByTgId !== undefined;
  const tiebreakerOccurred = !isForfeit && opts?.tiebreakerWinnerTgId !== undefined;
  const tbNote = tiebreakerOccurred ? " (Tiebreaker)" : "";
  const frame3Text = isForfeit
    ? "🏳️ Forfeit recorded..."
    : tiebreakerOccurred
      ? "🏆 And after the tiebreaker..."
      : "🏆 And the winner is...";

  let winnerLine: string;
  let winnerCelebration: string;
  let cTag = "", tTag = "";
  let winnerUserId: string | null = null;
  let isTie = false;

  let effectiveWinnerTgId: number | null;
  if (isForfeit) {
    const f = opts!.forfeitedByTgId!;
    effectiveWinnerTgId = f === duel.challengerTgId ? duel.targetTgId : duel.challengerTgId;
  } else if (tiebreakerOccurred) {
    effectiveWinnerTgId = opts!.tiebreakerWinnerTgId ?? null;
  } else {
    if (cScore > tScore) effectiveWinnerTgId = duel.challengerTgId;
    else if (tScore > cScore) effectiveWinnerTgId = duel.targetTgId;
    else effectiveWinnerTgId = null;
  }

  const forfeitedName = isForfeit
    ? (opts!.forfeitedByTgId === duel.challengerTgId ? duel.challengerName : duel.targetName)
    : null;

  if (effectiveWinnerTgId === null) {
    isTie = true;
    winnerLine = tiebreakerOccurred
      ? "🤝 IT'S A TIE! 🤝 (after 3 tiebreaker rounds)"
      : "🤝 IT'S A TIE! 🤝";
    winnerCelebration = "       ⚖️   🎖️   ⚖️";
  } else if (effectiveWinnerTgId === duel.challengerTgId) {
    winnerLine = isForfeit
      ? `🏳️ ${forfeitedName!.toUpperCase()} FORFEITS — ${duel.challengerName.toUpperCase()} WINS! 🏆`
      : `🥇 ${duel.challengerName.toUpperCase()} WINS!${tbNote} 🥇`;
    winnerCelebration = "      🎊   🏆   🎊";
    cTag = " 🏆";
    winnerUserId = duel.challengerUserId;
  } else {
    winnerLine = isForfeit
      ? `🏳️ ${forfeitedName!.toUpperCase()} FORFEITS — ${duel.targetName.toUpperCase()} WINS! 🏆`
      : `🥇 ${duel.targetName.toUpperCase()} WINS!${tbNote} 🥇`;
    winnerCelebration = "      🎊   🏆   🎊";
    tTag = " 🏆";
    winnerUserId = duel.targetUserId;
  }

  // Record to DB and fetch updated H2H
  let h2hText: string | null = null;
  if (duel.challengerUserId && duel.targetUserId) {
    try {
      await recordDuelResult({
        challengerId: duel.challengerUserId,
        targetId: duel.targetUserId,
        winnerId: winnerUserId,
        challengerScore: cScore,
        targetScore: tScore,
        challengerCorrect: cCorrect,
        targetCorrect: tCorrect,
        totalQuestions: total,
        challengerFastestSecs: cFastest ?? null,
        targetFastestSecs: tFastest ?? null,
      });
      const h2h = await getHeadToHead(duel.challengerUserId, duel.targetUserId);
      if (h2h.total > 0) {
        h2hText = `🔁 All-time H2H: ${shortName(duel.challengerName)} ${h2h.aWins} – ${h2h.bWins} ${shortName(duel.targetName)} (${h2h.total} duels)`;
      }
    } catch {
      // non-fatal
    }
  }

  const tiebreakerNote = isForfeit
    ? `\n🏳️ ${forfeitedName} forfeited mid-duel.`
    : tiebreakerOccurred && !isTie
      ? "\n🔥 Decided by tiebreaker short answer!"
      : tiebreakerOccurred && isTie
        ? "\n⚖️ Still tied after 3 tiebreaker rounds!"
        : "";

  const dmText = [
    "⚔️ Duel Complete!",
    "",
    winnerLine,
    winnerCelebration,
    tiebreakerNote,
    "",
    "📊 Final Scores",
    `${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`,
    "",
    `${duel.challengerName}${cTag}`,
    `  ${cScore} pts · ${cCorrect}/${total} ✓ (${cAccuracy}%)${cFastestLine}`,
    "",
    `${duel.targetName}${tTag}`,
    `  ${tScore} pts · ${tCorrect}/${total} ✓ (${tAccuracy}%)${tFastestLine}`,
    ...(h2hText ? ["", h2hText] : []),
  ].filter((l) => l !== undefined).join("\n");

  await Promise.all([
    bot.api.sendMessage(duel.challengerTgId, dmText).catch(() => {}),
    bot.api.sendMessage(duel.targetTgId, dmText).catch(() => {}),
  ]);

  // Animated group reveal — 4 frames
  const frame1 = `⚔️ Calculating result...\n${shortName(duel.challengerName)} vs ${shortName(duel.targetName)}`;

  const frame2Lines = [
    `⚔️ ${duel.challengerName} vs ${duel.targetName} — Final Score`,
    "",
    `${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`,
  ];
  const frame2 = frame2Lines.join("\n");
  const frame3 = [...frame2Lines, "", frame3Text].join("\n");
  const frame4 = [
    `⚔️ ${duel.challengerName} vs ${duel.targetName}`,
    "",
    winnerLine,
    winnerCelebration,
    "",
    `${shortName(duel.challengerName)} ${cScore}  ${bar}  ${tScore} ${shortName(duel.targetName)}`,
    "",
    `${duel.challengerName}${cTag}: ${cScore}pts · ${cCorrect}/${total} ✓ (${cAccuracy}%)${cFastestLine}`,
    `${duel.targetName}${tTag}: ${tScore}pts · ${tCorrect}/${total} ✓ (${tAccuracy}%)${tFastestLine}`,
    ...(h2hText ? ["", h2hText] : []),
  ].join("\n");

  const groupMsg = await bot.api.sendMessage(duel.groupChatId, frame1).catch(() => null);
  if (groupMsg) {
    await pause(700);
    await bot.api.editMessageText(duel.groupChatId, groupMsg.message_id, frame2).catch(() => {});
    await pause(900);
    await bot.api.editMessageText(duel.groupChatId, groupMsg.message_id, frame3).catch(() => {});
    await pause(1200);
    await bot.api.editMessageText(duel.groupChatId, groupMsg.message_id, frame4).catch(() => {});
  }
}

// ── Forfeit ───────────────────────────────────────────────────────────────────

async function handleForfeitCommand(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from) return;
  const tgId = ctx.from.id;
  const duelId = userToDuelId.get(tgId);
  if (!duelId) {
    await ctx.reply("You're not in an active duel.");
    return;
  }
  const duel = activeDuels.get(duelId);
  if (!duel || duel.finished) {
    await ctx.reply("No active duel found.");
    return;
  }
  const opponentName = tgId === duel.challengerTgId ? duel.targetName : duel.challengerName;
  const kb = new InlineKeyboard()
    .text("🏳️ Yes, forfeit", `duel:quit:yes:${duelId}`)
    .text("↩️ Cancel", `duel:quit:no:${duelId}`);
  await ctx.reply(
    `⚠️ Forfeit the duel? ${shortName(opponentName)} will win.`,
    { reply_markup: kb },
  );
}

async function handleForfeitRequest(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }
  const duelId = ctx.match[1]!;
  const tgId = ctx.from.id;
  const duel = activeDuels.get(duelId);
  if (!duel || duel.finished) {
    await ctx.answerCallbackQuery("Duel is already over.");
    return;
  }
  if (tgId !== duel.challengerTgId && tgId !== duel.targetTgId) {
    await ctx.answerCallbackQuery();
    return;
  }
  const opponentName = tgId === duel.challengerTgId ? duel.targetName : duel.challengerName;
  const kb = new InlineKeyboard()
    .text("🏳️ Yes, forfeit", `duel:quit:yes:${duelId}`)
    .text("↩️ Cancel", `duel:quit:no:${duelId}`);
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `⚠️ Forfeit the duel? ${shortName(opponentName)} will win.`,
    { reply_markup: kb },
  );
}

async function handleForfeitConfirm(ctx: BotContext, bot: Bot<BotContext>) {
  if (!ctx.from || !ctx.match) { await ctx.answerCallbackQuery(); return; }
  const duelId = ctx.match[1]!;
  const tgId = ctx.from.id;
  const duel = activeDuels.get(duelId);
  if (!duel || duel.finished) {
    await ctx.answerCallbackQuery("Duel is already over.");
    return;
  }
  if (tgId !== duel.challengerTgId && tgId !== duel.targetTgId) {
    await ctx.answerCallbackQuery();
    return;
  }
  await ctx.answerCallbackQuery("You forfeited.");
  await ctx.editMessageText("🏳️ You forfeited the duel.").catch(() => {});
  if (duel.timeoutHandle) { clearTimeout(duel.timeoutHandle); duel.timeoutHandle = null; }
  await finishDuel(bot, duel, { forfeitedByTgId: tgId });
}

async function handleForfeitCancel(ctx: BotContext) {
  await ctx.answerCallbackQuery("Forfeit cancelled — keep fighting!");
  await ctx.editMessageText("↩️ Forfeit cancelled. Good luck!").catch(() => {});
}
