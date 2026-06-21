import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiPutPreferences } from '../api/authApi';

export type FontSize = 'sm' | 'md' | 'lg' | 'xl';
export type AccentId = 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber';
export type ThemeMode = 'dark' | 'light' | 'system';
export type ToneId = 'slate' | 'gray' | 'zinc' | 'stone' | 'neutral';

export const ACCENTS: Record<AccentId, { label: string; from: string; to: string }> = {
  cyan: { label: 'Cyan', from: '#06b6d4', to: '#4f46e5' },
  violet: { label: 'Violet', from: '#8b5cf6', to: '#6366f1' },
  emerald: { label: 'Emerald', from: '#10b981', to: '#0d9488' },
  rose: { label: 'Rose', from: '#f43f5e', to: '#be123c' },
  amber: { label: 'Amber', from: '#f59e0b', to: '#d97706' },
};

export const TONES: { id: ToneId; label: string }[] = [
  { id: 'slate', label: 'Slate' },
  { id: 'gray', label: 'Gray' },
  { id: 'zinc', label: 'Zinc' },
  { id: 'stone', label: 'Stone' },
  { id: 'neutral', label: 'Neutral' },
];

export const FONT_SIZES: { id: FontSize; label: string }[] = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Medium' },
  { id: 'lg', label: 'Large' },
  { id: 'xl', label: 'Extra Large' },
];

const FONT_PX: Record<FontSize, string> = { sm: '14px', md: '16px', lg: '18px', xl: '20px' };

// Tailwind v4 exposes the full neutral palette + the app's slate scale as CSS
// variables, and `bg-slate-950` etc. compile to `var(--color-slate-950)`. So we
// re-theme the whole UI by remapping the slate scale to the chosen tone family,
// inverted for light mode (950↔50). Accents stay untouched.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
// Symmetric flip (used for the colored families in light mode).
const INVERT: Record<number, number> = {
  50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 100, 950: 50,
};
// Neutral light map — a *shifted* flip: backgrounds land on soft off-white
// (not glaring pure white) and text lands darker, for legibility.
const LIGHT_NEUTRAL: Record<number, number> = {
  950: 100, 900: 200, 800: 300, 700: 400, 600: 500, 500: 600, 400: 700, 300: 800, 200: 900, 100: 950, 50: 950,
};
// Colored families used in the UI — inverted in light mode so colored text and
// badges (cyan labels, amber/emerald/rose status pills) read dark-on-light.
const COLORED = ['cyan', 'emerald', 'rose', 'amber', 'indigo', 'purple', 'teal', 'yellow', 'sky', 'violet', 'pink', 'orange'];

function resolveMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system' && typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return mode === 'light' ? 'light' : 'dark';
}

function applyToDocument(themeMode: ThemeMode, tone: ToneId, fontSize: FontSize, accent: AccentId): 'dark' | 'light' {
  const root = document.documentElement;
  const mode = resolveMode(themeMode);
  const light = mode === 'light';

  // Neutral scale → chosen tone family (shifted-inverted for light). Default
  // (slate + dark) drops overrides to avoid a circular self-reference.
  const neutralDefault = tone === 'slate' && !light;
  for (const s of SHADES) {
    if (neutralDefault) {
      root.style.removeProperty(`--color-slate-${s}`);
    } else {
      root.style.setProperty(`--color-slate-${s}`, `var(--color-${tone}-${light ? LIGHT_NEUTRAL[s] : s})`);
    }
  }

  // Colored families: invert in light mode, default (no override) in dark.
  // Shade 500 maps to itself, so leave it unset to avoid a circular var().
  for (const fam of COLORED) {
    for (const s of SHADES) {
      if (light && INVERT[s] !== s) {
        root.style.setProperty(`--color-${fam}-${s}`, `var(--color-${fam}-${INVERT[s]})`);
      } else {
        root.style.removeProperty(`--color-${fam}-${s}`);
      }
    }
  }

  root.setAttribute('data-theme', mode);
  root.style.fontSize = FONT_PX[fontSize];
  root.style.setProperty('--accent', ACCENTS[accent].from);
  root.style.setProperty('--accent-strong', ACCENTS[accent].to);
  return mode;
}

interface UiState {
  themeMode: ThemeMode;
  tone: ToneId;
  fontSize: FontSize;
  accent: AccentId;
  /** Resolved (system → dark|light) — for Monaco theme selection. */
  resolvedMode: 'dark' | 'light';

  setThemeMode: (mode: ThemeMode) => void;
  setTone: (tone: ToneId) => void;
  setFontSize: (size: FontSize) => void;
  setAccent: (accent: AccentId) => void;
  resetAppearance: () => void;
  /** Apply current values to the document (call on load + on change). */
  apply: () => void;
  /** Replace from the server's stored preferences (theme JSON). */
  hydrateFromServer: (theme?: string) => void;
}

const DEFAULTS = {
  themeMode: 'dark' as ThemeMode,
  tone: 'slate' as ToneId,
  fontSize: 'md' as FontSize,
  accent: 'cyan' as AccentId,
};

function syncToServer(s: Pick<UiState, 'themeMode' | 'tone' | 'fontSize' | 'accent'>): void {
  void apiPutPreferences({
    theme: JSON.stringify({ themeMode: s.themeMode, tone: s.tone, fontSize: s.fontSize, accent: s.accent }),
  }).catch(() => undefined);
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => {
      const apply = () => {
        const { themeMode, tone, fontSize, accent } = get();
        set({ resolvedMode: applyToDocument(themeMode, tone, fontSize, accent) });
      };
      const update = (patch: Partial<UiState>) => {
        set(patch);
        apply();
        const { themeMode, tone, fontSize, accent } = get();
        syncToServer({ themeMode, tone, fontSize, accent });
      };
      return {
        ...DEFAULTS,
        resolvedMode: 'dark',

        setThemeMode: (themeMode) => update({ themeMode }),
        setTone: (tone) => update({ tone }),
        setFontSize: (fontSize) => update({ fontSize }),
        setAccent: (accent) => update({ accent }),
        resetAppearance: () => update({ ...DEFAULTS }),

        apply,

        hydrateFromServer: (theme) => {
          if (!theme) return;
          try {
            const p = JSON.parse(theme) as Partial<Pick<UiState, 'themeMode' | 'tone' | 'fontSize' | 'accent'>>;
            set({
              themeMode:
                p.themeMode === 'light' || p.themeMode === 'system' || p.themeMode === 'dark' ? p.themeMode : get().themeMode,
              tone: p.tone && TONES.some((t) => t.id === p.tone) ? p.tone : get().tone,
              fontSize: p.fontSize && FONT_PX[p.fontSize] ? p.fontSize : get().fontSize,
              accent: p.accent && ACCENTS[p.accent] ? p.accent : get().accent,
            });
            apply();
          } catch {
            /* theme not JSON (legacy) — ignore */
          }
        },
      };
    },
    { name: 'schema-sync-ui' }
  )
);

// Re-apply when the OS appearance changes, but only while following the system.
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useUiStore.getState().themeMode === 'system') useUiStore.getState().apply();
  });
}
