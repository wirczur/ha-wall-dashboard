// HLS of a Home Assistant camera entity (relayed by the add-on) – fallback for weak panels where WebRTC gives no picture.
import { api } from '../lib/api';

/** Starts HLS playback into the <video>; returns a stop function. */
export function startHls(video: HTMLVideoElement, entity: string, cb: { onLive(): void; onError(m: string): void }): () => void {
  let closed = false;
  let hls: { destroy(): void } | null = null;
  const onFrame = () => { if (!closed && video.videoWidth > 0) cb.onLive(); };
  video.addEventListener('playing', onFrame);
  video.addEventListener('loadeddata', onFrame);
  (async () => {
    const { url } = await api.get<{ url: string }>('camera/' + encodeURIComponent(entity) + '/hls');
    if (closed) return;
    video.srcObject = null;
    const abs = new URL(url, location.href).href;
    if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = abs; void video.play().catch(() => {}); return; }
    const { default: Hls } = await import('hls.js');
    if (closed) return;
    if (!Hls.isSupported()) return cb.onError('Ta przeglądarka nie odtwarza HLS');
    const h = new Hls({ lowLatencyMode: true, liveSyncDuration: 2, liveMaxLatencyDuration: 6, maxBufferLength: 6, backBufferLength: 4 });
    hls = h;
    h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean; details?: string }) => { if (d.fatal && !closed) cb.onError('HLS: ' + (d.details ?? 'błąd')); });
    h.loadSource(abs);
    h.attachMedia(video);
    void video.play().catch(() => {});
  })().catch((e: Error) => { if (!closed) cb.onError(e.message); });
  return () => {
    closed = true;
    video.removeEventListener('playing', onFrame); video.removeEventListener('loadeddata', onFrame);
    hls?.destroy();
    if (video.src) { video.removeAttribute('src'); video.load(); }
  };
}
