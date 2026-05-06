import { InlineKeyboard } from "grammy";
import type { Category } from "@aviation/db";

export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("Start Quiz", "menu:quiz")
    .row()
    .text("My Stats", "menu:stats")
    .text("Leaderboard", "menu:leaderboard")
    .row()
    .text("Help", "menu:help");
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

export function countKeyboard() {
  return new InlineKeyboard().text("5", "quiz:count:5").text("10", "quiz:count:10").text("20", "quiz:count:20");
}

export function typeKeyboard() {
  return new InlineKeyboard()
    .text("Multiple Choice", "quiz:type:multiple_choice")
    .row()
    .text("Short Answer", "quiz:type:short_answer")
    .row()
    .text("Mixed", "quiz:type:mixed");
}

export function answerKeyboard(options: Array<{ optionText: string }>) {
  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    keyboard.text(option.optionText, `answer:${index}`);
    keyboard.row();
  });
  return keyboard;
}
