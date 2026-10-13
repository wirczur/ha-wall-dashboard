// Settings of the thermostat / AC widget — also used for room thermostats and AC devices in the house editor.
import { useState, type FC } from 'react';
import { api } from '../lib/api';
import type { ClimateExtra, ClimateFeature, ClimateOptions, ClimateRef, ClimateRole, ModeKind, ModeOption } from '../../../shared/types';
import { hass } from '../lib/hass';
import { entityOptions, featureIcon, inferKind, KIND_ICON, MODE_KINDS, resolveRoles, ROLE_LABEL } from '../widgets/climate';
import { CheckF, EntityF, NumF, SelectF, TextF } from './fields';

type Opt = ClimateOptions;
const KIND_NAME: Record<ModeKind, string> = {
  manual: 'Ręczny', schedule: 'Harmonogram', off: 'Wyłączony', heat: 'Grzanie', cool: 'Chłodzenie', auto: 'Auto', dry: 'Osuszanie',
  fan: 'Wentylator', eco: 'Eko', comfort: 'Komfort', away: 'Poza domem / antyzamarzanie', boost: 'Boost', other: 'Inny'
};
const ROLE_GROUPS: { title: string; roles: ClimateRole[]; ac?: boolean }[] = [
  { title: 'Podstawowe', roles: ['current', 'humidity', 'target', 'mode', 'action', 'power'] },
  { title: 'Klimatyzacja', roles: ['fan', 'swing', 'preset'], ac: true },
  { title: 'Harmonogram', roles: ['nextTime', 'nextTarget', 'overrideTarget'] }
];
const ROLE_HINT: Partial<Record<ClimateRole, string>> = {
  current: 'sensor.* lub atrybut', target: 'number / input_number / climate', mode: 'select / input_select / switch / climate',
  action: 'binary_sensor / switch / sensor (pompa, zawór, przekaźnik)', power: 'switch – osobne zasilanie (opcjonalnie)',
  nextTime: 'sensor z godziną następnej zmiany', nextTarget: 'sensor z temperaturą następnej zmiany',
  overrideTarget: 'number dla zmiany tymczasowej (tryb „Zmień tymczasowo”)'
};
const tri = (v?: boolean) => (v == null ? '' : v ? '1' : '0');
const fromTri = (v: string) => (v === '' ? undefined : v === '1');
const asModes = (m?: ModeOption[] | string[]): ModeOption[] => (m || []).map((x) => (typeof x === 'string' ? { value: x } : x));

export const ClimateEditor: FC<{
  value?: Opt; onChange(v: Opt | undefined): void;
  /** base climate entity (widget entity / room climate) */
  entity?: string;
  /** hide layout options (room / device panels are always large) */
  panel?: boolean;
}> = ({ value, onChange, entity, panel }) => {
  const o: Opt = value || {};
  const set = (p: Partial<Opt>) => {
    const n = Object.fromEntries(Object.entries({ ...o, ...p }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as Opt;
    onChange(Object.keys(n).length ? n : undefined);
  };
  const kind = o.kind ?? 'thermostat';
  const source = o.source ?? 'climate';
  const effective = resolveRoles({ entity, options: o });

  const setRole = (r: ClimateRole, ref: Partial<ClimateRef> | undefined) => {
    const roles = { ...(o.roles || {}) };
    const next = ref ? { ...(roles[r] || { entity: '' }), ...ref } : undefined;
    if (!next || !next.entity) delete roles[r]; else roles[r] = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as unknown as ClimateRef;
    set({ roles: Object.keys(roles).length ? roles : undefined });
  };
  const loadFrom = (role: ClimateRole) => {
    const ref = effective[role];
    const vals = entityOptions(role, ref, ref ? hass.states.get(ref.entity) : undefined);
    return vals.map((v) => ({ value: v, ...(role === 'mode' ? { kind: inferKind(v, kind) } : {}) }));
  };

  return <>
    <SelectF label="Rodzaj" value={kind} options={[['thermostat', 'Termostat / ogrzewanie'], ['ac', 'Klimatyzacja']]} onChange={(v) => set({ kind: v as Opt['kind'] })} />
    <SelectF label="Źródło danych" value={source} onChange={(v) => set({ source: v === 'climate' ? undefined : 'entities' })}
      options={[['climate', 'Encja climate (+ nadpisane role)'], ['entities', 'Tylko osobne encje (role)']]}
      hint={source === 'climate' ? (entity ? `Role puste = z ${entity}` : 'Ustaw encję climate albo wybierz „osobne encje”') : 'Encja widgetu nie jest używana'} />
    {!panel && <>
      <SelectF label="Układ" value={o.layout ?? 'auto'} onChange={(v) => set({ layout: v === 'auto' ? undefined : v as Opt['layout'] })}
        options={[['auto', 'Automatycznie wg rozmiaru'], ['small', 'Mały (1×1)'], ['medium', 'Średni (2×1)'], ['large', 'Duży – wszystko'], ['bar', 'Pasek (jeden wiersz)']]} />
      {(o.layout ?? 'auto') !== 'medium' && (o.layout ?? 'auto') !== 'large' && (o.layout ?? 'auto') !== 'bar' && (
        <SelectF label="Mały: po dotknięciu" value={o.smallTap ?? 'panel'} onChange={(v) => set({ smallTap: v === 'panel' ? undefined : v as Opt['smallTap'] })}
          options={[['panel', 'Panel z pełnym sterowaniem'], ['cycle', 'Następny tryb'], ['power', 'Włącz / wyłącz'], ['none', 'Nic']]} />
      )}
    </>}

    <h4 className="ins-h">Role (encje)</h4>
    {ROLE_GROUPS.filter((g) => !g.ac || kind === 'ac' || g.roles.some((r) => o.roles?.[r])).map((g) => (
      <details key={g.title} className="ins-sub" open={g.title === 'Podstawowe'}>
        <summary>{g.title}</summary>
        {g.roles.map((r) => <RoleRow key={r} role={r} value={o.roles?.[r]} inherited={!o.roles?.[r]?.entity && effective[r] ? effective[r]!.entity : undefined}
          onChange={(ref) => setRole(r, ref)} />)}
      </details>
    ))}

    <h4 className="ins-h">Tryby</h4>
    <ModesF value={asModes(o.modes)} withKind onChange={(m) => set({ modes: m })} onLoad={() => set({ modes: loadFrom('mode') })} />
    {(kind === 'ac' || o.fanModes?.length) && <><h4 className="ins-h">Wentylator</h4>
      <ModesF value={o.fanModes || []} onChange={(m) => set({ fanModes: m })} onLoad={() => set({ fanModes: loadFrom('fan') })} /></>}
    {(kind === 'ac' || o.swingModes?.length) && <><h4 className="ins-h">Lamele</h4>
      <ModesF value={o.swingModes || []} onChange={(m) => set({ swingModes: m })} onLoad={() => set({ swingModes: loadFrom('swing') })} /></>}
    {(o.showPreset || o.presetModes?.length) && <><h4 className="ins-h">Presety</h4>
      <ModesF value={o.presetModes || []} onChange={(m) => set({ presetModes: m })} onLoad={() => set({ presetModes: loadFrom('preset') })} /></>}

    <h4 className="ins-h">Zachowanie</h4>
    <SelectF label="−/+ w harmonogramie" value={o.scheduleBehavior ?? 'switch'} onChange={(v) => set({ scheduleBehavior: v === 'switch' ? undefined : v as Opt['scheduleBehavior'] })}
      options={[['switch', 'Przełącz na ręczny'], ['lock', 'Zablokuj'], ['override', 'Zmień tymczasowo']]}
      hint={o.scheduleBehavior === 'override' ? (o.roles?.overrideTarget ? 'Wartość idzie do roli „Nastawa tymczasowa”' : 'Bez roli „Nastawa tymczasowa” wartość idzie do nastawy – sterownik sam decyduje, na jak długo') : undefined} />
    <SelectF label="−/+ gdy wyłączony" value={o.offBehavior ?? 'lock'} onChange={(v) => set({ offBehavior: v === 'lock' ? undefined : 'switch' })}
      options={[['lock', 'Zablokuj'], ['switch', 'Włącz (tryb ręczny / ostatni)']]} />
    <SelectF label="Tryb „ręczny”" value={o.manualMode ?? ''} onChange={(v) => set({ manualMode: v || undefined })}
      options={[['', 'automatycznie'], ...asModes(o.modes).map((m) => [m.value, m.label || m.value] as [string, string]), ...(o.manualMode && !asModes(o.modes).some((m) => m.value === o.manualMode) ? [[o.manualMode, o.manualMode] as [string, string]] : [])]}
      hint="Na ten tryb przełącza −/+ w harmonogramie i włączenie" />
    <div className="ins-grid4">
      <NumF label="Krok" value={o.step} step={0.1} placeholder="z encji" onChange={(v) => set({ step: v })} />
      <NumF label="Min" value={o.min} step={0.5} placeholder="z encji" onChange={(v) => set({ min: v })} />
      <NumF label="Max" value={o.max} step={0.5} placeholder="z encji" onChange={(v) => set({ max: v })} />
      <NumF label="Miejsca" value={o.decimals} min={0} max={2} placeholder="1" onChange={(v) => set({ decimals: v })} />
    </div>
    <NumF label="Opóźnienie wysłania (ms)" value={o.debounce} min={0} max={5000} step={100} placeholder="900" onChange={(v) => set({ debounce: v })}
      hint="Kilka kliknięć −/+ = jedno wywołanie" />
    <TextF label="Stany „pracuje”" value={o.activeStates?.join(', ')} placeholder="on, heating, cooling, liczby > 0"
      onChange={(v) => set({ activeStates: v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined })} />
    <CheckF label="Bez roli „Czy pracuje”: zgaduj z nastawy i temperatury" value={o.inferAction !== false} onChange={(v) => set({ inferAction: v ? undefined : false })} />
    <TextF label="Podpis nastawy" value={o.targetLabel} placeholder="Nastawa" onChange={(v) => set({ targetLabel: v })} />

    <h4 className="ins-h">Wyświetlanie</h4>
    <SelectF label="Wybór trybu" value={o.modeControl ?? 'auto'} onChange={(v) => set({ modeControl: v === 'auto' ? undefined : v as Opt['modeControl'] })}
      options={[['auto', 'Automatycznie (duży: przyciski, mniejsze: przełącznik)'], ['buttons', 'Przyciski'], ['cycle', 'Jeden przycisk – kolejny tryb'], ['hidden', 'Ukryj']]} />
    <SelectF label="Przycisk zasilania" value={tri(o.showPower)} onChange={(v) => set({ showPower: fromTri(v) })}
      options={[['', kind === 'ac' ? 'automatycznie (klima: tak)' : 'automatycznie (termostat: nie)'], ['1', 'Pokaż'], ['0', 'Ukryj']]} />
    <SelectF label="Następny punkt" value={o.showNext ?? 'schedule'} onChange={(v) => set({ showNext: v === 'schedule' ? undefined : v as Opt['showNext'] })}
      options={[['schedule', 'Tylko w harmonogramie'], ['always', 'Zawsze'], ['never', 'Nigdy']]} />
    <CheckF label="Ikony trybów" value={o.modeIcons !== false} onChange={(v) => set({ modeIcons: v ? undefined : false })} />
    <CheckF label="Wilgotność" value={o.showHumidity !== false} onChange={(v) => set({ showHumidity: v ? undefined : false })} />
    <CheckF label="Dodatkowe wartości" value={o.showExtras !== false} onChange={(v) => set({ showExtras: v ? undefined : false })} />
    <CheckF label="Plakietka „Grzeje / Chłodzi”" value={o.showAction !== false} onChange={(v) => set({ showAction: v ? undefined : false })} />
    <CheckF label="…także „Bezczynny”" value={o.showIdle} onChange={(v) => set({ showIdle: v || undefined })} />
    <SelectF label="Wentylator" value={tri(o.showFan)} onChange={(v) => set({ showFan: fromTri(v) })} options={[['', 'automatycznie (klima)'], ['1', 'Pokaż'], ['0', 'Ukryj']]} />
    <SelectF label="Lamele" value={tri(o.showSwing)} onChange={(v) => set({ showSwing: fromTri(v) })} options={[['', 'automatycznie (klima)'], ['1', 'Pokaż'], ['0', 'Ukryj']]} />
    <CheckF label="Presety" value={o.showPreset} onChange={(v) => set({ showPreset: v || undefined })} />

    <h4 className="ins-h">Funkcje dodatkowe (przyciski)</h4>
    <FeaturesF value={o.features || []} entity={entity} onChange={(f) => set({ features: f.length ? f : undefined })} />

    <h4 className="ins-h">Dodatkowe wartości</h4>
    <ExtrasF value={o.extras || []} onChange={(x) => set({ extras: x })} />
  </>;
};

// ---------------------------------------------------------------- one role
const RoleRow: FC<{ role: ClimateRole; value?: ClimateRef; inherited?: string; onChange(v: Partial<ClimateRef> | undefined): void }> = ({ role, value, inherited, onChange }) => (
  <div className="ins-role">
    <EntityF label={ROLE_LABEL[role]} value={value?.entity} onChange={(e) => onChange(e ? { entity: e } : undefined)}
      hint={inherited ? `z ${inherited}` : ROLE_HINT[role]} />
    {value?.entity && (
      <details className="ins-sub">
        <summary>Atrybut / usługa</summary>
        <TextF label="Atrybut" value={value.attribute} placeholder="stan encji" onChange={(v) => onChange({ attribute: v })} />
        <TextF label="Usługa zapisu" value={value.service} placeholder="domyślna dla domeny" onChange={(v) => onChange({ service: v })} hint="np. script.ustaw_tymczasowa" />
        {value.service && <TextF label="Pole wartości" value={value.serviceField} placeholder="value" onChange={(v) => onChange({ serviceField: v })} />}
      </details>
    )}
  </div>
);

// ---------------------------------------------------------------- list of modes
const ModesF: FC<{ value: ModeOption[]; withKind?: boolean; onChange(v: ModeOption[] | undefined): void; onLoad(): void }> = ({ value, withKind, onChange, onLoad }) => {
  const upd = (i: number, p: Partial<ModeOption>) => onChange(value.map((m, j) => (j === i ? Object.fromEntries(Object.entries({ ...m, ...p }).filter(([, v]) => v !== undefined && v !== '')) as unknown as ModeOption : m)));
  const move = (i: number, d: number) => { const a = [...value]; const [x] = a.splice(i, 1); a.splice(Math.max(0, Math.min(a.length, i + d)), 0, x); onChange(a); };
  return (
    <div className="ins-modes">
      {value.length === 0 && <p className="muted">Puste = wszystkie wartości z encji, nazwy i rodzaje rozpoznane automatycznie.</p>}
      {value.map((m, i) => (
        <div key={i} className="ins-mode">
          <input value={m.value} placeholder="wartość" aria-label="Wartość" onChange={(e) => upd(i, { value: e.target.value })} />
          <input value={m.label ?? ''} placeholder="nazwa" aria-label="Nazwa" onChange={(e) => upd(i, { label: e.target.value || undefined })} />
          {withKind && <select value={m.kind ?? ''} aria-label="Rodzaj" onChange={(e) => upd(i, { kind: (e.target.value || undefined) as ModeKind | undefined })}>
            <option value="">auto ({KIND_NAME[inferKind(m.value)]})</option>
            {MODE_KINDS.map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}
          </select>}
          <input value={m.icon ?? ''} placeholder={withKind ? KIND_ICON[m.kind ?? inferKind(m.value)] : 'ikona'} aria-label="Ikona" onChange={(e) => upd(i, { icon: e.target.value || undefined })} />
          <label className="ins-check" title="Ukryj na tablecie"><input type="checkbox" checked={!!m.hidden} onChange={(e) => upd(i, { hidden: e.target.checked || undefined })} />ukryj</label>
          <span className="row-btns">
            <button className="mini" onClick={() => move(i, -1)} aria-label="W górę">↑</button>
            <button className="mini" onClick={() => move(i, 1)} aria-label="W dół">↓</button>
            <button className="mini" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Usuń">×</button>
          </span>
        </div>
      ))}
      <div className="row-btns">
        <button className="btn" onClick={() => onChange([...value, { value: '' }])}>Dodaj</button>
        <button className="btn" onClick={onLoad}>Wczytaj z encji</button>
        {value.length > 0 && <button className="btn" onClick={() => onChange(undefined)}>Wyczyść</button>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- extra values (floor, valve …)
const ExtrasF: FC<{ value: ClimateExtra[]; onChange(v: ClimateExtra[] | undefined): void }> = ({ value, onChange }) => {
  const upd = (i: number, p: Partial<ClimateExtra>) => onChange(value.map((x, j) => (j === i ? Object.fromEntries(Object.entries({ ...x, ...p }).filter(([, v]) => v !== undefined && v !== '')) as unknown as ClimateExtra : x)));
  return (
    <div className="ins-modes">
      {value.map((x, i) => (
        <details key={i} className="ins-sub" open={!x.entity}>
          <summary>{x.label || x.entity || 'Nowa wartość'}</summary>
          <EntityF label="Encja" value={x.entity} onChange={(e) => upd(i, { entity: e ?? '' })} />
          <TextF label="Atrybut" value={x.attribute} placeholder="stan" onChange={(v) => upd(i, { attribute: v })} />
          <TextF label="Etykieta" value={x.label} placeholder="np. Podłoga" onChange={(v) => upd(i, { label: v })} />
          <TextF label="Jednostka" value={x.unit} placeholder="z encji" onChange={(v) => upd(i, { unit: v })} />
          <NumF label="Miejsca po przecinku" value={x.decimals} min={0} max={3} onChange={(v) => upd(i, { decimals: v })} />
          <button className="btn danger" onClick={() => onChange(value.filter((_, j) => j !== i))}>Usuń</button>
        </details>
      ))}
      <button className="btn" onClick={() => onChange([...value, { entity: '' }])}>Dodaj wartość</button>
    </div>
  );
};

const FEATURE_DOMAINS = /^(switch|input_boolean|select|input_select|button|input_button|light|script)\./;
/** jonizacja, oczyszczanie powietrza, tryb nocny, wyświetlacz… – switches / selects / buttons of the AC device */
const FeaturesF: FC<{ value: ClimateFeature[]; entity?: string; onChange(v: ClimateFeature[]): void }> = ({ value, entity, onChange }) => {
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState('');
  const upd = (i: number, p: Partial<ClimateFeature>) => onChange(value.map((x, j) => (j === i ? Object.fromEntries(Object.entries({ ...x, ...p }).filter(([, v]) => v !== undefined && v !== '')) as unknown as ClimateFeature : x)));
  const all = [...hass.states.keys()].filter((e) => FEATURE_DOMAINS.test(e)).sort();
  const discover = async () => {
    try {
      const devs = await api.get<{ name: string; entities: { entity_id: string; category?: string }[] }[]>('devices');
      const dev = devs.find((d) => d.entities.some((e) => e.entity_id === entity));
      if (!dev) return setMsg('Nie znalazłem urządzenia tej encji w HA – dodaj funkcje ręcznie.');
      const found = dev.entities.filter((e) => FEATURE_DOMAINS.test(e.entity_id) && e.category !== 'diagnostic' && !value.some((v) => v.entity === e.entity_id)).map((e) => ({ entity: e.entity_id }));
      onChange([...value, ...found]);
      setMsg(found.length ? `Dodano ${found.length} z urządzenia „${dev.name}”. Usuń zbędne (×).` : `Urządzenie „${dev.name}” nie ma więcej przełączników.`);
    } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="ins-list">
      {value.map((f, i) => (
        <div key={f.entity} className="ins-row">
          <code className="small">{f.entity}</code>
          <input placeholder={'Nazwa (auto)'} value={f.label ?? ''} onChange={(e) => upd(i, { label: e.target.value || undefined })} />
          <input placeholder={featureIcon((f.label ?? '') + ' ' + f.entity)} value={f.icon ?? ''} onChange={(e) => upd(i, { icon: e.target.value || undefined })} style={{ width: 150 }} />
          <button className="mini" disabled={i === 0} onClick={() => { const n = [...value]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }} aria-label="W górę">↑</button>
          <button className="mini" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={'Usuń ' + f.entity}>×</button>
        </div>
      ))}
      <div className="row-btns">
        <input list="cl-feat-ents" placeholder="switch.klima_jonizator" value={add} onChange={(e) => setAdd(e.target.value.trim())} />
        <button className="btn" disabled={!add} onClick={() => { if (!value.some((v) => v.entity === add)) onChange([...value, { entity: add }]); setAdd(''); }}>Dodaj</button>
        {entity && <button className="btn" onClick={discover}>Wykryj z urządzenia</button>}
      </div>
      <datalist id="cl-feat-ents">{all.map((e) => <option key={e} value={e} />)}</datalist>
      {msg ? <small className="muted">{msg}</small> : <small className="muted">Przełączniki (jonizacja, oczyszczanie, sen, eco, wyświetlacz…) włączają / wyłączają, listy wyboru przechodzą do następnej opcji, przyciski naciskają. Widać je w dużym widoku i w panelu po kliknięciu.</small>}
    </div>
  );
};
