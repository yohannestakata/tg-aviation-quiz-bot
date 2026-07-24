import { InlineKeyboard } from "grammy";
import type { Category } from "@aviation/db";

export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("🛫 Start Quiz", "menu:quiz")
    .row()
    .text("📊 My Stats", "menu:stats")
    .text("🏆 Leaderboard", "menu:leaderboard")
    .row()
    .text("❓ Help", "menu:help");
}

export function categoriesKeyboard(categories: Category[]) {
  const keyboard = new InlineKeyboard();
  categories.forEach((category, index) => {
    keyboard.text(category.name, `quiz:cat:${category.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  keyboard.row().text("Mixed", "quiz:cat:mixed");
  return keyboard;
}

export function playModeKeyboard() {
  return new InlineKeyboard()
    .text("👤 Individual", "quiz:mode:individual")
    .row()
    .text("🙋 Free Form", "quiz:mode:free_form")
    .row()
    .text("🏁 Race Mode", "quiz:mode:race")
    .row()
    .text("👥 Teams", "quiz:mode:teams");
}

export function teamCountKeyboard() {
  return new InlineKeyboard().text("2", "quiz:teams:2").text("3", "quiz:teams:3").text("4", "quiz:teams:4");
}

export function teamJoinModeKeyboard() {
  return new InlineKeyboard().text("✋ Manual Join", "quiz:joinmode:manual").row().text("⚖️ Auto Balance", "quiz:joinmode:auto_balance");
}

export function teamLobbyKeyboard(teamNames: string[], joinMode: "manual" | "auto_balance") {
  const keyboard = new InlineKeyboard();
  if (joinMode === "auto_balance") {
    keyboard.text("🎮 Join Game", "teamjoin:auto").row();
  } else {
    teamNames.forEach((teamName, index) => {
      keyboard.text(`➕ Join ${teamName}`, `teamjoin:${index}`);
      keyboard.row();
    });
  }
  keyboard.text("🚀 Start Quiz", "quiz:start");
  return keyboard;
}

export function countKeyboard() {
  return new InlineKeyboard().text("5", "quiz:count:5").text("10", "quiz:count:10").text("20", "quiz:count:20");
}

export function typeKeyboard() {
  return new InlineKeyboard()
    .text("✅ Multiple Choice", "quiz:type:multiple_choice")
    .row()
    .text("✍️ Short Answer", "quiz:type:short_answer")
    .row()
    .text("🔀 Mixed", "quiz:type:mixed");
}

export function answerKeyboard(options: Array<{ optionText: string }>) {
  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    keyboard.text(option.optionText, `answer:${index}`);
    keyboard.row();
  });
  keyboard.text("💡 Hint", "question:hint").text("🚩 Report", "question:report");
  return keyboard;
}

export function questionActionsKeyboard() {
  return new InlineKeyboard().text("💡 Hint", "question:hint").text("🚩 Report", "question:report");
}

export function reportNoteKeyboard() {
  return new InlineKeyboard().text("Skip note", "report:skip");
}

type LbPeriod = "all" | "week" | "month";
type LbMode = "all" | "solo" | "free_form" | "race" | "teams" | "duels";

const MODE_LABELS: Record<LbMode, string> = {
  all: "🌐 All",
  solo: "👤 Solo",
  free_form: "🙋 Free-form",
  race: "🏁 Race",
  teams: "👥 Teams",
  duels: "⚔️ Duels",
};

const PERIOD_LABELS: Record<LbPeriod, string> = {
  all: "⏳ All Time",
  week: "📅 This Week",
  month: "🗓️ This Month",
};

export function leaderboardKeyboard(period: LbPeriod = "all", mode: LbMode = "all") {
  const cell = (label: string, active: boolean) => (active ? `${label} ✓` : label);
  const kb = new InlineKeyboard();
  // Row 1: periods
  (["all", "week", "month"] as const).forEach((p, i) => {
    kb.text(cell(PERIOD_LABELS[p], p === period), `leaderboard:set:${p}:${mode}`);
    if (i < 2) { /* keep on same row */ }
  });
  kb.row();
  // Row 2: All / Solo / Free-form
  (["all", "solo", "free_form"] as const).forEach((m) => {
    kb.text(cell(MODE_LABELS[m], m === mode), `leaderboard:set:${period}:${m}`);
  });
  kb.row();
  // Row 3: Race / Teams / Duels
  (["race", "teams", "duels"] as const).forEach((m) => {
    kb.text(cell(MODE_LABELS[m], m === mode), `leaderboard:set:${period}:${m}`);
  });
  return kb;
}

/** @deprecated retained for callers still using the period-only keyboard */
export function leaderboardPeriodKeyboard(active: LbPeriod = "all") {
  return leaderboardKeyboard(active, "all");
}

export function retryWrongKeyboard(sessionId: string) {
  return new InlineKeyboard().text("🔁 Retry wrong answers", `quiz:retry:${sessionId}`);
}

export function dailyAnswerKeyboard(options: Array<{ optionText: string }>) {
  const kb = new InlineKeyboard();
  options.forEach((opt, i) => {
    kb.text(opt.optionText, `daily:mc:${i}`).row();
  });
  return kb;
}

export function dailyResultKeyboard() {
  return new InlineKeyboard().text("🏆 Daily Leaderboard", "daily:leaderboard");
}
