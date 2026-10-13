import type { FurnitureDef, FurnitureKind, HouseLevel, RectM, RoomDef, Seg, StairsDef } from '../shared/types.js';

/**
 * Converts a floor-plan SVG (the style used by the HA floor-plan cards) into a HouseLevel.
 * Recognised classes: r = room, w = wall line, ok = window, br = garage gate, d = dashed roof,
 * st = stair tread, mb / ml = furniture body / detail, text n = room name, text m2 = area.
 * Furniture types are guessed from shape and room; they can be corrected in the editor.
 */

interface Rot { a: number; cx: number; cy: number }
interface Shape { kind: 'rect' | 'ellipse' | 'line'; cls: string; x0: number; y0: number; x1: number; y1: number; rx?: number; ry?: number; diag?: boolean }
interface Item { shapes: Shape[]; rot: Rot | null }
interface RawRoom { name: string; area?: number; x: number; y: number; w: number; h: number; lx: number; ly: number }

export interface PlanFrame { scale: number; ox: number; oy: number }

const num = (v?: string) => (v == null ? NaN : parseFloat(v));
function attrs(s: string) {
  const o: Record<string, string> = {};
  for (const m of s.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2];
  return o;
}
function parseRotate(t?: string): Rot | null {
  const m = t?.match(/rotate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+)[\s,]+([-\d.]+))?\s*\)/);
  return m ? { a: +m[1], cx: +(m[2] ?? 0), cy: +(m[3] ?? 0) } : null;
}
function shapeOf(tag: string, a: Record<string, string>): Shape | null {
  const cls = (a.class || '').trim();
  if (tag === 'rect') {
    const x = num(a.x) || 0, y = num(a.y) || 0, w = num(a.width), h = num(a.height);
    return isFinite(w) && isFinite(h) ? { kind: 'rect', cls, x0: x, y0: y, x1: x + w, y1: y + h } : null;
  }
  if (tag === 'ellipse' || tag === 'circle') {
    const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx ?? a.r), ry = num(a.ry ?? a.r);
    return isFinite(cx) ? { kind: 'ellipse', cls, x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry, rx, ry } : null;
  }
  if (tag === 'line') {
    const x1 = num(a.x1), y1 = num(a.y1), x2 = num(a.x2), y2 = num(a.y2);
    return isFinite(x1) ? { kind: 'line', cls, x0: Math.min(x1, x2), y0: Math.min(y1, y2), x1: Math.max(x1, x2), y1: Math.max(y1, y2),
      diag: Math.abs(x2 - x1) > 4 && Math.abs(y2 - y1) > 4 } : null;
  }
  return null;
}

interface Parsed { top: Shape[]; groups: Item[]; rooms: RawRoom[]; lines: Record<string, [number, number, number, number][]>; dashed: Shape[] }

function parse(svg: string): Parsed {
  const top: Shape[] = [], groups: Item[] = [], dashed: Shape[] = [];
  const lines: Record<string, [number, number, number, number][]> = { w: [], ok: [], br: [], st: [] };
  const rectsR: Shape[] = [];
  const stack: (Item | null)[] = [];
  const texts: { cls: string; x: number; y: number; text: string }[] = [];
  const body = svg.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const [, close, tag, rest, self] = m;
    if (tag === 'g') {
      if (close) { stack.pop(); continue; }
      if (self) continue;
      const a = attrs(rest);
      const item: Item | null = stack.length === 0 ? { shapes: [], rot: parseRotate(a.transform) } : null;
      if (item) groups.push(item);
      stack.push(item ?? stack[stack.length - 1] ?? null);
      continue;
    }
    if (close) continue;
    const a = attrs(rest);
    const cls = (a.class || '').split(/\s+/)[0];
    if (tag === 'text') {
      const end = body.indexOf('</text>', re.lastIndex);
      const t = body.slice(re.lastIndex, end).replace(/<[^>]+>/g, '').trim();
      texts.push({ cls, x: num(a.x), y: num(a.y), text: t });
      continue;
    }
    if (tag === 'line' && cls in lines) {
      lines[cls].push([num(a.x1), num(a.y1), num(a.x2), num(a.y2)]);
      continue;
    }
    const s = shapeOf(tag, a);
    if (!s) continue;
    if (tag === 'rect' && cls === 'r') { rectsR.push(s); continue; }
    if (tag === 'rect' && cls === 'd') { dashed.push(s); continue; }
    if (cls !== 'mb' && cls !== 'ml') continue;
    const g = stack[stack.length - 1];
    if (g) g.shapes.push(s); else top.push(s);
  }

  // rooms with their labels (prefer a label that has an area below it)
  const names = texts.filter((t) => t.cls === 'n');
  const areas = texts.filter((t) => t.cls === 'm2');
  const labelled = names.map((n) => {
    const a = areas.find((x) => Math.abs(x.x - n.x) < 4 && x.y > n.y && x.y - n.y < 40);
    const v = a ? parseFloat(a.text.replace(',', '.')) : NaN;
    return { ...n, area: isFinite(v) ? v : undefined };
  });
  const rooms: RawRoom[] = rectsR.map((r) => {
    const inside = labelled.filter((l) => l.x >= r.x0 && l.x <= r.x1 && l.y >= r.y0 && l.y <= r.y1)
      .sort((p, q) => (p.area == null ? 1 : 0) - (q.area == null ? 1 : 0));
    const l = inside[0];
    return { name: l?.text ?? '', area: l?.area, x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0,
      lx: l?.x ?? (r.x0 + r.x1) / 2, ly: l?.y ?? (r.y0 + r.y1) / 2 };
  });
  groups.splice(0, groups.length, ...groups.filter((g) => g.shapes.length > 0));
  return { top, groups, rooms, lines, dashed };
}

/** Scale (m per px) from rooms with a known area; origin = centre of the room bounding box. */
export function frameFromSvg(svg: string): PlanFrame {
  const { rooms } = parse(svg);
  const ks = rooms.filter((r) => r.area && r.w > 0 && r.h > 0).map((r) => Math.sqrt(r.area! / (r.w * r.h))).sort((a, b) => a - b);
  const scale = ks.length ? ks[Math.floor(ks.length / 2)] : 0.01;
  const xs = rooms.flatMap((r) => [r.x, r.x + r.w]), ys = rooms.flatMap((r) => [r.y, r.y + r.h]);
  return { scale, ox: xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, oy: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0 };
}

const rotPt = (x: number, y: number, r: Rot | null): [number, number] => {
  if (!r) return [x, y];
  const t = (r.a * Math.PI) / 180, dx = x - r.cx, dy = y - r.cy;
  return [r.cx + dx * Math.cos(t) - dy * Math.sin(t), r.cy + dx * Math.sin(t) + dy * Math.cos(t)];
};
const area = (s: Shape) => (s.x1 - s.x0) * (s.y1 - s.y0);
const inside = (s: Shape, b: Shape, tol = 2) => s.x0 >= b.x0 - tol && s.y0 >= b.y0 - tol && s.x1 <= b.x1 + tol && s.y1 <= b.y1 + tol;
const centreIn = (s: Shape, b: Shape) => { const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2; return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1; };

export function svgToLevel(svg: string, f: PlanFrame, id: string, name: string, y: number): HouseLevel {
  const P = parse(svg);
  const S = f.scale;
  const X = (x: number) => +((x - f.ox) * S).toFixed(3), Z = (yy: number) => +((yy - f.oy) * S).toFixed(3);
  const seg = (l: [number, number, number, number]): Seg => ({ x1: X(l[0]), z1: Z(l[1]), x2: X(l[2]), z2: Z(l[3]) });

  const rooms: RoomDef[] = P.rooms.map((r) => ({
    name: r.name || (P.lines.st.length && pointInStairs(r, P.lines.st) ? 'Schody' : 'Pomieszczenie'),
    area: r.area, x0: X(r.x), z0: Z(r.y), x1: X(r.x + r.w), z1: Z(r.y + r.h), lx: X(r.lx), lz: Z(r.ly)
  }));
  const roofs: RectM[] = P.dashed.map((d) => ({ x0: X(d.x0), z0: Z(d.y0), x1: X(d.x1), z1: Z(d.y1) }));

  // stairs: treads bounding box, extended to the stair room containing it
  const stairs: StairsDef[] = [];
  if (P.lines.st.length >= 3) {
    const st = P.lines.st;
    const bx0 = Math.min(...st.map((l) => Math.min(l[0], l[2]))), bx1 = Math.max(...st.map((l) => Math.max(l[0], l[2])));
    const by0 = Math.min(...st.map((l) => Math.min(l[1], l[3]))), by1 = Math.max(...st.map((l) => Math.max(l[1], l[3])));
    const horizontal = st.every((l) => Math.abs(l[1] - l[3]) < 1);
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    const room = P.rooms.find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h && /schod/i.test(r.name || 'schody'));
    const r = room ?? { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
    stairs.push({ x0: X(r.x), z0: Z(horizontal ? by0 : r.y), x1: X(r.x + r.w), z1: Z(horizontal ? Math.min(r.y + r.h, by1 + (by1 - by0) / st.length) : r.y + r.h),
      axis: horizontal ? 'z' : 'x', top: 'min', steps: st.length + 1 });
  }

  const furniture = furnitureOf(P, f, rooms);
  return {
    id, name, y,
    walls: P.lines.w.map(seg), windows: P.lines.ok.map(seg), gates: P.lines.br.map(seg),
    rooms, roofs, stairs, furniture
  };
}

function pointInStairs(r: RawRoom, st: [number, number, number, number][]) {
  return st.some((l) => l[0] >= r.x && l[0] <= r.x + r.w && l[1] >= r.y && l[1] <= r.y + r.h);
}

// ---------------------------------------------------------------- furniture recognition
function furnitureOf(P: Parsed, f: PlanFrame, rooms: RoomDef[]): FurnitureDef[] {
  // top-level shapes: containers are mb rects not inside a larger mb rect
  const items: Item[] = [...P.groups];
  const mbRects = P.top.filter((s) => s.kind === 'rect' && s.cls === 'mb').sort((a, b) => area(b) - area(a));
  const mains: Item[] = [];
  const mainShapes: Shape[] = [];
  const near = (s: Shape, m: Shape, pad: number) => { const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2; return cx >= m.x0 - pad && cx <= m.x1 + pad && cy >= m.y0 - pad && cy <= m.y1 + pad; };
  for (const r of mbRects) {
    if (mainShapes.some((m) => inside(r, m))) continue;
    // small parts sticking out of a bigger body (car wheels, handles) belong to that body
    const owner = mainShapes.findIndex((m) => area(r) < area(m) * 0.12 && near(r, m, 25));
    if (owner >= 0) { mains[owner].shapes.push(r); continue; }
    mainShapes.push(r); mains.push({ shapes: [r], rot: null });
  }
  for (const s of P.top) {
    if (mainShapes.includes(s)) continue;
    const i = mainShapes.findIndex((m) => centreIn(s, m));
    if (i >= 0) mains[i].shapes.push(s);
  }
  items.push(...mains);

  const S = f.scale;
  const out: FurnitureDef[] = [];
  let n = 0;
  const push = (kind: FurnitureKind, cxPx: number, cyPx: number, wPx: number, hPx: number, phi: number) => {
    // w/h are along plan x/y; convert to model-local width/depth for the facing angle
    let w = wPx * S, d = hPx * S;
    if (Math.round(Math.abs(phi * 180 / Math.PI)) % 180 === 90) [w, d] = [d, w];
    out.push({ id: 'f' + ++n, kind, x: +((cxPx - f.ox) * S).toFixed(3), z: +((cyPx - f.oy) * S).toFixed(3), w: +w.toFixed(3), d: +d.toFixed(3), phi: +phi.toFixed(4) });
  };
  const roomAt = (xPx: number, yPx: number) => {
    const x = (xPx - f.ox) * S, z = (yPx - f.oy) * S;
    return rooms.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  };
  /** face away from the nearest wall of the room (front = +Z when phi = 0) */
  const faceWall = (cx: number, cy: number, w: number, h: number) => {
    const r = roomAt(cx, cy); if (!r) return 0;
    const x0 = r.x0 / S + f.ox, x1 = r.x1 / S + f.ox, y0 = r.z0 / S + f.oy, y1 = r.z1 / S + f.oy;
    const d: Record<'top' | 'bottom' | 'left' | 'right', number> = { top: cy - h / 2 - y0, bottom: y1 - (cy + h / 2), left: cx - w / 2 - x0, right: x1 - (cx + w / 2) };
    // long pieces (counters, wardrobes) stand with a long side against the wall
    const keys = (w > h * 1.6 ? ['top', 'bottom'] : h > w * 1.6 ? ['left', 'right'] : Object.keys(d)) as (keyof typeof d)[];
    const side = keys.reduce((a, b) => (d[a] <= d[b] ? a : b));
    return { top: 0, bottom: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[side];
  };
  const washersIn = new Map<string, number>();

  for (const it of items) {
    const rects = it.shapes.filter((s) => s.kind === 'rect' && s.cls === 'mb').sort((a, b) => area(b) - area(a));
    const main = rects[0] ?? it.shapes[0];
    // footprint of the whole item in local coords, then rotated to plan coords
    const fx0 = Math.min(...it.shapes.map((s) => s.x0)), fx1 = Math.max(...it.shapes.map((s) => s.x1));
    const fy0 = Math.min(...it.shapes.map((s) => s.y0)), fy1 = Math.max(...it.shapes.map((s) => s.y1));
    const rot = it.rot, quarter = rot ? Math.round(rot.a / 90) % 2 !== 0 : false;
    const [cx, cy] = rotPt((fx0 + fx1) / 2, (fy0 + fy1) / 2, rot);
    const pw = quarter ? fy1 - fy0 : fx1 - fx0, ph = quarter ? fx1 - fx0 : fy1 - fy0;
    const L = Math.max(pw, ph) * S, Sh = Math.min(pw, ph) * S;
    const roomName = (roomAt(cx, cy)?.name || '').toLowerCase();
    const th = rot ? (rot.a * Math.PI) / 180 : 0;

    const ellipses = it.shapes.filter((s) => s.kind === 'ellipse');
    const others = rects.slice(1);
    const chairs = others.filter((r) => Math.min(r.x1 - r.x0, r.y1 - r.y0) <= 22 && !centreIn(r, main));
    const inner = it.shapes.filter((s) => s !== main && s.kind === 'rect' && inside(s, main));
    const innerLines = it.shapes.filter((s) => s.kind === 'line' && !s.diag).length;
    const diag = it.shapes.filter((s) => s.diag).length;
    const tiny = rects.some((r) => Math.min(r.x1 - r.x0, r.y1 - r.y0) * S < 0.2);

    if (/gara/.test(roomName) && L > 3) {
      // car faces the gate if there is one, else away from the nearest wall
      const gate = P.lines.br[0];
      const phi = gate ? ((gate[1] + gate[3]) / 2 > cy ? 0 : Math.PI) : faceWall(cx, cy, pw, ph) + Math.PI;
      push('car', cx, cy, pw, ph, phi);
    } else if (chairs.length >= 3) {
      const [tx, ty] = rotPt((main.x0 + main.x1) / 2, (main.y0 + main.y1) / 2, rot);
      const tw = quarter ? main.y1 - main.y0 : main.x1 - main.x0, tl = quarter ? main.x1 - main.x0 : main.y1 - main.y0;
      push('table', tx, ty, tw, tl, 0);
      for (const c of chairs) {
        const [ccx, ccy] = rotPt((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, rot);
        out.push({ id: 'f' + ++n, kind: 'chair', x: +((ccx - f.ox) * S).toFixed(3), z: +((ccy - f.oy) * S).toFixed(3), w: 0.46, d: 0.46,
          phi: +Math.atan2(tx - ccx, ty - ccy).toFixed(4) });
      }
    } else if (diag >= 2) {
      push('shower', cx, cy, pw, ph, faceWall(cx, cy, pw, ph));
    } else if (/azienk|wc|toalet|pralni/.test(roomName)) {
      let kind: FurnitureKind;
      if (L > 1.4) kind = 'bathtub';
      else if (ellipses.length && tiny) kind = 'toilet';
      else if (/pralni/.test(roomName) || (ellipses.length && Math.abs(pw - ph) * S < 0.15)) {
        const k = roomName; const c = washersIn.get(k) ?? 0; washersIn.set(k, c + 1);
        kind = c === 0 ? 'washer' : 'dryer';
      } else if (ellipses.length) kind = 'bathSink';
      else kind = 'cabinet';
      push(kind, cx, cy, pw, ph, faceWall(cx, cy, pw, ph));
    } else if (ellipses.length >= 3) {
      // kitchen run: sink at the largest ellipse, hob at the cluster of small ones, cabinets in between
      const phi = faceWall(cx, cy, pw, ph);
      const big = ellipses.reduce((a, b) => ((a.rx ?? 0) >= (b.rx ?? 0) ? a : b));
      const small = ellipses.filter((e) => e !== big);
      const along = (s: Shape) => (quarter ? rotPt((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, rot)[1] : rotPt((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, rot)[0]);
      const a0 = quarter ? cy - ph / 2 : cx - pw / 2, a1 = quarter ? cy + ph / 2 : cx + pw / 2;
      const depth = quarter ? pw : ph, unit = 0.86 / S;
      const sinkC = along(big), hobC = small.reduce((s, e) => s + along(e), 0) / Math.max(1, small.length);
      const pieces: [FurnitureKind, number, number][] = [['sink', sinkC - unit / 2, sinkC + unit / 2], ['stove', hobC - unit / 2, hobC + unit / 2]];
      const cuts = pieces.map((p) => [p[1], p[2]]).sort((a, b) => a[0] - b[0]);
      let pos = a0;
      for (const [s0, s1] of cuts) { if (s0 - pos > 20) pieces.push(['cabinet', pos, s0]); pos = Math.max(pos, s1); }
      if (a1 - pos > 20) pieces.push(['cabinet', pos, a1]);
      for (const [k, s0, s1] of pieces) {
        const c = (s0 + s1) / 2;
        if (quarter) push(k, cx, c, depth, s1 - s0, phi); else push(k, c, cy, s1 - s0, depth, phi);
      }
    } else if (inner.length >= 1 && L >= 1.8 && Sh >= 1.2) {
      push('bed', cx, cy, pw, ph, faceWall(cx, cy, pw, ph));
    } else if (Sh < 0.75 && L >= 1.2 && /dzienn|salon|tv/.test(roomName)) {
      push('tvcab', cx, cy, pw, ph, faceWall(cx, cy, pw, ph));
    } else if (Sh < 0.75 && L >= 1.2) {
      push('wardrobe', cx, cy, pw, ph, faceWall(cx, cy, pw, ph));
    } else if (innerLines >= 2 && L >= 1.4 && Sh <= 1.1) {
      push('sofa', cx, cy, pw, ph, rot ? -th : faceWall(cx, cy, pw, ph));
    } else {
      push('box', cx, cy, pw, ph, faceWall(cx, cy, pw, ph));
    }
  }
  return out;
}
