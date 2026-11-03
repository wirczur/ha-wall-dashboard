import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import { Triggers } from './Triggers';
import { SceneAutomation } from './SceneAutomation';
import type { CustomTheme, DashboardDoc, DashboardSummary, EntityInfo, Settings, SipSettings, StatusInfo, TabletLive, TriggerDef, ViewDef } from '../../../shared/types';
import { api } from '../lib/api';
import { boot } from '../lib/boot';
import { hass, useConnection } from '../lib/hass';
import { useLook } from '../lib/occasion';
import { Icon } from '../ui/Icon';
import { lookVars } from '../view/DashboardView';
import { WIDGETS } from '../widgets/widgets';
import { DashboardEditor } from './DashboardEditor';
import { HouseEditor, Houses } from './HouseEditor';
import { Tvs } from './Tvs';
import { Themes } from './Themes';
import { setThemes } from '../lib/themes';
import { Tablets, when, type Info } from './Tablets';

type Page = 'status' | 'dashboards' | 'themes' | 'houses' | 'tablets' | 'tvs' | 'door' | 'triggers' | 'automations' | 'settings' | 'backup' | 'entities';
const NAV: [string, [Page, string, string][]][] = [
  ['', [['status', 'Stan', 'mdi:view-dashboard-variant-outline']]],
  ['Wygląd', [['dashboards', 'Dashboardy', 'mdi:view-grid-outline'], ['themes', 'Motywy', 'mdi:palette-outline'], ['houses', 'Domy 3D', 'mdi:home-modern']]],
  ['Urządzenia', [['tablets', 'Tablety', 'mdi:tablet'], ['tvs', 'Telewizory', 'mdi:television']]],
  ['Dzwonek i automatyka', [['door', 'Furtka i SIP', 'mdi:doorbell-video'], ['triggers', 'Wyzwalacze i pop-upy', 'mdi:bell-ring-outline'], ['automations', 'Sceny i automatyzacje', 'mdi:robot-outline']]],
  ['System', [['settings', 'Ustawienia', 'mdi:cog-outline'], ['backup', 'Kopia zapasowa', 'mdi:backup-restore'], ['entities', 'Encje', 'mdi:format-list-bulleted']]]
];
const PAGES = new Set(NAV.flatMap(([, l]) => l.map(([p]) => p)));

/** #/tablets/<id> → { page, sub } */
function readHash(): { page: Page; sub?: string; edit?: string; house?: string } {
  const h = location.hash;
  if (h.startsWith('#edit/')) return { page: 'dashboards', edit: decodeURIComponent(h.slice(6)) };
  if (h.startsWith('#house/')) return { page: 'houses', house: decodeURIComponent(h.slice(7)) };
  const [p, sub] = h.replace(/^#\/?/, '').split('/');
  return { page: PAGES.has(p as Page) ? (p as Page) : 'status', sub: sub ? decodeURIComponent(sub) : undefined };
}

/** Admin UI: opened from the Home Assistant sidebar (ingress). Full access. */
export const AdminApp: FC = () => {
  const [route, setRoute] = useState(readHash);
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [counts, setCounts] = useState<{ dashboards?: number; themes?: number }>({});
  const [navOpen, setNavOpen] = useState(false);
  const conn = useConnection();

  useEffect(() => {
    hass.start(); api.get<Info>('info').then(setInfo).catch(() => {});
    api.get<CustomTheme[]>('themes').then((l) => { setThemes(l); setCounts((c) => ({ ...c, themes: l.length })); }).catch(() => {});
    api.get<DashboardSummary[]>('dashboards').then((l) => setCounts((c) => ({ ...c, dashboards: l.length }))).catch(() => {});
  }, []);
  const loadStatus = useCallback(() => api.get<StatusInfo>('status').then(setStatus).catch(() => {}), []);
  useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 15000); return () => clearInterval(t); }, [loadStatus]);
  useEffect(() => { const f = () => setRoute(readHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const go = (page: Page, sub?: string) => { location.hash = '#/' + page + (sub ? '/' + encodeURIComponent(sub) : ''); setNavOpen(false); };

  if (route.edit) return <DashboardEditor id={route.edit} onBack={() => go('dashboards')} />;
  if (route.house) return <HouseEditor id={route.house} onBack={() => go('houses')} />;

  const warn = status?.warnings.length ?? 0;
  const badge: Partial<Record<Page, { n: number | string; cls?: string }>> = {
    status: warn ? { n: warn, cls: status!.warnings.some((w) => w.level === 'err') ? 'err' : 'warn' } : undefined,
    dashboards: counts.dashboards != null ? { n: counts.dashboards } : undefined,
    themes: counts.themes ? { n: counts.themes } : undefined,
    tablets: status ? { n: `${status.tablets.filter((t) => t.online).length}/${status.tablets.length}` } : undefined
  };
  const page = route.page;
  return (
    <div className={'adm' + (navOpen ? ' nav-open' : '')}>
      <nav className="adm-nav">
        <div className="adm-logo"><i />Wall Dashboard</div>
        {NAV.map(([g, items]) => (
          <div key={g || '-'} className="adm-grp">
            {g && <div className="adm-gl">{g}</div>}
            {items.map(([p, l, ic]) => (
              <button key={p} className={'adm-it' + (page === p ? ' on' : '')} onClick={() => go(p)} aria-current={page === p ? 'page' : undefined}>
                <Icon name={ic} size={19} /><span>{l}</span>
                {badge[p] && <b className={badge[p]!.cls}>{badge[p]!.n}</b>}
              </button>
            ))}
          </div>
        ))}
        <div className="adm-ver">wersja {boot.version}<br /><i className={'dot ' + (conn.ha ? 'ok' : 'err')} />{conn.ha ? 'Home Assistant połączony' : 'brak połączenia z HA'}</div>
      </nav>
      <div className="adm-scrim" onClick={() => setNavOpen(false)} />
      <main className="adm-main">
        <button className="btn adm-burger" onClick={() => setNavOpen(true)} aria-label="Menu"><Icon name="mdi:menu" size={20} />Menu</button>
        {page === 'status' && <Status s={status} reload={loadStatus} go={go} />}
        {page === 'dashboards' && <Dashboards onEdit={(id) => { location.hash = '#edit/' + encodeURIComponent(id); }} onCount={(n) => setCounts((c) => ({ ...c, dashboards: n }))} />}
        {page === 'houses' && <Houses onEdit={(id) => { location.hash = '#house/' + encodeURIComponent(id); }} />}
        {page === 'tvs' && <Tvs />}
        {page === 'themes' && <Themes />}
        {page === 'tablets' && info && <Tablets info={info} sel={route.sub} onSel={(id) => go('tablets', id)} />}
        {page === 'door' && info && <section className="a-sec"><div className="a-bar"><h2>Furtka i SIP</h2></div><SipCard info={info} onSettings={(s) => setInfo({ ...info, settings: s })} /></section>}
        {page === 'triggers' && <Triggers />}
        {page === 'automations' && <SceneAutomation />}
        {page === 'settings' && info && <SettingsPage info={info} onSettings={(s) => setInfo({ ...info, settings: s })} />}
        {page === 'backup' && <section className="a-sec"><div className="a-bar"><h2>Kopia zapasowa</h2></div><BackupCard /></section>}
        {page === 'entities' && <Entities />}
      </main>
    </div>
  );
};

// ---------------------------------------------------------------- status
const CALL_ST: Record<string, [string, string]> = { answered: ['Odebrany', 'ok'], opened: ['Otwarto', 'ok'], missed: ['Nieodebrany', 'err'], rejected: ['Odrzucony', 'warn'], ringing: ['Dzwoni', 'warn'] };
const Status: FC<{ s: StatusInfo | null; reload(): void; go(p: Page, sub?: string): void }> = ({ s, reload, go }) => {
  const [msg, setMsg] = useState('');
  if (!s) return <section className="a-sec"><div className="a-bar"><h2>Stan</h2></div><p className="muted">Ładowanie…</p></section>;
  const panels = s.tablets.filter((t) => !t.phone);
  const off = panels.filter((t) => !t.online);
  const reloadAll = async () => {
    let n = 0;
    for (const t of s.tablets.filter((x) => x.online)) { const r = await api.post<{ delivered: number }>('tablets/' + t.id + '/command', { command: 'reload' }).catch(() => ({ delivered: 0 })); n += r.delivered ? 1 : 0; }
    setMsg(`Przeładowano: ${n}`); setTimeout(reload, 4000);
  };
  const dur = (a: number, b?: number) => { if (!b) return ''; const x = Math.round((b - a) / 1000); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };
  return (
    <section className="a-sec">
      <div className="a-bar">
        <h2>Stan</h2>
        <div className="row-btns">{msg && <span className="muted small">{msg}</span>}
          <button className="btn" onClick={reloadAll}><Icon name="mdi:refresh" size={16} />Przeładuj wszystkie tablety</button>
          <button className="btn primary" onClick={async () => { const t = await api.post<{ id: string }>('tablets', { name: 'Nowy tablet' }); go('tablets', t.id); }}><Icon name="plus" size={18} />Dodaj tablet</button></div>
      </div>
      <div className="st-kpis">
        <button className="card st-kpi" onClick={() => go('tablets')}>
          <span className="muted small">Panele online</span>
          <b className="st-n">{panels.length - off.length}<small> / {panels.length}</small></b>
          <small>{off.length ? <><i className="dot err" />{off[0].name}{off.length > 1 ? ` i jeszcze ${off.length - 1}` : ''} – offline</> : <><i className="dot ok" />wszystkie działają</>}</small>
        </button>
        <button className="card st-kpi" onClick={() => go('door')}>
          <span className="muted small">Dzwonek z furtki</span>
          <b className="st-n sm">{!s.sip ? 'Po staremu' : s.sip.ok ? 'Centrala OK' : 'Centrala nie odpowiada'}</b>
          <small>{!s.sip ? 'wyzwalacz z HA + go2rtc' : <><i className={'dot ' + (s.sip.ok ? 'ok' : 'err')} />{s.sip.doors.length ? 'furtka ' + s.sip.doors.join(', ') : 'brak furtki'}{s.sip.registered.length ? ' · panele ' + s.sip.registered.join(', ') : ''}</>}</small>
        </button>
        <button className="card st-kpi" onClick={() => go('triggers')}>
          <span className="muted small">Dzwonki dziś</span>
          <b className="st-n">{s.calls.today}</b>
          <small className="muted">{s.calls.missedToday ? `${s.calls.missedToday} nieodebrane` : 'bez nieodebranych'}{s.calls.last[0] ? ' · ostatni ' + when(s.calls.last[0].at) : ''}</small>
        </button>
        <button className="card st-kpi" onClick={() => go('tablets')}>
          <span className="muted small">Tryb ciszy</span>
          <b className="st-n sm">{s.quiet.length ? `${s.quiet.length} ${s.quiet.length === 1 ? 'panel' : 'panele'} w ciszy` : 'Wyłączony'}</b>
          <small className="muted">{s.quiet.map((q) => q.name + (q.until ? ' do ' + when(q.until) : '')).join(', ') || 'dźwięki włączone wszędzie'}</small>
        </button>
      </div>
      <div className="st-cols">
        <div className="card">
          <h3>Wymaga uwagi</h3>
          {!s.warnings.length && <p className="muted"><i className="dot ok" />Wszystko działa.</p>}
          {s.warnings.map((w, i) => (
            <div key={i} className={'st-warn' + (w.level === 'err' ? ' st-e' : '')}>
              <i className={'dot ' + (w.level === 'err' ? 'err' : 'warn')} />
              <div><b>{w.title}</b><small>{w.text}</small></div>
              <button className="btn" onClick={() => go(w.page as Page, w.tablet)}>Otwórz</button>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Ostatnie dzwonki</h3>
          {!s.calls.last.length && <p className="muted">Jeszcze nikt nie dzwonił.</p>}
          {s.calls.last.map((c) => {
            const [l, cls] = CALL_ST[c.status] ?? [c.status, ''];
            return (
              <div key={c.id} className="st-call">
                <span className={'pill ' + cls}>{l}</span>
                <span className="grow">{c.name}{c.byName ? ' → ' + c.byName : ''}</span>
                <small className="muted">{when(c.at)}{c.status === 'answered' && c.ended ? ' · ' + dur(c.at, c.ended) : ''}</small>
              </div>
            );
          })}
        </div>
      </div>
      <p className="muted small">Wall Dashboard {s.version} · kiosk {s.https ? 'HTTPS' : 'HTTP'}{s.go2rtc ? ` · go2rtc ${s.go2rtc.ok ? 'OK (' + s.go2rtc.streams + ' strumieni)' : 'nie odpowiada'}` : ''} · aplikacja Android: najnowsza {s.latestApp}</p>
    </section>
  );
};

// ---------------------------------------------------------------- settings (kiosk address, go2rtc)
const SettingsPage: FC<{ info: Info; onSettings(s: Settings): void }> = ({ info, onSettings }) => {
  const [base, setBase] = useState(info.settings.kioskBase);
  const [g2, setG2] = useState(info.settings.go2rtcUrl ?? '');
  const [g2msg, setG2msg] = useState('');
  const [msg, setMsg] = useState('');
  const effectiveBase = info.settings.kioskBase || `${location.protocol === 'https:' ? 'http:' : location.protocol}//${location.hostname}:${info.kioskPort}`;
  return (
    <section className="a-sec">
      <div className="a-bar"><h2>Ustawienia</h2></div>
      <div className="card">
        <label className="field">
          <span>Adres kiosku widziany z tabletów</span>
          <div className="row-btns">
            <input value={base} placeholder={effectiveBase} onChange={(e) => setBase(e.target.value)} />
            <button className="btn" onClick={async () => { onSettings(await api.put<Settings>('settings', { kioskBase: base })); setMsg('Zapisano.'); }}>Zapisz</button>
          </div>
          <small className="muted">{msg || `Puste = ${effectiveBase}. Ustaw np. https://192.168.1.10:${info.kioskPort}, jeśli otwierasz HA przez domenę lub reverse proxy. Z tego adresu powstają linki tabletów.`}</small>
        </label>
        <label className="field">
          <span>Adres API go2rtc (kamery „Bezpośrednio go2rtc”, rozmowa z domofonem po staremu)</span>
          <div className="row-btns">
            <input value={g2} placeholder="http://127.0.0.1:1984" onChange={(e) => setG2(e.target.value)} />
            <button className="btn" onClick={async () => {
              try {
                onSettings(await api.put<Settings>('settings', { kioskBase: base, go2rtcUrl: g2 }));
                const s = await api.get<string[]>('go2rtc/streams');
                setG2msg(s.length ? 'Połączono. Strumienie: ' + s.join(', ') : 'Zapisano, ale go2rtc nie odpowiada pod tym adresem.');
              } catch (e: any) { setG2msg(e.message); }
            }}>Zapisz i sprawdź</button>
          </div>
          <small className="muted">{g2msg || 'Adres widziany z add-onu (nie z tabletu), port API 1984 – nie rtsp://…:8554. Puste = http://127.0.0.1:1984 (dodatek go2rtc na tym samym HA).'}</small>
        </label>
      </div>
      <div className="card">
        <h3>HTTPS kiosku</h3>
        <p className="muted small">Mikrofon (interkom, rozmowa z furtką) działa w przeglądarce tylko po HTTPS. Włącz w konfiguracji add-onu <code>ssl: true</code> i wskaż certyfikat z <code>/ssl</code> (<code>certfile</code>, <code>keyfile</code>), potem uruchom add-on ponownie.</p>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------- dashboards
const TEMPLATES: [string, string, Partial<ViewDef>, number][] = [
  ['tablet', 'Tablet / panel 15″', { columns: 24, rowHeight: 56, gap: 12 }, 8],
  ['square', 'Panel 1:1', { columns: 12, rowHeight: 48, gap: 10 }, 6],
  ['phone', 'Telefon', { columns: 6, rowHeight: 64, gap: 10 }, 6]
];
const Dashboards: FC<{ onEdit(id: string): void; onCount(n: number): void }> = ({ onEdit, onCount }) => {
  const [list, setList] = useState<DashboardSummary[]>([]);
  const [docs, setDocs] = useState<Record<string, DashboardDoc>>({});
  const [tablets, setTablets] = useState<TabletLive[]>([]);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const l = await api.get<DashboardSummary[]>('dashboards'); setList(l); onCount(l.length);
      api.get<TabletLive[]>('tablets').then(setTablets).catch(() => {});
      const all = await Promise.all(l.map((d) => api.get<DashboardDoc>('dashboards/' + d.id).catch(() => null)));
      setDocs(Object.fromEntries(all.filter(Boolean).map((d) => [d!.id, d!])));
    } catch (e: any) { setErr(e.message); }
  }, [onCount]);
  useEffect(() => { load(); }, [load]);

  const create = async (copyFrom?: string, title?: string) => (await api.post<DashboardDoc>('dashboards', { title: title || 'Nowy dashboard', copyFrom }));
  const fromTemplate = async (k: string) => {
    const [, label, grid, clockW] = TEMPLATES.find((t) => t[0] === k)!;
    const d = await create(undefined, 'Nowy – ' + label);
    const v = d.views[0];
    await api.put('dashboards/' + d.id, { ...d, views: [{ ...v, ...grid, widgets: v.widgets.map((w) => ({ ...w, w: Math.min(clockW, grid.columns!) })) }] });
    onEdit(d.id);
  };
  const importJson = async () => {
    const txt = window.prompt('Wklej dashboard (JSON z „Eksportuj”):'); if (!txt) return;
    try {
      const d = JSON.parse(txt) as DashboardDoc; if (!Array.isArray(d?.views)) throw new Error('to nie jest dashboard');
      const n = await create(undefined, d.title || 'Zaimportowany');
      await api.put('dashboards/' + n.id, { ...d, id: n.id, title: n.title }); load();
    } catch (e: any) { setErr('Nie udało się zaimportować: ' + e.message); }
  };
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = list.filter((d) => !terms.length || terms.every((t) => (d.title + ' ' + JSON.stringify(docs[d.id]?.views ?? '')).toLowerCase().includes(t)));
  return (
    <section className="a-sec">
      <div className="a-bar">
        <h2>Dashboardy</h2>
        <input className="search db-q" placeholder="Szukaj dashboardu lub encji…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row-btns">
          <button className="btn" onClick={importJson}>Importuj</button>
          <button className="btn primary" onClick={async () => onEdit((await create()).id)}><Icon name="plus" size={18} />Nowy dashboard</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="db-grid">
        {shown.map((d) => {
          const on = tablets.filter((t) => t.dashboards.includes(d.id));
          const doc = docs[d.id];
          return (
            <article key={d.id} className="card db-card">
              <button className="db-thumb-btn" onClick={() => onEdit(d.id)} aria-label={'Edytuj ' + d.title}>{doc ? <Thumb doc={doc} /> : <div className="db-thumb" />}</button>
              <div className="db-meta">
                <b>{d.title}</b>
                {doc && <ThemeName doc={doc} />}
              </div>
              <small className="muted">{d.views} {d.views === 1 ? 'widok' : d.views < 5 ? 'widoki' : 'widoków'} · {d.widgets} widgetów · {on.length ? 'na: ' + on.map((t) => t.name).join(', ') : <span className="warn-t">nieprzypisany</span>}</small>
              <div className="db-acts">
                <button className="btn primary" onClick={() => onEdit(d.id)}><Icon name="edit" size={16} />Edytuj</button>
                <button className="btn" onClick={async () => { await create(d.id, d.title + ' (kopia)'); load(); }}>Duplikuj</button>
                <div className="db-more">
                  <button className="btn" onClick={() => setMenu(menu === d.id ? null : d.id)} aria-label="Więcej" aria-expanded={menu === d.id}>⋯</button>
                  {menu === d.id && <div className="db-menu" onMouseLeave={() => setMenu(null)}>
                    <button onClick={async () => { const t = window.prompt('Nowa nazwa:', d.title); setMenu(null); if (t && doc) { await api.put('dashboards/' + d.id, { ...doc, title: t }); load(); } }}>Zmień nazwę</button>
                    <button onClick={async () => { setMenu(null); const txt = JSON.stringify(doc, null, 2); try { await navigator.clipboard.writeText(txt); setErr(''); alert('Skopiowano dashboard (JSON) do schowka.'); } catch { window.prompt('Skopiuj:', txt); } }}>Eksportuj (JSON)</button>
                    <button className="danger" onClick={async () => { setMenu(null); if (confirm(`Usunąć dashboard „${d.title}”?${on.length ? ' Używają go: ' + on.map((t) => t.name).join(', ') + '.' : ''}`)) { await api.del('dashboards/' + d.id); load(); } }}>Usuń</button>
                  </div>}
                </div>
              </div>
            </article>
          );
        })}
        <div className="db-new">
          <Icon name="plus" size={26} />
          <b>Nowy dashboard</b>
          <small className="muted">zacznij od siatki dla:</small>
          <div className="row-btns">{TEMPLATES.map(([k, l]) => <button key={k} className="btn" onClick={() => fromTemplate(k)}>{l}</button>)}</div>
        </div>
      </div>
    </section>
  );
};

const ThemeName: FC<{ doc: DashboardDoc }> = ({ doc }) => {
  const look = useLook({ ...doc.theme, occasions: false });
  const name = look.custom ? look.custom.name : doc.theme.skin === 'mech' ? 'Mech i mosiądz' : doc.theme.skin && doc.theme.skin !== 'glass' ? doc.theme.skin : 'Szkło';
  return <span className="pill">{name}</span>;
};

/** schematic of the first view in the dashboard's own colours; tiles of entities that are on use the "on" colour */
export const Thumb: FC<{ doc: DashboardDoc; view?: ViewDef }> = ({ doc, view }) => {
  const look = useLook({ ...doc.theme, occasions: false });
  const v = view ?? doc.views.find((x) => !x.panelOnly) ?? doc.views[0];
  const rows = Math.max(4, Math.min(24, v ? v.widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0) : 4));
  const bg = look.skin || look.custom ? 'var(--bg)' : doc.theme.background.type === 'color' ? doc.theme.background.color : 'linear-gradient(135deg, #1b2030, #0b0d12)';
  const img = doc.theme.background.type === 'image' && doc.theme.background.image ? `url("${doc.theme.background.image}") center / cover` : undefined;
  return (
    <div className="db-thumb" data-skin={look.skin} style={{ ...lookVars(doc.theme, look), background: img ?? bg }}>
      <div className="db-thumb-grid" style={{ gridTemplateColumns: `repeat(${v?.columns ?? 12}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {v?.widgets.filter((w) => w.y < rows).map((w) => {
          const st = w.entity ? hass.states.get(w.entity)?.state : undefined;
          const on = st === 'on' || st === 'open' || st === 'playing' || st === 'heat' || st === 'cool';
          const plain = ['clock', 'date', 'text'].includes(w.type);
          return <i key={w.id} title={w.title || WIDGETS[w.type]?.label} className={plain ? 'plain' : on ? 'on' : ''}
            style={{ gridColumn: `${w.x + 1} / span ${w.w}`, gridRow: `${w.y + 1} / span ${Math.min(w.h, rows - w.y)}` }} />;
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- SIP PBX (VitalPBX / Asterisk)
const SipCard: FC<{ info: Info; onSettings(s: Settings): void }> = ({ info, onSettings }) => {
  const cur = info.settings.sip;
  const [f, setF] = useState<SipSettings>(cur ?? { ws: '' });
  const [triggers, setTriggers] = useState<TriggerDef[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get<TriggerDef[]>('triggers').then(setTriggers).catch(() => {}); }, []);
  const set = (p: Partial<SipSettings>) => setF((x) => ({ ...x, ...p }));
  const doors = f.doors ?? [];
  const save = async (patch: Partial<SipSettings> = {}) => {
    try { const s = await api.put<Settings>('settings/sip', { ...f, ...patch }); onSettings(s); setF(s.sip ?? { ws: '' }); setMsg('Zapisano.'); }
    catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Dzwonek z furtki</h3>
      <label className="field"><span>Sposób obsługi połączeń</span>
        <select value={f.enabled ? 'sip' : 'old'} onChange={(e) => { const on = e.target.value === 'sip'; set({ enabled: on }); if (!on || f.ws) void save({ enabled: on }); }}>
          <option value="old">Po staremu – wyzwalacz z HA, obraz i rozmowa przez go2rtc, poczekalnia add-onu</option>
          <option value="sip">Przez centralę SIP (VitalPBX / Asterisk) – panele i telefony jako numery wewnętrzne</option>
        </select>
      </label>
      {f.enabled && <>
        <div className="ins-grid2">
          <label className="field"><span>Adres WebSocket centrali (z add-onu)</span>
            <input value={f.ws} placeholder="ws://192.168.1.20:8088/ws" onChange={(e) => set({ ws: e.target.value })} />
            <small className="muted">VitalPBX / Asterisk: ws://IP:8088/ws albo wss://IP:8089/ws. Panele łączą się przez add-on, głos idzie bezpośrednio panel ⇄ centrala.</small></label>
          <label className="field"><span>Domena SIP (opcjonalnie)</span>
            <input value={f.domain ?? ''} placeholder="domyślnie adres centrali" onChange={(e) => set({ domain: e.target.value || undefined })} /></label>
        </div>
        <div className="ins-grid2">
          <label className="field"><span>Kod przechwycenia połączenia</span>
            <input value={f.pickup ?? ''} placeholder="np. *8" onChange={(e) => set({ pickup: e.target.value || undefined })} />
            <small className="muted">Telefon otwarty z powiadomienia przejmuje dzwonek tym kodem (VitalPBX: Feature Codes → Call Pickup).</small></label>
          <label className="check" style={{ alignSelf: 'center' }}>
            <input type="checkbox" checked={!!f.tlsVerify} onChange={(e) => set({ tlsVerify: e.target.checked })} />
            Sprawdzaj certyfikat centrali (wss://)
          </label>
        </div>
        <fieldset className="field"><legend>Furtki (numer SIP → pop-up wyzwalacza: kamera, „Otwórz”, historia)</legend>
          {doors.map((d, i) => (
            <div key={i} className="row-btns">
              <input style={{ maxWidth: 140 }} value={d.number} placeholder="numer furtki, np. 100" onChange={(e) => set({ doors: doors.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })} />
              <select value={d.trigger} onChange={(e) => set({ doors: doors.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)) })}>
                <option value="">— wybierz wyzwalacz —</option>
                {triggers.filter((t) => t.action !== 'wake').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="btn" onClick={() => set({ doors: doors.filter((_, j) => j !== i) })} aria-label="Usuń"><Icon name="close" size={16} /></button>
            </div>
          ))}
          <button className="btn" onClick={() => set({ doors: [...doors, { number: '', trigger: '' }] })}><Icon name="plus" size={16} />Dodaj furtkę</button>
          <small className="muted">Gdy SIP jest włączony, wyzwalacz tej furtki nie otwiera już pop-upu z HA (zrobi to połączenie SIP), a poczekalnia add-onu nie działa – ustaw ją w centrali (IVR + muzyka + grupa dzwonienia).</small>
        </fieldset>
        <div className="row-btns"><button className="btn primary" onClick={() => save()}>Zapisz</button>{msg && <span className="muted small">{msg}</span>}</div>
        <p className="muted small">Numer SIP i hasło każdego panelu / telefonu ustawiasz w Tablety → wybrany tablet → Rozmowy. Mikrofon wymaga HTTPS kiosku.</p>
      </>}
    </div>
  );
};
// ---------------------------------------------------------------- entities
export const Entities: FC<{ onPick?(id: string): void; compact?: boolean }> = ({ onPick, compact }) => {
  const [all, setAll] = useState<EntityInfo[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => { api.get<EntityInfo[]>('entities').then(setAll).catch((e) => setErr(e.message)); }, []);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = all.filter((e) => terms.every((t) => (e.entity_id + ' ' + e.name + ' ' + (e.area || '')).toLowerCase().includes(t))).slice(0, 300);
  const pick = async (id: string) => {
    if (onPick) return onPick(id);
    try { await navigator.clipboard.writeText(id); setCopied(id); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  };
  return (
    <section className={compact ? '' : 'a-sec'}>
      {!compact && <div className="a-bar"><h2>Encje</h2></div>}
      <input className="search" placeholder="Szukaj: nazwa, encja lub pomieszczenie…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={compact} />
      {err && <p className="err">{err}</p>}
      <div className="ent-list">
        {rows.map((e) => (
          <button key={e.entity_id} className="ent" onClick={() => pick(e.entity_id)}>
            <span className="ent-name">{e.name}{e.area && <small> · {e.area}</small>}</span>
            <code>{e.entity_id}</code>
            <span className="ent-state">{copied === e.entity_id ? 'skopiowano' : e.state + (e.unit ? ' ' + e.unit : '')}</span>
          </button>
        ))}
        {rows.length === 0 && !err && <p className="muted">Brak wyników.</p>}
      </div>
    </section>
  );
};

/** Download / restore everything (dashboards, tablets, houses, TVs, triggers, uploaded media) */
const BackupCard: FC = () => {
  const [msg, setMsg] = useState('');
  const restore = async (file: File) => {
    try {
      const b = JSON.parse(await file.text());
      if (b?.app !== 'wall-dashboard' || !b.data) throw new Error('To nie jest plik kopii Wall Dashboard');
      if (!confirm(`Przywrócić kopię z ${String(b.created ?? '').slice(0, 10)}? Obecne dashboardy, tablety i domy zostaną zastąpione.`)) return;
      for (const m of b.media ?? []) {
        setMsg('Wysyłam pliki: ' + m.name);
        const bytes = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0));
        const r = await fetch('api/media?name=' + encodeURIComponent(m.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
        if (!r.ok) throw new Error('Plik ' + m.name + ': HTTP ' + r.status);
      }
      const r = await api.post<{ dashboards: number; tablets: number; houses: number }>('restore', { data: b.data });
      setMsg(`Przywrócono: dashboardy ${r.dashboards}, tablety ${r.tablets}, domy 3D ${r.houses}. Odświeżam…`);
      setTimeout(() => location.reload(), 1500);
    } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="card">
      <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Kopia zapasowa</h3>
      <p className="muted small">Wszystko w jednym pliku: dashboardy, tablety z kluczami, domy 3D, telewizory, wyzwalacze i wgrane obrazy / dźwięki. Przydaje się przy przenosinach na add-on z repozytorium albo na inny serwer HA.</p>
      <div className="row-btns">
        <a className="btn" href="api/backup" download>Pobierz kopię</a>
        <label className="btn">Przywróć z pliku…<input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }} /></label>
      </div>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
};