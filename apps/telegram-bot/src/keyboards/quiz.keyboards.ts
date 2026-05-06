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
