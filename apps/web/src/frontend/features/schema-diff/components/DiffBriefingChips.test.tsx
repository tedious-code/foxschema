/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiffBriefingChips, DiffBriefingTicks } from './DiffBriefingChips';

describe('DiffBriefingChips', () => {
  it('prints the same + / ~ / − language as the Sync toolbar', () => {
    render(<DiffBriefingChips briefing={{ added: 2, modified: 1, removed: 3, unchanged: 8 }} />);
    const el = screen.getByTestId('diff-briefing');
    expect(el.textContent).toContain('+2');
    expect(el.textContent).toContain('~1');
    expect(el.textContent).toContain('−3');
    expect(el.textContent).not.toContain('unchanged');
  });
});

describe('DiffBriefingTicks', () => {
  it('renders one rect per non-zero change kind', () => {
    const { container } = render(<DiffBriefingTicks added={2} modified={1} removed={0} />);
    expect(screen.getByTestId('lokee-change-ticks').tagName.toLowerCase()).toBe('svg');
    expect(container.querySelectorAll('rect')).toHaveLength(2);
  });

  it('renders an empty track when a version has no delta', () => {
    render(<DiffBriefingTicks added={0} modified={0} removed={0} />);
    expect(screen.getByTestId('lokee-change-ticks').tagName.toLowerCase()).toBe('span');
  });
});
