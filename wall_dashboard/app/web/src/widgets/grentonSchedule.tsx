// Grenton thermostat (wirczur/homeassistant-grenton 0.3+): weekly schedule from the climate attribute
// `weekly_schedule`, edited here and written back with grenton.set_thermostat_schedule (whole week at once).
import { useMemo, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import type { HassState } from '../../../shared/types';
import { hass, useEntity } from '../lib/hass';
import { Icon } from '../ui/Icon';

type Period = { time: string; temperature: number };
type Week = Record<Day, Period[]>;
type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
const DAYS: [Day, string, string][] = [
  ['monday', 'Pon', 'Poniedziałek'], ['tuesday', 'Wt', 'Wtorek'], ['wednesday', 'Śr', 'Środa'], ['thursday', 'Czw', 'Czwartek'],
  ['friday', 'Pt', 'Piątek'], ['saturday', 'Sob', 'Sobota'], ['sunday', 'Nd', 'Niedziela']
];
const WORK: Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], WEEKEND: Day[] = ['saturday', 'sunday'];
const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** schedule of a Grenton climate entity, or null when the entity has none */
export function grentonWeek(s?: HassState): Week | null {
  const w = s?.attributes.weekly_schedule as Record<string, { time: string; temperature: number }[]> | undefined;
  if (!w || typeof w !== 'object' || !DAYS.every(([d]) => Array.isArray(w[d]))) return null;
  return Object.fromEntries(DAYS.map(([d]) => [d, w[d].map((p) => ({ time: String(p.time).slice(0, 5), temperature: Number(p.temperature) }))])) as Week;
}

/** "Harmonogram" button for the climate widget; renders nothing for non-Grenton entities */
export const GrentonScheduleButton: FC<{ entity?: string; title: string; compact?: boolean; notify(m: string): void }> = ({ entity, title, compact, notify }) => {
  const s = useEntity(entity);
  const [open, setOpen] = useState(false);
  if (!entity || !grentonWeek(s)) return null;
  return <>
    <button className={compact ? 'cl-cyc' : 'cl-cyc gs-btn'} onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label="Harmonogram tygodniowy" title="Harmonogram tygodniowy">
      <Icon name="mdi:calendar-clock" size={18} />{!compact && <span>Harmonogram</span>}
    </button>
    {open && <GrentonScheduleEditor entity={entity} title={title} onClose={() => setOpen(false)} notify={notify} />}
  </>;
};

/** blue (coolest temperature of the week) → orange (warmest) */
const color = (t: number, lo: number, hi: number) => {
  const x = hi - lo < 0.5 ? 0.5 : Math.max(0, Math.min(1, (t - lo) / (hi - lo)));
  return `hsl(${Math.round(205 - 180 * x)} ${Math.round(55 + 20 * x)}% ${Math.round(68 - 8 * x)}%)`;
};
const fmt = (t: number) => (Number.isInteger(t) ? t.toFixed(0) : t.toFixed(1)).replace('.', ',') + '°';

/** day as a 24 h bar of coloured segments */
const DayBar: FC<{ periods: Period[]; lo: number; hi: number; labels?: boolean }> = ({ periods, lo, hi, labels }) => (
  <div className="gs-bar">
    {periods.map((p, i) => {
      const a = mins(p.time), b = i + 1 < periods.length ? mins(periods[i + 1].time) : 1440;
      const wd = ((b - a) / 1440) * 100;
      return <i key={i} style={{ left: (a / 1440) * 100 + '%', width: wd + '%', background: color(p.temperature, lo, hi) }} title={`${p.time}–${i + 1 < periods.length ? periods[i + 1].time : '24:00'}: ${fmt(p.temperature)}`}>
        {labels && wd > 7 && <span>{fmt(p.temperature)}</span>}
      </i>;
    })}
  </div>
);

const GrentonScheduleEditor: FC<{ entity: string; title: string; onClose(): void; notify(m: string): void }> = ({ entity, title, onClose, notify }) => {
  const s = useEntity(entity);
  const orig = useMemo(() => grentonWeek(s), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [week, setWeek] = useState<Week | null>(orig);
  const [day, setDay] = useState<Day>(() => DAYS[(new Date().getDay() + 6) % 7][0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const lo = Number(s?.attributes.min_temp ?? 5), hi = Number(s?.attributes.max_temp ?? 30);
  if (!week || !orig) return null;
  const dirty = JSON.stringify(week) !== JSON.stringify(orig);
  const ps = week[day];
  const all = DAYS.flatMap(([d]) => week[d].map((p) => p.temperature));
  const cLo = Math.min(...all), cHi = Math.max(...all); // colour scale of this week

  const setDayPs = (d: Day, list: Period[]) => setWeek({ ...week, [d]: list });
  const setP = (i: number, p: Partial<Period>) => setDayPs(day, ps.map((x, j) => (j === i ? { ...x, ...p } : x)).sort((a, b) => mins(a.time) - mins(b.time)));
  /** new change in the middle of the day's longest period */
  const add = () => {
    let best = 0, len = -1;
    ps.forEach((p, i) => { const l = (i + 1 < ps.length ? mins(ps[i + 1].time) : 1440) - mins(p.time); if (l > len) { len = l; best = i; } });
    if (len < 30) return;
    const at = Math.round((mins(ps[best].time) + len / 2) / 15) * 15;
    const t = TIMES[at / 15];
    setDayPs(day, [...ps, { time: t, temperature: ps[best].temperature }].sort((a, b) => mins(a.time) - mins(b.time)));
  };
  const copyTo = (days: Day[]) => setWeek({ ...week, ...Object.fromEntries(days.filter((d) => d !== day).map((d) => [d, ps.map((p) => ({ ...p }))])) } as Week);
  const step = (i: number, d: number) => setP(i, { temperature: Math.max(lo, Math.min(hi, Math.round((ps[i].temperature + d) * 2) / 2)) });

  const save = async () => {
    // merge neighbours with the same temperature and make sure each day starts at midnight
    const clean = Object.fromEntries(DAYS.map(([d]) => {
      const list = [...week[d]].sort((a, b) => mins(a.time) - mins(b.time));
      if (list[0]?.time !== '00:00') list.unshift({ time: '00:00', temperature: list[0]?.temperature ?? lo });
      return [d, list.filter((p, i) => i === 0 || p.temperature !== list[i - 1].temperature)];
    }));
    setBusy(true); setErr('');
    try { await hass.call('grenton', 'set_thermostat_schedule', { schedule: clean }, entity); onClose(); notify?.('Zapisano harmonogram w Grentonie.'); }
    catch (e: any) { setErr(e.message || 'Nie udało się zapisać'); }
    finally { setBusy(false); }
  };

  return createPortal(
    <div className="rb-map" onClick={onClose} role="dialog" aria-label={'Harmonogram – ' + title}>
      <div className="rb-map-box gs" onClick={(e) => e.stopPropagation()}>
        <div className="rb-map-h"><b><Icon name="mdi:calendar-clock" size={18} /> {title} – harmonogram</b>
          <button className="rb-b ghost" onClick={onClose} aria-label="Zamknij"><Icon name="close" size={20} /></button></div>

        <div className="gs-week" role="tablist" aria-label="Dni tygodnia">
          {DAYS.map(([d, short]) => (
            <button key={d} role="tab" aria-selected={d === day} className="gs-row" onClick={() => setDay(d)}>
              <b>{short}</b><DayBar periods={week[d]} lo={cLo} hi={cHi} labels />
            </button>
          ))}
          <div className="gs-hours" aria-hidden="true"><b /><div>{[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: (h / 24) * 100 + '%' }}>{h}</span>)}</div></div>
        </div>

        <div className="gs-day">
          <div className="gs-day-h"><b>{DAYS.find(([d]) => d === day)![2]}</b>
            <span className="grow" />
            <small>Kopiuj na:</small>
            <button className="gs-lnk" onClick={() => copyTo(WORK)}>dni robocze</button>
            <button className="gs-lnk" onClick={() => copyTo(WEEKEND)}>weekend</button>
            <button className="gs-lnk" onClick={() => copyTo(DAYS.map(([d]) => d))}>cały tydzień</button>
          </div>
          {ps.map((p, i) => (
            <div key={i} className="gs-p">
              <span className="gs-sw" style={{ background: color(p.temperature, cLo, cHi) }} />
              {i === 0 ? <span className="gs-time">00:00</span> : (
                <select className="gs-time" value={p.time} onChange={(e) => setP(i, { time: e.target.value })} aria-label="Od godziny">
                  {TIMES.slice(1).map((t) => <option key={t} value={t} disabled={t !== p.time && ps.some((x) => x.time === t)}>{t}</option>)}
                </select>)}
              <small className="muted">– {i + 1 < ps.length ? ps[i + 1].time : '24:00'}</small>
              <span className="grow" />
              <button className="cl-pm" onClick={() => step(i, -0.5)} disabled={p.temperature <= lo} aria-label="Chłodniej"><Icon name="minus" size={18} /></button>
              <b className="gs-t">{fmt(p.temperature)}</b>
              <button className="cl-pm" onClick={() => step(i, 0.5)} disabled={p.temperature >= hi} aria-label="Cieplej"><Icon name="plus" size={18} /></button>
              <button className="gs-del" onClick={() => setDayPs(day, ps.filter((_, j) => j !== i))} disabled={i === 0} aria-label="Usuń zmianę"><Icon name="close" size={16} /></button>
            </div>
          ))}
          <button className="gs-add" onClick={add} disabled={ps.length >= 24}><Icon name="plus" size={16} /> Dodaj zmianę temperatury</button>
        </div>

        {err && <p className="gs-err">{err}</p>}
        <div className="gs-foot">
          <small className="muted">Zapis nadpisuje cały tydzień w CLU (krok 15 min, 0,5°, {fmt(lo)}–{fmt(hi)}).</small>
          <span className="grow" />
          <button className="rb-b" onClick={() => setWeek(orig)} disabled={!dirty || busy}>Cofnij</button>
          <button className="rb-b primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Zapisuję…' : 'Zapisz'}</button>
        </div>
      </div>
    </div>, document.body
  );
};
