/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Remove credentials from text that is about to be sent to a client.
 *
 * Driver errors are passed through to the caller on purpose, because a message
 * like "permission denied on schema demo_b" is more useful than a generic
 * failure. Some drivers quote the connection string back in those messages,
 * and the connection string contains the password.
 *
 * Pino's `redact` option does not cover this: it matches fields in a log
 * object, whereas the password here is inside a sentence.
 *
 * The rules are narrow on purpose — they rewrite the two shapes a secret
 * actually appears in (URL userinfo and `key=value` pairs) and leave all other
 * text alone, so error messages stay readable.
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
