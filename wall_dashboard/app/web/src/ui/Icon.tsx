import { useEffect, useState } from 'react';
import { domainOf } from '../lib/format';

// Built-in line icons (24×24, stroke). Any Material Design icon also works as "mdi:name" (loaded on demand).
export const ICONS: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>',
  gate: '<path d="M4 20V8M20 20V8M4 10h16M4 16h16M8 10v6M12 10v6M16 10v6"/>',
  garage: '<path d="M3 10l9-6 9 6v10H3zM7 13h10M7 16h10M7 19h10"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>',
  mute: '<path d="M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/>',
  volume: '<path d="M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  cam: '<path d="M3 8h11v8H3zM14 11l7-3v8l-7-3"/>',
  garden: '<path d="M12 21v-9M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 15c0-3-2-5-6-5 0 3 2 5 6 5z"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 2 3-4 7zM14 12c4 0 7 1 7 4 0 2-3 2-7-4zM12 14c0 4-1 7-4 7-2 0-2-3 4-7zM10 12c-4 0-7-1-7-4 0-2 3-2 7 4z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>',
  thermometer: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>',
  droplet: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 2 3 4 1-2 0-5 0-7z"/>',
  snow: '<path d="M12 2v20M4 6l16 12M20 6L4 18M9 3l3 3 3-3M9 21l3-3 3 3"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  tank: '<path d="M5 8h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 8V5h8v3M5 13h14"/>',
  washer: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 6h3"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
  speaker: '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="14" r="3"/><circle cx="12" cy="7" r="1"/>',
  door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01"/>',
  window: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M4 12h16"/>',
  blinds: '<path d="M4 4h16M5 4v12M19 4v12M5 8h14M5 12h14M5 16h14M12 16v4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  plug: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 11v2M6 10v4M9 10v4"/>',
  car: '<path d="M5 16l1.5-6h11L19 16M4 16h16v3H4zM7 19v1M17 19v1"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  water: '<path d="M3 15c2 0 2-1.5 4.5-1.5S9.5 15 12 15s2.5-1.5 4.5-1.5S18 15 21 15M3 19c2 0 2-1.5 4.5-1.5S9.5 19 12 19s2.5-1.5 4.5-1.5S18 19 21 19M12 3l3 5a3 3 0 1 1-6 0z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
  prev: '<path d="M18 6l-8 6 8 6zM6 6v12"/>',
  next: '<path d="M6 6l8 6-8 6zM18 6v12"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  chart: '<path d="M4 19h16M6 15l4-5 4 3 5-7"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.5 16a1.5 1.5 0 0 1 2.3-2L8 16"/>',
  schedule: '<rect x="3" y="5" width="13" height="13" rx="2"/><path d="M3 9h13M7 3v4M12 3v4"/><circle cx="17" cy="16" r="4.5"/><path d="M17 14v2l1.5 1"/>',
  auto: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18 3v4.5h-4.5M6 21v-4.5h4.5"/>',
  leaf: '<path d="M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l7-7"/>',
  away: '<path d="M13 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7M10 12h11M18 9l3 3-3 3"/>',
  ac: '<rect x="3" y="5" width="18" height="8" rx="2"/><path d="M6 10h12M8 16v3M12 16v4M16 16v3"/>'
};

const DOMAIN_ICON: Record<string, string> = {
  light: 'bulb', switch: 'power', input_boolean: 'power', cover: 'blinds', climate: 'thermometer', lock: 'lock',
  camera: 'cam', media_player: 'play', fan: 'fan', sensor: 'chart', binary_sensor: 'dot', scene: 'sun', script: 'play',
  alarm_control_panel: 'shield', vacuum: 'home', person: 'home', weather: 'cloud', water_heater: 'flame'
};
export const iconFor = (entity?: string, icon?: string) => icon || DOMAIN_ICON[domainOf(entity)] || 'dot';

let mdiCache: Record<string, string> | null = null;
/** Icons MDI lacks, drawn in the same style: mdi:fan-speed-4 (fan + digit 4, like fan-speed-1…3). */
function withExtras(m: Record<string, string>) {
  const fan = (m.mdiFanSpeed1 ?? '').replace(/M17 15V17H18V23H20V15H17Z\s*$/, '');
  return { ...m, mdiFanSpeed4: fan + 'M16 15H18V18H19V15H21V23H19V20H16Z' };
}
const toMdiKey = (name: string) => 'mdi' + name.slice(4).split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');

export function Icon({ name, size = 22 }: { name?: string; size?: number }) {
  const isMdi = !!name && name.startsWith('mdi:');
  const [path, setPath] = useState<string | null>(isMdi && mdiCache ? mdiCache[toMdiKey(name!)] ?? null : null);
  useEffect(() => {
    if (!isMdi) return;
    let alive = true;
    const pick = (m: Record<string, string>) => { if (alive) setPath(m[toMdiKey(name!)] ?? null); };
    if (mdiCache) pick(mdiCache);
    else import('@mdi/js').then((m) => { mdiCache = withExtras(m as unknown as Record<string, string>); pick(mdiCache); });
    return () => { alive = false; };
  }, [name, isMdi]);

  if (isMdi) {
    return path
      ? <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={path} /></svg>
      : <span style={{ display: 'inline-block', width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name || 'dot'] || ICONS.dot }} />
  );
}
