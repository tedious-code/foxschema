import { describe, expect, it } from 'vitest';
import { sideBySideSectionCount, type SectionRun } from '@/features/sql-editor/lib/resultsSections';

const running: SectionRun = { status: 'running' };
const done = (n: number): SectionRun => ({ status: 'done', results: new Array(n).fill(null) });

describe('sideBySideSectionCount', () => {
  it('claims a section for a run still in flight', () => {
    // The regression: at dispatch neither statements nor results exist, and a
    // count of zero rendered an empty container with no sign of progress.
    expect(sideBySideSectionCount(0, [running])).toBe(1);
  });

  it('claims a section when only one of several credentials is still running', () => {
    expect(sideBySideSectionCount(0, [done(0), running])).toBe(1);
  });

  it('draws nothing before anything has been run', () => {
    expect(sideBySideSectionCount(0, [])).toBe(0);
  });

  it('draws nothing for finished runs that produced no statements', () => {
    expect(sideBySideSectionCount(0, [done(0)])).toBe(0);
  });

  it('follows the reported statements once they arrive', () => {
    expect(sideBySideSectionCount(3, [running])).toBe(3);
  });

  it('follows the longest result list across credentials', () => {
    expect(sideBySideSectionCount(1, [done(1), done(4)])).toBe(4);
  });

  it('does not let one in-flight run shrink an established count', () => {
    // A partial refresh of one credential must not collapse the layout.
    expect(sideBySideSectionCount(0, [done(5), running])).toBe(5);
  });

  it('tolerates a missing results list', () => {
    expect(sideBySideSectionCount(0, [{ status: 'done' }])).toBe(0);
    expect(sideBySideSectionCount(0, [{ status: 'done', results: null }])).toBe(0);
  });
});
