/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/sdk/src/pipe/infrastructure.ts).
 */
import type { CredentialStore } from '../../common/index.js';

export interface PipeLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Services pipes may use. Connectors must not open DB/HTTP with raw secrets
 * from config; go through this boundary (or `PipeContext.credentials`
 * until callers migrate fully).
 */
export interface InfrastructureContext {
  logger: PipeLogger;
  secrets: {
    get(credentialId: string): Promise<Record<string, unknown> | undefined>;
  };
  http: {
    fetch(url: string, init?: RequestInit): Promise<Response>;
  };
}

export type ErrorAction = 'retry' | 'fail' | 'skip';

const noopLogger: PipeLogger = {
  info() {},
  warn() {},
  error() {},
};

export interface CreateInfrastructureOptions {
  credentials?: CredentialStore;
  logger?: PipeLogger;
  fetch?: typeof fetch;
}

export function createInfrastructureContext(
  options: CreateInfrastructureOptions = {},
): InfrastructureContext {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    logger: options.logger ?? noopLogger,
    secrets: {
      async get(credentialId) {
        return options.credentials?.revealSecret(credentialId);
      },
    },
    http: {
      fetch(url, init) {
        return request(url, init);
      },
    },
  };
}
