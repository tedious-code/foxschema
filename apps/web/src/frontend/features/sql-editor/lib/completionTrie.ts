/** Compact prefix trie for SQL identifier autocomplete. */

export type TrieNode = {
  children: Map<string, TrieNode>;
  /** Terminal labels that end at this node (original casing). */
  values: string[];
};

export function createTrie(): TrieNode {
  return { children: new Map(), values: [] };
}

export function trieInsert(root: TrieNode, label: string): void {
  let node = root;
  const key = label.toLowerCase();
  for (const ch of key) {
    let next = node.children.get(ch);
    if (!next) {
      next = createTrie();
      node.children.set(ch, next);
    }
    node = next;
  }
  if (!node.values.includes(label)) node.values.push(label);
}

/** Collect up to `limit` labels under the node reached by `prefix` (case-insensitive). */
export function trieCollect(root: TrieNode, prefix: string, limit = 200): string[] {
  let node: TrieNode | undefined = root;
  const key = prefix.toLowerCase();
  for (const ch of key) {
    node = node.children.get(ch);
    if (!node) return [];
  }
  const out: string[] = [];
  const walk = (n: TrieNode) => {
    if (out.length >= limit) return;
    for (const v of n.values) {
      out.push(v);
      if (out.length >= limit) return;
    }
    for (const child of n.children.values()) walk(child);
  };
  walk(node);
  return out;
}

export type SchemaTrieBundle = {
  revision: string;
  tables: TrieNode;
  columnsByTable: Map<string, TrieNode>; // lower table key → column trie
};

/**
 * Stable revision from connection ids + table/column *names* (and object types).
 * Counts alone miss renames and swap-in-place metadata changes.
 */
export function schemaRevision(
  schemas: Array<{
    connectionId: string;
    tables: Array<{
      name: string;
      objectType?: string;
      columns?: Array<{ name: string }>;
    }>;
  }>
): string {
  return schemas
    .map((s) => {
      const tables = [...s.tables]
        .map((t) => {
          const cols = [...(t.columns ?? []).map((c) => c.name)].sort().join(',');
          return `${t.objectType ?? ''}:${t.name}(${cols})`;
        })
        .sort()
        .join(';');
      return `${s.connectionId}:{${tables}}`;
    })
    .join('|');
}

export function buildSchemaTries(
  schemas: Array<{
    connectionId: string;
    tables: Array<{
      name: string;
      objectType?: string;
      columns?: Array<{ name: string }>;
    }>;
  }>
): SchemaTrieBundle {
  const tables = createTrie();
  const columnsByTable = new Map<string, TrieNode>();
  for (const src of schemas) {
    for (const t of src.tables) {
      const ot = t.objectType;
      if (ot && ot !== 'TABLE' && ot !== 'VIEW' && ot !== 'MQT') continue;
      trieInsert(tables, t.name);
      const lower = t.name.toLowerCase();
      const bare = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : lower;
      let colTrie = columnsByTable.get(lower);
      if (!colTrie) {
        colTrie = createTrie();
        columnsByTable.set(lower, colTrie);
        columnsByTable.set(bare, colTrie);
      }
      for (const c of t.columns ?? []) trieInsert(colTrie, c.name);
    }
  }
  return { revision: schemaRevision(schemas), tables, columnsByTable };
}
