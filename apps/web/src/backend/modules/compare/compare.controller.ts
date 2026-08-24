/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compare use-cases.
 *
 * The controller is per feature; handlers are per endpoint. That division is
 * what stops this becoming a pass-through — orchestration that spans services
 * lives here, and it is the single place a resource check or a cache lookup can
 * be attached so no endpoint can skip one.
 *
 * No HTTP types: this is callable from a CLI, a worker or a test.
 */
import type { ActorContext } from '../../platform/contracts/actor';
import type { CompareInput, CompareOutput, CompareService } from './compare.service';

export interface CompareController {
  compare(input: CompareInput, actor: ActorContext): Promise<CompareOutput>;
}

export function makeCompareController(deps: {
  compareService: CompareService;
}): CompareController {
  return {
    /**
     * Thin today by design. The service already performs its own permission
     * check, so adding a wrapper that only forwards would be the pass-through
     * this layer exists to avoid.
     *
     * It earns its place when the plan's next two steps land: the resource-level
     * authorization check (docs/API_RESTRUCTURE_PLAN.md §6) and the scope-aware
     * cache (§4) both attach here, before the service runs, so neither can be
     * forgotten by an endpoint.
     */
    compare(input, actor) {
      return deps.compareService.compare(input, actor);
    },
  };
}
