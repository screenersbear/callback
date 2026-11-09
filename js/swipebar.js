// The bottom bar on a phone: one button that slides through the sections.
//
// The section you're in sits in the middle as its icon, no words, with a
// little triangle on each side that has another section. Swipe along the
// bar to the left and the page slides off that way while the next section
// comes in from the right; swipe to the right to go back. A tap on a
// triangle does the same, and a tap on the icon goes to the top of its
// section, the way its tab did. Wide windows keep the rail of tabs.

const phone = matchMedia('(max-width: 899px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const STEP = 46; // px from one icon to the next on the strip
const OUT_MS = 190;
const IN_MS = 260;

const S = {
  bar: null,
  tabs: [],
  idx: 0,
  strip: null,
  now: null,
  prev: null,
  next: null,
  drag: null,
  busy: false,
  enter: 0,
  exit: null,
  dragged: 0,
};

const tri = '<svg viewBox="0 0 10 12" aria-hidden="true"><path d="M2.3 1.5Q5.6 3.8 8.7 6.1 5.5 8.3 2.2 10.5 2.5 6 2.3 1.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const view = () => document.getElementById('view');

function build() {
  if (S.bar) return true;
  const bar = document.getElementById('tabbar');
  if (!bar) return false;
  S.bar = bar;
  S.tabs = [...bar.querySelectorAll('.tab')].map((a) => ({
    key: a.dataset.tab,
    href: a.getAttribute('href'),
    name: (a.querySelector('.tab-label') || a).textContent.trim(),
    icon: (a.querySelector('.tab-icon') || a).innerHTML,
  }));
  const el = document.createElement('div');
  el.className = 'slider';
  el.innerHTML = `<button type="button" class="slide-arrow is-prev">${tri}</button>`
    + `<a class="slide-now" href="${S.tabs[0].href}"><span class="slide-strip" aria-hidden="true">${S.tabs.map((t) => `<span class="slide-icon tab-icon">${t.icon}</span>`).join('')}</span></a>`
    + `<button type="button" class="slide-arrow is-next">${tri}</button>`;
  bar.appendChild(el);
  S.strip = el.querySelector('.slide-strip');
  S.now = el.querySelector('.slide-now');
  S.prev = el.querySelector('.is-prev');
  S.next = el.querySelector('.is-next');
  S.prev.addEventListener('click', () => go(-1));
  S.next.addEventListener('click', () => go(1));
  wire(bar);
  return true;
}

// Where the strip sits: the section's icon in the window, nudged by `x`
// pixels of page (a whole screen width is one icon).
function stripTo(i, x = 0, moving = false) {
  S.strip.classList.toggle('is-moving', moving);
  const w = window.innerWidth || 1;
  // Flat (2D), so iOS paints it whole inside the window's faded edges.
  S.strip.style.transform = `translateX(${(-i * STEP + (x / w) * STEP).toFixed(1)}px)`;
}

function label() {
  const t = S.tabs[S.idx];
  const p = S.tabs[S.idx - 1];
  const n = S.tabs[S.idx + 1];
  S.now.setAttribute('href', t.href);
  S.now.setAttribute('aria-label', t.name);
  S.now.setAttribute('aria-current', 'page');
  S.prev.classList.toggle('is-off', !p);
  S.next.classList.toggle('is-off', !n);
  S.prev.disabled = !p;
  S.next.disabled = !n;
  S.prev.setAttribute('aria-label', p ? `Previous: ${p.name}` : 'Nothing before this');
  S.next.setAttribute('aria-label', n ? `Next: ${n.name}` : 'Nothing after this');
}

// Called by the app after each page is drawn, with the section it's in.
export function updateSwipeBar(tab) {
  if (!build()) return;
  const i = S.tabs.findIndex((t) => t.key === tab);
  if (i >= 0) S.idx = i;
  label();
  const v = view();
  if (S.enter && v) {
    // Came here by sliding: the new page comes in from that side.
    const from = S.enter * (window.innerWidth || 1);
    S.enter = 0;
    clearTimeout(S.enterLate);
    if (S.exit) S.exit.cancel();
    S.exit = null;
    stripTo(S.idx, 0, false);
    v.animate([{ transform: `translate3d(${from}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }], { duration: IN_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    // Free to swipe again once it's mostly in.
    setTimeout(() => { S.busy = false; }, IN_MS * 0.6);
  } else if (!S.drag && !S.busy) stripTo(S.idx);
}

// Off to the next (1) or previous (-1) section, the page sliding away from
// where it's been dragged to (`from`, in px).
function go(dir, from = 0) {
  const t = S.tabs[S.idx + dir];
  const v = view();
  if (!t || S.busy || !v) return;
  if (reduced.matches) {
    location.hash = t.href;
    return;
  }
  S.busy = true;
  const w = window.innerWidth || 1;
  stripTo(S.idx + dir, 0, true);
  v.style.transform = '';
  const ms = OUT_MS * (1 - Math.min(0.6, Math.abs(from) / w));
  S.exit = v.animate([{ transform: `translate3d(${from}px, 0, 0)` }, { transform: `translate3d(${-dir * w}px, 0, 0)` }], { duration: ms, easing: 'cubic-bezier(0.4, 0, 0.9, 0.6)', fill: 'forwards' });
  // On when it's slid off, or a moment after if the phone held the
  // animation up (put away mid-swipe).
  let gone = false;
  const off = () => {
    if (gone) return;
    gone = true;
    S.enter = dir;
    // If the page doesn't change after all, put it back.
    S.enterLate = setTimeout(() => {
      if (!S.enter) return;
      S.enter = 0;
      if (S.exit) S.exit.cancel();
      S.exit = null;
      S.busy = false;
      stripTo(S.idx);
    }, 700);
    location.hash = t.href;
  };
  S.exit.onfinish = off;
  setTimeout(off, ms + 120);
}

// Back to where it was, dragged not far enough.
function settle(from) {
  const v = view();
  stripTo(S.idx, 0, true);
  if (!v || !from) {
    if (v) v.style.transform = '';
    return;
  }
  v.style.transform = '';
  v.animate([{ transform: `translate3d(${from}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
}

function wire(bar) {
  bar.addEventListener('pointerdown', (e) => {
    if (!phone.matches || S.busy || e.button) return;
    S.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, x: 0, v: 0, t: performance.now(), lx: e.clientX };
  });
  bar.addEventListener('pointermove', (e) => {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        S.drag = null;
        return;
      }
      d.moved = true;
      try { bar.setPointerCapture(e.pointerId); } catch { /* fine */ }
    }
    const now = performance.now();
    d.v = (e.clientX - d.lx) / Math.max(1, now - d.t);
    d.lx = e.clientX;
    d.t = now;
    // Nothing that way: it gives a little, then stops.
    const has = S.tabs[S.idx + (dx < 0 ? 1 : -1)];
    const w = window.innerWidth || 1;
    d.x = has ? dx : (dx * 0.3) / (1 + Math.abs(dx) / w);
    const v = view();
    if (v) v.style.transform = `translate3d(${d.x.toFixed(1)}px, 0, 0)`;
    stripTo(S.idx, d.x);
  });
  const end = (e) => {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    S.drag = null;
    if (!d.moved) return;
    S.dragged = performance.now();
    const w = window.innerWidth || 1;
    const dir = d.x < 0 ? 1 : -1;
    const flick = Math.abs(d.v) > 0.45 && Math.sign(d.v) === Math.sign(d.x) && Math.abs(d.x) > 24;
    if (e.type === 'pointerup' && S.tabs[S.idx + dir] && (Math.abs(d.x) > w * 0.25 || flick)) go(dir, d.x);
    else settle(d.x);
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  // A swipe that ends on the icon isn't a tap on it.
  bar.addEventListener('click', (e) => {
    if (performance.now() - S.dragged < 350) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

// For tests.
export function swipeBarInfo() {
  return { idx: S.idx, tab: S.tabs[S.idx] && S.tabs[S.idx].key, prev: !S.prev?.disabled, next: !S.next?.disabled, busy: S.busy, strip: S.strip && S.strip.style.transform };
}
