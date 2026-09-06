/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { diffBriefing } from './diffBriefing';

describe('diffBriefing', () => {
  it('counts compare statuses from the DTO already in memory', () => {
    expect(
      diffBriefing([
        { status: 'ADDED' },
        { status: 'ADDED' },
        { status: 'MODIFIED' },
        { status: 'REMOVED' },
        { status: 'UNCHANGED' },
        { status: 'UNCHANGED' },
      ])
    ).toEqual({ added: 2, modified: 1, removed: 1, unchanged: 2 });
  });

  it('treats a missing table list as empty', () => {
    expect(diffBriefing(undefined)).toEqual({
      added: 0,
      modified: 0,
      removed: 0,
      unchanged: 0,
    });
  });
});
