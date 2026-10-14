// Built-in triggers: when an entity changes (doorbell, intercom, gate, motion…) show a pop-up and/or wake the tablets.
import { useEffect, useState, type FC } from 'react';
import type { PanelRow, PopupDef, Tablet, TriggerDef } from '../../../shared/types';
import { PopupView } from '../kiosk/Popup';
import { api } from '../lib/api';
import { playTabletSound, SOUNDS, stopTabletSound } from '../lib/fully';
import { hass } from '../lib/hass';
import { Icon } from '../ui/Icon';
import { CheckF, EntityF, EntityListF, NumF, SelectF, TextF } from './fields';

const blank = (): TriggerDef => ({
  id: Math.random().toString(36).slice(2, 10), name: 'Dzwonek', enabled: true, entity: '', to: 'on', action: 'popup',
  tablets: [], popup: { title: 'Ktoś dzwoni', timeout: 60, talk: true, reject: { everywhere: true } }, wake: { screen: true, sound: 'sounds/ding-dong.wav', soundLoop: true }, closeOn: undefined, cooldown: 10
});
/** Appliance finished (washer, dryer, dishwasher): beep + speech, no pop-up. */
const blankAppliance = (): TriggerDef => ({
  id: Math.random().toString(36).slice(2, 10), name: 'Koniec prania', enabled: true, entity: '', to: '', action: 'wake',
  tablets: [], wake: { screen: true, sound: 'sounds/agd-koniec.wav', tts: 'Pranie zakończone' }, cooldown: 300
});

export const Triggers: FC = () => {
  const [list, setList] = useState<TriggerDef[] | null>(null);
  const [tablets, setTablets] = useState<Tablet[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<PopupDef | null>(null);
  const [left, setLeft] = useState(60);
  useEffect(() => {
    api.get<TriggerDef[]>('triggers').then(setList).catch((e) => setMsg({ ok: false, text: e.message }));
    api.get<Tablet[]>('tablets').then(setTablets).catch(() => {});
  }, []);
  if (!list) return <section className="a-sec"><p className="muted">Wczytuję…</p></section>;

  const set = (i: number, p: Partial<TriggerDef>) => { setList(list.map((t, j) => (j === i ? { ...t, ...p } : t))); setDirty(true); };
  const save = async () => {
    try { setList(await api.put<TriggerDef[]>('triggers', list)); setDirty(false); setMsg({ ok: true, text: 'Zapisano. Wyzwalacze działają od razu.' }); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };
  const test = async (t: TriggerDef) => {
    try {
      const r = await api.post<{ delivered: number; online: string[]; popup: PopupDef | null }>('triggers/test', t);
      const sel = (t.tablets ?? []).map((id) => tablets.find((x) => x.id === id)?.name ?? id);
      setMsg({ ok: r.delivered > 0, text: r.delivered
        ? `Wysłano na ${r.delivered} tablet(y). Podgląd poniżej – tak wygląda na tablecie.`
        : !r.online.length ? 'Żaden tablet nie ma teraz otwartego kiosku (link tabletu z zakładki Tablety). Podgląd poniżej.'
        : `Połączone tablety: ${r.online.join(', ')} – ale wyzwalacz jest ustawiony tylko na: ${sel.join(', ') || 'wszystkie'}. Podgląd poniżej.` });
      if (r.popup) { setLeft(r.popup.timeout ?? 60); setPreview(r.popup); }
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };

  return (
    <section className="a-sec">
      <div className="a-bar">
        <h2>Wyzwalacze – dzwonek, domofon, ruch</h2>
        <div className="row-btns">
          <button className="btn" onClick={() => { setList([...list, blank()]); setDirty(true); }}><Icon name="plus" size={18} />Dzwonek / domofon</button>
          <button className="btn" onClick={() => { setList([...list, blankAppliance()]); setDirty(true); }}><Icon name="mdi:washing-machine" size={18} />Koniec prania / AGD</button>
          <button className="btn primary" disabled={!dirty} onClick={save}>Zapisz</button>
        </div>
      </div>
      <p className="muted">Add-on sam obserwuje encję z Home Assistant i reaguje, gdy zmieni stan – bez pisania automatyzacji. Pop-up pokazuje kamerę (np. furtka z go2rtc) i przyciski (np. otwórz furtkę). <b>Wybudzanie</b> działa w Fully Kiosk Browser po włączeniu <i>Advanced Web Settings → Enable JavaScript Interface</i>; dźwięk i mowa działają też w innych przeglądarkach. Dalej działa też zdarzenie <code>wall_dashboard_popup</code> z automatyzacji HA.</p>
      {msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
      {list.length === 0 && <p className="muted">Brak wyzwalaczy. Dodaj pierwszy, np. „Dzwonek furtki”: encja <code>binary_sensor.dzwonek</code>, stan <code>on</code>, pop-up z kamerą furtki.</p>}
      {preview && <PopupView popup={preview} left={left} setLeft={(f) => setLeft(f)} onClose={() => setPreview(null)} setToast={(m) => setMsg({ ok: false, text: m })} />}
      <div className="cards">
        {list.map((t, i) => <TriggerCard key={t.id} t={t} tablets={tablets} onChange={(p) => set(i, p)} onDelete={() => { setList(list.filter((_, j) => j !== i)); setDirty(true); }} onTest={() => test(t)} />)}
      </div>
    </section>
  );
};

const TriggerCard: FC<{ t: TriggerDef; tablets: Tablet[]; onChange(p: Partial<TriggerDef>): void; onDelete(): void; onTest(): void }> = ({ t, tablets, onChange, onDelete, onTest }) => {
  const s = t.entity ? hass.states.get(t.entity) : undefined;
  const isEvent = t.entity.startsWith('event.');
  const p = t.popup ?? {};
  const w = t.wake ?? {};
  const setP = (x: Record<string, unknown>) => onChange({ popup: { ...p, ...x } });
  const setW = (x: Record<string, unknown>) => onChange({ wake: { ...w, ...x } });
  const toggleTablet = (id: string, on: boolean) => onChange({ tablets: on ? [...(t.tablets ?? []), id] : (t.tablets ?? []).filter((x) => x !== id) });
  return (
    <article className="card trg">
      <div className="a-bar">
        <h3>{t.name || 'Wyzwalacz'}</h3>
        <label className="check"><input type="checkbox" checked={t.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />aktywny</label>
      </div>
      <TextF label="Nazwa" value={t.name} onChange={(v) => onChange({ name: v ?? '' })} />
      <EntityF label="Encja" value={t.entity} onChange={(v) => onChange({ entity: v ?? '' })} hint={s ? `teraz: ${s.state}` : 'np. binary_sensor.dzwonek, event.domofon, sensor.intercom'} />
      <div className="ins-grid2">
        <TextF label="Gdy stan zmieni się na" value={t.to} onChange={(v) => onChange({ to: v })} placeholder={isEvent ? 'pusto = każde zdarzenie' : 'on / ringing / pusto = każda zmiana'} />
        <TextF label="…z (opcjonalnie)" value={t.from} onChange={(v) => onChange({ from: v })} placeholder="np. off" />
      </div>
      <SelectF label="Reakcja" value={t.action} onChange={(v) => onChange({ action: v as TriggerDef['action'] })}
        options={[['popup', 'Pop-up (kamera, przyciski) + wybudzenie'], ['wake', 'Tylko wybudź tablet']]} />
      <fieldset className="field">
        <legend>Tablety</legend>
        <div className="app-chips">
          <button className={'chip' + (!(t.tablets ?? []).length ? ' on' : '')} onClick={() => onChange({ tablets: [] })}>wszystkie</button>
          {tablets.map((tb) => { const on = (t.tablets ?? []).includes(tb.id); return <button key={tb.id} className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggleTablet(tb.id, !on)}>{tb.name}</button>; })}
        </div>
      </fieldset>
      {t.action === 'popup' && <>
        <TextF label="Tytuł pop-upu" value={p.title} onChange={(v) => setP({ title: v })} placeholder="Ktoś dzwoni do furtki" />
        <EntityF label="Kamera (encja HA)" value={p.camera} domains={['camera']} onChange={(v) => setP({ camera: v })} />
        <TextF label="…albo strumień go2rtc" value={p.go2rtc?.stream} onChange={(v) => setP({ go2rtc: v ? { ...(p.go2rtc ?? {}), stream: v } : undefined, ...(v && !p.camera ? { camera: undefined } : {}) })} placeholder="np. furtka" />
        {p.go2rtc?.stream && <TextF label="Strumień dla słabych paneli (Lite)" value={p.go2rtc.lite} onChange={(v) => setP({ go2rtc: { ...p.go2rtc!, lite: v || undefined } })} placeholder="np. furtka_sub – substream H.264 ≤ 1080p" />}
        <CheckF label="Rozmowa (mikrofon tabletu)" value={p.talk} onChange={(v) => setP({ talk: v || undefined })} />
        <fieldset className="field">
          <legend>Duże przyciski</legend>
          <EntityF label="Otwórz (furtka / brama / drzwi)" value={p.open?.entity} domains={['lock', 'button', 'switch', 'script', 'cover', 'input_button']}
            onChange={(v) => setP({ open: v ? { ...(p.open ?? {}), entity: v } : undefined })} hint="lock → otwórz (unlatch, jeśli zamek obsługuje), button → naciśnij, switch/script → włącz, cover → otwórz" />
          {p.open && <>
            <TextF label="Napis" value={p.open.label} onChange={(v) => setP({ open: { ...p.open!, label: v } })} placeholder="Otwórz furtkę" />
            <CheckF label="Przytrzymaj, aby otworzyć (ok. 1 s)" value={p.open.hold !== false} onChange={(v) => setP({ open: { ...p.open!, hold: v ? undefined : false } })} />
            <NumF label="Zamknij pop-up po otwarciu (s)" value={p.open.closeAfter ?? 5} min={0} max={120} onChange={(v) => setP({ open: { ...p.open!, closeAfter: v } })} hint="0 = zostaw otwarty" />
          </>}
          <CheckF label="Przycisk „Odrzuć”" value={!!p.reject} onChange={(v) => setP({ reject: v ? { everywhere: true } : undefined })} />
          {p.reject && <>
            <EntityF label="Odrzuć – rozłącz domofon (opcjonalnie)" value={p.reject.entity} domains={['button', 'script', 'switch', 'input_button']} onChange={(v) => setP({ reject: { ...p.reject!, entity: v } })} />
            <CheckF label="Zamknij na wszystkich tabletach" value={p.reject.everywhere !== false} onChange={(v) => setP({ reject: { ...p.reject!, everywhere: v } })} />
          </>}
        </fieldset>
        <EntityListF label="Przyciski / encje w pop-upie" value={(p.rows ?? []).map((r) => r.entity)} onChange={(v) => setP({ rows: (v ?? []).map((e): PanelRow => ({ entity: e, display: e.startsWith('lock.') || e.startsWith('button.') || e.startsWith('cover.') ? 'buttons' : undefined })) })} hint="np. lock.furtka, button.otworz_furtke" />
        <IvrEditor t={t} onChange={onChange} />
        <fieldset className="field">
          <legend>Historia połączeń</legend>
          <CheckF label="Zapisuj historię (kto dzwonił, zdjęcie z kamery, czy ktoś odebrał)" value={t.log !== false} onChange={(v) => onChange({ log: v ? undefined : false })} />
          {t.log !== false && <TextF label="Powiadom o nieodebranym" value={t.notify} onChange={(v) => onChange({ notify: v })} placeholder="notify.mobile_app_telefon – pusto = bez powiadomienia" />}
          <p className="muted small">Nieodebrane = nikt nie wcisnął „Rozmowa”, „Otwórz” ani „Odrzuć” do zamknięcia pop-upu. Widać je w widgecie „Nieodebrane (dzwonek)”. Add-on wysyła też zdarzenie <code>wall_dashboard_missed_call</code> do własnych automatyzacji.</p>
        </fieldset>
        <div className="ins-grid2">
          <NumF label="Zamknij po (s)" value={p.timeout ?? 60} min={0} max={600} onChange={(v) => setP({ timeout: v ?? 60 })} hint="0 = do zamknięcia ręcznie" />
          <TextF label="Zamknij, gdy stan" value={t.closeOn} onChange={(v) => onChange({ closeOn: v })} placeholder="np. off" />
        </div>
      </>}
      <fieldset className="field">
        <legend>Wybudzenie tabletu</legend>
        <CheckF label="Włącz ekran, wyłącz wygaszacz, Fully na wierzch" value={w.screen !== false} onChange={(v) => setW({ screen: v })} />
        <NumF label="Jasność (0–255, opcjonalnie)" value={w.brightness} min={0} max={255} onChange={(v) => setW({ brightness: v })} />
        <SoundPick w={w} onChange={setW} />
        <TextF label="Powiedz (TTS)" value={w.tts} onChange={(v) => setW({ tts: v })} placeholder="Ktoś dzwoni do furtki" />
      </fieldset>
      {isAppliance(t) && <p className="muted small">Pralka / AGD: ustaw encję stanu (np. <code>sensor.pralka_job_state</code>) i stan końcowy – np. <code>finished</code>, <code>none</code>, <code>stop</code>; albo pozostały czas → <code>0</code>. Aktualny stan widać pod polem „Encja”. Pole „…z” (np. <code>run</code>) zapobiega alarmowi po restarcie.</p>}
      <NumF label="Nie powtarzaj przez (s)" value={t.cooldown} min={0} max={3600} onChange={(v) => onChange({ cooldown: v })} />
      <div className="row-btns">
        <button className="btn" disabled={!t.entity} onClick={onTest}>Testuj teraz</button>
        <button className="btn" onClick={onDelete}>Usuń</button>
      </div>
    </article>
  );
};

const isAppliance = (t: TriggerDef) => t.action === 'wake' && /prani|pralk|susz|zmyw|agd|wash|dry|dish/i.test(t.name + ' ' + t.entity);

/** Melody: built-in, an uploaded file (mp3 / wav / ogg) or any URL; ▶ plays it here in the browser. */
/** Sound picker: built-in melodies, uploaded files (mp3 / wav / ogg), or any URL (e.g. internet radio); ▶ plays it here. */
export const SoundSelect: FC<{ label: string; value?: string; onChange(v: string | undefined): void; volume?: number; none?: string }> = ({ label, value, onChange, volume, none = '— bez dźwięku —' }) => {
  const [files, setFiles] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get<string[]>('media').then((l) => setFiles(l.filter((f) => /\.(mp3|wav|ogg|m4a|aac)$/i.test(f)))).catch(() => {}); }, []);
  const opts: [string, string][] = [['', none], ...SOUNDS, ...files.map((f): [string, string] => ['media/' + f, 'Mój plik: ' + f])];
  const custom = !!value && !opts.some(([v]) => v === value);
  const play = () => {
    if (playing) { stopTabletSound(); setPlaying(false); return; }
    if (!value) return;
    playTabletSound(value, { volume });
    setPlaying(true); setTimeout(() => setPlaying(false), 8000);
  };
  return (
    <>
      <div className="ins-row"><label>{label}</label><div className="ins-ctl">
        <select value={custom ? '__url' : value ?? ''} style={{ width: '100%' }} onChange={(e) => onChange(e.target.value === '__url' ? 'https://' : e.target.value || undefined)} aria-label={label}>
          {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="__url">Adres URL (np. radio internetowe)…</option>
        </select>
        <div className="row-btns" style={{ marginTop: 6 }}>
          <button className="btn" disabled={!value} onClick={play}>{playing ? '■ Stop' : '▶ Odsłuchaj'}</button>
          <label className="btn">Wgraj własny (mp3 / wav)
            <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { const r = await api.upload(f); setFiles((l) => [...new Set([...l, r.url.replace(/^media\//, '')])]); onChange(r.url); setErr(''); }
              catch (er: any) { setErr(er.message); }
            }} />
          </label>
        </div>
        {err && <small className="err">{err}</small>}
      </div></div>
      {custom && <TextF label="Adres dźwięku" value={value} onChange={(v) => onChange(v)} placeholder="https://… lub media/plik.mp3" />}
    </>
  );
};

const SoundPick: FC<{ w: { sound?: string; soundLoop?: boolean; volume?: number }; onChange(x: Record<string, unknown>): void }> = ({ w, onChange }) => (
  <>
    <SoundSelect label="Melodia" value={w.sound} volume={w.volume} onChange={(v) => onChange({ sound: v })} />
    {w.sound && <>
      <CheckF label="Powtarzaj aż do zamknięcia pop-upu lub dotknięcia ekranu (max 60 s)" value={w.soundLoop} onChange={(v) => onChange({ soundLoop: v || undefined })} />
      <NumF label="Głośność (0–100, opcjonalnie)" value={w.volume} min={0} max={100} onChange={(v) => onChange({ volume: v })} hint="Fully ustawia głośność multimediów tabletu" />
    </>}
  </>
);

/** Waiting room for the visitor at the gate: greeting + music through the intercom speaker (go2rtc two-way audio). */
const IvrEditor: FC<{ t: TriggerDef; onChange(p: Partial<TriggerDef>): void }> = ({ t, onChange }) => {
  const iv = t.ivr;
  const [msg, setMsg] = useState('');
  const set = (x: Partial<NonNullable<TriggerDef['ivr']>>) => onChange({ ivr: { ...(iv ?? {}), ...x } });
  const stream = iv?.stream || t.popup?.go2rtc?.stream;
  const test = async (play?: string, stop?: boolean) => {
    setMsg(stop ? 'Zatrzymuję…' : 'Wysyłam do domofonu…');
    try {
      const r = await api.post<{ stream?: string; seconds?: number }>('ivr/test', { ...t, play, stop });
      setMsg(stop ? 'Zatrzymano.' : `Gra w domofonie (strumień ${r.stream})${r.seconds ? ` – ${Math.round(r.seconds)} s` : ''}. Jeśli nic nie słychać, zmień kodek (pcmu ↔ pcma).`);
    } catch (e: any) { setMsg(e.message); }
  };
  return (
    <fieldset className="field">
      <legend>Poczekalnia dla odwiedzającego (IVR)</legend>
      <CheckF label="Gdy nikt nie odbiera – odbierz w domofonie i graj powitanie + muzykę" value={!!iv} onChange={(v) => onChange({ ivr: v ? { after: 8, greetingText: 'Dzień dobry, proszę chwilę poczekać, łączę z domownikami.', music: 'sounds/poczekalnia.wav' } : undefined })} />
      {iv && <>
        <NumF label="Zacznij po (s dzwonienia)" value={iv.after ?? 8} min={0} max={120} onChange={(v) => set({ after: v })} hint="0 = od razu" />
        <TextF label="Powitanie (mowa z HA)" value={iv.greetingText} onChange={(v) => set({ greetingText: v })} placeholder="Dzień dobry, proszę chwilę poczekać…" />
        {!iv.greetingText && <SoundSelect label="…albo plik powitania" value={iv.greeting} onChange={(v) => set({ greeting: v })} />}
        <SoundSelect label="Muzyka oczekiwania (w pętli)" value={iv.music} none="— bez muzyki —" onChange={(v) => set({ music: v })} />
        <TextF label="Pożegnanie, gdy nikt nie odebrał" value={iv.goodbyeText} onChange={(v) => set({ goodbyeText: v })} placeholder="Niestety nikt nie odbiera. Prosimy zostawić przesyłkę przy furtce." />
        <div className="ins-grid2">
          <NumF label="Głośność powitania / pożegnania (%)" value={iv.volume ?? 100} min={0} max={300} step={10} onChange={(v) => set({ volume: v })} hint="100 = jak w pliku; powyżej 100 z ogranicznikiem" />
          <NumF label="Głośność muzyki (%)" value={iv.musicVolume ?? 100} min={0} max={300} step={10} onChange={(v) => set({ musicVolume: v })} hint="np. 40 – muzyka ciszej niż mowa" />
        </div>
        <div className="ins-grid2">
          <TextF label="Strumień go2rtc domofonu" value={iv.stream} onChange={(v) => set({ stream: v })} placeholder={t.popup?.go2rtc?.stream || 'np. furtka'} />
          <SelectF label="Kodek audio" value={iv.codec ?? 'pcmu'} onChange={(v) => set({ codec: v as 'pcmu' })} options={[['pcmu', 'PCMU / G.711µ (Hikvision)'], ['pcma', 'PCMA / G.711a'], ['opus', 'Opus'], ['aac', 'AAC']]} />
        </div>
        <EntityF label="Odbierz połączenie w domofonie (opcjonalnie)" value={iv.answerEntity} domains={['button', 'script', 'switch', 'input_button']} onChange={(v) => set({ answerEntity: v })} hint="np. przycisk „Odbierz” z integracji domofonu albo skrypt wywołujący ISAPI – naciskany, gdy startuje poczekalnia" />
        <label className="field"><span>Silnik mowy (TTS)</span>
          <select value={iv.tts ?? ''} onChange={(e) => set({ tts: e.target.value || undefined })}>
            <option value="">automatycznie (polski silnik, jeśli jest)</option>
            {[...hass.states.keys()].filter((e) => e.startsWith('tts.')).map((e) => <option key={e} value={e}>{e}</option>)}
          </select></label>
        <TextF label="Język mowy" value={iv.ttsLanguage} onChange={(v) => set({ ttsLanguage: v })} placeholder="pl (domyślnie)" />
        <TextF label="Głos (opcjonalnie)" value={iv.ttsVoice} onChange={(v) => set({ ttsVoice: v })} placeholder="HA Cloud: ZofiaNeural / MarekNeural, Piper: pl_PL-gosia-medium" />
        <p className="muted small">Najlepiej po polsku brzmią: <b>Home Assistant Cloud</b> (głos ZofiaNeural lub MarekNeural) i <b>Piper</b> z polskim głosem (np. pl_PL-gosia-medium, pl_PL-darkman-medium). Google Translate czyta poprawnie tylko z językiem „pl”. Zamiast mowy możesz też nagrać własne powitanie (plik mp3) i wybrać je jako plik powitania.</p>
        <TextF label="Adres add-onu widziany z go2rtc" value={iv.base} onChange={(v) => set({ base: v })} placeholder="http://127.0.0.1:8099 – zmień, jeśli go2rtc działa w innym kontenerze (np. Frigate)" />
        <div className="row-btns">
          <button className="btn" disabled={!stream} onClick={() => test(iv.greetingText ? 'tts:' + iv.greetingText : iv.greeting)}>▶ Powitanie w domofonie</button>
          <button className="btn" disabled={!stream || !iv.music} onClick={() => test(iv.music)}>▶ Muzyka w domofonie</button>
          <button className="btn" disabled={!stream} onClick={() => test(undefined, true)}>■ Stop</button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
        <p className="muted small">Dźwięk wysyła go2rtc do głośnika domofonu (ta sama droga co rozmowa z tabletu). Poczekalnia milknie, gdy ktoś na panelu wciśnie mikrofon („Rozmowa”), „Otwórz” albo „Odrzuć”.</p>
      </>}
    </fieldset>
  );
};
