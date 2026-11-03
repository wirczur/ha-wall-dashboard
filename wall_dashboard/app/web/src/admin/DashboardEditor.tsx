import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react';
import type { DashboardDoc, TabletLive } from '../../../shared/types';
import { SKINS, type Skin } from '../lib/occasion';
import { api } from '../lib/api';
import { Icon } from '../ui/Icon';
import { DashboardView } from '../view/DashboardView';
import { WIDGETS } from '../widgets/widgets';
import { Entities } from './AdminApp';
import { SIZES, VisualEditor, type SizeKey } from './VisualEditor';

type Mode = 'visual' | 'json' | 'preview';

/** Editor shell: visual editor, JSON editor and live preview over one document, with undo/redo and save. */
export const DashboardEditor: FC<{ id: string; onBack(): void }> = ({ id, onBack }) => {
  const [doc, setDoc] = useState<DashboardDoc | null>(null);
  const [saved, setSaved] = useState('');
  const [mode, setMode] = useState<Mode>('visual');
  const [size, setSize] = useState<SizeKey>(() => (sessionStorage.getItem('wd.size') as SizeKey) || 'tablet');
  useEffect(() => { try { sessionStorage.setItem('wd.size', size); } catch { /* */ } }, [size]);
  const [occasion, setOccasion] = useState<Skin | ''>('');
  const [onTablet, setOnTablet] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const lastPush = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    api.get<DashboardDoc>('dashboards/' + id).then((d) => { setDoc(d); setSaved(JSON.stringify(d)); })
      .catch((e) => setMsg({ kind: 'err', text: e.message }));
  }, [id]);

  /** Apply a change; typing bursts within 600 ms share one undo step. */
  const change = useCallback((next: DashboardDoc, commit = true) => {
    setDoc((prev) => {
      if (prev && commit) {
        const now = Date.now();
        if (now - lastPush.current > 600 || undo.current.length === 0) undo.current.push(JSON.stringify(prev));
        if (undo.current.length > 100) undo.current.shift();
        lastPush.current = now;
        redo.current = [];
      }
      return next;
    });
    force((n) => n + 1);
  }, []);

  const doUndo = useCallback(() => {
    const p = undo.current.pop(); if (!p || !doc) return;
    redo.current.push(JSON.stringify(doc)); lastPush.current = 0; setDoc(JSON.parse(p));
  }, [doc]);
  const doRedo = useCallback(() => {
    const n = redo.current.pop(); if (!n || !doc) return;
    undo.current.push(JSON.stringify(doc)); lastPush.current = 0; setDoc(JSON.parse(n));
  }, [doc]);

  const dirty = !!doc && JSON.stringify(doc) !== saved;
  const save = useCallback(async () => {
    if (!doc) return;
    try {
      const d = await api.put<DashboardDoc>('dashboards/' + id, doc);
      setDoc(d); setSaved(JSON.stringify(d));
      setMsg({ kind: 'ok', text: 'Zapisano. Tablety z tym dashboardem odświeżą się same.' });
    } catch (e: any) { setMsg({ kind: 'err', text: e.message }); }
  }, [doc, id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inField = /INPUT|TEXTAREA|SELECT/.test(t.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      else if (!inField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (!inField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    };
    const leave = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', k); window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('beforeunload', leave); };
  }, [save, doUndo, doRedo, dirty]);

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), msg.kind === 'ok' ? 3000 : 8000); return () => clearTimeout(t); }, [msg]);

  if (!doc) return <div className="editor"><p className="muted">{msg?.text ?? 'Ładowanie…'}</p></div>;

  return (
    <div className="editor">
      <header className="e-head">
        <button className="btn" onClick={() => { if (!dirty || confirmLeave()) onBack(); }}><Icon name="prev" size={18} />Dashboardy</button>
        <h1>{doc.title}</h1>
        <span className={'pill' + (dirty ? ' warn' : '')}>{dirty ? 'niezapisane zmiany' : 'zapisane'}</span>
        <div className="grow" />
        <div className="seg" role="group" aria-label="Tryb edycji">
          {([['visual', 'Wizualnie'], ['json', 'JSON'], ['preview', 'Podgląd']] as [Mode, string][]).map(([k, l]) =>
            <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Rozmiar ekranu">
          {(Object.keys(SIZES) as SizeKey[]).map((k) => <button key={k} aria-pressed={size === k} onClick={() => setSize(k)} title={SIZES[k][2]}>{SIZES[k][2].replace('Tablet ', '')}</button>)}
        </div>
        <select className="e-occ" value={occasion} onChange={(e) => setOccasion(e.target.value as Skin | '')} aria-label="Podgląd motywu okolicznościowego" title="Tylko podgląd w edytorze – nie zmienia dashboardu">
          <option value="">Bez okazji</option>
          {SKINS.filter(([k]) => ['swieta', 'wielkanoc', 'halloween', 'walentynki'].includes(k)).map(([k, l]) => <option key={k} value={k}>Podgląd: {l.split(' – ')[0]}</option>)}
        </select>
        <button className="btn" disabled={!undo.current.length} onClick={doUndo} title="Ctrl+Z">Cofnij</button>
        <button className="btn" disabled={!redo.current.length} onClick={doRedo} title="Ctrl+Y">Ponów</button>
        <div className="db-more">
          <button className="btn" onClick={() => setOnTablet(!onTablet)} aria-expanded={onTablet} title="Pokaż tę wersję (także niezapisaną) na tablecie przez 3 minuty"><Icon name="mdi:tablet-cellphone" size={16} />Na tablecie</button>
          {onTablet && <TabletPreview doc={doc} onDone={(t) => { setOnTablet(false); if (t) setMsg({ kind: t.startsWith('!') ? 'err' : 'ok', text: t.replace(/^!/, '') }); }} />}
        </div>
        <button className="btn primary" disabled={!dirty} onClick={save} title="Ctrl+S">Zapisz</button>
      </header>
      {msg && <p className={msg.kind === 'err' ? 'err' : 'ok'} role="status">{msg.text}</p>}

      {mode === 'visual' && <VisualEditor doc={doc} onChange={change} size={size} occasion={occasion || undefined} />}
      {mode === 'json' && <JsonPane doc={doc} onChange={change} size={size} />}
      {mode === 'preview' && <div className="e-preview full"><Preview doc={doc} size={size} /></div>}
    </div>
  );
};

/** pick an online tablet and show the draft there for 3 minutes */
const TabletPreview: FC<{ doc: DashboardDoc; onDone(msg?: string): void }> = ({ doc, onDone }) => {
  const [list, setList] = useState<TabletLive[] | null>(null);
  useEffect(() => { api.get<TabletLive[]>('tablets').then(setList).catch(() => setList([])); }, []);
  const send = async (t: TabletLive) => {
    try {
      const r = await api.post<{ delivered: number }>('tablets/' + t.id + '/preview', { doc, minutes: 3 });
      onDone(r.delivered ? `„${t.name}” pokazuje tę wersję przez 3 minuty (dotknięcie banera wraca wcześniej).` : `!„${t.name}” nie jest teraz połączony.`);
    } catch (e: any) { onDone('!' + e.message); }
  };
  return (
    <div className="db-menu" onMouseLeave={() => onDone()}>
      {!list && <span className="muted small" style={{ padding: 8 }}>Ładowanie…</span>}
      {list?.filter((t) => t.online).map((t) => <button key={t.id} onClick={() => send(t)}><i className="dot ok" />{t.name}</button>)}
      {list && !list.some((t) => t.online) && <span className="muted small" style={{ padding: 8 }}>Żaden tablet nie jest teraz połączony.</span>}
    </div>
  );
};

function confirmLeave() {
  try { return window.confirm('Masz niezapisane zmiany. Wyjść bez zapisywania?'); } catch { return true; }
}

// ---------------------------------------------------------------- JSON pane
const JsonPane: FC<{ doc: DashboardDoc; onChange(d: DashboardDoc): void; size: SizeKey }> = ({ doc, onChange, size }) => {
  const [text, setText] = useState(() => JSON.stringify(doc, null, 2));
  const [err, setErr] = useState('');
  const [side, setSide] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const lastSent = useRef(JSON.stringify(doc));

  // external changes (undo/redo) replace the text
  useEffect(() => {
    const s = JSON.stringify(doc);
    if (s !== lastSent.current) { lastSent.current = s; setText(JSON.stringify(doc, null, 2)); setErr(''); }
  }, [doc]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const d = JSON.parse(text);
        if (!d || !Array.isArray(d.views)) throw new Error('brak tablicy "views"');
        setErr('');
        const s = JSON.stringify({ ...d, id: doc.id });
        if (s !== lastSent.current) { lastSent.current = s; onChange({ ...d, id: doc.id }); }
      } catch (e: any) { setErr(e.message); }
    }, 400);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (snippet: string) => {
    const el = ta.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    setText(text.slice(0, s) + snippet + text.slice(e));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + snippet.length; });
  };

  return (
    <div className="e-body">
      <div className="e-code">
        <div className="row-btns">
          <button className="btn" onClick={() => setSide(!side)}>Wstaw encję</button>
          <label className="btn">Wyślij obrazek<input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { insert(`"${(await api.upload(f)).url}"`); } catch (er: any) { setErr(er.message); }
          }} /></label>
          <button className="btn" onClick={() => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch { /* shown */ } }}>Formatuj</button>
        </div>
        <textarea ref={ta} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="Konfiguracja dashboardu (JSON)"
          onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); insert('  '); } }} />
        {err && <p className="err">Błąd JSON: {err}</p>}
        <details className="help"><summary>Ściąga: widgety, akcje, panele</summary><Help /></details>
      </div>
      <div className="e-preview"><Preview doc={doc} size={size} /></div>
      {side && (
        <aside className="e-side">
          <div className="a-bar"><h2>Wstaw encję</h2><button className="btn" onClick={() => setSide(false)}>Zamknij</button></div>
          <Entities compact onPick={(e) => insert(`"${e}"`)} />
        </aside>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- preview
export const Preview: FC<{ doc: DashboardDoc; size: SizeKey }> = ({ doc, size }) => {
  const [W, H] = SIZES[size];
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(el.clientWidth / W, 1)));
    ro.observe(el); return () => ro.disconnect();
  }, [W]);
  const key = useMemo(() => doc.views.map((v) => v.id).join(','), [doc]);
  return (
    <div className="pv-box" ref={box}>
      <div className="pv-frame" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        <DashboardView key={key} doc={doc} embedded />
      </div>
      <div style={{ height: H * scale }} />
    </div>
  );
};

const Help: FC = () => (
  <div className="help-body">
    <p><b>Widok</b>: <code>columns</code>, <code>rowHeight</code> (px), <code>gap</code>. Widget: <code>x, y, w, h</code> w kolumnach/wierszach.</p>
    <p><b>Typy</b>: {Object.entries(WIDGETS).map(([k, m]) => <span key={k}><code>{k}</code> ({m.label}) </span>)}</p>
    <p><b>style</b>: <code>background, color, accent, radius, opacity, fontScale, padding, border:false, hideTitle, align</code>.</p>
    <p><b>tap / hold</b>: <code>toggle</code>, <code>service</code> (+service, entity, data), <code>view</code>, <code>dashboard</code>, <code>url</code>, <code>panel</code>, <code>none</code>.</p>
    <p><b>panel.rows[].display</b>: <code>auto, toggle, slider, value, buttons, graph, camera</code>.</p>
  </div>
);
