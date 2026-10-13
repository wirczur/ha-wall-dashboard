import { useEffect, useId, useState, type FC, type ReactNode } from 'react';
import type { DashboardSummary, EntityInfo, HouseSummary, TvApp } from '../../../shared/types';
import { api } from '../lib/api';
import { ICONS } from '../ui/Icon';

// ---------------------------------------------------------------- shared data (loaded once)
let entityCache: Promise<EntityInfo[]> | null = null;
export function useEntityList() {
  const [list, setList] = useState<EntityInfo[]>([]);
  useEffect(() => {
    entityCache ??= api.get<EntityInfo[]>('entities').catch(() => { entityCache = null; return []; });
    entityCache.then(setList);
  }, []);
  return list;
}
let dashCache: Promise<DashboardSummary[]> | null = null;
export function useDashboardList() {
  const [list, setList] = useState<DashboardSummary[]>([]);
  useEffect(() => { dashCache ??= api.get<DashboardSummary[]>('dashboards').catch(() => []); dashCache.then(setList); }, []);
  return list;
}

let houseCache: Promise<HouseSummary[]> | null = null;
export function useHouseList() {
  const [list, setList] = useState<HouseSummary[]>([]);
  useEffect(() => { houseCache ??= api.get<HouseSummary[]>('houses').catch(() => { houseCache = null; return []; }); houseCache.then(setList); }, []);
  return list;
}

let tvCache: Promise<{ id: string; name: string; apps: TvApp[] }[]> | null = null;
export function useTvList() {
  const [list, setList] = useState<{ id: string; name: string; apps: TvApp[] }[]>([]);
  useEffect(() => { tvCache ??= api.get<{ id: string; name: string; apps: TvApp[] }[]>('tvs').catch(() => { tvCache = null; return []; }); tvCache.then(setList); }, []);
  return list;
}

// ---------------------------------------------------------------- layout
export const Section: FC<{ title: string; children: ReactNode; open?: boolean }> = ({ title, children, open = true }) => (
  <details className="ins-sec" open={open}>
    <summary>{title}</summary>
    <div className="ins-body">{children}</div>
  </details>
);

const Row: FC<{ label: string; id: string; hint?: string; children: ReactNode }> = ({ label, id, hint, children }) => (
  <div className="ins-row">
    <label htmlFor={id}>{label}</label>
    <div className="ins-ctl">{children}{hint && <small>{hint}</small>}</div>
  </div>
);

// ---------------------------------------------------------------- inputs (commit on change)
export const TextF: FC<{ label: string; value?: string; onChange(v: string | undefined): void; placeholder?: string; hint?: string; multiline?: boolean }> =
  ({ label, value, onChange, placeholder, hint, multiline }) => {
    const id = useId();
    const set = (v: string) => onChange(v === '' ? undefined : v);
    return (
      <Row label={label} id={id} hint={hint}>
        {multiline
          ? <textarea id={id} rows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
          : <input id={id} value={value ?? ''} placeholder={placeholder} onChange={(e) => set(e.target.value)} />}
      </Row>
    );
  };

export const NumF: FC<{ label: string; value?: number; onChange(v: number | undefined): void; min?: number; max?: number; step?: number; placeholder?: string; hint?: string }> =
  ({ label, value, onChange, min, max, step = 1, placeholder, hint }) => {
    const id = useId();
    return (
      <Row label={label} id={id} hint={hint}>
        <input id={id} type="number" value={value ?? ''} min={min} max={max} step={step} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      </Row>
    );
  };

export const RangeF: FC<{ label: string; value?: number; def: number; onChange(v: number | undefined): void; min: number; max: number; step?: number; unit?: string }> =
  ({ label, value, def, onChange, min, max, step = 1, unit = '' }) => {
    const id = useId();
    const v = value ?? def;
    return (
      <Row label={label} id={id}>
        <div className="ins-range">
          <input id={id} type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(Number(e.target.value))} />
          <span>{step < 1 ? v.toFixed(2) : v}{unit}</span>
          {value != null && <button className="mini" onClick={() => onChange(undefined)} title="Domyślne">×</button>}
        </div>
      </Row>
    );
  };

export const CheckF: FC<{ label: string; value?: boolean; onChange(v: boolean): void }> = ({ label, value, onChange }) => {
  const id = useId();
  return <label className="ins-check" htmlFor={id}><input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
};

export const SelectF: FC<{ label: string; value?: string; options: [string, string][]; onChange(v: string): void; hint?: string }> =
  ({ label, value, options, onChange, hint }) => {
    const id = useId();
    return (
      <Row label={label} id={id} hint={hint}>
        <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Row>
    );
  };

export const ColorF: FC<{ label: string; value?: string; onChange(v: string | undefined): void; allowTransparent?: boolean }> =
  ({ label, value, onChange, allowTransparent }) => {
    const id = useId();
    const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#222630';
    return (
      <Row label={label} id={id}>
        <div className="ins-color">
          <input id={id} type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
          <input value={value ?? ''} placeholder="domyślny" onChange={(e) => onChange(e.target.value || undefined)} />
          {allowTransparent && <button className="mini" onClick={() => onChange('transparent')} title="Przezroczyste">∅</button>}
          {value && <button className="mini" onClick={() => onChange(undefined)} title="Domyślne">×</button>}
        </div>
      </Row>
    );
  };

export const IconF: FC<{ value?: string; onChange(v: string | undefined): void }> = ({ value, onChange }) => {
  const id = useId();
  return (
    <Row label="Ikona" id={id} hint="Wbudowana lub mdi:nazwa (np. mdi:lightbulb-group)">
      <input id={id} list={id + 'l'} value={value ?? ''} placeholder="automatycznie wg encji" onChange={(e) => onChange(e.target.value || undefined)} />
      <datalist id={id + 'l'}>{Object.keys(ICONS).map((k) => <option key={k} value={k} />)}</datalist>
    </Row>
  );
};

export const EntityF: FC<{ label: string; value?: string; onChange(v: string | undefined): void; domains?: string[]; hint?: string }> =
  ({ label, value, onChange, domains, hint }) => {
    const id = useId();
    const all = useEntityList();
    const list = domains ? all.filter((e) => domains.includes(e.domain)) : all;
    const known = !value || all.length === 0 || all.some((e) => e.entity_id === value);
    return (
      <Row label={label} id={id} hint={!known ? 'Nie ma takiej encji w Home Assistant' : hint}>
        <input id={id} list={id + 'l'} value={value ?? ''} placeholder="np. light.salon" className={!known ? 'bad' : ''}
          onChange={(e) => onChange(e.target.value.trim() || undefined)} />
        <datalist id={id + 'l'}>
          {list.slice(0, 2000).map((e) => <option key={e.entity_id} value={e.entity_id}>{e.name}{e.area ? ' · ' + e.area : ''}</option>)}
        </datalist>
      </Row>
    );
  };

export const EntityListF: FC<{ label: string; value?: string[]; onChange(v: string[] | undefined): void; hint?: string }> =
  ({ label, value = [], onChange, hint }) => {
    const [add, setAdd] = useState<string | undefined>();
    return (
      <div className="ins-list">
        <div className="ins-list-head">{label}{hint && <small>{hint}</small>}</div>
        {value.map((e, i) => (
          <div key={e + i} className="ins-chip"><code>{e}</code>
            <button className="mini" onClick={() => { const n = value.filter((_, j) => j !== i); onChange(n.length ? n : undefined); }} aria-label={'Usuń ' + e}>×</button>
          </div>
        ))}
        <div className="ins-list-add">
          <EntityF label="Dodaj" value={add} onChange={setAdd} />
          <button className="btn" disabled={!add} onClick={() => { if (add) { onChange([...value, add]); setAdd(undefined); } }}>Dodaj</button>
        </div>
      </div>
    );
  };

/** "state=label" lines <-> object */
export const MapF: FC<{ label: string; value?: Record<string, string>; onChange(v: Record<string, string> | undefined): void; hint?: string }> =
  ({ label, value, onChange, hint }) => {
    const [text, setText] = useState(() => Object.entries(value || {}).map(([k, v]) => `${k}=${v}`).join('\n'));
    const id = useId();
    return (
      <Row label={label} id={id} hint={hint}>
        <textarea id={id} rows={3} value={text} placeholder={'on=Włączona\noff=Wyłączona'} onChange={(e) => {
          setText(e.target.value);
          const o: Record<string, string> = {};
          for (const line of e.target.value.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
          onChange(Object.keys(o).length ? o : undefined);
        }} />
      </Row>
    );
  };

/** Free JSON object (service data). */
export const JsonF: FC<{ label: string; value?: Record<string, unknown>; onChange(v: Record<string, unknown> | undefined): void }> = ({ label, value, onChange }) => {
  const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 2) : ''));
  const [err, setErr] = useState('');
  const id = useId();
  return (
    <Row label={label} id={id} hint={err || 'JSON, np. {"brightness_pct": 40}'}>
      <textarea id={id} rows={3} className={err ? 'bad' : ''} value={text} onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) { setErr(''); onChange(undefined); return; }
        try { const o = JSON.parse(e.target.value); setErr(''); onChange(o); } catch { setErr('Niepoprawny JSON'); }
      }} />
    </Row>
  );
};

/** Remote sources: TVs paired with the add-on + Home Assistant remote.* entities (e.g. Samsung integration). */
export function useRemoteOptions(): [string, string][] {
  const tvs = useTvList();
  const ents = useEntityList();
  return [
    ...tvs.map((t) => [t.id, `${t.name} (bezpośrednio)`] as [string, string]),
    ...ents.filter((e) => e.domain === 'remote').map((e) => [e.entity_id, `${e.name} (Home Assistant)`] as [string, string])
  ];
}
