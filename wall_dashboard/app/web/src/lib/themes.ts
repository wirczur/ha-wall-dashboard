// Own themes (Motywy): a colour set turned into the CSS variables the built-in skins use,
// plus optional extra CSS nested under [data-theme="<id>"].
import { useSyncExternalStore } from 'react';
import type { CustomTheme } from '../../../shared/types';

let themes: CustomTheme[] = [];
const listeners = new Set<() => void>();
export function setThemes(list: CustomTheme[] | undefined) {
  themes = Array.isArray(list) ? list : [];
  syncCss();
  for (const l of listeners) l();
}
export const getTheme = (id?: string) => (id ? themes.find((t) => t.id === id) : undefined);
export const useThemes = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => themes);

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbStr = (hex: string) => rgb(hex).join(', ');
const mix = (a: string, b: string, t: number) => {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const lum = (hex: string) => { const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const readable = (bg: string) => (lum(bg) > 0.45 ? '#1A1206' : '#FFFFFF');

/** CSS variables of a theme (the same names the built-in skins set) */
export function themeCssVars(t: CustomTheme): Record<string, string> {
  const c = t.colors;
  const muted = c.muted ?? `rgba(${rgbStr(c.fg)}, .65)`;
  const flat = t.base === 'flat';
  return {
    '--bg': c.bg, '--fg': c.fg, '--muted': muted, '--line': `rgba(${rgbStr(c.fg)}, ${flat ? '.09' : '.14'})`,
    '--accent': c.accent, '--on-accent': readable(c.accent),
    '--ok': c.ok ?? (t.dark ? '#7FD8A0' : '#4F7A4A'), '--err': c.err ?? (t.dark ? '#FF8A80' : '#B4473B'), '--cool': t.dark ? '#8FB4FF' : '#4D6E8C',
    '--ink': rgbStr(c.fg), '--shade': t.dark ? '0, 0, 0' : rgbStr(c.fg),
    '--tile-rgb': rgbStr(c.tile), '--tile-op': String(flat ? 1 : t.tileOpacity ?? 0.55),
    '--sel': c.on, '--sel-ink': c.onText, '--well': mix(c.tile, c.bg, 0.5),
    '--on-bg': c.on, '--on-ink': c.onText, '--on-sub': `rgba(${rgbStr(c.onText)}, .72)`, '--on-icon': c.onIcon ?? c.accent,
    '--surface': c.tile, '--surface-2': mix(c.tile, c.fg, 0.05), '--surface-3': mix(c.tile, c.fg, 0.12),
    '--power': c.err ?? '#B4473B', '--power-bg': mix(c.tile, c.err ?? '#B4473B', 0.15),
    ...(t.radius != null ? { '--radius': t.radius + 'px' } : {}),
    ...(t.font ? { '--font': t.font } : {}),
    'color-scheme': t.dark ? 'dark' : 'light'
  };
}

/** extra CSS of every theme, nested under its [data-theme] (native CSS nesting) */
function syncCss() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('wd-themes') as HTMLStyleElement | null;
  const css = themes.filter((t) => t.css).map((t) => `[data-theme="${t.id}"] {\n${t.css}\n}`).join('\n');
  if (!css) { el?.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'wd-themes'; document.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

/** Ready colour sets to start a theme from */
export const THEME_PRESETS: CustomTheme[] = [
  { id: 'p-glass', name: 'Szkło (ciemny)', base: 'glass', dark: true, tileOpacity: 0.55, colors: { bg: '#0B0D12', fg: '#F5F3EF', accent: '#FFC870', tile: '#16191F', on: '#FFF0D7', onText: '#1A1206' } },
  { id: 'p-mech', name: 'Mech i mosiądz (jasny)', base: 'flat', dark: false, colors: { bg: '#D5D7C9', fg: '#262A22', muted: '#6E7366', accent: '#A8822E', tile: '#EEEFE7', on: '#3D4834', onText: '#F3F1E6', onIcon: '#D9B45C' } },
  { id: 'p-graphite', name: 'Grafit (ciemny, płaski)', base: 'flat', dark: true, colors: { bg: '#111317', fg: '#ECEDEF', accent: '#4FB3FF', tile: '#1C1F25', on: '#4FB3FF', onText: '#06121C', onIcon: '#06121C' } },
  { id: 'p-paper', name: 'Papier (jasny, minimalny)', base: 'flat', dark: false, colors: { bg: '#F4F2EE', fg: '#1F1F1F', accent: '#E0663A', tile: '#FFFFFF', on: '#1F1F1F', onText: '#FFFFFF', onIcon: '#E0663A' } },
  { id: 'p-ocean', name: 'Ocean (szkło, niebieski)', base: 'glass', dark: true, tileOpacity: 0.45, colors: { bg: '#06182A', fg: '#EAF4FF', accent: '#5CE1E6', tile: '#0E2A45', on: '#5CE1E6', onText: '#03222A' } }
];
