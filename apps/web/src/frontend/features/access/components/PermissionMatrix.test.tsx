/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The grid's promise to the reader is that a checkbox they can tick produces
 * SQL their engine will accept, and one they cannot tick says why.
 *
 * The capability rules themselves are tested against the SQL in
 * `object-grid.test.ts`. What is tested here is that the rendering honours them
 * — a grid that draws an enabled checkbox for a privilege the compiler then
 * discards would let a reader believe they granted something they did not.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PermissionMatrix } from './PermissionMatrix';
import type { PermissionRequest } from '../lib/access';

const principal = { type: 'user' as const, name: 'report_user' };

function setup(dialect: string) {
  const onChange = vi.fn<(r: PermissionRequest[]) => void>();
  render(
    <PermissionMatrix
      dialect={dialect}
      principal={principal}
      action="grant"
      schema="app"
      tableChoices={['orders', 'customers']}
      onChange={onChange}
    />
  );
  const nameInput = screen.getAllByPlaceholderText('Table name')[0] as HTMLInputElement;
  const rowId = nameInput.getAttribute('data-testid')!.replace('matrix-name-', '');
  return { onChange, rowId, nameInput };
}

const latest = (onChange: { mock: { calls: unknown[][] } }): PermissionRequest[] =>
  (onChange.mock.calls.at(-1)?.[0] ?? []) as PermissionRequest[];

describe('cells the engine cannot express', () => {
  it('disables ALTER and DROP on PostgreSQL and gives the reason', () => {
    const { rowId } = setup('postgres');
    const alter = screen.getByTestId(`matrix-cell-${rowId}-alter-object`) as HTMLInputElement;
    expect(alter.disabled).toBe(true);
    expect(alter.getAttribute('title')).toMatch(/owning it/i);
  });

  it('enables the same cells on MySQL', () => {
    const { rowId } = setup('mysql');
    expect((screen.getByTestId(`matrix-cell-${rowId}-alter-object`) as HTMLInputElement).disabled).toBe(
      false
    );
    expect((screen.getByTestId(`matrix-cell-${rowId}-drop-object`) as HTMLInputElement).disabled).toBe(
      false
    );
  });

  it('draws the disabled cell rather than hiding it', () => {
    // A missing checkbox sends the reader looking for one; a struck-through
    // heading with a reason answers the question they came with.
    const { rowId } = setup('postgres');
    expect(screen.queryByTestId(`matrix-cell-${rowId}-drop-object`)).not.toBeNull();
    expect(screen.getByTestId('matrix-col-table-drop-object').className).toMatch(/line-through/);
  });

  it('refuses to tick a disabled cell', () => {
    const { rowId, onChange, nameInput } = setup('postgres');
    fireEvent.change(nameInput, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${rowId}-drop-object`));
    expect(latest(onChange)).toEqual([]);
  });
});

describe('ticking cells compiles to requests', () => {
  it('reports a request once a name and a privilege are set', () => {
    const { rowId, onChange, nameInput } = setup('postgres');
    fireEvent.change(nameInput, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${rowId}-read`));

    const requests = latest(onChange);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.permissions).toEqual(['read']);
    expect(requests[0]!.scope).toMatchObject({ type: 'tables', tables: ['orders'], schema: 'app' });
  });

  it('reports nothing while the row is unnamed', () => {
    // A privilege on an unnamed object cannot be written as SQL; emitting a
    // request for it would put `ON app.` in the preview.
    const { rowId, onChange } = setup('postgres');
    fireEvent.click(screen.getByTestId(`matrix-cell-${rowId}-read`));
    expect(latest(onChange)).toEqual([]);
  });

  it('unticks on a second click', () => {
    const { rowId, onChange, nameInput } = setup('postgres');
    fireEvent.change(nameInput, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${rowId}-read`));
    fireEvent.click(screen.getByTestId(`matrix-cell-${rowId}-read`));
    expect(latest(onChange)).toEqual([]);
  });

  it('ticks a whole column from its heading', () => {
    const { onChange, nameInput } = setup('postgres');
    fireEvent.change(nameInput, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId('matrix-col-table-read'));
    expect(latest(onChange)[0]!.permissions).toEqual(['read']);
  });

  it('ticks every available cell in a row, and no unavailable one', () => {
    const { rowId, onChange, nameInput } = setup('postgres');
    fireEvent.change(nameInput, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId(`matrix-row-all-${rowId}`));

    const permissions = latest(onChange)[0]!.permissions;
    expect(permissions).toContain('read');
    expect(permissions).toContain('trigger-object');
    // The two PostgreSQL cannot grant.
    expect(permissions).not.toContain('alter-object');
    expect(permissions).not.toContain('drop-object');
  });
});

describe('routine rows', () => {
  it('adds a procedure section with an Execute column', () => {
    setup('postgres');
    fireEvent.click(screen.getByTestId('matrix-add-section-procedure'));
    expect(screen.getByTestId('matrix-section-procedure')).toBeTruthy();
    expect(screen.getByTestId('matrix-col-procedure-execute-procedure')).toBeTruthy();
  });

  it('compiles a routine row to a routines scope, not a tables one', () => {
    const { onChange } = setup('postgres');
    fireEvent.click(screen.getByTestId('matrix-add-section-procedure'));
    const procInput = screen.getByPlaceholderText('Procedure name');
    const procRow = procInput.getAttribute('data-testid')!.replace('matrix-name-', '');
    fireEvent.change(procInput, { target: { value: 'reprice' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${procRow}-execute-procedure`));

    const requests = latest(onChange);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.scope).toMatchObject({
      type: 'routines',
      routines: [{ name: 'reprice', kind: 'procedure' }],
    });
  });
});

describe('rows', () => {
  it('removes a row', () => {
    const { rowId, onChange, nameInput } = setup('postgres');
    fireEvent.change(nameInput, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${rowId}-read`));
    expect(latest(onChange)).toHaveLength(1);

    fireEvent.click(screen.getByTestId(`matrix-remove-${rowId}`));
    expect(latest(onChange)).toEqual([]);
  });

  it('keeps each row independent when a second is added', () => {
    const { rowId, onChange, nameInput } = setup('postgres');
    fireEvent.change(nameInput, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${rowId}-read`));

    fireEvent.click(screen.getByTestId('matrix-add-table'));
    const second = screen.getAllByPlaceholderText('Table name')[1] as HTMLInputElement;
    const secondId = second.getAttribute('data-testid')!.replace('matrix-name-', '');
    fireEvent.change(second, { target: { value: 'customers' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${secondId}-insert`));

    const requests = latest(onChange);
    // Different privilege sets must not collapse into one statement.
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.permissions.join())).toEqual(
      expect.arrayContaining(['read', 'insert'])
    );
  });

  it('recompiles extra rows onto the schema field, not the schema at add time', () => {
    const onChange = vi.fn<(r: PermissionRequest[]) => void>();
    const props = {
      dialect: 'postgres',
      principal,
      action: 'grant' as const,
      tableChoices: ['orders', 'customers'],
      onChange,
    };
    const { rerender } = render(<PermissionMatrix {...props} schema="app" />);
    const first = screen.getAllByPlaceholderText('Table name')[0] as HTMLInputElement;
    const firstId = first.getAttribute('data-testid')!.replace('matrix-name-', '');
    fireEvent.change(first, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${firstId}-read`));

    fireEvent.click(screen.getByTestId('matrix-add-table'));
    const second = screen.getAllByPlaceholderText('Table name')[1] as HTMLInputElement;
    const secondId = second.getAttribute('data-testid')!.replace('matrix-name-', '');
    fireEvent.change(second, { target: { value: 'customers' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${secondId}-read`));

    rerender(<PermissionMatrix {...props} schema="reporting" />);
    const requests = latest(onChange);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.scope).toMatchObject({
      type: 'tables',
      schema: 'reporting',
      tables: ['orders', 'customers'],
    });
  });
});

describe('it does not spin when the caller passes a fresh principal each render', () => {
  it('settles instead of looping', () => {
    // The real parent builds `principal` as an object literal in its JSX, so a
    // new identity arrives on every render. With the compile memo keyed on that
    // identity, reporting the result set parent state, which re-rendered, which
    // produced a new identity — "Maximum update depth exceeded", and the whole
    // panel dead the moment it was opened.
    //
    // This harness is the parent: it stores what it is told and passes a fresh
    // literal back down. If the loop returns, React throws here.
    // A render budget, so a regression fails in a second instead of spinning
    // until the suite times out.
    let renders = 0;
    const Parent: React.FC = () => {
      renders += 1;
      if (renders > 50) throw new Error(`render loop: ${renders} renders`);
      const [requests, setRequests] = React.useState<PermissionRequest[]>([]);
      return (
        <>
          <span data-testid="count">{requests.length}</span>
          <PermissionMatrix
            dialect="postgres"
            principal={{ type: 'user', name: 'report_user' }}
            action="grant"
            schema="app"
            tableChoices={['orders']}
            onChange={setRequests}
          />
        </>
      );
    };

    render(<Parent />);
    const nameInput = screen.getAllByPlaceholderText('Table name')[0] as HTMLInputElement;
    const rowId = nameInput.getAttribute('data-testid')!.replace('matrix-name-', '');
    fireEvent.change(nameInput, { target: { value: 'orders' } });
    fireEvent.click(screen.getByTestId(`matrix-cell-${rowId}-read`));

    expect(screen.getByTestId('count').textContent).toBe('1');
  });
});

describe('opening on the database catalog', () => {
  const catalog = [
    { schema: 'demo_a', name: 'orders', kind: 'table' as const },
    { schema: 'demo_b', name: 'orders', kind: 'table' as const },
    { schema: 'demo_a', name: 'v_sales', kind: 'view' as const },
  ];

  function withCatalog(objects: typeof catalog) {
    const onChange = vi.fn<(r: PermissionRequest[]) => void>();
    const view = render(
      <PermissionMatrix
        dialect="postgres"
        principal={principal}
        action="grant"
        schema="app"
        catalog={objects}
        onChange={onChange}
      />
    );
    return { onChange, view };
  }

  it('draws a row per catalog object instead of one blank row', () => {
    withCatalog(catalog);
    expect(screen.getAllByTestId(/^matrix-name-cat-/)).toHaveLength(3);
  });

  it('grants each row in the schema it came from', () => {
    // The grid used to overwrite every row's schema with the single `schema`
    // prop, so a catalog spanning the database compiled to grants naming
    // objects in whichever schema the form happened to show — demo_a.orders
    // and demo_b.orders are different tables.
    const { onChange } = withCatalog(catalog);
    const ids = screen
      .getAllByTestId(/^matrix-name-cat-/)
      .map((el) => el.getAttribute('data-testid')!.replace('matrix-name-', ''));
    for (const id of ids) {
      fireEvent.click(screen.getByTestId(`matrix-cell-${id}-read`));
    }
    const schemas = latest(onChange)
      .map((r) => (r.scope as { schema?: string }).schema)
      .sort();
    expect(schemas).toEqual(['demo_a', 'demo_a', 'demo_b']);
  });

  it('names the schema on each row while the grid spans more than one', () => {
    withCatalog(catalog);
    const badges = screen.getAllByTestId(/^matrix-schema-/).map((el) => el.textContent);
    expect(badges.sort()).toEqual(['demo_a', 'demo_a', 'demo_b']);
  });

  it('says nothing about schema when every row shares one', () => {
    // On MySQL and Oracle there is no schema level at all; a badge repeating
    // the same word on every row is noise.
    withCatalog([{ schema: 'demo_a', name: 'orders', kind: 'table' as const }]);
    expect(screen.queryAllByTestId(/^matrix-schema-/)).toHaveLength(0);
  });

  it('applies a preset to every row, in the form each kind can express', () => {
    // The point of the grid is a whole database at once, and nobody ticks
    // "read only" across four hundred objects by hand. Each row takes only the
    // subset its own kind supports — "read and write" on a procedure means
    // EXECUTE, not four checkboxes the compiler would discard.
    const onChange = vi.fn<(r: PermissionRequest[]) => void>();
    const view = render(
      <PermissionMatrix
        dialect="postgres"
        principal={principal}
        action="grant"
        schema="app"
        catalog={[
          { schema: 'demo_a', name: 'orders', kind: 'table' as const },
          { schema: 'demo_a', name: 'sp_ship', kind: 'procedure' as const },
        ]}
        applyPreset={null}
        onChange={onChange}
      />
    );
    expect(latest(onChange)).toHaveLength(0);

    view.rerender(
      <PermissionMatrix
        dialect="postgres"
        principal={principal}
        action="grant"
        schema="app"
        catalog={[
          { schema: 'demo_a', name: 'orders', kind: 'table' as const },
          { schema: 'demo_a', name: 'sp_ship', kind: 'procedure' as const },
        ]}
        applyPreset={{ permissions: ['read', 'insert', 'execute-procedure'], nonce: 1 }}
        onChange={onChange}
      />
    );

    const granted = latest(onChange);
    expect(granted.length).toBeGreaterThan(0);
    const permissions = new Set(granted.flatMap((r) => r.permissions));
    expect(permissions.has('read')).toBe(true);
    expect(permissions.has('execute-procedure')).toBe(true);
  });

  it('keeps ticks made while the rest of the database was still loading', () => {
    // The loader commits one schema at a time, so the catalog grows under the
    // reader: they can tick demo_a's tables before demo_b has arrived. Each
    // commit reseeds the rows, and a reseed that rebuilt them empty would take
    // that work away seconds after they did it.
    const { onChange, view } = withCatalog([
      { schema: 'demo_a', name: 'orders', kind: 'table' as const },
    ]);
    const first = screen
      .getAllByTestId(/^matrix-name-cat-/)[0]!
      .getAttribute('data-testid')!
      .replace('matrix-name-', '');
    fireEvent.click(screen.getByTestId(`matrix-cell-${first}-read`));
    expect(latest(onChange)).toHaveLength(1);

    // demo_b lands: a different catalog, so the grid genuinely reseeds.
    view.rerender(
      <PermissionMatrix
        dialect="postgres"
        principal={principal}
        action="grant"
        schema="app"
        catalog={[
          { schema: 'demo_a', name: 'orders', kind: 'table' as const },
          { schema: 'demo_b', name: 'orders', kind: 'table' as const },
        ]}
        onChange={onChange}
      />
    );
    expect(screen.getAllByTestId(/^matrix-name-cat-/)).toHaveLength(2);
    const stillGranted = latest(onChange);
    expect(stillGranted, 'the tick was lost when the next schema arrived').toHaveLength(1);
    expect((stillGranted[0]!.scope as { schema?: string }).schema).toBe('demo_a');
  });
});
