import React from 'react';
import { Box, Text } from 'ink';
import type { TableDiff } from '@foxschema/core';
import { StatusBadge } from '../components/StatusBadge';
import { KeyHints } from '../components/KeyHints';
import { describeColumn, describeFk, describeIndex, describeTrigger } from '../../format/diffPresentation';

interface Props {
  diff: TableDiff;
}

function Section<T extends { status: string; name: string }>({
  title,
  items,
  describe,
}: {
  title: string;
  items: T[] | undefined;
  describe: (item: T) => string;
}): React.JSX.Element | null {
  const changed = (items ?? []).filter((i) => i.status !== 'UNCHANGED');
  if (changed.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        {title} ({changed.length})
      </Text>
      {changed.map((item) => (
        <Text key={item.name}>
          {'  '}
          <StatusBadge status={item.status} /> {item.name} <Text dimColor>— {describe(item)}</Text>
        </Text>
      ))}
    </Box>
  );
}

export function TableDiffDetailScreen({ diff }: Props): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        <StatusBadge status={diff.status} /> [{diff.objectType}] {diff.tableName}
      </Text>
      <Section title="Columns" items={diff.columnDiffs} describe={describeColumn} />
      <Section title="Indexes" items={diff.indexDiffs} describe={describeIndex} />
      <Section title="Foreign Keys" items={diff.foreignKeyDiffs} describe={describeFk} />
      <Section title="Triggers" items={diff.triggerDiffs} describe={describeTrigger} />
      {diff.columnDiffs.every((c) => c.status === 'UNCHANGED') &&
        diff.indexDiffs.every((i) => i.status === 'UNCHANGED') &&
        diff.foreignKeyDiffs.every((f) => f.status === 'UNCHANGED') &&
        (!diff.triggerDiffs || diff.triggerDiffs.every((t) => t.status === 'UNCHANGED')) && (
          <Text dimColor>No column/index/FK/trigger-level detail — this is an object-level {diff.status.toLowerCase()}.</Text>
        )}
      <KeyHints hints={['esc back']} />
    </Box>
  );
}
