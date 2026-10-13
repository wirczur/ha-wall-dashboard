// Seasonal look: which skin applies today and which particle effect goes with it.
import { useEffect, useState } from 'react';
import type { ThemeDef } from '../../../shared/types';

export type Skin = NonNullable<ThemeDef['skin']>;
export type FxKind = 'none' | 'snow' | 'hearts' | 'leaves' | 'petals';

export const SKINS: [Skin, string][] = [
  ['glass', 'Szkło – ciemny'], ['mech', 'Mech i mosiądz – jasny, ciepły'],
  ['swieta', 'Święta – sosna i żurawina'], ['wielkanoc', 'Wielkanoc – wiosenna łąka'],
  ['halloween', 'Halloween – dynia i bakłażan'], ['walentynki', 'Walentynki – pudrowy róż']
];
export const FX: [FxKind | 'auto', string][] = [['auto', 'Wg motywu'], ['none', 'Brak'], ['snow', 'Śnieg'], ['hearts', 'Serduszka'], ['leaves', 'Liście'], ['petals', 'Płatki']];
const SKIN_FX: Partial<Record<Skin, FxKind>> = { swieta: 'snow', walentynki: 'hearts', halloween: 'leaves', wielkanoc: 'petals' };

/** Gregorian Easter Sunday (Meeus/Jones/Butcher). */
export function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

/** Occasion skin for a date: Christmas 6 Dec – 6 Jan, Easter (Palm Sunday – Easter Monday), Halloween 24–31 Oct, Valentine's 10–14 Feb. */
export function occasionFor(d: Date): Skin | undefined {
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 12 && day >= 6) || (m === 1 && day <= 6)) return 'swieta';
  if (m === 10 && day >= 24) return 'halloween';
  if (m === 2 && day >= 10 && day <= 14) return 'walentynki';
  const e = easter(d.getFullYear()), t = new Date(d.getFullYear(), m - 1, day).getTime();
  if (t >= e.getTime() - 7 * 864e5 && t <= e.getTime() + 864e5) return 'wielkanoc';
  return undefined;
}

/** Effective skin + effect, re-checked every hour (the tablet runs for days). */
export function useLook(theme: ThemeDef): { skin?: Skin; fx: FxKind } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 3600_000); return () => clearInterval(t); }, []);
  const occ = theme.occasions ? occasionFor(now) : undefined;
  const skin = occ ?? (theme.skin && theme.skin !== 'glass' ? theme.skin : undefined);
  const fx = !theme.effect || theme.effect === 'auto' ? (skin ? SKIN_FX[skin] ?? 'none' : 'none') : theme.effect;
  return { skin, fx };
}
