// Waking a wall tablet. Fully Kiosk Browser exposes `window.fully` when
// "Advanced Web Settings → Enable JavaScript Interface" is on; sound and speech also work in other browsers.
import type { WakeOptions } from '../../../shared/types';

interface Fully {
  turnScreenOn?(): void; stopScreensaver?(): void; bringToForeground?(): void;
  setScreenBrightness?(v: number): void; playSound?(url: string, loop: boolean): void; stopSound?(): void; textToSpeech?(text: string): void;
  setAudioVolume?(level: number, stream: number): void;
  getAudioVolume?(stream: number): number;
}
declare global { interface Window { fully?: Fully } }

export const hasFully = () => typeof window !== 'undefined' && !!window.fully;

export function wakeTablet(w: WakeOptions = {}) {
  const f = window.fully;
  try {
    if (f) {
      if (w.screen !== false) { f.turnScreenOn?.(); f.stopScreensaver?.(); f.bringToForeground?.(); }
      if (w.brightness != null) f.setScreenBrightness?.(Math.round(w.brightness));
    }
    if (w.sound) playTabletSound(w.sound, { loop: w.soundLoop, volume: w.volume });
    if (w.tts && !quiet) {
      if (f?.textToSpeech) f.textToSpeech(w.tts);
      else if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(w.tts); u.lang = 'pl-PL'; speechSynthesis.speak(u); }
    }
  } catch { /* not every Fully build has every call */ }
}

/** Built-in melodies shipped with the add-on (web/public/sounds). */
export const SOUNDS: [string, string][] = [
  ['sounds/ding-dong.wav', 'Ding-dong (dzwonek do drzwi)'], ['sounds/westminster.wav', 'Westminster (gong zegarowy)'],
  ['sounds/dzwonek.wav', 'Dzwonek klasyczny'], ['sounds/trzy-tony.wav', 'Trzy tony (powiadomienie)'],
  ['sounds/agd-koniec.wav', 'Piszczenie – koniec prania / AGD'], ['sounds/poczekalnia.wav', 'Muzyka oczekiwania (pianino)'], ['sounds/alarm.wav', 'Alarm (szybkie piski)']
];

let current: HTMLAudioElement | null = null;
let notifyVolume: number | undefined;
/** panel's default volume for notifications / doorbell (a trigger's own volume wins) */
export function setNotifyVolume(v?: number) { notifyVolume = v; }
let quiet = false;
/** quiet mode of the panel: sounds and speech are skipped (pop-ups, screen wake and calls still work) */
export function setQuietMode(on: boolean) { quiet = on; if (on) stopTabletSound(); }
export const isQuiet = () => quiet;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let unTouch: (() => void) | undefined;

/** Play a sound on the tablet – Fully's player (works with the screen off) or the browser's Audio. */
export function playTabletSound(src: string, o: { loop?: boolean; volume?: number; force?: boolean } = {}) {
  stopTabletSound();
  if (quiet && !o.force) return;
  o = { ...o, volume: o.volume ?? notifyVolume };
  const f = window.fully;
  const url = new URL(src, location.href).href;
  if (f && o.volume != null) try { f.setAudioVolume?.(Math.round(Math.max(0, Math.min(100, o.volume))), 3); } catch { /* old Fully */ }
  if (f?.playSound) f.playSound(url, !!o.loop);
  else {
    current = new Audio(url);
    current.loop = !!o.loop;
    if (o.volume != null) current.volume = Math.max(0, Math.min(1, o.volume / 100));
    void current.play().catch(() => {});
  }
  if (o.loop) {
    stopTimer = setTimeout(stopTabletSound, 60_000);
    // any touch on the screen silences it
    const h = () => stopTabletSound();
    setTimeout(() => { window.addEventListener('pointerdown', h, { once: true, capture: true }); unTouch = () => window.removeEventListener('pointerdown', h, { capture: true }); }, 300);
  }
}
export function stopTabletSound() {
  clearTimeout(stopTimer); unTouch?.(); unTouch = undefined;
  try { window.fully?.stopSound?.(); } catch { /* ignore */ }
  if (current) { current.pause(); current = null; }
}
