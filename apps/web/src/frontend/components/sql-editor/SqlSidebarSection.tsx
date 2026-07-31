import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SQL_ICON_STROKE } from './sqlIconStyle';

const STORAGE_KEY = 'foxschema-sql-sidebar-sections';
const HEIGHTS_KEY = 'foxschema-sql-sidebar-section-heights';

export type SidebarSectionId =
  | 'destinations'
  | 'bookmarks'
  | 'variables'
  | 'vault'
  | 'utilities'
  | 'schema';

const DEFAULT_OPEN: Record<SidebarSectionId, boolean> = {
  destinations: true,
  bookmarks: true,
  variables: true,
  vault: true,
  utilities: true,
  schema: true,
};

const DEFAULT_HEIGHTS: Record<SidebarSectionId, number> = {
  destinations: 140,
  bookmarks: 120,
  variables: 140,
  vault: 160,
  utilities: 140,
  schema: 220,
};

const MIN_SECTION_H = 72;
const MAX_SECTION_H = 480;

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
 * (Destinations / Bookmarks / Variables / Secrets / Utilities / Schema).
 * Open sections are height-resizable via the bottom grip.
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
  children: React.ReactNode;
}> = ({ id, title, icon, open, onToggle, actions, grow, height, onResizeHeight, children }) => {
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
      className={`border-b border-[#e2e8f0] flex flex-col min-h-0 bg-white ${
        open ? (grow && !height ? 'flex-1' : 'shrink-0') : 'shrink-0'
      }`}
      style={
        open && height
          ? { height: height + 44 /* header approx */, maxHeight: MAX_SECTION_H + 44 }
          : undefined
      }
    >
      <div className="flex items-center gap-1 px-3 py-2.5 shrink-0 bg-white">
        <button
          type="button"
          data-testid={`sql-sidebar-toggle-${id}`}
          aria-expanded={open}
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 min-w-0 text-left text-[13px] font-bold uppercase tracking-wide text-[#334155] hover:text-[#0f172a] transition"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 shrink-0 text-sky-600" strokeWidth={SQL_ICON_STROKE} />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0 text-sky-600" strokeWidth={SQL_ICON_STROKE} />
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
          className="h-1.5 shrink-0 cursor-row-resize bg-slate-200 hover:bg-cyan-500/40 active:bg-cyan-500/50 transition-colors"
        />
      )}
    </div>
  );
};
