import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  abortUploadSession,
  appendUploadChunk,
  createUploadSession,
  sweepOrphanedUploadFiles,
} from './files/file-session.service';
import { fileQueryTempDir } from './files/file-query.service';

/**
 * `fileQueryTempDir()` creates its own directory but not the `uploads` child —
 * the module's private helper does that, and nothing here calls it before the
 * first orphan is written. Without the mkdir this file passes only when an
 * earlier run left the directory behind, and fails on a cold checkout.
 */
const uploadsDir = () => {
  const dir = join(fileQueryTempDir(), 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
};
const made: string[] = [];

/** A .part file no session knows about, aged past the keep window. */
function orphan(name: string, ageMs: number): string {
  const full = join(uploadsDir(), name);
  writeFileSync(full, 'x');
  const when = new Date(Date.now() - ageMs);
  utimesSync(full, when, when);
  made.push(full);
  return full;
}

afterEach(() => {
  for (const f of made.splice(0)) {
    try {
      unlinkSync(f);
    } catch {
      /* already swept */
    }
  }
});

describe('sweepOrphanedUploadFiles', () => {
  it('removes a .part file left behind by a dead process', () => {
    // The case that motivated this: sessions live in memory, so after a restart
    // nothing references the file and the TTL sweep can never see it.
    const stale = orphan(`sweep-stale-${Date.now()}.part`, 2 * 60 * 60 * 1000);
    expect(existsSync(stale)).toBe(true);

    expect(sweepOrphanedUploadFiles()).toBeGreaterThanOrEqual(1);
    expect(existsSync(stale)).toBe(false);
  });

  it('leaves a live session alone no matter how old the file looks', () => {
    // Ages the file past the window but keeps the session — the guard has to be
    // ownership, not just mtime, or a long upload gets its data deleted mid-flight.
    const s = createUploadSession('u1', { format: 'csv', fileName: 'live.csv' });
    appendUploadChunk('u1', s.id, 'a,b\n1,2\n');
    const when = new Date(Date.now() - 5 * 60 * 60 * 1000);
    utimesSync(s.uploadPath, when, when);

    sweepOrphanedUploadFiles();

    expect(existsSync(s.uploadPath)).toBe(true);
    abortUploadSession('u1', s.id);
  });

  it('leaves a recent orphan alone (another process may be writing it)', () => {
    const fresh = orphan(`sweep-fresh-${Date.now()}.part`, 0);
    sweepOrphanedUploadFiles();
    expect(existsSync(fresh)).toBe(true);
  });

  it('ignores files that are not .part', () => {
    const keep = join(uploadsDir(), `sweep-keep-${Date.now()}.db`);
    writeFileSync(keep, 'x');
    const when = new Date(Date.now() - 5 * 60 * 60 * 1000);
    utimesSync(keep, when, when);
    made.push(keep);

    sweepOrphanedUploadFiles();

    expect(existsSync(keep)).toBe(true);
  });

  it('is safe to run when the directory is empty', () => {
    for (const n of readdirSync(uploadsDir())) {
      if (n.endsWith('.part')) {
        try {
          unlinkSync(join(uploadsDir(), n));
        } catch {
          /* ignore */
        }
      }
    }
    expect(sweepOrphanedUploadFiles()).toBe(0);
  });
});
