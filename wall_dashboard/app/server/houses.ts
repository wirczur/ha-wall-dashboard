import type { HouseDef } from '../shared/types.js';
import { ENTITY_RE } from '../shared/types.js';
import { frameFromSvg, svgToLevel } from './svgplan.js';

export interface LevelUpload { name: string; svg: string; height?: number }

/** Builds a house from one SVG per level. All levels share the scale/origin of the first one. */
export function importHouse(id: string, name: string, levels: LevelUpload[], wallHeight = 2.6): HouseDef {
  if (!levels.length) throw new Error('Dodaj co najmniej jeden rzut SVG');
  for (const l of levels) if (!/<svg[\s>]/i.test(l.svg)) throw new Error(`Plik dla „${l.name}” nie wygląda na SVG`);
  const frame = frameFromSvg(levels[0].svg);
  let y = 0;
  const out = levels.map((l, i) => {
    const lvl = svgToLevel(l.svg, frame, 'l' + (i + 1), l.name || `Poziom ${i + 1}`, y);
    y += l.height ?? wallHeight + 0.3;
    return lvl;
  });
  return { id, name, wallHeight, levels: out, devices: [] };
}

/** Structural checks for a house saved from the editor. */
export function validateHouse(input: any, id: string): HouseDef {
  if (!input || typeof input !== 'object') throw new Error('Dom musi być obiektem JSON');
  if (!Array.isArray(input.levels) || !input.levels.length) throw new Error('Dom nie ma poziomów');
  if (!Array.isArray(input.devices)) input.devices = [];
  for (const d of input.devices) {
    if (!d || typeof d.id !== 'string') throw new Error('Urządzenie bez id');
    if (d.entity && !ENTITY_RE.test(d.entity)) throw new Error(`Niepoprawna encja urządzenia: ${d.entity}`);
    if (!Number.isInteger(d.level) || d.level < 0 || d.level >= input.levels.length) throw new Error(`Urządzenie ${d.id}: niepoprawny poziom`);
  }
  for (const l of input.levels) {
    for (const k of ['walls', 'windows', 'gates', 'rooms', 'roofs', 'stairs', 'furniture']) if (!Array.isArray(l[k])) l[k] = [];
    for (const r of l.rooms) for (const k of ['temperature', 'humidity', 'climate', 'light'])
      if (r[k] != null && r[k] !== '' && !ENTITY_RE.test(r[k])) throw new Error(`Pomieszczenie ${r.name}: niepoprawna encja ${r[k]}`);
  }
  return { id, name: String(input.name || 'Dom'), wallHeight: Number(input.wallHeight) || 2.6, levels: input.levels, devices: input.devices };
}
