import { ENTITY_RE } from '../shared/types.js';
import { templateEntities } from '../shared/template.js';
/** Service domains a kiosk may call (only on entities that appear in its dashboards). */
const KIOSK_DOMAINS = new Set([
    'homeassistant', 'remote', 'light', 'switch', 'input_boolean', 'cover', 'climate', 'fan', 'lock', 'media_player',
    'scene', 'script', 'button', 'input_button', 'input_number', 'input_select', 'select', 'number', 'input_text', 'text', 'input_datetime',
    'vacuum', 'valve', 'humidifier', 'water_heater', 'siren', 'alarm_control_panel', 'lawn_mower',
    // custom integrations with their own widgets: Simple Timer, Rain Bird IQ4
    'simple_timer', 'rainbird_iq4', 'scheduler',
    // Grenton: only the thermostat week; ONVIF: only pan / tilt / zoom (see checkKioskCall)
    'grenton', 'onvif'
]);
/** Collects every entity id referenced anywhere in a dashboard (widgets, panels, actions). */
export function entitiesOf(doc) {
    const out = new Set();
    const walk = (v) => {
        if (typeof v === 'string') {
            if (ENTITY_RE.test(v))
                out.add(v);
            else
                templateEntities(v).forEach((e) => out.add(e));
            return;
        }
        if (Array.isArray(v)) {
            v.forEach(walk);
            return;
        }
        if (v && typeof v === 'object')
            for (const x of Object.values(v))
                walk(x);
    };
    for (const view of doc.views)
        walk(view.widgets);
    return out;
}
/** House ids used by "house3d" widgets of a dashboard. */
export function housesOf(doc) {
    return doc.views.flatMap((v) => v.widgets.filter((w) => w.type === 'house3d' && w.options?.house).map((w) => String(w.options.house)));
}
/** TV ids used by remote widgets and by panels that show a remote. */
export function tvsOf(doc) {
    const out = [];
    const walk = (v) => {
        if (Array.isArray(v)) {
            v.forEach(walk);
            return;
        }
        if (!v || typeof v !== 'object')
            return;
        if (v.type === 'remote' && v.options?.tv)
            out.push(String(v.options.tv));
        if (typeof v.remote === 'string')
            out.push(v.remote);
        for (const x of Object.values(v))
            walk(x);
    };
    for (const view of doc.views)
        walk(view.widgets);
    return out;
}
export function kioskScope(store, tablet) {
    const dashboards = tablet.dashboards.filter((id) => store.get(id));
    const entities = new Set();
    const houses = new Set();
    const tvs = new Set();
    const walk = (v) => {
        if (typeof v === 'string') {
            if (ENTITY_RE.test(v))
                entities.add(v);
            else
                templateEntities(v).forEach((e) => entities.add(e));
            return;
        }
        if (Array.isArray(v)) {
            v.forEach(walk);
            return;
        }
        if (v && typeof v === 'object')
            for (const x of Object.values(v))
                walk(x);
    };
    for (const id of dashboards) {
        const doc = store.get(id);
        for (const e of entitiesOf(doc))
            entities.add(e);
        for (const h of housesOf(doc))
            houses.add(h);
        for (const t of tvsOf(doc))
            tvs.add(t);
    }
    for (const h of houses) {
        const house = store.data.houses[h];
        if (!house) {
            houses.delete(h);
            continue;
        }
        walk(house.devices);
        for (const l of house.levels) {
            walk(l.rooms);
            walk(l.gates);
            walk(l.stairs);
        }
        for (const d of house.devices)
            if (d.remote)
                tvs.add(d.remote);
    }
    // a Home Assistant remote also needs its media_player (same object id) for power / state / sources
    for (const e of [...entities, ...tvs]) {
        if (/^(remote|media_player)\.[a-z0-9_]+$/.test(e)) {
            const obj = e.split('.')[1];
            entities.add(e);
            entities.add('remote.' + obj);
            entities.add('media_player.' + obj);
        }
    }
    // values shown on the dark-screen clock (Android app)
    for (const e of tablet.screen?.clock?.entities ?? [])
        if (ENTITY_RE.test(e.entity))
            entities.add(e.entity);
    // a "schedules" widget lists every scheduler entity, including ones created later from the tablet
    const schedules = dashboards.some((id) => store.get(id).views.some((v) => v.widgets.some((w) => w.type === 'schedules')));
    return { dashboards, entities, houses: [...houses], tvs, schedules };
}
/** Throws if a kiosk is not allowed to make this call. */
export function checkKioskCall(call, allowed, opts = {}) {
    if (!KIOSK_DOMAINS.has(call.domain))
        throw new Error(`Usługa ${call.domain}.${call.service} nie jest dostępna z kiosku`);
    if (call.domain === 'onvif' && call.service !== 'ptz')
        throw new Error(`Usługa onvif.${call.service} nie jest dostępna z kiosku`);
    if (call.domain === 'grenton' && call.service !== 'set_thermostat_schedule')
        throw new Error(`Usługa grenton.${call.service} nie jest dostępna z kiosku`);
    if (call.domain === 'alarm_control_panel' && /disarm/.test(call.service) && !opts.allowDisarm)
        throw new Error('Rozbrajanie alarmu z tego tabletu jest wyłączone (Tablety → „Może rozbrajać alarm”)');
    const ids = new Set();
    const add = (v) => {
        if (typeof v === 'string')
            ids.add(v);
        else if (Array.isArray(v))
            v.forEach(add);
    };
    add(call.target?.entity_id);
    add(call.data?.entity_id);
    add(call.data?.group_members);
    // integrations that name their target in their own field (Rain Bird IQ4)
    add(call.data?.station_entity);
    add(call.data?.program_entity);
    add(call.data?.controller_entity);
    // scheduler.add / edit name their entities inside timeslots
    if (call.domain === 'scheduler')
        for (const ts of (call.data?.timeslots ?? []))
            for (const a of ts?.actions ?? [])
                add(a?.entity_id);
    if (ids.size === 0)
        throw new Error('Wywołanie z kiosku musi wskazywać encję');
    for (const id of ids)
        if (!allowed.has(id))
            throw new Error(`Encja ${id} nie należy do dashboardu tego tabletu`);
}
/** Trigger ids whose pop-up a tile of this dashboard can open (action "popup"). */
export function popupTriggersOf(doc) {
    const out = [];
    const walk = (v) => {
        if (Array.isArray(v)) {
            v.forEach(walk);
            return;
        }
        if (!v || typeof v !== 'object')
            return;
        if (v.type === 'popup' && typeof v.trigger === 'string')
            out.push(v.trigger);
        for (const x of Object.values(v))
            walk(x);
    };
    for (const view of doc.views)
        walk(view.widgets);
    return out;
}
/** "rtsp://host:8554/furtka" or "furtka" → "furtka" */
export const streamName = (v) => String(v ?? '').trim().replace(/^[a-z]+:\/\/[^/]+\//i, '').split(/[?#]/)[0];
/** go2rtc stream names used by camera widgets of a dashboard. */
export function streamsOf(doc) {
    const out = [];
    const walk = (v) => {
        if (Array.isArray(v)) {
            v.forEach(walk);
            return;
        }
        if (!v || typeof v !== 'object')
            return;
        if (v.type === 'camera' && v.options?.provider === 'go2rtc' && v.options?.stream)
            out.push(streamName(v.options.stream));
        if (v.type === 'camera' && v.options?.provider === 'go2rtc' && v.options?.liteStream)
            out.push(streamName(v.options.liteStream));
        // a tile that opens a trigger pop-up may need that pop-up's streams – handled by the pop-up itself (extra scope)
        for (const x of Object.values(v))
            walk(x);
    };
    for (const view of doc.views)
        walk(view.widgets);
    return out;
}
