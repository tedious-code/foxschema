/**
 * Fox Schema (@foxschema/db)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildMssqlPoolConfig } from './sqlserver.config.js';

describe('buildMssqlPoolConfig', () => {
  it('uses user/password for SQL login', () => {
    const cfg = buildMssqlPoolConfig(
      {
        host: 'db.example',
        port: 1433,
        database: 'app',
        username: 'sa',
        password: 'secret',
      },
      { encryptDefault: false }
    );
    expect(cfg.user).toBe('sa');
    expect(cfg.password).toBe('secret');
    expect(cfg.authentication).toBeUndefined();
    expect((cfg.options as { encrypt: boolean }).encrypt).toBe(false);
  });

  it('uses tedious NTLM and omits top-level user/password for Windows login', () => {
    const cfg = buildMssqlPoolConfig(
      {
        host: 'db.example',
        database: 'app',
        username: 'CONTOSO\\alice',
        password: 'WinPass1',
        authMethod: 'windows',
      },
      { encryptDefault: false }
    );
    expect(cfg.user).toBeUndefined();
    expect(cfg.password).toBeUndefined();
    expect(cfg.authentication).toEqual({
      type: 'ntlm',
      options: { domain: 'CONTOSO', userName: 'alice', password: 'WinPass1' },
    });
  });

  it('takes domain from the domain field when username has no backslash', () => {
    const cfg = buildMssqlPoolConfig(
      {
        host: 'db.example',
        username: 'alice',
        domain: 'CONTOSO',
        password: 'p',
        authMethod: 'windows',
      },
      { encryptDefault: true }
    );
    expect((cfg.authentication as { options: { domain: string } }).options.domain).toBe('CONTOSO');
    expect((cfg.options as { encrypt: boolean }).encrypt).toBe(true);
  });

  it('rejects Windows login without a domain', () => {
    expect(() =>
      buildMssqlPoolConfig(
        { host: 'h', username: 'alice', password: 'p', authMethod: 'windows' },
        { encryptDefault: false }
      )
    ).toThrow(/domain/i);
  });
});
