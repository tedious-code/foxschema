/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The session statements a destination needs before it will accept an explicit
 * identity value.
 *
 * Data migrate's "Include identity" switch preserves the source row's id. Most
 * engines take that in the INSERT itself — either plainly, or with an
 * overriding clause the statement carries. SQL Server and Azure SQL are the
 * exception: the permission is a property of the session, so something has to
 * turn it on around the ops and off again after.
 *
 * This is derived here, on the server, from the dialect capability table. The
 * client asks by naming a table and nothing more, because `/data-migrate/execute`
 * admits DML for its ops and a client that could post its own session SQL would
 * be a way around that.
 */
import { identityInsertSupport, qualifiedNameParts, quoteQualifiedName } from '@foxschema/sql';
import type { DataMigrateSessionSql } from '../../api/data-migrate-execute';

export type IdentitySessionResult =
  /** Statements to run around the ops. */
  | { ok: true; sessionSql: DataMigrateSessionSql }
  /** This dialect needs no session change — the statement carries its own. */
  | { ok: true; sessionSql: undefined }
  | { ok: false; error: string };

/** The largest qualification any supported engine uses: database.schema.table. */
const MAX_NAME_PARTS = 3;

export function identitySessionSql(dialect: string, tableName: string): IdentitySessionResult {
  const wanted = tableName.trim();
  if (!wanted) return { ok: true, sessionSql: undefined };

  const support = identityInsertSupport(dialect);
  if (support.kind !== 'toggle' || !support.enable || !support.disable) {
    return { ok: true, sessionSql: undefined };
  }

  const parts = qualifiedNameParts(wanted);
  if (parts.length === 0 || parts.length > MAX_NAME_PARTS) {
    return { ok: false, error: 'identityInsertTable must name a table.' };
  }

  const quoted = quoteQualifiedName(wanted, dialect);
  return { ok: true, sessionSql: { before: support.enable(quoted), after: support.disable(quoted) } };
}
