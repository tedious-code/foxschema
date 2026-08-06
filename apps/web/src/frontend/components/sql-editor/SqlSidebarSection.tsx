import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { SQL_ICON_STROKE } from './sqlIconStyle';

const STORAGE_KEY = 'foxschema-sql-sidebar-sections';
const HEIGHTS_KEY = 'foxschema-sql-sidebar-section-heights';
const ORDER_KEY = 'foxschema-sql-sidebar-order';

export type SidebarSectionId =
  | 'destinations'
  | 'bookmarks'
  | 'variables'
  | 'vault'
  | 'utilities'
  | 'files'
  | 'schema';

const DEFAULT_OPEN: Record<SidebarSectionId, boolean> = {
  destinations: true,
  bookmarks: true,
  variables: true,
  vault: true,
  utilities: true,
  files: true,
  schema: true,
};

const DEFAULT_HEIGHTS: Record<SidebarSectionId, number> = {
  destinations: 140,
  bookmarks: 120,
  variables: 140,
  vault: 160,
  utilities: 280,
  files: 180,
  /** Taller default — Schema is pinned at the top of the sidebar. */
  schema: 280,
};

const MIN_SECTION_H = 72;
const MAX_SECTION_H = 480;

/** Schema stays first; other sections keep relative order below it. */
const DEFAULT_ORDER: SidebarSectionId[] = [
  'schema',
  'destinations',
  'bookmarks',
  'variables',
  'vault',
  'utilities',
  'files',
];

const ALL_SECTION_IDS = new Set<SidebarSectionId>(DEFAULT_ORDER);

/** Keep Schema pinned at the top of the sidebar menu. */
export function pinSchemaFirst(order: SidebarSectionId[]): SidebarSectionId[] {
  const rest = order.filter((id) => id !== 'schema');
  return ['schema', ...rest];
}

function normalizeOrder(raw: unknown): SidebarSectionId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ORDER];
  const seen = new Set<SidebarSectionId>();
  const result: SidebarSectionId[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !ALL_SECTION_IDS.has(id as SidebarSectionId)) continue;
    const sid = id as SidebarSectionId;
    if (seen.has(sid)) continue;
    seen.add(sid);
    result.push(sid);
  }
  for (const id of DEFAULT_ORDER) {
    if (!seen.has(id)) result.push(id);
  }
  return pinSchemaFirst(result);
}

function loadOrder(): SidebarSectionId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return [...DEFAULT_ORDER];
    return normalizeOrder(JSON.parse(raw));
  } catch {
    return [...DEFAULT_ORDER];
  }
}

/** Reorder sidebar sections (immutable). Schema stays pinned at index 0. */
export function moveSidebarSection(
  order: SidebarSectionId[],
  fromIndex: number,
  toIndex: number
): SidebarSectionId[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return order;
  if (fromIndex >= order.length || toIndex >= order.length) return order;
  // Schema is fixed at the top — ignore drags that try to move it or drop onto it.
  if (order[fromIndex] === 'schema' || order[toIndex] === 'schema') return order;
  const next = [...order];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item!);
  return pinSchemaFirst(next);
}

/** Persist SQL-editor sidebar section order. */
export function useSidebarSectionOrder(): [
  SidebarSectionId[],
  (fromIndex: number, toIndex: number) => void,
] {
  const [order, setOrder] = useState(loadOrder);

  useEffect(() => {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    } catch {
      /* ignore quota */
    }
  }, [order]);

  const move = useCallback((fromIndex: number, toIndex: number) => {
    setOrder((prev) => moveSidebarSection(prev, fromIndex, toIndex));
  }, []);

  return [order, move];
}

function loadOpen(): Record<SidebarSectionId, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPEN };
    const parsed = JSON.parse(raw) as Partial<Record<SidebarSectionId, boolean>>;
    return {
      destinations: parsed.destinations ?? true,
      bookmarks: parsed.bookmarks ?? true,
      variables: parsed.variables ?? true,
      // Prefer `vault`; accept legacy `secrets` key from older localStorage.
      vault: parsed.vault ?? (parsed as { secrets?: boolean }).secrets ?? true,
      utilities: parsed.utilities ?? true,
      files: parsed.files ?? true,
      schema: parsed.schema ?? true,
    };
  } catch {
    return { ...DEFAULT_OPEN };
  }
}

function loadHeights(): Record<SidebarSectionId, number> {
  try {
    const raw = localStorage.getItem(HEIGHTS_KEY);
    if (!raw) return { ...DEFAULT_HEIGHTS };
    const parsed = JSON.parse(raw) as Partial<Record<SidebarSectionId, number>>;
    const clamp = (n: unknown, fallback: number) => {
      const v = typeof n === 'number' ? n : fallback;
      return Math.min(MAX_SECTION_H, Math.max(MIN_SECTION_H, v));
    };
    return {
      destinations: clamp(parsed.destinations, DEFAULT_HEIGHTS.destinations),
      bookmarks: clamp(parsed.bookmarks, DEFAULT_HEIGHTS.bookmarks),
      variables: clamp(parsed.variables, DEFAULT_HEIGHTS.variables),
      vault: clamp(
        parsed.vault ?? (parsed as { secrets?: number }).secrets,
        DEFAULT_HEIGHTS.vault
      ),
      utilities: clamp(parsed.utilities, DEFAULT_HEIGHTS.utilities),
      files: clamp(parsed.files, DEFAULT_HEIGHTS.files),
      schema: clamp(parsed.schema, DEFAULT_HEIGHTS.schema),
    };
  } catch {
    return { ...DEFAULT_HEIGHTS };
  }
}

/** Persist which SQL-editor sidebar sections are expanded. */
export function useSidebarSectionsOpen(): [
  Record<SidebarSectionId, boolean>,
  (id: SidebarSectionId) => void,
] {
  const [open, setOpen] = useState(loadOpen);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
    } catch {
      /* ignore quota */
    }
  }, [open]);

  const toggle = (id: SidebarSectionId) => {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return [open, toggle];
}

/** Persist per-section content heights (drag handles). */
export function useSidebarSectionHeights(): [
  Record<SidebarSectionId, number>,
  (id: SidebarSectionId, height: number) => void,
] {
  const [heights, setHeights] = useState(loadHeights);

  useEffect(() => {
    try {
      localStorage.setItem(HEIGHTS_KEY, JSON.stringify(heights));
    } catch {
      /* ignore */
    }
  }, [heights]);

  const setHeight = useCallback((id: SidebarSectionId, height: number) => {
    setHeights((prev) => ({
      ...prev,
      [id]: Math.min(MAX_SECTION_H, Math.max(MIN_SECTION_H, height)),
    }));
  }, []);

  return [heights, setHeight];
}

/**
 * Collapsible block for the SQL Editor left sidebar
 * (Schema pinned at top, then Destinations / Bookmarks / Variables / Secrets /
 * Utilities / Files). Open sections are height-resizable via the bottom grip.
 */
export const SqlSidebarSection: React.FC<{
  id: SidebarSectionId;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Extra controls on the header row (e.g. Bookmark Save). */
  actions?: React.ReactNode;
  /** When expanded and this is the flex-growing section. */
  grow?: boolean;
  height?: number;
  onResizeHeight?: (h: number) => void;
  /** Optional drag handle for reordering sections. */
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  children: React.ReactNode;
}> = ({
  id,
  title,
  icon,
  open,
  onToggle,
  actions,
  grow,
  height,
  onResizeHeight,
  draggable,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  children,
}) => {
  const startH = useRef(0);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      if (!onResizeHeight) return;
      e.preventDefault();
      startH.current = height ?? DEFAULT_HEIGHTS[id];
      const startY = e.clientY;
      const onMove = (ev: MouseEvent) => {
        onResizeHeight(startH.current + (ev.clientY - startY));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height, id, onResizeHeight]
  );

  return (
    <div
      data-testid={`sql-sidebar-${id}`}
      className={`border-b border-slate-800 flex flex-col min-h-0 bg-slate-950 ${
        open ? (grow && !height ? 'flex-1' : 'shrink-0') : 'shrink-0'
      } ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'ring-1 ring-inset ring-cyan-500/40' : ''}`}
      style={
        open && height
          ? { height: height + 44 /* header approx */, maxHeight: MAX_SECTION_H + 44 }
          : undefined
      }
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-1 px-2 py-2.5 shrink-0 bg-slate-950">
        {draggable && (
          <div
            draggable
            data-testid={`sql-sidebar-drag-${id}`}
            title="Drag to reorder section"
            aria-label={`Reorder ${title}`}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            className="shrink-0 p-0.5 cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 touch-none"
          >
            <GripVertical className="w-3.5 h-3.5" strokeWidth={SQL_ICON_STROKE} />
          </div>
        )}
        <button
          type="button"
          data-testid={`sql-sidebar-toggle-${id}`}
          aria-expanded={open}
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 min-w-0 text-left text-[13px] font-bold uppercase tracking-wide text-slate-300 hover:text-slate-100 transition pl-0.5"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 shrink-0 text-sky-500" strokeWidth={SQL_ICON_STROKE} />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0 text-sky-500" strokeWidth={SQL_ICON_STROKE} />
          )}
          <span className="shrink-0 flex items-center [&_svg]:w-4 [&_svg]:h-4 [&_svg]:stroke-[2.5]">{icon}</span>
          <span className="truncate">{title}</span>
        </button>
        {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
      </div>
      {open && (
        <div
          className="px-3 pb-1 flex flex-col min-h-0 flex-1 overflow-hidden bg-slate-900"
          style={height ? { height, minHeight: MIN_SECTION_H } : undefined}
        >
          {children}
        </div>
      )}
      {open && onResizeHeight && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${title}`}
          data-testid={`sql-sidebar-resize-${id}`}
          title="Drag to resize section"
          onMouseDown={startResize}
          className="h-1.5 shrink-0 cursor-row-resize bg-slate-800 hover:bg-cyan-500/40 active:bg-cyan-500/50 transition-colors"
        />
      )}
    </div>
  );
};
