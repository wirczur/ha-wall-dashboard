import { useCallback, useEffect, useState, type FC } from 'react';
import { SoundSelect, Triggers } from './Triggers';
import { SceneAutomation } from './SceneAutomation';
import type { DashboardSummary, DeviceCmd, EntityInfo, PairRequest, SaverClock, ScreenDef, Settings, SipSettings, Tablet, TriggerDef } from '../../../shared/types';
import { api } from '../lib/api';
import { boot } from '../lib/boot';
import { hass, useConnection } from '../lib/hass';
import { Icon } from '../ui/Icon';
import { DashboardEditor } from './DashboardEditor';
import { HouseEditor, Houses } from './HouseEditor';
import { Tvs } from './Tvs';

type Tab = 'dashboards' | 'houses' | 'tvs' | 'tablets' | 'triggers' | 'automations' | 'entities';
interface Info { version: string; kioskPort: number; haConnected: boolean; settings: Settings }

/** Admin UI: opened from the Home Assistant sidebar (ingress). Full access. */
export const AdminApp: FC = () => {
  const [tab, setTab] = useState<Tab>('dashboards');
  const [editing, setEditing] = useState<string | null>(() => location.hash.startsWith('#edit/') ? decodeURIComponent(location.hash.slice(6)) : null);
  const [editingHouse, setEditingHouse] = useState<string | null>(() => location.hash.startsWith('#house/') ? decodeURIComponent(location.hash.slice(7)) : null);
  const [info, setInfo] = useState<Info | null>(null);
  const conn = useConnection();

  useEffect(() => { hass.start(); api.get<Info>('info').then(setInfo).catch(() => {}); }, []);
  useEffect(() => {
    history.replaceState(null, '', editing ? '#edit/' + encodeURIComponent(editing) : editingHouse ? '#house/' + encodeURIComponent(editingHouse) : '#');
  }, [editing, editingHouse]);

  if (editing) return <DashboardEditor id={editing} onBack={() => setEditing(null)} />;
  if (editingHouse) return <HouseEditor id={editingHouse} onBack={() => { setEditingHouse(null); setTab('houses'); }} />;

  return (
    <div className="admin">
      <header className="a-head">
        <div>
          <h1>Wall Dashboard</h1>
          <p className="muted">Wersja {boot.version} · {conn.ha ? 'połączono z Home Assistant' : 'brak połączenia z Home Assistant'}</p>
        </div>
        <nav className="a-tabs" role="tablist">
          {([['dashboards', 'Dashboardy'], ['houses', 'Domy 3D'], ['tvs', 'Telewizory'], ['tablets', 'Tablety'], ['triggers', 'Wyzwalacze'], ['automations', 'Sceny i automatyzacje'], ['entities', 'Encje']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
      </header>
      {tab === 'dashboards' && <Dashboards onEdit={setEditing} />}
      {tab === 'houses' && <Houses onEdit={setEditingHouse} />}
      {tab === 'tvs' && <Tvs />}
      {tab === 'tablets' && info && <Tablets info={info} onSettings={(s) => setInfo({ ...info, settings: s })} />}
      {tab === 'triggers' && <Triggers />}
      {tab === 'automations' && <SceneAutomation />}
      {tab === 'entities' && <Entities />}
    </div>
  );
};

// ---------------------------------------------------------------- dashboards
const Dashboards: FC<{ onEdit(id: string): void }> = ({ onEdit }) => {
  const [list, setList] = useState<DashboardSummary[]>([]);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = useCallback(() => api.get<DashboardSummary[]>('dashboards').then(setList).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const create = async (copyFrom?: string, title?: string) => {
    const d = await api.post<{ id: string }>('dashboards', { title: title || 'Nowy dashboard', copyFrom });
    onEdit(d.id);
  };
  return (
    <section className="a-sec">
      <div className="a-bar">
        <h2>Dashboardy</h2>
        <button className="btn primary" onClick={() => create()}><Icon name="plus" size={18} />Nowy dashboard</button>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="cards">
        {list.map((d) => (
          <article key={d.id} className="card">
            <h3>{d.title}</h3>
            <p className="muted">{d.views} {d.views === 1 ? 'widok' : 'widoki'} · {d.widgets} widgetów · id: <code>{d.id}</code></p>
            <div className="row-btns">
              <button className="btn primary" onClick={() => onEdit(d.id)}><Icon name="edit" size={18} />Edytuj</button>
              <button className="btn" onClick={() => create(d.id, d.title + ' (kopia)')}>Duplikuj</button>
              {confirm === d.id
                ? <><button className="btn danger" onClick={async () => { await api.del('dashboards/' + d.id); setConfirm(null); load(); }}>Na pewno usuń</button>
                    <button className="btn" onClick={() => setConfirm(null)}>Anuluj</button></>
                : <button className="btn" onClick={() => setConfirm(d.id)}>Usuń</button>}
            </div>
          </article>
        ))}
      </div>
    </section>
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
        <p className="muted small">Numer SIP i hasło każdego panelu / telefonu ustawiasz niżej, w jego karcie. Mikrofon wymaga HTTPS kiosku.</p>
      </>}
    </div>
  );
};

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

// ---------------------------------------------------------------- tablets
const Tablets: FC<{ info: Info; onSettings(s: Settings): void }> = ({ info, onSettings }) => {
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [dashes, setDashes] = useState<DashboardSummary[]>([]);
  const [base, setBase] = useState(info.settings.kioskBase);
  const [g2, setG2] = useState(info.settings.go2rtcUrl ?? '');
  const [g2msg, setG2msg] = useState('');
  const [copied, setCopied] = useState('');
  const load = useCallback(() => {
    api.get<Tablet[]>('tablets').then(setTablets);
    api.get<DashboardSummary[]>('dashboards').then(setDashes);
  }, []);
  useEffect(() => { load(); }, [load]);

  const effectiveBase = info.settings.kioskBase || `${location.protocol === 'https:' ? 'http:' : location.protocol}//${location.hostname}:${info.kioskPort}`;
  const link = (t: Tablet) => `${effectiveBase}/?k=${encodeURIComponent(t.key)}`;
  const save = async (t: Tablet, patch: Partial<Tablet>) => { await api.put('tablets/' + t.id, { ...t, ...patch }); load(); };
  const copy = async (t: Tablet) => {
    try { await navigator.clipboard.writeText(link(t)); setCopied(t.id); setTimeout(() => setCopied(''), 2000); }
    catch { window.prompt('Skopiuj link:', link(t)); }
  };

  return (
    <section className="a-sec">
      <div className="a-bar">
        <h2>Tablety</h2>
        <button className="btn primary" onClick={async () => { await api.post('tablets', { name: 'Nowy tablet' }); load(); }}><Icon name="plus" size={18} />Dodaj tablet</button>
      </div>
      <p className="muted">Każdy tablet dostaje własny link z kluczem. Link otwiera tylko podgląd i sterowanie — bez ustawień. Nowy klucz unieważnia stary link.</p>
      <div className="card">
        <label className="field">
          <span>Adres kiosku widziany z tabletów</span>
          <div className="row-btns">
            <input value={base} placeholder={effectiveBase} onChange={(e) => setBase(e.target.value)} />
            <button className="btn" onClick={async () => onSettings(await api.put<Settings>('settings', { kioskBase: base }))}>Zapisz</button>
          </div>
          <small className="muted">Puste = {effectiveBase}. Ustaw np. http://192.168.1.10:{info.kioskPort}, jeśli otwierasz HA przez domenę lub reverse proxy.</small>
        </label>
        <label className="field">
          <span>Adres API go2rtc (dla kamer „Bezpośrednio go2rtc”)</span>
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
          <small className="muted">{g2msg || 'Adres widziany z add-onu (nie z tabletu), port API 1984 – nie rtsp://…:8554. Puste = http://127.0.0.1:1984 (dodatek go2rtc na tym samym HA). Tablety łączą się przez add-on, więc działa też przez HTTPS.'}</small>
        </label>
      </div>
      <SipCard info={info} onSettings={onSettings} />
      <PairCard tablets={tablets} onDone={load} />
      <BackupCard />
      <div className="cards">
        {tablets.map((t) => (
          <article key={t.id} className="card">
            <label className="field"><span>Nazwa</span>
              <input defaultValue={t.name} onBlur={(e) => e.target.value !== t.name && save(t, { name: e.target.value })} />
            </label>
            <fieldset className="field">
              <legend>Dashboardy (pierwszy zaznaczony otwiera się na starcie)</legend>
              {dashes.map((d) => (
                <label key={d.id} className="check">
                  <input type="checkbox" checked={t.dashboards.includes(d.id)}
                    onChange={(e) => save(t, { dashboards: e.target.checked ? [...t.dashboards, d.id] : t.dashboards.filter((x) => x !== d.id) })} />
                  {d.title}
                  {t.dashboards[0] === d.id && <span className="pill">start</span>}
                </label>
              ))}
            </fieldset>
            <label className="check">
              <input type="checkbox" checked={!!t.lite} onChange={(e) => save(t, { lite: e.target.checked })} />
              Tryb Lite (słaby panel: bez rozmycia i cieni, niższa rozdzielczość 3D)
            </label>
            {t.lite && <label className="check" style={{ marginLeft: 26 }}>
              <input type="checkbox" checked={!!t.intercomLiteCodec} onChange={(e) => save(t, { intercomLiteCodec: e.target.checked })} />
              Lite: lekki kodek interkomu (G.722 – mniej pracy dla procesora; gdy „Kodek interkomu” = Automatycznie)
            </label>}
            <label className="check">
              <input type="checkbox" checked={!!t.phone} onChange={(e) => save(t, { phone: e.target.checked })} />
              Telefon / iPad użytkownika – dzwonki, pop-upy i budzenie z wyzwalaczy tylko, gdy wskazują ten tablet z nazwy
            </label>
            {t.phone && <p className="muted small" style={{ marginLeft: 26 }}>iPhone / iPad: otwórz link tabletu w Safari → Udostępnij → „Do ekranu początkowego”. Poza domem przez VPN.</p>}
            <label className="field"><span>Głośność powiadomień i dzwonka (0–100%, puste = bez zmiany)</span>
              <input type="number" min={0} max={100} step={5} defaultValue={t.notifyVolume ?? ''} onBlur={(e) => save(t, { notifyVolume: e.target.value === '' ? (null as unknown as undefined) : Number(e.target.value) })} />
              <small className="muted">Domyślna dla dźwięków na tym panelu; głośność ustawiona w wyzwalaczu ma pierwszeństwo. Rozmowy SIP mają osobną głośność.</small>
            </label>
            <QuietEditor t={t} onSave={(q) => save(t, { quiet: q })} />
            <label className="field"><span>Układ na małym ekranie</span>
              <select value={t.layout ?? ''} onChange={(e) => save(t, { layout: (e.target.value || undefined) as Tablet['layout'] })}>
                <option value="">Automatycznie (jedna kolumna tylko na telefonie: poniżej 500 px i widok z ponad 6 kolumnami)</option>
                <option value="grid">Zawsze siatka dashboardu (panel ścienny, np. 480×480)</option>
                <option value="stack">Zawsze jedna kolumna (telefon)</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={!!t.allowDisarm} onChange={(e) => save(t, { allowDisarm: e.target.checked })} />
              Może rozbrajać alarm (kod nadal sprawdza Home Assistant)
            </label>
            <label className="check">
              <input type="checkbox" checked={t.intercom !== false} onChange={(e) => save(t, { intercom: e.target.checked })} />
              Interkom – może dzwonić do innych paneli i odbierać rozmowy (wymaga mikrofonu i HTTPS)
            </label>
            {t.intercom !== false && <fieldset className="field ic-set"><legend>Interkom – {t.name}</legend>
              <label className="field"><span>Odbieranie</span>
                <select value={t.intercomAuto ?? ''} onChange={(e) => save(t, { intercomAuto: (e.target.value || undefined) as Tablet['intercomAuto'] })}>
                  <option value="">Ręcznie (Odbierz / Odrzuć)</option>
                  <option value="on">Automatycznie – rozmowa w obie strony</option>
                  <option value="listen">Automatycznie – tylko słuchanie (mikrofon tego panelu wyciszony do dotknięcia)</option>
                </select>
              </label>
              {t.intercomAuto && <label className="field"><span>Odbierz po (s)</span>
                <input type="number" min={0} max={30} defaultValue={t.intercomAutoDelay ?? 2} onBlur={(e) => save(t, { intercomAutoDelay: e.target.value === '' ? (null as unknown as undefined) : Number(e.target.value) })} /></label>}
              <label className="field"><span>Głośność rozmowy (10–100)</span>
                <input type="number" min={10} max={100} defaultValue={t.intercomVolume ?? 80} onBlur={(e) => save(t, { intercomVolume: e.target.value === '' ? (null as unknown as undefined) : Number(e.target.value) })} />
              </label>
              <label className="field"><span>Kodek interkomu</span>
                <select value={t.intercomCodec ?? ''} onChange={(e) => save(t, { intercomCodec: (e.target.value || undefined) as Tablet['intercomCodec'] })}>
                  <option value="">Automatycznie ({t.lite && t.intercomLiteCodec ? 'G.722 – tablet Lite' : 'Opus'})</option>
                  <option value="opus">Opus 48 kHz – najlepsza jakość, najcięższy</option>
                  <option value="opus16">Opus 16 kHz – lżejszy, jakość VoIP</option>
                  <option value="g722">G.722 16 kHz – bardzo lekki, „HD Voice”</option>
                  <option value="pcmu">G.711 8 kHz – najlżejszy, jakość zwykłego telefonu</option>
                </select>
                <small>W rozmowie wygrywa lżejszy kodek z dwóch paneli.</small>
              </label>
              <label className="field"><span>Przetwarzanie mikrofonu</span>
                <select value={t.intercomAudio ?? ''} onChange={(e) => save(t, { intercomAudio: (e.target.value || undefined) as Tablet['intercomAudio'] })}>
                  <option value="">Automatycznie ({t.lite ? 'lekkie – tablet Lite' : 'pełne'})</option>
                  <option value="full">Pełne – echo, szumy, wzmocnienie</option>
                  <option value="light">Lekkie – tylko echo (słaby panel, głos „robotyczny”)</option>
                  <option value="raw">Wyłączone (zewnętrzny mikrofon / test)</option>
                  <option value="ptt">Krótkofalówka – przytrzymaj, aby mówić (najpewniejsze na słabym panelu)</option>
                </select>
              </label>
              <SoundSelect label="Dzwonek przychodzący" value={t.intercomRing} none="— domyślny (dwutonowy) —" onChange={(v) => save(t, { intercomRing: v })} />
              <SoundSelect label="Muzyka oczekiwania (gdy ten panel dzwoni)" value={t.intercomHold} none="— sygnał oczekiwania —" onChange={(v) => save(t, { intercomHold: v })} />
            </fieldset>}
            {info.settings.sip?.enabled && <TabletSip t={t} onSave={(p) => save(t, p)} />}
            <AppSettings t={t} onSave={(p) => save(t, p)} />
            <label className="field"><span>Link dla tabletu</span>
              <input readOnly value={link(t)} onFocus={(e) => e.target.select()} />
            </label>
            <div className="row-btns">
              <button className="btn primary" onClick={() => copy(t)}>{copied === t.id ? 'Skopiowano' : 'Kopiuj link'}</button>
              <a className="btn" href={link(t)} target="_blank" rel="noopener">Otwórz</a>
              <button className="btn" onClick={async () => {
                const r = await api.post<{ delivered: number }>('tablets/' + t.id + '/popup', { title: 'Test pop-upu', subtitle: t.name, timeout: 15,
                  rows: [] });
                alert(r.delivered ? 'Wysłano pop-up na tablet.' : 'Tablet nie jest teraz połączony.');
              }}>Testuj pop-up</button>
              <button className="btn" onClick={async () => { await api.post('tablets/' + t.id + '/rekey'); load(); }}>Nowy klucz</button>
              <button className="btn" onClick={async () => { await api.del('tablets/' + t.id); load(); }}>Usuń</button>
            </div>
          </article>
        ))}
      </div>
    </section>
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

/** Android app waiting for pairing: the panel shows a 6-digit code */
const PairCard: FC<{ tablets: Tablet[]; onDone(): void }> = ({ tablets, onDone }) => {
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
      <h3><Icon name="mdi:cellphone-link" size={20} /> Aplikacja Wall Dashboard (Android) – parowanie</h3>
      <p className="muted small">Uruchom aplikację na panelu i wpisz adres add-onu <b>https://</b>…:8100 (opcja „ssl” w konfiguracji add-onu – bez niej nie działa mikrofon). Panel pokaże 6-cyfrowy kod – wybierz, czy to nowy tablet, czy istniejący (np. ten, którego używał Fully albo panel po ponownym parowaniu).</p>
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
      {!list.length && <p className="muted small">Brak paneli czekających na sparowanie.</p>}
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
