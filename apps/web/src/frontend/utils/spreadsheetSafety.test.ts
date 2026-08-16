/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { neutralizeSpreadsheetFormula } from './spreadsheetSafety';
import { toCsv } from './exportCsv';
import { toTsv } from './copyGrid';

describe('neutralizeSpreadsheetFormula', () => {
  it('defuses every leading character a spreadsheet reads as a formula', () => {
    expect(neutralizeSpreadsheetFormula('=HYPERLINK("http://evil","click")')).toBe(
      '\'=HYPERLINK("http://evil","click")'
    );
    expect(neutralizeSpreadsheetFormula('+1+1')).toBe("'+1+1");
    expect(neutralizeSpreadsheetFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeSpreadsheetFormula('-2+3+cmd|\' /c calc\'!A0')).toBe(
      "'-2+3+cmd|' /c calc'!A0"
    );
    expect(neutralizeSpreadsheetFormula('\tcmd')).toBe("'\tcmd");
  });

  it('leaves ordinary values — and plain numbers — alone', () => {
    // Quoting -5 would turn a numeric column into text and break every SUM in
    // the exported sheet, which is a worse outcome than the thing being fixed.
    expect(neutralizeSpreadsheetFormula('-5')).toBe('-5');
    expect(neutralizeSpreadsheetFormula('+3.25')).toBe('+3.25');
    expect(neutralizeSpreadsheetFormula('-1.5e-3')).toBe('-1.5e-3');
    expect(neutralizeSpreadsheetFormula('hello')).toBe('hello');
    expect(neutralizeSpreadsheetFormula('')).toBe('');
  });
});

describe('export paths', () => {
  it('CSV download neutralizes formulas but keeps negative numbers numeric', () => {
    const csv = toCsv(['note', 'delta'], [['=1+1', -5]]);
    expect(csv).toBe('note,delta\n\'=1+1,-5');
  });

  it('clipboard TSV neutralizes formulas too — paste is evaluated the same way', () => {
    expect(toTsv(['note'], [['=1+1']])).toBe("note\r\n'=1+1");
  });
});
