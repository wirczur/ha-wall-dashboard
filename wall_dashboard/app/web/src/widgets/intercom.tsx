// Intercom: call buttons for the other panels (widget) and the call screen (IntercomHost, mounted in the kiosk).
import { useEffect, useState, type FC } from 'react';
import type { IcPeer, WidgetDef } from '../../../shared/types';
import { api } from '../lib/api';
import { boot } from '../lib/boot';
import { callStats, intercom, useIntercom, type IcConfig, type IcStats } from '../lib/intercom';
import { Icon } from '../ui/Icon';

function usePeers() {
  const [peers, setPeers] = useState<IcPeer[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (boot.mode !== 'kiosk') { setPeers([{ id: 'a', name: 'Parter', online: true }, { id: 'b', name: 'Piętro', online: true }]); return; }
    let alive = true;
    const load = () => api.get<IcPeer[]>('intercom/peers').then((p) => { if (alive) { setPeers(p); setErr(''); } }).catch((e) => alive && setErr(e.message));
    load(); const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { peers, err };
}

export const IntercomWidget: FC<{ w: WidgetDef }> = ({ w }) => {
  const o = w.options ?? {};
  const { peers, err } = usePeers();
  const st = useIntercom();
  useEffect(() => { if (isFinite(Number(o.volume))) intercom.volume = Number(o.volume); }, [o.volume]);
  const targets: string[] = Array.isArray(o.targets) ? o.targets : [];
  const list = (peers ?? []).filter((p) => boot.mode !== 'kiosk' || !targets.length || targets.includes(p.id));
  const busy = st.phase !== 'idle' && st.phase !== 'ended';
  const one = list.length === 1;
  return (
    <div className={'ic' + (one ? ' ic-one' : '')} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {!one && <div className="ic-hd"><Icon name="mdi:phone-in-talk-outline" size={18} /><b>{w.title || 'Interkom'}</b></div>}
      {err && <small className="ic-err">{err}</small>}
      {peers && !list.length && <small className="ic-err">Brak innych paneli z włączonym interkomem (Tablety → Interkom)</small>}
      <div className="ic-list">
        {list.map((p) => (
          <button key={p.id} className={'ic-btn' + (p.online ? '' : ' off')} disabled={busy || !p.online || boot.mode !== 'kiosk'} onClick={() => intercom.call(p)}
            aria-label={`Zadzwoń: ${p.name}`}>
            <span className="ic-ico"><Icon name="mdi:phone" size={one ? 30 : 22} /></span>
            <span className="ic-txt"><b>{one && w.title ? w.title : p.name}</b><small>{!p.online ? 'niedostępny' : p.busy ? 'rozmawia' : one && w.title && w.title !== p.name ? p.name : 'zadzwoń'}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Full-screen call UI: incoming ring, calling, talking, ended. */
export const IntercomHost: FC<{ cfg?: IcConfig }> = ({ cfg }) => {
  const st = useIntercom();
  const [diag, setDiag] = useState(false);
  const [stats, setStats] = useState<IcStats | null>(null);
  useEffect(() => {
    if (!diag || st.phase !== 'active') return;
    const t = setInterval(() => { void callStats().then(setStats); }, document.documentElement.dataset.lite === '1' ? 2000 : 1000);
    return () => clearInterval(t);
  }, [diag, st.phase]);
  const [, tick] = useState(0);
  useEffect(() => { intercom.start(); }, []);
  useEffect(() => { intercom.cfg = cfg ?? {}; }, [cfg]);
  useEffect(() => { if (st.phase !== 'incoming' || !st.autoAt) return; const t = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(t); }, [st.phase, st.autoAt]);
  useEffect(() => { if (st.phase !== 'active') return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [st.phase]);
  if (st.phase === 'idle') return null;
  const name = st.peer?.name ?? 'Panel';
  const secs = st.since ? Math.floor((Date.now() - st.since) / 1000) : 0;
  return (
    <div className={'ic-scrim ic-' + st.phase} role="dialog" aria-modal="true" aria-label={`Interkom: ${name}`}>
      <div className="ic-card">
        <div className="ic-avatar"><Icon name={st.phase === 'incoming' ? 'mdi:phone-ring' : st.phase === 'active' ? 'mdi:account-voice' : 'mdi:phone-outgoing'} size={44} />
          {(st.phase === 'incoming' || st.phase === 'outgoing') && <i className="ic-wave" />}</div>
        <small className="ic-kind">{st.phase === 'incoming' ? 'Dzwoni' : st.phase === 'outgoing' ? 'Dzwonisz do' : st.phase === 'ended' ? '' : 'Rozmowa'}</small>
        <h2>{name}</h2>
        <div className="ic-note">{st.phase === 'active' ? fmt(secs) + (st.ptt ? (st.talking ? ' · mówisz – puść, aby słuchać' : ' · słuchasz') : '') + (st.muted && st.autoAt ? ' · tylko słuchasz – dotknij Mikrofon, aby odpowiedzieć' : '')
          : st.phase === 'incoming' && st.autoAt ? `Odbieram automatycznie${st.autoAt > Date.now() ? ' za ' + Math.ceil((st.autoAt - Date.now()) / 1000) + ' s' : '…'}` : st.note ?? ''}</div>
        {diag && st.phase === 'active' && stats && (
          <div className="ic-diag">
            <span>Kodek <b>{stats.codec ?? '–'}</b></span>
            <span>Opóźnienie <b>{stats.rtt != null ? Math.round(stats.rtt) + ' ms' : '–'}</b></span>
            <span>Jitter <b>{stats.jitter != null ? Math.round(stats.jitter) + ' ms' : '–'}</b></span>
            <span className={(stats.lossIn ?? 0) > 2 ? 'bad' : ''}>Utracone pakiety <b>{stats.lossIn != null ? stats.lossIn.toFixed(1) + '%' : '–'}</b></span>
            <span className={(stats.concealed ?? 0) > 3 ? 'bad' : ''}>Zatuszowane próbki <b>{stats.concealed != null ? stats.concealed.toFixed(1) + '%' : '–'}</b></span>
            <span>Odbiór / wysyłka <b>{stats.kbpsIn != null ? Math.round(stats.kbpsIn) : '–'} / {stats.kbpsOut != null ? Math.round(stats.kbpsOut) : '–'} kb/s</b></span>
            <span className={(stats.stretch ?? 0) > 5 ? 'bad' : ''}>Rozciąganie głosu <b>{stats.stretch != null ? stats.stretch.toFixed(1) + '%' : '–'}</b></span>
            <span>Tłumienie echa <b>{stats.erle != null ? Math.round(stats.erle) + ' dB' : '–'}</b></span>
            <span>Mikrofon <b className="ic-lvl"><i style={{ width: Math.min(100, (stats.level ?? 0) * 300) + '%' }} /></b></span>
            <span>Dźwięk z drugiego <b className="ic-lvl"><i style={{ width: Math.min(100, (stats.levelIn ?? 0) * 300) + '%' }} /></b></span>
            <small>{stats.path ?? ''}</small>
            <small>{(stats.lossIn ?? 0) > 2 ? 'Gubione pakiety → sieć (Wi-Fi / przełącznik / inna podsieć).'
              : (stats.concealed ?? 0) > 3 || (stats.stretch ?? 0) > 5 ? 'Brak strat w sieci, a dźwięk się rwie → za słaby panel: spróbuj „Przetwarzanie mikrofonu: Wyłączone” lub „Krótkofalówka”.'
              : 'Sieć i dekodowanie OK. Jeśli pasek „Dźwięk z drugiego” zanika, gdy ktoś mówi → głos wycina redukcja echa po tamtej stronie: ustaw tam „Krótkofalówka”.'}</small>
          </div>
        )}
        <div className="ic-acts">
          {st.phase === 'incoming' && <>
            <button className="ic-round red" onClick={() => intercom.reject()} aria-label="Odrzuć"><Icon name="mdi:phone-hangup" size={30} /><span>Odrzuć</span></button>
            <button className="ic-round green" onClick={() => intercom.answer()} aria-label="Odbierz"><Icon name="mdi:phone" size={30} /><span>Odbierz</span></button>
          </>}
          {(st.phase === 'outgoing' || st.phase === 'connecting') && <button className="ic-round red" onClick={() => intercom.hangup('cancel')} aria-label="Rozłącz"><Icon name="mdi:phone-hangup" size={30} /><span>Rozłącz</span></button>}
          {st.phase === 'active' && <>
            <button className={'ic-round' + (diag ? ' on' : '')} onClick={() => setDiag(!diag)} aria-pressed={diag} aria-label="Jakość połączenia"><Icon name="mdi:information-outline" size={26} /><span>Jakość</span></button>
            {st.ptt ? (
              <button className={'ic-round ic-ptt' + (st.talking ? ' on' : '')} aria-pressed={!!st.talking} aria-label="Przytrzymaj, aby mówić"
                onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); intercom.talk(true); }}
                onPointerUp={() => intercom.talk(false)} onPointerCancel={() => intercom.talk(false)} onLostPointerCapture={() => intercom.talk(false)}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); intercom.talk(true); } }}
                onKeyUp={() => intercom.talk(false)} onContextMenu={(e) => e.preventDefault()}>
                <Icon name="mdi:microphone" size={34} /><span>{st.talking ? 'Mówisz…' : 'Przytrzymaj i mów'}</span>
              </button>
            ) : <button className={'ic-round' + (st.muted ? ' on' : '')} onClick={() => intercom.toggleMute()} aria-pressed={!!st.muted} aria-label="Wycisz mikrofon"><Icon name={st.muted ? 'mdi:microphone-off' : 'mdi:microphone'} size={28} /><span>{st.muted ? 'Wyciszony' : 'Mikrofon'}</span></button>}
            <button className="ic-round red" onClick={() => intercom.hangup()} aria-label="Rozłącz"><Icon name="mdi:phone-hangup" size={30} /><span>Rozłącz</span></button>
          </>}
          {st.phase === 'ended' && <button className="ic-round" onClick={() => intercom.dismiss()} aria-label="Zamknij"><Icon name="close" size={26} /><span>Zamknij</span></button>}
        </div>
      </div>
    </div>
  );
};
