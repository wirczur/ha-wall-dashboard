// Simple Timer (github.com/ArikShemesh/ha-simple-timer): countdown for a switch / light / fan / climate,
// preset buttons, extend, cancel, delayed start, schedule and daily usage – driven by the integration's sensor.
import { useEffect, useState, type FC } from 'react';
import type { HassState, WidgetDef } from '../../../shared/types';
import { hass, useEntity } from '../lib/hass';
import { Icon } from '../ui/Icon';

/** "15" → 15 min, "30s", "1.5h", "2d" → { duration, unit } as the integration expects */
export function parsePreset(p: string | number): { duration: number; unit: string; label: string } | null {
  const m = String(p).trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(s|sec|m|min|h|hr|d|day)?$/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const u = m[2] ?? 'min';
  const unit = u.startsWith('s') ? 's' : u.startsWith('h') ? 'h' : u.startsWith('d') ? 'd' : 'min';
  const label = unit === 'min' ? (n >= 60 && n % 60 === 0 ? `${n / 60} h` : `${n} min`) : unit === 's' ? `${n} s` : unit === 'h' ? `${n} h` : `${n} d`;
  return { duration: n, unit, label };
}

const fmtLeft = (sec: number) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const fmtUsage = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};
export const isSimpleTimer = (s?: HassState) => !!s && s.entity_id.startsWith('sensor.') && 'timer_state' in s.attributes && 'entry_id' in s.attributes;

export const TimerWidget: FC<{ w: WidgetDef; notify?(m: string): void }> = ({ w, notify }) => {
  const s = useEntity(w.entity);
  const o = w.options ?? {};
  const [, tick] = useState(0);
  const [sched, setSched] = useState(false);
  const [at, setAt] = useState('18:00');
  const [schedDur, setSchedDur] = useState('30');
  const active = s?.attributes.timer_state === 'active';
  useEffect(() => { if (!active) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [active]);

  if (!s) return <div className="tm tm-empty"><Icon name="mdi:timer-outline" size={26} /><span>{w.entity ? 'Brak encji ' + w.entity : 'Wybierz sensor Simple Timer'}</span></div>;
  if (!isSimpleTimer(s)) return <div className="tm tm-empty">To nie jest sensor Simple Timer (brak atrybutu timer_state)</div>;

  const a = s.attributes;
  const call = (service: string, data: Record<string, unknown> = {}) =>
    hass.call('simple_timer', service, { entity_id: s.entity_id, ...data }).catch((e: Error) => notify?.(e.message));
  const presets = ((Array.isArray(o.presets) && o.presets.length ? o.presets : [15, 30, 60, 90, 120]) as (string | number)[])
    .map(parsePreset).filter(Boolean) as NonNullable<ReturnType<typeof parsePreset>>[];
  const reverse = !!a.reverse_mode;
  const deviceOn = typeof a.device_active === 'boolean' ? a.device_active : undefined;
  const ends = a.timer_finishes_at ? Date.parse(String(a.timer_finishes_at)) : NaN;
  const left = active ? (isFinite(ends) ? (ends - Date.now()) / 1000 : Number(a.timer_remaining) || 0) : 0;
  const total = Number(a.timer_duration) * 60 || 0;
  const pct = active && total > 0 ? Math.max(0, Math.min(100, ((total - left) / total) * 100)) : 0;
  const usage = Number(s.state) || 0;
  const armed = a.schedule_state === 'armed' && a.scheduled_start;
  const title = w.title || String(a.instance_title || s.attributes.friendly_name || 'Timer');
  const compact = w.h <= 3;

  const start = (p: { duration: number; unit: string }) => {
    navigator.vibrate?.(10);
    if (active && o.extend !== false) return call('add_timer', { duration: p.duration, unit: p.unit });
    return call('start_timer', { duration: p.duration, unit: p.unit, ...(o.reverse ? { reverse_mode: true } : {}) });
  };
  const power = () => call('manual_power_toggle', { action: deviceOn ? 'turn_off' : 'turn_on' });

  return (
    <div className={'tm' + (active ? ' tm-on' : '') + (compact ? ' tm-compact' : '')} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="tm-head">
        <button className={'tm-pow' + (deviceOn ? ' on' : '')} onClick={power} aria-label={deviceOn ? 'Wyłącz urządzenie' : 'Włącz urządzenie'}>
          <Icon name={w.icon || 'mdi:timer-outline'} size={20} />
        </button>
        <div className="tm-title"><b>{title}</b>
          <small>{deviceOn === undefined ? '' : deviceOn ? 'włączone' : 'wyłączone'}{o.usage !== false ? ` · dziś ${fmtUsage(usage)}` : ''}</small></div>
        {active && <button className="tm-stop" onClick={() => call('cancel_timer', { turn_off_entity: o.turnOffOnCancel !== false })} aria-label="Zatrzymaj timer"><Icon name="stop" size={18} /> Stop</button>}
      </div>

      {active && compact ? (
        <div className="tm-inline"><b>{fmtLeft(left)}</b><small>{reverse ? 'do włączenia' : 'do wyłączenia'}</small><div className="tm-bar"><i style={{ width: pct + '%' }} /></div></div>
      ) : active ? (
        <div className="tm-count">
          <span className="tm-left">{fmtLeft(left)}</span>
          <small>{reverse ? 'do włączenia' : 'do wyłączenia'}</small>
          <div className="tm-bar"><i style={{ width: pct + '%' }} /></div>
        </div>
      ) : !compact && (
        <div className="tm-idle">{reverse || o.reverse ? 'Wybierz, za ile włączyć' : 'Wybierz czas pracy'}</div>
      )}

      <div className="tm-presets">
        {presets.map((p, i) => <button key={i} onClick={() => start(p)}>{active && o.extend !== false ? '+' : ''}{p.label}</button>)}
      </div>

      {o.schedule && !compact && (
        armed ? (
          <div className="tm-sched on">
            <Icon name="calendar" size={16} />
            <span>Start {new Date(String(a.scheduled_start)).toLocaleString('pl-PL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {a.scheduled_duration} {a.scheduled_unit === 'min' ? 'min' : a.scheduled_unit}{a.schedule_repeat ? ' · powtarzany' : ''}</span>
            <button onClick={() => call('cancel_schedule')} aria-label="Anuluj harmonogram">×</button>
          </div>
        ) : sched ? (
          <div className="tm-sched">
            <input type="time" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Godzina startu" />
            <input type="number" min={1} max={1000} value={schedDur} onChange={(e) => setSchedDur(e.target.value)} aria-label="Czas w minutach" /><span>min</span>
            <button className="primary" onClick={() => { call('schedule_timer', { start_time: at + ':00', duration: Number(schedDur) || 30, unit: 'min' }); setSched(false); }}>Zaplanuj</button>
            <button onClick={() => setSched(false)} aria-label="Anuluj">×</button>
          </div>
        ) : <button className="tm-sched-open" onClick={() => setSched(true)}><Icon name="calendar" size={16} /> Zaplanuj start</button>
      )}
      {a.watchdog_message && <div className="tm-warn">{String(a.watchdog_message)}</div>}
    </div>
  );
};
