import type { ActionDef, PanelDef, WidgetDef } from '../../../shared/types';
import { hass } from './hass';
import { domainOf, isActive } from './format';
import { runSteps } from './setValue';

export interface ActionCtx {
  setView(id: string): void;
  setDashboard(id: string): void;
  openPanel(panel: PanelDef, widget: WidgetDef): void;
  notify(msg: string): void;
}

const TOGGLEABLE = new Set(['light', 'switch', 'input_boolean', 'fan', 'cover', 'lock', 'media_player', 'scene', 'script', 'button', 'input_button', 'automation', 'climate', 'humidifier', 'siren', 'valve', 'vacuum']);

/** Tap behaviour when a widget has no explicit `tap`. */
export function defaultTap(w: WidgetDef): ActionDef {
  if (w.tap) return w.tap;
  if (w.type === 'button' && w.entity && TOGGLEABLE.has(domainOf(w.entity))) return { type: 'toggle' };
  if (w.entity && ['value', 'temperature'].includes(w.type)) return { type: 'panel', panel: { rows: [{ entity: w.entity, display: 'auto' }] } };
  return { type: 'none' };
}

const OFFABLE = new Set(['light', 'switch', 'fan', 'input_boolean', 'media_player', 'climate', 'humidifier', 'water_heater', 'siren', 'remote']);

export function isInteractive(a: ActionDef) { return a.type !== 'none'; }

/** Toggle with the right service for each domain. */
export function toggleEntity(entity: string) {
  const d = domainOf(entity);
  const s = hass.states.get(entity)?.state;
  switch (d) {
    case 'lock': return hass.call('lock', s === 'locked' ? 'unlock' : 'lock', undefined, entity);
    case 'cover': return hass.call('cover', 'toggle', undefined, entity);
    case 'scene': case 'script': return hass.call(d, 'turn_on', undefined, entity);
    case 'button': case 'input_button': return hass.call(d, 'press', undefined, entity);
    case 'automation': return hass.call('automation', 'trigger', undefined, entity);
    case 'media_player': return hass.call('media_player', s === 'off' || s === 'standby' ? 'turn_on' : 'turn_off', undefined, entity);
    case 'climate': return hass.call('climate', 'set_hvac_mode', { hvac_mode: s === 'off' ? 'heat' : 'off' }, entity);
    case 'vacuum': return hass.call('vacuum', s === 'cleaning' ? 'return_to_base' : 'start', undefined, entity);
    default: return hass.call('homeassistant', 'toggle', undefined, entity);
  }
}

export async function runAction(a: ActionDef, w: WidgetDef, ctx: ActionCtx) {
  try {
    switch (a.type) {
      case 'none': return;
      case 'toggle': {
        const e = a.entity || w.entity;
        if (!e) return ctx.notify('Kafelek nie ma przypisanej encji');
        await toggleEntity(e);
        return;
      }
      case 'service': {
        const [domain, service] = a.service.split('.');
        if (!domain || !service) return ctx.notify('Niepoprawna usługa: ' + a.service);
        const e = a.entity || (a.data?.entity_id ? undefined : w.entity);
        await hass.call(domain, service, a.data, e);
        return;
      }
      case 'view': return ctx.setView(a.view);
      case 'dashboard': return ctx.setDashboard(a.dashboard);
      case 'panel': return ctx.openPanel(a.panel, w);
      case 'popup':
        if (!a.trigger) return ctx.notify('Wybierz wyzwalacz z pop-upem');
        if (!hass.send({ type: 'popup-open', trigger: a.trigger })) ctx.notify('Brak połączenia z add-onem');
        return;
      case 'quiet':
        if (!hass.send({ type: 'quiet', mode: a.mode || 'toggle', minutes: a.minutes })) ctx.notify('Brak połączenia z add-onem');
        return;
      case 'url': window.open(a.url, '_blank', 'noopener'); return;
      case 'set': await runSteps(a.steps || []); return;
      case 'allOff': {
        const list = [...new Set(a.entities?.length ? a.entities : [...(Array.isArray(w.options?.countOn) ? w.options!.countOn as string[] : []), ...(w.entity ? [w.entity] : [])])]
          .filter((e) => OFFABLE.has(domainOf(e)));
        if (!list.length) return ctx.notify('Brak encji do wyłączenia – dodaj je w „Licz włączone” albo w akcji');
        const on = list.filter((e) => isActive(hass.states.get(e)));
        if (on.length) { await hass.call('homeassistant', 'turn_off', undefined, on); return; }
        if (a.onIfNone) await hass.call('homeassistant', 'turn_on', undefined, list);
        return;
      }
    }
  } catch (e: any) {
    ctx.notify(e.message || 'Nie udało się wykonać akcji');
  }
}
