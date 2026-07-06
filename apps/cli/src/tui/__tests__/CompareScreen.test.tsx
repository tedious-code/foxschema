import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import * as engine from '../../runtime/engine';
import { CompareScreen } from '../screens/CompareScreen';
import type { ConnRef } from '../types';

// A real (not setTimeout(0)) delay for the one wait that isn't itself checkable via
// vi.waitFor: after the content is already rendered, SelectInput still needs a tick to
// attach its own input listener before it can receive a keypress.
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const source: ConnRef = { dialect: 'postgres', option: {}, schema: 'demo_c', label: 'demo_c' };
const target: ConnRef = { dialect: 'postgres', option: {}, schema: 'demo_d', label: 'demo_d' };

function stubCompare(result: any) {
  vi.spyOn(engine, 'loadScopedTables').mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce(result);
}

describe('CompareScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading spinner with both connection labels, then the summary + grouped list', async () => {
    stubCompare({
      summary: { added: 1, removed: 0, modified: 1, unchanged: 3 },
      tables: [
        { tableName: 'WAREHOUSES', objectType: 'TABLE', status: 'ADDED', columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [] },
        { tableName: 'INVENTORY', objectType: 'TABLE', status: 'MODIFIED', columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [] },
      ],
    });

    const { lastFrame } = render(<CompareScreen source={source} target={target} onSelectDiff={() => {}} onMigrate={() => {}} />);
    expect(lastFrame()).toContain('demo_c');
    expect(lastFrame()).toContain('demo_d');

    await vi.waitFor(() => expect(lastFrame()).toContain('WAREHOUSES'));

    expect(lastFrame()).toContain('1 Added');
    expect(lastFrame()).toContain('1 Modified');
    expect(lastFrame()).toContain('INVENTORY');
    expect(lastFrame()).toContain('TABLES');
  });

  it('shows "Schemas are identical" when there is no drift', async () => {
    stubCompare({ summary: { added: 0, removed: 0, modified: 0, unchanged: 10 }, tables: [] });
    const { lastFrame } = render(<CompareScreen source={source} target={target} onSelectDiff={() => {}} onMigrate={() => {}} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('identical'));
  });

  it('shows an error when the compare call rejects', async () => {
    vi.spyOn(engine, 'loadScopedTables').mockRejectedValueOnce(new Error('connection refused'));
    const { lastFrame } = render(<CompareScreen source={source} target={target} onSelectDiff={() => {}} onMigrate={() => {}} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('connection refused'));
  });

  it('calls onSelectDiff with the picked TableDiff on enter', async () => {
    const diff = { tableName: 'WAREHOUSES', objectType: 'TABLE', status: 'ADDED', columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [] };
    stubCompare({ summary: { added: 1, removed: 0, modified: 0, unchanged: 0 }, tables: [diff] });

    const onSelectDiff = vi.fn();
    const { stdin, lastFrame } = render(<CompareScreen source={source} target={target} onSelectDiff={onSelectDiff} onMigrate={() => {}} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('WAREHOUSES'));
    await wait();

    stdin.write('\r');
    await vi.waitFor(() => expect(onSelectDiff).toHaveBeenCalled());

    expect(onSelectDiff).toHaveBeenCalledWith(diff);
  });
});
