/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Two more ways out of a result grid: YAML, and fixed-width text.
 *
 * CSV and JSON already exist. YAML is here because config and fixture files
 * are written in it, and hand-converting a query result into one is exactly
 * the tedious step a database tool should absorb. Fixed-width text is here
 * because it is what pastes into a terminal, a ticket, or a code comment and
 * still lines up — the thing CSV is worst at.
 */

/** SQL NULL is a value, not an absent key: both formats say so explicitly. */
const NULL_TEXT = 'null';

/**
 * Render one cell as YAML.
 *
 * Quoted unless it is unambiguously a plain scalar. YAML's implicit typing is
 * the trap: unquoted `on`, `no`, `y` and `1.0` parse as boolean or number, and
 * a leading zero (`0755`, or a zip code) loses it. A column of IDs silently
 * becoming integers is the kind of thing found much later, so anything not
 * provably safe is quoted.
 */
export function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return NULL_TEXT;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `"${value}"`;
  if (typeof value === 'boolean') return String(value);

  const s = String(value);
  if (s === '') return "''";
  // Multi-line values use a literal block, which keeps newlines intact.
  if (/\n/.test(s)) {
    const indented = s.split('\n').map((line) => `    ${line}`).join('\n');
    return `|-\n${indented}`;
  }
  // A plain scalar must not look like anything else YAML would coerce.
  const plain =
    /^[A-Za-z_][\w .-]*$/.test(s) &&
    !/^(y|n|yes|no|on|off|true|false|null|~)$/i.test(s) &&
    !s.includes(': ') &&
    !s.endsWith(':');
  return plain ? s : `'${s.replace(/'/g, "''")}'`;
}

/** A result grid as a YAML sequence of mappings. */
export function toYaml(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  if (columns.length === 0) return '[]\n';
  const key = (name: string) => (/^[A-Za-z_][\w-]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

  const out: string[] = [];
  for (const row of rows) {
    columns.forEach((name, i) => {
      const rendered = yamlScalar(row[i]);
      // `- ` opens the mapping on its first key; the rest align under it.
      const lead = i === 0 ? '- ' : '  ';
      if (rendered.startsWith('|-')) {
        const [head, ...tail] = rendered.split('\n');
        out.push(`${lead}${key(name)}: ${head}`, ...tail);
      } else {
        out.push(`${lead}${key(name)}: ${rendered}`);
      }
    });
  }
  return out.length > 0 ? `${out.join('\n')}\n` : '[]\n';
}

/** How a cell prints in fixed-width text. NULL is shown, not blanked. */
function textCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  return String(value).replace(/\r?\n/g, ' ');
}

/**
 * A result grid as columns padded to a common width.
 *
 * Widths come from the content, so the output lines up in any monospaced
 * context. Newlines inside a value are flattened to spaces first — one cell
 * spilling onto a second line would break the alignment for every row after
 * it, which defeats the point of the format.
 */
export function toFixedWidthText(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  options: { separator?: string; maxColumnWidth?: number } = {}
): string {
  if (columns.length === 0) return '';
  const sep = options.separator ?? '  ';
  const cap = Math.max(3, options.maxColumnWidth ?? 60);

  const clip = (s: string) => (s.length > cap ? `${s.slice(0, cap - 1)}…` : s);
  const body = rows.map((row) => columns.map((_, i) => clip(textCell(row[i]))));
  const head = columns.map((c) => clip(String(c)));

  const widths = head.map((h, i) =>
    Math.max(h.length, ...body.map((r) => r[i]?.length ?? 0), 0)
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join(sep).trimEnd();

  return [
    line(head),
    line(widths.map((w) => '-'.repeat(w))),
    ...body.map(line),
  ].join('\n');
}

/** Save `content` as a file, the same way the CSV and JSON exports do. */
function download(filename: string, ext: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadYaml(
  filename: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[]
): void {
  if (columns.length === 0) return;
  download(filename, 'yaml', 'application/yaml', toYaml(columns, rows));
}

export function downloadFixedWidthText(
  filename: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[]
): void {
  if (columns.length === 0) return;
  download(filename, 'txt', 'text/plain', toFixedWidthText(columns, rows));
}
