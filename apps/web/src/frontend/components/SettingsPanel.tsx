import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sun, Moon, Monitor, Palette, Type, RotateCcw, ShieldCheck, Database, ArrowUpCircle } from 'lucide-react';
import { useUiStore, ACCENTS, TONES, FONT_SIZES, type ThemeMode, type AccentId } from '../store/uiStore';
import { fetchAppInfo, type AppInfo } from '../api/setupApi';
import { DatabaseSettings } from './DatabaseSettings';
import { UpdatesSettings } from './UpdatesSettings';

interface Props {
  open: boolean;
  onClose: () => void;
}

const MODES: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: 'light', label: 'Light', icon: <Sun className="w-4 h-4" /> },
  { id: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" /> },
  { id: 'system', label: 'System', icon: <Monitor className="w-4 h-4" /> },
];

// Representative mid-shade per neutral family, for the tone swatches.
const TONE_SWATCH: Record<string, string> = {
  slate: '#64748b', gray: '#6b7280', zinc: '#71717a', stone: '#78716c', neutral: '#737373',
};

const Section: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="space-y-2">
    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1.5">
      {icon} {title}
    </p>
    {children}
  </div>
);

/** Appearance settings: theme mode, UI tone, accent, and text size. Each change applies live. */
export const SettingsPanel: React.FC<Props> = ({ open, onClose }) => {
  const { themeMode, tone, fontSize, accent, setThemeMode, setTone, setFontSize, setAccent, resetAppearance } = useUiStore();
  // Hooks must stay above the early return (rules-of-hooks).
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchAppInfo()
      .then((i) => alive && setInfo(i))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);
  if (!open) return null;

  const optionBtn = (active: boolean) =>
    `transition cursor-pointer border ${
      active ? 'bg-slate-800 border-cyan-500/40 text-slate-100' : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
    }`;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-slate-100 font-bold text-base">Appearance</h2>
              <p className="text-xs text-slate-400 mt-0.5">Personalize the whole interface · changes apply instantly</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <Section icon={<Monitor className="w-3 h-3" />} title="Background">
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setThemeMode(m.id)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-lg text-xs font-semibold ${optionBtn(themeMode === m.id)}`}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
          </Section>

          <Section icon={<Palette className="w-3 h-3" />} title="UI Tone">
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTone(t.id)}
                  className={`flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-md text-xs font-semibold ${optionBtn(tone === t.id)}`}
                >
                  <span className="w-4 h-4 rounded-full border border-white/10" style={{ backgroundColor: TONE_SWATCH[t.id] }} />
                  {t.label}
                </button>
              ))}
            </div>
          </Section>

          <Section icon={<span className="w-2.5 h-2.5 rounded-full accent-grad inline-block" />} title="Accent">
            <div className="flex gap-2.5">
              {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setAccent(id)}
                  title={ACCENTS[id].label}
                  className={`w-8 h-8 rounded-full transition cursor-pointer ${
                    accent === id ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-white/70' : 'hover:scale-110'
                  }`}
                  style={{ backgroundImage: `linear-gradient(to top right, ${ACCENTS[id].from}, ${ACCENTS[id].to})` }}
                />
              ))}
            </div>
          </Section>

          <Section icon={<Type className="w-3 h-3" />} title="Text Size">
            <div className="grid grid-cols-4 gap-2">
              {FONT_SIZES.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => setFontSize(f.id)}
                  title={f.label}
                  className={`flex items-center justify-center py-2 rounded-md font-bold ${optionBtn(fontSize === f.id)}`}
                  style={{ fontSize: `${0.72 + i * 0.13}rem` }}
                >
                  Aa
                </button>
              ))}
            </div>
          </Section>

          {info && (
            <Section icon={<Database className="w-3 h-3" />} title="Database">
              <DatabaseSettings info={info} />
            </Section>
          )}

          <Section icon={<ArrowUpCircle className="w-3 h-3" />} title="Updates">
            <UpdatesSettings />
          </Section>

          {info && (
            <Section icon={<ShieldCheck className="w-3 h-3" />} title="Security">
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-slate-800 bg-slate-950/40 text-xs">
                <ShieldCheck
                  className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${info.security.emailBound ? 'text-emerald-400' : 'text-amber-400'}`}
                />
                <p className="text-slate-300">
                  {info.security.emailBound ? (
                    <>
                      Encryption key bound to{' '}
                      <span className="font-mono text-slate-200">{info.security.boundEmail}</span> and held in the OS
                      keychain — a copied database can't be decrypted elsewhere.
                    </>
                  ) : (
                    <>Encryption key stored on this install (legacy key scheme).</>
                  )}
                </p>
              </div>
            </Section>
          )}
        </div>

        <div className="flex justify-between items-center px-6 py-4 bg-slate-950/60 border-t border-slate-800">
          <button
            onClick={resetAppearance}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold accent-grad on-accent-fg rounded transition shadow"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
