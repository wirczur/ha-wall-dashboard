import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FC } from 'react';
import type { DashboardDoc, PanelDef, TabStyle, ThemeDef, ViewDef, WidgetDef, WidgetStyle } from '../../../shared/types';
import { defaultTap, isInteractive, runAction, type ActionCtx } from '../lib/actions';
import { useConnection } from '../lib/hass';
import { Icon } from '../ui/Icon';
import { WIDGETS } from '../widgets/widgets';
import { PanelRowView } from './PanelRows';
import { useLook } from '../lib/occasion';
import { SeasonFx } from '../ui/SeasonFx';

const RemoteLazy = lazy(() => import('../remote/Remote').then((m) => ({ default: m.Remote })));

interface Props {
  doc: DashboardDoc;
  /** dashboards reachable with a "dashboard" action (kiosk: the tablet's list) */
  onDashboard?(id: string): void;
  /** fills the parent instead of the window (admin preview) */
  embedded?: boolean;
}

export const DashboardView: FC<Props> = ({ doc, onDashboard, embedded }) => {
  const tabs = doc.views.filter((v) => !v.panelOnly);
  const [viewId, setViewId] = useState((tabs[0] ?? doc.views[0])?.id);
  const view = doc.views.find((v) => v.id === viewId) ?? tabs[0] ?? doc.views[0];
  const [panel, setPanel] = useState<{ def: PanelDef; w: WidgetDef } | null>(null);
  const [toast, setToast] = useState('');
  const conn = useConnection();

  useEffect(() => { if (!doc.views.some((v) => v.id === viewId)) setViewId(doc.views[0]?.id); }, [doc, viewId]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  const ctx: ActionCtx = useMemo(() => ({
    setView: (id) => { setPanel(null); setViewId(id); },
    setDashboard: (id) => { setPanel(null); onDashboard ? onDashboard(id) : setToast('Przejście do innego dashboardu działa na tablecie'); },
    openPanel: (def, w) => setPanel({ def, w }),
    notify: setToast
  }), [onDashboard]);

  const tabStyle: TabStyle = doc.tabStyle ?? 'top';
  const atBottom = tabStyle === 'bottom' || tabStyle === 'tiles';
  const floating = !!doc.tabFloat && tabStyle !== 'top' && tabStyle !== 'rail';
  const look = useLook(doc.theme);
  // full-screen (kiosk): the skin also covers pop-ups and the page background
  useEffect(() => {
    if (embedded) return;
    const el = document.documentElement;
    if (look.skin) el.dataset.skin = look.skin; else delete el.dataset.skin;
    return () => { delete el.dataset.skin; };
  }, [embedded, look.skin]);
  const showBar = doc.showTabs !== false && tabs.length > 1 && !!view;

  // swipe like pages of a book: left → next view, right → previous (tab views only)
  const dashRef = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState<'' | 'next' | 'prev'>('');
  const swipeOn = !embedded && doc.swipeViews !== false && tabs.length > 1;
  // the listeners stay attached for the whole gesture – live HA updates re-render many times a second
  const nav = useRef({ tabs, viewId: view?.id, ctx });
  nav.current = { tabs, viewId: view?.id, ctx };
  useEffect(() => {
    const el = dashRef.current; if (!el || !swipeOn) return;
    let start: { x: number; y: number; t: number } | null = null;
    const blocked = (t: EventTarget | null) => {
      for (let n = t as HTMLElement | null; n && n !== el; n = n.parentElement) {
        if (n.matches('input, textarea, select, canvas, video, [data-noswipe], .drawer, .popup-scrim, .ic-scrim')) return true;
        const cs = getComputedStyle(n);
        // elements that handle horizontal drags themselves (sliders, dials, remote pad) or scroll sideways
        if (cs.touchAction === 'none') return true;
        if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 2) return true;
      }
      return false;
    };
    let done = false;
    const down = (e: TouchEvent) => {
      done = false;
      start = e.touches.length === 1 && !blocked(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    };
    // decide while the finger moves: phones may cancel the touch once they start scrolling, so touchend is not reliable
    const check = (x: number, y: number) => {
      if (!start || done) return;
      const dx = x - start.x, dy = y - start.y;
      if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // a vertical scroll – not a swipe
      if (Date.now() - start.t > 900 || Math.abs(dx) < Math.max(50, el.clientWidth * 0.1) || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      done = true; start = null;
      const { tabs: ts, viewId: cur, ctx: c } = nav.current;
      const i = ts.findIndex((v) => v.id === cur);
      const j = i + (dx < 0 ? 1 : -1);
      if (i < 0 || j < 0 || j >= ts.length) return;
      setSlide(dx < 0 ? 'next' : 'prev');
      c.setView(ts[j].id);
    };
    const move = (e: TouchEvent) => { if (e.touches.length === 1) check(e.touches[0].clientX, e.touches[0].clientY); else start = null; };
    const up = (e: TouchEvent) => { const p = e.changedTouches[0]; if (p) check(p.clientX, p.clientY); start = null; };
    const cancel = () => { start = null; };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('touchcancel', cancel, { passive: true });
    return () => { el.removeEventListener('touchstart', down); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', up); el.removeEventListener('touchcancel', cancel); };
  }, [swipeOn]);
  // a tap on a tab is not a swipe: no slide animation
  const pick = useCallback((id: string) => { setSlide(''); ctx.setView(id); }, [ctx]);

  return (
    <div ref={dashRef} data-skin={look.skin} className={'dash' + (embedded ? ' embedded' : '') + (showBar ? ' tabs-' + tabStyle + (floating ? ' tabs-float' : '') : '')} style={themeVars(doc.theme, look.skin)}>
      <Background theme={doc.theme} skin={look.skin} />
      <SeasonFx kind={look.fx} />
      {showBar && !atBottom && <TabBar views={tabs} active={view.id} style={tabStyle} align={doc.tabAlign} onPick={pick} />}
      {view ? <Grid key={view.id} view={view} ctx={ctx} slide={slide} /> : <div className="empty">Ten dashboard nie ma widoków.</div>}
      {showBar && atBottom && <TabBar views={tabs} active={view.id} style={tabStyle} align={doc.tabAlign} onPick={pick} />}
      {panel && <Drawer def={panel.def} fallbackTitle={panel.w.title} onClose={() => setPanel(null)} onError={setToast} doc={doc} ctx={ctx} />}
      {(!conn.online || !conn.ha) && (
        <div className="conn" role="status">{!conn.online ? 'Brak połączenia z add-onem — ponawiam…' : 'Add-on nie ma połączenia z Home Assistant'}</div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
};

/** View switcher: classic tabs, pills, a bottom bar (icon + label) or a vertical rail. Shared with the visual editor. */
export const TabBar: FC<{ views: ViewDef[]; active?: string; style: TabStyle; align?: 'left' | 'center' | 'right'; onPick?(id: string): void; inert?: boolean; css?: CSSProperties }> = ({ views, active, style, align, onPick, inert, css }) => {
  const iconic = style === 'bottom' || style === 'rail' || style === 'tiles' || style === 'tilesTop';
  return (
    <nav className={'vtabs vt-' + (style === 'tilesTop' ? 'tiles top' : style) + ' al-' + (align ?? 'center')} role={inert ? undefined : 'tablist'} aria-hidden={inert || undefined} aria-label="Widoki" style={css}>
      {views.map((v) => (
        <button key={v.id} role={inert ? undefined : 'tab'} tabIndex={inert ? -1 : undefined} aria-selected={v.id === active} onClick={() => onPick?.(v.id)}>
          {(v.icon || iconic) && <Icon name={v.icon || 'dot'} size={iconic ? 22 : 18} />}<span>{v.title}</span>
        </button>
      ))}
    </nav>
  );
};

export function themeVars(t: ThemeDef, skin: string | undefined = t.skin): CSSProperties {
  // a skin brings its own colours; only the radius from the theme still applies
  if (skin && skin !== 'glass') return { '--radius': t.radius + 'px' } as CSSProperties;
  return {
    '--accent': t.accent, '--fg': t.textColor, '--tile-op': String(t.tileOpacity), '--radius': t.radius + 'px'
  } as CSSProperties;
}

/** Inline style for a tile from its `style` settings (shared with the visual editor). */
export function tileStyle(s: WidgetStyle = {}): CSSProperties {
  return {
    ...(s.background ? { background: s.background } : {}),
    ...(s.color ? { color: s.color } : {}),
    ...(s.radius != null ? { borderRadius: s.radius } : {}),
    ...(s.padding != null ? { padding: s.padding } : {}),
    ...(s.border === false ? { border: 'none', backdropFilter: 'none', WebkitBackdropFilter: 'none' } : {}),
    ...(s.opacity != null && !s.background ? { '--tile-op': String(s.opacity) } : {}),
    ...(s.accent ? { '--accent': s.accent } : {}),
    '--fs': String(s.fontScale ?? 1)
  } as CSSProperties;
}

export const Background: FC<{ theme: ThemeDef; skin?: string }> = ({ theme, skin = theme.skin }) => {
  const b = theme.background;
  if (b.type === 'color') return <div className="bg" style={{ background: b.color }} />;
  if (b.type === 'glass' && skin && skin !== 'glass') return <div className="bg" style={{ background: 'var(--bg)' }} />;
  if (b.type === 'image' && b.image) {
    return (
      <div className="bg">
        <div className="bg-img" style={{ backgroundImage: `url("${b.image}")`, filter: b.blur ? `blur(${b.blur}px)` : undefined, transform: b.blur ? 'scale(1.06)' : undefined }} />
        <div className="bg-dim" style={{ opacity: b.dim / 100 }} />
      </div>
    );
  }
  return <div className="bg bg-glass" />;
};

// ---------------------------------------------------------------- grid
const Grid: FC<{ view: ViewDef; ctx: ActionCtx; slide?: '' | 'next' | 'prev' }> = ({ view, ctx, slide }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    // wall panels keep their grid; phones get one column. Tablet setting (Tablety → Układ) wins over the width.
    const mode = () => document.documentElement.dataset.layout;
    // a view designed for small screens (≤ 6 columns, e.g. 4 for a 480×480 panel) never collapses
    const ro = new ResizeObserver(() => setNarrow(mode() === 'stack' || (mode() !== 'grid' && view.columns > 6 && el.clientWidth < 500)));
    ro.observe(el); return () => ro.disconnect();
  }, [view.columns]);
  const widgets = useMemo(() => [...view.widgets].sort((a, b) => a.y - b.y || a.x - b.x), [view.widgets]);
  const style: CSSProperties = narrow
    ? { gridTemplateColumns: '1fr', gap: view.gap }
    : { gridTemplateColumns: `repeat(${view.columns}, minmax(0, 1fr))`, gridAutoRows: view.rowHeight + 'px', gap: view.gap };
  return (
    <div className={'grid' + (narrow ? ' stack' : '') + (slide ? ' slide-' + slide : '')} ref={ref} style={style}>
      {widgets.map((w) => (
        <WidgetFrame key={w.id} w={w} ctx={ctx}
          place={narrow ? { minHeight: Math.max(1, w.h) * view.rowHeight * 0.75 } : { gridColumn: `${w.x + 1} / span ${w.w}`, gridRow: `${w.y + 1} / span ${w.h}` }} />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------- one widget
const HOLD_MS = 550;

const WidgetFrame: FC<{ w: WidgetDef; ctx: ActionCtx; place: CSSProperties }> = ({ w, ctx, place }) => {
  const meta = WIDGETS[w.type];
  const tap = defaultTap(w);
  const hold = w.hold;
  const interactive = !meta?.ownInteraction && (isInteractive(tap) || (!!hold && isInteractive(hold)));
  const timer = useRef<number>();
  const held = useRef(false);
  const start = useRef<[number, number] | null>(null);

  const fire = useCallback((a = tap) => runAction(a, w, ctx), [tap, w, ctx]);
  const style: CSSProperties = { ...place, ...tileStyle(w.style) };

  if (!meta) return <div className="tile" style={style}><div className="w-center w-sub">Nieznany widget: {w.type}</div></div>;
  const C = meta.component;

  const al = { 'data-ha': w.style?.align, 'data-va': w.style?.valign };
  if (!interactive) return <div className={'tile t-' + w.type} style={style} {...al}><C w={w} ctx={ctx} /></div>;

  return (
    <div
      className={'tile t-' + w.type + ' tap'}
      style={style}
      {...al}
      role="button"
      tabIndex={0}
      aria-label={w.title || w.entity || meta.label}
      onPointerDown={(e) => {
        held.current = false; start.current = [e.clientX, e.clientY];
        if (hold) timer.current = window.setTimeout(() => { held.current = true; navigator.vibrate?.(15); fire(hold); }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        if (start.current && Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 12) { clearTimeout(timer.current); start.current = null; }
      }}
      onPointerUp={() => { clearTimeout(timer.current); if (start.current && !held.current) fire(); start.current = null; }}
      onPointerCancel={() => { clearTimeout(timer.current); start.current = null; }}
      onContextMenu={(e) => hold && e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } }}
    >
      <C w={w} ctx={ctx} />
    </div>
  );
};

// ---------------------------------------------------------------- side panel
const Drawer: FC<{ def: PanelDef; fallbackTitle?: string; onClose(): void; onError(m: string): void; doc?: DashboardDoc; ctx?: ActionCtx }> = ({ def, fallbackTitle, onClose, onError, doc, ctx }) => {
  const pview = def.view ? doc?.views.find((v) => v.id === def.view) : undefined;
  const cams = def.rows.filter((r) => r.display === 'camera' || (!r.display || r.display === 'auto') && r.entity.startsWith('camera.')).length;
  const size = !def.size || def.size === 'auto' ? (pview ? 'large' : cams >= 2 ? 'wide' : 'normal') : def.size;
  const grid = def.layout === 'grid' || ((!def.layout || def.layout === 'auto') && cams >= 2);
  const cols = Math.max(1, Math.min(4, def.columns ?? (size === 'large' || size === 'full' ? 3 : 2)));
  const closeRef = useRef<HTMLButtonElement>(null);
  // a tile opens the panel on pointer-up; the browser's click that follows the same touch would land on the
  // freshly drawn backdrop and close the panel at once – ignore backdrop clicks right after opening
  const openedAt = useRef(performance.now());
  const closeFromScrim = () => { if (performance.now() - openedAt.current > 450) onClose(); };
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={closeFromScrim} />
      <section className={'drawer size-' + size + (def.mode === 'center' ? ' center' : '') + (grid ? ' grid' : '')} role="dialog" aria-modal="true" aria-label={def.title || fallbackTitle || 'Panel'}>
        <header className="d-head">
          <div>
            {def.subtitle && <div className="d-sub">{def.subtitle}</div>}
            <h2>{def.title || fallbackTitle || 'Panel'}</h2>
          </div>
          <button ref={closeRef} className="d-close" onClick={onClose} aria-label="Zamknij"><Icon name="close" /></button>
        </header>
        {def.remote && <Suspense fallback={null}><RemoteLazy tv={def.remote} /></Suspense>}
        {def.widget && WIDGETS[def.widget.type] && (() => {
          const C = WIDGETS[def.widget!.type].component;
          return <div className={'tile d-widget t-' + def.widget!.type}><C w={{ ...def.widget!, style: { ...def.widget!.style, hideTitle: true } }} ctx={{ setView() {}, setDashboard() {}, openPanel() {}, notify: onError }} /></div>;
        })()}
        {pview && ctx && <div className="d-view"><Grid view={pview} ctx={ctx} /></div>}
        <div className="d-rows" style={grid ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
          {def.rows.length === 0 && !def.remote && !def.widget && !pview && <p className="d-sub">Panel nie ma jeszcze żadnych encji.</p>}
          {def.rows.map((r, i) => {
            const span = !grid ? 0 : r.span === 0 ? cols : Math.min(cols, r.span ?? 1);
            return grid
              ? <div key={i + r.entity} className="d-cell" style={{ gridColumn: `span ${span}` }}><PanelRowView row={r} onError={onError} /></div>
              : <PanelRowView key={i + r.entity} row={r} onError={onError} />;
          })}
        </div>
      </section>
    </>
  );
};
