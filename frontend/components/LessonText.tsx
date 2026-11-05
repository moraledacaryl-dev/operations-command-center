/** Emphasize the lesson's chosen terms without altering its wording or quiz answers. */
export function LessonText({ text, terms }: { text: string; terms: readonly string[] }) {
  const phrases = Array.from(new Set(terms.map(term => term.trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length)
    .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!phrases.length) return <>{text}</>;
  const parts = text.split(new RegExp(`\\b(${phrases.join('|')})\\b`, 'gi'));
  return <>{parts.map((part, index) => index % 2
    ? <strong className="ops-lesson-key-term" key={index}>{part}</strong>
    : part)}</>;
}
