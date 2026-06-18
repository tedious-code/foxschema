import { SchemaCompareResult, TableDiff, ColumnDiff, IndexDiff, ForeignKeyDiff, TriggerDiff } from '../interfaces/diff.types.interface';
import { TableSchema, ColumnInfo, IndexInfo, ForeignKeyInfo, TriggerInfo } from '../interfaces/schema.interface';

export class CompareModule {
  /**
   * Normalizes an object name for matching: drops any leading "schema." qualifier
   * and uppercases. So HUY.MyTable, "YOU".MyTable and MyTable all match —
   * the comparison is about the object, not which schema it was read from.
   */
  private key(name: string): string {
    return name.replace(/^"?[^".]+"?\./, '').replace(/"/g, '').toUpperCase();
  }

  async compare(sourceSchemas: TableSchema[], targetSchemas: TableSchema[]): Promise<SchemaCompareResult> {
    const sourceMap = new Map<string, TableSchema>(sourceSchemas.map((t) => [this.key(t.name), t]));
    const targetMap = new Map<string, TableSchema>(targetSchemas.map((t) => [this.key(t.name), t]));

    const allTableNames = Array.from(new Set([...Array.from(sourceMap.keys()), ...Array.from(targetMap.keys())]));
    const tableDiffs: TableDiff[] = [];

    let added = 0;
    let removed = 0;
    let modified = 0;
    let unchanged = 0;

    for (const tableName of allTableNames) {
      const source = sourceMap.get(tableName);
      const target = targetMap.get(tableName);

      if (source && !target) {
        // Table added in source (needs to be created in target to sync)
        added++;
        tableDiffs.push({
          tableName,
          objectType: source.objectType,
          status: 'ADDED',
          definition: source.definition,
          columnDiffs: source.columns.map((c) => ({ name: c.name, status: 'ADDED', source: c })),
          indexDiffs: source.indices.map((i) => ({ name: i.name, status: 'ADDED', source: i })),
          foreignKeyDiffs: source.foreignKeys.map((f) => ({ name: f.name, status: 'ADDED', source: f })),
          triggerDiffs: (source.triggers ?? []).map((t) => ({ name: t.name, status: 'ADDED' as const, source: t })),
          sourceTable: source,
        });
      } else if (!source && target) {
        // Table exists in target but not in source (needs to be dropped in target to match source)
        removed++;
        tableDiffs.push({
          tableName,
          objectType: target.objectType,
          status: 'REMOVED',
          definition: target.definition,
          columnDiffs: target.columns.map((c) => ({ name: c.name, status: 'REMOVED', target: c })),
          indexDiffs: target.indices.map((i) => ({ name: i.name, status: 'REMOVED', target: i })),
          foreignKeyDiffs: target.foreignKeys.map((f) => ({ name: f.name, status: 'REMOVED', target: f })),
          triggerDiffs: (target.triggers ?? []).map((t) => ({ name: t.name, status: 'REMOVED' as const, target: t })),
          targetTable: target,
        });
      } else if (source && target) {
        // Evaluate structural differences
        const columnDiffs = this.compareColumns(source.columns, target.columns);
        const indexDiffs = this.compareIndices(source.indices, target.indices);
        const foreignKeyDiffs = this.compareForeignKeys(source.foreignKeys, target.foreignKeys);
        const triggerDiffs = this.compareTriggers(source.triggers ?? [], target.triggers ?? []);

        const pkChanged =
          JSON.stringify(source.primaryKey?.columns ?? []) !==
          JSON.stringify(target.primaryKey?.columns ?? []);

        // Sequences and user-defined types carry their state in dedicated fields
        const sequenceChanged = JSON.stringify(source.sequence ?? {}) !== JSON.stringify(target.sequence ?? {});
        const userTypeChanged = JSON.stringify(source.userType ?? {}) !== JSON.stringify(target.userType ?? {});

        const isModified =
          columnDiffs.some((d) => d.status !== 'UNCHANGED') ||
          indexDiffs.some((d) => d.status !== 'UNCHANGED') ||
          foreignKeyDiffs.some((d) => d.status !== 'UNCHANGED') ||
          triggerDiffs.some((d) => d.status !== 'UNCHANGED') ||
          pkChanged ||
          sequenceChanged ||
          userTypeChanged ||
          source.definition !== target.definition;

        if (isModified) {
          modified++;
        } else {
          unchanged++;
        }

        tableDiffs.push({
          tableName,
          objectType: source.objectType,
          status: isModified ? 'MODIFIED' : 'UNCHANGED',
          definition: source.definition || target.definition,
          columnDiffs,
          indexDiffs,
          foreignKeyDiffs,
          triggerDiffs,
          sourceTable: source,
          targetTable: target,
        });
      }
    }

    return {
      tables: tableDiffs.sort((a, b) => a.tableName.localeCompare(b.tableName)),
      summary: { added, removed, modified, unchanged },
    };
  }

  private compareColumns(sourceCols: ColumnInfo[], targetCols: ColumnInfo[]): ColumnDiff[] {
    const sMap = new Map(sourceCols.map((c) => [this.key(c.name), c]));
    const tMap = new Map(targetCols.map((c) => [this.key(c.name), c]));
    const allColNames = Array.from(new Set([...Array.from(sMap.keys()), ...Array.from(tMap.keys())]));

    return allColNames.map((name) => {
      const sCol = sMap.get(name);
      const tCol = tMap.get(name);

      if (sCol && !tCol) {
        return { name, status: 'ADDED', source: sCol };
      } else if (!sCol && tCol) {
        return { name, status: 'REMOVED', target: tCol };
      } else if (sCol && tCol) {
        const typeChanged = sCol.type.toLowerCase() !== tCol.type.toLowerCase();
        const nullChanged = sCol.nullable !== tCol.nullable;
        const defaultChanged = sCol.defaultValue !== tCol.defaultValue;
        const pkChanged = sCol.primaryKey !== tCol.primaryKey;
        const identityChanged = !!sCol.identity !== !!tCol.identity;

        if (typeChanged || nullChanged || defaultChanged || pkChanged || identityChanged) {
          return { name, status: 'MODIFIED', source: sCol, target: tCol };
        }
        return { name, status: 'UNCHANGED', source: sCol, target: tCol };
      }
      return { name, status: 'UNCHANGED' };
    });
  }

  private compareIndices(sourceInds: IndexInfo[], targetInds: IndexInfo[]): IndexDiff[] {
    const sMap = new Map(sourceInds.map((i) => [this.key(i.name), i]));
    const tMap = new Map(targetInds.map((i) => [this.key(i.name), i]));
    const allIndNames = Array.from(new Set([...Array.from(sMap.keys()), ...Array.from(tMap.keys())]));

    return allIndNames.map((name) => {
      const sIdx = sMap.get(name);
      const tIdx = tMap.get(name);

      if (sIdx && !tIdx) {
        return { name, status: 'ADDED', source: sIdx };
      } else if (!sIdx && tIdx) {
        return { name, status: 'REMOVED', target: tIdx };
      } else if (sIdx && tIdx) {
        const columnsChanged = JSON.stringify(sIdx.columns) !== JSON.stringify(tIdx.columns);
        const uniqueChanged = sIdx.unique !== tIdx.unique;

        if (columnsChanged || uniqueChanged) {
          return { name, status: 'MODIFIED', source: sIdx, target: tIdx };
        }
        return { name, status: 'UNCHANGED', source: sIdx, target: tIdx };
      }
      return { name, status: 'UNCHANGED' };
    });
  }

  private compareTriggers(sourceTrgs: TriggerInfo[], targetTrgs: TriggerInfo[]): TriggerDiff[] {
    const sMap = new Map(sourceTrgs.map((t) => [this.key(t.name), t]));
    const tMap = new Map(targetTrgs.map((t) => [this.key(t.name), t]));
    const allNames = Array.from(new Set([...Array.from(sMap.keys()), ...Array.from(tMap.keys())]));

    return allNames.map((name) => {
      const sTrg = sMap.get(name);
      const tTrg = tMap.get(name);

      if (sTrg && !tTrg) {
        return { name, status: 'ADDED' as const, source: sTrg };
      } else if (!sTrg && tTrg) {
        return { name, status: 'REMOVED' as const, target: tTrg };
      } else if (sTrg && tTrg) {
        const defChanged = (sTrg.definition ?? '').trim() !== (tTrg.definition ?? '').trim();
        if (defChanged) {
          return { name, status: 'MODIFIED' as const, source: sTrg, target: tTrg };
        }
        return { name, status: 'UNCHANGED' as const, source: sTrg, target: tTrg };
      }
      return { name, status: 'UNCHANGED' as const };
    });
  }

  private compareForeignKeys(sourceFks: ForeignKeyInfo[], targetFks: ForeignKeyInfo[]): ForeignKeyDiff[] {
    const sMap = new Map(sourceFks.map((f) => [this.key(f.name), f]));
    const tMap = new Map(targetFks.map((f) => [this.key(f.name), f]));
    const allFkNames = Array.from(new Set([...Array.from(sMap.keys()), ...Array.from(tMap.keys())]));

    return allFkNames.map((name) => {
      const sFk = sMap.get(name);
      const tFk = tMap.get(name);

      if (sFk && !tFk) {
        return { name, status: 'ADDED', source: sFk };
      } else if (!sFk && tFk) {
        return { name, status: 'REMOVED', target: tFk };
      } else if (sFk && tFk) {
        const colChanged = JSON.stringify(sFk.columns) !== JSON.stringify(tFk.columns);
        const refTableChanged = this.key(sFk.referencedTable) !== this.key(tFk.referencedTable);
        const refColChanged = JSON.stringify(sFk.referencedColumns) !== JSON.stringify(tFk.referencedColumns);

        if (colChanged || refTableChanged || refColChanged) {
          return { name, status: 'MODIFIED', source: sFk, target: tFk };
        }
        return { name, status: 'UNCHANGED', source: sFk, target: tFk };
      }
      return { name, status: 'UNCHANGED' };
    });
  }
}
