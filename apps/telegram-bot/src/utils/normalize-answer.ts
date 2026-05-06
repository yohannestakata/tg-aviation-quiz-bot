export function normalizeAnswer(answer: string) {
  return answer.toLowerCase().trim().replace(/\s+/g, " ");
}

export function isShortAnswerCorrect(answer: string, correctAnswer?: string | null, acceptedKeywords: string[] = []) {
  const normalized = normalizeAnswer(answer);
  if (correctAnswer && normalized === normalizeAnswer(correctAnswer)) return true;
  if (acceptedKeywords.length) {
    return acceptedKeywords.every((keyword) => normalized.includes(normalizeAnswer(keyword)));
  }
  return false;
}
