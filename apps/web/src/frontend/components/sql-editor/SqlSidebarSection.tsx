import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const STORAGE_KEY = 'foxschema-sql-sidebar-sections';

export type SidebarSectionId = 'destinations' | 'bookmarks' | 'schema';

const DEFAULT_OPEN: Record<SidebarSectionId, boolean> = {
  destinations: true,
  bookmarks: true,
  schema: true,
};

function loadOpen(): Record<SidebarSectionId, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPEN };
    const parsed = JSON.parse(raw) as Partial<Record<SidebarSectionId, boolean>>;
    return {
      destinations: parsed.destinations ?? true,
      bookmarks: parsed.bookmarks ?? true,
      schema: parsed.schema ?? true,
    };
  } catch {
    return { ...DEFAULT_OPEN };
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

/**
 * Collapsible block for the SQL Editor left sidebar (Destinations / Bookmarks / Schema).
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
  children: React.ReactNode;
}> = ({ id, title, icon, open, onToggle, actions, grow, children }) => {
  return (
    <div
      data-testid={`sql-sidebar-${id}`}
      className={`border-b border-slate-800/80 flex flex-col min-h-0 ${
        open ? (grow ? 'flex-1' : 'shrink-0 max-h-[42%]') : 'shrink-0'
      }`}
    >
      <div className="flex items-center gap-1 px-3 py-2 shrink-0">
        <button
          type="button"
          data-testid={`sql-sidebar-toggle-${id}`}
          aria-expanded={open}
          onClick={onToggle}
          className="flex-1 flex items-center gap-1.5 min-w-0 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-200 transition"
        >
          {open ? (
            <ChevronDown className="w-3 h-3 shrink-0 text-slate-500" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0 text-slate-500" />
          )}
          <span className="shrink-0 text-slate-500">{icon}</span>
          <span className="truncate">{title}</span>
        </button>
        {actions && <div className="shrink-0 flex items-center gap-1">{actions}</div>}
      </div>
      {open && (
        <div className="px-3 pb-3 flex flex-col min-h-0 flex-1 overflow-hidden">{children}</div>
      )}
    </div>
  );
};
