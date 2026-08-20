/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Db2 TLS via ibm_db/GSKit. The CLI string cannot hold PEM; it wants a file
 * path (`SSLServerCertificate`). SQL0969N is the clidriver saying it has no
 * message catalog — the real failure is almost always the handshake.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConnectionOptions } from '@foxschema/sql';

function looksLikePem(value: string): boolean {
  return /-----BEGIN [A-Z ]*CERTIFICATE-----/.test(value);
}

function odbcEscape(value: string): string {
  if (!/[;{}]/.test(value) && value === value.trim()) return value;
  return `{${value.replace(/}/g, '}}')}}`;
}

/**
 * Ensure SSLServerCertificate is an absolute path GSKit can open.
 * PEM in `ssl.ca` is written once under os.tmpdir() (content-addressed).
 */
export function resolveDb2SslConnectionString(
  connectionString: string,
  options: ConnectionOptions
): string {
  const ca = options.ssl?.ca?.trim();
  if (!ca) return connectionString;

  const certPath = looksLikePem(ca)
    ? materializeDb2CaPem(ca)
    : path.isAbsolute(ca)
      ? ca
      : path.resolve(ca);

  const stripped = connectionString.replace(
    /SSLServerCertificate=\{[^}]*\}|SSLServerCertificate=[^;]*/gi,
    ''
  );
  const base = stripped.replace(/;{2,}/g, ';').replace(/;+$/, '');
  return `${base};SSLServerCertificate=${odbcEscape(certPath)};`;
}

export function materializeDb2CaPem(pem: string): string {
  const hash = createHash('sha256').update(pem).digest('hex').slice(0, 16);
  const dest = path.join(os.tmpdir(), `foxschema-db2-ca-${hash}.pem`);
  if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== pem) {
    fs.writeFileSync(dest, pem, { encoding: 'utf8', mode: 0o600 });
  }
  return dest;
}

export function explainDb2ConnectError(error: unknown, options: ConnectionOptions): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  const text = original.message || String(error);
  const catalogGap = /SQL0969N|-842216502|SQLJCMN/i.test(text);
  if (!catalogGap) return original;

  const sslHint = options.ssl?.enabled
    ? 'This is almost always a TLS handshake. Use the SSL listener port (often 50001, not 50000) and set SSL Server Certificate to an absolute path to the server .arm / .pem / .crt — not a Java .jks. Security=SSL alone is not enough for a self-signed or private CA.'
    : 'If this database requires TLS, enable SSL and attach the server certificate (.arm / .pem / .crt).';

  return new Error(
    `Db2 CLI has no message text for this error on this workstation. ${sslHint} Original: ${text}`
  );
}
