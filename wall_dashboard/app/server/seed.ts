import type { DashboardDoc, ThemeDef } from '../shared/types.js';

export const DEFAULT_THEME: ThemeDef = {
  background: { type: 'glass', color: '#0B0D12', image: '', blur: 0, dim: 35 },
  accent: '#FFC870',
  textColor: '#F5F3EF',
  tileOpacity: 0.58,
  radius: 20
};

export function emptyDashboard(id: string, title: string): DashboardDoc {
  return {
    id, title, showTabs: true, theme: structuredClone(DEFAULT_THEME),
    views: [{ id: 'main', title: 'Główny', columns: 24, rowHeight: 56, gap: 12, widgets: [
      { id: 'w1', type: 'clock', x: 0, y: 0, w: 8, h: 3, options: { date: 'below' } }
    ] }]
  };
}

/** First start: a small starter dashboard without any entities – the user adds widgets in the editor. */
export function seedDashboard(): DashboardDoc {
  return {
    id: 'start', title: 'Mój dashboard', showTabs: true, theme: structuredClone(DEFAULT_THEME),
    views: [{ id: 'main', title: 'Główny', columns: 24, rowHeight: 56, gap: 12, widgets: [
      { id: 'clock', type: 'clock', x: 0, y: 0, w: 10, h: 4, options: { date: 'below' } },
      { id: 'hello', type: 'text', x: 10, y: 0, w: 14, h: 4, title: 'Witaj',
        options: { text: 'To jest przykładowy dashboard. Otwórz Wall Dashboard w Home Assistant → Dashboardy → Edytuj i dodaj własne widgety.' } }
    ] }]
  };
}
