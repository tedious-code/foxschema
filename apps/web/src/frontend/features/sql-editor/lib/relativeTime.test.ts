import { describe, expect, it } from 'vitest';
import { formatRelativeDay } from '@/features/sql-editor/lib/relativeTime';

describe('formatRelativeDay', () => {
  const noon = (iso: string) => new Date(iso).getTime();

  it('labels today / a day ago / N days ago', () => {
    const now = noon('2026-08-04T15:00:00');
    expect(formatRelativeDay(noon('2026-08-04T01:00:00'), now)).toBe('Today');
    expect(formatRelativeDay(noon('2026-08-03T23:00:00'), now)).toBe('A day ago');
    expect(formatRelativeDay(noon('2026-08-02T12:00:00'), now)).toBe('2 days ago');
    expect(formatRelativeDay(noon('2026-07-28T12:00:00'), now)).toBe('7 days ago');
  });

  it('returns empty for invalid timestamps', () => {
    expect(formatRelativeDay(0)).toBe('');
    expect(formatRelativeDay(Number.NaN)).toBe('');
  });
});
