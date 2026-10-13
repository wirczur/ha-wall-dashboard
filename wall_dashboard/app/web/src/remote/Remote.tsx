import { useCallback, useEffect, useRef, useState, type CSSProperties, type FC, type ReactNode } from 'react';
import type { TvApp, TvStatus } from '../../../shared/types';
import { ENTITY_RE } from '../../../shared/types';
import { api } from '../lib/api';
import { boot } from '../lib/boot';
import { hass, useEntities } from '../lib/hass';
import { Icon } from '../ui/Icon';

// ---------------------------------------------------------------- TV list (names + app shortcuts)
interface TvInfo { id: string; name: string; apps: TvApp[] }
const tvs = new Map<string, TvInfo>();
const subs = new Set<() => void>();
export function setTvs(list: TvInfo[]) { tvs.clear(); for (const t of list) tvs.set(t.id, t); subs.forEach((l) => l()); }
let adminLoad: Promise<void> | null = null;
/** Admin: direct TVs + app shortcuts of Home Assistant TVs (id "ha:<object id>"). */
export function loadAdminTvs() {
  return Promise.all([api.get<TvInfo[]>('tvs').catch(() => []), api.get<TvInfo[]>('ha-tvs').catch(() => [])])
    .then(([a, b]) => setTvs([...a, ...b])).catch(() => {});
}

/** Well-known Samsung Tizen app ids (may differ per model / region – the TV's own list is authoritative). */
export const SAMSUNG_APPS: TvApp[] = [
  { appId: '3201907018807', name: 'Netflix' }, { appId: '111299001912', name: 'YouTube' }, { appId: '3201910019365', name: 'Prime Video' },
  { appId: '3201901017640', name: 'Disney+' }, { appId: '3201606009684', name: 'Spotify' }, { appId: '3201807016597', name: 'Apple TV' },
  { appId: '3201601007230', name: 'Max' }, { appId: '3201512006963', name: 'Plex' }
].map((a) => ({ ...a, via: 'app' as const }));

const BRAND: [RegExp, string][] = [[/netflix/i, '#e50914'], [/youtube/i, '#ff3d3d'], [/prime|amazon/i, '#00a8e1'], [/disney/i, '#2f5cff'], [/spotify/i, '#1db954'],
  [/apple/i, '#a1a1a6'], [/\bmax\b|hbo/i, '#7b4dff'], [/plex/i, '#e5a00d'], [/twitch/i, '#9146ff'], [/canal|polsat|player|tvp|go/i, '#f5b301'], [/hdmi|^tv$|antena|live/i, '#8a93a6']];
export const appColor = (name: string) => BRAND.find(([r]) => r.test(name))?.[1] ?? 'var(--accent)';
export function useTv(id?: string) {
  const [, f] = useState(0);
  useEffect(() => { const l = () => f((n) => n + 1); subs.add(l); return () => { subs.delete(l); }; }, []);
  useEffect(() => {
    if (boot.mode === 'admin' && id && !tvs.has(id)) {
      adminLoad ??= loadAdminTvs().finally(() => { adminLoad = null; });
    }
  }, [id]);
  return id ? tvs.get(id) : undefined;
}

// ---------------------------------------------------------------- remote UI
/** tv: id of a TV paired directly with the add-on, or a Home Assistant entity (remote.* / media_player.*) */
export interface RemoteProps { tv: string; showApps?: boolean; compact?: boolean; touchpad?: boolean }

/** HA entities behind a remote: remote.x for keys, media_player.x (same name) for power, state and sources. */
export function haRemoteEntities(tv: string) {
  if (!ENTITY_RE.test(tv)) return null;
  const obj = tv.split('.')[1];
  const remote = tv.startsWith('remote.') ? tv : hass.states.has('remote.' + obj) ? 'remote.' + obj : undefined;
  const media = tv.startsWith('media_player.') ? tv : hass.states.has('media_player.' + obj) ? 'media_player.' + obj : undefined;
  return { remote, media };
}

/** Samsung remote: power, d-pad / touchpad, back/home/source, volume, channels, app shortcuts.
 *  Works directly over the LAN (paired TV) or through Home Assistant's Samsung integration (remote.send_command). */
export const Remote: FC<RemoteProps> = ({ tv, showApps = true, compact, touchpad: touchpadDefault }) => {
  const ha = haRemoteEntities(tv);
  const info = useTv(ha ? undefined : tv);
  const haCfg = useTv(ha ? 'ha:' + tv.split('.')[1] : undefined);
  const [allApps, setAllApps] = useState(false);
  const [rs, ms] = useEntities([ha?.remote ?? '', ha?.media ?? '']);
  const [status, setStatus] = useState<TvStatus | null>(null);
  const [err, setErr] = useState('');
  const [pad, setPad] = useState(!!touchpadDefault);

  const refresh = useCallback(() => { if (ha) return; hass.tv(tv, { action: 'status' }).then((s) => setStatus(s ?? null)).catch(() => {}); }, [tv, !!ha]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); const t = setInterval(refresh, 15_000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 4000); return () => clearTimeout(t); }, [err]);

  const run = (p: Promise<unknown>) => p.then(() => setErr('')).catch((e) => setErr(e.message));
  const HA_MEDIA_KEYS: Record<string, [string, Record<string, unknown>?]> = {
    KEY_VOLUP: ['volume_up'], KEY_VOLDOWN: ['volume_down'], KEY_MUTE: ['volume_mute', { is_volume_muted: !ms?.attributes.is_volume_muted }],
    KEY_PLAY_BACK: ['media_play_pause'], KEY_CHUP: ['media_next_track'], KEY_CHDOWN: ['media_previous_track']
  };
  const key = (k: string, hold?: boolean) => {
    navigator.vibrate?.(8);
    if (!ha) return run(hass.tv(tv, { action: 'key', key: k, hold }));
    if (ha.remote) return run(hass.call('remote', 'send_command', { command: k }, ha.remote));
    const m = HA_MEDIA_KEYS[k];
    if (m && ha.media) return run(hass.call('media_player', m[0], m[1], ha.media));
    setErr('Ten przycisk wymaga encji remote.* telewizora');
  };
  const haOn = ms ? !['off', 'standby', 'unavailable'].includes(ms.state) : rs ? rs.state === 'on' : false;
  const power = () => {
    navigator.vibrate?.(15);
    if (!ha) return run(hass.tv(tv, { action: 'power' }).then(() => setTimeout(refresh, 2500)));
    if (ha.media) return run(hass.call('media_player', haOn ? 'turn_off' : 'turn_on', undefined, ha.media));
    if (ha.remote) return run(hass.call('remote', haOn ? 'turn_off' : 'turn_on', undefined, ha.remote));
  };

  const haSources: TvApp[] = ((ms?.attributes.source_list as string[] | undefined) ?? []).map((x) => ({ appId: x, name: x, via: 'source' as const }));
  const haFav = haCfg?.apps?.length ? haCfg.apps : haSources.slice(0, 12);
  const view = ha
    ? (rs || ms ? { name: String((ms ?? rs)!.attributes.friendly_name ?? tv), apps: haFav, all: [...haFav, ...haSources.filter((s) => !haFav.some((f) => f.appId === s.appId || f.name === s.name))] } : null)
    : info ? { ...info, all: info.apps } : null;
  const current = ms ? String(ms.attributes.app_name ?? ms.attributes.source ?? '') : '';
  const currentId = ms ? String(ms.attributes.app_id ?? '') : '';
  if (!view) return <div className="w-center w-sub">{ha ? 'Brak encji ' + tv : 'Wybierz telewizor w ustawieniach'}</div>;
  const st: TvStatus | null = ha ? { power: ms?.state === 'standby' ? 'standby' : haOn ? 'on' : 'off' } : status;
  const on = st?.power === 'on';
  const launch = (a: TvApp) => {
    navigator.vibrate?.(10);
    if (!ha) return run(hass.tv(tv, { action: 'app', appId: a.appId, appType: a.type }));
    if (!ha.media) return setErr('Aplikacje wymagają encji media_player telewizora');
    return a.via === 'app'
      ? run(hass.call('media_player', 'play_media', { media_content_type: 'app', media_content_id: a.appId }, ha.media))
      : run(hass.call('media_player', 'select_source', { source: a.appId }, ha.media));
  };
  return (
    <div className={'rmt' + (compact ? ' compact' : '')} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="rmt-head">
        <div className="rmt-name"><span className={'rmt-dot ' + (st?.power ?? 'unknown')} />{view.name}
          <small>{st ? { on: 'włączony', standby: 'czuwanie', off: 'wyłączony' }[st.power] : '…'}</small></div>
        <button className={'rmt-power' + (on ? ' on' : '')} onClick={power} aria-label={on ? 'Wyłącz telewizor' : 'Włącz telewizor'}><Icon name="power" /></button>
      </div>

      {pad ? <Touchpad onKey={key} /> : (
        <div className="rmt-dpad" role="group" aria-label="Nawigacja">
          <RBtn cls="up" label="W górę" k="KEY_UP" onKey={key} repeat><Icon name="up" /></RBtn>
          <RBtn cls="left" label="W lewo" k="KEY_LEFT" onKey={key} repeat><Icon name="left" /></RBtn>
          <RBtn cls="ok" label="OK" k="KEY_ENTER" onKey={key}>OK</RBtn>
          <RBtn cls="right" label="W prawo" k="KEY_RIGHT" onKey={key} repeat><Icon name="right" /></RBtn>
          <RBtn cls="down" label="W dół" k="KEY_DOWN" onKey={key} repeat><Icon name="down" /></RBtn>
        </div>
      )}

      <div className="rmt-row">
        <RBtn label="Wstecz" k="KEY_RETURN" onKey={key}>Wstecz</RBtn>
        <RBtn label="Home" k="KEY_HOME" onKey={key}><Icon name="home" /></RBtn>
        <RBtn label="Źródło" k="KEY_SOURCE" onKey={key}>Źródło</RBtn>
        <button className="rmt-b" aria-pressed={pad} onClick={() => setPad(!pad)} aria-label="Gładzik">{pad ? 'Strzałki' : 'Gładzik'}</button>
      </div>

      <div className="rmt-rockers">
        <div className="rmt-rocker">
          <RBtn label="Głośniej" k="KEY_VOLUP" onKey={key} repeat><Icon name="plus" /></RBtn>
          <span>VOL</span>
          <RBtn label="Ciszej" k="KEY_VOLDOWN" onKey={key} repeat><Icon name="minus" /></RBtn>
        </div>
        <div className="rmt-mid">
          <RBtn label="Wycisz" k="KEY_MUTE" onKey={key}><Icon name="mute" /></RBtn>
          <RBtn label="Odtwórz / pauza" k="KEY_PLAY_BACK" onKey={key}><Icon name="play" /></RBtn>
          <RBtn label="Menu" k="KEY_MENU" onKey={key}><Icon name="settings" /></RBtn>
        </div>
        <div className="rmt-rocker">
          <RBtn label="Następny kanał" k="KEY_CHUP" onKey={key} repeat><Icon name="up" /></RBtn>
          <span>CH</span>
          <RBtn label="Poprzedni kanał" k="KEY_CHDOWN" onKey={key} repeat><Icon name="down" /></RBtn>
        </div>
      </div>

      {showApps && view.apps.length > 0 && (
        <div className={'rmt-apps' + (allApps ? ' all' : '')}>
          {(allApps ? view.all : view.apps).map((a) => {
            const active = on && (a.appId === currentId || (!!current && (a.name === current || a.appId === current)));
            return (
              <button key={a.appId + a.name} className={'rmt-app' + (active ? ' on' : '')} aria-pressed={active} style={{ '--app': appColor(a.name) } as CSSProperties} onClick={() => launch(a)}>
                <i aria-hidden="true" />{a.name}
              </button>
            );
          })}
          {view.all.length > view.apps.length && (
            <button className="rmt-app more" onClick={() => setAllApps(!allApps)}>{allApps ? 'Mniej' : `Wszystkie (${view.all.length})`}</button>
          )}
        </div>
      )}
      {err && <div className="rmt-err" role="status">{err}</div>}
    </div>
  );
};

/** Button: tap = click; `repeat` = auto-repeat while held (volume, arrows). */
const RBtn: FC<{ k: string; label: string; onKey(k: string): void; repeat?: boolean; cls?: string; children: ReactNode }> = ({ k, label, onKey, repeat, cls, children }) => {
  const t = useRef<number>();
  const stop = () => { clearTimeout(t.current); clearInterval(t.current); t.current = undefined; };
  useEffect(() => stop, []);
  return (
    <button className={'rmt-b ' + (cls ?? '')} aria-label={label}
      onPointerDown={() => {
        onKey(k);
        if (repeat) t.current = window.setTimeout(() => { t.current = window.setInterval(() => onKey(k), 180); }, 450);
      }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKey(k); } }}>
      {children}
    </button>
  );
};

/** Swipe = arrow keys (one key per ~40 px), tap = OK. */
const Touchpad: FC<{ onKey(k: string): void }> = ({ onKey }) => {
  const st = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <div className="rmt-pad" role="application" aria-label="Gładzik: przesuń, aby nawigować, dotknij, aby zatwierdzić"
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); st.current = { x: e.clientX, y: e.clientY, moved: false }; }}
      onPointerMove={(e) => {
        const s = st.current; if (!s) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y, step = 40;
        if (Math.abs(dx) >= step || Math.abs(dy) >= step) {
          if (Math.abs(dx) > Math.abs(dy)) onKey(dx > 0 ? 'KEY_RIGHT' : 'KEY_LEFT'); else onKey(dy > 0 ? 'KEY_DOWN' : 'KEY_UP');
          st.current = { x: e.clientX, y: e.clientY, moved: true };
        }
      }}
      onPointerUp={() => { if (st.current && !st.current.moved) onKey('KEY_ENTER'); st.current = null; }}
      onPointerCancel={() => { st.current = null; }}>
      <span>przesuń · dotknij = OK</span>
    </div>
  );
};
