import { describe, expect, it } from 'vitest';
import {
  buildDb2ConnectionString,
  odbcEscape,
  parseDb2SemicolonMap,
} from './db2.connection';

describe('buildDb2ConnectionString', () => {
  it('always injects Authentication=SERVER', () => {
    const cs = buildDb2ConnectionString({
      host: 'db.example',
      port: 50000,
      database: 'SAMPLE',
      username: 'db2inst1',
      password: 'secret',
    });
    expect(cs).toContain('Authentication=SERVER');
    expect(cs).toContain('DATABASE=SAMPLE');
    expect(cs).toContain('HOSTNAME=db.example');
    expect(cs).toContain('UID=db2inst1');
    expect(cs).toContain('PWD=secret');
  });

  it('normalizes a pasted semicolon string and still forces Authentication=SERVER', () => {
    const cs = buildDb2ConnectionString({
      connectionString:
        'DATABASE=SAMPLE;HOSTNAME=h;PORT=50000;PROTOCOL=TCPIP;UID=u;PWD=p;',
    });
    expect(cs).toMatch(/Authentication=SERVER/);
    expect(cs).toContain('DATABASE=SAMPLE');
    expect(cs).toContain('UID=u');
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

  it('adds CurrentSchema when schema is provided', () => {
    const cs = buildDb2ConnectionString(
      { host: 'h', database: 'D', username: 'u', password: 'p', schema: 'myschema' },
      'myschema'
    );
    expect(cs).toContain('CurrentSchema=MYSCHEMA');
  });
});

describe('odbcEscape', () => {
  it('leaves plain values alone', () => {
    expect(odbcEscape('plain')).toBe('plain');
  });

  it('escapes braces inside braced values', () => {
    expect(odbcEscape('a}b')).toBe('{a}}b}');
  });
});
