// Panel commands from HA / the admin (reload, restart, screen on/off, screen saver, brightness).
// Wall Dashboard Android app: native `window.wallApp`; Fully Kiosk: `window.fully`; any other browser: reload only.
import type { DeviceCmd, ScreenDef } from '../../../shared/types';

export interface WallApp {
  setConfig?(json: string): void; reload?(): void; restart?(): void;
  screenOn?(): void; screenOff?(): void; saver?(): void; setBrightness?(pct: number): void; version?(): string;
}
type FullyCmd = { turnScreenOn?(): void; turnScreenOff?(keepAlive?: boolean): void; startScreensaver?(): void; restartApp?(): void; setScreenBrightness?(v: number): void };
declare global { interface Window { wallApp?: WallApp } }

export const isWallApp = () => typeof window !== 'undefined' && !!window.wallApp;

/** hands the screen settings to the Android app (no-op elsewhere) */
export function configureApp(cfg: { tablet: string; screen?: ScreenDef; pin?: string }) {
  try { window.wallApp?.setConfig?.(JSON.stringify(cfg)); } catch { /* old app */ }
}

export function deviceCommand(cmd: DeviceCmd, value?: number) {
  const a = window.wallApp;
  const f = window.fully as unknown as FullyCmd | undefined;
  try {
    switch (cmd) {
      case 'reload': if (a?.reload) a.reload(); else location.reload(); return;
      case 'restart': if (a?.restart) a.restart(); else if (f?.restartApp) f.restartApp(); else location.reload(); return;
      case 'screen-on': a?.screenOn ? a.screenOn() : f?.turnScreenOn?.(); return;
      case 'screen-off': a?.screenOff ? a.screenOff() : f?.turnScreenOff?.(); return;
      case 'saver': a?.saver ? a.saver() : f?.startScreensaver?.(); return;
      case 'brightness':
        if (value == null) return;
        if (a?.setBrightness) a.setBrightness(value); else f?.setScreenBrightness?.(Math.round(value * 2.55));
        return;
    }
  } catch (e) { console.warn('[panel] polecenie', cmd, e); }
}
