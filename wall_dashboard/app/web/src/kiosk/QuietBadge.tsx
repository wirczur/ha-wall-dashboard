// Small "quiet" indicator in the corner of a panel; tap = switch quiet off (or back on).
import { useState, type FC } from 'react';
import { hass, useQuiet } from '../lib/hass';
import { Icon } from '../ui/Icon';

const hhmm = (t: number) => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

export const QuietBadge: FC = () => {
  const q = useQuiet();
  const [open, setOpen] = useState(false);
  if (!q.on) return null;
  const why = q.reason === 'hours' ? 'harmonogram' : q.reason === 'entity' ? 'Home Assistant' : 'ręcznie';
  return (
    <div className="qb">
      {open && (
        <div className="qb-menu" role="dialog" aria-label="Cisza">
          <b>Cisza{q.until ? ' do ' + hhmm(q.until) : ''}</b>
          <small>{why} – dźwięki, dzwonki i mowa wyłączone</small>
          <button onClick={() => { hass.send({ type: 'quiet', mode: 'off' }); setOpen(false); }}>Wyłącz ciszę{q.reason === 'hours' && q.until ? ' do ' + hhmm(q.until) : ''}</button>
          <button className="ghost" onClick={() => setOpen(false)}>Zostaw</button>
        </div>
      )}
      <button className="qb-pill" onClick={() => setOpen(!open)} aria-label="Cisza – dotknij, aby zmienić">
        <Icon name="mdi:bell-sleep-outline" size={18} />{q.until ? hhmm(q.until) : 'Cisza'}
      </button>
    </div>
  );
};
