/**
 * Disk-backed chunked upload sessions for large Query-files imports.
 * Chunks append to a temp file; commit parses + bulk-loads.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  fileQueryTempDir,
  type FileQueryFormat,
  type FileQueryImportInput,
  type TextOffsetColumn,
} from './file-query.module';

export type FileUploadSession = {
  id: string;
  userId: string;
  format: FileQueryFormat;
  fileName: string;
  tableName?: string;
  csv?: { delimiter?: string; hasHeader?: boolean };
  json?: { mode?: 'array' | 'ndjson' };
  text?: { skipLines?: number; columns: TextOffsetColumn[] };
  /** Import into an existing saved credential (any dialect). */
  targetConnectionId?: string;
  /** Append a table to an existing Files: SQLite workspace. */
  workspaceConnectionId?: string;
  workspaceName?: string;
  replaceTable?: boolean;
  uploadPath: string;
  bytes: number;
  createdAt: number;
};

const SESSION_TTL_MS = 60 * 60 * 1000;
/** Assembled upload size cap (disk). */
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

const sessions = new Map<string, FileUploadSession>();

function uploadsDir(): string {
  const dir = join(fileQueryTempDir(), 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupStaleUploadSessions(now = Date.now()): number {
  let removed = 0;
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      try {
        unlinkSync(s.uploadPath);
      } catch {
        /* ignore */
      }
      sessions.delete(id);
      removed++;
    }
  }
  return removed;
}

export function createUploadSession(
  userId: string,
  meta: {
    format: FileQueryFormat;
    fileName: string;
    tableName?: string;
    csv?: FileUploadSession['csv'];
    json?: FileUploadSession['json'];
    text?: FileUploadSession['text'];
    targetConnectionId?: string;
    workspaceConnectionId?: string;
    workspaceName?: string;
    replaceTable?: boolean;
  }
): FileUploadSession {
  cleanupStaleUploadSessions();
  const id = randomUUID();
  const uploadPath = join(uploadsDir(), `${id}.part`);
  writeFileSync(uploadPath, '');
  const session: FileUploadSession = {
    id,
    userId,
    format: meta.format,
    fileName: meta.fileName,
    tableName: meta.tableName,
    csv: meta.csv,
    json: meta.json,
    text: meta.text,
    targetConnectionId: meta.targetConnectionId,
    workspaceConnectionId: meta.workspaceConnectionId,
    workspaceName: meta.workspaceName,
    replaceTable: meta.replaceTable,
    uploadPath,
    bytes: 0,
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

export function getUploadSession(userId: string, id: string): FileUploadSession | null {
  const s = sessions.get(id);
  if (!s || s.userId !== userId) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    abortUploadSession(userId, id);
    return null;
  }
  return s;
}

export function appendUploadChunk(userId: string, id: string, chunk: Buffer | string): FileUploadSession {
  const s = getUploadSession(userId, id);
  if (!s) throw new Error('Upload session not found or expired');
  const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
  if (s.bytes + buf.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Upload too large (max ${MAX_UPLOAD_BYTES} bytes). Use a smaller file or split it.`);
  }
  appendFileSync(s.uploadPath, buf);
  s.bytes += buf.length;
  return s;
}

export function readUploadSessionContent(userId: string, id: string): string {
  const s = getUploadSession(userId, id);
  if (!s) throw new Error('Upload session not found or expired');
  if (!existsSync(s.uploadPath)) throw new Error('Upload data missing');
  return readFileSync(s.uploadPath, 'utf8');
}

export function sessionToImportInput(userId: string, id: string): FileQueryImportInput {
  const s = getUploadSession(userId, id);
  if (!s) throw new Error('Upload session not found or expired');
  return {
    format: s.format,
    fileName: s.fileName,
    content: readUploadSessionContent(userId, id),
    tableName: s.tableName,
    csv: s.csv,
    json: s.json,
    text: s.text,
  };
}

export function abortUploadSession(userId: string, id: string): boolean {
  const s = sessions.get(id);
  if (!s || s.userId !== userId) return false;
  try {
    unlinkSync(s.uploadPath);
  } catch {
    /* ignore */
  }
  sessions.delete(id);
  return true;
}

export function completeUploadSession(userId: string, id: string): FileUploadSession | null {
  const s = getUploadSession(userId, id);
  if (!s) return null;
  try {
    unlinkSync(s.uploadPath);
  } catch {
    /* ignore */
  }
  sessions.delete(id);
  return s;
}
