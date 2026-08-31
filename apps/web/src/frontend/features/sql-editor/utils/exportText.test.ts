/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * These are mostly about YAML's implicit typing, which is where an export
 * quietly changes the data: unquoted `no` is a boolean, `0755` loses its zero,
 * and a column of version strings turns into floats. A round-trip that looks
 * fine and means something else is worse than one that fails.
 */
import { describe, expect, it } from 'vitest';
import { toFixedWidthText, toYaml, yamlScalar } from './exportText';

describe('yamlScalar', () => {
  it('leaves an ordinary word unquoted', () => {
    expect(yamlScalar('orders')).toBe('orders');
  });

  it.each(['no', 'No', 'yes', 'on', 'off', 'true', 'false', 'null', 'y', 'n'])(
    'quotes %s, which YAML would otherwise read as a boolean or null',
    (word) => {
      expect(yamlScalar(word)).toBe(`'${word}'`);
    }
  );

  it('quotes a number-like string so it stays a string', () => {
    // A zip code, a version, an account number with a leading zero.
    expect(yamlScalar('0755')).toBe("'0755'");
    expect(yamlScalar('1.0')).toBe("'1.0'");
  });

  it('keeps a real number unquoted', () => {
    expect(yamlScalar(42)).toBe('42');
    expect(yamlScalar(1.5)).toBe('1.5');
  });

  it('quotes NaN and Infinity, which are not YAML numbers', () => {
    expect(yamlScalar(Number.NaN)).toBe('"NaN"');
    expect(yamlScalar(Number.POSITIVE_INFINITY)).toBe('"Infinity"');
  });

  it('distinguishes SQL NULL from an empty string', () => {
    expect(yamlScalar(null)).toBe('null');
    expect(yamlScalar('')).toBe("''");
  });

  it('escapes an embedded quote', () => {
    expect(yamlScalar("O'Brien")).toBe("'O''Brien'");
  });

  it('quotes a value that would look like a key', () => {
    expect(yamlScalar('name: value')).toBe("'name: value'");
    expect(yamlScalar('trailing:')).toBe("'trailing:'");
  });

  it('uses a literal block for a multi-line value', () => {
    expect(yamlScalar('line one\nline two')).toBe('|-\n    line one\n    line two');
  });
});

describe('toYaml', () => {
  it('emits a sequence of mappings', () => {
    const out = toYaml(['id', 'name'], [[1, 'Ada'], [2, 'Grace']]);
    expect(out).toBe('- id: 1\n  name: Ada\n- id: 2\n  name: Grace\n');
  });

  it('quotes a column name that is not a plain key', () => {
    expect(toYaml(['total amount'], [[5]])).toContain("'total amount': 5");
  });

  it('keeps a multi-line value indented under its key', () => {
    const out = toYaml(['note'], [['a\nb']]);
    expect(out).toBe('- note: |-\n    a\n    b\n');
  });

  it('answers with an empty sequence rather than nothing', () => {
    expect(toYaml([], [])).toBe('[]\n');
    expect(toYaml(['id'], [])).toBe('[]\n');
  });
});

describe('toFixedWidthText', () => {
  it('pads every column to its widest cell', () => {
    const out = toFixedWidthText(['id', 'name'], [[1, 'Ada'], [22, 'Grace']]);
    expect(out.split('\n')).toEqual([
      'id  name',
      '--  -----',
      '1   Ada',
      '22  Grace',
    ]);
  });

  it('shows NULL rather than a blank, so a gap is not ambiguous', () => {
    expect(toFixedWidthText(['a'], [[null]])).toContain('NULL');
  });

  it('flattens a newline, which would otherwise break every row below it', () => {
    const out = toFixedWidthText(['note'], [['a\nb']]);
    expect(out.split('\n')).toHaveLength(3); // header, rule, one row
    expect(out).toContain('a b');
  });

  it('truncates a very wide cell instead of destroying the alignment', () => {
    const out = toFixedWidthText(['v'], [['x'.repeat(200)]], { maxColumnWidth: 10 });
    const widest = Math.max(...out.split('\n').map((l) => l.length));
    expect(widest).toBeLessThanOrEqual(10);
    expect(out).toContain('…');
  });

  it('returns nothing for a grid with no columns', () => {
    expect(toFixedWidthText([], [])).toBe('');
  });
});
