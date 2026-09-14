/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/http/src/index.ts).
 */
export { HttpSourcePipe } from './http.js';
export { MultiHttpSourcePipe } from './multi-http.js';
export { HttpSinkPipe } from './sink.js';
export {
  buildHttpRequest,
  executeHttpRequest,
  applyCredentialSecret,
  type HttpExecuteOptions,
  type HttpExecuteResult,
} from './request.js';
export {
  parseSetCookie,
  mergeCookies,
  cookieHeader,
  cookiesFromSecret,
  collectSetCookies,
  type StoredCookie,
} from './cookies.js';
export { HttpResponsePipe, shapeRunOutput } from './response.js';
export { HttpTransformPipe } from './transform.js';
