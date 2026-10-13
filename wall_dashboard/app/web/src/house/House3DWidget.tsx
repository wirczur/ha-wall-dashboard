import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import type { ActionDef, HouseDef, HouseDevice, PanelDef, RoomDef, WidgetDef } from '../../../shared/types';
import { runAction, toggleEntity, type ActionCtx } from '../lib/actions';
import { formatNumber } from '../lib/format';
import { hass } from '../lib/hass';
import { HouseScene, type MoveEvent, type Pick, type SceneOpts } from './HouseScene';
import { useHouse } from './houseStore';
import { climatePanelWidget, roomAction, roomTemperature } from '../widgets/climate';

/** Default panel for a room: climate, temperature history, humidity, light. */
export function roomPanel(r: RoomDef, house?: HouseDef, level?: number): PanelDef {
  const rows: PanelDef['rows'] = [];
  const inside = (x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  const extra: PanelDef['rows'] = [];
  if (house && level != null) {
    for (const d of house.devices) if (d.level === level && d.kind === 'light' && d.entity && inside(d.x, d.z)) extra.push({ entity: d.entity, name: d.name });
    for (const st of house.levels[level]?.stairs ?? []) if (st.led && inside((st.x0 + st.x1) / 2, (st.z0 + st.z1) / 2)) extra.push({ entity: st.led, name: 'LED schodów' });
  }
  const widget = r.climate || r.thermostat ? climatePanelWidget(r.name, r.climate, r.thermostat, 'thermostat') : undefined;
  if (r.temperature) rows.push({ entity: r.temperature, display: 'graph', name: 'Temperatura', hours: 24 });
  if (r.humidity) rows.push({ entity: r.humidity, display: 'value', name: 'Wilgotność' });
  if (r.light) rows.push({ entity: r.light, name: 'Światło' });
  for (const e of extra) if (!rows.some((x) => x.entity === e.entity)) rows.push(e);
  return { title: r.name, subtitle: r.area ? `${String(r.area).replace('.', ',')} m²` : undefined, rows, widget };
}

/** Default tap for a device placed on the model. */
export function deviceAction(d: HouseDevice): ActionDef {
  if (d.tap) return d.tap;
  switch (d.kind) {
    case 'tv': return d.remote ? { type: 'panel', panel: { title: d.name || 'Telewizor', rows: [], remote: d.remote } } : { type: 'toggle', entity: d.entity };
    case 'light': return { type: 'toggle', entity: d.entity };
    case 'speaker': return { type: 'panel', panel: { title: d.name || 'Media', rows: [{ entity: d.entity, display: 'buttons' }, { entity: d.entity, display: 'slider', name: 'Głośność' }] } };
    case 'ac': return { type: 'panel', panel: { title: d.name || 'Klimatyzacja', rows: [], widget: climatePanelWidget(d.id, d.entity || undefined, d.climate, 'ac') } };
    default: return { type: 'panel', panel: { title: d.name, rows: [{ entity: d.entity }] } };
  }
}

export interface HouseViewProps {
  house: HouseDef;
  opts: SceneOpts;
  showLevels?: boolean;
  onLevel?(l: number | 'all'): void;
  /** kiosk/dashboard: run actions; editor: receive raw picks */
  onPick(p: Pick): void;
  onScene?(s: HouseScene | null): void;
  selected?: string | null;
  /** editor: furniture and devices can be dragged; called on drop */
  onMove?(m: MoveEvent): void;
}

/** The 3D canvas with level switcher and room temperature chips. Used by the widget and the house editor. */
export const HouseView: FC<HouseViewProps> = ({ house, opts, showLevels, onLevel, onPick, onScene, selected, onMove }) => {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HouseScene | null>(null);
  const pickRef = useRef(onPick); pickRef.current = onPick;
  const moveRef = useRef(onMove); moveRef.current = onMove;
  const [frame, setFrame] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!host.current) return;
    let s: HouseScene;
    try {
      s = new HouseScene(host.current, house, opts, { onPick: (p) => pickRef.current(p), onFrame: () => setFrame((n) => (n + 1) % 1e9), onMove: (m) => moveRef.current?.(m) });
      s.enableDrag(!!moveRef.current);
    } catch (e: any) { setErr('WebGL niedostępny: ' + e.message); return; }
    scene.current = s; onScene?.(s);
    s.ready.catch((e) => setErr('Nie udało się wczytać modeli: ' + e.message));
    const upd = () => s.setStates((id) => hass.states.get(id));
    upd();
    const off = hass.subscribe(upd);
    return () => { off(); s.dispose(); scene.current = null; onScene?.(null); };
  }, [house]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scene.current?.setOptions(opts); }, [opts]);
  useEffect(() => { scene.current?.select(selected ?? null); }, [selected, frame === 0]);

  const chips = useMemo(() => {
    const s = scene.current; if (!s) return [];
    return house.levels.flatMap((L, li) => L.rooms.filter((r) => !r.hidden && (r.temperature || r.climate || r.thermostat)).map((r) => {
      const p = s.project(li, r.lx, opts.lowWalls ? 1.45 : 2.75, r.lz);
      if (!p) return null;
      const t = roomTemperature(r);
      const act = roomAction(r);
      const heating = act === 'heating', cooling = act === 'cooling';
      return { key: li + r.name, r, li, x: p.x, y: p.y, t, heating, cooling };
    }).filter(Boolean)) as { key: string; r: RoomDef; li: number; x: number; y: number; t: number; heating: boolean; cooling: boolean }[];
  }, [frame, house, opts.lowWalls]); // eslint-disable-line react-hooks/exhaustive-deps

  const levelNames = house.levels.map((l) => l.name);
  return (
    <div className="h3d">
      <div className="h3d-canvas" ref={host} />
      {chips.map((c) => (
        <button key={c.key} className={'h3d-chip' + (c.heating ? ' warm' : c.cooling ? ' cool' : '')} style={{ left: c.x, top: c.y }}
          onClick={(e) => { e.stopPropagation(); pickRef.current({ type: 'room', level: c.li, room: c.r }); }}>
          <b>{isFinite(c.t) ? formatNumber(c.t, 1) + '°' : '—'}</b><span>{c.r.name}</span>
        </button>
      ))}
      {showLevels && house.levels.length > 1 && (
        <div className="h3d-levels" role="group" aria-label="Kondygnacja">
          {levelNames.map((n, i) => <button key={i} aria-pressed={opts.level === i} onClick={() => onLevel?.(i)}>{n}</button>)}
          <button aria-pressed={opts.level === 'all'} onClick={() => onLevel?.('all')}>Cały dom</button>
        </div>
      )}
      {err && <div className="h3d-err">{err}</div>}
    </div>
  );
};

/** Dashboard widget "house3d". */
const House3DWidget: FC<{ w: WidgetDef; ctx?: ActionCtx }> = ({ w, ctx }) => {
  const o = w.options || {};
  const house = useHouse(o.house);
  const [level, setLevel] = useState<number | 'all'>(o.level ?? 0);
  useEffect(() => { setLevel(o.level ?? 0); }, [o.level]);
  const opts: SceneOpts = useMemo(() => ({
    level, lowWalls: o.lowWalls !== false, heatmap: o.heatmap !== false, palette: o.palette === 'kenney' ? 'kenney' : 'muted',
    lite: !!o.lite || document.documentElement.dataset.lite === '1',
    camera: { az: o.camera?.az ?? 90, el: o.camera?.el ?? 48, zoom: o.camera?.zoom ?? 1 }, orbit: !!o.orbit
  }), [level, o.lowWalls, o.heatmap, o.palette, o.lite, o.camera?.az, o.camera?.el, o.camera?.zoom, o.orbit]);

  if (!o.house) return <div className="w-center w-sub">Wybierz dom w ustawieniach widgetu</div>;
  if (!house) return <div className="w-center w-sub">Wczytywanie domu…</div>;
  const pick = (p: Pick) => {
    if (!ctx) return;
    if (p.type === 'device') runAction(deviceAction(p.device), w, ctx);
    else if (p.type === 'room') ctx.openPanel(roomPanel(p.room, house, p.level), w);
    else if (p.type === 'gate' && p.entity) toggleEntity(p.entity).catch((e) => ctx.notify(e.message));
  };
  return <HouseView house={house} opts={opts} showLevels={o.showLevels !== false} onLevel={setLevel} onPick={pick} />;
};
export default House3DWidget;
