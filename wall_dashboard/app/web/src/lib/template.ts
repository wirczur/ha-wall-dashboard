import { useEntities, hass } from './hass';
import { formatNumber, stateLabel } from './format';
import { TEMPLATE_RE, templateEntities } from '../../../shared/template';
import type { HassState } from '../../../shared/types';

export { templateEntities };

/** Renders "{sensor.x}° · {climate.y.temperature:1}" with current states. */
export function renderTemplate(text: string | undefined, get: (id: string) => HassState | undefined = (id) => hass.states.get(id)): string {
  if (!text || !text.includes('{')) return text ?? '';
  return text.replace(TEMPLATE_RE, (_all, id: string, attr?: string, dec?: string) => {
    const s = get(id);
    if (!s || s.state === 'unavailable' || s.state === 'unknown') return '—';
    const raw = attr ? s.attributes[attr] : s.state;
    if (raw == null) return '—';
    const n = Number(raw);
    if (dec != null && raw !== '' && isFinite(n)) return formatNumber(n, Number(dec));
    if (attr) return isFinite(n) && raw !== '' ? formatNumber(n) : String(raw);
    return stateLabel(s);
  });
}

/** Hook: re-renders when any entity used in the template changes. */
export function useTemplate(text?: string): string {
  useEntities(templateEntities(text));
  return renderTemplate(text);
}
