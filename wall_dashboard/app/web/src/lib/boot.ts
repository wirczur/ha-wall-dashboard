export interface Boot {
  mode: 'admin' | 'kiosk';
  key?: string | null;
  version?: string;
  user?: string;
}

declare global { interface Window { __BOOT__?: Boot } }

// In `vite dev` there is no server-injected boot block: default to admin.
export const boot: Boot = window.__BOOT__ ?? { mode: 'admin', version: 'dev' };

/** Query suffix that authenticates kiosk requests. */
export const keyQuery = (extra = '') => {
  const p = new URLSearchParams(extra);
  if (boot.mode === 'kiosk' && boot.key) p.set('k', boot.key);
  const s = p.toString();
  return s ? '?' + s : '';
};
