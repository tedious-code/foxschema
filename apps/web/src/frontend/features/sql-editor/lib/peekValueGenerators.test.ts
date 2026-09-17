/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  dateInputFromDraft,
  draftFromDateInput,
  generatePeekValue,
  suggestPeekGenerator,
} from './peekValueGenerators';

describe('generatePeekValue', () => {
  it('produces each generator kind', () => {
    expect(generatePeekValue('firstName')).toMatch(/^[A-Z][a-z]+$/);
    expect(generatePeekValue('lastName')).toMatch(/^[A-Z][a-z]+$/);
    expect(generatePeekValue('email')).toMatch(/^.+@.+\..+$/);
    expect(generatePeekValue('money')).toMatch(/^\d+\.\d{2}$/);
    expect(generatePeekValue('string').length).toBeGreaterThan(0);
  });

  it('respects text maxLength', () => {
    expect(generatePeekValue('string', { kind: 'text', maxLength: 4 }).length).toBeLessThanOrEqual(4);
  });
});

describe('suggestPeekGenerator', () => {
  it('picks from column name cues', () => {
    expect(suggestPeekGenerator({ name: 'email', kind: 'text', type: 'varchar' })).toBe('email');
    expect(suggestPeekGenerator({ name: 'first_name', kind: 'text', type: 'text' })).toBe('firstName');
    expect(suggestPeekGenerator({ name: 'last_name', kind: 'text', type: 'text' })).toBe('lastName');
    expect(suggestPeekGenerator({ name: 'amount', kind: 'decimal', type: 'numeric' })).toBe('money');
    expect(suggestPeekGenerator({ name: 'note', kind: 'text', type: 'text' })).toBe('string');
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
