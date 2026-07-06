import { useEffect, useState } from 'react';
import type { DbObjectType, SchemaCompareResult } from '@foxschema/core';
import { compareModule, loadScopedTables } from '../../runtime/engine';
import type { AsyncState, ConnRef } from '../types';

/** Plain, hook-independent data function — mirrors commands/compare.ts's runCompare sequence exactly. */
export async function loadCompareResult(
  source: ConnRef,
  target: ConnRef,
  scope?: DbObjectType[]
): Promise<SchemaCompareResult> {
  const [sourceTables, targetTables] = await Promise.all([
    loadScopedTables(source.dialect, source.option, source.schema, scope),
    loadScopedTables(target.dialect, target.option, target.schema, scope),
  ]);
  return compareModule.compare(sourceTables, targetTables, { source: source.dialect, target: target.dialect });
}

export function useCompare(source: ConnRef, target: ConnRef, scope?: DbObjectType[]): AsyncState<SchemaCompareResult> {
  const [state, setState] = useState<AsyncState<SchemaCompareResult>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadCompareResult(source, target, scope)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [source, target]);

  return state;
}
