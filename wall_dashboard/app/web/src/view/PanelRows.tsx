import { useEffect, useRef, useState, type FC } from 'react';
import type { HassState, PanelRow, RowDisplay } from '../../../shared/types';
import { api, historyPath } from '../lib/api';
import { hass, useEntity } from '../lib/hass';
import { domainOf, formatNumber, friendly, isActive, stateLabel } from '../lib/format';
import { toggleEntity } from '../lib/actions';
import { Icon, iconFor } from '../ui/Icon';
import { CameraView } from '../widgets/widgets';
import { Levels } from '../widgets/levels';

/** Picks a presentation for an entity when the row says 'auto'. */
export function autoDisplay(s: HassState | undefined, entity: string): RowDisplay {
  const d = domainOf(entity);
  switch (d) {
    case 'light': {
      const modes: string[] = s?.attributes.supported_color_modes || [];
      return modes.length && !(modes.length === 1 && modes[0] === 'onoff') ? 'slider' : 'toggle';
    }
    case 'switch': case 'input_boolean': case 'fan': case 'siren': return 'toggle';
    case 'cover': case 'lock': case 'climate': case 'media_player': case 'scene': case 'script':
    case 'button': case 'input_button': case 'vacuum': case 'select': case 'input_select': return 'buttons';
    case 'input_number': case 'number': return 'slider';
    case 'camera': return 'camera';
    case 'sensor': return s && isFinite(Number(s.state)) ? 'graph' : 'value';
    default: return 'value';
  }
}

export const PanelRowView: FC<{ row: PanelRow; onError(msg: string): void }> = ({ row, onError }) => {
  const s = useEntity(row.entity);
  const display = !row.display || row.display === 'auto' ? autoDisplay(s, row.entity) : row.display;
  const name = row.name || friendly(s, row.entity);
  const run = (p: Promise<void>) => p.catch((e) => onError(e.message));

  if (display === 'camera') {
    return <div className="p-row p-cam">{s ? <CameraView entity={row.entity} talk={row.talk} refresh={2} /> : <Missing id={row.entity} />}{row.name && <span className="p-cam-name">{row.name}</span>}</div>;
  }
  if (display === 'graph') return <GraphRow row={row} name={name} s={s} />;

  return (
    <div className={'p-row' + (isActive(s) ? ' is-on' : '')}>
      <span className="p-ic"><Icon name={iconFor(row.entity, row.icon)} /></span>
      <div className="p-txt">
        <div className="p-name">{name}</div>
        <div className="p-state">{!s ? 'brak encji ' + row.entity : row.attribute ? String(s.attributes[row.attribute] ?? '—') : stateLabel(s)}</div>
        {display === 'slider' && s && <Slider s={s} onError={onError} />}
        {display === 'buttons' && s && <Buttons s={s} run={run} />}
        {display === 'levels' && s && <Levels entity={row.entity} off={domainOf(row.entity) === 'fan'} compact onError={onError} />}
        {s && domainOf(row.entity) === 'light' && !row.noExtras && <LightExtras s={s} run={run} />}
      </div>
      {(display === 'toggle' || (display === 'slider' && ['light', 'fan'].includes(domainOf(row.entity)))) && s && (
        <button className="p-switch" role="switch" aria-checked={isActive(s)} aria-label={name}
          onClick={() => run(toggleEntity(row.entity))}><span /></button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- light: effects, colours, white temperature
const COLOR_MODES = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
const SWATCHES: [string, [number, number, number]][] = [
  ['Ciepła biel', [255, 197, 120]], ['Pomarańcz', [255, 120, 30]], ['Czerwień', [255, 40, 40]], ['Róż', [255, 80, 160]],
  ['Fiolet', [150, 70, 255]], ['Niebieski', [40, 90, 255]], ['Turkus', [0, 210, 200]], ['Zieleń', [40, 220, 80]]
];

export const LightExtras: FC<{ s: HassState; run(p: Promise<void>): void }> = ({ s, run }) => {
  const a = s.attributes;
  const modes: string[] = a.supported_color_modes ?? [];
  const effects: string[] = Array.isArray(a.effect_list) ? a.effect_list.filter((e: unknown) => typeof e === 'string' && e && e.toLowerCase() !== 'none') : [];
  const hasColor = modes.some((m) => COLOR_MODES.includes(m));
  const hasTemp = modes.includes('color_temp');
  const minK = Number(a.min_color_temp_kelvin ?? 2200), maxK = Number(a.max_color_temp_kelvin ?? 6500);
  const curK = Number(a.color_temp_kelvin ?? 0);
  const [k, setK] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  if (!effects.length && !hasColor && !hasTemp) return null;
  const on = (data: Record<string, unknown>) => run(hass.call('light', 'turn_on', data, s.entity_id));
  const rgb = Array.isArray(a.rgb_color) ? (a.rgb_color as number[]) : null;
  const near = (c: [number, number, number]) => !!rgb && a.color_mode !== 'color_temp' && Math.hypot(c[0] - rgb[0], c[1] - rgb[1], c[2] - rgb[2]) < 60;
  const shown = more ? effects : effects.slice(0, 8);
  return (
    <div className="lx" onClick={(e) => e.stopPropagation()}>
      {hasTemp && (
        <label className="lx-temp" aria-label="Barwa bieli">
          <input type="range" min={minK} max={maxK} step={50} value={k ?? (curK || Math.round((minK + maxK) / 2))}
            onChange={(e) => setK(Number(e.target.value))}
            onPointerUp={() => { if (k != null) { on({ color_temp_kelvin: k }); setTimeout(() => setK(null), 1500); } }}
            onKeyUp={() => { if (k != null) { on({ color_temp_kelvin: k }); setTimeout(() => setK(null), 1500); } }} />
          <span>{k ?? curK ? (k ?? curK) + ' K' : 'barwa'}</span>
        </label>
      )}
      {hasColor && (
        <div className="lx-sw" role="group" aria-label="Kolor">
          {SWATCHES.map(([n, c]) => (
            <button key={n} title={n} aria-label={n} aria-pressed={near(c)} style={{ background: `rgb(${c.join(',')})` }} onClick={() => on({ rgb_color: c })} />
          ))}
          <label className="lx-pick" title="Dowolny kolor">
            <input type="color" aria-label="Dowolny kolor" value={rgb ? '#' + rgb.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('') : '#ffc578'}
              onChange={(e) => { const h = e.target.value; on({ rgb_color: [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) }); }} />
          </label>
        </div>
      )}
      {effects.length > 0 && (
        <div className="lx-fx" role="group" aria-label="Efekty">
          {a.effect && a.effect !== 'None' && <button className="lx-chip off" onClick={() => on({ effect: effects.includes('Solid') ? 'Solid' : 'None' })}>Bez efektu</button>}
          {shown.map((fx) => <button key={fx} className="lx-chip" aria-pressed={a.effect === fx} onClick={() => on({ effect: fx })}>{fx}</button>)}
          {effects.length > 8 && <button className="lx-chip more" onClick={() => setMore(!more)}>{more ? 'Mniej' : `Więcej (${effects.length})`}</button>}
        </div>
      )}
    </div>
  );
};

const Missing: FC<{ id: string }> = ({ id }) => <div className="p-state">Brak encji {id}</div>;

/** Slider for brightness / position / percentage / number / volume. Commits on release. */
const Slider: FC<{ s: HassState; onError(m: string): void }> = ({ s, onError }) => {
  const d = domainOf(s.entity_id), a = s.attributes;
  let min = 0, max = 100, step = 1, value = 0, unit = '%';
  let commit: (v: number) => Promise<void>;
  switch (d) {
    case 'light': value = s.state === 'on' ? Math.round(((a.brightness ?? 255) / 255) * 100) : 0;
      commit = (v) => v === 0 ? hass.call('light', 'turn_off', undefined, s.entity_id) : hass.call('light', 'turn_on', { brightness_pct: v }, s.entity_id); break;
    case 'cover': value = Number(a.current_position ?? (s.state === 'open' ? 100 : 0));
      commit = (v) => hass.call('cover', 'set_cover_position', { position: v }, s.entity_id); break;
    case 'fan': value = Number(a.percentage ?? 0); step = Number(a.percentage_step ?? 1);
      commit = (v) => hass.call('fan', 'set_percentage', { percentage: v }, s.entity_id); break;
    case 'media_player': value = Math.round(Number(a.volume_level ?? 0) * 100);
      commit = (v) => hass.call('media_player', 'volume_set', { volume_level: v / 100 }, s.entity_id); break;
    case 'input_number': case 'number': min = Number(a.min ?? 0); max = Number(a.max ?? 100); step = Number(a.step ?? 1);
      value = Number(s.state); unit = a.unit_of_measurement ? ' ' + a.unit_of_measurement : '';
      commit = (v) => hass.call(d, 'set_value', { value: v }, s.entity_id); break;
    default: return null;
  }
  return <SliderInput min={min} max={max} step={step} value={value} unit={unit} onCommit={(v) => commit(v).catch((e) => onError(e.message))} />;
};

const SliderInput: FC<{ min: number; max: number; step: number; value: number; unit: string; onCommit(v: number): void }> =
  ({ min, max, step, value, unit, onCommit }) => {
    const [local, setLocal] = useState(value);
    const dragging = useRef(false);
    useEffect(() => { if (!dragging.current) setLocal(value); }, [value]);
    const done = () => { if (dragging.current) { dragging.current = false; onCommit(local); } };
    return (
      <div className="p-slider">
        <input type="range" min={min} max={max} step={step} value={local}
          onPointerDown={() => { dragging.current = true; }}
          onChange={(e) => { dragging.current = true; setLocal(Number(e.target.value)); }}
          onPointerUp={done} onKeyUp={done} onBlur={done} />
        <span>{formatNumber(local, step < 1 ? 1 : 0)}{unit}</span>
      </div>
    );
  };

const Buttons: FC<{ s: HassState; run(p: Promise<void>): void }> = ({ s, run }) => {
  const id = s.entity_id, d = domainOf(id), a = s.attributes;
  const B = (icon: string, label: string, fn: () => Promise<void>, pressed?: boolean) =>
    <button className="p-btn" aria-pressed={pressed} aria-label={label} title={label} onClick={() => run(fn())}><Icon name={icon} /><span>{label}</span></button>;
  switch (d) {
    case 'cover': return <div className="p-btns">
      {B('up', 'Otwórz', () => hass.call('cover', 'open_cover', undefined, id))}
      {B('stop', 'Stop', () => hass.call('cover', 'stop_cover', undefined, id))}
      {B('down', 'Zamknij', () => hass.call('cover', 'close_cover', undefined, id))}</div>;
    case 'lock': return <div className="p-btns">
      {B('unlock', 'Otwórz', () => hass.call('lock', 'unlock', undefined, id), s.state === 'unlocked')}
      {B('lock', 'Zamknij', () => hass.call('lock', 'lock', undefined, id), s.state === 'locked')}
      {a.supported_features & 1 ? B('door', 'Uchyl', () => hass.call('lock', 'open', undefined, id)) : null}</div>;
    case 'media_player': return <div className="p-btns">
      {B('power', s.state === 'off' ? 'Włącz' : 'Wyłącz', () => hass.call('media_player', s.state === 'off' ? 'turn_on' : 'turn_off', undefined, id))}
      {B('prev', 'Poprzedni', () => hass.call('media_player', 'media_previous_track', undefined, id))}
      {B(s.state === 'playing' ? 'pause' : 'play', s.state === 'playing' ? 'Pauza' : 'Graj', () => hass.call('media_player', 'media_play_pause', undefined, id))}
      {B('next', 'Następny', () => hass.call('media_player', 'media_next_track', undefined, id))}
      {Array.isArray(a.source_list) && (
        <select className="p-select" value={a.source ?? ''} aria-label="Źródło"
          onChange={(e) => run(hass.call('media_player', 'select_source', { source: e.target.value }, id))}>
          {!a.source && <option value="">Źródło…</option>}
          {(a.source_list as string[]).map((src) => <option key={src} value={src}>{src}</option>)}
        </select>)}
    </div>;
    case 'climate': {
      const t = Number(a.temperature), step = Number(a.target_temp_step ?? 0.5);
      return <div className="p-btns">
        {isFinite(t) && <>{B('minus', 'Mniej', () => hass.call('climate', 'set_temperature', { temperature: +(t - step).toFixed(1) }, id))}
          <span className="p-val">{formatNumber(t, 1)}°</span>
          {B('plus', 'Więcej', () => hass.call('climate', 'set_temperature', { temperature: +(t + step).toFixed(1) }, id))}</>}
        {(a.hvac_modes as string[] | undefined)?.map((m) => <span key={m} style={{ display: 'contents' }}>
          {B(m === 'off' ? 'power' : m === 'cool' ? 'snow' : m === 'heat' ? 'flame' : 'fan',
            stateLabel({ ...s, state: m }), () => hass.call('climate', 'set_hvac_mode', { hvac_mode: m }, id), s.state === m)}</span>)}
      </div>;
    }
    case 'select': case 'input_select': {
      const opts: string[] = Array.isArray(a.options) ? a.options : [];
      const pick = (o: string) => hass.call(d, 'select_option', { option: o }, id);
      return opts.length <= 6
        ? <div className="p-btns">{opts.map((o) => <button key={o} className="p-btn" aria-pressed={s.state === o} onClick={() => run(pick(o))}><span>{o}</span></button>)}</div>
        : <div className="p-btns"><select className="p-select" value={s.state} aria-label="Wybierz" onChange={(e) => run(pick(e.target.value))}>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>;
    }
    case 'button': case 'input_button': return <div className="p-btns">{B('play', 'Naciśnij', () => hass.call(d, 'press', undefined, id))}</div>;
    case 'vacuum': return <div className="p-btns">
      {B('play', 'Start', () => hass.call('vacuum', 'start', undefined, id))}
      {B('pause', 'Pauza', () => hass.call('vacuum', 'pause', undefined, id))}
      {B('home', 'Do stacji', () => hass.call('vacuum', 'return_to_base', undefined, id))}</div>;
    default: return <div className="p-btns">{B('play', 'Uruchom', () => toggleEntity(id))}</div>;
  }
};

const GraphRow: FC<{ row: PanelRow; name: string; s?: HassState }> = ({ row, name, s }) => {
  const hours = row.hours ?? 24;
  const [pts, setPts] = useState<{ t: number; v: number }[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => api.get<{ t: number; v: number }[]>(historyPath(row.entity, hours))
      .then((d) => { if (alive) { setPts(d); setErr(''); } }).catch((e) => alive && setErr(e.message));
    load();
    const i = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(i); };
  }, [row.entity, hours]);
  return (
    <div className="p-row p-graph">
      <div className="p-txt">
        <div className="p-name">{name}</div>
        <div className="p-big">{stateLabel(s)}</div>
        {err ? <div className="p-state">{err}</div> : <Sparkline pts={pts} hours={hours} />}
      </div>
    </div>
  );
};

const Sparkline: FC<{ pts: { t: number; v: number }[] | null; hours: number }> = ({ pts, hours }) => {
  if (!pts) return <div className="p-state">Ładowanie historii…</div>;
  if (pts.length < 2) return <div className="p-state">Za mało danych z {hours} h</div>;
  const W = 300, H = 80, P = 4;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const X = (t: number) => P + ((t - t0) / (t1 - t0)) * (W - 2 * P);
  const Y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <div className="p-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Wykres z ostatnich ${hours} h`}>
        <path d={`${line} L${X(last.t)},${H - P} L${X(t0)},${H - P} Z`} fill="var(--accent)" opacity="0.14" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={X(last.t)} cy={Y(last.v)} r="3" fill="var(--accent)" />
      </svg>
      <div className="p-spark-axis"><span>{formatNumber(lo)}</span><span>{hours} h</span><span>{formatNumber(hi)}</span></div>
    </div>
  );
};
