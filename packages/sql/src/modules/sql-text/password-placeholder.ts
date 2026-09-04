/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The token that stands in for a password in generated SQL and commands.
 *
 * It lives in `sql-text` — a foundation domain that depends on nothing —
 * because both `access` (which writes CREATE USER) and `command-mode` (which
 * writes the client invocation) need it. Keeping it in `access` and importing
 * it from `command-mode` closed a loop, since `access` already reads
 * `command-mode` to ask which engines have a client at all:
 *
 *     access → command-mode → access
 *
 * `access/user-sql.types.ts` re-exports it, so every existing import still
 * resolves to this one definition.
 */
export const PASSWORD_PLACEHOLDER = '<password>';
