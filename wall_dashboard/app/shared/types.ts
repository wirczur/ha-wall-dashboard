// Shared data model: used by the server (storage, validation, permissions) and the web app (rendering).

export interface HassState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

/** What happens on tap / hold. */
export type ActionDef =
  | { type: 'none' }
  | { type: 'toggle'; entity?: string }
  | { type: 'service'; service: string; entity?: string; data?: Record<string, unknown> }
  | { type: 'view'; view: string }
  | { type: 'dashboard'; dashboard: string }
  | { type: 'panel'; panel: PanelDef }
  | { type: 'url'; url: string }
  /** set several entities to given values at once (e.g. a ventilation preset) */
  | { type: 'set'; steps: SetStep[] }
  /** turn off everything that is on (entities, or the widget's "count on" list + its entity); onIfNone = turn them on when nothing is on */
  | { type: 'allOff'; entities?: string[]; onIfNone?: boolean }
  /** show the pop-up of a trigger (e.g. the gate camera with "open" / "reject") on this tablet */
  | { type: 'popup'; trigger: string }
  /** quiet mode of this panel (no sounds): toggle / on / off, optionally for N minutes */
  | { type: 'quiet'; mode: 'toggle' | 'on' | 'off'; minutes?: number };

/** One value to set. value: number (%, °C, position…), "on"/"off", an option / mode / preset name. */
export interface SetStep { entity: string; value: string }

/** How one entity is presented inside a panel. 'auto' picks by domain. */
export type RowDisplay = 'auto' | 'toggle' | 'slider' | 'value' | 'buttons' | 'graph' | 'camera' | 'levels';

export interface PanelRow {
  entity: string;
  name?: string;
  icon?: string;
  display?: RowDisplay;
  /** show an attribute instead of the state (display 'value') */
  attribute?: string;
  /** history window for display 'graph' */
  hours?: number;
  /** camera rows: show the talk (microphone) button */
  talk?: boolean;
  /** grid layout: how many columns this row takes (0 = whole width) */
  span?: number;
  /** light rows: hide effects / colours / white temperature */
  noExtras?: boolean;
}

export interface PanelDef {
  title?: string;
  subtitle?: string;
  rows: PanelRow[];
  /** show the remote of this TV (TvDef.id) above the rows */
  remote?: string;
  /** a widget shown full-size above the rows (e.g. the large thermostat opened from a small tile) */
  widget?: WidgetDef;
  /** panel width: normal 400 px, wide ~680 px, large ~1100 px, full screen; auto = wide when it has 2+ cameras */
  size?: 'auto' | 'normal' | 'wide' | 'large' | 'full';
  /** rows one under another, or in a grid */
  layout?: 'auto' | 'list' | 'grid';
  /** grid columns (default 2) */
  columns?: number;
  /** slide in from the side, or open in the centre of the screen */
  mode?: 'side' | 'center';
  /** show the widgets of this view (of the same dashboard) in the panel, laid out like on the dashboard */
  view?: string;
}

// ---- thermostat / air-conditioner widget ("climate")
export type ClimateRole =
  | 'current' | 'humidity' | 'target' | 'mode' | 'action' | 'power' | 'fan' | 'swing' | 'preset'
  | 'nextTime' | 'nextTarget' | 'overrideTarget';
export interface ClimateRef {
  entity: string;
  /** read this attribute instead of the state ('state' forces the state of a climate entity) */
  attribute?: string;
  /** write with this service instead of the default for the domain, e.g. script.tech_override */
  service?: string;
  /** data field for the value when `service` is set (default "value"; scripts get it in variables) */
  serviceField?: string;
}
export type ModeKind = 'manual' | 'schedule' | 'off' | 'heat' | 'cool' | 'auto' | 'dry' | 'fan' | 'eco' | 'comfort' | 'away' | 'boost' | 'other';
export interface ModeOption { value: string; label?: string; kind?: ModeKind; icon?: string; hidden?: boolean }
export interface ClimateExtra extends ClimateRef { label?: string; unit?: string; decimals?: number }
/** extra AC function: ionizer, air purification, sleep, eco, display light… (switch / select / button of the AC device) */
export interface ClimateFeature { entity: string; label?: string; icon?: string }
export interface ClimateOptions {
  /** extra functions shown as buttons (large layout / panel) */
  features?: ClimateFeature[];
  /** labels, icons and defaults */
  kind?: 'thermostat' | 'ac';
  /** 'climate' = the widget entity fills every role not set explicitly; 'entities' = roles only */
  source?: 'climate' | 'entities';
  layout?: 'auto' | 'small' | 'medium' | 'large' | 'bar';
  roles?: Partial<Record<ClimateRole, ClimateRef>>;
  extras?: ClimateExtra[];
  /** order, names, kinds and visibility of modes; empty = taken from the entity */
  modes?: ModeOption[] | string[];
  fanModes?: ModeOption[];
  swingModes?: ModeOption[];
  presetModes?: ModeOption[];
  step?: number; min?: number; max?: number; decimals?: number;
  /** ms after the last −/+ before the value is sent */
  debounce?: number;
  /** −/+ while the schedule runs */
  scheduleBehavior?: 'switch' | 'lock' | 'override';
  /** −/+ while switched off */
  offBehavior?: 'lock' | 'switch';
  /** mode value used when switching to manual / turning on */
  manualMode?: string;
  /** states of the "action" role that mean working (default: on, heating, cooling, numbers > 0 …) */
  activeStates?: string[];
  /** guess "heating" from target vs current when there is no action role */
  inferAction?: boolean;
  modeControl?: 'auto' | 'buttons' | 'cycle' | 'hidden';
  modeIcons?: boolean;
  showPower?: boolean; showHumidity?: boolean; showExtras?: boolean; showAction?: boolean; showIdle?: boolean;
  showFan?: boolean; showSwing?: boolean; showPreset?: boolean;
  showNext?: 'schedule' | 'always' | 'never';
  targetLabel?: string;
  /** tap on the small layout */
  smallTap?: 'panel' | 'cycle' | 'power' | 'none';
}

export interface WidgetStyle {
  background?: string;
  color?: string;
  accent?: string;
  radius?: number;
  /** 0..1, background opacity of the tile */
  opacity?: number;
  fontScale?: number;
  /** horizontal alignment of the tile content; undefined = the widget's own layout */
  align?: 'start' | 'center' | 'end';
  /** vertical alignment of the tile content; undefined = the widget's own layout */
  valign?: 'top' | 'center' | 'bottom';
  border?: boolean;
  padding?: number;
  hideTitle?: boolean;
}

export type WidgetType =
  | 'clock' | 'date' | 'value' | 'temperature' | 'climate'
  | 'button' | 'text' | 'image' | 'iframe' | 'camera' | 'house3d' | 'remote' | 'media' | 'calendar' | 'waste' | 'levels' | 'timer' | 'irrigation' | 'purifier' | 'device' | 'schedules' | 'alarm' | 'robot' | 'septic' | 'intercom' | 'calls' | 'ups';

// ---- Samsung TV controlled directly over the LAN (not through HA)
/** via (Home Assistant TVs only): 'source' = media_player.select_source, 'app' = play_media with a Samsung app id */
export interface TvApp { appId: string; name: string; type?: number; via?: 'source' | 'app' }
export interface TvDef {
  id: string;
  name: string;
  host: string;
  /** for Wake-on-LAN */
  mac?: string;
  /** WoL target, default: x.x.x.255 of the TV address */
  broadcast?: string;
  /** pairing token from the TV (8002/wss) */
  token?: string;
  /** app shortcuts shown on the remote */
  apps: TvApp[];
  model?: string;
}
export type TvAction =
  | { action: 'key'; key: string; hold?: boolean }
  | { action: 'app'; appId: string; appType?: number }
  | { action: 'power' }
  | { action: 'status' };
/** what a scene does with a TV of the add-on (remote): power, then an app / source shortcut (name or id) and keys */
export interface TvStep { tv: string; power?: 'on' | 'off'; app?: string; keys?: string[] }
export interface TvStatus { power: 'on' | 'standby' | 'off'; name?: string; model?: string }

// ---- 3D house (imported from SVG floor plans) — all lengths in metres, X = right, Z = down the plan
export interface Seg {
  x1: number; z1: number; x2: number; z2: number;
  entity?: string;
  /** windows: glazing from floor to ceiling (patio / panoramic window) */
  full?: boolean;
}
export interface RectM { x0: number; z0: number; x1: number; z1: number }
export interface RoomDef extends RectM {
  name: string;
  area?: number;
  /** label position */
  lx: number; lz: number;
  temperature?: string;
  humidity?: string;
  climate?: string;
  /** thermostat built from several entities (same options as the climate widget) */
  thermostat?: ClimateOptions;
  light?: string;
  /** look of the ceiling light: lamp (default), 4 joined spots in a square / in a line, or only the glow */
  lightModel?: 'lamp' | 'downlights' | 'spots' | 'spots8' | 'spotsLine' | 'none';
  /** number of recessed downlights spread over the ceiling (lightModel 'downlights', default 8) */
  lightCount?: number;
  hidden?: boolean;
}
export type FurnitureKind =
  | 'table' | 'chair' | 'sofa' | 'tvcab' | 'coffee' | 'rug' | 'sink' | 'stove' | 'cabinet' | 'wardrobe' | 'shower'
  | 'bathSink' | 'toilet' | 'washer' | 'dryer' | 'bed' | 'bathtub' | 'desk' | 'fridge' | 'plant' | 'car' | 'box'
  | 'tv' | 'tvVintage' | 'armchair' | 'sofaCorner' | 'ottoman' | 'bookcase' | 'nightstand' | 'sideTable' | 'floorLamp' | 'tableLamp'
  | 'speaker' | 'ceilingFan' | 'bedSingle' | 'deskChair' | 'roundTable' | 'rugRound' | 'mirror' | 'bathCabinet' | 'coatRack'
  | 'trashcan' | 'microwave' | 'washerDryer' | 'fridgeLarge' | 'plantSmall' | 'monitor' | 'bench' | 'bar'
  | 'tallCabinet' | 'hood' | 'shelfLow' | 'rack' | 'pc' | 'printer' | 'shredder' | 'model' | 'acUnit' | 'sofaLong' | 'tvBench' | 'sofaL';
export interface FurnitureDef {
  id: string; kind: FurnitureKind; x: number; z: number; w: number; d: number; phi: number;
  /** height above the floor (m), e.g. a TV on a cabinet or on the wall */
  elev?: number;
  /** any model of the bundled Kenney Furniture Kit (catalog name), overrides the model of the kind */
  model?: string;
  /** stretch the catalog model to w × d (default: natural size) */
  fit?: boolean;
  /** mirror image (e.g. corner sofa with the corner on the other side) */
  mirror?: boolean;
  /** height of the piece (m), overrides the model height */
  height?: number;
  /** colour of the whole piece, e.g. "#ffffff" */
  color?: string;
}
export interface StairsDef extends RectM {
  axis: 'x' | 'z';
  /** the plan edge where the stairs go up to the next level */
  top: 'min' | 'max';
  steps: number;
  /** open = treads on two stringers, empty underneath (default); solid = filled block */
  style?: 'open' | 'solid';
  /** LED lighting of the stairs (light / switch entity) */
  led?: string;
  /** step = strip under every tread nose, side = small lamp next to every step */
  ledStyle?: 'step' | 'side';
}
export interface HouseLevel {
  id: string; name: string;
  /** floor height in metres */
  y: number;
  walls: Seg[]; windows: Seg[]; gates: Seg[];
  rooms: RoomDef[]; roofs: RectM[]; stairs: StairsDef[]; furniture: FurnitureDef[];
}
export type HouseDeviceKind = 'light' | 'tv' | 'speaker' | 'ac' | 'marker';
export interface HouseDevice {
  id: string; entity: string; kind: HouseDeviceKind; level: number;
  x: number; z: number;
  /** height above the level floor (m); lights default to the ceiling */
  y?: number;
  phi?: number;
  /** light style */
  model?: 'ceiling' | 'spots' | 'spots8' | 'spotsLine' | 'floor' | 'table' | 'wall' | 'pendant' | 'strip' | 'none';
  /** LED strip length (m) */
  length?: number;
  name?: string;
  tap?: ActionDef;
  /** TV device: Samsung TV (TvDef.id) whose remote opens on tap */
  remote?: string;
  /** AC device: climate widget options (roles, modes …) for the panel */
  climate?: ClimateOptions;
}
export interface HouseDef { id: string; name: string; wallHeight: number; levels: HouseLevel[]; devices: HouseDevice[] }
export interface HouseSummary { id: string; name: string; levels: string[]; devices: number }

export interface WidgetDef {
  id: string;
  type: WidgetType;
  /** grid position in columns/rows (0-based) and size */
  x: number; y: number; w: number; h: number;
  title?: string;
  icon?: string;
  entity?: string;
  /** second entity, e.g. humidity next to a temperature */
  secondary?: string;
  options?: Record<string, any>;
  style?: WidgetStyle;
  tap?: ActionDef;
  hold?: ActionDef;
}

export interface ViewDef {
  id: string;
  title: string;
  icon?: string;
  /** not shown as a tab – used as the content of a side panel */
  panelOnly?: boolean;
  columns: number;
  rowHeight: number;
  gap: number;
  widgets: WidgetDef[];
}

export interface ThemeDef {
  /** ready-made look: 'glass' (dark glass, default), 'mech' (light, warm sage + brass) or an occasion */
  skin?: 'glass' | 'mech' | 'swieta' | 'wielkanoc' | 'halloween' | 'walentynki';
  /** switch to the occasion skin automatically (Christmas, Easter, Halloween, Valentine's) */
  occasions?: boolean;
  /** background particles; 'auto' = the one that goes with the skin */
  effect?: 'auto' | 'none' | 'snow' | 'hearts' | 'leaves' | 'petals';
  background: { type: 'glass' | 'color' | 'image'; color: string; image: string; blur: number; dim: number };
  accent: string;
  textColor: string;
  /** 0..1 default tile background opacity */
  tileOpacity: number;
  radius: number;
  /** own theme (StoreData.themes id) – used instead of the built-in look; occasion skins still win when on */
  custom?: string;
}

/** A user-made theme: colours, tile style, font and optional extra CSS. Shared by all dashboards that pick it. */
export interface CustomTheme {
  id: string;
  name: string;
  /** 'flat' = opaque tiles without blur (like Mech), 'glass' = translucent blurred tiles over the background */
  base: 'flat' | 'glass';
  /** dark or light colour scheme (form controls, scrollbars) */
  dark: boolean;
  colors: {
    /** page background */
    bg: string;
    /** text */
    fg: string;
    /** secondary text (default: text at 65%) */
    muted?: string;
    accent: string;
    /** tile background */
    tile: string;
    /** tile of something that is on (light, switch) */
    on: string;
    /** text and icon on an "on" tile */
    onText: string;
    /** icon on an "on" tile (default: accent) */
    onIcon?: string;
    ok?: string;
    err?: string;
  };
  /** glass: tile opacity 0..1 */
  tileOpacity?: number;
  /** corner radius of tiles, px */
  radius?: number;
  /** CSS font-family, e.g. "Inter, sans-serif" (fonts must be installed on the device or loaded in the CSS below) */
  font?: string;
  /** extra CSS for this theme; nested under [data-theme="<id>"] automatically */
  css?: string;
}

export type TabStyle = 'top' | 'pills' | 'bottom' | 'rail' | 'tiles' | 'tilesTop';

export interface DashboardDoc {
  id: string;
  title: string;
  showTabs?: boolean;
  /** swipe left / right on the dashboard switches to the next / previous view (default on) */
  swipeViews?: boolean;
  /** how views are switched: tabs on top (default), pills, bottom bar or a side rail */
  tabStyle?: TabStyle;
  /** horizontal position of a compact bar (pills, bottom, tiles) */
  tabAlign?: 'left' | 'center' | 'right';
  /** the bar floats over the widgets instead of taking its own row */
  tabFloat?: boolean;
  theme: ThemeDef;
  views: ViewDef[];
}

export interface Tablet {
  id: string;
  name: string;
  key: string;
  /** weak panel: no blur, no shadows, lower 3D resolution */
  lite?: boolean;
  /** small screens: 'grid' = always keep the dashboard grid (wall panels), 'stack' = always one column (phones); default: one column below 500 px */
  layout?: 'grid' | 'stack';
  /** this tablet may disarm alarms (alarm_control_panel.alarm_disarm, code still checked by HA) */
  allowDisarm?: boolean;
  /** dashboards this tablet may open; the first one is shown on start */
  dashboards: string[];
  /** quiet mode: no sounds / speech / ringing on this panel (pop-ups and the screen still work) */
  quiet?: QuietDef;
  /** a person's phone / iPad: pop-ups, sounds and wake from triggers / HA reach it only when it is named as a target */
  phone?: boolean;
  /** Wall Dashboard Android app: screen saver / screen off (Fully has its own settings) */
  screen?: ScreenDef;
  /** Wall Dashboard Android app: PIN for its settings screen (digits); empty = no PIN */
  appPin?: string;
  /** Wall Dashboard Android app: device model reported when paired */
  appModel?: string;
  /** last connection of the kiosk: time (updated on disconnect), app ("wa:0.1.4" Android app, "fully", "browser"), screen size */
  seen?: { at: number; app?: string; screen?: string };
  /** volume of notifications / doorbell sounds on this panel (system media volume, %); a trigger's own volume wins */
  notifyVolume?: number;
  /** SIP call: system volume during a call (%, default 100) and software boost of the other side's voice (%, 100 = as received) */
  callVolume?: number;
  callGain?: number;
  /** SIP account of this panel / phone on the PBX (extension + secret); used when the PBX is set up */
  sip?: { ext: string; password: string };
  /** phones: HA notification service (notify.mobile_app_…) – a SIP call from a door sends a push that opens this link */
  notify?: string;
  /** intercom between panels (voice); false = this tablet can neither call nor be called */
  intercom?: boolean;
  /** answer intercom calls automatically: 'on' = talk both ways, 'listen' = this panel's microphone starts muted */
  intercomAuto?: 'on' | 'listen';
  /** microphone processing: full (echo + noise + gain), light (echo only – weak panels), raw (none); default: light on Lite tablets */
  intercomAudio?: 'full' | 'light' | 'raw' | 'ptt';
  /** intercom codec: opus (best), opus16 (16 kHz, lighter), g722 (16 kHz, very light), pcmu (G.711, 8 kHz, lightest); default opus */
  intercomCodec?: 'opus' | 'opus16' | 'g722' | 'pcmu';
  /** Lite tablet: use the light G.722 codec when the codec is "automatic" */
  intercomLiteCodec?: boolean;
  /** loudness during a call (Fully, 10–100, default 80) */
  intercomVolume?: number;
  /** seconds of ringing before the automatic answer (default 2) */
  intercomAutoDelay?: number;
  /** ringtone for incoming calls / music the caller hears while waiting (URL: sounds/…, media/…, http…) */
  intercomRing?: string;
  intercomHold?: string;
}

export interface Settings {
  /** public base URL of the kiosk port as seen from tablets, e.g. http://192.168.1.10:8100 */
  kioskBase: string;
  /** go2rtc API reachable from the add-on (server side), default http://127.0.0.1:1984 */
  go2rtcUrl?: string;
  /** SIP PBX (VitalPBX / Asterisk): panels and phones register to it through the add-on */
  sip?: SipSettings;
}

/** SIP PBX. Signalling goes tablet → add-on (WebSocket proxy) → PBX; voice goes directly tablet ⇄ PBX (WebRTC). */
export interface SipSettings {
  enabled?: boolean;
  /** PBX SIP WebSocket as reached from the add-on, e.g. ws://192.168.1.20:8088/ws or wss://pbx.lan:8089/ws */
  ws: string;
  /** SIP domain (default: host of the PBX address) */
  domain?: string;
  /** check the PBX TLS certificate (wss://); off by default – a LAN PBX usually has a self-signed one */
  tlsVerify?: boolean;
  /** feature code that takes over a call ringing elsewhere – for phones opened from the push notification (e.g. *8) */
  pickup?: string;
  /** callers (door stations): SIP number → trigger whose pop-up (camera, open button, call log) is shown */
  doors?: { number: string; trigger: string }[];
}

export interface StoreData {
  version: 1;
  dashboards: Record<string, DashboardDoc>;
  tablets: Tablet[];
  settings: Settings;
  houses: Record<string, HouseDef>;
  tvs: TvDef[];
  /** app shortcuts of TVs controlled through Home Assistant, keyed by entity object id (remote.<id> / media_player.<id>) */
  haTvs?: Record<string, { apps: TvApp[] }>;
  /** built-in pop-up / wake reactions to entities */
  triggers?: TriggerDef[];
  /** own themes (Motywy) */
  themes?: CustomTheme[];
  /** doorbell / intercom call log (newest first, capped) */
  calls?: CallRecord[];
}

/** One ring of a pop-up trigger (doorbell, gate intercom) – the trace of missed calls. */
export interface CallRecord {
  id: string;
  trigger: string;
  name: string;
  at: number;
  ended?: number;
  status: 'ringing' | 'missed' | 'answered' | 'opened' | 'rejected';
  /** tablet that answered / opened / rejected */
  by?: string;
  /** a camera frame was saved (GET calls/:id/snapshot) */
  snapshot?: boolean;
  /** IVR played to the visitor */
  ivr?: boolean;
  seen?: boolean;
}

/** "Waiting room" of a gate intercom: after a few seconds without an answer the visitor hears a greeting and music
 *  through the intercom speaker (go2rtc two-way audio); stops when a panel answers, opens or rejects. */
export interface IvrDef {
  /** seconds of ringing before the IVR starts (default 8) */
  after?: number;
  /** played once first, e.g. "Proszę czekać, łączę z domownikami" (sounds/…, media/…, http…) */
  greeting?: string;
  /** played in a loop afterwards */
  music?: string;
  /** played once when nobody answered */
  goodbye?: string;
  /** instead of files: texts spoken by Home Assistant TTS (engine e.g. tts.google_translate_pl_pl, tts.piper) */
  greetingText?: string;
  goodbyeText?: string;
  tts?: string;
  /** TTS language (default pl) and voice (engine specific, e.g. HA Cloud "ZofiaNeural", Piper "pl_PL-gosia-medium") */
  ttsLanguage?: string;
  ttsVoice?: string;
  /** go2rtc stream with the intercom speaker (default: the pop-up's go2rtc stream) */
  stream?: string;
  /** loudness in % (100 = file as is, up to 300) for the greeting / goodbye and for the music */
  volume?: number;
  musicVolume?: number;
  /** audio codec for the intercom (Hikvision: pcmu or pcma) */
  codec?: 'pcmu' | 'pcma' | 'opus' | 'aac';
  /** entity that answers the call on the intercom (button / script / switch), pressed when the IVR starts */
  answerEntity?: string;
  /** entity that ends the call on the intercom, pressed when nobody answered (after the goodbye) or a panel rejected */
  hangupEntity?: string;
  /** seconds from the first ring after which the add-on gives up and hangs up (default: the pop-up's "close after") */
  hangupAfter?: number;
  /** add-on address as seen from go2rtc, for fetching the sound files (default http://127.0.0.1:8099) */
  base?: string;
}

export interface EntityInfo {
  entity_id: string;
  name: string;
  domain: string;
  area?: string;
  state: string;
  unit?: string;
}

export interface DashboardSummary { id: string; title: string; views: number; widgets: number }

// ---- browser <-> add-on websocket ----
export type ServerMsg =
  | { type: 'hello'; haConnected: boolean; mode: 'admin' | 'kiosk' }
  | { type: 'states'; states: HassState[] }
  | { type: 'state'; entity_id: string; state: HassState | null }
  | { type: 'ha'; connected: boolean }
  | { type: 'result'; id: number; ok: boolean; error?: string }
  | { type: 'dashboards-changed'; ids: string[] }
  /** editor draft shown on this tablet until the given time ("Podgląd na tablecie") */
  | { type: 'preview'; doc: DashboardDoc; until: number }
  | { type: 'webrtc'; id: number; event: WebRtcEvent }
  | { type: 'popup'; popup: PopupDef }
  | { type: 'wake'; wake: WakeOptions }
  | { type: 'calls-changed'; missed: number }
  | { type: 'quiet'; state: QuietState }
  | { type: 'device'; cmd: DeviceCmd; value?: number }
  | { type: 'ic-calling'; callId: string; to: IcPeer }
  | { type: 'ic-ring'; callId: string; from: IcPeer }
  | { type: 'ic-accepted'; callId: string; codec?: string }
  | { type: 'ic-ended'; callId: string; reason: IcEndReason }
  | { type: 'ic-signal'; callId: string; data: IcSignal }
  | { type: 'ic-error'; message: string }
  | { type: 'popup-close'; id?: string }
  | { type: 'tv'; id: number; ok: boolean; error?: string; status?: TvStatus };

/** HA camera/webrtc/offer subscription events, forwarded to the browser. */
export type WebRtcEvent =
  | { type: 'session'; session_id: string }
  | { type: 'answer'; answer: string }
  | { type: 'candidate'; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } }
  | { type: 'error'; code?: string; message: string }
  | { type: 'config'; iceServers: RTCIceServerLike[] };
export interface RTCIceServerLike { urls: string | string[]; username?: string; credential?: string }

/**
 * Pop-up sent by a Home Assistant automation:
 *   event: wall_dashboard_popup, event_data: { tablets: [...], title, camera, talk, rows, timeout }
 */
export interface PopupDef {
  id?: string;
  /** tablet names or ids; empty = all tablets */
  tablets?: string[];
  title?: string;
  subtitle?: string;
  camera?: string;
  talk?: boolean;
  /** play a go2rtc stream (by name, e.g. "furtka") instead of the HA camera entity; lite = lighter stream (substream) for weak panels */
  go2rtc?: { url?: string; stream: string; lite?: string };
  rows?: PanelRow[];
  /** seconds; 0 = stays until closed */
  timeout?: number;
  /** close an open pop-up with this id instead of opening one */
  action?: 'open' | 'close';
  /** what the tablet does when the pop-up arrives (Fully Kiosk Browser JS interface) */
  wake?: WakeOptions;
  /** big "open the gate" button: lock (unlock/open), button (press), switch / script (turn_on), cover (open) */
  /** set by the add-on: a SIP call rings on this panel ("Odbierz" answers it); 'pickup' = take over a call ringing elsewhere */
  sip?: 'ring' | 'pickup';
  open?: { entity: string; label?: string; /** hold ~1 s to open (default true) */ hold?: boolean; /** close the pop-up N s after opening (default 5, 0 = keep) */ closeAfter?: number };
  /** "reject" button: closes the pop-up on all tablets; optionally presses an entity (e.g. intercom hang-up) */
  reject?: { entity?: string; label?: string; /** close on every tablet (default true) */ everywhere?: boolean };
}

/** Waking a wall tablet: Fully Kiosk Browser JS interface (fully.*), sound/speech also without Fully. */
export interface WakeOptions {
  /** screen on, stop screensaver, bring Fully to the front (default true) */
  screen?: boolean;
  /** 0–255 */
  brightness?: number;
  /** URL of a sound to play: a built-in melody (sounds/ding-dong.wav) or an uploaded file (media/gong.mp3) */
  sound?: string;
  /** repeat the sound until the pop-up is closed / the screen is touched (max. 60 s) */
  soundLoop?: boolean;
  /** sound volume 0–100 (Fully: media volume of the tablet) */
  volume?: number;
  /** text to speak (Fully TTS or the browser's speech) */
  tts?: string;
}

/** Built-in reaction to an entity, configured in the add-on (no HA automation needed). */
export interface TriggerDef {
  id: string;
  name: string;
  enabled: boolean;
  /** e.g. binary_sensor.dzwonek, event.domofon_ding, lock.furtka */
  entity: string;
  /** state that fires the trigger; empty = any change (event.* entities, counters) */
  to?: string;
  /** only when changing from this state */
  from?: string;
  action: 'popup' | 'wake';
  /** tablet names or ids; empty = all */
  tablets?: string[];
  popup?: PopupDef;
  wake?: WakeOptions;
  /** state that closes the pop-up again (e.g. "off") */
  closeOn?: string;
  /** seconds to ignore repeats */
  cooldown?: number;
  /** pop-up triggers: keep a call log (default on) */
  log?: boolean;
  /** pop-up triggers: HA notify service for missed calls, e.g. notify.mobile_app_telefon */
  notify?: string;
  /** pop-up triggers: waiting room / IVR for the visitor */
  ivr?: IvrDef;
}

export type ClientMsg =
  | ClientCall
  | { type: 'webrtc-config'; id: number; entity: string }
  | { type: 'webrtc-offer'; id: number; entity: string; offer: string }
  | { type: 'webrtc-candidate'; id: number; entity: string; session_id: string; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } }
  | { type: 'webrtc-close'; id: number }
  /** tablet rejected / closed a pop-up – close it on the other tablets too */
  | { type: 'popup-dismiss'; popupId: string }
  /** a tile asks for a trigger's pop-up on this tablet */
  | { type: 'popup-open'; trigger: string }
  /** intercom between panels: call another tablet, answer, hang up / reject, WebRTC signalling */
  /** quiet mode of this panel from a tile / the indicator: on/off/toggle, for N minutes (0 = until changed) */
  | { type: 'quiet'; mode: 'on' | 'off' | 'toggle'; minutes?: number }
  /** a tablet answered (talk) / opened / rejected a pop-up – call log + stops the IVR */
  | { type: 'popup-event'; popupId: string; event: 'answer' | 'open' | 'reject' }
  | { type: 'ic-call'; to: string }
  | { type: 'ic-answer'; callId: string; codec?: string }
  | { type: 'ic-hangup'; callId: string; reason?: IcEndReason }
  | { type: 'ic-signal'; callId: string; data: IcSignal }
  | ({ type: 'tv'; id: number; tv: string } & TvAction);

export interface ClientCall {
  type: 'call';
  id: number;
  domain: string;
  service: string;
  data?: Record<string, unknown>;
  target?: { entity_id?: string | string[] };
}

export const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;

// ---------------------------------------------------------------- intercom between panels (voice only, WebRTC peer-to-peer)
export interface IcPeer { id: string; name: string; online?: boolean; busy?: boolean }
export type IcEndReason = 'hangup' | 'reject' | 'busy' | 'no-answer' | 'cancel' | 'answered-elsewhere' | 'offline' | 'error';
export interface IcSignal {
  sdp?: { type: 'offer' | 'answer'; sdp: string };
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
}

/** Quiet mode of one panel. Order: a manual switch from the panel (until a time) → HA entity → quiet hours. */
/** Screen of a panel running the Wall Dashboard Android app */
export interface ScreenDef {
  /** what "dark" means: saver = black screen (touch wakes it), dim = low brightness, off = display off (only HA / pop-up / call wakes it) */
  mode?: 'saver' | 'dim' | 'off';
  /** minutes without touch → dark (0 / empty = never) */
  idle?: number;
  /** dark windows, e.g. 23:00–06:30 (touch wakes for `idle` minutes, or 1 min when idle is not set) */
  hours?: { from: string; to: string; days?: number[] }[];
  /** normal brightness 1–100 (empty = system setting) */
  brightness?: number;
  /** brightness for mode "dim", 0–100 (default 3) */
  dimBrightness?: number;
  /** clock on the dark screen (black screen mode, Android app) */
  clock?: SaverClock;
}
/** Clock on the dark screen: separately for the night windows and for "no touch" in the day */
export interface SaverClock {
  /** in the night windows (hours) */
  night?: boolean;
  /** after the idle time outside the windows (and for "Wygaś" from HA) */
  idle?: boolean;
  /** weekday and date under the time */
  date?: boolean;
  /** up to 4 values from HA under the clock (temperature, alarm, …) */
  entities?: { entity: string; label?: string }[];
  /** missed doorbell calls (only when there are some) */
  calls?: boolean;
  /** screen brightness while the clock is shown, 1–60 % (default 8) */
  brightness?: number;
}
export type DeviceCmd = 'reload' | 'restart' | 'screen-on' | 'screen-off' | 'saver' | 'brightness';
export interface PairRequest { code: string; device: string; ip: string; at: number }

export interface QuietDef {
  /** schedule: quiet windows "22:00" – "07:00" (may cross midnight), on chosen weekdays (0 = Sunday; empty = every day) */
  hours?: { from: string; to: string; days?: number[] }[];
  /** HA entity that switches it (input_boolean / switch / binary_sensor: on = quiet), e.g. input_boolean.cisza_pietro */
  entity?: string;
  /** set from the panel ("Wycisz panel"): on/off until a time (ms) or until changed */
  manual?: { on: boolean; until?: number };
  /** during quiet mode intercom calls are refused as busy (otherwise they ring silently) */
  intercomSilent?: boolean;
}
export interface QuietState { on: boolean; reason?: 'manual' | 'hours' | 'entity'; until?: number }

/** live state of a tablet (admin, GET tablets / status) */
export interface TabletPresence {
  online: boolean; since?: number; lastSeen?: number; app?: string; /** reported screen size, e.g. 1920x1080 */ display?: string; sipRegistered?: boolean;
  quietNow?: QuietState;
}
export type TabletLive = Tablet & TabletPresence;
export interface StatusWarning { level: 'err' | 'warn'; title: string; text: string; page: string; tablet?: string }
export interface StatusInfo {
  version: string; latestApp: string; ha: boolean; https: boolean;
  sip: { ok: boolean; err?: string; ws: string; doors: string[]; registered: (string | undefined)[] } | null;
  go2rtc: { ok: boolean; streams: number } | null;
  tablets: ({ id: string; name: string; phone: boolean; ext?: string } & TabletPresence)[];
  warnings: StatusWarning[];
  calls: { today: number; missedToday: number; missed: number; last: (CallRecord & { byName?: string })[] };
  quiet: { name: string; until?: number }[];
}
