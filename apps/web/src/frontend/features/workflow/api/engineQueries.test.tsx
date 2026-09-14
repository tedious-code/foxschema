/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The engine read cache: screens share one request per key, a refresh fetches
 * again, and a failed refresh leaves the last good data on screen.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listCredentials = vi.fn();
vi.mock('./engineClient', () => ({ api: { listCredentials: () => listCredentials() } }));

// The cache is module state; each test gets a fresh copy.
let queries: typeof import('./engineQueries');

beforeEach(async () => {
  vi.resetModules();
  listCredentials.mockReset();
  queries = await import('./engineQueries');
});

afterEach(cleanup);

function Names({ testId }: { testId: string }) {
  const { credentials, refresh } = queries.useCredentials();
  return (
    <button data-testid={testId} onClick={refresh}>
      {credentials.map((credential) => credential.name).join(',')}
    </button>
  );
}

const meta = (name: string) => ({ id: name, name, kind: 'http' });

/** Long enough for a refetch loop to have fired several times. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));

describe('engine query cache', () => {
  it('serves two screens reading the same key from one request', async () => {
    listCredentials.mockResolvedValue([meta('pg-prod')]);

    render(
      <>
        <Names testId="a" />
        <Names testId="b" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('b').textContent).toBe('pg-prod'));
    expect(screen.getByTestId('a').textContent).toBe('pg-prod');
    await settle();
    // Once — not once per screen, and not again because the first one finished.
    expect(listCredentials).toHaveBeenCalledTimes(1);
  });

  it('fetches again on refresh and shows the new data everywhere', async () => {
    listCredentials.mockResolvedValueOnce([meta('old')]).mockResolvedValueOnce([meta('old'), meta('new')]);
    render(
      <>
        <Names testId="a" />
        <Names testId="b" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('old'));

    fireEvent.click(screen.getByTestId('a'));

    await waitFor(() => expect(screen.getByTestId('b').textContent).toBe('old,new'));
    await settle();
    expect(listCredentials).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good data when a refresh fails', async () => {
    listCredentials.mockResolvedValueOnce([meta('kept')]).mockRejectedValueOnce(new Error('engine down'));
    render(<Names testId="a" />);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('kept'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('a'));
    });

    await waitFor(() => expect(listCredentials).toHaveBeenCalledTimes(2));
    await settle();
    expect(screen.getByTestId('a').textContent).toBe('kept');
    // A failure is not retried in a loop; the next refresh tries again.
    expect(listCredentials).toHaveBeenCalledTimes(2);
  });
});
