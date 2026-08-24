/**
 * Schema comparison, independent of transport.
 *
 * The REST route is now a translation layer over this. A GraphQL resolver would
 * call the same function and inherit the same permission check, which is the
 * point of the split.
 */
import { CompareModule, type DbObjectType } from '@foxschema/db';
import { requirePermission, type ActorContext } from '../../platform/contracts/actor';
import type { ConnectionRef, ConnectionResolver } from '../../platform/db/resolve';

export interface CompareInput {
  source: ConnectionRef;
  target: ConnectionRef;
  scope: DbObjectType[];
}

/** The compare result, plus warnings when either side degraded (e.g. roles). */
export type CompareOutput = Awaited<ReturnType<CompareModule['compare']>> & {
  warnings?: string[];
};

export interface CompareService {
  compare(input: CompareInput, actor: ActorContext): Promise<CompareOutput>;
}

export function makeCompareService(deps: {
  resolver: ConnectionResolver;
  compareModule?: CompareModule;
}): CompareService {
  const compareModule = deps.compareModule ?? new CompareModule();

  return {
    async compare(input, actor) {
      requirePermission(actor, 'schema.compare');

      const src = await deps.resolver.resolveRef(actor.userId, input.source);
      const tgt = await deps.resolver.resolveRef(actor.userId, input.target);

      // Load both schemas and diff server-side; only the result crosses the wire.
      const [srcLoad, tgtLoad] = await Promise.all([
        deps.resolver.loadScopedTables(src.dialect, src.option, src.schema, input.scope),
        deps.resolver.loadScopedTables(tgt.dialect, tgt.option, tgt.schema, input.scope),
      ]);

      const result = await compareModule.compare(
        srcLoad.tables,
        tgtLoad.tables,
        { source: src.dialect, target: tgt.dialect },
        { source: src.schema, target: tgt.schema }
      );

      const warnings = [
        ...srcLoad.warnings.map((w) => `Source — ${w}`),
        ...tgtLoad.warnings.map((w) => `Target — ${w}`),
      ];
      return warnings.length ? { ...result, warnings } : result;
    },
  };
}
