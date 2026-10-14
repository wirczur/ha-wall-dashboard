import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientCall, ClientMsg, DashboardDoc, DeviceCmd, PairRequest, ScreenDef, CallRecord, EntityInfo, IcEndReason, IvrDef, PopupDef, QuietDef, QuietState, Tablet, ServerMsg, TriggerDef, TvApp, TvDef, WakeOptions } from '../shared/types.js';
import { ENTITY_RE } from '../shared/types.js';
import { HaClient } from './ha.js';
import { log } from './log.js';
import { checkKioskCall, kioskScope, popupTriggersOf, streamName, streamsOf } from './permissions.js';
import { emptyDashboard } from './seed.js';
import { DATA_DIR, MEDIA_DIR, Store, newId, newKey } from './store.js';
import { validateDashboard } from './validate.js';
import { importHouse, validateHouse } from './houses.js';
import { TvRegistry } from './samsung.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(here, '../web');
const VERSION = '1.0.7';
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 8099);
const KIOSK_PORT = Number(process.env.KIOSK_PORT || 8100);
const IN_ADDON = !!process.env.SUPERVISOR_TOKEN;
const INGRESS_IP = '172.30.32.2';

const store = new Store();
const tvs = new TvRegistry((id, token) => {
  const t = store.data.tvs.find((x) => x.id === id);
  if (t) { t.token = token; store.write(); }
});
tvs.sync(store.data.tvs);
const ha = HaClient.fromEnv();
if (ha) ha.connect();
else log.warn('Brak połączenia z Home Assistant — ustaw HA_URL i HA_TOKEN (poza add-onem).');

// ---------------------------------------------------------------- html shell
let shellCache = '';
function page(boot: Record<string, unknown>, head = '') {
  if (!shellCache || !IN_ADDON) shellCache = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  const slash = `<script>if(!/\\/$/.test(location.pathname))location.replace(location.pathname+'/'+location.search+location.hash)</script>`;
  return shellCache.replace('<!--BOOT-->', `${head}${slash}<script>window.__BOOT__=${json}</script>`);
}
const escAttr = (s: string) => s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]!);

// ---------------------------------------------------------------- helpers
const asyncH = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function requireHa(): HaClient {
  if (!ha || !ha.connected) throw Object.assign(new Error('Brak połączenia z Home Assistant'), { status: 503 });
  return ha;
}

async function proxyCamera(entity: string, res: Response) {
  const r = await requireHa().rest('/camera_proxy/' + encodeURIComponent(entity));
  if (!r.ok) return res.status(r.status).send('Kamera niedostępna');
  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(await r.arrayBuffer()));
}

/** Album art of a media_player (entity_picture is served by HA and needs its token). */
async function proxyArt(entity: string, res: Response) {
  const h = requireHa();
  const pic = h.states.get(entity)?.attributes?.entity_picture;
  if (typeof pic !== 'string' || !pic) return res.status(404).send('Brak okładki');
  const r = pic.startsWith('/api/') ? await h.rest(pic.slice(4)) : /^https?:\/\//.test(pic) ? await fetch(pic) : null;
  if (!r || !r.ok) return res.status(r?.status || 404).send('Okładka niedostępna');
  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(await r.arrayBuffer()));
}

/** Events of HA calendar entities in [start, end); cached briefly so many tablets don't hammer HA. */
const calCache = new Map<string, { at: number; data: unknown }>();
async function calendarEvents(entities: string[], start: string, end: string) {
  const h = requireHa();
  const out: any[] = [];
  await Promise.all(entities.map(async (e) => {
    const key = e + '|' + start + '|' + end;
    const hit = calCache.get(key);
    let list: any[];
    if (hit && Date.now() - hit.at < 60_000) list = hit.data as any[];
    else {
      const r = await h.rest(`/calendars/${encodeURIComponent(e)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      if (!r.ok) throw Object.assign(new Error(`Kalendarz ${e} niedostępny (${r.status})`), { status: 502 });
      list = (await r.json()) as any[];
      calCache.set(key, { at: Date.now(), data: list });
      if (calCache.size > 200) calCache.delete(calCache.keys().next().value!);
    }
    for (const ev of list) {
      const allDay = !!ev.start?.date && !ev.start?.dateTime;
      out.push({ calendar: e, summary: String(ev.summary ?? ''), location: ev.location || undefined, description: ev.description || undefined,
        allDay, start: ev.start?.dateTime ?? ev.start?.date, end: ev.end?.dateTime ?? ev.end?.date });
    }
  }));
  return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
function calendarQuery(req: Request) {
  const entities = String(req.query.e || '').split(',').filter((x) => /^calendar\.[a-z0-9_]+$/.test(x)).slice(0, 12);
  const start = new Date(String(req.query.start || '')), end = new Date(String(req.query.end || ''));
  if (!entities.length || isNaN(+start) || isNaN(+end) || end <= start || +end - +start > 62 * 864e5) throw Object.assign(new Error('Niepoprawne zapytanie kalendarza'), { status: 400 });
  return { entities, start: start.toISOString(), end: end.toISOString() };
}

async function history(entity: string, hours: number) {
  const start = new Date(Date.now() - hours * 3600_000).toISOString();
  const r = await requireHa().rest(`/history/period/${start}?filter_entity_id=${encodeURIComponent(entity)}&minimal_response&no_attributes`);
  if (!r.ok) throw new Error('Historia niedostępna (' + r.status + ')');
  const data = (await r.json()) as any[][];
  return (data[0] || [])
    .map((p) => ({ t: Date.parse(p.last_changed || p.lu * 1000), v: parseFloat(p.state) }))
    .filter((p) => isFinite(p.v) && isFinite(p.t));
}

/** Long history (weeks) for slow sensors like a septic tank: hourly long-term statistics if the sensor has them
 *  (kept beyond the recorder's purge window), otherwise raw history averaged per hour. */
async function longHistory(entity: string, days: number) {
  const client = requireHa();
  const start = new Date(Date.now() - days * 864e5).toISOString();
  try {
    const r = await client.cmd<Record<string, any[]>>({ type: 'recorder/statistics_during_period', start_time: start, statistic_ids: [entity], period: 'hour', types: ['mean', 'min', 'max'] });
    const rows = r?.[entity] ?? [];
    if (rows.length > 24) {
      return rows.map((p) => ({ t: typeof p.start === 'number' ? p.start : Date.parse(p.start), v: Number(p.mean ?? p.max ?? p.min), min: p.min != null ? Number(p.min) : undefined }))
        .filter((p) => isFinite(p.t) && isFinite(p.v));
    }
  } catch (e: any) { log.debug('Statystyki niedostępne dla ' + entity, e.message); }
  const raw = await history(entity, days * 24);
  const buckets = new Map<number, number[]>();
  for (const p of raw) { const h = Math.floor(p.t / 3600_000) * 3600_000; (buckets.get(h) ?? buckets.set(h, []).get(h)!).push(p.v); }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, vs]) => ({ t, v: vs.reduce((s, x) => s + x, 0) / vs.length, min: Math.min(...vs) }));
}

async function entityList(): Promise<EntityInfo[]> {
  const client = requireHa();
  let areaOf = new Map<string, string>();
  try {
    const { areas, devices, entities } = await client.registries();
    const areaName = new Map(areas.map((a: any) => [a.area_id, a.name]));
    const devArea = new Map(devices.map((d: any) => [d.id, d.area_id]));
    areaOf = new Map(entities.map((e: any) => [e.entity_id, areaName.get(e.area_id || devArea.get(e.device_id)) || '']));
  } catch (e: any) { log.debug('Rejestry niedostępne', e.message); }
  return [...client.states.values()]
    .map((s) => ({
      entity_id: s.entity_id,
      name: s.attributes.friendly_name || s.entity_id,
      domain: s.entity_id.split('.')[0],
      area: areaOf.get(s.entity_id) || undefined,
      state: s.state,
      unit: s.attributes.unit_of_measurement
    }))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err.status || err.statusCode || 400;
  if (status >= 500) log.warn(`${req.method} ${req.originalUrl}: ${err.stack || err.message}`);
  else log.info(`${req.method} ${req.originalUrl} → ${status}: ${err.message}`);
  if (res.headersSent) return;
  res.status(status).json({ error: err.message || 'Błąd' });
}

// keep the add-on alive and leave a trace in the log instead of dying silently
process.on('uncaughtException', (e) => log.warn('Nieobsłużony wyjątek: ' + (e?.stack || e)));
process.on('unhandledRejection', (e: any) => log.warn('Nieobsłużone odrzucenie: ' + (e?.stack || e)));

// ---------------------------------------------------------------- admin (ingress)
const admin = express();
admin.disable('x-powered-by');
admin.use((req, res, next) => {
  if (!IN_ADDON || process.env.ALLOW_ANY_ADMIN === '1') return next();
  // sound files for go2rtc (intercom waiting room) – same files the kiosk port serves without a key
  if (req.method === 'GET' && /^\/(sounds\/[\w.-]+\.wav|media\/[\w.-]+\.(mp3|wav|ogg|m4a|aac)|ivr-audio\/[\w-]+\.wav)$/.test(req.path)) return next();
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  if (ip === INGRESS_IP || ip === '127.0.0.1') return next();
  res.status(403).send('Panel administracyjny jest dostępny tylko przez Home Assistant.');
});
admin.use((req, res, next) => {
  res.on('finish', () => { if (res.statusCode >= 500) log.warn(`${req.method} ${req.originalUrl} → ${res.statusCode}`); });
  next();
});
admin.use(express.json({ limit: '10mb' }));

// Large bodies in small pieces: some reverse proxies in front of HA (e.g. Nginx Proxy Manager / openresty)
// answer 500 when a request body does not fit their in-memory buffer. The editor uploads such bodies as
// ≤ 6 KB chunks (optionally gzip), then sends the real request with X-WD-Chunks: <id>:<count>:<gz|raw>.
const chunks = new Map<string, { parts: Buffer[]; at: number }>();
setInterval(() => { const old = Date.now() - 10 * 60_000; for (const [k, v] of chunks) if (v.at < old) chunks.delete(k); }, 60_000).unref();
admin.post('/api/chunk/:id/:i', express.raw({ type: '*/*', limit: '64kb' }), (req, res) => {
  const id = String(req.params.id), i = Number(req.params.i);
  if (!/^[\w-]{6,40}$/.test(id) || !Number.isInteger(i) || i < 0 || i > 2000) return res.status(400).json({ error: 'Zły fragment' });
  const e = chunks.get(id) ?? { parts: [], at: Date.now() };
  e.parts[i] = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0); e.at = Date.now();
  chunks.set(id, e);
  res.status(204).end();
});
admin.use('/api', (req, _res, next) => {
  const h = req.get('X-WD-Chunks'); if (!h) return next();
  const [id, n, enc] = h.split(':'); const e = chunks.get(id); const count = Number(n);
  if (!e || e.parts.length !== count || e.parts.some((x) => !x)) return next(Object.assign(new Error('Niekompletne dane – spróbuj zapisać ponownie'), { status: 400 }));
  chunks.delete(id);
  try {
    let buf = Buffer.concat(e.parts);
    if (enc === 'gz') buf = zlib.gunzipSync(buf);
    req.body = JSON.parse(buf.toString('utf8'));
    next();
  } catch (err: any) { next(Object.assign(new Error('Nie udało się odczytać danych: ' + err.message), { status: 400 })); }
});
admin.get('/', (req, res) => {
  res.type('html').send(page({ mode: 'admin', version: VERSION, user: req.get('X-Remote-User-Display-Name') || '' }));
});
admin.use(express.static(WEB_DIR, { index: false, maxAge: '1h' }));
admin.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }));

const api = express.Router();
api.get('/info', (_req, res) => res.json({ version: VERSION, kioskPort: KIOSK_PORT, haConnected: !!ha?.connected, settings: store.data.settings }));
api.put('/settings', (req, res) => {
  const go2 = String(req.body?.go2rtcUrl ?? store.data.settings.go2rtcUrl ?? '').trim().replace(/\/+$/, '');
  if (go2 && !/^https?:\/\/[\w.\-\[\]:]+(\/.*)?$/.test(go2)) return res.status(400).json({ error: 'Adres go2rtc musi zaczynać się od http:// lub https://' });
  store.data.settings = {
    kioskBase: String(req.body?.kioskBase ?? store.data.settings.kioskBase ?? '').trim().replace(/\/+$/, ''),
    ...(go2 ? { go2rtcUrl: go2 } : {})
  };
  store.write(); res.json(store.data.settings);
});

// ---- go2rtc relay: the browser talks only to the add-on (same origin, works over HTTPS),
//      the add-on talks to go2rtc on the LAN. Media then flows directly tablet ⇄ go2rtc (WebRTC).
const go2rtcBase = () => (store.data.settings.go2rtcUrl || 'http://127.0.0.1:1984').replace(/\/+$/, '');
async function go2rtcOffer(stream: string, sdp: string) {
  const r = await fetch(`${go2rtcBase()}/api/webrtc?src=${encodeURIComponent(stream)}`, { method: 'POST', body: sdp, signal: AbortSignal.timeout(10_000) })
    .catch((e) => { throw Object.assign(new Error(`Brak połączenia z go2rtc (${go2rtcBase()}): ${e.message}`), { status: 502 }); });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`go2rtc: ${r.status} ${text.slice(0, 200)}`), { status: 502 });
  return text;
}
async function go2rtcFrame(stream: string, res: Response) {
  const r = await fetch(`${go2rtcBase()}/api/frame.jpeg?src=${encodeURIComponent(stream)}`, { signal: AbortSignal.timeout(10_000) })
    .catch((e) => { throw Object.assign(new Error('Brak połączenia z go2rtc: ' + e.message), { status: 502 }); });
  if (!r.ok) throw Object.assign(new Error('go2rtc: ' + r.status), { status: 502 });
  res.set('Cache-Control', 'no-store').type(r.headers.get('content-type') || 'image/jpeg').send(Buffer.from(await r.arrayBuffer()));
}
const sdpBody = express.text({ type: '*/*', limit: '256kb' });
api.post('/go2rtc/webrtc', sdpBody, asyncH(async (req, res) => {
  const stream = streamName(req.query.stream);
  if (!stream) return res.status(400).json({ error: 'Brak nazwy strumienia' });
  res.type('text/plain').send(await go2rtcOffer(stream, String(req.body || '')));
}));
api.get('/go2rtc/frame.jpeg', asyncH(async (req, res) => { await go2rtcFrame(streamName(req.query.stream), res); }));
api.get('/go2rtc/streams', asyncH(async (_req, res) => {
  const r = await fetch(`${go2rtcBase()}/api/streams`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  res.json(r && r.ok ? Object.keys(await r.json().catch(() => ({}))) : []);
}));

api.get('/dashboards', (_req, res) => res.json(store.list()));
api.get('/dashboards/:id', (req, res) => {
  const d = store.get(req.params.id);
  d ? res.json(d) : res.status(404).json({ error: 'Nie ma takiego dashboardu' });
});
api.post('/dashboards', (req, res) => {
  const title = String(req.body?.title || 'Nowy dashboard').slice(0, 80);
  const id = slug(title) + '-' + newId().slice(0, 4);
  const from = req.body?.copyFrom ? store.get(String(req.body.copyFrom)) : undefined;
  const doc: DashboardDoc = from ? { ...structuredClone(from), id, title } : emptyDashboard(id, title);
  store.put(doc); res.status(201).json(doc);
});
api.put('/dashboards/:id', (req, res) => {
  if (!store.get(req.params.id)) return res.status(404).json({ error: 'Nie ma takiego dashboardu' });
  const doc = validateDashboard(req.body, req.params.id);
  store.put(doc);
  onDashboardsChanged([doc.id]);
  res.json(doc);
});
api.delete('/dashboards/:id', (req, res) => { store.remove(req.params.id); onDashboardsChanged([req.params.id]); res.status(204).end(); });

// houses (3D floor plans)
api.get('/houses', (_req, res) => res.json(Object.values(store.data.houses).map((h) => ({
  id: h.id, name: h.name, levels: h.levels.map((l) => l.name), devices: h.devices.length
}))));
api.get('/houses/:id', (req, res) => {
  const h = store.data.houses[req.params.id];
  h ? res.json(h) : res.status(404).json({ error: 'Nie ma takiego domu' });
});
api.post('/houses/import', (req, res) => {
  const name = String(req.body?.name || 'Dom').slice(0, 60);
  const id = req.body?.replace && store.data.houses[req.body.replace] ? String(req.body.replace) : slug(name) + '-' + newId().slice(0, 4);
  const h = importHouse(id, name, Array.isArray(req.body?.levels) ? req.body.levels : [], Number(req.body?.wallHeight) || 2.6);
  const old = store.data.houses[id];
  if (old) h.devices = old.devices.filter((d) => d.level < h.levels.length);   // re-import keeps devices
  store.data.houses[id] = h; store.write(); onDashboardsChanged([]);
  res.status(201).json(h);
});
api.put('/houses/:id', (req, res) => {
  if (!store.data.houses[req.params.id]) return res.status(404).json({ error: 'Nie ma takiego domu' });
  const h = validateHouse(req.body, req.params.id);
  store.data.houses[h.id] = h; store.write(); onDashboardsChanged([]);
  res.json(h);
});
api.delete('/houses/:id', (req, res) => { delete store.data.houses[req.params.id]; store.write(); onDashboardsChanged([]); res.status(204).end(); });

// Samsung TVs (direct LAN control)
const tvPublic = (t: TvDef) => ({ ...t, token: undefined, paired: !!t.token });
api.get('/tvs', (_req, res) => res.json(store.data.tvs.map(tvPublic)));
api.post('/tvs', (req, res) => {
  const host = String(req.body?.host || '').trim();
  if (!/^[\w.-]+$/.test(host)) return res.status(400).json({ error: 'Podaj adres IP telewizora' });
  const t: TvDef = { id: 'tv' + newId().slice(0, 6), name: String(req.body?.name || 'Telewizor').slice(0, 60), host,
    mac: String(req.body?.mac || '').trim() || undefined, broadcast: String(req.body?.broadcast || '').trim() || undefined, apps: [] };
  store.data.tvs.push(t); store.write(); tvs.sync(store.data.tvs); res.status(201).json(tvPublic(t));
});
api.put('/tvs/:id', (req, res) => {
  const t = store.data.tvs.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie ma takiego telewizora' });
  const b = req.body || {};
  if (typeof b.name === 'string') t.name = b.name.slice(0, 60);
  if (typeof b.host === 'string' && /^[\w.-]+$/.test(b.host.trim())) t.host = b.host.trim();
  if (typeof b.mac === 'string') t.mac = b.mac.trim() || undefined;
  if (typeof b.broadcast === 'string') t.broadcast = b.broadcast.trim() || undefined;
  if (Array.isArray(b.apps)) t.apps = b.apps.filter((a: any) => a && a.appId).map((a: any) => ({ appId: String(a.appId), name: String(a.name || a.appId), type: a.type }));
  store.write(); tvs.sync(store.data.tvs); onDashboardsChanged([]); res.json(tvPublic(t));
});
api.delete('/tvs/:id', (req, res) => {
  store.data.tvs = store.data.tvs.filter((x) => x.id !== req.params.id);
  store.write(); tvs.sync(store.data.tvs); res.status(204).end();
});
// TVs controlled through Home Assistant (remote.* + media_player.* with the same object id): app shortcuts
const cleanApps = (list: unknown): TvApp[] => (Array.isArray(list) ? list : []).filter((a: any) => a && a.appId).slice(0, 40)
  .map((a: any) => ({ appId: String(a.appId).slice(0, 120), name: String(a.name || a.appId).slice(0, 40), ...(a.via === 'app' || a.via === 'source' ? { via: a.via } : {}) }));
api.get('/ha-tvs', (_req, res) => {
  const states = ha?.states ?? new Map();
  const objs = [...states.keys()].filter((e) => e.startsWith('remote.')).map((e) => e.slice(7));
  for (const k of Object.keys(store.data.haTvs ?? {})) if (!objs.includes(k)) objs.push(k);
  res.json(objs.map((obj) => {
    const r = states.get('remote.' + obj), m = states.get('media_player.' + obj);
    return {
      id: 'ha:' + obj, obj, remote: r ? 'remote.' + obj : undefined, media: m ? 'media_player.' + obj : undefined,
      name: String(m?.attributes.friendly_name ?? r?.attributes.friendly_name ?? obj), state: m?.state ?? r?.state,
      sources: Array.isArray(m?.attributes.source_list) ? m!.attributes.source_list : [], source: m?.attributes.source,
      apps: store.data.haTvs?.[obj]?.apps ?? []
    };
  }));
});
api.put('/ha-tvs/:obj', (req, res) => {
  const obj = req.params.obj;
  if (!/^[a-z0-9_]+$/.test(obj)) return res.status(400).json({ error: 'Nieprawidłowa nazwa encji' });
  store.data.haTvs ??= {};
  store.data.haTvs[obj] = { apps: cleanApps(req.body?.apps) };
  store.write(); onDashboardsChanged([]); res.json(store.data.haTvs[obj]);
});
api.post('/tvs/:id/pair', asyncH(async (req, res) => {
  const tv = tvs.get(req.params.id);
  await tv.pair();
  const st = await tv.status();
  const t = store.data.tvs.find((x) => x.id === req.params.id);
  if (t && st.model) { t.model = st.model; store.write(); }
  res.json({ paired: true, status: st });
}));
api.get('/tvs/:id/apps', asyncH(async (req, res) => { res.json(await tvs.get(req.params.id).installedApps()); }));
api.get('/tvs/:id/status', asyncH(async (req, res) => { res.json(await tvs.get(req.params.id).status()); }));

api.get('/tablets', (_req, res) => res.json(store.data.tablets.map((t) => ({ ...t, quietNow: quietState(t) }))));
api.post('/tablets', (req, res) => {
  const first = Object.keys(store.data.dashboards)[0];
  const t = { id: newId(), name: String(req.body?.name || 'Nowy tablet').slice(0, 60), key: newKey(), dashboards: first ? [first] : [] };
  store.data.tablets.push(t); store.write(); res.status(201).json(t);
});
api.put('/tablets/:id', (req, res) => {
  const t = store.tablet(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie ma takiego tabletu' });
  if (typeof req.body?.name === 'string') t.name = req.body.name.slice(0, 60);
  if (Array.isArray(req.body?.dashboards)) t.dashboards = req.body.dashboards.filter((d: string) => store.get(d));
  if (typeof req.body?.lite === 'boolean') t.lite = req.body.lite || undefined;
  if (typeof req.body?.phone === 'boolean') t.phone = req.body.phone || undefined;
  if ('quiet' in (req.body ?? {})) {
    const q = req.body.quiet;
    const time = (v: unknown) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : undefined);
    t.quiet = q && typeof q === 'object' ? {
      hours: Array.isArray(q.hours) ? q.hours.filter((w: any) => time(w?.from) && time(w?.to)).slice(0, 10)
        .map((w: any) => ({ from: time(w.from)!, to: time(w.to)!, ...(Array.isArray(w.days) && w.days.length ? { days: w.days.map(Number).filter((x: number) => x >= 0 && x <= 6) } : {}) })) : undefined,
      entity: ENTITY_RE.test(String(q.entity ?? '')) ? String(q.entity) : undefined,
      ...(q.manual && typeof q.manual === 'object' ? { manual: { on: !!q.manual.on, ...(isFinite(q.manual.until) && q.manual.until ? { until: Number(q.manual.until) } : {}) } } : {}),
      ...(q.intercomSilent ? { intercomSilent: true } : {})
    } : undefined;
    setTimeout(() => pushQuiet(t, true), 0);
  }
  if ('layout' in (req.body ?? {})) t.layout = ['grid', 'stack'].includes(req.body.layout) ? req.body.layout : undefined;
  if (typeof req.body?.allowDisarm === 'boolean') t.allowDisarm = req.body.allowDisarm || undefined;
  if (typeof req.body?.intercom === 'boolean') t.intercom = req.body.intercom ? undefined : false;
  if ('intercomVolume' in (req.body ?? {})) t.intercomVolume = isFinite(req.body.intercomVolume) && req.body.intercomVolume !== null ? Math.max(10, Math.min(100, Number(req.body.intercomVolume))) : undefined;
  if ('intercomAudio' in (req.body ?? {})) t.intercomAudio = ['full', 'light', 'raw', 'ptt'].includes(req.body.intercomAudio) ? req.body.intercomAudio : undefined;
  if ('intercomCodec' in (req.body ?? {})) t.intercomCodec = ['opus', 'opus16', 'g722', 'pcmu'].includes(req.body.intercomCodec) ? req.body.intercomCodec : undefined;
  if (typeof req.body?.intercomLiteCodec === 'boolean') t.intercomLiteCodec = req.body.intercomLiteCodec || undefined;
  if ('intercomAuto' in (req.body ?? {})) t.intercomAuto = ['on', 'listen'].includes(req.body.intercomAuto) ? req.body.intercomAuto : undefined;
  if ('intercomAutoDelay' in (req.body ?? {})) t.intercomAutoDelay = isFinite(req.body.intercomAutoDelay) && req.body.intercomAutoDelay !== null ? Math.max(0, Math.min(30, Number(req.body.intercomAutoDelay))) : undefined;
  for (const k of ['intercomRing', 'intercomHold'] as const) if (k in (req.body ?? {})) t[k] = typeof req.body[k] === 'string' && req.body[k].trim() ? String(req.body[k]).trim().slice(0, 500) : undefined;
  if ('screen' in (req.body ?? {})) t.screen = cleanScreen(req.body.screen);
  if ('appPin' in (req.body ?? {})) t.appPin = typeof req.body.appPin === 'string' && /^\d{4,8}$/.test(req.body.appPin) ? req.body.appPin : undefined;
  store.write(); refreshKioskScopes();
  // the app on the panel takes the new screen / PIN settings with the reloaded kiosk data
  if ('screen' in (req.body ?? {}) || 'appPin' in (req.body ?? {})) for (const c of clients) if (c.mode === 'kiosk' && c.tabletId === t.id) send(c, { type: 'dashboards-changed', ids: [] });
  res.json(t);
});

function cleanClock(c: any): ScreenDef['clock'] {
  if (!c || typeof c !== 'object') return undefined;
  const ents = Array.isArray(c.entities) ? c.entities.filter((e: any) => e && typeof e.entity === 'string' && ENTITY_RE.test(e.entity)).slice(0, 4)
    .map((e: any) => ({ entity: e.entity, ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim().slice(0, 30) } : {}) })) : [];
  const out = {
    night: c.night ? true : undefined, idle: c.idle ? true : undefined, date: c.date ? true : undefined, calls: c.calls ? true : undefined,
    entities: ents.length ? ents : undefined,
    brightness: isFinite(Number(c.brightness)) && c.brightness !== '' && c.brightness != null ? Math.max(1, Math.min(60, Math.round(Number(c.brightness)))) : undefined
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}
function cleanScreen(s: any): ScreenDef | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const time = (v: unknown) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : undefined);
  const pct = (v: unknown, min = 0) => (v === '' || v == null || !isFinite(Number(v)) ? undefined : Math.max(min, Math.min(100, Math.round(Number(v)))));
  const hours = Array.isArray(s.hours) ? s.hours.map((w: any) => ({ from: time(w?.from), to: time(w?.to), days: Array.isArray(w?.days) && w.days.length ? w.days.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) : undefined }))
    .filter((w: any) => w.from && w.to).slice(0, 10) : [];
  const out: ScreenDef = {
    mode: ['saver', 'dim', 'off'].includes(s.mode) ? s.mode : undefined,
    idle: isFinite(Number(s.idle)) && Number(s.idle) > 0 ? Math.min(24 * 60, Math.round(Number(s.idle))) : undefined,
    hours: hours.length ? hours : undefined,
    brightness: pct(s.brightness, 1), dimBrightness: pct(s.dimBrightness),
    clock: cleanClock(s.clock)
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

// ------------------------------------------------------------ panel commands (HA event wall_dashboard_command, admin buttons)
const DEVICE_CMDS: DeviceCmd[] = ['reload', 'restart', 'screen-on', 'screen-off', 'saver', 'brightness'];
/** target: tablet id or name (case-insensitive), a list of them, or 'all' / empty = every panel. Returns how many panels got it. */
function deviceCommand(target: unknown, cmd: unknown, value?: unknown): number {
  const command = String(cmd ?? '').toLowerCase().replace(/_/g, '-') as DeviceCmd;
  if (!DEVICE_CMDS.includes(command)) { log.warn(`Polecenie dla panelu: nieznane „${String(cmd)}” (dozwolone: ${DEVICE_CMDS.join(', ')})`); return 0; }
  const names = (Array.isArray(target) ? target : target == null || target === '' ? ['all'] : [target]).map((x) => String(x).toLowerCase());
  const ids = new Set(store.data.tablets.filter((t) => names.includes('all') || names.includes(t.id.toLowerCase()) || names.includes(t.name.toLowerCase())).map((t) => t.id));
  const v = value == null || value === '' || !isFinite(Number(value)) ? undefined : Math.max(0, Math.min(100, Number(value)));
  let n = 0;
  for (const c of clients) if (c.mode === 'kiosk' && c.tabletId && ids.has(c.tabletId)) { send(c, { type: 'device', cmd: command, value: v }); n++; }
  log.info(`Polecenie „${command}”${v != null ? ' ' + v : ''} → ${n} panel(i)`);
  return n;
}
api.post('/tablets/:id/command', (req, res) => {
  const t = store.tablet(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie ma takiego tabletu' });
  res.json({ delivered: deviceCommand(t.id, req.body?.command, req.body?.value) });
});

// ------------------------------------------------------------ pairing the Android app: the panel shows a code, the admin confirms it here
const pairs = new Map<string, PairRequest & { token: string; result?: { key: string; tablet: string } }>();
setInterval(() => { const old = Date.now() - 15 * 60_000; for (const [k, p] of pairs) if (p.at < old) pairs.delete(k); }, 60_000).unref();
api.get('/pair', (_req, res) => res.json([...pairs.values()].filter((p) => !p.result).map(({ code, device, ip, at }) => ({ code, device, ip, at }))));
api.post('/pair/:code', (req, res) => {
  const p = pairs.get(String(req.params.code).replace(/\D/g, ''));
  if (!p || p.result) return res.status(404).json({ error: 'Nie ma takiego kodu (ważny 15 minut) – sprawdź kod na panelu' });
  let t = req.body?.tabletId ? store.tablet(String(req.body.tabletId)) : undefined;
  if (!t && req.body?.tabletId) return res.status(404).json({ error: 'Nie ma takiego tabletu' });
  if (!t) {
    const first = Object.keys(store.data.dashboards)[0];
    t = { id: newId(), name: String(req.body?.name || p.device || 'Panel').slice(0, 60), key: newKey(), dashboards: first ? [first] : [] };
    store.data.tablets.push(t);
  }
  t.appModel = p.device.slice(0, 80) || undefined;
  store.write(); refreshKioskScopes();
  p.result = { key: t.key, tablet: t.name };
  log.info(`Sparowano aplikację (${p.device}, ${p.ip}) z tabletem „${t.name}”`);
  res.json(t);
});

api.post('/tablets/:id/rekey', (req, res) => {
  const t = store.tablet(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie ma takiego tabletu' });
  t.key = newKey(); store.write(); dropKioskClients(t.id); res.json(t);
});
api.post('/tablets/:id/popup', (req, res) => {
  const t = store.tablet(req.params.id);
  if (!t) return res.status(404).json({ error: 'Nie ma takiego tabletu' });
  const n = sendPopup({ ...(req.body || {}), tablets: [t.id] });
  res.json({ delivered: n });
});
api.delete('/tablets/:id', (req, res) => {
  store.data.tablets = store.data.tablets.filter((t) => t.id !== req.params.id);
  store.write(); dropKioskClients(req.params.id); res.status(204).end();
});

api.get('/entities', asyncH(async (_req, res) => { res.json(await entityList()); }));
api.get('/camera/:entity', asyncH(async (req, res) => { await proxyCamera(req.params.entity, res); }));
api.get('/calendar', asyncH(async (req, res) => { const q = calendarQuery(req); res.json(await calendarEvents(q.entities, q.start, q.end)); }));
api.get('/media/:entity/art', asyncH(async (req, res) => { await proxyArt(req.params.entity, res); }));
api.get('/history-long/:entity', asyncH(async (req, res) => {
  res.json(await longHistory(req.params.entity, Math.min(120, Math.max(1, Number(req.query.days) || 60))));
}));
api.get('/history/:entity', asyncH(async (req, res) => {
  res.json(await history(req.params.entity, Math.min(168, Math.max(1, Number(req.query.hours) || 24))));
}));

// ------------------------------------------------------------ backup / restore (e.g. moving to the add-on from the repository)
api.get('/backup', (_req, res) => {
  const media = fs.readdirSync(MEDIA_DIR).filter((f) => !f.startsWith('.') && fs.statSync(path.join(MEDIA_DIR, f)).isFile())
    .map((name) => ({ name, data: fs.readFileSync(path.join(MEDIA_DIR, name)).toString('base64') }));
  res.setHeader('Content-Disposition', `attachment; filename="wall-dashboard-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ app: 'wall-dashboard', version: VERSION, created: new Date().toISOString(), data: store.data, media });
});
api.post('/restore', (req, res) => {
  const d = req.body?.data;
  if (!d || typeof d !== 'object' || typeof d.dashboards !== 'object' || !Array.isArray(d.tablets)) {
    return res.status(400).json({ error: 'To nie jest kopia zapasowa Wall Dashboard (brak dashboardów / tabletów)' });
  }
  store.data = { ...store.data, ...d, version: store.data.version, houses: d.houses ?? {}, tvs: d.tvs ?? [], triggers: d.triggers ?? [], calls: d.calls ?? [] };
  store.write();
  tvs.sync(store.data.tvs);
  onDashboardsChanged([]);
  log.info(`Przywrócono kopię zapasową: ${Object.keys(store.data.dashboards).length} dashboardów, ${store.data.tablets.length} tabletów`);
  res.json({ dashboards: Object.keys(store.data.dashboards).length, tablets: store.data.tablets.length, houses: Object.keys(store.data.houses ?? {}).length });
});

api.get('/media', (_req, res) => res.json(fs.readdirSync(MEDIA_DIR).filter((f) => !f.startsWith('.'))));
api.post('/media', express.raw({ type: '*/*', limit: '15mb' }), (req, res) => {
  const name = String(req.query.name || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  if (!/\.(png|jpe?g|webp|gif|svg|mp3|wav|ogg|m4a|aac)$/i.test(name)) return res.status(400).json({ error: 'Dozwolone pliki: png, jpg, webp, gif, svg oraz dźwięki mp3, wav, ogg, m4a' });
  fs.writeFileSync(path.join(MEDIA_DIR, name), req.body as Buffer);
  res.status(201).json({ url: 'media/' + name });
});
api.delete('/media/:name', (req, res) => {
  const f = path.join(MEDIA_DIR, path.basename(req.params.name));
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.status(204).end();
});
admin.use('/api', api);
admin.use(errorHandler);

// ---------------------------------------------------------------- kiosk (port 8100)
const kiosk = express();
kiosk.disable('x-powered-by');
// Works behind a reverse proxy sub-path (e.g. https://ha.example.com/custom/kiosk/) whether or not the
// proxy strips the prefix: known resource paths are cut out of any prefix, everything else is the page.
const KIOSK_PARTS = /^\/.*?(\/(?:assets|api|media|kenney|seed|sounds|icons)\/.*|\/manifest\.webmanifest(?:\?.*)?)$/;
kiosk.use((req, _res, next) => {
  const m = req.url.match(KIOSK_PARTS);
  if (m && !/^\/(?:assets|api|media|kenney|seed|sounds|icons)\/|^\/manifest\.webmanifest/.test(req.url)) req.url = m[1];
  next();
});
const kioskPage = (req: Request, res: Response) => {
  const t = store.tabletByKey(String(req.query.k || ''));
  // "Add to Home Screen" (iPhone / iPad / Android): own name, icon and full screen, starting with this tablet's key
  const head = t ? `<link rel="manifest" href="manifest.webmanifest?k=${encodeURIComponent(t.key)}"><meta name="apple-mobile-web-app-title" content="${escAttr(t.name)}">` : '';
  res.type('html').send(page({ mode: 'kiosk', key: t ? t.key : null }, head));
};
kiosk.get('/manifest.webmanifest', (req, res) => {
  const t = store.tabletByKey(String(req.query.k || ''));
  if (!t) return res.status(404).end();
  res.type('application/manifest+json').send(JSON.stringify({
    name: `Wall Dashboard – ${t.name}`, short_name: t.name.slice(0, 20), start_url: `./?k=${encodeURIComponent(t.key)}`, scope: './',
    display: 'standalone', background_color: '#0B0D12', theme_color: '#0B0D12', lang: 'pl',
    icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
  }));
});
kiosk.get('/', kioskPage);
kiosk.use(express.static(WEB_DIR, { index: false, maxAge: '1h' }));
kiosk.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }));

function kioskAuth(req: Request) {
  const t = store.tabletByKey(String(req.query.k || ''));
  if (!t) throw Object.assign(new Error('Nieprawidłowy lub cofnięty klucz tabletu'), { status: 401 });
  return { tablet: t, scope: kioskScope(store, t) };
}
const kapi = express.Router();
// Android app pairing (no key yet): start → 6-digit code shown on the panel; poll with the secret token until the admin confirms
const pairHits = new Map<string, number[]>();
kapi.post('/pair/start', express.json({ limit: '2kb' }), (req, res) => {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  const now = Date.now(), hits = (pairHits.get(ip) ?? []).filter((t) => t > now - 10 * 60_000);
  if (hits.length >= 10 || pairs.size >= 20) return res.status(429).json({ error: 'Za dużo prób parowania – odczekaj kilka minut' });
  hits.push(now); pairHits.set(ip, hits);
  let code = '';
  do code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); while (pairs.has(code));
  const token = crypto.randomBytes(24).toString('hex');
  pairs.set(code, { code, token, device: String(req.body?.device ?? '').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 80), ip, at: now });
  for (const c of clients) if (c.mode === 'admin') send(c, { type: 'dashboards-changed', ids: [] });
  res.json({ code, token, expires: 15 * 60 });
});
kapi.get('/pair/poll', (req, res) => {
  const p = [...pairs.values()].find((x) => x.token === String(req.query.token || ''));
  if (!p) return res.status(404).json({ status: 'expired' });
  if (!p.result) return res.json({ status: 'pending', code: p.code });
  pairs.delete(p.code);
  res.json({ status: 'ok', key: p.result.key, tablet: p.result.tablet });
});
kapi.get('/kiosk', (req, res) => {
  const { tablet, scope } = kioskAuth(req);
  res.json({
    tablet: { id: tablet.id, name: tablet.name, lite: !!tablet.lite, layout: tablet.layout, screen: tablet.screen, appPin: tablet.appPin, intercom: tablet.intercom !== false, intercomCfg: { volume: tablet.intercomVolume, lite: !!tablet.lite, audio: tablet.intercomAudio, codec: tablet.intercomCodec ?? (tablet.lite && tablet.intercomLiteCodec ? 'g722' : undefined), dnd: !!tablet.quiet?.intercomSilent, auto: tablet.intercomAuto, autoDelay: tablet.intercomAutoDelay, ring: tablet.intercomRing, hold: tablet.intercomHold } },
    dashboards: scope.dashboards.map((id) => store.get(id)),
    houses: scope.houses.map((id) => store.data.houses[id]),
    tvs: [
      ...store.data.tvs.filter((t) => scope.tvs.has(t.id)).map((t) => ({ id: t.id, name: t.name, apps: t.apps })),
      ...Object.entries(store.data.haTvs ?? {}).filter(([o]) => scope.entities.has('remote.' + o) || scope.entities.has('media_player.' + o)).map(([o, v]) => ({ id: 'ha:' + o, name: '', apps: v.apps }))
    ]
  });
});
kapi.get('/camera/:entity', asyncH(async (req, res) => {
  const { scope } = kioskAuth(req);
  if (!scope.entities.has(req.params.entity)) return res.status(403).send('Brak dostępu');
  await proxyCamera(req.params.entity, res);
}));
kapi.get('/calendar', asyncH(async (req, res) => {
  const { scope } = kioskAuth(req);
  const q = calendarQuery(req);
  if (q.entities.some((e) => !scope.entities.has(e))) return res.status(403).json({ error: 'Kalendarz nie należy do dashboardu tego tabletu' });
  res.json(await calendarEvents(q.entities, q.start, q.end));
}));
kapi.get('/media/:entity/art', asyncH(async (req, res) => {
  const { scope } = kioskAuth(req);
  if (!scope.entities.has(req.params.entity)) return res.status(403).send('Brak dostępu');
  await proxyArt(req.params.entity, res);
}));
/** go2rtc streams a tablet may watch: from its dashboards, or from a pop-up currently shown on it */
function kioskStreamAllowed(req: Request, stream: string) {
  const { tablet, scope } = kioskAuth(req);
  if (!stream) return false;
  if (scope.dashboards.some((id) => streamsOf(store.get(id)!).includes(stream))) return true;
  return [...clients].some((c) => c.tabletId === tablet.id && !!c.extra?.has('go2rtc:' + stream));
}
kapi.post('/go2rtc/webrtc', sdpBody, asyncH(async (req, res) => {
  const stream = streamName(req.query.stream);
  if (!kioskStreamAllowed(req, stream)) return res.status(403).json({ error: 'Brak dostępu do strumienia' });
  res.type('text/plain').send(await go2rtcOffer(stream, String(req.body || '')));
}));
kapi.get('/go2rtc/frame.jpeg', asyncH(async (req, res) => {
  const stream = streamName(req.query.stream);
  if (!kioskStreamAllowed(req, stream)) return res.status(403).send('Brak dostępu');
  await go2rtcFrame(stream, res);
}));
// kiosk: call log for tablets of the trigger (or all, when the trigger targets all tablets)
const kcalls = express.Router();
kcalls.use('/calls', (req, _res, next) => { kioskAuth(req); next(); });
callsApi(kcalls);
kapi.use(kcalls);
kapi.get('/intercom/peers', (req, res) => {
  const { tablet } = kioskAuth(req);
  if (tablet.intercom === false) return res.json([]);
  res.json(store.data.tablets.filter((t) => t.id !== tablet.id && t.intercom !== false)
    .map((t) => ({ id: t.id, name: t.name, online: [...clients].some((x) => x.tabletId === t.id), busy: icBusy(t.id) })));
});
kapi.get('/history-long/:entity', asyncH(async (req, res) => {
  const { scope } = kioskAuth(req);
  if (!scope.entities.has(req.params.entity)) return res.status(403).json({ error: 'Brak dostępu' });
  res.json(await longHistory(req.params.entity, Math.min(120, Math.max(1, Number(req.query.days) || 60))));
}));
kapi.get('/history/:entity', asyncH(async (req, res) => {
  const { scope } = kioskAuth(req);
  if (!scope.entities.has(req.params.entity)) return res.status(403).json({ error: 'Brak dostępu' });
  res.json(await history(req.params.entity, Math.min(168, Math.max(1, Number(req.query.hours) || 24))));
}));
// ---- HLS of Home Assistant cameras (camera.* entities) for weak panels: HA hands out a tokenised playlist,
//      the add-on relays it (same origin, works through HTTPS); only tokens issued here are relayed.
const hlsTokens = new Map<string, number>(); // token → expiry
async function haHls(entity: string) {
  const r = await requireHa().cmd<{ url: string }>({ type: 'camera/stream', entity_id: entity, format: 'hls' });
  const m = /\/api\/hls\/([^/]+)\/(.+)$/.exec(r?.url ?? '');
  if (!m) throw Object.assign(new Error('Kamera nie udostępnia strumienia HLS (integracja stream)'), { status: 502 });
  hlsTokens.set(m[1], Date.now() + 6 * 3600_000);
  return 'api/ha-hls/' + m[1] + '/' + m[2];
}
kapi.get('/camera/:entity/hls', asyncH(async (req, res) => {
  const { scope } = kioskAuth(req);
  if (!scope.entities.has(req.params.entity) && ![...clients].some((c) => c.extra?.has(req.params.entity))) return res.status(403).json({ error: 'Brak dostępu' });
  res.json({ url: await haHls(req.params.entity) });
}));
api.get('/camera/:entity/hls', asyncH(async (req, res) => res.json({ url: await haHls(req.params.entity) })));
const hlsRelay = asyncH(async (req, res) => {
  const token = req.params.token, exp = hlsTokens.get(token);
  if (!exp || exp < Date.now()) return res.status(403).end();
  const rest = String((req.params as any)[0] ?? '');
  const r = await requireHa().rest(`/hls/${encodeURIComponent(token)}/${rest}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
  res.status(r.status).set('Cache-Control', 'no-store').type(r.headers.get('content-type') || 'application/octet-stream');
  res.send(Buffer.from(await r.arrayBuffer()));
});
kiosk.get('/api/ha-hls/:token/*', hlsRelay);
admin.get('/api/ha-hls/:token/*', hlsRelay);
setInterval(() => { const n = Date.now(); for (const [k, v] of hlsTokens) if (v < n) hlsTokens.delete(k); }, 600_000).unref();

kiosk.use('/api', kapi);
// any other GET (the prefix itself, e.g. /custom/kiosk/) gets the page
kiosk.get(/^\/(?!api\/|assets\/|media\/|kenney\/|seed\/).*/, kioskPage);
kiosk.use(errorHandler);

// ---------------------------------------------------------------- websocket (both ports)
interface Client { ws: WebSocket; mode: 'admin' | 'kiosk'; tabletId?: string; allowed: Set<string> | null; tvs?: Set<string>; extra?: Set<string>; rtc?: Map<number, number>; schedules?: boolean }
const isScheduleEntity = (id: string, s?: any) => id.startsWith('switch.schedule_') || (id.startsWith('switch.') && Array.isArray(s?.attributes?.timeslots));
/** add scheduler entities to a kiosk scope that shows a schedules widget */
function withSchedules(allowed: Set<string>, on: boolean) {
  if (on && ha) for (const s of ha.states.values()) if (isScheduleEntity(s.entity_id, s)) allowed.add(s.entity_id);
  return allowed;
}
const clients = new Set<Client>();

function send(c: Client, msg: ServerMsg) { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg)); }
function visibleStates(c: Client) {
  if (!ha) return [];
  return [...ha.states.values()].filter((s) => !c.allowed || c.allowed.has(s.entity_id));
}
function refreshKioskScopes() {
  for (const c of clients) {
    if (c.mode !== 'kiosk') continue;
    const t = c.tabletId ? store.tablet(c.tabletId) : undefined;
    if (!t) { c.ws.close(4001, 'tablet removed'); continue; }
    const sc = kioskScope(store, t);
    c.allowed = withSchedules(sc.entities, sc.schedules); c.tvs = sc.tvs; c.schedules = sc.schedules;
    send(c, { type: 'states', states: visibleStates(c) });
  }
}
function onDashboardsChanged(ids: string[]) {
  refreshKioskScopes();
  for (const c of clients) send(c, { type: 'dashboards-changed', ids });
}
function dropKioskClients(tabletId: string) {
  for (const c of clients) if (c.tabletId === tabletId) c.ws.close(4001, 'key revoked');
}

/** go2rtc MSE over WebSocket (fMP4) relayed by the add-on: works through HTTPS / proxies and without UDP –
 *  the fallback when WebRTC gives no picture (other subnet, blocked UDP, weak decoder). */
const g2wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
function go2rtcWsProxy(req: http.IncomingMessage, socket: any, head: Buffer, mode: 'admin' | 'kiosk', url: URL) {
  const stream = streamName(url.searchParams.get('stream'));
  if (mode === 'admin') {
    const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
    if (IN_ADDON && process.env.ALLOW_ANY_ADMIN !== '1' && ip !== INGRESS_IP && ip !== '127.0.0.1') return socket.destroy();
  } else {
    try { if (!kioskStreamAllowed({ query: { k: url.searchParams.get('k') ?? '' } } as unknown as Request, stream)) return socket.destroy(); }
    catch { return socket.destroy(); }
  }
  if (!stream) return socket.destroy();
  g2wss.handleUpgrade(req, socket, head, (client) => {
    const target = go2rtcBase().replace(/^http/, 'ws') + '/api/ws?src=' + encodeURIComponent(stream);
    const up = new WebSocket(target);
    const pending: { data: any; bin: boolean }[] = [];
    up.on('open', () => { for (const p of pending.splice(0)) up.send(p.data, { binary: p.bin }); });
    up.on('message', (data, bin) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary: bin }); });
    client.on('message', (data, bin) => { if (up.readyState === WebSocket.OPEN) up.send(data, { binary: bin }); else pending.push({ data, bin }); });
    const close = () => { try { client.close(); } catch { /* */ } try { up.close(); } catch { /* */ } };
    up.on('close', close); up.on('error', (e) => { log.debug('go2rtc ws: ' + e.message); close(); });
    client.on('close', close); client.on('error', close);
  });
}

function attachWs(server: http.Server, mode: 'admin' | 'kiosk') {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname.endsWith('/api/go2rtc/ws')) return go2rtcWsProxy(req, socket, head, mode, url);
    if (!url.pathname.endsWith('/ws')) return socket.destroy();
    let client: Omit<Client, 'ws'>;
    if (mode === 'admin') {
      const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
      if (IN_ADDON && process.env.ALLOW_ANY_ADMIN !== '1' && ip !== INGRESS_IP && ip !== '127.0.0.1') return socket.destroy();
      client = { mode, allowed: null };
    } else {
      const t = store.tabletByKey(url.searchParams.get('k') || '');
      if (!t) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
      const sc = kioskScope(store, t);
      client = { mode, tabletId: t.id, allowed: withSchedules(sc.entities, sc.schedules), tvs: sc.tvs, schedules: sc.schedules };
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c: Client = { ws, ...client };
      clients.add(c);
      send(c, { type: 'hello', haConnected: !!ha?.connected, mode });
      { const tq = c.tabletId ? store.tablet(c.tabletId) : undefined; if (tq) send(c, { type: 'quiet', state: quietState(tq) }); }
      send(c, { type: 'states', states: visibleStates(c) });
      ws.on('message', (raw) => onClientMessage(c, raw.toString()));
      ws.on('close', () => {
        clients.delete(c);
        intercomGone(c);
        for (const sub of c.rtc?.values() ?? []) ha?.unsubscribe(sub);
      });
    });
  });
}

const canSee = (c: Client, entity: string) => !c.allowed || c.allowed.has(entity) || !!c.extra?.has(entity);

async function onClientMessage(c: Client, raw: string) {
  let msg: ClientMsg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'call') return onCall(c, msg);
  if (msg.type === 'tv') return onTv(c, msg);
  if (msg.type === 'popup-open') return onPopupOpen(c, msg.trigger);
  if (msg.type === 'quiet') {
    const t = c.tabletId ? store.tablet(c.tabletId) : undefined;
    if (c.mode !== 'kiosk' || !t) return;
    const cur = quietState(t).on;
    const on = msg.mode === 'toggle' ? !cur : msg.mode === 'on';
    const mins = Number(msg.minutes) || 0;
    // "off" during quiet hours / entity: override until the current window ends (or N minutes)
    const base = { ...(t.quiet ?? {}) }; delete base.manual;
    const auto = quietState({ ...t, quiet: base }).on; // what schedule / entity say without a manual switch
    // no override needed when the wish matches the schedule; "off" inside a window lasts until the window ends
    t.quiet = on === auto && !mins ? base
      : { ...base, manual: { on, ...(mins > 0 ? { until: Date.now() + mins * 60_000 } : !on ? { until: quietWindowEnd(base) ?? Date.now() + 12 * 3600_000 } : {}) } };
    store.write(); pushQuiet(t, true);
    log.info(`Cisza na „${t.name}”: ${on ? 'włączona' : 'wyłączona'}${mins ? ' na ' + mins + ' min' : ''}`);
    return;
  }
  if (msg.type === 'popup-event') {
    if (typeof msg.popupId === 'string' && ['answer', 'open', 'reject'].includes(msg.event))
      callEvent(msg.popupId, msg.event, c.tabletId ? store.tablet(c.tabletId)?.name : undefined);
    return;
  }
  if (msg.type.startsWith('ic-')) return onIntercom(c, msg as IcClientMsg);
  if (msg.type === 'popup-dismiss') { if (typeof msg.popupId === 'string' && msg.popupId) { log.info(`Pop-up ${msg.popupId} odrzucony na tablecie`); sendPopup({ id: msg.popupId, action: 'close' }); callEnd(msg.popupId); } return; }
  if (msg.type.startsWith('webrtc-')) return onWebRtc(c, msg as Exclude<ClientMsg, ClientCall | { type: 'tv' } | { type: 'popup-dismiss' } | { type: 'popup-open' } | { type: 'popup-event' } | { type: 'quiet' } | IcClientMsg>).catch((e) => send(c, { type: 'webrtc', id: (msg as any).id, event: { type: 'error', message: e.message } }));
}

async function onCall(c: Client, msg: ClientCall) {
  try {
    if (typeof msg.domain !== 'string' || typeof msg.service !== 'string') throw new Error('Niepoprawne wywołanie');
    if (c.mode === 'kiosk') checkKioskCall(msg, new Set([...c.allowed!, ...(c.extra ?? [])]), { allowDisarm: !!(c.tabletId && store.tablet(c.tabletId)?.allowDisarm) });
    const target = msg.target?.entity_id ? { entity_id: msg.target.entity_id } : undefined;
    if (target) {
      const ids = ([] as string[]).concat(target.entity_id as any);
      if (!ids.every((e) => ENTITY_RE.test(e))) throw new Error('Niepoprawna encja');
    }
    await requireHa().callService(msg.domain, msg.service, msg.data, target);
    send(c, { type: 'result', id: msg.id, ok: true });
  } catch (e: any) {
    log.debug(`call ${msg.domain}.${msg.service} odrzucone:`, e.message);
    send(c, { type: 'result', id: msg.id, ok: false, error: e.message });
  }
}

async function onTv(c: Client, msg: Extract<ClientMsg, { type: 'tv' }>) {
  try {
    if (c.mode === 'kiosk' && !c.tvs?.has(msg.tv)) throw new Error('Ten telewizor nie należy do dashboardu tego tabletu');
    const tv = tvs.get(msg.tv);
    switch (msg.action) {
      case 'key': await tv.key(msg.key, msg.hold); break;
      case 'app': await tv.launch(msg.appId, msg.appType); break;
      case 'power': await tv.power(); break;
      case 'status': return send(c, { type: 'tv', id: msg.id, ok: true, status: await tv.status() });
    }
    send(c, { type: 'tv', id: msg.id, ok: true });
  } catch (e: any) {
    log.debug('TV:', e.message);
    send(c, { type: 'tv', id: msg.id, ok: false, error: e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' ? 'Telewizor jest wyłączony lub poza siecią' : e.message });
  }
}

/** Live camera: the browser's SDP offer goes to HA (camera/webrtc/offer, go2rtc inside HA); answer and ICE come back. */
async function onWebRtc(c: Client, msg: Exclude<ClientMsg, ClientCall | { type: 'tv' } | { type: 'popup-dismiss' } | { type: 'popup-open' } | { type: 'popup-event' } | { type: 'quiet' } | IcClientMsg>) {
  const client = requireHa();
  if (msg.type === 'webrtc-close') {
    const sub = c.rtc?.get(msg.id); c.rtc?.delete(msg.id);
    if (sub) await client.unsubscribe(sub);
    return;
  }
  if (!ENTITY_RE.test(msg.entity) || !msg.entity.startsWith('camera.')) throw new Error('Niepoprawna kamera');
  if (!canSee(c, msg.entity)) throw new Error('Kamera nie należy do dashboardu tego tabletu');
  if (msg.type === 'webrtc-config') {
    let iceServers: any[] = [];
    try { iceServers = (await client.cmd<any>({ type: 'camera/webrtc/get_client_config', entity_id: msg.entity }))?.configuration?.iceServers ?? []; }
    catch { /* older HA: no config, LAN works without STUN */ }
    send(c, { type: 'webrtc', id: msg.id, event: { type: 'config', iceServers } });
    return;
  }
  if (msg.type === 'webrtc-offer') {
    c.rtc ??= new Map();
    const sub = await client.subscribe({ type: 'camera/webrtc/offer', entity_id: msg.entity, offer: msg.offer },
      (event) => send(c, { type: 'webrtc', id: msg.id, event }));
    c.rtc.set(msg.id, sub);
    return;
  }
  if (msg.type === 'webrtc-candidate') {
    await client.cmd({ type: 'camera/webrtc/candidate', entity_id: msg.entity, session_id: msg.session_id, candidate: msg.candidate });
  }
}

// ---------------------------------------------------------------- pop-ups (HA event wall_dashboard_popup)
function popupEntities(p: PopupDef) {
  const out = new Set<string>();
  if (p.camera && ENTITY_RE.test(p.camera)) out.add(p.camera);
  for (const r of p.rows ?? []) if (r && ENTITY_RE.test(r.entity)) out.add(r.entity);
  if (p.open?.entity && ENTITY_RE.test(p.open.entity)) out.add(p.open.entity);
  if (p.reject?.entity && ENTITY_RE.test(p.reject.entity)) out.add(p.reject.entity);
  return out;
}
function sendPopup(raw: any, only?: Client): number {
  const p: PopupDef = raw && typeof raw === 'object' ? raw : {};
  const targets = (Array.isArray(p.tablets) ? p.tablets : typeof (p.tablets as any) === 'string' ? [p.tablets as any] : []).map((x) => String(x).toLowerCase());
  const close = p.action === 'close';
  let n = 0;
  for (const c of clients) {
    if (c.mode !== 'kiosk' || (only && c !== only)) continue;
    const t = c.tabletId ? store.tablet(c.tabletId) : undefined;
    if (!t) continue;
    if (!only && targets.length && !targets.includes(t.id.toLowerCase()) && !targets.includes(t.name.toLowerCase())) continue;
    if (close) { send(c, { type: 'popup-close', id: p.id }); n++; continue; }
    // phones / iPads: only pop-ups aimed at them by name (or opened by their own button)
    if (!only && !targets.length && t.phone) continue;
    // an automation is trusted: the tablet may see/control the pop-up's entities while it is open
    const ents = popupEntities(p);
    if (p.go2rtc?.stream) ents.add('go2rtc:' + streamName(p.go2rtc.stream));
    if (p.go2rtc?.lite) ents.add('go2rtc:' + streamName(p.go2rtc.lite));
    c.extra = new Set([...(c.extra ?? []), ...ents]);
    if (ha) send(c, { type: 'states', states: [...ha.states.values()].filter((s) => canSee(c, s.entity_id)) });
    send(c, { type: 'popup', popup: { ...p, rows: Array.isArray(p.rows) ? p.rows : [], tablets: undefined } });
    n++;
  }
  log.info(`Pop-up „${p.title ?? p.id ?? ''}” → ${n} tablet(ów)`);
  return n;
}

// ---------------------------------------------------------------- triggers (entity → pop-up / wake), configured in the add-on
const lastState = new Map<string, string>();
const lastFired = new Map<string, number>();
const trgId = (t: TriggerDef) => 'trg-' + t.id;
function fireTrigger(t: TriggerDef, test = false): number {
  lastFired.set(t.id, Date.now());
  if (t.action === 'wake') return sendWake(t.tablets ?? [], t.wake ?? {});
  log.info(`Wyzwalacz „${t.name}”${test ? ' (test)' : ''}`);
  const n = sendPopup({ timeout: 60, ...(t.popup ?? {}), ...(t.ivr?.hangupAfter ? { timeout: t.ivr.hangupAfter } : {}), id: trgId(t), tablets: t.tablets ?? [], wake: t.wake ?? { screen: true } });
  if (!test || t.ivr) callStart(t, test);
  return n;
}
/** A tile with the action "show pop-up": only for triggers that a dashboard of this tablet points to. */
function onPopupOpen(c: Client, id: unknown) {
  const t = (store.data.triggers ?? []).find((x) => x.id === id);
  const tablet = c.tabletId ? store.tablet(c.tabletId) : undefined;
  if (c.mode !== 'kiosk' || !t || !tablet) return;
  const used = kioskScope(store, tablet).dashboards.some((d) => popupTriggersOf(store.get(d)!).includes(t.id));
  if (!used) { log.warn(`Tablet ${tablet.name} prosił o pop-up „${t.name}”, którego nie ma na jego dashboardach`); return; }
  log.info(`Pop-up „${t.name}” otwarty przyciskiem na ${tablet.name}`);
  sendPopup({ timeout: 60, ...(t.popup ?? {}), id: trgId(t), wake: { screen: false } }, c);
}
// ---------------------------------------------------------------- intercom between panels: the add-on only rings and relays
// WebRTC signalling; the voice goes directly tablet ↔ tablet in the LAN.
type IcClientMsg = Extract<ClientMsg, { type: `ic-${string}` }>;
interface IcCall { id: string; from: Client; fromTablet: string; to: string; callee?: Client; timer?: ReturnType<typeof setTimeout> }
const icCalls = new Map<string, IcCall>();
const icTablet = (id?: string) => (id ? store.tablet(id) : undefined);
const icPeer = (id: string) => ({ id, name: icTablet(id)?.name ?? id });
const icBusy = (tabletId: string) => [...icCalls.values()].some((k) => k.fromTablet === tabletId || k.to === tabletId);
function icEnd(k: IcCall, reason: IcEndReason, by?: Client) {
  clearTimeout(k.timer);
  icCalls.delete(k.id);
  const notify = new Set<Client>([k.from, ...(k.callee ? [k.callee] : [...clients].filter((x) => x.tabletId === k.to))]);
  for (const x of notify) if (x !== by) send(x, { type: 'ic-ended', callId: k.id, reason });
  log.info(`Interkom ${icPeer(k.fromTablet).name} → ${icPeer(k.to).name}: koniec (${reason})`);
}
function onIntercom(c: Client, msg: IcClientMsg) {
  if (c.mode !== 'kiosk' || !c.tabletId) return;
  const me = icTablet(c.tabletId);
  if (!me) return;
  if (msg.type === 'ic-call') {
    const to = icTablet(String(msg.to));
    if (me.intercom === false) return send(c, { type: 'ic-error', message: 'Interkom jest wyłączony dla tego tabletu (Tablety → Interkom)' });
    if (!to || to.id === me.id || to.intercom === false) return send(c, { type: 'ic-error', message: 'Nie można zadzwonić do tego panelu' });
    const targets = [...clients].filter((x) => x.tabletId === to.id && x.mode === 'kiosk');
    const id = newId();
    if (!targets.length) { send(c, { type: 'ic-calling', callId: id, to: icPeer(to.id) }); return send(c, { type: 'ic-ended', callId: id, reason: 'offline' }); }
    if (icBusy(to.id) || icBusy(me.id)) { send(c, { type: 'ic-calling', callId: id, to: icPeer(to.id) }); return send(c, { type: 'ic-ended', callId: id, reason: 'busy' }); }
    const k: IcCall = { id, from: c, fromTablet: me.id, to: to.id };
    k.timer = setTimeout(() => icEnd(k, 'no-answer'), 45_000);
    icCalls.set(id, k);
    send(c, { type: 'ic-calling', callId: id, to: icPeer(to.id) });
    for (const x of targets) send(x, { type: 'ic-ring', callId: id, from: icPeer(me.id) });
    log.info(`Interkom: ${me.name} dzwoni do ${to.name}`);
    return;
  }
  const k = icCalls.get(String((msg as any).callId));
  if (!k) return;
  if (msg.type === 'ic-answer') {
    if (k.callee || c.tabletId !== k.to) return;
    k.callee = c; clearTimeout(k.timer);
    k.timer = setTimeout(() => { if (icCalls.has(k.id)) icEnd(k, 'hangup'); }, 3 * 3600_000); // safety: max 3 h
    send(k.from, { type: 'ic-accepted', callId: k.id, ...(typeof msg.codec === 'string' ? { codec: msg.codec.slice(0, 10) } : {}) });
    for (const x of clients) if (x.tabletId === k.to && x !== c) send(x, { type: 'ic-ended', callId: k.id, reason: 'answered-elsewhere' });
    log.info(`Interkom: ${icPeer(k.to).name} odebrał`);
    return;
  }
  if (msg.type === 'ic-signal') {
    const other = c === k.from ? k.callee : c === k.callee ? k.from : undefined;
    if (other) send(other, { type: 'ic-signal', callId: k.id, data: msg.data });
    return;
  }
  if (msg.type === 'ic-hangup') {
    if (c === k.from) return icEnd(k, k.callee ? (msg.reason === 'error' ? 'error' : 'hangup') : 'cancel', c);
    if (c === k.callee) return icEnd(k, msg.reason === 'error' ? 'error' : 'hangup', c);
    if (!k.callee && c.tabletId === k.to) {
      // one screen of the called tablet rejected (or was busy)
      return icEnd(k, msg.reason === 'busy' ? 'busy' : 'reject', c);
    }
  }
}
function intercomGone(c: Client) {
  for (const k of [...icCalls.values()]) {
    if (k.from === c || k.callee === c) icEnd(k, 'offline', c);
    else if (!k.callee && c.tabletId === k.to && ![...clients].some((x) => x.tabletId === k.to)) icEnd(k, 'offline', c);
  }
}

// ---------------------------------------------------------------- call log ("who rang while nobody answered") + IVR
const CALLS_DIR = path.join(DATA_DIR, 'calls');
fs.mkdirSync(CALLS_DIR, { recursive: true });
interface ActiveCall { rec: CallRecord; t: TriggerDef; timer: ReturnType<typeof setTimeout>; ivr?: { timer?: ReturnType<typeof setTimeout>; stream: string; playing: boolean }; test: boolean }
const activeCalls = new Map<string, ActiveCall>();
const missedCount = () => (store.data.calls ?? []).filter((r) => r.status === 'missed' && !r.seen).length;
function callsChanged() {
  const missed = missedCount();
  for (const c of clients) send(c, { type: 'calls-changed', missed });
}
function callSave(rec: CallRecord) {
  const list = (store.data.calls ?? []).filter((r) => r.id !== rec.id);
  list.unshift(rec);
  for (const old of list.splice(200)) fs.rmSync(path.join(CALLS_DIR, old.id + '.jpg'), { force: true });
  store.data.calls = list; store.write(); callsChanged();
}
async function callSnapshot(rec: CallRecord, p: PopupDef) {
  try {
    const r = p.go2rtc?.stream ? await fetch(`${go2rtcBase()}/api/frame.jpeg?src=${encodeURIComponent(streamName(p.go2rtc.stream))}`, { signal: AbortSignal.timeout(8000) })
      : p.camera ? await requireHa().rest('/camera_proxy/' + encodeURIComponent(p.camera)) : null;
    if (!r || !r.ok) return;
    fs.writeFileSync(path.join(CALLS_DIR, rec.id + '.jpg'), Buffer.from(await r.arrayBuffer()));
    rec.snapshot = true; callSave(rec);
  } catch (e: any) { log.debug('Zdjęcie dzwoniącego niedostępne', e.message); }
}
function callStart(t: TriggerDef, test: boolean) {
  const id = trgId(t);
  const prev = activeCalls.get(id);
  if (prev) { clearTimeout(prev.timer); ivrStop(prev); activeCalls.delete(id); }
  const rec: CallRecord = { id: newId(), trigger: t.id, name: t.name, at: Date.now(), status: 'ringing' };
  const timeout = (t.ivr?.hangupAfter ?? t.popup?.timeout ?? 60) || 600;
  const a: ActiveCall = { rec, t, test, timer: setTimeout(() => callEnd(id), timeout * 1000) };
  activeCalls.set(id, a);
  if (!test && t.log !== false) { callSave(rec); void callSnapshot(rec, t.popup ?? {}); }
  if (t.ivr && (t.ivr.music || t.ivr.greeting || t.ivr.greetingText)) ivrSchedule(a);
}
function callEvent(popupId: string, ev: 'answer' | 'open' | 'reject', by?: string) {
  const a = activeCalls.get(popupId);
  if (!a) return;
  ivrStop(a);
  if (a.rec.status === 'ringing' || (a.rec.status === 'answered' && ev === 'open')) {
    a.rec.status = ev === 'answer' ? 'answered' : ev === 'open' ? 'opened' : 'rejected';
    a.rec.by = by;
    if (!a.test && a.t.log !== false) callSave(a.rec);
    log.info(`Dzwonek „${a.t.name}”: ${a.rec.status}${by ? ' (' + by + ')' : ''}`);
  }
  if (ev === 'reject') {
    if (a.rec.ivr && a.t.ivr?.hangupEntity) { log.info(`IVR „${a.t.name}”: odrzucono na panelu – rozłączam domofon`); void pressEntity(a.t.ivr.hangupEntity, 'IVR rozłącz'); }
    callEnd(popupId);
  }
}
/** gone = the visitor hung up / the intercom went idle (closeOn) – no goodbye, nothing to hang up */
function callEnd(popupId: string, gone = false) {
  const a = activeCalls.get(popupId);
  if (!a) return;
  clearTimeout(a.timer); activeCalls.delete(popupId);
  const missed = a.rec.status === 'ringing';
  const bye = a.t.ivr?.goodbye || (a.t.ivr?.goodbyeText ? 'tts:' + a.t.ivr.goodbyeText : '');
  if (missed && a.rec.ivr && !gone) {
    // nobody answered: goodbye, then hang up the intercom and close the pop-up on the panels
    sendPopup({ id: popupId, action: 'close', tablets: a.t.tablets ?? [] });
    void ivrFinish(a, bye);
  } else ivrStop(a);
  if (missed) a.rec.status = 'missed';
  a.rec.ended = Date.now();
  if (a.test || a.t.log === false) return;
  callSave(a.rec);
  if (missed) {
    log.info(`Nieodebrany dzwonek: ${a.t.name}`);
    const at = new Date(a.rec.at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    ha?.cmd({ type: 'fire_event', event_type: 'wall_dashboard_missed_call', event_data: { trigger: a.t.id, name: a.t.name, at: new Date(a.rec.at).toISOString(), call_id: a.rec.id } }).catch(() => {});
    const svc = a.t.notify?.match(/^notify\.([\w]+)$/);
    if (svc && ha) ha.callService('notify', svc[1], { title: 'Nieodebrany dzwonek', message: `${a.t.name} – ${at}` }).catch((e: Error) => log.warn('Powiadomienie: ' + e.message));
  }
}
// ---- IVR: sound files are sent to the intercom speaker by go2rtc ("stream to camera")
function audioLength(src: string): number | undefined {
  const file = src.startsWith('sounds/') ? path.join(WEB_DIR, src) : src.startsWith('media/') ? path.join(MEDIA_DIR, path.basename(src)) : '';
  if (!file || !fs.existsSync(file)) return undefined;
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) === 'RIFF') { const rate = b.readUInt32LE(28); const i = b.indexOf('data'); return i > 0 && rate ? b.readUInt32LE(i + 4) / rate : undefined; }
  // MP3 (CBR estimate from the first frame header)
  let i = b.toString('ascii', 0, 3) === 'ID3' ? 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) : 0;
  for (; i < Math.min(b.length - 4, 200_000); i++) if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) {
    const kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][(b[i + 2] >> 4) & 15];
    if (kbps) return ((b.length - i) * 8) / (kbps * 1000);
  }
  return undefined;
}
/** Home Assistant TTS → URL of an mp3 that go2rtc can fetch */
/**
 * Polish speech from HA TTS. Without a language most engines speak with their default (often English) voice,
 * which makes Polish text sound wrong – so the language is always sent (pl, then pl-PL, then the engine default).
 */
const ttsCache = new Map<string, { url: string; at: number }>();
async function ttsUrl(text: string, engine?: string, language = 'pl', voice?: string) {
  // HA keeps generated speech in its cache: the same text gives the same URL – no waiting on the next ring
  const ck = [text, engine, language, voice].join('|');
  const hit = ttsCache.get(ck);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.url;
  const url = await ttsUrlFresh(text, engine, language, voice);
  ttsCache.set(ck, { url, at: Date.now() });
  return url;
}
async function ttsUrlFresh(text: string, engine?: string, language = 'pl', voice?: string) {
  const client = requireHa();
  const all = [...client.states.keys()].filter((e) => e.startsWith('tts.'));
  const eng = engine || all.find((e) => /_pl(_|$)|polish|polsk/i.test(e)) || all[0];
  if (!eng) throw new Error('Brak silnika TTS w Home Assistant (encja tts.*)');
  const langs = [...new Set([language, language.includes('-') ? language.split('-')[0] : `${language}-${language.toUpperCase()}`, ''])];
  let last = '';
  const tries = langs.flatMap((lang) => (voice ? [{ lang, voice }, { lang, voice: '' }] : [{ lang, voice: '' }]));
  for (const { lang, voice: v } of tries) {
    const body: Record<string, unknown> = { engine_id: eng, message: text };
    if (lang) body.language = lang;
    if (v) body.options = { voice: v };
    const r = await client.rest('/tts_get_url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return String((await r.json()).url);
    last = `${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`;
  }
  throw new Error(`TTS (${eng}): ${last}`);
}
const ttsSeconds = (text: string) => 1.5 + text.length * 0.075;
// ------------------------------------------------------------ IVR sounds with changed loudness (FFmpeg in the add-on)
// go2rtc refuses API sources with spaces, so no volume filter can go to go2rtc. The add-on renders the sound once to a
// finished WAV file (known length – go2rtc plays it like any other file) and serves it at /ivr-audio/<id>.wav.
const IVR_DIR = path.join(DATA_DIR, 'ivr-cache');
fs.mkdirSync(IVR_DIR, { recursive: true });
setInterval(() => {
  const old = Date.now() - 6 * 3600_000;
  for (const f of fs.readdirSync(IVR_DIR)) { try { if (fs.statSync(path.join(IVR_DIR, f)).mtimeMs < old) fs.unlinkSync(path.join(IVR_DIR, f)); } catch { /* gone */ } }
}, 30 * 60_000).unref();
/** PCM16 WAV in memory → same WAV with every sample multiplied (fallback without FFmpeg) */
function scaleWav(buf: Buffer, gain: number): Buffer | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let p = 12, fmtBits = 0, dataAt = -1, dataLen = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmtBits = buf.readUInt16LE(p + 8) === 1 ? buf.readUInt16LE(p + 8 + 14) : 0;
    if (id === 'data') { dataAt = p + 8; dataLen = Math.min(len, buf.length - dataAt); break; }
    p += 8 + len + (len & 1);
  }
  if (fmtBits !== 16 || dataAt < 0) return null;
  const out = Buffer.from(buf);
  for (let i = dataAt; i + 1 < dataAt + dataLen; i += 2) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf.readInt16LE(i) * gain))), i);
  return out;
}
const runFfmpeg = (args: string[], timeoutMs = 30_000) => new Promise<void>((resolve, reject) => {
  const ff = spawn('ffmpeg', args);
  let err = '';
  ff.stderr.on('data', (d) => { err = (err + String(d)).slice(-400); });
  const t = setTimeout(() => { ff.kill('SIGKILL'); reject(new Error('FFmpeg: przekroczony czas')); }, timeoutMs);
  ff.on('error', (e: any) => { clearTimeout(t); reject(e); });
  ff.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error('FFmpeg: ' + (err.trim() || 'kod ' + code))); });
});
/** returns the id of the rendered file (cached per source + loudness) */
async function ivrPrepare(url: string, vol: number): Promise<string> {
  const id = crypto.createHash('sha1').update(url + '|' + vol).digest('hex').slice(0, 20);
  const file = path.join(IVR_DIR, id + '.wav');
  if (fs.existsSync(file) && fs.statSync(file).size > 44) { fs.utimesSync(file, new Date(), new Date()); return id; }
  const gain = vol / 100;
  const tmp = file + '.part.wav';
  try {
    await runFfmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-i', url, '-vn', '-af', `volume=${gain.toFixed(2)}${vol > 100 ? ',alimiter=limit=0.95' : ''}`,
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', tmp]);
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
    // no FFmpeg (e.g. outside the add-on image): only WAV files can be scaled here
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`Pobranie dźwięku: HTTP ${r.status}`);
    const scaled = scaleWav(Buffer.from(await r.arrayBuffer()), gain);
    if (!scaled) throw new Error('Brak FFmpeg – zmiana głośności działa tylko dla plików WAV');
    fs.writeFileSync(tmp, scaled);
  }
  fs.renameSync(tmp, file);
  log.info(`IVR: przygotowano dźwięk ${vol}% (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  return id;
}
admin.get('/ivr-audio/:id.wav', (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-f0-9]{20}$/.test(id) || !fs.existsSync(path.join(IVR_DIR, id + '.wav'))) return res.status(404).end();
  res.type('audio/wav').sendFile(path.join(IVR_DIR, id + '.wav'));
});

/** plays on the intercom speaker; returns an error text (shown by the editor's test button) */
async function ivrPlay(a: ActiveCall, src: string, music = false): Promise<string | undefined> {
  const iv = a.t.ivr!;
  if (src.startsWith('tts:')) {
    try { src = await ttsUrl(src.slice(4), iv.tts, iv.ttsLanguage || 'pl', iv.ttsVoice) + '#.mp3'; } catch (e: any) { log.warn('IVR ' + e.message); return e.message; }
  }
  const stream = streamName(iv.stream || a.t.popup?.go2rtc?.stream || '');
  if (!stream) { log.warn('IVR: brak strumienia go2rtc domofonu'); return 'Brak strumienia go2rtc domofonu – ustaw go w pop-upie albo w poczekalni'; }
  const base = (iv.base || `http://127.0.0.1:${ADMIN_PORT}`).replace(/\/+$/, '');
  const file = src.endsWith('#.mp3');
  src = src.replace(/#\.mp3$/, '');
  const url = /^https?:\/\//.test(src) ? src : `${base}/${src.replace(/^\//, '')}`;
  const live = !file && /^https?:\/\//.test(src) && !/\.(mp3|wav|ogg|m4a|aac)(\?|$)/i.test(src);
  const vol = Math.max(0, Math.min(300, (music ? iv.musicVolume : iv.volume) ?? 100));
  const codec = iv.codec || 'pcmu';
  // go2rtc refuses API sources containing spaces ("source with spaces may be insecure"), so an FFmpeg volume filter
  // cannot go into the go2rtc source. For loudness ≠ 100 % the add-on serves the sound already turned up / down.
  let playUrl = url;
  if (vol !== 100 && !live) {
    // the add-on fetches the source itself – through its own address, not the one go2rtc uses
    const local = url.startsWith(base + '/') ? `http://127.0.0.1:${ADMIN_PORT}/${url.slice(base.length + 1)}` : url;
    try { playUrl = `${base}/ivr-audio/${await ivrPrepare(local, vol)}.wav`; }
    catch (e: any) { log.warn('IVR głośność: ' + e.message); return 'Głośność ' + vol + '%: ' + e.message; }
  }
  const s = `ffmpeg:${playUrl}#audio=${codec}${live ? '' : '#input=file'}`;
  a.ivr ??= { stream, playing: false };
  a.ivr.stream = stream;
  // one source at a time on the intercom speaker: stop the previous file first
  if (a.ivr.playing) await fetch(`${go2rtcBase()}/api/streams?dst=${encodeURIComponent(stream)}&src=`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => null);
  a.ivr.playing = true;
  let err: string | undefined;
  const r = await fetch(`${go2rtcBase()}/api/streams?dst=${encodeURIComponent(stream)}&src=${encodeURIComponent(s)}`, { method: 'POST', signal: AbortSignal.timeout(8000) }).catch((e) => { err = 'go2rtc: ' + e.message; return null; });
  if (r && !r.ok) err = `go2rtc: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`;
  if (err) log.warn('IVR ' + err);
  return err;
}
/** presses a button / runs a script / turns on a switch in HA */
async function pressEntity(entity: string, what: string) {
  if (!ha) return;
  const d = entity.split('.')[0];
  const press = d === 'button' || d === 'input_button';
  await ha.callService(press ? d : d === 'script' ? 'script' : d, press ? 'press' : 'turn_on', {}, { entity_id: entity }).catch((e: Error) => log.warn(`${what}: ${e.message}`));
}
/** end of an unanswered waiting room: goodbye (if set), silence, hang up */
async function ivrFinish(a: ActiveCall, bye: string) {
  const iv = a.t.ivr!;
  if (a.ivr) clearTimeout(a.ivr.timer);
  if (bye) {
    const err = await ivrPlay(a, bye);
    const len = err ? 0 : bye.startsWith('tts:') ? ttsSeconds(bye.slice(4)) : audioLength(bye) ?? 4;
    await new Promise((r) => setTimeout(r, (len + 0.8) * 1000));
  }
  ivrStop(a);
  if (iv.hangupEntity) { log.info(`IVR „${a.t.name}”: nikt nie odebrał – rozłączam domofon`); await pressEntity(iv.hangupEntity, 'IVR rozłącz'); }
  else log.info(`IVR „${a.t.name}”: nikt nie odebrał – koniec poczekalni (brak encji „rozłącz”)`);
}
/** prepares speech and louder / quieter files in advance, so the waiting room starts without delay */
async function ivrWarm(t: TriggerDef) {
  const iv = t.ivr; if (!iv || !ha?.connected) return;
  const base = `http://127.0.0.1:${ADMIN_PORT}`;
  const abs = (src: string) => (/^https?:\/\//.test(src) ? src : `${base}/${src.replace(/^\//, '')}`);
  const jobs: [string, number][] = [];
  try {
    if (iv.greetingText) jobs.push([await ttsUrl(iv.greetingText, iv.tts, iv.ttsLanguage || 'pl', iv.ttsVoice), iv.volume ?? 100]);
    if (iv.goodbyeText) jobs.push([await ttsUrl(iv.goodbyeText, iv.tts, iv.ttsLanguage || 'pl', iv.ttsVoice), iv.volume ?? 100]);
  } catch (e: any) { log.debug('IVR przygotowanie mowy: ' + e.message); }
  if (iv.greeting) jobs.push([abs(iv.greeting), iv.volume ?? 100]);
  if (iv.goodbye) jobs.push([abs(iv.goodbye), iv.volume ?? 100]);
  if (iv.music && /\.(mp3|wav|ogg|m4a|aac)(\?|$)/i.test(iv.music)) jobs.push([abs(iv.music), iv.musicVolume ?? 100]);
  for (const [url, vol] of jobs) if (vol !== 100) await ivrPrepare(url, vol).catch((e) => log.debug('IVR przygotowanie: ' + e.message));
}
const ivrWarmAll = () => { for (const t of store.data.triggers ?? []) if (t.ivr) void ivrWarm(t); };

function ivrSchedule(a: ActiveCall) {
  const iv = a.t.ivr!;
  const loop = () => {
    if (activeCalls.get(trgId(a.t)) !== a || a.rec.status !== 'ringing' || !iv.music) return;
    void ivrPlay(a, iv.music, true);
    const len = audioLength(iv.music);
    if (len && a.ivr) a.ivr.timer = setTimeout(loop, (len + 0.4) * 1000);
  };
  a.ivr = { stream: '', playing: false, timer: setTimeout(async () => {
    if (activeCalls.get(trgId(a.t)) !== a || a.rec.status !== 'ringing') return;
    log.info(`IVR „${a.t.name}”: odbieram i gram poczekalnię`);
    a.rec.ivr = true;
    if (iv.answerEntity && ha) {
      await pressEntity(iv.answerEntity, 'IVR odbierz');
      // the intercom needs a moment to open its speaker after answering – otherwise the start of the greeting is lost
      await new Promise((r) => setTimeout(r, 1000));
      if (activeCalls.get(trgId(a.t)) !== a || a.rec.status !== 'ringing') return;
    }
    const greeting = iv.greeting || (iv.greetingText ? 'tts:' + iv.greetingText : '');
    if (greeting) {
      await ivrPlay(a, greeting);
      const len = iv.greeting ? audioLength(iv.greeting) ?? 4 : ttsSeconds(iv.greetingText!);
      if (a.ivr) a.ivr.timer = setTimeout(loop, (len + 0.4) * 1000);
    } else loop();
  }, Math.max(0, iv.after ?? 8) * 1000) };
}
function ivrStop(a: ActiveCall, silence = true) {
  if (!a.ivr) return;
  clearTimeout(a.ivr.timer);
  if (silence && a.ivr.playing && a.ivr.stream) {
    fetch(`${go2rtcBase()}/api/streams?dst=${encodeURIComponent(a.ivr.stream)}&src=`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
    a.ivr.playing = false;
  }
}

// ---------------------------------------------------------------- quiet mode per panel
const hm = (v?: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
/** the quiet window active now (days = weekday on which the window starts) */
function activeWindow(q: QuietDef, d = new Date()) {
  const n = d.getHours() * 60 + d.getMinutes();
  for (const w of q.hours ?? []) {
    const a = hm(w.from), b = hm(w.to); if (!isFinite(a) || !isFinite(b) || a === b) continue;
    const today = d.getDay(), yesterday = (today + 6) % 7;
    const okDay = (day: number) => !w.days?.length || w.days.includes(day);
    if (a < b ? n >= a && n < b && okDay(today) : (n >= a && okDay(today)) || (n < b && okDay(yesterday))) {
      const end = new Date(d); end.setHours(Math.floor(b / 60), b % 60, 0, 0);
      if (end <= d) end.setDate(end.getDate() + 1);
      return +end;
    }
  }
  return undefined;
}
const inHours = (q: QuietDef) => activeWindow(q) !== undefined;
/** end of the current quiet window, ms – used when the panel switches quiet off by hand */
const quietWindowEnd = (q: QuietDef) => activeWindow(q);
function quietState(t: Tablet): QuietState {
  const q = t.quiet ?? {};
  if (q.manual && (!q.manual.until || q.manual.until > Date.now())) return { on: q.manual.on, reason: 'manual', until: q.manual.until };
  const e = q.entity ? ha?.states.get(q.entity)?.state : undefined;
  if (e === 'on') return { on: true, reason: 'entity' };
  if (inHours(q)) return { on: true, reason: 'hours', until: quietWindowEnd(q) };
  return { on: false };
}
const lastQuiet = new Map<string, string>();
function pushQuiet(t: Tablet, force = false) {
  const st = quietState(t); const key = JSON.stringify(st);
  if (!force && lastQuiet.get(t.id) === key) return;
  lastQuiet.set(t.id, key);
  for (const c of clients) if (c.tabletId === t.id) send(c, { type: 'quiet', state: { ...st, ...(t.quiet?.intercomSilent ? {} : {}) } });
}
setInterval(() => {
  for (const t of store.data.tablets) {
    // drop an expired manual switch
    if (t.quiet?.manual?.until && t.quiet.manual.until <= Date.now()) { delete t.quiet.manual; store.write(); }
    pushQuiet(t);
  }
}, 20_000).unref();

function sendWake(tablets: string[], wake: WakeOptions): number {
  const targets = tablets.map((x) => String(x).toLowerCase());
  let n = 0;
  for (const c of clients) {
    if (c.mode !== 'kiosk') continue;
    const t = c.tabletId ? store.tablet(c.tabletId) : undefined;
    if (!t || (targets.length && !targets.includes(t.id.toLowerCase()) && !targets.includes(t.name.toLowerCase()))) continue;
    if (!targets.length && t.phone) continue;
    send(c, { type: 'wake', wake }); n++;
  }
  return n;
}
function checkTriggers(entity_id: string, state: { state: string } | null) {
  const prev = lastState.get(entity_id);
  const cur = state?.state;
  if (cur == null) { lastState.delete(entity_id); return; }
  lastState.set(entity_id, cur);
  if (prev === undefined || prev === cur || cur === 'unavailable' || cur === 'unknown') return;
  for (const t of store.data.triggers ?? []) {
    if (!t.enabled || t.entity !== entity_id) continue;
    if (t.closeOn && cur === t.closeOn) { sendPopup({ id: trgId(t), action: 'close', tablets: t.tablets ?? [] }); callEnd(trgId(t), true); continue; }
    if (t.to && cur !== t.to) continue;
    if (t.from && prev !== t.from) continue;
    if (t.cooldown && Date.now() - (lastFired.get(t.id) ?? 0) < t.cooldown * 1000) continue;
    fireTrigger(t);
  }
}
function cleanTrigger(x: any): TriggerDef | null {
  if (!x || typeof x !== 'object' || !ENTITY_RE.test(String(x.entity ?? ''))) return null;
  const str = (v: unknown, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  return {
    id: str(x.id, 40) ?? newId(), name: str(x.name, 60) ?? String(x.entity), enabled: x.enabled !== false, entity: String(x.entity),
    to: str(x.to, 60), from: str(x.from, 60), action: x.action === 'wake' ? 'wake' : 'popup',
    tablets: Array.isArray(x.tablets) ? x.tablets.map(String).slice(0, 50) : [],
    popup: x.popup && typeof x.popup === 'object' ? x.popup : undefined,
    wake: x.wake && typeof x.wake === 'object' ? { screen: x.wake.screen !== false, ...(isFinite(x.wake.brightness) ? { brightness: Math.max(0, Math.min(255, Number(x.wake.brightness))) } : {}), sound: str(x.wake.sound, 500), ...(x.wake.soundLoop ? { soundLoop: true } : {}), ...(isFinite(x.wake.volume) && x.wake.volume !== null ? { volume: Math.max(0, Math.min(100, Number(x.wake.volume))) } : {}), tts: str(x.wake.tts, 300) } : undefined,
    closeOn: str(x.closeOn, 60), cooldown: isFinite(x.cooldown) && x.cooldown > 0 ? Math.min(3600, Number(x.cooldown)) : undefined,
    ...(x.log === false ? { log: false } : {}), notify: /^notify\.\w+$/.test(String(x.notify ?? '')) ? String(x.notify) : undefined,
    ivr: x.ivr && typeof x.ivr === 'object' && (x.ivr.music || x.ivr.greeting || x.ivr.greetingText) ? {
      after: isFinite(x.ivr.after) && x.ivr.after !== null ? Math.max(0, Math.min(120, Number(x.ivr.after))) : undefined,
      greeting: str(x.ivr.greeting, 500), music: str(x.ivr.music, 500), goodbye: str(x.ivr.goodbye, 500), stream: str(x.ivr.stream, 120),
      greetingText: str(x.ivr.greetingText, 400), goodbyeText: str(x.ivr.goodbyeText, 400), tts: /^tts\.\w+$/.test(String(x.ivr.tts ?? '')) ? String(x.ivr.tts) : undefined,
      ttsLanguage: /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(x.ivr.ttsLanguage ?? '')) ? String(x.ivr.ttsLanguage) : undefined,
      ttsVoice: /^[\w.\- ]{1,80}$/.test(String(x.ivr.ttsVoice ?? '')) ? String(x.ivr.ttsVoice).trim() : undefined,
      codec: ['pcmu', 'pcma', 'opus', 'aac'].includes(x.ivr.codec) ? x.ivr.codec : undefined,
      volume: isFinite(x.ivr.volume) && x.ivr.volume !== null ? Math.max(0, Math.min(300, Number(x.ivr.volume))) : undefined,
      musicVolume: isFinite(x.ivr.musicVolume) && x.ivr.musicVolume !== null ? Math.max(0, Math.min(300, Number(x.ivr.musicVolume))) : undefined,
      answerEntity: ENTITY_RE.test(String(x.ivr.answerEntity ?? '')) ? String(x.ivr.answerEntity) : undefined,
      hangupEntity: ENTITY_RE.test(String(x.ivr.hangupEntity ?? '')) ? String(x.ivr.hangupEntity) : undefined,
      hangupAfter: isFinite(x.ivr.hangupAfter) && x.ivr.hangupAfter ? Math.max(10, Math.min(600, Number(x.ivr.hangupAfter))) : undefined, base: str(x.ivr.base, 200)
    } satisfies IvrDef : undefined
  };
}
// ---------------------------------------------------------------- scenes & automations created step by step (HA config API)
const cfgId = (v: unknown) => (typeof v === 'string' && /^[a-z0-9_]{3,64}$/.test(v) ? v : 'wd_' + Date.now().toString(36));
async function haConfig(kind: 'scene' | 'automation', id: string, method: 'POST' | 'DELETE', body?: unknown) {
  const r = await requireHa().rest(`/config/${kind}/config/${encodeURIComponent(id)}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {})
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw Object.assign(new Error(`Home Assistant odrzucił zapis (${r.status}): ${t.slice(0, 200) || r.statusText}` +
      (r.status === 400 || r.status === 404 ? ` – sprawdź, czy configuration.yaml zawiera „${kind}: !include ${kind}s.yaml”` : '')), { status: 502 });
  }
  await requireHa().callService(kind, 'reload');
}
api.get('/ha/automations', (_req, res) => {
  const states = [...(ha?.states.values() ?? [])];
  res.json({
    automations: states.filter((s) => s.entity_id.startsWith('automation.')).map((s) => ({ entity_id: s.entity_id, id: s.attributes.id, name: s.attributes.friendly_name ?? s.entity_id, state: s.state, last_triggered: s.attributes.last_triggered })),
    scenes: states.filter((s) => s.entity_id.startsWith('scene.')).map((s) => ({ entity_id: s.entity_id, id: s.attributes.id, name: s.attributes.friendly_name ?? s.entity_id, entities: s.attributes.entity_id }))
  });
});
api.post('/ha/scene', asyncH(async (req, res) => {
  const b = req.body || {};
  const entities = b.entities && typeof b.entities === 'object' ? b.entities : {};
  if (!String(b.name ?? '').trim() || !Object.keys(entities).length || !Object.keys(entities).every((e) => ENTITY_RE.test(e))) throw new Error('Scena wymaga nazwy i co najmniej jednej encji');
  const id = cfgId(b.id);
  await haConfig('scene', id, 'POST', { id, name: String(b.name).trim().slice(0, 80), ...(b.icon ? { icon: String(b.icon) } : {}), entities });
  log.info(`Zapisano scenę „${b.name}” (${Object.keys(entities).length} encji)`);
  res.json({ id });
}));
api.post('/ha/scene/apply', asyncH(async (req, res) => {
  const entities = req.body?.entities;
  if (!entities || typeof entities !== 'object') throw new Error('Brak encji');
  await requireHa().callService('scene', 'apply', { entities });
  res.json({ ok: true });
}));
api.post('/ha/automation', asyncH(async (req, res) => {
  const b = req.body || {};
  if (!String(b.alias ?? '').trim() || !Array.isArray(b.triggers) || !b.triggers.length || !Array.isArray(b.actions) || !b.actions.length) throw new Error('Automatyzacja wymaga nazwy, wyzwalacza i co najmniej jednej akcji');
  const id = cfgId(b.id);
  await haConfig('automation', id, 'POST', { id, alias: String(b.alias).trim().slice(0, 100), description: String(b.description ?? 'Utworzone w Wall Dashboard'),
    mode: ['single', 'restart', 'queued', 'parallel'].includes(b.mode) ? b.mode : 'single', triggers: b.triggers, conditions: Array.isArray(b.conditions) ? b.conditions : [], actions: b.actions });
  log.info(`Zapisano automatyzację „${b.alias}”`);
  res.json({ id });
}));
api.delete('/ha/:kind/:id', asyncH(async (req, res) => {
  const kind = req.params.kind === 'scene' ? 'scene' : req.params.kind === 'automation' ? 'automation' : null;
  if (!kind) return res.status(404).end();
  await haConfig(kind, req.params.id, 'DELETE');
  res.status(204).end();
}));

// devices of an integration with their entities (for the device / purifier widgets and discovery in the editor)
api.get('/devices', asyncH(async (req, res) => {
  const client = requireHa();
  const integ = String(req.query.integration || '');
  const { areas, devices, entities } = await client.registries();
  const areaName = new Map(areas.map((a: any) => [a.area_id, a.name]));
  const byDev = new Map<string, any[]>();
  for (const e of entities) {
    if (!e.device_id || e.disabled_by || (integ && e.platform !== integ)) continue;
    byDev.set(e.device_id, [...(byDev.get(e.device_id) ?? []), e]);
  }
  res.json(devices.filter((d: any) => byDev.has(d.id)).map((d: any) => ({
    id: d.id, name: d.name_by_user || d.name || d.model || d.id, model: d.model, manufacturer: d.manufacturer, area: areaName.get(d.area_id) || undefined,
    integrations: [...new Set(byDev.get(d.id)!.map((e: any) => e.platform))],
    entities: byDev.get(d.id)!.map((e: any) => ({ entity_id: e.entity_id, key: e.translation_key || e.original_name || '', platform: e.platform, category: e.entity_category || undefined, name: client.states.get(e.entity_id)?.attributes.friendly_name ?? e.original_name ?? e.entity_id }))
  })).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'pl')));
}));

api.get('/integration-entities', asyncH(async (req, res) => {
  const platform = String(req.query.platform || '');
  const { entities } = await requireHa().registries();
  res.json(entities.filter((e: any) => e.platform === platform && !e.disabled_by).map((e: any) => e.entity_id).sort());
}));

api.get('/triggers', (_req, res) => res.json(store.data.triggers ?? []));
function callsApi(r: express.Router) {
  r.get('/calls', (_req, res) => res.json({ calls: store.data.calls ?? [], missed: missedCount() }));
  r.post('/calls/seen', (_req, res) => { for (const c of store.data.calls ?? []) c.seen = true; store.write(); callsChanged(); res.json({ ok: true }); });
  r.delete('/calls', (_req, res) => { for (const c of store.data.calls ?? []) fs.rmSync(path.join(CALLS_DIR, c.id + '.jpg'), { force: true }); store.data.calls = []; store.write(); callsChanged(); res.status(204).end(); });
  r.get('/calls/:id/snapshot', (req, res) => {
    const f = path.join(CALLS_DIR, path.basename(req.params.id) + '.jpg');
    fs.existsSync(f) ? res.set('Cache-Control', 'private, max-age=86400').type('image/jpeg').sendFile(f) : res.status(404).end();
  });
}
callsApi(api);
api.post('/ivr/test', asyncH(async (req, res) => {
  const t = cleanTrigger(req.body);
  if (!t?.ivr) throw new Error('Brak ustawień poczekalni');
  const a: ActiveCall = { rec: { id: 'test', trigger: t.id, name: t.name, at: Date.now(), status: 'ringing' }, t, test: true, timer: setTimeout(() => {}, 0) };
  const src = String(req.body?.play || t.ivr.greeting || (t.ivr.greetingText ? 'tts:' + t.ivr.greetingText : '') || t.ivr.music || '');
  if (req.body?.stop) { a.ivr = { stream: streamName(t.ivr.stream || t.popup?.go2rtc?.stream || ''), playing: true }; ivrStop(a); return res.json({ ok: true }); }
  if (!src) throw new Error('Wybierz powitanie albo muzykę');
  const err = await ivrPlay(a, src, src === t.ivr.music);
  if (err) throw new Error(err);
  res.json({ ok: true, stream: a.ivr?.stream, seconds: src.startsWith('tts:') ? undefined : audioLength(src) });
}));
api.put('/triggers', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Oczekiwano listy wyzwalaczy' });
  store.data.triggers = req.body.map(cleanTrigger).filter(Boolean) as TriggerDef[];
  store.write(); res.json(store.data.triggers);
  ivrWarmAll();
});
api.post('/triggers/test', (req, res) => {
  const t = cleanTrigger(req.body);
  if (!t) return res.status(400).json({ error: 'Wyzwalacz musi wskazywać encję' });
  const delivered = fireTrigger(t, true);
  res.json({ delivered, online: onlineTablets(), popup: t.action === 'popup' ? { timeout: 60, ...(t.popup ?? {}), id: 'trg-' + t.id } : null });
});
/** names of tablets with an open kiosk connection right now */
function onlineTablets() {
  const out = new Set<string>();
  for (const c of clients) if (c.mode === 'kiosk' && c.tabletId) out.add(store.tablet(c.tabletId)?.name ?? c.tabletId);
  return [...out];
}
api.get('/tablets-online', (_req, res) => res.json(onlineTablets()));

if (ha) {
  ha.on('snapshot', () => { for (const s of ha!.states.values()) lastState.set(s.entity_id, s.state); });
  ha.on('state', (entity_id: string, state) => checkTriggers(entity_id, state));
  ha.on('state', (entity_id: string) => { for (const t of store.data.tablets) if (t.quiet?.entity === entity_id) pushQuiet(t); });
  ha.on('state', (entity_id: string, state) => {
    if (state && isScheduleEntity(entity_id, state)) for (const c of clients) if (c.schedules) c.allowed?.add(entity_id);
    for (const c of clients) if (canSee(c, entity_id)) send(c, { type: 'state', entity_id, state });
  });
  ha.on('snapshot', () => { for (const c of clients) send(c, { type: 'states', states: visibleStates(c) }); });
  ha.on('status', (connected: boolean) => { for (const c of clients) send(c, { type: 'ha', connected }); });
  ha.on('popup', (data: any) => sendPopup(data));
  ha.on('snapshot', () => setTimeout(ivrWarmAll, 3000));
  ha.on('command', (d: any) => deviceCommand(d?.tablet ?? d?.tablets, d?.command, d?.value));
}

// ---------------------------------------------------------------- start
const adminServer = http.createServer(admin);
const kioskServer = createKioskServer();
attachWs(adminServer, 'admin');
attachWs(kioskServer, 'kiosk');
adminServer.listen(ADMIN_PORT, () => log.info(`Panel admina (ingress) na porcie ${ADMIN_PORT}`));
kioskServer.listen(KIOSK_PORT, () => log.info(`Kiosk dla tabletów na porcie ${KIOSK_PORT}`));

function shutdown() { log.info('Zamykanie'); ha?.stop(); adminServer.close(); kioskServer.close(); setTimeout(() => process.exit(0), 500).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

/** Kiosk port: plain HTTP, or HTTPS when enabled in the add-on options (needed for the microphone on tablets). */
function createKioskServer(): http.Server {
  let o: any = {};
  try { o = JSON.parse(fs.readFileSync('/data/options.json', 'utf8')); } catch { /* outside HA */ }
  if (o.ssl) {
    const dir = process.env.SSL_DIR || '/ssl';
    try {
      const srv = https.createServer({ cert: fs.readFileSync(path.join(dir, o.certfile || 'fullchain.pem')), key: fs.readFileSync(path.join(dir, o.keyfile || 'privkey.pem')) }, kiosk);
      log.info('Kiosk: HTTPS włączony');
      return srv as unknown as http.Server;
    } catch (e: any) { log.error('Nie można wczytać certyfikatu — kiosk działa po HTTP:', e.message); }
  }
  return http.createServer(kiosk);
}

function slug(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'dashboard';
}
