import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/api/schemaApi', () => ({
  checkDriver: vi.fn().mockResolvedValue({ installed: true }),
  fetchSchemaList: vi.fn().mockResolvedValue([]),
  installDriver: vi.fn().mockResolvedValue(undefined),
}));

import { ConnectionModal } from './ConnectionModal';

describe('ConnectionModal', () => {
  it('verifies Azure SQL server certificates by default', () => {
    const onSave = vi.fn();

    render(
      <ConnectionModal
        open
        dialect="postgres"
        onClose={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByTestId('conn-dialect-select'), {
      target: { value: 'azuresql' },
    });
    fireEvent.click(screen.getByTestId('conn-save-btn'));

    expect(onSave).toHaveBeenCalledOnce();
    const [options, dialect] = onSave.mock.calls[0];
    expect(dialect).toBe('azuresql');
    expect(options.ssl).toMatchObject({
      enabled: true,
      rejectUnauthorized: true,
    });
    expect(options.connectionString).not.toContain('TrustServerCertificate=True');
  });
});
