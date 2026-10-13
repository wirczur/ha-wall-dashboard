// Intercom between panels (voice only). The add-on rings the other tablet and relays WebRTC signalling;
// the audio goes directly tablet ↔ tablet in the LAN (host candidates, no STUN/TURN needed).
import { useSyncExternalStore } from 'react';
import type { IcEndReason, IcPeer, IcSignal, ServerMsg } from '../../../shared/types';
import { hass } from './hass';
import { isQuiet, playTabletSound, stopTabletSound, wakeTablet } from './fully';

export type Codec = 'opus' | 'opus16' | 'g722' | 'pcmu';
export type IcPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export interface IcState { phase: IcPhase; callId?: string; peer?: IcPeer; since?: number; muted?: boolean; note?: string; autoAt?: number; ptt?: boolean; talking?: boolean }
/** per-tablet settings (Tablety → Interkom) */
export interface IcConfig { volume?: number; audio?: 'full' | 'light' | 'raw' | 'ptt'; codec?: Codec; lite?: boolean; dnd?: boolean; auto?: 'on' | 'listen'; autoDelay?: number; ring?: string; hold?: string }

const END_PL: Record<IcEndReason, string> = {
  hangup: 'Rozmowa zakończona', reject: 'Odrzucono', busy: 'Panel jest zajęty', 'no-answer': 'Nikt nie odebrał', cancel: 'Połączenie anulowane',
  'answered-elsewhere': 'Odebrano na innym ekranie', offline: 'Panel jest niedostępny', error: 'Błąd połączenia'
};
export const RING = 'sounds/interkom.wav';
export const RINGBACK = 'sounds/sygnal.wav';

type IcMsg = Extract<ServerMsg, { type: `ic-${string}` }>;
type FullyAudio = { setAudioVolume?(l: number, s: number): void; getAudioVolume?(s: number): number };

/** Microphone check with a clear message (HTTPS + permission). */
export function micProblem(): string | null {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'Mikrofon wymaga połączenia HTTPS – włącz „ssl” (HTTPS dla kiosku) w konfiguracji add-onu i otwórz link tabletu przez https://';
  if (typeof RTCPeerConnection === 'undefined') return 'Ta przeglądarka nie obsługuje rozmów (WebRTC)';
  return null;
}

class Intercom {
  state: IcState = { phase: 'idle' };
  private listeners = new Set<() => void>();
  pc?: RTCPeerConnection;
  private mic?: MediaStream;
  private audio?: HTMLAudioElement;
  private pendingIce: RTCIceCandidateInit[] = [];
  private role?: 'caller' | 'callee';
  private endTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private savedVol?: number[];
  private started = false;
  /** volume during a call (0–100), from the intercom widget */
  volume = 80;
  cfg: IcConfig = {};
  private autoTimer?: ReturnType<typeof setTimeout>;

  start() {
    if (this.started) return;
    this.started = true;
    hass.onIntercom((m) => this.onMsg(m));
  }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(s: Partial<IcState>, replace = false) { this.state = replace ? (s as IcState) : { ...this.state, ...s }; this.listeners.forEach((l) => l()); }

  async call(peer: IcPeer) {
    if (this.state.phase !== 'idle' && this.state.phase !== 'ended') return;
    clearTimeout(this.endTimer);
    const p = micProblem();
    if (p) return this.finish(p);
    this.set({ phase: 'outgoing', peer, callId: undefined, since: undefined, muted: false, note: 'Łączenie…' }, true);
    try { await this.getMic(); } catch (e: any) { return this.finish(micError(e)); }
    if ((this.state as IcState).phase !== 'outgoing') { this.releaseMic(); return; }
    this.role = 'caller';
    if (!hass.send({ type: 'ic-call', to: peer.id })) return this.finish('Brak połączenia z add-onem');
  }

  async answer() {
    const { callId } = this.state;
    if (this.state.phase !== 'incoming' || !callId) return;
    stopTabletSound();
    const p = micProblem();
    if (p) { hass.send({ type: 'ic-hangup', callId, reason: 'error' }); return this.finish(p); }
    this.set({ phase: 'connecting', note: 'Łączenie…' });
    try { await this.getMic(); } catch (e: any) { hass.send({ type: 'ic-hangup', callId, reason: 'error' }); return this.finish(micError(e)); }
    this.role = 'callee';
    clearTimeout(this.autoTimer);
    if (this.state.autoAt && this.cfg.auto === 'listen') { this.mic?.getAudioTracks().forEach((t) => { t.enabled = false; }); this.set({ muted: true }); }
    this.makePc();
    hass.send({ type: 'ic-answer', callId, codec: this.cfg.codec ?? 'opus' });
    this.watchConnect();
  }

  reject() { this.hangup('reject'); }
  dismiss() { clearTimeout(this.endTimer); if (this.state.phase === 'ended') this.set({ phase: 'idle' }, true); }

  hangup(reason: IcEndReason = 'hangup') {
    const { callId, phase } = this.state;
    if (callId) hass.send({ type: 'ic-hangup', callId, reason });
    this.finish(phase === 'incoming' ? '' : phase === 'outgoing' ? 'Połączenie anulowane' : 'Rozmowa zakończona');
  }

  /** walkie-talkie mode: hold to talk – own speaker is muted meanwhile, so no echo cancellation is needed */
  talk(on: boolean) {
    if (!this.state.ptt || this.state.phase !== 'active' || on === !!this.state.talking) return;
    this.mic?.getAudioTracks().forEach((t) => { t.enabled = on; });
    if (this.audio) this.audio.muted = on;
    this.set({ talking: on });
  }

  toggleMute() {
    if (this.state.ptt) return;
    const muted = !this.state.muted;
    this.mic?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.set({ muted });
  }

  // ------------------------------------------------------------ signalling
  private async onMsg(m: IcMsg) {
    const s = this.state;
    switch (m.type) {
      case 'ic-error': if (s.phase === 'outgoing') this.finish(m.message); return;
      case 'ic-calling':
        if (s.phase === 'outgoing' && !s.callId) { this.set({ callId: m.callId, peer: m.to, note: 'Dzwonię…' }); playTabletSound(this.cfg.hold || RINGBACK, { loop: true }); }
        return;
      case 'ic-ring':
        if ((s.phase !== 'idle' && s.phase !== 'ended') || (this.cfg.dnd && isQuiet())) { hass.send({ type: 'ic-hangup', callId: m.callId, reason: 'busy' }); return; }
        clearTimeout(this.endTimer);
        wakeTablet({ screen: true });
        playTabletSound(this.cfg.ring || RING, { loop: true });
        // quiet mode = do not disturb: silent ring, never answer automatically
        if (this.cfg.auto && !isQuiet()) {
          const delay = Math.max(0, Number(this.cfg.autoDelay ?? 2)) * 1000;
          this.set({ phase: 'incoming', callId: m.callId, peer: m.from, since: undefined, muted: false, note: undefined, autoAt: Date.now() + delay }, true);
          clearTimeout(this.autoTimer);
          this.autoTimer = setTimeout(() => { if (this.state.phase === 'incoming' && this.state.callId === m.callId) void this.answer(); }, delay);
        } else {
          this.set({ phase: 'incoming', callId: m.callId, peer: m.from, since: undefined, muted: false, note: undefined }, true);
        }
        return;
    }
    if (m.callId !== s.callId) return;
    switch (m.type) {
      case 'ic-accepted': {
        stopTabletSound();
        this.set({ phase: 'connecting', note: 'Łączenie…' });
        const pc = this.makePc();
        try {
          const offer = await pc.createOffer();
          // the callee told us its codec: offer the lighter one of the two first, so both directions use it
          const theirs = RANK.includes(m.codec as Codec) ? (m.codec as Codec) : 'opus';
          offer.sdp = setCodec(offer.sdp ?? '', lighter(this.cfg.codec ?? 'opus', theirs));
          await pc.setLocalDescription(offer);
          this.signal({ sdp: { type: 'offer', sdp: offer.sdp ?? '' } });
          this.watchConnect();
        } catch { this.fail(); }
        return;
      }
      case 'ic-signal': {
        const pc = this.pc; if (!pc) return;
        try {
          if (m.data.sdp) {
            await pc.setRemoteDescription(m.data.sdp);
            for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
            if (m.data.sdp.type === 'offer') {
              const ans = await pc.createAnswer();
              // the lighter codec of the two panels wins (the answer decides what both sides send)
              ans.sdp = setCodec(ans.sdp ?? '', lighter(this.cfg.codec ?? 'opus', offeredCodec(m.data.sdp.sdp)));
              await pc.setLocalDescription(ans);
              this.signal({ sdp: { type: 'answer', sdp: ans.sdp ?? '' } });
            }
          } else if (m.data.candidate) {
            if (pc.remoteDescription) await pc.addIceCandidate(m.data.candidate).catch(() => {});
            else this.pendingIce.push(m.data.candidate);
          }
        } catch { this.fail(); }
        return;
      }
      case 'ic-ended':
        this.finish(s.phase === 'incoming' && (m.reason === 'cancel' || m.reason === 'answered-elsewhere') ? '' : END_PL[m.reason] ?? 'Koniec');
        return;
    }
  }

  private signal(data: IcSignal) { if (this.state.callId) hass.send({ type: 'ic-signal', callId: this.state.callId, data }); }

  private makePc() {
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc; this.pendingIce = [];
    this.mic?.getTracks().forEach((t) => {
      const snd = pc.addTrack(t, this.mic!);
      // voice first: DSCP EF marking on the LAN + a fixed bitrate ceiling
      try {
        const p = snd.getParameters();
        if (p.encodings?.length) {
          p.encodings.forEach((e: any) => { e.priority = 'high'; e.networkPriority = 'high'; });
          void snd.setParameters(p).catch(() => {});
        }
      } catch { /* older WebView */ }
    });
    pc.onicecandidate = (e) => { if (e.candidate) this.signal({ candidate: { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex } }); };
    pc.ontrack = (e) => {
      // a fixed, bigger jitter buffer (≈200 ms): less time-stretching (= "robotic" voice) on weak panels
      try { (e.receiver as any).jitterBufferTarget = 200; } catch { /* older WebView */ }
      try { (e.receiver as any).playoutDelayHint = 0.2; } catch { /* older WebView */ }
      if (!this.audio) { this.audio = new Audio(); this.audio.autoplay = true; }
      this.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void this.audio.play().catch(() => {});
    };
    pc.oniceconnectionstatechange = () => console.debug('[interkom] ice', pc.iceConnectionState);
    pc.onconnectionstatechange = () => {
      console.debug('[interkom] pc', pc.connectionState);
      if (pc !== this.pc) return;
      if (pc.connectionState === 'connected' && this.state.phase !== 'active') {
        clearTimeout(this.connectTimer);
        this.loud(true);
        const ptt = this.mode() === 'ptt';
        if (ptt) this.mic?.getAudioTracks().forEach((t) => { t.enabled = false; });
        this.set({ phase: 'active', since: Date.now(), note: undefined, ptt, talking: false });
      }
      if (pc.connectionState === 'failed') this.fail();
      if (pc.connectionState === 'disconnected') setTimeout(() => { if (pc === this.pc && pc.connectionState === 'disconnected') this.fail(); }, 5000);
    };
    return pc;
  }
  private watchConnect() {
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => { if (this.state.phase === 'connecting') this.fail('Nie udało się zestawić połączenia – sprawdź, czy oba panele są w tej samej sieci'); }, 15_000);
  }
  private fail(note = 'Błąd połączenia') {
    if (this.state.callId) hass.send({ type: 'ic-hangup', callId: this.state.callId, reason: 'error' });
    this.finish(note);
  }

  private async getMic() {
    if (this.mic?.active) return;
    // weak panels (e.g. Rockchip PX30): heavy noise suppression / AGC makes the voice robotic – keep only echo cancellation
    const mode = this.mode();
    const audio: MediaTrackConstraints = mode === 'raw' || mode === 'ptt' ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : mode === 'light' ? { echoCancellation: true, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    this.mic = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, channelCount: 1 } });
  }
  private mode() { return this.cfg.audio ?? (this.cfg.lite ? 'light' : 'full'); }
  private releaseMic() { this.mic?.getTracks().forEach((t) => t.stop()); this.mic = undefined; }

  /** Fully: louder for the call (voice + media streams), restore afterwards. */
  private loud(on: boolean) {
    const f = window.fully as unknown as FullyAudio | undefined;
    if (!f?.setAudioVolume) return;
    try {
      if (on) {
        this.savedVol = [0, 3].map((s) => (f.getAudioVolume ? Number(f.getAudioVolume(s)) : NaN));
        const vol = Math.max(10, Math.min(100, Number(this.cfg.volume ?? this.volume) || 80));
        for (const s of [0, 3]) f.setAudioVolume(vol, s);
      } else if (this.savedVol) {
        [0, 3].forEach((s, i) => { const v = this.savedVol![i]; if (isFinite(v)) f.setAudioVolume!(v, s); });
        this.savedVol = undefined;
      }
    } catch { /* older Fully */ }
  }

  private finish(note: string) {
    stopTabletSound();
    clearTimeout(this.autoTimer);
    clearTimeout(this.connectTimer);
    this.pc?.close(); this.pc = undefined;
    this.releaseMic();
    if (this.audio) { this.audio.srcObject = null; this.audio = undefined; }
    this.loud(false);
    this.role = undefined;
    if (!note) { this.set({ phase: 'idle' }, true); return; }
    this.set({ phase: 'ended', callId: undefined, note });
    clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => { if (this.state.phase === 'ended') this.set({ phase: 'idle' }, true); }, 3000);
  }
}

const micError = (e: any) => e?.name === 'NotAllowedError' ? 'Brak zgody na mikrofon – zezwól w Fully (Web Content Settings) i w uprawnieniach Androida'
  : e?.name === 'NotFoundError' ? 'Ten panel nie ma mikrofonu' : 'Mikrofon niedostępny: ' + (e?.message || e);

const RANK: Codec[] = ['opus', 'opus16', 'g722', 'pcmu'];
const lighter = (a: Codec, b: Codec): Codec => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b);
const CODEC_RE: Record<Exclude<Codec, 'opus16'>, RegExp> = { opus: /^opus\/48000/i, g722: /^G722\/8000/i, pcmu: /^(PCMU|PCMA)\/8000/i };

/** the codec the other panel put first in its offer */
export function offeredCodec(sdp: string): Codec {
  const m = /^m=audio \d+ \S+ ([\d ]+)/m.exec(sdp); if (!m) return 'opus';
  const pt = m[1].trim().split(' ')[0];
  const name = new RegExp(`a=rtpmap:${pt} ([^\r\n]+)`).exec(sdp)?.[1] ?? '';
  if (/^G722/i.test(name)) return 'g722';
  if (/^(PCMU|PCMA)/i.test(name)) return 'pcmu';
  return new RegExp(`a=fmtp:${pt} [^\r\n]*maxplaybackrate=16000`).test(sdp) ? 'opus16' : 'opus';
}

/** Puts the chosen codec first in the audio m-line (the first one is what gets sent) and tunes Opus. */
export function setCodec(sdp: string, codec: Codec) {
  const m = /^(m=audio \d+ \S+) ([\d ]+?) *(?=\r?$)/m.exec(sdp);
  if (!m) return tuneOpus(sdp, codec === 'opus16');
  const pts = m[2].trim().split(' ');
  const re = CODEC_RE[codec === 'opus16' ? 'opus' : codec];
  const name = (pt: string) => new RegExp(`a=rtpmap:${pt} ([^\r\n]+)`).exec(sdp)?.[1] ?? '';
  const first = pts.filter((pt) => re.test(name(pt)));
  // PCMU before PCMA
  first.sort((a, b) => Number(/^PCMA/i.test(name(a))) - Number(/^PCMA/i.test(name(b))));
  const out = first.length ? sdp.replace(m[0], `${m[1]} ${[...first, ...pts.filter((p) => !first.includes(p))].join(' ')}`) : sdp;
  return tuneOpus(out, codec === 'opus16');
}

/** Opus for voice: mono, in-band FEC (repairs lost packets), no DTX (DTX gaps sound like dropouts), 32 kbit/s (16 kHz: 20 kbit/s). */
export function tuneOpus(sdp: string, narrow = false) {
  const m = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
  if (!m) return sdp;
  const pt = m[1];
  const want = 'useinbandfec=1;usedtx=0;stereo=0;sprop-stereo=0;' + (narrow ? 'maxplaybackrate=16000;sprop-maxcapturerate=16000;maxaveragebitrate=20000' : 'maxaveragebitrate=32000');
  const re = new RegExp(`a=fmtp:${pt} ([^\r\n]*)`);
  if (re.test(sdp)) {
    return sdp.replace(re, (_l, params: string) => {
      const kept = params.split(';').filter((x) => x && !/^(useinbandfec|usedtx|stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|sprop-maxcapturerate)=/.test(x.trim()));
      return `a=fmtp:${pt} ${[...kept, want].join(';')}`;
    });
  }
  return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${want}`);
}

/** Live call quality from WebRTC stats – shown on the call screen (ⓘ) to tell network problems from a weak panel. */
export interface IcStats { stretch?: number; levelIn?: number; erle?: number; codec?: string; rtt?: number; jitter?: number; lossIn?: number; concealed?: number; path?: string; kbpsIn?: number; kbpsOut?: number; level?: number }
let lastIn = { t: 0, bytes: 0 }, lastOut = { t: 0, bytes: 0 };
export async function callStats(): Promise<IcStats | null> {
  const pc = intercom.pc; if (!pc) return null;
  const rep = await pc.getStats();
  const out: IcStats = {};
  const byId = new Map<string, any>(); rep.forEach((r: any) => byId.set(r.id, r));
  rep.forEach((r: any) => {
    if (r.type === 'inbound-rtp' && r.kind === 'audio') {
      const lost = r.packetsLost ?? 0, got = r.packetsReceived ?? 0;
      out.lossIn = got + lost > 0 ? (lost / (got + lost)) * 100 : 0;
      out.jitter = r.jitter != null ? r.jitter * 1000 : undefined;
      out.concealed = r.totalSamplesReceived ? ((r.concealedSamples ?? 0) / r.totalSamplesReceived) * 100 : undefined;
      // jitter buffer speeding up / slowing down the voice – the classic "robot" sound
      out.stretch = r.totalSamplesReceived ? (((r.insertedSamplesForDeceleration ?? 0) + (r.removedSamplesForAcceleration ?? 0)) / r.totalSamplesReceived) * 100 : undefined;
      if (r.audioLevel != null) out.levelIn = r.audioLevel;
      if (lastIn.t) out.kbpsIn = ((r.bytesReceived - lastIn.bytes) * 8) / (r.timestamp - lastIn.t);
      lastIn = { t: r.timestamp, bytes: r.bytesReceived };
      const c = byId.get(r.codecId); if (c) out.codec = `${String(c.mimeType).replace('audio/', '')} ${c.clockRate / 1000} kHz${c.channels ? ' ' + c.channels + 'ch' : ''}`;
    }
    if (r.type === 'outbound-rtp' && r.kind === 'audio') {
      if (lastOut.t) out.kbpsOut = ((r.bytesSent - lastOut.bytes) * 8) / (r.timestamp - lastOut.t);
      lastOut = { t: r.timestamp, bytes: r.bytesSent };
    }
    if (r.type === 'media-source' && r.kind === 'audio') {
      if (r.audioLevel != null) out.level = r.audioLevel;
      if (r.echoReturnLossEnhancement != null) out.erle = r.echoReturnLossEnhancement;
    }
    if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') {
      out.rtt = r.currentRoundTripTime != null ? r.currentRoundTripTime * 1000 : out.rtt;
      const l = byId.get(r.localCandidateId), m = byId.get(r.remoteCandidateId);
      if (l && m) out.path = `${l.candidateType}/${l.protocol} ${l.address ?? l.ip ?? ''} ↔ ${m.candidateType} ${m.address ?? m.ip ?? ''}`;
    }
  });
  return out;
}

export const intercom = new Intercom();
(window as any).__intercom = intercom; // diagnostics from the browser console
export const useIntercom = () => useSyncExternalStore(intercom.subscribe, () => intercom.state);
