import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Exercise path helpers without starting a real server.
describe('CLI UI launcher paths', () => {
  const prev = { ...process.env };
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `foxschema-test-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    process.env.FOXSCHEMA_STATIC_DIR = dir;
  });

  afterEach(() => {
    process.env = { ...prev };
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolveStaticDir prefers FOXSCHEMA_STATIC_DIR', async () => {
    const { resolveStaticDir } = await import('../resolvePaths');
    expect(resolveStaticDir()).toBe(dir);
    expect(existsSync(join(resolveStaticDir(), 'index.html'))).toBe(true);
  });
});

describe('DEFAULT_UI_PORT', () => {
  it('is 3210', async () => {
    const { DEFAULT_UI_PORT } = await import('../paths');
    expect(DEFAULT_UI_PORT).toBe(3210);
  });
});
