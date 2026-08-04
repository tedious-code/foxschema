import { formatRelativeDay } from '../../lib/relativeTime';

/** Parse API `createdAt` (ISO string or epoch ms/seconds) for relative day labels. */
export function importCreatedAtMs(createdAt: string | undefined): number {
  if (!createdAt) return 0;
  const n = Number(createdAt);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Files sidebar “When” cell — Today / A day ago / N days ago. */
export function formatFileImportWhen(createdAt: string | undefined, now = Date.now()): string {
  return formatRelativeDay(importCreatedAtMs(createdAt), now);
}
