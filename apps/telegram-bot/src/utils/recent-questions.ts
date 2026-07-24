// Per-chat in-memory cache of recently-used question IDs.
// Prevents the same questions from cycling back too quickly in group quizzes
// and duels that share a chat, since listQuestionsForQuiz's per-user history
// (SR) doesn't cover other players in the same group.

const CAP = 500;
const cache = new Map<number, string[]>();

export function getRecentQuestionIds(chatId: number | null | undefined): string[] {
  if (chatId === undefined || chatId === null) return [];
  return cache.get(chatId) ?? [];
}

export function recordRecentQuestionIds(chatId: number | null | undefined, ids: string[]): void {
  if (chatId === undefined || chatId === null || ids.length === 0) return;
  const existing = cache.get(chatId) ?? [];
  const merged = [...ids, ...existing.filter((id) => !ids.includes(id))].slice(0, CAP);
  cache.set(chatId, merged);
}
