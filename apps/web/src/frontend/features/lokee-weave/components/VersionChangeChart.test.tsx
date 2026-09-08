/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VersionChangeChart } from './VersionChangeChart';

describe('VersionChangeChart', () => {
  it('draws stacked bars from version + / ~ / − already on the DTO', () => {
    const { container } = render(
      <VersionChangeChart
        versions={[
          { id: 'v1', number: 1, added: 2, modified: 1, removed: 0, createdAt: '', rootHash: 'a' },
          { id: 'v2', number: 2, added: 0, modified: 3, removed: 1, createdAt: '', rootHash: 'b' },
        ]}
      />
    );
    expect(screen.getByTestId('lokee-change-chart')).toBeTruthy();
    expect(container.querySelectorAll('rect').length).toBeGreaterThanOrEqual(4);
  });
});
