// Scenes and automations created step by step, saved straight into Home Assistant (scenes.yaml / automations.yaml).
import { useEffect, useMemo, useState, type FC, type ReactNode } from 'react';
import type { EntityInfo, HassState, TvDef, TvStep } from '../../../shared/types';
import { api } from '../lib/api';
import { domainOf } from '../lib/format';
import { hass } from '../lib/hass';
import { serviceFor } from '../lib/setValue';
import { Icon } from '../ui/Icon';
import { EntityF, IconF, NumF, SelectF, TextF, useEntityList } from './fields';

interface HaItem { entity_id: string; id?: string; name: string; state: string; last_triggered?: string; entities?: string[]; tv?: boolean }

export const SceneAutomation: FC = () => {
  const [mode, setMode] = useState<'list' | 'scene' | 'automation'>('list');
  const [items, setItems] = useState<{ automations: HaItem[]; scenes: HaItem[] } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => api.get<{ automations: HaItem[]; scenes: HaItem[] }>('ha/automations').then(setItems).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []);
  const done = (text: string) => { setMode('list'); setMsg({ ok: true, text }); setTimeout(load, 1500); };

  if (mode === 'scene') return <SceneWizard onCancel={() => setMode('list')} onDone={done} />;
  if (mode === 'automation') return <AutomationWizard onCancel={() => setMode('list')} onDone={done} />;

  const run = (p: Promise<unknown>) => p.then(() => setTimeout(load, 800)).catch((e) => setMsg({ ok: false, text: e.message }));
  const del = async (kind: 'scene' | 'automation', it: HaItem) => {
    if (!it.id || !confirm(`Usunąć „${it.name}” z Home Assistant?`)) return;
    try { await api.del(`ha/${kind}/${it.id}`); setMsg({ ok: true, text: 'Usunięto.' }); setTimeout(load, 1200); } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  };
  return (
    <section className="a-sec">
      <div className="a-bar">
        <h2>Sceny i automatyzacje</h2>
        <div className="row-btns">
          <button className="btn primary" onClick={() => setMode('scene')}><Icon name="plus" size={18} />Nowa scena</button>
          <button className="btn primary" onClick={() => setMode('automation')}><Icon name="plus" size={18} />Nowa automatyzacja</button>
        </div>
      </div>
      <p className="muted">Kreator krok po kroku zapisuje sceny i automatyzacje bezpośrednio w Home Assistant – potem są widoczne i edytowalne także w HA (Ustawienia → Automatyzacje i sceny). Tutaj widać tylko te utworzone w Wall Dashboard; pozostałe zostają w HA. Scenę dodasz na dashboard przyciskiem z encją <code>scene.…</code>.</p>
      {msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
      {!items ? <p className="muted">Wczytuję…</p> : (
        <div className="sa-cols">
          <div>
            <h3>Automatyzacje ({items.automations.length})</h3>
            <div className="sa-list">
              {!items.automations.length && <p className="muted small">Brak automatyzacji utworzonych w Wall Dashboard.</p>}
              {items.automations.map((a) => (
                <div key={a.entity_id} className="sa-it">
                  <label className="check" title={a.state === 'on' ? 'aktywna' : 'wyłączona'}><input type="checkbox" checked={a.state === 'on'} onChange={(e) => run(hass.call('automation', e.target.checked ? 'turn_on' : 'turn_off', undefined, a.entity_id))} /></label>
                  <div><b>{a.name}</b><small>{a.last_triggered ? 'ostatnio ' + new Date(a.last_triggered).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'jeszcze nie uruchomiona'}</small></div>
                  <button className="mini" title="Uruchom teraz" onClick={() => run(hass.call('automation', 'trigger', undefined, a.entity_id))}>▶</button>
                  {a.id && <button className="mini" title="Usuń" onClick={() => del('automation', a)}>×</button>}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3>Sceny ({items.scenes.length})</h3>
            <div className="sa-list">
              {!items.scenes.length && <p className="muted small">Brak scen utworzonych w Wall Dashboard.</p>}
              {items.scenes.map((s) => (
                <div key={s.entity_id} className="sa-it">
                  <Icon name="sun" size={18} />
                  <div><b>{s.name}</b><small>{(s.entities ?? []).length} encji{s.tv ? ' + telewizor' : ''} · <code>{s.entity_id}</code></small></div>
                  <button className="mini" title="Włącz scenę" onClick={() => run(hass.call('scene', 'turn_on', undefined, s.entity_id))}>▶</button>
                  {s.id && <button className="mini" title="Usuń" onClick={() => del('scene', s)}>×</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------- shared wizard frame
const Steps: FC<{ title: string; steps: string[]; step: number; setStep(n: number): void; canNext: boolean; onCancel(): void; finish: ReactNode; children: ReactNode }> =
  ({ title, steps, step, setStep, canNext, onCancel, finish, children }) => (
    <section className="a-sec wiz">
      <div className="a-bar"><h2>{title}</h2><button className="btn" onClick={onCancel}>Anuluj</button></div>
      <ol className="wiz-steps">{steps.map((s, i) => <li key={s} className={i === step ? 'cur' : i < step ? 'done' : ''}><button disabled={i > step} onClick={() => setStep(i)}><span>{i + 1}</span>{s}</button></li>)}</ol>
      <div className="wiz-body">{children}</div>
      <div className="wiz-foot">
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Wstecz</button>
        {step < steps.length - 1 ? <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Dalej</button> : finish}
      </div>
    </section>
  );

const SCENE_DOMAINS = ['light', 'switch', 'cover', 'climate', 'media_player', 'fan', 'input_boolean', 'humidifier', 'valve', 'water_heater'];
const DOM_PL: Record<string, string> = { light: 'Światła', switch: 'Przełączniki', cover: 'Rolety / bramy', climate: 'Klimat', media_player: 'Media', fan: 'Wentylatory', input_boolean: 'Pomocnicze', humidifier: 'Nawilżacze', valve: 'Zawory', water_heater: 'Woda' };

/** Scene state for an entity as it is right now (state + the attributes a scene can restore). */
function captureState(s?: HassState): Record<string, unknown> {
  if (!s) return { state: 'on' };
  const a = s.attributes, d = domainOf(s.entity_id), out: Record<string, unknown> = { state: s.state };
  if (d === 'light' && s.state === 'on') {
    if (a.brightness != null) out.brightness = a.brightness;
    if (a.color_mode === 'color_temp' && a.color_temp_kelvin) out.color_temp_kelvin = a.color_temp_kelvin;
    else if (a.rgb_color && ['rgb', 'rgbw', 'rgbww', 'hs', 'xy'].includes(a.color_mode)) out.rgb_color = a.rgb_color;
    if (a.effect && a.effect !== 'None') out.effect = a.effect;
  }
  if (d === 'cover' && a.current_position != null) out.current_position = a.current_position;
  if (d === 'climate') { if (a.temperature != null) out.temperature = a.temperature; if (a.preset_mode) out.preset_mode = a.preset_mode; }
  if (d === 'media_player' && s.state !== 'off') { if (a.volume_level != null) out.volume_level = a.volume_level; if (a.source) out.source = a.source; }
  if (d === 'fan' && s.state === 'on') { if (a.percentage != null) out.percentage = a.percentage; if (a.preset_mode) out.preset_mode = a.preset_mode; }
  return out;
}

const stateText = (st: Record<string, unknown>) => Object.entries(st).map(([k, v]) => k === 'state' ? String(v) : k === 'brightness' ? `${Math.round((Number(v) / 255) * 100)}%` : k === 'current_position' ? `pozycja ${v}%` : k === 'temperature' ? `${v}°` : k === 'color_temp_kelvin' ? `${v} K` : k === 'volume_level' ? `głośność ${Math.round(Number(v) * 100)}%` : k === 'percentage' ? `${v}%` : k === 'rgb_color' ? 'kolor' : String(v)).join(' · ');

// ---------------------------------------------------------------- scene wizard
const SceneWizard: FC<{ onCancel(): void; onDone(msg: string): void }> = ({ onCancel, onDone }) => {
  const all = useEntityList();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | undefined>('mdi:palette');
  const [q, setQ] = useState('');
  const [dom, setDom] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, Record<string, unknown>>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /** TVs of the add-on (Telewizory / remote) – not HA entities, so they go into a companion automation */
  const [tvList, setTvList] = useState<TvDef[]>([]);
  const [tvs, setTvs] = useState<TvStep[]>([]);
  useEffect(() => { api.get<TvDef[]>('tvs').then(setTvList).catch(() => {}); }, []);
  const tvOf = (id: string) => tvList.find((t) => t.id === id);
  const toggleTv = (id: string) => setTvs(tvs.some((t) => t.tv === id) ? tvs.filter((t) => t.tv !== id) : [...tvs, { tv: id, power: 'on' }]);
  const setTv = (id: string, p: Partial<TvStep>) => setTvs(tvs.map((t) => (t.tv === id ? Object.fromEntries(Object.entries({ ...t, ...p }).filter(([, v]) => v !== undefined && v !== '')) as unknown as TvStep : t)));
  const tvText = (t: TvStep) => [t.power === 'on' ? 'włącz' : t.power === 'off' ? 'wyłącz' : '', t.app ? (tvOf(t.tv)?.apps.find((a) => a.appId === t.app)?.name ?? t.app) : '', ...(t.keys ?? [])].filter(Boolean).join(' → ') || 'bez zmian';

  const cand = useMemo(() => all.filter((e) => SCENE_DOMAINS.includes(e.domain) && (!dom || e.domain === dom) &&
    (!q || (e.name + ' ' + e.entity_id + ' ' + (e.area ?? '')).toLowerCase().includes(q.toLowerCase()))), [all, q, dom]);
  const byArea = useMemo(() => {
    const m = new Map<string, EntityInfo[]>();
    for (const e of cand) { const k = e.area || 'Bez obszaru'; m.set(k, [...(m.get(k) ?? []), e]); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pl'));
  }, [cand]);
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const goStates = () => { const st = { ...states }; for (const e of sel) st[e] ??= captureState(hass.states.get(e)); setStates(st); };
  const scene = () => Object.fromEntries(sel.map((e) => [e, states[e] ?? captureState(hass.states.get(e))]));
  const setSt = (e: string, p: Record<string, unknown>) => setStates({ ...states, [e]: Object.fromEntries(Object.entries({ ...states[e], ...p }).filter(([, v]) => v !== undefined)) });

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ note?: string }>('ha/scene', { name, icon, entities: scene(), tvs });
      onDone(`Scena „${name}” zapisana w Home Assistant.${tvs.length ? ' Telewizor steruje automatyzacja „Scena „' + name + '” – telewizor” (włącza się razem ze sceną).' : ''}${r.note ?? ''}`);
    }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const preview = async () => {
    setErr('');
    try {
      if (sel.length) await api.post('ha/scene/apply', { entities: scene() });
      if (tvs.length) { const r = await api.post<{ errors: string[] }>('tvs/run', { steps: tvs }); if (r.errors.length) setErr('Telewizor: ' + r.errors.join('; ')); }
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Steps title="Nowa scena" steps={['Nazwa', 'Urządzenia', 'Ustawienia', 'Zapis']} step={step} setStep={(n) => { if (n === 2) goStates(); setStep(n); }} onCancel={onCancel}
      canNext={step === 0 ? !!name.trim() : step === 1 ? sel.length + tvs.length > 0 : true}
      finish={<button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Zapisuję…' : 'Zapisz scenę w HA'}</button>}>
      {step === 0 && <div className="wiz-narrow">
        <TextF label="Nazwa sceny" value={name} onChange={(v) => setName(v ?? '')} placeholder="np. Wieczór filmowy" />
        <IconF value={icon} onChange={setIcon} />
        <p className="muted">Najprościej: ustaw najpierw światła, rolety itd. tak jak chcesz (choćby z tabletu), a w kroku „Ustawienia” kliknij „Jak teraz”.</p>
      </div>}
      {step === 1 && <>
        <div className="wiz-filter">
          <input placeholder="Szukaj: salon, lampa, roleta…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj encji" />
          <div className="app-chips"><button className={'chip' + (!dom ? ' on' : '')} onClick={() => setDom('')}>wszystkie</button>
            {SCENE_DOMAINS.filter((d) => all.some((e) => e.domain === d)).map((d) => <button key={d} className={'chip' + (dom === d ? ' on' : '')} onClick={() => setDom(d)}>{DOM_PL[d] ?? d}</button>)}</div>
          <span className="muted">wybrano {sel.length + tvs.length}</span>
        </div>
        <div className="wiz-areas">
          {tvList.length > 0 && <fieldset className="field">
            <legend>Telewizory (pilot Wall Dashboard)</legend>
            {tvList.map((t) => <label key={t.id} className="check"><input type="checkbox" checked={tvs.some((x) => x.tv === t.id)} onChange={() => toggleTv(t.id)} />{t.name} <small className="muted">· {t.model || t.host}</small></label>)}
          </fieldset>}
          {byArea.map(([area, list]) => (
            <fieldset key={area} className="field">
              <legend>{area} <button className="mini" onClick={() => { const ids = list.map((e) => e.entity_id); const allOn = ids.every((i) => sel.includes(i)); setSel(allOn ? sel.filter((x) => !ids.includes(x)) : [...new Set([...sel, ...ids])]); }}>wszystkie</button></legend>
              {list.map((e) => <label key={e.entity_id} className="check"><input type="checkbox" checked={sel.includes(e.entity_id)} onChange={() => toggle(e.entity_id)} />{e.name} <small className="muted">· {e.state}</small></label>)}
            </fieldset>
          ))}
        </div>
      </>}
      {step === 2 && <>
        <div className="row-btns">
          <button className="btn" onClick={() => setStates(Object.fromEntries(sel.map((e) => [e, captureState(hass.states.get(e))])))}>Wszystkie „jak teraz”</button>
          <button className="btn" onClick={preview}>Podgląd – ustaw teraz w domu</button>
        </div>
        <div className="wiz-rows">
          {sel.map((e) => <SceneRow key={e} entity={e} st={states[e] ?? {}} set={(p) => setSt(e, p)} capture={() => setStates({ ...states, [e]: captureState(hass.states.get(e)) })} />)}
          {tvs.map((t) => { const def = tvOf(t.tv); return def && <TvRow key={t.tv} def={def} st={t} set={(p) => setTv(t.tv, p)} />; })}
        </div>
      </>}
      {step === 3 && <div className="wiz-narrow">
        <h3>{name}</h3>
        <ul className="wiz-sum">{sel.map((e) => <li key={e}><b>{String(hass.states.get(e)?.attributes.friendly_name ?? e)}</b> → {stateText(states[e] ?? {})}</li>)}
          {tvs.map((t) => <li key={t.tv}><b>{tvOf(t.tv)?.name ?? t.tv}</b> (telewizor) → {tvText(t)}</li>)}</ul>
        {tvs.length > 0 && <p className="muted small">Telewizory z pilota Wall Dashboard nie są encjami HA, więc obok sceny powstanie automatyzacja <b>„Scena „{name}” – telewizor”</b>: gdy scenę włączysz (z tabletu, z HA, głosem), add-on wykona kroki telewizora. Usunięcie sceny tutaj usuwa też tę automatyzację.</p>}
        <p className="muted">Scena trafi do <code>scenes.yaml</code> w Home Assistant i pojawi się jako <code>scene.{name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}</code>.</p>
      </div>}
      {err && <p className="err">{err}</p>}
    </Steps>
  );
};

const SceneRow: FC<{ entity: string; st: Record<string, unknown>; set(p: Record<string, unknown>): void; capture(): void }> = ({ entity, st, set, capture }) => {
  const s = hass.states.get(entity);
  const d = domainOf(entity), a = s?.attributes ?? {};
  const on = st.state !== 'off' && st.state !== 'closed';
  const modes: string[] = a.supported_color_modes ?? [];
  return (
    <div className="wiz-row">
      <div className="wiz-row-h"><b>{String(a.friendly_name ?? entity)}</b><small className="muted">{entity}</small>
        <button className="mini" onClick={capture} title="Ustaw tak, jak jest teraz">jak teraz</button></div>
      <div className="wiz-row-c">
        {d === 'cover' ? (
          <SelectF label="Stan" value={String(st.state ?? 'open')} options={[['open', 'Otwarta'], ['closed', 'Zamknięta']]} onChange={(v) => set({ state: v, current_position: v === 'closed' ? 0 : st.current_position ?? 100 })} />
        ) : d === 'climate' ? (
          <SelectF label="Tryb" value={String(st.state ?? 'heat')} options={((a.hvac_modes as string[]) ?? ['off', 'heat']).map((m) => [m, m] as [string, string])} onChange={(v) => set({ state: v })} />
        ) : (
          <SelectF label="Stan" value={on ? 'on' : 'off'} options={[['on', 'Włączone'], ['off', 'Wyłączone']]} onChange={(v) => set({ state: v, ...(v === 'off' ? { brightness: undefined, rgb_color: undefined, color_temp_kelvin: undefined } : {}) })} />
        )}
        {d === 'light' && on && modes.some((m) => m !== 'onoff') && <NumF label="Jasność %" value={st.brightness != null ? Math.round((Number(st.brightness) / 255) * 100) : 100} min={1} max={100} onChange={(v) => set({ brightness: Math.round(((v ?? 100) / 100) * 255) })} />}
        {d === 'light' && on && modes.includes('color_temp') && <NumF label="Barwa (K)" value={st.color_temp_kelvin as number | undefined} min={Number(a.min_color_temp_kelvin ?? 2000)} max={Number(a.max_color_temp_kelvin ?? 6500)} step={100} onChange={(v) => set({ color_temp_kelvin: v, rgb_color: undefined })} />}
        {d === 'light' && on && modes.some((m) => ['rgb', 'rgbw', 'rgbww', 'hs', 'xy'].includes(m)) && (
          <label className="field"><span>Kolor</span><input type="color" value={Array.isArray(st.rgb_color) ? '#' + (st.rgb_color as number[]).map((x) => x.toString(16).padStart(2, '0')).join('') : '#ffc578'}
            onChange={(e) => { const h = e.target.value; set({ rgb_color: [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), color_temp_kelvin: undefined }); }} /></label>
        )}
        {d === 'cover' && st.state !== 'closed' && <NumF label="Pozycja %" value={st.current_position as number | undefined} min={0} max={100} onChange={(v) => set({ current_position: v })} />}
        {d === 'climate' && st.state !== 'off' && <NumF label="Temperatura °C" value={st.temperature as number | undefined} min={5} max={35} step={0.5} onChange={(v) => set({ temperature: v })} />}
        {d === 'media_player' && on && <NumF label="Głośność %" value={st.volume_level != null ? Math.round(Number(st.volume_level) * 100) : undefined} min={0} max={100} onChange={(v) => set({ volume_level: v != null ? v / 100 : undefined })} />}
        {d === 'fan' && on && <NumF label="Prędkość %" value={st.percentage as number | undefined} min={0} max={100} onChange={(v) => set({ percentage: v })} />}
      </div>
    </div>
  );
};

const INPUTS: [string, string][] = [['', '— bez zmiany —'], ['KEY_TV', 'Telewizja (tuner)'], ['KEY_HDMI1', 'HDMI 1'], ['KEY_HDMI2', 'HDMI 2'], ['KEY_HDMI3', 'HDMI 3'], ['KEY_HDMI4', 'HDMI 4']];
/** one add-on TV in a scene: power, then an app (shortcut from Telewizory) or an input, plus extra keys */
const TvRow: FC<{ def: TvDef; st: TvStep; set(p: Partial<TvStep>): void }> = ({ def, st, set }) => {
  const input = st.keys?.find((k) => INPUTS.some(([v]) => v === k)) ?? '';
  const extra = (st.keys ?? []).filter((k) => k !== input);
  const [raw, setRaw] = useState(extra.join(' '));
  return (
    <div className="wiz-row">
      <div className="wiz-row-h"><b>{def.name}</b><small className="muted">telewizor · {def.host}</small></div>
      <div className="wiz-row-c">
        <SelectF label="Zasilanie" value={st.power ?? ''} options={[['on', 'Włącz'], ['off', 'Wyłącz'], ['', 'Bez zmiany']]} onChange={(v) => set({ power: (v || undefined) as TvStep['power'], ...(v === 'off' ? { app: undefined, keys: undefined } : {}) })} />
        {st.power !== 'off' && <>
          <SelectF label="Aplikacja" value={st.app ?? ''} options={[['', '— bez zmiany —'], ...def.apps.map((a) => [a.appId, a.name] as [string, string])]} onChange={(v) => set({ app: v || undefined })}
            hint={def.apps.length ? undefined : 'Dodaj skróty aplikacji w Telewizory.'} />
          <SelectF label="Wejście" value={input} options={INPUTS} onChange={(v) => set({ keys: [...(v ? [v] : []), ...extra] })} />
          <TextF label="Dodatkowe klawisze" value={raw} placeholder="np. KEY_VOLDOWN KEY_VOLDOWN" hint="Klawisze pilota Samsung, wysyłane po kolei po aplikacji / wejściu." onChange={(v) => { setRaw(String(v ?? '').toUpperCase()); set({ keys: [...(input ? [input] : []), ...String(v ?? '').toUpperCase().split(/[\s,]+/).filter((k) => /^KEY_[A-Z0-9_]+$/.test(k))] }); }} />
        </>}
      </div>
      {st.power === 'on' && !def.mac && <p className="muted small">Bez adresu MAC (Telewizory) całkiem wyłączonego telewizora nie da się włączyć – zadziała tylko z czuwania.</p>}
    </div>
  );
};

// ---------------------------------------------------------------- automation wizard
type Trig = { kind: 'time'; at: string } | { kind: 'sun'; event: 'sunset' | 'sunrise'; offset: number } | { kind: 'state'; entity: string; to: string; forMin: number }
  | { kind: 'numeric'; entity: string; above?: number; below?: number };
type Cond = { kind: 'days'; days: string[] } | { kind: 'between'; after: string; before: string } | { kind: 'dark' } | { kind: 'state'; entity: string; state: string };
type Act = { kind: 'scene'; entity: string } | { kind: 'set'; entity: string; value: string } | { kind: 'delay'; minutes: number }
  | { kind: 'notify'; service: string; title: string; message: string } | { kind: 'popup'; title: string; camera: string; stream: string };

const DAYS: [string, string][] = [['mon', 'pn'], ['tue', 'wt'], ['wed', 'śr'], ['thu', 'cz'], ['fri', 'pt'], ['sat', 'sb'], ['sun', 'nd']];
const hms = (min: number) => { const s = min < 0 ? '-' : ''; const m = Math.abs(min); return `${s}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`; };

function toHa(t: Trig, conds: Cond[], acts: Act[]) {
  const trigger = t.kind === 'time' ? { trigger: 'time', at: t.at + ':00' }
    : t.kind === 'sun' ? { trigger: 'sun', event: t.event, ...(t.offset ? { offset: hms(t.offset) } : {}) }
    : t.kind === 'state' ? { trigger: 'state', entity_id: t.entity, ...(t.to ? { to: t.to } : {}), ...(t.forMin ? { for: { minutes: t.forMin } } : {}) }
    : { trigger: 'numeric_state', entity_id: t.entity, ...(t.above != null ? { above: t.above } : {}), ...(t.below != null ? { below: t.below } : {}) };
  const conditions = conds.map((c) => c.kind === 'days' ? { condition: 'time', weekday: c.days }
    : c.kind === 'between' ? { condition: 'time', after: c.after + ':00', before: c.before + ':00' }
    : c.kind === 'dark' ? { condition: 'sun', after: 'sunset', before: 'sunrise' }
    : { condition: 'state', entity_id: c.entity, state: c.state });
  const actions = acts.map((a) => {
    if (a.kind === 'scene') return { action: 'scene.turn_on', target: { entity_id: a.entity } };
    if (a.kind === 'delay') return { delay: { minutes: a.minutes } };
    if (a.kind === 'notify') return { action: a.service.startsWith('notify.') ? a.service : 'notify.' + a.service, data: { message: a.message, ...(a.title ? { title: a.title } : {}) } };
    if (a.kind === 'popup') return { event: 'wall_dashboard_popup', event_data: { title: a.title, ...(a.camera ? { camera: a.camera } : {}), ...(a.stream ? { go2rtc: { stream: a.stream } } : {}), timeout: 60 } };
    const sc = serviceFor(a.entity, a.value);
    return { action: `${sc.domain}.${sc.service}`, target: { entity_id: a.entity }, ...(sc.data ? { data: sc.data } : {}) };
  });
  return { triggers: [trigger], conditions, actions };
}
const trigText = (t: Trig) => t.kind === 'time' ? `codziennie o ${t.at}` : t.kind === 'sun' ? `${t.event === 'sunset' ? 'zachód' : 'wschód'} słońca${t.offset ? ` ${t.offset > 0 ? '+' : ''}${t.offset} min` : ''}`
  : t.kind === 'state' ? `${t.entity} zmieni się${t.to ? ' na „' + t.to + '”' : ''}${t.forMin ? ` na ${t.forMin} min` : ''}` : `${t.entity}${t.above != null ? ' > ' + t.above : ''}${t.below != null ? ' < ' + t.below : ''}`;

const AutomationWizard: FC<{ onCancel(): void; onDone(msg: string): void }> = ({ onCancel, onDone }) => {
  const [step, setStep] = useState(0);
  const [trig, setTrig] = useState<Trig>({ kind: 'time', at: '07:00' });
  const [conds, setConds] = useState<Cond[]>([]);
  const [acts, setActs] = useState<Act[]>([{ kind: 'set', entity: '', value: 'on' }]);
  const [alias, setAlias] = useState('');
  const [mode, setMode] = useState('single');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const notifyServices = useMemo(() => [...hass.states.keys()].filter((e) => e.startsWith('device_tracker.') || e.startsWith('person.')).length ? ['notify', 'persistent_notification'] : ['notify'], []);

  const trigOk = trig.kind === 'time' ? /^\d\d:\d\d$/.test(trig.at) : trig.kind === 'sun' ? true : !!trig.entity;
  const actsOk = acts.length > 0 && acts.every((a) => a.kind === 'delay' ? a.minutes > 0 : a.kind === 'notify' ? !!a.message : a.kind === 'popup' ? !!a.title : !!a.entity);
  const setC = (i: number, c: Cond) => setConds(conds.map((x, j) => (j === i ? c : x)));
  const setA = (i: number, a: Act) => setActs(acts.map((x, j) => (j === i ? a : x)));
  const move = (i: number, d: number) => { const n = [...acts]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setActs(n); };

  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('ha/automation', { alias, mode, ...toHa(trig, conds, acts) }); onDone(`Automatyzacja „${alias}” zapisana i włączona w Home Assistant.`); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Steps title="Nowa automatyzacja" steps={['Kiedy', 'Warunki', 'Co zrobić', 'Nazwa i zapis']} step={step} setStep={setStep} onCancel={onCancel}
      canNext={step === 0 ? trigOk : step === 2 ? actsOk : true}
      finish={<button className="btn primary" disabled={busy || !alias.trim()} onClick={save}>{busy ? 'Zapisuję…' : 'Zapisz automatyzację w HA'}</button>}>
      {step === 0 && <div className="wiz-narrow">
        <div className="wiz-cards">
          {([['time', 'O godzinie', 'clock'], ['sun', 'Wschód / zachód', 'sun'], ['state', 'Gdy coś się zmieni', 'bolt'], ['numeric', 'Gdy wartość przekroczy', 'chart']] as const).map(([k, l, ic]) => (
            <button key={k} className={'wiz-card' + (trig.kind === k ? ' on' : '')} onClick={() => setTrig(k === 'time' ? { kind: 'time', at: '07:00' } : k === 'sun' ? { kind: 'sun', event: 'sunset', offset: 0 } : k === 'state' ? { kind: 'state', entity: '', to: 'on', forMin: 0 } : { kind: 'numeric', entity: '' })}>
              <Icon name={ic} size={22} /><span>{l}</span></button>
          ))}
        </div>
        {trig.kind === 'time' && <label className="field"><span>Godzina</span><input type="time" value={trig.at} onChange={(e) => setTrig({ ...trig, at: e.target.value })} /></label>}
        {trig.kind === 'sun' && <>
          <SelectF label="Zdarzenie" value={trig.event} options={[['sunset', 'Zachód słońca'], ['sunrise', 'Wschód słońca']]} onChange={(v) => setTrig({ ...trig, event: v as 'sunset' | 'sunrise' })} />
          <NumF label="Przesunięcie (min, ujemne = wcześniej)" value={trig.offset} min={-180} max={180} onChange={(v) => setTrig({ ...trig, offset: v ?? 0 })} />
        </>}
        {trig.kind === 'state' && <>
          <EntityF label="Encja" value={trig.entity} onChange={(v) => setTrig({ ...trig, entity: v ?? '' })} hint="np. binary_sensor.ruch_hall, event.dzwonek, person.jan" />
          <TextF label="Zmieni się na (pusto = każda zmiana)" value={trig.to} onChange={(v) => setTrig({ ...trig, to: v ?? '' })} placeholder={trig.entity && hass.states.get(trig.entity) ? 'teraz: ' + hass.states.get(trig.entity)!.state : 'on / home / open'} />
          <NumF label="…i trwa co najmniej (min)" value={trig.forMin} min={0} max={1440} onChange={(v) => setTrig({ ...trig, forMin: v ?? 0 })} />
        </>}
        {trig.kind === 'numeric' && <>
          <EntityF label="Czujnik" value={trig.entity} domains={['sensor', 'number', 'input_number']} onChange={(v) => setTrig({ ...trig, entity: v ?? '' })} />
          <div className="ins-grid2">
            <NumF label="Powyżej" value={trig.above} onChange={(v) => setTrig({ ...trig, above: v })} />
            <NumF label="Poniżej" value={trig.below} onChange={(v) => setTrig({ ...trig, below: v })} />
          </div>
        </>}
      </div>}
      {step === 1 && <div className="wiz-narrow">
        <p className="muted">Opcjonalnie – automatyzacja zadziała tylko, gdy wszystkie warunki są spełnione.</p>
        {conds.map((c, i) => (
          <div key={i} className="wiz-row">
            <div className="wiz-row-h"><b>{c.kind === 'days' ? 'Tylko w dni' : c.kind === 'between' ? 'Tylko między godzinami' : c.kind === 'dark' ? 'Tylko po zmroku' : 'Tylko gdy'}</b>
              <button className="mini" onClick={() => setConds(conds.filter((_, j) => j !== i))}>×</button></div>
            {c.kind === 'days' && <div className="app-chips">{DAYS.map(([k, l]) => { const on = c.days.includes(k); return <button key={k} className={'chip' + (on ? ' on' : '')} onClick={() => setC(i, { ...c, days: on ? c.days.filter((d) => d !== k) : [...c.days, k] })}>{l}</button>; })}</div>}
            {c.kind === 'between' && <div className="ins-grid2">
              <label className="field"><span>Od</span><input type="time" value={c.after} onChange={(e) => setC(i, { ...c, after: e.target.value })} /></label>
              <label className="field"><span>Do</span><input type="time" value={c.before} onChange={(e) => setC(i, { ...c, before: e.target.value })} /></label></div>}
            {c.kind === 'state' && <div className="ins-grid2">
              <EntityF label="Encja" value={c.entity} onChange={(v) => setC(i, { ...c, entity: v ?? '' })} />
              <TextF label="ma stan" value={c.state} onChange={(v) => setC(i, { ...c, state: v ?? '' })} placeholder="np. home, off" /></div>}
          </div>
        ))}
        <div className="row-btns">
          <button className="btn" onClick={() => setConds([...conds, { kind: 'days', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }])}>+ Dni tygodnia</button>
          <button className="btn" onClick={() => setConds([...conds, { kind: 'between', after: '06:00', before: '22:00' }])}>+ Przedział godzin</button>
          <button className="btn" onClick={() => setConds([...conds, { kind: 'dark' }])}>+ Po zmroku</button>
          <button className="btn" onClick={() => setConds([...conds, { kind: 'state', entity: '', state: 'home' }])}>+ Stan encji</button>
        </div>
      </div>}
      {step === 2 && <div className="wiz-narrow">
        {acts.map((a, i) => (
          <div key={i} className="wiz-row">
            <div className="wiz-row-h"><b>{i + 1}. {a.kind === 'scene' ? 'Włącz scenę' : a.kind === 'set' ? 'Ustaw urządzenie' : a.kind === 'delay' ? 'Odczekaj' : a.kind === 'notify' ? 'Powiadomienie' : 'Pop-up na tabletach'}</b>
              <span><button className="mini" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button className="mini" disabled={i === acts.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="mini" onClick={() => setActs(acts.filter((_, j) => j !== i))}>×</button></span></div>
            {a.kind === 'scene' && <EntityF label="Scena" value={a.entity} domains={['scene', 'script']} onChange={(v) => setA(i, { ...a, entity: v ?? '' })} />}
            {a.kind === 'set' && <div className="ins-grid2">
              <EntityF label="Urządzenie" value={a.entity} onChange={(v) => setA(i, { ...a, entity: v ?? '' })} />
              <TextF label="Wartość" value={a.value} onChange={(v) => setA(i, { ...a, value: v ?? '' })} placeholder="on / off / 50 / 21.5 / tryb" /></div>}
            {a.kind === 'set' && a.entity && <p className="muted small">→ {(() => { const sc = serviceFor(a.entity, a.value); return `${sc.domain}.${sc.service}${sc.data ? ' ' + JSON.stringify(sc.data) : ''}`; })()}</p>}
            {a.kind === 'delay' && <NumF label="Minuty" value={a.minutes} min={1} max={1440} onChange={(v) => setA(i, { ...a, minutes: v ?? 1 })} />}
            {a.kind === 'notify' && <>
              <TextF label="Usługa powiadomień" value={a.service} onChange={(v) => setA(i, { ...a, service: v ?? 'notify' })} placeholder="notify.mobile_app_telefon" hint="w HA: Narzędzia deweloperskie → Akcje, wpisz „notify.”" />
              <TextF label="Tytuł" value={a.title} onChange={(v) => setA(i, { ...a, title: v ?? '' })} />
              <TextF label="Treść" value={a.message} onChange={(v) => setA(i, { ...a, message: v ?? '' })} /></>}
            {a.kind === 'popup' && <>
              <TextF label="Tytuł" value={a.title} onChange={(v) => setA(i, { ...a, title: v ?? '' })} />
              <EntityF label="Kamera (opcjonalnie)" value={a.camera} domains={['camera']} onChange={(v) => setA(i, { ...a, camera: v ?? '' })} />
              <TextF label="…albo strumień go2rtc" value={a.stream} onChange={(v) => setA(i, { ...a, stream: v ?? '' })} placeholder="furtka" /></>}
          </div>
        ))}
        <div className="row-btns">
          <button className="btn" onClick={() => setActs([...acts, { kind: 'set', entity: '', value: 'on' }])}>+ Ustaw urządzenie</button>
          <button className="btn" onClick={() => setActs([...acts, { kind: 'scene', entity: '' }])}>+ Scena</button>
          <button className="btn" onClick={() => setActs([...acts, { kind: 'delay', minutes: 5 }])}>+ Odczekaj</button>
          <button className="btn" onClick={() => setActs([...acts, { kind: 'notify', service: notifyServices[0] === 'notify' ? 'notify.notify' : 'notify.notify', title: '', message: '' }])}>+ Powiadomienie</button>
          <button className="btn" onClick={() => setActs([...acts, { kind: 'popup', title: 'Ktoś dzwoni', camera: '', stream: '' }])}>+ Pop-up na tablecie</button>
        </div>
      </div>}
      {step === 3 && <div className="wiz-narrow">
        <TextF label="Nazwa" value={alias} onChange={(v) => setAlias(v ?? '')} placeholder="np. Rolety w dół po zachodzie" />
        <SelectF label="Gdy wyzwoli się ponownie w trakcie" value={mode} onChange={setMode} options={[['single', 'zignoruj'], ['restart', 'zacznij od nowa'], ['queued', 'kolejkuj'], ['parallel', 'równolegle']]} />
        <ul className="wiz-sum">
          <li><b>Kiedy:</b> {trigText(trig)}</li>
          {conds.length > 0 && <li><b>Warunki:</b> {conds.map((c) => c.kind === 'days' ? DAYS.filter(([k]) => c.days.includes(k)).map(([, l]) => l).join(', ') : c.kind === 'between' ? `${c.after}–${c.before}` : c.kind === 'dark' ? 'po zmroku' : `${c.entity} = ${c.state}`).join(' · ')}</li>}
          <li><b>Co zrobić:</b> {acts.map((a) => a.kind === 'scene' ? a.entity : a.kind === 'set' ? `${a.entity} → ${a.value}` : a.kind === 'delay' ? `czekaj ${a.minutes} min` : a.kind === 'notify' ? `powiadom „${a.message}”` : `pop-up „${a.title}”`).join(' → ')}</li>
        </ul>
        <details><summary className="muted">Podgląd dla Home Assistant</summary><pre className="wiz-pre">{JSON.stringify({ alias, mode, ...toHa(trig, conds, acts) }, null, 2)}</pre></details>
      </div>}
      {err && <p className="err">{err}</p>}
    </Steps>
  );
};
