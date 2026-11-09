// Camera pan / tilt / zoom on top of the picture.
// ONVIF (HA integration ONVIF): onvif.ptz on the camera entity – continuous move while held, Stop on release, presets.
// Entities: own button / script / switch per direction (Tuya, Reolink, Hikvision buttons…) – pressed repeatedly while held.
import { useEffect, useRef, useState, type FC } from 'react';
import { hass } from '../lib/hass';
import { Icon } from '../ui/Icon';

export interface PtzCfg {
  mode?: 'onvif' | 'entities';
  /** ONVIF camera entity (default: the widget's camera) */
  entity?: string;
  speed?: number;
  up?: string; down?: string; left?: string; right?: string; zoomIn?: string; zoomOut?: string; home?: string;
  presets?: { name: string; preset: string }[];
}
type Dir = 'up' | 'down' | 'left' | 'right' | 'zoomIn' | 'zoomOut';
const ONVIF: Record<Dir, Record<string, string>> = {
  up: { tilt: 'UP' }, down: { tilt: 'DOWN' }, left: { pan: 'LEFT' }, right: { pan: 'RIGHT' }, zoomIn: { zoom: 'ZOOM_IN' }, zoomOut: { zoom: 'ZOOM_OUT' }
};
/** press an entity the way its domain wants */
function press(entity: string) {
  const d = entity.split('.')[0];
  if (d === 'button' || d === 'input_button') return hass.call(d, 'press', {}, entity);
  if (d === 'script') return hass.call('script', 'turn_on', {}, entity);
  if (d === 'scene') return hass.call('scene', 'turn_on', {}, entity);
  return hass.call('homeassistant', 'turn_on', {}, entity);
}

export const hasPtz = (p?: PtzCfg, camera?: string) => !!p && (p.mode === 'onvif' ? !!(p.entity || camera) : !!(p.up || p.down || p.left || p.right || p.zoomIn || p.zoomOut));

export const PtzPad: FC<{ cfg: PtzCfg; camera?: string; big?: boolean; onError?(m: string): void }> = ({ cfg, camera, big, onError }) => {
  const [open, setOpen] = useState(!!big);
  const held = useRef<{ dir: Dir; timer?: number } | null>(null);
  const onvifEntity = cfg.entity || camera;
  const speed = Math.max(0.1, Math.min(1, cfg.speed ?? 0.5));
  const fail = (e: any) => onError?.(e?.message ?? String(e));

  const step = (dir: Dir) => {
    if (cfg.mode === 'onvif') {
      if (!onvifEntity) return;
      hass.call('onvif', 'ptz', { ...ONVIF[dir], move_mode: 'ContinuousMove', speed, continuous_duration: 0.6 }, onvifEntity).catch(fail);
    } else { const e = cfg[dir]; if (e) press(e).catch(fail); }
  };
  const start = (dir: Dir) => {
    stop();
    navigator.vibrate?.(8);
    step(dir);
    held.current = { dir, timer: window.setInterval(() => step(dir), cfg.mode === 'onvif' ? 450 : 600) };
  };
  const stop = () => {
    const h = held.current; if (!h) return;
    clearInterval(h.timer); held.current = null;
    if (cfg.mode === 'onvif' && onvifEntity) hass.call('onvif', 'ptz', { move_mode: 'Stop' }, onvifEntity).catch(() => {});
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const btn = (dir: Dir, icon: string, label: string) => {
    if (cfg.mode !== 'onvif' && !cfg[dir]) return <span className={'ptz-b ptz-' + dir + ' off'} />;
    return <button className={'ptz-b ptz-' + dir} aria-label={label} title={label}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); start(dir); }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <Icon name={icon} size={big ? 26 : 20} /></button>;
  };
  const home = () => {
    if (cfg.mode === 'onvif' && cfg.presets?.[0] && onvifEntity) hass.call('onvif', 'ptz', { move_mode: 'GotoPreset', preset: cfg.presets[0].preset }, onvifEntity).catch(fail);
    else if (cfg.home) press(cfg.home).catch(fail);
  };
  const zoom = cfg.mode === 'onvif' || cfg.zoomIn || cfg.zoomOut;

  if (!open) return (
    <button className="ptz-toggle" onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label="Sterowanie kamerą" title="Sterowanie kamerą (góra, dół, boki, zoom)">
      <Icon name="mdi:gamepad-round-outline" size={20} /></button>
  );
  return (
    <div className={'ptz' + (big ? ' big' : '')} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="ptz-pad">
        {btn('up', 'mdi:chevron-up', 'Do góry')}
        {btn('left', 'mdi:chevron-left', 'W lewo')}
        {(cfg.home || (cfg.mode === 'onvif' && cfg.presets?.length))
          ? <button className="ptz-b ptz-home" onClick={home} aria-label="Pozycja domowa" title="Pozycja domowa"><Icon name="mdi:home-outline" size={big ? 22 : 18} /></button>
          : !big ? <button className="ptz-b ptz-home" onClick={() => setOpen(false)} aria-label="Ukryj sterowanie" title="Ukryj sterowanie"><Icon name="close" size={16} /></button> : <span className="ptz-b ptz-home off" />}
        {btn('right', 'mdi:chevron-right', 'W prawo')}
        {btn('down', 'mdi:chevron-down', 'W dół')}
      </div>
      {zoom && <div className="ptz-zoom">{btn('zoomIn', 'mdi:magnify-plus-outline', 'Przybliż')}{btn('zoomOut', 'mdi:magnify-minus-outline', 'Oddal')}</div>}
      {big && cfg.mode === 'onvif' && !!cfg.presets?.length && onvifEntity && (
        <div className="ptz-presets">{cfg.presets.map((p) => (
          <button key={p.preset} onClick={() => hass.call('onvif', 'ptz', { move_mode: 'GotoPreset', preset: p.preset }, onvifEntity).catch(fail)}>{p.name || 'Pozycja ' + p.preset}</button>))}
        </div>)}
      {!big && (cfg.home || (cfg.mode === 'onvif' && cfg.presets?.length)) && <button className="ptz-hide" onClick={() => setOpen(false)} aria-label="Ukryj sterowanie"><Icon name="close" size={14} /></button>}
    </div>
  );
};
