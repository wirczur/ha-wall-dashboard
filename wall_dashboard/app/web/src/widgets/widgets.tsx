import { lazy, Suspense, useEffect, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import type { ActionCtx } from '../lib/actions';
import type { WidgetDef, WidgetType } from '../../../shared/types';
import { cameraUrl } from '../lib/api';
import { keyQuery } from '../lib/boot';
import { renderTemplate, templateEntities, useTemplate } from '../lib/template';
import { matchesValue } from '../lib/setValue';
import { hass, useEntities, useEntity, useQuiet } from '../lib/hass';
import { formatNumber, friendly, isActive, stateLabel } from '../lib/format';
import { Icon, iconFor } from '../ui/Icon';
import { LiveCamera } from '../ui/LiveCamera';
import { hasPtz, PtzPad, type PtzCfg } from './ptz';
import { ClimateWidget } from './climate';
import { MediaWidget } from './media';
import { CalendarWidget } from './calendar';
import { WasteWidget } from './waste';
import { LevelsWidget } from './levels';
import { TimerWidget } from './timer';
import { IrrigationWidget } from './irrigation';
import { AlarmWidget, DeviceWidget, PurifierWidget, ScheduleWidget } from './devices';
import { RobotWidget } from './robot';
import { SepticWidget } from './septic';
import { IntercomWidget } from './intercom';
import { CallsWidget } from './calls';
import { UpsWidget } from './ups';

export interface WidgetProps { w: WidgetDef; ctx?: ActionCtx }

function useNow(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const Title: FC<{ w: WidgetDef; fallback?: string }> = ({ w, fallback }) => {
  const t = useTemplate(w.title);
  return w.style?.hideTitle ? null : <div className="w-title">{t || fallback}</div>;
};

// ---------------------------------------------------------------- clock / date
const Clock: FC<WidgetProps> = ({ w }) => {
  const sec = !!w.options?.seconds;
  const now = useNow(sec ? 1000 : 5000);
  const t = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) });
  const pos: string = w.options?.date ?? 'none';
  if (pos === 'none') return <div className="w-center"><div className="w-clock">{t}</div></div>;
  const fmt: Intl.DateTimeFormatOptions = w.options?.dateFormat === 'short' ? { day: 'numeric', month: 'numeric', year: 'numeric' }
    : w.options?.dateFormat === 'full' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long' };
  const d = now.toLocaleDateString('pl-PL', fmt);
  return (
    <div className={'w-clockdate cd-' + pos + ' cd-' + (w.options?.align ?? 'center')}>
      <div className="w-clock">{t}</div>
      <div className="w-cd-date">{d}</div>
    </div>
  );
};

const DateW: FC<WidgetProps> = ({ w }) => {
  const now = useNow(60_000);
  const fmt: Intl.DateTimeFormatOptions = w.options?.format === 'short'
    ? { day: 'numeric', month: 'numeric', year: 'numeric' }
    : { weekday: 'long', day: 'numeric', month: 'long' };
  return <div className="w-center"><div className="w-date">{now.toLocaleDateString('pl-PL', fmt)}</div></div>;
};

// ---------------------------------------------------------------- value / temperature
function valueText(w: WidgetDef, s = hass.states.get(w.entity || '')) {
  if (!s) return '—';
  const attr = w.options?.attribute as string | undefined;
  if (attr) {
    const v = s.attributes[attr];
    if (v == null) return '—';
    const n = Number(v);
    return (isFinite(n) ? formatNumber(n, w.options?.decimals) : String(v)) + (w.options?.unit ?? '');
  }
  const n = Number(s.state);
  if (w.options?.decimals != null && isFinite(n)) return formatNumber(n, w.options.decimals) + (w.options?.unit ?? (s.attributes.unit_of_measurement ? ' ' + s.attributes.unit_of_measurement : ''));
  return stateLabel(s, w.options?.stateMap) + (w.options?.unit ?? '');
}

const Value: FC<WidgetProps> = ({ w }) => {
  const s = useEntity(w.entity);
  const tpl = useTemplate(w.options?.template);
  return (
    <div className="w-value">
      <span className="w-icon"><Icon name={iconFor(w.entity, w.icon)} /></span>
      <div className="w-big">{w.options?.template ? tpl : valueText(w, s)}</div>
      <Title w={w} fallback={friendly(s, w.entity)} />
    </div>
  );
};

const Temperature: FC<WidgetProps> = ({ w }) => {
  const [s, sec] = useEntities([w.entity || '', w.secondary || '']);
  const raw = s ? (s.entity_id.startsWith('climate.') ? s.attributes.current_temperature : s.state) : undefined;
  const n = Number(raw);
  const temp = raw == null || raw === '' || !isFinite(n) ? '—' : formatNumber(n, w.options?.decimals ?? 1) + '°';
  return (
    <div className="w-value">
      <span className="w-icon" style={{ color: 'var(--cool)' }}><Icon name={w.icon || 'thermometer'} /></span>
      <div className="w-big">{temp}</div>
      <Title w={w} fallback={friendly(s, w.entity)} />
      {w.secondary && <div className="w-sub">{stateLabel(sec)}</div>}
    </div>
  );
};

// ---------------------------------------------------------------- climate (thermostat / AC, see climate.tsx)
const Climate: FC<WidgetProps> = ({ w, ctx }) => <ClimateWidget w={w} ctx={ctx} />;
const Media: FC<WidgetProps> = ({ w }) => <MediaWidget w={w} />;
const Calendar: FC<WidgetProps> = ({ w }) => <CalendarWidget w={w} />;
const Waste: FC<WidgetProps> = ({ w }) => <WasteWidget w={w} />;
const LevelsW: FC<WidgetProps> = ({ w, ctx }) => <LevelsWidget w={w} notify={ctx?.notify} />;
const TimerW: FC<WidgetProps> = ({ w, ctx }) => <TimerWidget w={w} notify={ctx?.notify} />;
const IrrigationW: FC<WidgetProps> = ({ w, ctx }) => <IrrigationWidget w={w} notify={ctx?.notify} />;
const PurifierW: FC<WidgetProps> = ({ w, ctx }) => <PurifierWidget w={w} notify={ctx?.notify} />;
const RobotW: FC<WidgetProps> = ({ w, ctx }) => <RobotWidget w={w} notify={ctx?.notify} />;
const SepticW: FC<WidgetProps> = ({ w, ctx }) => <SepticWidget w={w} notify={ctx?.notify}
  onOpen={() => ctx?.openPanel({ title: w.title || 'Szambo', rows: [w.options?.distance, w.options?.remaining].filter(Boolean).map((e) => ({ entity: String(e), display: 'value' as const })),
    widget: { ...w, id: w.id + '-full', title: undefined, w: 6, h: 9, options: { ...w.options, layout: 'tank' } } }, w)} />;
const DeviceW: FC<WidgetProps> = ({ w, ctx }) => <DeviceWidget w={w} notify={ctx?.notify}
  onOpen={() => ctx?.openPanel({ title: w.title, rows: [], widget: { ...w, id: w.id + '-full', title: undefined, w: 8, h: 8, options: { ...w.options, layout: 'list' } } }, w)} />;
const SchedulesW: FC<WidgetProps> = ({ w, ctx }) => <ScheduleWidget w={w} notify={ctx?.notify} />;
const AlarmW: FC<WidgetProps> = ({ w, ctx }) => <AlarmWidget w={w} notify={ctx?.notify}
  onOpen={() => ctx?.openPanel({ title: w.title || 'Naruszenia', rows: [], widget: { ...w, id: w.id + '-full', title: undefined, w: 6, h: 8, options: { ...w.options, layout: 'list' } } }, w)} />;

// ---------------------------------------------------------------- button / tile
export function buttonSubtitle(w: WidgetDef): { text: string; active: boolean } {
  const o = w.options || {};
  const s = w.entity ? hass.states.get(w.entity) : undefined;
  if (Array.isArray(o.countOn)) {
    const n = (o.countOn as string[]).filter((e) => isActive(hass.states.get(e))).length;
    return { text: o.subtitle ?? `${n} wł.`, active: n > 0 };
  }
  let text = '';
  if (o.subtitle != null) text = renderTemplate(o.subtitle);
  else if (o.subtitleAttribute && s) {
    const v = s.attributes[o.subtitleAttribute];
    text = v == null ? '' : String(v) + (o.subtitleSuffix ?? '');
  } else if (s) text = stateLabel(s, o.stateMap);
  // preset button: lit while all its values are set
  if (o.activeOnMatch && w.tap?.type === 'set' && w.tap.steps?.length)
    return { text, active: w.tap.steps.every((st) => matchesValue(hass.states.get(st.entity), st.value)) };
  return { text, active: o.active === false ? false : isActive(s) };
}

const Button: FC<WidgetProps> = ({ w }) => {
  const steps = w.tap?.type === 'set' ? w.tap.steps.map((x) => x.entity) : [];
  const ids = [w.entity || '', ...((w.options?.countOn as string[]) || []), ...templateEntities(w.options?.subtitle), ...templateEntities(w.title), ...steps];
  const [s] = useEntities(ids);
  const quiet = useQuiet();
  const q = w.tap?.type === 'quiet' && !w.entity;
  const sub = q ? { active: quiet.on, text: quiet.on ? (quiet.until ? 'do ' + new Date(quiet.until).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : 'włączona') : 'wyłączona' } : buttonSubtitle(w);
  const name = renderTemplate(w.title);
  return (
    <div className={'w-button' + (sub.active ? ' is-on' : '')}>
      <span className="w-icon"><Icon name={iconFor(w.entity, w.icon)} size={26} /></span>
      <div className="w-name">{name || friendly(s, w.entity || 'Przycisk')}</div>
      {sub.text && <div className="w-sub">{sub.text}</div>}
    </div>
  );
};

// ---------------------------------------------------------------- text / image / iframe / camera
const Text: FC<WidgetProps> = ({ w }) => {
  const title = useTemplate(w.title), text = useTemplate(w.options?.text ?? '');
  return (
    <div className={'w-text' + (w.style?.align ? ' ha-' + w.style.align : '') + (w.style?.valign ? ' va-' + w.style.valign : '')} style={{ fontSize: w.options?.size ? w.options.size + 'px' : undefined }}>
      {!w.style?.hideTitle && title && <div className="w-title">{title}</div>}
      <div style={{ whiteSpace: 'pre-line' }}>{text}</div>
    </div>
  );
};

const Image: FC<WidgetProps> = ({ w }) => (
  w.options?.url
    ? <img className="w-image" src={w.options.url} alt={w.title || ''} style={{ objectFit: w.options?.fit || 'cover' }} draggable={false} />
    : <div className="w-center w-sub">Ustaw options.url</div>
);

const Iframe: FC<WidgetProps> = ({ w }) => (
  w.options?.url
    ? <iframe className="w-iframe" src={w.options.url} title={w.title || 'Strona'} loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerPolicy="no-referrer" />
    : <div className="w-center w-sub">Ustaw options.url</div>
);

export const CameraImage: FC<{ entity?: string; stream?: string; refresh?: number; alt?: string }> = ({ entity, stream, refresh = 5, alt }) => {
  const [t, setT] = useState(() => Date.now());
  const [err, setErr] = useState(false);
  useEffect(() => { const i = setInterval(() => setT(Date.now()), Math.max(1, refresh) * 1000); return () => clearInterval(i); }, [refresh]);
  const src = stream ? 'api/go2rtc/frame.jpeg' + keyQuery(`stream=${encodeURIComponent(stream)}&t=${t}`) : cameraUrl(entity || '', t);
  return err
    ? <div className="w-center w-sub">Kamera niedostępna</div>
    : <img className="w-image" src={src} alt={alt || entity || stream} onError={() => setErr(true)} onLoad={() => setErr(false)} draggable={false} />;
};

/** "rtsp://host:8554/furtka" or "furtka" → "furtka" */
export const streamName = (v?: string) => (v ?? '').trim().replace(/^[a-z]+:\/\/[^/]+\//i, '').split(/[?#]/)[0];

/** Live (WebRTC) by default; falls back to refreshed snapshots when WebRTC is unavailable. */
export const CameraView: FC<{ entity?: string; talk?: boolean; onTalk?(on: boolean): void; snapshot?: boolean; refresh?: number; go2rtc?: { url?: string; stream: string; lite?: string }; title?: string }> =
  ({ entity, talk, onTalk, snapshot, refresh, go2rtc, title }) => {
    const [fallback, setFallback] = useState('');
    useEffect(() => { setFallback(''); }, [entity, go2rtc?.stream]);
    // weak panels (Tablety → Lite) use the lighter stream, e.g. the camera's substream (H.264, ≤ 1080p)
    const lite = document.documentElement.dataset.lite === '1' && go2rtc?.lite;
    const stream = go2rtc ? streamName(lite || go2rtc.stream) : undefined;
    if (snapshot || fallback) return (
      <div className="w-camera"><CameraImage entity={entity} stream={stream} refresh={snapshot ? refresh : 2} alt={title} />
        {title && <span className="w-live nodot">{title}</span>}
        {fallback && <span className="w-cam-note" title={fallback}>zdjęcia co 2 s – brak wideo{talk ? ' i rozmowy' : ''}</span>}
        {fallback && <button className="w-cam-retry" onClick={() => setFallback('')} aria-label="Spróbuj wideo ponownie">↻</button>}</div>
    );
    return <LiveCamera entity={entity} talk={talk} onTalk={onTalk} go2rtc={stream ? { stream } : undefined} onFail={(m) => setFallback(m || 'błąd')} />;
  };

const Camera: FC<WidgetProps> = ({ w }) => {
  const o = w.options || {};
  const g2 = o.provider === 'go2rtc' && o.stream ? { stream: streamName(o.stream), lite: o.liteStream ? streamName(o.liteStream) : undefined } : undefined;
  if (!w.entity && !g2) return <div className="w-center w-sub">{o.provider === 'go2rtc' ? 'Podaj nazwę strumienia go2rtc' : 'Wybierz encję camera'}</div>;
  return <CameraTile o={o} entity={g2 ? undefined : w.entity} g2={g2} title={w.style?.hideTitle ? undefined : w.title} fullTitle={w.title} ptzCamera={w.entity} />;
};

/** camera in a tile + "full screen" (button in the corner, or tapping the picture when the option says so) */
const CameraTile: FC<{ o: Record<string, any>; entity?: string; g2?: { stream: string; lite?: string }; title?: string; fullTitle?: string; ptzCamera?: string }> = ({ o, entity, g2, title, fullTitle, ptzCamera }) => {
  const [full, setFull] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 4000); return () => clearTimeout(t); }, [err]);
  const ptz = hasPtz(o.ptz, ptzCamera) ? o.ptz as PtzCfg : undefined;
  const canFull = o.fullscreen !== false;
  return <>
    <div className="w-camera-wrap" onPointerDown={(e) => e.stopPropagation()} onClick={() => { if (canFull && o.fullscreen === 'tap') setFull(true); }}>
      {/* the tile's own video stops while the full-screen one plays – one stream per camera on weak panels */}
      {!full && <CameraView entity={entity} talk={!!o.talk} snapshot={o.mode === 'snapshot'} refresh={o.refresh} go2rtc={g2} title={title} />}
      {canFull && <button className="w-cam-full" onClick={(e) => { e.stopPropagation(); setFull(true); }} aria-label="Pełny ekran" title="Pełny ekran"><Icon name="mdi:fullscreen" size={22} /></button>}
      {ptz && !full && <PtzPad cfg={ptz} camera={ptzCamera} onError={setErr} />}
      {err && <span className="w-cam-note ptz-err">{err}</span>}
    </div>
    {full && <CameraFull entity={entity} g2={g2} o={o} title={fullTitle} ptz={ptz} ptzCamera={ptzCamera} onClose={() => setFull(false)} />}
  </>;
};
const CameraFull: FC<{ o: Record<string, any>; entity?: string; g2?: { stream: string; lite?: string }; title?: string; ptz?: PtzCfg; ptzCamera?: string; onClose(): void }> = ({ o, entity, g2, title, ptz, ptzCamera, onClose }) => {
  const [fill, setFill] = useState(() => o.fullFit === 'cover');
  const [err, setErr] = useState('');
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className={'cam-full' + (fill ? ' fill' : '')} role="dialog" aria-label={'Kamera ' + (title ?? '')} onPointerDown={(e) => e.stopPropagation()}>
      <CameraView entity={entity} talk={!!o.talk} snapshot={o.mode === 'snapshot'} refresh={o.refresh} go2rtc={g2} />
      <div className="cam-full-bar">
        {title && <b>{title}</b>}
        <span className="grow" />
        <button onClick={() => setFill(!fill)} aria-pressed={fill} title={fill ? 'Pokaż cały obraz' : 'Wypełnij ekran (przytnie brzegi)'}>
          <Icon name={fill ? 'mdi:fit-to-screen-outline' : 'mdi:arrow-expand-all'} size={20} />{fill ? 'Cały obraz' : 'Wypełnij'}</button>
        <button onClick={onClose} aria-label="Zamknij pełny ekran"><Icon name="close" size={22} /></button>
      </div>
      {ptz && <PtzPad cfg={ptz} camera={ptzCamera} big onError={setErr} />}
      {err && <span className="w-cam-note ptz-err">{err}</span>}
    </div>, document.body);
};

// ---------------------------------------------------------------- 3D house (three.js loaded only when used)
const House3DLazy = lazy(() => import('../house/House3DWidget'));
const House3D: FC<WidgetProps> = (p) => (
  <Suspense fallback={<div className="w-center w-sub">Ładowanie 3D…</div>}><House3DLazy {...p} /></Suspense>
);

// ---------------------------------------------------------------- Samsung remote
const RemoteLazy = lazy(() => import('../remote/Remote').then((m) => ({ default: m.Remote })));
const RemoteW: FC<WidgetProps> = ({ w }) => (
  <Suspense fallback={null}>
    <RemoteLazy tv={w.options?.tv} showApps={w.options?.showApps !== false} touchpad={!!w.options?.touchpad} compact={w.h * 56 < 520} />
  </Suspense>
);

// ---------------------------------------------------------------- registry
export interface WidgetMeta { label: string; component: FC<WidgetProps>; defaults: Partial<WidgetDef>; ownInteraction?: boolean }

export const WIDGETS: Record<WidgetType, WidgetMeta> = {
  clock:       { label: 'Zegar i data', component: Clock, defaults: { w: 6, h: 3, options: { date: 'below' } } },
  date:        { label: 'Data', component: DateW, defaults: { w: 6, h: 1 } },
  value:       { label: 'Wartość encji', component: Value, defaults: { w: 4, h: 2, entity: 'sensor.przyklad' } },
  temperature: { label: 'Temperatura', component: Temperature, defaults: { w: 4, h: 2, entity: 'sensor.temperatura' } },
  climate:     { label: 'Termostat / klimatyzacja', component: Climate, defaults: { w: 8, h: 5, entity: 'climate.salon', options: { kind: 'thermostat', layout: 'auto' } }, ownInteraction: true },
  button:      { label: 'Przycisk / kafelek', component: Button, defaults: { w: 3, h: 2, title: 'Przycisk', icon: 'bulb' } },
  text:        { label: 'Tekst', component: Text, defaults: { w: 6, h: 2, options: { text: 'Tekst' } } },
  image:       { label: 'Obrazek', component: Image, defaults: { w: 6, h: 4, options: { url: '', fit: 'cover' } } },
  iframe:      { label: 'Strona (iframe)', component: Iframe, defaults: { w: 12, h: 6, options: { url: '' } }, ownInteraction: true },
  camera:      { label: 'Kamera', component: Camera, defaults: { w: 8, h: 5, entity: 'camera.przyklad', options: { refresh: 5 } }, ownInteraction: true },
  timer:       { label: 'Timer (Simple Timer)', component: TimerW, defaults: { w: 6, h: 5, options: { presets: [15, 30, 60, 90, 120] } }, ownInteraction: true },
  irrigation:  { label: 'Nawadnianie (Rain Bird IQ4)', component: IrrigationW, defaults: { w: 8, h: 10, options: { duration: 10 } }, ownInteraction: true },
  purifier:    { label: 'Oczyszczacz / wentylator (Dyson)', component: PurifierW, defaults: { w: 6, h: 6 }, ownInteraction: true },
  ups:         { label: 'UPS (zasilacz awaryjny)', component: ({ w }) => <UpsWidget w={w} />, defaults: { w: 5, h: 4, title: 'UPS' } },
  calls:       { label: 'Dzwonek – nieodebrane / historia', component: ({ w }) => <CallsWidget w={w} />, defaults: { w: 4, h: 5, title: 'Nieodebrane' }, ownInteraction: true },
  intercom:    { label: 'Interkom (rozmowa między panelami)', component: ({ w }) => <IntercomWidget w={w} />, defaults: { w: 3, h: 2, title: 'Interkom' }, ownInteraction: true },
  septic:      { label: 'Szambo / zbiornik', component: SepticW, defaults: { w: 3, h: 5, title: 'Szambo', options: { warn: 75, alarm: 90 } }, ownInteraction: true },
  robot:       { label: 'Robot – kosiarka / odkurzacz', component: RobotW, defaults: { w: 6, h: 5 }, ownInteraction: true },
  device:      { label: 'Urządzenie (np. AGD Samsung – LocalThings)', component: DeviceW, defaults: { w: 6, h: 6 }, ownInteraction: true },
  schedules:   { label: 'Harmonogramy (Scheduler)', component: SchedulesW, defaults: { w: 6, h: 7, title: 'Harmonogramy' }, ownInteraction: true },
  alarm:       { label: 'Alarm (Satel i inne)', component: AlarmW, defaults: { w: 6, h: 8 }, ownInteraction: true },
  levels:      { label: 'Poziomy (np. wentylacja 1–4)', component: LevelsW, defaults: { w: 6, h: 3, entity: 'fan.rekuperator', options: { off: true } }, ownInteraction: true },
  waste:       { label: 'Wywóz śmieci', component: Waste, defaults: { w: 6, h: 2, title: 'Wywóz', options: { alertDays: 1 } } },
  calendar:    { label: 'Kalendarz', component: Calendar, defaults: { w: 6, h: 6, title: 'Kalendarz', options: { layout: 'auto', calendars: [] } }, ownInteraction: true },
  media:       { label: 'Odtwarzacz (media player)', component: Media, defaults: { w: 8, h: 4, entity: 'media_player.przyklad', options: { layout: 'auto' }, style: { padding: 0 } }, ownInteraction: true },
  remote:      { label: 'Pilot TV (Samsung)', component: RemoteW, defaults: { w: 6, h: 10, options: { tv: '', showApps: true } }, ownInteraction: true },
  house3d:     { label: 'Dom 3D', component: House3D, defaults: { w: 12, h: 10, options: { house: '', level: 0, showLevels: true, lowWalls: true, heatmap: true, camera: { az: 90, el: 48, zoom: 1 } }, style: { padding: 0 } }, ownInteraction: true }
};
