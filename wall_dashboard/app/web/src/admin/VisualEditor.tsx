import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FC, type PointerEvent as RPE } from 'react';
import type { DashboardDoc, ViewDef, WidgetDef, WidgetType } from '../../../shared/types';
import { Icon } from '../ui/Icon';
import { Background, TabBar, themeVars, tileStyle } from '../view/DashboardView';
import { WIDGETS } from '../widgets/widgets';
import { DashboardInspector, WidgetInspector } from './Inspector';
import { WidgetGallery } from './WidgetGallery';
import { useLook } from '../lib/occasion';

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
}

/** Drag & drop grid editor with a property inspector. Edits the same JSON as the code editor. */
export const VisualEditor: FC<Props> = ({ doc, onChange, size }) => {
  const [viewId, setViewId] = useState(doc.views[0]?.id);
  const [selId, setSelId] = useState<string | null>(null);
  const view = doc.views.find((v) => v.id === viewId) ?? doc.views[0];
  const sel = view?.widgets.find((w) => w.id === selId) ?? null;

  useEffect(() => { if (!doc.views.some((v) => v.id === viewId)) setViewId(doc.views[0]?.id); }, [doc, viewId]);

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
    setSelId(w.id);
  };
  const remove = () => { if (!sel) return; setView({ ...view, widgets: view.widgets.filter((w) => w.id !== sel.id) }); setSelId(null); };
  const duplicate = () => {
    if (!sel) return;
    const c: WidgetDef = { ...structuredClone(sel), id: uniqueId(sel.type), y: freeY() };
    setView({ ...view, widgets: [...view.widgets, c] }); setSelId(c.id);
  };

  // keyboard: delete, duplicate, nudge, resize
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!sel || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
      else if (e.key === 'Escape') setSelId(null);
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (e.shiftKey) setWidget({ ...sel, w: clamp(sel.w + dx, 1, view.columns - sel.x), h: Math.max(1, sel.h + dy) });
        else setWidget({ ...sel, x: clamp(sel.x + dx, 0, view.columns - sel.w), y: Math.max(0, sel.y + dy) });
      }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  if (!view) return <p className="muted">Brak widoków.</p>;

  return (
    <div className="ve">
      <div className="ve-main">
        <div className="ve-bar">
          {doc.views.length > 1 && (
            <div className="seg" role="tablist" aria-label="Widok">
              {doc.views.map((v) => <button key={v.id} aria-pressed={v.id === view.id} onClick={() => { setViewId(v.id); setSelId(null); }}>{v.title}{v.panelOnly ? ' · panel' : ''}</button>)}
            </div>
          )}
          <button className="primary" onClick={() => setGallery(true)}>＋ Dodaj widget</button>
          <span className="muted">Przeciągnij, aby przesunąć · róg = rozmiar · strzałki / Shift+strzałki · Del · Ctrl+D</span>
        </div>
        {gallery && <WidgetGallery doc={doc} onClose={() => setGallery(false)} onPick={(p) => { setGallery(false); addWidget(p.type, p.patch); }} />}
        <Canvas doc={doc} view={view} size={size} selId={selId} onSelect={setSelId} onWidget={setWidget} />
      </div>
      <aside className="ve-side">
        {sel
          ? <WidgetInspector key={sel.id} w={sel} view={view} doc={doc} onChange={(w) => setWidget(w)} onDelete={remove} onDuplicate={duplicate} />
          : <DashboardInspector doc={doc} viewId={view.id} onChange={(d) => onChange(d)} onSelectView={(id) => { setViewId(id); setSelId(null); }} />}
      </aside>
    </div>
  );
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- canvas
const Canvas: FC<{
  doc: DashboardDoc; view: ViewDef; size: SizeKey; selId: string | null;
  onSelect(id: string | null): void; onWidget(w: WidgetDef, commit?: boolean): void;
}> = ({ doc, view, size, selId, onSelect, onWidget }) => {
  const [W, H] = SIZES[size];
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
      <div className="ve-canvas" data-skin={look.skin} style={{ width: W, height: contentH, transform: `scale(${scale})`, ...themeVars(doc.theme, look.skin) }}
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
