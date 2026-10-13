// go2rtc MSE player (fMP4 over WebSocket, relayed by the add-on). Same protocol as go2rtc's video-rtc.js:
// → {type:"mse", value:"<supported codecs>"}  ← {type:"mse", value:"video/mp4; codecs=…"}  ← binary fMP4 segments.
import { keyQuery } from '../lib/boot';

const CODECS = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'hvc1.1.6.L153.B0', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'opus'];

export const mseSupported = () => typeof window !== 'undefined' && ('MediaSource' in window || 'ManagedMediaSource' in window);

/** Starts playback into the <video>; returns a stop function. onLive = first frame shown, onError = give up. */
export function startMse(video: HTMLVideoElement, stream: string, cb: { onLive(): void; onError(m: string): void }): () => void {
  const MS: typeof MediaSource = (window as any).ManagedMediaSource ?? window.MediaSource;
  const ms = new MS();
  let ws: WebSocket | null = null;
  let sb: SourceBuffer | null = null;
  let closed = false;
  const queue: ArrayBuffer[] = [];
  let live = false;

  const pump = () => {
    if (!sb || sb.updating || !queue.length) return;
    try { sb.appendBuffer(queue.shift()!); } catch (e: any) { if (e?.name === 'QuotaExceededError') trim(true); else fail('MSE: ' + e.message); }
  };
  const trim = (hard = false) => {
    if (!sb || sb.updating || !sb.buffered.length) return;
    const start = sb.buffered.start(0), end = sb.buffered.end(sb.buffered.length - 1);
    if (hard || end - start > 20) { try { sb.remove(start, end - 8); } catch { /* */ } }
    // stay at the live edge (doorbell: latency matters more than smoothness)
    if (video.currentTime < end - 3 || video.currentTime > end) video.currentTime = Math.max(start, end - 0.4);
  };
  const fail = (m: string) => { if (closed) return; stop(); cb.onError(m); };

  const onOpen = () => {
    const u = new URL('api/go2rtc/ws' + keyQuery('stream=' + encodeURIComponent(stream)), location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(u.toString());
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const codecs = CODECS.filter((c) => MS.isTypeSupported(`video/mp4; codecs="${c}"`)).join();
      ws!.send(JSON.stringify({ type: 'mse', value: codecs }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'mse') {
          try {
            sb = ms.addSourceBuffer(msg.value);
            sb.mode = 'segments';
            sb.addEventListener('updateend', () => { pump(); trim(); });
          } catch (e: any) { fail('Ten panel nie obsługuje kodeka ' + msg.value); }
        } else if (msg.type === 'error') fail('go2rtc: ' + msg.value);
        return;
      }
      queue.push(ev.data as ArrayBuffer);
      if (queue.length > 60) queue.splice(0, queue.length - 60);
      pump();
    };
    ws.onerror = () => fail('Brak połączenia z go2rtc (MSE)');
    ws.onclose = () => { if (!closed && !live) fail('go2rtc zamknął strumień MSE'); };
  };

  const onFrame = () => {
    if (live || video.videoWidth === 0) return;
    live = true; cb.onLive();
  };
  video.addEventListener('loadeddata', onFrame);
  video.addEventListener('playing', onFrame);
  ms.addEventListener('sourceopen', onOpen, { once: true });
  video.srcObject = null;
  (video as any).disableRemotePlayback = true;
  video.src = URL.createObjectURL(ms);
  video.play().catch(() => {});

  function stop() {
    closed = true;
    video.removeEventListener('loadeddata', onFrame); video.removeEventListener('playing', onFrame);
    try { ws?.close(); } catch { /* */ }
    try { if (ms.readyState === 'open') ms.endOfStream(); } catch { /* */ }
    if (video.src.startsWith('blob:')) { URL.revokeObjectURL(video.src); video.removeAttribute('src'); video.load(); }
  }
  return stop;
}
