// Drag-to-scroll fallback for the kiosk.
// 1) Mouse / pen (large touch screens with a USB touch frame report a mouse, not touch; desktop browsers):
//    dragging a list scrolls it, like a finger does; the click after a drag is swallowed.
// 2) Touch, when the WebView does not scroll a nested list by itself (older Android WebViews, fixed side panel):
//    if the finger moves and the list did not move, the list is scrolled by hand.

const SKIP = 'input, textarea, select, [contenteditable], canvas, video, .ve-w, .ve-handle, .rmt-pad, .ic-ptt, [data-noscroll]';

function scroller(t: EventTarget | null): HTMLElement | null {
  for (let n = t as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    if (!(n instanceof HTMLElement)) continue;
    const cs = getComputedStyle(n);
    if (cs.touchAction === 'none') return null; // sliders, dials, pads handle the drag themselves
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 2) return n;
  }
  return null;
}

export function installDragScroll() {
  // ---- mouse / pen
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target || target.closest?.(SKIP)) return;
    const el = scroller(target);
    if (!el) return;
    const y0 = e.clientY, top0 = el.scrollTop;
    let dragging = false;
    const move = (m: PointerEvent) => {
      const dy = y0 - m.clientY;
      if (!dragging && Math.abs(dy) < 8) return;
      dragging = true;
      el.scrollTop = top0 + dy;
      m.preventDefault();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      if (dragging) {
        // the release after a drag is not a tap
        const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 50);
      }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }, true);

  // ---- touch fallback (only when the WebView itself did not scroll)
  // native scrolling updates scrollTop asynchronously, so the decision waits a moment after the finger starts moving
  let t: { el: HTMLElement; y0: number; y: number; top0: number; manual: boolean; check?: ReturnType<typeof setTimeout> } | null = null;
  const stopT = () => { if (t?.check) clearTimeout(t.check); t = null; };
  window.addEventListener('touchstart', (e) => {
    stopT();
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (!target || target.closest?.(SKIP)) return;
    const el = scroller(target);
    if (el) t = { el, y0: e.touches[0].clientY, y: e.touches[0].clientY, top0: el.scrollTop, manual: false };
  }, { passive: true, capture: true });
  window.addEventListener('touchmove', (e) => {
    if (!t || e.touches.length !== 1) { stopT(); return; }
    const y = e.touches[0].clientY;
    if (t.manual) { t.el.scrollTop += t.y - y; t.y = y; return; }
    t.y = y;
    if (t.check || Math.abs(t.y0 - y) < 16) return;
    const cur = t;
    cur.check = setTimeout(() => {
      if (t !== cur) return;
      const dy = cur.y0 - cur.y;
      const canMove = dy > 0 ? cur.el.scrollTop < cur.el.scrollHeight - cur.el.clientHeight - 1 : cur.el.scrollTop > 0;
      if (cur.el.scrollTop !== cur.top0 || !canMove || Math.abs(dy) < 16) { t = null; return; } // native scrolling works
      cur.manual = true;
      cur.el.scrollTop = cur.top0 + dy;
    }, 150);
  }, { passive: true, capture: true });
  const end = () => { if (t && !t.manual) stopT(); else t = null; };
  window.addEventListener('touchend', end, { passive: true, capture: true });
  window.addEventListener('touchcancel', end, { passive: true, capture: true });
}
