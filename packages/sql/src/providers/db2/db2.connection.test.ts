import { describe, expect, it } from 'vitest';
import {
  buildDb2ConnectionString,
  db2CaLooksLikePem,
  odbcEscape,
  parseDb2SemicolonMap,
  withDb2Authentication,
} from './db2.connection.js';

describe('buildDb2ConnectionString', () => {
  it('defaults to SERVER_ENCRYPT (DBeaver Database Native / modern LUW)', () => {
    const cs = buildDb2ConnectionString({
      host: 'db.example',
      port: 50000,
      database: 'SAMPLE',
      username: 'db2inst1',
      password: 'secret',
    });
    expect(cs).toContain('Authentication=SERVER_ENCRYPT');
    expect(cs).toContain('DATABASE=SAMPLE');
    expect(cs).toContain('HOSTNAME=db.example');
    expect(cs).toContain('UID=db2inst1');
    expect(cs).toContain('PWD=secret');
  });

  it('ignores Authentication=SERVER on a rebuilt field-form connectionString', () => {
    const cs = buildDb2ConnectionString({
      host: 'h',
      database: 'D',
      username: 'u',
      password: 'p',
      connectionString:
        'DATABASE=D;HOSTNAME=h;PORT=25000;UID=u;PWD=p;Authentication=SERVER;',
    });
    expect(cs).toContain('Authentication=SERVER_ENCRYPT');
  });

  it('keeps Authentication from a pasted CLI string without host/database fields', () => {
    const cs = buildDb2ConnectionString({
      connectionString:
        'DATABASE=SAMPLE;HOSTNAME=h;PORT=50000;PROTOCOL=TCPIP;UID=u;PWD=p;Authentication=SERVER;',
    });
    expect(cs).toMatch(/Authentication=SERVER;/);
    expect(cs).not.toContain('SERVER_ENCRYPT');
    expect(cs).toContain('DATABASE=SAMPLE');
  });

  it('honors an explicit options.authentication on the field form', () => {
    const cs = buildDb2ConnectionString({
      host: 'h',
      database: 'D',
      username: 'u',
      password: 'p',
      authentication: 'SERVER',
    });
    expect(cs).toMatch(/Authentication=SERVER;/);
    expect(cs).not.toContain('SERVER_ENCRYPT');
  });

  it('brace-escapes passwords that contain semicolons so they round-trip', () => {
    const password = 'a;b}c';
    const cs = buildDb2ConnectionString({
      host: 'h',
      database: 'D',
      username: 'u',
      password,
    });
    expect(cs).toContain(`PWD=${odbcEscape(password)}`);
    const map = parseDb2SemicolonMap(cs);
    expect(map.get('PWD')).toBe(password);
  });

  it('parses braced PWD from a pasted string', () => {
    const cs = buildDb2ConnectionString({
      connectionString: 'DATABASE=D;HOSTNAME=h;PORT=50000;UID=u;PWD={p;a;s;s};',
    });
    expect(parseDb2SemicolonMap(cs).get('PWD')).toBe('p;a;s;s');
  });

  it('ldap method still emits UID/PWD and SERVER_ENCRYPT (LDAP is server-side)', () => {
    const cs = buildDb2ConnectionString({
      host: 'db.example',
      port: 50000,
      database: 'SAMPLE',
      username: 'alice',
      password: 'dir-secret',
      authMethod: 'ldap',
    });
    expect(cs).toContain('UID=alice');
    expect(cs).toContain('PWD=dir-secret');
    expect(cs).toContain('Authentication=SERVER_ENCRYPT');
    expect(cs).not.toMatch(/KERBEROS|GSSPLUGIN|CLIENT/i);
  });

  it('adds CurrentSchema when schema is provided', () => {
    const cs = buildDb2ConnectionString(
      { host: 'h', database: 'D', username: 'u', password: 'p', schema: 'myschema' },
      'myschema'
    );
    expect(cs).toContain('CurrentSchema=MYSCHEMA');
  });

  it('adds Security=SSL when SSL is enabled', () => {
    const cs = buildDb2ConnectionString({
      host: 'h',
      database: 'D',
      username: 'u',
      password: 'p',
      ssl: { enabled: true },
    });
    expect(cs).toContain('Security=SSL');
    expect(cs).not.toContain('SSLServerCertificate=');
  });

  it('passes a certificate file path as SSLServerCertificate', () => {
    const cs = buildDb2ConnectionString({
      host: 'h',
      port: 50001,
      database: 'D',
      username: 'u',
      password: 'p',
      ssl: { enabled: true, ca: '/etc/certs/db2-server.arm' },
    });
    expect(cs).toContain('Security=SSL');
    expect(cs).toContain('SSLServerCertificate=/etc/certs/db2-server.arm');
  });

  it('does not put PEM text into the CLI string', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    const cs = buildDb2ConnectionString({
      host: 'h',
      database: 'D',
      username: 'u',
      password: 'p',
      ssl: { enabled: true, ca: pem },
    });
    expect(cs).toContain('Security=SSL');
    expect(cs).not.toContain('BEGIN CERTIFICATE');
    expect(cs).not.toContain('SSLServerCertificate=');
  });

  it('keeps SSLServerCertificate from a pasted CLI string', () => {
    const cs = buildDb2ConnectionString({
      connectionString:
        'DATABASE=D;HOSTNAME=h;PORT=50001;UID=u;PWD=p;Security=SSL;SSLServerCertificate=/tmp/s.pem;',
    });
    expect(cs).toContain('Security=SSL');
    expect(cs).toContain('SSLServerCertificate=/tmp/s.pem');
  });
});

describe('withDb2Authentication', () => {
  it('swaps SERVER for SERVER_ENCRYPT', () => {
    expect(
      withDb2Authentication('DATABASE=D;Authentication=SERVER;', 'SERVER_ENCRYPT')
    ).toBe('DATABASE=D;Authentication=SERVER_ENCRYPT;');
  });
});

describe('db2CaLooksLikePem', () => {
  it('detects PEM bodies vs a filesystem path', () => {
    expect(
      db2CaLooksLikePem('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----')
    ).toBe(true);
    expect(db2CaLooksLikePem('/etc/certs/db2-server.arm')).toBe(false);
  });
});

