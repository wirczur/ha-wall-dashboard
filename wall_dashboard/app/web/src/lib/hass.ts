import { deviceCommand } from './device';
import { useSyncExternalStore } from 'react';
import type { ClientMsg, DashboardDoc, HassState, PopupDef, QuietState, ServerMsg, TvAction, TvStatus, WebRtcEvent, WakeOptions } from '../../../shared/types';
import { boot, keyQuery } from './boot';
import { setQuietMode } from './fully';

type Listener = () => void;

/** Live entity states streamed from the add-on (which proxies Home Assistant). */
class HassStore {
  states = new Map<string, HassState>();
  online = false;       // browser <-> add-on
  haConnected = false;  // add-on <-> Home Assistant
  private ws?: WebSocket;
  private seq = 1;
  private pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<Listener>();
  private dashListeners = new Set<(ids: string[]) => void>();
  private previewListeners = new Set<(doc: DashboardDoc, until: number) => void>();
  private rtcListeners = new Map<number, (e: WebRtcEvent) => void>();
  private tvPending = new Map<number, { resolve: (s?: TvStatus) => void; reject: (e: Error) => void }>();
  private popupListeners = new Set<(p: PopupDef | null, closeId?: string) => void>();
  private wakeListeners = new Set<(w: WakeOptions) => void>();
  private callsListeners = new Set<(missed: number) => void>();
  /** quiet mode of this panel (kiosk) */
  quiet: QuietState = { on: false };
  private quietListeners = new Set<() => void>();
  private icListeners = new Set<(m: Extract<ServerMsg, { type: `ic-${string}` }>) => void>();
  private retry = 1000;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.open();
    // iOS / Android put a backgrounded web app to sleep and its socket can stay "open" but dead:
    // after a longer pause reconnect at once (fresh states) instead of waiting for the timeout
    let hiddenAt = 0;
    const back = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (this.ws?.readyState !== WebSocket.OPEN || (hiddenAt && Date.now() - hiddenAt > 15_000)) this.reconnectNow();
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) this.reconnectNow(); });
    window.addEventListener('online', () => { if (this.ws?.readyState !== WebSocket.OPEN) this.reconnectNow(); });
  }

  private reopenTimer?: ReturnType<typeof setTimeout>;
  private reconnectNow() {
    clearTimeout(this.reopenTimer);
    const old = this.ws;
    if (old) { old.onclose = null; old.onmessage = null; try { old.close(); } catch { /* already gone */ } }
    for (const p of this.pending.values()) p.reject(new Error('Brak połączenia z add-onem'));
    this.pending.clear();
    this.retry = 1000;
    this.open();
  }

  private open() {
    const u = new URL('ws' + keyQuery(boot.mode === 'kiosk' ? clientInfo() : ''), location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(u.toString());
    this.ws = ws;
    ws.onopen = () => { this.retry = 1000; this.online = true; this.emitStatus(); };
    ws.onclose = () => {
      this.online = false; this.emitStatus();
      for (const p of this.pending.values()) p.reject(new Error('Brak połączenia z add-onem'));
      this.pending.clear();
      this.reopenTimer = setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data) as ServerMsg);
  }

  private onMessage(m: ServerMsg) {
    switch (m.type) {
      case 'hello': this.haConnected = m.haConnected; this.emitStatus(); break;
      case 'ha': this.haConnected = m.connected; this.emitStatus(); break;
      case 'states':
        this.states = new Map(m.states.map((s) => [s.entity_id, s]));
        this.emit(); break;
      case 'state':
        if (m.state) this.states.set(m.entity_id, m.state); else this.states.delete(m.entity_id);
        this.emit(); break;
      case 'result': {
        const p = this.pending.get(m.id);
        if (!p) break;
        this.pending.delete(m.id);
        m.ok ? p.resolve() : p.reject(new Error(m.error || 'Błąd'));
        break;
      }
      case 'dashboards-changed': this.dashListeners.forEach((l) => l(m.ids)); break;
      case 'preview': this.previewListeners.forEach((l) => l(m.doc, m.until)); break;
      case 'webrtc': this.rtcListeners.get(m.id)?.(m.event); break;
      case 'tv': {
        const p = this.tvPending.get(m.id); if (!p) break;
        this.tvPending.delete(m.id);
        m.ok ? p.resolve(m.status) : p.reject(new Error(m.error || 'Błąd telewizora'));
        break;
      }
      case 'popup': this.popupListeners.forEach((l) => l(m.popup)); break;
      case 'popup-close': this.popupListeners.forEach((l) => l(null, m.id)); break;
      case 'wake': this.wakeListeners.forEach((l) => l(m.wake)); break;
      case 'calls-changed': this.callsListeners.forEach((l) => l(m.missed)); break;
      case 'device': deviceCommand(m.cmd, m.value); break;
      case 'quiet': this.quiet = m.state; setQuietMode(m.state.on); this.quietListeners.forEach((l) => l()); break;
      case 'ic-calling': case 'ic-ring': case 'ic-accepted': case 'ic-ended': case 'ic-signal': case 'ic-error':
        this.icListeners.forEach((l) => l(m)); break;
    }
  }

  call(domain: string, service: string, data?: Record<string, unknown>, entity?: string | string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('Brak połączenia'));
      const id = this.seq++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ type: 'call', id, domain, service, data, target: entity ? { entity_id: entity } : undefined }));
    });
  }

  /** Raw message to the add-on (WebRTC signalling). Returns false when offline. */
  send(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg)); return true;
  }
  nextId() { return this.seq++; }
  /** Samsung TV command through the add-on (direct LAN control, not HA). */
  tv(tv: string, a: TvAction): Promise<TvStatus | undefined> {
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      this.tvPending.set(id, { resolve, reject });
      if (!this.send({ type: 'tv', id, tv, ...a } as ClientMsg)) { this.tvPending.delete(id); reject(new Error('Brak połączenia')); }
      setTimeout(() => { if (this.tvPending.delete(id)) reject(new Error('Telewizor nie odpowiedział')); }, 35_000);
    });
  }
  onRtc(id: number, l: (e: WebRtcEvent) => void) { this.rtcListeners.set(id, l); return () => { this.rtcListeners.delete(id); }; }
  onPopup(l: (p: PopupDef | null, closeId?: string) => void) { this.popupListeners.add(l); return () => { this.popupListeners.delete(l); }; }
  onIntercom(l: (m: Extract<ServerMsg, { type: `ic-${string}` }>) => void) { this.icListeners.add(l); return () => { this.icListeners.delete(l); }; }
  subscribeQuiet = (l: () => void) => { this.quietListeners.add(l); return () => { this.quietListeners.delete(l); }; };
  onCalls(l: (missed: number) => void) { this.callsListeners.add(l); return () => { this.callsListeners.delete(l); }; }
  onWake(l: (w: WakeOptions) => void) { this.wakeListeners.add(l); return () => { this.wakeListeners.delete(l); }; }

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  subscribeStatus = (l: Listener) => { this.statusListeners.add(l); return () => { this.statusListeners.delete(l); }; };
  onPreview(l: (doc: DashboardDoc, until: number) => void) { this.previewListeners.add(l); return () => { this.previewListeners.delete(l); }; }
  onDashboardsChanged(l: (ids: string[]) => void) { this.dashListeners.add(l); return () => { this.dashListeners.delete(l); }; }
  private emit() { this.listeners.forEach((l) => l()); }
  private emitStatus() { this.statusListeners.forEach((l) => l()); }
}

export const hass = new HassStore();

/** Re-renders only when this entity's state object changes. */
export function useEntity(id?: string): HassState | undefined {
  const get = () => (id ? hass.states.get(id) : undefined);
  return useSyncExternalStore(hass.subscribe, get, get);
}

/** For components that read several entities. */
export function useEntities(ids: string[]): (HassState | undefined)[] {
  const get = () => ids.map((i) => hass.states.get(i)?.last_updated ?? '-').join('|');
  useSyncExternalStore(hass.subscribe, get, get);
  return ids.map((i) => hass.states.get(i));
}

export function useConnection() {
  const online = useSyncExternalStore(hass.subscribeStatus, () => hass.online, () => true);
  const ha = useSyncExternalStore(hass.subscribeStatus, () => hass.haConnected, () => true);
  return { online, ha };
}

/** quiet mode of this panel (sounds off) */
export const useQuiet = () => useSyncExternalStore(hass.subscribeQuiet, () => hass.quiet);

/** what runs the kiosk (shown in the admin): Android app version, Fully, or a plain browser; plus the screen size */
function clientInfo() {
  let app = 'browser';
  try {
    const w = window as unknown as { wallApp?: { version?(): string }; fully?: unknown };
    if (w.wallApp) app = 'wa:' + (w.wallApp.version?.() ?? '?');
    else if (w.fully) app = 'fully';
    else if (/iPhone|iPad/.test(navigator.userAgent)) app = 'ios';
  } catch { /* */ }
  const scr = Math.round(screen.width * (devicePixelRatio || 1)) + 'x' + Math.round(screen.height * (devicePixelRatio || 1));
  return new URLSearchParams({ app, scr }).toString();
}
