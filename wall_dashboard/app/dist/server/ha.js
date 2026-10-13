import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { log } from './log.js';
export const POPUP_EVENT = 'wall_dashboard_popup';
/** HA → panels: { tablet: name | id | 'all', command: reload | restart | screen-on | screen-off | saver | brightness, value?: 0–100 } */
export const COMMAND_EVENT = 'wall_dashboard_command';
/**
 * Minimal Home Assistant websocket client.
 * Inside the add-on it talks to Core through the Supervisor proxy with SUPERVISOR_TOKEN;
 * for local development set HA_URL + HA_TOKEN (long-lived access token).
 * Events: 'status'(connected:boolean), 'snapshot'(), 'state'(entity_id, state|null)
 */
export class HaClient extends EventEmitter {
    wsUrl;
    restUrl;
    token;
    states = new Map();
    connected = false;
    ws;
    seq = 1;
    pending = new Map();
    subs = new Map();
    retryMs = 1000;
    stopped = false;
    constructor(wsUrl, restUrl, token) {
        super();
        this.wsUrl = wsUrl;
        this.restUrl = restUrl;
        this.token = token;
    }
    static fromEnv() {
        const sup = process.env.SUPERVISOR_TOKEN;
        if (sup)
            return new HaClient('ws://supervisor/core/websocket', 'http://supervisor/core/api', sup);
        const url = process.env.HA_URL, tok = process.env.HA_TOKEN;
        if (url && tok) {
            const base = url.replace(/\/+$/, '');
            return new HaClient(base.replace(/^http/, 'ws') + '/api/websocket', base + '/api', tok);
        }
        return null;
    }
    connect() {
        if (this.stopped)
            return;
        log.debug('Łączenie z HA', this.wsUrl);
        const ws = new WebSocket(this.wsUrl);
        this.ws = ws;
        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            this.onMessage(msg).catch((e) => log.error('Błąd obsługi wiadomości HA', e));
        });
        ws.on('close', () => {
            if (this.connected)
                log.warn('Rozłączono z Home Assistant');
            this.connected = false;
            this.emit('status', false);
            for (const [, p] of this.pending) {
                clearTimeout(p.timer);
                p.reject(new Error('Rozłączono z Home Assistant'));
            }
            this.pending.clear();
            for (const [, h] of this.subs)
                h({ type: 'error', message: 'Rozłączono z Home Assistant' });
            this.subs.clear();
            if (!this.stopped)
                setTimeout(() => this.connect(), this.retryMs);
            this.retryMs = Math.min(this.retryMs * 2, 30_000);
        });
        ws.on('error', (e) => log.debug('HA websocket error:', e.message));
    }
    stop() { this.stopped = true; this.ws?.close(); }
    async onMessage(m) {
        switch (m.type) {
            case 'auth_required':
                this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
                return;
            case 'auth_invalid':
                log.error('Home Assistant odrzucił token:', m.message);
                return;
            case 'auth_ok': {
                this.retryMs = 1000;
                await this.cmd({ type: 'subscribe_events', event_type: 'state_changed' });
                await this.subscribe({ type: 'subscribe_events', event_type: POPUP_EVENT }, (ev) => { if (ev?.event_type === POPUP_EVENT)
                    this.emit('popup', ev.data ?? {}); });
                await this.subscribe({ type: 'subscribe_events', event_type: COMMAND_EVENT }, (ev) => { if (ev?.event_type === COMMAND_EVENT)
                    this.emit('command', ev.data ?? {}); });
                const states = await this.cmd({ type: 'get_states' });
                this.states.clear();
                for (const s of states)
                    this.states.set(s.entity_id, s);
                this.connected = true;
                log.info(`Połączono z Home Assistant (${states.length} encji)`);
                this.emit('status', true);
                this.emit('snapshot');
                return;
            }
            case 'result': {
                const p = this.pending.get(m.id);
                if (!p)
                    return;
                this.pending.delete(m.id);
                clearTimeout(p.timer);
                if (m.success)
                    p.resolve(m.result);
                else
                    p.reject(new Error(m.error?.message || 'Błąd Home Assistant'));
                return;
            }
            case 'event': {
                const sub = this.subs.get(m.id);
                if (sub) {
                    sub(m.event);
                    return;
                }
                const ev = m.event;
                if (ev?.event_type !== 'state_changed')
                    return;
                const { entity_id, new_state } = ev.data;
                if (new_state)
                    this.states.set(entity_id, new_state);
                else
                    this.states.delete(entity_id);
                this.emit('state', entity_id, new_state ?? null);
                return;
            }
        }
    }
    cmd(msg) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
                return reject(new Error('Brak połączenia z Home Assistant'));
            const id = this.seq++;
            const timer = setTimeout(() => { if (this.pending.delete(id))
                reject(new Error('Home Assistant nie odpowiedział')); }, 15_000);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ ...msg, id }));
        });
    }
    /** Subscription command: resolves with the id once HA confirms; events go to onEvent. */
    async subscribe(msg, onEvent) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
            throw new Error('Brak połączenia z Home Assistant');
        const id = this.seq++;
        this.subs.set(id, onEvent);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { if (this.pending.delete(id)) {
                this.subs.delete(id);
                reject(new Error('Home Assistant nie odpowiedział'));
            } }, 15_000);
            this.pending.set(id, { resolve, reject: (e) => { this.subs.delete(id); reject(e); }, timer });
            this.ws.send(JSON.stringify({ ...msg, id }));
        });
        return id;
    }
    async unsubscribe(id) {
        if (!this.subs.delete(id))
            return;
        try {
            await this.cmd({ type: 'unsubscribe_events', subscription: id });
        }
        catch { /* already gone */ }
    }
    callService(domain, service, data, target) {
        return this.cmd({ type: 'call_service', domain, service, service_data: data ?? {}, ...(target ? { target } : {}) });
    }
    async registries() {
        const [areas, devices, entities] = await Promise.all([
            this.cmd({ type: 'config/area_registry/list' }),
            this.cmd({ type: 'config/device_registry/list' }),
            this.cmd({ type: 'config/entity_registry/list' })
        ]);
        return { areas, devices, entities };
    }
    rest(path, init = {}) {
        return fetch(this.restUrl + path, {
            ...init,
            headers: { Authorization: 'Bearer ' + this.token, ...init.headers }
        });
    }
}
