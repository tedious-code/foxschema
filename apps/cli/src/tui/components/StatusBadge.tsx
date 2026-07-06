import React from 'react';
import { Text } from 'ink';

const COLOR: Record<string, string> = { ADDED: 'green', REMOVED: 'red', MODIFIED: 'yellow', UNCHANGED: 'gray' };
const MARK: Record<string, string> = { ADDED: '+', REMOVED: '-', MODIFIED: '~', UNCHANGED: '=' };

/** Ink equivalent of commands/compare.ts's STATUS_MARK — same colors/marks, via <Text color> instead of chalk. */
export function StatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <Text color={COLOR[status] ?? 'white'} bold>
      {MARK[status] ?? '·'}
    </Text>
  );
}
