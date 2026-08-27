import React from 'react';
import {
  Autocomplete,
  type AutocompleteOption,
} from '@/shared/components/Autocomplete';

export type { AutocompleteOption };

/** SQL Editor autocomplete — violet theme, exact match on blur. */
export const SchemaAutocomplete: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: AutocompleteOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}> = (props) => <Autocomplete {...props} theme="violet" maxResults={60} resolveExactOnBlur />;
