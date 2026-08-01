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

const MAX_CONTENT_CHARS = 8_000_000;
const MAX_ROWS = 200_000;
const TTL_MS = 24 * 60 * 60 * 1000;

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

function loadSqlite(): new (path: string) => {
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...args: unknown[]) => void };
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

/**
 * Parse the file and write a temp SQLite database with one table.
 */
export function materializeFileToSqlite(input: FileQueryImportInput): FileQueryImportResult {
  if (!input?.content && input?.content !== '') throw new Error('File content is required');
  if (input.content.length > MAX_CONTENT_CHARS) {
    throw new Error(`File too large (max ${MAX_CONTENT_CHARS} characters)`);
  }

  cleanupStaleFileQueryDbs();

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

  // Pad / trim rows to column width
  matrix = matrix.map((r) => {
    const out = columns.map((_, i) => (r as unknown[])[i] ?? null);
    return out;
  });

  const types = columns.map((c, i) =>
    inferType(matrix.map((r) => r[i]))
  );

  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  const dbPath = join(fileQueryTempDir(), `files-${id}.db`);
  const Database = loadSqlite();
  const db = new Database(dbPath);
  try {
    const colDefs = columns.map((c, i) => `${quoteIdent(c)} ${types[i]}`).join(', ');
    db.exec(`CREATE TABLE ${quoteIdent(tableName)} (${colDefs})`);
    if (matrix.length > 0) {
      const placeholders = columns.map(() => '?').join(', ');
      const insert = db.prepare(
        `INSERT INTO ${quoteIdent(tableName)} (${columns.map(quoteIdent).join(', ')}) VALUES (${placeholders})`
      );
      db.exec('BEGIN');
      for (const row of matrix) {
        const bound = row.map((v, i) => {
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
        insert.run(...bound);
      }
      db.exec('COMMIT');
    }
  } catch (e) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
    throw e;
  }
  db.close();

  const shortName = (input.fileName || tableName).split(/[/\\]/).pop() || tableName;
  return {
    dbPath,
    tableName,
    rowCount: matrix.length,
    columns,
    connectionName: `Files: ${shortName}`,
  };
}
