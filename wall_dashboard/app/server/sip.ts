// SIP over WebSocket proxy: panel (JsSIP) ⇄ add-on ⇄ PBX (VitalPBX / Asterisk).
// The add-on only relays signalling (and reads it to know who is ringing / who answered);
// the voice goes directly panel ⇄ PBX (WebRTC, DTLS-SRTP).
import type http from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { SipSettings } from '../shared/types.js';
import { log } from './log.js';

export interface SipMsg {
  /** request method (INVITE, CANCEL, BYE…) or undefined for a response */
  method?: string;
  /** response status code */
  status?: number;
  /** method in CSeq (what a response answers) */
  cseq?: string;
  callId: string;
  /** user part of From / To and of the request URI */
  fromUser: string;
  fromName: string;
  toUser: string;
  ruriUser: string;
}

const HDR: Record<string, string> = { i: 'call-id', f: 'from', t: 'to' };

export function parseSip(text: string): SipMsg | null {
  const end = text.indexOf('\r\n\r\n');
  const lines = (end >= 0 ? text.slice(0, end) : text).split(/\r?\n/);
  const first = lines.shift() ?? '';
  const h = new Map<string, string>();
  for (const l of lines) {
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(l);
    if (m) { const k = m[1].toLowerCase(); h.set(HDR[k] ?? k, m[2]); }
  }
  const callId = h.get('call-id');
  if (!callId) return null;
  const user = (v?: string) => /sips?:([^@;>\s]+)@/.exec(v ?? '')?.[1] ?? '';
  const name = (v?: string) => /^\s*"([^"]*)"/.exec(v ?? '')?.[1] ?? /^\s*([^<"]+?)\s*</.exec(v ?? '')?.[1] ?? '';
  const resp = /^SIP\/2\.0\s+(\d{3})/.exec(first);
  const req = /^([A-Z]+)\s+(\S+)\s+SIP\/2\.0/.exec(first);
  if (!resp && !req) return null;
  return {
    method: req?.[1], status: resp ? Number(resp[1]) : undefined,
    cseq: (h.get('cseq') ?? '').trim().split(/\s+/)[1]?.toUpperCase(),
    callId, fromUser: decodeURIComponent(user(h.get('from'))), fromName: name(h.get('from')),
    toUser: decodeURIComponent(user(h.get('to'))), ruriUser: req ? decodeURIComponent(/sips?:([^@;>\s]+)@?/.exec(req[2])?.[1] ?? '') : ''
  };
}

export interface SipLink {
  tabletId: string;
  /** messages PBX → panel */
  onDown?(m: SipMsg): void;
  /** messages panel → PBX */
  onUp?(m: SipMsg): void;
  onClose?(): void;
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, handleProtocols: (p) => (p.has('sip') ? 'sip' : false) });
/** open SIP sessions (one per panel page) */
export const sipLinks = new Set<SipLink>();

export function sipProxy(req: http.IncomingMessage, socket: any, head: Buffer, cfg: SipSettings, link: SipLink) {
  wss.handleUpgrade(req, socket, head, (client) => {
    const up = new WebSocket(cfg.ws, 'sip', { rejectUnauthorized: !!cfg.tlsVerify, handshakeTimeout: 8000 });
    const pending: string[] = [];
    sipLinks.add(link);
    const read = (raw: RawData, dir: 'up' | 'down') => {
      const text = raw.toString();
      try {
        const m = parseSip(text);
        if (m) dir === 'up' ? link.onUp?.(m) : link.onDown?.(m);
      } catch (e: any) { log.debug('SIP: ' + e.message); }
      return text;
    };
    up.on('open', () => { for (const p of pending.splice(0)) up.send(p); });
    up.on('message', (data) => { const t = read(data, 'down'); if (client.readyState === WebSocket.OPEN) client.send(t); });
    client.on('message', (data) => { const t = read(data, 'up'); if (up.readyState === WebSocket.OPEN) up.send(t); else pending.push(t); });
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      sipLinks.delete(link); link.onClose?.();
      try { client.close(); } catch { /* */ } try { up.close(); } catch { /* */ }
    };
    up.on('close', close); client.on('close', close); client.on('error', close);
    up.on('error', (e) => { log.warn(`SIP: brak połączenia z centralą ${cfg.ws}: ${e.message}`); close(); });
  });
}
