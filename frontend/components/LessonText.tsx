/** Emphasize curated reminders without changing wording or quiz choices. */
export function LessonText({ text, terms }: { text: string; terms: readonly string[] }) {
  const phrases = Array.from(new Set(terms.map(term => term.trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length)
    .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!phrases.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(?<![\\p{L}\\p{N}_])(${phrases.join('|')})(?![\\p{L}\\p{N}_])`, 'giu'));
  return <>{parts.map((part, index) => index % 2
    ? <strong className="ops-lesson-key-term" key={index}>{part}</strong>
    : part)}</>;
}
