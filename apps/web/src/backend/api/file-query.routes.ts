/**
 * Flat-file import → temp SQLite credential for SQL Editor queries.
 */
import { Router, Request, Response } from 'express';
import type { AuthedRequest } from './auth.routes';
import { requirePermissions } from './rbac.middleware';
import { rateLimit } from './rate-limit';
import { ConnectionStore } from '../modules/connection-store.module';
import {
  materializeFileToSqlite,
  type FileQueryFormat,
  type FileQueryImportInput,
  type TextOffsetColumn,
} from '../modules/file-query.module';

const importLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

function asFormat(v: unknown): FileQueryFormat | null {
  return v === 'csv' || v === 'json' || v === 'text' ? v : null;
}

export function createFileQueryRoutes(connectionStore: ConnectionStore): Router {
  const router = Router();

  /**
   * POST /api/files/import
   * Body: { format, fileName, content, tableName?, csv?, json?, text? }
   * → creates a temp SQLite DB + saved connection (dialect sqlite).
   */
  router.post(
    '/import',
    importLimiter,
    requirePermissions('editor.access'),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as Partial<FileQueryImportInput> & {
          contentBase64?: string;
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

        res.json({
          ok: true,
          connection,
          tableName: result.tableName,
          rowCount: result.rowCount,
          columns: result.columns,
          dbPath: result.dbPath,
          sampleSql: `SELECT * FROM "${result.tableName}" LIMIT 100;`,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Import failed';
        res.status(400).json({ ok: false, error: message });
      }
    }
  );

  return router;
}
