import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DashboardDoc, StoreData, Tablet } from '../shared/types.js';
import { seedDashboard } from './seed.js';
import { log } from './log.js';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
const FILE = path.join(DATA_DIR, 'store.json');

export const newId = () => crypto.randomBytes(5).toString('hex');
export const newKey = () => crypto.randomBytes(18).toString('base64url');

export class Store {
  data: StoreData;

  constructor() {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (raw && raw.dashboards && Array.isArray(raw.tablets)) {
        raw.settings ??= { kioskBase: '' };
        raw.houses ??= {};
        raw.tvs ??= [];
        return raw as StoreData;
      }
    } catch (e: any) {
      if (e.code !== 'ENOENT') log.error('Nie można odczytać store.json — tworzę nowy', e.message);
    }
    const d = seedDashboard();
    const data: StoreData = {
      version: 1,
      dashboards: { [d.id]: d },
      tablets: [{ id: newId(), name: 'Tablet 1', key: newKey(), dashboards: [d.id] }],
      settings: { kioskBase: '' },
      houses: {},
      tvs: []
    };
    this.write(data);
    log.info('Utworzono startowy dashboard "Mój dashboard" i tablet "Tablet 1"');
    return data;
  }

  write(data: StoreData = this.data) {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    // keep the previous version next to the data file (store.json.bak)
    try { if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak'); } catch { /* ignore */ }
    fs.renameSync(tmp, FILE);
  }

  // dashboards
  list() {
    return Object.values(this.data.dashboards).map((d) => ({
      id: d.id, title: d.title, views: d.views.length,
      widgets: d.views.reduce((n, v) => n + v.widgets.length, 0)
    }));
  }
  get(id: string): DashboardDoc | undefined { return this.data.dashboards[id]; }
  put(doc: DashboardDoc) { this.data.dashboards[doc.id] = doc; this.write(); }
  remove(id: string) {
    delete this.data.dashboards[id];
    for (const t of this.data.tablets) t.dashboards = t.dashboards.filter((d) => d !== id);
    this.write();
  }

  // tablets
  tabletByKey(key: string): Tablet | undefined {
    if (!key) return undefined;
    const a = Buffer.from(key);
    return this.data.tablets.find((t) => {
      const b = Buffer.from(t.key);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
  }
  tablet(id: string) { return this.data.tablets.find((t) => t.id === id); }
}
