/**
 * Flat-file import → temp SQLite credential for SQL Editor queries.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { Router, Request, Response } from 'express';
import type { AuthedRequest } from './auth.routes';
import { requirePermissions } from './rbac.middleware';
import { rateLimit } from './rate-limit';
import { ConnectionStore } from '../modules/connection-store.module';
import {
  isFileQueryConnectionName,
  isFileQueryDbPath,
  materializeFileToSqlite,
  removeFileQueryDb,
  type FileQueryFormat,
  type FileQueryImportInput,
  type TextOffsetColumn,
} from '../modules/file-query.module';

const nodeRequire = createRequire(import.meta.url);
const importLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

function asFormat(v: unknown): FileQueryFormat | null {
  return v === 'csv' || v === 'json' || v === 'text' ? v : null;
}

function listTablesInSqliteFile(dbPath: string): string[] {
  if (!dbPath || !existsSync(dbPath)) return [];
  try {
    const Database = nodeRequire('better-sqlite3');
    const Db = (Database.default ?? Database) as new (
      path: string,
      opts?: { readonly?: boolean; fileMustExist?: boolean }
    ) => {
      prepare: (sql: string) => { all: () => { name: string }[] };
      close: () => void;
    };
    const db = new Db(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
        )
        .all();
      return rows.map((r) => r.name);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

async function listFileImportConnections(connectionStore: ConnectionStore, userId: string) {
  const list = await connectionStore.list(userId);
  const out: {
    id: string;
    name: string;
    database?: string;
    createdAt: string;
    tables: string[];
  }[] = [];
  for (const c of list) {
    if (c.dialect !== 'sqlite') continue;
    if (!isFileQueryConnectionName(c.name) && !isFileQueryDbPath(c.database)) continue;
    const resolved = await connectionStore.resolve(userId, c.id);
    const dbPath = resolved?.option.connectionString || resolved?.option.database || c.database;
    out.push({
      id: c.id,
      name: c.name,
      database: dbPath,
      createdAt: c.createdAt,
      tables: dbPath ? listTablesInSqliteFile(dbPath) : [],
    });
  }
  return out;
}

/**
 * Remove prior Query-files credentials for this user (and their temp .db files).
 * Optionally keep one id (the newly created connection).
 */
async function clearPreviousFileImports(
  connectionStore: ConnectionStore,
  userId: string,
  keepId?: string
): Promise<{ removedConnectionIds: string[]; removedFiles: number }> {
  const list = await connectionStore.list(userId);
  const removedConnectionIds: string[] = [];
  let removedFiles = 0;
  for (const c of list) {
    if (keepId && c.id === keepId) continue;
    if (c.dialect !== 'sqlite') continue;
    if (!isFileQueryConnectionName(c.name) && !isFileQueryDbPath(c.database)) continue;
    const resolved = await connectionStore.resolve(userId, c.id);
    const dbPath = resolved?.option.connectionString || resolved?.option.database || c.database;
    const ok = await connectionStore.remove(userId, c.id);
    if (ok) {
      removedConnectionIds.push(c.id);
      if (dbPath && removeFileQueryDb(dbPath)) removedFiles++;
    }
  }
  return { removedConnectionIds, removedFiles };
}

export function createFileQueryRoutes(connectionStore: ConnectionStore): Router {
  const router = Router();

  /**
   * GET /api/files/imports — list reusable Query-files credentials + table names.
   */
  router.get(
    '/imports',
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as AuthedRequest).userId!;
        const imports = await listFileImportConnections(connectionStore, userId);
        res.json({ imports });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'List failed';
        res.status(500).json({ error: message });
      }
    }
  );

  /**
   * POST /api/files/import
   * Body: { format, fileName, content, tableName?, csv?, json?, text?, replacePrevious? }
   * → creates a temp SQLite DB + saved connection (dialect sqlite).
   * Keeps earlier imports by default so they stay reusable in the editor.
   */
  router.post(
    '/import',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as Partial<FileQueryImportInput> & {
          contentBase64?: string;
          /** When true, drop earlier Files: credentials + temp DBs. Default false. */
          replacePrevious?: boolean;
        };
        const format = asFormat(body.format);
        if (!format) {
          res.status(400).json({ error: 'format must be csv, json, or text' });
          return;
        }
        let content = typeof body.content === 'string' ? body.content : '';
        if (!content && typeof body.contentBase64 === 'string') {
          content = Buffer.from(body.contentBase64, 'base64').toString('utf8');
        }
        if (!content) {
          res.status(400).json({ error: 'content (or contentBase64) is required' });
          return;
        }

        const input: FileQueryImportInput = {
          format,
          fileName: String(body.fileName || 'data').slice(0, 240),
          content,
          tableName: body.tableName ? String(body.tableName) : undefined,
          csv: body.csv,
          json: body.json,
          text: body.text
            ? {
                skipLines: body.text.skipLines,
                columns: (body.text.columns || []) as TextOffsetColumn[],
              }
            : undefined,
        };

        const result = materializeFileToSqlite(input);
        const userId = (req as AuthedRequest).userId!;
        const connection = await connectionStore.create(userId, {
          name: result.connectionName,
          dialect: 'sqlite',
          schema: '',
          option: {
            database: result.dbPath,
            connectionString: result.dbPath,
            // SQLite ignores passwords; a stored placeholder keeps the SQL Editor
            // from opening the session-password modal when the credential is checked.
            password: 'file-query',
          },
          savePassword: true,
        });

        // Default keep prior imports so users can reuse them in the editor.
        const replacePrevious = body.replacePrevious === true;
        const cleared = replacePrevious
          ? await clearPreviousFileImports(connectionStore, userId, connection.id)
          : { removedConnectionIds: [] as string[], removedFiles: 0 };

        res.json({
          ok: true,
          connection,
          tableName: result.tableName,
          rowCount: result.rowCount,
          columns: result.columns,
          dbPath: result.dbPath,
          sampleSql: `SELECT * FROM "${result.tableName}" LIMIT 100;`,
          replacedPrevious: replacePrevious,
          removedConnectionIds: cleared.removedConnectionIds,
          removedFiles: cleared.removedFiles,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Import failed';
        res.status(400).json({ ok: false, error: message });
      }
    }
  );

  /**
   * DELETE /api/files/imports/:id — remove one Query-files credential + temp DB.
   */
  router.delete(
    '/imports/:id',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as AuthedRequest).userId!;
        const id = String(req.params.id || '');
        const resolved = await connectionStore.resolve(userId, id);
        if (!resolved || resolved.dialect !== 'sqlite') {
          res.status(404).json({ ok: false, error: 'File import not found' });
          return;
        }
        const dbPath = resolved.option.connectionString || resolved.option.database;
        const list = await connectionStore.list(userId);
        const meta = list.find((c) => c.id === id);
        if (!isFileQueryConnectionName(meta?.name) && !isFileQueryDbPath(dbPath)) {
          res.status(400).json({ ok: false, error: 'Not a Query-files import' });
          return;
        }
        const ok = await connectionStore.remove(userId, id);
        if (!ok) {
          res.status(404).json({ ok: false, error: 'File import not found' });
          return;
        }
        const removedFile = dbPath ? removeFileQueryDb(dbPath) : false;
        res.json({ ok: true, removedConnectionIds: [id], removedFiles: removedFile ? 1 : 0 });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Delete failed';
        res.status(500).json({ ok: false, error: message });
      }
    }
  );

  /**
   * DELETE /api/files/imports
   * Remove all Query-files credentials + temp DBs for the current user.
   */
  router.delete(
    '/imports',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as AuthedRequest).userId!;
        const cleared = await clearPreviousFileImports(connectionStore, userId);
        res.json({
          ok: true,
          removedConnectionIds: cleared.removedConnectionIds,
          removedFiles: cleared.removedFiles,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Clear failed';
        res.status(500).json({ ok: false, error: message });
      }
    }
  );

  return router;
}
