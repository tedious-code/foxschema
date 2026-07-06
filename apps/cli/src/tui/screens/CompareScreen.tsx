import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import type { TableDiff } from '@foxschema/core';
import { useCompare } from '../data/useCompare';
import { TYPE_LABEL, groupByType, sortSections, sortByStatusThenName } from '../../format/diffPresentation';
import { SummaryBox } from '../components/SummaryBox';
import { StatusBadge } from '../components/StatusBadge';
import { KeyHints } from '../components/KeyHints';
import type { ConnRef } from '../types';

interface Props {
  source: ConnRef;
  target: ConnRef;
  onSelectDiff: (diff: TableDiff) => void;
  onMigrate: () => void;
}

const MIGRATE = Symbol('migrate');

export function CompareScreen({ source, target, onSelectDiff, onMigrate }: Props): React.JSX.Element {
  const state = useCompare(source, target);

  if (state.status === 'loading') {
    return (
      <Box paddingX={1}>
        <Text>
          <Spinner type="dots" /> Comparing {source.label} → {target.label}…
        </Text>
      </Box>
    );
  }

  if (state.status === 'error') {
    return (
      <Box paddingX={1}>
        <Text color="red">{state.error}</Text>
      </Box>
    );
  }

  const { added, removed, modified, unchanged } = state.data.summary;
  const changed = state.data.tables.filter((t) => t.status !== 'UNCHANGED');
  const drift = added + removed + modified > 0;

  // A single flat SelectInput can't render separate per-section headers, so each row's
  // label carries its own [TYPE] tag inline — same information as the line CLI's
  // section headers (renderGroupedView), just laid out for one selectable list.
  const items: Array<{ key: string; label: string; value: TableDiff | typeof MIGRATE }> = [
    ...sortSections([...groupByType(changed).entries()]).flatMap(([type, group]) =>
      sortByStatusThenName(group).map((t) => ({
        // ink-select-input keys items by `value` when no `key` is given — a whole
        // TableDiff object stringifies to the same "[object Object]" for every row,
        // so an explicit string key is required, not optional.
        key: `${type}:${t.tableName}`,
        label: `${t.status.padEnd(9)} [${TYPE_LABEL[type] ?? type}] ${t.tableName}`,
        value: t as TableDiff | typeof MIGRATE,
      }))
    ),
    // Kept last (not pre-selected) so the default action on landing here is "browse a
    // diff", not "migrate" — the destructive-adjacent action shouldn't be one Enter away.
    { key: 'migrate', label: `→ Migrate these ${changed.length} change(s)`, value: MIGRATE },
  ];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        Fox Compare — {source.label} → {target.label}
      </Text>
      <Box marginY={1}>
        <SummaryBox added={added} removed={removed} modified={modified} unchanged={unchanged} />
      </Box>
      {!drift ? (
        <Text color="green">✔ Schemas are identical.</Text>
      ) : (
        <SelectInput
          items={items}
          itemComponent={({ label, isSelected }) => {
            if (label.startsWith('→')) {
              return (
                <Text color={isSelected ? 'cyan' : 'yellow'} bold>
                  {label}
                </Text>
              );
            }
            const [status, ...rest] = label.split(/\s+/);
            return (
              <Text color={isSelected ? 'cyan' : undefined}>
                <StatusBadge status={status} /> {rest.join(' ')}
              </Text>
            );
          }}
          onSelect={(item) => (item.value === MIGRATE ? onMigrate() : onSelectDiff(item.value))}
        />
      )}
      <KeyHints hints={['↑↓ navigate', 'enter drill in', 'esc back']} />
    </Box>
  );
}
