import type { ConnectionOptions } from '../../interfaces/schema-provider.interface.js';

/**
 * `URL` is a WHATWG global, not a DOM API: Node ≥10, Deno, workers, and every
 * browser have it. The build runs with `lib: ["es2022"]` and `types: []` on
 * purpose — adding `dom` would satisfy `URL` but would also make `document`,
 * `window` and `localStorage` type-check cleanly inside a package that has to
 * run in Node, a worker, and on an edge runtime. So declare just the members
 * used here.
 *
 * This declaration is deliberately module-scoped rather than a global `.d.ts`:
 * a global `declare class URL` collides with `lib.dom`'s own `URL` (TS2300) in
 * every workspace tsconfig that pulls `packages/` into its program, and is only
 * invisible today because those configs set `skipLibCheck`.
 */
declare const URL: {
  new (
    url: string,
    base?: string
  ): {
    readonly username: string;
    readonly password: string;
    readonly hostname: string;
    readonly port: string;
    readonly pathname: string;
  };
};

/**
 * Build a DB2 CLI connection string (semicolon-delimited key=value pairs).
 * ibm_db does not accept db2:// URLs — those must be converted first.
 *
 * Authentication defaults to SERVER_ENCRYPT (DBeaver Database Native). Hard-coding
 * SERVER made modern LUW return SQL30082N reason 17. The Node adapter retries
 * the other type if the server refuses.
 *
 * ibm_db's GSKit wants a filesystem path. PEM pasted into `ssl.ca` is written
 * to a temp file in the Node adapter — do not put the PEM in the CLI string.
 */
export function db2CaLooksLikePem(value: string): boolean {
  return /-----BEGIN [A-Z ]*CERTIFICATE-----/.test(value);
}

const PASTED_SSL_KEYWORDS: ReadonlyArray<{ key: string; out: string }> = [
  { key: 'SSLSERVERCERTIFICATE', out: 'SSLServerCertificate' },
  { key: 'SSLCLIENTKEYSTOREDB', out: 'SSLClientKeystoredb' },
  { key: 'SSLCLIENTKEYSTASH', out: 'SSLClientKeystash' },
  { key: 'SSLCLIENTKEYSTOREDBPASSWORD', out: 'SSLClientKeystoreDBPassword' },
  { key: 'SSLCLIENTLABEL', out: 'SSLClientLabel' },
];

/** CLI values IBM accepts for userid/password auth (not Kerberos / IAM). */
export type Db2Authentication = 'SERVER' | 'SERVER_ENCRYPT' | 'SERVER_ENCRYPT_AES';

/**
 * DBeaver "Database Native" negotiates encrypted password auth.
 * ibm_db used to hard-code Authentication=SERVER, which modern LUW rejects
 * with SQL30082N reason 17 (UNSUPPORTED FUNCTION) when the server is
 * SERVER_ENCRYPT. Default to SERVER_ENCRYPT; honor a pasted/explicit value.
 */
export function resolveDb2Authentication(
  options: ConnectionOptions,
  extras?: Map<string, string>
): Db2Authentication {
  const fromOptions = String(options.authentication ?? '')
    .trim()
    .toUpperCase();
  if (fromOptions === 'SERVER' || fromOptions === 'SERVER_ENCRYPT' || fromOptions === 'SERVER_ENCRYPT_AES') {
    return fromOptions;
  }
  // The credential form always sends host/database plus a rebuilt connectionString.
  // That string used to contain Authentication=SERVER; treating it as a user paste
  // pinned the old type and modern LUW kept returning SQL30082N reason 17.
  const fieldForm = Boolean(options.host || options.database);
  if (!fieldForm) {
    const fromPaste = (extras?.get('AUTHENTICATION') ?? '').trim().toUpperCase();
    if (fromPaste === 'SERVER' || fromPaste === 'SERVER_ENCRYPT' || fromPaste === 'SERVER_ENCRYPT_AES') {
      return fromPaste;
    }
  }
  return 'SERVER_ENCRYPT';
}

export function withDb2Authentication(connectionString: string, authentication: string): string {
  const value = authentication.trim();
  if (/Authentication\s*=/i.test(connectionString)) {
    return connectionString.replace(/Authentication\s*=[^;]*/i, `Authentication=${value}`);
  }
  return `${connectionString.replace(/;+$/, '')};Authentication=${value};`;
}

export function buildDb2ConnectionString(options: ConnectionOptions, schema?: string): string {
  const parsed = parseDb2ConnectionInput(options.connectionString, options);
  const authentication = resolveDb2Authentication(options, parsed.extras);

  const parts: string[] = [
    `DATABASE=${odbcEscape(parsed.database)}`,
    `HOSTNAME=${odbcEscape(parsed.host)}`,
    `PORT=${parsed.port}`,
    'PROTOCOL=TCPIP',
    `UID=${odbcEscape(parsed.username)}`,
    `PWD=${odbcEscape(parsed.password)}`,
    `Authentication=${authentication}`,
  ];

  appendDb2Ssl(parts, options, parsed.extras);

  const schemaName = schema?.trim() || options.schema?.trim();
  if (schemaName) {
    parts.push(`CurrentSchema=${odbcEscape(schemaName.toUpperCase())}`);
  }

  return parts.join(';') + ';';
}

function appendDb2Ssl(
  parts: string[],
  options: ConnectionOptions,
  extras: Map<string, string>
): void {
  const pastedSecurity = extras.get('SECURITY') ?? extras.get('SECURITYTRANSPORTMODE') ?? '';
  const sslOn = Boolean(options.ssl?.enabled) || /^ssl$/i.test(pastedSecurity);
  if (!sslOn) return;

  parts.push('Security=SSL');

  const ca = options.ssl?.ca?.trim();
  if (ca && !db2CaLooksLikePem(ca)) {
    parts.push(`SSLServerCertificate=${odbcEscape(ca)}`);
  } else if (!ca || !db2CaLooksLikePem(ca)) {
    const pastedCert = extras.get('SSLSERVERCERTIFICATE');
    if (pastedCert) parts.push(`SSLServerCertificate=${odbcEscape(pastedCert)}`);
  }

  for (const { key, out } of PASTED_SSL_KEYWORDS) {
    if (key === 'SSLSERVERCERTIFICATE') continue;
    const value = extras.get(key);
    if (value) parts.push(`${out}=${odbcEscape(value)}`);
  }
}

/** ODBC brace-escape so values containing `;` or `}` do not truncate the string. */
export function odbcEscape(value: string): string {
  if (!/[;{}]/.test(value) && value === value.trim()) return value;
  return `{${value.replace(/}/g, '}}')}}`;
}

function emptyExtras(): Map<string, string> {
  return new Map();
}

function parseDb2ConnectionInput(
  connectionString: string | undefined,
  options: ConnectionOptions
): {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  extras: Map<string, string>;
} {
  if (connectionString?.trim()) {
    const trimmed = connectionString.trim();

    if (/^db2:\/\//i.test(trimmed)) {
      return { ...parseDb2Url(trimmed), extras: emptyExtras() };
    }

    if (/DATABASE\s*=/i.test(trimmed)) {
      return parseDb2Semicolon(trimmed, options);
    }
  }

  return {
    host: options.host ?? 'localhost',
    port: options.port ?? 50000,
    database: options.database ?? '',
    username: options.username ?? '',
    password: options.password ?? '',
    extras: emptyExtras(),
  };
}

function parseDb2Url(url: string): {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
} {
  const normalized = url.replace(/^db2:\/\//i, 'http://');
  const parsed = new URL(normalized);

  return {
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 50000,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

/**
 * Parse `KEY=value;KEY2={value;with;semicolons};` with ODBC brace rules.
 * A plain `split(';')` would truncate passwords that contain `;`.
 */
export function parseDb2SemicolonMap(connStr: string): Map<string, string> {
  const map = new Map<string, string>();
  let i = 0;
  const s = connStr;

  while (i < s.length) {
    while (i < s.length && (s[i] === ';' || /\s/.test(s[i]!))) i++;
    if (i >= s.length) break;

    const eq = s.indexOf('=', i);
    if (eq === -1) break;
    const key = s.slice(i, eq).trim().toUpperCase();
    let j = eq + 1;
    while (j < s.length && s[j] === ' ') j++;

    let value: string;
    if (s[j] === '{') {
      j++;
      let out = '';
      while (j < s.length) {
        if (s[j] === '}' && s[j + 1] === '}') {
          out += '}';
          j += 2;
          continue;
        }
        if (s[j] === '}') {
          j++;
          break;
        }
        out += s[j]!;
        j++;
      }
      value = out;
      while (j < s.length && s[j] !== ';') j++;
    } else {
      const semi = s.indexOf(';', j);
      value = (semi === -1 ? s.slice(j) : s.slice(j, semi)).trim();
      j = semi === -1 ? s.length : semi;
    }

    if (key) map.set(key, value);
    i = j + 1;
  }

  return map;
}

function parseDb2Semicolon(
  connStr: string,
  fallback: ConnectionOptions
): {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  extras: Map<string, string>;
} {
  const map = parseDb2SemicolonMap(connStr);

  return {
    database: map.get('DATABASE') ?? fallback.database ?? '',
    host: map.get('HOSTNAME') ?? fallback.host ?? 'localhost',
    port: Number(map.get('PORT') ?? fallback.port ?? 50000),
    username: map.get('UID') ?? fallback.username ?? '',
    password: map.get('PWD') ?? fallback.password ?? '',
    extras: map,
  };
}
