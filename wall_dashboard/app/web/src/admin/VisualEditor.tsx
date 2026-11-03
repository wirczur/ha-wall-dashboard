import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FC, type PointerEvent as RPE } from 'react';
import type { DashboardDoc, Tablet, ViewDef, WidgetDef, WidgetType } from '../../../shared/types';
import { api } from '../lib/api';
import { hass } from '../lib/hass';
import { Icon } from '../ui/Icon';
import { Background, TabBar, themeVars, lookVars, tileStyle } from '../view/DashboardView';
import { WIDGETS } from '../widgets/widgets';
import { DashboardInspector, WidgetInspector } from './Inspector';
import { WidgetGallery } from './WidgetGallery';
import { useLook, type Skin } from '../lib/occasion';

export const SIZES = { tablet: [1280, 800, 'Tablet 16:10'], tablet15: [1440, 900, 'Tablet 15″'], panel: [640, 640, 'Panel 1:1'], phone: [390, 844, 'Telefon'] } as const;
export type SizeKey = keyof typeof SIZES;
const PAD = 12;      // matches .dash padding
const TABS_H = 57;   // top tab bar height incl. margin
const BOTTOM_H = 74; // bottom bar height incl. margin
const RAIL_W = 92;   // extra left padding of the side rail

interface Props {
  doc: DashboardDoc;
  /** commit: true = new undo step; false = live update while dragging */
  onChange(doc: DashboardDoc, commit?: boolean): void;
  size: SizeKey;
  /** show the canvas in a seasonal skin (preview only, not saved) */
  occasion?: Skin;
}
type ITab = 'widget' | 'view' | 'dashboard';
const QUICK: [WidgetType, string][] = [['button', 'Przycisk'], ['value', 'Wartość'], ['climate', 'Klimat'], ['camera', 'Kamera'], ['media', 'Odtwarzacz'], ['clock', 'Zegar']];
const wName = (w: WidgetDef) => w.title?.replace(/\{[^}]*\}/g, '…') || (w.entity && hass.states.get(w.entity)?.attributes?.friendly_name as string) || WIDGETS[w.type]?.label || w.type;

/** Drag & drop grid editor: structure on the left, canvas in the middle, inspector (widget / view / dashboard) on the right. */
export const VisualEditor: FC<Props> = ({ doc, onChange, size, occasion }) => {
  const [viewId, setViewId] = useState(doc.views[0]?.id);
  const [selId, setSelId] = useState<string | null>(null);
  const [itab, setItab] = useState<ITab>('dashboard');
  const view = doc.views.find((v) => v.id === viewId) ?? doc.views[0];
  const sel = view?.widgets.find((w) => w.id === selId) ?? null;
  const nStates = useSyncExternalStore(hass.subscribe, () => hass.states.size); // entity list known → warnings

  useEffect(() => { if (!doc.views.some((v) => v.id === viewId)) setViewId(doc.views[0]?.id); }, [doc, viewId]);
  const select = (id: string | null) => { setSelId(id); if (id) setItab('widget'); else setItab((t) => (t === 'widget' ? 'view' : t)); };
  const openView = (id: string) => { setViewId(id); setSelId(null); setItab((t) => (t === 'widget' ? 'view' : t)); };

  const setView = (v: ViewDef, commit = true) => onChange({ ...doc, views: doc.views.map((x) => (x.id === v.id ? v : x)) }, commit);
  const setWidget = (w: WidgetDef, commit = true) => setView({ ...view, widgets: view.widgets.map((x) => (x.id === w.id ? w : x)) }, commit);
  const uniqueId = (base: string) => { let n = 1; const all = new Set(doc.views.flatMap((v) => v.widgets.map((w) => w.id))); while (all.has(base + n)) n++; return base + n; };
  const freeY = () => view.widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);

  const [gallery, setGallery] = useState(false);
  const addWidget = (type: WidgetType, patch: Partial<WidgetDef> = {}) => {
    const d = WIDGETS[type].defaults;
    const w: WidgetDef = JSON.parse(JSON.stringify({ id: uniqueId(type), type, x: 0, y: freeY(), w: d.w ?? 4, h: d.h ?? 2, ...structuredClone(d), ...patch }));
    w.x = 0; w.y = freeY();
    w.w = Math.min(w.w, view.columns);
    setView({ ...view, widgets: [...view.widgets, w] });
    select(w.id);
  };
  const remove = () => { if (!sel) return; setView({ ...view, widgets: view.widgets.filter((w) => w.id !== sel.id) }); select(null); };
  const duplicate = () => {
    if (!sel) return;
    const c: WidgetDef = { ...structuredClone(sel), id: uniqueId(sel.type), y: freeY() };
    setView({ ...view, widgets: [...view.widgets, c] }); select(c.id);
  };
  const addView = (panel: boolean) => {
    let n = doc.views.length + 1; while (doc.views.some((v) => v.id === 'widok' + n)) n++;
    const v: ViewDef = { id: 'widok' + n, title: panel ? 'Panel ' + n : 'Widok ' + n, columns: view.columns, rowHeight: view.rowHeight, gap: view.gap, widgets: [], ...(panel ? { panelOnly: true } : {}) };
    onChange({ ...doc, views: [...doc.views, v] }); setViewId(v.id); setSelId(null); setItab('view');
  };
  const moveView = (id: string, d: number) => {
    const i = doc.views.findIndex((v) => v.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= doc.views.length) return;
    const n = [...doc.views]; [n[i], n[j]] = [n[j], n[i]]; onChange({ ...doc, views: n });
  };

  // keyboard: delete, duplicate, nudge, resize
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!sel || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
      else if (e.key === 'Escape') select(null);
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (e.shiftKey) setWidget({ ...sel, w: clamp(sel.w + dx, 1, view.columns - sel.x), h: Math.max(1, sel.h + dy) });
        else setWidget({ ...sel, x: clamp(sel.x + dx, 0, view.columns - sel.w), y: Math.max(0, sel.y + dy) });
      }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const warnings = useMemo(() => docWarnings(doc), [doc, nStates]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return <p className="muted">Brak widoków.</p>;
  const tabsV = doc.views.filter((v) => !v.panelOnly), panelsV = doc.views.filter((v) => v.panelOnly);
  const treeView = (v: ViewDef) => (
    <div key={v.id} className="vt-view">
      <div className={'vt-row' + (v.id === view.id ? ' on' : '')}>
        <button className="vt-name" onClick={() => openView(v.id)} onDoubleClick={() => { openView(v.id); setItab('view'); }}>
          <Icon name={v.panelOnly ? 'mdi:dock-right' : v.icon || 'mdi:tab'} size={16} /><span>{v.title}</span><small>{v.widgets.length}</small>
        </button>
        <span className="vt-mv">
          <button className="mini" onClick={() => moveView(v.id, -1)} aria-label={'Przesuń ' + v.title + ' wyżej'}>↑</button>
          <button className="mini" onClick={() => moveView(v.id, 1)} aria-label={'Przesuń ' + v.title + ' niżej'}>↓</button>
        </span>
      </div>
      {v.id === view.id && <div className="vt-ws">
        {[...v.widgets].sort((a, b) => a.y - b.y || a.x - b.x).map((w) => (
          <button key={w.id} className={'vt-w' + (w.id === selId ? ' on' : '') + (warnings.bad.has(w.id) ? ' bad' : '')} onClick={() => select(w.id)} title={WIDGETS[w.type]?.label}>
            <span>{wName(w)}</span><small>{w.w}×{w.h}</small>
          </button>
        ))}
        {!v.widgets.length && <small className="muted">pusty – dodaj widget niżej</small>}
      </div>}
    </div>
  );

  return (
    <div className="ve ve3">
      <aside className="ve-tree">
        <div className="vt-h">Widoki<button className="mini" onClick={() => addView(false)} aria-label="Nowy widok" title="Nowy widok">+</button></div>
        {tabsV.map(treeView)}
        <div className="vt-h">Panele boczne<button className="mini" onClick={() => addView(true)} aria-label="Nowy panel" title="Nowy widok tylko do panelu bocznego">+</button></div>
        {panelsV.map(treeView)}
        {!panelsV.length && <small className="muted vt-hint">Widok otwierany z kafelka (np. pokój) – nie jest zakładką.</small>}
        <div className="vt-h">Dodaj widget</div>
        <div className="vt-add">
          {QUICK.map(([t, l]) => <button key={t} className="btn" onClick={() => addWidget(t)}>{l}</button>)}
          <button className="btn primary" onClick={() => setGallery(true)}>Więcej…</button>
        </div>
      </aside>
      <div className="ve-main">
        <div className="ve-bar">
          {tabsV.length > 1 && !view.panelOnly && <div className="seg" role="tablist" aria-label="Widok">
            {tabsV.map((v) => <button key={v.id} aria-pressed={v.id === view.id} onClick={() => openView(v.id)}>{v.title}</button>)}
          </div>}
          {view.panelOnly && <span className="pill">panel boczny: {view.title}</span>}
          <span className="grow" />
          <span className="muted small">Siatka {view.columns} kol. · wiersz {view.rowHeight} px · odstęp {view.gap}</span>
        </div>
        {gallery && <WidgetGallery doc={doc} onClose={() => setGallery(false)} onPick={(p) => { setGallery(false); addWidget(p.type, p.patch); }} />}
        <Canvas doc={doc} view={view} size={size} selId={selId} onSelect={select} onWidget={setWidget} occasion={occasion} />
        <span className="muted small ve-hint">Przeciągnij, aby przesunąć · róg = rozmiar · strzałki / Shift+strzałki · Del usuwa · Ctrl+D duplikuje · Ctrl+Z cofa</span>
        <UsedOn doc={doc} />
      </div>
      <aside className="ve-side">
        <div className="ins-tabs" role="tablist">
          {([['widget', 'Widget'], ['view', 'Widok'], ['dashboard', 'Dashboard']] as [ITab, string][]).map(([k, l]) =>
            <button key={k} role="tab" aria-selected={itab === k} onClick={() => setItab(k)}>{l}</button>)}
        </div>
        {itab === 'widget' && (sel
          ? <WidgetInspector key={sel.id} w={sel} view={view} doc={doc} onChange={(w) => setWidget(w)} onDelete={remove} onDuplicate={duplicate} />
          : <p className="muted small">Kliknij widget na podglądzie albo na liście po lewej.</p>)}
        {itab === 'view' && <DashboardInspector part="view" doc={doc} viewId={view.id} onChange={(d) => onChange(d)} onSelectView={openView} />}
        {itab === 'dashboard' && <DashboardInspector part="dashboard" doc={doc} viewId={view.id} onChange={(d) => onChange(d)} onSelectView={openView} />}
        {warnings.list.length > 0 && <div className="ve-warn">
          <b>Ostrzeżenia</b>
          {warnings.list.map((x, i) => (
            <button key={i} onClick={() => { if (x.view) { setViewId(x.view); } if (x.widget) select(x.widget); }}><i className="dot warn" />{x.text}</button>
          ))}
        </div>}
      </aside>
    </div>
  );
};

/** unknown entities, overlapping widgets, side panels nothing opens */
function docWarnings(doc: DashboardDoc) {
  const list: { text: string; view?: string; widget?: string }[] = [];
  const bad = new Set<string>();
  const known = hass.states.size > 0;
  for (const v of doc.views) {
    for (const w of v.widgets) {
      const miss = [w.entity, w.secondary].filter((e): e is string => !!e && known && !hass.states.has(e) && !/[{}]/.test(e));
      if (miss.length) { bad.add(w.id); list.push({ text: `„${w.title || WIDGETS[w.type]?.label}” (${v.title}): nie ma encji ${miss.join(', ')}`, view: v.id, widget: w.id }); }
    }
    const ws = v.widgets;
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const a = ws[i], b = ws[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        bad.add(a.id); bad.add(b.id);
        list.push({ text: `${v.title}: „${a.title || WIDGETS[a.type]?.label}” nachodzi na „${b.title || WIDGETS[b.type]?.label}”`, view: v.id, widget: b.id });
      }
    }
  }
  const json = JSON.stringify(doc.views);
  for (const v of doc.views.filter((x) => x.panelOnly)) if (!json.includes(`"view":"${v.id}"`)) list.push({ text: `Panel „${v.title}” nie jest otwierany przez żaden kafelek`, view: v.id });
  return { list: list.slice(0, 12), bad };
}

/** tablets showing this dashboard; toggling assigns it right away (independent of "Zapisz") */
const UsedOn: FC<{ doc: DashboardDoc }> = ({ doc }) => {
  const [tablets, setTablets] = useState<Tablet[]>([]);
  useEffect(() => { api.get<Tablet[]>('tablets').then(setTablets).catch(() => {}); }, []);
  const look = useLook({ ...doc.theme, occasions: false });
  const toggle = async (t: Tablet) => {
    const on = t.dashboards.includes(doc.id);
    const dashboards = on ? t.dashboards.filter((x) => x !== doc.id) : [...t.dashboards, doc.id];
    setTablets((l) => l.map((x) => (x.id === t.id ? { ...x, dashboards } : x)));
    await api.put('tablets/' + t.id, { ...t, dashboards });
  };
  return (
    <div className="ve-used">
      <span className="muted small">Używany na:</span>
      {tablets.map((t) => <button key={t.id} className={'chip' + (t.dashboards.includes(doc.id) ? ' on' : '')} onClick={() => toggle(t)}
        title={t.dashboards.includes(doc.id) ? 'Kliknij, aby odłączyć od tego tabletu' : 'Kliknij, aby przypisać do tego tabletu'}>{t.name}{t.dashboards[0] === doc.id ? ' · start' : ''}</button>)}
      <span className="grow" />
      <span className="muted small">Motyw: {look.custom?.name ?? (doc.theme.skin === 'mech' ? 'Mech i mosiądz' : doc.theme.skin && doc.theme.skin !== 'glass' ? doc.theme.skin : 'Szkło')}{doc.theme.occasions ? ' + okolicznościowe' : ''}</span>
    </div>
  );
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- canvas
const Canvas: FC<{
  doc: DashboardDoc; view: ViewDef; size: SizeKey; selId: string | null; occasion?: Skin;
  onSelect(id: string | null): void; onWidget(w: WidgetDef, commit?: boolean): void;
}> = ({ doc: doc0, view, size, selId, onSelect, onWidget, occasion }) => {
  const [W, H] = SIZES[size];
  const doc = occasion ? { ...doc0, theme: { ...doc0.theme, occasions: false, custom: undefined, skin: occasion } } : doc0;
  const look = useLook(doc.theme);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / W)));
    ro.observe(el); return () => ro.disconnect();
  }, [W]);

  const tabViews = doc.views.filter((v) => !v.panelOnly);
  const tabs = doc.showTabs !== false && tabViews.length > 1 && !view.panelOnly;
  const tabStyle = doc.tabStyle ?? 'top';
  const floating = !!doc.tabFloat && tabStyle !== 'top' && tabStyle !== 'rail';
  const top = PAD + (floating ? 0 : tabs && (tabStyle === 'top' || tabStyle === 'pills') ? TABS_H : tabs && tabStyle === 'tilesTop' ? BOTTOM_H : 0) + 2;
  const left = PAD + 2 + (tabs && tabStyle === 'rail' ? RAIL_W : 0);
  const bottomBar = tabs && !floating && (tabStyle === 'bottom' || tabStyle === 'tiles') ? BOTTOM_H : 0;
  const al = doc.tabAlign ?? 'center';
  const hpos: CSSProperties = al === 'left' ? { left: PAD } : al === 'right' ? { right: PAD } : { left: '50%', transform: 'translateX(-50%)' };
  const innerW = W - (left - 2) - PAD - 4;
  const cellW = (innerW - view.gap * (view.columns - 1)) / view.columns;
  const stepX = cellW + view.gap, stepY = view.rowHeight + view.gap;
  const rows = Math.max(Math.ceil((H - top - PAD - bottomBar) / stepY), view.widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0) + 2);
  const contentH = Math.max(H, top + rows * stepY + PAD);

  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; orig: WidgetDef; moved: boolean } | null>(null);
  const [live, setLive] = useState<WidgetDef | null>(null);

  const down = (e: RPE, w: WidgetDef, mode: 'move' | 'size') => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: w.id, mode, sx: e.clientX, sy: e.clientY, orig: w, moved: false };
    onSelect(w.id);
  };
  const move = (e: RPE) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const o = d.orig;
    const n = d.mode === 'move'
      ? { ...o, x: clamp(Math.round(o.x + dx / stepX), 0, view.columns - o.w), y: Math.max(0, Math.round(o.y + dy / stepY)) }
      : { ...o, w: clamp(Math.round(o.w + dx / stepX), 1, view.columns - o.x), h: Math.max(1, Math.round(o.h + dy / stepY)) };
    setLive(n);
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (d?.moved && live && (live.x !== d.orig.x || live.y !== d.orig.y || live.w !== d.orig.w || live.h !== d.orig.h)) onWidget(live, true);
    setLive(null);
  };

  return (
    <div className="ve-canvas-box" ref={box}>
      <div className="ve-canvas" data-skin={look.skin} data-theme={look.custom?.id} style={{ width: W, height: contentH, transform: `scale(${scale})`, ...lookVars(doc.theme, look) }}
        onPointerDown={() => onSelect(null)}>
        <div className={'dash embedded' + (tabs ? ' tabs-' + tabStyle + (floating ? ' tabs-float' : '') : '')} style={{ height: contentH }}>
          <Background theme={doc.theme} skin={look.skin} />
          {tabs && <TabBar views={tabViews} active={view.id} style={tabStyle} align={doc.tabAlign} inert
            css={floating ? { position: 'absolute', ...hpos, margin: 0, ...(tabStyle === 'bottom' || tabStyle === 'tiles' ? { top: H - 64 - 18 } : { top: 18 }), zIndex: 30, pointerEvents: 'none', opacity: .92 } : tabStyle === 'bottom' || tabStyle === 'tiles' ? { position: 'absolute', ...hpos, margin: 0, top: H - BOTTOM_H + 10 - PAD, zIndex: 3 } : tabStyle === 'rail' ? { height: H - PAD * 2, bottom: 'auto' } : undefined} />}
        </div>
        {/* grid cells */}
        <div className="ve-cells" style={{ top, left, width: innerW, height: rows * stepY,
          backgroundSize: `${stepX}px ${stepY}px`,
          backgroundImage: `linear-gradient(to right, rgba(255,255,255,.07) ${cellW}px, transparent ${cellW}px), linear-gradient(to bottom, transparent ${view.rowHeight}px, rgba(0,0,0,.25) ${view.rowHeight}px)` }} />
        {view.widgets.map((w0) => {
          const w = live && live.id === w0.id ? live : w0;
          const C = WIDGETS[w.type]?.component;
          return (
            <div key={w.id}
              className={'tile t-' + w.type + ' ve-w' + (w.id === selId ? ' sel' : '')}
              style={{ ...tileStyle(w.style), position: 'absolute', left: left + w.x * stepX, top: top + w.y * stepY,
                width: w.w * stepX - view.gap, height: w.h * stepY - view.gap }}
              onPointerDown={(e) => down(e, w0, 'move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <div className="ve-content">{C ? <C w={w} /> : w.type}</div>
              <span className="ve-label">{w.title || WIDGETS[w.type]?.label} · {w.w}×{w.h}</span>
              <span className="ve-handle" onPointerDown={(e) => down(e, w0, 'size')} onPointerMove={move} onPointerUp={up} aria-hidden="true" />
            </div>
          );
        })}
      </div>
      <div style={{ height: contentH * scale }} />
    </div>
  );
};
