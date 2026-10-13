// Dynamic text: "{sensor.salon_temp}° · {sensor.salon_humidity}" — used in titles, subtitles and text widgets.
//   {domain.object}             state as shown in the UI (with unit / Polish state names)
//   {domain.object.attribute}   an attribute
//   {…:1}                       number with 1 decimal (no unit)
export const TEMPLATE_RE = /\{([a-z_]+\.[a-z0-9_]+)(?:\.([a-z0-9_]+))?(?::(\d))?\}/g;

export function templateEntities(text?: string): string[] {
  if (!text || !text.includes('{')) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(TEMPLATE_RE)) out.add(m[1]);
  return [...out];
}
