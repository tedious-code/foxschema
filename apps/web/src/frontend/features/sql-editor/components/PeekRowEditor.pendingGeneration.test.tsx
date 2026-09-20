/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableSchema } from '@/shared/lib/types';
import { buildPeekInsert, draftToRowValues } from '@/features/sql-editor/lib/rowDml';
import type { PeekRowEditorSubmit } from './PeekRowEditor';

const generatePeekValueAsync = vi.hoisted(() => vi.fn());

vi.mock('@/features/sql-editor/lib/peekValueGenerators', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/sql-editor/lib/peekValueGenerators')>()),
  generatePeekValueAsync,
}));

import { PeekRowEditor } from './PeekRowEditor';

const table: TableSchema = {
  name: 'users',
  objectType: 'TABLE',
  columns: [{ name: 'name', type: 'text', nullable: false, primaryKey: false }],
  indices: [],
  foreignKeys: [],
};
const editTable: TableSchema = {
  name: 'users',
  objectType: 'TABLE',
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true },
    { name: 'name', type: 'text', nullable: false, primaryKey: false },
    { name: 'city', type: 'text', nullable: false, primaryKey: false },
  ],
  indices: [],
  foreignKeys: [],
  primaryKey: { columns: ['id'] },
};

describe('PeekRowEditor pending generation', () => {
  beforeEach(() => {
    generatePeekValueAsync.mockReset();
  });

  it('submits the draft snapshot captured by Preview when Generate is pending', async () => {
    let resolveGeneration!: (value: string) => void;
    generatePeekValueAsync.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveGeneration = resolve;
      })
    );
    let submitted: PeekRowEditorSubmit | undefined;

    render(
      <PeekRowEditor
        open
        mode="add"
        tableName="users"
        table={table}
        columns={['name']}
        dialect="postgres"
        draft={{ name: 'reviewed-value' }}
        keyNames={[]}
        identityColumns={new Set()}
        onCancel={() => undefined}
        onSubmit={(payload) => {
          submitted = payload;
        }}
      />
    );

    fireEvent.click(screen.getByTestId('peek-row-generate-all'));
    expect(generatePeekValueAsync).toHaveBeenCalledOnce();
    expect((screen.getByTestId('peek-row-submit') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('peek-row-submit'));
    const previewSql = screen.getByTestId('peek-row-preview-sql').textContent ?? '';
    const reviewedPlan = buildPeekInsert({
      tableName: 'users',
      dialect: 'postgres',
      values: { name: 'reviewed-value' },
    });
    if ('error' in reviewedPlan) throw new Error(reviewedPlan.error);

    await act(async () => {
      resolveGeneration('generated-after-preview');
    });
    await waitFor(() => expect(generatePeekValueAsync).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('peek-row-preview')).toBeTruthy();

    fireEvent.click(screen.getByTestId('peek-row-save'));
    expect(submitted).toBeDefined();
    const actualPlan = buildPeekInsert({
      tableName: 'users',
      dialect: 'postgres',
      values: draftToRowValues(['name'], submitted!.draft),
    });
    if ('error' in actualPlan) throw new Error(actualPlan.error);

    expect(submitted).toEqual({
      draft: { name: 'reviewed-value' },
      updateColumns: undefined,
      previewSql,
    });
    expect(reviewedPlan.params).toEqual(['reviewed-value']);
    expect(actualPlan.params).toEqual(reviewedPlan.params);
    expect(actualPlan.displaySql).toBe(previewSql);
  });

  it('submits the update-column snapshot captured while Generate continues', async () => {
    const resolvers: Array<(value: string) => void> = [];
    generatePeekValueAsync.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        })
    );
    let submitted: PeekRowEditorSubmit | undefined;

    render(
      <PeekRowEditor
        open
        mode="edit"
        tableName="users"
        table={editTable}
        columns={['id', 'name', 'city']}
        dialect="postgres"
        draft={{ id: '1', name: 'reviewed-name', city: 'reviewed-city' }}
        keyNames={['id']}
        identityColumns={new Set()}
        originalRow={[1, 'original-name', 'reviewed-city']}
        keyColumns={[{ name: 'id', resultIndex: 0 }]}
        onCancel={() => undefined}
        onSubmit={(payload) => {
          submitted = payload;
        }}
      />
    );

    fireEvent.click(screen.getByTestId('peek-row-generate-all'));
    expect(generatePeekValueAsync).toHaveBeenCalledOnce();

    await act(async () => {
      resolvers[0]!('generated-name');
    });
    await waitFor(() => expect(generatePeekValueAsync).toHaveBeenCalledTimes(2));
    expect((screen.getByTestId('peek-row-col-name') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('peek-row-col-city') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByTestId('peek-row-submit'));
    expect(screen.getByTestId('peek-row-preview').textContent).toContain('reviewed-name');

    await act(async () => {
      resolvers[1]!('generated-city');
    });
    fireEvent.click(screen.getByTestId('peek-row-save'));

    expect(submitted).toEqual({
      draft: { id: '1', name: 'reviewed-name', city: 'reviewed-city' },
      updateColumns: ['name'],
      previewSql: screen.getByTestId('peek-row-preview-sql').textContent,
    });
  });
});
