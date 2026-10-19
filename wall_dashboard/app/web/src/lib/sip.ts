// SIP phone of the panel (JsSIP): registers on the PBX through the add-on (WebSocket proxy),
// voice goes directly panel ⇄ PBX (WebRTC). The pop-up of the door uses answer() / hangup().
import type { UA } from 'jssip';
import type { RTCSession } from 'jssip/lib/RTCSession';
import { useSyncExternalStore } from 'react';
import { keyQuery } from './boot';

export interface SipConfig { uri: string; password: string; ext: string; pickup?: string; callVolume?: number; callGain?: number }
export type SipPhase = 'off' | 'registering' | 'ready' | 'error';
export interface SipState { phase: SipPhase; error?: string; ringing: boolean; inCall: boolean; muted: boolean; gain: number }

interface AppBridge { getAudioVolume?(stream: number): number; setAudioVolume?(level: number, stream: number): void }
interface WallAppAudio { callAudio?(on: boolean): void }
const GAIN_KEY = 'wd.sipGain';
const STREAMS = [0, 3]; // Android: voice call + media (WebView plays a WebRTC call on one of them)

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

class SipPhone {
  private ua: UA | null = null;
  private cfgKey = '';
  /** incoming call ringing on this panel */
  private incoming: RTCSession | null = null;
  /** the call in progress (answered incoming or a pickup) */
  private active: RTCSession | null = null;
  private audio = new Audio();
  private listeners = new Set<() => void>();
  state: SipState = { phase: 'off', ringing: false, inCall: false, muted: false, gain: 100 };
  private cfg?: SipConfig;
  // the other side's voice: <audio> (muted, Chrome needs it to pull the stream) → WebAudio gain → speaker
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  /** system volumes before the call (restored afterwards) */
  private saved: Record<number, number> = {};
  pickupCode?: string;
  private domain = '';
  /** microphone opened while ringing */
  private mic: Promise<MediaStream | null> | null = null;
  private callStream: MediaStream | null = null;
  private dropMic() { const m = this.mic; this.mic = null; void m?.then((st) => st?.getTracks().forEach((t) => t.stop())); }

  constructor() { this.audio.autoplay = true; }
  private set(p: Partial<SipState>) {
    const was = this.state.inCall;
    this.state = { ...this.state, ...p };
    if (was !== this.state.inCall) this.callAudio(this.state.inCall);
    for (const l of this.listeners) l();
  }

  /** call volume of the panel: system volume up for the call, back afterwards (Android app / Fully) */
  private callAudio(on: boolean) {
    const f = window.fully as AppBridge | undefined;
    try { (window as unknown as { wallApp?: WallAppAudio }).wallApp?.callAudio?.(on); } catch { /* older app */ }
    if (!f?.setAudioVolume) return;
    try {
      if (on) {
        const v = Math.max(10, Math.min(100, this.cfg?.callVolume ?? 100));
        for (const st of STREAMS) { const cur = f.getAudioVolume?.(st); if (cur != null && cur >= 0) this.saved[st] = cur; f.setAudioVolume(v, st); }
      } else {
        for (const [st, v] of Object.entries(this.saved)) f.setAudioVolume(v, Number(st));
        this.saved = {};
      }
    } catch { /* not supported */ }
    if (!on) { try { this.source?.disconnect(); } catch { /* */ } this.source = null; }
  }

  /** software boost of the other side's voice, % (also changed live in the pop-up; remembered on this panel) */
  setGain(pct: number) {
    const g = Math.max(50, Math.min(400, Math.round(pct)));
    if (this.gainNode) this.gainNode.gain.value = g / 100;
    try { localStorage.setItem(GAIN_KEY, String(g)); } catch { /* private mode */ }
    this.set({ gain: g });
  }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  start(cfg?: SipConfig) {
    const key = cfg ? JSON.stringify(cfg) : '';
    if (key === this.cfgKey) return;
    this.cfgKey = key;
    this.ua?.stop(); this.ua = null;
    this.pickupCode = cfg?.pickup;
    this.cfg = cfg;
    let g = cfg?.callGain ?? 100;
    try { const v = Number(localStorage.getItem(GAIN_KEY)); if (v) g = v; } catch { /* */ }
    this.state = { ...this.state, gain: Math.max(50, Math.min(400, g)) };
    this.domain = cfg?.uri.split('@')[1] ?? '';
    if (!cfg) return this.set({ phase: 'off' });
    this.set({ phase: 'registering' });
    // JsSIP only on panels with a SIP account (separate chunk)
    void import('jssip').then((J) => { if (this.cfgKey === key) this.boot(J, cfg); })
      .catch((e) => this.set({ phase: 'error', error: 'Nie udało się wczytać SIP: ' + e.message }));
  }

  private boot(J: typeof import('jssip'), cfg: SipConfig) {
    const { UA, WebSocketInterface, debug } = J;
    try { if (!localStorage.getItem('debug')) debug.disable(); } catch { debug.disable(); }
    const u = new URL('api/sip/ws' + keyQuery(), location.href);
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ua = new UA({
      sockets: [new WebSocketInterface(u.toString())], uri: cfg.uri, password: cfg.password,
      display_name: undefined, register: true, register_expires: 300, session_timers: false,
      connection_recovery_min_interval: 2, connection_recovery_max_interval: 30, user_agent: 'WallDashboard'
    });
    ua.on('registered', () => this.set({ phase: 'ready', error: undefined }));
    ua.on('registrationFailed', (e: any) => this.set({ phase: 'error', error: 'Centrala odrzuciła rejestrację: ' + (e?.cause ?? '') }));
    ua.on('disconnected', () => this.set({ phase: 'error', error: 'Brak połączenia z centralą SIP' }));
    ua.on('connecting', () => { if (this.state.phase !== 'ready') this.set({ phase: 'registering' }); });
    ua.on('newRTCSession', (e: any) => {
      const s: RTCSession = e.session;
      if (e.originator !== 'remote') return;
      if (this.incoming || this.active) { s.terminate({ status_code: 486 }); return; } // busy
      this.incoming = s;
      this.set({ ringing: true });
      // open the microphone while it rings – answering is then instant
      this.mic = navigator.mediaDevices?.getUserMedia({ audio: AUDIO }).catch(() => null) ?? Promise.resolve(null);
      const done = () => {
        if (this.incoming === s) { this.incoming = null; this.dropMic(); }
        if (this.active === s) { this.active = null; this.audio.srcObject = null; this.callStream?.getTracks().forEach((t) => t.stop()); this.callStream = null; }
        this.set({ ringing: !!this.incoming, inCall: !!this.active, muted: false });
      };
      s.on('failed', (e: any) => { console.warn('SIP: połączenie nieudane –', e?.cause, e?.message?.status_code ?? ''); done(); });
      s.on('ended', done);
      s.on('peerconnection', (pe: any) => this.attach(pe.peerconnection));
      this.fastIce(s);
    });
    this.ua = ua;
    ua.start();
  }

  /** do not wait for full ICE gathering (can take seconds on devices with many interfaces): LAN host candidates are enough */
  private fastIce(s: RTCSession) {
    let timer: number | undefined;
    s.on('icecandidate', (e: any) => { if (timer === undefined) timer = window.setTimeout(() => { try { e.ready(); } catch { /* sent already */ } }, 400); });
  }

  private attach(pc: RTCPeerConnection) {
    pc.addEventListener('track', (ev) => {
      if (ev.track.kind !== 'audio') return;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.audio.srcObject = stream;
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) throw new Error('no WebAudio');
        this.ctx ??= new AC();
        if (!this.gainNode) { this.gainNode = this.ctx.createGain(); this.gainNode.connect(this.ctx.destination); }
        this.gainNode.gain.value = this.state.gain / 100;
        try { this.source?.disconnect(); } catch { /* */ }
        this.source = this.ctx.createMediaStreamSource(stream);
        this.source.connect(this.gainNode);
        this.audio.muted = true; // the sound goes through the gain; the element only keeps the stream flowing
        void this.ctx.resume().catch(() => {});
      } catch { this.audio.muted = false; }
      void this.audio.play().catch(() => {});
    });
  }

  /** answers the call ringing here; otherwise takes over the call ringing elsewhere (pickup code) */
  answer(): boolean {
    if (this.incoming) {
      const s = this.incoming;
      this.incoming = null; this.active = s;
      this.set({ ringing: false, inCall: true });
      const mic = this.mic; this.mic = null;
      void (mic ?? Promise.resolve(null)).then((stream) => {
        if (this.active !== s) { stream?.getTracks().forEach((t) => t.stop()); return; }
        this.callStream = stream;
        try { s.answer({ ...(stream ? { mediaStream: stream } : { mediaConstraints: { audio: AUDIO, video: false } }), pcConfig: { iceServers: [] } }); }
        catch (e) { console.warn('SIP: odbieranie nieudane', e); this.hangup(); }
      });
      return true;
    }
    if (this.ua && this.pickupCode && this.state.phase === 'ready' && !this.active) {
      const s = this.ua.call(`sip:${this.pickupCode}@${this.domain}`, { mediaConstraints: { audio: AUDIO, video: false }, pcConfig: { iceServers: [] } });
      this.active = s;
      const done = () => { if (this.active === s) { this.active = null; this.audio.srcObject = null; } this.set({ inCall: !!this.active, muted: false }); };
      s.on('failed', done); s.on('ended', done);
      this.fastIce(s);
      if (s.connection) this.attach(s.connection); else s.on('peerconnection', (pe: any) => this.attach(pe.peerconnection));
      this.set({ inCall: true });
      return true;
    }
    return false;
  }
  /** rejects the ringing call (486 busy here, 603 = decline everywhere) or ends the call */
  hangup(decline = false) {
    try {
      if (this.active) this.active.terminate();
      else if (this.incoming) this.incoming.terminate({ status_code: decline ? 603 : 486 });
    } catch { /* already gone */ }
  }
  mute(on: boolean) {
    if (!this.active) return;
    if (on) this.active.mute({ audio: true }); else this.active.unmute({ audio: true });
    this.set({ muted: on });
  }
  get hasCall() { return !!this.incoming || !!this.active; }
}

export const sip = new SipPhone();
export const useSip = () => useSyncExternalStore(sip.subscribe, () => sip.state);
