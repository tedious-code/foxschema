import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { MainMenuScreen } from '../screens/MainMenuScreen';

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

describe('MainMenuScreen', () => {
  it('shows all five choices', () => {
    const { lastFrame } = render(<MainMenuScreen onChoose={() => {}} />);
    const frame = lastFrame();
    expect(frame).toContain('Compare two schemas');
    expect(frame).toContain('Migrate source');
    expect(frame).toContain('Manage saved connections');
    expect(frame).toContain('Migration history');
    expect(frame).toContain('Quit');
  });

  it('calls onChoose with "compare" for the pre-selected first item on enter', async () => {
    const onChoose = vi.fn();
    const { stdin } = render(<MainMenuScreen onChoose={onChoose} />);
    await wait();
    stdin.write('\r');
    await vi.waitFor(() => expect(onChoose).toHaveBeenCalledWith('compare'));
  });

  it('calls onChoose with "migrate" after moving down once', async () => {
    const onChoose = vi.fn();
    const { stdin } = render(<MainMenuScreen onChoose={onChoose} />);
    await wait();
    stdin.write('\x1b[B'); // down arrow
    await wait();
    stdin.write('\r');
    await vi.waitFor(() => expect(onChoose).toHaveBeenCalledWith('migrate'));
  });
});
