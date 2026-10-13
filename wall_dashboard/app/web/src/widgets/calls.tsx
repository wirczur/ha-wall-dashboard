// Doorbell / gate intercom call log: who rang, when, a camera frame, and whether anyone answered.
import { useCallback, useEffect, useState, type FC } from 'react';
import type { CallRecord, WidgetDef } from '../../../shared/types';
import { api } from '../lib/api';
import { keyQuery } from '../lib/boot';
import { hass } from '../lib/hass';
import { Icon } from '../ui/Icon';

const STATUS: Record<CallRecord['status'], [string, string]> = {
  missed: ['Nieodebrane', 'mdi:phone-missed'], answered: ['Odebrane', 'mdi:phone-check'], opened: ['Otwarto', 'mdi:gate-open'],
  rejected: ['Odrzucone', 'mdi:phone-hangup'], ringing: ['Dzwoni…', 'mdi:phone-ring']
};
const snap = (id: string) => 'api/calls/' + encodeURIComponent(id) + '/snapshot' + keyQuery();
function when(t: number) {
  const d = new Date(t), now = new Date();
  const day = d.toDateString() === now.toDateString() ? 'dziś' : new Date(now.getTime() - 864e5).toDateString() === d.toDateString() ? 'wczoraj'
    : d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`;
}

export function useCalls() {
  const [data, setData] = useState<{ calls: CallRecord[]; missed: number } | null>(null);
  const load = useCallback(() => api.get<{ calls: CallRecord[]; missed: number }>('calls').then(setData).catch(() => setData({ calls: [], missed: 0 })), []);
  useEffect(() => { load(); const off = hass.onCalls(() => load()); const t = setInterval(load, 5 * 60_000); return () => { off(); clearInterval(t); }; }, [load]);
  return { data, load };
}

export const CallsWidget: FC<{ w: WidgetDef }> = ({ w }) => {
  const o = w.options ?? {};
  const { data, load } = useCalls();
  const [big, setBig] = useState<CallRecord | null>(null);
  const onlyMissed = o.onlyMissed !== false;
  const list = (data?.calls ?? []).filter((c) => (!onlyMissed || c.status === 'missed') && (!o.triggers?.length || o.triggers.includes(c.trigger))).slice(0, Number(o.count) || 20);
  const unseen = list.filter((c) => c.status === 'missed' && !c.seen).length;
  const compact = w.h <= 2;
  const seen = () => api.post('calls/seen').then(load).catch(() => {});

  if (compact) {
    const last = list[0];
    return (<>
      <button className={'calls cg-compact' + (unseen ? ' hot' : '')} onClick={(e) => { e.stopPropagation(); if (last) setBig(last); }}>
        <span className="cg-ico"><Icon name={unseen ? 'mdi:phone-missed' : 'mdi:doorbell'} size={26} />{unseen > 0 && <i className="cg-badge">{unseen}</i>}</span>
        <span className="cg-txt"><b>{w.title || 'Dzwonek'}</b><small>{last ? when(last.at) : 'brak połączeń'}</small></span>
      </button>
      {big && <CallBig c={big} onClose={() => { setBig(null); seen(); }} />}
    </>);
  }
  return (
    <div className="calls" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cg-hd">
        <Icon name="mdi:doorbell" size={20} /><b>{w.title || (onlyMissed ? 'Nieodebrane' : 'Dzwonek – historia')}</b>
        {unseen > 0 && <span className="cg-count">{unseen}</span>}
        {unseen > 0 && <button className="cg-seen" onClick={seen}>Obejrzane</button>}
      </div>
      {!list.length && <div className="cg-empty">{data ? (onlyMissed ? 'Brak nieodebranych połączeń' : 'Brak połączeń') : 'Wczytuję…'}</div>}
      <div className="cg-list">{list.map((c) => (
        <button key={c.id} className={'cg-row st-' + c.status + (c.status === 'missed' && !c.seen ? ' new' : '')} onClick={() => setBig(c)}>
          {c.snapshot ? <img src={snap(c.id)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <span className="cg-noimg"><Icon name={STATUS[c.status][1]} size={22} /></span>}
          <span className="cg-txt"><b>{when(c.at)}</b><small>{c.name} · {STATUS[c.status][0]}{c.by ? ' – ' + c.by : ''}{c.ivr ? ' · poczekalnia' : ''}</small></span>
          <Icon name={STATUS[c.status][1]} size={18} />
        </button>
      ))}</div>
      {big && <CallBig c={big} onClose={() => { setBig(null); if (unseen) seen(); }} />}
    </div>
  );
};

const CallBig: FC<{ c: CallRecord; onClose(): void }> = ({ c, onClose }) => (
  <div className="popup-scrim" onClick={(e) => { e.stopPropagation(); onClose(); }} role="dialog" aria-modal="true" aria-label="Połączenie">
    <section className="popup cg-big" onClick={(e) => e.stopPropagation()}>
      <header className="d-head"><div><div className="d-sub">{c.name} · {STATUS[c.status][0]}{c.by ? ' – ' + c.by : ''}</div><h2>{when(c.at)}</h2></div>
        <button className="d-close" onClick={onClose} aria-label="Zamknij"><Icon name="close" /></button></header>
      {c.snapshot ? <img className="cg-img" src={snap(c.id)} alt={'Zdjęcie z ' + when(c.at)} /> : <div className="cg-empty">Brak zdjęcia z kamery</div>}
    </section>
  </div>
);
