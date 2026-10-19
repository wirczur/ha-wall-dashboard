import { useEffect, useRef, useState, type FC } from 'react';
import type { PopupDef } from '../../../shared/types';
import { hass } from '../lib/hass';
import { setEntityValue } from '../lib/setValue';
import { stopTabletSound, wakeTablet } from '../lib/fully';
import { sip, useSip } from '../lib/sip';
import { Icon } from '../ui/Icon';
import { PanelRowView } from '../view/PanelRows';
import { CameraView } from '../widgets/widgets';


/** Shows pop-ups sent by Home Assistant (event wall_dashboard_popup), e.g. the gate camera when the bell rings. */
export const PopupHost: FC = () => {
  const [popup, setPopup] = useState<PopupDef | null>(null);
  const [left, setLeft] = useState(0);
  const [toast, setToast] = useState('');

  useEffect(() => hass.onPopup((p, closeId) => {
    if (!p) {
      setPopup((cur) => {
        if (closeId && cur?.id !== closeId) return cur;
        // rejected on another panel / the call is over: stop ringing here too (the PBX moves on)
        if (cur?.sip && sip.state.ringing) sip.hangup(true);
        return null;
      });
      return;
    }
    // wake the panel (Fully Kiosk Browser JS interface, if enabled)
    wakeTablet(p.wake ?? { screen: true });
    setPopup(p); setLeft(p.timeout ?? 60);
  }), []);

  useEffect(() => {
    if (!popup || !(popup.timeout ?? 60)) return;
    const t = setInterval(() => setLeft((s) => { if (s <= 1) { setPopup(null); return 0; } return s - 1; }), 1000);
    return () => clearInterval(t);
  }, [popup]);
  // pop-up gone (closed, answered, timed out, closed on another tablet) → stop the ringing
  useEffect(() => { if (!popup) stopTabletSound(); }, [popup]);
  // wake without a pop-up (trigger action "wake")
  useEffect(() => hass.onWake((w) => wakeTablet(w)), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  if (!popup) return toast ? <div className="toast" role="status">{toast}</div> : null;
  return <PopupView popup={popup} left={left} setLeft={setLeft} onClose={() => setPopup(null)} toast={toast} setToast={setToast} />;
};

/** The pop-up itself – used on tablets and as a preview in the admin panel. */
export const PopupView: FC<{ popup: PopupDef; left: number; setLeft(f: (s: number) => number): void; onClose(): void; toast?: string; setToast(m: string): void }> =
  ({ popup, left, setLeft, onClose, toast, setToast }) => {
  const setPopup = (_: null) => onClose();
  const total = popup.timeout ?? 60;
  const close = (everywhere: boolean) => {
    if (everywhere && popup.id) hass.send({ type: 'popup-dismiss', popupId: popup.id });
    setPopup(null);
  };
  const report = (event: 'answer' | 'open' | 'reject') => { if (popup.id) hass.send({ type: 'popup-event', popupId: popup.id, event }); };
  const reject = () => {
    report('reject');
    if (popup.reject?.entity) setEntityValue(popup.reject.entity, 'on').catch((e: Error) => setToast(e.message));
    close(popup.reject?.everywhere !== false);
  };
  const rows = (popup.rows ?? []).filter((r) => r.entity !== popup.open?.entity);
  const sp = useSip();
  const wasCall = useRef(false);
  // the SIP call ended (other side hung up, answered elsewhere) → close the pop-up
  useEffect(() => {
    if (!popup.sip) return;
    if (sp.inCall) { wasCall.current = true; return; }
    if (wasCall.current && !sp.ringing) { wasCall.current = false; onClose(); }
  }, [popup.sip, sp.inCall, sp.ringing]);
  const sipAnswer = () => {
    stopTabletSound();
    if (sip.answer()) report('answer'); else setToast(sp.phase === 'ready' ? 'To połączenie już nie dzwoni' : 'Brak połączenia z centralą SIP');
  };
  const sipReject = () => { sip.hangup(true); reject(); };
  return (
    <div className="popup-scrim" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null); }}>
      <section className="popup" role="dialog" aria-modal="true" aria-label={popup.title || 'Powiadomienie'}>
        <header className="d-head">
          <div>
            {popup.subtitle && <div className="d-sub">{popup.subtitle}</div>}
            <h2>{popup.title || 'Powiadomienie'}</h2>
          </div>
          <button className="d-close" onClick={() => setPopup(null)} aria-label="Zamknij"><Icon name="close" /></button>
        </header>
        {(popup.camera || popup.go2rtc?.stream) && (
          <div className="popup-cam"><CameraView entity={popup.camera ?? ''} talk={popup.talk} onTalk={(on) => on && report('answer')} go2rtc={popup.go2rtc} /></div>
        )}
        {popup.sip && sp.inCall && (
          <div className="sip-vol" role="group" aria-label="Głośność rozmowy">
            <span>Głośność</span>
            <button onClick={() => sip.setGain(sp.gain - (sp.gain > 100 ? 50 : 25))} disabled={sp.gain <= 50} aria-label="Ciszej">−</button>
            <b>{sp.gain}%</b>
            <button onClick={() => sip.setGain(sp.gain + (sp.gain >= 100 ? 50 : 25))} disabled={sp.gain >= 400} aria-label="Głośniej">+</button>
          </div>
        )}
        {popup.sip && (
          <div className="popup-acts">
            {!sp.inCall && <button className="pa-b answer" onClick={sipAnswer}><Icon name="mdi:phone" size={24} /><span>Odbierz</span></button>}
            {sp.inCall && <button className="pa-b mute" aria-pressed={sp.muted} onClick={() => sip.mute(!sp.muted)}><Icon name={sp.muted ? 'mdi:microphone-off' : 'mdi:microphone'} size={24} /><span>{sp.muted ? 'Włącz mikrofon' : 'Wycisz'}</span></button>}
            {sp.inCall
              ? <button className="pa-b reject" onClick={() => { sip.hangup(); onClose(); }}><Icon name="mdi:phone-hangup" size={24} /><span>Rozłącz</span></button>
              : <button className="pa-b reject" onClick={sipReject}><Icon name="mdi:phone-hangup" size={24} /><span>{popup.reject?.label || 'Odrzuć'}</span></button>}
          </div>
        )}
        {(popup.open || (popup.reject && !popup.sip)) && (
          <div className="popup-acts">
            {popup.reject && !popup.sip && <button className="pa-b reject" onClick={reject}><Icon name="mdi:phone-hangup" size={24} /><span>{popup.reject.label || 'Odrzuć'}</span></button>}
            {popup.open && <OpenButton def={popup.open} onError={setToast} onOpened={(after) => { report('open'); if (after > 0) setTimeout(() => onClose(), after * 1000); }} />}
          </div>
        )}
        {rows.length > 0 && (
          <div className="d-rows">{rows.map((r, i) => <PanelRowView key={i + r.entity} row={r} onError={setToast} />)}</div>
        )}
        {total > 0 && (
          <div className="popup-foot">
            <div className="popup-bar" style={{ flex: 1 }}><div style={{ width: Math.min(100, (left / total) * 100) + '%' }} /></div>
            <span>zamknie się za {left} s</span>
            <button className="btn" onClick={() => setLeft((s) => s + 60)}>+60 s</button>
          </div>
        )}
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
};

/** Opens the gate / door. Hold for ~1 s by default so a brush against the screen does not open it. */
const OpenButton: FC<{ def: NonNullable<PopupDef['open']>; onError(m: string): void; onOpened(closeAfter: number): void }> = ({ def, onError, onOpened }) => {
  const [phase, setPhase] = useState<'idle' | 'holding' | 'busy' | 'done'>('idle');
  const timer = useRef<number>();
  const hold = def.hold !== false;
  const s = hass.states.get(def.entity);
  const label = def.label || (def.entity.startsWith('lock.') ? 'Otwórz furtkę' : 'Otwórz');
  const fire = () => {
    setPhase('busy'); navigator.vibrate?.(30);
    const d = def.entity.split('.')[0];
    const p = d === 'lock' ? hass.call('lock', (Number(s?.attributes.supported_features ?? 0) & 1) ? 'open' : 'unlock', undefined, def.entity)
      : d === 'cover' ? hass.call('cover', 'open_cover', undefined, def.entity)
      : setEntityValue(def.entity, 'on');
    p.then(() => { setPhase('done'); onOpened(def.closeAfter ?? 5); setTimeout(() => setPhase('idle'), 6000); })
      .catch((e: Error) => { setPhase('idle'); onError(e.message); });
  };
  const down = () => { if (phase !== 'idle') return; if (!hold) return fire(); setPhase('holding'); timer.current = window.setTimeout(fire, 900); };
  const up = () => { if (phase === 'holding') { clearTimeout(timer.current); setPhase('idle'); } };
  return (
    <button className={'pa-b open ' + phase} onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fire(); }} aria-label={label}>
      <i className="pa-fill" aria-hidden="true" />
      <Icon name={phase === 'done' ? 'mdi:check-bold' : 'mdi:gate-open'} size={26} />
      <span>{phase === 'done' ? 'Otwarto' : phase === 'busy' ? 'Otwieram…' : label}</span>
      {hold && phase === 'idle' && <small>przytrzymaj</small>}
    </button>
  );
};
