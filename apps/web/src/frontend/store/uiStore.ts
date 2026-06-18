import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiPutPreferences } from '../api/authApi';

export type FontSize = 'sm' | 'md' | 'lg';
export type AccentId = 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber';

export const ACCENTS: Record<AccentId, { label: string; from: string; to: string }> = {
  cyan: { label: 'Cyan', from: '#06b6d4', to: '#4f46e5' },
  violet: { label: 'Violet', from: '#8b5cf6', to: '#6366f1' },
  emerald: { label: 'Emerald', from: '#10b981', to: '#0d9488' },
  rose: { label: 'Rose', from: '#f43f5e', to: '#be123c' },
  amber: { label: 'Amber', from: '#f59e0b', to: '#d97706' },
};

const FONT_PX: Record<FontSize, string> = { sm: '14px', md: '16px', lg: '18px' };

interface UiState {
  fontSize: FontSize;
  accent: AccentId;
  setFontSize: (size: FontSize) => void;
  setAccent: (accent: AccentId) => void;
  /** Apply current values to the document (call on load + on change). */
  apply: () => void;
  /** Replace from the server's stored preferences (theme JSON). */
  hydrateFromServer: (theme?: string) => void;
}

function applyToDocument(fontSize: FontSize, accent: AccentId): void {
  const root = document.documentElement;
  root.style.fontSize = FONT_PX[fontSize];
  root.style.setProperty('--accent', ACCENTS[accent].from);
  root.style.setProperty('--accent-strong', ACCENTS[accent].to);
}

/** Persist appearance to the server too (best-effort), as theme JSON. */
function syncToServer(fontSize: FontSize, accent: AccentId): void {
  void apiPutPreferences({ theme: JSON.stringify({ fontSize, accent }) }).catch(() => undefined);
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      fontSize: 'md',
      accent: 'cyan',

      setFontSize: (fontSize) => {
        set({ fontSize });
        applyToDocument(fontSize, get().accent);
        syncToServer(fontSize, get().accent);
      },

      setAccent: (accent) => {
        set({ accent });
        applyToDocument(get().fontSize, accent);
        syncToServer(get().fontSize, accent);
      },

      apply: () => applyToDocument(get().fontSize, get().accent),

      hydrateFromServer: (theme) => {
        if (!theme) return;
        try {
          const parsed = JSON.parse(theme) as Partial<Pick<UiState, 'fontSize' | 'accent'>>;
          const fontSize = parsed.fontSize && FONT_PX[parsed.fontSize] ? parsed.fontSize : get().fontSize;
          const accent = parsed.accent && ACCENTS[parsed.accent] ? parsed.accent : get().accent;
          set({ fontSize, accent });
          applyToDocument(fontSize, accent);
        } catch {
          /* theme not JSON (legacy) — ignore */
        }
      },
    }),
    { name: 'schema-sync-ui' }
  )
);
