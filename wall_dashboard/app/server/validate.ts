import type { DashboardDoc, WidgetType } from '../shared/types.js';
import { ENTITY_RE } from '../shared/types.js';
import { DEFAULT_THEME } from './seed.js';

const WIDGETS: WidgetType[] = ['clock', 'date', 'value', 'temperature', 'climate', 'button', 'text', 'image', 'iframe', 'camera', 'house3d', 'remote', 'media', 'calendar', 'waste', 'levels', 'timer', 'irrigation', 'purifier', 'device', 'schedules', 'alarm', 'robot', 'septic', 'intercom', 'calls', 'ups'];

/** Checks structure and fills safe defaults. Throws Error with a readable (Polish) message. */
export function validateDashboard(input: any, id: string): DashboardDoc {
  if (!input || typeof input !== 'object') throw new Error('Dashboard musi być obiektem JSON');
  if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('Brak pola "title"');
  if (!Array.isArray(input.views) || input.views.length === 0) throw new Error('"views" musi być niepustą tablicą');
  const theme = { ...DEFAULT_THEME, ...(input.theme || {}), background: { ...DEFAULT_THEME.background, ...(input.theme?.background || {}) } };
  const viewIds = new Set<string>();
  const views = input.views.map((v: any, vi: number) => {
    const where = `views[${vi}]`;
    if (!v || typeof v.id !== 'string' || !v.id) throw new Error(`${where}: brak "id"`);
    if (viewIds.has(v.id)) throw new Error(`${where}: powtórzone id "${v.id}"`);
    viewIds.add(v.id);
    if (!Array.isArray(v.widgets)) throw new Error(`${where}: "widgets" musi być tablicą`);
    const columns = num(v.columns, 24, 1, 48), rowHeight = num(v.rowHeight, 56, 16, 400), gap = num(v.gap, 12, 0, 64);
    const wIds = new Set<string>();
    const widgets = v.widgets.map((w: any, wi: number) => {
      const at = `${where}.widgets[${wi}]`;
      if (!w || typeof w.id !== 'string' || !w.id) throw new Error(`${at}: brak "id"`);
      if (wIds.has(w.id)) throw new Error(`${at}: powtórzone id "${w.id}"`);
      wIds.add(w.id);
      if (!WIDGETS.includes(w.type)) throw new Error(`${at}: nieznany typ "${w.type}" (dozwolone: ${WIDGETS.join(', ')})`);
      for (const k of ['entity', 'secondary']) if (w[k] != null && w[k] !== '' && !ENTITY_RE.test(w[k])) throw new Error(`${at}: "${k}" ma niepoprawny format encji (${w[k]})`);
      const x = num(w.x, 0, 0, columns - 1), wdt = num(w.w, 4, 1, columns);
      return { ...w, x, y: num(w.y, 0, 0, 500), w: Math.min(wdt, columns - x), h: num(w.h, 2, 1, 100) };
    });
    return { id: v.id, title: String(v.title ?? v.id), icon: v.icon, ...(v.panelOnly ? { panelOnly: true } : {}), columns, rowHeight, gap, widgets };
  });
  return { id, title: input.title.trim(), showTabs: input.showTabs !== false, ...(['pills', 'bottom', 'rail', 'tiles', 'tilesTop'].includes(input.tabStyle) ? { tabStyle: input.tabStyle } : {}), ...(['left', 'right'].includes(input.tabAlign) ? { tabAlign: input.tabAlign } : {}), ...(input.tabFloat === true ? { tabFloat: true } : {}), theme, views };
}

function num(v: any, def: number, min: number, max: number) {
  const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : def;
  return Math.max(min, Math.min(max, n));
}
