import { describe, expect, it } from 'vitest';
import {
  addTab,
  checkedAfterSqlChange,
  closeTab,
  createTab,
  effectiveConnectionIds,
  hydrateTabs,
  moveTab,
  nextTabTitle,
  persistableTabs,
  statementsToRun,
  statementsFromSelection,
  canExecuteWithoutDestination,
  resolveRunStatements,
  toggleStatementCheck,
} from './sqlEditorTabLogic';

describe('sqlEditorTabLogic', () => {
  it('addTab appends Query N and activates it', () => {
    const t1 = createTab({ title: 'Query 1' });
    const next = addTab([t1]);
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[1]!.title).toBe('Query 2');
    expect(next.activeTabId).toBe(next.tabs[1]!.id);
  });

  it('moveTab reorders by index and no-ops out of range', () => {
    const a = createTab({ title: 'A' });
    const b = createTab({ title: 'B' });
    const c = createTab({ title: 'C' });
    expect(moveTab([a, b, c], 0, 2).map((t) => t.id)).toEqual([b.id, c.id, a.id]);
    expect(moveTab([a, b, c], 2, 0).map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    expect(moveTab([a, b, c], 1, 1)).toEqual([a, b, c]);
    expect(moveTab([a, b, c], -1, 1)).toEqual([a, b, c]);
    expect(moveTab([a, b, c], 0, 9)).toEqual([a, b, c]);
  });

  it('nextTabTitle skips ahead of existing Query numbers', () => {
    expect(nextTabTitle([createTab({ title: 'Query 1' }), createTab({ title: 'scratch' })])).toBe(
      'Query 2'
    );
    expect(nextTabTitle([createTab({ title: 'Query 5' })])).toBe('Query 6');
  });

  it('closeTab activates a neighbor and refuses an empty tab list', () => {
    const a = createTab({ title: 'Query 1' });
    const b = createTab({ title: 'Query 2' });
    const closed = closeTab([a, b], a.id, a.id);
    expect(closed.tabs.map((t) => t.id)).toEqual([b.id]);
    expect(closed.activeTabId).toBe(b.id);

    const last = closeTab([b], b.id, b.id);
    expect(last.tabs).toHaveLength(1);
    expect(last.tabs[0]!.id).not.toBe(b.id);
    expect(last.tabs[0]!.sql).toBe('');
  });

  it('checkedAfterSqlChange resets when statement count changes', () => {
    expect(checkedAfterSqlChange(1, 2, [0])).toEqual([]);
    expect(checkedAfterSqlChange(2, 2, [0, 1])).toEqual([0, 1]);
    expect(checkedAfterSqlChange(2, 2, [0, 9])).toEqual([0]);
  });

  it('statementsToRun uses first statement when none checked', () => {
    const sql = 'SELECT 1; SELECT 2; SELECT 3;';
    expect(statementsToRun(sql, [])).toEqual(['SELECT 1;']);
    expect(statementsToRun(sql, [2, 0])).toEqual(['SELECT 1;', 'SELECT 3;']);
    expect(statementsToRun(sql, [99])).toEqual(['SELECT 1;']);
    expect(statementsToRun('', [])).toEqual([]);
  });

  it('statementsToRun keeps inter-statement -- @set on the following statement', () => {
    const sql = `SELECT 1 AS id;
-- @set ids = column id
SELECT 2 AS id;`;
    const out = statementsToRun(sql, [0, 1]);
    expect(out[0]).toBe('SELECT 1 AS id;');
    expect(out[1]).toContain('-- @set ids = column id');
    expect(out[1]).toContain('SELECT 2 AS id;');
  });

  it('statementsFromSelection runs all statements in the selection', () => {
    expect(statementsFromSelection('SELECT 1; SELECT 2;')).toEqual(['SELECT 1;', 'SELECT 2;']);
    expect(statementsFromSelection('  SELECT * FROM t WHERE id = 1;  ')).toEqual([
      'SELECT * FROM t WHERE id = 1;',
    ]);
    expect(statementsFromSelection('')).toEqual([]);
  });

  it('canExecuteWithoutDestination allows pure code cells only', () => {
    expect(canExecuteWithoutDestination([])).toBe(false);
    expect(canExecuteWithoutDestination(['SELECT 1;'])).toBe(false);
    expect(canExecuteWithoutDestination(['-- @node\nreturn [];\n-- @end'])).toBe(true);
    expect(canExecuteWithoutDestination(['-- @js\nreturn [];\n-- @end'])).toBe(true);
    expect(
      canExecuteWithoutDestination(['-- @node\nreturn [];\n-- @end', 'SELECT 1;'])
    ).toBe(false);
  });

  it('resolveRunStatements prefers selection over strip checks', () => {
    const sql = 'SELECT 1; SELECT 2;';
    expect(resolveRunStatements(sql, [1], null)).toEqual(['SELECT 2;']);
    expect(resolveRunStatements(sql, [1], '-- @js\nreturn 1;\n-- @end')).toEqual([
      '-- @js\nreturn 1;\n-- @end',
    ]);
  });

  it('toggleStatementCheck adds/removes sorted', () => {
    expect(toggleStatementCheck([0], 2)).toEqual([0, 2]);
    expect(toggleStatementCheck([0, 2], 0)).toEqual([2]);
  });

  it('persistableTabs drops ephemeral fields; hydrate restores checks + statementCount', () => {
    const tab = createTab({
      title: 'Q',
      sql: 'SELECT 1; SELECT 2;',
      checkedStatements: [0, 1],
      layout: 'sideBySide',
    });
    const persisted = persistableTabs([tab]);
    expect(persisted[0]).not.toHaveProperty('checkedStatements');
    expect(persisted[0]).not.toHaveProperty('statementCount');
    expect(persisted[0]!.layout).toBe('sideBySide');

    const hydrated = hydrateTabs(persisted as any);
    expect(hydrated[0]!.checkedStatements).toEqual([]);
    expect(hydrated[0]!.statementCount).toBe(2);
    expect(hydrated[0]!.layout).toBe('sideBySide');
  });

  it('effectiveConnectionIds respects shareDestinations', () => {
    const tab = createTab({ selectedConnectionIds: ['a'] });
    expect(effectiveConnectionIds(tab, false, ['b'])).toEqual(['a']);
    expect(effectiveConnectionIds(tab, true, ['b', 'c'])).toEqual(['b', 'c']);
  });
});
