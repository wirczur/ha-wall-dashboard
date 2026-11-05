import { useEffect, useState, type FC } from 'react';
import type { HassState, SetStep, ActionDef, TriggerDef, DashboardDoc, PanelDef, PanelRow, RowDisplay, ThemeDef, ViewDef, WidgetDef, WidgetStyle, WidgetType } from '../../../shared/types';
import { api } from '../lib/api';
import { useThemes } from '../lib/themes';
import { hass } from '../lib/hass';
import { WIDGETS } from '../widgets/widgets';
import { ClimateEditor } from './ClimateEditor';
import { CAL_COLORS } from '../widgets/calendar';
import { autoLevels, type LevelDef } from '../widgets/levels';
import { discoverIq4 } from '../widgets/irrigation';
import { isSimpleTimer } from '../widgets/timer';
import { isRobot } from '../widgets/robot';
import { UPS_KEYS, upsGuess } from '../widgets/ups';
import { AIR_KEYS, DYSON_MAP } from '../widgets/devices';
import { FX, occasionFor, SKINS } from '../lib/occasion';
import { useRemoteOptions, useEntityList, CheckF, ColorF, EntityF, EntityListF, IconF, JsonF, MapF, NumF, RangeF, Section, SelectF, TextF, useDashboardList, useHouseList, useTvList } from './fields';

type Patch<T> = (p: Partial<T>) => void;
const clean = <T extends object>(o: T): T | undefined => {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
};

// ================================================================ widget
export const WidgetInspector: FC<{
  w: WidgetDef; view: ViewDef; doc: DashboardDoc;
  onChange(w: WidgetDef): void; onDelete(): void; onDuplicate(): void;
}> = ({ w, view, doc, onChange, onDelete, onDuplicate }) => {
  const set: Patch<WidgetDef> = (p) => onChange(clean({ ...w, ...p }) as WidgetDef);
  const opt = (k: string, v: unknown) => set({ options: clean({ ...(w.options || {}), [k]: v }) });
  const style: Patch<WidgetStyle> = (p) => set({ style: clean({ ...(w.style || {}), ...p }) });
  const o = w.options || {}, s = w.style || {};

  return (
    <div className="ins">
      <div className="ins-top">
        <h3>{WIDGETS[w.type]?.label ?? w.type}</h3>
        <div className="row-btns">
          <button className="btn" onClick={onDuplicate} title="Ctrl+D">Duplikuj</button>
          <button className="btn danger" onClick={onDelete} title="Delete">Usuń</button>
        </div>
      </div>

      <Section title="Podstawowe">
        <SelectF label="Typ" value={w.type} options={Object.entries(WIDGETS).map(([k, m]) => [k, m.label])}
          onChange={(t) => set({ type: t as WidgetType })} />
        <TextF label="Tytuł" value={w.title} onChange={(v) => set({ title: v })} placeholder="nazwa z encji · może zawierać {encja}" />
        {!['clock', 'date', 'image', 'iframe', 'text'].includes(w.type) && (
          <EntityF label="Encja" value={w.entity} onChange={(v) => set({ entity: v })}
            domains={w.type === 'alarm' ? ['alarm_control_panel'] : w.type === 'timer' ? ['sensor'] : w.type === 'climate' ? ['climate', 'water_heater'] : w.type === 'camera' ? ['camera'] : w.type === 'media' ? ['media_player'] : w.type === 'levels' ? ['fan', 'select', 'input_select', 'number', 'input_number'] : undefined}
            hint={w.type === 'climate' ? 'Opcjonalnie – termostat z osobnych encji ustawisz w rolach niżej' : undefined} />
        )}
        {w.type === 'temperature' && <EntityF label="Druga encja" value={w.secondary} onChange={(v) => set({ secondary: v })} hint="np. wilgotność pod temperaturą" />}
        {['value', 'temperature', 'button'].includes(w.type) && <IconF value={w.icon} onChange={(v) => set({ icon: v })} />}
      </Section>

      <Section title="Położenie i rozmiar" open={false}>
        <div className="ins-grid4">
          <NumF label="Kolumna" value={w.x} min={0} max={view.columns - 1} onChange={(v) => set({ x: Math.max(0, Math.min(view.columns - w.w, v ?? 0)) })} />
          <NumF label="Wiersz" value={w.y} min={0} onChange={(v) => set({ y: Math.max(0, v ?? 0) })} />
          <NumF label="Szerokość" value={w.w} min={1} max={view.columns} onChange={(v) => set({ w: Math.max(1, Math.min(view.columns - w.x, v ?? 1)) })} />
          <NumF label="Wysokość" value={w.h} min={1} onChange={(v) => set({ h: Math.max(1, v ?? 1) })} />
        </div>
      </Section>

      <Section title="Treść">
        {w.type === 'clock' && <>
          <CheckF label="Pokazuj sekundy" value={o.seconds} onChange={(v) => opt('seconds', v || undefined)} />
          <SelectF label="Data" value={o.date ?? 'none'} onChange={(v) => opt('date', v === 'none' ? undefined : v)}
            options={[['none', 'bez daty'], ['below', 'pod godziną'], ['above', 'nad godziną'], ['beside', 'obok godziny']]} />
          {o.date && <>
            <SelectF label="Format daty" value={o.dateFormat ?? 'long'} onChange={(v) => opt('dateFormat', v === 'long' ? undefined : v)}
              options={[['long', 'niedziela, 11 października'], ['full', 'niedziela, 11 października 2026'], ['short', '11.10.2026']]} />
            <SelectF label="Wyrównanie" value={o.align ?? 'center'} onChange={(v) => opt('align', v === 'center' ? undefined : v)} options={[['center', 'do środka'], ['left', 'do lewej']]} />
          </>}
        </>}
        {w.type === 'date' && <SelectF label="Format" value={o.format ?? 'long'} options={[['long', 'sobota, 10 października'], ['short', '10.10.2026']]} onChange={(v) => opt('format', v)} />}
        {(w.type === 'value' || w.type === 'temperature') && <>
          {w.type === 'value' && <TextF label="Atrybut" value={o.attribute} onChange={(v) => opt('attribute', v)} placeholder="pusty = stan encji" />}
          {w.type === 'value' && <TextF label="Szablon (zamiast wartości)" value={o.template} onChange={(v) => opt('template', v)} placeholder="np. {sensor.temp_zew}° / {sensor.wilg_zew}" />}
          {w.type === 'value' && o.template != null && <TemplateInsert value={o.template} onChange={(v) => opt('template', v)} />}
          <NumF label="Miejsca po przecinku" value={o.decimals} min={0} max={4} onChange={(v) => opt('decimals', v)} />
          {w.type === 'value' && <TextF label="Jednostka" value={o.unit} onChange={(v) => opt('unit', v)} placeholder="z encji" />}
          {w.type === 'value' && <MapF label="Nazwy stanów" value={o.stateMap} onChange={(v) => opt('stateMap', v)} />}
        </>}
        {w.type === 'climate' && <ClimateEditor value={o} entity={w.entity} onChange={(v) => set({ options: v as Record<string, any> | undefined })} />}
        {w.type === 'button' && <>
          <TextF label="Podpis" value={o.subtitle} onChange={(v) => opt('subtitle', v)} placeholder="pusty = stan encji · np. {sensor.co2} ppm · {fan.rekuperator.percentage}%" />
          <TemplateInsert value={o.subtitle} onChange={(v) => opt('subtitle', v)} />
          {w.tap?.type === 'set' && <CheckF label="Podświetl, gdy te wartości są ustawione" value={o.activeOnMatch} onChange={(v) => opt('activeOnMatch', v || undefined)} />}
          <TextF label="Podpis z atrybutu" value={o.subtitleAttribute} onChange={(v) => opt('subtitleAttribute', v)} placeholder="np. percentage" />
          {o.subtitleAttribute && <TextF label="Dopisek" value={o.subtitleSuffix} onChange={(v) => opt('subtitleSuffix', v)} placeholder="np. % nawiewu" />}
          <MapF label="Nazwy stanów" value={o.stateMap} onChange={(v) => opt('stateMap', v)} />
          <EntityListF label="Licz włączone" value={o.countOn} onChange={(v) => opt('countOn', v)} hint="podpis „N wł.” i podświetlenie, gdy coś świeci" />
          <CheckF label="Nigdy nie podświetlaj" value={o.active === false} onChange={(v) => opt('active', v ? false : undefined)} />
        </>}
        {w.type === 'text' && <>
          <TextF label="Tekst" value={o.text} multiline onChange={(v) => opt('text', v)} />
          <TemplateInsert value={o.text} onChange={(v) => opt('text', v)} />
          <NumF label="Rozmiar (px)" value={o.size} min={8} max={120} onChange={(v) => opt('size', v)} />
        </>}
        {w.type === 'image' && <>
          <TextF label="Adres obrazka" value={o.url} onChange={(v) => opt('url', v)} placeholder="media/plik.png lub https://…" />
          <UploadButton onUrl={(u) => opt('url', u)} />
          <SelectF label="Dopasowanie" value={o.fit ?? 'cover'} options={[['cover', 'Wypełnij (przytnij)'], ['contain', 'Zmieść w całości'], ['fill', 'Rozciągnij']]} onChange={(v) => opt('fit', v)} />
        </>}
        {w.type === 'iframe' && <TextF label="Adres strony" value={o.url} onChange={(v) => opt('url', v)} placeholder="https://embed.windy.com/…" />}
        {w.type === 'camera' && <>
          <SelectF label="Obraz" value={o.mode ?? 'live'} options={[['live', 'Na żywo (WebRTC)'], ['snapshot', 'Zdjęcia co kilka sekund']]} onChange={(v) => opt('mode', v === 'live' ? undefined : v)} />
          {o.mode === 'snapshot' && <NumF label="Odświeżanie (s)" value={o.refresh} min={1} max={60} onChange={(v) => opt('refresh', v)} />}
          {o.mode !== 'snapshot' && <>
            <SelectF label="Źródło" value={o.provider ?? 'ha'} options={[['ha', 'Home Assistant (go2rtc w HA)'], ['go2rtc', 'Bezpośrednio go2rtc']]} onChange={(v) => opt('provider', v === 'ha' ? undefined : v)} />
            {o.provider === 'go2rtc' && <Go2rtcStream value={o.stream} onChange={(v) => opt('stream', v)} />}
            {o.provider === 'go2rtc' && <TextF label="Strumień dla słabych paneli (Lite)" value={o.liteStream} onChange={(v) => opt('liteStream', v)} placeholder="np. furtka_sub – substream H.264 ≤ 1080p" />}
            <CheckF label="Rozmowa (mikrofon tabletu)" value={o.talk} onChange={(v) => opt('talk', v || undefined)} />
          </>}
        </>}
        {w.type === 'house3d' && <HouseOptions o={o} opt={opt} />}
        {w.type === 'remote' && <RemoteOptions o={o} opt={opt} />}
        {w.type === 'levels' && <LevelsF o={o} opt={opt} entity={w.entity} />}
        {w.type === 'timer' && <>
          <TimerPick w={w} set={set} />
          <TextF label="Przyciski czasu" value={(o.presets ?? []).join(', ')} onChange={(v) => opt('presets', v ? v.split(/[,;\s]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : undefined)}
            placeholder="15, 30, 60, 90, 120 · także 30s, 1.5h, 1d" />
          <div className="ins-grid2">
            <CheckF label="Gdy trwa – przyciski dodają czas" value={o.extend !== false} onChange={(v) => opt('extend', v ? undefined : false)} />
            <CheckF label="Opóźniony start (włącz po czasie)" value={o.reverse} onChange={(v) => opt('reverse', v || undefined)} />
            <CheckF label="Stop wyłącza urządzenie" value={o.turnOffOnCancel !== false} onChange={(v) => opt('turnOffOnCancel', v ? undefined : false)} />
            <CheckF label="Dzienny czas pracy" value={o.usage !== false} onChange={(v) => opt('usage', v ? undefined : false)} />
            <CheckF label="Planowanie startu" value={o.schedule} onChange={(v) => opt('schedule', v || undefined)} />
          </div>
          <p className="muted small">Encja: sensor z integracji Simple Timer (ten z czasem pracy, ma atrybut timer_state). Wymaga integracji ha-simple-timer z HACS.</p>
        </>}
        {w.type === 'purifier' && <DeviceDiscover integration="hass_dyson" label="Wykryj urządzenie Dyson" onPick={(d) => {
          const p: Record<string, unknown> = { ...o };
          for (const e of d.entities) { const k = DYSON_MAP[e.key]; if (k && !p[k]) p[k] = e.entity_id; if (e.entity_id.startsWith('fan.') && !p.fan) p.fan = e.entity_id; }
          set({ options: p, title: w.title || d.name });
        }} />}
        {w.type === 'purifier' && <>
          <EntityF label="Wentylator / oczyszczacz" value={o.fan} domains={['fan']} onChange={(v) => opt('fan', v)} />
          {AIR_KEYS.map(([k, l]) => <EntityF key={k} label={l} value={o[k]} domains={['sensor']} onChange={(v) => opt(k, v)} />)}
          <EntityF label="Filtr (%)" value={o.filter} domains={['sensor']} onChange={(v) => opt('filter', v)} />
          <EntityF label="Tryb nocny" value={o.night} domains={['switch', 'select']} onChange={(v) => opt('night', v)} />
          <EntityF label="Tryb auto" value={o.auto} domains={['switch']} onChange={(v) => opt('auto', v)} hint="pusto = preset „Auto” wentylatora" />
          <EntityF label="Oscylacja" value={o.oscillation} domains={['switch', 'select']} onChange={(v) => opt('oscillation', v)} hint="pusto = oscylacja wentylatora" />
        </>}
        {w.type === 'ups' && <DeviceDiscover label="Wykryj UPS" filter={(d) => d.integrations.some((i) => /nut|apcupsd|ups/i.test(i)) || d.entities.some((e) => /ups|battery_runtime|status_data/i.test(e.entity_id))}
          onPick={(d) => set({ title: w.title || d.name, options: { ...o, ...upsGuess(d.entities.map((e) => ({ entity_id: e.entity_id, key: e.key }))) } })} />}
        {w.type === 'ups' && <>
          {UPS_KEYS.map(([k, l]) => <EntityF key={k} label={l} value={o[k]} domains={k === 'status' ? ['sensor', 'binary_sensor'] : ['sensor']} onChange={(v) => opt(k, v)} />)}
          <label className="field"><span>Własne nazwy stanów (opcjonalnie)</span>
            <textarea rows={3} value={o.statusMap ?? ''} onChange={(e) => opt('statusMap', e.target.value || undefined)} placeholder={'Resting=sieć\nBattery Mode=bateria\nFault=przeciążenie'} />
            <small className="muted">tekst stanu = sieć / bateria / niski / ładowanie / bypass / przeciążenie / wyłączony – gdy Twoja aplikacja wysyła inne nazwy. Aktualny stan: {o.status ? hass.states.get(o.status)?.state ?? '—' : '—'}</small>
          </label>
          <p className="muted small">Stan pracy: kody NUT (OL / OB / LB / CHRG), apcupsd (ONLINE / ONBATT), tekst albo binary_sensor „online”. Czas pracy w s, min lub h – jednostka z encji. Kafelek 3×3 = wersja mała.</p>
        </>}
        {w.type === 'calls' && <>
          <CheckF label="Tylko nieodebrane" value={o.onlyMissed !== false} onChange={(v) => opt('onlyMissed', v ? undefined : false)} />
          <NumF label="Ile pozycji" value={o.count ?? 20} min={1} max={100} onChange={(v) => opt('count', v)} />
          <p className="muted small">Lista powstaje z wyzwalaczy z pop-upem (Wyzwalacze → „Zapisuj historię połączeń”). Zdjęcie robione jest z kamery pop-upu w chwili dzwonienia. Kafelek 2 wiersze = licznik + ostatnie połączenie.</p>
        </>}
        {w.type === 'intercom' && <IntercomTargets value={o.targets} onChange={(v) => opt('targets', v)} />}
        {w.type === 'intercom' && <NumF label="Głośność rozmowy (0–100)" value={o.volume ?? 100} min={0} max={100} onChange={(v) => opt('volume', v)} hint="Fully ustawia głośność tabletu na czas rozmowy i przywraca ją potem" />}
        {w.type === 'intercom' && <p className="muted small">Rozmowa głosowa między panelami (bez kamery). Wymaga mikrofonu i HTTPS dla kiosku (opcja „ssl” add-onu). Każdy panel z włączonym interkomem (Tablety) może odbierać połączenia – także bez tego widgetu.</p>}
        {w.type === 'septic' && <>
          <SelectF label="Wygląd" value={w.options?.layout ?? 'auto'} onChange={(v) => opt('layout', v === 'auto' ? undefined : v)}
            options={[['auto', 'Automatycznie (wg rozmiaru)'], ['tank', 'Zbiornik'], ['ring', 'Kafelek 1:1 – dotknij = szczegóły'], ['bar', 'Pasek z historią']]} />
          <EntityF label="Poziom (%)" value={w.entity} domains={['sensor', 'number', 'input_number']} onChange={(v) => set({ entity: v })} />
          <EntityF label="Odległość do lustra (opcjonalnie)" value={o.distance} domains={['sensor', 'number']} onChange={(v) => opt('distance', v)} hint="pokazywana jako informacja" />
          <EntityF label="Pozostały czas do zapełnienia (opcjonalnie)" value={o.remaining} domains={['sensor', 'number', 'input_number']} onChange={(v) => opt('remaining', v)}
            hint="jednostka z encji (d / h / min), bez jednostki = dni; pusto = liczone z historii" />
          <div className="ins-grid2">
            <NumF label="Pojemność (m³)" value={o.capacity} min={0} max={100} step={0.5} onChange={(v) => opt('capacity', v)} hint="pusto = tylko %" />
            <NumF label="Historia (dni)" value={o.days ?? 60} min={7} max={120} onChange={(v) => opt('days', v)} />
            <NumF label="Ostrzeżenie (%)" value={o.warn ?? 75} min={0} max={100} onChange={(v) => opt('warn', v)} />
            <NumF label="Alarm (%)" value={o.alarm ?? 90} min={0} max={100} onChange={(v) => opt('alarm', v)} />
          </div>
          <EntityF label="Zamów wywóz – skrypt / przycisk (opcjonalnie)" value={o.orderEntity} domains={['script', 'button', 'input_button', 'automation']} onChange={(v) => opt('orderEntity', v)} hint="np. script.zamow_wywoz_szamba (SMS / e-mail / powiadomienie)" />
          {!o.orderEntity && <TextF label="…albo telefon" value={o.orderPhone} onChange={(v) => opt('orderPhone', v)} placeholder="np. 600 100 200 – na tablecie z telefonem otworzy dzwonienie" />}
          {(o.orderEntity || o.orderPhone) && <TextF label="Napis przycisku" value={o.orderLabel} onChange={(v) => opt('orderLabel', v)} placeholder="Zamów wywóz" />}
          <p className="muted small">Ostatni wywóz i tempo napełniania liczone są z historii HA (spadek poziomu o ≥30 punktów w 2 dni = wywóz). Najlepiej, gdy czujnik ma state_class: measurement – wtedy HA trzyma statystyki dłużej niż 10 dni.</p>
        </>}
        {w.type === 'robot' && <DeviceDiscover label="Wykryj urządzenie (kosiarka / odkurzacz)" filter={(d) => d.entities.some((e) => isRobot(e.entity_id))} onPick={(d) => {
          const main = d.entities.find((e) => isRobot(e.entity_id))!.entity_id;
          const dc = (e: string) => hass.states.get(e)?.attributes.device_class;
          const battery = d.entities.find((e) => e.entity_id.startsWith('sensor.') && (dc(e.entity_id) === 'battery' || /battery|bateri/i.test(e.key + e.entity_id)))?.entity_id;
          const error = d.entities.find((e) => e.entity_id.startsWith('sensor.') && /error|bł[aą]d|fault/i.test(e.key + e.entity_id))?.entity_id;
          // hass-dyson (Spot+Scrub, Vis Nav): current room, dock, clean coverage image, cleaning mode, rooms from the per-room selects
          const byKey = (k: string) => d.entities.find((e) => e.key === k)?.entity_id;
          const room = byKey('robot_current_room'), dock = byKey('robot_dock_state'), dockTimer = byKey('robot_dock_timer_end'), coverage = byKey('clean_coverage') ?? byKey('dust_map'), cleanMode = byKey('spot_scrub_cleaning_mode');
          // per-room settings selects of hass-dyson: <serial>_room_<id>_<setting>
          const RS: Record<string, string> = { cleaning_mode: 'mode', vacuum_power: 'power', hydration: 'water', wash_repetitions: 'wash' };
          const byRoom = new Map<string, Record<string, string>>();
          for (const e of d.entities) {
            const m = /_room_(\d+)_(cleaning_mode|vacuum_power|hydration|wash_repetitions)$/.exec(e.uid ?? '');
            if (!m) continue;
            const r = byRoom.get(m[1]) ?? { id: m[1] };
            r[RS[m[2]]] = e.entity_id;
            if (m[2] === 'cleaning_mode' || !r.name) r.name = (e.orig ?? e.name).replace(/\s*(cleaning mode|vacuum power|hydration|wash repetitions)$/i, '').trim();
            byRoom.set(m[1], r);
          }
          const rooms = [...byRoom.values()] as { id: string; name: string }[];
          const own = [main, battery, error, room, dock, dockTimer, coverage, cleanMode];
          const extras = d.entities.filter((e) => !e.category && !own.includes(e.entity_id) && /^(button|select|number|switch|sensor|binary_sensor|input_button)\./.test(e.entity_id)).map((e) => e.entity_id).slice(0, 12);
          set({ entity: main, title: w.title || d.name, icon: w.icon || (main.startsWith('lawn_mower.') ? 'mdi:robot-mower' : 'mdi:robot-vacuum'),
            options: clean({ ...o, battery, error, extras, room, dock, dockTimer, coverage, cleanMode, rooms: rooms.length ? rooms : o.rooms }) });
        }} />}
        {w.type === 'robot' && <>
          <EntityF label="Kosiarka / odkurzacz" value={w.entity} domains={['lawn_mower', 'vacuum']} onChange={(v) => set({ entity: v })} />
          <EntityF label="Bateria (sensor)" value={o.battery} domains={['sensor']} onChange={(v) => opt('battery', v)} hint="pusto = atrybut battery_level" />
          <EntityF label="Opis błędu (sensor, opcjonalnie)" value={o.error} domains={['sensor']} onChange={(v) => opt('error', v)} />
          <EntityListF label="Dodatkowe encje (przyciski pokoi, wysokość koszenia…)" value={o.extras} onChange={(v) => opt('extras', v)} hint="Widoczne, gdy kafelek ma co najmniej 5 wierszy wysokości" />
          {(!w.entity || w.entity.startsWith('vacuum.')) && <>
            <EntityF label="Aktualny pokój (sensor)" value={o.room} domains={['sensor']} onChange={(v) => opt('room', v)} hint="hass-dyson: „Current room” – pokazywany przy stanie" />
            <EntityF label="Stacja dokująca (sensor)" value={o.dock} domains={['sensor']} onChange={(v) => opt('dock', v)} hint="np. suszenie mopa" />
            <EntityF label="Koniec pracy stacji (sensor czasu)" value={o.dockTimer} domains={['sensor']} onChange={(v) => opt('dockTimer', v)} />
            <EntityF label="Mapa / pokrycie sprzątania (image)" value={o.coverage} domains={['image', 'camera']} onChange={(v) => opt('coverage', v)} hint="Przycisk „Mapa” w kafelku" />
            <EntityF label="Tryb sprzątania (select)" value={o.cleanMode} domains={['select']} onChange={(v) => opt('cleanMode', v)} hint="Spot+Scrub: odkurzanie / mop" />
            <RoomsF value={o.rooms} onChange={(v) => opt('rooms', v)} />
          </>}
          <p className="muted small">Kosiarki: domena lawn_mower (Segway Navimow, Husqvarna, Worx…). Odkurzacze: domena vacuum (Dyson 360 / Vis Nav przez hass-dyson, Roborock…).</p>
        </>}
        {w.type === 'device' && <DeviceDiscover label="Wybierz urządzenie" onPick={(d) => set({ title: w.title || d.name, options: { ...o, device: d.id, entities: d.entities.filter((e) => !e.category).map((e) => e.entity_id) } })} />}
        {w.type === 'device' && <SelectF label="Wygląd" value={o.layout ?? 'auto'} onChange={(v) => opt('layout', v === 'auto' ? undefined : v)}
          options={[['auto', 'Automatycznie (mały kwadrat = 1:1)'], ['square', 'Kafelek 1:1 – czas w okręgu, dotknij = szczegóły'], ['list', 'Lista wszystkich encji']]} />}
        {w.type === 'device' && (o.layout === 'square' || (!o.layout && w.w <= 4 && w.h <= 4)) && <EntityF label="Stan (opcjonalnie)" value={o.status} domains={['sensor', 'select']} onChange={(v) => opt('status', v)} hint="pusto = wykryj (machine_state, job_state, status…)" />}
        {w.type === 'device' && (o.layout === 'square' || (!o.layout && w.w <= 4 && w.h <= 4)) && <EntityF label="Program (opcjonalnie)" value={o.program} domains={['sensor', 'select']} onChange={(v) => opt('program', v)} hint="pusto = wykryj; kody typu „1B” są pomijane" />}
        {w.type === 'device' && <EntityListF label="Encje (kolejność wierszy)" value={o.entities} onChange={(v) => opt('entities', v)} hint="Pozostały czas i godzina końca pokazują się u góry" />}
        {w.type === 'schedules' && <>
          <TextF label="Tylko z tagiem" value={o.tag} onChange={(v) => opt('tag', v)} placeholder="np. salon – pusto = wszystkie" />
          <EntityListF label="Tylko dla urządzeń" value={o.entities} onChange={(v) => opt('entities', v)} hint="pusto = wszystkie harmonogramy; lista ogranicza też wybór przy dodawaniu" />
          <CheckF label="Dodawanie z tabletu" value={o.allowAdd !== false} onChange={(v) => opt('allowAdd', v ? undefined : false)} />
          <p className="muted small">Wymaga integracji scheduler-component (HACS). Włącz/wyłącz, „wykonaj teraz” i proste dodawanie: urządzenie, akcja, godzina, dni.</p>
        </>}
        {w.type === 'alarm' && <>
          <IntegrationPick platform="satel_integra" label="Wykryj strefy i wyjścia Satel" onPick={(l) => set({ entity: w.entity || l.find((e) => e.startsWith('alarm_control_panel.')), options: { ...o, zones: l.filter((e) => e.startsWith('binary_sensor.')), outputs: l.filter((e) => e.startsWith('switch.')) } })} />
          <EntityListF label="Strefy / czujki (binary_sensor)" value={o.zones} onChange={(v) => opt('zones', v)} />
          <EntityListF label="Wyjścia (switch)" value={o.outputs} onChange={(v) => opt('outputs', v)} />
          {o.panel === false && <SelectF label="Wygląd naruszeń" value={o.layout ?? 'auto'} onChange={(v) => opt('layout', v === 'auto' ? undefined : v)}
            options={[['auto', 'Automatycznie (mały kafelek = przycisk)'], ['button', 'Przycisk z licznikiem – dotknij = lista w panelu'], ['list', 'Lista na kafelku']]} />}
          <div className="ins-grid2">
            <CheckF label="Panel uzbrajania (klawiatura, przyciski)" value={o.panel !== false} onChange={(v) => opt('panel', v ? undefined : false)} />
            {o.panel !== false && <CheckF label="Klawiatura kodu" value={o.keypad !== false} onChange={(v) => opt('keypad', v ? undefined : false)} />}
            <CheckF label="Lista naruszeń" value={o.violations !== false} onChange={(v) => opt('violations', v ? undefined : false)} />
            <CheckF label="Ostrzeż przed uzbrojeniem z naruszeniem" value={o.warnOnArm !== false} onChange={(v) => opt('warnOnArm', v ? undefined : false)} />
            <CheckF label="Pokaż też wszystkie strefy" value={o.allZones} onChange={(v) => opt('allZones', v || undefined)} />
            <CheckF label="Przycisk „Urlop”" value={o.vacation} onChange={(v) => opt('vacation', v || undefined)} />
          </div>
          <p className="muted small">Satel Integra: encja <code>alarm_control_panel.*</code> (partycja), strefy jako binary_sensor, wyjścia jako switch. Rozbrajanie z tabletu włączasz w zakładce Tablety („Może rozbrajać alarm”).</p>
        </>}
        {w.type === 'irrigation' && <IrrigationF o={o} set={(p) => set({ options: { ...o, ...p } })} opt={opt} />}
        {w.type === 'waste' && <>
          <SelectF label="Źródło" value={o.calendar != null ? 'calendar' : 'entities'} onChange={(v) => set({ options: v === 'calendar' ? { ...o, calendar: o.calendar ?? '', when: undefined, what: undefined } : { ...o, calendar: undefined } })}
            options={[['entities', 'Dwie encje: kiedy + co'], ['calendar', 'Kalendarz wywozu (calendar.*)']]} />
          {o.calendar == null ? <>
            <EntityF label="Kiedy (data / liczba dni / tekst)" value={o.when} onChange={(v) => opt('when', v)} hint="np. sensor z datą 2026-10-14, z liczbą dni „2” albo tekstem „jutro”" />
            <TextF label="…z atrybutu (opcjonalnie)" value={o.whenAttr} onChange={(v) => opt('whenAttr', v)} placeholder="np. daysTo" />
            <EntityF label="Co (rodzaj odpadów)" value={o.what} onChange={(v) => opt('what', v)} hint="kilka rodzajów rozdziel przecinkiem – np. „Bio, Plastik”" />
            <TextF label="…z atrybutu (opcjonalnie)" value={o.whatAttr} onChange={(v) => opt('whatAttr', v)} placeholder="np. types" />
          </> : <>
            <EntityF label="Kalendarz" value={o.calendar} domains={['calendar']} onChange={(v) => opt('calendar', v ?? '')} hint="tytuł wydarzenia = rodzaj odpadów; kilka w tym samym dniu łączy się" />
            <NumF label="Ile najbliższych wywozów" value={o.count} min={1} max={6} onChange={(v) => opt('count', v)} />
            <NumF label="Szukaj w kalendarzu (dni do przodu)" value={o.range ?? 31} min={7} max={62} onChange={(v) => opt('range', v === 31 ? undefined : v)} />
          </>}
          <NumF label="Wyróżnij, gdy zostało dni (lub mniej)" value={o.alertDays ?? 1} min={0} max={7} onChange={(v) => opt('alertDays', v)} />
          <CheckF label="Pomijaj nierozpoznane rodzaje" value={o.onlyKnown !== false} onChange={(v) => opt('onlyKnown', v ? undefined : false)} />
          <p className="muted small">Wydarzenia, które nie pasują do znanych rodzajów (Bio, Plastik, Papier, Szkło, Zmieszane, Gabaryty, Popiół, Szambo) ani do „Własnych kolorów”, są pomijane – pokazuje się następny rozpoznany wywóz. Własny rodzaj dodasz wpisem w „Własne kolory”.</p>
          <MapF label="Własne kolory (nazwa → kolor)" value={o.colors} onChange={(v) => opt('colors', v)} />
          <TextF label="Tekst, gdy brak wywozów" value={o.emptyText} onChange={(v) => opt('emptyText', v)} placeholder="Brak wywozów w ciągu 31 dni" />
        </>}
        {w.type === 'calendar' && <>
          <CalendarsF value={o.calendars} onChange={(v) => opt('calendars', v)} />
          <SelectF label="Układ" value={o.layout ?? 'auto'} onChange={(v) => opt('layout', v === 'auto' ? undefined : v)}
            options={[['auto', 'Auto (wg rozmiaru)'], ['agenda', 'Lista najbliższych dni'], ['week', 'Tydzień'], ['month', 'Miesiąc + wybrany dzień']]} />
          {(o.layout ?? 'auto') !== 'week' && (o.layout ?? 'auto') !== 'month' && <NumF label="Ile dni do przodu (lista)" value={o.days} min={1} max={60} onChange={(v) => opt('days', v)} />}
          <div className="ins-grid2">
            <CheckF label="Pokaż miejsce" value={o.location !== false} onChange={(v) => opt('location', v ? undefined : false)} />
            <CheckF label="Ukryj zakończone" value={o.hidePast} onChange={(v) => opt('hidePast', v || undefined)} />
            <CheckF label="Tytuł nad listą" value={o.title !== false} onChange={(v) => opt('title', v ? undefined : false)} />
            <CheckF label="Legenda kalendarzy" value={o.legend !== false} onChange={(v) => opt('legend', v ? undefined : false)} />
          </div>
        </>}
        {w.type === 'media' && <>
          <SelectF label="Układ" value={o.layout ?? 'auto'} onChange={(v) => opt('layout', v === 'auto' ? undefined : v)}
            options={[['auto', 'Auto (wg rozmiaru)'], ['bar', 'Pasek'], ['small', 'Mały'], ['large', 'Duży z okładką']]} />
          <TextF label="Nazwa" value={o.name} onChange={(v) => opt('name', v)} placeholder="z encji" />
          <div className="ins-grid2">
            <CheckF label="Okładka" value={o.art !== false} onChange={(v) => opt('art', v ? undefined : false)} />
            <CheckF label="Rozmyte tło z okładki" value={o.blur !== false} onChange={(v) => opt('blur', v ? undefined : false)} />
            <CheckF label="Pasek postępu" value={o.progress !== false} onChange={(v) => opt('progress', v ? undefined : false)} />
            <CheckF label="Głośność" value={o.volume !== false} onChange={(v) => opt('volume', v ? undefined : false)} />
            <CheckF label="Wybór źródła" value={o.source !== false} onChange={(v) => opt('source', v ? undefined : false)} />
            <CheckF label="Losowo / powtarzanie" value={o.shuffle !== false} onChange={(v) => opt('shuffle', v ? undefined : false)} />
            <CheckF label="Przycisk zasilania" value={o.power !== false} onChange={(v) => opt('power', v ? undefined : false)} />
          </div>
          <EntityListF label="Multiroom – głośniki do grupowania" value={o.group} onChange={(v) => opt('group', v)}
            hint="np. HEOS / Sonos: dotknięcie dołącza głośnik do tego odtwarzacza lub go odłącza (media_player.join / unjoin)" />
        </>}
      </Section>

      <Section title="Wygląd" open={false}>
        <ColorF label="Tło" value={s.background} allowTransparent onChange={(v) => style({ background: v })} />
        <RangeF label="Krycie tła" value={s.opacity} def={doc.theme.tileOpacity} min={0} max={1} step={0.05} onChange={(v) => style({ opacity: v })} />
        <ColorF label="Tekst" value={s.color} onChange={(v) => style({ color: v })} />
        <ColorF label="Akcent" value={s.accent} onChange={(v) => style({ accent: v })} />
        <RangeF label="Zaokrąglenie" value={s.radius} def={doc.theme.radius} min={0} max={48} unit=" px" onChange={(v) => style({ radius: v })} />
        <RangeF label="Wielkość tekstu" value={s.fontScale} def={1} min={0.5} max={2.5} step={0.05} unit="×" onChange={(v) => style({ fontScale: v })} />
        <RangeF label="Margines wewn." value={s.padding} def={12} min={0} max={40} unit=" px" onChange={(v) => style({ padding: v })} />
        <CheckF label="Bez ramki i rozmycia" value={s.border === false} onChange={(v) => style({ border: v ? false : undefined })} />
        <CheckF label="Ukryj tytuł" value={s.hideTitle} onChange={(v) => style({ hideTitle: v || undefined })} />
        <SelectF label="Wyrównanie w poziomie" value={s.align ?? ''} options={[['', 'Domyślne'], ['start', 'Do lewej'], ['center', 'Do środka'], ['end', 'Do prawej']]} onChange={(v) => style({ align: (v || undefined) as WidgetStyle['align'] })} />
        <SelectF label="Wyrównanie w pionie" value={s.valign ?? ''} options={[['', 'Domyślne'], ['top', 'Do góry'], ['center', 'Do środka'], ['bottom', 'Do dołu']]} onChange={(v) => style({ valign: (v || undefined) as WidgetStyle['valign'] })} />
      </Section>

      {!WIDGETS[w.type]?.ownInteraction && <>
        <Section title="Po dotknięciu">
          <ActionEditor value={w.tap} onChange={(a) => set({ tap: a })} doc={doc} widget={w} allowDefault />
        </Section>
        <Section title="Po przytrzymaniu" open={!!w.hold}>
          <ActionEditor value={w.hold} onChange={(a) => set({ hold: a })} doc={doc} widget={w} />
        </Section>
      </>}
      <p className="muted">id: <code>{w.id}</code></p>
    </div>
  );
};

/** go2rtc stream name with suggestions from the go2rtc API; a pasted rtsp:// URL is reduced to the name */
const Go2rtcStream: FC<{ value?: string; onChange(v: string | undefined): void }> = ({ value, onChange }) => {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => { api.get<string[]>('go2rtc/streams').then(setList).catch(() => setList([])); }, []);
  return <>
    <div className="ins-row"><label>Strumień go2rtc</label><div className="ins-ctl">
      <input list="g2streams" value={value ?? ''} placeholder="furtka" onChange={(e) => {
        const v = e.target.value.trim().replace(/^[a-z]+:\/\/[^/]+\//i, '').split(/[?#]/)[0];
        onChange(v || undefined);
      }} />
      <datalist id="g2streams">{list.map((x) => <option key={x} value={x} />)}</datalist>
      <small>{list.length ? `go2rtc ma ${list.length} strumieni` : 'Nazwa ze go2rtc.yaml – możesz wkleić rtsp://…:8554/furtka'}. Adres go2rtc ustawiasz w zakładce Tablety.</small>
    </div></div>
  </>;
};

const RemoteOptions: FC<{ o: Record<string, any>; opt(k: string, v: unknown): void }> = ({ o, opt }) => {
  const list = useRemoteOptions();
  return <>
    <SelectF label="Telewizor" value={o.tv ?? ''} options={[['', list.length ? 'wybierz…' : 'brak – dodaj TV w „Telewizory” lub integrację Samsung w HA'], ...list]} onChange={(v) => opt('tv', v || undefined)}
      hint="Bezpośrednio: sparowany w zakładce „Telewizory”. Home Assistant: encja remote.* z integracji Samsung (klawisze przez remote.send_command)." />
    <CheckF label="Skróty aplikacji" value={o.showApps !== false} onChange={(v) => opt('showApps', v ? undefined : false)} />
    <CheckF label="Domyślnie gładzik zamiast strzałek" value={o.touchpad} onChange={(v) => opt('touchpad', v || undefined)} />
  </>;
};

const HouseOptions: FC<{ o: Record<string, any>; opt(k: string, v: unknown): void }> = ({ o, opt }) => {
  const houses = useHouseList();
  const h = houses.find((x) => x.id === o.house);
  const cam = o.camera || {};
  const setCam = (k: string, v: number | undefined) => opt('camera', { az: 90, el: 48, zoom: 1, ...cam, [k]: v ?? { az: 90, el: 48, zoom: 1 }[k] });
  return <>
    <SelectF label="Dom" value={o.house ?? ''} options={[['', 'wybierz…'], ...houses.map((x) => [x.id, x.name] as [string, string])]} onChange={(v) => opt('house', v || undefined)}
      hint="Domy importujesz w zakładce „Domy 3D”" />
    {h && <SelectF label="Kondygnacja" value={String(o.level ?? 0)} options={[...h.levels.map((n, i) => [String(i), n] as [string, string]), ['all', 'Cały dom']]}
      onChange={(v) => opt('level', v === 'all' ? 'all' : Number(v))} />}
    <CheckF label="Przełącznik kondygnacji" value={o.showLevels !== false} onChange={(v) => opt('showLevels', v ? undefined : false)} />
    <CheckF label="Niskie ściany (przekrój)" value={o.lowWalls !== false} onChange={(v) => opt('lowWalls', v ? undefined : false)} />
    <CheckF label="Mapa temperatur" value={o.heatmap !== false} onChange={(v) => opt('heatmap', v ? undefined : false)} />
    <CheckF label="Tryb Lite (słabe panele)" value={o.lite} onChange={(v) => opt('lite', v || undefined)} />
    <CheckF label="Pozwól obracać palcem" value={o.orbit} onChange={(v) => opt('orbit', v || undefined)} />
    <SelectF label="Kolory" value={o.palette ?? 'muted'} options={[['muted', 'Stonowane'], ['kenney', 'Kenney (żywe)']]} onChange={(v) => opt('palette', v === 'muted' ? undefined : v)} />
    <div className="ins-row"><label>Orientacja</label><div className="row-btns">
      {([[0, 'Jak na rzucie'], [90, '90°'], [180, '180°'], [270, '270°']] as [number, string][]).map(([a, l]) =>
        <button key={a} className={'btn' + ((cam.az ?? 90) === a ? ' primary' : '')} onClick={() => setCam('az', a)}>{l}</button>)}
    </div></div>
    <RangeF label="Kąt — obrót" value={cam.az} def={90} min={0} max={359} unit="°" onChange={(v) => setCam('az', v)} />
    <RangeF label="Kąt — nachylenie" value={cam.el} def={48} min={15} max={89} unit="°" onChange={(v) => setCam('el', v)} />
    <RangeF label="Przybliżenie" value={cam.zoom} def={1} min={0.5} max={2.5} step={0.05} unit="×" onChange={(v) => setCam('zoom', v)} />
  </>;
};

const UploadButton: FC<{ onUrl(url: string): void }> = ({ onUrl }) => (
  <label className="btn">Wyślij obrazek…
    <input type="file" accept="image/*" hidden onChange={async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      try { onUrl((await api.upload(f)).url); } catch (err: any) { alert(err.message); }
    }} />
  </label>
);

// ================================================================ actions
const ACTION_TYPES: [ActionDef['type'] | 'default', string][] = [
  ['default', 'Domyślnie (przełącz / szczegóły)'], ['none', 'Nic'], ['toggle', 'Przełącz encję'], ['set', 'Ustaw wartości (np. tryb rekuperacji)'], ['allOff', 'Wyłącz wszystkie (np. światła w pokoju)'], ['popup', 'Pokaż pop-up (np. kamera furtki)'], ['quiet', 'Cisza na tym panelu (wycisz dźwięki)'], ['service', 'Wywołaj usługę'],
  ['panel', 'Otwórz panel boczny'], ['view', 'Przejdź do zakładki'], ['dashboard', 'Przejdź do dashboardu'], ['url', 'Otwórz adres']
];

export const ActionEditor: FC<{ value?: ActionDef; onChange(a: ActionDef | undefined): void; doc: DashboardDoc; widget: WidgetDef; allowDefault?: boolean }> =
  ({ value, onChange, doc, widget, allowDefault }) => {
    const dashes = useDashboardList();
    const type = value?.type ?? (allowDefault ? 'default' : 'none');
    const pick = (t: string) => {
      switch (t) {
        case 'default': return onChange(undefined);
        case 'none': return onChange(allowDefault ? { type: 'none' } : undefined);
        case 'toggle': return onChange({ type: 'toggle' });
        case 'service': return onChange({ type: 'service', service: 'script.turn_on' });
        case 'set': return onChange({ type: 'set', steps: [{ entity: widget.entity ?? '', value: '' }] });
        case 'panel': return onChange({ type: 'panel', panel: { title: widget.title, rows: widget.entity ? [{ entity: widget.entity }] : [] } });
        case 'view': return onChange({ type: 'view', view: doc.views[0]?.id ?? '' });
        case 'dashboard': return onChange({ type: 'dashboard', dashboard: dashes[0]?.id ?? '' });
        case 'url': return onChange({ type: 'url', url: 'https://' });
        case 'allOff': return onChange({ type: 'allOff' });
        case 'popup': return onChange({ type: 'popup', trigger: '' });
        case 'quiet': return onChange({ type: 'quiet', mode: 'toggle' });
      }
    };
    return (
      <>
        <SelectF label="Akcja" value={type} options={ACTION_TYPES.filter(([k]) => allowDefault || k !== 'default') as [string, string][]} onChange={pick} />
        {value?.type === 'toggle' && <EntityF label="Encja" value={value.entity} onChange={(e) => onChange({ ...value, entity: e })} hint="pusta = encja widgetu" />}
        {value?.type === 'service' && <>
          <TextF label="Usługa" value={value.service} onChange={(v) => onChange({ ...value, service: v ?? '' })} placeholder="domena.usługa, np. light.turn_on" />
          <EntityF label="Encja" value={value.entity} onChange={(e) => onChange({ ...value, entity: e })} hint="pusta = encja widgetu" />
          <JsonF label="Dane" value={value.data} onChange={(d) => onChange({ ...value, data: d })} />
        </>}
        {value?.type === 'allOff' && <>
          <EntityListF label="Encje" value={value.entities} onChange={(v) => onChange({ ...value, entities: v })} hint="puste = lista „Licz włączone” + encja widgetu" />
          <CheckF label="Gdy nic nie jest włączone – włącz wszystkie" value={value.onIfNone} onChange={(v) => onChange({ ...value, onIfNone: v || undefined })} />
        </>}
        {value?.type === 'quiet' && <>
          <SelectF label="Działanie" value={value.mode} options={[['toggle', 'Przełącz (wł. / wył.)'], ['on', 'Włącz ciszę'], ['off', 'Wyłącz ciszę']]} onChange={(v) => onChange({ ...value, mode: v as 'toggle' })} />
          <NumF label="Na ile minut" value={value.minutes} min={0} max={1440} onChange={(v) => onChange({ ...value, minutes: v || undefined })} hint="pusto = do wyłączenia albo do końca okna z harmonogramu" />
          <p className="muted small">Działa na panelu, na którym dotknięto kafelka. Kafelek bez encji pokazuje stan ciszy (wł. / do godziny). Harmonogram ciszy ustawisz w Tabletach.</p>
        </>}
        {value?.type === 'popup' && <TriggerPick value={value.trigger} onChange={(id) => onChange({ type: 'popup', trigger: id })} />}
        {value?.type === 'set' && <StepsEditor steps={value.steps} onChange={(steps) => onChange({ type: 'set', steps })} />}
        {value?.type === 'view' && <SelectF label="Zakładka" value={value.view} options={doc.views.map((v) => [v.id, v.title])} onChange={(v) => onChange({ type: 'view', view: v })} />}
        {value?.type === 'dashboard' && <SelectF label="Dashboard" value={value.dashboard} options={dashes.map((d) => [d.id, d.title])} onChange={(v) => onChange({ type: 'dashboard', dashboard: v })}
          hint="Tablet musi mieć ten dashboard przypisany" />}
        {value?.type === 'url' && <TextF label="Adres" value={value.url} onChange={(v) => onChange({ type: 'url', url: v ?? '' })} />}
        {value?.type === 'panel' && <PanelEditor panel={value.panel} doc={doc} onChange={(p) => onChange({ type: 'panel', panel: p })} />}
      </>
    );
  };

/** Pick a trigger whose pop-up the tile opens (same window as when the bell rings). */
const TriggerPick: FC<{ value: string; onChange(id: string): void }> = ({ value, onChange }) => {
  const [list, setList] = useState<TriggerDef[] | null>(null);
  useEffect(() => { api.get<TriggerDef[]>('triggers').then((l) => {
    setList(l);
    const pop = l.filter((t) => t.action === 'popup');
    if (!value && pop.length) onChange(pop[0].id);
  }).catch(() => setList([])); }, []);
  const pop = (list ?? []).filter((t) => t.action === 'popup');
  if (list && !pop.length) return <p className="muted">Najpierw dodaj wyzwalacz z pop-upem w zakładce <b>Wyzwalacze</b> (np. „Dzwonek furtki” z kamerą i przyciskiem „Otwórz”). Przycisk otworzy dokładnie ten sam pop-up.</p>;
  return <SelectF label="Pop-up z wyzwalacza" value={value} options={pop.map((t) => [t.id, `${t.name}${t.popup?.title ? ' – ' + t.popup.title : ''}`])} onChange={onChange}
    hint="Ten sam pop-up co przy dzwonku: kamera, „Odbierz”, „Odrzuć”, „Otwórz furtkę”. Otwiera się tylko na tablecie, na którym dotknięto kafelka." />;
};

// ================================================================ "set values" steps
const StepsEditor: FC<{ steps: SetStep[]; onChange(s: SetStep[]): void }> = ({ steps, onChange }) => {
  const all = useEntityList();
  const setStep = (i: number, p: Partial<SetStep>) => onChange(steps.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="panel-ed">
      <p className="muted">Po dotknięciu wszystkie wartości zostaną ustawione po kolei. Liczba = procent / temperatura / pozycja / wartość; tekst = tryb, opcja lub preset; on / off.</p>
      {steps.map((st, i) => {
        const s = hass.states.get(st.entity);
        const sugg = suggestionsFor(st.entity, s);
        return (
          <div key={i} className="panel-row-ed">
            <div className="panel-row-head"><b>{i + 1}. {all.find((e) => e.entity_id === st.entity)?.name || st.entity || 'nowa encja'}</b>
              <span className="row-btns"><button className="mini" onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label="Usuń">×</button></span></div>
            <EntityF label="Encja" value={st.entity} onChange={(e) => setStep(i, { entity: e ?? '' })} />
            <div className="ins-row"><label>Wartość</label><div className="ins-ctl">
              <input list={'sv' + i} value={st.value} placeholder={sugg.placeholder} onChange={(e) => setStep(i, { value: e.target.value })} />
              <datalist id={'sv' + i}>{sugg.options.map((o) => <option key={o} value={o} />)}</datalist>
              {s && <small>teraz: {s.state}{s.attributes.percentage != null ? ` · ${s.attributes.percentage}%` : ''}{s.attributes.preset_mode ? ` · ${s.attributes.preset_mode}` : ''}</small>}
            </div></div>
          </div>
        );
      })}
      <button className="btn" onClick={() => onChange([...steps, { entity: '', value: '' }])}>+ Dodaj wartość</button>
    </div>
  );
};

function suggestionsFor(entity: string, s?: HassState): { options: string[]; placeholder: string } {
  const d = entity.split('.')[0], a = s?.attributes ?? {};
  switch (d) {
    case 'select': case 'input_select': return { options: a.options ?? [], placeholder: 'opcja' };
    case 'fan': return { options: ['off', '25', '50', '75', '100', ...(a.preset_modes ?? [])], placeholder: 'procent lub preset' };
    case 'number': case 'input_number': return { options: [], placeholder: `${a.min ?? ''}–${a.max ?? ''}${a.unit_of_measurement ? ' ' + a.unit_of_measurement : ''}` };
    case 'climate': return { options: [...(a.hvac_modes ?? []), ...(a.preset_modes ?? [])], placeholder: 'temperatura lub tryb' };
    case 'light': return { options: ['off', 'on', '20', '50', '100'], placeholder: 'jasność % lub on/off' };
    case 'cover': return { options: ['open', 'close', 'stop', '0', '50', '100'], placeholder: 'pozycja % lub open/close' };
    case 'media_player': return { options: ['on', 'off', '20', '40', ...(a.source_list ?? [])], placeholder: 'głośność % lub źródło' };
    default: return { options: ['on', 'off'], placeholder: 'on / off' };
  }
}

/** Hint + quick insert of {entity} into a text that supports templates. */
export const TemplateInsert: FC<{ value?: string; onChange(v: string): void }> = ({ value, onChange }) => {
  const all = useEntityList();
  return (
    <div className="ins-row"><label>Wstaw encję</label><div className="ins-ctl">
      <input list="tplents" placeholder="wybierz, aby dopisać {encja}" onChange={(e) => {
        const v = e.target.value.trim();
        if (all.some((x) => x.entity_id === v)) { onChange((value ?? '') + '{' + v + '}'); e.target.value = ''; }
      }} />
      <datalist id="tplents">{all.slice(0, 2000).map((x) => <option key={x.entity_id} value={x.entity_id}>{x.name}</option>)}</datalist>
      <small>Dynamiczny tekst: {'{sensor.temp}'} – stan z jednostką, {'{climate.salon.temperature}'} – atrybut, {'{sensor.temp:1}'} – 1 miejsce po przecinku.</small>
    </div></div>
  );
};

// ================================================================ panel builder
const DISPLAYS: [RowDisplay, string][] = [['auto', 'Automatycznie'], ['toggle', 'Przełącznik'], ['slider', 'Suwak'], ['value', 'Wartość'], ['buttons', 'Przyciski'], ['graph', 'Wykres'], ['camera', 'Kamera'], ['levels', 'Poziomy (1–4)']];

export const PanelEditor: FC<{ panel: PanelDef; onChange(p: PanelDef): void; doc?: DashboardDoc }> = ({ panel, onChange, doc }) => {
  const rows = panel.rows || [];
  const setRow = (i: number, p: Partial<PanelRow>) => onChange({ ...panel, rows: rows.map((r, j) => (j === i ? clean({ ...r, ...p }) as PanelRow : r)) });
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= rows.length) return;
    const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; onChange({ ...panel, rows: n });
  };
  return (
    <div className="panel-ed">
      <TextF label="Tytuł panelu" value={panel.title} onChange={(v) => onChange({ ...panel, title: v })} />
      <TextF label="Nadtytuł" value={panel.subtitle} onChange={(v) => onChange({ ...panel, subtitle: v })} placeholder="np. Parter" />
      <PanelRemote value={panel.remote} onChange={(v) => onChange({ ...panel, remote: v })} />
      {doc && <SelectF label="Widgety z zakładki" value={panel.view ?? ''} onChange={(v) => onChange(clean({ ...panel, view: v || undefined }) as PanelDef)}
        options={[['', 'brak – tylko wiersze poniżej'], ...[...doc.views].sort((a, b) => Number(!!b.panelOnly) - Number(!!a.panelOnly)).map((v) => [v.id, v.title + (v.panelOnly ? ' (tylko panel)' : '')] as [string, string])]}
        hint="Panel pokaże widgety tej zakładki w tym samym układzie. Utwórz zakładkę w ustawieniach dashboardu i zaznacz „Tylko do panelu”, a widgety ułóż w edytorze wizualnym." />}
      {doc && panel.view && <ViewMini view={doc.views.find((v) => v.id === panel.view)} />}
      <div className="ins-grid4">
        <SelectF label="Rozmiar" value={panel.size ?? 'auto'} onChange={(v) => onChange(clean({ ...panel, size: v === 'auto' ? undefined : v as PanelDef['size'] }) as PanelDef)}
          options={[['auto', 'Auto'], ['normal', 'Normalny'], ['wide', 'Szeroki'], ['large', 'Duży'], ['full', 'Cały ekran']]} />
        <SelectF label="Układ" value={panel.layout ?? 'auto'} onChange={(v) => onChange(clean({ ...panel, layout: v === 'auto' ? undefined : v as PanelDef['layout'] }) as PanelDef)}
          options={[['auto', 'Auto'], ['list', 'Lista'], ['grid', 'Siatka']]} />
        <SelectF label="Kolumny" value={String(panel.columns ?? '')} onChange={(v) => onChange(clean({ ...panel, columns: v ? Number(v) : undefined }) as PanelDef)}
          options={[['', 'Auto'], ['2', '2'], ['3', '3'], ['4', '4']]} />
        <SelectF label="Pokaż" value={panel.mode ?? 'side'} onChange={(v) => onChange(clean({ ...panel, mode: v === 'side' ? undefined : 'center' }) as PanelDef)}
          options={[['side', 'Z boku'], ['center', 'Na środku']]} />
      </div>
      <p className="muted">Auto: przy 2+ kamerach panel jest szeroki, a wiersze układają się w siatkę.</p>
      {rows.map((r, i) => (
        <div key={i} className="panel-row-ed">
          <div className="panel-row-head">
            <b>{i + 1}. {r.name || r.entity || 'nowa encja'}</b>
            <span className="row-btns">
              <button className="mini" onClick={() => move(i, -1)} aria-label="W górę">↑</button>
              <button className="mini" onClick={() => move(i, 1)} aria-label="W dół">↓</button>
              <button className="mini" onClick={() => onChange({ ...panel, rows: rows.filter((_, j) => j !== i) })} aria-label="Usuń">×</button>
            </span>
          </div>
          <EntityF label="Encja" value={r.entity} onChange={(e) => setRow(i, { entity: e ?? '' })} />
          <TextF label="Nazwa" value={r.name} onChange={(v) => setRow(i, { name: v })} placeholder="z encji" />
          <SelectF label="Szerokość w siatce" value={r.span == null ? '' : String(r.span)} onChange={(v) => setRow(i, { span: v === '' ? undefined : Number(v) })}
            options={[['', '1 kolumna'], ['2', '2 kolumny'], ['3', '3 kolumny'], ['0', 'Cała szerokość']]} />
          <SelectF label="Prezentacja" value={r.display ?? 'auto'} options={DISPLAYS} onChange={(v) => setRow(i, { display: v === 'auto' ? undefined : v as RowDisplay })} />
          {r.display === 'value' && <TextF label="Atrybut" value={r.attribute} onChange={(v) => setRow(i, { attribute: v })} placeholder="pusty = stan" />}
          {r.display === 'graph' && <NumF label="Godzin historii" value={r.hours} min={1} max={168} placeholder="24" onChange={(v) => setRow(i, { hours: v })} />}
          {r.display === 'camera' && <CheckF label="Rozmowa (mikrofon)" value={r.talk} onChange={(v) => setRow(i, { talk: v || undefined })} />}
          {r.entity.startsWith('light.') && <CheckF label="Efekty, kolory i barwa bieli" value={!r.noExtras} onChange={(v) => setRow(i, { noExtras: v ? undefined : true })} />}
        </div>
      ))}
      <button className="btn" onClick={() => onChange({ ...panel, rows: [...rows, { entity: '' }] })}>+ Dodaj encję do panelu</button>
    </div>
  );
};

const PanelRemote: FC<{ value?: string; onChange(v: string | undefined): void }> = ({ value, onChange }) => {
  const list = useRemoteOptions();
  return <SelectF label="Pilot TV" value={value ?? ''} options={[['', list.length ? 'brak' : 'brak – dodaj TV lub integrację Samsung w HA'], ...list]} onChange={(v) => onChange(v || undefined)}
    hint="Pilot pokaże się nad wierszami panelu" />;
};

// ================================================================ dashboard / view / theme
/** copy of a view with fresh view / widget ids (ids are unique within a dashboard) */
export function cloneView(v: ViewDef, target: DashboardDoc, title: string): ViewDef {
  const wIds = new Set(target.views.flatMap((x) => x.widgets.map((w) => w.id)));
  const vIds = new Set(target.views.map((x) => x.id));
  const fresh = (base: string, used: Set<string>) => {
    if (!used.has(base)) { used.add(base); return base; }
    const stem = base.replace(/-?\d+$/, '') || 'w';
    let n = 2; while (used.has(stem + n)) n++;
    used.add(stem + n); return stem + n;
  };
  const copy: ViewDef = JSON.parse(JSON.stringify(v));
  copy.id = fresh(v.id.replace(/-kopia\d*$/, '') + '-kopia', vIds);
  copy.title = title;
  copy.widgets = copy.widgets.map((w) => ({ ...w, id: fresh(w.id, wIds) }));
  return copy;
}

const CopyViewTo: FC<{ doc: DashboardDoc; view: ViewDef }> = ({ doc, view }) => {
  const dashes = useDashboardList().filter((d) => d.id !== doc.id);
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  if (!dashes.length) return null;
  const copy = async () => {
    try {
      const target = await api.get<DashboardDoc>('dashboards/' + to);
      const v = cloneView(view, target, view.title);
      await api.put<DashboardDoc>('dashboards/' + to, { ...target, views: [...target.views, v] });
      setMsg(`Skopiowano „${view.title}” do „${target.title}” (widgetów: ${v.widgets.length}). Przyciski przełączające widoki tego dashboardu sprawdź w kopii.`);
    } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="field">
      <span>Kopiuj ten widok do innego dashboardu</span>
      <div className="row-btns">
        <select value={to} onChange={(e) => { setTo(e.target.value); setMsg(''); }}>
          <option value="">— wybierz dashboard —</option>
          {dashes.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
        <button className="btn" disabled={!to} onClick={copy}>Kopiuj</button>
      </div>
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
};

export const DashboardInspector: FC<{
  doc: DashboardDoc; viewId: string; onChange(d: DashboardDoc): void; onSelectView(id: string): void;
  /** 'view' = settings of the selected view, 'dashboard' = name, view switching and theme; default both */
  part?: 'view' | 'dashboard';
}> = ({ doc, viewId, onChange, onSelectView, part }) => {
  const view = doc.views.find((v) => v.id === viewId) ?? doc.views[0];
  const ownThemes = useThemes();
  const setView = (p: Partial<ViewDef>) => onChange({ ...doc, views: doc.views.map((v) => (v.id === view.id ? { ...v, ...p } : v)) });
  const theme: Patch<ThemeDef> = (p) => onChange({ ...doc, theme: { ...doc.theme, ...p } });
  const bg = (p: Partial<ThemeDef['background']>) => theme({ background: { ...doc.theme.background, ...p } });
  const moveView = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= doc.views.length) return;
    const n = [...doc.views]; [n[i], n[j]] = [n[j], n[i]]; onChange({ ...doc, views: n });
  };
  const duplicateView = (v: ViewDef) => {
    const c = cloneView(v, doc, v.title + ' (kopia)');
    const i = doc.views.findIndex((x) => x.id === v.id);
    onChange({ ...doc, views: [...doc.views.slice(0, i + 1), c, ...doc.views.slice(i + 1)] }); onSelectView(c.id);
  };
  const addView = () => {
    let n = doc.views.length + 1; while (doc.views.some((v) => v.id === 'widok' + n)) n++;
    const v: ViewDef = { id: 'widok' + n, title: 'Widok ' + n, columns: view.columns, rowHeight: view.rowHeight, gap: view.gap, widgets: [] };
    onChange({ ...doc, views: [...doc.views, v] }); onSelectView(v.id);
  };
  const showDash = part !== 'view', showView = part !== 'dashboard';
  const vi = doc.views.findIndex((v) => v.id === view.id);
  return (
    <div className="ins">
      {!part && <><div className="ins-top"><h3>Dashboard</h3></div>
      <p className="muted">Kliknij widget na podglądzie, aby go edytować.</p></>}
      {part === 'view' && <div className="ins-top"><h3>{view.title}</h3>
        <div className="row-btns">
          <button className="mini" onClick={() => moveView(vi, -1)} disabled={vi <= 0} aria-label="Przesuń widok wcześniej" title="Wcześniej">↑</button>
          <button className="mini" onClick={() => moveView(vi, 1)} disabled={vi >= doc.views.length - 1} aria-label="Przesuń widok dalej" title="Dalej">↓</button>
          <button className="btn" onClick={() => duplicateView(view)}>Duplikuj</button>
          {doc.views.length > 1 && <button className="btn danger" onClick={() => { if (!confirm(`Usunąć widok „${view.title}” z ${view.widgets.length} widgetami?`)) return; const n = doc.views.filter((x) => x.id !== view.id); onChange({ ...doc, views: n }); onSelectView(n[0].id); }}>Usuń</button>}
        </div></div>}
      {showDash && <Section title="Ogólne">
        <TextF label="Nazwa" value={doc.title} onChange={(v) => onChange({ ...doc, title: v ?? '' })} />
        <CheckF label="Pokazuj zakładki widoków" value={doc.showTabs !== false} onChange={(v) => onChange({ ...doc, showTabs: v })} />
        <CheckF label="Przesunięcie palcem w bok zmienia widok" value={doc.swipeViews !== false} onChange={(v) => onChange(clean({ ...doc, swipeViews: v ? undefined : false }) as DashboardDoc)} />
        {doc.showTabs !== false && <SelectF label="Styl przełączania widoków" value={doc.tabStyle ?? 'top'}
          onChange={(v) => onChange(clean({ ...doc, tabStyle: v === 'top' ? undefined : v as DashboardDoc['tabStyle'] }) as DashboardDoc)}
          options={[['top', 'Zakładki u góry'], ['pills', 'Pigułki u góry'], ['bottom', 'Belka na dole (ikona + nazwa)'], ['tiles', 'Same kafelki na dole'], ['tilesTop', 'Same kafelki u góry'], ['rail', 'Pasek boczny z lewej']]}
          hint="Przy belce, kafelkach i pasku bocznym ustaw ikony widoków poniżej – bez ikony pojawi się kropka." />}
        {doc.showTabs !== false && ['pills', 'bottom', 'tiles', 'tilesTop'].includes(doc.tabStyle ?? 'top') && <SelectF label="Położenie" value={doc.tabAlign ?? 'center'}
          onChange={(v) => onChange(clean({ ...doc, tabAlign: v === 'center' ? undefined : v as DashboardDoc['tabAlign'] }) as DashboardDoc)}
          options={[['left', 'Do lewej'], ['center', 'Na środku'], ['right', 'Do prawej']]} />}
        {doc.showTabs !== false && ['pills', 'bottom', 'tiles', 'tilesTop'].includes(doc.tabStyle ?? 'top') && <CheckF label="Pływające nad widgetami" value={doc.tabFloat}
          onChange={(v) => onChange(clean({ ...doc, tabFloat: v || undefined }) as DashboardDoc)} />}
      </Section>}

      {!part && <Section title="Widoki (zakładki)">
        {doc.views.map((v, i) => (
          <div key={v.id} className={'view-item' + (v.id === view.id ? ' sel' : '')}>
            <button className="view-name" onClick={() => onSelectView(v.id)}>{v.title}{v.panelOnly ? ' · panel' : ''}</button>
            <span className="row-btns">
              <button className="mini" onClick={() => moveView(i, -1)} aria-label="W lewo">↑</button>
              <button className="mini" onClick={() => moveView(i, 1)} aria-label="W prawo">↓</button>
              <button className="mini" onClick={() => duplicateView(v)} aria-label={'Duplikuj widok ' + v.title} title="Duplikuj">⧉</button>
              {doc.views.length > 1 && <button className="mini" aria-label={'Usuń widok ' + v.title}
                onClick={() => { const n = doc.views.filter((x) => x.id !== v.id); onChange({ ...doc, views: n }); onSelectView(n[0].id); }}>×</button>}
            </span>
          </div>
        ))}
        <button className="btn" onClick={addView}>+ Nowy widok</button>
      </Section>}

      {showView && <Section title={part ? 'Ustawienia widoku' : `Widok „${view.title}”`}>
        <TextF label="Nazwa zakładki" value={view.title} onChange={(v) => setView({ title: v ?? view.id })} />
        <CheckF label="Tylko do panelu (nie pokazuj jako zakładki)" value={view.panelOnly} onChange={(v) => setView({ panelOnly: v || undefined })} />
        <IconF value={view.icon} onChange={(v) => setView({ icon: v })} />
        <NumF label="Kolumny siatki" value={view.columns} min={1} max={48} onChange={(v) => setView({ columns: Math.max(1, Math.min(48, v ?? 24)) })} />
        <NumF label="Wysokość wiersza (px)" value={view.rowHeight} min={16} max={400} onChange={(v) => setView({ rowHeight: Math.max(16, v ?? 56) })} />
        <NumF label="Odstęp (px)" value={view.gap} min={0} max={64} onChange={(v) => setView({ gap: Math.max(0, v ?? 12) })} />
        {!part && <button className="btn" onClick={() => duplicateView(view)}>⧉ Duplikuj widok</button>}
        <CopyViewTo doc={doc} view={view} />
      </Section>}

      {showDash && <Section title="Motyw">
        <SelectF label="Wygląd" value={doc.theme.custom ? 'own:' + doc.theme.custom : doc.theme.skin ?? 'glass'}
          onChange={(v) => v.startsWith('own:') ? theme({ custom: v.slice(4) }) : theme({ custom: undefined, skin: v === 'glass' ? undefined : v as ThemeDef['skin'], ...(v !== 'glass' && doc.theme.radius === 20 ? { radius: 16 } : {}) })}
          options={[...SKINS as [string, string][], ...ownThemes.map((t) => ['own:' + t.id, 'Mój: ' + t.name] as [string, string])]}
          hint={doc.theme.custom ? (ownThemes.some((t) => t.id === doc.theme.custom) ? 'Własny motyw – kolory, kafelki i czcionkę zmienisz w zakładce Motywy.' : 'Tego motywu już nie ma – wybierz inny.') : doc.theme.skin && doc.theme.skin !== 'glass' ? 'Kolory pochodzą z wyglądu – akcent, tekst i krycie kafelków poniżej są pomijane.' : 'Własne motywy tworzysz w zakładce Motywy.'} />
        <CheckF label="Motywy okolicznościowe automatycznie" value={doc.theme.occasions} onChange={(v) => theme({ occasions: v || undefined })} />
        <p className="muted small">{'Święta 6.12–6.01 · Wielkanoc (od Niedzieli Palmowej do Poniedziałku Wielkanocnego) · Halloween 24–31.10 · Walentynki 10–14.02; poza tym „Wygląd” powyżej.' + (occasionFor(new Date()) ? ' Dziś: ' + SKINS.find(([k]) => k === occasionFor(new Date()))?.[1] : '')}</p>
        <SelectF label="Efekt w tle" value={doc.theme.effect ?? 'auto'} onChange={(v) => theme({ effect: v === 'auto' ? undefined : v as ThemeDef['effect'] })}
          options={FX as [string, string][]} hint="Wg motywu: śnieg na Święta, płatki na Wielkanoc, liście na Halloween, serduszka na Walentynki. Wyłączone na słabych tabletach." />
        <SelectF label="Tło" value={doc.theme.background.type} options={[['glass', 'Szkło (gradient)'], ['color', 'Kolor'], ['image', 'Obrazek']]}
          onChange={(v) => bg({ type: v as ThemeDef['background']['type'] })} />
        {doc.theme.background.type === 'color' && <ColorF label="Kolor tła" value={doc.theme.background.color} onChange={(v) => bg({ color: v ?? '#0B0D12' })} />}
        {doc.theme.background.type === 'image' && <>
          <TextF label="Obrazek" value={doc.theme.background.image} onChange={(v) => bg({ image: v ?? '' })} placeholder="media/tlo.jpg" />
          <UploadButton onUrl={(u) => bg({ image: u })} />
          <RangeF label="Rozmycie" value={doc.theme.background.blur} def={0} min={0} max={30} unit=" px" onChange={(v) => bg({ blur: v ?? 0 })} />
          <RangeF label="Przyciemnienie" value={doc.theme.background.dim} def={35} min={0} max={90} unit="%" onChange={(v) => bg({ dim: v ?? 35 })} />
        </>}
        <ColorF label="Akcent" value={doc.theme.accent} onChange={(v) => theme({ accent: v ?? '#FFC870' })} />
        <ColorF label="Tekst" value={doc.theme.textColor} onChange={(v) => theme({ textColor: v ?? '#F5F3EF' })} />
        <RangeF label="Krycie kafelków" value={doc.theme.tileOpacity} def={0.58} min={0} max={1} step={0.05} onChange={(v) => theme({ tileOpacity: v ?? 0.58 })} />
        <RangeF label="Zaokrąglenie" value={doc.theme.radius} def={20} min={0} max={48} unit=" px" onChange={(v) => theme({ radius: v ?? 20 })} />
      </Section>}
    </div>
  );
};

/** Small schematic of a view's layout (used for "widgets in the side panel"). */
const ViewMini: FC<{ view?: ViewDef }> = ({ view }) => {
  if (!view) return <p className="muted">Ta zakładka już nie istnieje.</p>;
  if (!view.widgets.length) return <p className="muted">Zakładka „{view.title}” jest pusta – dodaj w niej widgety w edytorze wizualnym.</p>;
  return (
    <div className="vmini" style={{ gridTemplateColumns: `repeat(${view.columns}, 1fr)` }} aria-label={'Podgląd zakładki ' + view.title}>
      {view.widgets.map((w) => (
        <div key={w.id} style={{ gridColumn: `${w.x + 1} / span ${w.w}`, gridRow: `${w.y + 1} / span ${w.h}` }} title={w.title || WIDGETS[w.type]?.label}>
          {w.title || WIDGETS[w.type]?.label}
        </div>
      ))}
    </div>
  );
};

/** Rooms of a Dyson robot (hass_dyson.start_zone_clean takes their id or MyDyson name) */
const RoomsF: FC<{ value?: { id: string; name: string; label?: string; mode?: string }[]; onChange(v: { id: string; name: string; label?: string; mode?: string }[] | undefined): void }> = ({ value = [], onChange }) => {
  const set = (i: number, p: Partial<{ id: string; name: string; label?: string }>) => onChange(value.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="ins-row"><label>Pokoje</label>
      <div className="ins-ctl">
        {value.map((r, i) => (
          <div key={i} className="row-btns">
            <input style={{ width: 60 }} value={r.id} placeholder="id" onChange={(e) => set(i, { id: e.target.value })} aria-label="Id pokoju" />
            <input style={{ flex: 1 }} value={r.name} placeholder="nazwa jak w MyDyson" onChange={(e) => set(i, { name: e.target.value })} aria-label="Nazwa pokoju w MyDyson" title="Nazwa w MyDyson – po niej robot rozpoznaje pokój" />
            <input style={{ flex: 1 }} value={r.label ?? ''} placeholder="wyświetlana (opcjonalnie)" onChange={(e) => set(i, { label: e.target.value || undefined })} aria-label="Nazwa wyświetlana" />
            {r.mode && <small className="muted" title="Ustawienia pokoju z hass-dyson (tryb, moc, woda, mycie)">⚙</small>}
            <button className="mini" onClick={() => { const n = value.filter((_, j) => j !== i); onChange(n.length ? n : undefined); }} aria-label={'Usuń ' + r.name}>×</button>
          </div>
        ))}
        <button className="btn" onClick={() => onChange([...value, { id: '', name: '' }])}>+ Pokój</button>
        <small>„Wykryj urządzenie” uzupełnia pokoje z hass-dyson (Spot+Scrub) razem z ich ustawieniami (⚙ – tryb, moc, woda, mycie; w kafelku przycisk z zębatką). Dla Vis Nav wpisz nazwy pokoi z aplikacji MyDyson. Druga kolumna to nazwa w kafelku (np. „Salon” zamiast „Living room2”) – pierwsza musi zostać jak w MyDyson. W kafelku: wybierz pokoje → „Sprzątaj”.</small>
      </div>
    </div>
  );
};

/** Calendars shown by a calendar widget: entity, colour, optional name. */
const CalendarsF: FC<{ value?: { entity: string; color?: string; name?: string }[]; onChange(v: { entity: string; color?: string; name?: string }[] | undefined): void }> = ({ value = [], onChange }) => {
  const set = (i: number, p: Partial<{ entity: string; color?: string; name?: string }>) => onChange(value.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <fieldset className="field">
      <legend>Kalendarze</legend>
      {value.map((c, i) => (
        <div key={i} className="cal-ed">
          <EntityF label={'Kalendarz ' + (i + 1)} value={c.entity} domains={['calendar']} onChange={(v) => set(i, { entity: v ?? '' })} />
          <div className="cal-ed-row">
            <input type="color" aria-label="Kolor" value={c.color || CAL_COLORS[i % CAL_COLORS.length]} onChange={(e) => set(i, { color: e.target.value })} />
            <input placeholder="nazwa (opcjonalnie)" value={c.name ?? ''} onChange={(e) => set(i, { name: e.target.value || undefined })} />
            <button className="mini" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Usuń kalendarz">×</button>
          </div>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...value, { entity: '' }])}>+ Dodaj kalendarz</button>
    </fieldset>
  );
};

/** Levels widget: automatic from the entity, or your own list (value, label, icon). */
const LevelsF: FC<{ o: Record<string, any>; opt(k: string, v: unknown): void; entity?: string }> = ({ o, opt, entity }) => {
  const own: LevelDef[] = Array.isArray(o.levels) ? o.levels : [];
  const set = (i: number, p: Partial<LevelDef>) => opt('levels', own.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <>
      <div className="ins-grid2">
        <CheckF label="Przycisk „Wył.”" value={o.off} onChange={(v) => opt('off', v || undefined)} />
        <CheckF label="Nagłówek z nazwą" value={o.header !== false} onChange={(v) => opt('header', v ? undefined : false)} />
      </div>
      {!own.length && <NumF label="Liczba poziomów (auto)" value={o.count} min={1} max={10} onChange={(v) => opt('count', v)} />}
      <fieldset className="field">
        <legend>Poziomy {own.length ? '' : '(automatycznie z encji)'}</legend>
        {own.map((l, i) => (
          <div key={i} className="lv-ed">
            <input placeholder="wartość (np. 25, 2, Boost)" value={l.value} onChange={(e) => set(i, { value: e.target.value })} aria-label="Wartość" />
            <input placeholder="etykieta" value={l.label ?? ''} onChange={(e) => set(i, { label: e.target.value || undefined })} aria-label="Etykieta" />
            <input placeholder="ikona" value={l.icon ?? ''} onChange={(e) => set(i, { icon: e.target.value || undefined })} aria-label="Ikona" />
            <button className="mini" onClick={() => opt('levels', own.filter((_, j) => j !== i))} aria-label="Usuń poziom">×</button>
          </div>
        ))}
        <div className="row-btns">
          <button className="btn" onClick={() => opt('levels', [...own, { value: String(own.length + 1), label: String(own.length + 1), icon: 'mdi:fan-speed-' + Math.min(4, own.length + 1) }])}>+ Poziom</button>
          {!own.length && entity && <button className="btn" onClick={() => opt('levels', autoLevels(hass.states.get(entity), o.count))}>Skopiuj automatyczne do edycji</button>}
        </div>
        <p className="muted small">Wartość: procent wentylatora (25/50/75/100), nazwa presetu lub opcji, liczba dla encji number. Ikony: mdi:fan-speed-1 … mdi:fan-speed-4, mdi:fan-off, dowolne mdi:…</p>
      </fieldset>
    </>
  );
};

/** Rain Bird IQ4: zones, programs, rain delay and connection – found automatically or picked by hand. */
const IrrigationF: FC<{ o: Record<string, any>; set(p: Record<string, unknown>): void; opt(k: string, v: unknown): void }> = ({ o, set, opt }) => {
  const found = () => { const d = discoverIq4(hass.states.values()); set(clean({ stations: d.stations, programs: d.programs, rainDelay: d.rainDelay, connected: d.connected, mode: d.mode, alarms: d.alarms, warnings: d.warnings, rainSensor: d.rainSensor, forecast: d.forecast }) as Record<string, unknown>); };
  return (
    <>
      <div className="row-btns"><button className="btn primary" onClick={found}>Wykryj strefy i programy Rain Bird IQ4</button></div>
      <EntityListF label="Strefy (sensory Station)" value={o.stations} onChange={(v) => opt('stations', v)} />
      <EntityListF label="Programy (sensory Program … Status)" value={o.programs === false ? [] : o.programs} onChange={(v) => opt('programs', v)} />
      <EntityF label="Opóźnienie deszczowe" value={o.rainDelay} domains={['sensor']} onChange={(v) => opt('rainDelay', v)} />
      <EntityF label="Połączenie (binary_sensor Connected)" value={o.connected} domains={['binary_sensor']} onChange={(v) => opt('connected', v)} hint="używane też jako sterownik dla „Zatrzymaj wszystko” i opóźnienia" />
      <EntityF label="Tryb sterownika (sensor Controller Mode)" value={o.mode} domains={['sensor']} onChange={(v) => opt('mode', v)} hint="przy „off” kafelek ostrzega, że programy nie ruszą" />
      <div className="ins-grid2">
        <EntityF label="Alarmy (sensor)" value={o.alarms} domains={['sensor']} onChange={(v) => opt('alarms', v)} />
        <EntityF label="Ostrzeżenia (sensor)" value={o.warnings} domains={['sensor']} onChange={(v) => opt('warnings', v)} />
      </div>
      <div className="ins-grid2">
        <EntityF label="Czujnik deszczu (binary_sensor)" value={o.rainSensor} domains={['binary_sensor']} onChange={(v) => opt('rainSensor', v)} />
        <EntityF label="Opóźnienie wg prognozy (binary_sensor)" value={o.forecast} domains={['binary_sensor']} onChange={(v) => opt('forecast', v)} />
      </div>
      <NumF label="Domyślny czas strefy (min)" value={o.duration ?? 10} min={1} max={100} onChange={(v) => opt('duration', v)} />
      <div className="ins-grid2">
        <CheckF label="Przyciski opóźnienia" value={o.delayButtons !== false} onChange={(v) => opt('delayButtons', v ? undefined : false)} />
        <CheckF label="Ukryj nieaktywne programy" value={o.hideInactivePrograms} onChange={(v) => opt('hideInactivePrograms', v || undefined)} />
      </div>
      <p className="muted small">Wymaga integracji rainbird_iq4 z HACS. Strefy uruchamiane są usługą rainbird_iq4.start_zone (1–100 min, integracja 1.9+). Od wersji 1.8 każda strefa jest osobnym urządzeniem w HA – „Wykryj” i tak znajdzie wszystkie.</p>
    </>
  );
};

interface DevInfo { id: string; name: string; model?: string; area?: string; integrations: string[]; entities: { entity_id: string; key: string; uid?: string; orig?: string; category?: string; name: string }[] }
/** Pick a device from the HA registry (optionally of one integration) – used by device-based widgets. */
const DeviceDiscover: FC<{ integration?: string; label: string; filter?(d: DevInfo): boolean; onPick(d: DevInfo): void }> = ({ integration, label, filter, onPick }) => {
  const [list, setList] = useState<DevInfo[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const load = () => api.get<DevInfo[]>('devices' + (integration ? '?integration=' + integration : '')).then((l) => setList(filter ? l.filter(filter) : l)).catch((e) => setErr(e.message));
  if (!list) return <div className="row-btns"><button className="btn primary" onClick={load}>{label}</button>{err && <span className="err">{err}</span>}</div>;
  const f = list.filter((d) => !q || (d.name + ' ' + (d.model ?? '') + ' ' + (d.area ?? '') + ' ' + d.integrations.join(' ')).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="dev-pick">
      <input placeholder="Szukaj urządzenia…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Szukaj urządzenia" />
      {list.length === 0 && <p className="muted">{integration ? `Brak urządzeń integracji ${integration}.` : 'Brak urządzeń.'}</p>}
      <div className="dev-list">{f.slice(0, 80).map((d) => (
        <button key={d.id} onClick={() => { onPick(d); setList(null); }}><b>{d.name}</b><small>{[d.model, d.area, d.integrations.join(', '), d.entities.length + ' encji'].filter(Boolean).join(' · ')}</small></button>
      ))}</div>
      <button className="btn" onClick={() => setList(null)}>Anuluj</button>
    </div>
  );
};

/** Entities of an integration (also those without a device, like Satel zones) – one click fills a widget. */
const IntegrationPick: FC<{ platform: string; label: string; onPick(entities: string[]): void }> = ({ platform, label, onPick }) => {
  const [msg, setMsg] = useState('');
  return (
    <div className="row-btns">
      <button className="btn primary" onClick={() => api.get<string[]>('integration-entities?platform=' + platform).then((l) => { onPick(l); setMsg(l.length ? `Znaleziono ${l.length} encji.` : 'Brak encji tej integracji.'); }).catch((e) => setMsg(e.message))}>{label}</button>
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
};

/** Simple Timer: pick an instance by name, or paste a timer-card YAML (timer_instance_id = config entry id). */
const TimerPick: FC<{ w: WidgetDef; set(p: Partial<WidgetDef>): void }> = ({ w, set }) => {
  const timers = [...hass.states.values()].filter(isSimpleTimer);
  const [yaml, setYaml] = useState('');
  const [msg, setMsg] = useState('');
  const label = (s: HassState) => String(s.attributes.instance_title || s.attributes.friendly_name || s.entity_id);
  const importCard = () => {
    const get = (k: string) => yaml.match(new RegExp('^\\s*' + k + ':\\s*(.+)$', 'm'))?.[1].trim().replace(/^["']|["']$/g, '');
    const id = get('timer_instance_id');
    const sensor = timers.find((s) => s.attributes.entry_id === id);
    if (!id) return setMsg('Nie znalazłem „timer_instance_id” w wklejonym tekście.');
    if (!sensor) return setMsg(`Nie ma sensora Simple Timer z entry_id ${id} – sprawdź, czy integracja działa i czy add-on widzi encję.`);
    const block = yaml.match(/timer_buttons:\s*\n((?:\s*-\s*.+\n?)+)/)?.[1] ?? '';
    const presets = block.split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    const bool = (k: string) => { const v = get(k); return v == null ? undefined : v === 'true'; };
    const o: Record<string, any> = { ...(w.options ?? {}) };
    if (presets.length) o.presets = presets;
    if (bool('reverse_mode')) o.reverse = true; else delete o.reverse;
    if (bool('turn_off_on_cancel') === false) o.turnOffOnCancel = false;
    if (bool('show_daily_usage') === false) o.usage = false;
    if (bool('show_schedule')) o.schedule = true;
    set({ entity: sensor.entity_id, title: get('card_title') || w.title, icon: get('entity_state_icon') || w.icon, options: o });
    setMsg(`Ustawiono: ${label(sensor)} (${sensor.entity_id}).`); setYaml('');
  };
  return (
    <>
      <SelectF label="Timer" value={w.entity ?? ''} onChange={(v) => set({ entity: v || undefined, title: w.title || label(hass.states.get(v)!) })}
        options={[['', timers.length ? 'wybierz…' : 'brak sensorów Simple Timer'], ...timers.map((s) => [s.entity_id, `${label(s)} · ${s.entity_id}`] as [string, string])]} />
      <label className="field"><span>…albo wklej konfigurację karty timer-card</span>
        <textarea rows={4} value={yaml} onChange={(e) => setYaml(e.target.value)} placeholder={'type: custom:timer-card\ntimer_instance_id: 01K…\ncard_title: …'} /></label>
      <div className="row-btns"><button className="btn" disabled={!yaml.trim()} onClick={importCard}>Importuj z timer-card</button>{msg && <span className="muted">{msg}</span>}</div>
    </>
  );
};

/** Which panels the intercom widget can call (empty = all with intercom on). */
const IntercomTargets: FC<{ value?: string[]; onChange(v: string[] | undefined): void }> = ({ value, onChange }) => {
  const [tablets, setTablets] = useState<{ id: string; name: string; intercom?: boolean }[]>([]);
  useEffect(() => { api.get<{ id: string; name: string; intercom?: boolean }[]>('tablets').then(setTablets).catch(() => {}); }, []);
  const v = value ?? [];
  return (
    <fieldset className="field"><legend>Do kogo dzwonić</legend>
      <div className="app-chips">
        <button className={'chip' + (!v.length ? ' on' : '')} onClick={() => onChange(undefined)}>wszystkie panele</button>
        {tablets.filter((t) => t.intercom !== false).map((t) => { const on = v.includes(t.id); return <button key={t.id} className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onChange(on ? v.filter((x) => x !== t.id) : [...v, t.id])}>{t.name}</button>; })}
      </div>
      <small className="muted">Własny panel nie pojawia się na liście na tablecie.</small>
    </fieldset>
  );
};
