/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VersionTimeline } from './VersionTimeline';

const V = (
  number: number,
  extras: { added?: number; modified?: number; removed?: number; changeCount?: number } = {}
) => ({
  id: `v${number}`,
  number,
  createdAt: '2026-09-07T00:00:00.000Z',
  rootHash: `h${number}`,
  ...extras,
});

describe('VersionTimeline', () => {
  it('draws stacked + / ~ / − ticks from the version DTO', () => {
    render(
      <VersionTimeline
        versions={[V(2, { added: 2, modified: 1, removed: 3 }), V(1, { added: 4 })]}
        totalVersions={2}
      />
    );
    const ticks = screen.getAllByTestId('lokee-change-ticks');
    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.querySelectorAll('rect')).toHaveLength(3);
    expect(screen.getByTestId('lokee-timeline-v-2').textContent).toContain('6 changes');
  });

  it('selects a version without loading the graph', () => {
    const onSelect = vi.fn();
    render(
      <VersionTimeline versions={[V(1, { added: 1 })]} totalVersions={1} onSelect={onSelect} />
    );
    fireEvent.click(screen.getByTestId('lokee-timeline-v-1'));
    expect(onSelect).toHaveBeenCalledWith('v1');
  });
});
