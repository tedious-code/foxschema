/**
 * Runtime investigation for a pending Generate operation crossing the Preview
 * boundary. This intentionally records the current unsafe behaviour; it is not
 * the fix.
 */
import { appendFileSync } from 'node:fs';
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

const LOG = '/opt/cursor/logs/debug.log';
const table: TableSchema = {
  name: 'users',
  objectType: 'TABLE',
  columns: [{ name: 'name', type: 'text', nullable: false, primaryKey: false }],
  indices: [],
  foreignKeys: [],
};

function writeLog(entry: {
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
}): void {
  appendFileSync(LOG, `${JSON.stringify({ ...entry, timestamp: Date.now() })}\n`);
}

describe('PeekRowEditor pending Generate runtime investigation', () => {
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
          // #region agent log
          writeLog({
            hypothesisId: 'B,D',
            location: 'PeekRowEditor.pendingGeneration.test.tsx:onSubmit',
            message: 'Save submitted payload',
            data: { draft: payload.draft, previewSql: payload.previewSql },
          });
          // #endregion
        }}
      />
    );

    fireEvent.click(screen.getByTestId('peek-row-generate-all'));
    // #region agent log
    writeLog({
      hypothesisId: 'A,E',
      location: 'PeekRowEditor.pendingGeneration.test.tsx:after-generate-click',
      message: 'Generate pending while Preview remains enabled',
      data: {
        generatorCalls: generatePeekValueAsync.mock.calls.length,
        previewDisabled: (screen.getByTestId('peek-row-submit') as HTMLButtonElement).disabled,
      },
    });
    // #endregion

    fireEvent.click(screen.getByTestId('peek-row-submit'));
    const previewSql = screen.getByTestId('peek-row-preview-sql').textContent ?? '';
    const reviewedPlan = buildPeekInsert({
      tableName: 'users',
      dialect: 'postgres',
      values: { name: 'reviewed-value' },
    });
    if ('error' in reviewedPlan) throw new Error(reviewedPlan.error);
    // #region agent log
    writeLog({
      hypothesisId: 'C',
      location: 'PeekRowEditor.pendingGeneration.test.tsx:after-preview-click',
      message: 'Preview captured before generation resolved',
      data: { previewSql, reviewedParams: reviewedPlan.params },
    });
    // #endregion

    await act(async () => {
      resolveGeneration('generated-after-preview');
    });
    await waitFor(() => expect(generatePeekValueAsync).toHaveBeenCalledOnce());
    // #region agent log
    writeLog({
      hypothesisId: 'A,C',
      location: 'PeekRowEditor.pendingGeneration.test.tsx:after-generation-resolve',
      message: 'Generation resolved while Preview stayed open',
      data: {
        previewStillOpen: Boolean(screen.queryByTestId('peek-row-preview')),
        previewSql: screen.getByTestId('peek-row-preview-sql').textContent,
      },
    });
    // #endregion

    fireEvent.click(screen.getByTestId('peek-row-save'));
    expect(submitted).toBeDefined();
    const actualPlan = buildPeekInsert({
      tableName: 'users',
      dialect: 'postgres',
      values: draftToRowValues(['name'], submitted!.draft),
    });
    if ('error' in actualPlan) throw new Error(actualPlan.error);
    // #region agent log
    writeLog({
      hypothesisId: 'D',
      location: 'PeekRowEditor.pendingGeneration.test.tsx:reconstructed-write',
      message: 'Downstream write reconstructed from submitted draft',
      data: {
        reviewedParams: reviewedPlan.params,
        actualParams: actualPlan.params,
        sqlMatchesPreview: actualPlan.displaySql === submitted!.previewSql,
      },
    });
    // #endregion

    expect(submitted).toEqual({
      draft: { name: 'reviewed-value' },
      updateColumns: undefined,
      previewSql,
    });
    expect(reviewedPlan.params).toEqual(['reviewed-value']);
    expect(actualPlan.params).toEqual(reviewedPlan.params);
    expect(actualPlan.displaySql).toBe(previewSql);
  });
});
