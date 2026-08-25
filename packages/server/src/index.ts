/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The public surface of the server package.
 *
 * Deliberately narrow. This replaced six deep subpaths into `apps/web`
 * (`@foxschema/web/auth`, `/connection-store`, `/migration-history`,
 * `/app-settings`, `/store`, `/serve`) which had to be listed by hand in both
 * `apps/web/package.json` and the root `vitest.config.ts` — two copies that no
 * type checker compares. Moving a file while updating only one of them
 * typechecked clean, passed the unit suite, and failed only in the CLI tests.
 * That happened twice. One entry point cannot drift from itself.
 *
 * What belongs here is what a *consumer* needs — the CLI, and the web app's
 * serve entry. Everything else stays internal, so the package can be
 * restructured without breaking anyone. Adding an export is a decision, not a
 * convenience: it becomes a contract the next refactor has to honour.
 */

/** Running the whole thing: single-origin UI + API. */
export { startUiServer, serverFlavour } from './startUiServer';
export type { StartUiServerOptions, StartedUiServer } from './startUiServer';
export { DEFAULT_API_PORT } from './defaultApiPort';

/** The HTTP app itself, for tests and for embedding. */
export { createApp, startServer } from './api/server';

/** Metadata store access, for callers that talk to the database directly. */
export { getStore } from './database/store';

/** Feature services the CLI drives without going through HTTP. */
export { AuthModule } from './modules/auth/auth.service';
export { ConnectionStore } from './modules/connections/connection-store.service';
export type { SavedConnectionSummary } from './modules/connections/connection-store.service';
export { MigrationHistoryStore } from './modules/migration/migration-history.service';
export type {
  MigrationRunDetail,
  MigrationRunSummary,
  MigrationObjectResult,
  MigrationRunStatus,
} from './modules/migration/migration-history.service';
export { AppSettingsStore } from './modules/admin/app-settings.service';

/** Logging, so a host process writes into the same stream as the server. */
export { getLogger } from './platform/logger/logger';

/** The error contract, re-exported so consumers need one import. */
export { ServiceError, toApiError, toHttpError } from './platform/contracts/actor';
export type { ActorContext } from './platform/contracts/actor';
