/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { redactCredentials } from './redact';

describe('redactCredentials', () => {
  it('censors the password in a connection URL but keeps the user', () => {
    // An Oracle driver message that quotes the connection string back.
    const leak =
      'NJS-515: error in Easy Connect connection string: input string not in ' +
      'easy connect format: oracle://u:LEAKME_PW_XYZ@127.0.0.1:9999/nodb';
    const safe = redactCredentials(leak);
    expect(safe).not.toContain('LEAKME_PW_XYZ');
    // The username is kept: it identifies which account failed and is not a
    // secret.
    expect(safe).toContain('oracle://u:***@127.0.0.1:9999/nodb');
  });

  it.each([
    ['postgres://admin:s3cr3t@db:5432/app', 'postgres://admin:***@db:5432/app'],
    ['mysql://root:p%40ss@127.0.0.1/x', 'mysql://root:***@127.0.0.1/x'],
  ])('censors %s', (input, expected) => {
    expect(redactCredentials(input)).toBe(expected);
  });

  it.each([
    ['DATABASE=x;UID=u;PWD=hunter2;', 'DATABASE=x;UID=u;PWD=***;'],
    ['Server=a;Password=hunter2;Trusted=no', 'Server=a;Password=***;Trusted=no'],
    ['passwd=hunter2 and more text', 'passwd=*** and more text'],
  ])('censors DSN pairs in %s', (input, expected) => {
    expect(redactCredentials(input)).toBe(expected);
  });

  it('leaves an ordinary message alone', () => {
    // The rules are narrow so that ordinary messages stay readable: mentioning
    // the word "password" is not the same as containing one.
    const msg = 'password authentication failed for user "nope_user"';
    expect(redactCredentials(msg)).toBe(msg);
  });

  it('does not swallow the rest of a sentence after a DSN pair', () => {
    expect(redactCredentials('PWD=abc; retry the connection')).toBe('PWD=***; retry the connection');
  });

  it('handles several secrets in one message', () => {
    const out = redactCredentials('a=1 postgres://u1:p1@h/db and PWD=p2;');
    expect(out).not.toMatch(/p1|p2/);
    expect(out).toContain('postgres://u1:***@h/db');
    expect(out).toContain('PWD=***');
  });

  it('leaves a URL with no credentials untouched', () => {
    const url = 'https://example.com/path?x=1';
    expect(redactCredentials(url)).toBe(url);
  });
});
