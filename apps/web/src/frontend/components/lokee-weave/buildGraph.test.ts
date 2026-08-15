import { describe, expect, it } from 'vitest';
import { buildVersionGraph, deriveObjectColumns, edgeStatusFor, type BuiltGraph } from './buildGraph';
import {
  DEFAULT_LAYOUT,
  EMPTY_FILTERS,
  shortHash,
  type VersionGraphDTO,
  type VersionGraphFilters,
  type VersionGraphObject,
  type LokeeVersionNode,
} from './graphTypes';

/** Narrows to a version node, so `.data` is the version payload not the union. */
function versionNode(graph: BuiltGraph, id: string): LokeeVersionNode {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node || node.type !== 'versionNode') throw new Error(`no version node ${id}`);
  return node;
}

const filters = (over: Partial<VersionGraphFilters> = {}): VersionGraphFilters => ({
  ...EMPTY_FILTERS,
  objectTypes: new Set(),
  statuses: new Set(),
  ...over,
});

const obj = (
  versionId: string,
  objectKey: string,
  objectHash: string | null,
  status: VersionGraphObject['status'],
  objectType: VersionGraphObject['objectType'] = 'table'
): VersionGraphObject => ({
  versionId,
  objectKey,
  name: objectKey.slice(objectKey.indexOf(':') + 1),
  objectType,
  objectHash,
  status,
});

/**
 * orders: created v1, unchanged v2, modified v3.
 * old_view: exists v1-v2, deleted in v3.
 * user_stats: first appears in v3.
 */
const dto: VersionGraphDTO = {
  databaseId: 'db1',
  versions: [
    { id: 'v1', number: 1, createdAt: '2026-07-01T10:00:00Z', rootHash: 'r1' },
    { id: 'v2', number: 2, createdAt: '2026-07-05T10:00:00Z', rootHash: 'r2' },
    { id: 'v3', number: 3, createdAt: '2026-07-09T10:00:00Z', rootHash: 'r3' },
  ],
  objects: [
    obj('v1', 'table:ORDERS', 'A', 'added'),
    obj('v2', 'table:ORDERS', 'A', 'unchanged'),
    obj('v3', 'table:ORDERS', 'B', 'modified'),
    obj('v1', 'view:OLD_VIEW', 'C', 'added', 'view'),
    obj('v2', 'view:OLD_VIEW', 'C', 'unchanged', 'view'),
    obj('v3', 'view:OLD_VIEW', null, 'deleted', 'view'),
    obj('v3', 'index:USER_STATS', 'D', 'added', 'index'),
  ],
  totalVersions: 3,
  totalObjects: 3,
    truncatedObjects: false,
};

const nodeIds = (g: ReturnType<typeof buildVersionGraph>) => g.nodes.map((n) => n.id);
const edge = (g: ReturnType<typeof buildVersionGraph>, id: string) =>
  g.edges.find((e) => e.id === id);

describe('edgeStatusFor — lineage semantics', () => {
  it('same hash across versions is reuse, not a rewrite', () => {
    // The whole storage story: one immutable object, many positions.
    expect(edgeStatusFor(obj('v1', 'k', 'A', 'added'), obj('v2', 'k', 'A', 'unchanged'))).toBe(
      'reused'
    );
  });

  it('different hash for the same key is a modification', () => {
    expect(edgeStatusFor(obj('v1', 'k', 'A', 'added'), obj('v2', 'k', 'B', 'modified'))).toBe(
      'modified'
    );
  });

  it('no earlier position means the object was created here', () => {
    expect(edgeStatusFor(undefined, obj('v2', 'k', 'A', 'added'))).toBe('created');
  });

  it('a deleted position is a deletion regardless of hashes', () => {
    expect(edgeStatusFor(obj('v1', 'k', 'A', 'added'), obj('v2', 'k', null, 'deleted'))).toBe(
      'deleted'
    );
  });
});

describe('buildVersionGraph — layout', () => {
  it('puts the newest version at the top', () => {
    const g = buildVersionGraph(dto, filters());
    const v3 = versionNode(g, 'version:v3');
    const v1 = versionNode(g, 'version:v1');
    expect(v3.position.y).toBeLessThan(v1.position.y);
  });

  it('keeps one logical object in one column for its whole life', () => {
    // Horizontal jumping would make lineage impossible to follow.
    const g = buildVersionGraph(dto, filters());
    const xs = g.nodes
      .filter((n) => n.id.endsWith(':table:ORDERS'))
      .map((n) => n.position.x);
    expect(new Set(xs).size).toBe(1);
  });

  it('orders columns by first appearance, not alphabetically', () => {
    // Sorting by name would reshuffle every column the moment someone adds
    // an object whose name sorts early.
    const g = buildVersionGraph(dto, filters());
    expect(g.columns).toEqual(['table:ORDERS', 'view:OLD_VIEW', 'index:USER_STATS']);
  });

  it('leaves the column gap where an object did not exist yet', () => {
    // user_stats appears in v3 only — no fabricated v1/v2 node.
    const g = buildVersionGraph(dto, filters());
    expect(nodeIds(g)).toContain('object:v3:index:USER_STATS');
    expect(nodeIds(g)).not.toContain('object:v1:index:USER_STATS');
    expect(nodeIds(g)).not.toContain('object:v2:index:USER_STATS');
  });

  it('uses deterministic ids, never array indexes', () => {
    const g = buildVersionGraph(dto, filters());
    expect(nodeIds(g)).toContain('object:v2:table:ORDERS');
    expect(nodeIds(g)).toContain('version:v2');
  });

  it('honours a custom layout', () => {
    const g = buildVersionGraph(dto, filters(), { ...DEFAULT_LAYOUT, versionRowHeight: 500 });
    const v3 = versionNode(g, 'version:v3');
    const v2 = versionNode(g, 'version:v2');
    expect(Math.abs(v2.position.y - v3.position.y)).toBe(500);
  });

  it('nudge object cards down so they sit beside the version title', () => {
    const g = buildVersionGraph(dto, filters());
    const version = versionNode(g, 'version:v3');
    const object = g.nodes.find((n) => n.id === 'object:v3:table:ORDERS')!;
    expect(object.position.y).toBe(version.position.y + DEFAULT_LAYOUT.objectYOffset);
  });
});

describe('buildVersionGraph — edges', () => {
  it('joins an unchanged object to its previous position as reused', () => {
    const g = buildVersionGraph(dto, filters());
    expect(edge(g, 'lineage:table:ORDERS:v2:v1')!.data!.status).toBe('reused');
  });

  it('marks a hash change as modified', () => {
    const g = buildVersionGraph(dto, filters());
    expect(edge(g, 'lineage:table:ORDERS:v3:v2')!.data!.status).toBe('modified');
  });

  it('marks the tombstone edge as deleted', () => {
    const g = buildVersionGraph(dto, filters());
    expect(edge(g, 'lineage:view:OLD_VIEW:v3:v2')!.data!.status).toBe('deleted');
  });

  it('carries both hashes so the view can explain the change', () => {
    const g = buildVersionGraph(dto, filters());
    expect(edge(g, 'lineage:table:ORDERS:v3:v2')!.data).toMatchObject({
      previousHash: 'A',
      currentHash: 'B',
    });
  });

  it('draws the version spine between adjacent versions', () => {
    const g = buildVersionGraph(dto, filters());
    expect(edge(g, 'version:v3:v2')).toBeDefined();
    expect(edge(g, 'version:v2:v1')).toBeDefined();
  });

  it('does not draw a lineage edge to a node that was filtered out', () => {
    // A dangling edge renders as a line to nowhere.
    const g = buildVersionGraph(dto, filters({ changesOnly: true }));
    expect(edge(g, 'lineage:table:ORDERS:v2:v1')).toBeUndefined();
  });
});

describe('buildVersionGraph — tombstones and status', () => {
  it('renders a deleted position as a tombstone node type', () => {
    const g = buildVersionGraph(dto, filters());
    const node = g.nodes.find((n) => n.id === 'object:v3:view:OLD_VIEW')!;
    expect(node.type).toBe('deletedObjectNode');
  });

  it('does not carry the tombstone into versions that have none', () => {
    const g = buildVersionGraph(dto, filters());
    const tombstones = g.nodes.filter((n) => n.type === 'deletedObjectNode');
    expect(tombstones).toHaveLength(1);
  });

  it('exposes the previous hash on a modified node', () => {
    const g = buildVersionGraph(dto, filters());
    const node = g.nodes.find((n) => n.id === 'object:v3:table:ORDERS')!;
    expect(node.data).toMatchObject({ objectHash: 'B', previousHash: 'A' });
  });

  it('counts only real changes on the version node', () => {
    const g = buildVersionGraph(dto, filters());
    const v2 = versionNode(g, 'version:v2');
    // v2 is two unchanged objects — nothing actually changed.
    expect(v2.data.changeCount).toBe(0);
  });
});

describe('buildVersionGraph — filters', () => {
  it('hides unchanged objects in changes-only mode', () => {
    const g = buildVersionGraph(dto, filters({ changesOnly: true }));
    expect(nodeIds(g)).not.toContain('object:v2:table:ORDERS');
    expect(nodeIds(g)).toContain('object:v3:table:ORDERS');
  });

  it('narrows to chosen object types', () => {
    const g = buildVersionGraph(dto, filters({ objectTypes: new Set(['view']) }));
    expect(nodeIds(g).some((id) => id.includes('table:ORDERS'))).toBe(false);
    expect(nodeIds(g).some((id) => id.includes('view:OLD_VIEW'))).toBe(true);
  });

  it('can hide deleted objects', () => {
    const g = buildVersionGraph(dto, filters({ showDeleted: false }));
    expect(nodeIds(g)).not.toContain('object:v3:view:OLD_VIEW');
  });

  it('narrows by status', () => {
    const g = buildVersionGraph(dto, filters({ statuses: new Set(['added']) }));
    expect(nodeIds(g)).toContain('object:v1:table:ORDERS');
    expect(nodeIds(g)).not.toContain('object:v3:table:ORDERS');
  });

  it('keeps version nodes whatever the object filters say', () => {
    // Filtering objects must never make the timeline itself disappear.
    const g = buildVersionGraph(dto, filters({ objectTypes: new Set(['sequence']) }));
    expect(nodeIds(g)).toContain('version:v1');
    expect(nodeIds(g)).toContain('version:v3');
  });

  it('narrows to chosen versions and their objects', () => {
    const g = buildVersionGraph(dto, filters({ versionIds: new Set(['v2']) }));
    expect(nodeIds(g)).toContain('version:v2');
    expect(nodeIds(g)).not.toContain('version:v1');
    expect(nodeIds(g)).not.toContain('version:v3');
    expect(nodeIds(g)).toContain('object:v2:table:ORDERS');
    expect(nodeIds(g)).not.toContain('object:v3:table:ORDERS');
  });

  it('filters versions by inclusive date range', () => {
    const g = buildVersionGraph(dto, filters({ dateFrom: '2026-07-05', dateTo: '2026-07-05' }));
    expect(nodeIds(g)).toEqual(expect.arrayContaining(['version:v2']));
    expect(nodeIds(g)).not.toContain('version:v1');
    expect(nodeIds(g)).not.toContain('version:v3');
  });

  it('filters versions by author', () => {
    const withAuthors: VersionGraphDTO = {
      ...dto,
      versions: [
        { ...dto.versions[0]!, author: 'alice@example.com' },
        { ...dto.versions[1]!, author: 'bob@example.com' },
        { ...dto.versions[2]!, author: 'alice@example.com' },
      ],
    };
    const g = buildVersionGraph(withAuthors, filters({ authors: new Set(['alice@example.com']) }));
    expect(nodeIds(g)).toContain('version:v1');
    expect(nodeIds(g)).toContain('version:v3');
    expect(nodeIds(g)).not.toContain('version:v2');
  });

  it('carries custom name and description onto version nodes', () => {
    const named: VersionGraphDTO = {
      ...dto,
      versions: [
        { ...dto.versions[0]!, name: 'Baseline', description: 'First capture' },
        dto.versions[1]!,
        dto.versions[2]!,
      ],
    };
    const g = buildVersionGraph(named, filters());
    const v1 = versionNode(g, 'version:v1');
    expect(v1.data.name).toBe('Baseline');
    expect(v1.data.description).toBe('First capture');
  });
});

describe('buildVersionGraph — large graphs', () => {
  const many: VersionGraphDTO = {
    ...dto,
    objects: Array.from({ length: 60 }, (_, i) =>
      obj('v1', `table:T${String(i).padStart(3, '0')}`, 'H', i < 10 ? 'modified' : 'unchanged')
    ),
  };

  it('reports how many nodes the cap removed instead of truncating silently', () => {
    const g = buildVersionGraph(many, filters(), DEFAULT_LAYOUT, 20);
    expect(g.hiddenByCap).toBe(40);
    expect(g.nodes.filter((n) => n.type === 'schemaObjectNode')).toHaveLength(20);
  });

  it('keeps changed objects when the cap bites', () => {
    // Showing an arbitrary alphabetical prefix would hide exactly what the
    // reader opened the graph to find.
    const g = buildVersionGraph(many, filters(), DEFAULT_LAYOUT, 10);
    const kept = g.nodes
      .filter((n) => n.type === 'schemaObjectNode')
      .map((n) => (n.type === 'schemaObjectNode' ? n.data.status : undefined));
    expect(kept.every((s) => s === 'modified')).toBe(true);
  });

  it('reports nothing hidden when everything fits', () => {
    expect(buildVersionGraph(dto, filters()).hiddenByCap).toBe(0);
  });

  it('builds a 25 x 500 graph quickly', () => {
    const versions = Array.from({ length: 25 }, (_, i) => ({
      id: `v${i + 1}`,
      number: i + 1,
      createdAt: '2026-07-01T10:00:00Z',
      rootHash: `r${i}`,
    }));
    const objects = versions.flatMap((v) =>
      Array.from({ length: 500 }, (_, j) => obj(v.id, `table:T${j}`, `h${j}`, 'unchanged'))
    );
    const big: VersionGraphDTO = { ...dto, versions, objects, totalVersions: 25, totalObjects: 500 };
    const started = performance.now();
    const g = buildVersionGraph(big, filters(), DEFAULT_LAYOUT, 500);
    expect(performance.now() - started).toBeLessThan(500);
    expect(g.nodes.length).toBeGreaterThan(0);
  });
});

describe('deriveObjectColumns / shortHash', () => {
  it('ignores objects that were filtered away', () => {
    const visible = dto.objects.filter((o) => o.objectType === 'table');
    expect(deriveObjectColumns(dto, visible)).toEqual(['table:ORDERS']);
  });

  it('shortens a hash for the node face', () => {
    expect(shortHash('a1b2c3d4e5')).toBe('A1B2C3');
  });

  it('shows a dash rather than "null" for a tombstone', () => {
    expect(shortHash(null)).toBe('—');
    expect(shortHash(undefined)).toBe('—');
    expect(shortHash('')).toBe('—');
  });
});

describe('buildVersionGraph — degenerate input', () => {
  it('handles an empty history', () => {
    const g = buildVersionGraph(
      { databaseId: 'db', versions: [], objects: [], totalVersions: 0, totalObjects: 0, truncatedObjects: false },
      filters()
    );
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it('handles a single version with no spine edge', () => {
    const g = buildVersionGraph(
      {
        databaseId: 'db',
        versions: [dto.versions[0]!],
        objects: [obj('v1', 'table:A', 'H', 'added')],
        totalVersions: 1,
        totalObjects: 1,
    truncatedObjects: false,
      },
      filters()
    );
    expect(g.edges.filter((e) => e.id.startsWith('version:'))).toHaveLength(0);
    expect(nodeIds(g)).toContain('object:v1:table:A');
  });

  it('ignores an object pointing at a version that is not in the window', () => {
    const g = buildVersionGraph(
      { ...dto, objects: [...dto.objects, obj('v99', 'table:GHOST', 'H', 'added')] },
      filters()
    );
    expect(nodeIds(g).some((id) => id.includes('GHOST'))).toBe(false);
  });
});
