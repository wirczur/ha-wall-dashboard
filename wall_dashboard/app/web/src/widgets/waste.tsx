// Waste collection: "when" + "what" from two entities, or the next events of a calendar, with bin colours per waste type.
import { useEffect, useState, type CSSProperties, type FC } from 'react';
import type { WidgetDef } from '../../../shared/types';
import { api } from '../lib/api';
import { useEntities } from '../lib/hass';

const TYPES: [RegExp, string, string][] = [
  [/szk[łl]o|zielon\S* (worek|work|pojemnik|kontener)/i, '#3BA55C', 'Szkło'],
  [/bio|kuchen|zielone|br[aą]zow/i, '#8B5A2B', 'Bio'],
  [/plasti|metal|tworzyw|żółt|zolt/i, '#E3B21F', 'Plastik i metale'],
  [/papier|makulat|niebiesk/i, '#3D7BD9', 'Papier'],
  [/zmiesz|reszt|komunal|czarn/i, '#5B5F66', 'Zmieszane'],
  [/gabaryt|wielkogab/i, '#8E6BBF', 'Gabaryty'],
  [/popi[oó][łl]/i, '#9AA0A6', 'Popiół'],
  [/szamb|nieczysto/i, '#6B4E3D', 'Szambo']
];
export const wasteColor = (name: string, custom?: Record<string, string>) => {
  const c = custom && Object.entries(custom).find(([k]) => k && name.toLowerCase().includes(k.toLowerCase()));
  return c?.[1] ?? TYPES.find(([r]) => r.test(name))?.[1] ?? 'var(--accent)';
};
/** Is this name one of the known waste types (or one with a custom colour)? */
export const isKnownWaste = (name: string, custom?: Record<string, string>) =>
  TYPES.some(([r]) => r.test(name)) || (!!custom && Object.keys(custom).some((k) => k && name.toLowerCase().includes(k.toLowerCase())));
/** "Metale i tworzywa sztuczne" → "Plastik i metale": one name per known type so the same bin is not shown twice. */
const canonical = (name: string) => TYPES.find(([r]) => r.test(name))?.[2] ?? name;
/** Types of one event / state, known ones under their common name, without repeats. */
const typesOf = (s: string, onlyKnown: boolean, custom?: Record<string, string>) => {
  const out: string[] = [];
  for (const t of splitTypes(s)) {
    if (onlyKnown && !isKnownWaste(t, custom)) continue;
    const n = canonical(t);
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
};
const splitTypes = (s: string) => s.split(/\s*(?:[,;+/]|\si\s)\s*/).map((x) => x.trim()).filter(Boolean);

const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const DAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

/** Reads "when" from a state: number of days, a date / timestamp, or Polish text ("jutro", "za 3 dni"). */
export function parseWhen(v: unknown, now = new Date()): { days?: number; date?: Date; text?: string } {
  if (v == null || v === '' || v === 'unknown' || v === 'unavailable') return {};
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) { const days = Math.round(Number(s)); return { days, date: new Date(day0(now).getTime() + days * 864e5) }; }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : /^\d{4}-\d{2}-\d{2}T/.test(s) ? new Date(s) : null;
  const pl = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  const date = iso ?? (pl ? new Date(+pl[3], +pl[2] - 1, +pl[1]) : null);
  if (date && !isNaN(+date)) return { date, days: Math.round((day0(date).getTime() - day0(now).getTime()) / 864e5) };
  if (/dzi[sś]/i.test(s)) return { days: 0, text: s };
  if (/pojutrze/i.test(s)) return { days: 2, text: s };
  if (/jutro/i.test(s)) return { days: 1, text: s };
  const m = s.match(/za\s+(\d+)/i) ?? s.match(/(\d+)\s*dni/i);
  if (m) return { days: Number(m[1]), text: s };
  return { text: s };
}
export const whenLabel = (days?: number) => days == null ? '' : days < 0 ? 'minęło' : days === 0 ? 'Dziś' : days === 1 ? 'Jutro' : days === 2 ? 'Pojutrze' : `za ${days} dni`;

interface Pickup { what: string[]; days?: number; date?: Date; text?: string }

const Bin: FC<{ color: string; size?: number }> = ({ color, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 7h14l-1.2 13.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" fill={color} />
    <rect x="3.5" y="4" width="17" height="3" rx="1" fill={color} opacity=".85" />
    <path d="M9 10.5v7M12 10.5v7M15 10.5v7" stroke="rgba(0,0,0,.28)" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const WasteWidget: FC<{ w: WidgetDef }> = ({ w }) => {
  const o = w.options ?? {};
  const custom: Record<string, string> | undefined = o.colors;
  const onlyKnown = o.onlyKnown !== false;
  const [whenS, whatS] = useEntities([o.when ?? '', o.what ?? '']);
  const [cal, setCal] = useState<Pickup[] | null>(null);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 10 * 60_000); return () => clearInterval(t); }, []);
  const count = Math.max(1, Math.min(6, Number(o.count) || 1));
  const alertDays = o.alertDays ?? 1;

  useEffect(() => {
    if (!o.calendar) { setCal(null); return; }
    let dead = false;
    const start = day0(now), end = new Date(start.getTime() + (Number(o.range) || 31) * 864e5);
    api.get<{ summary: string; start: string }[]>(`calendar?e=${encodeURIComponent(o.calendar)}&start=${start.toISOString()}&end=${end.toISOString()}`)
      .then((list) => {
        if (dead) return;
        const by = new Map<number, Pickup>();
        for (const ev of list) {
          const allDay = !ev.start.includes('T');
          const date = allDay ? new Date(+ev.start.slice(0, 4), +ev.start.slice(5, 7) - 1, +ev.start.slice(8, 10)) : day0(new Date(ev.start));
          const days = Math.round((date.getTime() - day0(now).getTime()) / 864e5);
          if (days < 0) continue;
          const types = typesOf(ev.summary, onlyKnown, custom);
          if (!types.length) continue; // unknown event (e.g. a reminder) – skipped, the next known pickup is shown
          const cur = by.get(+date) ?? { what: [], days, date };
          for (const t of types) if (!cur.what.some((x) => x.toLowerCase() === t.toLowerCase())) cur.what.push(t);
          by.set(+date, cur);
        }
        setCal([...by.values()].sort((a, b) => (a.days ?? 99) - (b.days ?? 99)));
        setErr('');
      })
      .catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [o.calendar, o.range, onlyKnown, JSON.stringify(custom ?? {}), now.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps

  let items: Pickup[] = [];
  if (o.calendar) items = (cal ?? []).slice(0, count);
  else if (o.when || o.what) {
    const wv = o.whenAttr ? whenS?.attributes[o.whenAttr] : whenS?.state;
    const wt = o.whatAttr ? whatS?.attributes[o.whatAttr] : whatS?.state;
    items = [{ ...parseWhen(wv, now), what: wt && !['unknown', 'unavailable'].includes(String(wt)) ? typesOf(String(wt), onlyKnown && !!o.when, custom) : [] }];
    if (!o.when && whatS) { const p = parseWhen(whatS.state, now); if (p.days != null) items[0] = { ...p, what: [] }; }
  }

  if (!o.calendar && !o.when && !o.what) return <div className="ws ws-empty">Wskaż encje „kiedy” i „co” albo kalendarz wywozu</div>;
  if (o.calendar && cal === null && !err) return <div className="ws ws-empty">Wczytuję…</div>;
  if (!items.length) return <div className="ws ws-empty">{err || o.emptyText || `Brak wywozów w ciągu ${Number(o.range) || 31} dni`}</div>;

  const first = items[0];
  const soon = first.days != null && first.days >= 0 && first.days <= alertDays;
  const mainColor = wasteColor(first.what[0] || w.title || '', custom);
  const dateTxt = (p: Pickup) => p.date ? `${DAYS[p.date.getDay()]} ${p.date.getDate()}.${String(p.date.getMonth() + 1).padStart(2, '0')}` : '';
  const compact = w.h <= 2 || items.length === 1;

  return (
    <div className={'ws' + (soon ? ' ws-soon' : '') + (compact ? ' ws-compact' : '')} style={{ '--wc': mainColor } as CSSProperties}>
      {(compact ? [first] : items).map((p, i) => (
        <div key={i} className={'ws-row' + (i === 0 ? ' first' : '')}>
          <div className="ws-bins">{(p.what.length ? p.what : ['']).slice(0, 3).map((t, j) => <Bin key={j} color={wasteColor(t || w.title || '', custom)} size={i === 0 ? 30 : 22} />)}</div>
          <div className="ws-txt">
            <b>{p.what.length ? p.what.join(' + ') : (w.title || 'Wywóz')}</b>
            <small>{[p.days != null ? whenLabel(p.days) : p.text, p.days != null && p.days > 1 ? dateTxt(p) : p.days != null && p.days <= 1 ? dateTxt(p) : ''].filter(Boolean).join(' · ')}</small>
          </div>
          {i === 0 && p.days != null && p.days >= 0 && p.days <= 9 && !compact && <span className="ws-big">{p.days === 0 ? 'dziś' : p.days === 1 ? 'jutro' : p.days}</span>}
        </div>
      ))}
      {compact && items.length > 1 && <div className="ws-next">potem: {items.slice(1, 3).map((p) => `${p.what.join(' + ')} ${dateTxt(p)}`).join(', ')}</div>}
    </div>
  );
};

