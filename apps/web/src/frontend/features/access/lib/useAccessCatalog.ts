import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSqlEditorStore } from '@/app/store/useSqlEditorStore';
import { fetchDbAccess, fetchSchemaList } from '@/shared/api/schemaApi';
import { findCachedTable, tableNameParts } from '@/shared/lib/tablePreview';
import type { DbPrincipal } from './access';

type Conn = {
  id: string;
  dialect?: string;
  database?: string;
  schema?: string;
} | null;

function tableBareName(qualified: string): string {
  const parts = tableNameParts(qualified);
  return parts[parts.length - 1] ?? qualified;
}

function tableSchemaName(qualified: string): string | null {
  const parts = tableNameParts(qualified);
  return parts.length > 1 ? parts[0]! : null;
}

/** Principals, schemas, and table/column names for Access Assistant autocomplete. */
export function useAccessCatalog(connectionId: string, conn: Conn) {
  const sessionPasswords = useSqlEditorStore((s) => s.sessionPasswords);
  const ensureSchema = useSqlEditorStore((s) => s.ensureSchema);
  const cacheEntry = useSqlEditorStore((s) =>
    connectionId ? s.schemaCache[connectionId] : undefined
  );

  const [principals, setPrincipals] = useState<DbPrincipal[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [loadingPrincipals, setLoadingPrincipals] = useState(false);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadPrincipals = useCallback(async () => {
    if (!connectionId) return;
    setLoadingPrincipals(true);
    setCatalogError(null);
    try {
      const res = await fetchDbAccess(
        { connectionId, password: sessionPasswords[connectionId] || undefined },
        { schema: conn?.schema || undefined }
      );
      setPrincipals(res.principals ?? []);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : String(e));
      setPrincipals([]);
    } finally {
      setLoadingPrincipals(false);
    }
  }, [connectionId, conn?.schema, sessionPasswords]);

  const loadSchemas = useCallback(async () => {
    if (!connectionId) return;
    setLoadingSchemas(true);
    try {
      const list = await fetchSchemaList({
        connectionId,
        password: sessionPasswords[connectionId] || undefined,
        schema: conn?.schema || undefined,
      });
      const merged = new Set<string>();
      if (conn?.database?.trim()) merged.add(conn.database.trim());
      if (conn?.schema?.trim()) merged.add(conn.schema.trim());
      for (const s of list) if (s.trim()) merged.add(s.trim());
      setSchemas([...merged].sort((a, b) => a.localeCompare(b)));
    } catch {
      const fallback = [conn?.schema, conn?.database].filter(Boolean) as string[];
      setSchemas([...new Set(fallback)]);
    } finally {
      setLoadingSchemas(false);
    }
  }, [connectionId, conn?.database, conn?.schema, sessionPasswords]);

  const loadTables = useCallback(async () => {
    if (!connectionId) return;
    setLoadingTables(true);
    try {
      await ensureSchema(connectionId, { force: false });
    } finally {
      setLoadingTables(false);
    }
  }, [connectionId, ensureSchema]);

  useEffect(() => {
    if (!connectionId) {
      setPrincipals([]);
      setSchemas([]);
      return;
    }
    void loadPrincipals();
    void loadSchemas();
    void loadTables();
  }, [connectionId, loadPrincipals, loadSchemas, loadTables]);

  const principalOptions = useMemo(
    () =>
      principals.map((p) => ({
        value: p.name,
        hint: p.kind === 'user' ? 'user' : p.kind === 'role' ? 'role' : p.kind,
      })),
    [principals]
  );

  const schemaOptions = useMemo(
    () => schemas.map((s) => ({ value: s })),
    [schemas]
  );

  const databaseOptions = useMemo(() => {
    const dbs = new Set<string>();
    if (conn?.database?.trim()) dbs.add(conn.database.trim());
    for (const s of schemas) dbs.add(s);
    return [...dbs].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v }));
  }, [conn?.database, schemas]);

  const allTables = useMemo(() => {
    const tables = cacheEntry?.tables ?? [];
    return tables
      .filter((t) => t.objectType === 'TABLE' || t.objectType === 'MQT')
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b));
  }, [cacheEntry?.tables]);

  const tablesInSchema = useCallback(
    (schemaName: string) => {
      const want = schemaName.trim().toLowerCase();
      if (!want) return allTables.map(tableBareName);
      return allTables
        .filter((t) => {
          const ts = tableSchemaName(t);
          if (ts) return ts.toLowerCase() === want;
          return tableBareName(t).toLowerCase().includes(want) || !ts;
        })
        .map(tableBareName);
    },
    [allTables]
  );

  const columnsInTable = useCallback(
    (schemaName: string, tableName: string) => {
      const tables = cacheEntry?.tables ?? [];
      const qualified = schemaName.trim()
        ? `${schemaName.trim()}.${tableName.trim()}`
        : tableName.trim();
      const t =
        findCachedTable(tables, qualified) ??
        findCachedTable(tables, tableName.trim());
      return (t?.columns ?? []).map((c) => c.name).sort((a, b) => a.localeCompare(b));
    },
    [cacheEntry?.tables]
  );

  return {
    principals,
    principalOptions,
    schemas,
    schemaOptions,
    databaseOptions,
    allTables,
    tablesInSchema,
    columnsInTable,
    loadingPrincipals,
    loadingSchemas,
    loadingTables,
    catalogError,
    loadPrincipals,
    loadSchemas,
    loadTables,
    tablesReady: cacheEntry?.status === 'ready',
  };
}
