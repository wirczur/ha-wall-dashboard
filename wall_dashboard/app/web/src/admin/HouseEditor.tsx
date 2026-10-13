import { ClimateEditor } from './ClimateEditor';
import { ModelCatalog, prettyModel } from './ModelCatalog';
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import type { Seg, DashboardDoc, FurnitureDef, FurnitureKind, HouseDef, HouseDevice, HouseDeviceKind, HouseSummary, RoomDef, WidgetDef } from '../../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../ui/Icon';
import { HouseView } from '../house/House3DWidget';
import type { HouseScene, MoveEvent, Pick, SceneOpts } from '../house/HouseScene';
import { putHouse } from '../house/houseStore';
import { CheckF, EntityF, NumF, Section, SelectF, TextF, useRemoteOptions } from './fields';
import { ActionEditor } from './Inspector';

const KINDS: [FurnitureKind, string][] = [
  ['sofa', 'Sofa'], ['table', 'Stół'], ['chair', 'Krzesło'], ['coffee', 'Stolik kawowy'], ['tvcab', 'Szafka RTV'], ['rug', 'Dywan'],
  ['bed', 'Łóżko'], ['wardrobe', 'Szafa'], ['desk', 'Biurko'], ['cabinet', 'Szafka'], ['box', 'Szafka (ogólna)'], ['plant', 'Roślina'],
  ['sink', 'Zlew'], ['stove', 'Kuchenka'], ['fridge', 'Lodówka'], ['bathSink', 'Umywalka'], ['toilet', 'WC'], ['shower', 'Prysznic'],
  ['bathtub', 'Wanna'], ['washer', 'Pralka'], ['dryer', 'Suszarka'], ['car', 'Samochód'],
  ['tv', 'Telewizor'], ['tvVintage', 'Telewizor (stary)'], ['speaker', 'Głośnik'], ['monitor', 'Monitor'], ['armchair', 'Fotel'], ['sofaCorner', 'Narożnik'],
  ['ottoman', 'Puf'], ['bookcase', 'Regał'], ['nightstand', 'Szafka nocna'], ['sideTable', 'Stolik'], ['roundTable', 'Stół okrągły'], ['bar', 'Wyspa / bar'],
  ['floorLamp', 'Lampa stojąca'], ['tableLamp', 'Lampka'], ['ceilingFan', 'Wentylator sufitowy'], ['bedSingle', 'Łóżko pojedyncze'], ['deskChair', 'Krzesło biurowe'],
  ['bench', 'Ławka'], ['rugRound', 'Dywan okrągły'], ['mirror', 'Lustro'], ['bathCabinet', 'Szafka łazienkowa'], ['washerDryer', 'Pralka + suszarka'],
  ['fridgeLarge', 'Lodówka duża'], ['microwave', 'Mikrofalówka'], ['coatRack', 'Wieszak'], ['trashcan', 'Kosz'], ['plantSmall', 'Roślina mała'],
  ['tallCabinet', 'Zabudowa wysoka (piekarnik)'], ['hood', 'Okap'], ['shelfLow', 'Regał niski / kostka'], ['rack', 'Szafa rack'], ['pc', 'Komputer'],
  ['printer', 'Drukarka'], ['shredder', 'Niszczarka'], ['acUnit', 'Klimatyzator (sam wygląd)'], ['sofaL', 'Narożnik L (klasyczny)'], ['sofaLong', 'Sofa długa'], ['tvBench', 'Szafka RTV niska (długa)']
];
/** default footprint (w × d, m) of a new piece */
const SIZE: Record<FurnitureKind, [number, number]> = {
  table: [1.6, 0.9], chair: [0.5, 0.5], sofa: [2.2, 0.95], tvcab: [1.8, 0.45], coffee: [1.1, 0.6], rug: [2.4, 1.7], sink: [1.2, 0.6], stove: [0.6, 0.6],
  cabinet: [0.6, 0.6], wardrobe: [1.2, 0.6], shower: [0.9, 0.9], bathSink: [0.6, 0.45], toilet: [0.4, 0.65], washer: [0.6, 0.6], dryer: [0.6, 0.6],
  bed: [1.6, 2.1], bathtub: [1.7, 0.75], desk: [1.4, 0.7], fridge: [0.6, 0.65], plant: [0.4, 0.4], car: [1.9, 4.6], box: [0.8, 0.5],
  tv: [1.4, 0.25], tvVintage: [0.7, 0.5], speaker: [0.3, 0.3], monitor: [0.6, 0.2], armchair: [0.85, 0.85], sofaCorner: [1.0, 1.0], ottoman: [0.8, 0.8],
  bookcase: [1.0, 0.4], nightstand: [0.5, 0.4], sideTable: [0.5, 0.5], roundTable: [1.1, 1.1], bar: [1.8, 0.9], floorLamp: [0.4, 0.4], tableLamp: [0.3, 0.3],
  ceilingFan: [1.2, 1.2], bedSingle: [1.0, 2.0], deskChair: [0.6, 0.6], bench: [1.4, 0.45], rugRound: [2.0, 2.0], mirror: [0.6, 0.1], bathCabinet: [0.6, 0.45],
  washerDryer: [0.6, 0.65], fridgeLarge: [0.9, 0.7], microwave: [0.5, 0.35], coatRack: [0.5, 0.5], trashcan: [0.35, 0.35], plantSmall: [0.3, 0.3],
  tallCabinet: [0.6, 0.6], hood: [0.6, 0.4], shelfLow: [0.72, 0.38], rack: [0.6, 0.6], pc: [0.22, 0.45], printer: [0.45, 0.38], shredder: [0.35, 0.25], model: [0.8, 0.8], acUnit: [0.9, 0.25], sofaL: [1.9, 2.5], sofaLong: [2.5, 0.95], tvBench: [3.0, 0.42]
};
type Placing = { kind: 'device' | 'furniture'; id: string } | null;
const LIGHT_MODELS: [NonNullable<HouseDevice['model']>, string][] = [['ceiling', 'Lampa sufitowa'], ['spots', '4 reflektory (kwadrat)'], ['spots8', '8 reflektorów razem'], ['spotsLine', '4 reflektory (listwa)'], ['pendant', 'Lampa wisząca'], ['wall', 'Kinkiet'], ['floor', 'Lampa stojąca'],
  ['table', 'Lampka stołowa'], ['strip', 'Taśma LED'], ['none', 'Punkt świetlny']];
const DEV_KINDS: [HouseDeviceKind, string][] = [['light', 'Światło'], ['tv', 'Telewizor'], ['speaker', 'Głośnik / media'], ['ac', 'Klimatyzator'], ['marker', 'Znacznik (dowolna encja)']];
const STUB_DOC = { id: '', title: '', views: [], theme: {} } as unknown as DashboardDoc;
const STUB_W = { id: 'dev', type: 'button', x: 0, y: 0, w: 1, h: 1 } as WidgetDef;

// ================================================================ list + import
export const Houses: FC<{ onEdit(id: string): void }> = ({ onEdit }) => {
  const [list, setList] = useState<HouseSummary[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.get<HouseSummary[]>('houses').then(setList).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  return (
    <section className="a-sec">
      <div className="a-bar"><h2>Domy 3D</h2></div>
      <p className="muted">Dom budowany jest z rzutów SVG (jeden plik na kondygnację). Ściany, okna, drzwi, bramy, pomieszczenia, schody i meble są rozpoznawane automatycznie — potem możesz je poprawić i dodać urządzenia z HA. Dom wstawiasz na dashboard widgetem „Dom 3D”.</p>
      {err && <p className="err">{err}</p>}
      <div className="cards">
        {list.map((h) => (
          <article key={h.id} className="card">
            <h3>{h.name}</h3>
            <p className="muted">{h.levels.join(' · ')} · {h.devices} urządzeń · id: <code>{h.id}</code></p>
            <div className="row-btns">
              <button className="btn primary" onClick={() => onEdit(h.id)}><Icon name="edit" size={18} />Edytuj</button>
              <button className="btn" onClick={async () => { await api.del('houses/' + h.id); load(); }}>Usuń</button>
            </div>
          </article>
        ))}
        <ImportCard onDone={(id) => { load(); onEdit(id); }} />
      </div>
    </section>
  );
};

interface LevelIn { name: string; svg: string; file: string; height?: number }
export const ImportCard: FC<{ onDone(id: string): void; replace?: string; title?: string }> = ({ onDone, replace, title }) => {
  const [name, setName] = useState('Dom');
  const [levels, setLevels] = useState<LevelIn[]>([{ name: 'Parter', svg: '', file: '' }]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<LevelIn>) => setLevels(levels.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const h = await api.post<HouseDef>('houses/import', { name, replace, levels: levels.filter((l) => l.svg).map((l) => ({ name: l.name, svg: l.svg, height: l.height })) });
      onDone(h.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <article className="card">
      <h3>{title ?? 'Importuj dom z rzutów SVG'}</h3>
      {!replace && <label className="field"><span>Nazwa</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>}
      {levels.map((l, i) => (
        <div key={i} className="import-row">
          <label className="field"><span>Kondygnacja {i + 1}</span><input value={l.name} onChange={(e) => set(i, { name: e.target.value })} /></label>
          <label className="field"><span>Plik SVG</span>
            <input type="file" accept=".svg,image/svg+xml" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set(i, { svg: await f.text(), file: f.name }); }} />
          </label>
          <label className="field"><span>Wys. (m)</span><input type="number" step="0.1" placeholder="2.9" value={l.height ?? ''} onChange={(e) => set(i, { height: e.target.value ? Number(e.target.value) : undefined })} /></label>
          {levels.length > 1 && <button className="mini" onClick={() => setLevels(levels.filter((_, j) => j !== i))} aria-label="Usuń kondygnację">×</button>}
        </div>
      ))}
      <div className="row-btns">
        <button className="btn" onClick={() => setLevels([...levels, { name: levels.length === 1 ? 'Piętro' : `Poziom ${levels.length + 1}`, svg: '', file: '' }])}>+ Kondygnacja</button>
        <button className="btn primary" disabled={busy || !levels.some((l) => l.svg)} onClick={go}>{busy ? 'Importuję…' : replace ? 'Zaimportuj ponownie' : 'Importuj'}</button>
      </div>
      {replace && <p className="muted">Ponowny import nadpisuje ściany, pomieszczenia i meble; urządzenia zostają.</p>}
      {err && <p className="err">{err}</p>}
    </article>
  );
};

// ================================================================ editor
type Tab = 'rooms' | 'furniture' | 'devices' | 'windows' | 'gates' | 'settings';
type Sel = { kind: 'room'; level: number; name: string } | { kind: 'furniture'; level: number; id: string } | { kind: 'device'; id: string } | { kind: 'gate'; level: number; index: number } | null;

export const HouseEditor: FC<{ id: string; onBack(): void }> = ({ id, onBack }) => {
  const [house, setHouse] = useState<HouseDef | null>(null);
  const [viewHouse, setViewHouse] = useState<HouseDef | null>(null);
  const [saved, setSaved] = useState('');
  const [tab, setTab] = useState<Tab>('rooms');
  const [sel, setSel] = useState<Sel>(null);
  const [placing, setPlacingS] = useState<Placing>(null); // piece waiting for a floor click
  const setPlacing = (id: string | null) => setPlacingS(id ? { kind: 'device', id } : null);
  /** house data whose positions the 3D view already shows (drag / nudge) → no rebuild needed */
  const liveRef = useRef<HouseDef | null>(null);
  const [level, setLevel] = useState<number | 'all'>(0);
  const [cam, setCam] = useState({ az: 0, el: 55, zoom: 1 });
  const [low, setLow] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const sceneRef = useRef<HouseScene | null>(null);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => { const k = (e: KeyboardEvent) => keyRef.current(e); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const load = useCallback(() => api.get<HouseDef>('houses/' + id).then((h) => { setHouse(h); setViewHouse(h); setSaved(JSON.stringify(h)); }).catch((e) => setMsg({ kind: 'err', text: e.message })), [id]);
  useEffect(() => { load(); }, [load]);

  // rebuild the 3D view shortly after edits, keeping the current camera
  useEffect(() => {
    if (!house || house === viewHouse) return;
    if (house === liveRef.current) { sceneRef.current?.setHouseData(house); return; }
    const t = setTimeout(() => { const c = sceneRef.current?.currentCamera(); if (c) setCam(c); setViewHouse(house); }, 450);
    return () => clearTimeout(t);
  }, [house]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!house && JSON.stringify(house) !== saved;

  // ---- local draft: unsaved edits survive a failed save, a reload or a closed tab
  const draftKey = 'wd-house-draft-' + id;
  const [draft, setDraft] = useState<{ at: number; house: HouseDef } | null>(null);
  useEffect(() => {
    if (!saved) return;
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (d?.house && JSON.stringify(d.house) !== saved) setDraft(d); else localStorage.removeItem(draftKey);
    } catch { /* no storage */ }
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!house || !dirty || draft) return;
    const t = setTimeout(() => { try { localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), house })); } catch { /* full / blocked */ } }, 600);
    return () => clearTimeout(t);
  }, [house, dirty, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const dropDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } setDraft(null); };

  const exportJson = () => {
    if (!house) return;
    const blob = new Blob([JSON.stringify(house, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dom-${house.id}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importJson = async (file: File) => {
    try {
      const h = JSON.parse(await file.text());
      if (!h || !Array.isArray(h.levels) || !h.levels.length || !Array.isArray(h.devices ?? [])) throw new Error('To nie jest plik domu (brak „levels”)');
      for (const l of h.levels) for (const k of ['walls', 'windows', 'gates', 'rooms', 'roofs', 'stairs', 'furniture']) if (!Array.isArray(l[k])) l[k] = [];
      const next: HouseDef = { ...h, id, devices: h.devices ?? [] };
      setHouse(next); setViewHouse(next);
      setMsg({ kind: 'ok', text: `Wczytano ${file.name}. Sprawdź i kliknij Zapisz.` });
    } catch (e: any) { setMsg({ kind: 'err', text: 'Nie udało się wczytać: ' + e.message }); }
  };
  const save = async () => {
    if (!house) return;
    try { const h = await api.put<HouseDef>('houses/' + id, house); setHouse(h); setSaved(JSON.stringify(h)); putHouse(h); dropDraft(); setMsg({ kind: 'ok', text: 'Zapisano. Tablety odświeżą widok domu.' }); }
    catch (e: any) { setMsg({ kind: 'err', text: `Nie zapisano (${e.message}). Zmiany są bezpieczne w tej przeglądarce – możesz też pobrać JSON.` }); }
  };
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); }, [msg]);

  const opts: SceneOpts = useMemo(() => ({ level, lowWalls: low, heatmap: true, palette: 'muted', lite: false, camera: cam, orbit: true }), [level, low, cam]);
  const lvIdx = level === 'all' ? 0 : level;

  if (!house || !viewHouse) return <div className="editor"><p className="muted">{msg?.text ?? 'Ładowanie…'}</p></div>;

  const upLevel = (li: number, fn: (l: HouseDef['levels'][number]) => HouseDef['levels'][number]) =>
    setHouse({ ...house, levels: house.levels.map((l, i) => (i === li ? fn(l) : l)) });
  const upDevice = (d: HouseDevice) => setHouse({ ...house, devices: house.devices.map((x) => (x.id === d.id ? d : x)) });

  /** position change already visible in 3D: update data without rebuilding the scene */
  const moveLive = (type: 'furniture' | 'device', id: string, x: number, z: number) => {
    const h: HouseDef = type === 'device'
      ? { ...house, devices: house.devices.map((d) => (d.id === id ? { ...d, x, z } : d)) }
      : { ...house, levels: house.levels.map((l) => (l.furniture.some((f) => f.id === id) ? { ...l, furniture: l.furniture.map((f) => (f.id === id ? { ...f, x, z } : f)) } : l)) };
    sceneRef.current?.setHouseData(h);
    liveRef.current = h; setHouse(h);
  };
  const onMove = (m: MoveEvent) => {
    moveLive(m.type, m.id, m.x, m.z);
    if (m.type === 'furniture') { setSel({ kind: 'furniture', level: m.level, id: m.id }); setTab('furniture'); }
    else { setSel({ kind: 'device', id: m.id }); setTab('devices'); }
  };

  const onPick = (p: Pick) => {
    if (p.type === 'floor') {
      if (placing?.kind === 'device') {
        const d = house.devices.find((x) => x.id === placing.id);
        if (d) upDevice({ ...d, x: p.x, z: p.z, level: p.level });
        setPlacingS(null); setSel({ kind: 'device', id: placing.id }); setTab('devices');
      } else if (placing?.kind === 'furniture') {
        const id = placing.id;
        setHouse({ ...house, levels: house.levels.map((l, i) => {
          const f = house.levels.flatMap((x) => x.furniture).find((x) => x.id === id);
          const rest = l.furniture.filter((x) => x.id !== id);
          return i === p.level && f ? { ...l, furniture: [...rest, { ...f, x: p.x, z: p.z }] } : { ...l, furniture: rest };
        }) });
        setPlacingS(null); setSel({ kind: 'furniture', level: p.level, id }); setTab('furniture');
      }
      return;
    }
    if (placing) return;
    if (p.type === 'furniture') { setSel({ kind: 'furniture', level: p.level, id: p.id }); setTab('furniture'); }
    else if (p.type === 'device') { setSel({ kind: 'device', id: p.device.id }); setTab('devices'); }
    else if (p.type === 'room') { setSel({ kind: 'room', level: p.level, name: p.room.name }); setTab('rooms'); }
    else if (p.type === 'gate') { setSel({ kind: 'gate', level: p.level, index: p.index }); setTab('gates'); }
  };
  const selectedId = sel?.kind === 'furniture' || sel?.kind === 'device' ? sel.id : null;
  keyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape' && placing) { setPlacingS(null); return; }
    if (sel?.kind !== 'furniture' && sel?.kind !== 'device') return;
    const lvl = sel.kind === 'furniture' ? sel.level : 0;
    const f = sel.kind === 'furniture' ? house.levels[lvl]?.furniture.find((x) => x.id === sel.id) : undefined;
    const d = sel.kind === 'device' ? house.devices.find((x) => x.id === sel.id) : undefined;
    const it = f ?? d; if (!it) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const st = e.shiftKey ? 0.25 : e.altKey ? 0.01 : 0.05;
      const x = +(it.x + arrows[e.key][0] * st).toFixed(3), z = +(it.z + arrows[e.key][1] * st).toFixed(3);
      sceneRef.current?.moveTo(sel.kind, it.id, x, z);
      moveLive(sel.kind, it.id, x, z);
    } else if ((e.key === 'r' || e.key === 'R') && f) {
      e.preventDefault();
      const turn = e.shiftKey ? -Math.PI / 2 : Math.PI / 2;
      upLevel(lvl, (l) => ({ ...l, furniture: l.furniture.map((x) => (x.id === f.id ? { ...x, phi: +(x.phi + turn).toFixed(4), w: x.d, d: x.w } : x)) }));
    } else if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const nid = (f ? 'f' : 'd') + Date.now().toString(36);
      if (f) { upLevel(lvl, (l) => ({ ...l, furniture: [...l.furniture, { ...f, id: nid, x: +(f.x + 0.3).toFixed(3), z: +(f.z + 0.3).toFixed(3) }] })); setSel({ kind: 'furniture', level: lvl, id: nid }); }
      else if (d) { setHouse({ ...house, devices: [...house.devices, { ...d, id: nid, x: +(d.x + 0.3).toFixed(3), z: +(d.z + 0.3).toFixed(3) }] }); setSel({ kind: 'device', id: nid }); }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (f) upLevel(lvl, (l) => ({ ...l, furniture: l.furniture.filter((x) => x.id !== f.id) }));
      else setHouse({ ...house, devices: house.devices.filter((x) => x.id !== it.id) });
      setSel(null);
    }
  };

  return (
    <div className="editor">
      <header className="e-head">
        <button className="btn" onClick={onBack}><Icon name="prev" size={18} />Domy</button>
        <h1>{house.name}</h1>
        <span className={'pill' + (dirty ? ' warn' : '')}>{dirty ? 'niezapisane zmiany' : 'zapisane'}</span>
        <div className="grow" />
        <label className="ins-check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />Niskie ściany</label>
        <button className="btn" onClick={() => { setCam({ az: 0, el: 55, zoom: 1 }); }} title="Góra rzutu u góry ekranu">Jak na rzucie</button>
        <button className="btn" onClick={() => { const c = sceneRef.current?.currentCamera() ?? cam; setCam({ ...c, az: (Math.round(c.az / 90) * 90 + 90) % 360 }); }}>Obróć widok 90°</button>
        <button className="btn" onClick={() => { setCam({ az: 0, el: 89, zoom: 1 }); }}>Z góry</button>
        <button className="btn" onClick={exportJson} title="Kopia całego domu do pliku">Pobierz JSON</button>
        <label className="btn" title="Wczytaj dom z pliku JSON (potem Zapisz)">Wczytaj JSON
          <input type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />
        </label>
        <button className="btn" disabled={!dirty} onClick={() => { const h = JSON.parse(saved); setHouse(h); setViewHouse(h); dropDraft(); }}>Cofnij zmiany</button>
        <button className="btn primary" disabled={!dirty} onClick={save}>Zapisz</button>
      </header>
      {msg && <p className={msg.kind === 'err' ? 'err' : 'ok'} role="status">{msg.text}</p>}
      {draft && (
        <div className="he-draft" role="alert">
          <span>Masz niezapisane zmiany tego domu z {new Date(draft.at).toLocaleString('pl-PL')}.</span>
          <button className="btn primary" onClick={() => { setHouse(draft.house); setViewHouse(draft.house); setDraft(null); }}>Przywróć</button>
          <button className="btn" onClick={dropDraft}>Odrzuć</button>
        </div>
      )}
      <div className="he">
        <div className="he-view">
          <HouseView house={viewHouse} opts={opts} showLevels onLevel={setLevel} onPick={onPick} onScene={(s) => { sceneRef.current = s; }} selected={selectedId} onMove={onMove} />
          {placing
            ? <div className="he-hint">Kliknij podłogę, aby postawić {placing.kind === 'device' ? 'urządzenie' : 'mebel'} · <button className="mini" onClick={() => setPlacingS(null)}>Anuluj</button></div>
            : <div className="he-hint soft">Przeciągnij mebel lub urządzenie · przyciąga do ścian (Alt – bez), Shift – co 1 cm · strzałki przesuwają, R obraca, Ctrl+D duplikuje, Delete usuwa</div>}
        </div>
        <aside className="ve-side">
          <div className="seg" role="tablist" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            {([['rooms', 'Pokoje'], ['furniture', 'Meble'], ['devices', 'Urządzenia'], ['windows', 'Okna'], ['gates', 'Bramy'], ['settings', 'Ustawienia']] as [Tab, string][]).map(([k, l]) =>
              <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === 'rooms' && <RoomsTab house={house} li={lvIdx} sel={sel} setSel={setSel} upLevel={upLevel}
            addDevice={(d) => { setHouse({ ...house, devices: [...house.devices, d] }); setSel({ kind: 'device', id: d.id }); setTab('devices'); setPlacingS({ kind: 'device', id: d.id }); }}
            openDevice={(id) => { setSel({ kind: 'device', id }); setTab('devices'); }} />}
          {tab === 'furniture' && <FurnitureTab house={house} li={lvIdx} sel={sel} setSel={setSel} upLevel={upLevel} onPlace={(id) => setPlacingS({ kind: 'furniture', id })} />}
          {tab === 'devices' && <DevicesTab house={house} li={lvIdx} sel={sel} setSel={setSel} setHouse={setHouse} upDevice={upDevice} setPlacing={setPlacing} />}
          {tab === 'windows' && <WindowsTab house={house} li={lvIdx} upLevel={upLevel} />}
          {tab === 'gates' && <GatesTab house={house} sel={sel} setSel={setSel} upLevel={upLevel} />}
          {tab === 'settings' && <SettingsTab house={house} setHouse={setHouse} onReimported={() => load()} />}
        </aside>
      </div>
    </div>
  );
};

type UpLevel = (li: number, fn: (l: HouseDef['levels'][number]) => HouseDef['levels'][number]) => void;

const RoomsTab: FC<{ house: HouseDef; li: number; sel: Sel; setSel(s: Sel): void; upLevel: UpLevel; addDevice(d: HouseDevice): void; openDevice(id: string): void }> = ({ house, li, sel, setSel, upLevel, addDevice, openDevice }) => {
  const [lightModel, setLightModel] = useState<NonNullable<HouseDevice['model']>>('ceiling');
  const L = house.levels[li];
  const r = sel?.kind === 'room' ? house.levels[sel.level]?.rooms.find((x) => x.name === sel.name) : undefined;
  const set = (p: Partial<RoomDef>) => sel?.kind === 'room' && upLevel(sel.level, (l) => ({ ...l, rooms: l.rooms.map((x) => (x.name === sel.name ? { ...x, ...p } : x)) }));
  return (
    <div className="ins">
      <p className="muted">{L.name}: kliknij pomieszczenie na modelu lub na liście. Temperatura i klimat pokazują się na modelu i w mapie ciepła.</p>
      <div className="he-list">
        {L.rooms.map((x) => (
          <button key={x.name} className={'he-item' + (r === x ? ' sel' : '')} onClick={() => setSel({ kind: 'room', level: li, name: x.name })}>
            <span>{x.name}{x.area ? <small> · {String(x.area).replace('.', ',')} m²</small> : null}</span>
            <small>{[x.temperature && 'temp.', (x.climate || x.thermostat) && 'klimat', x.light && 'światło'].filter(Boolean).join(' · ')}</small>
          </button>
        ))}
      </div>
      {r && (
        <Section title={r.name}>
          <EntityF label="Temperatura" value={r.temperature} onChange={(v) => set({ temperature: v })} domains={['sensor']} />
          <EntityF label="Wilgotność" value={r.humidity} onChange={(v) => set({ humidity: v })} domains={['sensor']} />
          <EntityF label="Klimat / termostat" value={r.climate} onChange={(v) => set({ climate: v })} domains={['climate', 'water_heater']} hint="lub termostat z osobnych encji poniżej" />
          <CheckF label="Termostat z osobnych encji / własne ustawienia" value={!!r.thermostat} onChange={(v) => set({ thermostat: v ? { kind: 'thermostat', source: r.climate ? undefined : 'entities' } : undefined })} />
          {r.thermostat && <Section title="Termostat pokoju"><ClimateEditor panel value={r.thermostat} entity={r.climate} onChange={(v) => set({ thermostat: v ?? { kind: 'thermostat' } })} /></Section>}
          <EntityF label="Światło sufitowe" value={r.light} onChange={(v) => set({ light: v })} domains={['light', 'switch']} hint="lampa na środku pokoju" />
          {r.light && <SelectF label="Oprawa" value={r.lightModel ?? 'lamp'} options={[['lamp', 'Lampa'], ['downlights', 'Oczka w suficie (rozłożone)'], ['spots', '4 reflektory razem (kwadrat)'], ['spots8', '8 reflektorów razem'], ['spotsLine', '4 reflektory w listwie'], ['none', 'Bez oprawy (samo światło)']]}
            onChange={(v) => set({ lightModel: v === 'lamp' ? undefined : v as RoomDef['lightModel'] })} />}
          {r.light && r.lightModel === 'downlights' && <NumF label="Liczba oczek" value={r.lightCount} min={1} max={24} placeholder="8" onChange={(v) => set({ lightCount: v })} />}
          <h4 className="ins-h">Światła i urządzenia w pokoju</h4>
          {(() => {
            const lvl = sel?.kind === 'room' ? sel.level : li;
            const inRoom = house.devices.filter((d) => d.level === lvl && d.x >= r.x0 && d.x <= r.x1 && d.z >= r.z0 && d.z <= r.z1);
            const mk = (p: Partial<HouseDevice>): HouseDevice => ({ id: 'd' + Date.now().toString(36), entity: '', kind: 'light', level: lvl, x: +((r.x0 + r.x1) / 2).toFixed(2), z: +((r.z0 + r.z1) / 2).toFixed(2), ...p });
            return <>
              {inRoom.length === 0 && <p className="muted">Brak — dodaj dowolną liczbę świateł, taśm LED czy klimatyzatorów.</p>}
              <div className="he-list">
                {inRoom.map((d) => <button key={d.id} className="he-item" onClick={() => openDevice(d.id)}>
                  <span>{d.name || d.entity || '(bez encji)'}</span><small>{d.kind === 'light' ? LIGHT_MODELS.find((m) => m[0] === (d.model ?? 'ceiling'))?.[1] : DEV_KINDS.find((k) => k[0] === d.kind)?.[1]}</small>
                </button>)}
              </div>
              <div className="row-btns">
                <select value={lightModel} onChange={(e) => setLightModel(e.target.value as NonNullable<HouseDevice['model']>)} aria-label="Rodzaj światła">
                  {LIGHT_MODELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button className="btn" onClick={() => addDevice(mk({ kind: 'light', model: lightModel, ...(lightModel === 'strip' ? { length: 1.5 } : {}) }))}>+ Światło</button>
                <button className="btn" onClick={() => addDevice(mk({ kind: 'ac', name: 'Klimatyzacja ' + r.name }))}>+ Klimatyzator</button>
              </div>
            </>;
          })()}
          <CheckF label="Ukryj pomieszczenie" value={r.hidden} onChange={(v) => set({ hidden: v || undefined })} />
        </Section>
      )}
    </div>
  );
};

const FurnitureTab: FC<{ house: HouseDef; li: number; sel: Sel; setSel(s: Sel): void; upLevel: UpLevel; onPlace(id: string): void }> = ({ house, li, sel, setSel, upLevel, onPlace }) => {
  const L = house.levels[li];
  const [newKind, setNewKind] = useState<FurnitureKind>('sofa');
  const [catalog, setCatalog] = useState<'add' | 'change' | null>(null);
  const fl = sel?.kind === 'furniture' ? sel.level : li;
  const f = sel?.kind === 'furniture' ? house.levels[fl]?.furniture.find((x) => x.id === sel.id) : undefined;
  const set = (p: Partial<FurnitureDef>) => f && upLevel(fl, (l) => ({ ...l, furniture: l.furniture.map((x) => (x.id === f.id ? { ...x, ...p } : x)) }));
  const label = (k: FurnitureKind) => KINDS.find((x) => x[0] === k)?.[1] ?? k;
  return (
    <div className="ins">
      <p className="muted">Przeciągnij mebel na modelu, aby go przesunąć (dosuwa się do ścian). Kliknij, aby zmienić typ, obrót lub wymiary.</p>
      <div className="he-list">
        {L.furniture.map((x) => (
          <button key={x.id} className={'he-item' + (f?.id === x.id ? ' sel' : '')} onClick={() => setSel({ kind: 'furniture', level: li, id: x.id })}>
            <span>{x.model ? prettyModel(x.model) : label(x.kind)}</span><small>{x.w.toFixed(2)}×{x.d.toFixed(2)} m</small>
          </button>
        ))}
      </div>
      <div className="row-btns">
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as FurnitureKind)} aria-label="Rodzaj mebla">
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn" onClick={() => {
          const id = 'f' + Date.now().toString(36);
          const [w, d] = SIZE[newKind];
          upLevel(li, (l) => ({ ...l, furniture: [...l.furniture, { id, kind: newKind, x: 0, z: 0, w, d, phi: 0 }] }));
          setSel({ kind: 'furniture', level: li, id });
          onPlace(id);
        }}>+ Dodaj i kliknij miejsce</button>
        <button className="btn" onClick={() => setCatalog(catalog === 'add' ? null : 'add')}>Katalog modeli…</button>
      </div>
      {catalog && <ModelCatalog current={catalog === 'change' ? f?.model : undefined} onClose={() => setCatalog(null)} onPick={(it) => {
        if (catalog === 'change' && f) { set({ kind: 'model', model: it.name, w: it.w, d: it.d, fit: undefined }); setCatalog(null); return; }
        const id = 'f' + Date.now().toString(36);
        upLevel(li, (l) => ({ ...l, furniture: [...l.furniture, { id, kind: 'model', model: it.name, x: 0, z: 0, w: it.w, d: it.d, phi: 0 }] }));
        setSel({ kind: 'furniture', level: li, id });
        setCatalog(null);
        onPlace(id);
      }} />}
      {f && (
        <Section title={f.model ? prettyModel(f.model) : label(f.kind)}>
          <SelectF label="Typ" value={f.kind} options={f.kind === 'model' ? [['model', 'Model z katalogu'], ...KINDS] : KINDS}
            onChange={(v) => set({ kind: v as FurnitureKind, ...(v !== 'model' ? { model: undefined, fit: undefined } : {}) })} />
          <div className="row-btns">
            {f.model && <img className="cat-thumb" src={'kenney/preview/' + f.model + '.png'} alt="" />}
            <button className="btn" onClick={() => setCatalog(catalog === 'change' ? null : 'change')}>{f.model ? 'Zmień model…' : 'Wybierz model z katalogu…'}</button>
          </div>
          {f.model && <CheckF label="Dopasuj do szerokości i głębokości" value={f.fit} onChange={(v) => set({ fit: v || undefined })} />}
          {f.kind === 'sofaL' && <CheckF label="Narożnik po drugiej stronie (lustro)" value={f.mirror} onChange={(v) => set({ mirror: v || undefined })} />}
          <div className="row-btns">
            <button className="btn" onClick={() => set({ phi: +(f.phi - Math.PI / 2).toFixed(4), w: f.d, d: f.w })}>⟲ 90°</button>
            <button className="btn" onClick={() => set({ phi: +(f.phi + Math.PI / 2).toFixed(4), w: f.d, d: f.w })}>⟳ 90°</button>
            <button className="btn" onClick={() => set({ phi: +(f.phi + Math.PI).toFixed(4) })}>Obróć 180°</button>
          </div>
          <div className="ins-grid4">
            <NumF label="X (m)" value={f.x} step={0.05} onChange={(v) => set({ x: v ?? 0 })} />
            <NumF label="Z (m)" value={f.z} step={0.05} onChange={(v) => set({ z: v ?? 0 })} />
            <NumF label="Szerokość" value={f.w} step={0.05} min={0.1} onChange={(v) => set({ w: Math.max(0.1, v ?? 0.5), ...(f.model ? { fit: true } : {}) })} />
            <NumF label="Głębokość" value={f.d} step={0.05} min={0.1} onChange={(v) => set({ d: Math.max(0.1, v ?? 0.5), ...(f.model ? { fit: true } : {}) })} />
          </div>
          <NumF label="Wysokość nad podłogą (m)" value={f.elev} step={0.05} min={0} max={3} placeholder="domyślna" onChange={(v) => set({ elev: v })}
            hint="np. telewizor na szafce 0,5 m, na ścianie 1,1 m" />
          <NumF label="Wysokość mebla (m)" value={f.height} step={0.05} min={0.05} max={4} placeholder="z modelu" onChange={(v) => set({ height: v })} />
          <ColorPick value={f.color} onChange={(v) => set({ color: v })} />
          <div className="row-btns">
            <button className="btn" onClick={() => onPlace(f.id)}>Przenieś — kliknij na modelu</button>
            <button className="btn" onClick={() => {
              const id = 'f' + Date.now().toString(36);
              upLevel(fl, (l) => ({ ...l, furniture: [...l.furniture, { ...f, id, x: +(f.x + 0.3).toFixed(3), z: +(f.z + 0.3).toFixed(3) }] }));
              setSel({ kind: 'furniture', level: fl, id });
            }}>Duplikuj</button>
            <button className="btn danger" onClick={() => { upLevel(fl, (l) => ({ ...l, furniture: l.furniture.filter((x) => x.id !== f.id) })); setSel(null); }}>Usuń mebel</button>
          </div>
        </Section>
      )}
    </div>
  );
};

const DevicesTab: FC<{
  house: HouseDef; li: number; sel: Sel; setSel(s: Sel): void; setHouse(h: HouseDef): void; upDevice(d: HouseDevice): void; setPlacing(id: string | null): void;
}> = ({ house, li, sel, setSel, setHouse, upDevice, setPlacing }) => {
  const d = sel?.kind === 'device' ? house.devices.find((x) => x.id === sel.id) : undefined;
  const [newKind, setNewKind] = useState<HouseDeviceKind>('light');
  const [newEntity, setNewEntity] = useState<string | undefined>();
  const set = (p: Partial<HouseDevice>) => d && upDevice(Object.fromEntries(Object.entries({ ...d, ...p }).filter(([, v]) => v !== undefined)) as unknown as HouseDevice);
  const add = () => {
    if (!newEntity && newKind !== 'tv') return;
    const nd: HouseDevice = { id: 'd' + Date.now().toString(36), entity: newEntity ?? '', kind: newKind, level: li, x: 0, z: 0, ...(newKind === 'light' ? { model: 'ceiling' } : {}) };
    setHouse({ ...house, devices: [...house.devices, nd] });
    setSel({ kind: 'device', id: nd.id }); setPlacing(nd.id); setNewEntity(undefined);
  };
  const label = (k: HouseDeviceKind) => DEV_KINDS.find((x) => x[0] === k)?.[1] ?? k;
  return (
    <div className="ins">
      <p className="muted">Urządzenia z HA na modelu: światła świecą, TV i głośniki reagują na odtwarzanie, klimatyzator pokazuje nawiew. Dotknięcie na tablecie wykonuje akcję.</p>
      <div className="he-list">
        {house.devices.map((x) => (
          <button key={x.id} className={'he-item' + (d?.id === x.id ? ' sel' : '')} onClick={() => setSel({ kind: 'device', id: x.id })}>
            <span>{x.name || x.entity}</span><small>{label(x.kind)} · {house.levels[x.level]?.name}</small>
          </button>
        ))}
      </div>
      <Section title="Dodaj urządzenie">
        <SelectF label="Rodzaj" value={newKind} options={DEV_KINDS} onChange={(v) => setNewKind(v as HouseDeviceKind)} />
        <EntityF label="Encja" value={newEntity} onChange={setNewEntity}
          domains={newKind === 'light' ? ['light', 'switch'] : newKind === 'tv' || newKind === 'speaker' ? ['media_player', 'switch', 'remote'] : newKind === 'ac' ? ['climate', 'select', 'input_select', 'switch'] : undefined} />
        {newKind === 'tv' && <p className="muted">Telewizor Samsung sterowany bezpośrednio nie potrzebuje encji HA — po dodaniu wybierz „Pilot Samsung”.</p>}
        <button className="btn primary" disabled={!newEntity && newKind !== 'tv'} onClick={add}>Dodaj i kliknij miejsce na modelu</button>
      </Section>
      {d && (
        <Section title={d.name || d.entity}>
          <TextF label="Nazwa" value={d.name} onChange={(v) => set({ name: v })} placeholder="z encji" />
          <EntityF label="Encja" value={d.entity} onChange={(v) => set({ entity: v ?? '' })} />
          <SelectF label="Rodzaj" value={d.kind} options={DEV_KINDS} onChange={(v) => set({ kind: v as HouseDeviceKind })} />
          {d.kind === 'tv' && <TvLink value={d.remote} onChange={(v) => set({ remote: v })} />}
          {d.kind === 'speaker' && <SelectF label="Wygląd" value={d.model === 'ceiling' ? 'ceiling' : 'floor'} options={[['floor', 'Kolumna / głośnik stojący'], ['ceiling', 'Głośnik sufitowy']]}
            onChange={(v) => set({ model: v === 'ceiling' ? 'ceiling' : undefined })} />}
          {d.kind === 'ac' && <Section title="Klimatyzacja – panel" open={!!d.climate}>
            <ClimateEditor panel value={{ kind: 'ac', ...(d.climate || {}) }} entity={d.entity} onChange={(v) => set({ climate: v })} />
          </Section>}
          {d.kind === 'light' && <SelectF label="Wygląd" value={d.model ?? 'ceiling'} options={LIGHT_MODELS} onChange={(v) => set({ model: v as HouseDevice['model'] })} />}
          {d.kind === 'light' && d.model === 'strip' && <NumF label="Długość taśmy (m)" value={d.length} step={0.1} min={0.2} max={20} placeholder="1" onChange={(v) => set({ length: v })}
            hint="Obrót ustawia kierunek, wysokość – np. 0,05 m przy podłodze, 2,4 m pod sufitem" />}
          <SelectF label="Kondygnacja" value={String(d.level)} options={house.levels.map((l, i) => [String(i), l.name])} onChange={(v) => set({ level: Number(v) })} />
          <div className="ins-grid4">
            <NumF label="X (m)" value={d.x} step={0.05} onChange={(v) => set({ x: v ?? 0 })} />
            <NumF label="Z (m)" value={d.z} step={0.05} onChange={(v) => set({ z: v ?? 0 })} />
            <NumF label="Wysokość (m)" value={d.y} step={0.05} placeholder="auto" onChange={(v) => set({ y: v })} />
            <NumF label="Obrót (°)" value={d.phi != null ? Math.round((d.phi * 180) / Math.PI) : undefined} step={15} placeholder="0" onChange={(v) => set({ phi: v == null ? undefined : +((v * Math.PI) / 180).toFixed(4) })} />
          </div>
          <button className="btn" onClick={() => setPlacing(d.id)}>Przenieś — kliknij na modelu</button>
          <Section title="Po dotknięciu" open={!!d.tap}>
            <ActionEditor value={d.tap} onChange={(a) => set({ tap: a })} doc={STUB_DOC} widget={{ ...STUB_W, entity: d.entity, title: d.name }} allowDefault />
          </Section>
          <button className="btn danger" onClick={() => { setHouse({ ...house, devices: house.devices.filter((x) => x.id !== d.id) }); setSel(null); }}>Usuń urządzenie</button>
        </Section>
      )}
    </div>
  );
};

const TvLink: FC<{ value?: string; onChange(v: string | undefined): void }> = ({ value, onChange }) => {
  const list = useRemoteOptions();
  return <SelectF label="Pilot Samsung" value={value ?? ''} options={[['', 'brak — dotknięcie przełącza encję'], ...list]}
    onChange={(v) => onChange(v || undefined)} hint="Dotknięcie telewizora na modelu otworzy pilota" />;
};

/** Rooms whose edge contains the window (one window may border two rooms). */
function roomsAt(L: HouseDef['levels'][number], w: Seg) {
  const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2, t = 0.2;
  return L.rooms.filter((r) => mx >= r.x0 - t && mx <= r.x1 + t && mz >= r.z0 - t && mz <= r.z1 + t).map((r) => r.name).join(' / ');
}

const ColorPick: FC<{ value?: string; onChange(v: string | undefined): void }> = ({ value, onChange }) => (
  <div className="ins-row"><label>Kolor</label><div className="row-btns">
    <input type="color" value={value ?? '#cccccc'} onChange={(e) => onChange(e.target.value)} aria-label="Kolor mebla" />
    {['#f3f2ee', '#2b2d31', '#b49478', '#8e9298'].map((c) => <button key={c} className="mini" style={{ background: c, width: 26, height: 26 }} onClick={() => onChange(c)} aria-label={'Kolor ' + c} />)}
    {value && <button className="mini" onClick={() => onChange(undefined)}>z modelu</button>}
  </div></div>
);

const WindowsTab: FC<{ house: HouseDef; li: number; upLevel: UpLevel }> = ({ house, li, upLevel }) => {
  const L = house.levels[li];
  const setW = (i: number, p: Partial<Seg>) => upLevel(li, (l) => ({ ...l, windows: l.windows.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
  const resize = (i: number, len: number) => {
    const w = L.windows[i], horiz = Math.abs(w.z2 - w.z1) < 1e-3, cx = (w.x1 + w.x2) / 2, cz = (w.z1 + w.z2) / 2, h = Math.max(0.3, len) / 2;
    setW(i, horiz ? { x1: +(cx - h).toFixed(3), x2: +(cx + h).toFixed(3) } : { z1: +(cz - h).toFixed(3), z2: +(cz + h).toFixed(3) });
  };
  return (
    <div className="ins">
      <p className="muted">{L.name}: okna rozpoznane z rzutu. Szerokość zmienia się symetrycznie od środka – ściana obok sama się dopasuje.</p>
      {L.windows.length === 0 && <p className="muted">Na tej kondygnacji nie ma okien.</p>}
      {L.windows.map((w, i) => {
        const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
        return (
          <Section key={i} title={`${roomsAt(L, w) || 'Okno'} · ${len.toFixed(2).replace('.', ',')} m${w.full ? ' · od podłogi' : ''}`} open={false}>
            <NumF label="Szerokość (m)" value={+len.toFixed(2)} step={0.05} min={0.3} max={8} onChange={(v) => v && resize(i, v)} />
            <CheckF label="Od podłogi do sufitu" value={w.full} onChange={(v) => setW(i, { full: v || undefined })} />
          </Section>
        );
      })}
    </div>
  );
};

const GatesTab: FC<{ house: HouseDef; sel: Sel; setSel(s: Sel): void; upLevel: UpLevel }> = ({ house, sel, setSel, upLevel }) => {
  const gates = house.levels.flatMap((l, li) => l.gates.map((g, gi) => ({ li, gi, g, level: l.name })));
  return (
    <div className="ins">
      <p className="muted">Bramy rozpoznane z rzutu (linia przerywana). Przypisz encję cover — model pokaże otwarcie, a dotknięcie przełączy bramę.</p>
      {gates.length === 0 && <p className="muted">Brak bram na rzutach.</p>}
      {gates.map(({ li, gi, g, level }) => (
        <Section key={li + '-' + gi} title={`Brama ${gi + 1} · ${level}`} open={sel?.kind === 'gate' && sel.level === li && sel.index === gi}>
          <EntityF label="Encja" value={g.entity} domains={['cover']} onChange={(v) => {
            setSel({ kind: 'gate', level: li, index: gi });
            upLevel(li, (l) => ({ ...l, gates: l.gates.map((x, i) => (i === gi ? { ...x, entity: v } : x)) }));
          }} />
        </Section>
      ))}
    </div>
  );
};

const SettingsTab: FC<{ house: HouseDef; setHouse(h: HouseDef): void; onReimported(): void }> = ({ house, setHouse, onReimported }) => (
  <div className="ins">
    <Section title="Dom">
      <TextF label="Nazwa" value={house.name} onChange={(v) => setHouse({ ...house, name: v ?? 'Dom' })} />
      <NumF label="Wysokość ścian (m)" value={house.wallHeight} step={0.1} min={2} max={4} onChange={(v) => setHouse({ ...house, wallHeight: v ?? 2.6 })} />
    </Section>
    <Section title="Kondygnacje">
      {house.levels.map((l, i) => (
        <div key={l.id} className="ins-grid4">
          <TextF label="Nazwa" value={l.name} onChange={(v) => setHouse({ ...house, levels: house.levels.map((x, j) => (j === i ? { ...x, name: v ?? x.name } : x)) })} />
          <NumF label="Poziom podłogi (m)" value={l.y} step={0.1} onChange={(v) => setHouse({ ...house, levels: house.levels.map((x, j) => (j === i ? { ...x, y: v ?? 0 } : x)) })} />
          {l.stairs.length > 0 && <SelectF label="Schody" value={l.stairs[0].style ?? 'open'} options={[['open', 'Ażurowe (puste pod spodem)'], ['solid', 'Pełne']]}
            onChange={(v) => setHouse({ ...house, levels: house.levels.map((x, j) => (j === i ? { ...x, stairs: x.stairs.map((st) => ({ ...st, style: v as 'open' | 'solid' })) } : x)) })} />}
          {l.stairs.length > 0 && <EntityF label="LED schodów" value={l.stairs[0].led} domains={['light', 'switch', 'input_boolean']}
            onChange={(v) => setHouse({ ...house, levels: house.levels.map((x, j) => (j === i ? { ...x, stairs: x.stairs.map((st) => ({ ...st, led: v })) } : x)) })} hint="kolor i jasność z encji" />}
          {l.stairs[0]?.led && <SelectF label="Rodzaj LED" value={l.stairs[0].ledStyle ?? 'step'} options={[['step', 'Pasek pod każdym stopniem'], ['side', 'Oprawka przy każdym stopniu']]}
            onChange={(v) => setHouse({ ...house, levels: house.levels.map((x, j) => (j === i ? { ...x, stairs: x.stairs.map((st) => ({ ...st, ledStyle: v as 'step' | 'side' })) } : x)) })} />}
        </div>
      ))}
    </Section>
    <ImportCard replace={house.id} title="Zaimportuj rzuty ponownie" onDone={onReimported} />
  </div>
);
