export const BADGE_META: Record<string, { emoji: string; label: string; description: string }> = {
  perfect_flight: { emoji: "🎯", label: "Perfect Flight", description: "Score 100% on a 10+ question quiz" },
  speed_demon:    { emoji: "⚡", label: "Speed Demon",    description: "Answer 5 questions under 10s each in one quiz" },
  daily_grinder:  { emoji: "🗓️", label: "Daily Grinder",  description: "Reach a 7-day play streak" },
  scholar:        { emoji: "📚", label: "Scholar",        description: "Answer questions in 5+ categories" },
  centurion:      { emoji: "💯", label: "Centurion",      description: "Answer 100 questions total" },
  sharp_shooter:  { emoji: "🎖️", label: "Sharp Shooter",  description: "90%+ accuracy across 50+ questions" },
};

export function formatBadgeAnnouncement(badge: string): string {
  const meta = BADGE_META[badge];
  if (!meta) return "";
  return `🏆 New badge: ${meta.emoji} ${meta.label} — ${meta.description}`;
}

export function formatBadgeList(badges: string[]): string {
  if (!badges.length) return "";
  return badges.map((b) => {
    const m = BADGE_META[b];
    return m ? `${m.emoji} ${m.label}` : b;
  }).join("  ");
}
