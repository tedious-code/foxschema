import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

/** Ink re-implementation of commands/compare.ts's summaryBox() as a bordered <Box> instead of hand-drawn box-chars. */
export function SummaryBox({ added, removed, modified, unchanged }: Props): React.JSX.Element {
  return (
    <Box borderStyle="round" paddingX={1} gap={3}>
      <Text color="green">+{added} Added</Text>
      <Text color="yellow">~{modified} Modified</Text>
      <Text color="red">-{removed} Removed</Text>
      <Text dimColor>={unchanged} Unchanged</Text>
    </Box>
  );
}
