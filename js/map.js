// Circles and Organizations, on a phone: a map you look down on at a slant.
// Each circle is a little ring of its people holding hands, as big as the
// circle is; each organization is a building drawn in a loose line, taller
// the more people work there. A finger moves the map about; a tap flies in
// to that circle, or in at one of the building's windows, and then the app
// opens it (the People ring, with just those people).
//
// One canvas, kept and moved between pages, like ring.js. Where you left
// each map is kept while the app is open.

import { bodyLine, shake, trace, armRoots, handBetween, hashStr, lightness } from './ring.js';

const TAU = Math.PI * 2;
const TILT = 0.5; // the ground, squashed: how steeply you look down on it
const UP = 0.86; // standing things, a little shortened
const GAP = 0.8; // between people in a little ring, in their heights
const ARM = 0.4; // an arm's length, in its owner's height
const MOST = 40; // the most people drawn round one circle
const LABEL_W = 150; // the widest a name gets, in pixels
const FLY = 0.72; // seconds to fly in
const BACKOUT = 0.55; // and out again

// Buildings are drawn at a smaller scale than people, so a street of them
// still fits.
const zoomOf = (kind) => (kind === 'orgs' ? 0.6 : 1);

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------------------------------------------------------------------------
// State

const st = {
  el: null,
  cv: null,
  ctx: null,
  w: 0,
  h: 0,
  dpr: 1,
  kind: 'circles',
  items: [],
  key: null,
  box: null, // everything, in map units
  base: 40, // pixels per person's height
  k: 40, // the same, for this map (buildings are drawn smaller)
  cam: { x: 0, y: 0 },
  vel: { x: 0, y: 0 },
  cams: {}, // where each map was left
  drag: null,
  fly: null, // { id, to, k0, k1, c0, c1, t, out }
  t: 0,
  last: 0,
  lastDraw: 0,
  raf: 0,
  visible: true,
  hits: [],
  onOpen: null,
};

function build() {
  const el = document.createElement('div');
  el.className = 'map';
  el.innerHTML = '<canvas class="map-canvas" tabindex="0" role="img"></canvas>';
  st.el = el;
  st.cv = el.querySelector('canvas');
  st.ctx = st.cv.getContext('2d');
  wire(st.cv);
  new ResizeObserver(() => { resize(); kick(); }).observe(el);
  new IntersectionObserver((entries) => {
    st.visible = entries[entries.length - 1].isIntersecting;
    kick();
  }).observe(el);
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('resize', () => { if (st.el.isConnected) { resize(); kick(); } });
  if (document.fonts) document.fonts.load('16px Mansalva').then(() => draw(), () => {});
}

// The stage runs down to the tab bar, like People's ring.
function resize() {
  const w = st.el.clientWidth;
  if (!w) return;
  const bar = document.getElementById('tabbar');
  const br = bar && bar.getBoundingClientRect();
  const barTop = br && br.height && br.top > window.innerHeight / 2 ? br.top : window.innerHeight;
  const top = st.el.getBoundingClientRect().top + window.scrollY;
  const h = Math.round(Math.max(w * 0.9, barTop - top));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (w === st.w && h === st.h && dpr === st.dpr) return;
  Object.assign(st, { w, h, dpr });
  st.base = clamp(w / 7.6, 34, 54);
  st.k = st.base * zoomOf(st.kind);
  st.el.style.height = `${h}px`;
  st.cv.width = Math.round(w * dpr);
  st.cv.height = Math.round(h * dpr);
  st.cv.style.width = `${w}px`;
  st.cv.style.height = `${h}px`;
  holdIn();
}

// ---------------------------------------------------------------------------
// What's on the map. Everything is in map units (a person's height), x to
// the right and y down the screen, with the ground already squashed.

// A circle: its people round a ring, the first at the front. Big circles
// stop at MOST people drawn.
function ringItem(c) {
  const people = c.people.slice(0, MOST).map((p, i) => ({ ...p, seed: hashStr(`${c.id}:${p.id || i}`) }));
  const n = people.length;
  const gaps = people.map((p, i) => GAP * (p.size + people[(i + 1) % n].size) / 2);
  const around = gaps.reduce((a, b) => a + b, 0);
  const R = n > 2 ? Math.max(0.6, around / TAU) : 0.5;
  // One or two people stand side by side at the front instead.
  let a = Math.PI / 2;
  people.forEach((p, i) => {
    if (n === 1) p.th = Math.PI / 2;
    else if (n === 2) p.th = Math.PI / 2 + (i ? -0.75 : 0.75);
    else {
      p.th = a;
      a -= (gaps[i] / around) * TAU;
    }
  });
  const tall = n ? Math.max(...people.map((p) => p.size)) * UP : UP;
  return { ...c, type: 'ring', count: c.count ?? c.people.length, R, people, x0: -R - 0.5, x1: R + 0.5, y0: -R * TILT - tall - 0.2, y1: R * TILT + 0.95 };
}

// A building, by kind of organization: an office with a water tank on the
// roof (agency), a shop with an awning (brand), a wide stage with a big
// door (production), a tall block with an aerial (publication), a sawtooth
// roof (studio), or a house with a pitched roof (anything else).
const BUILDINGS = {
  agency: { a: 0.75, b: 0.95, floor: 0.4, roof: 'tank' },
  brand: { a: 0.8, b: 1.15, floor: 0.42, roof: 'shop' },
  production: { a: 1.05, b: 1.3, floor: 0.5, roof: 'stage' },
  publication: { a: 0.6, b: 0.7, floor: 0.38, roof: 'aerial', extra: 2 },
  studio: { a: 0.9, b: 1.1, floor: 0.46, roof: 'saw' },
  other: { a: 0.7, b: 0.8, floor: 0.42, roof: 'gable' },
};
function buildingItem(o) {
  const B = BUILDINGS[o.type] || BUILDINGS.other;
  const n = o.n || 0;
  const cap = o.type === 'production' || o.type === 'brand' ? 3 : 7;
  const floors = clamp(1 + Math.ceil(n / 2) + (B.extra || 0), 1, cap + (B.extra || 0));
  const wide = 1 + Math.min(n, 12) * 0.035;
  const a = B.a * wide;
  const b = B.b * wide;
  const H = floors * B.floor + 0.12;
  const roofUp = { tank: 0.38, shop: 0.22, stage: 0.3, aerial: 0.55, saw: 0.3, gable: 0.42 }[B.roof] || 0;
  return {
    ...o,
    type: 'building',
    roof: B.roof,
    a,
    b,
    H,
    floors,
    floor: B.floor,
    seed: hashStr(o.id),
    x0: -a * 0.866 - 0.3,
    x1: b * 0.866 + 0.3,
    y0: -H - (a + b) * 0.5 - roofUp - 0.15,
    y1: 0.95,
  };
}

// Lay them out from the middle in a loose spiral, the first in the middle,
// each in the first free spot it comes to.
function layout(items) {
  const placed = [];
  const pad = 0.25;
  const free = (it, x, y) => placed.every((o) => x + it.x1 + pad < o.x + o.x0 || x + it.x0 - pad > o.x + o.x1 || y + it.y1 + pad < o.y + o.y0 || y + it.y0 - pad > o.y + o.y1);
  for (const it of items) {
    let x = 0;
    let y = 0;
    for (let t = 0; t < 4000 && placed.length; t++) {
      const ang = t * 0.31;
      const r = 0.05 * t;
      // A touch wider than tall, like a phone held upright sees a map.
      x = Math.cos(ang) * r;
      y = Math.sin(ang) * r * 1.15;
      if (free(it, x, y)) break;
    }
    it.x = x;
    it.y = y;
    placed.push(it);
  }
  const box = items.reduce((b, it) => ({
    x0: Math.min(b.x0, it.x + it.x0),
    x1: Math.max(b.x1, it.x + it.x1),
    y0: Math.min(b.y0, it.y + it.y0),
    y1: Math.max(b.y1, it.y + it.y1),
  }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  return items.length ? box : { x0: -1, x1: 1, y0: -1, y1: 1 };
}

// The middle of everything at the start, or where this map was left.
function update(kind, list, key) {
  const fresh = kind !== st.kind || key !== st.key;
  if (st.kind && st.items.length) st.cams[st.kind] = { ...st.cam };
  st.kind = kind;
  st.k = st.base * zoomOf(kind);
  if (fresh) {
    st.items = list.map((x) => (kind === 'orgs' ? buildingItem(x) : ringItem(x)));
    // Room for each name under it, so no two names run together.
    for (const it of st.items) {
      const half = Math.min(LABEL_W, it.name.length * 7.8 + 10) / 2 / st.k;
      it.x0 = Math.min(it.x0, -half);
      it.x1 = Math.max(it.x1, half);
    }
    st.box = layout(st.items);
    st.key = key;
  }
  const kept = st.cams[kind];
  st.cam = kept ? { ...kept } : { x: (st.box.x0 + st.box.x1) / 2, y: (st.box.y0 + st.box.y1) / 2 };
  st.vel = { x: 0, y: 0 };
  holdIn();
  const n = st.items.length;
  const what = kind === 'orgs' ? (n === 1 ? 'one organization' : `${n} organizations`) : n === 1 ? 'one circle' : `${n} circles`;
  st.cv.setAttribute('aria-label', `A map of your ${kind === 'orgs' ? 'organizations as buildings' : 'circles, each a ring of its people'}, ${what}. Drag to move around, tap one to go in.`);
}

// Not so far off that everything's gone: the middle of the screen stays
// over the map (or, when it all fits, the map stays in the middle).
function limits() {
  const b = st.box;
  const hw = st.w / 2 / st.k;
  const hh = st.h / 2 / st.k;
  const lim = (lo, hi, half) => (hi - lo < half * 2 ? [(lo + hi) / 2, (lo + hi) / 2] : [lo + half * 0.55, hi - half * 0.55]);
  return { x: lim(b.x0, b.x1, hw), y: lim(b.y0, b.y1, hh) };
}
function holdIn() {
  if (!st.box || !st.w) return;
  const L = limits();
  st.cam.x = clamp(st.cam.x, L.x[0], L.x[1]);
  st.cam.y = clamp(st.cam.y, L.y[0], L.y[1]);
}

export function mountMap(slot, { kind = 'circles', items = [], key = '' } = {}, { onOpen, from = null } = {}) {
  if (!st.el) build();
  st.onOpen = onOpen;
  slot.appendChild(st.el);
  resize();
  update(kind, items, key);
  st.fly = null;
  // Back out of a circle or building: start in close and pull back.
  const it = from && st.items.find((x) => x.id === from);
  if (it && !reduced.matches) {
    const aim = aimAt(it);
    st.fly = { id: it.id, out: true, t: 0, k0: st.k * aim.zoom, k1: st.k, c0: aim.c, c1: { ...st.cam }, at: aim.c };
  }
  draw();
  kick();
}

// For tests: move time on by hand (a hidden test browser runs no frames).
export function mapStep(seconds = 0, set = {}) {
  Object.assign(st, set);
  for (let s = 0; s < seconds; s += 1 / 60) step(1 / 60);
  draw();
}

export function mapInfo() {
  return {
    kind: st.kind,
    k: st.k,
    cam: { x: Math.round(st.cam.x * 100) / 100, y: Math.round(st.cam.y * 100) / 100 },
    box: st.box,
    fly: st.fly && { id: st.fly.id, out: st.fly.out, t: Math.round(st.fly.t * 100) / 100 },
    items: st.items.map((it) => ({ id: it.id, name: it.name, x: Math.round(it.x * 100) / 100, y: Math.round(it.y * 100) / 100, R: it.R, floors: it.floors })),
    hits: st.hits.map((h) => ({ id: h.id, x: Math.round((h.x0 + h.x1) / 2), y: Math.round((h.y0 + h.y1) / 2) })),
  };
}

// Where to fly to for each: the middle of a ring, close enough to be in
// it; or one of a building's windows, close enough that it fills the
// screen.
function aimAt(it) {
  if (it.type === 'building') {
    const win = windowSpot(it);
    return { c: { x: it.x + win.x, y: it.y + win.y }, zoom: clamp((st.w * 2.8) / (win.size * st.k), 10, 160) };
  }
  return { c: { x: it.x, y: it.y - 0.35 }, zoom: clamp((st.w * 1.6) / ((it.R * 2 + 0.6) * st.k), 4, 30) };
}

function go(it) {
  if (!it || st.fly) return;
  if (reduced.matches) {
    if (st.onOpen) st.onOpen(it.id);
    return;
  }
  const aim = aimAt(it);
  st.vel = { x: 0, y: 0 };
  st.fly = { id: it.id, out: false, t: 0, k0: st.k, k1: st.k * aim.zoom, c0: { ...st.cam }, c1: aim.c, at: aim.c };
  kick();
}

// ---------------------------------------------------------------------------
// Touch: drag the map about (it runs on a little when let go); tap one to
// go in.

function wire(cv) {
  cv.addEventListener('pointerdown', (e) => {
    if (e.button || st.fly) return;
    st.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), c0: { ...st.cam }, moved: false, v: { x: 0, y: 0 } };
    st.vel = { x: 0, y: 0 };
    kick();
  });
  cv.addEventListener('pointermove', (e) => {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      d.moved = true;
      try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
    }
    const now = performance.now();
    const dt = Math.max(1, now - d.t) / 1000;
    d.v.x = mix(d.v.x, -(e.clientX - d.x) / st.k / dt, 0.35);
    d.v.y = mix(d.v.y, -(e.clientY - d.y) / st.k / dt, 0.35);
    d.x = e.clientX;
    d.y = e.clientY;
    d.t = now;
    st.cam.x = d.c0.x - dx / st.k;
    st.cam.y = d.c0.y - dy / st.k;
    holdSoft();
    kick();
  });
  const end = (e) => {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    st.drag = null;
    if (d.moved) {
      if (performance.now() - d.t < 90) st.vel = { x: clamp(d.v.x, -14, 14), y: clamp(d.v.y, -14, 14) };
    } else if (e.type === 'pointerup') {
      const r = st.cv.getBoundingClientRect();
      tap(e.clientX - r.left, e.clientY - r.top);
    }
    kick();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    st.cam.x += e.deltaX / st.k;
    st.cam.y += e.deltaY / st.k;
    holdIn();
    kick();
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step) {
      e.preventDefault();
      st.vel = { x: step[0] * 5, y: step[1] * 5 };
      kick();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go(nearest());
    }
  });
}

// Dragged past the edge: it gives, but less and less.
function holdSoft() {
  const L = limits();
  const give = (v, lo, hi) => (v < lo ? lo - Math.sqrt(lo - v) * 0.6 : v > hi ? hi + Math.sqrt(v - hi) * 0.6 : v);
  st.cam.x = give(st.cam.x, L.x[0], L.x[1]);
  st.cam.y = give(st.cam.y, L.y[0], L.y[1]);
}

function tap(x, y) {
  const hit = st.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
  if (hit) go(st.items.find((it) => it.id === hit.id));
}

function nearest() {
  let best = null;
  for (const it of st.items) {
    const d = Math.hypot(it.x - st.cam.x, it.y - st.cam.y);
    if (!best || d < best.d) best = { it, d };
  }
  return best && best.it;
}

// ---------------------------------------------------------------------------
// Time

function kick() {
  if (st.raf || !st.el || !st.el.isConnected || document.hidden || !st.visible) return;
  st.last = 0;
  st.raf = requestAnimationFrame(frame);
}

const moving = () => st.drag || (st.fly && !st.fly.done) || Math.abs(st.vel.x) + Math.abs(st.vel.y) > 0.01 || outside();
function outside() {
  if (!st.box) return false;
  const L = limits();
  return st.cam.x < L.x[0] - 0.001 || st.cam.x > L.x[1] + 0.001 || st.cam.y < L.y[0] - 0.001 || st.cam.y > L.y[1] + 0.001;
}

function frame(now) {
  st.raf = 0;
  if (!st.el || !st.el.isConnected || document.hidden || !st.visible) return;
  const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 1 / 60;
  st.last = now;
  step(dt);
  // Moving gets every frame; just swaying gets about 25 a second.
  const b = moving();
  if (b || now - st.lastDraw > 40) {
    st.lastDraw = now;
    draw();
  }
  if (b || !reduced.matches) st.raf = requestAnimationFrame(frame);
}

function step(dt) {
  st.t += dt;
  const f = st.fly;
  if (f) {
    if (f.done) return;
    f.t += dt / (f.out ? BACKOUT : FLY);
    if (f.t >= 1) {
      if (f.out) {
        st.fly = null;
        st.cam = { ...f.c1 };
      } else {
        // Stay in, on the blank page, until the app opens it; the map
        // stays where it was, for coming back out.
        f.t = 1;
        f.done = true;
        st.cams[st.kind] = { ...st.cam };
        if (st.onOpen) st.onOpen(f.id);
      }
    }
    return;
  }
  if (!st.drag) {
    if (st.vel.x || st.vel.y) {
      st.cam.x += st.vel.x * dt;
      st.cam.y += st.vel.y * dt;
      const decay = Math.exp(-3 * dt);
      st.vel.x *= decay;
      st.vel.y *= decay;
      if (Math.abs(st.vel.x) + Math.abs(st.vel.y) < 0.01) st.vel = { x: 0, y: 0 };
    }
    // Past the edge: back in, softly.
    const L = limits();
    const pull = (v, lo, hi) => (v < lo ? v + (lo - v) * Math.min(1, 9 * dt) : v > hi ? v + (hi - v) * Math.min(1, 9 * dt) : v);
    const x = pull(st.cam.x, L.x[0], L.x[1]);
    const y = pull(st.cam.y, L.y[0], L.y[1]);
    if (x !== st.cam.x) st.vel.x = 0;
    if (y !== st.cam.y) st.vel.y = 0;
    st.cam.x = x;
    st.cam.y = y;
  }
}

// The camera now, flying or not: its zoom and middle, and how far in.
function camera() {
  const f = st.fly;
  if (!f) return { k: st.k, c: st.cam, p: 0 };
  const e = ease(clamp(f.t, 0, 1));
  // Zoom evenly (in proportion), and slide what you're flying at across
  // the screen evenly too: into the middle going in, out of it coming back.
  const k = f.k0 * Math.pow(f.k1 / f.k0, e);
  const off0 = { x: (f.at.x - f.c0.x) * f.k0, y: (f.at.y - f.c0.y) * f.k0 };
  const off1 = { x: (f.at.x - f.c1.x) * f.k1, y: (f.at.y - f.c1.y) * f.k1 };
  const c = { x: f.at.x - mix(off0.x, off1.x, e) / k, y: f.at.y - mix(off0.y, off1.y, e) / k };
  return { k, c, p: f.out ? 1 - e : e };
}

// ---------------------------------------------------------------------------
// Drawing

const line = (a, b, n) => Array.from({ length: n }, (_, i) => [mix(a[0], b[0], i / (n - 1)), mix(a[1], b[1], i / (n - 1))]);
const chain = (pts, n = 6) => pts.slice(1).reduce((out, p, i) => out.concat(line(pts[i], p, n).slice(i ? 1 : 0)), []);

function draw() {
  resize();
  const { ctx, w, h, dpr } = st;
  if (!ctx || !w) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  st.hits = [];
  if (!st.items.length) return;
  const cs = getComputedStyle(st.el);
  const ink = cs.color;
  const paper = cs.getPropertyValue('--bg').trim() || '#fff';
  const dark = lightness(paper) < 0.4;
  const textInk = cs.getPropertyValue('--text').trim() || ink;
  const dim = cs.getPropertyValue('--text-dim').trim() || textInk;
  const colours = Object.fromEntries(['client', 'active', 'warm', 'cold', 'parked', 'none'].map((k) => [k, cs.getPropertyValue(`--w-${k}`).trim() || ink]));
  const cam = camera();
  const K = cam.k;
  const S = (x, y) => [w / 2 + (x - cam.c.x) * K, h / 2 + (y - cam.c.y) * K];
  const flying = st.fly ? st.fly.id : null;
  // Flying in, the others fade away; the one you're going into stays.
  const others = flying ? 1 - clamp(cam.p * 1.6, 0, 1) : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pen = { ctx, ink, paper, dark, colours, K };
  // Off the screen: not drawn.
  const seen = (it) => {
    const [ax, ay] = S(it.x, it.y);
    return ax + it.x1 * K > -20 && ax + it.x0 * K < w + 20 && ay + it.y1 * K > -20 && ay + it.y0 * K < h + 20;
  };

  if (st.kind === 'orgs') {
    const order = [...st.items].sort((a, b) => a.y - b.y);
    for (const it of order) {
      if (!seen(it)) continue;
      ctx.globalAlpha = it.id === flying ? 1 : others;
      drawBuilding(pen, it, S(it.x, it.y));
    }
  } else {
    // Everyone from every ring, back to front, so the near ones cross
    // over the far ones.
    const sway = reduced.matches ? 0 : 0.03 * Math.sin(st.t * 1.25);
    const figs = [];
    for (const it of st.items) {
      if (!seen(it)) continue;
      const alpha = it.id === flying ? 1 : others;
      if (!it.people.length) {
        drawEmptyRing(pen, it, S, alpha);
        continue;
      }
      const ring = it.people.map((p) => {
        const fx = it.x + Math.cos(p.th) * it.R;
        const fy = it.y + Math.sin(p.th) * it.R * TILT;
        const [sx, sy] = S(fx, fy);
        const hp = p.size * UP * K;
        const lean = sway;
        const put = ([u, v]) => [sx + (u + lean * v * (0.55 + 0.45 * v)) * hp, sy - v * hp];
        const kind = p.figure || 'person';
        return { p, it, sx, sy, hp, put, kind, alpha, back: Math.sin(p.th) < -0.2, sh: armRoots(kind).map(put), hands: [null, null] };
      });
      // Hands with the next one round: whichever hands face each other on
      // the screen.
      const n = ring.length;
      const pairs = n === 2 ? [[0, 1]] : n > 2 ? ring.map((_, i) => [i, (i + 1) % n]) : [];
      for (const [i, j] of pairs) {
        const [l, r] = ring[i].sx <= ring[j].sx ? [ring[i], ring[j]] : [ring[j], ring[i]];
        const lh = l.hands[1] ? 0 : 1;
        const rh = r.hands[0] ? 1 : 0;
        if (l.hands[lh] || r.hands[rh]) continue;
        const hand = handBetween(l.sh[lh], ARM * l.hp, r.sh[rh], ARM * r.hp);
        l.hands[lh] = hand;
        r.hands[rh] = hand;
      }
      figs.push(...ring);
    }
    figs.sort((a, b) => a.sy - b.sy);
    for (const f of figs) drawFigure(pen, f);
  }

  // Names under each, and how many, over everything.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const it of st.items) {
    if (!seen(it)) continue;
    const alpha = it.id === flying ? 1 - clamp(cam.p * 3, 0, 1) : others;
    const [ax, ay] = S(it.x, it.y);
    const below = it.type === 'ring' ? it.R * TILT * K : 0;
    const y0 = ay + below + 7;
    const maxW = LABEL_W * (K / st.k);
    let size = 17;
    ctx.font = `${size}px Mansalva, "Bradley Hand", cursive`;
    let label = it.name;
    while (ctx.measureText(label).width > maxW && size > 13) {
      size -= 1;
      ctx.font = `${size}px Mansalva, "Bradley Hand", cursive`;
    }
    while (ctx.measureText(label).width > maxW && label.length > 4) label = `${label.slice(0, -2).trimEnd()}…`;
    if (alpha > 0.02) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 4;
      ctx.strokeStyle = paper;
      ctx.strokeText(label, ax, y0);
      ctx.fillStyle = textInk;
      ctx.fillText(label, ax, y0);
      const n = it.type === 'ring' ? it.count : it.n;
      const sub = n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'Nobody yet';
      ctx.font = `13px Mansalva, "Bradley Hand", cursive`;
      ctx.strokeText(sub, ax, y0 + size + 1);
      ctx.fillStyle = dim;
      ctx.fillText(sub, ax, y0 + size + 1);
    }
    if (!flying) st.hits.push({ id: it.id, x0: ax + it.x0 * K, x1: ax + it.x1 * K, y0: ay + it.y0 * K, y1: ay + it.y1 * K });
  }
  ctx.globalAlpha = 1;
  // Flying into a building: its window grows round the screen.
  if (st.fly && st.kind === 'orgs') {
    const it = st.items.find((x) => x.id === st.fly.id);
    if (it) drawWindowFill(pen, it, S, cam.p);
  }
  // The last of the way in (or the start of the way out): the page shows
  // through, ready for what opens.
  if (st.fly) {
    const fade = clamp((cam.p - 0.86) / 0.14, 0, 1);
    if (fade > 0) {
      ctx.globalAlpha = fade;
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }
  // Nearest the front first, for taps.
  st.hits.sort((a, b) => b.y1 - a.y1);
}

function drawFigure(pen, f) {
  const { ctx, paper, dark, colours, ink } = pen;
  const { p, hp } = f;
  const path = new Path2D();
  trace(path, shake(bodyLine(f.kind, hp > 70, f.put, f.hands, hp), p.seed, clamp(0.006 * hp, 0.22, 1.2)));
  const lw = clamp(hp / 30, 1, 2.2);
  ctx.setLineDash([]);
  ctx.globalAlpha = f.alpha;
  ctx.strokeStyle = paper;
  ctx.lineWidth = lw + 2.4;
  ctx.stroke(path);
  ctx.globalAlpha = f.alpha * (f.back ? (dark ? 0.75 : 0.65) : 1);
  ctx.strokeStyle = colours[p.warmth] || ink;
  ctx.lineWidth = lw;
  if (p.warmth === 'parked') ctx.setLineDash([3.5, 3]);
  ctx.stroke(path);
  ctx.setLineDash([]);
}

// A circle with nobody in it yet: just where the ring would be.
function drawEmptyRing(pen, it, S, alpha) {
  const { ctx, ink } = pen;
  const pts = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 39) * TAU * 1.04;
    return S(it.x + Math.cos(a) * it.R, it.y + Math.sin(a) * it.R * TILT);
  });
  const path = new Path2D();
  trace(path, shake(pts, hashStr(it.id), 0.6));
  ctx.globalAlpha = alpha * 0.6;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke(path);
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------------------
// Buildings: in map units from the front bottom corner, a left face going
// up and left and a right face going up and right.

function faces(it) {
  const { a, b } = it;
  const L = (t, z) => [-0.866 * a * t, -0.5 * a * t - z];
  const R = (t, z) => [0.866 * b * t, -0.5 * b * t - z];
  const T = (u, v, z) => [-0.866 * a * u + 0.866 * b * v, -0.5 * a * u - 0.5 * b * v - z];
  return { L, R, T };
}

// The window to fly in at: on the right face, about the middle floor.
function windowSpot(it) {
  const { R } = faces(it);
  const fl = Math.floor((it.floors - 1) / 2);
  const z0 = 0.12 + fl * it.floor + it.floor * 0.28;
  const z1 = z0 + it.floor * 0.46;
  const cols = winCols(it.b);
  const c = Math.floor((cols - 1) / 2);
  const [t0, t1] = winSpan(c, cols);
  const mid = R((t0 + t1) / 2, (z0 + z1) / 2);
  return { x: mid[0], y: mid[1], size: Math.max(Math.abs(R(t1, z0)[0] - R(t0, z0)[0]), z1 - z0), t0, t1, z0, z1 };
}
const winCols = (len) => clamp(Math.round(len / 0.32), 2, 5);
const winSpan = (c, cols) => [(c + 0.22) / cols, (c + 0.78) / cols];

function drawBuilding(pen, it, at) {
  const { ctx, ink, paper, K } = pen;
  const { L, R, T } = faces(it);
  const { a, b, H } = it;
  const P = ([x, y]) => [at[0] + x * K, at[1] + y * K];
  const strokes = [];
  const add = (pts, w = 1.7) => strokes.push({ pts: pts.map(P), w });
  // The outline, round in one go: front corner, along the right, up, over
  // the back, down the left and back to the front.
  add(chain([L(0, 0), R(1, 0), R(1, H), T(1, 1, H), L(1, H), L(1, 0), L(0, 0), L(0, H)], 7), 1.9);
  add(chain([L(1, H), T(0, 0, H), R(1, H)], 7), 1.9);
  // Windows, a row to a floor, on both faces; a door on the left.
  const win = (F, t0, t1, z0, z1) => add(chain([F(t0, z0), F(t1, z0), F(t1, z1), F(t0, z1), F(t0, z0 + (z1 - z0) * 0.25)], 4), 1.3);
  const groundDoor = it.roof !== 'shop' && it.roof !== 'stage';
  for (let f = 0; f < it.floors; f++) {
    const z0 = 0.12 + f * it.floor + it.floor * 0.28;
    const z1 = z0 + it.floor * 0.46;
    [[R, b], [L, a]].forEach(([F, len]) => {
      const cols = winCols(len);
      for (let c = 0; c < cols; c++) {
        if (f === 0 && F === L && groundDoor && c === Math.floor(cols / 2)) continue;
        if (f === 0 && F === R && it.roof === 'shop') continue;
        if (f === 0 && F === R && it.roof === 'stage') continue;
        const [t0, t1] = winSpan(c, cols);
        win(F, t0, t1, z0, z1);
      }
    });
  }
  if (groundDoor) {
    const cols = winCols(a);
    const c = Math.floor(cols / 2);
    const [t0, t1] = winSpan(c, cols);
    add(chain([L(t0, 0), L(t0, it.floor * 0.8), L(t1, it.floor * 0.8), L(t1, 0)], 4), 1.4);
  }
  // The roof, or what's on it, by kind.
  if (it.roof === 'tank') {
    const c = T(0.55, 0.5, H);
    const r = 0.13;
    const legs = [c[0] - r * 0.8, c[0] + r * 0.8];
    add([[legs[0], c[1]], [legs[0], c[1] - 0.14]], 1.2);
    add([[legs[1], c[1]], [legs[1], c[1] - 0.14]], 1.2);
    const top = c[1] - 0.14;
    const tank = [];
    for (let i = 0; i <= 14; i++) {
      const ang = Math.PI * (i / 14);
      tank.push([c[0] - Math.cos(ang) * r, top + Math.sin(ang) * r * 0.45]);
    }
    add([...tank, [c[0] + r, top - 0.2], [c[0], top - 0.27], [c[0] - r, top - 0.2], [c[0] - r, top]], 1.4);
  } else if (it.roof === 'aerial') {
    const c = T(0.5, 0.5, H);
    add(chain([c, [c[0], c[1] - 0.5]], 6), 1.3);
    add(chain([[c[0] - 0.1, c[1] - 0.3], [c[0] + 0.1, c[1] - 0.34]], 3), 1.2);
    add(chain([[c[0] - 0.06, c[1] - 0.42], [c[0] + 0.06, c[1] - 0.44]], 3), 1.2);
  } else if (it.roof === 'saw') {
    // Teeth along the top, up over the left edge.
    const teeth = [];
    const n = 3;
    for (let i = 0; i < n; i++) {
      teeth.push(T(0, i / n, H), T(0, (i + 0.15) / n, H + 0.3), T(0, (i + 1) / n, H));
    }
    add(chain(teeth, 4), 1.6);
    for (let i = 0; i < n; i++) add(chain([T(0, (i + 0.15) / n, H + 0.3), T(1, (i + 0.15) / n, H + 0.3)], 5), 1.3);
    // The same teeth along the far end, behind.
    const back = [];
    for (let i = 0; i < n; i++) back.push(T(1, i / n, H), T(1, (i + 0.15) / n, H + 0.3), T(1, (i + 1) / n, H));
    add(chain(back, 4), 1.1);
  } else if (it.roof === 'gable') {
    const ridge0 = T(0.5, 0, H + 0.42);
    const ridge1 = T(0.5, 1, H + 0.42);
    add(chain([L(1, H), ridge0, L(0, H)], 6), 1.8);
    add(chain([ridge0, ridge1, T(1, 1, H)], 7), 1.6);
    add(chain([ridge1, R(1, H)], 5), 1.3);
  } else if (it.roof === 'shop') {
    // A big shop window on the ground floor, a scalloped awning over it,
    // and a sign on the roof.
    const fl = it.floor;
    add(chain([R(0.12, 0.06), R(0.88, 0.06), R(0.88, fl * 0.62), R(0.12, fl * 0.62), R(0.12, 0.06)], 5), 1.3);
    const out = (p) => [p[0] + 0.07, p[1] + 0.11];
    const scallop = [];
    const n = 4;
    for (let i = 0; i <= n * 8; i++) {
      const t = 0.08 + (0.84 * i) / (n * 8);
      const dip = Math.abs(Math.sin((i / 8) * Math.PI)) * 0.07;
      scallop.push(out(R(t, fl * 0.74 - dip)));
    }
    add([R(0.08, fl * 0.95), out(R(0.08, fl * 0.74)), ...scallop, out(R(0.92, fl * 0.74)), R(0.92, fl * 0.95)], 1.4);
    add(chain([R(0.15, it.H), R(0.15, it.H + 0.22), R(0.85, it.H + 0.22), R(0.85, it.H)], 5), 1.4);
  } else if (it.roof === 'stage') {
    // A big rolling door, and a curved roof.
    add(chain([R(0.22, 0), R(0.22, it.floor * 1.05), R(0.78, it.floor * 1.05), R(0.78, 0)], 5), 1.5);
    for (let i = 1; i < 4; i++) add(chain([R(0.24, it.floor * 0.26 * i), R(0.76, it.floor * 0.26 * i)], 4), 1);
    const arch = (u) => Array.from({ length: 12 }, (_, i) => {
      const v = i / 11;
      return T(u, v, H + Math.sin(v * Math.PI) * 0.3);
    });
    add(arch(0), 1.7);
    add(arch(1), 1.3);
  }
  // Each line with a little paper round it, then the ink.
  ctx.setLineDash([]);
  const paths = strokes.map((s, i) => {
    const path = new Path2D();
    trace(path, shake(s.pts, it.seed + i * 7, clamp(0.012 * K, 0.3, 1.6)));
    return { path, w: s.w };
  });
  const alpha = ctx.globalAlpha;
  ctx.strokeStyle = paper;
  for (const s of paths) {
    ctx.lineWidth = s.w + 2.6;
    ctx.stroke(s.path);
  }
  ctx.strokeStyle = ink;
  for (const s of paths) {
    ctx.lineWidth = s.w * clamp(K / 40, 0.85, 1.6);
    ctx.stroke(s.path);
  }
  ctx.globalAlpha = alpha;
}

// Going in at a building's window: the window's frame grows past the
// edges of the screen, with the paper inside.
function drawWindowFill(pen, it, S, p) {
  const { ctx, ink, paper } = pen;
  const win = windowSpot(it);
  const { R } = faces(it);
  const corners = [R(win.t0, win.z0), R(win.t1, win.z0), R(win.t1, win.z1), R(win.t0, win.z1)].map(([x, y]) => S(it.x + x, it.y + y));
  const inside = new Path2D();
  corners.forEach(([x, y], i) => (i ? inside.lineTo(x, y) : inside.moveTo(x, y)));
  inside.closePath();
  ctx.globalAlpha = clamp(p * 1.6, 0, 1);
  ctx.fillStyle = paper;
  ctx.fill(inside);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2 + 10 * p;
  ctx.stroke(inside);
  // Its panes, as the window comes up to the glass.
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.globalAlpha = clamp((p - 0.3) * 2, 0, 1);
  ctx.lineWidth = 1.5 + 5 * p;
  ctx.beginPath();
  ctx.moveTo(...mid(corners[0], corners[1]));
  ctx.lineTo(...mid(corners[2], corners[3]));
  ctx.moveTo(...mid(corners[0], corners[3]));
  ctx.lineTo(...mid(corners[1], corners[2]));
  ctx.stroke();
  ctx.globalAlpha = 1;
}
