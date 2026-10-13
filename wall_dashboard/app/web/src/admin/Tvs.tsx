import { useCallback, useEffect, useState, type FC } from 'react';
import type { TvApp, TvDef, TvStatus } from '../../../shared/types';
import { api } from '../lib/api';
import { Icon } from '../ui/Icon';
import { appColor, loadAdminTvs, Remote, SAMSUNG_APPS } from '../remote/Remote';

type TvRow = Omit<TvDef, 'token'> & { paired: boolean };

/** Samsung TVs controlled directly on the LAN: add, pair, pick app shortcuts, try the remote. */
export const Tvs: FC = () => {
  const [list, setList] = useState<TvRow[]>([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: 'Telewizor salon', host: '', mac: '' });
  const load = useCallback(() => api.get<TvRow[]>('tvs').then((l) => { setList(l); loadAdminTvs(); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="a-sec">
      <div className="a-bar"><h2>Telewizory Samsung</h2></div>
      <p className="muted">Sterowanie bezpośrednio w sieci lokalnej (bez integracji HA): telewizory Samsung z Tizen, od 2016 r. Na telewizorze włącz <b>Ustawienia → Ogólne → Menedżer urządzeń zewnętrznych → Menedżer połączeń urządzeń → Dostęp: zawsze</b> oraz <b>Ogólne → Sieć → Ustawienia eksperta → Włącz z urządzeniem mobilnym</b> (Wake-on-LAN). Pilot dodajesz na dashboard widgetem „Pilot TV”.</p>
      {err && <p className="err">{err}</p>}
      <div className="cards">
        {list.map((t) => <TvCard key={t.id} tv={t} onChanged={load} />)}
        <article className="card">
          <h3>Dodaj telewizor</h3>
          <label className="field"><span>Nazwa</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Adres IP</span><input value={form.host} placeholder="192.168.1.50" onChange={(e) => setForm({ ...form, host: e.target.value })} /></label>
          <label className="field"><span>Adres MAC (do włączania)</span><input value={form.mac} placeholder="aa:bb:cc:dd:ee:ff — z routera lub Ustawienia → Pomoc → Informacje" onChange={(e) => setForm({ ...form, mac: e.target.value })} /></label>
          <button className="btn primary" disabled={!form.host} onClick={async () => {
            try { await api.post('tvs', form); setForm({ name: 'Telewizor', host: '', mac: '' }); load(); } catch (e: any) { setErr(e.message); }
          }}><Icon name="plus" size={18} />Dodaj</button>
        </article>
      </div>
      <HaTvs />
    </section>
  );
};

const TvCard: FC<{ tv: TvRow; onChanged(): void }> = ({ tv, onChanged }) => {
  const [status, setStatus] = useState<TvStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [installed, setInstalled] = useState<TvApp[] | null>(null);
  const [showRemote, setShowRemote] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => { api.get<TvStatus>(`tvs/${tv.id}/status`).then(setStatus).catch(() => {}); }, [tv.id]);
  const save = async (patch: Partial<TvRow>) => { await api.put('tvs/' + tv.id, { ...tv, ...patch }); onChanged(); };
  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e: any) { setMsg({ kind: 'err', text: e.message }); } finally { setBusy(''); }
  };
  const toggleApp = (a: TvApp, on: boolean) => save({ apps: on ? [...tv.apps, a] : tv.apps.filter((x) => x.appId !== a.appId) });

  return (
    <article className="card">
      <div className="a-bar">
        <h3>{tv.name}</h3>
        <span className={'pill' + (tv.paired ? '' : ' warn')}>{tv.paired ? 'sparowany' : 'niesparowany'}</span>
      </div>
      <p className="muted">
        {tv.model ? tv.model + ' · ' : ''}{status ? { on: 'włączony', standby: 'czuwanie', off: 'wyłączony / nieosiągalny' }[status.power] : 'sprawdzam…'}
      </p>
      <label className="field"><span>Nazwa</span><input defaultValue={tv.name} onBlur={(e) => e.target.value !== tv.name && save({ name: e.target.value })} /></label>
      <div className="ins-grid4" style={{ gridTemplateColumns: '1fr 1fr', display: 'grid', gap: 8 }}>
        <label className="field"><span>Adres IP</span><input defaultValue={tv.host} onBlur={(e) => e.target.value !== tv.host && save({ host: e.target.value })} /></label>
        <label className="field"><span>MAC</span><input defaultValue={tv.mac ?? ''} placeholder="do Wake-on-LAN" onBlur={(e) => e.target.value !== (tv.mac ?? '') && save({ mac: e.target.value })} /></label>
      </div>
      <label className="field"><span>Adres rozgłoszeniowy WoL (opcjonalnie)</span>
        <input defaultValue={tv.broadcast ?? ''} placeholder={tv.host.split('.').slice(0, 3).join('.') + '.255'} onBlur={(e) => e.target.value !== (tv.broadcast ?? '') && save({ broadcast: e.target.value })} />
      </label>

      <div className="row-btns">
        <button className="btn primary" disabled={!!busy} onClick={() => act('pair', async () => {
          setMsg({ kind: 'ok', text: 'Zaakceptuj połączenie „Wall Dashboard” na ekranie telewizora (30 s)…' });
          const r = await api.post<{ status: TvStatus }>(`tvs/${tv.id}/pair`);
          setStatus(r.status); setMsg({ kind: 'ok', text: 'Sparowano.' }); onChanged();
        })}>{busy === 'pair' ? 'Czekam na TV…' : tv.paired ? 'Paruj ponownie' : 'Paruj'}</button>
        <button className="btn" disabled={!!busy} onClick={() => act('apps', async () => setInstalled(await api.get<TvApp[]>(`tvs/${tv.id}/apps`)))}>
          {busy === 'apps' ? 'Pobieram…' : 'Aplikacje na pilocie'}</button>
        <button className="btn" onClick={() => setShowRemote(!showRemote)}>{showRemote ? 'Ukryj pilota' : 'Wypróbuj pilota'}</button>
        {confirmDel
          ? <><button className="btn danger" onClick={async () => { await api.del('tvs/' + tv.id); onChanged(); }}>Na pewno usuń</button><button className="btn" onClick={() => setConfirmDel(false)}>Anuluj</button></>
          : <button className="btn" onClick={() => setConfirmDel(true)}>Usuń</button>}
      </div>
      {msg && <p className={msg.kind === 'err' ? 'err' : 'ok'}>{msg.text}</p>}

      {tv.apps.length > 0 && <AppOrder apps={tv.apps} onChange={(apps) => save({ apps })} />}
      {installed && (
        <fieldset className="field">
          <legend>Zainstalowane aplikacje — zaznacz skróty na pilocie</legend>
          <div className="tv-apps">
            {installed.map((a) => (
              <label key={a.appId} className="check">
                <input type="checkbox" checked={tv.apps.some((x) => x.appId === a.appId)} onChange={(e) => toggleApp(a, e.target.checked)} />{a.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <ManualApp onAdd={(a) => save({ apps: [...tv.apps.filter((x) => x.appId !== a.appId), a] })} />
      {showRemote && <div className="tv-try"><Remote tv={tv.id} /></div>}
      <p className="muted">id: <code>{tv.id}</code></p>
    </article>
  );
};

/** app shortcut by its Tizen id – for TVs that do not list their apps */
const ManualApp: FC<{ onAdd(a: TvApp): void }> = ({ onAdd }) => {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  return (
    <details className="small">
      <summary>Dodaj skrót ręcznie (ID aplikacji)</summary>
      <div className="row-btns" style={{ marginTop: 8 }}>
        <input placeholder="ID, np. 3201907018807" value={id} onChange={(e) => setId(e.target.value.trim())} />
        <input placeholder="Nazwa, np. Netflix" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!id} onClick={() => { onAdd({ appId: id, name: name.trim() || id }); setId(''); setName(''); }}>Dodaj</button>
      </div>
      <p className="muted">Przykłady: Netflix 3201907018807 · YouTube 111299001912 · Prime Video 3201910019365 · Disney+ 3201901017640 · Spotify 3201606009684 · Apple TV 3201807016597.</p>
    </details>
  );
};

// ---------------------------------------------------------------- app shortcuts editor (shared)
/** Ordered list of shortcuts shown on the remote: move up/down, remove. */
const AppOrder: FC<{ apps: TvApp[]; onChange(apps: TvApp[]): void }> = ({ apps, onChange }) => {
  const move = (i: number, d: number) => { const a = [...apps]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a); };
  return (
    <fieldset className="field">
      <legend>Na pilocie (kolejność)</legend>
      <ol className="app-order">
        {apps.map((a, i) => (
          <li key={a.appId + a.name}>
            <i style={{ background: appColor(a.name) }} /><span>{a.name}</span>
            <small className="muted">{a.via === 'app' ? 'aplikacja ' + a.appId : a.via === 'source' ? 'źródło' : ''}</small>
            <button className="mini" disabled={i === 0} onClick={() => move(i, -1)} aria-label={'W górę: ' + a.name}>↑</button>
            <button className="mini" disabled={i === apps.length - 1} onClick={() => move(i, 1)} aria-label={'W dół: ' + a.name}>↓</button>
            <button className="mini" onClick={() => onChange(apps.filter((_, j) => j !== i))} aria-label={'Usuń: ' + a.name}>×</button>
          </li>
        ))}
      </ol>
    </fieldset>
  );
};

// ---------------------------------------------------------------- TVs controlled through Home Assistant
interface HaTvRow { id: string; obj: string; name: string; remote?: string; media?: string; state?: string; sources: string[]; source?: string; apps: TvApp[] }

const HaTvs: FC = () => {
  const [list, setList] = useState<HaTvRow[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api.get<HaTvRow[]>('ha-tvs').then(setList).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!list) return null;
  return (
    <>
      <div className="a-bar" style={{ marginTop: 28 }}><h2>Telewizory przez Home Assistant</h2></div>
      <p className="muted">Pilot z encji <code>remote.*</code> integracji Samsung w HA (działa też, gdy TV jest w innej podsieci). Aplikacje na pilocie: wybierz ze źródeł telewizora albo dodaj po ID aplikacji Samsung – uruchamiane przez <code>media_player.play_media</code>.</p>
      {err && <p className="err">{err}</p>}
      {list.length === 0 && <p className="muted">Brak encji <code>remote.*</code> w Home Assistant.</p>}
      <div className="cards">{list.map((t) => <HaTvCard key={t.obj} tv={t} onChanged={() => { load(); loadAdminTvs(); }} />)}</div>
    </>
  );
};

const HaTvCard: FC<{ tv: HaTvRow; onChanged(): void }> = ({ tv, onChanged }) => {
  const [msg, setMsg] = useState('');
  const [custom, setCustom] = useState({ appId: '', name: '' });
  const [showRemote, setShowRemote] = useState(false);
  const save = async (apps: TvApp[]) => {
    try { await api.put('ha-tvs/' + tv.obj, { apps }); setMsg(''); onChanged(); } catch (e: any) { setMsg(e.message); }
  };
  const has = (a: TvApp) => tv.apps.some((x) => x.appId === a.appId && (x.via ?? 'source') === (a.via ?? 'source'));
  const toggle = (a: TvApp) => save(has(a) ? tv.apps.filter((x) => !(x.appId === a.appId && (x.via ?? 'source') === (a.via ?? 'source'))) : [...tv.apps, a]);
  const sources = tv.sources.map((s) => ({ appId: s, name: s, via: 'source' as const }));
  return (
    <article className="card">
      <div className="a-bar"><h3>{tv.name}</h3><span className="pill">{tv.state ?? '—'}</span></div>
      <p className="muted"><code>{tv.remote ?? 'brak remote.' + tv.obj}</code> · <code>{tv.media ?? 'brak media_player.' + tv.obj}</code>{tv.source ? ' · teraz: ' + tv.source : ''}</p>
      {!tv.media && <p className="err">Bez encji media_player.{tv.obj} aplikacji nie da się uruchamiać.</p>}
      {tv.apps.length > 0
        ? <AppOrder apps={tv.apps} onChange={save} />
        : <p className="muted">Nic nie wybrano – pilot pokazuje pierwsze 12 źródeł telewizora.</p>}
      {sources.length > 0 && (
        <fieldset className="field">
          <legend>Źródła i aplikacje zgłaszane przez TV ({sources.length})</legend>
          <div className="app-chips">{sources.map((a) => <button key={a.appId} className={'chip' + (has(a) ? ' on' : '')} aria-pressed={has(a)} onClick={() => toggle(a)}><i style={{ background: appColor(a.name) }} />{a.name}</button>)}</div>
        </fieldset>
      )}
      <fieldset className="field">
        <legend>Popularne aplikacje Samsung (po ID)</legend>
        <div className="app-chips">{SAMSUNG_APPS.map((a) => <button key={a.appId} className={'chip' + (has(a) ? ' on' : '')} aria-pressed={has(a)} onClick={() => toggle(a)} title={'ID ' + a.appId}><i style={{ background: appColor(a.name) }} />{a.name}</button>)}</div>
        <p className="muted">ID bywają różne zależnie od modelu i regionu – jeśli coś się nie uruchamia, dodaj aplikację z jej ID poniżej.</p>
      </fieldset>
      <div className="app-custom">
        <label className="field"><span>Nazwa</span><input value={custom.name} placeholder="np. Player" onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></label>
        <label className="field"><span>ID aplikacji</span><input value={custom.appId} placeholder="np. 3201508004642" onChange={(e) => setCustom({ ...custom, appId: e.target.value.trim() })} /></label>
        <button className="btn" disabled={!custom.appId} onClick={() => { save([...tv.apps, { appId: custom.appId, name: custom.name || custom.appId, via: 'app' }]); setCustom({ appId: '', name: '' }); }}>Dodaj</button>
      </div>
      <div className="row-btns">
        <button className="btn" onClick={() => setShowRemote(!showRemote)}>{showRemote ? 'Ukryj pilota' : 'Wypróbuj pilota'}</button>
      </div>
      {msg && <p className="err">{msg}</p>}
      {showRemote && <div className="tv-try"><Remote tv={tv.remote ?? tv.media ?? ''} /></div>}
    </article>
  );
};
