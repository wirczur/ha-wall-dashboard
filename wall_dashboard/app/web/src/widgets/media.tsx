// Media player widget: artwork, title/artist, progress, transport, volume, source, shuffle/repeat and multiroom grouping.
import { useEffect, useRef, useState, type CSSProperties, type FC } from 'react';
import type { HassState, WidgetDef } from '../../../shared/types';
import { keyQuery } from '../lib/boot';
import { hass, useEntities, useEntity } from '../lib/hass';
import { Icon } from '../ui/Icon';

// media_player supported_features bits
const F = { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREV: 16, NEXT: 32, TURN_ON: 128, TURN_OFF: 256, VOLUME_STEP: 1024,
  SOURCE: 2048, STOP: 4096, PLAY: 16384, SHUFFLE: 32768, SOUND_MODE: 65536, REPEAT: 262144, GROUPING: 524288 };

export type MediaLayout = 'auto' | 'bar' | 'small' | 'large';

const STATE_PL: Record<string, string> = { playing: 'Odtwarza', paused: 'Pauza', idle: 'Bezczynny', on: 'Włączony', off: 'Wyłączony', standby: 'Czuwanie', buffering: 'Buforowanie', unavailable: 'Niedostępny' };

const fmt = (sec?: number) => {
  if (sec == null || !isFinite(sec) || sec < 0) return '';
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
};

/** Current position, advanced locally while playing. */
function usePosition(s?: HassState) {
  const [, tick] = useState(0);
  const playing = s?.state === 'playing';
  useEffect(() => { if (!playing) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [playing]);
  const a = s?.attributes ?? {};
  const pos = Number(a.media_position), dur = Number(a.media_duration);
  if (!isFinite(pos) || !isFinite(dur) || dur <= 0) return null;
  const upd = a.media_position_updated_at ? Date.parse(String(a.media_position_updated_at)) : NaN;
  const cur = playing && isFinite(upd) ? pos + (Date.now() - upd) / 1000 : pos;
  return { pos: Math.min(dur, Math.max(0, cur)), dur };
}

export const artUrl = (entity: string, pic: string) => 'api/media/' + encodeURIComponent(entity) + '/art' + keyQuery('v=' + encodeURIComponent(pic.slice(-24)));

export const MediaWidget: FC<{ w: WidgetDef }> = ({ w }) => {
  const id = w.entity ?? '';
  const s = useEntity(id);
  const o = w.options ?? {};
  const group: string[] = Array.isArray(o.group) ? o.group : [];
  const members = useEntities(group);
  const p = usePosition(s);
  const [err, setErr] = useState('');
  const [vol, setVol] = useState<number | null>(null);
  const volTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 3000); return () => clearTimeout(t); }, [err]);

  if (!s) return <div className="mp mp-empty"><Icon name="speaker" size={28} /><span>{id || 'Wybierz encję media_player'}</span></div>;

  const a = s.attributes;
  const sf = Number(a.supported_features ?? 0xfffffff);
  const has = (f: number) => (sf & f) !== 0;
  const off = ['off', 'standby', 'unavailable'].includes(s.state);
  const playing = s.state === 'playing';
  const name = String(o.name || a.friendly_name || id);
  const title = String(a.media_title ?? (off ? '' : a.source ?? ''));
  const artist = String(a.media_artist ?? a.media_series_title ?? a.app_name ?? '');
  const album = a.media_album_name ? String(a.media_album_name) : '';
  const pic = typeof a.entity_picture === 'string' && o.art !== false && !off ? a.entity_picture : '';
  const volume = vol ?? (typeof a.volume_level === 'number' ? a.volume_level : null);
  const muted = !!a.is_volume_muted;
  const sources: string[] = Array.isArray(a.source_list) ? a.source_list : [];
  const groupMembers: string[] = Array.isArray(a.group_members) ? a.group_members : [];

  const layout: MediaLayout = o.layout && o.layout !== 'auto' ? o.layout : w.h <= 2 ? 'bar' : w.w <= 5 || w.h <= 3 ? 'small' : 'large';

  const call = (service: string, data?: Record<string, unknown>, target = id) =>
    hass.call('media_player', service, data, target).catch((e: Error) => setErr(e.message));
  const setVolume = (v: number) => {
    setVol(v);
    clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => { call('volume_set', { volume_level: Math.round(v * 100) / 100 }); setTimeout(() => setVol(null), 1500); }, 250);
  };
  const toggleMember = (m: string) =>
    groupMembers.includes(m) ? call('unjoin', undefined, m) : call('join', { group_members: [m] });

  const btn = (icon: string, label: string, onClick: () => void, cls = '') => (
    <button className={'mp-b ' + cls} aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick(); }}><Icon name={icon} size={cls.includes('big') ? 30 : 20} /></button>
  );

  const transport = (
    <div className="mp-tr">
      {o.shuffle !== false && has(F.SHUFFLE) && layout === 'large' && btn('mdi:shuffle-variant', 'Losowo', () => call('shuffle_set', { shuffle: !a.shuffle }), a.shuffle ? 'on' : '')}
      {has(F.PREV) && btn('prev', 'Poprzedni', () => call('media_previous_track'))}
      {(has(F.PLAY) || has(F.PAUSE)) && btn(playing ? 'pause' : 'play', playing ? 'Pauza' : 'Odtwarzaj', () => call(off ? 'turn_on' : 'media_play_pause'), 'big')}
      {has(F.NEXT) && btn('next', 'Następny', () => call('media_next_track'))}
      {o.shuffle !== false && has(F.REPEAT) && layout === 'large' &&
        btn(a.repeat === 'one' ? 'mdi:repeat-once' : 'mdi:repeat', 'Powtarzanie', () => call('repeat_set', { repeat: a.repeat === 'off' ? 'all' : a.repeat === 'all' ? 'one' : 'off' }), a.repeat && a.repeat !== 'off' ? 'on' : '')}
    </div>
  );

  const volumeRow = o.volume !== false && (has(F.VOLUME_SET) || has(F.VOLUME_MUTE) || has(F.VOLUME_STEP)) && (
    <div className="mp-vol" onClick={(e) => e.stopPropagation()}>
      {has(F.VOLUME_MUTE) && btn(muted ? 'mute' : 'volume', muted ? 'Włącz dźwięk' : 'Wycisz', () => call('volume_mute', { is_volume_muted: !muted }), muted ? 'on' : '')}
      {has(F.VOLUME_SET) && volume != null
        ? <input type="range" min={0} max={1} step={0.01} value={volume} aria-label="Głośność" style={{ '--v': volume * 100 + '%' } as CSSProperties}
            onChange={(e) => setVolume(Number(e.target.value))} />
        : <>{btn('minus', 'Ciszej', () => call('volume_down'))}{btn('plus', 'Głośniej', () => call('volume_up'))}</>}
      {volume != null && <span className="mp-vn">{Math.round(volume * 100)}</span>}
    </div>
  );

  const power = (has(F.TURN_ON) || has(F.TURN_OFF)) && o.power !== false &&
    btn('power', off ? 'Włącz' : 'Wyłącz', () => call(off ? 'turn_on' : 'turn_off'), off ? '' : 'on');

  const progress = p && o.progress !== false && (
    <div className="mp-prog">
      <div className={'mp-pbar' + (has(F.SEEK) ? ' seek' : '')} role={has(F.SEEK) ? 'slider' : undefined} aria-label="Pozycja" aria-valuenow={Math.round(p.pos)}
        onClick={(e) => { e.stopPropagation(); if (!has(F.SEEK)) return; const r = e.currentTarget.getBoundingClientRect(); call('media_seek', { seek_position: Math.round(((e.clientX - r.left) / r.width) * p.dur) }); }}>
        <i style={{ width: (p.pos / p.dur) * 100 + '%' }} />
      </div>
      <span>{fmt(p.pos)}</span><span>{fmt(p.dur)}</span>
    </div>
  );

  const art = (cls: string) => pic
    ? <img className={cls} src={artUrl(id, pic)} alt="" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
    : <div className={cls + ' mp-noart'}><Icon name={off ? 'speaker' : 'mdi:music-note'} size={layout === 'bar' ? 22 : 40} /></div>;

  const info = (
    <div className="mp-info">
      <div className="mp-t">{off ? name : title || STATE_PL[s.state] || s.state}</div>
      <div className="mp-a">{off ? STATE_PL[s.state] ?? s.state : [artist, layout === 'large' ? album : ''].filter(Boolean).join(' · ') || name}</div>
    </div>
  );

  const extras = layout === 'large' && (
    <div className="mp-ex" onClick={(e) => e.stopPropagation()}>
      {o.source !== false && has(F.SOURCE) && sources.length > 0 && (
        <select className="mp-src" value={String(a.source ?? '')} aria-label="Źródło" onChange={(e) => call('select_source', { source: e.target.value })}>
          {!a.source && <option value="">Źródło…</option>}
          {sources.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      )}
      {group.length > 0 && (
        <div className="mp-grp" aria-label="Multiroom">
          <Icon name="speaker" size={16} />
          {group.map((m, i) => {
            const ms = members[i];
            const inG = groupMembers.includes(m);
            return <button key={m} className={'mp-chip' + (inG ? ' on' : '')} aria-pressed={inG} onClick={() => toggleMember(m)}>{String(ms?.attributes.friendly_name ?? m.split('.')[1])}</button>;
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className={'mp mp-' + layout + (off ? ' mp-off' : '')}>
      {pic && o.blur !== false && layout !== 'bar' && <div className="mp-bg" style={{ backgroundImage: `url("${artUrl(id, pic)}")` }} />}
      {layout === 'bar' && <>
        {art('mp-art')}{info}{transport}{power}
      </>}
      {layout === 'small' && <>
        <div className="mp-top">{art('mp-art')}{info}{power}</div>
        {progress}
        <div className="mp-row">{transport}</div>
        {w.h >= 4 && volumeRow}
      </>}
      {layout === 'large' && <>
        <div className="mp-l">{art('mp-art')}</div>
        <div className="mp-r">
          <div className="mp-head"><span className="mp-name"><Icon name="speaker" size={14} /> {name}{a.source && !off ? ' · ' + a.source : ''}</span>{power}</div>
          {info}
          {progress}
          {transport}
          {volumeRow}
          {extras}
        </div>
      </>}
      {err && <div className="mp-err" role="alert">{err}</div>}
    </div>
  );
};
