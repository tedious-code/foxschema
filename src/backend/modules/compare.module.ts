import { TableSchema, ColumnInfo, IndexInfo, ForeignKeyInfo } from '../interfaces/schema-provider.interface';
import { SchemaCompareResult, TableDiff, ColumnDiff, IndexDiff, ForeignKeyDiff } from '../types/diff.types';

export class CompareModule {
  async compare(sourceSchemas: TableSchema[], targetSchemas: TableSchema[]): Promise<SchemaCompareResult> {
    // Simulate complex background schema analytics calculations
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const sourceMap = new Map<string, TableSchema>(sourceSchemas.map((t) => [t.name.toUpperCase(), t]));
    const targetMap = new Map<string, TableSchema>(targetSchemas.map((t) => [t.name.toUpperCase(), t]));

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
          targetTable: target,
        });
      } else if (source && target) {
        // Evaluate structural differences
        const columnDiffs = this.compareColumns(source.columns, target.columns);
        const indexDiffs = this.compareIndices(source.indices, target.indices);
        const foreignKeyDiffs = this.compareForeignKeys(source.foreignKeys, target.foreignKeys);

        const isModified =
          columnDiffs.some((d) => d.status !== 'UNCHANGED') ||
          indexDiffs.some((d) => d.status !== 'UNCHANGED') ||
          foreignKeyDiffs.some((d) => d.status !== 'UNCHANGED') ||
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
    const sMap = new Map(sourceCols.map((c) => [c.name.toUpperCase(), c]));
    const tMap = new Map(targetCols.map((c) => [c.name.toUpperCase(), c]));
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

        if (typeChanged || nullChanged || defaultChanged || pkChanged) {
          return { name, status: 'MODIFIED', source: sCol, target: tCol };
        }
        return { name, status: 'UNCHANGED', source: sCol, target: tCol };
      }
      return { name, status: 'UNCHANGED' };
    });
  }

  private compareIndices(sourceInds: IndexInfo[], targetInds: IndexInfo[]): IndexDiff[] {
    const sMap = new Map(sourceInds.map((i) => [i.name.toUpperCase(), i]));
    const tMap = new Map(targetInds.map((i) => [i.name.toUpperCase(), i]));
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

  private compareForeignKeys(sourceFks: ForeignKeyInfo[], targetFks: ForeignKeyInfo[]): ForeignKeyDiff[] {
    const sMap = new Map(sourceFks.map((f) => [f.name.toUpperCase(), f]));
    const tMap = new Map(targetFks.map((f) => [f.name.toUpperCase(), f]));
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
        const refTableChanged = sFk.referencedTable.toUpperCase() !== tFk.referencedTable.toUpperCase();
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
