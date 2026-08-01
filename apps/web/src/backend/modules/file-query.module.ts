/**
 * Flat-file → temporary SQLite materializer.
 *
 * Formats: CSV, JSON (array / NDJSON), fixed-width text (column offsets).
 * Produces a .db file under the OS temp dir so the existing sqlite dialect /
 * SQL Editor can query it without a new provider registry entry.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const nodeRequire = createRequire(import.meta.url);

export type FileQueryFormat = 'csv' | 'json' | 'text';

export type TextOffsetColumn = {
  name: string;
  /** 0-based start index (inclusive). */
  start: number;
  /** Character length. */
  length: number;
};

export type FileQueryImportInput = {
  format: FileQueryFormat;
  fileName: string;
  /** UTF-8 file contents (client sends text / decoded bytes). */
  content: string;
  tableName?: string;
  csv?: { delimiter?: string; hasHeader?: boolean };
  json?: { mode?: 'array' | 'ndjson' };
  text?: { skipLines?: number; columns: TextOffsetColumn[] };
};

export type FileQueryImportResult = {
  dbPath: string;
  tableName: string;
  rowCount: number;
  columns: string[];
  /** Suggested connection display name. */
  connectionName: string;
};

/** In-request JSON / paste path. Larger files should use chunked upload sessions. */
export const MAX_CONTENT_CHARS = 8_000_000;
export const MAX_ROWS = 500_000;
const TTL_MS = 24 * 60 * 60 * 1000;
/** Multi-row VALUES batch size for local SQLite materialize. */
const SQLITE_INSERT_BATCH = 200;

export function fileQueryTempDir(): string {
  const dir = join(tmpdir(), 'foxschema-file-query');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** True when a connection path is one of our temp file-query SQLite DBs. */
export function isFileQueryDbPath(path: string | undefined | null): boolean {
  if (!path) return false;
  const dir = fileQueryTempDir();
  // Normalize for path prefix checks across platforms.
  const norm = path.replace(/\\/g, '/');
  const root = dir.replace(/\\/g, '/');
  return norm.startsWith(`${root}/`) || norm.startsWith(`${root}`);
}

/** Best-effort delete of a temp file-query DB. */
export function removeFileQueryDb(path: string): boolean {
  if (!isFileQueryDbPath(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Drop temp DBs older than TTL (best-effort). */
export function cleanupStaleFileQueryDbs(now = Date.now()): number {
  const dir = fileQueryTempDir();
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.db')) continue;
    const path = join(dir, name);
    try {
      const age = now - statSync(path).mtimeMs;
      if (age > TTL_MS) {
        unlinkSync(path);
        removed++;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/** Connection display names created by Query files (`Files: …`). */
export function isFileQueryConnectionName(name: string | undefined | null): boolean {
  return !!name && /^Files:\s+/i.test(name.trim());
}

export function sanitizeTableName(raw: string, fallback = 'data'): string {
  let base = raw
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  // SQLite identifiers may start with a digit only if quoted; keep a letter/_ prefix.
  if (/^\d/.test(base)) base = `t_${base}`;
  return base || fallback;
}

export function sanitizeColumnName(raw: string, index: number): string {
  const base = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^(\d)/, '_$1')
    .slice(0, 64);
  return base || `col_${index + 1}`;
}

/** Normalize delimiter tokens from the UI (`\\t`, `tab`, etc.). */
export function normalizeCsvDelimiter(raw?: string): string {
  if (raw == null || raw === '') return ',';
  const t = raw;
  if (t === '\\t' || t.toLowerCase() === 'tab') return '\t';
  if (t === '\\n') return '\n';
  // Allow multi-char custom delimiters (e.g. `||`); keep escapes as one char.
  if (t.startsWith('\\') && t.length === 2) {
    const esc: Record<string, string> = { t: '\t', n: '\n', r: '\r' };
    return esc[t[1]!] ?? t[1]!;
  }
  return t;
}

/** Minimal CSV/TSV parser with quotes + escaped quotes. Supports any delimiter string. */
export function parseCsv(
  content: string,
  opts?: { delimiter?: string; hasHeader?: boolean }
): { columns: string[]; rows: string[][] } {
  const delimiter = normalizeCsvDelimiter(opts?.delimiter);
  const hasHeader = opts?.hasHeader !== false;
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const dLen = delimiter.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    // Skip trailing empty line
    if (row.length === 1 && row[0] === '' && rows.length > 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  const text = content.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (dLen > 0 && text.startsWith(delimiter, i)) {
      pushField();
      i += dLen - 1;
      continue;
    }
    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }
  // last field / row
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  if (rows.length === 0) return { columns: [], rows: [] };

  if (hasHeader) {
    const header = rows[0]!.map((h, i) => sanitizeColumnName(h, i));
    // Dedupe column names
    const seen = new Map<string, number>();
    const columns = header.map((h) => {
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      return n === 1 ? h : `${h}_${n}`;
    });
    return { columns, rows: rows.slice(1) };
  }

  const width = Math.max(...rows.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => `col_${i + 1}`);
  return { columns, rows };
}

/** JSON array of objects, or NDJSON (one object per line). */
export function parseJsonRecords(
  content: string,
  mode: 'array' | 'ndjson' = 'array'
): { columns: string[]; rows: Record<string, unknown>[] } {
  const text = content.replace(/^\uFEFF/, '').trim();
  if (!text) return { columns: [], rows: [] };

  let records: Record<string, unknown>[] = [];
  if (mode === 'ndjson' || (!text.startsWith('[') && !text.startsWith('{'))) {
    records = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, i) => {
        const v = JSON.parse(line) as unknown;
        if (v == null || typeof v !== 'object' || Array.isArray(v)) {
          throw new Error(`NDJSON line ${i + 1} must be a JSON object`);
        }
        return v as Record<string, unknown>;
      });
  } else {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      records = parsed.map((v, i) => {
        if (v == null || typeof v !== 'object' || Array.isArray(v)) {
          throw new Error(`JSON array item ${i} must be an object`);
        }
        return v as Record<string, unknown>;
      });
    } else if (parsed && typeof parsed === 'object') {
      records = [parsed as Record<string, unknown>];
    } else {
      throw new Error('JSON must be an object or an array of objects');
    }
  }

  const colSet = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) colSet.add(k);
  }
  const columns = [...colSet].map((k, i) => sanitizeColumnName(k, i));
  // Map original keys → sanitized (first wins on collision)
  const keyMap = new Map<string, string>();
  let i = 0;
  for (const k of colSet) {
    const sk = columns[i++]!;
    if (![...keyMap.values()].includes(sk)) keyMap.set(k, sk);
  }
  const mapped = records.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const sk = keyMap.get(k);
      if (sk) out[sk] = v;
    }
    return out;
  });
  return { columns: [...new Set(keyMap.values())], rows: mapped };
}

/** Fixed-width / text-offset rows. */
export function parseTextOffsets(
  content: string,
  columns: TextOffsetColumn[],
  skipLines = 0
): { columns: string[]; rows: string[][] } {
  if (!columns?.length) throw new Error('Text format requires at least one column offset');
  for (const c of columns) {
    if (!Number.isFinite(c.start) || c.start < 0) throw new Error(`Invalid start for ${c.name}`);
    if (!Number.isFinite(c.length) || c.length <= 0) throw new Error(`Invalid length for ${c.name}`);
  }
  const names = columns.map((c, i) => sanitizeColumnName(c.name, i));
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const body = lines.slice(Math.max(0, skipLines)).filter((l) => l.length > 0);
  const rows = body.map((line) =>
    columns.map((c) => line.slice(c.start, c.start + c.length).trimEnd())
  );
  return { columns: names, rows };
}

type SqlType = 'INTEGER' | 'REAL' | 'TEXT';

function inferType(values: unknown[]): SqlType {
  let sawReal = false;
  let sawInt = false;
  for (const v of values) {
    if (v == null || v === '') continue;
    if (typeof v === 'number') {
      if (Number.isInteger(v)) sawInt = true;
      else sawReal = true;
      continue;
    }
    const s = String(v).trim();
    if (s === '') continue;
    if (/^[+-]?\d+$/.test(s)) {
      sawInt = true;
      continue;
    }
    if (/^[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) {
      sawReal = true;
      continue;
    }
    return 'TEXT';
  }
  if (sawReal) return 'REAL';
  if (sawInt) return 'INTEGER';
  return 'TEXT';
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function loadSqlite(): new (
  path: string,
  opts?: { readonly?: boolean; fileMustExist?: boolean }
) => {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...args: unknown[]) => void;
    all: (...args: unknown[]) => unknown[];
  };
  close: () => void;
} {
  try {
    const mod = nodeRequire('better-sqlite3');
    return (mod.default ?? mod) as never;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`better-sqlite3 is required for file query import — ${message}`);
  }
}

export type ParsedFileTable = {
  tableName: string;
  columns: string[];
  matrix: unknown[][];
  types: SqlType[];
};

/** Parse file content into a padded row matrix (shared by SQLite + remote writers). */
export function parseFileToTable(
  input: FileQueryImportInput,
  opts?: { maxChars?: number }
): ParsedFileTable {
  if (!input?.content && input?.content !== '') throw new Error('File content is required');
  const maxChars = opts?.maxChars ?? MAX_CONTENT_CHARS;
  if (input.content.length > maxChars) {
    throw new Error(`File too large (max ${maxChars} characters)`);
  }

  const tableName = sanitizeTableName(input.tableName || input.fileName || 'data');
  let columns: string[] = [];
  let matrix: unknown[][] = [];

  if (input.format === 'csv') {
    const parsed = parseCsv(input.content, input.csv);
    columns = parsed.columns;
    matrix = parsed.rows;
  } else if (input.format === 'json') {
    const parsed = parseJsonRecords(input.content, input.json?.mode ?? 'array');
    columns = parsed.columns;
    matrix = parsed.rows.map((r) => columns.map((c) => r[c]));
  } else if (input.format === 'text') {
    const parsed = parseTextOffsets(
      input.content,
      input.text?.columns ?? [],
      input.text?.skipLines ?? 0
    );
    columns = parsed.columns;
    matrix = parsed.rows;
  } else {
    throw new Error(`Unsupported format: ${String(input.format)}`);
  }

  if (!columns.length) throw new Error('No columns found in the file');
  if (matrix.length > MAX_ROWS) {
    throw new Error(`Too many rows (max ${MAX_ROWS}). Split the file and import again.`);
  }

  matrix = matrix.map((r) => columns.map((_, i) => (r as unknown[])[i] ?? null));
  const types = columns.map((_, i) => inferType(matrix.map((r) => r[i])));
  return { tableName, columns, matrix, types };
}

function bindRow(row: unknown[], types: SqlType[]): unknown[] {
  return row.map((v, i) => {
    if (v == null || v === '') return null;
    if (types[i] === 'INTEGER') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    if (types[i] === 'REAL') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      return Number.isFinite(n) ? n : null;
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });
}

/** Pick a free table name inside an existing SQLite file. */
export function uniqueSqliteTableName(dbPath: string, desired: string): string {
  const Database = loadSqlite();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const existing = new Set(
      (
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
          )
          .all() as { name: string }[]
      ).map((r) => r.name.toLowerCase())
    );
    let name = desired;
    let n = 2;
    while (existing.has(name.toLowerCase())) {
      name = `${desired}_${n++}`.slice(0, 48);
    }
    return name;
  } finally {
    db.close();
  }
}

/**
 * Create/replace a table in a SQLite file using multi-row VALUES batches.
 */
export function writeTableToSqliteFile(
  dbPath: string,
  table: ParsedFileTable,
  opts?: { replaceTable?: boolean; uniqueName?: boolean }
): { tableName: string; rowCount: number } {
  const tableName = opts?.uniqueName
    ? uniqueSqliteTableName(dbPath, table.tableName)
    : table.tableName;
  const Database = loadSqlite();
  const db = new Database(dbPath);
  try {
    return writeTableWithDb(db, { ...table, tableName }, opts?.replaceTable);
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

function writeTableWithDb(
  db: {
    exec: (sql: string) => void;
    prepare: (sql: string) => { run: (...args: unknown[]) => void };
  },
  table: ParsedFileTable,
  replaceTable?: boolean
): { tableName: string; rowCount: number } {
  const { tableName, columns, matrix, types } = table;
  if (replaceTable) {
    db.exec(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`);
  }
  const colDefs = columns.map((c, i) => `${quoteIdent(c)} ${types[i]}`).join(', ');
  db.exec(`CREATE TABLE ${quoteIdent(tableName)} (${colDefs})`);
  if (matrix.length > 0) {
    const colList = columns.map(quoteIdent).join(', ');
    db.exec('BEGIN');
    for (let i = 0; i < matrix.length; i += SQLITE_INSERT_BATCH) {
      const slice = matrix.slice(i, i + SQLITE_INSERT_BATCH);
      const valueGroups = slice
        .map(() => `(${columns.map(() => '?').join(', ')})`)
        .join(', ');
      const sql = `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES ${valueGroups}`;
      const stmt = db.prepare(sql);
      const binds: unknown[] = [];
      for (const row of slice) binds.push(...bindRow(row, types));
      stmt.run(...binds);
    }
    db.exec('COMMIT');
  }
  return { tableName, rowCount: matrix.length };
}

/**
 * Parse the file and write a new temp SQLite database with one table.
 */
export function materializeFileToSqlite(
  input: FileQueryImportInput,
  opts?: { maxChars?: number; connectionName?: string }
): FileQueryImportResult {
  cleanupStaleFileQueryDbs();
  const parsed = parseFileToTable(input, { maxChars: opts?.maxChars });
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  const dbPath = join(fileQueryTempDir(), `files-${id}.db`);
  try {
    const written = writeTableToSqliteFile(dbPath, parsed);
    const shortName = (input.fileName || written.tableName).split(/[/\\]/).pop() || written.tableName;
    return {
      dbPath,
      tableName: written.tableName,
      rowCount: written.rowCount,
      columns: parsed.columns,
      connectionName: opts?.connectionName || `Files: ${shortName}`,
    };
  } catch (e) {
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * Add another file as a table inside an existing temp SQLite workspace DB.
 */
export function appendFileToSqliteWorkspace(
  dbPath: string,
  input: FileQueryImportInput,
  opts?: { maxChars?: number; replaceTable?: boolean }
): { tableName: string; rowCount: number; columns: string[] } {
  if (!isFileQueryDbPath(dbPath)) {
    throw new Error('Not a Query-files workspace database');
  }
  const parsed = parseFileToTable(input, { maxChars: opts?.maxChars });
  const written = writeTableToSqliteFile(dbPath, parsed, {
    replaceTable: opts?.replaceTable,
    uniqueName: !opts?.replaceTable,
  });
  return { tableName: written.tableName, rowCount: written.rowCount, columns: parsed.columns };
}
