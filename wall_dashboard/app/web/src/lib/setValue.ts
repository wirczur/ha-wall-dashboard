// Sets an entity to a value with the right service for its domain — used by "Ustaw wartości" buttons.
import type { HassState, SetStep } from '../../../shared/types';
import { hass } from './hass';
import { domainOf } from './format';

const isNum = (v: string) => v.trim() !== '' && isFinite(Number(v.replace(',', '.')));
const num = (v: string) => Number(v.replace(',', '.'));
const ON = (v: string) => /^(on|wł\.?|wlacz|włącz|true|1|open|otwórz)$/i.test(v.trim());
const OFF = (v: string) => /^(off|wył\.?|wylacz|wyłącz|false|0|close|zamknij)$/i.test(v.trim());

export interface ServiceCall { domain: string; service: string; data?: Record<string, unknown> }

/** Which service sets this entity to this value (shared by "Ustaw wartości" buttons and the automation wizard). */
export function serviceFor(entity: string, value: string, s: HassState | undefined = hass.states.get(entity)): ServiceCall {
  const d = domainOf(entity), v = String(value ?? '').trim(), c = (service: string, data?: Record<string, unknown>, domain = d): ServiceCall => ({ domain, service, ...(data ? { data } : {}) });
  switch (d) {
    case 'number': case 'input_number': return c('set_value', { value: num(v) });
    case 'select': case 'input_select': return c('select_option', { option: v });
    case 'input_text': case 'text': return c('set_value', { value: v });
    case 'input_datetime': return c('set_datetime', /:/.test(v) && !/-/.test(v) ? { time: v } : { datetime: v });
    case 'fan':
      if (OFF(v)) return c('turn_off');
      if (isNum(v)) return num(v) <= 0 ? c('turn_off') : c('set_percentage', { percentage: Math.round(num(v)) });
      if (ON(v)) return c('turn_on');
      return c('set_preset_mode', { preset_mode: v });
    case 'light':
      if (OFF(v) || (isNum(v) && num(v) <= 0)) return c('turn_off');
      if (isNum(v)) return c('turn_on', { brightness_pct: Math.round(num(v)) });
      return c('turn_on');
    case 'climate':
      if (isNum(v)) return c('set_temperature', { temperature: num(v) });
      if (OFF(v)) return c('turn_off');
      return (s?.attributes.preset_modes ?? []).includes(v) ? c('set_preset_mode', { preset_mode: v }) : c('set_hvac_mode', { hvac_mode: v });
    case 'water_heater': return isNum(v) ? c('set_temperature', { temperature: num(v) }) : c('set_operation_mode', { operation_mode: v });
    case 'humidifier': return isNum(v) ? c('set_humidity', { humidity: num(v) }) : OFF(v) ? c('turn_off') : ON(v) ? c('turn_on') : c('set_mode', { mode: v });
    case 'cover':
      if (isNum(v)) return c('set_cover_position', { position: Math.round(num(v)) });
      if (/stop/i.test(v)) return c('stop_cover');
      return ON(v) ? c('open_cover') : c('close_cover');
    case 'valve': return isNum(v) ? c('set_valve_position', { position: Math.round(num(v)) }) : ON(v) ? c('open_valve') : c('close_valve');
    case 'media_player':
      if (isNum(v)) return c('volume_set', { volume_level: Math.max(0, Math.min(1, num(v) / 100)) });
      if (OFF(v)) return c('turn_off');
      if (ON(v)) return c('turn_on');
      return c('select_source', { source: v });
    case 'lock': return /unlock|otw/i.test(v) ? c('unlock') : c('lock');
    case 'scene': case 'script': return c('turn_on');
    case 'button': case 'input_button': return c('press');
    case 'vacuum': return /dock|base|baza|powr/i.test(v) ? c('return_to_base') : c('start');
    default: return OFF(v) ? c('turn_off', undefined, 'homeassistant') : c('turn_on', undefined, 'homeassistant');
  }
}

export async function setEntityValue(entity: string, value: string) {
  const sc = serviceFor(entity, value);
  return hass.call(sc.domain, sc.service, sc.data, entity);
}

export async function runSteps(steps: SetStep[]) {
  for (const s of steps) if (s.entity) await setEntityValue(s.entity, s.value);
}

/** Is the entity currently at this value? (for highlighting the active preset) */
export function matchesValue(s: HassState | undefined, value: string): boolean {
  if (!s) return false;
  const d = domainOf(s.entity_id), v = String(value ?? '').trim(), a = s.attributes;
  const near = (x: unknown, tol = 0.6) => isFinite(Number(x)) && Math.abs(Number(x) - num(v)) <= tol;
  if (OFF(v)) return s.state === 'off' || s.state === 'closed' || (isNum(v) && near(s.state));
  if (isNum(v)) {
    switch (d) {
      case 'fan': return s.state === 'on' && near(a.percentage, 1);
      case 'light': return s.state === 'on' && near(Math.round(((a.brightness ?? 255) / 255) * 100), 2);
      case 'climate': case 'water_heater': return near(a.temperature, 0.05);
      case 'humidifier': return near(a.humidity, 0.5);
      case 'cover': case 'valve': return near(a.current_position ?? a.current_valve_position, 1);
      case 'media_player': return near((a.volume_level ?? -1) * 100, 1);
      default: return near(s.state, 0.05);
    }
  }
  if (ON(v)) return ['on', 'open', 'unlocked', 'playing', 'heat', 'cool'].includes(s.state);
  if (d === 'fan') return a.preset_mode === v;
  if (d === 'climate') return s.state === v || a.preset_mode === v;
  if (d === 'media_player') return a.source === v;
  return s.state === v;
}
