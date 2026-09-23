/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dateInputFromDraft, PeekDatePicker } from './PeekDatePicker';

const PRECISE_TIMESTAMP = '2024-03-05 14:30:45.123456+00';

describe('PeekDatePicker timestamp preservation', () => {
  it('projects the complete clock into date/time controls', () => {
    expect(dateInputFromDraft('timestamp', PRECISE_TIMESTAMP)).toBe('2024-03-05T14:30:45');
  });

  it('preserves untouched timestamp parts across calendar and time changes', () => {
    const onChange = vi.fn();
    render(
      <PeekDatePicker
        fieldName="created_at"
        kind="timestamp"
        value={PRECISE_TIMESTAMP}
        showError={false}
        onChange={onChange}
        onBlur={() => undefined}
      />
    );

    fireEvent.click(screen.getByTestId('peek-row-datepicker-created_at'));
    let popover = screen.getByTestId('peek-row-datepicker-pop-created_at');
    expect((screen.getByTestId('peek-row-time-created_at') as HTMLInputElement).value).toBe(
      '14:30:45'
    );
    fireEvent.click(within(popover).getByRole('button', { name: '5' }));
    expect(onChange).toHaveBeenLastCalledWith(PRECISE_TIMESTAMP);

    fireEvent.click(screen.getByTestId('peek-row-datepicker-created_at'));
    popover = screen.getByTestId('peek-row-datepicker-pop-created_at');
    fireEvent.click(within(popover).getByRole('button', { name: '6' }));
    expect(onChange).toHaveBeenLastCalledWith('2024-03-06 14:30:45.123456+00');

    fireEvent.click(screen.getByTestId('peek-row-datepicker-created_at'));
    fireEvent.change(screen.getByTestId('peek-row-time-created_at'), {
      target: { value: '15:31:30' },
    });
    expect(onChange).toHaveBeenLastCalledWith('2024-03-05 15:31:30.123456+00');
  });
});
