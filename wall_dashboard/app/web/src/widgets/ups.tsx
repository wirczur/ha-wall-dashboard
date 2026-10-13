// UPS: battery, mains / on battery, runtime, load, voltages – from single entities (NUT, APC UPS Daemon, SNMP, …).
import type { FC } from 'react';
import type { HassState, WidgetDef } from '../../../shared/types';
import { formatNumber, friendly } from '../lib/format';
import { useEntities } from '../lib/hass';
import { Icon } from '../ui/Icon';

export const UPS_KEYS: [string, string][] = [
  ['battery', 'Bateria (%)'], ['status', 'Stan pracy'], ['runtime', 'Pozostały czas'], ['load', 'Obciążenie (%)'],
  ['power', 'Moc (W)'], ['inputV', 'Napięcie wejściowe'], ['outputV', 'Napięcie wyjściowe'], ['battV', 'Napięcie baterii'], ['charger', 'Stan baterii / ładowarki']
];

/** entity id / translation key → option, for one-click discovery (NUT, apcupsd, generic names) */
export function upsGuess(ids: { entity_id: string; key?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const rules: [string, RegExp][] = [
    ['charger', /(charger_status|battery_charger|charger)/],
    ['status', /(status_data|ups_status|_status$|status_code|online_status)/],
    ['battery', /(battery_charge$|battery_charge_level|_battery$|bcharge|battery_level|_charge$)/],
    ['runtime', /(battery_runtime$|time_left|timeleft|runtime$|remaining)/],
    ['load', /(_load$|load_percent|loadpct|ups_load)/],
    ['power', /(realpower$|ups_realpower|_power$|load_power|watts)/],
    ['inputV', /(input_voltage$|linev|input_volt)/],
    ['outputV', /(output_voltage$|outputv|output_volt)/],
    ['battV', /(battery_voltage$|battv)/]
  ];
  // prefer the raw status codes (OL / OB / LB) over the translated text
  const sorted = [...ids].sort((a, b) => Number(/status_data/.test(b.entity_id)) - Number(/status_data/.test(a.entity_id)));
  for (const e of sorted) {
    const s = (e.key ? e.key + ' ' : '') + e.entity_id;
    for (const [k, re] of rules) if (!out[k] && re.test(s) && (k === 'status' ? /^(sensor|binary_sensor)\./.test(e.entity_id) : e.entity_id.startsWith('sensor.'))) { out[k] = e.entity_id; break; }
  }
  return out;
}

type Mode = 'online' | 'battery' | 'low' | 'charging' | 'bypass' | 'overload' | 'off' | 'unknown';
const MODE_PL: Record<Mode, string> = {
  online: 'Zasilanie z sieci', battery: 'Praca na baterii', low: 'Niski poziom baterii!', charging: 'Ładowanie baterii',
  bypass: 'Bypass – bez ochrony', overload: 'Przeciążenie!', off: 'Wyłączony', unknown: 'Brak danych'
};
/** NUT status codes (OL OB LB CHRG …), apcupsd (ONLINE / ONBATT), binary "online" sensors or plain text */
/** user mapping from the widget settings: "Resting=online" per line (modes: online, battery, low, charging, bypass, overload, off) */
export function parseStatusMap(txt?: string): Record<string, Mode> {
  const out: Record<string, Mode> = {};
  const alias: Record<string, Mode> = { siec: 'online', 'sieć': 'online', online: 'online', bateria: 'battery', battery: 'battery', niski: 'low', low: 'low', ladowanie: 'charging', 'ładowanie': 'charging', charging: 'charging', bypass: 'bypass', przeciazenie: 'overload', 'przeciążenie': 'overload', overload: 'overload', off: 'off', wylaczony: 'off', 'wyłączony': 'off' };
  for (const line of String(txt ?? '').split(/\n|;/)) {
    const [k, v] = line.split('=').map((x) => x.trim());
    if (k && v && alias[v.toLowerCase()]) out[k.toLowerCase()] = alias[v.toLowerCase()];
  }
  return out;
}
function modeOf(s?: HassState, map: Record<string, Mode> = {}): { mode: Mode; codes: string[] } {
  if (!s || ['unknown', 'unavailable', ''].includes(s.state)) return { mode: 'unknown', codes: [] };
  const own = map[s.state.trim().toLowerCase()];
  if (own) return { mode: own, codes: [] };
  if (s.entity_id.startsWith('binary_sensor.')) return { mode: s.state === 'on' ? 'online' : 'battery', codes: [] };
  const v = s.state.toUpperCase();
  const codes = v.split(/[\s,]+/);
  const has = (...c: string[]) => c.some((x) => codes.includes(x) || v.includes(x));
  if (has('OVER', 'OVERLOAD', 'PRZECI')) return { mode: 'overload', codes };
  if (has('LB', 'LOW BATTERY', 'LOWBATT')) return { mode: 'low', codes };
  // PowerWalker / Voltronic (ViewPower, WinPower): Line / Battery / Standby / Fault / ECO / Converter / Bypass mode
  if (has('FAULT', 'AWARIA', 'BŁĄD', 'NOT CONNECT', "CAN'T WORK ON INVERTER")) return { mode: 'overload', codes };
  // WinPower events / modes: "UPS battery low", "back-up time exhausted", "AC fail", "AC restore", "normal mode", "Bypass output"
  if (has('BATTERY LOW', 'TIME EXHAUSTED')) return { mode: 'low', codes };
  if (has('AC FAIL', 'SELF-TEST BEGIN', 'SELF TEST')) return { mode: 'battery', codes };
  if (has('AC RESTORE', 'NORMAL MODE')) return { mode: 'online', codes };
  if (has('OB', 'ONBATT', 'ON BATTERY', 'BATTERY MODE', 'DISCHRG', 'DISCHARGING', 'NA BATERII', 'BATTERY TEST')) return { mode: 'battery', codes };
  if (has('BYPASS')) return { mode: 'bypass', codes };
  if ((has('OFF') && !has('ONLINE', 'OL')) || has('SHUTDOWN', 'STANDBY MODE')) return { mode: 'off', codes };
  if (has('CHRG', 'CHARGING')) return { mode: 'charging', codes };
  // battery charger states (NUT battery.charger.status): resting / floating = battery full, mains present
  if (has('OL', 'ONLINE', 'ON LINE', 'SIEĆ', 'SIEC', 'RESTING', 'FLOATING', 'FLOAT', 'FULLY CHARGED', 'NORMAL', 'LINE MODE', 'LINE', 'ECO', 'CONVERTER', 'POWER ON')) return { mode: 'online', codes };
  return { mode: 'unknown', codes };
}
/** battery / charger state in Polish (Resting, Floating, Charging, Discharging…) */
const CHARGER_PL: [RegExp, string][] = [
  [/discharg/i, 'bateria się rozładowuje'], [/resting/i, 'bateria naładowana, w spoczynku'], [/float/i, 'bateria naładowana (podtrzymanie)'],
  [/charg/i, 'ładowanie baterii'], [/fully charged|full/i, 'bateria naładowana'], [/replace|wymie/i, 'wymień baterię!'], [/test/i, 'test baterii']
];
const chargerPl = (s?: HassState) => {
  if (!s || ['unknown', 'unavailable', ''].includes(s.state)) return '';
  return CHARGER_PL.find(([re]) => re.test(s.state))?.[1] ?? s.state;
};
const num = (s?: HassState) => (s && s.state !== '' && isFinite(Number(s.state)) ? Number(s.state) : undefined);
/** runtime in minutes from s / min / h */
function minutes(s?: HassState) {
  const v = num(s); if (v == null) return undefined;
  const u = String(s!.attributes.unit_of_measurement ?? 's').toLowerCase();
  return u.startsWith('h') ? v * 60 : u.startsWith('min') ? v : u === 's' || u.startsWith('sec') ? v / 60 : v / 60;
}
const fmtRun = (m: number) => m >= 90 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
const ago = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; if (!isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'chwili' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export const UpsWidget: FC<{ w: WidgetDef }> = ({ w }) => {
  const o = w.options ?? {};
  const [bat, st, run, load, power, inV, outV, battV, chg] = useEntities(UPS_KEYS.map(([k]) => o[k] ?? ''));
  if (!o.battery && !o.status) return <div className="ups ups-empty"><Icon name="mdi:power-plug-battery-outline" size={28} /><span>Wskaż encje UPS („Wykryj UPS” w ustawieniach)</span></div>;
  const pct = num(bat);
  const m0 = modeOf(st, parseStatusMap(o.statusMap)).mode;
  // mains OK but the charger reports charging → show the charging look
  const mode: Mode = m0 === 'online' && chg && /^charging/i.test(chg.state) ? 'charging' : m0;
  const runMin = minutes(run);
  const ld = num(load);
  const bad = mode === 'battery' || mode === 'low' || mode === 'overload' || mode === 'bypass';
  const level = mode === 'low' || mode === 'overload' || (pct != null && pct < 25) ? 'crit' : bad ? 'warn' : 'ok';
  const title = w.title || (st ? friendly(st, '').replace(/\s*(status( data)?|stan.*)$/i, '') : 'UPS') || 'UPS';
  const icon = mode === 'online' || mode === 'charging' ? 'mdi:power-plug' : mode === 'unknown' || mode === 'off' ? 'mdi:power-plug-off-outline' : 'mdi:battery-alert-variant-outline';
  const small = w.w <= 3 && w.h <= 3;
  const fill = Math.max(0, Math.min(100, pct ?? 0));

  return (
    <div className={'ups lvl-' + level + (small ? ' ups-small' : '') + (mode === 'charging' ? ' chg' : '')}>
      <div className="ups-hd">
        <span className="ups-ico"><Icon name={icon} size={small ? 20 : 22} /></span>
        <div className="ups-tt"><b>{title}</b><small>{mode === 'unknown' && st && !['unknown', 'unavailable', ''].includes(st.state) ? (chargerPl(st) || st.state) : MODE_PL[mode]}{bad && st?.last_changed ? ` · od ${ago(st.last_changed)}` : ''}{(() => { const c = chargerPl(chg) || (mode === 'online' && st && /resting|float/i.test(st.state) ? chargerPl(st) : ''); return c && c !== MODE_PL[mode].toLowerCase() ? ' · ' + c : ''; })()}</small></div>
      </div>
      <div className="ups-bat" role="img" aria-label={`Bateria ${pct ?? '?'}%`}>
        <div className="ups-cell"><i style={{ width: fill + '%' }} />{mode === 'charging' && <Icon name="mdi:lightning-bolt" size={16} />}</div>
        <div className="ups-pct"><b>{pct == null ? '–' : formatNumber(pct, 0)}</b><span>%</span></div>
      </div>
      {runMin != null && <div className="ups-run"><Icon name="mdi:timer-sand" size={16} /><span>{bad ? 'zostało' : 'czas pracy na baterii'}</span><b>{fmtRun(runMin)}</b></div>}
      {!small && ld != null && (
        <div className="ups-load"><span>Obciążenie</span><div className="ups-lbar"><i style={{ width: Math.min(100, ld) + '%' }} className={ld > 85 ? 'hot' : ''} /></div>
          <b>{formatNumber(ld, 0)}%{num(power) != null ? ` · ${formatNumber(num(power)!, 0)} W` : ''}</b></div>
      )}
      {!small && (inV || outV || battV) && (
        <div className="ups-v">
          {inV && <span><small>wejście</small>{formatNumber(num(inV) ?? 0, 0)} V</span>}
          {outV && <span><small>wyjście</small>{formatNumber(num(outV) ?? 0, 0)} V</span>}
          {battV && <span><small>bateria</small>{formatNumber(num(battV) ?? 0, 1)} V</span>}
        </div>
      )}
    </div>
  );
};
