// People, on a phone: everyone drawn in one loose line, holding hands in a
// ring. The front of the ring is the list (in its sort, after its search and
// filters) from left to right; the ring runs on behind them, smaller in the
// distance, and round again. A short list is made up to a full ring with
// faint people who aren't anyone. A sideways swipe turns the ring.
//
// How big someone is says how close you are (the app works that out); each
// is drawn as a man with a tie, a woman in a dress, or a person like the one
// on a sign. They sway together a little, and lean back against a swipe as
// if pulled along, swinging past upright when it stops.

const TAU = Math.PI * 2;
const GAP = 0.6; // from one person to the next, in their heights
const AROUND = 14; // the ring's length, in heights
const EYE = 3; // the camera's distance from the front of the ring, in heights
const ARM = 0.4; // an arm's length, in its owner's height
const FRONT = 0.56; // the biggest figure at the front, in stage heights
const BACK = 0.3; // where the far side's feet are, in stage heights from the top
const FEET = 34; // room under the front row's feet for their names, in pixels

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x) {
  const i = Math.floor(x);
  return mix(hash1(i), hash1(i + 1), smooth(x - i)) * 2 - 1;
}
// How light a colour is, 0 to 1: on a dark page the far side is drawn
// stronger, or it disappears.
function lightness(c) {
  let rgb;
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const n = parseInt(hex[1], 16);
    rgb = [n >> 16, (n >> 8) & 255, n & 255];
  } else {
    rgb = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    if (rgb.length < 3) return 1;
  }
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}
function hashStr(s) {
  let h = 7;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h;
}

// ---------------------------------------------------------------------------
// The figures: each is one line round the body, the way a one-line contour
// drawing goes: from the left hand along the top of the arm, over the
// shoulder, up the neck and round the head, down and over the other
// shoulder, out to the right hand and back under the arm, down the side,
// round the legs (a loop at each foot) or under a dress, and up the other
// side to the left hand again. In their own heights: feet at 0, the top of
// the head at 1. The arms are worked out every frame, out to wherever the
// hands are, so the body is kept apart from them.

// Catmull-Rom through some points, for a soft line.
function spline(ctrl, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * (ctrl.length - 1);
    const k = Math.min(ctrl.length - 2, Math.floor(f));
    const t = f - k;
    const p0 = ctrl[Math.max(0, k - 1)];
    const p1 = ctrl[k];
    const p2 = ctrl[k + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, k + 2)];
    out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t * t * t)));
  }
  return out;
}
function arc(cx, cy, rx, ry, a0, a1, n) {
  return Array.from({ length: n }, (_, i) => {
    const a = mix(a0, a1, i / (n - 1));
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
}
// A small loop where the pen turns, round a point.
function loopAround(cx, cy, r, a0, turn, n) {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + turn * (i / (n - 1)) * TAU * 1.05;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}
const flipX = (pts) => pts.map(([x, y]) => [-x, y]).reverse();

// Shoulder top, armpit, waist and hips, by kind: broad and squared for the
// man, narrow with a dress for the woman, in between for the person.
const BUILD = {
  man: { sh: [0.13, 0.748], pit: [0.092, 0.668], waist: [0.078, 0.51], hip: [0.088, 0.42] },
  woman: { sh: [0.1, 0.748], pit: [0.074, 0.668], waist: [0.056, 0.535] },
  person: { sh: [0.112, 0.748], pit: [0.084, 0.668], waist: [0.082, 0.51], hip: [0.088, 0.42] },
};

const bodies = new Map();
function bodyOf(kind, fine) {
  const key = `${kind}|${fine}`;
  if (bodies.has(key)) return bodies.get(key);
  const B = BUILD[kind] || BUILD.person;
  const q = fine ? 1 : 0.5;
  const N = (n) => Math.max(4, Math.round(n * q));
  // Over the top: left shoulder, neck, the head round from the left, neck,
  // (the man's tie), right shoulder.
  const shoulder = spline([[-B.sh[0], B.sh[1]], [-B.sh[0] * 0.62, B.sh[1] + 0.03], [-0.03, 0.776]], N(8));
  const neckL = spline([[-0.03, 0.776], [-0.026, 0.8], [-0.024, 0.818]], N(4)).slice(1);
  const head = arc(0, 0.9, 0.062, 0.082, Math.PI * 1.36, -Math.PI * 0.41, N(30));
  const neckR = spline([[0.022, 0.82], [0.026, 0.8], [0.03, 0.776]], N(4));
  let tie = [];
  if (kind === 'man' && fine) {
    tie = [
      ...spline([[0.03, 0.776], [0.012, 0.77], [0.004, 0.758]], 5),
      ...loopAround(0.004, 0.746, 0.012, Math.PI / 2, -1, 12),
      ...spline([[0.004, 0.735], [-0.02, 0.705], [-0.006, 0.62], [0, 0.585], [0.007, 0.62], [0.021, 0.705], [0.03, 0.772]], 16),
    ];
  }
  const top = [...shoulder, ...neckL, ...head, ...neckR, ...tie, ...flipX(shoulder)];
  // Round the bottom, from the right armpit to the left one.
  const foot = (x, side) => loopAround(x, 0.03, 0.02, side > 0 ? -Math.PI / 2 : -Math.PI / 2, side, N(12));
  let low;
  if (kind === 'woman') {
    const side = spline([[B.pit[0], B.pit[1]], [0.078, 0.6], [B.waist[0], B.waist[1]], [0.1, 0.42], [0.168, 0.2]], N(14));
    const legR = [
      ...spline([[0.168, 0.2], [0.11, 0.185], [0.062, 0.19], [0.056, 0.1], [0.052, 0.045]], N(10)),
      ...foot(0.036, 1),
      ...spline([[0.022, 0.045], [0.022, 0.12], [0.022, 0.188], [0, 0.18]], N(7)),
    ];
    low = [...side, ...legR, ...flipX(legR).slice(1), ...flipX(side)];
  } else {
    const side = spline([[B.pit[0], B.pit[1]], [B.waist[0] + 0.004, 0.59], [B.waist[0], B.waist[1]], [B.hip[0], B.hip[1]], [0.08, 0.23], [0.064, 0.05]], N(16));
    const legR = [
      ...side,
      ...foot(0.044, 1),
      ...spline([[0.024, 0.05], [0.026, 0.23], [0.012, 0.34], [0, 0.375]], N(9)),
    ];
    low = [...legR, ...flipX(legR).slice(1)];
  }
  const b = { top, low, sh: [[-B.sh[0], B.sh[1]], [B.sh[0], B.sh[1]]], pit: [[-B.pit[0], B.pit[1]], [B.pit[0], B.pit[1]]] };
  b.root = [0, 1].map((j) => [(b.sh[j][0] + b.pit[j][0]) / 2, (b.sh[j][1] + b.pit[j][1]) / 2]);
  bodies.set(key, b);
  return b;
}

// Where an arm's root is, in the figure's own heights, for working out
// where its hands meet the neighbours'.
const armRoots = (kind) => bodyOf(kind, true).root;

// The whole line on the page: `put` takes the figure's own heights to the
// page; `hands` are where its hands are on the page (or null to hang
// down); `hp` is its height there.
function bodyLine(kind, fine, put, hands, hp) {
  const b = bodyOf(kind, fine);
  const sh = b.sh.map(put);
  const pit = b.pit.map(put);
  const root = b.root.map(put);
  const hand = [0, 1].map((j) => hands[j] || [root[j][0] + (j ? 1 : -1) * 0.1 * hp, root[j][1] + 0.36 * hp]);
  const n = fine ? 9 : 5;
  // One edge of an arm, sagging a touch at the elbow.
  const edge = (a, c, sag) => {
    const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 + sag * hp];
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const u = 1 - t;
      return [u * u * a[0] + 2 * u * t * m[0] + t * t * c[0], u * u * a[1] + 2 * u * t * m[1] + t * t * c[1]];
    });
  };
  const r = Math.max(1.1, 0.02 * hp);
  const grip = (h, side) => loopAround(h[0], h[1] - r * 0.2, r, side > 0 ? Math.PI : 0, side, fine ? 12 : 7);
  return [
    ...edge(hand[0], sh[0], 0.03),
    ...b.top.slice(1).map(put),
    ...edge(sh[1], hand[1], 0.03).slice(1),
    ...grip(hand[1], 1),
    ...edge(hand[1], pit[1], 0.045).slice(1),
    ...b.low.slice(1).map(put),
    ...edge(pit[0], hand[0], 0.045).slice(1),
    ...grip(hand[0], -1),
  ];
}

// The line's hand-drawn shake: the same for the same figure every frame.
function shake(pts, seed, amp) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const o = amp * noise(seed * 0.37 + i * 0.13);
    return [p[0] - (dy / l) * o, p[1] + (dx / l) * o];
  });
}

// The same figures as SVG, standing still with their arms down: for the
// picker when adding someone. In a 0 0 60 100 box.
export function figureSVG(kind, cls = '') {
  const hp = 92;
  const put = ([x, y]) => [30 + x * hp, 96 - y * hp];
  const pts = shake(bodyLine(kind, true, put, [null, null], hp), 11, 0.35);
  const d = `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`;
  return `<svg class="${cls}" viewBox="0 0 60 100" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ---------------------------------------------------------------------------
// State

const st = {
  el: null,
  cv: null,
  ctx: null,
  w: 0,
  h: 0,
  dpr: 1,
  items: [], // the ring: people, then made-up people to close it
  real: 0,
  len: 0, // the whole way round, in heights
  ring: AROUND, // how much of it is round the circle
  key: null,
  scroll: 0,
  vel: 0,
  lean: 0,
  leanV: 0,
  drag: null,
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
  el.className = 'ring';
  el.innerHTML = '<canvas class="ring-canvas" tabindex="0" role="img"></canvas>';
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

// Like Today's head, the stage runs down to the tab bar.
function resize() {
  const w = st.el.clientWidth;
  if (!w) return;
  const bar = document.getElementById('tabbar');
  const br = bar && bar.getBoundingClientRect();
  const barTop = br && br.height && br.top > window.innerHeight / 2 ? br.top : window.innerHeight;
  const top = st.el.getBoundingClientRect().top + window.scrollY;
  const h = Math.round(Math.max(w * 0.95, barTop - top));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (w === st.w && h === st.h && dpr === st.dpr) return;
  Object.assign(st, { w, h, dpr });
  st.el.style.height = `${h}px`;
  st.cv.width = Math.round(w * dpr);
  st.cv.height = Math.round(h * dpr);
  st.cv.style.width = `${w}px`;
  st.cv.style.height = `${h}px`;
}

// Pixels per height at the front, and where the front and the far side
// stand.
function view() {
  const k = Math.min(FRONT * st.h, st.w * 0.64);
  const yf = st.h - FEET;
  const sb = EYE / (EYE + (2 * st.ring) / TAU);
  return { k, cx: st.w / 2, yf, hz: (BACK * st.h - sb * yf) / (1 - sb) };
}

// Where a spot `d` round the ring from the front lands on the screen.
function project(d, v) {
  const R = st.ring / TAU;
  const ph = d / R;
  const X = R * Math.sin(ph);
  const Z = R * (1 - Math.cos(ph));
  const s = EYE / (EYE + Z);
  return { ph, s, x: v.cx + X * s * v.k, y: v.hz + (v.yf - v.hz) * s };
}

const gapOf = (a, b) => GAP * (a.size + b.size) / 2;

function update(people, key) {
  const items = people.map((p) => ({ ...p, seed: hashStr(p.id) }));
  const real = items.length;
  // Made-up people close a short ring, each a little different.
  const chain = () => items.reduce((a, it, i) => (i ? a + gapOf(items[i - 1], it) : 0), 0);
  for (let g = 0; real && chain() + gapOf(items[items.length - 1], items[0]) < AROUND; g++) {
    const h = hash1(g * 7.3 + 1);
    items.push({ id: null, ghost: true, figure: ['person', 'man', 'woman'][Math.floor(hash1(g * 3.1 + 2) * 3)], size: 0.58 + h * 0.26, seed: 500 + g });
  }
  let pos = 0;
  items.forEach((it, i) => {
    if (i) pos += gapOf(items[i - 1], it);
    it.pos = pos;
  });
  st.items = items;
  st.real = real;
  st.len = items.length ? pos + gapOf(items[items.length - 1], items[0]) : AROUND;
  // All the way round when it's made up to a ring; else just the part that
  // fits, with the rest of the list round the back, out of sight.
  st.ring = items.length > real ? st.len : AROUND;
  if (key !== st.key) {
    st.key = key;
    st.scroll = startScroll();
    st.vel = 0;
  }
  if (st.cv) st.cv.setAttribute('aria-label', real ? `Your people holding hands in a ring, ${real === 1 ? 'one person' : `${real} people`}. Swipe sideways to turn it, tap someone to open them.` : 'Nobody here.');
}

// The first person stands at the front, a little left of the middle, so
// the list reads left to right; a short list stands in the middle.
function startScroll() {
  if (!st.real || !st.w) return 0;
  const first = st.items[0].pos;
  const lastReal = st.items[st.real - 1].pos;
  const v = view();
  const at = -0.3 * st.w;
  let lo = -st.ring / 4;
  let hi = 0;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (project(m, v).x - v.cx < at) lo = m;
    else hi = m;
  }
  const lead = -lo;
  return lastReal - first < lead * 2 ? (first + lastReal) / 2 : first + lead;
}

export function mountRing(slot, { people = [], key = '' } = {}, { onOpen } = {}) {
  if (!st.el) build();
  st.onOpen = onOpen;
  slot.appendChild(st.el);
  resize();
  update(people, key);
  draw();
  kick();
}

// For tests: move time on by hand (a hidden test browser runs no frames).
export function ringStep(seconds = 0, set = {}) {
  Object.assign(st, set);
  for (let s = 0; s < seconds; s += 1 / 60) step(1 / 60);
  draw();
}

export function ringInfo() {
  const front = nearestFront();
  return { real: st.real, ghosts: st.items.length - st.real, len: st.len, ring: st.ring, scroll: st.scroll, vel: st.vel, lean: st.lean, front: front && front.id, hits: st.hits.map((h) => ({ id: h.id, x: Math.round((h.x0 + h.x1) / 2), y: Math.round(h.y1), s: Math.round(h.s * 100) / 100 })) };
}

function wrap(d) {
  const L = st.len;
  return ((((d + L / 2) % L) + L) % L) - L / 2;
}

function nearestFront() {
  let best = null;
  for (const it of st.items.slice(0, st.real)) {
    const d = Math.abs(wrap(it.pos - st.scroll));
    if (!best || d < best.d) best = { id: it.id, d };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Touch: a sideways swipe turns the ring and lets it run on; a tap opens
// whoever is there. Up and down is left to the page.

function wire(cv) {
  cv.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    st.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, t: performance.now(), s0: st.scroll, moved: false, v: 0 };
    st.vel = 0;
    kick();
  });
  cv.addEventListener('pointermove', (e) => {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        st.drag = null;
        return;
      }
      d.moved = true;
      try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
    }
    const { k } = view();
    const now = performance.now();
    const dt = Math.max(1, now - d.t) / 1000;
    const v = -(e.clientX - d.x) / k / dt;
    d.v = mix(d.v, v, 0.35);
    d.x = e.clientX;
    d.t = now;
    st.scroll = d.s0 - dx / k;
    kick();
  });
  const end = (e) => {
    const d = st.drag;
    if (!d || e.pointerId !== d.id) return;
    st.drag = null;
    if (d.moved) {
      st.vel = performance.now() - d.t < 90 ? clamp(d.v, -12, 12) : 0;
    } else if (e.type === 'pointerup') {
      const r = st.cv.getBoundingClientRect();
      tap(e.clientX - r.left, e.clientY - r.top);
    }
    kick();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    st.scroll += e.deltaX / view().k;
    st.vel = clamp(e.deltaX / view().k * 20, -6, 6);
    kick();
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      st.vel = e.key === 'ArrowLeft' ? -2.4 : 2.4;
      kick();
    } else if (e.key === 'Enter') {
      const f = nearestFront();
      if (f && st.onOpen) st.onOpen(f.id);
    }
  });
}

function tap(x, y) {
  const hit = st.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
  if (hit && st.onOpen) st.onOpen(hit.id);
}

// ---------------------------------------------------------------------------
// Time

function kick() {
  if (st.raf || !st.el || !st.el.isConnected || document.hidden || !st.visible) return;
  st.last = 0;
  st.raf = requestAnimationFrame(frame);
}

const busy = () => st.drag || Math.abs(st.vel) > 0.01 || Math.abs(st.lean) > 0.002 || Math.abs(st.leanV) > 0.01;

function frame(now) {
  st.raf = 0;
  if (!st.el || !st.el.isConnected || document.hidden || !st.visible) return;
  const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 1 / 60;
  st.last = now;
  step(dt);
  // Moving gets every frame; just swaying gets about 25 a second.
  const b = busy();
  if (b || now - st.lastDraw > 40) {
    st.lastDraw = now;
    draw();
  }
  if (b || !reduced.matches) st.raf = requestAnimationFrame(frame);
}

function step(dt) {
  st.t += dt;
  const calm = reduced.matches;
  if (!st.drag && st.vel) {
    st.scroll += st.vel * dt;
    st.vel *= Math.exp(-(calm ? 6 : 2.6) * dt);
    if (Math.abs(st.vel) < 0.01) st.vel = 0;
  }
  // Pulled along by the ring, they lean back against the way it's going,
  // then swing past upright when it stops.
  const v = st.drag ? st.drag.v : st.vel;
  const goal = calm ? 0 : clamp(v * view().k * 0.00024, -0.3, 0.3);
  st.leanV += (60 * (goal - st.lean) - 6 * st.leanV) * dt;
  st.lean += st.leanV * dt;
  if (Math.abs(st.lean) < 1e-4 && Math.abs(st.leanV) < 1e-3 && !goal) st.lean = st.leanV = 0;
}

// ---------------------------------------------------------------------------
// Drawing

// Through the points with soft corners, like a pen.
function trace(path, pts) {
  const n = pts.length;
  if (n < 2) return;
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n - 1; i++) path.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  path.lineTo(pts[n - 1][0], pts[n - 1][1]);
}

// Where two arms meet: below both shoulders, an arm's length from each,
// or straight out between them when they're too far apart to reach.
function handBetween(a, la, b, lb) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.hypot(dx, dy) || 1e-6;
  if (d >= la + lb - 0.5) return [a[0] + (dx * la) / (la + lb), a[1] + (dy * la) / (la + lb)];
  const along = (d * d + la * la - lb * lb) / (2 * d);
  const off = Math.sqrt(Math.max(0, la * la - along * along));
  const ux = dx / d;
  const uy = dy / d;
  const p1 = [a[0] + ux * along - uy * off, a[1] + uy * along + ux * off];
  const p2 = [a[0] + ux * along + uy * off, a[1] + uy * along - ux * off];
  return p1[1] > p2[1] ? p1 : p2;
}

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
  // Warmth by colour (the size says it too, and the key above).
  const colours = Object.fromEntries(['client', 'active', 'warm', 'cold', 'parked', 'none'].map((k) => [k, cs.getPropertyValue(`--w-${k}`).trim() || ink]));
  const v = view();
  const sway = reduced.matches ? 0 : 0.03 * Math.sin(st.t * 1.25);
  const sBack = EYE / (EYE + (2 * st.ring) / TAU);
  const half = st.ring / 2;

  // Everyone in the ring that can be seen, where they stand and lean.
  const on = [];
  st.items.forEach((it, i) => {
    const d = wrap(it.pos - st.scroll);
    if (Math.abs(d) > half) return;
    const p = project(d, v);
    const hp = it.size * p.s * v.k;
    if (p.x < -hp || p.x > w + hp) return;
    // Out of the circle past the back (a long list): fade at the seam.
    const fade = st.ring < st.len ? clamp((half - Math.abs(d)) / (half * 0.18), 0, 1) : 1;
    const lean = clamp(sway + st.lean * Math.cos(p.ph), -0.4, 0.4);
    const kind = it.figure || 'person';
    const put = ([fx, fy]) => [p.x + (fx + lean * fy * (0.55 + 0.45 * fy)) * hp, p.y - fy * hp];
    on.push({ it, i, d, p, hp, fade, kind, put, sh: armRoots(kind).map(put), hands: [null, null] });
  });
  const byIndex = new Map(on.map((o) => [o.i, o]));
  const n = st.items.length;
  // Hands: each with the next one round, unless the next is out of sight
  // round the back.
  for (const o of on) {
    const nb = byIndex.get((o.i + 1) % n);
    if (!nb || (st.ring < st.len && nb.d < o.d)) continue;
    const hand = handBetween(o.sh[1], ARM * o.hp, nb.sh[0], ARM * nb.hp);
    o.hands[1] = hand;
    nb.hands[0] = hand;
  }

  on.sort((a, b) => a.p.s - b.p.s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const o of on) {
    const { it, p, hp } = o;
    const path = new Path2D();
    trace(path, shake(bodyLine(o.kind, hp > 70, o.put, o.hands, hp), it.seed, clamp(0.006 * hp, 0.25, 1.4)));
    const near = clamp((p.s - sBack) / (1 - sBack), 0, 1);
    const lw = Math.max(0.8, 2.1 * Math.pow(p.s, 0.7));
    ctx.setLineDash([]);
    ctx.globalAlpha = o.fade;
    ctx.strokeStyle = paper;
    ctx.lineWidth = lw + 2 + 3 * p.s;
    ctx.stroke(path);
    ctx.globalAlpha = o.fade * mix(dark ? 0.7 : 0.45, 1, near) * (it.ghost ? (dark ? 0.45 : 0.3) : 1);
    ctx.strokeStyle = it.ghost ? colours.none : colours[it.warmth] || ink;
    ctx.lineWidth = lw;
    // Parked: a broken line, like its badge.
    if (it.warmth === 'parked' && !it.ghost) ctx.setLineDash([5 * p.s + 1, 4 * p.s + 1]);
    ctx.stroke(path);
    ctx.setLineDash([]);
    if (!it.ghost && o.fade > 0.5) {
      const half2 = Math.max(18, 0.18 * hp);
      st.hits.push({ id: it.id, s: p.s, x0: p.x - half2, x1: p.x + half2, y0: p.y - hp * 1.02, y1: p.y + FEET * p.s });
    }
  }

  // Names under the ones near the front, the nearest first, none on top of
  // another.
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const taken = [];
  for (const o of [...on].reverse()) {
    if (o.it.ghost || o.p.s < 0.62 || o.fade < 1) continue;
    const size = Math.round(16 * clamp(o.p.s, 0.75, 1));
    ctx.font = `${size}px Mansalva, "Bradley Hand", cursive`;
    const label = o.it.name;
    const tw = ctx.measureText(label).width;
    const box = { x0: o.p.x - tw / 2 - 4, x1: o.p.x + tw / 2 + 4, y0: o.p.y + 6 * o.p.s, y1: o.p.y + 6 * o.p.s + size };
    if (box.x1 < 0 || box.x0 > w || taken.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
    taken.push(box);
    ctx.globalAlpha = clamp((o.p.s - 0.62) / 0.2, 0, 1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = paper;
    ctx.strokeText(label, o.p.x, box.y0);
    ctx.fillStyle = textInk;
    ctx.fillText(label, o.p.x, box.y0);
  }
  ctx.globalAlpha = 1;
  // The nearest first, for taps.
  st.hits.sort((a, b) => b.s - a.s);
}
