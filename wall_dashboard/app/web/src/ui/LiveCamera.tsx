import { useEffect, useRef, useState, type FC } from 'react';
import { hass } from '../lib/hass';
import { keyQuery } from '../lib/boot';
import { Icon } from './Icon';
import { mseSupported, startMse } from './msePlayer';
import { startHls } from './hlsPlayer';

export interface LiveCameraProps {
  entity?: string;
  /** go2rtc stream (signalling relayed by the add-on), otherwise the HA camera entity */
  go2rtc?: { url?: string; stream: string };
  /** show the talk button (two-way audio, needs HTTPS on the tablet) */
  talk?: boolean;
  /** the user switched the microphone on / off (pop-up: "answered") */
  onTalk?(on: boolean): void;
  /** called when WebRTC fails, so the caller can fall back to snapshots */
  onFail?(msg: string): void;
  className?: string;
}

type Status = 'connecting' | 'live' | 'error';

/**
 * Live camera over WebRTC. With Home Assistant 2024.11+ the stream comes from HA's built-in go2rtc
 * (camera/webrtc/offer, proxied by the add-on). Two-way audio sends the tablet microphone in the same
 * session; whether the camera plays it depends on go2rtc's backchannel support (e.g. Hikvision ISAPI).
 */
export const LiveCamera: FC<LiveCameraProps> = ({ entity, go2rtc, talk, onTalk, onFail, className }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [err, setErr] = useState('');
  const [talking, setTalking] = useState(false);
  const [muted, setMuted] = useState(true);
  const [gen, setGen] = useState(0); // bump to restart the session (e.g. after enabling the mic)
  // go2rtc transport: null = auto (WebRTC, Lite tablets start with MSE), true = MSE over WebSocket, false = WebRTC only
  const [mse, setMse] = useState<boolean | null>(null);
  const [via, setVia] = useState('');

  useEffect(() => {
    let closed = false;
    let pc: RTCPeerConnection | null = null;
    let mic: MediaStream | null = null;
    const id = hass.nextId();
    let offRtc = () => {};
    // go2rtc over MSE (WebSocket through the add-on): no UDP, works across subnets / proxies – like HA's camera card fallback
    // fallback transport: MSE for go2rtc streams, HLS (via Home Assistant) for camera entities
    const canMse = go2rtc ? mseSupported() : !!entity && !talking && mseSupported();
    const fail = (m: string) => {
      if (closed) return;
      if (canMse && mse === null) { setMse(true); return; } // WebRTC failed – try MSE before giving up
      setStatus('error'); setErr(m); onFail?.(m);
    };
    const wantMse = canMse && (mse === true || (mse === null && document.documentElement.dataset.lite === '1'));
    if (wantMse && video.current && !go2rtc) {
      setStatus('connecting'); setErr(''); setVia('HLS');
      const v = video.current;
      const stopHls = startHls(v, entity!, {
        onLive: () => { if (!closed) setStatus('live'); },
        onError: () => { if (!closed) setMse(false); }
      });
      const wd = setTimeout(() => { if (!closed && v.videoWidth === 0) setMse(false); }, 20_000);
      return () => { closed = true; clearTimeout(wd); stopHls(); };
    }
    if (wantMse && video.current) {
      setStatus('connecting'); setErr(''); setVia('MSE');
      const v = video.current;
      const stopMse = startMse(v, go2rtc!.stream, {
        onLive: () => { if (!closed) setStatus('live'); },
        onError: (m) => { if (closed) return; if (mse === null || mse === true) setMse(false); else fail(m); }
      });
      const wd = setTimeout(() => { if (!closed && v.videoWidth === 0) setMse(false); }, 12_000);
      // talking while the picture comes over MSE: a separate audio-only WebRTC session (mic → intercom, intercom → speaker)
      let apc: RTCPeerConnection | null = null, amic: MediaStream | null = null; const aEl = new Audio(); aEl.autoplay = true;
      if (talking) (async () => {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setTalking(false); return; }
        amic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (closed) { amic.getTracks().forEach((t) => t.stop()); return; }
        apc = new RTCPeerConnection({ iceServers: [] });
        amic.getAudioTracks().forEach((t) => apc!.addTransceiver(t, { direction: 'sendrecv' }));
        apc.ontrack = (ev) => { aEl.srcObject = new MediaStream([ev.track]); void aEl.play().catch(() => {}); };
        await apc.setLocalDescription(await apc.createOffer());
        await new Promise<void>((r) => { if (apc!.iceGatheringState === 'complete') return r(); apc!.onicegatheringstatechange = () => apc!.iceGatheringState === 'complete' && r(); setTimeout(r, 2000); });
        const res = await fetch('api/go2rtc/webrtc' + keyQuery('stream=' + go2rtc!.stream), { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: apc.localDescription!.sdp });
        if (!res.ok || closed) return;
        const answer = await res.text();
        await apc.setRemoteDescription({ type: 'answer', sdp: answer.trim().startsWith('{') ? JSON.parse(answer).sdp : answer });
      })().catch(() => { setErr('Rozmowa niedostępna (WebRTC)'); });
      return () => { closed = true; clearTimeout(wd); stopMse(); apc?.close(); amic?.getTracks().forEach((t) => t.stop()); aEl.srcObject = null; };
    }
    setVia(go2rtc ? 'WebRTC' : '');
    if (video.current?.src) { video.current.removeAttribute('src'); }
    // watchdog: connected but no picture (UDP blocked between subnets, or the decoder can't handle the stream)
    const watchdog = setTimeout(() => {
      const v = video.current;
      if (closed || (v && v.videoWidth > 0)) return;
      if (canMse && mse === null) { setMse(true); return; } // try MSE before giving up
      fail('Brak obrazu – ten panel nie dekoduje strumienia (np. H.265 lub za wysoka rozdzielczość). Ustaw lżejszy strumień dla paneli Lite.');
    }, go2rtc ? 7_000 : 15_000);

    (async () => {
      setStatus('connecting'); setErr('');
      if (talking) {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setTalking(false); return fail('Mikrofon wymaga połączenia HTTPS — włącz „HTTPS dla kiosku” w konfiguracji add-onu.'); }
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
        catch { setTalking(false); return fail('Brak zgody na mikrofon w przeglądarce tabletu.'); }
      }
      const iceServers = go2rtc ? [] : await new Promise<RTCIceServer[]>((resolve) => {
        const off = hass.onRtc(id, (e) => { if (e.type === 'config') { off(); resolve(e.iceServers as RTCIceServer[]); } else if (e.type === 'error') { off(); resolve([]); } });
        if (!hass.send({ type: 'webrtc-config', id, entity: entity ?? '' })) { off(); resolve([]); }
        setTimeout(() => { off(); resolve([]); }, 3000);
      });
      if (closed) return;
      pc = new RTCPeerConnection({ iceServers });
      pc.addTransceiver('video', { direction: 'recvonly' });
      if (mic) mic.getAudioTracks().forEach((t) => pc!.addTransceiver(t, { direction: 'sendrecv' }));
      else pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.ontrack = (ev) => {
        const v = video.current; if (!v) return;
        if (!v.srcObject) v.srcObject = new MediaStream();
        (v.srcObject as MediaStream).addTrack(ev.track);
        v.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === 'connected') setStatus('live');
        if (pc?.connectionState === 'failed') fail('Nie udało się zestawić połączenia z kamerą.');
      };

      if (go2rtc) {
        // go2rtc: one-shot SDP exchange over HTTP once ICE gathering is done
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise<void>((r) => { if (pc!.iceGatheringState === 'complete') return r(); pc!.onicegatheringstatechange = () => pc!.iceGatheringState === 'complete' && r(); setTimeout(r, 2000); });
        const res = await fetch('api/go2rtc/webrtc' + keyQuery('stream=' + go2rtc.stream), { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp });
        if (!res.ok) { const t = await res.text().catch(() => ''); return fail('go2rtc: ' + (t.match(/"error":"([^"]+)"/)?.[1] ?? res.status)); }
        const answer = await res.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answer.trim().startsWith('{') ? JSON.parse(answer).sdp : answer });
        return;
      }

      if (!entity) return fail('Brak encji kamery');
      // Home Assistant: trickle ICE through the add-on
      let session = '';
      const queued: RTCIceCandidateInit[] = [];
      const sendCand = (c: RTCIceCandidateInit) => hass.send({ type: 'webrtc-candidate', id, entity: entity ?? '', session_id: session, candidate: { candidate: c.candidate!, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } });
      pc.onicecandidate = (ev) => { if (!ev.candidate) return; const c = ev.candidate.toJSON(); session ? sendCand(c) : queued.push(c); };
      offRtc = hass.onRtc(id, async (e) => {
        try {
          if (e.type === 'session') { session = e.session_id; queued.splice(0).forEach(sendCand); }
          else if (e.type === 'answer') await pc!.setRemoteDescription({ type: 'answer', sdp: e.answer });
          else if (e.type === 'candidate') await pc!.addIceCandidate(e.candidate);
          else if (e.type === 'error') fail(e.message || 'Kamera nie obsługuje WebRTC');
        } catch (x: any) { fail(x.message); }
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!hass.send({ type: 'webrtc-offer', id, entity: entity ?? '', offer: offer.sdp! })) fail('Brak połączenia z add-onem');
    })().catch((e) => fail(e.message || String(e)));

    return () => {
      closed = true; offRtc(); clearTimeout(watchdog);
      hass.send({ type: 'webrtc-close', id });
      pc?.close(); mic?.getTracks().forEach((t) => t.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [entity, go2rtc?.url, go2rtc?.stream, talking, gen, mse]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={'live-cam ' + (className ?? '')}>
      <video ref={video} autoPlay playsInline muted={muted} />
      {status !== 'live' && (
        <div className="live-msg">
          {status === 'connecting' ? 'Łączenie z kamerą…' : err}
          {status === 'error' && <button className="mini" onClick={() => { setMse(null); setGen((g) => g + 1); }}>Ponów</button>}
        </div>
      )}
      <span className={'w-live' + (status === 'live' ? '' : ' wait')}>NA ŻYWO{via === 'MSE' || via === 'HLS' ? ' · ' + via : ''}</span>
      <div className="live-ctl">
        <button className="live-btn" aria-pressed={!muted} onClick={() => { setMuted(!muted); video.current?.play().catch(() => {}); }}
          aria-label={muted ? 'Włącz dźwięk' : 'Wycisz'}><Icon name={muted ? 'mute' : 'volume'} /></button>
        {talk && (
          <button className="live-btn talk" aria-pressed={talking} onClick={() => { setMuted(false); onTalk?.(!talking); setTalking(!talking); }}>
            <Icon name="mic" /><span>{talking ? 'Zakończ rozmowę' : 'Odbierz'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
