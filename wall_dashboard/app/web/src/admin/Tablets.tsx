// Admin: tablets – list with live status on the left, the chosen tablet in tabs on the right.
import { useCallback, useEffect, useState, type FC } from 'react';
import { SoundSelect } from './Triggers';
import type { DashboardSummary, DeviceCmd, PairRequest, SaverClock, ScreenDef, Settings, Tablet, TabletLive } from '../../../shared/types';
import { api } from '../lib/api';
import { hass } from '../lib/hass';
import { Icon } from '../ui/Icon';

export interface Info { version: string; kioskPort: number; haConnected: boolean; settings: Settings }
type TTab = 'general' | 'dashboards' | 'screen' | 'calls' | 'quiet';
const TTABS: [TTab, string][] = [['general', 'Ogólne'], ['dashboards', 'Dashboardy'], ['screen', 'Ekran'], ['calls', 'Rozmowy'], ['quiet', 'Cisza']];

/** "wa:0.1.4" → "aplikacja 0.1.4" */
export const appLabel = (a?: string) => !a ? '' : a.startsWith('wa:') ? 'aplikacja ' + a.slice(3) : a === 'fully' ? 'Fully Kiosk' : a === 'ios' ? 'iPhone / iPad' : 'przeglądarka';
const hhmm = (v: number) => new Date(v).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
/** "14:51", "wczoraj 14:51", "3.11 14:51" */
export function when(v?: number) {
  if (!v) return '';
  const d = new Date(v), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  return diff === 0 ? hhmm(v) : diff === 1 ? 'wczoraj ' + hhmm(v) : d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' }) + ' ' + hhmm(v);
}
export const statusLine = (t: TabletLive) => t.online ? 'online' : t.lastSeen ? (t.phone ? 'ostatnio ' : 'offline od ') + when(t.lastSeen) : 'jeszcze się nie połączył';

export const Tablets: FC<{ info: Info; sel?: string; onSel(id: string | undefined): void }> = ({ info, sel, onSel }) => {
  const [tablets, setTablets] = useState<TabletLive[]>([]);
  const [dashes, setDashes] = useState<DashboardSummary[]>([]);
  const load = useCallback(() => {
    api.get<TabletLive[]>('tablets').then(setTablets).catch(() => {});
    api.get<DashboardSummary[]>('dashboards').then(setDashes).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(() => api.get<TabletLive[]>('tablets').then(setTablets).catch(() => {}), 5000); return () => clearInterval(t); }, [load]);
  const cur = tablets.find((t) => t.id === sel) ?? tablets[0];
  const add = async () => { const t = await api.post<Tablet>('tablets', { name: 'Nowy tablet' }); load(); onSel(t.id); };
  const save = async (t: Tablet, patch: Partial<Tablet>) => {
    setTablets((l) => l.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    await api.put('tablets/' + t.id, { ...t, ...patch }); load();
  };

  return (
    <section className="a-sec">
      <div className="a-bar">
        <h2>Tablety</h2>
        <button className="btn primary" onClick={add}><Icon name="plus" size={18} />Dodaj tablet</button>
      </div>
      <div className="tb-split">
        <div className="tb-left">
          <div className="card tb-list">
            {tablets.map((t) => (
              <button key={t.id} className={'tb-item' + (cur?.id === t.id ? ' on' : '')} onClick={() => onSel(t.id)}>
                <Device t={t} />
                <span className="tb-txt">
                  <b>{t.name}</b>
                  <small><i className={'dot ' + (t.online ? 'ok' : t.lastSeen && !t.phone ? 'err' : 'off')} />{statusLine(t)}
                    {t.sip?.ext && <> · SIP {t.sip.ext}{t.online && t.sipRegistered === false ? ' ✕' : ''}</>}
                    {t.app && <> · {appLabel(t.app)}</>}</small>
                </span>
                {t.quietNow?.on && <span className="pill" title="Cisza">cisza</span>}
              </button>
            ))}
            {!tablets.length && <p className="muted small">Brak tabletów – dodaj pierwszy.</p>}
          </div>
          <PairCard tablets={tablets} onDone={load} />
        </div>
        {cur ? <TabletDetail key={cur.id} t={cur} info={info} dashes={dashes} save={(p) => save(cur, p)} onGone={() => { onSel(undefined); load(); }} onRekey={load} />
          : <div className="card muted">Wybierz tablet z listy.</div>}
      </div>
    </section>
  );
};

/** small device outline: wide (tablet), square (panel 1:1) or tall (phone), from the reported screen size */
const Device: FC<{ t: TabletLive; big?: boolean }> = ({ t, big }) => {
  const m = /^(\d+)x(\d+)$/.exec(t.display ?? '');
  let r = m ? Math.max(+m[1], +m[2]) / Math.min(+m[1], +m[2]) : 1.6;
  const tall = t.phone || (m ? +m[2] > +m[1] && r > 1.4 : false);
  if (t.phone) r = 2;
  const h = big ? 52 : 28, w = tall ? h / r : r < 1.15 ? h : h * Math.min(r, 1.8);
  return <span className={'tb-dev' + (t.online ? ' on' : '')} style={{ width: w, height: h }} aria-hidden="true" />;
};

const TabletDetail: FC<{ t: TabletLive; info: Info; dashes: DashboardSummary[]; save(p: Partial<Tablet>): Promise<void>; onGone(): void; onRekey(): void }> = ({ t, info, dashes, save, onGone, onRekey }) => {
  const [tab, setTab] = useState<TTab>(() => (sessionStorage.getItem('wd.ttab') as TTab) || 'general');
  useEffect(() => { try { sessionStorage.setItem('wd.ttab', tab); } catch { /* */ } }, [tab]);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!msg) return; const x = setTimeout(() => setMsg(''), 3500); return () => clearTimeout(x); }, [msg]);
  const effectiveBase = info.settings.kioskBase || `${location.protocol === 'https:' ? 'http:' : location.protocol}//${location.hostname}:${info.kioskPort}`;
  const link = `${effectiveBase}/?k=${encodeURIComponent(t.key)}`;
  const cmd = async (c: DeviceCmd) => { const r = await api.post<{ delivered: number }>('tablets/' + t.id + '/command', { command: c }); setMsg(r.delivered ? 'Wysłano.' : 'Tablet nie jest teraz połączony.'); };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setMsg('Skopiowano link.'); } catch { window.prompt('Skopiuj link:', link); } };
  const test = async () => {
    const r = await api.post<{ delivered: number }>('tablets/' + t.id + '/popup', { title: 'Test pop-upu', subtitle: t.name, timeout: 15, rows: [] });
    setMsg(r.delivered ? 'Wysłano pop-up na tablet.' : 'Tablet nie jest teraz połączony.');
  };
  const sipOn = !!info.settings.sip?.enabled;
  return (
    <div className="card tb-detail">
      <div className="tb-head">
        <Device t={t} big />
        <div className="tb-title">
          <h3>{t.name}</h3>
          <small className="muted"><i className={'dot ' + (t.online ? 'ok' : t.lastSeen ? 'err' : 'off')} />{statusLine(t)}{t.online && t.since ? ' od ' + when(t.since) : ''}
            {t.app && ' · ' + appLabel(t.app)}{t.appModel && ' · ' + t.appModel}{t.display && ' · ' + t.display.replace('x', '×')}
            {t.sip?.ext && <> · SIP {t.sip.ext} {t.sipRegistered ? <span className="pill ok">zarejestrowany</span> : sipOn && t.online ? <span className="pill warn">niezarejestrowany</span> : null}</>}</small>
        </div>
        <div className="row-btns tb-acts">
          <button className="btn" onClick={() => cmd('reload')}><Icon name="mdi:refresh" size={16} />Przeładuj</button>
          <button className="btn" onClick={() => cmd('saver')}><Icon name="mdi:monitor-off" size={16} />Wygaś</button>
          <button className="btn" onClick={test}><Icon name="bell" size={16} />Test pop-upu</button>
          <button className="btn" onClick={copy}><Icon name="mdi:link-variant" size={16} />Kopiuj link</button>
          <a className="btn" href={link} target="_blank" rel="noopener"><Icon name="mdi:open-in-new" size={16} />Otwórz</a>
        </div>
      </div>
      {msg && <p className="ok small" role="status">{msg}</p>}
      <div className="tb-tabs" role="tablist">
        {TTABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="tb-body">
        {tab === 'general' && <>
          <label className="field"><span>Nazwa</span>
            <input defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && save({ name: e.target.value.trim() })} /></label>
          <label className="check"><input type="checkbox" checked={!!t.phone} onChange={(e) => save({ phone: e.target.checked })} />
            Telefon / iPad użytkownika – dzwonki, pop-upy i budzenie z wyzwalaczy tylko, gdy wskazują ten tablet z nazwy</label>
          {t.phone && <p className="muted small" style={{ marginLeft: 26 }}>iPhone / iPad: otwórz link w Safari → Udostępnij → „Do ekranu początkowego”. Poza domem przez VPN.</p>}
          <label className="field"><span>Układ na małym ekranie</span>
            <select value={t.layout ?? ''} onChange={(e) => save({ layout: (e.target.value || undefined) as Tablet['layout'] })}>
              <option value="">Automatycznie (jedna kolumna tylko na telefonie: poniżej 500 px i widok z ponad 6 kolumnami)</option>
              <option value="grid">Zawsze siatka dashboardu (panel ścienny, np. 480×480)</option>
              <option value="stack">Zawsze jedna kolumna (telefon)</option>
            </select></label>
          <label className="check"><input type="checkbox" checked={!!t.lite} onChange={(e) => save({ lite: e.target.checked })} />Tryb Lite (słaby panel: bez rozmycia i cieni, niższa rozdzielczość 3D)</label>
          <label className="check"><input type="checkbox" checked={!!t.allowDisarm} onChange={(e) => save({ allowDisarm: e.target.checked })} />Może rozbrajać alarm (kod nadal sprawdza Home Assistant)</label>
          <label className="field"><span>Link dla tabletu</span><input readOnly value={link} onFocus={(e) => e.target.select()} />
            <small className="muted">Link otwiera tylko podgląd i sterowanie – bez ustawień. Nowy klucz unieważnia stary link.</small></label>
          <div className="row-btns">
            <button className="btn" onClick={async () => { if (confirm(`Nowy klucz dla „${t.name}”? Stary link przestanie działać – tablet trzeba otworzyć nowym linkiem albo sparować ponownie.`)) { await api.post('tablets/' + t.id + '/rekey'); onRekey(); } }}>Nowy klucz</button>
            <button className="btn danger" onClick={async () => { if (confirm(`Usunąć tablet „${t.name}”?`)) { await api.del('tablets/' + t.id); onGone(); } }}>Usuń tablet</button>
          </div>
        </>}
        {tab === 'dashboards' && <DashPick t={t} dashes={dashes} save={save} />}
        {tab === 'screen' && <AppSettings t={t} onSave={(p) => save(p)} />}
        {tab === 'calls' && <>
          <label className="field"><span>Głośność powiadomień i dzwonka (0–100%, puste = bez zmiany)</span>
            <input type="number" min={0} max={100} step={5} defaultValue={t.notifyVolume ?? ''} onBlur={(e) => save({ notifyVolume: e.target.value === '' ? (null as unknown as undefined) : Number(e.target.value) })} />
            <small className="muted">Domyślna dla dźwięków na tym panelu; głośność ustawiona w wyzwalaczu ma pierwszeństwo. Rozmowy mają osobną głośność.</small></label>
          {sipOn ? <TabletSip t={t} onSave={(p) => save(p)} /> : <p className="muted small">Centrala SIP jest wyłączona – dzwonek z furtki idzie „po staremu” (wyzwalacz + go2rtc). Włączysz ją w <b>Furtka i SIP</b>.</p>}
          <IntercomSet t={t} save={save} />
        </>}
        {tab === 'quiet' && <QuietEditor t={t} onSave={(q) => save({ quiet: q })} />}
      </div>
    </div>
  );
};

/** dashboards of a tablet in order: the first one opens on start */
const DashPick: FC<{ t: Tablet; dashes: DashboardSummary[]; save(p: Partial<Tablet>): void }> = ({ t, dashes, save }) => {
  const mine = t.dashboards.map((id) => dashes.find((d) => d.id === id)).filter(Boolean) as DashboardSummary[];
  const rest = dashes.filter((d) => !t.dashboards.includes(d.id));
  const move = (i: number, d: number) => { const n = [...t.dashboards]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; save({ dashboards: n }); };
  return <>
    <p className="muted small">Tablet może otwierać tylko te dashboardy (i widzi tylko ich encje). Pierwszy otwiera się na starcie.</p>
    <div className="tb-dash">
      {mine.map((d, i) => (
        <div key={d.id} className="tb-dash-row">
          <b>{d.title}</b>{i === 0 && <span className="pill ok">start</span>}
          <span className="grow" />
          <button className="mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Wyżej">↑</button>
          <button className="mini" onClick={() => move(i, 1)} disabled={i === mine.length - 1} aria-label="Niżej">↓</button>
          <button className="mini" onClick={() => save({ dashboards: t.dashboards.filter((x) => x !== d.id) })} aria-label={'Odłącz ' + d.title}>×</button>
        </div>
      ))}
      {!mine.length && <p className="muted small">Brak – tablet pokaże pusty ekran.</p>}
    </div>
    {rest.length > 0 && <div className="row-btns">{rest.map((d) => <button key={d.id} className="btn" onClick={() => save({ dashboards: [...t.dashboards, d.id] })}><Icon name="plus" size={16} />{d.title}</button>)}</div>}
  </>;
};

const IntercomSet: FC<{ t: Tablet; save(p: Partial<Tablet>): void }> = ({ t, save }) => <>
  <label className="check">
    <input type="checkbox" checked={t.intercom !== false} onChange={(e) => save({ intercom: e.target.checked })} />
    Interkom – może dzwonić do innych paneli i odbierać rozmowy (wymaga mikrofonu i HTTPS)
  </label>
  {t.intercom !== false && <fieldset className="field ic-set"><legend>Interkom – {t.name}</legend>
    <label className="field"><span>Odbieranie</span>
      <select value={t.intercomAuto ?? ''} onChange={(e) => save({ intercomAuto: (e.target.value || undefined) as Tablet['intercomAuto'] })}>
        <option value="">Ręcznie (Odbierz / Odrzuć)</option>
        <option value="on">Automatycznie – rozmowa w obie strony</option>
        <option value="listen">Automatycznie – tylko słuchanie (mikrofon tego panelu wyciszony do dotknięcia)</option>
      </select>
    </label>
    {t.intercomAuto && <label className="field"><span>Odbierz po (s)</span>
      <input type="number" min={0} max={30} defaultValue={t.intercomAutoDelay ?? 2} onBlur={(e) => save({ intercomAutoDelay: e.target.value === '' ? (null as unknown as undefined) : Number(e.target.value) })} /></label>}
    <label className="field"><span>Głośność rozmowy (10–100)</span>
      <input type="number" min={10} max={100} defaultValue={t.intercomVolume ?? 80} onBlur={(e) => save({ intercomVolume: e.target.value === '' ? (null as unknown as undefined) : Number(e.target.value) })} />
    </label>
    <label className="field"><span>Kodek interkomu</span>
      <select value={t.intercomCodec ?? ''} onChange={(e) => save({ intercomCodec: (e.target.value || undefined) as Tablet['intercomCodec'] })}>
        <option value="">Automatycznie ({t.lite && t.intercomLiteCodec ? 'G.722 – tablet Lite' : 'Opus'})</option>
        <option value="opus">Opus 48 kHz – najlepsza jakość, najcięższy</option>
        <option value="opus16">Opus 16 kHz – lżejszy, jakość VoIP</option>
        <option value="g722">G.722 16 kHz – bardzo lekki, „HD Voice”</option>
        <option value="pcmu">G.711 8 kHz – najlżejszy, jakość zwykłego telefonu</option>
      </select>
      <small>W rozmowie wygrywa lżejszy kodek z dwóch paneli.</small>
    </label>
    {t.lite && <label className="check">
      <input type="checkbox" checked={!!t.intercomLiteCodec} onChange={(e) => save({ intercomLiteCodec: e.target.checked })} />
      Lite: lekki kodek (G.722), gdy „Kodek interkomu” = Automatycznie
    </label>}
    <label className="field"><span>Przetwarzanie mikrofonu</span>
      <select value={t.intercomAudio ?? ''} onChange={(e) => save({ intercomAudio: (e.target.value || undefined) as Tablet['intercomAudio'] })}>
        <option value="">Automatycznie ({t.lite ? 'lekkie – tablet Lite' : 'pełne'})</option>
        <option value="full">Pełne – echo, szumy, wzmocnienie</option>
        <option value="light">Lekkie – tylko echo (słaby panel, głos „robotyczny”)</option>
        <option value="raw">Wyłączone (zewnętrzny mikrofon / test)</option>
        <option value="ptt">Krótkofalówka – przytrzymaj, aby mówić (najpewniejsze na słabym panelu)</option>
      </select>
    </label>
    <SoundSelect label="Dzwonek przychodzący" value={t.intercomRing} none="— domyślny (dwutonowy) —" onChange={(v) => save({ intercomRing: v })} />
    <SoundSelect label="Muzyka oczekiwania (gdy ten panel dzwoni)" value={t.intercomHold} none="— sygnał oczekiwania —" onChange={(v) => save({ intercomHold: v })} />
  </fieldset>}
</>;

/** SIP account of one tablet / phone */
const TabletSip: FC<{ t: Tablet; onSave(p: Partial<Tablet>): void }> = ({ t, onSave }) => {
  const [ext, setExt] = useState(t.sip?.ext ?? '');
  const [pw, setPw] = useState(t.sip?.password ?? '');
  const [notify, setNotify] = useState(t.notify ?? '');
  // the HA app registers device trackers as device_tracker.<name>; its notify service is notify.mobile_app_<name>
  const notifiers = [...hass.states.keys()].filter((k) => k.startsWith('device_tracker.')).map((k) => 'notify.mobile_app_' + k.slice(15));
  return (
    <fieldset className="field"><legend>Centrala SIP – {t.name}</legend>
      <div className="ins-grid2">
        <label className="field"><span>Numer wewnętrzny</span><input value={ext} placeholder="np. 201" onChange={(e) => setExt(e.target.value)} /></label>
        <label className="field"><span>Hasło (secret)</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
      </div>
      {t.phone && <label className="field"><span>Powiadomienie o dzwonku (aplikacja HA na telefonie)</span>
        <input list={'nf-' + t.id} value={notify} placeholder="notify.mobile_app_iphone" onChange={(e) => setNotify(e.target.value)} />
        <datalist id={'nf-' + t.id}>{notifiers.map((n) => <option key={n} value={n} />)}</datalist>
        <small className="muted">Push otwiera link tego telefonu; „Odbierz” przejmuje połączenie kodem przechwycenia.</small></label>}
      <div className="ins-grid2">
        <label className="field"><span>Głośność systemu w rozmowie (10–100%)</span>
          <input type="number" min={10} max={100} step={5} defaultValue={t.callVolume ?? 100} onBlur={(e) => onSave({ callVolume: e.target.value === '' ? (null as unknown as undefined) : Number(e.target.value) })} />
          <small className="muted">Na czas rozmowy panel ustawia tę głośność, po rozmowie wraca do poprzedniej.</small></label>
        <label className="field"><span>Wzmocnienie głosu rozmówcy (50–400%)</span>
          <input type="number" min={50} max={400} step={25} defaultValue={t.callGain ?? 100} onBlur={(e) => onSave({ callGain: e.target.value === '' ? (null as unknown as undefined) : Number(e.target.value) })} />
          <small className="muted">Startowa wartość; w rozmowie zmienisz ją przyciskami − / + (panel ją zapamięta).</small></label>
      </div>
      <div className="row-btns">
        <button className="btn" onClick={() => onSave({ sip: ext.trim() ? { ext: ext.trim(), password: pw } : undefined, ...(t.phone ? { notify: notify.trim() || undefined } : {}) })}>Zapisz SIP</button>
      </div>
    </fieldset>
  );
};
/** Android app waiting for pairing: the panel shows a 6-digit code */
export const PairCard: FC<{ tablets: Tablet[]; onDone(): void }> = ({ tablets, onDone }) => {
  const [list, setList] = useState<PairRequest[]>([]);
  const [code, setCode] = useState('');
  const [codeTarget, setCodeTarget] = useState('');
  /** chosen tablet per waiting code ('' = new tablet) */
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => api.get<PairRequest[]>('pair').then((l) => alive && setList(l)).catch(() => {});
    load(); const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // re-pairing the same device: suggest the tablet it was paired with before
  const guess = (p: PairRequest) => tablets.find((t) => t.appModel && t.appModel === p.device)?.id ?? '';
  const targetOf = (p: PairRequest) => targets[p.code] ?? guess(p);
  const pair = async (c: string, target: string, device?: string) => {
    try {
      const t = await api.post<Tablet>('pair/' + c, target === '' ? { name: device } : { tabletId: target });
      setMsg(`Sparowano z „${t.name}” – panel za chwilę otworzy dashboard.`); setCode(''); onDone();
    } catch (e: any) { setMsg(e.message); }
  };
  const TabletSelect: FC<{ value: string; onChange(v: string): void }> = ({ value, onChange }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Tablet">
      <option value="">➕ Nowy tablet</option>
      <optgroup label="Istniejący tablet (zachowa jego dashboardy i ustawienia)">
        {tablets.map((t) => <option key={t.id} value={t.id}>{t.name}{t.appModel ? ' · ' + t.appModel : ''}</option>)}
      </optgroup>
    </select>
  );
  return (
    <div className="card pair-card">
      <h3><Icon name="mdi:cellphone-link" size={18} /> Parowanie aplikacji (Android)</h3>
      <p className="muted small">Uruchom aplikację na panelu i wpisz adres add-onu <b>https://</b>…:8100. Panel pokaże 6-cyfrowy kod – pojawi się tutaj. Wybierz nowy tablet albo istniejący (zachowa ustawienia).</p>
      {list.length > 0 && <ul className="pair-list">{list.map((p) => (
        <li key={p.code}><b>{p.code.slice(0, 3)} {p.code.slice(3)}</b><span>{p.device || 'panel'} · {p.ip} · {Math.max(0, Math.round((Date.now() - p.at) / 60000))} min temu</span>
          <TabletSelect value={targetOf(p)} onChange={(v) => setTargets({ ...targets, [p.code]: v })} />
          <button className="btn primary" onClick={() => pair(p.code, targetOf(p), p.device)}>Sparuj</button></li>
      ))}</ul>}
      <details className="small"><summary>Wpisz kod ręcznie</summary>
        <div className="row-btns" style={{ marginTop: 8 }}>
          <input inputMode="numeric" maxLength={7} placeholder="kod z panelu" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ width: 140 }} />
          <TabletSelect value={codeTarget} onChange={setCodeTarget} />
          <button className="btn" disabled={code.length !== 6} onClick={() => pair(code, codeTarget)}>Sparuj</button>
        </div>
      </details>
      {!list.length && <p className="muted small"><i className="dot off" />Żaden panel nie czeka.</p>}
      {msg && <p className="small">{msg}</p>}
    </div>
  );
};

const CMDS: [DeviceCmd, string][] = [['reload', 'Przeładuj'], ['saver', 'Wygaś'], ['screen-off', 'Wyłącz ekran'], ['screen-on', 'Włącz ekran'], ['restart', 'Restart aplikacji']];
/** Screen saver / screen off and the settings PIN – used by the Android app; commands work with Fully too */
const AppSettings: FC<{ t: Tablet; onSave(p: Partial<Tablet>): void }> = ({ t, onSave }) => {
  const s = t.screen ?? {};
  const [hours, setHours] = useState(s.hours ?? []);
  const [res, setRes] = useState('');
  const put = (p: Partial<ScreenDef>) => onSave({ screen: { ...s, hours, ...p } });
  const setW = (i: number, p: Partial<{ from: string; to: string; days: number[] }>) => setHours(hours.map((w, j) => (j === i ? { ...w, ...p } : w)));
  const cmd = async (c: DeviceCmd, value?: number) => {
    const r = await api.post<{ delivered: number }>('tablets/' + t.id + '/command', { command: c, value });
    setRes(r.delivered ? 'Wysłano.' : 'Tablet nie jest teraz połączony.');
  };
  return (
    <fieldset className="field app-set"><legend>Ekran i aplikacja{t.appModel ? ` – ${t.appModel}` : ''}</legend>
      <p className="muted small">Wygaszanie działa w aplikacji Wall Dashboard na Androida. W Fully ustaw je w samym Fully – przyciski poniżej działają w obu.</p>
      <label className="field"><span>Wygaszanie</span>
        <select value={s.mode ?? ''} onChange={(e) => put({ mode: (e.target.value || undefined) as ScreenDef['mode'] })}>
          <option value="">Czarny ekran – dotknięcie budzi (domyślnie)</option>
          <option value="dim">Przyciemnienie</option>
          <option value="off">Wyłączenie ekranu – budzi tylko HA, pop-up lub rozmowa</option>
        </select>
      </label>
      <label className="field"><span>Wygaś po (min bez dotyku, puste = nigdy)</span>
        <input type="number" min={1} max={1440} defaultValue={s.idle ?? ''} onBlur={(e) => put({ idle: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
      <label className="field"><span>Jasność (1–100, puste = systemowa)</span>
        <input type="number" min={1} max={100} defaultValue={s.brightness ?? ''} onBlur={(e) => put({ brightness: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
      {s.mode === 'dim' && <label className="field"><span>Jasność po przyciemnieniu (0–100)</span>
        <input type="number" min={0} max={100} defaultValue={s.dimBrightness ?? 3} onBlur={(e) => put({ dimBrightness: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>}
      <div className="field"><span>Wygaszony według godzin (dotknięcie budzi na chwilę)</span>
        {hours.map((w, i) => (
          <div key={i} className="quiet-row">
            <input type="time" value={w.from} onChange={(e) => setW(i, { from: e.target.value })} aria-label="Od" />
            <span>–</span>
            <input type="time" value={w.to} onChange={(e) => setW(i, { to: e.target.value })} aria-label="Do" />
            <div className="app-chips">{DAYS.map(([d, l]) => {
              const on = !w.days?.length || w.days.includes(d);
              return <button key={d} className={'chip' + (on ? ' on' : '')} onClick={() => {
                const all = w.days?.length ? w.days : DAYS.map(([x]) => x);
                const next = on ? all.filter((x) => x !== d) : [...all, d];
                setW(i, { days: next.length === 7 ? undefined : next });
              }}>{l}</button>;
            })}</div>
            <button className="mini" onClick={() => setHours(hours.filter((_, j) => j !== i))} aria-label="Usuń">×</button>
          </div>
        ))}
        <div className="row-btns">
          <button className="btn" onClick={() => setHours([...hours, { from: '23:00', to: '06:30' }])}>+ Okno</button>
          {JSON.stringify(hours) !== JSON.stringify(s.hours ?? []) && <button className="btn primary" onClick={() => put({ hours })}>Zapisz godziny</button>}
        </div>
      </div>
      <ClockEditor clock={s.clock} hasHours={hours.length > 0} onChange={(clock) => put({ clock })} />
      <label className="field"><span>PIN do ustawień aplikacji (4–8 cyfr, puste = bez PIN-u)</span>
        <input inputMode="numeric" maxLength={8} defaultValue={t.appPin ?? ''} onBlur={(e) => e.target.value !== (t.appPin ?? '') && onSave({ appPin: e.target.value.replace(/\D/g, '') })} />
        <small className="muted">Ustawienia otwierasz, przytrzymując 3 s lewy górny róg ekranu.</small></label>
      <div className="row-btns">{CMDS.map(([c, l]) => <button key={c} className="btn" onClick={() => cmd(c)}>{l}</button>)}</div>
      {res && <small className="muted">{res}</small>}
      <details className="small"><summary>Sterowanie z Home Assistant</summary>
        <pre className="code">{`action: event.fire   # albo w automatyzacji: event
data:
  event_type: wall_dashboard_command
  event_data:
    tablet: "${t.name}"      # nazwa, id albo all
    command: saver          # reload | restart | screen-on | screen-off | saver | brightness
    value: 40               # tylko dla brightness (0–100)`}</pre>
      </details>
    </fieldset>
  );
};

/** Clock on the dark screen (Android app, black screen mode) */
const ClockEditor: FC<{ clock?: SaverClock; hasHours: boolean; onChange(c: SaverClock | undefined): void }> = ({ clock, hasHours, onChange }) => {
  const c = clock ?? {};
  const [add, setAdd] = useState('');
  const set = (p: Partial<SaverClock>) => onChange({ ...c, ...p });
  const ents = c.entities ?? [];
  return (
    <fieldset className="field quiet-ed"><legend>Zegar na wygaszonym ekranie (czarny ekran)</legend>
      <label className="check"><input type="checkbox" checked={!!c.night} onChange={(e) => set({ night: e.target.checked || undefined })} />W trybie nocnym (okna godzinowe powyżej){!hasHours && <small className="muted"> – dodaj okno, np. 23:00–6:30</small>}</label>
      <label className="check"><input type="checkbox" checked={!!c.idle} onChange={(e) => set({ idle: e.target.checked || undefined })} />Po wygaszeniu w dzień (brak dotyku, „Wygaś” z HA)</label>
      {(c.night || c.idle) && <>
        <label className="check"><input type="checkbox" checked={!!c.date} onChange={(e) => set({ date: e.target.checked || undefined })} />Dzień tygodnia i data</label>
        <label className="check"><input type="checkbox" checked={!!c.calls} onChange={(e) => set({ calls: e.target.checked || undefined })} />Nieodebrane dzwonki (tylko gdy są)</label>
        <label className="field"><span>Jasność ekranu z zegarem (1–60 %, domyślnie 8)</span>
          <input type="number" min={1} max={60} defaultValue={c.brightness ?? ''} placeholder="8" onBlur={(e) => set({ brightness: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        <div className="field"><span>Wartości pod zegarem (do 4) – np. temperatura na zewnątrz, alarm</span>
          {ents.map((x, i) => (
            <div key={x.entity} className="clk-row">
              <code className="small" title={x.entity}>{x.entity}</code>
              <input placeholder="podpis" defaultValue={x.label ?? ''} onBlur={(e) => set({ entities: ents.map((y, j) => (j === i ? { entity: y.entity, ...(e.target.value.trim() ? { label: e.target.value.trim() } : {}) } : y)) })} />
              <button className="mini" onClick={() => set({ entities: ents.filter((_, j) => j !== i) })} aria-label={'Usuń ' + x.entity}>×</button>
            </div>
          ))}
          {ents.length < 4 && <div className="row-btns">
            <input list="ents-saver" placeholder="sensor.temperatura_zewnatrz" value={add} onChange={(e) => setAdd(e.target.value.trim())} />
            <button className="btn" disabled={!add} onClick={() => { if (!ents.some((y) => y.entity === add)) set({ entities: [...ents, { entity: add }] }); setAdd(''); }}>Dodaj</button>
          </div>}
          <datalist id="ents-saver">{[...hass.states.keys()].filter((e) => /^(sensor|binary_sensor|alarm_control_panel|lock|weather|input_number|climate)\./.test(e)).map((e) => <option key={e} value={e} />)}</datalist>
        </div>
        <p className="muted small">Zegar jest przygaszony i co minutę lekko się przesuwa (ochrona ekranu). Dotknięcie wraca do dashboardu.</p>
      </>}
    </fieldset>
  );
};

const DAYS: [number, string][] = [[1, 'pn'], [2, 'wt'], [3, 'śr'], [4, 'cz'], [5, 'pt'], [6, 'sb'], [0, 'nd']];
/** Quiet mode of a panel: schedule (several windows, weekdays), HA entity, current state. */
const QuietEditor: FC<{ t: Tablet & { quietNow?: { on: boolean; reason?: string; until?: number } }; onSave(q: Tablet['quiet']): void }> = ({ t, onSave }) => {
  const q = t.quiet ?? {};
  const [hours, setHours] = useState(q.hours ?? []);
  const [entity, setEntity] = useState(q.entity ?? '');
  const dirty = JSON.stringify(hours) !== JSON.stringify(q.hours ?? []) || entity !== (q.entity ?? '');
  const now = t.quietNow;
  const hh = (v?: number) => (v ? new Date(v).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '');
  const setW = (i: number, p: Partial<{ from: string; to: string; days: number[] }>) => setHours(hours.map((w, j) => (j === i ? { ...w, ...p } : w)));
  return (
    <fieldset className="field quiet-ed"><legend>Cisza – bez dźwięków, dzwonków i mowy</legend>
      <p className="muted small">Teraz: <b>{now?.on ? `cisza${now.until ? ' do ' + hh(now.until) : ''} (${now.reason === 'hours' ? 'harmonogram' : now.reason === 'entity' ? 'encja HA' : 'ręcznie z panelu'})` : 'dźwięki włączone'}</b>
        {q.manual && <> · <button className="mini" onClick={() => onSave({ ...q, manual: undefined })}>Usuń ręczne ustawienie</button></>}</p>
      {hours.map((w, i) => (
        <div key={i} className="quiet-row">
          <input type="time" value={w.from} onChange={(e) => setW(i, { from: e.target.value })} aria-label="Od" />
          <span>–</span>
          <input type="time" value={w.to} onChange={(e) => setW(i, { to: e.target.value })} aria-label="Do" />
          <div className="app-chips">{DAYS.map(([d, l]) => {
            const on = !w.days?.length || w.days.includes(d);
            return <button key={d} className={'chip' + (on ? ' on' : '')} onClick={() => {
              const all = w.days?.length ? w.days : DAYS.map(([x]) => x);
              const next = on ? all.filter((x) => x !== d) : [...all, d];
              setW(i, { days: next.length === 7 ? undefined : next });
            }}>{l}</button>;
          })}</div>
          <button className="mini" onClick={() => setHours(hours.filter((_, j) => j !== i))} aria-label="Usuń">×</button>
        </div>
      ))}
      <div className="row-btns">
        <button className="btn" onClick={() => setHours([...hours, { from: '22:00', to: '07:00' }])}>+ Okno ciszy</button>
        {!hours.length && <button className="btn" onClick={() => setHours([{ from: '22:00', to: '06:30', days: [0, 1, 2, 3, 4] }, { from: '23:00', to: '08:30', days: [5, 6] }])}>Typowy: w tygodniu 22–6:30, weekend 23–8:30</button>}
      </div>
      <label className="field"><span>…albo gdy encja HA jest włączona (opcjonalnie)</span>
        <input list="ents-quiet" value={entity} onChange={(e) => setEntity(e.target.value.trim())} placeholder="np. input_boolean.cisza_pietro" />
      </label>
      <datalist id="ents-quiet">{[...hass.states.keys()].filter((e) => /^(input_boolean|switch|binary_sensor)\./.test(e)).map((e) => <option key={e} value={e} />)}</datalist>
      <label className="check"><input type="checkbox" checked={!!q.intercomSilent} onChange={(e) => onSave({ ...q, hours, entity: entity || undefined, intercomSilent: e.target.checked || undefined })} />W ciszy nie przyjmuj rozmów z interkomu ani z centrali SIP (dzwoniący zobaczy „Panel jest zajęty”, centrala dostaje „zajęty”)</label>
      {dirty && <button className="btn primary" onClick={() => onSave({ ...q, hours, entity: entity || undefined })}>Zapisz ciszę</button>}
      <p className="muted small">Na panelu włączysz ją też ręcznie kafelkiem „Cisza (ten panel)” – ręczne ustawienie wygrywa z harmonogramem do końca bieżącego okna. W ciszy pop-upy i wybudzanie ekranu działają, nie ma tylko dźwięku i mowy; interkom nie odbiera automatycznie.</p>
    </fieldset>
  );
};