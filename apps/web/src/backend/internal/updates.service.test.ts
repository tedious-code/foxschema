import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  applyNpmGlobalUpdate,
  canSelfUpdate,
  clearUpdateCache,
  checkForUpdate,
  isNewer,
  parseUpdateFeed,
  resolveUpdateFeedUrl,
  scheduleUiRelaunch,
  DEFAULT_UPDATE_FEED_URL,
  NPM_PACKAGE,
} from './updates.service';

describe('updates.module (npm publish channel)', () => {
  beforeEach(() => {
    clearUpdateCache();
    delete process.env.UPDATE_FEED_URL;
    delete process.env.APP_VERSION;
    delete process.env.FOXSCHEMA_SELF_UPDATE;
    delete process.env.LOCAL_SINGLE_USER;
  });

  afterEach(() => {
    clearUpdateCache();
    delete process.env.UPDATE_FEED_URL;
    delete process.env.APP_VERSION;
    delete process.env.FOXSCHEMA_SELF_UPDATE;
    delete process.env.LOCAL_SINGLE_USER;
  });

  it('isNewer compares semver-ish dotted versions', () => {
    expect(isNewer('0.2.5', '0.2.4')).toBe(true);
    expect(isNewer('0.2.4', '0.2.4')).toBe(false);
    expect(isNewer('0.3.0', '0.2.9')).toBe(true);
  });

  it('defaults UPDATE_FEED_URL to npm registry latest', () => {
    expect(resolveUpdateFeedUrl({})).toBe(DEFAULT_UPDATE_FEED_URL);
    expect(DEFAULT_UPDATE_FEED_URL).toContain(NPM_PACKAGE);
  });

  it('allows disabling the feed with off/false/none', () => {
    expect(resolveUpdateFeedUrl({ UPDATE_FEED_URL: 'off' })).toBeNull();
    expect(resolveUpdateFeedUrl({ UPDATE_FEED_URL: 'false' })).toBeNull();
    expect(resolveUpdateFeedUrl({ UPDATE_FEED_URL: 'none' })).toBeNull();
  });

  it('parseUpdateFeed understands npm registry /latest JSON', () => {
    const parsed = parseUpdateFeed(
      {
        name: 'foxschema',
        version: '0.3.0',
        description: 'CLI release',
        homepage: 'https://foxschema.com',
      },
      DEFAULT_UPDATE_FEED_URL,
      '0.2.4'
    );
    expect(parsed.updateAvailable).toBe(true);
    expect(parsed.latest).toBe('0.3.0');
    // “What’s new” lands on the GitHub Release page (notes from docs/RELEASE_*.md).
    expect(parsed.url).toBe(
      'https://github.com/tedious-code/foxschema/releases/tag/v0.3.0'
    );
  });

  it('parseUpdateFeed understands GitHub releases JSON', () => {
    const parsed = parseUpdateFeed(
      {
        tag_name: 'v0.3.1',
        html_url: 'https://github.com/tedious-code/foxschema/releases/tag/v0.3.1',
        body: 'notes',
      },
      'https://api.github.com/repos/tedious-code/foxschema/releases/latest',
      '0.2.4'
    );
    expect(parsed.latest).toBe('0.3.1');
    expect(parsed.url).toContain('github.com');
    expect(parsed.notes).toBe('notes');
  });

  it('checkForUpdate hits the npm feed and reports an available update', async () => {
    process.env.APP_VERSION = '0.2.0';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'foxschema',
        version: '0.2.4',
        description: 'latest on npm',
      }),
    });
    const info = await checkForUpdate(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      DEFAULT_UPDATE_FEED_URL,
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(info.updateAvailable).toBe(true);
    expect(info.latest).toBe('0.2.4');
    expect(info.current).toBe('0.2.0');
    expect(info.configured).toBe(true);
  });

  it('checkForUpdate does not cache failures', async () => {
    process.env.APP_VERSION = '0.2.4';
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'foxschema', version: '0.2.4' }),
      });
    const fail = await checkForUpdate(fetchImpl as unknown as typeof fetch);
    expect(fail.updateAvailable).toBe(false);
    const ok = await checkForUpdate(fetchImpl as unknown as typeof fetch);
    expect(ok.latest).toBe('0.2.4');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('canSelfUpdate is opt-in via FOXSCHEMA_SELF_UPDATE (CLI open)', () => {
    expect(canSelfUpdate({})).toBe(false);
    expect(canSelfUpdate({ FOXSCHEMA_SELF_UPDATE: 'true' })).toBe(true);
    expect(canSelfUpdate({ FOXSCHEMA_SELF_UPDATE: 'false' })).toBe(false);
    expect(canSelfUpdate({ FOXSCHEMA_SELF_UPDATE: 'true', LOCAL_SINGLE_USER: 'false' })).toBe(
      true
    );
  });

  it('applyNpmGlobalUpdate runs npm install -g foxschema@latest', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    const spawnImpl = vi.fn().mockReturnValue(proc);
    const pending = applyNpmGlobalUpdate(spawnImpl as never);
    expect(spawnImpl).toHaveBeenCalledWith(
      'npm',
      ['install', '-g', 'foxschema@latest'],
      expect.any(Object)
    );
    proc.emit('close', 0);
    await expect(pending).resolves.toEqual({ ok: true, stdout: '', restarting: true });
  });

  it('scheduleUiRelaunch spawns foxschema open then exits', () => {
    vi.useFakeTimers();
    const spawnImpl = vi.fn().mockReturnValue({ unref: vi.fn() });
    const exitFn = vi.fn();
    scheduleUiRelaunch({ port: 3210, spawnImpl: spawnImpl as never, exitFn, delayMs: 10 });
    expect(spawnImpl).toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(exitFn).toHaveBeenCalledWith(0);
    vi.useRealTimers();
  });
});
