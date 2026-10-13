import type { HassState } from '../../../shared/types';

export const domainOf = (entity?: string) => (entity ? entity.split('.')[0] : '');

const LABELS: Record<string, string> = {
  on: 'wł.', off: 'wył.', open: 'otwarta', closed: 'zamknięta', opening: 'otwiera się', closing: 'zamyka się',
  locked: 'zamknięta', unlocked: 'otwarta', locking: 'zamyka się', unlocking: 'otwiera się', jammed: 'zablokowana',
  playing: 'gra', paused: 'pauza', idle: 'bezczynny', standby: 'czuwanie', buffering: 'buforuje',
  home: 'w domu', not_home: 'poza domem', heat: 'grzanie', cool: 'chłodzenie', auto: 'auto', dry: 'osuszanie',
  fan_only: 'wentylacja', heat_cool: 'grzanie/chłodzenie', heating: 'grzeje', cooling: 'chłodzi', drying: 'osusza',
  armed_home: 'uzbrojony (dom)', armed_away: 'uzbrojony', armed_night: 'uzbrojony (noc)', disarmed: 'rozbrojony',
  triggered: 'ALARM', pending: 'oczekuje', arming: 'uzbraja się',
  unavailable: 'niedostępne', unknown: '—', above_horizon: 'dzień', below_horizon: 'noc',
  cleaning: 'sprząta', docked: 'w stacji', returning: 'wraca'
};

export function stateLabel(s?: HassState, map?: Record<string, string>): string {
  if (!s) return '—';
  if (map && map[s.state] != null) return map[s.state];
  const unit = s.attributes.unit_of_measurement;
  const n = Number(s.state);
  if (s.state !== '' && isFinite(n) && domainOf(s.entity_id) !== 'input_boolean') {
    return formatNumber(n) + (unit ? (unit === '%' ? '%' : ' ' + unit) : '');
  }
  const dc = s.attributes.device_class;
  if (domainOf(s.entity_id) === 'binary_sensor') {
    if (dc === 'door' || dc === 'window' || dc === 'garage_door' || dc === 'opening') return s.state === 'on' ? 'otwarte' : 'zamknięte';
    if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') return s.state === 'on' ? 'wykryto' : 'brak';
  }
  if (dc === 'timestamp' || dc === 'date') return formatDate(s.state);
  return LABELS[s.state] ?? s.state;
}

export function formatNumber(n: number, decimals?: number) {
  const d = decimals ?? (Math.abs(n) >= 100 || Number.isInteger(n) ? 0 : 1);
  return n.toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function formatDate(v: string) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });
}

const ACTIVE = new Set(['on', 'open', 'opening', 'unlocked', 'playing', 'home', 'heat', 'cool', 'auto', 'dry', 'fan_only', 'heat_cool', 'cleaning', 'triggered', 'armed_away', 'armed_home', 'armed_night']);
export const isActive = (s?: HassState) => !!s && ACTIVE.has(s.state);

export const friendly = (s?: HassState, fallback = '') => (s?.attributes.friendly_name as string) || fallback;
