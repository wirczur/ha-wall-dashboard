import { useEffect, useState } from 'react';
import type { HouseDef } from '../../../shared/types';
import { api } from '../lib/api';
import { boot } from '../lib/boot';
import { hass } from '../lib/hass';

/** Houses known to this page. Kiosk: delivered with the kiosk payload. Admin: fetched on demand. */
const houses = new Map<string, HouseDef>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setHouses(list: HouseDef[]) { houses.clear(); for (const h of list) if (h) houses.set(h.id, h); emit(); }
export function putHouse(h: HouseDef) { houses.set(h.id, h); emit(); }

const inflight = new Map<string, Promise<void>>();
function fetchHouse(id: string) {
  if (boot.mode !== 'admin') return;
  if (!inflight.has(id)) inflight.set(id, api.get<HouseDef>('houses/' + encodeURIComponent(id)).then(putHouse).catch(() => {}).finally(() => inflight.delete(id)));
}
if (boot.mode === 'admin') hass.onDashboardsChanged(() => { for (const id of [...houses.keys()]) { houses.delete(id); fetchHouse(id); } });

export function useHouse(id?: string): HouseDef | undefined {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  useEffect(() => { if (id && !houses.has(id)) fetchHouse(id); }, [id]);
  return id ? houses.get(id) : undefined;
}
