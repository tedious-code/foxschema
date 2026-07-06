import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import * as engine from '../../runtime/engine';
import { MigrateConfirmScreen } from '../screens/MigrateConfirmScreen';
import type { ConnRef } from '../types';

// A real (not setTimeout(0)) delay between keystrokes: under full-suite parallel load,
// same-tick flushes aren't reliably enough time for ink-select-input to process one
// keypress and re-render before the next is sent (confirmed flaky in CI-like conditions —
// passed every time run in isolation, intermittently failed under full `vitest run`).
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const source: ConnRef = { dialect: 'postgres', option: {}, schema: 'demo_c', label: 'demo_c' };
const target: ConnRef = { dialect: 'postgres', option: {}, schema: 'demo_d', label: 'demo_d' };

function stubCompare(result: any) {
  vi.spyOn(engine, 'loadScopedTables').mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce(result);
}

function stubOnePlan() {
  stubCompare({
    summary: { added: 1, removed: 0, modified: 0, unchanged: 0 },
    tables: [{ tableName: 'WAREHOUSES', objectType: 'TABLE', status: 'ADDED', columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [] }],
  });
  vi.spyOn(engine.sqlGenerator, 'generateMigrationPlan').mockReturnValue([{ objectName: 'WAREHOUSES' }] as any);
  vi.spyOn(engine.sqlGenerator, 'generateMigrationSql').mockReturnValue('CREATE TABLE WAREHOUSES (id INT);');
}

describe('MigrateConfirmScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the step count and a dry-run SQL preview', async () => {
    stubOnePlan();
    const { lastFrame } = render(<MigrateConfirmScreen source={source} target={target} onConfirm={() => {}} onCancel={() => {}} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('1 change(s)'));

    expect(lastFrame()).toContain('CREATE TABLE WAREHOUSES');
    expect(lastFrame()).toContain('skip failures');
  });

  it('shows "nothing to migrate" when there is no drift', async () => {
    stubCompare({ summary: { added: 0, removed: 0, modified: 0, unchanged: 5 }, tables: [] });
    const { lastFrame } = render(<MigrateConfirmScreen source={source} target={target} onConfirm={() => {}} onCancel={() => {}} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('nothing to migrate'));
  });

  it('calls onConfirm(false) for "stop on first failure" (the pre-selected default)', async () => {
    stubOnePlan();
    const onConfirm = vi.fn();

    const { stdin, lastFrame } = render(<MigrateConfirmScreen source={source} target={target} onConfirm={onConfirm} onCancel={() => {}} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('stop on the first failure'));
    await wait(); // SelectInput's input listener attaches a tick after its content renders

    stdin.write('\r');
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalled());

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('calls onConfirm(true) for "skip failures and continue"', async () => {
    stubOnePlan();
    const onConfirm = vi.fn();

    const { stdin, lastFrame } = render(<MigrateConfirmScreen source={source} target={target} onConfirm={onConfirm} onCancel={() => {}} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('stop on the first failure'));
    await wait(); // SelectInput's input listener attaches a tick after its content renders

    stdin.write('\x1b[B'); // down to "skip failures and continue"
    await wait();
    stdin.write('\r');
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalled());

    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('calls onCancel for "Cancel"', async () => {
    stubOnePlan();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    const { stdin, lastFrame } = render(<MigrateConfirmScreen source={source} target={target} onConfirm={onConfirm} onCancel={onCancel} />);
    await vi.waitFor(() => expect(lastFrame()).toContain('stop on the first failure'));
    await wait(); // SelectInput's input listener attaches a tick after its content renders

    stdin.write('\x1b[B');
    await wait();
    stdin.write('\x1b[B');
    await wait();
    stdin.write('\r');
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
