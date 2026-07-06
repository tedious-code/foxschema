import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import * as setup from '../../runtime/setup';
import { SetupRequiredScreen } from '../screens/SetupRequiredScreen';

// A real (not setTimeout(0)) delay for the one case where there's no content change to
// poll for: right after mount, before the first keystroke, Ink needs a tick to attach
// its input listener. vi.waitFor covers every other wait in this file, where an actual
// async outcome (state update, callback) can be asserted on directly.
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

describe('SetupRequiredScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a non-actionable message for key-unreachable (nothing a TUI screen can fix)', () => {
    const { lastFrame } = render(<SetupRequiredScreen reason="key-unreachable" onComplete={() => {}} />);
    expect(lastFrame()).toContain('Encryption key unavailable');
    expect(lastFrame()).toContain('fox setup');
  });

  it('runs performSetup() on a valid email and calls onComplete', async () => {
    const performSpy = vi.spyOn(setup, 'performSetup').mockReturnValue({
      cfg: { setupComplete: true, email: 'a@b.com', dbEngine: 'sqlite', dbPath: '/tmp/x.db', dbUrl: '', keyScheme: 'v2' },
      created: true,
    });
    const onComplete = vi.fn();

    const { stdin } = render(<SetupRequiredScreen reason="not-set-up" onComplete={onComplete} />);
    await wait();
    stdin.write('a@b.com');
    await wait();
    stdin.write('\r');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());

    expect(performSpy).toHaveBeenCalledWith('a@b.com');
  });

  it('shows an error and does not call onComplete for an invalid email', async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(<SetupRequiredScreen reason="not-set-up" onComplete={onComplete} />);
    await wait();
    stdin.write('not-an-email');
    await wait();
    stdin.write('\r');
    await vi.waitFor(() => expect(lastFrame()).toContain('valid email'));

    expect(onComplete).not.toHaveBeenCalled();
  });
});
