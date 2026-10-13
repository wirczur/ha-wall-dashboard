// Levels: a row of big buttons (e.g. ventilation 1–4 with mdi:fan-speed-1…4) for fan / select / number entities.
import { useState, type FC } from 'react';
import type { HassState, WidgetDef } from '../../../shared/types';
import { domainOf, friendly } from '../lib/format';
import { useEntity } from '../lib/hass';
import { matchesValue, setEntityValue } from '../lib/setValue';
import { Icon } from '../ui/Icon';

export interface LevelDef { value: string; label?: string; icon?: string }

const fanIcon = (i: number) => (i >= 1 && i <= 4 ? 'mdi:fan-speed-' + i : 'fan');

/** Levels taken from the entity when none are configured. */
export function autoLevels(s: HassState | undefined, count?: number): LevelDef[] {
  if (!s) return [];
  const d = domainOf(s.entity_id), a = s.attributes;
  if (d === 'fan') {
    const presets: string[] = Array.isArray(a.preset_modes) ? a.preset_modes : [];
    if (!count && presets.length >= 2 && !a.percentage_step) return presets.map((p, i) => ({ value: p, label: p, icon: presets.length <= 4 ? fanIcon(i + 1) : undefined }));
    const n = count || (a.percentage_step ? Math.round(100 / Number(a.percentage_step)) : 4);
    return Array.from({ length: Math.min(10, Math.max(1, n)) }, (_, i) => ({ value: String(Math.round(((i + 1) * 100) / n)), label: String(i + 1), icon: n <= 4 ? fanIcon(i + 1) : undefined }));
  }
  if (d === 'select' || d === 'input_select') {
    const opts: string[] = Array.isArray(a.options) ? a.options : [];
    return opts.map((o, i) => ({ value: o, label: o, icon: opts.length <= 4 && /^\d$/.test(o) ? fanIcon(Number(o)) : opts.length <= 4 ? fanIcon(i + 1) : undefined }));
  }
  if (d === 'number' || d === 'input_number') {
    const min = Number(a.min ?? 0), max = Number(a.max ?? 4), step = Number(a.step ?? 1);
    const n = count || ((max - min) / step + 1 <= 6 ? Math.round((max - min) / step) + 1 : 4);
    return Array.from({ length: n }, (_, i) => {
      const v = n === 1 ? max : min + ((max - min) * i) / (n - 1);
      const val = String(Math.round(v / step) * step);
      return { value: val, label: val, icon: Number(val) >= 1 && Number(val) <= 4 && Number.isInteger(Number(val)) ? fanIcon(Number(val)) : undefined };
    });
  }
  return [{ value: 'off', label: 'Wył.', icon: 'power' }, { value: 'on', label: 'Wł.', icon: 'power' }];
}

export const Levels: FC<{ entity: string; levels?: LevelDef[]; count?: number; off?: boolean; compact?: boolean; onError?(m: string): void }> =
  ({ entity, levels, count, off, compact, onError }) => {
    const s = useEntity(entity);
    const [busy, setBusy] = useState<string | null>(null);
    const list = levels?.length ? levels : autoLevels(s, count);
    if (!s) return <div className="lv-miss">Brak encji {entity || '—'}</div>;
    const isOff = ['off', 'unavailable'].includes(s.state);
    const pick = (v: string) => {
      setBusy(v); navigator.vibrate?.(10);
      setEntityValue(entity, v).catch((e) => onError?.(e.message)).finally(() => setTimeout(() => setBusy(null), 600));
    };
    const all = off ? [{ value: 'off', label: 'Wył.', icon: domainOf(entity) === 'fan' ? 'mdi:fan-off' : 'power' }, ...list] : list;
    return (
      <div className={'lv' + (compact ? ' compact' : '')} role="group" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        {all.map((l) => {
          const active = l.value === 'off' ? isOff : !isOff && matchesValue(s, l.value);
          return (
            <button key={l.value} className={'lv-b' + (active ? ' on' : '') + (busy === l.value ? ' busy' : '')} aria-pressed={active} onClick={() => pick(l.value)} aria-label={l.label ?? l.value}>
              {l.icon && <Icon name={l.icon} size={compact ? 22 : 30} />}
              {(l.label ?? l.value) && !(compact && l.value === 'off' && l.icon) && <span>{l.label ?? l.value}</span>}
            </button>
          );
        })}
      </div>
    );
  };

export const LevelsWidget: FC<{ w: WidgetDef; notify?(m: string): void }> = ({ w, notify }) => {
  const s = useEntity(w.entity);
  const o = w.options ?? {};
  const levels: LevelDef[] | undefined = Array.isArray(o.levels) && o.levels.length ? o.levels : undefined;
  const list = levels ?? autoLevels(s, o.count);
  const cur = s && !['off', 'unavailable'].includes(s.state) ? list.find((l) => matchesValue(s, l.value)) : undefined;
  return (
    <div className="lvw">
      {o.header !== false && (
        <div className="lvw-h">
          <Icon name={cur?.icon ?? w.icon ?? 'fan'} size={20} />
          <b>{w.title || friendly(s, w.entity ?? '')}</b>
          <small>{!s ? '' : ['off'].includes(s.state) ? 'wyłączone' : cur ? 'poziom ' + (cur.label ?? cur.value) : s.attributes.percentage != null ? s.attributes.percentage + '%' : s.state}</small>
        </div>
      )}
      <Levels entity={w.entity ?? ''} levels={levels} count={o.count} off={o.off} compact={w.h <= 2} onError={notify} />
    </div>
  );
};
