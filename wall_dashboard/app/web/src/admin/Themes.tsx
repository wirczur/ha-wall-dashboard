// Admin: own themes (colours, tile style, font, extra CSS) with a live preview on real dashboard widgets.
import { useEffect, useMemo, useState, type FC } from 'react';
import type { CustomTheme, DashboardDoc, DashboardSummary } from '../../../shared/types';
import { api } from '../lib/api';
import { hass } from '../lib/hass';
import { setThemes, THEME_PRESETS } from '../lib/themes';
import { DashboardView } from '../view/DashboardView';
import { Icon } from '../ui/Icon';

const COLOR_FIELDS: [keyof CustomTheme['colors'], string, string][] = [
  ['bg', 'Tło strony', ''], ['tile', 'Kafelek', ''], ['fg', 'Tekst', ''], ['muted', 'Tekst drugorzędny', 'puste = tekst 65%'],
  ['accent', 'Akcent', 'ikony, suwaki, zaznaczenia'], ['on', 'Kafelek „włączony”', 'np. zapalone światło'], ['onText', 'Tekst na „włączonym”', ''],
  ['onIcon', 'Ikona na „włączonym”', 'puste = akcent'], ['ok', 'Kolor „OK”', 'puste = domyślny'], ['err', 'Kolor błędu / alarmu', 'puste = domyślny']
];
const FONTS: [string, string][] = [
  ['', 'Manrope (domyślna)'], ['system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', 'Systemowa'],
  ['"Inter", system-ui, sans-serif', 'Inter (jeśli jest na urządzeniu / w CSS)'], ['Georgia, "Times New Roman", serif', 'Szeryfowa'],
  ['"Roboto Mono", ui-monospace, monospace', 'Monospace']
];
const newId = () => 'th-' + Math.random().toString(36).slice(2, 9);

export const Themes: FC = () => {
  const [list, setList] = useState<CustomTheme[]>([]);
  const [sel, setSel] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { api.get<CustomTheme[]>('themes').then((l) => { setList(l); setThemes(l); setSel(l[0]?.id ?? ''); }).catch((e) => setMsg(e.message)); }, []);
  const cur = list.find((t) => t.id === sel);
  const upd = (p: Partial<CustomTheme>) => {
    const next = list.map((t) => (t.id === sel ? { ...t, ...p } : t));
    setList(next); setThemes(next); setDirty(true);
  };
  const col = (k: keyof CustomTheme['colors'], v?: string) => cur && upd({ colors: { ...cur.colors, [k]: v || undefined } as CustomTheme['colors'] });
  const add = (from: CustomTheme) => {
    const t: CustomTheme = { ...structuredClone(from), id: newId(), name: from.name.replace(/ \(.*\)$/, '') + ' – mój' };
    const next = [...list, t]; setList(next); setThemes(next); setSel(t.id); setDirty(true);
  };
  const save = async () => {
    try { const l = await api.put<CustomTheme[]>('themes', list); setList(l); setThemes(l); setDirty(false); setMsg('Zapisano. Tablety z dashboardami w tym motywie odświeżą się same.'); }
    catch (e: any) { setMsg(e.message); }
  };
  const remove = () => {
    if (!cur || !confirm(`Usunąć motyw „${cur.name}”? Dashboardy z nim wrócą do wyglądu wbudowanego.`)) return;
    const next = list.filter((t) => t.id !== sel); setList(next); setThemes(next); setSel(next[0]?.id ?? ''); setDirty(true);
  };
  const exportJson = async () => {
    if (!cur) return;
    const txt = JSON.stringify(cur, null, 2);
    try { await navigator.clipboard.writeText(txt); setMsg('Skopiowano motyw (JSON) do schowka.'); } catch { window.prompt('Skopiuj motyw:', txt); }
  };
  const importJson = () => {
    const txt = window.prompt('Wklej motyw (JSON):'); if (!txt) return;
    try { const t = JSON.parse(txt) as CustomTheme; if (!t?.colors?.bg) throw new Error('to nie jest motyw'); add({ ...t, name: t.name || 'Zaimportowany' }); }
    catch (e: any) { setMsg('Nie udało się wczytać: ' + e.message); }
  };

  return (
    <section className="a-sec">
      <div className="a-bar">
        <h2>Motywy</h2>
        <div className="row-btns">
          <button className="btn" onClick={importJson}>Importuj</button>
          <button className="btn primary" disabled={!dirty} onClick={save}>Zapisz</button>
        </div>
      </div>
      <p className="muted">Własne kolory, kafelki i czcionka. Motyw wybierasz w edytorze dashboardu: <b>Motyw → Wygląd</b>. Motywy okolicznościowe (Święta, Wielkanoc…) mają pierwszeństwo, jeśli są włączone.</p>
      <div className="th-layout">
        <aside className="card th-list">
          {list.map((t) => (
            <button key={t.id} className={'th-item' + (t.id === sel ? ' on' : '')} onClick={() => setSel(t.id)}>
              <Swatch t={t} /><span>{t.name}</span>
            </button>
          ))}
          {!list.length && <p className="muted small">Nie masz jeszcze własnych motywów. Zacznij od gotowego:</p>}
          <div className="th-new">
            <small className="muted">Nowy motyw na bazie:</small>
            {THEME_PRESETS.map((p) => <button key={p.id} className="btn" onClick={() => add(p)}><Swatch t={p} />{p.name}</button>)}
            {cur && <button className="btn" onClick={() => add(cur)}><Icon name="mdi:content-copy" size={16} />Kopia „{cur.name}”</button>}
          </div>
        </aside>
        {cur ? <div className="card th-edit">
          <div className="ins-grid2">
            <label className="field"><span>Nazwa</span><input value={cur.name} onChange={(e) => upd({ name: e.target.value })} /></label>
            <label className="field"><span>Kafelki</span>
              <select value={cur.base} onChange={(e) => upd({ base: e.target.value as CustomTheme['base'] })}>
                <option value="flat">Pełne (płaskie, bez rozmycia – lżejsze dla słabych paneli)</option>
                <option value="glass">Szkło (półprzezroczyste z rozmyciem)</option>
              </select></label>
          </div>
          <div className="ins-grid2">
            <label className="check"><input type="checkbox" checked={cur.dark} onChange={(e) => upd({ dark: e.target.checked })} />Ciemny motyw (pola formularzy, paski przewijania)</label>
            {cur.base === 'glass' && <label className="field"><span>Krycie kafelków ({Math.round((cur.tileOpacity ?? 0.55) * 100)}%)</span>
              <input type="range" min={0} max={100} value={Math.round((cur.tileOpacity ?? 0.55) * 100)} onChange={(e) => upd({ tileOpacity: Number(e.target.value) / 100 })} /></label>}
          </div>
          <div className="th-colors">
            {COLOR_FIELDS.map(([k, label, hint]) => {
              const v = cur.colors[k];
              return (
                <label key={k} className="th-color" title={hint}>
                  <input type="color" value={v ?? '#888888'} onChange={(e) => col(k, e.target.value)} />
                  <span>{label}{hint && <small className="muted"> · {hint}</small>}</span>
                  <input className="th-hex" value={v ?? ''} placeholder="—" onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) || !e.target.value ? col(k, e.target.value) : null} />
                </label>
              );
            })}
          </div>
          <div className="ins-grid2">
            <label className="field"><span>Zaokrąglenie kafelków ({cur.radius ?? '—'} px)</span>
              <input type="range" min={0} max={40} value={cur.radius ?? 16} onChange={(e) => upd({ radius: Number(e.target.value) })} /></label>
            <label className="field"><span>Czcionka</span>
              <select value={FONTS.some(([f]) => f === (cur.font ?? '')) ? cur.font ?? '' : '__own'} onChange={(e) => e.target.value !== '__own' && upd({ font: e.target.value || undefined })}>
                {FONTS.map(([f, l]) => <option key={l} value={f}>{l}</option>)}
                <option value="__own">Własna (wpisz niżej)</option>
              </select>
              <input value={cur.font ?? ''} placeholder="np. 'Nunito', sans-serif" onChange={(e) => upd({ font: e.target.value || undefined })} /></label>
          </div>
          <details className="th-css" open={!!cur.css}>
            <summary>Własny CSS (zaawansowane)</summary>
            <textarea rows={8} spellCheck={false} value={cur.css ?? ''} onChange={(e) => upd({ css: e.target.value || undefined })}
              placeholder={'/* działa tylko w tym motywie */\n.tile { border-width: 2px; }\n.w-title { text-transform: uppercase; letter-spacing: .06em; }\n@import url("https://fonts.googleapis.com/css2?family=Nunito:wght@400;700&display=swap");'} />
            <small className="muted">Reguły są automatycznie zawężone do tego motywu. Klasy widgetów podejrzysz w przeglądarce (Zbadaj element).</small>
          </details>
          <div className="row-btns">
            <button className="btn" onClick={exportJson}>Eksportuj (JSON)</button>
            <button className="btn danger" onClick={remove}>Usuń motyw</button>
            {msg && <span className="muted small">{msg}</span>}
          </div>
        </div> : <div className="card th-edit muted">Wybierz albo utwórz motyw.</div>}
        {cur && <ThemePreview t={cur} />}
      </div>
      {!cur && msg && <p className="muted small">{msg}</p>}
    </section>
  );
};

const Swatch: FC<{ t: CustomTheme }> = ({ t }) => (
  <i className="th-sw" style={{ background: t.colors.bg }}>
    <b style={{ background: t.colors.tile }} /><b style={{ background: t.colors.on }} /><b style={{ background: t.colors.accent }} />
  </i>
);

/** Live preview: one of the user's dashboards (or a sample) rendered in the theme being edited */
const ThemePreview: FC<{ t: CustomTheme }> = ({ t }) => {
  const [dashes, setDashes] = useState<DashboardSummary[]>([]);
  const [pick, setPick] = useState('');
  const [doc, setDoc] = useState<DashboardDoc | null>(null);
  useEffect(() => { api.get<DashboardSummary[]>('dashboards').then((d) => { setDashes(d); setPick((p) => p || d[0]?.id || ''); }).catch(() => {}); }, []);
  useEffect(() => { if (pick) api.get<DashboardDoc>('dashboards/' + pick).then(setDoc).catch(() => setDoc(null)); }, [pick]);
  const sample = useMemo<DashboardDoc>(() => {
    const light = [...hass.states.keys()].find((e) => e.startsWith('light.'));
    return { id: 'theme-preview', title: 'Podgląd', showTabs: false, theme: { background: { type: 'glass', color: t.colors.bg, image: '', blur: 0, dim: 35 }, accent: t.colors.accent, textColor: t.colors.fg, tileOpacity: 0.55, radius: 16 },
      views: [{ id: 'v', title: 'Podgląd', columns: 12, rowHeight: 56, gap: 12, widgets: [
        { id: 'c', type: 'clock', x: 0, y: 0, w: 6, h: 3, options: { date: 'below' } },
        { id: 'b1', type: 'button', x: 6, y: 0, w: 3, h: 3, title: 'Światło', icon: 'bulb', ...(light ? { entity: light } : {}) },
        { id: 'b2', type: 'button', x: 9, y: 0, w: 3, h: 3, title: 'Brama', icon: 'garage' },
        { id: 't', type: 'text', x: 0, y: 3, w: 12, h: 2, title: 'Tekst', options: { text: 'Tak wygląda tekst i tekst drugorzędny w tym motywie.' } }] }] } as DashboardDoc;
  }, [t.colors.bg, t.colors.accent, t.colors.fg]);
  const base = doc ?? sample;
  const shown: DashboardDoc = { ...base, theme: { ...base.theme, custom: t.id, occasions: false } };
  return (
    <div className="card th-prev">
      <div className="row-btns">
        <b>Podgląd</b>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Przykład</option>
          {dashes.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      </div>
      <div className="th-frame"><DashboardView doc={{ ...shown }} embedded /></div>
    </div>
  );
};
