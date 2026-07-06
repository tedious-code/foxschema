import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useHistoryDetail } from '../data/useHistory';
import { STATUS_COLOR } from '../components/statusColor';
import { KeyHints } from '../components/KeyHints';

interface Props {
  runId: string;
}

const RESULT_COLOR: Record<string, string> = { SUCCESS: 'green', FAILED: 'red', SKIPPED: 'yellow', RUNNING: 'gray' };

export function HistoryDetailScreen({ runId }: Props): React.JSX.Element {
  const state = useHistoryDetail(runId);

  if (state.status === 'loading') {
    return (
      <Box paddingX={1}>
        <Text>
          <Spinner type="dots" /> Loading run…
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

  if (!state.data) {
    return (
      <Box paddingX={1}>
        <Text color="red">No migration run "{runId}".</Text>
      </Box>
    );
  }

  const run = state.data;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Run {run.id}</Text>
      <Text>
        status &nbsp;&nbsp;&nbsp;<Text color={STATUS_COLOR[run.status]}>{run.status}</Text>
      </Text>
      <Text>
        target &nbsp;&nbsp;&nbsp;{run.dialect} {run.host ?? ''} {run.database ?? ''}/{run.schema ?? ''}
      </Text>
      <Text>
        started &nbsp;&nbsp;{run.startedAt}
        {run.finishedAt ? `   finished ${run.finishedAt}` : ''}
      </Text>
      {run.error && (
        <Text>
          <Text color="red">error</Text> {run.error}
        </Text>
      )}
      {run.results.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Results ({run.results.length})</Text>
          {run.results.map((o) => (
            <Text key={o.name}>
              {'  '}
              <Text color={RESULT_COLOR[o.status] ?? 'white'}>{o.status}</Text> {o.action} {o.type} {o.name}
              {o.error && <Text color="red"> — {o.error}</Text>}
            </Text>
          ))}
        </Box>
      )}
      {run.script && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>--- script ---</Text>
          <Text>{run.script}</Text>
        </Box>
      )}
      <KeyHints hints={['esc back']} />
    </Box>
  );
}
