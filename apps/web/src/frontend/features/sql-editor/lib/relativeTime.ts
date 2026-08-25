/**
 * Calendar-day relative labels for Recent queries / bookmarks.
 * "Today", "A day ago", "2 days ago", …
 */
export function formatRelativeDay(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const startOf = (n: number) => {
    const d = new Date(n);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(now) - startOf(ts)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'A day ago';
  return `${days} days ago`;
}
