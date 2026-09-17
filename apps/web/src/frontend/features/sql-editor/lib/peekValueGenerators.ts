/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lightweight sample values for the Data Peek add/edit form. Kept sync and
 * dependency-free so a Generate click does not pull @faker-js/faker (~400 kB)
 * into the editor chunk — code cells still use faker when they ask for it.
 */
import type { PeekField } from '@/features/sql-editor/lib/peekRowValidation';

export type PeekGeneratorId = 'string' | 'money' | 'email' | 'firstName' | 'lastName';

export const PEEK_GENERATORS: { id: PeekGeneratorId; label: string }[] = [
  { id: 'string', label: 'String' },
  { id: 'money', label: 'Money' },
  { id: 'email', label: 'Email' },
  { id: 'firstName', label: 'First name' },
  { id: 'lastName', label: 'Last name' },
];

const FIRST_NAMES = [
  'Ava',
  'Noah',
  'Mia',
  'Liam',
  'Zoe',
  'Ethan',
  'Chloe',
  'Lucas',
  'Iris',
  'Owen',
  'Nora',
  'Kai',
  'Ella',
  'Leo',
  'Ruby',
  'Jude',
];

const LAST_NAMES = [
  'Nguyen',
  'Patel',
  'Garcia',
  'Kim',
  'Silva',
  'Chen',
  'Ali',
  'Brooks',
  'Sato',
  'Khan',
  'Rossi',
  'Murphy',
  'Costa',
  'Singh',
  'Lopez',
  'Park',
];

const WORDS = [
  'amber',
  'cedar',
  'delta',
  'ember',
  'flint',
  'grove',
  'harbor',
  'ivory',
  'jade',
  'keel',
  'lotus',
  'maple',
  'north',
  'orbit',
  'pine',
  'quartz',
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Build a sample string that respects a text column's max length when known. */
function generateString(maxLength?: number): string {
  const a = pick(WORDS);
  const b = pick(WORDS);
  const n = randInt(10, 99);
  let out = `${a}-${b}-${n}`;
  if (maxLength !== undefined && maxLength > 0 && out.length > maxLength) {
    out = out.slice(0, maxLength);
  }
  return out;
}

function generateMoney(scale = 2): string {
  const dollars = randInt(1, 9999);
  const cents = randInt(0, Math.pow(10, scale) - 1);
  return `${dollars}.${String(cents).padStart(scale, '0')}`;
}

function generateEmail(first?: string, last?: string): string {
  const local = `${(first ?? pick(FIRST_NAMES)).toLowerCase()}.${(last ?? pick(LAST_NAMES)).toLowerCase()}${randInt(1, 99)}`;
  const domain = pick(['example.com', 'mail.test', 'foxschema.dev']);
  return `${local}@${domain}`;
}

export function generatePeekValue(id: PeekGeneratorId, field?: Pick<PeekField, 'kind' | 'maxLength' | 'scale'>): string {
  switch (id) {
    case 'firstName':
      return pick(FIRST_NAMES);
    case 'lastName':
      return pick(LAST_NAMES);
    case 'email':
      return generateEmail();
    case 'money': {
      const scale = field?.scale ?? 2;
      return generateMoney(Math.min(Math.max(scale, 0), 4));
    }
    case 'string':
    default:
      return generateString(field?.maxLength);
  }
}

/**
 * Pick a sensible default generator from the column name + type so "Generate"
 * on an email column does not dump a random string.
 */
export function suggestPeekGenerator(field: Pick<PeekField, 'name' | 'kind' | 'type'>): PeekGeneratorId {
  const name = field.name.toLowerCase();
  if (/e_?mail|email_address/.test(name) || field.type.toLowerCase().includes('email')) {
    return 'email';
  }
  if (/first[_\s-]?name|given[_\s-]?name|fname|forename/.test(name)) return 'firstName';
  if (/last[_\s-]?name|sur[_\s-]?name|family[_\s-]?name|lname/.test(name)) return 'lastName';
  if (
    field.kind === 'decimal' ||
    /amount|price|cost|balance|salary|wage|fee|total|money/.test(name) ||
    /money|currency|numeric|decimal|number/.test(field.type.toLowerCase())
  ) {
    return 'money';
  }
  return 'string';
}

/** Convert a date / datetime-local control value into the draft string the form validates. */
export function draftFromDateInput(kind: 'date' | 'timestamp', value: string): string {
  if (!value) return '';
  if (kind === 'date') return value; // already YYYY-MM-DD
  // datetime-local → YYYY-MM-DD HH:MM:SS
  const [datePart, timePart = '00:00'] = value.split('T');
  const time = timePart.length === 5 ? `${timePart}:00` : timePart;
  return `${datePart} ${time}`;
}

/** Convert a draft timestamp/date into a value an HTML date/datetime-local input accepts. */
export function dateInputFromDraft(kind: 'date' | 'timestamp', draft: string): string {
  const v = (draft ?? '').trim();
  if (!v) return '';
  if (kind === 'date') {
    const m = /^(\d{4}-\d{1,2}-\d{1,2})/.exec(v);
    if (!m) return '';
    const [y, mo, d] = m[1]!.split('-');
    return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  const m = /^(\d{4}-\d{1,2}-\d{1,2})[ T](\d{1,2}:\d{2})(?::(\d{2}))?/.exec(v);
  if (!m) return '';
  const [y, mo, d] = m[1]!.split('-');
  const [hh, mm] = m[2]!.split(':');
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T${hh!.padStart(2, '0')}:${mm}`;
}
