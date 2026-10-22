/** Property-day due-date semantics shared with the backend My Work queue.
 *
 * The backend classifies an overdue task by the calendar date in Asia/Manila,
 * not by the due timestamp being earlier than the current clock time.
 * Keep the Tasks and Projects counters consistent with that rule.
 */
const propertyDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function propertyDayKey(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = propertyDayFormatter.formatToParts(date);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);
  if (!year || !month || !day) return null;
  return year * 10000 + month * 100 + day;
}

export function isOverduePropertyDay(dueDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const due = propertyDayKey(dueDate);
  const today = propertyDayKey(now);
  return due !== null && today !== null && due < today;
}
