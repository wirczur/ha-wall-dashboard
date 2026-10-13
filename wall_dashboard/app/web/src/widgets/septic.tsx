// Septic tank (szambo): fill level in %, optional distance sensor, "time left" entity, capacity in m³,
// warning / alarm thresholds, history (weeks) → last emptying, fill rate, forecast; three looks:
//  tank (illustration), ring (1:1 tile, tap = details), bar (level bar + history sparkline).
import { useEffect, useMemo, useState, type FC } from 'react';
import type { HassState, WidgetDef } from '../../../shared/types';
import { api, longHistoryPath } from '../lib/api';
import { formatNumber, friendly } from '../lib/format';
import { hass, useEntities, useEntity } from '../lib/hass';
import { Icon } from '../ui/Icon';

type Pt = { t: number; v: number; min?: number };
export type SepticLayout = 'tank' | 'ring' | 'bar';

export const septicLayout = (w: WidgetDef): SepticLayout => {
  const l = w.options?.layout;
  if (l === 'tank' || l === 'ring' || l === 'bar') return l;
  if (w.w >= w.h * 2) return 'bar';
  if (w.w <= 3 && w.h <= 3) return 'ring';
  return 'tank';
};

const DAY = 864e5;
const num = (s?: HassState) => (s && s.state !== '' && isFinite(Number(s.state)) ? Number(s.state) : undefined);

/** Emptying = level falls by ≥ minDrop points within 2 days. */
function emptyings(pts: Pt[], minDrop: number): number[] {
  const out: number[] = [];
  let i = 0;
  for (let j = 0; j < pts.length; j++) {
    while (pts[j].t - pts[i].t > 2 * DAY) i++;
    let max = -Infinity;
    for (let k = i; k < j; k++) max = Math.max(max, pts[k].v);
    const low = pts[j].min ?? pts[j].v;
    if (max - low >= minDrop && (!out.length || pts[j].t - out[out.length - 1] > 3 * DAY)) out.push(pts[j].t);
  }
  return out;
}
/** Fill rate in % per day: least squares since the last emptying (or over the whole window). */
function fillRate(pts: Pt[], since: number): number | undefined {
  const p = pts.filter((x) => x.t > since + 6 * 3600_000);
  if (p.length < 12 || p[p.length - 1].t - p[0].t < 2 * DAY) return undefined;
  const n = p.length, mx = p.reduce((s, x) => s + x.t, 0) / n, my = p.reduce((s, x) => s + x.v, 0) / n;
  let a = 0, b = 0;
  for (const x of p) { a += (x.t - mx) * (x.v - my); b += (x.t - mx) ** 2; }
  const perMs = b ? a / b : 0;
  return perMs > 0 ? perMs * DAY : undefined;
}
/** "time left" entity → days (unit d / h / min, default days) */
function daysOf(s?: HassState): number | undefined {
  const v = num(s); if (v == null) return undefined;
  const u = String(s!.attributes.unit_of_measurement ?? 'd').toLowerCase();
  return /^h|godz/.test(u) ? v / 24 : /^min/.test(u) ? v / 1440 : /^s/.test(u) ? v / 86400 : /^(w|tydz)/.test(u) ? v * 7 : v;
}
const plDays = (d: number) => d < 1 ? 'mniej niż dzień' : `${Math.round(d)} ${Math.round(d) === 1 ? 'dzień' : 'dni'}`;
const dateShort = (t: number) => new Date(t).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' });

export function useSeptic(w: WidgetDef) {
  const o = w.options ?? {};
  const s = useEntity(w.entity);
  const [dist, left, orderE] = useEntities([o.distance ?? '', o.remaining ?? '', o.orderEntity ?? '']);
  const [pts, setPts] = useState<Pt[] | null>(null);
  const days = Number(o.days) || 60;
  useEffect(() => {
    if (!w.entity) return;
    let alive = true;
    const load = () => api.get<Pt[]>(longHistoryPath(w.entity!, days)).then((p) => alive && setPts(p)).catch(() => alive && setPts([]));
    load(); const t = setInterval(load, 30 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [w.entity, days]);

  const pct = num(s);
  const warn = Number(o.warn ?? 75), alarm = Number(o.alarm ?? 90);
  const cap = Number(o.capacity) || 0;
  const stats = useMemo(() => {
    if (!pts?.length) return {};
    const ev = emptyings(pts, Number(o.drop) || 30);
    const last = ev[ev.length - 1];
    const rate = fillRate(pts, last ?? 0);
    const every = ev.length >= 2 ? (ev[ev.length - 1] - ev[0]) / (ev.length - 1) / DAY : undefined;
    return { last, rate, every, ev };
  }, [pts, o.drop]);
  const leftDays = left ? daysOf(left) : pct != null && stats.rate ? Math.max(0, (100 - pct) / stats.rate) : undefined;
  const level = pct == null ? 'none' : pct >= alarm ? 'alarm' : pct >= warn ? 'warn' : 'ok';
  const order = () => {
    navigator.vibrate?.(10);
    if (o.orderEntity) {
      const d = o.orderEntity.split('.')[0];
      return hass.call(d, d === 'button' || d === 'input_button' ? 'press' : 'turn_on', undefined, o.orderEntity);
    }
    if (o.orderPhone) location.href = 'tel:' + String(o.orderPhone).replace(/\s/g, '');
  };
  const canOrder = !!(o.orderEntity || o.orderPhone);
  return { o, s, dist, left, orderE, pts, pct, warn, alarm, cap, stats, leftDays, level, order, canOrder };
}
type Septic = ReturnType<typeof useSeptic>;

export const SepticWidget: FC<{ w: WidgetDef; notify?(m: string): void; onOpen?(): void }> = ({ w, notify, onOpen }) => {
  const d = useSeptic(w);
  if (!w.entity) return <div className="sp sp-empty"><Icon name="mdi:water-percent" size={28} /><span>Wskaż czujnik poziomu szamba (%)</span></div>;
  if (!d.s) return <div className="sp sp-empty">Brak encji {w.entity}</div>;
  const order = () => { const r = d.order(); if (r && 'catch' in r) r.catch((e: Error) => notify?.(e.message)); };
  const L = septicLayout(w);
  if (L === 'ring') return <SepticRing w={w} d={d} onOpen={onOpen} />;
  if (L === 'bar') return <SepticBar w={w} d={d} order={order} />;
  return <SepticTank w={w} d={d} order={order} />;
};

const title = (w: WidgetDef, d: Septic) => w.title || friendly(d.s, w.entity!).replace(/ (poziom|level|napełnienie)$/i, '') || 'Szambo';
const vol = (d: Septic) => d.cap && d.pct != null ? formatNumber((d.cap * d.pct) / 100, 1) + ' m³' : '';
const leftText = (d: Septic) => d.leftDays == null ? '' : d.pct != null && d.pct >= 100 ? 'pełne' : '~' + plDays(d.leftDays);

const SepticTank: FC<{ w: WidgetDef; d: Septic; order(): void }> = ({ w, d, order }) => {
  const p = Math.max(0, Math.min(100, d.pct ?? 0));
  return (
    <div className={'sp sp-tank lvl-' + d.level} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sp-hd"><b>{title(w, d)}</b><span>{d.cap ? d.cap + ' m³' : d.dist ? `${d.dist.state} ${d.dist.attributes.unit_of_measurement ?? ''}` : ''}</span></div>
      <div className="sp-vessel" role="img" aria-label={`Poziom ${d.pct ?? '?'}%`}>
        <div className="sp-liq" style={{ height: p + '%' }} />
        <div className="sp-mark alarm" style={{ bottom: d.alarm + '%' }}><span>{d.alarm}%</span></div>
        <div className="sp-mark warn" style={{ bottom: d.warn + '%' }}><span>{d.warn}%</span></div>
        <div className="sp-big"><b>{d.pct == null ? '–' : formatNumber(d.pct, 0) + '%'}</b>{vol(d) && <small>{vol(d)}</small>}</div>
      </div>
      <div className="sp-ft">
        {d.leftDays != null && <span><small>pełne za</small><b>{leftText(d)}</b></span>}
        {d.stats.last && <span className="r"><small>ostatni wywóz</small><b>{dateShort(d.stats.last)} · {plDays((Date.now() - d.stats.last) / DAY)} temu</b></span>}
      </div>
      {d.canOrder && <button className={'sp-order' + (d.level !== 'ok' ? ' hot' : '')} onClick={order}><Icon name={d.o.orderEntity ? 'mdi:truck-outline' : 'mdi:phone'} size={18} />{d.o.orderLabel || 'Zamów wywóz'}</button>}
    </div>
  );
};

const SepticRing: FC<{ w: WidgetDef; d: Septic; onOpen?(): void }> = ({ w, d, onOpen }) => {
  const R = 44, C = 2 * Math.PI * R, p = Math.max(0, Math.min(100, d.pct ?? 0));
  return (
    <button className={'sp sp-ring lvl-' + d.level} onClick={(e) => { e.stopPropagation(); onOpen?.(); }} aria-label={`${title(w, d)}: ${d.pct ?? '?'}%`}>
      <div className="sp-r">
        <svg viewBox="0 0 100 100" aria-hidden><circle cx="50" cy="50" r={R} className="sp-track" /><circle cx="50" cy="50" r={R} className="sp-prog" strokeDasharray={`${(C * p) / 100} ${C}`} transform="rotate(-90 50 50)" /></svg>
        <div className="sp-mid"><b>{d.pct == null ? '–' : formatNumber(d.pct, 0) + '%'}</b><small>{d.level === 'alarm' ? 'zamów!' : leftText(d) || vol(d)}</small></div>
      </div>
      <span className="sp-name">{title(w, d)}</span>
    </button>
  );
};

const SepticBar: FC<{ w: WidgetDef; d: Septic; order(): void }> = ({ w, d, order }) => {
  const p = Math.max(0, Math.min(100, d.pct ?? 0));
  const pts = d.pts ?? [];
  const path = useMemo(() => {
    if (pts.length < 2) return '';
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    return pts.map((x, i) => `${i ? 'L' : 'M'}${(((x.t - t0) / (t1 - t0 || 1)) * 400).toFixed(1)},${(38 - (Math.max(0, Math.min(100, x.v)) / 100) * 36).toFixed(1)}`).join(' ');
  }, [pts]);
  const full = d.leftDays != null ? Date.now() + d.leftDays * DAY : undefined;
  const perWeek = d.stats.rate ? d.stats.rate * 7 : undefined;
  return (
    <div className={'sp sp-bar lvl-' + d.level} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sp-hd"><b>{title(w, d)}</b>
        <span>{[d.cap && d.pct != null ? `${vol(d)} z ${d.cap} m³` : '', full && !(d.pct != null && d.pct >= 100) ? 'pełne ok. ' + dateShort(full) : ''].filter(Boolean).join(' · ')}</span>
        <em>{d.pct == null ? '–' : formatNumber(d.pct, 0) + '%'}</em></div>
      <div className="sp-lbar"><i style={{ width: p + '%' }} /><span className="m warn" style={{ left: d.warn + '%' }} /><span className="m alarm" style={{ left: d.alarm + '%' }} /></div>
      {w.h >= 2 && path && (
        <svg className="sp-spark" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden>
          <path d={path} />
          {(d.stats.ev ?? []).map((t) => { const t0 = pts[0].t, t1 = pts[pts.length - 1].t; const x = ((t - t0) / (t1 - t0 || 1)) * 400; return <line key={t} x1={x} x2={x} y1="0" y2="40" />; })}
        </svg>
      )}
      <div className="sp-chips">
        {perWeek != null && <span>+{d.cap ? formatNumber((d.cap * perWeek) / 100, 1) + ' m³' : formatNumber(perWeek, 0) + '%'} / tydzień</span>}
        {d.stats.last && <span>ostatni wywóz {dateShort(d.stats.last)}</span>}
        {d.stats.every && <span>śr. co {d.stats.every >= 14 ? Math.round(d.stats.every / 7) + ' tyg.' : Math.round(d.stats.every) + ' dni'}</span>}
        {d.dist && <span>{formatNumber(Number(d.dist.state), 0)} {d.dist.attributes.unit_of_measurement ?? ''} do lustra</span>}
        {d.canOrder && <button className={'sp-chip-btn' + (d.level !== 'ok' ? ' hot' : '')} onClick={order}><Icon name={d.o.orderEntity ? 'mdi:truck-outline' : 'mdi:phone'} size={14} />{d.o.orderLabel || 'Zamów'}</button>}
      </div>
    </div>
  );
};
