/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * HTTP in, HTTP out. One handler per endpoint, and nothing else in it.
 */
import type { HttpRequest, HttpResponse } from '../../platform/http/types';
import { toHttpError } from '../../platform/contracts/actor';
import { actorOf } from '../../platform/http/actor-of';
import type { CompareController } from './compare.controller';
import { parseCompareInput } from './compare.schema';

export function makeCompareHandlers(controller: CompareController) {
  return {
    async compare(req: HttpRequest, res: HttpResponse): Promise<void> {
      try {
        const result = await controller.compare(parseCompareInput(req.body), actorOf(req));
        res.json(result);
      } catch (error: unknown) {
        const { status, body } = toHttpError(error, 'Schema comparison failed');
        res.status(status).json(body);
      }
    },
  };
}
