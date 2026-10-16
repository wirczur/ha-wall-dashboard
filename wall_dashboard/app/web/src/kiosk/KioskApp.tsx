import { useCallback, useEffect, useState, type FC } from 'react';
import type { DashboardDoc, HouseDef, ScreenDef, TvApp } from '../../../shared/types';
import { configureApp, isWallApp } from '../lib/device';
import { SaverFeed } from './SaverFeed';
import { setTvs } from '../remote/Remote';
import { setHouses } from '../house/houseStore';
import { api } from '../lib/api';
import { boot } from '../lib/boot';
import { hass } from '../lib/hass';
import { DashboardView } from '../view/DashboardView';
import { PopupHost } from './Popup';
import { QuietBadge } from './QuietBadge';
import { IntercomHost } from '../widgets/intercom';
import { useIntercom, type IcConfig } from '../lib/intercom';
import { sip, useSip, type SipConfig } from '../lib/sip';

interface KioskData { tablet: { id: string; name: string; screen?: ScreenDef; appPin?: string; lite?: boolean; layout?: 'grid' | 'stack'; intercom?: boolean; intercomCfg?: IcConfig }; sip?: SipConfig; dashboards: DashboardDoc[]; houses: HouseDef[]; tvs: { id: string; name: string; apps: TvApp[] }[] }

/** Tablet mode: shows the assigned dashboard, no settings. */
export const KioskApp: FC = () => {
  const [data, setData] = useState<KioskData | null>(null);
  const [current, setCurrent] = useState<string>('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get<KioskData>('kiosk').then((d) => {
      document.documentElement.dataset.lite = d.tablet.lite ? '1' : '0';
      document.documentElement.dataset.layout = d.tablet.layout ?? 'auto';
      configureApp({ tablet: d.tablet.name, screen: d.tablet.screen, pin: d.tablet.appPin });
      setHouses(d.houses || []); setTvs(d.tvs || []); setData(d); setError('');
      sip.start(d.sip);
      setCurrent((c) => (d.dashboards.some((x) => x.id === c) ? c : d.dashboards[0]?.id || ''));
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!boot.key) return;
    hass.start();
    load();
    const off = hass.onDashboardsChanged(() => load());
    // keep the screen awake where the browser allows it (Fully Kiosk handles this itself)
    let lock: any;
    const wake = () => (navigator as any).wakeLock?.request('screen').then((l: any) => { lock = l; }).catch(() => {});
    wake();
    const vis = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', vis);
    return () => { off(); document.removeEventListener('visibilitychange', vis); lock?.release?.(); };
  }, [load]);

  // during a call the dashboard behind is unmounted (cameras, 3D, animations stop) – a weak panel (PX30) needs the CPU for audio
  const ic = useIntercom().phase;
  const sp = useSip();
  const paused = !!data && (ic === 'connecting' || ic === 'active' || sp.inCall || (!!data.tablet.lite && (ic === 'incoming' || ic === 'outgoing' || sp.ringing)));
  useEffect(() => { document.documentElement.dataset.call = paused ? '1' : '0'; }, [paused]);
  if (!boot.key) return <Message title="Nieprawidłowy klucz tabletu" text="Ten link nie jest (lub już nie jest) przypisany do żadnego tabletu. Skopiuj aktualny link z panelu Wall Dashboard w Home Assistant." />;
  if (error && !data) return <Message title="Nie udało się wczytać dashboardu" text={error} />;
  if (!data) return <Message title="Ładowanie…" text="" />;
  const doc = data.dashboards.find((d) => d.id === current);
  if (!doc) return <Message title="Brak dashboardu" text={`Tablet „${data.tablet.name}” nie ma przypisanego dashboardu. Przypisz go w panelu Wall Dashboard.`} />;
  return <>
    {!paused && <DashboardView key={doc.id} doc={doc} onDashboard={(id) => {
      if (data.dashboards.some((d) => d.id === id)) setCurrent(id);
    }} />}
    {isWallApp() && <SaverFeed clock={data.tablet.screen?.clock} />}
    <PopupHost />
    <QuietBadge />
    {data.tablet.intercom !== false && <IntercomHost cfg={data.tablet.intercomCfg} />}
  </>;
};

const Message: FC<{ title: string; text: string }> = ({ title, text }) => (
  <div className="msg"><div className="msg-box"><h1>{title}</h1>{text && <p>{text}</p>}</div></div>
);
