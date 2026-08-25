import { describe, it, expect } from 'vitest';
import { describeFragmentationChange } from './IndexManagementModal';

/**
 * Reported by a user: "I ran defragment and refreshed, and the percentage did
 * not change." The maintenance had in fact run — the indexes were one leaf page
 * on an empty table, so Postgres returns NaN and there was nothing to reclaim.
 *
 * A number that does not move is indistinguishable from a button that does
 * nothing, so the outcome has to be stated rather than left to be inferred.
 */
describe('describeFragmentationChange', () => {
  it('reports a real reduction as a change', () => {
    expect(describeFragmentationChange([42, 38], [3, 2])).toMatch(/40% → 2\.5%|40% → 3%/);
  });

  it('explains an unmeasurable index instead of implying failure', () => {
    // Postgres yields NaN for an index with no leaf pages; that arrives as null.
    expect(describeFragmentationChange([null, null], [null, null])).toMatch(
      /too small to measure/i
    );
  });

  it('says an already-compact index was fine, not that nothing happened', () => {
    expect(describeFragmentationChange([0, 0], [0, 0])).toMatch(/already compact/i);
  });

  it('points at stale statistics when a real figure refuses to move', () => {
    // Engines whose estimate comes from optimiser statistics need those
    // re-gathered before the number reflects the rebuild.
    expect(describeFragmentationChange([37], [37])).toMatch(/statistics refreshed/i);
  });

  it('treats sub-half-point movement as noise, not a result', () => {
    expect(describeFragmentationChange([12.0], [11.7])).not.toMatch(/→/);
  });

  it('does not claim success when fragmentation rose', () => {
    expect(describeFragmentationChange([5], [20])).toMatch(/rose/i);
  });

  it('ignores nulls mixed in with real readings', () => {
    // formatPct keeps a decimal below 10, so 4 renders as 4.0%.
    expect(describeFragmentationChange([40, null], [4, null])).toMatch(/40% → 4\.0%/);
  });
});
