// Assist on the panel: text questions, hold-to-talk and wake word. The add-on runs the HA pipeline;
// here: the conversation, the microphone (16 kHz s16le mono as binary frames) and the spoken answer.
import { useSyncExternalStore } from 'react';
import type { AssistEvent } from '../../../shared/types';
import { keyQuery } from './boot';
import { hass } from './hass';
import { intercom } from './intercom';
import { sip } from './sip';

export interface AssistConfig { enabled: boolean; voice: 'off' | 'ptt' | 'wake'; tts: boolean; wakeInQuiet?: boolean; hints?: string[] }
export type AssistPhase = 'idle' | 'ready' | 'listening' | 'thinking' | 'speaking';
export interface AssistMsg { id: number; who: 'me' | 'ai' | 'err'; text: string }
export interface AssistState { cfg: AssistConfig | null; open: boolean; phase: AssistPhase; msgs: AssistMsg[]; byWake: boolean; wakeOn: boolean; micError?: string }

/** microphone → 16 kHz PCM frames over the add-on connection */
class Mic {
  private stream?: MediaStream; private ctx?: AudioContext; private node?: ScriptProcessorNode; private src?: MediaStreamAudioSourceNode;
  private buf: number[] = [];
  running = false;
  async start() {
    if (this.running) return;
    this.running = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) { this.running = false; throw e; }
    if (!this.running) { this.release(); return; }
    this.ctx = new AudioContext();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const ratio = this.ctx.sampleRate / 16000;
    this.node.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      // downsample by averaging
      for (let i = 0; i + ratio <= input.length; i += ratio) {
        let sum = 0, n = 0;
        for (let j = Math.floor(i); j < Math.floor(i + ratio); j++) { sum += input[j]; n++; }
        this.buf.push(n ? sum / n : 0);
      }
      if (this.buf.length >= 1600) { // 100 ms
        const pcm = new Int16Array(this.buf.length);
        for (let i = 0; i < this.buf.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(this.buf[i] * 32767)));
        this.buf = [];
        hass.sendBinary(pcm.buffer);
      }
    };
    this.src.connect(this.node);
    this.node.connect(this.ctx.destination); // ScriptProcessor runs only when connected (it outputs silence)
  }
  stop() { this.running = false; this.release(); }
  private release() {
    try { this.node?.disconnect(); this.src?.disconnect(); } catch { /* */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.node = undefined; this.src = undefined; this.stream = undefined; this.ctx = undefined; this.buf = [];
  }
}

class Assistant {
  state: AssistState = { cfg: null, open: false, phase: 'idle', msgs: [], byWake: false, wakeOn: false };
  private listeners = new Set<() => void>();
  private mic = new Mic();
  private seq = 0;
  private audio?: HTMLAudioElement;
  private closeTimer?: number;
  private ptt = false;
  private watch?: number;

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<AssistState>) { this.state = { ...this.state, ...p }; this.listeners.forEach((l) => l()); }
  private say(who: AssistMsg['who'], text: string) { this.set({ msgs: [...this.state.msgs.slice(-30), { id: ++this.seq, who, text }] }); }

  private hooked = false;
  start(cfg?: AssistConfig) {
    this.set({ cfg: cfg?.enabled ? cfg : null });
    if (!this.hooked) { this.hooked = true; hass.onAssist((e) => this.onEvent(e)); }
    clearInterval(this.watch);
    if (cfg?.enabled && cfg.voice === 'wake') {
      // the wake word listens unless a call uses the microphone, the page is hidden or it is quiet time
      this.watch = window.setInterval(() => this.syncWake(), 2000);
      this.syncWake();
    }
  }

  private wakeAllowed() {
    const c = this.state.cfg;
    if (!c || c.voice !== 'wake' || document.hidden) return false;
    if (hass.quiet.on && !c.wakeInQuiet) return false;
    if (sip.state.inCall || sip.state.ringing) return false;
    if (!['idle', 'ended'].includes(intercom.state.phase)) return false;
    return true;
  }
  private syncWake() {
    const want = this.wakeAllowed();
    if (want === this.state.wakeOn) return;
    if (want) {
      this.mic.start().then(() => { hass.send({ type: 'assist_wake', on: true }); this.set({ wakeOn: true, micError: undefined }); })
        .catch((e) => this.set({ micError: 'Brak mikrofonu: ' + (e?.message ?? e) }));
    } else {
      hass.send({ type: 'assist_wake', on: false });
      if (!this.ptt) this.mic.stop();
      this.set({ wakeOn: false, phase: this.state.phase === 'ready' ? 'idle' : this.state.phase });
    }
  }

  open(on = true) { clearTimeout(this.closeTimer); this.set({ open: on, byWake: false }); if (!on) this.stopAudio(); }

  ask(text: string) {
    const t = text.trim(); if (!t) return;
    this.stopAudio();
    this.say('me', t);
    this.set({ phase: 'thinking' });
    hass.send({ type: 'assist_text', text: t });
  }

  async pttDown() {
    if (!this.state.cfg || this.state.cfg.voice === 'off') return;
    this.stopAudio();
    this.ptt = true;
    try { await this.mic.start(); } catch (e: any) { this.ptt = false; this.say('err', 'Brak dostępu do mikrofonu (' + (e?.message ?? e) + '). Potrzebny HTTPS i zgoda na mikrofon.'); return; }
    if (!this.ptt) return; // released before the microphone opened
    hass.send({ type: 'assist_voice', on: true });
    this.set({ phase: 'listening' });
  }
  pttUp() {
    if (!this.ptt) return;
    this.ptt = false;
    hass.send({ type: 'assist_voice', on: false });
    if (!this.state.wakeOn) window.setTimeout(() => { if (!this.ptt && !this.state.wakeOn) this.mic.stop(); }, 300);
    if (this.state.phase === 'listening') this.set({ phase: 'thinking' });
  }

  private stopAudio() { if (this.audio) { this.audio.pause(); this.audio = undefined; } }

  private onEvent(e: AssistEvent) {
    switch (e.ev) {
      case 'ready': if (this.state.phase === 'idle') this.set({ phase: 'ready' }); break;
      case 'wake':
        this.stopAudio();
        clearTimeout(this.closeTimer);
        this.set({ open: true, byWake: !this.state.open || this.state.byWake, phase: 'listening' });
        navigator.vibrate?.(20);
        break;
      case 'listening': this.set({ phase: 'listening' }); break;
      case 'stt': this.say('me', e.text ?? ''); this.set({ phase: 'thinking' }); break;
      case 'reply': this.say('ai', e.text ?? ''); break;
      case 'tts': {
        if (hass.quiet.on || !e.url) break;
        this.stopAudio();
        const a = new Audio(e.url + keyQuery());
        this.audio = a;
        this.set({ phase: 'speaking' });
        a.onended = a.onerror = () => { if (this.audio === a) { this.audio = undefined; this.afterTurn(); } };
        a.play().catch(() => this.afterTurn());
        return;
      }
      case 'error': if (e.text) this.say('err', e.text); break;
      case 'end': if (this.state.phase !== 'speaking') this.afterTurn(); break;
    }
  }
  private afterTurn() {
    this.set({ phase: this.state.wakeOn ? 'ready' : 'idle' });
    // opened by the wake word → close by itself a while after the answer
    if (this.state.byWake) { clearTimeout(this.closeTimer); this.closeTimer = window.setTimeout(() => this.set({ open: false, byWake: false }), 12_000); }
  }
}

export const assistant = new Assistant();
export const useAssistant = () => useSyncExternalStore(assistant.subscribe, () => assistant.state);
