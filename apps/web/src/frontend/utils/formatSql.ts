import { format, type FormatOptionsWithLanguage } from 'sql-formatter';
import {
  codeCellNeedsTs,
  findCodeFences,
  type CodeCellKind,
} from '../lib/sql-splitter';

const LANGUAGE_BY_DIALECT: Record<string, NonNullable<FormatOptionsWithLanguage['language']>> = {
  db2: 'db2',
  mysql: 'mysql',
  mariadb: 'mariadb',
  oracle: 'plsql',
  postgres: 'postgresql',
  sqlserver: 'tsql',
  sqlite: 'sqlite',
};

/**
 * Pretty-prints catalog DDL (views, triggers, routines often come back as one line).
 * Falls back to the raw text when the formatter can't parse vendor-specific syntax.
 */
export function formatSql(sql: string, dialect: string): string {
  if (!sql || !sql.trim()) return sql;
  try {
    return format(sql, {
      language: LANGUAGE_BY_DIALECT[dialect.toLowerCase()] ?? 'sql',
      keywordCase: 'upper',
      tabWidth: 1,
      indentStyle: 'tabularLeft',
    });
  } catch {
    return sql;
  }
}

type FenceParts = {
  open: string;
  body: string;
  close: string | null;
  trailingNl: boolean;
};

/** Split a `-- @js`…`-- @end` slice into open line / body / close line. */
export function splitCodeFenceSlice(slice: string, closed: boolean): FenceParts {
  const trailingNl = /\r?\n$/.test(slice);
  const raw = trailingNl ? slice.replace(/\r?\n$/, '') : slice;
  const lines = raw.length === 0 ? [''] : raw.split(/\r?\n/);
  const open = lines[0] ?? '';
  if (closed && lines.length >= 2) {
    return {
      open,
      body: lines.slice(1, -1).join('\n'),
      close: lines[lines.length - 1]!,
      trailingNl,
    };
  }
  return {
    open,
    body: lines.slice(1).join('\n'),
    close: null,
    trailingNl,
  };
}

const PRETTIER_OPTS = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all' as const,
  printWidth: 60,
  tabWidth: 2,
  arrowParens: 'always' as const,
};

type PrettierBundle = {
  format: typeof import('prettier/standalone').format;
  estree: unknown;
  babel: unknown;
  typescript: unknown;
};

let prettierBundle: Promise<PrettierBundle> | null = null;

function loadPrettier(): Promise<PrettierBundle> {
  if (!prettierBundle) {
    prettierBundle = Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/estree'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/typescript'),
    ])
      .then(([standalone, estree, babel, typescript]) => ({
        format: standalone.format,
        estree,
        babel,
        typescript,
      }))
      .catch((err) => {
        prettierBundle = null;
        throw err;
      });
  }
  return prettierBundle;
}

/** Format a JS/TS code-cell body with Prettier (browser standalone). */
export async function formatCodeCellBody(
  body: string,
  kind: CodeCellKind
): Promise<string> {
  if (!body.trim()) return body;
  try {
    const { format: prettierFormat, estree, babel, typescript } = await loadPrettier();
    const ts = codeCellNeedsTs(kind);
    const formatted = await prettierFormat(body, {
      ...PRETTIER_OPTS,
      parser: ts ? 'typescript' : 'babel',
      plugins: [ts ? typescript : babel, estree] as never[],
    });
    return formatted.replace(/\n$/, '');
  } catch {
    return body;
  }
}

function reassembleFence(parts: FenceParts, formattedBody: string): string {
  const lines = [parts.open];
  if (formattedBody.length > 0) lines.push(formattedBody);
  if (parts.close) lines.push(parts.close);
  let out = lines.join('\n');
  if (parts.trailingNl) out += '\n';
  return out;
}

function formatSqlSegment(segment: string, dialect: string): string {
  if (!segment.trim()) return segment;
  let formatted = formatSql(segment, dialect);
  if (!formatted.endsWith('\n')) formatted += '\n';
  return formatted;
}

/**
 * Format a SQL Editor buffer: sql-formatter for SQL segments, Prettier for
 * `-- @js` / `-- @ts` / `-- @node` / `-- @nodets` code-cell bodies.
 */
export async function formatEditorSql(sql: string, dialect: string): Promise<string> {
  if (!sql || !sql.trim()) return sql;

  const fences = findCodeFences(sql);
  if (fences.length === 0) return formatSql(sql, dialect);

  const fenceParts = fences.map((fence) => {
    const slice = sql.slice(fence.start, fence.end);
    const parts = splitCodeFenceSlice(slice, fence.closed);
    return { fence, parts };
  });
  const formattedBodies = await Promise.all(
    fenceParts.map(({ fence, parts }) => formatCodeCellBody(parts.body, fence.kind))
  );

  let out = '';
  let cursor = 0;
  for (let i = 0; i < fences.length; i++) {
    const fence = fences[i]!;
    if (fence.start > cursor) {
      out += formatSqlSegment(sql.slice(cursor, fence.start), dialect);
    }
    out += reassembleFence(fenceParts[i]!.parts, formattedBodies[i]!);
    cursor = fence.end;
  }
  if (cursor < sql.length) {
    const tail = sql.slice(cursor);
    out += tail.trim() ? formatSql(tail, dialect) : tail;
  }
  return out;
}
