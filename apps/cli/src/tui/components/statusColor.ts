/** Ink-color equivalent of commands/history.ts's statusColor, for MigrationRunStatus values. */
export const STATUS_COLOR: Record<string, string> = {
  SUCCESS: 'green',
  PARTIAL_SUCCESS: 'yellow',
  ROLLED_BACK: 'yellow',
  FAILED: 'red',
  RUNNING: 'gray',
};
