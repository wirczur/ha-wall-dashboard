// Calendar widget: events of Home Assistant calendar entities as an agenda, a week or a month.
import { useEffect, useMemo, useState, type CSSProperties, type FC } from 'react';
import type { WidgetDef } from '../../../shared/types';
import { api } from '../lib/api';
import { useEntities } from '../lib/hass';

export interface CalRef { entity: string; color?: string; name?: string }
interface Ev { calendar: string; summary: string; location?: string; allDay: boolean; start: string; end: string; s: Date; e: Date; color: string }

export const CAL_COLORS = ['#E2A63B', '#5B9BD5', '#7FB36A', '#D86A7A', '#A07BD8', '#4FB8B0', '#E0783B', '#8A93A6'];
const DAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
const DAYS_LONG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_N = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** "2026-10-12" is a local date; everything else is an ISO timestamp */
const parse = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) : new Date(v));
const hhmm = (d: Date) => d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
const mondayOf = (d: Date) => addDays(day0(d), -((d.getDay() + 6) % 7));
/** does the event cover (part of) this day? all-day ends are exclusive */
const onDay = (ev: Ev, d: Date) => ev.s < addDays(d, 1) && (ev.allDay ? ev.e > d : ev.e > d || +ev.e === +ev.s && sameDay(ev.s, d));

export function calRefs(o: Record<string, any>): CalRef[] {
  return (Array.isArray(o.calendars) ? o.calendars : []).filter((c: any) => c && typeof c.entity === 'string' && c.entity.startsWith('calendar.'));
}

function dayLabel(d: Date, today: Date) {
  if (sameDay(d, today)) return 'Dziś';
  if (sameDay(d, addDays(today, 1))) return 'Jutro';
  return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export const CalendarWidget: FC<{ w: WidgetDef }> = ({ w }) => {
  const o = w.options ?? {};
  const refs = calRefs(o);
  const states = useEntities(refs.map((r) => r.entity));
  const layout: 'agenda' | 'week' | 'month' = o.layout && o.layout !== 'auto' ? o.layout : w.w >= 10 && w.h >= 7 ? 'month' : w.w >= 10 && w.h >= 4 ? 'week' : 'agenda';
  const [now, setNow] = useState(() => new Date());
  const [offset, setOffset] = useState(0); // weeks / months shown relative to today
  const [pick, setPick] = useState<Date | null>(null);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const today = day0(now);

  // visible range
  const [from, to] = useMemo(() => {
    if (layout === 'week') { const m = addDays(mondayOf(today), offset * 7); return [m, addDays(m, 7)]; }
    if (layout === 'month') {
      const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const start = mondayOf(first);
      return [start, addDays(start, 42)];
    }
    return [today, addDays(today, Math.max(1, Math.min(60, Number(o.days) || 7)))];
  }, [layout, offset, today.getTime(), o.days]); // eslint-disable-line react-hooks/exhaustive-deps

  const key = refs.map((r) => r.entity).join(',');
  const stamp = states.map((s) => s?.last_updated ?? '').join('|'); // refetch when a calendar entity changes
  useEffect(() => {
    if (!key) return;
    let dead = false;
    const load = () => api.get<Omit<Ev, 's' | 'e' | 'color'>[]>(`calendar?e=${encodeURIComponent(key)}&start=${from.toISOString()}&end=${to.toISOString()}`)
      .then((list) => {
        if (dead) return;
        const color = (c: string, i = refs.findIndex((r) => r.entity === c)) => refs[i]?.color || CAL_COLORS[Math.max(0, i) % CAL_COLORS.length];
        setEvents(list.map((x) => ({ ...x, s: parse(x.start), e: parse(x.end), color: color(x.calendar) })));
        setErr('');
      })
      .catch((e) => !dead && setErr(e.message));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { dead = true; clearInterval(t); };
  }, [key, from.getTime(), to.getTime(), stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!refs.length) return <div className="cal cal-empty">Wybierz kalendarze w ustawieniach widgetu</div>;
  const evs = (events ?? []).filter((e) => !(o.hidePast && !e.allDay && e.e < now));
  const showLoc = o.location !== false;

  const evRow = (ev: Ev, i: number) => (
    <div key={i} className={'cal-ev' + (ev.e < now && !ev.allDay ? ' past' : '') + (ev.s <= now && now < ev.e && !ev.allDay ? ' now' : '')} style={{ '--c': ev.color } as CSSProperties}>
      <span className="cal-t">{ev.allDay ? 'cały dzień' : hhmm(ev.s)}{!ev.allDay && <small>{hhmm(ev.e)}</small>}</span>
      <span className="cal-bar" />
      <span className="cal-s"><b>{ev.summary || '(bez tytułu)'}</b>{showLoc && ev.location && <small>{ev.location}</small>}</span>
    </div>
  );

  const nav = (label: string) => (
    <div className="cal-head">
      <button aria-label="Wstecz" onClick={() => { setOffset(offset - 1); setPick(null); }}>‹</button>
      <b onClick={() => { setOffset(0); setPick(null); }}>{label}</b>
      <button aria-label="Dalej" onClick={() => { setOffset(offset + 1); setPick(null); }}>›</button>
    </div>
  );

  let body;
  if (layout === 'agenda') {
    const days: [Date, Ev[]][] = [];
    for (let d = from; d < to; d = addDays(d, 1)) { const l = evs.filter((e) => onDay(e, d)); if (l.length || sameDay(d, today)) days.push([d, l]); }
    body = (
      <div className="cal-agenda">
        {o.title !== false && <div className="cal-title">{w.title || 'Kalendarz'}</div>}
        {days.map(([d, l]) => (
          <section key={+d}>
            <h4 className={sameDay(d, today) ? 'today' : ''}>{dayLabel(d, today)}</h4>
            {l.length ? l.map(evRow) : <p className="cal-none">Nic zaplanowanego</p>}
          </section>
        ))}
      </div>
    );
  } else if (layout === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    body = (
      <>
        {nav(`${from.getDate()} ${MONTHS[from.getMonth()]} – ${addDays(from, 6).getDate()} ${MONTHS[addDays(from, 6).getMonth()]}`)}
        <div className="cal-week">
          {days.map((d) => (
            <div key={+d} className={'cal-col' + (sameDay(d, today) ? ' today' : '')}>
              <div className="cal-dh"><span>{DAYS[d.getDay()]}</span><b>{d.getDate()}</b></div>
              {evs.filter((e) => onDay(e, d)).map((ev, i) => (
                <div key={i} className={'cal-chip' + (ev.allDay ? ' all' : '')} style={{ '--c': ev.color } as CSSProperties} title={ev.summary}>
                  {!ev.allDay && <small>{hhmm(ev.s)}</small>}<span>{ev.summary}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </>
    );
  } else {
    const month = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const cells = Array.from({ length: 42 }, (_, i) => addDays(from, i));
    const sel = pick ?? (offset === 0 ? today : month);
    const selEvs = evs.filter((e) => onDay(e, sel));
    body = (
      <div className="cal-mwrap">
        <div className="cal-mmain">
          {nav(`${MONTHS_N[month.getMonth()]} ${month.getFullYear()}`)}
          <div className="cal-month">
            {['pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'].map((x) => <span key={x} className="cal-wd">{x}</span>)}
            {cells.map((d) => {
              const l = evs.filter((e) => onDay(e, d));
              return (
                <button key={+d} className={'cal-day' + (d.getMonth() !== month.getMonth() ? ' out' : '') + (sameDay(d, today) ? ' today' : '') + (sameDay(d, sel) ? ' sel' : '')}
                  onClick={() => setPick(d)} aria-label={dayLabel(d, today) + (l.length ? ', wydarzeń: ' + l.length : '')}>
                  <b>{d.getDate()}</b>
                  <span className="cal-dots">{l.slice(0, 4).map((e, i) => <i key={i} style={{ background: e.color }} />)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="cal-side">
          <h4>{dayLabel(sel, today)}</h4>
          {selEvs.length ? selEvs.map(evRow) : <p className="cal-none">Nic zaplanowanego</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={'cal cal-l-' + layout} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {body}
      {refs.length > 1 && o.legend !== false && layout !== 'agenda' && (
        <div className="cal-legend">{refs.map((r, i) => <span key={r.entity}><i style={{ background: r.color || CAL_COLORS[i % CAL_COLORS.length] }} />{r.name || String(states[i]?.attributes.friendly_name ?? r.entity)}</span>)}</div>
      )}
      {err && <div className="cal-err">{err}</div>}
      {events === null && !err && <div className="cal-load">Wczytuję…</div>}
    </div>
  );
};
