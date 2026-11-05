// Robot widget: robot mower (lawn_mower.* – Segway Navimow, Husqvarna, Worx…) and robot vacuum (vacuum.* – Dyson 360 / Vis Nav via hass-dyson, Roborock…).
// Status, battery, start / pause / dock, vacuum suction power, plus any extra entities of the device (room buttons, cutting height, blade time…).
import { useEffect, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import type { HassState, PanelRow, WidgetDef } from '../../../shared/types';
import { friendly } from '../lib/format';
import { api } from '../lib/api';
import { keyQuery } from '../lib/boot';
import { hass, useEntities, useEntity } from '../lib/hass';
import { Icon } from '../ui/Icon';
import { PanelRowView } from '../view/PanelRows';

const STATE_PL: Record<string, string> = {
  mowing: 'Kosi', cleaning: 'Sprząta', docked: 'W bazie', charging: 'Ładuje się', idle: 'Gotowy', paused: 'Wstrzymany',
  returning: 'Wraca do bazy', error: 'Błąd', unavailable: 'Niedostępny', unknown: 'Brak danych', off: 'Wyłączony', on: 'Włączony'
};
const STATUS_PL: Record<string, string> = {
  charging: 'ładuje się', charged: 'naładowany', 'fully charged': 'naładowany', 'full charged': 'naładowany', idle: 'gotowy', standby: 'czuwa', sleeping: 'uśpiony',
  'going home': 'wraca', 'returning to dock': 'wraca', 'mapping': 'mapuje', 'rain delay': 'przerwa – deszcz', raining: 'przerwa – deszcz', 'scheduled': 'zaplanowany'
};
/** hass-dyson dock states (firmware vocabulary, only partly known) */
const DOCK_PL: Record<string, string> = { drying_mop: 'suszy mop', drying: 'suszy', washing_mop: 'pierze mop', washing: 'pierze', emptying: 'opróżnia pojemnik', emptying_bin: 'opróżnia pojemnik', charging: 'ładuje', idle: 'gotowa', refilling: 'uzupełnia wodę', draining: 'spuszcza wodę' };
const dockPl = (v: string) => DOCK_PL[v.toLowerCase()] ?? v.toLowerCase().replace(/_/g, ' ');
const MODES: [string, string][] = [['', 'Tryb: jak w ustawieniach pokoju'], ['vacuum_only', 'Odkurzanie'], ['vacuum_and_mop', 'Odkurz. + mop'], ['mop_only', 'Tylko mop'], ['vacuum_then_mop', 'Najpierw odkurz., potem mop']];
/** per-room settings of hass-dyson (Spot+Scrub): select entities, options as the integration names them */
type Room = { id: string; name: string; /** shown instead of the MyDyson name */ label?: string; mode?: string; power?: string; water?: string; wash?: string };
const ROOM_SET: [keyof Room, string, Record<string, string>][] = [
  ['mode', 'Tryb', { vacuum_only: 'Odkurzanie', vacuum_and_mop: 'Odkurzanie + mop', mop_only: 'Tylko mop', vacuum_then_mop: 'Najpierw odkurzanie, potem mop' }],
  ['power', 'Moc', { auto: 'Auto', boost: 'Boost', quiet: 'Cicho', quick: 'Szybko' }],
  ['water', 'Woda (mop)', { very_low: 'Bardzo mało', low: 'Mało', medium: 'Średnio', high: 'Dużo' }],
  ['wash', 'Mycie mopa', { '1x': '1 raz', '2x': '2 razy' }]
];
const MODE_SHORT: Record<string, string> = { vacuum_only: 'odkurzanie', vacuum_and_mop: 'odkurz. + mop', mop_only: 'mop', vacuum_then_mop: 'odkurz. → mop' };
/** icons of a cleaning mode: vacuum and / or mop */
const ModeIcons: FC<{ m?: string }> = ({ m }) => !m || !MODE_SHORT[m] ? null : (
  <span className="rb-mi" title={MODE_SHORT[m]}>
    {m !== 'mop_only' && <Icon name="mdi:vacuum-outline" size={14} />}
    {m === 'vacuum_then_mop' && <i>→</i>}
    {m !== 'vacuum_only' && <Icon name="mdi:water-outline" size={14} />}
    <small>{MODE_SHORT[m]}</small>
  </span>
);
const valid = (x?: HassState) => !!x && !['unknown', 'unavailable', 'none', ''].includes(String(x.state).toLowerCase());
const hhmm = (iso: string) => { const d = new Date(iso); return isNaN(+d) || d.getTime() < Date.now() ? '' : d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); };
const statusPl = (v: unknown) => { const t = String(v ?? '').trim(); return STATUS_PL[t.toLowerCase().replace(/_/g, ' ')] ?? t; };
const ACTIVE = new Set(['mowing', 'cleaning', 'returning']);
// supported_features bits
const VAC = { PAUSE: 4, STOP: 8, RETURN: 16, FAN: 32, LOCATE: 512, START: 8192 };
const MOW = { START: 1, PAUSE: 2, DOCK: 4 };

export const isRobot = (e?: string) => !!e && /^(vacuum|lawn_mower)\./.test(e);

/** Battery %: dedicated sensor (HA 2025.8+ moved it out of the vacuum) or the old battery_level attribute. */
function batteryOf(main: HassState, sensor?: HassState): number | undefined {
  const v = sensor ? Number(sensor.state) : Number(main.attributes.battery_level);
  return isFinite(v) && (sensor ? sensor.state !== '' : main.attributes.battery_level != null) ? Math.round(v) : undefined;
}
const batIcon = (b: number, charging: boolean) => charging ? 'mdi:battery-charging' : b >= 95 ? 'mdi:battery' : b < 10 ? 'mdi:battery-outline' : `mdi:battery-${Math.floor(b / 10) * 10}`;

export const RobotWidget: FC<{ w: WidgetDef; notify?(m: string): void }> = ({ w, notify }) => {
  const o = w.options ?? {};
  const s = useEntity(w.entity);
  const [bat, err, room, dock, dockTimer] = useEntities([o.battery ?? '', o.error ?? '', o.room ?? '', o.dock ?? '', o.dockTimer ?? '']);
  const rooms: Room[] = Array.isArray(o.rooms) ? o.rooms.filter((r: any) => r && (r.name || r.id)) : [];
  const roomModes = useEntities(rooms.map((r) => r.mode ?? ''));
  const [roomCfg, setRoomCfg] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [mode, setMode] = useState('');
  const [map, setMap] = useState(false);
  const extras: string[] = Array.isArray(o.extras) ? o.extras : [];
  useEntities(extras);
  if (!s) return <div className="rb rb-empty"><Icon name="mdi:robot-mower-outline" size={30} /><span>{w.entity ? 'Brak encji ' + w.entity : 'Wybierz kosiarkę lub odkurzacz („Wykryj urządzenie”)'}</span></div>;

  const mower = s.entity_id.startsWith('lawn_mower.');
  const a = s.attributes, f = Number(a.supported_features);
  const has = (bit: number) => !isFinite(f) || (f & bit) === bit;
  const st = s.state;
  const charging = st === 'charging' || /charg|ładuj/i.test(String(a.status ?? '')) || bat?.attributes.charging === true;
  const battery = batteryOf(s, bat);
  const active = ACTIVE.has(st);
  const errorText = st === 'error' ? String(err?.state && !['unknown', 'unavailable', 'none', ''].includes(err.state) ? err.state : a.error ?? a.status ?? '') : '';
  const statusText = (mower ? (st === 'paused' ? 'Wstrzymana' : st === 'idle' ? 'Gotowa' : STATE_PL[st]) : STATE_PL[st]) ?? (a.status ? String(a.status) : st);
  const sub = !errorText && a.status && String(a.status).toLowerCase() !== st ? statusPl(a.status) : '';
  const roomName = valid(room) ? String(room!.state) : '';
  const dockText = valid(dock) ? dockPl(String(dock!.state)) + (valid(dockTimer) && hhmm(dockTimer!.state) ? ' do ' + hhmm(dockTimer!.state) : '') : '';
  const cleanRooms = async () => {
    navigator.vibrate?.(10);
    try { await api.post('robot/zone', { entity: s.entity_id, zones: pick.map((id) => rooms.find((r) => (r.id || r.name) === id)?.name || id), mode: mode || undefined }); setPick([]); }
    catch (e: any) { notify?.(e.message); }
  };

  const call = (svc: string, data?: Record<string, unknown>) => {
    navigator.vibrate?.(10);
    return hass.call(mower ? 'lawn_mower' : 'vacuum', svc, data, s.entity_id).catch((e: Error) => notify?.(e.message));
  };
  const start = () => call(mower ? 'start_mowing' : 'start');
  const canPause = mower ? has(MOW.PAUSE) : has(VAC.PAUSE);
  const canDock = mower ? has(MOW.DOCK) : has(VAC.RETURN);
  const canStop = !mower && has(VAC.STOP) && isFinite(f);
  const fanList: string[] = !mower && Array.isArray(a.fan_speed_list) ? a.fan_speed_list : [];
  const icon = w.icon || (mower ? 'mdi:robot-mower' : 'mdi:robot-vacuum');

  return (
    <div className={'rb rb-' + st + (active ? ' rb-active' : '') + (w.h <= 3 ? ' rb-compact' : '')} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
     <div className="rb-grid">
      <div className="rb-main">
      <div className="rb-head">
        <div className="rb-ico" aria-hidden><Icon name={icon} size={30} />{active && <i className="rb-pulse" />}</div>
        <div className="rb-title">
          <b>{w.title || friendly(s, s.entity_id)}</b>
          <span className="rb-state">{statusText}{roomName ? <small> · {roomName}</small> : sub ? <small> · {sub}</small> : null}</span>
          {dockText && <small className="rb-dock"><Icon name="mdi:home-import-outline" size={13} /> stacja: {dockText}</small>}
        </div>
        {battery != null && (
          <div className={'rb-bat' + (battery < 20 ? ' low' : '')} aria-label={`Bateria ${battery}%`}>
            <Icon name={batIcon(battery, charging)} size={20} /><b>{battery}%</b>
          </div>
        )}
      </div>
      {battery != null && w.h > 3 && <div className="rb-bar"><i style={{ width: battery + '%' }} className={battery < 20 ? 'low' : ''} /></div>}
      {errorText && <div className="rb-err"><Icon name="mdi:alert-circle-outline" size={16} /> {errorText}</div>}

      <div className="rb-acts">
        {active && canPause
          ? <button className="rb-b" onClick={() => call('pause')}><Icon name="mdi:pause" size={20} />Pauza</button>
          : <button className="rb-b primary" onClick={start} disabled={st === 'unavailable'}><Icon name="mdi:play" size={20} />{st === 'paused' ? 'Wznów' : mower ? 'Koś' : 'Sprzątaj'}</button>}
        {canDock && <button className="rb-b" onClick={() => call(mower ? 'dock' : 'return_to_base')} disabled={st === 'docked' || st === 'returning'}><Icon name="mdi:home-import-outline" size={20} />Do bazy</button>}
        {canStop && active && <button className="rb-b" onClick={() => call('stop')}><Icon name="stop" size={20} />Stop</button>}
        {o.coverage && <button className="rb-b ghost" onClick={() => setMap(true)} aria-label="Mapa sprzątania" title="Mapa sprzątania"><Icon name="mdi:map-outline" size={20} /></button>}
        {!mower && isFinite(f) && has(VAC.LOCATE) && w.w >= 5 && <button className="rb-b ghost" onClick={() => call('locate')} aria-label="Znajdź odkurzacz"><Icon name="mdi:map-marker-radius-outline" size={20} /></button>}
      </div>

      {fanList.length > 0 && w.h > 3 && (
        <div className="rb-fan" role="group" aria-label="Moc ssania">
          {fanList.map((x) => <button key={x} aria-pressed={a.fan_speed === x} onClick={() => call('set_fan_speed', { fan_speed: x })}>{x}</button>)}
        </div>
      )}
      </div>

      {!mower && rooms.length > 0 && w.h > 4 && (
        <div className="rb-rooms">
          <div className="rb-rooms-h">
            <b>Pokoje</b>
            <small>{pick.length ? `wybrano ${pick.length}` : 'dotknij, aby wybrać'}</small>
            <span className="grow" />
            <button className="rb-lnk" onClick={() => setPick(pick.length === rooms.length ? [] : rooms.map((r) => r.id || r.name))}>{pick.length === rooms.length ? 'Żaden' : 'Wszystkie'}</button>
            {rooms.some((r) => r.mode || r.power || r.water || r.wash) && <button className="rb-cfg" onClick={() => setRoomCfg(true)} aria-label="Ustawienia pokoi" title="Ustawienia pokoi: tryb, moc, woda, mycie"><Icon name="mdi:tune-variant" size={18} /></button>}
          </div>
          <div className="rb-room-list" role="group" aria-label="Pokoje">
            {rooms.map((r, i) => { const k = r.id || r.name; const on = pick.includes(k); const here = !!roomName && r.name === roomName; return (
              <button key={k} aria-pressed={on} className={here ? 'here' : ''} onClick={() => setPick(on ? pick.filter((x) => x !== k) : [...pick, k])}>
                <span className="rb-rn">{r.label || r.name || 'pokój ' + r.id}</span>
                <ModeIcons m={roomModes[i]?.state} />
                {here && <i className="rb-here" title="Robot jest w tym pokoju" />}
                {on && <span className="rb-ck"><Icon name="mdi:check-circle" size={16} /></span>}
              </button>); })}
          </div>
          {pick.length > 0 && <div className="rb-go">
            <select className="rb-mode" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Tryb sprzątania">{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button className="rb-b primary" onClick={cleanRooms} disabled={active}><Icon name="mdi:broom" size={18} />Sprzątaj ({pick.length})</button>
          </div>}
        </div>
      )}
     </div>

      {extras.length > 0 && w.h > 4 && (
        <div className="rb-rows">{extras.map((e) => {
          const es = hass.states.get(e); const full = friendly(es, e);
          const t = (w.title || friendly(s, s.entity_id)).toLowerCase();
          const name = full.toLowerCase().startsWith(t + ' ') ? full.slice(t.length + 1) : full;
          return <PanelRowView key={e} row={{ entity: e, name: name.charAt(0).toUpperCase() + name.slice(1) } as PanelRow} onError={(m) => notify?.(m)} />;
        })}</div>
      )}
      {roomCfg && <RoomSettings rooms={rooms} busy={active} title={w.title || friendly(s, s.entity_id)} onClose={() => setRoomCfg(false)} notify={notify} />}
      {map && o.coverage && <RobotMap entity={o.coverage} title={(w.title || friendly(s, s.entity_id)) + (roomName ? ' · ' + roomName : '')} live={active} onClose={() => setMap(false)} />}
    </div>
  );
};

/** per-room settings (hass-dyson writes them only while the robot is docked) */
const RoomSettings: FC<{ rooms: Room[]; busy: boolean; title: string; onClose(): void; notify?: (m: string) => void }> = ({ rooms, busy, title, onClose, notify }) => {
  const ids = rooms.flatMap((r) => ROOM_SET.map(([k]) => (r[k] as string | undefined) ?? ''));
  const st = useEntities(ids);
  return createPortal(
    <div className="rb-map" onClick={onClose} role="dialog" aria-label="Ustawienia pokoi">
      <div className="rb-map-box rb-rcfg" onClick={(e) => e.stopPropagation()}>
        <div className="rb-map-h"><b>{title} · pokoje</b><button className="rb-b ghost" onClick={onClose} aria-label="Zamknij"><Icon name="close" size={20} /></button></div>
        {busy && <small className="rb-warn">Robot sprząta – ustawienia pokoi da się zmienić dopiero, gdy wróci do stacji.</small>}
        <div className="rb-rcfg-list">
          {rooms.map((r, ri) => (
            <div key={r.id || r.name} className="rb-rcfg-row">
              <b>{r.label || r.name}</b>
              {ROOM_SET.map(([k, label, opts], si) => {
                const ent = r[k] as string | undefined; if (!ent) return null;
                const x = st[ri * ROOM_SET.length + si];
                const options = (x?.attributes.options as string[] | undefined) ?? Object.keys(opts);
                return (
                  <label key={k}><span>{label}</span>
                    <select value={x?.state ?? ''} disabled={busy || !x || x.state === 'unavailable'}
                      onChange={(e) => hass.call('select', 'select_option', { option: e.target.value }, ent).catch((er: Error) => notify?.(er.message))}>
                      {!options.includes(x?.state ?? '') && <option value={x?.state ?? ''}>—</option>}
                      {options.map((v) => <option key={v} value={v}>{opts[v] ?? v}</option>)}
                    </select></label>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>, document.body
  );
};

/** coverage / map image of the robot (image.* or camera.* through the add-on), refreshed while it cleans */
const RobotMap: FC<{ entity: string; title: string; live: boolean; onClose(): void }> = ({ entity, title, live, onClose }) => {
  const [t, setT] = useState(() => Date.now());
  const pic = useEntity(entity);
  useEffect(() => { if (!live) return; const x = setInterval(() => setT(Date.now()), 10_000); return () => clearInterval(x); }, [live]);
  const src = (entity.startsWith('camera.') ? 'api/camera/' : 'api/media/') + encodeURIComponent(entity) + (entity.startsWith('camera.') ? '' : '/art') + keyQuery('t=' + t + '-' + (pic?.last_updated ?? ''));
  // portal: a tile with backdrop-filter would clip a position: fixed overlay
  return createPortal(
    <div className="rb-map" onClick={onClose} role="dialog" aria-label="Mapa sprzątania">
      <div className="rb-map-box" onClick={(e) => e.stopPropagation()}>
        <div className="rb-map-h"><b>{title}</b><button className="rb-b ghost" onClick={onClose} aria-label="Zamknij"><Icon name="close" size={20} /></button></div>
        <img src={src} alt="Mapa sprzątania" />
        {live && <small>odświeża się co 10 s</small>}
      </div>
    </div>, document.body
  );
};
