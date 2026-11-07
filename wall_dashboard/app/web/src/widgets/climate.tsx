// Thermostat / air-conditioner widget.
// Works with one `climate.*` (or `water_heater.*`) entity, with a set of separate entities
// (sensor + number + select + switch …), or with a mix: every role can be overridden.
import { useEffect, useLayoutEffect, useRef, useState, type FC } from 'react';
import type { HassState, WidgetDef } from '../../../shared/types';
import type { ClimateFeature, ClimateOptions, ClimateRef, ClimateRole, ModeKind, ModeOption } from '../../../shared/types';
import { shortNames } from './devices';
import { hass, useEntities } from '../lib/hass';
import { domainOf, formatNumber, friendly } from '../lib/format';
import type { ActionCtx } from '../lib/actions';
import { Icon } from '../ui/Icon';
import { GrentonScheduleButton } from './grentonSchedule';
import { renderTemplate } from '../lib/template';

// ---------------------------------------------------------------- roles
export const ROLE_LABEL: Record<ClimateRole, string> = {
  current: 'Temperatura aktualna', humidity: 'Wilgotność', target: 'Nastawa', mode: 'Tryb', action: 'Czy pracuje',
  power: 'Zasilanie', fan: 'Wentylator', swing: 'Lamele / nawiew', preset: 'Preset',
  nextTime: 'Następny punkt – godzina', nextTarget: 'Następny punkt – temperatura', overrideTarget: 'Nastawa tymczasowa'
};
export const ROLES = Object.keys(ROLE_LABEL) as ClimateRole[];

/** Attribute used for a role when the role points at a climate / water_heater entity. */
const CLIMATE_ATTR: Partial<Record<ClimateRole, string>> = {
  current: 'current_temperature', humidity: 'current_humidity', target: 'temperature', action: 'hvac_action',
  fan: 'fan_mode', swing: 'swing_mode', preset: 'preset_mode'
};
const WH_ATTR: Partial<Record<ClimateRole, string>> = { current: 'current_temperature', target: 'temperature' };
const BASE_ROLES: ClimateRole[] = ['current', 'humidity', 'target', 'mode', 'action', 'fan', 'swing', 'preset', 'power'];

const isClimateLike = (e?: string) => ['climate', 'water_heater'].includes(domainOf(e));

/** Effective roles: explicit roles win, the rest come from the base climate entity. */
export function resolveRoles(w: { entity?: string; options?: ClimateOptions }): Partial<Record<ClimateRole, ClimateRef>> {
  const o = w.options || {};
  const out: Partial<Record<ClimateRole, ClimateRef>> = {};
  const base = (o.source ?? 'climate') === 'climate' && isClimateLike(w.entity) ? w.entity : undefined;
  if (base) for (const r of BASE_ROLES) {
    if (domainOf(base) === 'water_heater' && !['current', 'target', 'mode', 'power'].includes(r)) continue;
    out[r] = { entity: base };
  }
  for (const [r, ref] of Object.entries(o.roles || {}) as [ClimateRole, ClimateRef | undefined][]) {
    if (ref?.entity) out[r] = ref;
  }
  return out;
}

function attrFor(role: ClimateRole, ref: ClimateRef): string | undefined {
  if (ref.attribute) return ref.attribute === 'state' ? undefined : ref.attribute;
  const d = domainOf(ref.entity);
  if (d === 'climate') return CLIMATE_ATTR[role];
  if (d === 'water_heater') return WH_ATTR[role];
  return undefined;
}

function readRaw(role: ClimateRole, ref?: ClimateRef, s?: HassState): unknown {
  if (!ref || !s) return undefined;
  const a = attrFor(role, ref);
  return a ? s.attributes[a] : s.state;
}
const toNum = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : NaN; };
const ON = new Set(['on', 'true', '1', 'yes', 'open', 'heat', 'cool', 'auto', 'dry', 'fan_only', 'heat_cool', 'heating', 'cooling', 'drying', 'running', 'active']);

// ---------------------------------------------------------------- modes
const VALUE_LABEL: Record<string, string> = {
  off: 'Wył.', on: 'Wł.', heat: 'Grzanie', cool: 'Chłodzenie', auto: 'Auto', heat_cool: 'Auto', dry: 'Osuszanie', fan_only: 'Wentylator',
  manual: 'Ręczny', schedule: 'Harmonogram', eco: 'Eko', comfort: 'Komfort', away: 'Poza domem', boost: 'Boost', home: 'W domu',
  sleep: 'Sen', activity: 'Aktywność', none: 'Brak', low: 'Niski', medium: 'Średni', middle: 'Średni', high: 'Wysoki', quiet: 'Cichy',
  turbo: 'Turbo', silent: 'Cichy', strong: 'Mocny', vertical: 'Pion', horizontal: 'Poziom', both: 'Oba', swing: 'Ruch'
};
const KIND_LABEL: Record<ModeKind, string> = {
  manual: 'Ręczny', schedule: 'Harmonogram', off: 'Wył.', heat: 'Grzanie', cool: 'Chłodzenie', auto: 'Auto', dry: 'Osuszanie',
  fan: 'Wentylator', eco: 'Eko', comfort: 'Komfort', away: 'Poza domem', boost: 'Boost', other: ''
};
export const KIND_ICON: Record<ModeKind, string> = {
  manual: 'hand', schedule: 'schedule', off: 'power', heat: 'flame', cool: 'snow', auto: 'auto',
  dry: 'droplet', fan: 'fan', eco: 'leaf', comfort: 'sun', away: 'away', boost: 'bolt', other: 'dot'
};
export const MODE_KINDS = Object.keys(KIND_LABEL) as ModeKind[];

export function inferKind(value: string, kind: 'thermostat' | 'ac' = 'thermostat'): ModeKind {
  const v = value.toLowerCase();
  if (/^(off|wył\.?|wyl|wyłącz\w*|wylacz\w*|disabled?|stop|false|0|standby)$/.test(v)) return 'off';
  if (v === 'heat_cool') return 'auto';
  if (v === 'auto') return kind === 'thermostat' ? 'schedule' : 'auto';
  if (/sched|harmon|program|plan|week|tydz|time|zegar/.test(v)) return 'schedule';
  if (/manu|ręcz|recz|hand|perm|const|stał|stal|hold/.test(v)) return 'manual';
  if (/heat|grz/.test(v)) return 'heat';
  if (/cool|chłod|chlod/.test(v)) return 'cool';
  if (/dry|osusz/.test(v)) return 'dry';
  if (/fan|went/.test(v)) return 'fan';
  if (/eco|ekon|oszcz/.test(v)) return 'eco';
  if (/comf|komf/.test(v)) return 'comfort';
  if (/away|urlop|vacat|holiday|frost|antifr|mróz|mroz/.test(v)) return 'away';
  if (/boost|turbo|party/.test(v)) return 'boost';
  if (/^(on|wł\.?|wl|true|1)$/.test(v)) return 'manual';
  return 'other';
}

interface Mode { value: string; label: string; kind: ModeKind; icon: string }

/** Values offered by the entity behind a role (select options, hvac_modes, on/off …). */
export function entityOptions(role: ClimateRole, ref?: ClimateRef, s?: HassState): string[] {
  if (!ref || !s) return [];
  const d = domainOf(ref.entity), a = s.attributes;
  if (d === 'climate' && !ref.attribute) {
    if (role === 'mode') return a.hvac_modes ?? [];
    if (role === 'fan') return a.fan_modes ?? [];
    if (role === 'swing') return a.swing_modes ?? [];
    if (role === 'preset') return a.preset_modes ?? [];
  }
  if (d === 'water_heater' && role === 'mode') return a.operation_list ?? [];
  if (d === 'select' || d === 'input_select') return a.options ?? [];
  if (['switch', 'input_boolean', 'light', 'fan', 'siren'].includes(d)) return ['on', 'off'];
  return [];
}

function buildModes(list: ModeOption[] | string[] | undefined, fromEntity: string[], kind: 'thermostat' | 'ac'): Mode[] {
  const conf = (list || []).map((m) => (typeof m === 'string' ? { value: m } : m) as ModeOption);
  const src: ModeOption[] = conf.length ? conf : fromEntity.map((value) => ({ value }));
  return src.filter((m) => m && m.value != null && !m.hidden).map((m) => {
    const k = m.kind || inferKind(String(m.value), kind);
    return { value: String(m.value), kind: k, label: m.label || (['schedule', 'manual', 'off'].includes(k) ? KIND_LABEL[k] : VALUE_LABEL[String(m.value)] || KIND_LABEL[k]) || String(m.value), icon: m.icon || KIND_ICON[k] };
  });
}

// ---------------------------------------------------------------- writing
export async function writeRole(role: ClimateRole, ref: ClimateRef, value: string | number | boolean) {
  const e = ref.entity, d = domainOf(e);
  if (ref.service) {
    const [dom, svc] = ref.service.split('.');
    const key = ref.serviceField || 'value';
    return hass.call(dom, svc, dom === 'script' ? { variables: { [key]: value } } : { [key]: value }, e);
  }
  if (d === 'climate') {
    switch (role) {
      case 'target': case 'overrideTarget': return hass.call('climate', 'set_temperature', { temperature: Number(value) }, e);
      case 'mode': return hass.call('climate', 'set_hvac_mode', { hvac_mode: String(value) }, e);
      case 'fan': return hass.call('climate', 'set_fan_mode', { fan_mode: String(value) }, e);
      case 'swing': return hass.call('climate', 'set_swing_mode', { swing_mode: String(value) }, e);
      case 'preset': return hass.call('climate', 'set_preset_mode', { preset_mode: String(value) }, e);
      case 'power': return hass.call('climate', value ? 'turn_on' : 'turn_off', undefined, e);
    }
  }
  if (d === 'water_heater') {
    if (role === 'mode') return hass.call('water_heater', 'set_operation_mode', { operation_mode: String(value) }, e);
    if (role === 'power') return hass.call('water_heater', value ? 'turn_on' : 'turn_off', undefined, e);
    return hass.call('water_heater', 'set_temperature', { temperature: Number(value) }, e);
  }
  if (d === 'number' || d === 'input_number') return hass.call(d, 'set_value', { value: Number(value) }, e);
  if (d === 'select' || d === 'input_select') return hass.call(d, 'select_option', { option: String(value) }, e);
  if (d === 'input_text' || d === 'text') return hass.call(d, 'set_value', { value: String(value) }, e);
  if (['switch', 'input_boolean', 'light', 'fan', 'siren', 'humidifier'].includes(d)) {
    const on = typeof value === 'boolean' ? value : ON.has(String(value).toLowerCase());
    return hass.call(d, on ? 'turn_on' : 'turn_off', undefined, e);
  }
  if (d === 'script') return hass.call('script', 'turn_on', { variables: { value } }, e);
  throw new Error(`Nie umiem zapisać „${ROLE_LABEL[role]}” do ${e} — ustaw usługę w roli`);
}

// ---------------------------------------------------------------- the model used by every layout
const lastMode = new Map<string, string>();

function useClimate(w: WidgetDef, notify: (m: string) => void) {
  const o = (w.options || {}) as ClimateOptions;
  const kind = o.kind ?? 'thermostat';
  const roles = resolveRoles(w);
  const extras = (o.extras || []).filter((x) => x?.entity);
  const ids = [...new Set([...Object.values(roles).map((r) => r!.entity), ...extras.map((x) => x.entity)])];
  const states = useEntities(ids);
  const st = (ref?: ClimateRef) => (ref ? states[ids.indexOf(ref.entity)] : undefined);
  const raw = (r: ClimateRole) => readRaw(r, roles[r], st(roles[r]));

  const current = toNum(raw('current'));
  const humidity = toNum(raw('humidity'));
  const targetS = st(roles.target);
  const target = toNum(raw('target'));

  // limits
  const ta = targetS?.attributes || {};
  const isCl = isClimateLike(roles.target?.entity);
  const step = Number(o.step ?? (isCl ? ta.target_temp_step : ta.step) ?? 0.5) || 0.5;
  const min = Number(o.min ?? (isCl ? ta.min_temp : ta.min) ?? 5);
  const max = Number(o.max ?? (isCl ? ta.max_temp : ta.max) ?? 35);

  // modes
  const modeVal = raw('mode') == null ? undefined : String(raw('mode'));
  const modes = buildModes(o.modes, entityOptions('mode', roles.mode, st(roles.mode)), kind);
  const fanModes = buildModes(o.fanModes, entityOptions('fan', roles.fan, st(roles.fan)), kind);
  const swingModes = buildModes(o.swingModes, entityOptions('swing', roles.swing, st(roles.swing)), kind);
  const presetModes = buildModes(o.presetModes, entityOptions('preset', roles.preset, st(roles.preset)), kind);
  const mode: Mode | undefined = modeVal == null ? undefined
    : modes.find((m) => m.value === modeVal) ?? buildModes([{ value: modeVal }], [], kind)[0];
  if (mode && mode.kind !== 'off') lastMode.set(w.id, mode.value);

  // power: explicit role, climate base (state != off) or "off" mode
  const powerRef = roles.power;
  const powerS = st(powerRef);
  const hasPowerRole = !!powerRef && (!isClimateLike(powerRef.entity) || !!o.roles?.power?.entity || kind === 'ac');
  const powered = powerRef && powerS
    ? (isClimateLike(powerRef.entity) && !powerRef.attribute ? powerS.state !== 'off' : ON.has(String(readRaw('power', powerRef, powerS)).toLowerCase()))
    : true;
  const off = !powered || mode?.kind === 'off';
  const schedule = !off && mode?.kind === 'schedule';

  // working indicator
  const actRaw = raw('action');
  let active: boolean | undefined, actionLabel = '';
  if (roles.action && actRaw != null) {
    const v = String(actRaw).toLowerCase();
    const list = (o.activeStates || []).map((x) => x.toLowerCase());
    active = list.length ? list.includes(v) : ON.has(v) || toNum(v) > 0;
    const CL: Record<string, string> = { heating: 'Grzeje', cooling: 'Chłodzi', drying: 'Osusza', fan: 'Nawiew', idle: 'Bezczynny', off: 'Wył.', preheating: 'Rozgrzewa', defrosting: 'Odszrania' };
    actionLabel = CL[v] ?? '';
  } else if (o.inferAction !== false && !off && isFinite(current) && isFinite(target)) {
    const k = mode?.kind;
    if (kind === 'ac' && k === 'cool') active = current > target + 0.2;
    else if (kind === 'ac' && k !== 'heat') active = undefined;
    else active = target > current + 0.05;
  }
  if (!actionLabel && active != null) {
    actionLabel = !active ? 'Bezczynny' : kind === 'ac'
      ? (mode?.kind === 'cool' ? 'Chłodzi' : mode?.kind === 'heat' ? 'Grzeje' : mode?.kind === 'dry' ? 'Osusza' : 'Pracuje')
      : 'Grzeje';
  }
  const hot = kind === 'ac' ? mode?.kind === 'heat' : true;

  // next schedule point
  const nTime = raw('nextTime'), nTarget = toNum(raw('nextTarget'));
  let next = '';
  if (nTime != null && nTime !== '' && nTime !== 'unknown') next = 'do ' + fmtTime(String(nTime));
  if (isFinite(nTarget)) next += (next ? ', potem ' : 'potem ') + fmtT(nTarget, o.decimals);

  // extras
  const extraText = extras.map((x) => {
    const s = st(x);
    if (!s) return '';
    const v = x.attribute ? s.attributes[x.attribute] : s.state;
    const n = toNum(v);
    const val = isFinite(n) ? formatNumber(n, x.decimals) : String(v ?? '—');
    const unit = x.unit ?? (x.attribute ? '' : s.attributes.unit_of_measurement ?? '');
    return `${x.label ? x.label + ' ' : ''}${val}${unit === '°C' ? '°' : unit === '%' ? '%' : unit ? ' ' + unit : ''}`;
  }).filter(Boolean).join(' · ');

  // ---- target changes (debounced)
  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<number>(), clearT = useRef<number>();
  const pendingRef = useRef<number | null>(null);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(clearT.current); }, []);
  useEffect(() => { if (pending != null && isFinite(target) && Math.abs(target - pending) < 1e-6) { setPending(null); pendingRef.current = null; } }, [target, pending]);

  const scheduleBehavior = o.scheduleBehavior ?? 'switch';
  const offBehavior = o.offBehavior ?? 'lock';
  const canAdjust = !!roles.target && (off ? offBehavior !== 'lock' : schedule ? scheduleBehavior !== 'lock' : true);

  const manualValue = () => {
    if (o.manualMode) return o.manualMode;
    const remembered = lastMode.get(w.id);
    const prefer: ModeKind[] = kind === 'ac' ? ['cool', 'heat', 'auto', 'manual'] : ['manual', 'heat', 'comfort', 'other'];
    for (const k of prefer) { const m = modes.find((x) => x.kind === k); if (m) return m.value; }
    return remembered && modes.find((m) => m.value === remembered && m.kind !== 'schedule') ? remembered : undefined;
  };

  const run = async (fn: () => Promise<void> | void) => { try { await fn(); } catch (e: any) { notify(e?.message || 'Nie udało się'); } };

  const turnOn = async () => {
    if (powerRef && !powered) { await writeRole('power', powerRef, true); return; }
    if (roles.mode) {
      const v = (kind === 'ac' && lastMode.get(w.id)) || manualValue();
      if (v) await writeRole('mode', roles.mode, v);
    }
  };
  const turnOff = async () => {
    if (hasPowerRole && powerRef) { await writeRole('power', powerRef, false); return; }
    const offMode = modes.find((m) => m.kind === 'off')?.value ?? (roles.mode && entityOptions('mode', roles.mode, st(roles.mode)).includes('off') ? 'off' : undefined);
    if (offMode && roles.mode) await writeRole('mode', roles.mode, offMode);
    else if (powerRef) await writeRole('power', powerRef, false);
  };

  const commit = (value: number) => run(async () => {
    if (off) {
      if (offBehavior === 'lock') return;
      await turnOn();
    } else if (schedule) {
      if (scheduleBehavior === 'switch') {
        const v = manualValue();
        if (v && roles.mode) await writeRole('mode', roles.mode, v);
      } else if (scheduleBehavior === 'override' && roles.overrideTarget) {
        await writeRole('overrideTarget', roles.overrideTarget, value);
        return;
      }
    }
    await writeRole('target', roles.target!, value);
    clearTimeout(clearT.current);
    clearT.current = window.setTimeout(() => { setPending(null); pendingRef.current = null; }, 4000);
  });

  const nudge = (dir: 1 | -1) => {
    if (!canAdjust) return;
    const baseV = pendingRef.current ?? (isFinite(target) ? target : (min + max) / 2);
    const v = Math.min(max, Math.max(min, Math.round((baseV + dir * step) / step) * step));
    const val = +v.toFixed(2);
    pendingRef.current = val; setPending(val);
    clearTimeout(timer.current); clearTimeout(clearT.current);
    timer.current = window.setTimeout(() => commit(val), Math.max(0, o.debounce ?? 900));
  };

  const setMode = (m: Mode) => run(async () => {
    if (m.kind === 'off') return turnOff();
    if (powerRef && !powered && hasPowerRole) await writeRole('power', powerRef, true);
    if (roles.mode) await writeRole('mode', roles.mode, m.value);
  });
  const cycle = (list: Mode[], cur: string | undefined, role: ClimateRole) => {
    if (!list.length || !roles[role]) return;
    const i = list.findIndex((m) => m.value === cur);
    const nx = list[(i + 1) % list.length];
    if (role === 'mode') return setMode(nx);
    return run(() => writeRole(role, roles[role]!, nx.value));
  };
  const setOpt = (role: ClimateRole, m: Mode) => run(() => writeRole(role, roles[role]!, m.value));
  const togglePower = () => run(() => (off ? turnOn() : turnOff()));

  const showPower = o.showPower ?? (kind === 'ac' && (!!powerRef || modes.some((m) => m.kind === 'off')));
  const curOf = (r: ClimateRole) => { const v = raw(r); return v == null ? undefined : String(v); };

  return {
    o, kind, roles, ids, title: renderTemplate(w.title) || friendly(st(roles.target ?? roles.current ?? roles.mode), w.entity || ''),
    current, humidity, target: pending ?? target, pending: pending != null, step, min, max,
    modes, mode, fanModes, swingModes, presetModes, fan: curOf('fan'), swing: curOf('swing'), preset: curOf('preset'),
    off, schedule, active, actionLabel, hot, next, extraText, canAdjust, showPower,
    nudge, setMode, cycle, setOpt, togglePower, missing: ids.length === 0, unknown: ids.length > 0 && states.every((s) => !s)
  };
}

const fmtT = (n: number, d?: number) => (isFinite(n) ? formatNumber(n, d ?? 1) + '°' : '—');
function fmtTime(v: string) {
  if (/^\d{1,2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const today = new Date().toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return today ? hm : d.toLocaleDateString('pl-PL', { weekday: 'short' }) + ' ' + hm;
}

// ---------------------------------------------------------------- layouts
type Layout = 'small' | 'medium' | 'large' | 'bar';
function autoLayout(wd: number, ht: number): Layout {
  if (ht < 96) return wd >= 240 ? 'bar' : 'small';
  if (wd < 220) return 'small';
  if (ht < 210) return 'medium';
  return 'large';
}

export const ClimateWidget: FC<{ w: WidgetDef; ctx?: ActionCtx; forceLayout?: Layout }> = ({ w, ctx, forceLayout }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([300, 300]);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement; if (!el) return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const c = useClimate(w, (m) => (ctx ? ctx.notify(m) : console.warn(m)));
  const o = c.o;
  const layout: Layout = forceLayout ?? (o.layout && o.layout !== 'auto' ? o.layout : autoLayout(size[0], size[1]));
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (c.missing) return <div ref={ref} className="w-center w-sub">Wybierz encję climate lub przypisz role</div>;

  const color = c.off ? 'var(--muted)' : c.hot ? '#FFB45A' : 'var(--cool)';
  const headIcon = w.icon || (c.kind === 'ac'
    ? (c.mode ? (c.mode.kind === 'off' || c.mode.kind === 'other' || c.mode.kind === 'manual' ? 'ac' : c.mode.icon) : 'ac')
    : (c.active ? 'flame' : 'thermometer'));
  const hideTitle = !!w.style?.hideTitle;
  const showHum = o.showHumidity !== false && isFinite(c.humidity);
  const showChip = o.showAction !== false && c.actionLabel && (c.active || o.showIdle);
  const nextVisible = c.next && (o.showNext ?? 'schedule') !== 'never' && ((o.showNext ?? 'schedule') === 'always' || c.schedule);
  const targetLabel = c.off ? 'Wyłączony' : c.schedule ? (o.scheduleBehavior === 'override' && c.pending ? 'Tymczasowo' : 'Wg harmonogramu') : (o.targetLabel || 'Nastawa');
  const modeCtl = o.modeControl ?? 'auto';
  const gsEntity = o.grentonSchedule === false ? undefined : (w.entity || c.roles.target?.entity);
  const gs = (compact?: boolean) => <GrentonScheduleButton entity={gsEntity} title={c.title} compact={compact} notify={(m) => ctx?.notify?.(m)} />;

  const stepper = (big?: boolean) => (
    <div className={'cl-step' + (big ? ' big' : '')}>
      <button className="cl-pm" disabled={!c.canAdjust} aria-label="Obniż temperaturę" onClick={() => c.nudge(-1)}><Icon name="minus" size={big ? 24 : 20} /></button>
      <div className={'cl-target' + (c.pending ? ' pending' : '')}>
        {big && <small>{targetLabel}</small>}
        <span>{c.off ? '—' : fmtT(c.target, o.decimals)}</span>
      </div>
      <button className="cl-pm" disabled={!c.canAdjust} aria-label="Podnieś temperaturę" onClick={() => c.nudge(1)}><Icon name="plus" size={big ? 24 : 20} /></button>
    </div>
  );
  const modeCycle = () => c.modes.length > 0 && modeCtl !== 'hidden' ? (
    <button className="cl-cyc" onClick={() => c.cycle(c.modes, c.mode?.value, 'mode')} aria-label={'Tryb: ' + (c.mode?.label ?? '') + '. Zmień'}>
      <Icon name={c.mode?.icon ?? 'dot'} size={18} />{layout !== 'bar' && <span>{c.mode?.label ?? '—'}</span>}
    </button>
  ) : null;
  const power = () => c.showPower ? (
    <button className={'cl-pow' + (c.off ? '' : ' on')} onClick={c.togglePower} aria-label={c.off ? 'Włącz' : 'Wyłącz'}><Icon name="power" size={18} /></button>
  ) : null;
  const chips = (list: Mode[], cur: string | undefined, role: ClimateRole, label: string) => list.length ? (
    <div className="cl-chips" role="group" aria-label={label}>
      {list.map((m) => (
        <button key={m.value} className="cl-chip" aria-pressed={cur === m.value} onClick={() => (role === 'mode' ? c.setMode(m) : c.setOpt(role, m))}>
          {o.modeIcons !== false && <Icon name={m.icon} size={16} />}<span>{m.label}</span>
        </button>
      ))}
    </div>
  ) : null;

  // ---- small: read-only summary, tap = panel / cycle / power
  if (layout === 'small') {
    const tap = o.smallTap ?? 'panel';
    const onTap = () => {
      if (tap === 'cycle') c.cycle(c.modes, c.mode?.value, 'mode');
      else if (tap === 'power') c.togglePower();
      else if (tap === 'panel' && ctx) ctx.openPanel({ title: c.title, rows: [], widget: { ...w, options: { ...o, layout: 'large' } } }, w);
    };
    return (
      <div ref={ref} className={'cl cl-small' + (c.off ? ' is-off' : '')} role={tap !== 'none' ? 'button' : undefined} tabIndex={tap !== 'none' ? 0 : undefined}
        onClick={onTap} onKeyDown={(e) => { if (e.key === 'Enter') onTap(); }} onPointerDown={stop}>
        <div className="cl-row"><span style={{ color }}><Icon name={headIcon} size={20} /></span>{c.mode && <span className="cl-dim"><Icon name={c.mode.icon} size={16} /></span>}</div>
        <div>
          <div className="cl-cur">{fmtT(c.current, o.decimals)}</div>
          <div className="cl-sub">{c.off ? 'wył.' : '→ ' + fmtT(c.target, o.decimals)}{showHum && <> · {formatNumber(c.humidity, 0)}%</>}</div>
        </div>
        {!hideTitle && <div className="cl-name">{c.title}</div>}
      </div>
    );
  }

  // ---- bar: one row
  if (layout === 'bar') {
    return (
      <div ref={ref} className={'cl cl-bar' + (c.off ? ' is-off' : '')} onPointerDown={stop} onClick={stop}>
        <span style={{ color }}><Icon name={headIcon} size={20} /></span>
        {!hideTitle && <span className="cl-name grow">{c.title}</span>}
        <span className="cl-cur sm">{fmtT(c.current, o.decimals)}</span>
        {stepper()}
        {modeCycle()}
        {power()}
      </div>
    );
  }

  // ---- medium: temperature, stepper, mode cycle
  if (layout === 'medium') {
    return (
      <div ref={ref} className={'cl cl-medium' + (c.off ? ' is-off' : '')} onPointerDown={stop} onClick={stop}>
        <div className="cl-row">
          {!hideTitle ? <span className="cl-name">{c.title}</span> : <span />}
          <span className="cl-row gap">{showChip && <span className={'cl-badge' + (c.hot ? ' hot' : ' cold')}>{c.actionLabel}</span>}{power()}</span>
        </div>
        <div className="cl-row">
          <div className="cl-cur">{fmtT(c.current, o.decimals)}</div>
          {stepper()}
        </div>
        <div className="cl-row">
          <span className="cl-row gap">{modeCycle()}{gs(true)}
            {c.kind === 'ac' && o.showFan !== false && c.fanModes.length > 0 && (
              <button className="cl-cyc" onClick={() => c.cycle(c.fanModes, c.fan, 'fan')} aria-label="Wentylator. Zmień"><Icon name="fan" size={18} /><span>{c.fanModes.find((m) => m.value === c.fan)?.label ?? c.fan ?? '—'}</span></button>
            )}
          </span>
          {o.features?.length
            ? <ClimateFeatures compact features={o.features.filter((f) => f?.entity).slice(0, 4)} title={c.title} notify={(m) => ctx?.notify?.(m)} />
            : <span className="cl-sub">{nextVisible ? c.next : showHum ? formatNumber(c.humidity, 0) + '%' : ''}</span>}
        </div>
      </div>
    );
  }

  // ---- large: everything
  return (
    <div ref={ref} className={'cl cl-large' + (c.off ? ' is-off' : '')} onPointerDown={stop} onClick={stop}>
      <div className="cl-row">
        {!hideTitle ? <span className="cl-name"><span style={{ color }}><Icon name={headIcon} size={20} /></span> {c.title}</span> : <span />}
        <span className="cl-row gap">{showChip && <span className={'cl-badge' + (c.hot ? ' hot' : ' cold')}>{c.actionLabel}</span>}{power()}</span>
      </div>
      <div>
        <div className="cl-row start">
          <span className="cl-cur xl">{fmtT(c.current, o.decimals)}</span>
          {showHum && <span className="cl-dim"><Icon name="droplet" size={15} /> {formatNumber(c.humidity, 0)}%</span>}
        </div>
        {o.showExtras !== false && c.extraText && <div className="cl-sub">{c.extraText}</div>}
      </div>
      {stepper(true)}
      <div className="cl-sub center">{nextVisible ? c.next : ' '}</div>
      {modeCtl === 'cycle' ? modeCycle() :modeCtl !== 'hidden' && chips(c.modes, c.mode?.value, "mode", "Tryb")}
      {o.showFan !== false && c.roles.fan && (c.kind === 'ac' || o.showFan) && chips(c.fanModes, c.fan, "fan", "Wentylator")}
      {o.showSwing !== false && c.roles.swing && (c.kind === 'ac' || o.showSwing) && chips(c.swingModes, c.swing, "swing", "Lamele")}
      {o.showPreset && c.roles.preset && chips(c.presetModes, c.preset, "preset", "Preset")}
      {!!o.features?.length && <ClimateFeatures features={o.features.filter((f) => f?.entity)} title={c.title} notify={(m) => ctx?.notify?.(m)} />}
    </div>
  );
};

// ---------------------------------------------------------------- extra functions (ionizer, purification, sleep…)
const FEATURE_ICONS: [RegExp, string][] = [
  [/jon[io]z|ioni[sz]|plasma|plazm|nanoe|anion/i, 'mdi:atom-variant'], [/oczyszcz|purif|clean.?air|uv|steril|bakter|wirus|virus|health/i, 'mdi:air-purifier'],
  [/samoczyszcz|self.?clean|auto.?clean|dry.?clean|osusz/i, 'mdi:water-sync'], [/sleep|sen|noc|night/i, 'mdi:weather-night'],
  [/eco|oszcz/i, 'mdi:leaf'], [/turbo|boost|power(ful)?|moc/i, 'mdi:rocket-launch-outline'], [/quiet|cich|silent|mute/i, 'mdi:volume-off'],
  [/beep|dźwięk|dzwiek|sound|buzz/i, 'mdi:volume-high'], [/light|display|wyświetl|wyswietl|led|panel/i, 'mdi:lightbulb-outline'],
  [/filtr|filter/i, 'mdi:air-filter'], [/swing|lamel|nawiew/i, 'mdi:arrow-oscillating'], [/fresh|świeże|swieze|wentyl/i, 'mdi:weather-windy'],
  [/frost|8.?°|antifreeze|mróz|mroz/i, 'mdi:snowflake-alert'], [/heat|grzan/i, 'mdi:fire']
];
export const featureIcon = (text: string) => FEATURE_ICONS.find(([re]) => re.test(text))?.[1] ?? 'mdi:toggle-switch-outline';
const FEATURE_ON = new Set(['on', 'true', 'open', 'active']);

/** Buttons for the AC's extra functions: switches toggle, selects step to the next option, buttons press. */
const ClimateFeatures: FC<{ features: ClimateFeature[]; title?: string; notify(m: string): void; compact?: boolean }> = ({ features, title, notify, compact }) => {
  const states = useEntities(features.map((f) => f.entity));
  const names = shortNames(features.map((f, i) => friendly(states[i], f.entity)), title);
  const press = (f: ClimateFeature, s?: HassState) => {
    const d = domainOf(f.entity);
    let p: Promise<void>;
    if (d === 'select' || d === 'input_select') {
      const opts: string[] = s?.attributes.options ?? [];
      const next = opts[(opts.indexOf(s?.state ?? '') + 1) % Math.max(1, opts.length)];
      if (!next) return;
      p = hass.call(d, 'select_option', { option: next }, f.entity);
    } else if (d === 'button' || d === 'input_button') p = hass.call(d, 'press', undefined, f.entity);
    else if (d === 'script' || d === 'scene') p = hass.call(d, 'turn_on', undefined, f.entity);
    else p = hass.call(['switch', 'input_boolean', 'light', 'fan'].includes(d) ? d : 'homeassistant', 'toggle', undefined, f.entity);
    p.catch((e) => notify(e.message));
  };
  if (compact) return (
    <span className="cl-row gap cl-feats-c" role="group" aria-label="Funkcje dodatkowe">
      {features.map((f, i) => {
        const s = states[i]; const d = domainOf(f.entity); const isSel = d === 'select' || d === 'input_select';
        const on = !!s && !isSel && FEATURE_ON.has(String(s.state).toLowerCase());
        const label = f.label || names[i];
        return (
          <button key={f.entity} className="cl-cyc cl-feat" aria-pressed={isSel ? undefined : on} disabled={!s || s.state === 'unavailable'} onClick={() => press(f, s)}
            title={label} aria-label={`${label}: ${isSel ? s?.state : on ? 'włączone' : 'wyłączone'}`}>
            <Icon name={f.icon || featureIcon(label + ' ' + f.entity)} size={18} />{isSel && s ? <span>{s.state}</span> : null}
          </button>
        );
      })}
    </span>
  );
  return (
    <div className="cl-chips cl-feats" role="group" aria-label="Funkcje dodatkowe">
      {features.map((f, i) => {
        const s = states[i];
        const d = domainOf(f.entity);
        const isSel = d === 'select' || d === 'input_select';
        const on = !!s && !isSel && FEATURE_ON.has(String(s.state).toLowerCase());
        const label = f.label || names[i];
        const unavailable = !s || s.state === 'unavailable';
        return (
          <button key={f.entity} className="cl-chip" aria-pressed={isSel ? undefined : on} disabled={unavailable} onClick={() => press(f, s)}
            aria-label={`${label}: ${isSel ? s?.state : on ? 'włączone' : 'wyłączone'}`}>
            <Icon name={f.icon || featureIcon(label + ' ' + f.entity)} size={16} />
            <span>{label}{isSel && s ? ': ' + s.state : ''}</span>
          </button>
        );
      })}
    </div>
  );
};

/** Temperature of a room for labels / heat map: sensor, climate entity or thermostat role. */
export function roomTemperature(r: { temperature?: string; climate?: string; thermostat?: ClimateOptions },
  get: (id: string) => HassState | undefined = (id) => hass.states.get(id)): number {
  if (r.temperature) return toNum(get(r.temperature)?.state);
  if (r.thermostat) {
    const roles = resolveRoles({ entity: r.climate, options: r.thermostat });
    const ref = roles.current;
    if (ref) return toNum(readRaw('current', ref, get(ref.entity)));
  }
  if (r.climate) return toNum(get(r.climate)?.attributes.current_temperature);
  return NaN;
}

/** Heating / cooling state of a room for the chip colour. */
export function roomAction(r: { climate?: string; thermostat?: ClimateOptions }): 'heating' | 'cooling' | undefined {
  const roles = resolveRoles({ entity: r.climate, options: r.thermostat ?? { kind: 'thermostat' } });
  const ref = roles.action;
  if (!ref) return undefined;
  const v = String(readRaw('action', ref, hass.states.get(ref.entity)) ?? '').toLowerCase();
  if (v === 'cooling') return 'cooling';
  const list = (r.thermostat?.activeStates || []).map((x) => x.toLowerCase());
  if (v === 'heating' || (list.length ? list.includes(v) : (ON.has(v) && !['cool', 'cooling'].includes(v)) || toNum(v) > 0)) return 'heating';
  return undefined;
}

/** Widget shown in a room / AC panel. */
export function climatePanelWidget(id: string, entity: string | undefined, options: ClimateOptions | undefined, kind: 'thermostat' | 'ac'): WidgetDef {
  return { id: 'panel-' + id, type: 'climate', x: 0, y: 0, w: 8, h: 6, entity, options: { kind, ...(options || {}), layout: 'large' } };
}

/** State of an AC device on the 3D model (works for a climate entity and for composite roles). */
export function acVisual(entity: string | undefined, options: ClimateOptions | undefined, get: (id: string) => HassState | undefined): { on: boolean; heat: boolean; running: boolean } {
  const o: ClimateOptions = { kind: 'ac', ...(options || {}) };
  const roles = resolveRoles({ entity, options: o });
  const rd = (r: ClimateRole) => { const ref = roles[r]; return ref ? readRaw(r, ref, get(ref.entity)) : undefined; };
  const modeV = rd('mode') == null ? '' : String(rd('mode'));
  const conf = (o.modes || []).map((m) => (typeof m === 'string' ? { value: m } : m) as ModeOption).find((m) => m.value === modeV);
  const mk = modeV ? conf?.kind ?? inferKind(modeV, 'ac') : undefined;
  const p = roles.power, ps = p ? get(p.entity) : undefined;
  const powered = p && ps ? (isClimateLike(p.entity) && !p.attribute ? ps.state !== 'off' : ON.has(String(readRaw('power', p, ps)).toLowerCase())) : !!modeV;
  const on = powered && mk !== 'off';
  const act = String(rd('action') ?? '').toLowerCase();
  const running = on && (act ? ON.has(act) || toNum(act) > 0 : true);
  return { on, heat: mk === 'heat' || act === 'heating', running };
}
