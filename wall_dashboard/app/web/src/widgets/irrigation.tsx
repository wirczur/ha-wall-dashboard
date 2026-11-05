// Rain Bird IQ4 (github.com/Chapter-322/rainbird_iq4, 1.8+): zones with per-zone duration (1–100 min), start / stop,
// stop all, programs (run now, next run), rain delay, rain sensor, forecast delay, controller mode, alarms and cloud connection.
import { useEffect, useState, type FC } from 'react';
import type { HassState, WidgetDef } from '../../../shared/types';
import { hass, useEntities, useEntity } from '../lib/hass';
import { Icon } from '../ui/Icon';

export const isIq4Station = (s?: HassState) => !!s && s.entity_id.startsWith('sensor.') && s.attributes.terminal !== undefined
  && !/_program_|_rain_delay/.test(s.entity_id) && ['idle', 'running', 'paused', 'unknown', 'unavailable'].includes(s.state);
export const isIq4Program = (s?: HassState) => !!s && s.entity_id.startsWith('sensor.') && s.attributes.schedule_type !== undefined && 'steps' in s.attributes;

/** Finds the IQ4 entities in a state list (used by the editor and the gallery). */
export function discoverIq4(states: Iterable<HassState>) {
  const all = [...states];
  const stations = all.filter(isIq4Station).sort((a, b) => Number(a.attributes.terminal ?? 999) - Number(b.attributes.terminal ?? 999)).map((s) => s.entity_id);
  const programs = all.filter(isIq4Program).map((s) => s.entity_id);
  const prefix = stations[0]?.split('.')[1].replace(/_?(station|strefa|zone)?_?\d+$/i, '') ?? '';
  const pick = (dom: string, re: RegExp) => all.find((s) => s.entity_id.startsWith(dom + '.') && re.test(s.entity_id) && (!prefix || s.entity_id.includes(prefix.split('_')[0])))?.entity_id
    ?? all.find((s) => s.entity_id.startsWith(dom + '.') && re.test(s.entity_id))?.entity_id;
  return {
    stations, programs,
    rainDelay: pick('sensor', /rain_delay/),
    connected: pick('binary_sensor', /_connected$|_polaczon/),
    anyRunning: pick('binary_sensor', /any_zone_running/),
    mode: pick('sensor', /controller_mode|tryb_sterownika/),
    alarms: pick('sensor', /_alarms$|_alarmy$/),
    warnings: pick('sensor', /_warnings$|_ostrzezenia$/),
    rainSensor: pick('binary_sensor', /rain_sensor|czujnik_deszczu/),
    forecast: pick('binary_sensor', /forecast_rain_delay|prognoz/)
  };
}

const STATE_PL: Record<string, string> = { idle: 'bezczynna', running: 'podlewa', paused: 'pauza', unknown: '—', unavailable: 'niedostępna' };
const PROG_PL: Record<string, string> = { scheduled: 'zaplanowany', not_scheduled: 'bez harmonogramu', disabled: 'wyłączony' };
const SCHED_PL = (t?: string) => !t ? '' : t === 'weekly' ? 'co tydzień' : t === 'odd days' ? 'dni nieparzyste' : t === 'even days' ? 'dni parzyste' : t.replace(/^every (\d+) days$/, 'co $1 dni');

function leftOf(s: HassState): string {
  const ends = s.attributes.run_ends_at ? Date.parse(String(s.attributes.run_ends_at)) : NaN;
  if (isFinite(ends) && ends > Date.now()) { const t = Math.ceil((ends - Date.now()) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
  const r = s.attributes.remaining ?? s.attributes.remaining_seconds;
  if (r == null || r === '' || r === 0 || r === '0') return '';
  if (typeof r === 'number') { const t = Math.round(r); return t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t} s`; }
  return String(r);
}
/** "ostatnio wt 06:00" from the station's last_run */
function lastRun(v: unknown) {
  if (!v) return '';
  const d = new Date(String(v)); if (isNaN(+d) || d.getFullYear() < 2000) return '';
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(+d).setHours(0, 0, 0, 0)) / 86400000);
  const t = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return 'ostatnio ' + (days === 0 ? 'dziś ' + t : days === 1 ? 'wczoraj ' + t : days < 7 ? d.toLocaleDateString('pl-PL', { weekday: 'short' }) + ' ' + t : d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' }));
}
const cleanName = (name: string, controller?: string) => (controller ? name.replace(new RegExp('^' + controller.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '') : name).replace(/^station\s*/i, 'Strefa ');

export const IrrigationWidget: FC<{ w: WidgetDef; notify?(m: string): void }> = ({ w, notify }) => {
  const o = w.options ?? {};
  const stations: string[] = Array.isArray(o.stations) ? o.stations : [];
  const programs: string[] = o.programs === false ? [] : Array.isArray(o.programs) ? o.programs : [];
  const st = useEntities(stations);
  const pr = useEntities(programs);
  const delay = useEntity(o.rainDelay);
  const conn = useEntity(o.connected);
  const [mode, alarms, warns, rainS, fc] = useEntities([o.mode ?? '', o.alarms ?? '', o.warnings ?? '', o.rainSensor ?? '', o.forecast ?? '']);
  const nAlarms = Number(alarms?.state) || 0, nWarns = Number(warns?.state) || 0;
  const [dur, setDur] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<Record<string, 'start' | 'stop'>>({});
  const [, tick] = useState(0);
  const running = st.some((s) => s?.state === 'running');
  useEffect(() => { if (!running) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [running]);
  useEffect(() => { // clear "starting…/stopping…" once the controller confirms (or after 90 s)
    const t = setTimeout(() => setBusy({}), 90_000); return () => clearTimeout(t);
  }, [busy]);

  const def = Math.max(1, Math.min(100, Number(o.duration) || 10));
  const call = (service: string, data: Record<string, unknown>) => hass.call('rainbird_iq4', service, data).catch((e: Error) => { notify?.(e.message); setBusy({}); });
  const controllerName = conn?.attributes.friendly_name ? String(conn.attributes.friendly_name).replace(/\s*(connected|połączon\w*)$/i, '') : undefined;
  const title = w.title || controllerName || 'Nawadnianie';
  const days = Number(delay?.state) || 0;

  if (!stations.length) return <div className="ir ir-empty"><Icon name="mdi:sprinkler-variant" size={28} /><span>Wskaż strefy Rain Bird IQ4 w ustawieniach (przycisk „Wykryj”)</span></div>;

  return (
    <div className="ir" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ir-head">
        <Icon name="mdi:sprinkler-variant" size={20} />
        <b>{title}</b>
        {conn && <span className={'ir-dot ' + (conn.state === 'on' ? 'ok' : 'bad')} title={conn.state === 'on' ? 'połączony z chmurą IQ4' : 'brak połączenia z chmurą IQ4'} />}
        {nAlarms > 0 && <span className="ir-chip err" title="Nieodczytane alarmy sterownika (aplikacja Rain Bird IQ4)"><Icon name="mdi:alert" size={14} />{nAlarms}</span>}
        {nWarns > 0 && <span className="ir-chip warn" title="Nieodczytane ostrzeżenia sterownika"><Icon name="mdi:alert-outline" size={14} />{nWarns}</span>}
        {running && o.controller !== '' && (
          <button className="ir-stopall" onClick={() => { call('stop_all_zones', o.connected ? { controller_entity: o.connected } : {}); }}>
            <Icon name="stop" size={16} /> Zatrzymaj wszystko
          </button>
        )}
      </div>

      {mode?.state === 'off' && <div className="ir-off"><Icon name="mdi:power-off" size={16} /> Sterownik wyłączony (tryb Off) – programy nie ruszą. Włączysz go w aplikacji Rain Bird.</div>}
      {o.rainDelay && delay && (
        <div className={'ir-delay' + (days > 0 ? ' on' : '')}>
          <Icon name="mdi:weather-rainy" size={18} />
          <span>{days > 0 ? `Opóźnienie deszczowe: ${days} ${days === 1 ? 'dzień' : 'dni'}` : 'Bez opóźnienia deszczowego'}
            {(rainS?.state === 'on' || fc?.state === 'on') && <small>{[rainS?.state === 'on' ? 'czujnik deszczu: mokro' : '', fc?.state === 'on' ? 'opóźnienie wg prognozy włączone' : ''].filter(Boolean).join(' · ')}</small>}</span>
          {o.delayButtons !== false && <div className="ir-delay-b">
            {[0, 1, 2, 3, 7].map((d) => (
              <button key={d} aria-pressed={days === d} onClick={() => call('set_rain_delay', { days: d, ...(o.connected ? { controller_entity: o.connected } : {}) })}>{d === 0 ? 'brak' : d + ' d'}</button>
            ))}
          </div>}
        </div>
      )}

      <div className="ir-list">
        {st.map((s, i) => {
          const id = stations[i];
          if (!s) return <div key={id} className="ir-st miss">Brak encji {id}</div>;
          const run = s.state === 'running', paused = s.state === 'paused';
          const b = busy[id];
          const d = dur[id] ?? def;
          const left = run ? leftOf(s) : '';
          const name = cleanName(String(s.attributes.friendly_name ?? id), controllerName);
          return (
            <div key={id} className={'ir-st' + (run ? ' run' : '') + (paused ? ' paused' : '') + (s.attributes.is_active === false ? ' inactive' : '')}>
              <span className="ir-term">{s.attributes.terminal ?? '–'}</span>
              <div className="ir-name"><b>{name}</b>
                <small>{b === 'start' && !run ? 'uruchamiam…' : b === 'stop' && run ? 'zatrzymuję…' : run ? (left ? `podlewa · zostało ${left}` : 'podlewa') : (s.state === 'idle' && lastRun(s.attributes.last_run)) || (STATE_PL[s.state] ?? s.state)}</small>
              </div>
              {!run && !paused && (
                <div className="ir-dur">
                  <button onClick={() => setDur({ ...dur, [id]: Math.max(1, d - (d > 10 ? 5 : 1)) })} aria-label="Krócej">−</button>
                  <span>{d} min</span>
                  <button onClick={() => setDur({ ...dur, [id]: Math.min(100, d + (d >= 10 ? 5 : 1)) })} aria-label="Dłużej">+</button>
                </div>
              )}
              {run || paused
                ? <button className="ir-go stop" disabled={b === 'stop'} onClick={() => { setBusy({ ...busy, [id]: 'stop' }); call('stop_zone', { station_entity: id }); }}><Icon name="stop" size={18} /> Stop</button>
                : <button className="ir-go" disabled={b === 'start'} onClick={() => { setBusy({ ...busy, [id]: 'start' }); call('start_zone', { station_entity: id, duration: d }); }}><Icon name="mdi:play" size={18} /> Start</button>}
            </div>
          );
        })}
      </div>

      {programs.length > 0 && (
        <div className="ir-progs">
          {pr.map((p, i) => {
            if (!p) return null;
            if (o.hideInactivePrograms && p.state !== 'scheduled') return null;
            const a = p.attributes;
            const next = a.next_run ? new Date(String(a.next_run)) : null;
            return (
              <div key={programs[i]} className="ir-pr">
                <div className="ir-name"><b>{String(a.friendly_name ?? programs[i]).replace(controllerName ?? '\u0000', '').replace(/\s*status$/i, '').trim()}</b>
                  <small>{[PROG_PL[p.state] ?? p.state, SCHED_PL(a.schedule_type as string), a.start_time ? 'start ' + String(a.start_time).slice(0, 5) : '',
                    next && !isNaN(+next) ? 'następne ' + next.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'numeric' }) : ''].filter(Boolean).join(' · ')}</small>
                </div>
                <button className="ir-go" onClick={() => call('start_program', { program_entity: programs[i] })}><Icon name="mdi:play" size={18} /> Uruchom</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
