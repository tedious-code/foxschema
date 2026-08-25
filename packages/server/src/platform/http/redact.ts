/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Strip credentials out of text that is about to leave the process.
 *
 * Driver errors are passed through to the caller on purpose — a database
 * saying "permission denied on schema demo_b" is far more useful than a generic
 * failure. The cost is that some drivers quote the connection string back, and
 * that string carries the password. Measured against a live server:
 *
 *   POST /api/connection/test  (oracle, deliberately malformed)
 *   → NJS-515: error in Easy Connect connection string: input string not in
 *     easy connect format: oracle://u:LEAKME_PW_XYZ@127.0.0.1:9999/nodb
 *
 * The password reached the HTTP response body. Pino's `redact` did not help:
 * it matches object *paths*, and this is a sentence.
 *
 * Deliberately narrow. It rewrites the two shapes a secret actually appears in
 * — URL userinfo and `key=value` DSN pairs — and leaves everything else
 * untouched, because an error message mangled into uselessness is its own kind
 * of bug.
 */

/** What replaces a secret, distinctive enough to recognise in a bug report. */
const CENSOR = '***';

/**
 * `scheme://user:secret@host` → `scheme://user:***@host`.
 *
 * The user survives: knowing *which* account failed is most of the diagnostic
 * value, and it is not the secret.
 */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^:/?#\s@]+):([^@\s]+)@/gi;

/**
 * `password=secret`, `pwd=secret`, `passwd=secret` — ODBC, JDBC and Db2 DSNs.
 *
 * Stops at the delimiters those formats use, so it cannot swallow the rest of
 * a sentence when a message merely mentions the word.
 */
const KEY_VALUE = /\b(password|passwd|pwd)\s*=\s*([^;,&\s"')]+)/gi;

/** Remove credentials from a message bound for a client. */
export function redactCredentials(text: string): string {
  return text.replace(URL_USERINFO, `$1$2:${CENSOR}@`).replace(KEY_VALUE, `$1=${CENSOR}`);
}
