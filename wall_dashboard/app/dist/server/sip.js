import { WebSocketServer, WebSocket } from 'ws';
import { log } from './log.js';
const HDR = { i: 'call-id', f: 'from', t: 'to' };
export function parseSip(text) {
    const end = text.indexOf('\r\n\r\n');
    const lines = (end >= 0 ? text.slice(0, end) : text).split(/\r?\n/);
    const first = lines.shift() ?? '';
    const h = new Map();
    for (const l of lines) {
        const m = /^([\w-]+)\s*:\s*(.*)$/.exec(l);
        if (m) {
            const k = m[1].toLowerCase();
            h.set(HDR[k] ?? k, m[2]);
        }
    }
    const callId = h.get('call-id');
    if (!callId)
        return null;
    const user = (v) => /sips?:([^@;>\s]+)@/.exec(v ?? '')?.[1] ?? '';
    const name = (v) => /^\s*"([^"]*)"/.exec(v ?? '')?.[1] ?? /^\s*([^<"]+?)\s*</.exec(v ?? '')?.[1] ?? '';
    const resp = /^SIP\/2\.0\s+(\d{3})/.exec(first);
    const req = /^([A-Z]+)\s+(\S+)\s+SIP\/2\.0/.exec(first);
    if (!resp && !req)
        return null;
    return {
        method: req?.[1], status: resp ? Number(resp[1]) : undefined,
        cseq: (h.get('cseq') ?? '').trim().split(/\s+/)[1]?.toUpperCase(),
        callId, fromUser: decodeURIComponent(user(h.get('from'))), fromName: name(h.get('from')),
        toUser: decodeURIComponent(user(h.get('to'))), ruriUser: req ? decodeURIComponent(/sips?:([^@;>\s]+)@?/.exec(req[2])?.[1] ?? '') : ''
    };
}
/** a final response to a request (copies Via / From / To / Call-ID / CSeq) */
export function sipReply(text, code, reason) {
    const head = text.split('\r\n\r\n')[0].split(/\r?\n/).slice(1);
    const pick = (names) => head.filter((l) => names.includes(l.split(':')[0].trim().toLowerCase()));
    const to = pick(['to', 't']).map((l) => (/;\s*tag=/i.test(l) ? l : l + ';tag=' + Math.random().toString(36).slice(2, 10)));
    return [`SIP/2.0 ${code} ${reason}`, ...pick(['via', 'v']), ...pick(['from', 'f']), ...to, ...pick(['call-id', 'i']), ...pick(['cseq']), 'Content-Length: 0', '', ''].join('\r\n');
}
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, handleProtocols: (p) => (p.has('sip') ? 'sip' : false) });
/** open SIP sessions (one per panel page) */
export const sipLinks = new Set();
export function sipProxy(req, socket, head, cfg, link) {
    wss.handleUpgrade(req, socket, head, (client) => {
        const up = new WebSocket(cfg.ws, 'sip', { rejectUnauthorized: !!cfg.tlsVerify, handshakeTimeout: 8000 });
        const pending = [];
        sipLinks.add(link);
        const read = (raw, dir) => {
            const text = raw.toString();
            try {
                const m = parseSip(text);
                if (m)
                    dir === 'up' ? link.onUp?.(m) : link.onDown?.(m);
            }
            catch (e) {
                log.debug('SIP: ' + e.message);
            }
            return text;
        };
        up.on('open', () => { for (const p of pending.splice(0))
            up.send(p); });
        const refused = new Set(); // calls answered "busy" by the add-on
        up.on('message', (data) => {
            const text = data.toString();
            const m = (() => { try {
                return parseSip(text);
            }
            catch {
                return null;
            } })();
            if (m && refused.has(m.callId))
                return; // ACK / CANCEL of a call the panel never saw
            if (m?.method === 'INVITE' && link.busy?.(m)) {
                refused.add(m.callId);
                if (refused.size > 200)
                    refused.delete(refused.values().next().value);
                if (up.readyState === WebSocket.OPEN)
                    up.send(sipReply(text, 486, 'Busy Here'));
                return;
            }
            const t = read(data, 'down');
            if (client.readyState === WebSocket.OPEN)
                client.send(t);
        });
        client.on('message', (data) => { const t = read(data, 'up'); if (up.readyState === WebSocket.OPEN)
            up.send(t);
        else
            pending.push(t); });
        let closed = false;
        const close = () => {
            if (closed)
                return;
            closed = true;
            sipLinks.delete(link);
            link.onClose?.();
            try {
                client.close();
            }
            catch { /* */ }
            try {
                up.close();
            }
            catch { /* */ }
        };
        up.on('close', close);
        client.on('close', close);
        client.on('error', close);
        up.on('error', (e) => { log.warn(`SIP: brak połączenia z centralą ${cfg.ws}: ${e.message}`); close(); });
    });
}
