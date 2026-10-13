// Widgets for whole devices and integrations:
//  - Purifier: air purifier / fan (Dyson hass-dyson and others) – air quality, speed, auto, night, oscillation, filter
//  - Device: any device's entities as rows (Samsung appliances via LocalThings, …), timers and finish time on top
//  - Schedules: nielsfaber/scheduler-component – list, enable, next run, add a simple schedule
//  - Alarm: alarm_control_panel (Satel Integra and others) – keypad, arm modes, zones and outputs
import { useEffect, useState, type FC } from 'react';
import type { HassState, PanelRow, WidgetDef } from '../../../shared/types';
import { domainOf, formatNumber, friendly } from '../lib/format';
import { hass, useEntities, useEntity } from '../lib/hass';
import { Icon } from '../ui/Icon';
import { PanelRowView } from '../view/PanelRows';

type Notify = ((m: string) => void) | undefined;
const stop = { onClick: (e: { stopPropagation(): void }) => e.stopPropagation(), onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation() };
const num = (s?: HassState) => (s && isFinite(Number(s.state)) ? Number(s.state) : undefined);

// ---------------------------------------------------------------- purifier (Dyson)
export const AIR_KEYS: [string, string, string][] = [
  ['pm25', 'PM2.5', 'µg/m³'], ['pm10', 'PM10', 'µg/m³'], ['voc', 'VOC', ''], ['no2', 'NO₂', ''], ['hcho', 'HCHO', 'mg/m³'],
  ['co2', 'CO₂', 'ppm'], ['temperature', 'Temp.', '°C'], ['humidity', 'Wilg.', '%']
];
/** PM2.5 → quality band (WHO-ish), used for the colour of the big number */
const pmBand = (v?: number) => v == null ? '' : v <= 12 ? 'good' : v <= 35 ? 'fair' : v <= 55 ? 'poor' : 'bad';
const BAND_PL: Record<string, string> = { good: 'dobra', fair: 'umiarkowana', poor: 'słaba', bad: 'zła' };

/** translation_key → option name, for discovery from the entity registry */
export const DYSON_MAP: Record<string, string> = {
  pm25: 'pm25', p25r: 'pm25', pm10: 'pm10', p10r: 'pm10', voc: 'voc', no2: 'no2', hcho: 'hcho', co2: 'co2', temperature: 'temperature', humidity: 'humidity',
  hepa_filter_life: 'filter', filter_life: 'filter', night_mode: 'night', auto_mode: 'auto', oscillation: 'oscillation', aqi: 'aqi'
};

export const PurifierWidget: FC<{ w: WidgetDef; notify?: Notify }> = ({ w, notify }) => {
  const o = w.options ?? {};
  const fan = useEntity(o.fan);
  const air = useEntities(AIR_KEYS.map(([k]) => o[k] ?? ''));
  const [filter, night, auto, osc, aqi] = useEntities([o.filter ?? '', o.night ?? '', o.auto ?? '', o.oscillation ?? '', o.aqi ?? '']);
  if (!fan) return <div className="pu pu-empty"><Icon name="fan" size={28} /><span>Wskaż wentylator / oczyszczacz (przycisk „Wykryj” w ustawieniach)</span></div>;
  const a = fan.attributes, on = fan.state === 'on';
  const pct = Number(a.percentage ?? 0), step = Number(a.percentage_step ?? 10) || 10;
  const speed = on ? Math.round(pct / step) : 0, max = Math.round(100 / step);
  const call = (d: string, s: string, data?: Record<string, unknown>, e = fan.entity_id) => hass.call(d, s, data, e).catch((er: Error) => notify?.(er.message));
  const autoOn = auto ? auto.state === 'on' : String(a.preset_mode ?? '').toLowerCase() === 'auto';
  const toggleSwitch = (s?: HassState) => s && call(domainOf(s.entity_id) === 'select' ? 'select' : 'homeassistant', domainOf(s.entity_id) === 'select' ? 'select_next' : 'toggle', undefined, s.entity_id);
  const pm = num(air[0]);
  const band = pmBand(pm);
  const presets: string[] = Array.isArray(a.preset_modes) ? a.preset_modes : [];
  return (
    <div className="pu" {...stop}>
      <div className="pu-head">
        <button className={'pu-pow' + (on ? ' on' : '')} onClick={() => call('fan', on ? 'turn_off' : 'turn_on')} aria-label={on ? 'Wyłącz' : 'Włącz'}><Icon name="power" size={20} /></button>
        <div className="pu-title"><b>{w.title || friendly(fan, fan.entity_id)}</b><small>{on ? (autoOn ? 'auto' : `prędkość ${speed}/${max}`) : 'wyłączony'}</small></div>
        {pm != null && <div className={'pu-aq ' + band}><b>{formatNumber(pm, 0)}</b><small>PM2.5 · {BAND_PL[band]}</small></div>}
        {pm == null && aqi && <div className="pu-aq"><b>{aqi.state}</b><small>AQI</small></div>}
      </div>
      <div className="pu-air">
        {AIR_KEYS.slice(1).map(([k, label, unit], i) => {
          const s = air[i + 1]; if (!s) return null;
          return <div key={k}><small>{label}</small><b>{formatNumber(Number(s.state), k === 'temperature' ? 1 : 0)}<i>{s.attributes.unit_of_measurement ?? unit}</i></b></div>;
        })}
      </div>
      <div className="pu-speed">
        <button onClick={() => call('fan', 'set_percentage', { percentage: Math.max(step, pct - step) })} disabled={!on || speed <= 1} aria-label="Wolniej">−</button>
        <div className="pu-bars" aria-label={`Prędkość ${speed} z ${max}`}>
          {Array.from({ length: max }, (_, i) => <i key={i} className={i < speed ? 'on' : ''} style={{ height: 30 + (i / Math.max(1, max - 1)) * 70 + '%' }} onClick={() => call('fan', 'set_percentage', { percentage: (i + 1) * step })} />)}
        </div>
        <button onClick={() => call('fan', 'set_percentage', { percentage: Math.min(100, (on ? pct : 0) + step) })} disabled={speed >= max} aria-label="Szybciej">+</button>
      </div>
      <div className="pu-modes">
        {(auto || presets.some((p) => p.toLowerCase() === 'auto')) && <button aria-pressed={autoOn} onClick={() => auto ? toggleSwitch(auto) : call('fan', 'set_preset_mode', { preset_mode: presets.find((p) => p.toLowerCase() === 'auto') })}><Icon name="auto" size={18} />Auto</button>}
        {night && <button aria-pressed={night.state === 'on'} onClick={() => toggleSwitch(night)}><Icon name="moon" size={18} />Noc</button>}
        {(osc || a.oscillating != null) && <button aria-pressed={osc ? osc.state === 'on' : !!a.oscillating} onClick={() => osc ? toggleSwitch(osc) : call('fan', 'oscillate', { oscillating: !a.oscillating })}><Icon name="mdi:arrow-oscillating" size={18} />Obrót</button>}
      </div>
      {filter && <div className="pu-filter"><small>Filtr</small><div className="pu-fbar"><i style={{ width: Math.max(0, Math.min(100, Number(filter.state) || 0)) + '%' }} className={(Number(filter.state) || 0) < 15 ? 'low' : ''} /></div><small>{filter.state}{filter.attributes.unit_of_measurement ?? '%'}</small></div>}
    </div>
  );
};

// ---------------------------------------------------------------- generic device (LocalThings appliances, …)
/** Square layout (1:1): when chosen, or "auto" on a small, roughly square tile. */
const isSquare = (w: WidgetDef) => { const l = w.options?.layout ?? 'auto'; return l === 'square' || (l === 'auto' && w.w <= 4 && w.h <= 4 && Math.abs(w.w - w.h) <= 1); };

/**
 * Entity names without the device name in front: "Samsung Dryer Szacowany czas" → "Szacowany czas".
 * Strips the widget title and the words every entity of the device starts with (HA puts the device name first).
 */
export function shortNames(names: string[], title?: string): string[] {
  const words = names.map((n) => n.trim().split(/\s+/));
  let common = 0;
  if (words.length >= 2) {
    const min = Math.min(...words.map((w) => w.length));
    while (common < min && words.every((w) => w[common].toLowerCase() === words[0][common].toLowerCase())) common++;
    // every name identical → nothing to strip
    if (words.every((w) => w.length === common)) common = 0;
  }
  const t = title?.trim().toLowerCase();
  return words.map((w, i) => {
    const full = names[i].trim();
    // the main entity is often named just like the device ("Samsung Dryer") → its state
    let out = common && w.length === common ? 'Stan' : w.slice(common).join(' ');
    // the widget title, when it cuts more than the common words
    if (t && full.toLowerCase().startsWith(t + ' ')) { const rest = full.slice(t.length + 1).trim(); if (rest.length < out.length) out = rest; }
    out = out.replace(/^[-–:·]\s*/, '') || full;
    return out.charAt(0).toUpperCase() + out.slice(1);
  });
}

export const DeviceWidget: FC<{ w: WidgetDef; notify?: Notify; onOpen?(): void }> = ({ w, notify, onOpen }) => {
  const o = w.options ?? {};
  const ents: string[] = Array.isArray(o.entities) ? o.entities : [];
  const states = useEntities(ents);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  if (!ents.length) return <div className="dv dv-empty"><Icon name="settings" size={26} /><span>Wybierz urządzenie w ustawieniach widgetu</span></div>;
  if (isSquare(w)) return <DeviceSquare w={w} states={states.filter((s): s is HassState => !!s)} onOpen={onOpen} />;
  // on top: remaining time / finish time / main state – what you want to see from across the room
  const hero = states.filter((s): s is HassState => !!s && (/remaining|finish|end|koniec|pozosta|completion/i.test(s.entity_id) || ['duration', 'timestamp'].includes(s.attributes.device_class))).slice(0, 2);
  const rows = ents.filter((e) => !hero.some((h) => h.entity_id === e));
  const shorts = shortNames(ents.map((e, i) => friendly(states[i], e)), w.title);
  const label = (e: string) => shorts[ents.indexOf(e)] ?? e;
  const show = (s: HassState) => {
    if (s.attributes.device_class === 'timestamp') { const d = new Date(s.state); return isNaN(+d) ? s.state : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); }
    const v = Number(s.state), u = s.attributes.unit_of_measurement;
    if (isFinite(v) && (u === 'min' || s.attributes.device_class === 'duration')) { const m = u === 's' ? v / 60 : u === 'h' ? v * 60 : v; return `${Math.floor(m / 60) ? Math.floor(m / 60) + ' h ' : ''}${Math.round(m % 60)} min`; }
    return s.state + (u ? ' ' + u : '');
  };
  return (
    <div className="dv" {...stop}>
      {(w.title || hero.length > 0) && <div className="dv-head">
        {w.title && <b>{w.title}</b>}
        {hero.map((s) => <span key={s.entity_id} className="dv-hero"><small>{o.names?.[s.entity_id] ?? label(s.entity_id)}</small>{show(s)}</span>)}
      </div>}
      <div className="dv-rows">{rows.map((e, i) => (
        <PanelRowView key={e + i} row={{ entity: e, name: o.names?.[e] ?? label(e) } as PanelRow} onError={(m) => notify?.(m)} />))}</div>
    </div>
  );
};

// ---------------------------------------------------------------- device as a 1:1 tile
const IDLE_RE = /^(off|none|ready|idle|stop|stopped|end|finished|done|complete|standby|unknown|unavailable|gotowa?|wył|koniec|zakończ)/i;
/** Appliance icon from the name / model (Polish and English names). */
export function applianceIcon(text: string) {
  const t = text.toLowerCase();
  if (/susz|dryer|tumble/.test(t)) return 'mdi:tumble-dryer';
  if (/zmyw|dish/.test(t)) return 'mdi:dishwasher';
  if (/prał|prak|pralk|wash/.test(t)) return 'mdi:washing-machine';
  if (/piek|oven|stove|kuchen/.test(t)) return 'mdi:stove';
  if (/lodów|lodow|fridge|refriger|zamraż/.test(t)) return 'mdi:fridge-outline';
  if (/ekspres|coffee|kaw/.test(t)) return 'mdi:coffee-maker-outline';
  if (/mikrofal|microwave/.test(t)) return 'mdi:microwave';
  if (/okap|hood/.test(t)) return 'mdi:range-hood';
  return 'mdi:devices';
}
const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)}`;

const DeviceSquare: FC<{ w: WidgetDef; states: HassState[]; onOpen?(): void }> = ({ w, states, onOpen }) => {
  const by = (re: RegExp, pred: (s: HassState) => boolean = () => true) => states.find((s) => re.test(s.entity_id + ' ' + (s.attributes.friendly_name ?? '')) && pred(s));
  const dc = (s: HassState) => s.attributes.device_class;
  const remaining = states.find((s) => dc(s) === 'duration' || /remaining|pozosta/i.test(s.entity_id + ' ' + (s.attributes.friendly_name ?? '')));
  const finish = states.find((s) => dc(s) === 'timestamp' && /finish|end|koniec|completion/i.test(s.entity_id + ' ' + (s.attributes.friendly_name ?? '')));
  const progressS = by(/progress|postęp|completion_rate/i, (s) => isFinite(Number(s.state)));
  const stateS = w.options?.status ? states.find((s) => s.entity_id === w.options!.status) : by(/(machine|operating|job|run|cycle|operation)_?state|status|stan/i, (s) => !isFinite(Number(s.state)) || s.entity_id.startsWith('select.'));
  // a program name – not a raw code like "1B" / "16" (Samsung course ids); a select with real option names wins
  const isName = (v: string) => !!v && !['unknown', 'unavailable', 'none'].includes(v) && !/^[0-9a-f]{1,3}$/i.test(v) && !/^(course|cycle)_?[0-9a-f]+$/i.test(v);
  const program = w.options?.program ? states.find((s) => s.entity_id === w.options!.program)
    : [...states].sort((x, y) => Number(y.entity_id.startsWith('select.')) - Number(x.entity_id.startsWith('select.')))
      .find((s) => /program|cycle|course|tryb/i.test(s.entity_id + ' ' + (s.attributes.friendly_name ?? '')) && /^(select|sensor)\./.test(s.entity_id) && isName(s.state));
  const power = states.find((s) => /^(switch|binary_sensor)\./.test(s.entity_id) && /power|zasil|running|run/i.test(s.entity_id));

  let mins: number | undefined;
  if (remaining && isFinite(Number(remaining.state))) { const u = remaining.attributes.unit_of_measurement; const v = Number(remaining.state); mins = u === 's' ? v / 60 : u === 'h' ? v * 60 : v; }
  else if (finish) { const t = Date.parse(finish.state); if (isFinite(t)) mins = Math.max(0, (t - Date.now()) / 60_000); }
  const stateTxt = stateS && !['unknown', 'unavailable'].includes(stateS.state) ? stateS.state : undefined;
  const running = (mins ?? 0) > 0 ? !(stateTxt && IDLE_RE.test(stateTxt)) : stateTxt ? !IDLE_RE.test(stateTxt) : power?.state === 'on' && !!remaining;
  const off = power?.state === 'off';
  const pct = progressS ? Math.max(0, Math.min(100, Number(progressS.state))) : undefined;
  const endAt = finish && isFinite(Date.parse(finish.state)) ? new Date(finish.state) : mins ? new Date(Date.now() + mins * 60_000) : undefined;
  const title = w.title || 'Urządzenie';
  const icon = w.icon || applianceIcon(title + ' ' + states.map((s) => s.entity_id).join(' '));
  const R = 44, C = 2 * Math.PI * R;
  const narrow = w.w <= 2;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ');

  return (
    <button className={'dvq' + (running ? ' run' : '') + (off ? ' off' : '') + (narrow ? ' narrow' : '') + (w.h > w.w ? ' tall' : '') + (w.w >= w.h * 1.5 ? ' wide' : '')} onClick={(e) => { e.stopPropagation(); onOpen?.(); }} aria-label={`${title}: ${running ? 'pracuje' : stateTxt ?? 'bezczynna'}`}>
      <div className="dvq-ring">
        <svg viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r={R} className="dvq-track" />
          {running && <circle cx="50" cy="50" r={R} className={'dvq-prog' + (pct == null ? ' spin' : '')} strokeDasharray={pct == null ? `${C * 0.22} ${C}` : `${(C * pct) / 100} ${C}`} transform="rotate(-90 50 50)" />}
        </svg>
        <div className="dvq-mid">
          {running && mins != null
            ? <><b>{fmtMin(mins)}</b><small>{mins >= 60 ? 'h:min' : 'min'}</small></>
            : <Icon name={icon} size={34} />}
        </div>
      </div>
      <div className="dvq-txt">
        <b>{title}</b>
        {running ? <>
          {(() => { const t = program && isName(program.state) ? program.state : stateTxt && isName(stateTxt) ? stateTxt : ''; return t ? <small>{cap(t)}</small> : null; })()}
          {endAt && <small className="dvq-end">{narrow || w.w >= w.h * 1.5 ? 'do' : 'koniec'} {endAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</small>}
        </> : <small>{off ? 'wyłączona' : stateTxt ? cap(stateTxt) : 'gotowa'}</small>}
      </div>
    </button>
  );
};

// ---------------------------------------------------------------- scheduler-component
const WD: Record<string, string> = { mon: 'pn', tue: 'wt', wed: 'śr', thu: 'cz', fri: 'pt', sat: 'sb', sun: 'nd', daily: 'codziennie', workday: 'dni robocze', weekend: 'weekend' };
export const isSchedule = (s?: HassState) => !!s && s.entity_id.startsWith('switch.schedule_') || (!!s && s.entity_id.startsWith('switch.') && Array.isArray(s.attributes.timeslots) && 'next_trigger' in s.attributes);

export const ScheduleWidget: FC<{ w: WidgetDef; notify?: Notify }> = ({ w, notify }) => {
  const o = w.options ?? {};
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ entity: '', at: '07:00', action: 'turn_on', days: ['daily'] as string[] });
  const all = [...hass.states.values()].filter(isSchedule);
  useEntities(all.map((s) => s.entity_id)); // re-render on changes
  const tag: string | undefined = o.tag;
  const forEntities: string[] = Array.isArray(o.entities) ? o.entities : [];
  const list = all.filter((s) => (!tag || (s.attributes.tags ?? []).includes(tag)) && (!forEntities.length || (s.attributes.entities ?? []).some((e: string) => forEntities.includes(e))))
    .sort((a, b) => String(a.attributes.next_trigger ?? 'z').localeCompare(String(b.attributes.next_trigger ?? 'z')));
  const call = (svc: string, data?: Record<string, unknown>, e?: string) => hass.call(svc.split('.')[0], svc.split('.')[1], data, e).catch((er: Error) => notify?.(er.message));
  const add = () => {
    if (!form.entity) return;
    const d = domainOf(form.entity);
    const service = d === 'cover' ? (form.action === 'turn_on' ? 'cover.open_cover' : 'cover.close_cover') : d === 'scene' || d === 'script' ? `${d}.turn_on` : `${['light', 'switch', 'fan', 'input_boolean', 'climate', 'media_player'].includes(d) ? d : 'homeassistant'}.${form.action}`;
    call('scheduler.add', { weekdays: form.days, repeat_type: 'repeat', name: o.newName || undefined, ...(tag ? { tags: [tag] } : {}), timeslots: [{ start: form.at, actions: [{ service, entity_id: form.entity }] }] });
    setAdding(false);
  };
  return (
    <div className="sc" {...stop}>
      <div className="sc-head"><Icon name="calendar" size={20} /><b>{w.title || 'Harmonogramy'}</b>
        {o.allowAdd !== false && <button className="sc-add" onClick={() => setAdding(!adding)}>{adding ? 'Anuluj' : '+ Dodaj'}</button>}</div>
      {adding && (
        <div className="sc-form">
          <select value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} aria-label="Urządzenie">
            <option value="">urządzenie…</option>
            {(forEntities.length ? forEntities : [...hass.states.keys()].filter((e) => /^(light|switch|cover|fan|scene|script|climate|input_boolean)\./.test(e))).map((e) =>
              <option key={e} value={e}>{friendly(hass.states.get(e), e)}</option>)}
          </select>
          <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} aria-label="Akcja"><option value="turn_on">włącz / otwórz</option><option value="turn_off">wyłącz / zamknij</option></select>
          <input type="time" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} aria-label="Godzina" />
          <div className="sc-days">{['daily', 'workday', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => {
            const on = form.days.includes(d);
            return <button key={d} aria-pressed={on} onClick={() => setForm({ ...form, days: d === 'daily' || d === 'workday' ? [d] : on ? form.days.filter((x) => x !== d) : [...form.days.filter((x) => x !== 'daily' && x !== 'workday'), d] })}>{WD[d]}</button>;
          })}</div>
          <button className="sc-save" disabled={!form.entity || !form.days.length} onClick={add}>Zapisz harmonogram</button>
        </div>
      )}
      <div className="sc-list">
        {list.length === 0 && <p className="sc-none">{all.length ? 'Brak harmonogramów pasujących do filtra' : 'Brak harmonogramów (integracja Scheduler z HACS)'}</p>}
        {list.map((s) => {
          const a = s.attributes;
          const next = a.next_trigger ? new Date(a.next_trigger) : null;
          const ents: string[] = a.entities ?? [];
          return (
            <div key={s.entity_id} className={'sc-it' + (s.state === 'off' ? ' off' : '')}>
              <button className={'sc-sw' + (s.state !== 'off' ? ' on' : '')} role="switch" aria-checked={s.state !== 'off'} aria-label="Aktywny" onClick={() => call(s.state === 'off' ? 'switch.turn_on' : 'switch.turn_off', undefined, s.entity_id)}><span /></button>
              <div className="sc-txt">
                <b>{friendly(s, s.entity_id).replace(/^Schedule\s*#?/i, 'Harmonogram ')}</b>
                <small>{(a.timeslots ?? []).join(', ')} · {(a.weekdays ?? []).map((d: string) => WD[d] ?? d).join(' ')}{ents.length ? ' · ' + ents.map((e) => friendly(hass.states.get(e), e)).join(', ') : ''}</small>
                {next && !isNaN(+next) && s.state !== 'off' && <small className="sc-next">następnie {next.toLocaleString('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small>}
              </div>
              <button className="mini" title="Wykonaj teraz" onClick={() => call('scheduler.run_action', { entity_id: s.entity_id })}>▶</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- alarm (Satel Integra and other alarm_control_panel)
const AL_PL: Record<string, string> = { disarmed: 'Rozbrojony', armed_home: 'Uzbrojony (w domu)', armed_away: 'Uzbrojony', armed_night: 'Uzbrojony (noc)', armed_vacation: 'Uzbrojony (urlop)',
  armed_custom_bypass: 'Uzbrojony (z wyłączeniami)', pending: 'Odliczanie…', arming: 'Uzbrajanie…', disarming: 'Rozbrajanie…', triggered: 'ALARM!', unavailable: 'Niedostępny' };
const F = { HOME: 1, AWAY: 2, NIGHT: 4, BYPASS: 16, VACATION: 32 };

export const AlarmWidget: FC<{ w: WidgetDef; notify?: Notify; onOpen?(): void }> = ({ w, notify, onOpen }) => {
  const o = w.options ?? {};
  const s = useEntity(w.entity);
  const zones: string[] = Array.isArray(o.zones) ? o.zones : [];
  const outputs: string[] = Array.isArray(o.outputs) ? o.outputs : [];
  const zs = useEntities(zones);
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!code) return; const t = setTimeout(() => setCode(''), 30_000); return () => clearTimeout(t); }, [code]);
  // violations only – no keypad / arming (e.g. a "what is open" tile by the door)
  if (o.panel === false) {
    const openZ = zs.filter((z): z is HassState => !!z && z.state === 'on').sort((x, y) => Date.parse(y.last_changed ?? '') - Date.parse(x.last_changed ?? ''));
    if (!zones.length) return <div className="al al-empty"><Icon name="shield" size={28} /><span>Wskaż strefy (binary_sensor) w ustawieniach – „Wykryj strefy Satel”</span></div>;
    // button with a counter – tap opens the list in a side panel
    const asButton = o.layout === 'button' || (o.layout !== 'list' && w.w <= 3 && w.h <= 3);
    if (asButton) {
      const n = openZ.length;
      return (
        <button className={'al-btn' + (n ? ' has' : '')} onClick={(e) => { e.stopPropagation(); onOpen?.(); }} aria-label={`${w.title || 'Naruszenia'}: ${n}`}>
          <span className="al-btn-ico"><Icon name={n ? 'mdi:shield-alert-outline' : 'mdi:shield-check-outline'} size={28} />{n > 0 && <i className="al-badge">{n}</i>}</span>
          <b>{w.title || 'Naruszenia'}</b>
          <small>{n ? (n === 1 ? friendly(openZ[0], openZ[0].entity_id) : `${n} otwarte`) : (o.okText || 'wszystko zamknięte')}</small>
        </button>
      );
    }
    return (
      <div className={'al al-only' + (openZ.length ? ' has' : '')} {...stop}>
        <div className="al-head"><Icon name={openZ.length ? 'mdi:alert' : 'shield'} size={20} />
          <div><b>{w.title || 'Naruszenia'}</b>{s && <small>{AL_PL[s.state] ?? s.state}</small>}</div>
          <span className={'al-open' + (openZ.length ? ' warn' : '')}>{openZ.length || '✓'}</span></div>
        <div className="al-viol">
          {openZ.length === 0
            ? <div className="al-ok"><Icon name="shield" size={16} />{o.okText || 'Wszystko zamknięte'}</div>
            : openZ.map((z) => (
              <div key={z.entity_id} className="al-v"><Icon name={zoneIcon(z)} size={18} /><b>{friendly(z, z.entity_id)}</b><span>{zoneText(z)}</span><small>{since(z.last_changed)}</small></div>
            ))}
        </div>
      </div>
    );
  }
  if (!s) return <div className="al al-empty"><Icon name="shield" size={28} /><span>Wskaż centralę alarmową (alarm_control_panel)</span></div>;
  const a = s.attributes, sf = Number(a.supported_features ?? 0xff);
  const needCode = !!a.code_format;
  const open = zs.filter((z): z is HassState => !!z && z.state === 'on').sort((x, y) => Date.parse(y.last_changed ?? '') - Date.parse(x.last_changed ?? ''));
  const armed = s.state.startsWith('armed') || s.state === 'triggered' || s.state === 'pending' || s.state === 'arming';
  const go = (service: string, force = false) => {
    if (needCode && !code && (service === 'alarm_disarm' || a.code_arm_required !== false)) { notify?.('Wpisz kod'); return; }
    // arming with violated zones: ask first (the panel may refuse or bypass them)
    if (!force && service !== 'alarm_disarm' && o.warnOnArm !== false && open.length) { setConfirm(service); return; }
    setConfirm(null);
    hass.call('alarm_control_panel', service, code ? { code } : undefined, s.entity_id).then(() => setCode('')).catch((e: Error) => { notify?.(e.message); setCode(''); });
  };
  const cls = s.state === 'triggered' ? 'trig' : armed ? 'armed' : s.state === 'disarmed' ? 'off' : '';
  return (
    <div className={'al al-' + cls} {...stop}>
      <div className="al-head"><Icon name="shield" size={22} /><div><b>{w.title || friendly(s, s.entity_id)}</b><small>{AL_PL[s.state] ?? s.state}</small></div>
        {zones.length > 0 && <span className={'al-open' + (open.length ? ' warn' : '')}>{open.length ? `naruszenia: ${open.length}` : 'brak naruszeń'}</span>}</div>
      {zones.length > 0 && o.violations !== false && (
        <div className={'al-viol' + (open.length ? ' warn' : '')}>
          {open.length === 0
            ? <div className="al-ok"><Icon name="shield" size={16} />Wszystkie strefy w spoczynku – można uzbroić</div>
            : open.map((z) => (
              <div key={z.entity_id} className="al-v">
                <Icon name={zoneIcon(z)} size={18} />
                <b>{friendly(z, z.entity_id)}</b>
                <span>{zoneText(z)}</span>
                <small>{since(z.last_changed)}</small>
              </div>
            ))}
        </div>
      )}
      {confirm && (
        <div className="al-confirm" role="alertdialog">
          <span>Naruszone: {open.map((z) => friendly(z, z.entity_id)).join(', ')}. Uzbroić mimo to?</span>
          <button className="al-b" onClick={() => go(confirm, true)}>Uzbrój</button>
          <button className="al-b ghost" onClick={() => setConfirm(null)}>Anuluj</button>
        </div>
      )}
      <div className="al-main">
        {needCode && o.keypad !== false && (
          <div className="al-pad">
            <div className="al-code" aria-label="Kod">{code ? '•'.repeat(code.length) : <span>kod</span>}</div>
            <div className="al-keys">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                <button key={k} onClick={() => { navigator.vibrate?.(8); setCode(k === 'C' ? '' : k === '⌫' ? code.slice(0, -1) : (code + k).slice(0, 12)); }}>{k}</button>
              ))}
            </div>
          </div>
        )}
        <div className="al-acts">
          {armed
            ? <button className="al-b dis" onClick={() => go('alarm_disarm')}><Icon name="unlock" size={20} />Rozbrój</button>
            : <>
              {sf & F.AWAY ? <button className="al-b" onClick={() => go('alarm_arm_away')}><Icon name="lock" size={20} />Uzbrój</button> : null}
              {sf & F.HOME ? <button className="al-b" onClick={() => go('alarm_arm_home')}><Icon name="home" size={20} />W domu</button> : null}
              {sf & F.NIGHT ? <button className="al-b" onClick={() => go('alarm_arm_night')}><Icon name="moon" size={20} />Noc</button> : null}
              {sf & F.VACATION && o.vacation ? <button className="al-b" onClick={() => go('alarm_arm_vacation')}><Icon name="away" size={20} />Urlop</button> : null}
            </>}
        </div>
      </div>
      {((o.allZones && zones.length > 0) || outputs.length > 0) && (
        <div className="al-zones">
          {o.allZones && zs.map((z, i) => z ? <span key={zones[i]} className={'al-z' + (z.state === 'on' ? ' on' : '')}>{friendly(z, zones[i])}</span> : null)}
          {outputs.map((e) => <OutputChip key={e} entity={e} notify={notify} />)}
        </div>
      )}
    </div>
  );
};
/** zone icon / wording by binary_sensor device_class */
const zoneIcon = (z: HassState) => { const c = z.attributes.device_class; return c === 'door' || c === 'garage_door' ? 'door' : c === 'window' ? 'window' : c === 'motion' || c === 'occupancy' || c === 'presence' ? 'mdi:motion-sensor' : c === 'smoke' || c === 'gas' ? 'mdi:smoke-detector' : c === 'moisture' ? 'droplet' : c === 'tamper' || c === 'problem' ? 'mdi:alert' : 'shield'; };
const zoneText = (z: HassState) => { const c = z.attributes.device_class; return c === 'door' || c === 'garage_door' || c === 'window' || c === 'opening' ? 'otwarte' : c === 'motion' || c === 'occupancy' || c === 'presence' ? 'ruch' : c === 'smoke' ? 'dym' : c === 'gas' ? 'gaz' : c === 'moisture' ? 'zalanie' : c === 'tamper' ? 'sabotaż' : 'naruszona'; };
const since = (iso?: string) => { const t = Date.parse(iso ?? ''); if (!isFinite(t)) return ''; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'teraz' : m < 60 ? `od ${m} min` : m < 1440 ? `od ${Math.floor(m / 60)} h ${m % 60} min` : `od ${Math.floor(m / 1440)} d`; };

const OutputChip: FC<{ entity: string; notify?: Notify }> = ({ entity, notify }) => {
  const s = useEntity(entity);
  if (!s) return null;
  return <button className={'al-z out' + (s.state === 'on' ? ' on' : '')} onClick={() => hass.call('homeassistant', 'toggle', undefined, entity).catch((e: Error) => notify?.(e.message))}><Icon name="power" size={14} />{friendly(s, entity)}</button>;
};
