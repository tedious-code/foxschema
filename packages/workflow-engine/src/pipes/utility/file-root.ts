/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resolveDatabasePath } from '../../storage/database-path.js';

/** The environment variable that names the directory file pipes may touch. */
export const FILES_DIR_ENV = 'FOXFLOW_FILES_DIR';

/**
 * The one directory the file pipes (CSV/JSON/text sources, the CSV sink, the
 * preview route) read and write under.
 *
 * Designing a workflow is an editor-level permission. Without a root, a file
 * source configured with `/etc/passwd`, or a CSV sink appending to
 * `~/.ssh/authorized_keys`, ran as the engine's own user — an editor could
 * read or write anything the engine process could.
 *
 * `FOXFLOW_FILES_DIR` wins; otherwise `workflow-files/` beside the engine
 * database, which is where the rest of the engine's state already lives.
 */
export function workflowFilesRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[FILES_DIR_ENV];
  if (explicit) return resolve(explicit);
  const database = resolveDatabasePath(env.FOXFLOW_DB_PATH || undefined);
  const base = isAbsolute(database) ? dirname(database) : process.cwd();
  return join(base, 'workflow-files');
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  // `..` as a whole segment climbs out; a file merely named `..notes.csv` does not.
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The real path of `path`, or of its nearest existing ancestor plus the rest. */
async function realOrNearest(path: string): Promise<string> {
  let current = path;
  const rest: string[] = [];
  for (;;) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- resolving the path being confined, to check it stays inside the root
      const real = await realpath(current);
      return rest.length ? join(real, ...rest.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      rest.push(current.slice(parent.length).replace(/^[\\/]+/, ''));
      current = parent;
    }
  }
}

/**
 * Resolve a pipe's configured `path` inside the files root. A relative path is
 * taken from the root; an absolute one must already lie under it. Symlinks are
 * followed before the check, so a link inside the root cannot point out of it.
 */
export async function resolveWorkflowFile(
  path: string,
  root: string = workflowFilesRoot(),
): Promise<string> {
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, path);
  const realRoot = await realOrNearest(absoluteRoot);
  const realTarget = await realOrNearest(target);
  if (!inside(absoluteRoot, target) || !inside(realRoot, realTarget)) {
    throw new Error(
      `file path ${path} is outside the workflow files directory (${absoluteRoot}); ` +
        `use a path relative to it, or set ${FILES_DIR_ENV}`,
    );
  }
  return target;
}
