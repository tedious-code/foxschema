/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which names from the access catalog are actually databases.
 *
 * `fetchSchemaList` returns schemas. On the MySQL family those are databases
 * (`db.*` is the GRANT target). Everywhere else a schema is not a database —
 * treating `public` as one would emit `GRANT CONNECT ON DATABASE public`.
 */
import { accessFamily } from './access';

export function connectionDatabaseNames(opts: {
  dialect?: string;
  database?: string;
  schemas?: readonly string[];
}): string[] {
  const family = accessFamily(opts.dialect ?? '');
  const dbs = new Set<string>();
  const connected = opts.database?.trim();
  if (connected) dbs.add(connected);
  if (family === 'mysql' || family === 'mariadb') {
    for (const s of opts.schemas ?? []) {
      const name = s.trim();
      if (name) dbs.add(name);
    }
  }
  return [...dbs].sort((a, b) => a.localeCompare(b));
}
