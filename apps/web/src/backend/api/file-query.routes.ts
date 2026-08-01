/**
 * Flat-file import → temp SQLite workspace and/or saved credential (any dialect).
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { Router, Request, Response } from 'express';
import type { AuthedRequest } from './auth.routes';
import { requirePermissions } from './rbac.middleware';
import { rateLimit } from './rate-limit';
import { ConnectionStore } from '../modules/connection-store.module';
import {
  appendFileToSqliteWorkspace,
  isFileQueryConnectionName,
  isFileQueryDbPath,
  materializeFileToSqlite,
  MAX_CONTENT_CHARS,
  parseFileToTable,
  removeFileQueryDb,
  type FileQueryFormat,
  type FileQueryImportInput,
  type TextOffsetColumn,
} from '../modules/file-query.module';
import { bulkLoadIntoConnection } from '../modules/file-query-bulk.module';
import {
  abortUploadSession,
  appendUploadChunk,
  completeUploadSession,
  createUploadSession,
  getUploadSession,
  MAX_UPLOAD_BYTES,
  sessionToImportInput,
} from '../modules/file-query-session.module';

const nodeRequire = createRequire(import.meta.url);
const importLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

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

function parseImportBody(body: Record<string, unknown>): {
  input: FileQueryImportInput;
  replacePrevious: boolean;
  targetConnectionId?: string;
  workspaceConnectionId?: string;
  workspaceName?: string;
  replaceTable: boolean;
} {
  const format = asFormat(body.format);
  if (!format) throw new Error('format must be csv, json, or text');
  let content = typeof body.content === 'string' ? body.content : '';
  if (!content && typeof body.contentBase64 === 'string') {
    content = Buffer.from(body.contentBase64, 'base64').toString('utf8');
  }
  if (!content) throw new Error('content (or contentBase64) is required');

  const text = body.text as FileQueryImportInput['text'] | undefined;
  return {
    input: {
      format,
      fileName: String(body.fileName || 'data').slice(0, 240),
      content,
      tableName: body.tableName ? String(body.tableName) : undefined,
      csv: body.csv as FileQueryImportInput['csv'],
      json: body.json as FileQueryImportInput['json'],
      text: text
        ? {
            skipLines: text.skipLines,
            columns: (text.columns || []) as TextOffsetColumn[],
          }
        : undefined,
    },
    replacePrevious: body.replacePrevious === true,
    targetConnectionId: body.targetConnectionId
      ? String(body.targetConnectionId)
      : undefined,
    workspaceConnectionId: body.workspaceConnectionId
      ? String(body.workspaceConnectionId)
      : undefined,
    workspaceName: body.workspaceName ? String(body.workspaceName).slice(0, 120) : undefined,
    replaceTable: body.replaceTable === true,
  };
}

async function resolveWorkspaceDbPath(
  connectionStore: ConnectionStore,
  userId: string,
  workspaceConnectionId: string
): Promise<{ connectionId: string; dbPath: string; name: string }> {
  const resolved = await connectionStore.resolve(userId, workspaceConnectionId);
  if (!resolved || resolved.dialect !== 'sqlite') {
    throw new Error('Workspace connection not found');
  }
  const dbPath = resolved.option.connectionString || resolved.option.database;
  if (!dbPath || !isFileQueryDbPath(dbPath)) {
    throw new Error('Not a Query-files workspace');
  }
  const list = await connectionStore.list(userId);
  const meta = list.find((c) => c.id === workspaceConnectionId);
  return {
    connectionId: workspaceConnectionId,
    dbPath,
    name: meta?.name || 'Files: workspace',
  };
}

export function createFileQueryRoutes(connectionStore: ConnectionStore): Router {
  const router = Router();

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
   * Small paste / JSON body import.
   * - default: new temp SQLite Files credential
   * - workspaceConnectionId: add table to existing Files DB
   * - targetConnectionId: bulk-load into a saved credential (any dialect)
   */
  router.post(
    '/import',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as AuthedRequest).userId!;
        const parsed = parseImportBody(req.body as Record<string, unknown>);
        const result = await runImport(connectionStore, userId, parsed);
        res.json(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Import failed';
        res.status(400).json({ ok: false, error: message });
      }
    }
  );

  /** Start a disk-backed chunked upload (large files). */
  router.post(
    '/sessions',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as AuthedRequest).userId!;
        const body = req.body as Record<string, unknown>;
        const format = asFormat(body.format);
        if (!format) {
          res.status(400).json({ ok: false, error: 'format must be csv, json, or text' });
          return;
        }
        const session = createUploadSession(userId, {
          format,
          fileName: String(body.fileName || 'data').slice(0, 240),
          tableName: body.tableName ? String(body.tableName) : undefined,
          csv: body.csv as FileUploadCsv,
          json: body.json as FileUploadJson,
          text: body.text as FileUploadText,
          targetConnectionId: body.targetConnectionId
            ? String(body.targetConnectionId)
            : undefined,
          workspaceConnectionId: body.workspaceConnectionId
            ? String(body.workspaceConnectionId)
            : undefined,
          workspaceName: body.workspaceName
            ? String(body.workspaceName).slice(0, 120)
            : undefined,
          replaceTable: body.replaceTable === true,
        });
        res.json({
          ok: true,
          sessionId: session.id,
          maxBytes: MAX_UPLOAD_BYTES,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Session create failed';
        res.status(400).json({ ok: false, error: message });
      }
    }
  );

  /** Append a UTF-8 or base64 chunk to an upload session. */
  router.put(
    '/sessions/:id/chunk',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as AuthedRequest).userId!;
        const id = String(req.params.id || '');
        const body = req.body as { data?: string; encoding?: 'utf8' | 'base64' };
        if (typeof body.data !== 'string' || !body.data) {
          res.status(400).json({ ok: false, error: 'data is required' });
          return;
        }
        const buf =
          body.encoding === 'base64'
            ? Buffer.from(body.data, 'base64')
            : Buffer.from(body.data, 'utf8');
        const session = appendUploadChunk(userId, id, buf);
        res.json({ ok: true, bytes: session.bytes, maxBytes: MAX_UPLOAD_BYTES });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Chunk failed';
        res.status(400).json({ ok: false, error: message });
      }
    }
  );

  /** Finalize chunked upload → same import pipeline as POST /import. */
  router.post(
    '/sessions/:id/commit',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as AuthedRequest).userId!;
        const id = String(req.params.id || '');
        const session = getUploadSession(userId, id);
        if (!session) {
          res.status(404).json({ ok: false, error: 'Upload session not found or expired' });
          return;
        }
        const input = sessionToImportInput(userId, id);
        const body = (req.body || {}) as Record<string, unknown>;
        const result = await runImport(connectionStore, userId, {
          input,
          replacePrevious: body.replacePrevious === true,
          targetConnectionId: session.targetConnectionId,
          workspaceConnectionId: session.workspaceConnectionId,
          workspaceName: session.workspaceName,
          replaceTable: session.replaceTable === true,
          maxChars: MAX_UPLOAD_BYTES,
        });
        completeUploadSession(userId, id);
        res.json(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Commit failed';
        res.status(400).json({ ok: false, error: message });
      }
    }
  );

  router.delete(
    '/sessions/:id',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      const userId = (req as AuthedRequest).userId!;
      const ok = abortUploadSession(userId, String(req.params.id || ''));
      res.json({ ok });
    }
  );

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

type FileUploadCsv = FileQueryImportInput['csv'];
type FileUploadJson = FileQueryImportInput['json'];
type FileUploadText = FileQueryImportInput['text'];

async function runImport(
  connectionStore: ConnectionStore,
  userId: string,
  parsed: {
    input: FileQueryImportInput;
    replacePrevious: boolean;
    targetConnectionId?: string;
    workspaceConnectionId?: string;
    workspaceName?: string;
    replaceTable: boolean;
    maxChars?: number;
  }
) {
  const maxChars = parsed.maxChars ?? MAX_CONTENT_CHARS;

  // --- Remote / saved credential target (dialect bulk) ---
  if (parsed.targetConnectionId) {
    const resolved = await connectionStore.resolve(userId, parsed.targetConnectionId);
    if (!resolved) throw new Error('Target credential not found');
    const table = parseFileToTable(parsed.input, { maxChars });
    const load = await bulkLoadIntoConnection({
      dialect: resolved.dialect,
      option: resolved.option,
      tableName: table.tableName,
      columns: table.columns,
      matrix: table.matrix,
      types: table.types,
      replaceTable: parsed.replaceTable,
    });
    const list = await connectionStore.list(userId);
    const connection = list.find((c) => c.id === parsed.targetConnectionId);
    return {
      ok: true,
      mode: 'credential' as const,
      connection,
      connectionId: parsed.targetConnectionId,
      tableName: table.tableName,
      rowCount: load.rowCount,
      columns: table.columns,
      chunks: load.chunks,
      dialect: resolved.dialect,
      sampleSql: `SELECT * FROM "${table.tableName.replace(/"/g, '""')}" LIMIT 100;`,
      replacedPrevious: false,
      removedConnectionIds: [] as string[],
      removedFiles: 0,
    };
  }

  // --- Append to existing Files workspace ---
  if (parsed.workspaceConnectionId) {
    const ws = await resolveWorkspaceDbPath(
      connectionStore,
      userId,
      parsed.workspaceConnectionId
    );
    const appended = appendFileToSqliteWorkspace(ws.dbPath, parsed.input, {
      maxChars,
      replaceTable: parsed.replaceTable,
    });
    const list = await connectionStore.list(userId);
    const connection = list.find((c) => c.id === ws.connectionId);
    return {
      ok: true,
      mode: 'workspace' as const,
      connection,
      connectionId: ws.connectionId,
      tableName: appended.tableName,
      rowCount: appended.rowCount,
      columns: appended.columns,
      sampleSql: `SELECT * FROM "${appended.tableName.replace(/"/g, '""')}" LIMIT 100;`,
      replacedPrevious: false,
      removedConnectionIds: [] as string[],
      removedFiles: 0,
    };
  }

  // --- New temp SQLite workspace ---
  const workspaceLabel =
    parsed.workspaceName?.trim() ||
    (parsed.input.fileName || parsed.input.tableName || 'workspace')
      .split(/[/\\]/)
      .pop() ||
    'workspace';
  const result = materializeFileToSqlite(parsed.input, {
    maxChars,
    connectionName: `Files: ${workspaceLabel}`,
  });
  const connection = await connectionStore.create(userId, {
    name: result.connectionName,
    dialect: 'sqlite',
    schema: '',
    option: {
      database: result.dbPath,
      connectionString: result.dbPath,
      password: 'file-query',
    },
    savePassword: true,
  });

  const cleared = parsed.replacePrevious
    ? await clearPreviousFileImports(connectionStore, userId, connection.id)
    : { removedConnectionIds: [] as string[], removedFiles: 0 };

  return {
    ok: true,
    mode: 'workspace' as const,
    connection,
    connectionId: connection.id,
    tableName: result.tableName,
    rowCount: result.rowCount,
    columns: result.columns,
    dbPath: result.dbPath,
    sampleSql: `SELECT * FROM "${result.tableName}" LIMIT 100;`,
    replacedPrevious: parsed.replacePrevious,
    removedConnectionIds: cleared.removedConnectionIds,
    removedFiles: cleared.removedFiles,
  };
}
