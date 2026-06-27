export function rankFromPoints(points: number): string {
  if (points >= 500) return "✈️ Captain";
  if (points >= 200) return "🛫 Senior Officer";
  if (points >= 75) return "🛩️ Commercial Pilot";
  if (points >= 30) return "🪂 Private Pilot";
  if (points >= 10) return "🎓 Student Pilot";
  return "🔰 Cadet";
}
