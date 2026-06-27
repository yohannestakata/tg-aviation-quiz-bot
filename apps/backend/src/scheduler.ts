import type { Bot } from "grammy";
import {
  getDailyQuestionForDate,
  getSubscribedGroupsPendingToday,
  markGroupDailyPosted,
} from "@aviation/db";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function postDailyChallengeToGroups(bot: Bot) {
  const today = todayUTC();
  const question = await getDailyQuestionForDate(today);
  if (!question) return;

  const groups = await getSubscribedGroupsPendingToday(today);
  for (const group of groups) {
    try {
      await bot.api.sendMessage(
        group.telegramChatId,
        [
          `📅 Daily Aviation Challenge — ${today}`,
          "",
          question.questionText,
          "",
          "Answer in private: send me /daily",
        ].join("\n"),
      );
      await markGroupDailyPosted(group.id, today);
    } catch (err) {
      console.error(`Failed to post daily to group ${group.telegramChatId}:`, err);
    }
  }
}

export function scheduleDailyQuestions(bot: Bot) {
  let lastPostedHour = -1;

  setInterval(async () => {
    const hour = new Date().getUTCHours();
    if (hour === 8 && hour !== lastPostedHour) {
      lastPostedHour = hour;
      await postDailyChallengeToGroups(bot).catch((err) =>
        console.error("scheduleDailyQuestions error:", err),
      );
    }
    if (hour !== 8) lastPostedHour = -1;
  }, 60_000);
}
