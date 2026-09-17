/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  dateInputFromDraft,
  draftFromDateInput,
  evaluatePeekFormula,
  generatePeekValue,
  resolvePeekNumberInput,
  suggestPeekGenerator,
  PEEK_GENERATORS,
} from './peekValueGenerators';

describe('generatePeekValue', () => {
  it('produces core generator kinds', () => {
    expect(generatePeekValue('firstName')).toMatch(/^[A-Za-z].+$/);
    expect(generatePeekValue('lastName')).toMatch(/^[A-Za-z].+$/);
    expect(generatePeekValue('email')).toMatch(/@.+\./);
    expect(generatePeekValue('money')).toMatch(/^\d+\.\d+$/);
    expect(generatePeekValue('gender').length).toBeGreaterThan(0);
    expect(generatePeekValue('country').length).toBeGreaterThan(0);
    expect(generatePeekValue('state').length).toBeGreaterThan(0);
    expect(generatePeekValue('city').length).toBeGreaterThan(0);
    expect(generatePeekValue('address')).toMatch(/\d/);
    expect(generatePeekValue('string').length).toBeGreaterThan(0);
  });

  it('lists curated faker-backed generators', () => {
    const ids = new Set(PEEK_GENERATORS.map((g) => g.id));
    for (const id of ['gender', 'country', 'state', 'city', 'address', 'email', 'money'] as const) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('respects text maxLength', () => {
    expect(generatePeekValue('string', { kind: 'text', maxLength: 4 }).length).toBeLessThanOrEqual(4);
  });
});

describe('suggestPeekGenerator', () => {
  it('picks from column name cues', () => {
    expect(suggestPeekGenerator({ name: 'email', kind: 'text', type: 'varchar' })).toBe('email');
    expect(suggestPeekGenerator({ name: 'first_name', kind: 'text', type: 'text' })).toBe('firstName');
    expect(suggestPeekGenerator({ name: 'gender', kind: 'text', type: 'text' })).toBe('gender');
    expect(suggestPeekGenerator({ name: 'country', kind: 'text', type: 'text' })).toBe('country');
    expect(suggestPeekGenerator({ name: 'city', kind: 'text', type: 'text' })).toBe('city');
    expect(suggestPeekGenerator({ name: 'address', kind: 'text', type: 'text' })).toBe('address');
    expect(suggestPeekGenerator({ name: 'amount', kind: 'decimal', type: 'numeric' })).toBe('money');
  });
});

describe('evaluatePeekFormula', () => {
  it('evaluates simple arithmetic', () => {
    expect(evaluatePeekFormula('=1+2*3')).toBe('7');
    expect(evaluatePeekFormula('=(10+5)/3')).toBe('5');
    expect(evaluatePeekFormula('=100*1.1')).toBe('110');
  });

  it('rejects unsafe or non-formula input', () => {
    expect(evaluatePeekFormula('10+2')).toBeNull();
    expect(evaluatePeekFormula('=alert(1)')).toBeNull();
    expect(evaluatePeekFormula('=1;2')).toBeNull();
  });

  it('resolvePeekNumberInput applies formulas on blur path', () => {
    expect(resolvePeekNumberInput('=2+2')).toBe('4');
    expect(resolvePeekNumberInput('42')).toBe('42');
  });
});

describe('date draft ↔ input', () => {
  it('round-trips date', () => {
    expect(draftFromDateInput('date', '2024-03-05')).toBe('2024-03-05');
    expect(dateInputFromDraft('date', '2024-3-5')).toBe('2024-03-05');
  });

  it('round-trips timestamp via datetime-local', () => {
    expect(draftFromDateInput('timestamp', '2024-03-05T14:30')).toBe('2024-03-05 14:30:00');
    expect(dateInputFromDraft('timestamp', '2024-03-05 14:30:00')).toBe('2024-03-05T14:30');
  });
});
