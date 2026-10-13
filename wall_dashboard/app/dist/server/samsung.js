import dgram from 'node:dgram';
import http from 'node:http';
import WebSocket from 'ws';
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
const KNOWN_APPS = [
    { appId: '3201907018807', name: 'Netflix' }, { appId: '11101200001', name: 'Netflix' },
    { appId: '111299001912', name: 'YouTube' }, { appId: '3201910019365', name: 'Prime Video' }, { appId: '3201512006785', name: 'Prime Video' },
    { appId: '3201901017640', name: 'Disney+' }, { appId: '3202301029760', name: 'Max' }, { appId: '3201807016597', name: 'Apple TV' },
    { appId: '3201606009684', name: 'Spotify' }, { appId: '3201512006963', name: 'Plex' }, { appId: '3202203026841', name: 'Twitch' },
    { appId: '3201908019041', name: 'Apple Music' }, { appId: '3201608010191', name: 'Deezer' },
    { appId: '3202009021709', name: 'Disney+' }, { appId: '3202204027038', name: 'Disney+' },
    { appId: 'org.tizen.browser', name: 'Internet' }
];
export class SamsungTv {
    def;
    onToken;
    ws;
    connecting;
    idle;
    appsWaiters = [];
    constructor(def, onToken) {
        this.def = def;
        this.onToken = onToken;
    }
    update(def) {
        const changed = def.host !== this.def.host || def.token !== this.def.token;
        this.def = def;
        if (changed)
            this.close();
    }
    close() { clearTimeout(this.idle); this.ws?.removeAllListeners(); this.ws?.close(); this.ws = undefined; this.connecting = undefined; }
    /** Opens (or reuses) the remote-control socket. pairTimeout: how long to wait for "Allow" on the TV. */
    connect(pairTimeout = 8000) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.touch();
            return Promise.resolve(this.ws);
        }
        if (this.connecting)
            return this.connecting;
        const tryOne = (secure) => new Promise((resolve, reject) => {
            const tok = secure && this.def.token ? '&token=' + encodeURIComponent(this.def.token) : '';
            const url = `${secure ? 'wss' : 'ws'}://${this.def.host}:${secure ? 8002 : 8001}/api/v2/channels/samsung.remote.control?name=${encodeURIComponent(APP_NAME)}${tok}`;
            const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 4000 });
            const timer = setTimeout(() => { ws.terminate(); reject(new Error(this.def.token ? 'Telewizor nie odpowiada' : 'Brak akceptacji na telewizorze (Zezwól)')); }, pairTimeout);
            ws.on('message', (raw) => {
                let m;
                try {
                    m = JSON.parse(raw.toString());
                }
                catch {
                    return;
                }
                if (m.event === 'ms.channel.connect') {
                    clearTimeout(timer);
                    const token = m.data?.token;
                    if (secure && token && token !== this.def.token) {
                        this.def.token = String(token);
                        this.onToken(this.def.token);
                        log.info(`TV ${this.def.name}: sparowano`);
                    }
                    resolve(ws);
                }
                else if (m.event === 'ms.channel.unauthorized') {
                    clearTimeout(timer);
                    ws.terminate();
                    reject(new Error('Telewizor odrzucił połączenie. Na TV: Menedżer połączeń urządzeń → Lista urządzeń – usuń lub zezwól „Wall Dashboard”; Powiadomienie o dostępie – „Tylko za pierwszym razem”; (2020+) Sieć → Ustawienia eksperta → Zdalne IP – Wł. Potem Paruj i w ciągu 30 s wybierz Zezwól.'));
                }
                else if (m.event === 'ed.installedApp.get') {
                    const apps = (m.data?.data ?? []).map((a) => ({ appId: String(a.appId), name: String(a.name), type: a.app_type }));
                    this.appsWaiters.splice(0).forEach((w) => w(apps));
                }
            });
            ws.on('error', (e) => { clearTimeout(timer); reject(e); });
            ws.on('close', () => { if (this.ws === ws)
                this.ws = undefined; });
        });
        this.connecting = tryOne(true)
            .catch((e) => {
            // older models (2016–2017) only speak ws://8001 without a token
            if (/odrzucił|akceptacji/.test(e.message))
                throw e;
            return tryOne(false);
        })
            .then((ws) => { this.ws = ws; this.touch(); return ws; })
            .finally(() => { this.connecting = undefined; });
        return this.connecting;
    }
    touch() { clearTimeout(this.idle); this.idle = setTimeout(() => this.close(), IDLE_MS); }
    async emit(msg) {
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
    key(key, hold) {
        if (!/^KEY_[A-Z0-9_]+$/.test(key))
            throw new Error('Niepoprawny klawisz: ' + key);
        const p = (Cmd) => ({ method: 'ms.remote.control', params: { Cmd, DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } });
        if (!hold)
            return this.emit(p('Click'));
        return this.emit(p('Press')).then(() => new Promise((r) => setTimeout(r, 1200))).then(() => this.emit(p('Release')));
    }
    /**
     * Starts an app. Models differ: older ones accept REST POST /api/v2/applications/<id>, newer ones only the
     * WebSocket "ed.apps.launch" – with DEEP_LINK (most apps, the default of Samsung's own tools) or NATIVE_LAUNCH.
     * Each way is tried in turn until the TV reports the app as running.
     */
    async launch(appId, type) {
        const ws = (action) => () => this.emit({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { appId, action_type: action, metaTag: '' } } }).then(() => true);
        // app_type from the TV's own list: 2 = deep link, 4 = native; unknown (manual / discovered) → deep link first
        const order = type === 4 ? [ws('NATIVE_LAUNCH'), ws('DEEP_LINK')] : [ws('DEEP_LINK'), ws('NATIVE_LAUNCH')];
        const tries = [() => this.restLaunch(appId), ...order];
        let canCheck = true;
        for (const t of tries) {
            const sent = await t().catch(() => false);
            if (!sent)
                continue;
            if (!canCheck)
                return;
            const st = await this.appRunning(appId, 3500);
            if (st === true)
                return;
            if (st === null)
                canCheck = false; // the TV does not report app state – keep the first way that was accepted
            if (!canCheck)
                return;
        }
        log.warn(`Telewizor ${this.def.name}: aplikacja ${appId} nie wystartowała żadnym ze sposobów`);
        throw new Error('Telewizor nie uruchomił aplikacji – sprawdź ID aplikacji (Telewizory → Dodaj skrót ręcznie)');
    }
    /** REST launch (older Tizen); true = accepted */
    restLaunch(appId) {
        return new Promise((resolve) => {
            const req = http.request({ host: this.def.host, port: 8001, method: 'POST', path: '/api/v2/applications/' + encodeURIComponent(appId), timeout: 2500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.on('error', () => resolve(false));
            req.end();
        });
    }
    /** polls GET /api/v2/applications/<id> until "running"; null = this TV does not answer that query */
    async appRunning(appId, within) {
        const end = Date.now() + within;
        let answered = false;
        while (Date.now() < end) {
            await new Promise((r) => setTimeout(r, 700));
            const st = await new Promise((resolve) => {
                const req = http.get({ host: this.def.host, port: 8001, path: '/api/v2/applications/' + encodeURIComponent(appId), timeout: 1500 }, (res) => {
                    let body = '';
                    res.on('data', (c) => (body += c));
                    res.on('end', () => { if (res.statusCode !== 200)
                        return resolve(null); try {
                        resolve(JSON.parse(body));
                    }
                    catch {
                        resolve(null);
                    } });
                });
                req.on('timeout', () => { req.destroy(); resolve(null); });
                req.on('error', () => resolve(null));
            });
            if (st) {
                answered = true;
                if (st.running || st.visible)
                    return true;
            }
        }
        return answered ? false : null;
    }
    async installedApps() {
        const p = new Promise((resolve, reject) => {
            this.appsWaiters.push(resolve);
            setTimeout(() => reject(new Error('Telewizor nie zwrócił listy aplikacji')), 6000);
        });
        try {
            await this.emit({ method: 'ms.channel.emit', params: { event: 'ed.installedApp.get', to: 'host' } });
            return (await p).sort((a, b) => a.name.localeCompare(b.name));
        }
        catch {
            // newer Samsung models (≈2022+) no longer answer ed.installedApp.get: ask the REST API about well-known apps instead
            const found = (await Promise.all(KNOWN_APPS.map((a) => this.probeApp(a.appId).then((name) => (name === null ? null : { ...a, name: name || a.name })))))
                .filter((a) => !!a);
            const seen = new Set();
            const list = found.filter((a) => !seen.has(a.name) && seen.add(a.name));
            if (list.length)
                return list.sort((a, b) => a.name.localeCompare(b.name));
            throw new Error('Ten telewizor nie podaje listy aplikacji (nowsze modele Samsunga). Dodaj skrót ręcznie po ID aplikacji.');
        }
    }
    /** GET /api/v2/applications/<id>: 200 = installed (returns its name), anything else = not there */
    probeApp(appId) {
        return new Promise((resolve) => {
            const req = http.get({ host: this.def.host, port: 8001, path: '/api/v2/applications/' + encodeURIComponent(appId), timeout: 2500 }, (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => {
                    if (res.statusCode !== 200)
                        return resolve(null);
                    try {
                        resolve(String(JSON.parse(body).name ?? ''));
                    }
                    catch {
                        resolve('');
                    }
                });
            });
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.on('error', () => resolve(null));
        });
    }
    /** PowerState from the REST info endpoint; unreachable = off. */
    status() {
        return new Promise((resolve) => {
            const req = http.get({ host: this.def.host, port: 8001, path: '/api/v2/', timeout: 2500 }, (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => {
                    try {
                        const d = JSON.parse(body).device ?? {};
                        const ps = String(d.PowerState ?? 'on').toLowerCase();
                        resolve({ power: ps === 'on' ? 'on' : 'standby', name: d.name, model: d.modelName });
                    }
                    catch {
                        resolve({ power: 'on' });
                    }
                });
            });
            req.on('timeout', () => { req.destroy(); resolve({ power: 'off' }); });
            req.on('error', () => resolve({ power: 'off' }));
        });
    }
    /** Power toggle: on/standby → KEY_POWER, off → Wake-on-LAN (then KEY_POWER once reachable in standby). */
    async power() {
        const st = await this.status();
        if (st.power === 'on')
            return this.key('KEY_POWER');
        if (st.power === 'standby')
            return this.key('KEY_POWER');
        if (!this.def.mac)
            throw new Error('Telewizor jest wyłączony, a nie ustawiono adresu MAC do Wake-on-LAN');
        await wakeOnLan(this.def.mac, this.def.broadcast || broadcastOf(this.def.host), this.def.host);
    }
}
export function broadcastOf(host) {
    const p = host.split('.');
    return p.length === 4 && p.every((x) => /^\d+$/.test(x)) ? `${p[0]}.${p[1]}.${p[2]}.255` : '255.255.255.255';
}
/** Magic packet ×3 to the broadcast address and the TV's own address, ports 9 and 7. */
export function wakeOnLan(mac, broadcast, host) {
    const hex = mac.replace(/[^0-9a-f]/gi, '');
    if (hex.length !== 12)
        return Promise.reject(new Error('Niepoprawny adres MAC: ' + mac));
    const m = Buffer.from(hex, 'hex');
    const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(m)]);
    return new Promise((resolve, reject) => {
        const sock = dgram.createSocket('udp4');
        sock.once('error', (e) => { sock.close(); reject(e); });
        sock.bind(() => {
            sock.setBroadcast(true);
            const targets = [broadcast, ...(host ? [host] : [])];
            let pending = 0;
            for (let i = 0; i < 3; i++)
                for (const t of targets)
                    for (const port of [9, 7]) {
                        pending++;
                        sock.send(pkt, port, t, () => { if (--pending === 0) {
                            sock.close();
                            resolve();
                        } });
                    }
        });
    });
}
/** One SamsungTv per configured TV, kept in sync with the store. */
export class TvRegistry {
    save;
    tvs = new Map();
    constructor(save) {
        this.save = save;
    }
    sync(defs) {
        const ids = new Set(defs.map((d) => d.id));
        for (const [id, tv] of this.tvs)
            if (!ids.has(id)) {
                tv.close();
                this.tvs.delete(id);
            }
        for (const d of defs) {
            const tv = this.tvs.get(d.id);
            if (tv)
                tv.update({ ...d });
            else
                this.tvs.set(d.id, new SamsungTv({ ...d }, (t) => this.save(d.id, t)));
        }
    }
    get(id) {
        const tv = this.tvs.get(id);
        if (!tv)
            throw new Error('Nie ma takiego telewizora');
        return tv;
    }
}
