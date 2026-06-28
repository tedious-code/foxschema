// Browser-safe migration event shape, emitted by the engine's MigrationModule
// (in @foxschema/core) and consumed by the frontend to render progress. Kept
// here in shared so the UI can import it without pulling in the node runtime.
export type MigrationEvent =
  | { type: 'snapshot'; ddl: string }
  | { type: 'start'; total: number }
  | { type: 'object'; objectName: string; objectType: string; action: string; status: 'RUNNING' | 'SUCCESS' | 'FAILED'; error?: string }
  | { type: 'done'; success: boolean; rolledBack: boolean; error?: string };
