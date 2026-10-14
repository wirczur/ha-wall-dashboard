// Values for the Android app's dark-screen clock (temperature outside, alarm, missed doorbell calls…).
// Rendered nothing – it only hands short texts to window.wallApp.setSaverInfo when they change.
import { useEffect, type FC } from 'react';
import type { HassState, SaverClock } from '../../../shared/types';
import { domainOf, friendly, stateLabel } from '../lib/format';
import { useEntities } from '../lib/hass';
import { useCalls } from '../widgets/calls';

function iconOf(s?: HassState): string {
  if (!s) return '•';
  const d = domainOf(s.entity_id), dc = String(s.attributes.device_class ?? ''), u = String(s.attributes.unit_of_measurement ?? '');
  if (d === 'alarm_control_panel') return '🛡';
  if (d === 'lock') return '🔒';
  if (d === 'weather') return '☁';
  if (dc === 'temperature' || /°/.test(u)) return '🌡';
  if (dc === 'humidity') return '💧';
  if (dc === 'door' || dc === 'garage_door' || dc === 'opening') return '🚪';
  if (dc === 'window') return '🪟';
  if (dc === 'power' || dc === 'energy' || u === 'W' || u === 'kW') return '⚡';
  if (dc === 'battery') return '🔋';
  return '•';
}
const isWarn = (s?: HassState) => !!s && (s.state === 'triggered' || s.state === 'pending'
  || (domainOf(s.entity_id) === 'binary_sensor' && s.state === 'on' && /door|window|opening|garage_door|smoke|moisture|gas|problem/.test(String(s.attributes.device_class ?? '')))
  || (domainOf(s.entity_id) === 'lock' && s.state === 'unlocked'));

export const SaverFeed: FC<{ clock?: SaverClock }> = ({ clock }) => {
  const app = typeof window !== 'undefined' ? window.wallApp : undefined;
  const ents = (clock?.entities ?? []).map((e) => e.entity);
  const states = useEntities(ents);
  const calls = useCalls();
  const missed = clock?.calls ? (calls.data?.calls ?? []).filter((c) => c.status === 'missed' && !c.seen).length : 0;
  const items = (clock?.entities ?? []).map((e, i) => {
    const s = states[i];
    const label = e.label ?? '';
    return { icon: iconOf(s), text: (label ? label + ' ' : '') + (s ? stateLabel(s) : '—'), warn: isWarn(s), title: friendly(s, e.entity) };
  });
  if (missed > 0) items.push({ icon: '🔔', text: missed === 1 ? '1 nieodebrane' : `${missed} nieodebrane`, warn: true, title: 'Dzwonek' });
  const json = JSON.stringify(items);
  useEffect(() => { try { app?.setSaverInfo?.(json); } catch { /* old app */ } }, [app, json]);
  return null;
};
