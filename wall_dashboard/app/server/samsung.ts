import dgram from 'node:dgram';
import http from 'node:http';
import WebSocket from 'ws';
import type { TvApp, TvDef, TvStatus } from '../shared/types.js';
import { log } from './log.js';

/**
 * Samsung Tizen TV (2016+) controlled directly on the LAN:
 *  - remote keys / apps: WebSocket wss://TV:8002 (token from pairing) with fallback to ws://TV:8001
 *  - power state: GET http://TV:8001/api/v2/ (device.PowerState on newer models)
 *  - power on: Wake-on-LAN magic packet (needs "Power on with mobile / network" enabled on the TV)
 */
const APP_NAME = Buffer.from('Wall Dashboard').toString('base64');
const IDLE_MS = 5 * 60_000;

/** Tizen app ids of popular apps – checked one by one when the TV does not list its apps */
const KNOWN_APPS: TvApp[] = [
  { appId: '3201907018807', name: 'Netflix' }, { appId: '11101200001', name: 'Netflix' },
  { appId: '111299001912', name: 'YouTube' }, { appId: '3201910019365', name: 'Prime Video' }, { appId: '3201512006785', name: 'Prime Video' },
  { appId: '3201901017640', name: 'Disney+' }, { appId: '3202301029760', name: 'Max' }, { appId: '3201807016597', name: 'Apple TV' },
  { appId: '3201606009684', name: 'Spotify' }, { appId: '3201512006963', name: 'Plex' }, { appId: '3202203026841', name: 'Twitch' },
  { appId: '3201908019041', name: 'Apple Music' }, { appId: '3201608010191', name: 'Deezer' },
  { appId: '3202009021709', name: 'Disney+' }, { appId: '3202204027038', name: 'Disney+' },
  { appId: 'org.tizen.browser', name: 'Internet' }
];

export class SamsungTv {
  private ws?: WebSocket;
  private connecting?: Promise<WebSocket>;
  private idle?: NodeJS.Timeout;
  private appsWaiters: ((apps: TvApp[]) => void)[] = [];

  constructor(public def: TvDef, private onToken: (token: string) => void) {}

  update(def: TvDef) {
    const changed = def.host !== this.def.host || def.token !== this.def.token;
    this.def = def;
    if (changed) this.close();
  }

  close() { clearTimeout(this.idle); this.ws?.removeAllListeners(); this.ws?.close(); this.ws = undefined; this.connecting = undefined; }

  /** Opens (or reuses) the remote-control socket. pairTimeout: how long to wait for "Allow" on the TV. */
  private connect(pairTimeout = 8000): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { this.touch(); return Promise.resolve(this.ws); }
    if (this.connecting) return this.connecting;
    const tryOne = (secure: boolean) => new Promise<WebSocket>((resolve, reject) => {
      const tok = secure && this.def.token ? '&token=' + encodeURIComponent(this.def.token) : '';
      const url = `${secure ? 'wss' : 'ws'}://${this.def.host}:${secure ? 8002 : 8001}/api/v2/channels/samsung.remote.control?name=${encodeURIComponent(APP_NAME)}${tok}`;
      const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 4000 });
      const timer = setTimeout(() => { ws.terminate(); reject(new Error(this.def.token ? 'Telewizor nie odpowiada' : 'Brak akceptacji na telewizorze (Zezwól)')); }, pairTimeout);
      ws.on('message', (raw) => {
        let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.event === 'ms.channel.connect') {
          clearTimeout(timer);
          const token = m.data?.token;
          if (secure && token && token !== this.def.token) { this.def.token = String(token); this.onToken(this.def.token); log.info(`TV ${this.def.name}: sparowano`); }
          resolve(ws);
        } else if (m.event === 'ms.channel.unauthorized') {
          clearTimeout(timer); ws.terminate(); reject(new Error('Telewizor odrzucił połączenie. Na TV: Menedżer połączeń urządzeń → Lista urządzeń – usuń lub zezwól „Wall Dashboard”; Powiadomienie o dostępie – „Tylko za pierwszym razem”; (2020+) Sieć → Ustawienia eksperta → Zdalne IP – Wł. Potem Paruj i w ciągu 30 s wybierz Zezwól.'));
        } else if (m.event === 'ed.installedApp.get') {
          const apps: TvApp[] = (m.data?.data ?? []).map((a: any) => ({ appId: String(a.appId), name: String(a.name), type: a.app_type }));
          this.appsWaiters.splice(0).forEach((w) => w(apps));
        }
      });
      ws.on('error', (e) => { clearTimeout(timer); reject(e); });
      ws.on('close', () => { if (this.ws === ws) this.ws = undefined; });
    });
    this.connecting = tryOne(true)
      .catch((e) => {
        // older models (2016–2017) only speak ws://8001 without a token
        if (/odrzucił|akceptacji/.test(e.message)) throw e;
        return tryOne(false);
      })
      .then((ws) => { this.ws = ws; this.touch(); return ws; })
      .finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private touch() { clearTimeout(this.idle); this.idle = setTimeout(() => this.close(), IDLE_MS); }

  private async emit(msg: unknown) {
    const ws = await this.connect();
    ws.send(JSON.stringify(msg));
  }

  /** Pairing: opens wss with no token and waits for the user to press "Allow" on the TV. */
  async pair() {
    this.close();
    this.def.token = undefined;
    await this.connect(30_000);
    return this.def.token;
  }

  key(key: string, hold?: boolean) {
    if (!/^KEY_[A-Z0-9_]+$/.test(key)) throw new Error('Niepoprawny klawisz: ' + key);
    const p = (Cmd: string) => ({ method: 'ms.remote.control', params: { Cmd, DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } });
    if (!hold) return this.emit(p('Click'));
    return this.emit(p('Press')).then(() => new Promise((r) => setTimeout(r, 1200))).then(() => this.emit(p('Release')));
  }

  launch(appId: string, type?: number) {
    return this.emit({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { appId, action_type: type === 2 ? 'DEEP_LINK' : 'NATIVE_LAUNCH' } } });
  }

  async installedApps(): Promise<TvApp[]> {
    const p = new Promise<TvApp[]>((resolve, reject) => {
      this.appsWaiters.push(resolve);
      setTimeout(() => reject(new Error('Telewizor nie zwrócił listy aplikacji')), 6000);
    });
    try {
      await this.emit({ method: 'ms.channel.emit', params: { event: 'ed.installedApp.get', to: 'host' } });
      return (await p).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // newer Samsung models (≈2022+) no longer answer ed.installedApp.get: ask the REST API about well-known apps instead
      const found = (await Promise.all(KNOWN_APPS.map((a) => this.probeApp(a.appId).then((name) => (name === null ? null : { ...a, name: name || a.name })))))
        .filter((a): a is TvApp => !!a);
      const seen = new Set<string>();
      const list = found.filter((a) => !seen.has(a.name) && seen.add(a.name));
      if (list.length) return list.sort((a, b) => a.name.localeCompare(b.name));
      throw new Error('Ten telewizor nie podaje listy aplikacji (nowsze modele Samsunga). Dodaj skrót ręcznie po ID aplikacji.');
    }
  }

  /** GET /api/v2/applications/<id>: 200 = installed (returns its name), anything else = not there */
  private probeApp(appId: string): Promise<string | null> {
    return new Promise((resolve) => {
      const req = http.get({ host: this.def.host, port: 8001, path: '/api/v2/applications/' + encodeURIComponent(appId), timeout: 2500 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(String(JSON.parse(body).name ?? '')); } catch { resolve(''); }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    });
  }

  /** PowerState from the REST info endpoint; unreachable = off. */
  status(): Promise<TvStatus> {
    return new Promise((resolve) => {
      const req = http.get({ host: this.def.host, port: 8001, path: '/api/v2/', timeout: 2500 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const d = JSON.parse(body).device ?? {};
            const ps = String(d.PowerState ?? 'on').toLowerCase();
            resolve({ power: ps === 'on' ? 'on' : 'standby', name: d.name, model: d.modelName });
          } catch { resolve({ power: 'on' }); }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ power: 'off' }); });
      req.on('error', () => resolve({ power: 'off' }));
    });
  }

  /** Power toggle: on/standby → KEY_POWER, off → Wake-on-LAN (then KEY_POWER once reachable in standby). */
  async power() {
    const st = await this.status();
    if (st.power === 'on') return this.key('KEY_POWER');
    if (st.power === 'standby') return this.key('KEY_POWER');
    if (!this.def.mac) throw new Error('Telewizor jest wyłączony, a nie ustawiono adresu MAC do Wake-on-LAN');
    await wakeOnLan(this.def.mac, this.def.broadcast || broadcastOf(this.def.host), this.def.host);
  }
}

export function broadcastOf(host: string) {
  const p = host.split('.');
  return p.length === 4 && p.every((x) => /^\d+$/.test(x)) ? `${p[0]}.${p[1]}.${p[2]}.255` : '255.255.255.255';
}

/** Magic packet ×3 to the broadcast address and the TV's own address, ports 9 and 7. */
export function wakeOnLan(mac: string, broadcast: string, host?: string): Promise<void> {
  const hex = mac.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return Promise.reject(new Error('Niepoprawny adres MAC: ' + mac));
  const m = Buffer.from(hex, 'hex');
  const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(m)]);
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', (e) => { sock.close(); reject(e); });
    sock.bind(() => {
      sock.setBroadcast(true);
      const targets = [broadcast, ...(host ? [host] : [])];
      let pending = 0;
      for (let i = 0; i < 3; i++) for (const t of targets) for (const port of [9, 7]) {
        pending++;
        sock.send(pkt, port, t, () => { if (--pending === 0) { sock.close(); resolve(); } });
      }
    });
  });
}

/** One SamsungTv per configured TV, kept in sync with the store. */
export class TvRegistry {
  private tvs = new Map<string, SamsungTv>();
  constructor(private save: (id: string, token: string) => void) {}
  sync(defs: TvDef[]) {
    const ids = new Set(defs.map((d) => d.id));
    for (const [id, tv] of this.tvs) if (!ids.has(id)) { tv.close(); this.tvs.delete(id); }
    for (const d of defs) {
      const tv = this.tvs.get(d.id);
      if (tv) tv.update({ ...d }); else this.tvs.set(d.id, new SamsungTv({ ...d }, (t) => this.save(d.id, t)));
    }
  }
  get(id: string) {
    const tv = this.tvs.get(id);
    if (!tv) throw new Error('Nie ma takiego telewizora');
    return tv;
  }
}
