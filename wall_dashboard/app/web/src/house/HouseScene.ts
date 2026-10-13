import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FurnitureDef, FurnitureKind, HassState, HouseDef, HouseDevice, RoomDef, Seg, StairsDef } from '../../../shared/types';
import { acVisual, roomTemperature } from '../widgets/climate';

export interface SceneOpts {
  /** level index, or 'all' (levels stacked with a gap) */
  level: number | 'all';
  lowWalls: boolean;
  heatmap: boolean;
  palette: 'muted' | 'kenney';
  lite: boolean;
  camera: { az: number; el: number; zoom: number };
  /** allow free orbit (editor); kiosk keeps the fixed angle */
  orbit: boolean;
}
export type Pick =
  | { type: 'device'; device: HouseDevice }
  | { type: 'room'; level: number; room: RoomDef }
  | { type: 'furniture'; level: number; id: string }
  | { type: 'gate'; level: number; index: number; entity?: string }
  | { type: 'floor'; level: number; x: number; z: number };

/** A furniture piece or device dragged to a new place (editor). */
export interface MoveEvent { type: 'furniture' | 'device'; id: string; level: number; x: number; z: number }

const S = 2; // Kenney units → metres
const T = 0.127; // wall thickness
const KMUTED: Record<string, number> = {
  carpet: 0x8a93a6, carpetDarker: 0x6f778a, carpetWhite: 0xe9e4db, carpetBlue: 0x7e8fae, wood: 0xb49478, woodDark: 0x8a6a52,
  metal: 0xc9cbc8, metalLight: 0xeeeae3, metalMedium: 0x6b6e73, metalDark: 0x3e4147, glass: 0xa9c4d8, plant: 0x6e9a72, lamp: 0xf1e6d2, _defaultMat: 0xe6dfd4
};
const PROC: Record<string, [number, number]> = {
  pFloor: [0xcdb9a0, 0xe0a15e], pTile: [0xd3d1cc, 0xe6eef2], pConcrete: [0x9e9c98, 0xb9b9b9], pStair: [0xa88a6c, 0xc97b3a],
  pRoof: [0x7e8086, 0x8c96a3], pCar: [0x5e6b7e, 0x3d7bd9], pTire: [0x2a2c30, 0x2a2c30], pGate: [0xc9cbc8, 0xdde3ea],
  pAc: [0xf4f2ee, 0xffffff], pDark: [0x3e4147, 0x4e6363], pWall: [0xe6dfd4, 0xf4f4f4], pBox: [0xb49478, 0xd9823b]
};
const MODEL: Partial<Record<FurnitureKind, [string, { keep?: boolean; h?: number }?]>> = {
  table: ['table'], chair: ['chair', { keep: true }], sofa: ['loungeSofa'], tvcab: ['cabinetTelevision'], coffee: ['tableCoffee'], rug: ['rugRectangle'],
  sink: ['kitchenSink'], stove: ['kitchenStove'], cabinet: ['kitchenCabinet'], wardrobe: ['bookcaseClosedDoors', { h: 2.1 }], shower: ['shower', { h: 2.05 }],
  bathSink: ['bathroomSink'], toilet: ['toilet'], washer: ['washer'], dryer: ['dryer'], bed: ['bedDouble'], bathtub: ['bathtub'],
  desk: ['desk'], fridge: ['kitchenFridge'], plant: ['pottedPlant', { keep: true }], box: ['kitchenCabinet'],
  tv: ['televisionModern'], tvVintage: ['televisionVintage', { keep: true }], armchair: ['loungeChair'], sofaCorner: ['loungeSofaCorner'],
  ottoman: ['loungeSofaOttoman'], bookcase: ['bookcaseOpen', { h: 1.9 }], nightstand: ['cabinetBed'], sideTable: ['sideTable'],
  floorLamp: ['lampSquareFloor', { keep: true }], tableLamp: ['lampRoundTable', { keep: true }], speaker: ['speaker', { keep: true }],
  ceilingFan: ['ceilingFan', { keep: true }], bedSingle: ['bedSingle'], deskChair: ['chairDesk', { keep: true }], roundTable: ['tableRound'],
  rugRound: ['rugRound'], mirror: ['bathroomMirror', { keep: true }], bathCabinet: ['bathroomCabinet'], coatRack: ['coatRackStanding', { keep: true }],
  trashcan: ['trashcan', { keep: true }], microwave: ['kitchenMicrowave', { keep: true }], washerDryer: ['washerDryerStacked'],
  fridgeLarge: ['kitchenFridgeLarge'], plantSmall: ['plantSmall1', { keep: true }], monitor: ['computerScreen', { h: 0.42 }],
  bench: ['bench'], bar: ['kitchenBar'], tallCabinet: ['kitchenFridgeBuiltIn', { h: 2.15 }], hood: ['hoodModern', { keep: true }],
  shelfLow: ['bookcaseOpenLow', { h: 0.75 }], sofaLong: ['loungeSofaLong'], tvBench: ['cabinetTelevision', { h: 0.45 }]
};
/** one colour for the whole piece (real look of the appliance) */
const TINT: Partial<Record<FurnitureKind, number>> = { fridge: 0x2b2d31, tallCabinet: 0xefede8, hood: 0x222428, tvBench: 0xf1f0ec, speaker: 0x1f2124 };
/** simple pieces drawn as boxes: material, height (m) */
const BOXED: Partial<Record<FurnitureKind, [string, number]>> = { acUnit: ['pAc', 0.3], rack: ['pDark', 1.2], pc: ['pDark', 0.45], printer: ['pAc', 0.3], shredder: ['pDark', 0.42] };
/** default height above the floor for pieces that do not stand on it */
const ELEV: Partial<Record<FurnitureKind, number>> = { acUnit: 2.05, hood: 1.55, tv: 0.5, tableLamp: 0.6, microwave: 0.9, monitor: 0.75, mirror: 1.2, ceilingFan: 2.25 };
const ACTIVE = new Set(['on', 'open', 'opening', 'playing', 'heat', 'cool', 'auto', 'dry', 'heat_cool', 'fan_only']);

const loader = new GLTFLoader();
const modelCache = new Map<string, Promise<THREE.Group>>();
function loadModel(name: string) {
  if (!modelCache.has(name)) modelCache.set(name, loader.loadAsync('kenney/' + name + '.glb').then((g) => g.scene));
  return modelCache.get(name)!;
}

interface DevRuntime { def: HouseDevice; root: THREE.Object3D; glow: THREE.MeshStandardMaterial[]; lights: THREE.PointLight[]; flow?: THREE.MeshBasicMaterial; levelGroup: THREE.Group; power?: number }
interface StairLed { entity: string; mats: THREE.MeshStandardMaterial[]; lights: THREE.PointLight[] }
interface LevelRuntime { stairLeds: StairLed[]; group: THREE.Group; walls: THREE.Group; clip: THREE.Plane; heat: { room: RoomDef; mesh: THREE.Mesh }[]; gates: { seg: Seg; panel: THREE.Mesh }[]; roomLights: { room: RoomDef; lamp: THREE.Object3D; mats: THREE.MeshStandardMaterial[]; lights: THREE.PointLight[]; power: number }[] }

export class HouseScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  private controls: OrbitControls;
  private mats = new Set<THREE.Material>();
  private levels: LevelRuntime[] = [];
  private devices: DevRuntime[] = [];
  private furnitureById = new Map<string, THREE.Object3D>();
  private pickables: THREE.Object3D[] = [];
  private hemi = new THREE.HemisphereLight(0xdfe8ff, 0x5a4a3c, 0.5);
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private ro: ResizeObserver;
  private pending = false;
  private disposed = false;
  private states: (id: string) => HassState | undefined = () => undefined;
  private animating = false;
  private selection: THREE.BoxHelper | null = null;
  private dragEnabled = false;
  ready: Promise<void>;

  constructor(private host: HTMLElement, private house: HouseDef, public opts: SceneOpts,
    private cb: { onPick?(p: Pick): void; onFrame?(): void; onMove?(m: MoveEvent): void } = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !opts.lite, alpha: true, powerPreference: opts.lite ? 'low-power' : 'default' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(this.hemi);
    this.sun.position.set(-8, 14, -6);
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.bindPointer();
    this.ready = this.build();
    this.applyOpts();
  }

  // ------------------------------------------------------------------ public
  setOptions(p: Partial<SceneOpts>) {
    const prev = this.opts; this.opts = { ...this.opts, ...p };
    if (p.lite !== undefined && p.lite !== prev.lite) { this.renderer.shadowMap.enabled = !this.opts.lite; this.mats.forEach((m) => (m.needsUpdate = true)); }
    this.applyOpts();
  }
  setStates(get: (id: string) => HassState | undefined) { this.states = get; this.applyStates(); }
  /** screen position (px, relative to host) of a point on a level */
  project(level: number, x: number, y: number, z: number) {
    const lv = this.levels[level]; if (!lv || !lv.group.visible) return null;
    const v = new THREE.Vector3(x, lv.group.position.y + y, z).project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    return { x: ((v.x + 1) / 2) * this.host.clientWidth, y: ((1 - v.y) / 2) * this.host.clientHeight };
  }
  levelVisible(i: number) { return !!this.levels[i]?.group.visible; }
  /** current orbit as az/el/zoom (for "save angle") */
  currentCamera() {
    const d = this.camera.position.clone().sub(this.controls.target);
    const dist = d.length(); d.normalize();
    const el = (Math.asin(d.y) * 180) / Math.PI, az = ((Math.atan2(d.x, d.z) * 180) / Math.PI + 360) % 360;
    const fit = this.fitDistance(d);
    return { az: Math.round(az), el: Math.round(el), zoom: +(fit / dist).toFixed(2) };
  }
  select(id: string | null) {
    if (this.selection) { this.scene.remove(this.selection); this.selection = null; }
    const o = id ? this.furnitureById.get(id) ?? this.devices.find((d) => d.def.id === id)?.root : null;
    if (o) { this.selection = new THREE.BoxHelper(o, 0xffc870); this.scene.add(this.selection); }
    this.render();
  }
  /** editor: allow dragging furniture and devices on the floor */
  enableDrag(on: boolean) { this.dragEnabled = on; }
  /** editor: take new data without rebuilding (positions already shown) */
  setHouseData(h: HouseDef) {
    this.house = h;
    for (const d of this.devices) d.def = h.devices.find((x) => x.id === d.def.id) ?? d.def;
  }
  /** editor: move a piece to a new plan position (keyboard nudge) without rebuilding */
  moveTo(type: 'furniture' | 'device', id: string, x: number, z: number) {
    const t = this.target(type, id); if (!t) return;
    this.shift(t, x - t.x, z - t.z);
  }
  private target(type: 'furniture' | 'device', id: string) {
    if (type === 'furniture') {
      for (let li = 0; li < this.house.levels.length; li++) {
        const f = this.house.levels[li].furniture.find((x) => x.id === id);
        const obj = this.furnitureById.get(id);
        if (f && obj) return { level: li, x: f.x, z: f.z, objs: [obj], f };
      }
      return null;
    }
    const d = this.devices.find((x) => x.def.id === id);
    return d ? { level: d.def.level, x: d.def.x, z: d.def.z, objs: [d.root, ...d.lights], f: undefined } : null;
  }
  private shift(t: { objs: THREE.Object3D[] }, dx: number, dz: number, from?: THREE.Vector3[]) {
    t.objs.forEach((o, i) => {
      const b = from?.[i] ?? o.position;
      o.position.x = b.x + dx; o.position.z = b.z + dz;
    });
    this.selection?.update();
    this.render();
  }
  /** Moves a furniture footprint flush to a wall face when an edge is within `tol` metres. */
  private snapToWalls(level: number, f: FurnitureDef, x: number, z: number, tol = 0.15) {
    const L = this.house.levels[level]; if (!L) return { x, z };
    const c = Math.abs(Math.cos(f.phi || 0)), sn = Math.abs(Math.sin(f.phi || 0));
    const hx = (c * f.w + sn * f.d) / 2, hz = (sn * f.w + c * f.d) / 2, half = T / 2;
    let bx: number | null = null, bz: number | null = null, dbx = tol, dbz = tol;
    for (const w of [...L.walls, ...L.windows]) {
      const horiz = Math.abs(w.z2 - w.z1) < 1e-3;
      if (horiz) {
        const a = Math.min(w.x1, w.x2), b = Math.max(w.x1, w.x2);
        if (x + hx <= a + 0.05 || x - hx >= b - 0.05) continue;
        for (const cand of [w.z1 + half + hz, w.z1 - half - hz]) { const dd = Math.abs(cand - z); if (dd < dbz) { dbz = dd; bz = cand; } }
      } else {
        const a = Math.min(w.z1, w.z2), b = Math.max(w.z1, w.z2);
        if (z + hz <= a + 0.05 || z - hz >= b - 0.05) continue;
        for (const cand of [w.x1 + half + hx, w.x1 - half - hx]) { const dd = Math.abs(cand - x); if (dd < dbx) { dbx = dd; bx = cand; } }
      }
    }
    return { x: bx ?? x, z: bz ?? z };
  }
  async rebuild(house: HouseDef) { this.house = house; this.clear(); await (this.ready = this.build()); this.applyOpts(); this.applyStates(); }
  dispose() {
    this.disposed = true; this.ro.disconnect(); this.controls.dispose();
    this.clear(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
  render() {
    if (this.pending || this.disposed) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; if (this.disposed) return; this.renderer.render(this.scene, this.camera); this.cb.onFrame?.(); });
  }

  // ------------------------------------------------------------------ build
  private clear() {
    for (const lv of this.levels) { this.scene.remove(lv.group); lv.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
    this.levels = []; this.devices = []; this.furnitureById.clear(); this.pickables = []; this.mats.clear();
  }

  private pm(name: string, extra: THREE.MeshStandardMaterialParameters = {}) {
    const m = new THREE.MeshStandardMaterial({ name, flatShading: true, roughness: 0.85, ...extra });
    this.mats.add(m); this.paint(m); return m;
  }
  private paint(m: THREE.Material) {
    const mat = m as THREE.MeshStandardMaterial; if (!mat.color) return;
    if (mat.userData.fixed !== undefined) { mat.color.setHex(mat.userData.fixed); return; }
    if (PROC[mat.name]) { mat.color.setHex(PROC[mat.name][this.opts.palette === 'muted' ? 0 : 1]); return; }
    if (mat.userData.orig === undefined) mat.userData.orig = mat.color.getHex();
    const v = this.opts.palette === 'muted' ? KMUTED[mat.name] : undefined;
    mat.color.setHex(v ?? mat.userData.orig);
  }
  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }

  /** place a Kenney model; fits footprint w×d (model axes) unless keep; optional height h */
  private async place(parent: THREE.Object3D, name: string, it: { x: number; z: number; w?: number; d?: number; phi?: number }, o: { keep?: boolean; h?: number; y?: number } = {}) {
    const inner = (await loadModel(name)).clone(true);
    inner.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.flatShading = true; mesh.material = mat; this.mats.add(mat); this.paint(mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
    });
    inner.scale.setScalar(S); inner.updateMatrixWorld(true);
    let b = new THREE.Box3().setFromObject(inner); const sz = new THREE.Vector3(); b.getSize(sz);
    if (!o.keep && it.w && it.d) { inner.scale.x *= it.w / sz.x; inner.scale.z *= it.d / sz.z; }
    if (o.h) inner.scale.y *= o.h / sz.y;
    inner.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(inner); const c = new THREE.Vector3(); b.getCenter(c);
    inner.position.set(-c.x, -b.min.y, -c.z);
    const pivot = new THREE.Group(); pivot.add(inner);
    pivot.rotation.y = it.phi || 0; pivot.position.set(it.x, o.y || 0, it.z);
    parent.add(pivot); return pivot;
  }

  private async build() {
    const H = this.house.wallHeight || 2.6;
    const M = {
      floor: this.pm('pFloor'), tile: this.pm('pTile'), concrete: this.pm('pConcrete'), stair: this.pm('pStair'), roof: this.pm('pRoof'),
      car: this.pm('pCar', { roughness: 0.45 }), tire: this.pm('pTire'), gate: this.pm('pGate'), dark: this.pm('pDark'), wall: this.pm('pWall'), boxm: this.pm('pBox')
    };
    const floorMat = (n: string) => (/azienk|pralni|wc/i.test(n) ? M.tile : /gara/i.test(n) ? M.concrete : M.floor);
    const jobs: Promise<unknown>[] = [];

    this.house.levels.forEach((L, li) => {
      const group = new THREE.Group(); group.position.y = L.y; this.scene.add(group);
      const lv: LevelRuntime = { stairLeds: [], group, walls: new THREE.Group(), clip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), heat: [], gates: [], roomLights: [] };
      this.levels.push(lv);
      group.add(lv.walls);

      for (const r of L.rooms) {
        if (r.hidden) continue;
        const isStairVoid = li > 0 && /schod/i.test(r.name);
        if (!isStairVoid) {
          const f = this.box(r.x1 - r.x0 + 0.02, 0.06, r.z1 - r.z0 + 0.02, floorMat(r.name), (r.x0 + r.x1) / 2, -0.03, (r.z0 + r.z1) / 2, group);
          f.castShadow = false; f.userData.pick = { type: 'room', level: li, room: r } satisfies Pick; this.pickables.push(f);
        }
        const hm = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.1, r.x1 - r.x0 - 0.1), Math.max(0.1, r.z1 - r.z0 - 0.1)),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.24, depthWrite: false, color: 0x888888 }));
        hm.rotation.x = -Math.PI / 2; hm.position.set((r.x0 + r.x1) / 2, 0.05, (r.z0 + r.z1) / 2); hm.renderOrder = 2; hm.visible = false;
        group.add(hm); lv.heat.push({ room: r, mesh: hm });
        if (r.light) jobs.push(this.roomLight(lv, r, H));
      }
      for (const r of L.roofs) this.box(r.x1 - r.x0, 0.12, r.z1 - r.z0, M.roof, (r.x0 + r.x1) / 2, -0.06, (r.z0 + r.z1) / 2, group);
      const nextY = this.house.levels[li + 1]?.y ?? L.y + H + 0.3;
      for (const st of L.stairs) {
        const n = Math.max(2, st.steps), rise = (nextY - L.y) / n;
        const len = st.axis === 'z' ? st.z1 - st.z0 : st.x1 - st.x0, run = len / n;
        if (st.led) this.stairLeds(lv, group, st, n, rise, run);
        if (st.style !== 'solid') { this.openStairs(group, st, n, rise, run, len, nextY - L.y, M.stair); continue; }
        for (let i = 0; i < n; i++) {
          const top = (i + 1) * rise;
          const along = st.top === 'min' ? (st.axis === 'z' ? st.z1 : st.x1) - (i + 0.5) * run : (st.axis === 'z' ? st.z0 : st.x0) + (i + 0.5) * run;
          if (st.axis === 'z') this.box(st.x1 - st.x0 - 0.06, top, run + 0.01, M.stair, (st.x0 + st.x1) / 2, top / 2, along, group);
          else this.box(run + 0.01, top, st.z1 - st.z0 - 0.06, M.stair, along, top / 2, (st.z0 + st.z1) / 2, group);
        }
      }
      L.gates.forEach((g, gi) => {
        const horiz = Math.abs(g.z2 - g.z1) < 1e-3, len = Math.hypot(g.x2 - g.x1, g.z2 - g.z1);
        const panel = this.box(horiz ? len : 0.06, 2.3, horiz ? 0.06 : len, M.gate, (g.x1 + g.x2) / 2, 1.15, (g.z1 + g.z2) / 2, group);
        panel.userData.pick = { type: 'gate', level: li, index: gi, entity: g.entity } satisfies Pick; this.pickables.push(panel);
        lv.gates.push({ seg: g, panel });
      });
      jobs.push(this.buildWalls(lv, L.walls, L.windows, L.gates, H));
      for (const f of L.furniture) jobs.push(this.furniture(group, li, f, M));
    });
    for (const d of this.house.devices) jobs.push(this.device(d, H));
    await Promise.all(jobs);
    this.renderer.shadowMap.enabled = !this.opts.lite;
    this.sun.castShadow = !this.opts.lite;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.applyStates();
    this.fit();
  }

  private async buildWalls(lv: LevelRuntime, walls: Seg[], windows: Seg[], gates: Seg[], H: number) {
    const g = lv.walls;
    const tile = async (s: Seg, model: string, extra: number) => {
      const horiz = Math.abs(s.z2 - s.z1) < 1e-3, len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1) + extra;
      if (len < 0.05) return;
      const n = Math.max(1, Math.round(len / 2)), w = len / n;
      const ux = horiz ? Math.sign(s.x2 - s.x1) || 1 : 0, uz = horiz ? 0 : Math.sign(s.z2 - s.z1) || 1;
      const sx = (s.x1 + s.x2) / 2 - (ux * len) / 2, sz = (s.z1 + s.z2) / 2 - (uz * len) / 2;
      for (let i = 0; i < n; i++)
        await this.place(g, model, { x: sx + ux * (i + 0.5) * w, z: sz + uz * (i + 0.5) * w, w, d: T, phi: horiz ? 0 : Math.PI / 2 }, { h: H });
    };
    // walls give way to windows / gates that overlap them (windows can be widened in the editor)
    const cut = cutWalls(walls, [...windows, ...gates]);
    await Promise.all([...cut.map((s) => tile(s, 'wall', T)), ...windows.filter((s) => !s.full).map((s) => tile(s, 'wallWindow', 0))]);
    for (const w of windows.filter((s) => s.full)) this.fullWindow(g, w, H);
    // door openings between collinear wall pieces get a frame + lintel
    for (const d of doorGaps(walls, [...windows, ...gates])) {
      const mid = (d.a + d.b) / 2, w = d.b - d.a;
      const it = d.h ? { x: mid, z: d.c, w, d: T * 1.3, phi: 0 } : { x: d.c, z: mid, w, d: T * 1.3, phi: Math.PI / 2 };
      await this.place(g, 'doorwayOpen', it, { h: 2.05 });
      this.box(d.h ? w : T, H - 2.05, d.h ? T : w, this.pm('pWall'), it.x, 2.05 + (H - 2.05) / 2, it.z, g);
    }
    g.traverse((n) => {
      const m = (n as THREE.Mesh).material as THREE.Material | undefined;
      if (m) { m.clippingPlanes = [lv.clip]; m.clipShadows = true; m.side = THREE.DoubleSide; }
    });
  }

  private async furniture(group: THREE.Group, li: number, f: FurnitureDef, M: Record<string, THREE.MeshStandardMaterial>) {
    let obj: THREE.Object3D;
    if (f.kind === 'car') obj = this.car(group, f, M);
    else if (f.model) {
      obj = await this.place(group, f.model, f, { keep: !f.fit, y: f.elev ?? 0, ...(f.height ? { h: f.height } : {}) });
      const tint = TINT[f.kind];
      if (tint != null) obj.traverse((n) => { const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.color) { m.userData.fixed = tint; this.paint(m); } });
    }
    else if (f.kind === 'sofaL') obj = this.sofaL(group, f);
    else if (BOXED[f.kind]) obj = this.boxed(group, f);
    else {
      const spec = MODEL[f.kind];
      const y = f.elev ?? (f.kind === 'ceilingFan' ? (this.house.wallHeight || 2.6) - 0.35 : ELEV[f.kind] ?? 0);
      obj = spec ? await this.place(group, spec[0], f, { ...(spec[1] ?? {}), ...(f.height ? { h: f.height } : {}), y }) : this.box(f.w, f.height ?? 0.8, f.d, M.boxm, f.x, (f.height ?? 0.8) / 2 + y, f.z, group);
      const tint = TINT[f.kind];
      if (tint != null) obj.traverse((n) => {
        const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.color) { m.userData.fixed = tint; this.paint(m); }
      });
      if (f.kind === 'tv' || f.kind === 'monitor') obj.traverse((n) => {
        const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.name === 'metal') { m.userData.fixed = 0x101216; this.paint(m); }
      });
    }
    obj.traverse((n) => { if ((n as THREE.Mesh).isMesh) { n.userData.pick = { type: 'furniture', level: li, id: f.id } satisfies Pick; this.pickables.push(n); } });
    if (f.color && /^#[0-9a-f]{6}$/i.test(f.color)) {
      const hex = parseInt(f.color.slice(1), 16);
      obj.traverse((n) => { const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.color && !m.transparent) { m.userData.fixed = hex; this.paint(m); } });
    }
    this.furnitureById.set(f.id, obj);
  }

  /** floor-to-ceiling glazing: frame, mullions every ~1 m, glass */
  private fullWindow(parent: THREE.Object3D, s: Seg, H: number) {
    const horiz = Math.abs(s.z2 - s.z1) < 1e-3, len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
    const cx = (s.x1 + s.x2) / 2, cz = (s.z1 + s.z2) / 2;
    const frame = this.pm('pDark'), fw = 0.06, fd = T * 0.9;
    const glass = new THREE.MeshStandardMaterial({ color: 0xbcd4e4, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const put = (along: number, y: number, a: number, h: number, d: number, m: THREE.Material) =>
      horiz ? this.box(a, h, d, m, cx + along, y, cz, parent) : this.box(d, h, a, m, cx, y, cz + along, parent);
    const p = put(0, H / 2, len - 0.02, H - 0.04, 0.012, glass); p.castShadow = false; p.renderOrder = 4;
    put(0, 0.025, len, 0.05, fd, frame); put(0, H - 0.03, len, 0.06, fd, frame);
    put(-len / 2 + fw / 2, H / 2, fw, H, fd, frame); put(len / 2 - fw / 2, H / 2, fw, H, fd, frame);
    const parts = Math.max(1, Math.round(len / 1.0));
    for (let i = 1; i < parts; i++) put(-len / 2 + (i * len) / parts, H / 2, 0.045, H, fd * 0.8, frame);
  }

  /** LED under every tread nose (step) or a small lamp beside every step (side) */
  private stairLeds(lv: LevelRuntime, parent: THREE.Object3D, st: StairsDef, n: number, rise: number, run: number) {
    const width = (st.axis === 'z' ? st.x1 - st.x0 : st.z1 - st.z0) - 0.06;
    const cx = (st.x0 + st.x1) / 2, cz = (st.z0 + st.z1) / 2;
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, emissive: 0, flatShading: true });
    const dir = st.top === 'min' ? 1 : -1; // towards the bottom of the flight
    for (let i = 0; i < n; i++) {
      const top = (i + 1) * rise;
      const along = st.top === 'min' ? (st.axis === 'z' ? st.z1 : st.x1) - (i + 0.5) * run : (st.axis === 'z' ? st.z0 : st.x0) + (i + 0.5) * run;
      let m: THREE.Mesh;
      if (st.ledStyle === 'side') {
        const off = width / 2 - 0.02, y = top + 0.22;
        m = st.axis === 'z' ? this.box(0.02, 0.05, 0.1, mat, cx + off, y, along, parent) : this.box(0.1, 0.05, 0.02, mat, along, y, cz + off, parent);
      } else {
        const nose = along + dir * (run / 2 - 0.03), y = top - 0.06;
        m = st.axis === 'z' ? this.box(width - 0.2, 0.012, 0.02, mat, cx, y, nose, parent) : this.box(0.02, 0.012, width - 0.2, mat, nose, y, cz, parent);
      }
      m.castShadow = false;
    }
    const lights: THREE.PointLight[] = [];
    for (const f of [0.25, 0.75]) {
      const i = Math.floor(n * f), along = st.top === 'min' ? (st.axis === 'z' ? st.z1 : st.x1) - (i + 0.5) * run : (st.axis === 'z' ? st.z0 : st.x0) + (i + 0.5) * run;
      const l = new THREE.PointLight(0xffb860, 0, 2.5, 2);
      l.position.set(st.axis === 'z' ? cx : along, (i + 1) * rise + 0.15, st.axis === 'z' ? along : cz); parent.add(l); lights.push(l);
    }
    lv.stairLeds.push({ entity: st.led!, mats: [mat], lights });
  }

  /** open stairs: treads on two inclined stringers, nothing underneath */
  private openStairs(parent: THREE.Object3D, st: StairsDef, n: number, rise: number, run: number, len: number, total: number, mat: THREE.Material) {
    const width = (st.axis === 'z' ? st.x1 - st.x0 : st.z1 - st.z0) - 0.06, t = 0.045;
    const cx = (st.x0 + st.x1) / 2, cz = (st.z0 + st.z1) / 2;
    for (let i = 0; i < n; i++) {
      const top = (i + 1) * rise;
      const along = st.top === 'min' ? (st.axis === 'z' ? st.z1 : st.x1) - (i + 0.5) * run : (st.axis === 'z' ? st.z0 : st.x0) + (i + 0.5) * run;
      if (st.axis === 'z') this.box(width - 0.12, t, run + 0.03, mat, cx, top - t / 2, along, parent);
      else this.box(run + 0.03, t, width - 0.12, mat, along, top - t / 2, cz, parent);
    }
    // stringers
    const slope = Math.atan2(total, len), L = Math.hypot(total, len), sMat = this.pm('pDark');
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      if (st.axis === 'z') {
        g.position.set(cx + side * (width / 2 - 0.03), total / 2 - 0.08, cz);
        g.rotation.x = st.top === 'min' ? slope : -slope;
        this.box(0.05, 0.26, L, sMat, 0, 0, 0, g);
      } else {
        g.position.set(cx, total / 2 - 0.08, cz + side * (width / 2 - 0.03));
        g.rotation.z = st.top === 'min' ? -slope : slope;
        this.box(L, 0.26, 0.05, sMat, 0, 0, 0, g);
      }
      parent.add(g);
    }
  }

  /** classic L-shaped corner sofa: w × d footprint, backrests along the back (−Z) and left (−X) edges, arms at both ends */
  private sofaL(parent: THREE.Object3D, f: FurnitureDef) {
    const g = new THREE.Group(); g.position.set(f.x, f.elev ?? 0, f.z); g.rotation.y = f.phi || 0; if (f.mirror) g.scale.x = -1; parent.add(g);
    const fabric = (hex: number) => { const m = this.pm('fabric'); m.userData.fixed = hex; this.paint(m); return m; };
    const seat = fabric(0x8e9298), back = fabric(0x7f838a), feet = this.pm('pDark');
    const { w, d } = f, D = Math.min(0.95, w * 0.6, d * 0.6), sh = 0.42, bh = 0.84, bt = 0.2, aw = 0.14, ah = 0.58;
    // seat: run along the back edge + run along the left edge
    this.box(w, sh - 0.06, D, seat, 0, 0.06 + (sh - 0.06) / 2, -d / 2 + D / 2, g);
    this.box(D, sh - 0.06, d - D, seat, -w / 2 + D / 2, 0.06 + (sh - 0.06) / 2, (D + 0) / 2, g);
    // backrests
    this.box(w, bh, bt, back, 0, bh / 2, -d / 2 + bt / 2, g);
    this.box(bt, bh, d - bt, back, -w / 2 + bt / 2, bh / 2, bt / 2, g);
    // headrests along the back (as on the photo: adjustable headrests)
    for (let i = 0; i < 2; i++) this.box(0.55, 0.16, 0.18, back, -w / 2 + bt + 0.4 + i * 0.6, bh + 0.08, -d / 2 + bt / 2 + 0.02, g);
    for (let i = 0; i < 2; i++) this.box(0.18, 0.16, 0.55, back, -w / 2 + bt / 2 + 0.02, bh + 0.08, -d / 2 + bt + 0.6 + i * 0.6, g);
    // arms at the two open ends
    this.box(aw, ah, D, back, w / 2 - aw / 2, ah / 2, -d / 2 + D / 2, g);
    this.box(D, ah, aw, back, -w / 2 + D / 2, ah / 2, d / 2 - aw / 2, g);
    // seat cushion seams
    const seam = fabric(0x6f737a);
    this.box(0.012, 0.01, D - 0.2, seam, -w / 2 + D, sh + 0.001, -d / 2 + D / 2 + 0.1, g);
    this.box(D - 0.2, 0.01, 0.012, seam, -w / 2 + D / 2 + 0.1, sh + 0.001, -d / 2 + D, g);
    for (const [fx, fz] of [[w / 2 - 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + D - 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [-w / 2 + D - 0.1, d / 2 - 0.1], [-w / 2 + 0.1, -d / 2 + 0.1]])
      this.box(0.05, 0.06, 0.05, feet, fx, 0.03, fz, g);
    return g;
  }

  /** rack / PC / printer / shredder: a body with a front detail, rotated like models (front = +Z) */
  private boxed(parent: THREE.Object3D, f: FurnitureDef) {
    const [mat, h] = BOXED[f.kind]!;
    const y = f.elev ?? ELEV[f.kind] ?? 0;
    const g = new THREE.Group(); g.position.set(f.x, y, f.z); g.rotation.y = f.phi || 0; parent.add(g);
    this.box(f.w, h, f.d, this.pm(mat), 0, h / 2, 0, g);
    if (f.kind === 'rack') {
      this.box(f.w - 0.08, h - 0.12, 0.012, this.pm('pConcrete'), 0, h / 2, f.d / 2 + 0.006, g);
      const led = new THREE.MeshStandardMaterial({ color: 0x3a7bff, emissive: 0x2a5bff, emissiveIntensity: 1.2, flatShading: true });
      this.box(0.03, 0.02, 0.01, led, -f.w / 4, h * 0.62, f.d / 2 + 0.014, g);
      this.box(0.03, 0.02, 0.01, new THREE.MeshStandardMaterial({ color: 0x4cff7a, emissive: 0x2acc55 }), f.w / 5, h * 0.18, f.d / 2 + 0.014, g);
    } else if (f.kind === 'acUnit') {
      this.box(f.w - 0.08, 0.04, 0.02, this.pm('pDark'), 0, 0.08, f.d / 2 + 0.01, g);
    } else if (f.kind === 'printer') {
      this.box(f.w * 0.8, 0.02, f.d * 0.5, this.pm('pDark'), 0, h + 0.01, -f.d * 0.1, g);
    } else if (f.kind === 'pc') {
      this.box(0.02, 0.02, 0.01, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88aaff }), 0, h - 0.05, f.d / 2 + 0.005, g);
    }
    return g;
  }

  private car(parent: THREE.Object3D, it: FurnitureDef, M: Record<string, THREE.MeshStandardMaterial>) {
    const g = new THREE.Group(); g.position.set(it.x, 0, it.z); g.rotation.y = it.phi || 0; parent.add(g);
    const L = Math.min(it.d, 4.6) - 0.1, W = Math.min(it.w, 1.9) - 0.12;
    this.box(W, 0.55, L, M.car, 0, 0.5, 0, g);
    this.box(W - 0.18, 0.48, L * 0.48, M.car, 0, 1.0, -L * 0.06, g);
    this.box(W - 0.16, 0.36, L * 0.46, M.dark, 0, 1.0, -L * 0.06, g).scale.set(1.01, 1, 0.96);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14), M.tire);
      w.rotation.z = Math.PI / 2; w.position.set(sx * (W / 2 - 0.05), 0.33, sz * (L / 2 - 0.75)); w.castShadow = true; g.add(w);
    }
    return g;
  }

  private async roomLight(lv: LevelRuntime, r: RoomDef, H: number) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, model = r.lightModel ?? 'lamp';
    const mats: THREE.MeshStandardMaterial[] = [];
    const lights: THREE.PointLight[] = [];
    let lamp: THREE.Object3D;
    if (model === 'spots' || model === 'spots8' || model === 'spotsLine') {
      const sp = this.spots(lv.group, cx, cz, H, model === 'spotsLine' ? 'line' : model === 'spots8' ? 'grid8' : 'square', 0); lamp = sp.root; mats.push(...sp.glow);
    } else if (model === 'downlights') {
      const n = Math.max(1, Math.min(24, r.lightCount ?? 8));
      const wx = r.x1 - r.x0, wz = r.z1 - r.z0, alongX = wx >= wz;
      const rows = n <= 3 ? 1 : n <= 12 ? 2 : 3, cols = Math.ceil(n / rows);
      const mL = Math.min(0.9, (alongX ? wx : wz) * 0.18), mS = Math.min(0.9, (alongX ? wz : wx) * 0.22);
      const grp = new THREE.Group(); lv.group.add(grp); lamp = grp;
      const trim = this.pm('pAc');
      const pos: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / cols), col = i % cols, inRow = Math.min(cols, n - row * cols);
        const a = inRow === 1 ? 0.5 : col / (inRow - 1), b = rows === 1 ? 0.5 : row / (rows - 1);
        const L0 = (alongX ? r.x0 : r.z0) + mL, L1 = (alongX ? r.x1 : r.z1) - mL, S0 = (alongX ? r.z0 : r.x0) + mS, S1 = (alongX ? r.z1 : r.x1) - mS;
        const u = L0 + (L1 - L0) * a, v = S0 + (S1 - S0) * b;
        pos.push(alongX ? [u, v] : [v, u]);
      }
      const bulb = new THREE.MeshStandardMaterial({ color: 0xfff6e6, emissive: 0, flatShading: true });
      for (const [x, z] of pos) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 16), trim); ring.position.set(x, H - 0.006, z); grp.add(ring);
        const disk = new THREE.Mesh(new THREE.CircleGeometry(0.042, 16), bulb); disk.rotation.x = Math.PI / 2; disk.position.set(x, H - 0.013, z); grp.add(disk);
      }
      mats.push(bulb);
      // a few real lights for the illumination (one per ~2 spots, max 4)
      const nl = Math.min(4, Math.ceil(n / 2));
      for (let i = 0; i < nl; i++) {
        const [x, z] = pos[Math.floor((i + 0.5) * pos.length / nl)];
        const l = new THREE.PointLight(0xffd29a, 0, 5, 2); l.position.set(x, H - 0.5, z); lv.group.add(l); lights.push(l);
      }
    } else if (model === 'none') {
      lamp = new THREE.Group(); lamp.position.set(cx, H - 0.05, cz); lv.group.add(lamp);
    } else {
      lamp = await this.place(lv.group, 'lampSquareCeiling', { x: cx, z: cz }, { keep: true, y: H - 0.46 });
      lamp.traverse((n) => { const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.name === 'lamp') mats.push(m); });
    }
    if (!lights.length) { const light = new THREE.PointLight(0xffd29a, 0, 6, 2); light.position.set(cx, H - 0.6, cz); lv.group.add(light); lights.push(light); }
    lamp.traverse((n) => { if ((n as THREE.Mesh).isMesh) { n.userData.pick = { type: 'room', level: this.levels.indexOf(lv), room: r } satisfies Pick; this.pickables.push(n); } });
    lv.roomLights.push({ room: r, lamp, mats, lights, power: 12 / Math.sqrt(lights.length) });
  }

  /** ceiling fixture of joined spots: 2×2 on a square plate, 2×4 on a long plate, or 4 in a line on a bar */
  private spots(parent: THREE.Object3D, x: number, z: number, H: number, layout: 'square' | 'grid8' | 'line', phi: number) {
    const g = new THREE.Group(); g.position.set(x, H, z); g.rotation.y = phi; parent.add(g);
    const body = this.pm('pDark'), glow: THREE.MeshStandardMaterial[] = [];
    const pos: [number, number][] = layout === 'line' ? [[-0.27, 0], [-0.09, 0], [0.09, 0], [0.27, 0]]
      : layout === 'grid8' ? [-0.27, -0.09, 0.09, 0.27].flatMap((px) => [[px, -0.09], [px, 0.09]] as [number, number][])
      : [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]];
    const pw = layout === 'square' ? 0.34 : 0.7 + 0.08, pd = layout === 'line' ? 0.07 : 0.34;
    this.box(pw, 0.03, pd, body, 0, -0.015, 0, g);
    for (const [px, pz] of pos) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.11, 14), body);
      can.position.set(px, -0.085, pz); can.castShadow = true; g.add(can);
      const bulb = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0, flatShading: true });
      const disk = new THREE.Mesh(new THREE.CircleGeometry(0.035, 14), bulb); disk.rotation.x = Math.PI / 2; disk.position.set(px, -0.142, pz); g.add(disk);
      glow.push(bulb);
    }
    return { root: g, glow };
  }

  private async device(d: HouseDevice, H: number) {
    const lv = this.levels[d.level]; if (!lv) return;
    const g = lv.group;
    let root: THREE.Object3D; const glow: THREE.MeshStandardMaterial[] = []; const lights: THREE.PointLight[] = []; let flow: THREE.MeshBasicMaterial | undefined; let power: number | undefined;
    const collect = (o: THREE.Object3D, name: string) => o.traverse((n) => { const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial; if (m?.name === name) glow.push(m); });
    switch (d.kind) {
      case 'light': {
        const model = d.model ?? 'ceiling', phi = d.phi ?? 0, fx = Math.sin(phi), fz = Math.cos(phi);
        const lamp = (y: number) => { const l = new THREE.PointLight(0xffc98a, 0, 7, 2); l.position.set(d.x, y, d.z); g.add(l); lights.push(l); return l; };
        if (model === 'none') {
          root = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.pm('lamp', { color: 0xfff3d6 }));
          root.position.set(d.x, d.y ?? 2.2, d.z); g.add(root); glow.push((root as THREE.Mesh).material as THREE.MeshStandardMaterial);
          lamp(d.y ?? 2.2); power = 8;
        } else if (model === 'spots' || model === 'spots8' || model === 'spotsLine') {
          const sp = this.spots(g, d.x, d.z, d.y ?? H, model === 'spotsLine' ? 'line' : model === 'spots8' ? 'grid8' : 'square', phi);
          root = sp.root; glow.push(...sp.glow); lamp((d.y ?? H) - 0.4); power = 10;
        } else if (model === 'pendant') {
          const y = d.y ?? H - 0.8, grp = new THREE.Group(); grp.position.set(d.x, y, d.z); g.add(grp);
          this.box(0.012, H - y - 0.25, 0.012, this.pm('pDark'), 0, (H - y) / 2 + 0.12, 0, grp);
          const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.3, 18, 1, true), this.pm('pDark', { side: THREE.DoubleSide }));
          shade.castShadow = true; grp.add(shade);
          const bulb = this.pm('lamp', { color: 0xfff3d6 });
          const disk = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18), bulb); disk.rotation.x = Math.PI / 2; disk.position.y = -0.12; grp.add(disk);
          glow.push(bulb); root = grp; lamp(y - 0.3); power = 7;
        } else if (model === 'strip') {
          const len = d.length ?? 1, y = d.y ?? 0.05, grp = new THREE.Group(); grp.position.set(d.x, y, d.z); grp.rotation.y = phi; g.add(grp);
          const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0, flatShading: true });
          this.box(len, 0.014, 0.03, mat, 0, 0, 0, grp); glow.push(mat); root = grp;
          const n = Math.max(1, Math.round(len / 1.5));
          for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n - 0.5, l = new THREE.PointLight(0xffc98a, 0, 2.2, 2);
            l.position.set(d.x + Math.cos(phi) * t * len + fx * 0.05, y + 0.06, d.z - Math.sin(phi) * t * len + fz * 0.05); g.add(l); lights.push(l);
          }
          power = 3 / n;
        } else {
          const spec: Record<string, [string, number]> = { ceiling: ['lampSquareCeiling', H - 0.46], floor: ['lampSquareFloor', 0], table: ['lampRoundTable', 0.75], wall: ['lampWall', 1.7] };
          const [name, y0] = spec[model] ?? spec.ceiling, y = d.y ?? y0;
          root = await this.place(g, name, { x: d.x, z: d.z, phi }, { keep: true, y });
          collect(root, 'lamp');
          const ly = model === 'ceiling' ? H - 0.6 : model === 'floor' ? 1.45 : model === 'table' ? y + 0.35 : y + 0.1;
          const l = lamp(ly); if (model === 'wall') l.position.set(d.x + fx * 0.2, ly, d.z + fz * 0.2);
          power = { ceiling: 11, floor: 12, table: 6, wall: 7 }[model] ?? 10;
        }
        break;
      }
      case 'tv': {
        root = await this.place(g, 'televisionModern', { x: d.x, z: d.z, phi: d.phi }, { keep: true, y: d.y ?? 0.62 });
        collect(root, 'metal'); // the screen
        glow.forEach((m) => { m.userData.fixed = 0x101216; this.paint(m); });
        const l = new THREE.PointLight(0x6fa8ff, 0, 3.5, 2);
        l.position.set(d.x + Math.sin(d.phi ?? 0) * 0.5, (d.y ?? 0.62) + 0.4, d.z + Math.cos(d.phi ?? 0) * 0.5); g.add(l); lights.push(l);
        break;
      }
      case 'speaker':
        if (d.model === 'ceiling') {
          // round in-ceiling speaker: white rim, grille that lights up while playing
          const grp = new THREE.Group(); grp.position.set(d.x, d.y ?? H, d.z); g.add(grp);
          const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 24), this.pm('pAc')); rim.position.y = -0.006; grp.add(rim);
          const grille = new THREE.MeshStandardMaterial({ color: 0xd9dade, emissive: 0, flatShading: true });
          const gm = new THREE.Mesh(new THREE.CircleGeometry(0.105, 24), grille); gm.rotation.x = Math.PI / 2; gm.position.y = -0.014; grp.add(gm);
          glow.push(grille); root = grp;
        } else {
          root = await this.place(g, 'speaker', { x: d.x, z: d.z, phi: d.phi }, { keep: true, y: d.y ?? 0 });
          collect(root, 'metalMedium');
        }
        break;
      case 'ac': {
        const grp = new THREE.Group();
        const led = new THREE.MeshStandardMaterial({ color: 0x9fd0ff, flatShading: true });
        this.box(0.92, 0.3, 0.22, this.pm('pAc', { roughness: 0.6 }), 0, 0, 0, grp);
        this.box(0.84, 0.04, 0.02, this.pm('pDark'), 0, -0.1, 0.112, grp);
        this.box(0.06, 0.02, 0.01, led, 0.36, 0.08, 0.112, grp);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.4, -0.12, 0.12, 0.4, -0.12, 0.12, 0.7, -1.1, 1.5, -0.4, -0.12, 0.12, 0.7, -1.1, 1.5, -0.7, -1.1, 1.5], 3));
        flow = new THREE.MeshBasicMaterial({ color: 0x8fc4ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
        const fm = new THREE.Mesh(geo, flow); fm.raycast = () => {}; fm.renderOrder = 3; grp.add(fm);
        grp.position.set(d.x, d.y ?? 2.25, d.z); grp.rotation.y = d.phi ?? 0; g.add(grp);
        glow.push(led); root = grp;
        break;
      }
      default: {
        root = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), this.pm('marker', { color: 0x8fb4ff, emissive: 0x1a2a44 }));
        root.position.set(d.x, d.y ?? 1.2, d.z); g.add(root); glow.push((root as THREE.Mesh).material as THREE.MeshStandardMaterial);
      }
    }
    root.traverse((n) => { if ((n as THREE.Mesh).isMesh) { n.userData.pick = { type: 'device', device: d } satisfies Pick; this.pickables.push(n); } });
    this.devices.push({ def: d, root, glow, lights, flow, levelGroup: g, power });
  }

  // ------------------------------------------------------------------ state → scene
  private applyStates() {
    const get = this.states;
    for (const lv of this.levels) {
      for (const rl of lv.roomLights) {
        const s = get(rl.room.light!); const on = s?.state === 'on';
        const k = on ? (s?.attributes.brightness ?? 255) / 255 : 0;
        const col = lightColor(s);
        rl.lights.forEach((l) => { l.intensity = rl.power * k; l.color.copy(col); });
        rl.mats.forEach((m) => { if (on) m.emissive.copy(col); else m.emissive.setHex(0); });
      }
      for (const h of lv.heat) {
        const t = roomTemperature(h.room, get);
        h.mesh.visible = this.opts.heatmap && isFinite(t);
        if (isFinite(t)) (h.mesh.material as THREE.MeshBasicMaterial).color.copy(tempColor(t));
      }
      for (const sl of lv.stairLeds) {
        const st = get(sl.entity), on = !!st && ACTIVE.has(st.state), k = on ? (st?.attributes.brightness ?? 255) / 255 : 0, col = lightColor(st);
        sl.mats.forEach((m) => { if (on) m.emissive.copy(col); else m.emissive.setHex(0); m.emissiveIntensity = on ? 0.6 + k : 1; });
        sl.lights.forEach((l) => { l.intensity = 3 * k; l.color.copy(col); });
      }
      for (const gt of lv.gates) {
        const s = gt.seg.entity ? get(gt.seg.entity) : undefined;
        const pos = s ? (s.attributes.current_position ?? (s.state === 'open' ? 100 : s.state === 'opening' || s.state === 'closing' ? 50 : 0)) : 0;
        const open = Math.max(0, Math.min(1, pos / 100));
        gt.panel.scale.y = Math.max(0.06, 1 - open); gt.panel.position.y = 2.3 - (2.3 * gt.panel.scale.y) / 2;
      }
    }
    for (const d of this.devices) {
      const s = get(d.def.entity), on = !!s && ACTIVE.has(s.state);
      switch (d.def.kind) {
        case 'light': {
          const k = on ? (s?.attributes.brightness ?? 255) / 255 : 0, col = lightColor(s);
          d.lights.forEach((l) => { l.intensity = (d.power ?? 11) * k; l.color.copy(col); });
          d.glow.forEach((m) => { if (on) m.emissive.copy(col); else m.emissive.setHex(0); m.emissiveIntensity = on ? 0.5 + k : 1; });
          break;
        }
        case 'tv': d.glow.forEach((m) => m.emissive.setHex(on ? 0x4a86d0 : 0)); d.lights.forEach((l) => (l.intensity = on ? 4 : 0)); break;
        case 'speaker': d.glow.forEach((m) => m.emissive.setHex(s?.state === 'playing' ? 0x3a2608 : 0)); break;
        case 'ac': {
          const v = acVisual(d.def.entity || undefined, d.def.climate, get);
          d.glow.forEach((m) => m.emissive.setHex(!v.on ? 0 : v.heat ? 0xff9a3a : 0x4aa3ff));
          if (d.flow) { d.flow.color.setHex(v.heat ? 0xffb070 : 0x8fc4ff); d.flow.opacity = v.running ? 0.22 : 0; }
          break;
        }
        default: d.glow.forEach((m) => m.emissive.setHex(on ? 0x335599 : 0x0c1422));
      }
    }
    this.render();
    this.animate();
  }

  /** the only continuous animation: AC airflow; off in Lite / reduced motion */
  private animate() {
    const wants = () => !this.disposed && !this.opts.lite && !matchMedia('(prefers-reduced-motion: reduce)').matches && this.devices.some((d) => d.flow && d.flow.opacity > 0);
    if (this.animating || !wants()) return;
    this.animating = true;
    const t0 = performance.now();
    const frame = (t: number) => {
      if (!wants()) { this.animating = false; return; }
      for (const d of this.devices) if (d.flow && d.flow.opacity > 0) d.flow.opacity = 0.12 + 0.16 * (0.5 + 0.5 * Math.sin((t - t0) / 450));
      this.renderer.render(this.scene, this.camera); this.cb.onFrame?.();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ options / camera
  private applyOpts() {
    const o = this.opts;
    this.levels.forEach((lv, i) => {
      lv.group.visible = o.level === 'all' || o.level === i;
      lv.group.position.y = o.level === 'all' ? this.house.levels[i].y + i * 3.5 : this.house.levels[i].y;
      const wallH = o.lowWalls ? 1.15 : (this.house.wallHeight || 2.6) + 0.05;
      lv.clip.constant = lv.group.position.y + wallH;
      lv.heat.forEach((h) => (h.mesh.visible = o.heatmap && h.mesh.visible));
    });
    this.mats.forEach((m) => this.paint(m));
    this.controls.enabled = o.orbit;
    const now = new Date(), hour = now.getHours() + now.getMinutes() / 60;
    const day = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 14));
    this.sun.intensity = 0.15 + day * 2.4; this.hemi.intensity = 0.35 + day * 0.9;
    this.sun.castShadow = !o.lite;
    this.renderer.setPixelRatio(o.lite ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.applyStates();
    this.fit();
  }

  private viewBox() {
    const b = new THREE.Box3();
    this.levels.forEach((lv, i) => {
      if (!lv.group.visible) return;
      const y = lv.group.position.y;
      for (const r of this.house.levels[i].rooms) {
        b.expandByPoint(new THREE.Vector3(r.x0, y, r.z0));
        b.expandByPoint(new THREE.Vector3(r.x1, y + (this.opts.lowWalls ? 1.15 : 2), r.z1));
      }
    });
    if (b.isEmpty()) b.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 2, 5));
    return b;
  }
  private dir() {
    const az = (this.opts.camera.az * Math.PI) / 180, el = (Math.max(10, Math.min(89, this.opts.camera.el)) * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }
  private fitDistance(dir: THREE.Vector3) {
    const b = this.viewBox(), c = new THREE.Vector3(); b.getCenter(c);
    const corners: THREE.Vector3[] = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
    let lo = 1, hi = 200;
    const cam = this.camera.clone();
    for (let i = 0; i < 24; i++) {
      const d = (lo + hi) / 2;
      cam.position.copy(c).addScaledVector(dir, d); cam.lookAt(c); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const ok = corners.every((p) => { const v = p.clone().project(cam); return Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88; });
      if (ok) hi = d; else lo = d;
    }
    return hi;
  }
  fit() {
    const b = this.viewBox(), c = new THREE.Vector3(); b.getCenter(c);
    const dir = this.dir();
    const d = this.fitDistance(dir) / Math.max(0.3, this.opts.camera.zoom || 1);
    this.controls.target.copy(c); this.camera.position.copy(c).addScaledVector(dir, d);
    this.controls.minDistance = 2; this.controls.maxDistance = d * 4;
    this.controls.update(); this.render();
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.fov = w / h < 1 ? 44 : 30; this.camera.updateProjectionMatrix();
    this.fit();
  }

  // ------------------------------------------------------------------ picking
  private bindPointer() {
    const el = this.renderer.domElement, ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let down: [number, number] | null = null;
    const hit = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, this.camera);
      const visible = this.pickables.filter((o) => { let p: THREE.Object3D | null = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; });
      return ray.intersectObjects(visible, false)[0];
    };
    // ---- drag (editor)
    type Drag = { type: 'furniture' | 'device'; id: string; level: number; t: NonNullable<ReturnType<HouseScene['target']>>; from: THREE.Vector3[];
      plane: THREE.Plane; grab: THREE.Vector3; sx: number; sy: number; moved: boolean; x: number; z: number; pid: number };
    let drag: Drag | null = null;
    const onPlane = (e: PointerEvent, plane: THREE.Plane) => {
      const r = el.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, this.camera);
      const v = new THREE.Vector3();
      return ray.ray.intersectPlane(plane, v) ? v : null;
    };
    el.addEventListener('pointerdown', (e) => {
      if (!this.dragEnabled || e.button > 0) return;
      const h = hit(e); const p = h?.object.userData.pick as Pick | undefined;
      if (!p || (p.type !== 'furniture' && p.type !== 'device')) return;
      const type = p.type, id = p.type === 'furniture' ? p.id : p.device.id;
      const t = this.target(type, id); if (!t) return;
      const ly = this.levels[t.level]?.group.position.y ?? 0;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ly);
      const grab = onPlane(e, plane); if (!grab) return;
      drag = { type, id, level: t.level, t, from: t.objs.map((o) => o.position.clone()), plane, grab, sx: e.clientX, sy: e.clientY, moved: false, x: t.x, z: t.z, pid: e.pointerId };
      this.controls.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pid) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      if (!drag.moved) { drag.moved = true; this.select(drag.id); el.style.cursor = 'grabbing'; }
      const pt = onPlane(e, drag.plane); if (!pt) return;
      const step = e.shiftKey ? 0.01 : 0.05;
      let x = Math.round((drag.t.x + pt.x - drag.grab.x) / step) * step, z = Math.round((drag.t.z + pt.z - drag.grab.z) / step) * step;
      if (drag.t.f && !e.altKey) ({ x, z } = this.snapToWalls(drag.level, drag.t.f, x, z));
      drag.x = +x.toFixed(3); drag.z = +z.toFixed(3);
      this.shift(drag.t, drag.x - drag.t.x, drag.z - drag.t.z, drag.from);
    });
    const endDrag = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const d = drag; drag = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.controls.enabled = this.opts.orbit;
      el.style.cursor = '';
      if (d.moved && (d.x !== d.t.x || d.z !== d.t.z)) this.cb.onMove?.({ type: d.type, id: d.id, level: d.level, x: d.x, z: d.z });
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) { down = null; return; }
      down = null;
      const h = hit(e); if (!h) return;
      const p = h.object.userData.pick as Pick | undefined;
      if (!p) return;
      if (p.type === 'room') {
        // a click on the floor also reports the point (used to place devices in the editor)
        const lv = this.levels[p.level];
        this.cb.onPick?.({ type: 'floor', level: p.level, x: +h.point.x.toFixed(2), z: +h.point.z.toFixed(2) });
        void lv;
      }
      this.cb.onPick?.(p);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      const p = hit(e)?.object.userData.pick as Pick | undefined;
      el.style.cursor = p ? (this.dragEnabled && (p.type === 'furniture' || p.type === 'device') ? 'move' : 'pointer') : this.opts.orbit ? 'grab' : 'default';
    });
  }
}

/** colour of a light entity (rgb_color, or warm white) */
function lightColor(s?: HassState) {
  const c = s?.attributes.rgb_color;
  return Array.isArray(c) && c.length >= 3 ? new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255) : new THREE.Color(0xffb860);
}

function tempColor(t: number) { const k = Math.min(1, Math.max(0, (t - 19) / 5)); return new THREE.Color().setHSL(0.6 - 0.52 * k, 0.75, 0.55); }

/** Wall segments minus the parts covered by collinear windows / gates. */
export function cutWalls(walls: Seg[], holes: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const w of walls) {
    const horiz = Math.abs(w.z2 - w.z1) < 1e-3;
    const c = horiz ? w.z1 : w.x1, a0 = horiz ? Math.min(w.x1, w.x2) : Math.min(w.z1, w.z2), a1 = horiz ? Math.max(w.x1, w.x2) : Math.max(w.z1, w.z2);
    let parts: [number, number][] = [[a0, a1]];
    for (const h of holes) {
      const hh = Math.abs(h.z2 - h.z1) < 1e-3; if (hh !== horiz) continue;
      if (Math.abs((hh ? h.z1 : h.x1) - c) > 0.1) continue;
      const b0 = hh ? Math.min(h.x1, h.x2) : Math.min(h.z1, h.z2), b1 = hh ? Math.max(h.x1, h.x2) : Math.max(h.z1, h.z2);
      parts = parts.flatMap(([p0, p1]) => (b1 <= p0 || b0 >= p1 ? [[p0, p1]] : [[p0, b0], [b1, p1]].filter(([q0, q1]) => q1 - q0 > 0.02)) as [number, number][]);
    }
    for (const [p0, p1] of parts) out.push(horiz ? { x1: p0, z1: c, x2: p1, z2: c } : { x1: c, z1: p0, x2: c, z2: p1 });
  }
  return out;
}

/** Gaps 0.55–1.25 m between collinear wall pieces that are not windows/gates → doors. */
export function doorGaps(walls: Seg[], blockers: Seg[]) {
  const norm = (s: Seg) => { const h = Math.abs(s.z2 - s.z1) < 1e-3; return h ? { h, c: s.z1, a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2) } : { h, c: s.x1, a: Math.min(s.z1, s.z2), b: Math.max(s.z1, s.z2) }; };
  const segs = walls.map(norm), bl = blockers.map(norm), out: { h: boolean; c: number; a: number; b: number }[] = [];
  for (const p of segs) for (const q of segs) {
    if (p.h !== q.h || Math.abs(p.c - q.c) > 0.03) continue;
    const gap = q.a - p.b; if (gap < 0.55 || gap > 1.25) continue;
    if (segs.some((r) => r.h === p.h && Math.abs(r.c - p.c) < 0.03 && r.a < q.a - 0.01 && r.b > p.b + 0.01)) continue;
    const mid = (p.b + q.a) / 2;
    if (bl.some((w) => w.h === p.h && Math.abs(w.c - p.c) < 0.12 && w.a < mid && w.b > mid)) continue;
    out.push({ h: p.h, c: p.c, a: p.b, b: q.a });
  }
  return out;
}
