import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiPutPreferences } from '../api/authApi';

export type FontSize = 'sm' | 'md' | 'lg' | 'xl';
export type AccentId = 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber' | 'teal' | 'sky' | 'fuchsia';
export type ThemeMode = 'dark' | 'light' | 'system';
export type ToneId = 'slate' | 'gray' | 'zinc' | 'stone' | 'neutral';

export const ACCENTS: Record<AccentId, { label: string; from: string; to: string }> = {
  cyan: { label: 'Cyan', from: '#06b6d4', to: '#4f46e5' },
  violet: { label: 'Violet', from: '#8b5cf6', to: '#6366f1' },
  emerald: { label: 'Emerald', from: '#10b981', to: '#0d9488' },
  rose: { label: 'Rose', from: '#f43f5e', to: '#be123c' },
  amber: { label: 'Amber', from: '#f59e0b', to: '#d97706' },
  teal: { label: 'Teal', from: '#14b8a6', to: '#0d9488' },
  sky: { label: 'Sky', from: '#0ea5e9', to: '#2563eb' },
  fuchsia: { label: 'Fuchsia', from: '#d946ef', to: '#9333ea' },
};

/**
 * Curated one-click looks: a complete combination of mode + tone + accent.
 * Individual controls below still fine-tune after a preset is applied.
 */
export interface ThemePreset {
  id: string;
  label: string;
  mode: ThemeMode;
  tone: ToneId;
  accent: AccentId;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'midnight', label: 'Midnight', mode: 'dark', tone: 'slate', accent: 'cyan' },
  { id: 'nebula', label: 'Nebula', mode: 'dark', tone: 'zinc', accent: 'violet' },
  { id: 'forest', label: 'Forest', mode: 'dark', tone: 'stone', accent: 'emerald' },
  { id: 'ember', label: 'Ember', mode: 'dark', tone: 'neutral', accent: 'amber' },
  { id: 'crimson', label: 'Crimson', mode: 'dark', tone: 'gray', accent: 'rose' },
  { id: 'abyss', label: 'Abyss', mode: 'dark', tone: 'slate', accent: 'sky' },
  { id: 'daylight', label: 'Daylight', mode: 'light', tone: 'slate', accent: 'cyan' },
  { id: 'parchment', label: 'Parchment', mode: 'light', tone: 'stone', accent: 'amber' },
];

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
// Light-mode shade remap (used for BOTH neutrals and colored families). Backgrounds land light (text darker for
// legibility). The dominant base shade (950) is additionally softened to a
// gentle canvas between 100 and 200 below — lighter than a flat gray, but not
// the bare white that read as "uncoloured".
const LIGHT_NEUTRAL: Record<number, number> = {
  950: 100, 900: 200, 800: 300, 700: 400, 600: 500, 500: 600, 400: 700, 300: 800, 200: 900, 100: 950, 50: 950,
};
// Colored families used in the UI (cyan labels, amber/emerald/rose status
// pills + add/remove/modified tints). Remapped in light mode with the shifted
// scale above so dark fills (bg-*-950/900) become *visible* light tints
// (100/200) rather than near-white, and colored text lands dark enough to read.
const COLORED = ['cyan', 'emerald', 'rose', 'amber', 'indigo', 'purple', 'teal', 'yellow', 'sky', 'violet', 'pink', 'orange'];
// Neutral "tone" families.
const TONE_FAMILIES: ToneId[] = ['slate', 'gray', 'zinc', 'stone', 'neutral'];

// The real palette, captured once as *literal* color values. Light-mode
// overrides must reference these literals rather than other `--color-*` vars,
// because a remap like 400→700 alongside 700→400 forms a circular var() chain
// that CSS marks invalid-at-computed-value-time — which blanks the color out
// (the bug: amber/rose/emerald status tints rendered as inherited gray).
let ORIGINALS: Record<string, string> | null = null;
function captureOriginals(root: HTMLElement): void {
  if (ORIGINALS) return;
  const fams = [...TONE_FAMILIES, ...COLORED];
  // Read from a clean slate so any prior inline overrides can't skew the capture.
  for (const fam of fams) for (const s of SHADES) root.style.removeProperty(`--color-${fam}-${s}`);
  const cs = getComputedStyle(root);
  const map: Record<string, string> = {};
  for (const fam of fams) {
    for (const s of SHADES) {
      const v = cs.getPropertyValue(`--color-${fam}-${s}`).trim();
      if (v) map[`${fam}-${s}`] = v;
    }
  }
  // Only cache once the stylesheet is loaded (non-empty); avoids locking in
  // blanks if applied before CSS is ready.
  if (map['slate-500'] || map['gray-500']) ORIGINALS = map;
}

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

  captureOriginals(root);
  // Literal value of a palette entry — never a `--color-*` var (which may itself
  // be overridden → circular). Falls back to a var() only if capture isn't ready.
  const lit = (fam: string, shade: number) => ORIGINALS?.[`${fam}-${shade}`] ?? `var(--color-${fam}-${shade})`;

  // Neutral scale → chosen tone family (shifted for light). Default (slate +
  // dark) drops overrides to use Tailwind's own slate.
  const neutralDefault = tone === 'slate' && !light;
  for (const s of SHADES) {
    if (neutralDefault) {
      root.style.removeProperty(`--color-slate-${s}`);
    } else {
      root.style.setProperty(`--color-slate-${s}`, lit(tone, light ? LIGHT_NEUTRAL[s] : s));
    }
  }
  // Soften the base canvas (the largest surface) to a gentle tint between shades
  // 100 and 200: lighter than a flat gray, but enough that big areas don't read
  // as a bare-white, "uncoloured" page next to the panels.
  if (light) {
    root.style.setProperty('--color-slate-950', `color-mix(in oklab, ${lit(tone, 100)} 60%, ${lit(tone, 200)})`);
  }

  // Colored families: in light mode remap with the same shifted scale as the
  // neutrals, so status fills (bg-emerald-950/rose-950/amber-950 …) become
  // visible light tints and colored numbers/text land dark enough to read.
  // Default (no override) in dark.
  for (const fam of COLORED) {
    for (const s of SHADES) {
      if (light) {
        root.style.setProperty(`--color-${fam}-${s}`, lit(fam, LIGHT_NEUTRAL[s]));
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
  /** Apply a curated preset (mode + tone + accent) in one step. */
  applyPreset: (id: string) => void;
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
        applyPreset: (id) => {
          const p = THEME_PRESETS.find((x) => x.id === id);
          if (p) update({ themeMode: p.mode, tone: p.tone, accent: p.accent });
        },
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
