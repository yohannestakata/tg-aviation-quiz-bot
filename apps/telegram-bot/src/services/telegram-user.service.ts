import type { BotContext } from "../types";
import { upsertTelegramGroup, upsertTelegramUser } from "@aviation/db";

export async function ensureTelegramUser(ctx: BotContext) {
  if (!ctx.from) return null;
  return upsertTelegramUser({
    telegramUserId: String(ctx.from.id),
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
    languageCode: ctx.from.language_code
  });
}

export async function ensureTelegramGroup(ctx: BotContext) {
  const chat = ctx.chat;
  if (!chat || chat.type === "private") return null;
  return upsertTelegramGroup({
    telegramChatId: String(chat.id),
    title: "title" in chat ? chat.title : null,
    type: chat.type
  });
}
