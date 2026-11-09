// Circles and Organizations, on a phone: a little world you look down on
// in perspective, like People's ring, so what's near is bigger than what's
// far. Each circle is a ring of its people holding hands, as big as the
// circle is; each organization is a building drawn in a loose line, taller
// the more people work there. One finger moves the map about and two pinch
// it in and out; a tap flies in to that circle, or in at one of the
// building's windows, and then the app opens it (the People ring, with
// just those people).
//
// One canvas, kept and moved between pages, like ring.js. Where you left
// each map, and how close you were, is kept while the app is open.

import { bodyLine, bodySash, shake, trace, armRoots, handBetween, hashStr, lightness } from './ring.js';

const TAU = Math.PI * 2;
const PITCH = 0.62; // how steeply you look down at the ground, in radians
const LENS = 1.7; // the lens, in screen widths: the perspective
const NEAR = 0.05; // nothing nearer the eye than this is drawn
const GAP = 0.8; // between people in a little ring, in their heights
const ARM = 0.4; // an arm's length, in its owner's height
const MOST = 40; // the most people drawn round one circle
const LABEL_W = 150; // the widest a name gets, in pixels
const FLY = 0.72; // seconds to fly in
const BACKOUT = 0.55; // and out again
const CLOSEST = 4; // a pinch goes in to four times as big as at the start
const FARTHEST = 0.3; // and out to a third as big (or to the whole map)
const FONT = 'Mansalva, "Bradley Hand", cursive';

// The buildings are drawn smaller than people would be.
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
  box: null, // the ground it all stands on, in heights: x0, x1, z0 (near), z1 (far)
  fit: null, // where to stand to see all of it
  base: 40, // pixels per person's height where you look, at the start
  F: 900, // the lens, in pixels
  cam: { x: 0, z: 0, D: 20 }, // the spot on the ground you look at, and how far back you are
  vel: { x: 0, z: 0 },
  cams: {}, // where each map was left
  ptrs: new Map(), // fingers down, where they are
  drag: null,
  pinch: null,
  fly: null,
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
  st.F = LENS * w;
  st.el.style.height = `${h}px`;
  st.cv.width = Math.round(w * dpr);
  st.cv.height = Math.round(h * dpr);
  st.cv.style.width = `${w}px`;
  st.cv.style.height = `${h}px`;
  holdIn();
}

// ---------------------------------------------------------------------------
// What's on the map. Everything stands on the ground: x to the right, z
// away from you, y up, all in a person's height.

// A circle: its people round a ring, facing in, the first at the front.
// Big circles stop at MOST people drawn.
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
  const tall = n ? Math.max(...people.map((p) => p.size)) : 1;
  return { ...c, type: 'ring', count: c.count ?? c.people.length, R, people, tall, mx: 0, mz: 0, reach: R + 0.5 + tall };
}

// A building, by kind of organization: an office with a water tank on the
// roof (agency), a shop with an awning (brand), a wide stage with a big
// door (production), a tall block with an aerial (publication), a sawtooth
// roof (studio), or a house with a pitched roof (anything else). It stands
// on its front corner, one side running back to the left, one to the
// right.
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
  const roofUp = { tank: 0.45, shop: 0.22, stage: 0.3, aerial: 0.55, saw: 0.3, gable: 0.42 }[B.roof] || 0;
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
    tall: H + roofUp,
    mx: 0.433 * (b - a),
    mz: 0.25 * (a + b),
    reach: Math.max(a, b) + H + roofUp,
  };
}

// Lay them out from the middle in a loose spiral, the first in the middle,
// each in the first free spot it comes to. Each keeps room in front for
// its name, and behind for what stands up off the ground. Names shrink
// less than things do with distance, so farther back they need more
// ground; and from the far side you look along the ground more, so what
// stands up there hides more of what's behind it.
function layout(items, k) {
  const sp = Math.sin(PITCH);
  const cp = Math.cos(PITCH);
  const D0 = st.F / k;
  const ext = (it, z) => {
    const s = clamp(D0 / (D0 + z * cp), 0.45, 2.2);
    const sc = clamp(Math.sqrt(s), 0.78, 1.2); // as the names are drawn
    const half = (Math.min(LABEL_W, it.name.length * 7.8 + 10) * sc) / 2 / (k * s);
    const label = (48 * sc) / (k * s * sp);
    const up = (it.tall * (D0 * cp + z)) / Math.max(D0 * sp * 0.3, D0 * sp - it.tall);
    return it.type === 'ring'
      ? { x0: Math.min(-it.R - 0.3, -half), x1: Math.max(it.R + 0.3, half), z0: -it.R - 0.3 - label, z1: it.R + 0.3 + up }
      : { x0: Math.min(-0.866 * it.a - 0.3, -half), x1: Math.max(0.866 * it.b + 0.3, half), z0: -0.2 - label, z1: 0.5 * (it.a + it.b) + 0.2 + up };
  };
  const placed = [];
  const pad = 0.3;
  const free = (e, x, z) => placed.every((o) => x + e.x1 + pad < o.x + o.x0 || x + e.x0 - pad > o.x + o.x1 || z + e.z1 + pad < o.z + o.z0 || z + e.z0 - pad > o.z + o.z1);
  for (const it of items) {
    let x = 0;
    let z = 0;
    let e = ext(it, 0);
    for (let t = 0; t < 4000 && placed.length; t++) {
      const ang = t * 0.31;
      const r = 0.05 * t;
      // Deeper than wide: the ground is seen at a slant, so depth comes
      // out short on the screen, and a phone is held upright.
      x = Math.cos(ang) * r;
      z = Math.sin(ang) * r * 2.6;
      e = ext(it, z);
      if (free(e, x, z)) break;
    }
    Object.assign(it, e, { x, z });
    placed.push(it);
  }
  const box = items.reduce((b, it) => ({
    x0: Math.min(b.x0, it.x + it.x0),
    x1: Math.max(b.x1, it.x + it.x1),
    z0: Math.min(b.z0, it.z + it.z0),
    z1: Math.max(b.z1, it.z + it.z1),
  }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  return items.length ? box : { x0: -1, x1: 1, z0: -1, z1: 1 };
}

// Where to stand to see the whole map, in the middle of the screen: the
// nearest back far enough that its near edge fits across and it fits top
// to bottom (the far side is smaller, so it takes less of the screen).
const startK = () => st.base * zoomOf(st.kind);
function fitView() {
  const b = st.box;
  const sig = `${st.kind}|${st.key}|${st.w}x${st.h}`;
  if (st.fit && st.fit.sig === sig) return st.fit;
  const x = (b.x0 + b.x1) / 2;
  // Each one's patch of ground (with its name in front and room behind
  // for what stands up), on the screen.
  const spread = (L) => {
    let out = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const it of st.items) {
      for (const [gx, gz] of [[it.x0, it.z0], [it.x1, it.z0], [it.x0, it.z1], [it.x1, it.z1]]) {
        const p = L.P(it.x + gx, 0, it.z + gz);
        if (!p) return null;
        out = { x0: Math.min(out.x0, p[0]), x1: Math.max(out.x1, p[0]), y0: Math.min(out.y0, p[1]), y1: Math.max(out.y1, p[1]) };
      }
    }
    return out;
  };
  // Looking at the spot that puts it all in the middle, top to bottom and
  // side to side.
  const place = (D) => {
    let found = null;
    let gx = x;
    for (let pass = 0; pass < 3; pass++) {
      let lo = b.z0;
      let hi = b.z1;
      for (let i = 0; i < 24; i++) {
        const z = (lo + hi) / 2;
        const s = spread(lens({ T: [gx, 0, z], D, pitch: PITCH }));
        if (!s) {
          lo = z;
          continue;
        }
        found = { x: gx, z, s };
        // Sitting low on the screen: look a little nearer.
        if ((s.y0 + s.y1) / 2 > st.h / 2) hi = z;
        else lo = z;
      }
      if (!found) break;
      gx += (((found.s.x0 + found.s.x1) / 2 - st.w / 2) * D) / st.F;
    }
    return found;
  };
  const fits = (D) => {
    const e = place(D);
    if (!e) return null;
    const { s } = e;
    const ok = s.y1 < st.h * 0.96 && s.y0 > st.h * 0.03 && s.x0 > st.w * 0.02 && s.x1 < st.w * 0.98;
    return ok ? { x: e.x, z: e.z, D } : null;
  };
  let lo = 0.5;
  let hi = 400;
  let best = fits(hi) || { x, z: (b.z0 + b.z1) / 2, D: hi };
  for (let i = 0; i < 30; i++) {
    const D = Math.sqrt(lo * hi);
    const f = fits(D);
    if (f) {
      best = f;
      hi = D;
    } else lo = D;
  }
  st.fit = { ...best, sig, place };
  return st.fit;
}
function range() {
  const d = st.F / startK();
  return { lo: d / CLOSEST, hi: Math.max(d / FARTHEST, fitView().D * 1.25) };
}

// The middle of everything at the start, or where this map was left.
function update(kind, list, key) {
  const fresh = kind !== st.kind || key !== st.key;
  if (st.kind && st.items.length) st.cams[st.kind] = { ...st.cam };
  st.kind = kind;
  if (fresh) {
    st.items = list.map((x) => (kind === 'orgs' ? buildingItem(x) : ringItem(x)));
    st.box = layout(st.items, startK());
    st.key = key;
  }
  const kept = st.cams[kind];
  st.cam = kept ? { ...kept } : startCam();
  st.vel = { x: 0, z: 0 };
  holdIn();
  const n = st.items.length;
  const what = kind === 'orgs' ? (n === 1 ? 'one organization' : `${n} organizations`) : n === 1 ? 'one circle' : `${n} circles`;
  st.cv.setAttribute('aria-label', `A map of your ${kind === 'orgs' ? 'organizations as buildings' : 'circles, each a ring of its people'}, ${what}. Drag to move around, pinch to zoom in and out, tap one to go in.`);
}

// At the start: the whole map, filling the screen, unless that's so far
// back the people are hard to see (then as close as that, in the middle
// of it) or, for a few, so close they're huge.
function startCam() {
  const f = fitView();
  const d = st.F / startK();
  const D = clamp(f.D, d / 1.5, d / 0.75);
  const at = D === f.D ? f : f.place(D);
  const b = st.box;
  return at ? { x: at.x, z: at.z, D } : { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, D };
}

// Not so far off that everything's gone: the middle of the screen stays
// over the map. Not too close, or too far back.
function limits() {
  const b = st.box;
  const r = range();
  return { x: [b.x0, b.x1], z: [b.z0, b.z1], D: [r.lo, r.hi] };
}
function holdIn() {
  if (!st.box || !st.w) return;
  st.cam.D = clamp(st.cam.D, ...limits().D);
  const L = limits();
  st.cam.x = clamp(st.cam.x, L.x[0], L.x[1]);
  st.cam.z = clamp(st.cam.z, L.z[0], L.z[1]);
}

export function mountMap(slot, { kind = 'circles', items = [], key = '' } = {}, { onOpen, from = null } = {}) {
  if (!st.el) build();
  st.onOpen = onOpen;
  slot.appendChild(st.el);
  resize();
  update(kind, items, key);
  st.fly = null;
  st.ptrs.clear();
  st.drag = null;
  st.pinch = null;
  // Back out of a circle or building: start in close and pull back.
  const it = from && st.items.find((x) => x.id === from);
  if (it && !reduced.matches) startFly(it, true);
  draw();
  kick();
}

// For tests: move time on by hand (a hidden test browser runs no frames).
export function mapStep(seconds = 0, set = {}) {
  Object.assign(st, set);
  for (let s = 0; s < seconds; s += 1 / 60) step(1 / 60);
  draw();
}

const r2 = (v) => Math.round(v * 100) / 100;
export function mapInfo() {
  return {
    kind: st.kind,
    D: r2(st.cam.D),
    k: r2(st.F / st.cam.D),
    cam: { x: r2(st.cam.x), z: r2(st.cam.z) },
    range: range(),
    box: st.box,
    fly: st.fly && { id: st.fly.id, out: st.fly.out, t: r2(st.fly.t) },
    items: st.items.map((it) => ({ id: it.id, name: it.name, x: r2(it.x), z: r2(it.z), R: it.R, floors: it.floors })),
    hits: st.hits.map((h) => ({ id: h.id, x: Math.round((h.x0 + h.x1) / 2), y: Math.round((h.y0 + h.y1) / 2) })),
  };
}

// Where to fly to for each: the middle of a ring, close enough to be in
// it; or one of a building's windows, close enough that it fills the
// screen, looking at it more nearly straight on.
function aimAt(it) {
  if (it.type === 'building') {
    const win = windowSpot(it);
    return { at: win.c, D: clamp((st.F * win.size) / (st.w * 2.8), 0.08, st.cam.D / 8), pitch: 0.32 };
  }
  return { at: [it.x, 0.4, it.z], D: clamp((st.F * (it.R * 2 + 0.6)) / (st.w * 1.6), 0.5, st.cam.D), pitch: PITCH };
}

function startFly(it, out) {
  const aim = aimAt(it);
  const here = { T: [st.cam.x, 0, st.cam.z], D: st.cam.D, pitch: PITCH };
  const there = { T: aim.at, D: aim.D, pitch: aim.pitch };
  const [a, b] = out ? [there, here] : [here, there];
  // What you fly at slides across the screen evenly as you go, so it
  // never swings off the edge on the way.
  const off = (c) => c.T.map((v, i) => (aim.at[i] - v) / c.D);
  st.fly = { id: it.id, out, t: 0, at: aim.at, D0: a.D, D1: b.D, p0: a.pitch, p1: b.pitch, off0: off(a), off1: off(b) };
}

function go(it) {
  if (!it || st.fly) return;
  if (reduced.matches) {
    if (st.onOpen) st.onOpen(it.id);
    return;
  }
  st.vel = { x: 0, z: 0 };
  startFly(it, false);
  kick();
}

// ---------------------------------------------------------------------------
// The camera and its lens.

// The camera now, flying or not: what it looks at (up off the ground, for
// a window), how far back it is, how steeply it looks down, and how far in.
function camera() {
  const f = st.fly;
  if (!f) return { T: [st.cam.x, 0, st.cam.z], D: st.cam.D, pitch: PITCH, p: 0 };
  const e = ease(clamp(f.t, 0, 1));
  const D = f.D0 * Math.pow(f.D1 / f.D0, e);
  const T = f.at.map((v, i) => v - mix(f.off0[i], f.off1[i], e) * D);
  return { T, D, pitch: mix(f.p0, f.p1, e), p: f.out ? 1 - e : e };
}
const here = () => ({ T: [st.cam.x, 0, st.cam.z], D: st.cam.D, pitch: PITCH });

// From the ground to the screen (P: a point to [x, y, its depth], or null
// when it's behind you), and back (ground: the spot under a point on the
// screen).
function lens(c) {
  const sp = Math.sin(c.pitch);
  const cp = Math.cos(c.pitch);
  const C = [c.T[0], c.T[1] + c.D * sp, c.T[2] - c.D * cp];
  const F = st.F;
  const cx = st.w / 2;
  const cy = st.h / 2;
  const P = (x, y, z) => {
    const dy = y - C[1];
    const dz = z - C[2];
    const zc = dz * cp - dy * sp;
    if (zc < NEAR) return null;
    return [cx + (F * (x - C[0])) / zc, cy - (F * (dy * cp + dz * sp)) / zc, zc];
  };
  const ground = (sx, sy) => {
    const u = -(sy - cy) / F;
    const dy = Math.min(u * cp - sp, -0.02);
    const t = -C[1] / dy;
    return [C[0] + ((sx - cx) / F) * t, C[2] + (u * sp + cp) * t];
  };
  return { P, ground, F };
}

// ---------------------------------------------------------------------------
// Touch: drag the map about (it runs on a little when let go), pinch it in
// and out; tap one to go in.

const rel = (e) => {
  const r = st.cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

// A finger down or up: one finger moves the map, two pinch it.
function grip(moved) {
  const pts = [...st.ptrs.entries()];
  const L = lens(here());
  st.drag = null;
  st.pinch = null;
  if (pts.length >= 2) {
    const [a, b] = [pts[0][1], pts[1][1]];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    st.pinch = { ids: [pts[0][0], pts[1][0]], d0: Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1])), D0: st.cam.D, G: L.ground(...mid) };
  } else if (pts.length === 1) {
    const [id, p] = pts[0];
    st.drag = { id, p0: p, T0: { x: st.cam.x, z: st.cam.z }, G0: L.ground(...p), moved, t: performance.now(), v: { x: 0, z: 0 } };
  }
}

// The ground under the finger stays under it.
function dragMove() {
  const d = st.drag;
  const p = st.ptrs.get(d.id);
  if (!d.moved) {
    if (Math.hypot(p[0] - d.p0[0], p[1] - d.p0[1]) < 7) return;
    d.moved = true;
  }
  const g = lens({ T: [d.T0.x, 0, d.T0.z], D: st.cam.D, pitch: PITCH }).ground(...p);
  const x = d.T0.x + d.G0[0] - g[0];
  const z = d.T0.z + d.G0[1] - g[1];
  const now = performance.now();
  const dt = Math.max(1, now - d.t) / 1000;
  d.v.x = mix(d.v.x, (x - st.cam.x) / dt, 0.35);
  d.v.z = mix(d.v.z, (z - st.cam.z) / dt, 0.35);
  d.t = now;
  st.cam.x = x;
  st.cam.z = z;
  holdSoft();
  kick();
}

// Two fingers: closer or farther by how far apart they go, and the ground
// between them stays between them.
function pinchMove() {
  const P = st.pinch;
  const a = st.ptrs.get(P.ids[0]);
  const b = st.ptrs.get(P.ids[1]);
  if (!a || !b) return;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dist = Math.max(20, Math.hypot(a[0] - b[0], a[1] - b[1]));
  const [lo, hi] = limits().D;
  const D = (P.D0 * P.d0) / dist;
  st.cam.D = D < lo ? lo * Math.pow(D / lo, 0.3) : D > hi ? hi * Math.pow(D / hi, 0.3) : D;
  const g = lens(here()).ground(...mid);
  st.cam.x += P.G[0] - g[0];
  st.cam.z += P.G[1] - g[1];
  holdSoft();
  kick();
}

function wire(cv) {
  cv.addEventListener('pointerdown', (e) => {
    if (e.button || st.fly) return;
    st.ptrs.set(e.pointerId, rel(e));
    try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
    st.vel = { x: 0, z: 0 };
    // A second finger turns a drag into a pinch (and never a tap).
    grip(st.ptrs.size > 1);
    kick();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!st.ptrs.has(e.pointerId)) return;
    st.ptrs.set(e.pointerId, rel(e));
    if (st.pinch) pinchMove();
    else if (st.drag && st.drag.id === e.pointerId) dragMove();
  });
  const end = (e) => {
    if (!st.ptrs.has(e.pointerId)) return;
    st.ptrs.delete(e.pointerId);
    const d = st.drag;
    if (st.pinch) {
      // One finger left on: it carries on moving the map.
      grip(true);
    } else if (d && d.id === e.pointerId) {
      st.drag = null;
      if (d.moved) {
        const most = st.cam.D * 0.8;
        if (performance.now() - d.t < 90) st.vel = { x: clamp(d.v.x, -most, most), z: clamp(d.v.z, -most, most) };
      } else if (e.type === 'pointerup') {
        tap(...rel(e));
      }
    }
    kick();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  // Safari's own pinch would zoom the page instead.
  cv.addEventListener('gesturestart', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (st.fly) return;
    const p = rel(e);
    if (e.ctrlKey) {
      // A pinch on a trackpad: in and out about the pointer.
      const G = lens(here()).ground(...p);
      st.cam.D = clamp(st.cam.D * Math.exp(e.deltaY * 0.01), ...limits().D);
      const g = lens(here()).ground(...p);
      st.cam.x += G[0] - g[0];
      st.cam.z += G[1] - g[1];
    } else {
      const k = st.F / st.cam.D;
      st.cam.x += e.deltaX / k;
      st.cam.z -= e.deltaY / (k * Math.sin(PITCH));
    }
    holdIn();
    kick();
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (step) {
      e.preventDefault();
      st.vel = { x: step[0] * st.cam.D * 0.25, z: step[1] * st.cam.D * 0.4 };
      kick();
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();
      st.cam.D = clamp(st.cam.D * (e.key === '-' ? 1.25 : 0.8), ...limits().D);
      holdIn();
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
  st.cam.z = give(st.cam.z, L.z[0], L.z[1]);
}

function tap(x, y) {
  const hit = st.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
  if (hit) go(st.items.find((it) => it.id === hit.id));
}

function nearest() {
  let best = null;
  for (const it of st.items) {
    const d = Math.hypot(it.x + it.mx - st.cam.x, it.z + it.mz - st.cam.z);
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

const moving = () => (st.drag && st.drag.moved) || st.pinch || (st.fly && !st.fly.done) || Math.abs(st.vel.x) + Math.abs(st.vel.z) > 0.01 || outside();
function outside() {
  if (!st.box) return false;
  const L = limits();
  const out = (v, [lo, hi]) => v < lo - 0.001 || v > hi + 0.001;
  return out(st.cam.x, L.x) || out(st.cam.z, L.z) || out(st.cam.D, L.D);
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
      if (f.out) st.fly = null;
      else {
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
  if (st.drag || st.pinch) return;
  if (st.vel.x || st.vel.z) {
    st.cam.x += st.vel.x * dt;
    st.cam.z += st.vel.z * dt;
    const decay = Math.exp(-3 * dt);
    st.vel.x *= decay;
    st.vel.z *= decay;
    if (Math.abs(st.vel.x) + Math.abs(st.vel.z) < 0.01) st.vel = { x: 0, z: 0 };
  }
  // Past the edge, or pinched too far: back, softly.
  const L = limits();
  const pull = (v, [lo, hi]) => (v < lo ? v + (lo - v) * Math.min(1, 9 * dt) : v > hi ? v + (hi - v) * Math.min(1, 9 * dt) : v);
  const x = pull(st.cam.x, L.x);
  const z = pull(st.cam.z, L.z);
  if (x !== st.cam.x) st.vel.x = 0;
  if (z !== st.cam.z) st.vel.z = 0;
  st.cam.x = x;
  st.cam.z = z;
  st.cam.D = pull(st.cam.D, L.D);
}

// ---------------------------------------------------------------------------
// Drawing

const line = (a, b, n) => Array.from({ length: n }, (_, i) => a.map((v, j) => mix(v, b[j], i / (n - 1))));
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
  const L = lens(cam);
  const k0 = startK();
  const flying = st.fly ? st.fly.id : null;
  // Flying in, the others fade away; the one you're going into stays.
  const others = flying ? 1 - clamp(cam.p * 1.6, 0, 1) : 1;
  // Farther off, a little fainter, like the far side of People's ring.
  const far = (zc) => clamp(1.3 - 0.3 * (zc / cam.D), 0.5, 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pen = { ctx, ink, paper, dark, colours, L, far };
  // Where each is, and whether it's on the screen at all.
  const where = new Map();
  for (const it of st.items) {
    const c = L.P(it.x + it.mx, 0, it.z + it.mz);
    let on = !!c;
    if (c) {
      const r = (it.reach * L.F) / c[2];
      on = c[0] + r > -30 && c[0] - r < w + 30 && c[1] + r > -30 && c[1] - r < h + 30;
    }
    if (on || it.id === flying) where.set(it.id, { zc: c ? c[2] : cam.D, box: null });
  }
  const grow = (box, x0, y0, x1, y1) => (box ? { x0: Math.min(box.x0, x0), y0: Math.min(box.y0, y0), x1: Math.max(box.x1, x1), y1: Math.max(box.y1, y1) } : { x0, y0, x1, y1 });

  if (st.kind === 'orgs') {
    const order = st.items.filter((it) => where.has(it.id)).sort((a, b) => where.get(b.id).zc - where.get(a.id).zc);
    for (const it of order) {
      const W = where.get(it.id);
      ctx.globalAlpha = (it.id === flying ? 1 : others) * far(W.zc);
      W.box = drawBuilding(pen, it, W.zc);
    }
  } else {
    // Everyone from every ring, back to front, so the near ones cross
    // over the far ones.
    const sway = reduced.matches ? 0 : 0.03 * Math.sin(st.t * 1.25);
    const figs = [];
    for (const it of st.items) {
      const W = where.get(it.id);
      if (!W) continue;
      const alpha = it.id === flying ? 1 : others;
      if (!it.people.length) {
        W.box = drawEmptyRing(pen, it, alpha);
        continue;
      }
      const ring = it.people.map((p) => {
        const fx = it.x + Math.cos(p.th) * it.R;
        const fz = it.z - Math.sin(p.th) * it.R;
        const foot = L.P(fx, 0, fz);
        const head = L.P(fx, p.size, fz);
        if (!foot || !head || foot[1] - head[1] < 1.5) return null;
        const [sx, sy, zc] = foot;
        const hp = sy - head[1];
        const put = ([u, v]) => [sx + (u + sway * v * (0.55 + 0.45 * v)) * hp, sy - v * hp];
        const kind = p.figure || 'person';
        W.box = grow(W.box, sx - hp * 0.32, sy - hp * 1.02, sx + hp * 0.32, sy + 4);
        // They face into the ring: the near side has its back to you, the
        // far side faces you, so which hand is on which side swaps.
        const facing = Math.sin(p.th) < 0;
        return { p, it, sx, sy, zc, hp, put, kind, alpha: alpha * far(zc), back: Math.sin(p.th) < -0.2, right: facing ? 0 : 1, sh: armRoots(kind).map(put), hands: [null, null] };
      });
      // Hands: each one's right with the next one's left, round the ring
      // (two people just hold the one pair). Always the same pairs, so
      // nobody swaps hands as the map moves.
      const n = ring.length;
      const pairs = n === 2 ? 1 : n > 2 ? n : 0;
      for (let i = 0; i < pairs; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        if (!a || !b) continue;
        const hand = handBetween(a.sh[a.right], ARM * a.hp, b.sh[1 - b.right], ARM * b.hp);
        a.hands[a.right] = hand;
        b.hands[1 - b.right] = hand;
      }
      figs.push(...ring.filter(Boolean));
    }
    figs.sort((a, b) => b.zc - a.zc);
    for (const f of figs) drawFigure(pen, f);
  }

  // Names under each, and how many, over everything: the nearest first,
  // and one that would land on another slides aside, or down, to clear it.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const tags = [];
  for (const it of st.items) {
    if (!where.has(it.id)) continue;
    const a = it.type === 'ring' ? L.P(it.x, 0, it.z - it.R - 0.3) : L.P(it.x, 0, it.z - 0.15);
    if (a) tags.push({ it, a });
  }
  tags.sort((p, q) => p.a[2] - q.a[2]);
  const taken = [];
  for (const { it, a } of tags) {
    const W = where.get(it.id);
    const alpha = it.id === flying ? 1 - clamp(cam.p * 3, 0, 1) : others;
    const sc = clamp(Math.sqrt(L.F / a[2] / k0), 0.78, 1.2);
    let size = Math.round(17 * sc);
    const small = Math.round(13 * sc);
    const maxW = LABEL_W * sc;
    ctx.font = `${size}px ${FONT}`;
    let label = it.name;
    while (ctx.measureText(label).width > maxW && size > 13) {
      size -= 1;
      ctx.font = `${size}px ${FONT}`;
    }
    while (ctx.measureText(label).width > maxW && label.length > 4) label = `${label.slice(0, -2).trimEnd()}…`;
    const n = it.type === 'ring' ? it.count : it.n;
    const sub = n ? `${n} ${n === 1 ? 'person' : 'people'}` : 'Nobody yet';
    const tw = Math.max(ctx.measureText(label).width, sub.length * small * 0.46);
    const hh = size + small + 2;
    const at = (dx, dy) => ({ x: a[0] + dx, y0: a[1] + 6 + dy, x0: a[0] + dx - tw / 2 - 3, x1: a[0] + dx + tw / 2 + 3, y1: a[1] + 6 + dy + hh });
    const hits = (bx) => taken.find((b) => b.x0 < bx.x1 && bx.x0 < b.x1 && b.y0 < bx.y1 && bx.y0 < b.y1);
    let box = at(0, 0);
    const other = hits(box);
    if (other) {
      const right = other.x1 - box.x0 + 2;
      const left = other.x0 - box.x1 - 2;
      const tries = [at(Math.abs(left) < right ? left : right, 0), at(Math.abs(left) < right ? right : left, 0), at(0, other.y1 - box.y0 + 2)];
      box = tries.find((t) => Math.abs(t.x - a[0]) < tw && !hits(t)) || box;
    }
    taken.push(box);
    W.box = grow(W.box, box.x0, box.y0, box.x1, box.y1);
    if (alpha <= 0.02) continue;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 4;
    ctx.strokeStyle = paper;
    ctx.strokeText(label, box.x, box.y0);
    ctx.fillStyle = textInk;
    ctx.fillText(label, box.x, box.y0);
    ctx.font = `${small}px ${FONT}`;
    ctx.strokeText(sub, box.x, box.y0 + size + 1);
    ctx.fillStyle = dim;
    ctx.fillText(sub, box.x, box.y0 + size + 1);
  }
  ctx.globalAlpha = 1;
  // For taps: what each covers, the nearest first.
  if (!flying) {
    for (const it of st.items) {
      const W = where.get(it.id);
      if (W && W.box) st.hits.push({ id: it.id, zc: W.zc, ...W.box });
    }
    st.hits.sort((a, b) => a.zc - b.zc);
  }
  // Flying into a building: its window grows round the screen.
  if (st.fly && st.kind === 'orgs') {
    const it = st.items.find((x) => x.id === st.fly.id);
    if (it) drawWindowFill(pen, it, cam.p);
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
}

function drawFigure(pen, f) {
  const { ctx, paper, dark, colours, ink } = pen;
  const { p, hp } = f;
  const path = new Path2D();
  trace(path, shake(bodyLine(f.kind, hp > 70, f.put, f.hands, hp), p.seed, clamp(0.006 * hp, 0.22, 1.2)));
  const sash = bodySash(f.kind, f.put, hp);
  if (sash) trace(path, shake(sash, p.seed + 3, clamp(0.005 * hp, 0.2, 1)));
  const lw = clamp(hp / 30, 0.9, 2.6);
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

// Points on the screen, in runs: a line that goes behind you is cut there.
function runs(L, pts) {
  const out = [];
  let cur = [];
  for (const q of pts) {
    const p = L.P(q[0], q[1], q[2]);
    if (p) cur.push(p);
    else {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
const boxOf = (pts) => pts.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

// A circle with nobody in it yet: just where the ring would be.
function drawEmptyRing(pen, it, alpha) {
  const { ctx, ink, L, far } = pen;
  const pts = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 39) * TAU * 1.04;
    return [it.x + Math.cos(a) * it.R, 0, it.z + Math.sin(a) * it.R];
  });
  const lines = runs(L, pts);
  if (!lines.length) return null;
  const path = new Path2D();
  for (const run of lines) trace(path, shake(run, hashStr(it.id), 0.6));
  const mid = L.P(it.x, 0, it.z);
  ctx.globalAlpha = alpha * 0.6 * (mid ? far(mid[2]) : 1);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.stroke(path);
  ctx.setLineDash([]);
  const b = boxOf(lines.flat());
  return { x0: b.x0, y0: b.y0 - 24, x1: b.x1, y1: b.y1 };
}

// ---------------------------------------------------------------------------
// Buildings: from the front corner, a left side running back to the left
// (L), a right side running back to the right (R), and the roof between
// (T), each at a height.

function faces(it) {
  const { a, b, x, z } = it;
  const L = (t, y) => [x - 0.866 * a * t, y, z + 0.5 * a * t];
  const R = (t, y) => [x + 0.866 * b * t, y, z + 0.5 * b * t];
  const T = (u, v, y) => [x - 0.866 * a * u + 0.866 * b * v, y, z + 0.5 * a * u + 0.5 * b * v];
  return { L, R, T };
}

// The window to fly in at: on the right side, about the middle floor.
function windowSpot(it) {
  const { R } = faces(it);
  const fl = Math.floor((it.floors - 1) / 2);
  const z0 = 0.12 + fl * it.floor + it.floor * 0.28;
  const z1 = z0 + it.floor * 0.46;
  const cols = winCols(it.b);
  const c = Math.floor((cols - 1) / 2);
  const [t0, t1] = winSpan(c, cols);
  return { c: R((t0 + t1) / 2, (z0 + z1) / 2), size: Math.max(it.b * (t1 - t0), z1 - z0), t0, t1, z0, z1 };
}
const winCols = (len) => clamp(Math.round(len / 0.32), 2, 5);
const winSpan = (c, cols) => [(c + 0.22) / cols, (c + 0.78) / cols];

function drawBuilding(pen, it, zc) {
  const { ctx, ink, paper, L: lensOf } = pen;
  const { L, R, T } = faces(it);
  const { H } = it;
  const strokes = [];
  const add = (pts, w = 1.7) => strokes.push({ pts, w });
  // The outline, round in one go: front corner, along the right, up, over
  // the back, down the left and back to the front.
  add(chain([L(0, 0), R(1, 0), R(1, H), T(1, 1, H), L(1, H), L(1, 0), L(0, 0), L(0, H)], 7), 1.9);
  add(chain([L(1, H), T(0, 0, H), R(1, H)], 7), 1.9);
  // Windows, a row to a floor, on both sides; a door on the left.
  const win = (F, t0, t1, z0, z1) => add(chain([F(t0, z0), F(t1, z0), F(t1, z1), F(t0, z1), F(t0, z0 + (z1 - z0) * 0.25)], 4), 1.3);
  const groundDoor = it.roof !== 'shop' && it.roof !== 'stage';
  for (let f = 0; f < it.floors; f++) {
    const z0 = 0.12 + f * it.floor + it.floor * 0.28;
    const z1 = z0 + it.floor * 0.46;
    [[R, it.b], [L, it.a]].forEach(([F, len]) => {
      const cols = winCols(len);
      for (let c = 0; c < cols; c++) {
        if (f === 0 && F === L && groundDoor && c === Math.floor(cols / 2)) continue;
        if (f === 0 && F === R && (it.roof === 'shop' || it.roof === 'stage')) continue;
        const [t0, t1] = winSpan(c, cols);
        win(F, t0, t1, z0, z1);
      }
    });
  }
  if (groundDoor) {
    const cols = winCols(it.a);
    const c = Math.floor(cols / 2);
    const [t0, t1] = winSpan(c, cols);
    add(chain([L(t0, 0), L(t0, it.floor * 0.8), L(t1, it.floor * 0.8), L(t1, 0)], 4), 1.4);
  }
  // The roof, or what's on it, by kind.
  if (it.roof === 'tank') {
    // A water tank on legs: a round tub with a pointed lid.
    const [cx, , cz] = T(0.55, 0.5, H);
    const r = 0.13;
    const y0 = H + 0.14;
    add([[cx - r * 0.8, H, cz], [cx - r * 0.8, y0, cz]], 1.2);
    add([[cx + r * 0.8, H, cz], [cx + r * 0.8, y0, cz]], 1.2);
    const tub = Array.from({ length: 15 }, (_, i) => {
      const ang = Math.PI * (i / 14);
      return [cx - Math.cos(ang) * r, y0, cz - Math.sin(ang) * r];
    });
    add([...tub, [cx + r, y0 + 0.2, cz], [cx, y0 + 0.27, cz], [cx - r, y0 + 0.2, cz], [cx - r, y0, cz]], 1.4);
  } else if (it.roof === 'aerial') {
    const c = T(0.5, 0.5, H);
    const up = (dx, y) => [c[0] + dx, y, c[2]];
    add(chain([c, up(0, H + 0.5)], 6), 1.3);
    add(chain([up(-0.1, H + 0.3), up(0.1, H + 0.34)], 3), 1.2);
    add(chain([up(-0.06, H + 0.42), up(0.06, H + 0.44)], 3), 1.2);
  } else if (it.roof === 'saw') {
    // Teeth along the top, up over the left edge.
    const n = 3;
    const teeth = [];
    for (let i = 0; i < n; i++) teeth.push(T(0, i / n, H), T(0, (i + 0.15) / n, H + 0.3), T(0, (i + 1) / n, H));
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
    const out = (p) => [p[0] + 0.06, p[1] - 0.03, p[2] - 0.1];
    const scallop = [];
    const n = 4;
    for (let i = 0; i <= n * 8; i++) {
      const t = 0.08 + (0.84 * i) / (n * 8);
      const dip = Math.abs(Math.sin((i / 8) * Math.PI)) * 0.07;
      scallop.push(out(R(t, fl * 0.74 - dip)));
    }
    add([R(0.08, fl * 0.95), out(R(0.08, fl * 0.74)), ...scallop, out(R(0.92, fl * 0.74)), R(0.92, fl * 0.95)], 1.4);
    add(chain([R(0.15, H), R(0.15, H + 0.22), R(0.85, H + 0.22), R(0.85, H)], 5), 1.4);
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
  // On the screen, each line with a little paper round it, then the ink;
  // thicker the nearer it is.
  const K = lensOf.F / zc;
  const amp = clamp(0.012 * K, 0.3, 1.6);
  const paths = [];
  let box = null;
  strokes.forEach((s, i) => {
    runs(lensOf, s.pts).forEach((run, j) => {
      const path = new Path2D();
      trace(path, shake(run, it.seed + i * 7 + j * 3, amp));
      paths.push({ path, w: s.w });
      const b = boxOf(run);
      box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    });
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = paper;
  for (const s of paths) {
    ctx.lineWidth = s.w + 2.6;
    ctx.stroke(s.path);
  }
  ctx.strokeStyle = ink;
  const thick = clamp(K / 40, 0.85, 1.8);
  for (const s of paths) {
    ctx.lineWidth = s.w * thick;
    ctx.stroke(s.path);
  }
  return box;
}

// Going in at a building's window: the window's frame grows past the
// edges of the screen, with the paper inside.
function drawWindowFill(pen, it, p) {
  const { ctx, ink, paper, L } = pen;
  const win = windowSpot(it);
  const { R } = faces(it);
  const corners = [R(win.t0, win.z0), R(win.t1, win.z0), R(win.t1, win.z1), R(win.t0, win.z1)].map((q) => L.P(...q));
  if (corners.some((c) => !c)) return;
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
