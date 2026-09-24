/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A short, stable, non-reversible tag for a secret, for use in cache keys.
 *
 * Two connections that differ only by password must not share a cached pool or
 * schema, so the key has to vary with the password — without the password ever
 * appearing in it. djb2 over the string, as unsigned 32-bit hex.
 *
 * Not a security primitive: it is there to *separate* keys, not to protect the
 * secret against someone holding the hash. It lives here because the browser
 * (schema cache keys) and the driver runtime (pool keys) both need it and each
 * had its own byte-identical copy.
 */
export function nonSecretFingerprint(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h) ^ value.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
