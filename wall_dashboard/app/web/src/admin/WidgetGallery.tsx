// "Add widget" gallery: every widget type (plus ready-made variants) rendered as a live preview with entities from your Home Assistant.
import { useEffect, useMemo, useState, type FC } from 'react';
import type { DashboardDoc, HassState, WidgetDef, WidgetType } from '../../../shared/types';
import { hass } from '../lib/hass';
import { Icon } from '../ui/Icon';
import { themeVars, tileStyle } from '../view/DashboardView';
import { WIDGETS } from '../widgets/widgets';
import { discoverIq4 } from '../widgets/irrigation';
import { upsGuess } from '../widgets/ups';

export interface GalleryPick { type: WidgetType; patch: Partial<WidgetDef> }

interface Preset {
  key: string; type: WidgetType; label: string; desc: string; cat: string;
  /** what to insert; entity placeholders are replaced with a sample from HA */
  patch(s: Samples): Partial<WidgetDef>;
  /** static mock instead of a live render (heavy or needs config) */
  mock?: string;
}

type Samples = Record<'timer' | 'fan' | 'calendar' | 'remote' | 'temp' | 'sensor' | 'light' | 'switch' | 'climate' | 'camera' | 'cover' | 'media', string | undefined>;

const septicGuess = () => [...hass.states.values()].find((s) => /szamb|septic|zbiornik|tank/i.test(s.entity_id + ' ' + (s.attributes.friendly_name ?? '')) && s.attributes.unit_of_measurement === '%')?.entity_id;
const PRESETS: Preset[] = [
  { key: 'clock', type: 'clock', cat: 'Podstawowe', label: 'Zegar z datą', desc: 'Godzina i data w jednym', patch: () => ({}) },
  { key: 'clock-only', type: 'clock', cat: 'Podstawowe', label: 'Sam zegar', desc: 'Tylko godzina', patch: () => ({ h: 2, options: {} }) },
  { key: 'date', type: 'date', cat: 'Podstawowe', label: 'Data', desc: 'Dzień tygodnia i data', patch: () => ({}) },
  { key: 'text', type: 'text', cat: 'Podstawowe', label: 'Tekst', desc: 'Stały lub dynamiczny – {encja}', patch: () => ({ options: { text: 'Dzień dobry 👋' } }) },
  { key: 'page-title', type: 'text', cat: 'Podstawowe', label: 'Nagłówek strony (środek)', desc: 'Wyśrodkowany tytuł, np. na mały panel', patch: () => ({ w: 4, h: 1, options: { text: 'PIĘTRO' }, style: { border: false, background: 'transparent', align: 'center', valign: 'center', fontScale: 1.4 } }) },
  { key: 'title', type: 'text', cat: 'Podstawowe', label: 'Nagłówek sekcji', desc: 'Tekst bez tła kafelka', patch: () => ({ w: 12, h: 1, options: { text: 'SALON' }, style: { border: false, background: 'transparent' } }) },
  { key: 'temp', type: 'temperature', cat: 'Czujniki', label: 'Temperatura', desc: 'Wartość z ikoną', patch: (s) => ({ entity: s.temp ?? 'sensor.temperatura' }) },
  { key: 'value', type: 'value', cat: 'Czujniki', label: 'Wartość encji', desc: 'Dowolny sensor / stan', patch: (s) => ({ entity: s.sensor ?? 'sensor.przyklad' }) },
  { key: 'light', type: 'button', cat: 'Sterowanie', label: 'Światło', desc: 'Kafelek – dotknij, aby włączyć', patch: (s) => ({ entity: s.light, title: undefined, icon: 'bulb' }) },
  { key: 'switch', type: 'button', cat: 'Sterowanie', label: 'Gniazdko / przełącznik', desc: 'Przełącznik on/off', patch: (s) => ({ entity: s.switch ?? s.light, title: undefined, icon: 'plug' }) },
  { key: 'cover', type: 'button', cat: 'Sterowanie', label: 'Roleta / brama', desc: 'Otwórz / zamknij', patch: (s) => ({ entity: s.cover, title: undefined, icon: s.cover?.includes('gate') || s.cover?.includes('brama') ? 'gate' : 'blinds' }) },
  { key: 'scene', type: 'button', cat: 'Sterowanie', label: 'Ustaw wartości', desc: 'Np. preset rekuperacji (kilka encji naraz)', patch: () => ({ title: 'Wietrzenie', icon: 'fan', tap: { type: 'set', steps: [] } }) },
  { key: 'timer', type: 'timer', cat: 'Sterowanie', label: 'Timer (Simple Timer)', desc: 'Odliczanie, +czas, stop, dzienny czas pracy', patch: (s) => ({ entity: s.timer }) },
  { key: 'irrigation', type: 'irrigation', cat: 'Sterowanie', label: 'Nawadnianie Rain Bird IQ4', desc: 'Strefy, programy, opóźnienie deszczowe', patch: () => ({ options: { duration: 10, ...discoverIq4(hass.states.values()) } }) },
  { key: 'purifier', type: 'purifier', cat: 'Klimat', label: 'Oczyszczacz (Dyson)', desc: 'Jakość powietrza, prędkość, auto, noc', patch: (s) => ({ options: { fan: s.fan?.startsWith('fan.') ? s.fan : undefined } }) },
  { key: 'alarm', type: 'alarm', cat: 'Sterowanie', label: 'Alarm (Satel)', desc: 'Klawiatura, uzbrajanie, strefy', patch: () => ({ entity: [...hass.states.keys()].find((e) => e.startsWith('alarm_control_panel.')) }) },
  { key: 'violations-btn', type: 'alarm', cat: 'Czujniki', label: 'Naruszenia – przycisk z licznikiem', desc: 'Liczba otwartych; dotknij = lista', patch: () => ({ w: 2, h: 2, title: 'Naruszenia', entity: undefined, options: { panel: false, layout: 'button', zones: [...hass.states.values()].filter((s) => s.entity_id.startsWith('binary_sensor.') && ['door', 'window', 'garage_door', 'opening', 'motion'].includes(s.attributes.device_class)).map((s) => s.entity_id).slice(0, 40) } }) },
  { key: 'violations', type: 'alarm', cat: 'Czujniki', label: 'Naruszenia (Satel)', desc: 'Otwarte drzwi, okna, ruch – bez panelu alarmu', patch: () => ({ w: 5, h: 4, title: 'Naruszenia', entity: undefined, options: { panel: false, zones: [...hass.states.values()].filter((s) => s.entity_id.startsWith('binary_sensor.') && ['door', 'window', 'garage_door', 'opening', 'motion'].includes(s.attributes.device_class)).map((s) => s.entity_id).slice(0, 40) } }) },
  { key: 'schedules', type: 'schedules', cat: 'Sterowanie', label: 'Harmonogramy', desc: 'Scheduler: lista, włącz, dodaj', patch: () => ({}) },
  { key: 'mower', type: 'robot', cat: 'Sterowanie', label: 'Kosiarka (Navimow)', desc: 'Status, bateria, koś / pauza / do bazy', patch: () => ({ entity: [...hass.states.keys()].find((e) => e.startsWith('lawn_mower.')), icon: 'mdi:robot-mower' }) },
  { key: 'vacuum', type: 'robot', cat: 'Sterowanie', label: 'Odkurzacz (Dyson 360)', desc: 'Status, bateria, moc ssania, do bazy', patch: () => ({ entity: [...hass.states.keys()].find((e) => e.startsWith('vacuum.')), icon: 'mdi:robot-vacuum' }) },
  { key: 'device-sq', type: 'device', cat: 'Sterowanie', label: 'AGD – kafelek 1:1', desc: 'Czas do końca w okręgu, dotknij = wszystkie ustawienia', patch: () => ({ w: 3, h: 3, options: { layout: 'square' } }), mock: 'mdi:washing-machine' },
  { key: 'septic-tank', type: 'septic', cat: 'Czujniki', label: 'Szambo – zbiornik', desc: 'Poziom, m³, pełne za…, ostatni wywóz, zamów', patch: () => ({ w: 3, h: 5, entity: septicGuess(), options: { layout: 'tank', warn: 75, alarm: 90 } }) },
  { key: 'septic-ring', type: 'septic', cat: 'Czujniki', label: 'Szambo – kafelek 1:1', desc: 'Okrąg z % i dniami, dotknij = szczegóły', patch: () => ({ w: 2, h: 2, entity: septicGuess(), options: { layout: 'ring', warn: 75, alarm: 90 } }) },
  { key: 'septic-bar', type: 'septic', cat: 'Czujniki', label: 'Szambo – pasek z historią', desc: 'Progi, wykres tygodni, tempo, wywozy', patch: () => ({ w: 6, h: 2, entity: septicGuess(), options: { layout: 'bar', warn: 75, alarm: 90 } }) },
  { key: 'ups', type: 'ups', cat: 'Czujniki', label: 'UPS', desc: 'Bateria, sieć / bateria, czas pracy, obciążenie', patch: () => ({ w: 5, h: 4, options: upsGuess([...hass.states.values()].filter((s) => /ups|nut|apc/i.test(s.entity_id)).map((s) => ({ entity_id: s.entity_id }))) }) },
  { key: 'ups-small', type: 'ups', cat: 'Czujniki', label: 'UPS – mały', desc: 'Bateria i stan', patch: () => ({ w: 3, h: 3, options: upsGuess([...hass.states.values()].filter((s) => /ups|nut|apc/i.test(s.entity_id)).map((s) => ({ entity_id: s.entity_id }))) }) },
  { key: 'calls', type: 'calls', cat: 'Czujniki', label: 'Nieodebrane (dzwonek)', desc: 'Kto dzwonił, kiedy, zdjęcie z kamery', patch: () => ({ w: 4, h: 5 }) },
  { key: 'calls-small', type: 'calls', cat: 'Czujniki', label: 'Nieodebrane – kafelek', desc: 'Licznik + ostatnie połączenie', patch: () => ({ w: 3, h: 2, title: 'Dzwonek' }) },
  { key: 'quiet', type: 'button', cat: 'Sterowanie', label: 'Cisza (ten panel)', desc: 'Wycisza dźwięki, dzwonki i mowę na tym panelu', patch: () => ({ w: 3, h: 2, entity: undefined, title: 'Cisza', icon: 'mdi:bell-sleep-outline', tap: { type: 'quiet', mode: 'toggle' } }) },
  { key: 'intercom', type: 'intercom', cat: 'Sterowanie', label: 'Interkom', desc: 'Rozmowa głosowa z panelem na innym piętrze', patch: () => ({ w: 3, h: 2 }) },
  { key: 'device', type: 'device', cat: 'Sterowanie', label: 'Urządzenie / AGD', desc: 'Wszystkie encje urządzenia (np. pralka Samsung)', patch: () => ({}), mock: 'washer' },
  { key: 'levels', type: 'levels', cat: 'Sterowanie', label: 'Poziomy 1–4', desc: 'Np. wentylacja / rekuperacja (mdi:fan-speed-1…4)', patch: (s) => ({ entity: s.fan ?? 'fan.rekuperator', options: { off: true } }) },
  { key: 'th-auto', type: 'climate', cat: 'Klimat', label: 'Termostat', desc: 'Pełny: tryby, harmonogram', patch: (s) => ({ entity: s.climate ?? 'climate.salon', options: { kind: 'thermostat', layout: 'auto' } }) },
  { key: 'th-small', type: 'climate', cat: 'Klimat', label: 'Termostat – mały', desc: 'Temperatura i +/−', patch: (s) => ({ w: 4, h: 3, entity: s.climate ?? 'climate.salon', options: { kind: 'thermostat', layout: 'small' } }) },
  { key: 'th-bar', type: 'climate', cat: 'Klimat', label: 'Termostat – pasek', desc: 'Jedna linia, do list', patch: (s) => ({ w: 8, h: 2, entity: s.climate ?? 'climate.salon', options: { kind: 'thermostat', layout: 'bar' } }) },
  { key: 'ac', type: 'climate', cat: 'Klimat', label: 'Klimatyzacja', desc: 'Tryby, wentylator, nawiew', patch: (s) => ({ entity: s.climate ?? 'climate.salon', options: { kind: 'ac', layout: 'auto' } }) },
  { key: 'waste', type: 'waste', cat: 'Czujniki', label: 'Wywóz śmieci', desc: 'Kiedy + co, kolory pojemników', patch: (s) => ({ options: { alertDays: 1, ...(s.calendar ? { calendar: s.calendar } : {}) } }) },
  { key: 'waste-list', type: 'waste', cat: 'Czujniki', label: 'Wywóz – najbliższe', desc: 'Kilka kolejnych odbiorów z kalendarza', patch: (s) => ({ w: 5, h: 5, options: { calendar: s.calendar ?? '', count: 4, alertDays: 1 } }) },
  { key: 'cal-agenda', type: 'calendar', cat: 'Podstawowe', label: 'Kalendarz – lista', desc: 'Najbliższe dni z kalendarzy HA', patch: (s) => ({ w: 5, h: 6, options: { layout: 'agenda', days: 7, calendars: s.calendar ? [{ entity: s.calendar }] : [] } }) },
  { key: 'cal-week', type: 'calendar', cat: 'Podstawowe', label: 'Kalendarz – tydzień', desc: '7 kolumn, wydarzenia w dniach', patch: (s) => ({ w: 12, h: 5, options: { layout: 'week', calendars: s.calendar ? [{ entity: s.calendar }] : [] } }) },
  { key: 'cal-month', type: 'calendar', cat: 'Podstawowe', label: 'Kalendarz – miesiąc', desc: 'Siatka miesiąca + wybrany dzień', patch: (s) => ({ w: 12, h: 8, options: { layout: 'month', calendars: s.calendar ? [{ entity: s.calendar }] : [] } }) },
  { key: 'media', type: 'media', cat: 'Media', label: 'Odtwarzacz', desc: 'Okładka, postęp, głośność, źródło, multiroom', patch: (s) => ({ entity: s.media ?? 'media_player.przyklad', options: { layout: 'large' } }) },
  { key: 'media-small', type: 'media', cat: 'Media', label: 'Odtwarzacz – mały', desc: 'Okładka i sterowanie', patch: (s) => ({ w: 4, h: 4, entity: s.media ?? 'media_player.przyklad', options: { layout: 'small' } }) },
  { key: 'media-bar', type: 'media', cat: 'Media', label: 'Odtwarzacz – pasek', desc: 'Jedna linia', patch: (s) => ({ w: 8, h: 2, entity: s.media ?? 'media_player.przyklad', options: { layout: 'bar' } }) },
  { key: 'camera', type: 'camera', cat: 'Media', label: 'Kamera', desc: 'Podgląd / WebRTC (go2rtc)', patch: (s) => ({ entity: s.camera ?? 'camera.przyklad' }), mock: 'camera' },
  { key: 'remote', type: 'remote', cat: 'Media', label: 'Pilot TV', desc: 'Samsung – bezpośrednio lub przez HA', patch: (s) => ({ options: { tv: s.remote ?? '', showApps: true } }), mock: 'tv' },
  { key: 'image', type: 'image', cat: 'Media', label: 'Obrazek', desc: 'Zdjęcie / logo z URL', patch: () => ({}), mock: 'sun' },
  { key: 'iframe', type: 'iframe', cat: 'Media', label: 'Strona (iframe)', desc: 'Np. pogoda, Grafana', patch: () => ({}), mock: 'chart' },
  { key: 'house', type: 'house3d', cat: 'Dom', label: 'Dom 3D', desc: 'Model domu z pokojami i światłami', patch: () => ({}), mock: 'home' }
];

function samples(): Samples {
  const all = [...hass.states.values()];
  const find = (pred: (s: HassState) => boolean) => all.find((s) => pred(s) && s.state !== 'unavailable')?.entity_id ?? all.find(pred)?.entity_id;
  const dom = (d: string) => (s: HassState) => s.entity_id.startsWith(d + '.');
  return {
    remote: find((s) => s.entity_id.startsWith('remote.')),
    calendar: find((s) => s.entity_id.startsWith('calendar.')),
    timer: find((s) => s.entity_id.startsWith('sensor.') && 'timer_state' in s.attributes && 'entry_id' in s.attributes),
    fan: find((s) => s.entity_id.startsWith('fan.')) ?? find((s) => /^(input_)?select\./.test(s.entity_id)),
    temp: find((s) => dom('sensor')(s) && s.attributes?.device_class === 'temperature'),
    sensor: find((s) => dom('sensor')(s) && !isNaN(Number(s.state)) && s.attributes?.device_class !== 'temperature') ?? find(dom('sensor')),
    light: find(dom('light')),
    switch: find(dom('switch')),
    climate: find(dom('climate')),
    camera: find(dom('camera')),
    cover: find(dom('cover')),
    media: find((s) => dom('media_player')(s) && s.state === 'playing') ?? find(dom('media_player'))
  };
}

const CELL_W = 92, CELL_H = 72, BOX_W = 236, BOX_H = 132;

/** One widget rendered at its real size, scaled into the card. */
const Live: FC<{ w: WidgetDef }> = ({ w }) => {
  const C = WIDGETS[w.type].component;
  const W = w.w * CELL_W, H = w.h * CELL_H;
  const k = Math.min(1, BOX_W / W, BOX_H / H);
  return (
    <div className="wg-live" style={{ width: W * k, height: H * k }}>
      <div className={'tile t-' + w.type} style={{ ...tileStyle(w.style), width: W, height: H, transform: `scale(${k})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
        <C w={w} />
      </div>
    </div>
  );
};

export const WidgetGallery: FC<{ doc: DashboardDoc; onPick(p: GalleryPick): void; onClose(): void }> = ({ doc, onPick, onClose }) => {
  const s = useMemo(samples, []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const cats = [...new Set(PRESETS.map((p) => p.cat))];
  const list = PRESETS.filter((p) => (!cat || p.cat === cat) && (!q || (p.label + ' ' + p.desc + ' ' + WIDGETS[p.type].label).toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="wg-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wg" role="dialog" aria-label="Dodaj widget" style={themeVars(doc.theme)}>
        <div className="wg-head">
          <b>Dodaj widget</b>
          <input autoFocus placeholder="Szukaj…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj widgetu" />
          <button className="mini" onClick={onClose} aria-label="Zamknij">×</button>
        </div>
        <div className="cat-cats">
          <button aria-pressed={!cat} onClick={() => setCat('')}>Wszystkie</button>
          {cats.map((c) => <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="wg-grid">
          {list.map((p) => {
            const d = WIDGETS[p.type].defaults;
            const patch = p.patch(s);
            const w = { id: 'pv-' + p.key, type: p.type, x: 0, y: 0, ...structuredClone(d), ...patch, w: patch.w ?? d.w ?? 4, h: patch.h ?? d.h ?? 2 } as WidgetDef;
            return (
              <button key={p.key} className="wg-card" onClick={() => onPick({ type: p.type, patch })} title={`${WIDGETS[p.type].label} · ${w.w}×${w.h}`}>
                <div className="wg-pv">
                  {p.mock
                    ? <div className="tile wg-mock"><Icon name={p.mock} size={40} /><span>{WIDGETS[p.type].label}</span></div>
                    : <Live w={w} />}
                </div>
                <span className="wg-name">{p.label}</span>
                <span className="wg-desc">{p.desc} · {w.w}×{w.h}</span>
              </button>
            );
          })}
          {list.length === 0 && <p className="muted">Nic nie pasuje.</p>}
        </div>
      </div>
    </div>
  );
};
