import { describe, it, expect } from 'vitest';
import { filterAutocompleteOptions } from './Autocomplete';

describe('filterAutocompleteOptions', () => {
  const options = [
    { value: 'public', hint: 'schema' },
    { value: 'report_user', label: 'report_user', hint: 'user' },
    { value: 'reporting', hint: 'schema' },
    { value: 'orders', hint: 'table' },
  ];

  it('returns all options up to max when query is empty', () => {
    expect(filterAutocompleteOptions(options, '', 2)).toHaveLength(2);
  });

  it('ranks prefix matches above substring matches', () => {
    const hits = filterAutocompleteOptions(options, 'rep');
    expect(hits[0]?.value).toBe('report_user');
    expect(hits.some((h) => h.value === 'reporting')).toBe(true);
  });

  it('matches label text', () => {
    expect(filterAutocompleteOptions([{ value: 'x', label: 'Customer Orders' }], 'order')).toHaveLength(
      1
    );
  });
});
