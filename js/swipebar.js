// The bottom bar on a phone: one button that slides through the sections.
// Wide windows (the Mac app) keep the rail of tabs down the side.
//
// The section you're in sits in the middle as its icon, no words, with a
// little triangle on each side that has another section. Swipe along the
// bar to the left and the page slides off that way with the next section
// drawn right beside it, coming in from the right as one strip (no gap
// between them); swipe to the right to go back (a sideways scroll over the
// bar does the same, for a trackpad on a narrow window). A tap on a triangle
// does the same, and a tap on the icon goes to the top of its section, the
// way its tab did.
//
// Circles and Organizations live under People (11-10): their tabs carry
// data-under="people", so they're left out of the slide and drawn as their
// icons either side of it instead, Circles on the left and Organizations on
// the right, shown while you're in People. On one of them the middle is
// still People, so a tap there goes back, and a swipe goes on to the
// sections either side of People as usual.
//
// The page next door (a "peek") is drawn by the app (setSwipePeek) into a
// layer of its own beside this one; once it's slid all the way in, the app
// goes there for real and the layer is taken away in the same moment.

const phone = matchMedia('(max-width: 899px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const STEP = 46; // px from one icon to the next on the strip
const SLIDE_MS = 260;
// How far the page has to be swiped to go over: a quarter of a phone's
// screen, and no further than this on a big window.
const far = (w) => Math.min(w * 0.25, 180);

const S = {
  bar: null,
  tabs: [],
  under: [],
  sides: [],
  sub: null,
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
  peek: null,
  peekDir: 0,
  wheel: null,
};
let makePeek = null;

// The app hands over how to draw a section into a peek: fn(key, page).
export function setSwipePeek(fn) {
  makePeek = fn;
}

// The section `dir` away (1 the next, -1 the one before) drawn beside this
// page, ready to slide in.
function peekFor(dir) {
  if (S.peek && S.peekDir === dir) return S.peek;
  dropPeek();
  const t = S.tabs[S.idx + dir];
  if (!t || !makePeek) return null;
  const el = document.createElement('div');
  el.className = 'peek';
  el.setAttribute('aria-hidden', 'true');
  el.inert = true;
  el.style.transform = `translate3d(${dir * (window.innerWidth || 1)}px, 0, 0)`;
  el.style.right = 'auto';
  el.style.width = `${window.innerWidth || 1}px`;
  const page = document.createElement('div');
  page.className = 'peek-app';
  el.appendChild(page);
  document.body.appendChild(el);
  S.peek = el;
  S.peekDir = dir;
  try { makePeek(t.key, page); } catch (err) { console.error(err); }
  // Where scroll bars are always shown (a Mac with a mouse), a page taller
  // than the window will have one once it's there: drawn that much
  // narrower, so it lines up with itself.
  const sb = scrollBarWidth();
  if (sb && page.offsetHeight > el.clientHeight) el.style.width = `${(window.innerWidth || 1) - sb}px`;
  return el;
}
function scrollBarWidth() {
  const d = document.createElement('div');
  d.style.cssText = 'position: absolute; top: -200px; width: 100px; height: 100px; overflow: scroll; visibility: hidden;';
  document.body.appendChild(d);
  const w = d.offsetWidth - d.clientWidth;
  d.remove();
  return w;
}
function dropPeek() {
  if (S.peek) S.peek.remove();
  S.peek = null;
  S.peekDir = 0;
}

const tri = '<svg viewBox="0 0 10 12" aria-hidden="true"><path d="M2.3 1.5Q5.6 3.8 8.7 6.1 5.5 8.3 2.2 10.5 2.5 6 2.3 1.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
const view = () => document.getElementById('view');
// While a page is slid aside it hangs off the edge of the screen; clipped
// (style.css), so the page never gets wider than the screen (the width
// jumped and the two pages came apart).
const sliding = (on) => document.documentElement.classList.toggle('is-swiping', on);

function build() {
  if (S.bar) return true;
  const bar = document.getElementById('tabbar');
  if (!bar) return false;
  S.bar = bar;
  const all = [...bar.querySelectorAll('.tab')].map((a) => ({
    key: a.dataset.tab,
    href: a.getAttribute('href'),
    name: (a.querySelector('.tab-label') || a).textContent.trim(),
    icon: (a.querySelector('.tab-icon') || a).innerHTML,
    under: a.dataset.under || null,
  }));
  S.tabs = all.filter((t) => !t.under);
  S.under = all.filter((t) => t.under);
  const side = (t) => (t ? `<a class="slide-side tab-icon is-off" href="${t.href}" data-key="${t.key}" aria-label="${t.name}" title="${t.name}" tabindex="-1">${t.icon}</a>` : '');
  const el = document.createElement('div');
  el.className = 'slider';
  el.innerHTML = side(S.under[0])
    + `<button type="button" class="slide-arrow is-prev">${tri}</button>`
    + `<a class="slide-now" href="${S.tabs[0].href}"><span class="slide-strip" aria-hidden="true">${S.tabs.map((t) => `<span class="slide-icon tab-icon">${t.icon}</span>`).join('')}</span></a>`
    + `<button type="button" class="slide-arrow is-next">${tri}</button>`
    + side(S.under[1]);
  bar.appendChild(el);
  S.sides = [...el.querySelectorAll('.slide-side')];
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
  S.now.setAttribute('aria-label', S.sub ? `Back to ${t.name}` : t.name);
  if (S.sub) S.now.removeAttribute('aria-current');
  else S.now.setAttribute('aria-current', 'page');
  // Circles and Organizations, either side, while you're in their section.
  for (const a of S.sides) {
    const u = S.under.find((x) => x.key === a.dataset.key);
    const here = !!u && u.under === t.key;
    a.classList.toggle('is-off', !here);
    a.tabIndex = here ? 0 : -1;
    a.setAttribute('aria-hidden', String(!here));
    a.classList.toggle('is-on', S.sub === a.dataset.key);
    if (S.sub === a.dataset.key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  S.prev.classList.toggle('is-off', !p);
  S.next.classList.toggle('is-off', !n);
  S.prev.disabled = !p;
  S.next.disabled = !n;
  S.prev.setAttribute('aria-label', p ? `Previous: ${p.name}` : 'Nothing before this');
  S.next.setAttribute('aria-label', n ? `Next: ${n.name}` : 'Nothing after this');
  // Named when the pointer rests on them (Mac).
  S.now.title = t.name;
  S.prev.title = p ? p.name : '';
  S.next.title = n ? n.name : '';
}

// Called by the app after each page is drawn, with the section it's in.
export function updateSwipeBar(tab) {
  if (!build()) return;
  // On Circles or Organizations the bar stands at People.
  const sub = S.under.find((u) => u.key === tab);
  S.sub = sub ? sub.key : null;
  const i = S.tabs.findIndex((t) => t.key === (sub ? sub.under : tab));
  if (i >= 0) S.idx = i;
  label();
  if (S.enter) {
    // Came here by sliding: the page is drawn where its peek was, so the
    // peek goes and the page is put back in place in the same moment.
    S.enter = 0;
    clearTimeout(S.enterLate);
    if (S.exit) S.exit.cancel();
    S.exit = null;
    dropPeek();
    stripTo(S.idx, 0, false);
    S.busy = false;
    sliding(false);
  } else if (!S.drag && !S.wheel && !S.busy) stripTo(S.idx);
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
  sliding(true);
  const w = window.innerWidth || 1;
  const p = peekFor(dir);
  stripTo(S.idx + dir, 0, true);
  v.style.transform = '';
  const ms = SLIDE_MS * (1 - 0.5 * Math.min(1, Math.abs(from) / w));
  const ease = 'cubic-bezier(0.25, 0.6, 0.3, 1)';
  S.exit = v.animate([{ transform: `translate3d(${from}px, 0, 0)` }, { transform: `translate3d(${-dir * w}px, 0, 0)` }], { duration: ms, easing: ease, fill: 'forwards' });
  if (p) {
    p.style.transform = '';
    p.animate([{ transform: `translate3d(${dir * w + from}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }], { duration: ms, easing: ease, fill: 'forwards' });
  }
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
      dropPeek();
      S.busy = false;
      sliding(false);
      stripTo(S.idx);
    }, 700);
    location.hash = t.href;
  };
  S.exit.onfinish = off;
  setTimeout(off, ms + 120);
}

// Back to where it was, dragged not far enough: the peek slides back out.
function settle(from) {
  const v = view();
  stripTo(S.idx, 0, true);
  const p = S.peek;
  const dir = S.peekDir;
  S.peek = null;
  S.peekDir = 0;
  if (p) {
    const w = window.innerWidth || 1;
    p.style.transform = '';
    const a = p.animate([{ transform: `translate3d(${dir * w + from}px, 0, 0)` }, { transform: `translate3d(${dir * w}px, 0, 0)` }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'forwards' });
    a.onfinish = () => p.remove();
    setTimeout(() => p.remove(), 400);
  }
  if (!v || !from) {
    if (v) v.style.transform = '';
    sliding(false);
    return;
  }
  v.style.transform = '';
  v.animate([{ transform: `translate3d(${from}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
  setTimeout(() => { if (!S.drag && !S.busy) sliding(false); }, 260);
}

// Taken hold of: the page is the finger's (or the trackpad's) now, even if
// it was still springing back from the last one.
function grab() {
  sliding(true);
  const v = view();
  if (v) v.getAnimations().forEach((an) => an.cancel());
}

// The page moved along by `dx` px, the page next door riding beside it;
// returns where the page is.
function follow(dx) {
  // Nothing that way: it gives a little, then stops.
  const dir = dx < 0 ? 1 : -1;
  const has = S.tabs[S.idx + dir];
  const w = window.innerWidth || 1;
  const x = has ? Math.max(-w, Math.min(w, dx)) : (dx * 0.3) / (1 + Math.abs(dx) / w);
  const v = view();
  if (v) v.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
  // Kept a moment longer when the finger wobbles back over the middle.
  let p = null;
  if (S.peek && S.peekDir !== dir && Math.abs(x) < 12) p = S.peek;
  else if (has) p = peekFor(dir);
  else dropPeek();
  if (p) p.style.transform = `translate3d(${(S.peekDir * w + x).toFixed(1)}px, 0, 0)`;
  stripTo(S.idx, x);
  return x;
}

// Let go at `x`, moving at `v` px/ms: over to the next section if it went
// far enough (or was flicked that way), else back.
function release(x, ok = true, v = 0) {
  S.dragged = performance.now();
  const w = window.innerWidth || 1;
  const dir = x < 0 ? 1 : -1;
  const flick = Math.abs(v) > 0.45 && Math.sign(v) === Math.sign(x) && Math.abs(x) > 24;
  if (ok && S.tabs[S.idx + dir] && (Math.abs(x) > far(w) || flick)) go(dir, x);
  else settle(x);
}

function wire(bar) {
  bar.addEventListener('pointerdown', (e) => {
    if (!phone.matches || S.busy || S.wheel || e.button) return;
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
      grab();
      try { bar.setPointerCapture(e.pointerId); } catch { /* fine */ }
    }
    const now = performance.now();
    d.v = (e.clientX - d.lx) / Math.max(1, now - d.t);
    d.lx = e.clientX;
    d.t = now;
    d.x = follow(dx);
  });
  const end = (e) => {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    S.drag = null;
    if (d.moved) release(d.x, e.type === 'pointerup', d.v);
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
  // Two fingers on a Mac trackpad (or a sideways scroll): the page follows
  // them like a finger, and the swipe ends when they've stopped. Up and
  // down scrolls the page as usual.
  bar.addEventListener('wheel', (e) => {
    if (e.ctrlKey || !phone.matches) return; // a pinch, or the rail
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
    const dx = e.deltaX * k;
    const dy = e.deltaY * k;
    let wh = S.wheel;
    if (!wh) {
      if (Math.abs(dx) <= Math.abs(dy)) return;
      // Sideways is never the browser's back or forward here.
      e.preventDefault();
      if (S.busy || S.drag) return;
      wh = S.wheel = { x: 0, at: 0, gone: false, quiet: 0 };
      grab();
    }
    e.preventDefault();
    clearTimeout(wh.quiet);
    wh.quiet = setTimeout(() => {
      S.wheel = null;
      if (!wh.gone) release(wh.at);
    }, 160);
    // Already on its way over: the rest of this swipe (the trackpad keeps
    // coasting a while) moves nothing.
    if (wh.gone) return;
    wh.x -= dx;
    wh.at = follow(wh.x);
    const w = window.innerWidth || 1;
    const dir = wh.at < 0 ? 1 : -1;
    if (Math.abs(wh.at) > far(w) * 1.6 && S.tabs[S.idx + dir]) {
      wh.gone = true;
      S.dragged = performance.now();
      go(dir, wh.at);
    }
  }, { passive: false });
}

// For tests.
export function swipeBarInfo() {
  return { idx: S.idx, tab: S.tabs[S.idx] && S.tabs[S.idx].key, prev: !S.prev?.disabled, next: !S.next?.disabled, busy: S.busy, strip: S.strip && S.strip.style.transform, peek: S.peek ? S.tabs[S.idx + S.peekDir]?.key : null };
}
