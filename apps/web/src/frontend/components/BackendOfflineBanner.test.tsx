import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { BackendOfflineBanner } from './BackendOfflineBanner';

/**
 * The banner exists because the UI and the API are separate processes: the API
 * can die while the page keeps rendering its last state, and every subsequent
 * action fails with its own unrelated-looking message.
 *
 * The edge cases below are the ones that decide whether this helps or annoys:
 * a single blip must not flash it, a hung (not dead) server must still trip it,
 * and it has to clear itself once the backend is back.
 */

const ok = (): Promise<Response> => Promise.resolve({ ok: true } as Response);
// Annotated: without it TS infers Promise<never> and refuses a later swap to `ok`.
const dead = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));

/** Drain the promise/timer interleaving the poll loop depends on. */
async function settle(ms = 0) {
  await act(async () => {
    if (ms) vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const banner = () => screen.queryByTestId('backend-offline-banner');

describe('BackendOfflineBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stays hidden while the backend answers', async () => {
    vi.stubGlobal('fetch', vi.fn(ok));
    render(<BackendOfflineBanner />);
    await settle();
    expect(banner()).toBeNull();
  });

  it('does not flash on a single failed probe', async () => {
    // One miss is a blip — a sleeping laptop, a rebuild, a dropped packet.
    const fetchMock = vi.fn(dead);
    vi.stubGlobal('fetch', fetchMock);
    render(<BackendOfflineBanner />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(banner()).toBeNull();
  });

  it('appears once failures are consistent', async () => {
    vi.stubGlobal('fetch', vi.fn(dead));
    render(<BackendOfflineBanner />);
    await settle();
    await settle(3_000);
    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toMatch(/Stop Fox Schema and start it again/);
  });

  it('treats a non-OK status as down, not just a rejected fetch', async () => {
    // A 502 from a proxy in front of a dead API never rejects.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false } as Response)));
    render(<BackendOfflineBanner />);
    await settle();
    await settle(3_000);
    expect(banner()).not.toBeNull();
  });

  it('trips on a hung server that never responds', async () => {
    // fetch to a listening-but-stuck server never settles on its own; the
    // probe aborts it, which is the whole reason for the timeout.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }) as Promise<Response>
      )
    );
    render(<BackendOfflineBanner />);
    await settle(5_000);
    await settle(3_000);
    await settle(5_000);
    expect(banner()).not.toBeNull();
  });

  it('clears itself when the backend comes back', async () => {
    const fetchMock = vi.fn(dead);
    vi.stubGlobal('fetch', fetchMock);
    render(<BackendOfflineBanner />);
    await settle();
    await settle(3_000);
    expect(banner()).not.toBeNull();

    fetchMock.mockImplementation(ok);
    await settle(3_000);
    expect(banner()).toBeNull();
  });

  it('recovers a single success streak — one good probe is enough to clear', async () => {
    // Asymmetric on purpose: slow to alarm, quick to forgive.
    const fetchMock = vi.fn(dead);
    vi.stubGlobal('fetch', fetchMock);
    render(<BackendOfflineBanner />);
    await settle();
    await settle(3_000);
    expect(banner()).not.toBeNull();

    fetchMock.mockImplementationOnce(ok).mockImplementation(dead);
    await settle(3_000);
    expect(banner()).toBeNull();
  });

  it('stops polling after unmount', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<BackendOfflineBanner />);
    await settle();
    const calls = fetchMock.mock.calls.length;
    unmount();
    await settle(60_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('probes with no-store so a cached 200 cannot mask an outage', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    render(<BackendOfflineBanner />);
    await settle();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/health$/);
    expect(init.cache).toBe('no-store');
  });
});
