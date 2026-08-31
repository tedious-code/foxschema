/**
 * Fox Schema (@foxschema/db)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * mssql/tedious pool config. SQL Server ignores connection-string auth keys —
 * credentials come from ConnectionOptions fields. Windows login is NTLM
 * (domain + user + Windows password), not Azure AD Integrated.
 */
import {
  assertWindowsAccount,
  resolveAuthMethod,
  type ConnectionOptions,
} from '@foxschema/sql';
import { connectTimeoutMs, queryTimeoutMs } from '../../cores/timeouts';

export function buildMssqlPoolConfig(
  options: ConnectionOptions,
  extras: { encryptDefault: boolean }
): Record<string, unknown> {
  const method = resolveAuthMethod(
    extras.encryptDefault ? 'azuresql' : 'sqlserver',
    options.authMethod
  );
  const shared = {
    server: options.host || (extras.encryptDefault ? '' : 'localhost'),
    port: options.port || 1433,
    database: options.database || '',
    options: {
      encrypt: extras.encryptDefault ? true : (options.ssl?.enabled ?? false),
      trustServerCertificate: options.ssl?.rejectUnauthorized === false,
      connectTimeout: connectTimeoutMs(options, 15_000),
      requestTimeout: queryTimeoutMs(options, 30_000),
    },
    pool: {
      max: options.pool?.max ?? 10,
      min: options.pool?.min ?? 1,
      idleTimeoutMillis: options.pool?.idleTimeoutMs ?? 30000,
    },
  };

  if (method === 'windows') {
    const account = assertWindowsAccount(options.username, options.domain);
    return {
      ...shared,
      authentication: {
        type: 'ntlm',
        options: {
          domain: account.domain,
          userName: account.userName,
          password: options.password || '',
        },
      },
    };
  }

  return {
    ...shared,
    user: options.username || '',
    password: options.password || '',
  };
}
