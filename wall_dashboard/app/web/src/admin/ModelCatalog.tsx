// Picker for every model of the bundled Kenney Furniture Kit (CC0), with previews, categories and search.
import { useEffect, useMemo, useState, type FC } from 'react';

export interface CatalogItem { name: string; cat: string; w: number; d: number; h: number }

let cache: Promise<CatalogItem[]> | null = null;
export function useCatalog() {
  const [list, setList] = useState<CatalogItem[]>([]);
  useEffect(() => {
    cache ??= fetch('kenney/catalog.json').then((r) => (r.ok ? r.json() : [])).catch(() => { cache = null; return []; });
    cache.then(setList);
  }, []);
  return list;
}

/** "loungeSofaCorner" → "lounge sofa corner" */
export const prettyModel = (n: string) => n.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();

export const ModelCatalog: FC<{ onPick(it: CatalogItem): void; onClose(): void; current?: string }> = ({ onPick, onClose, current }) => {
  const all = useCatalog();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = useMemo(() => [...new Set(all.map((x) => x.cat))].sort((a, b) => a.localeCompare(b, 'pl')), [all]);
  const list = all.filter((x) => (!cat || x.cat === cat) && (!q || (x.name + ' ' + prettyModel(x.name) + ' ' + x.cat).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="cat">
      <div className="cat-head">
        <input autoFocus placeholder="Szukaj: sofa, lamp, kitchen…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj modelu" />
        <button className="mini" onClick={onClose} aria-label="Zamknij katalog">×</button>
      </div>
      <div className="cat-cats">
        <button aria-pressed={!cat} onClick={() => setCat('')}>Wszystkie ({all.length})</button>
        {cats.map((c) => <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="cat-grid">
        {list.map((x) => (
          <button key={x.name} className={'cat-it' + (x.name === current ? ' sel' : '')} onClick={() => onPick(x)} title={`${x.name} · ${x.w.toFixed(2)}×${x.d.toFixed(2)}×${x.h.toFixed(2)} m`}>
            <img src={'kenney/preview/' + x.name + '.png'} alt="" loading="lazy" draggable={false} />
            <span>{prettyModel(x.name)}</span>
          </button>
        ))}
        {all.length > 0 && list.length === 0 && <p className="muted">Nic nie pasuje.</p>}
      </div>
    </div>
  );
};
