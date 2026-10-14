import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { KioskApp } from './kiosk/KioskApp';
import { boot } from './lib/boot';
import { installDragScroll } from './lib/dragScroll';
import './styles.css';

// The admin UI (editors, three.js house editor) is a separate chunk, so tablets only load the viewer.
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));

document.documentElement.dataset.mode = boot.mode;
if (boot.mode === 'kiosk') installDragScroll();
createRoot(document.getElementById('root')!).render(
  boot.mode === 'kiosk'
    ? <KioskApp />
    : <Suspense fallback={<div className="msg"><div className="msg-box"><h1>Ładowanie…</h1></div></div>}><AdminApp /></Suspense>
);
