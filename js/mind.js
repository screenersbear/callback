// Today's head and its thought bubbles, on a phone.
//
// The head is a small 3D shape drawn as ink lines. Its outline is worked out
// from the shape every frame, and the ears, hair and face are curves on its
// surface that hide as they turn away, so it can be spun round with a finger
// and still looks drawn by hand from any side. Each bubble is a Today section
// with something waiting: tapping one opens it, and once it's empty it pops
// (when you can see it: not behind a sheet, not scrolled away). The face
// worries more the more is waiting, and smiles once nothing is.

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const EYE = 5; // the viewer's distance, in head sizes: a touch of perspective
const ASPECT = 1.08; // stage height over width
const SHRINK = 0.42; // how much shorter it gets with no bubbles, so the head moves up
const HEAD = { x: 0.5, y: 0.78, r: 0.19 }; // in stage widths
const BUB = { rx: 0.16, ry: 0.1 }; // a bubble's size, in stage widths

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const backOut = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const sheetOpen = () => document.body.classList.contains('sheet-open');
const r1 = (v) => Math.round(v * 10) / 10;

// Value noise: the same wobble for the same spot on a line, so a stroke
// keeps its hand-drawn shake as the head turns instead of crawling.
function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x) {
  const i = Math.floor(x);
  return mix(hash1(i), hash1(i + 1), smooth(x - i)) * 2 - 1;
}
function hashStr(s) {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h;
}

// ---------------------------------------------------------------------------
// The head's shape: a slightly squashed ball, narrower toward the jaw.
// th goes round (0 is the front), ph goes up (0 is eye level).

function surf(th, ph) {
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const low = s < 0 ? s * s : 0;
  return [c * Math.sin(th) * (1 - 0.1 * low), s * 1.03, c * Math.cos(th) * (0.94 - 0.07 * low)];
}

function normalAt(th, ph) {
  const e = 1e-3;
  const a = surf(th + e, ph);
  const b = surf(th - e, ph);
  const c = surf(th, ph + e);
  const d = surf(th, ph - e);
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const p = surf(th, ph);
  if (Math.hypot(...n) < 1e-9) n = p;
  const l = Math.hypot(...n);
  n = [n[0] / l, n[1] / l, n[2] / l];
  return n[0] * p[0] + n[1] * p[1] + n[2] * p[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
}

// A point on the skin (or lifted off it by `off`), with its facing.
function onHead(th, ph, off = 0) {
  const p = surf(th, ph);
  const n = normalAt(th, ph);
  return { p: [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off], n };
}

// Is a point inside the head? Compared with the skin in its direction.
function insideHead(p) {
  const l = Math.hypot(...p);
  if (l < 1e-6) return true;
  const ph = Math.asin(clamp(p[1] / l, -1, 1));
  const th = Math.atan2(p[0], p[2]);
  return l < Math.hypot(...surf(th, ph)) * 0.995;
}

// Points all over the skin, for the outline.
const SKIN = (() => {
  const pts = [];
  for (let j = 0; j <= 18; j++) {
    const ph = -Math.PI / 2 + (j / 18) * Math.PI;
    const ring = j === 0 || j === 18 ? 1 : 40;
    for (let i = 0; i < ring; i++) pts.push(surf((i / ring) * TAU, ph));
  }
  return pts;
})();

const bez = (a, b, c, d, t) => {
  const u = 1 - t;
  return a.map((_, i) => u * u * u * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + t * t * t * d[i]);
};

// Catmull-Rom through a few (th, ph, off) points, for the nose.
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
    out.push(p1.map((_, j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t * t * t)));
  }
  return out;
}

// Every line of the head for one expression, in the head's own space.
// kind 'skin' hides when it faces away; 'out' (ears, nose, hair tuft) hides
// when it's behind the head or inside it.
function headLines(ex) {
  const L = [];
  const add = (kind, pts, o = {}) => L.push({ kind, pts, w: 2, op: 1, closed: false, seed: L.length * 7.3, waves: 3, ...o });
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1), i));

  // Hair: the edge of a cap of hair, high on the forehead and low at the
  // back, with a fringe swept to one side; strands combed into it, a swirl
  // on the crown and a tuft.
  const hairPh = (th) => 0.1 + 0.32 * Math.cos(th) + 0.05 * Math.cos(2 * th) - 0.15 * Math.max(0, 1 - Math.abs(th - 0.38) / 0.3) ** 1.5;
  add('skin', range(80, (t) => {
    const th = -Math.PI + t * TAU * 1.03;
    return { ...onHead(th, hairPh(th), 0.012), t };
  }), { waves: 10 });
  for (const [a, b, c, d] of [[-0.25, 1.08, 0.33, 0.36], [0.12, 1.12, 0.6, 0.43], [-0.6, 0.95, -0.2, 0.55]]) {
    add('skin', range(14, (t) => ({ ...onHead(mix(a, c, t), mix(b, d, t) + 0.07 * Math.sin(Math.PI * t), 0.014), t })), { w: 1.5, waves: 1.2 });
  }
  // Strands round the sides and back, down from the crown, so it reads as
  // hair from behind too.
  for (let k = 0; k < 7; k++) {
    const th = Math.PI + (k - 3) * 0.42;
    const len = 0.55 + 0.15 * hash1(k * 5.1);
    add('skin', range(10, (t) => {
      const ph = mix(1.12, hairPh(th) + 0.08, t * len + (1 - len) * 0.5);
      return { ...onHead(th + 0.12 * Math.sin(t * 2.2) * (k < 3 ? -1 : 1), ph, 0.014), t };
    }), { w: 1.4, waves: 1 });
  }
  add('skin', range(18, (t) => {
    const a = t * TAU * 1.6;
    const r = 0.025 + 0.085 * t;
    return { ...onHead(Math.PI + (r * Math.cos(a)) / Math.cos(0.82), 0.82 + r * Math.sin(a), 0.01), t };
  }), { w: 1.6, waves: 2 });
  for (const [th, ph, c] of [[0.25, 1.25, [[0, 0.16, 0.02], [0.14, 0.27, 0.04], [0.21, 0.18, 0.05]]], [-0.35, 1.3, [[-0.03, 0.13, 0], [0.05, 0.23, 0], [0.12, 0.18, 0]]]]) {
    const b = surf(th, ph);
    const ctrl = [b, ...c.map((d) => [b[0] + d[0], b[1] + d[1], b[2] + d[2]])];
    add('out', range(12, (t) => ({ p: bez(...ctrl, t), t })), { w: 1.8, waves: 1.5 });
  }

  // Ears: an oval sticking out each side, its inner half hidden in the head.
  for (const side of [-1, 1]) {
    const base = onHead(side * (Math.PI / 2 + 0.05), -0.08, 0.05).p;
    const d = [side * 0.7, 0, -0.71];
    const at = (cu, cv) => [base[0] + d[0] * cu, base[1] + cv, base[2] + d[2] * cu];
    add('out', range(30, (t) => {
      const a = (side > 0 ? -1.9 : 1.9 - Math.PI) + t * TAU * 1.04 * side;
      const grow = 1 + Math.max(0, t - 0.95) * 0.6;
      return { p: at(0.18 * Math.cos(a) * grow, 0.24 * Math.sin(a) * grow), t };
    }), { waves: 2.5 });
    add('out', range(12, (t) => {
      const a = -1.1 + t * 2.2;
      return { p: at(0.075 * Math.cos(a) + 0.03, 0.13 * Math.sin(a) - 0.01), t };
    }), { w: 1.5, waves: 1 });
  }

  // Eyes: a lower lid, and an upper one that opens away from it. Shut, only
  // the lower curve is left: a calm, content ⌣.
  const lidL = mix(0.05, 0.065, ex.joy);
  const lidU = 0.13;
  for (const side of [-1, 1]) {
    const th0 = side * 0.35;
    const lid = (s, top) => {
      const v = (top ? mix(-lidL, lidU, ex.open) : -lidL) * Math.sin(Math.PI * s);
      return [th0 + (s - 0.5) * 0.26, v];
    };
    if (ex.open > 0.12) {
      const pts = [];
      for (let i = 0; i < 13; i++) pts.push(lid(i / 12, false));
      for (let i = 12; i >= 0; i--) pts.push(lid(i / 12, true));
      pts.push(lid(0.06, false), lid(0.12, false));
      add('skin', pts.map(([th, ph], i) => ({ ...onHead(th, ph, 0.006), t: i / pts.length })), { w: 1.9, waves: 1.5 });
    } else {
      add('skin', range(13, (t) => {
        const [th, ph] = lid(t, false);
        return { ...onHead(th, ph, 0.006), t };
      }), { w: 2.1, waves: 1 });
    }
    if (ex.open > 0.3) {
      const v = (lidU * ex.open - lidL) * 0.45 + ex.lookV * 0.022;
      const r = mix(0.036, 0.026, ex.worry) * clamp((ex.open - 0.3) / 0.25, 0, 1);
      L.push({ kind: 'skin', dot: r, pts: [{ ...onHead(th0 + ex.lookU * 0.05, v, 0.008), t: 0 }], seed: 0 });
    }
  }

  // Brows: the inner ends rise as the worry grows.
  for (const side of [-1, 1]) {
    const base = mix(0.21, 0.25, ex.joy);
    const inner = 0.08 * ex.worry * (1 - ex.joy);
    const outer = -0.02 * ex.worry;
    const arch = mix(0.025, 0.045, ex.joy) - 0.02 * ex.worry;
    add('skin', range(12, (t) => ({ ...onHead(side * mix(0.15, 0.5, t), base + mix(inner, outer, t) + arch * Math.sin(Math.PI * t), 0.008), t })), { w: 2.1, waves: 1 });
  }

  // Nose: down from between the eyes, out to a point, and a little hook back.
  const nose = spline([[0, -0.1, 0.02], [0, -0.19, 0.11], [0, -0.29, 0.23], [0.05, -0.33, 0.13], [0.09, -0.31, 0.03]], 18);
  add('out', nose.map(([th, ph, off], i) => ({ ...onHead(th, ph, off), t: i / 17 })), { waves: 1.2 });

  // Mouth: a smile that flattens, turns down and wobbles with worry, and a
  // big U once everything's done.
  const width = mix(mix(0.34, 0.3, ex.worry), 0.48, ex.joy);
  const depth = mix(0.15, 0.21, ex.joy);
  const smile = mix(0.3 - 0.65 * ex.worry, 1, ex.joy);
  const wav = Math.max(0, (ex.worry - 0.45) / 0.55) * (1 - ex.joy);
  add('skin', range(16, (t) => ({ ...onHead((t - 0.5) * width, -0.5 - smile * depth * Math.sin(Math.PI * t) + wav * 0.02 * Math.sin(4 * Math.PI * t), 0.008), t })), { w: 2.1, waves: 1.5 });

  // Happy cheeks: a few quick hatch marks.
  if (ex.joy > 0.4) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const th = side * (0.43 + k * 0.055);
        add('skin', range(4, (t) => ({ ...onHead(th + side * 0.03 * t, -0.2 - 0.08 * t, 0.006), t })), { w: 1.4, op: clamp((ex.joy - 0.4) / 0.5, 0, 1), waves: 0.5 });
      }
    }
  }
  // Worry lines on the forehead, and a drop of sweat when it's a lot.
  if (ex.worry > 0.55) {
    const op = clamp((ex.worry - 0.55) / 0.3, 0, 1) * (1 - ex.joy);
    for (const ph of [0.31, 0.355]) {
      add('skin', range(8, (t) => ({ ...onHead((t - 0.5) * 0.22, ph + 0.008 * Math.sin(TAU * t), 0.008), t })), { w: 1.4, op, waves: 0.8 });
    }
  }
  if (ex.worry > 0.7) {
    const op = clamp((ex.worry - 0.7) / 0.2, 0, 1) * (1 - ex.joy);
    add('skin', range(16, (t) => {
      const a = t * TAU;
      return { ...onHead(0.68 + 0.032 * Math.sin(a) * Math.sin(a / 2), 0.2 + 0.05 * Math.cos(a), 0.02), t };
    }), { w: 1.5, op, waves: 0.6, closed: true });
  }
  return L;
}

// ---------------------------------------------------------------------------
// Flat geometry helpers

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A closed outline, evenly spaced, starting nearest the given angle.
function resample(poly, n, cx, cy, startAngle) {
  const seg = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(l);
    total += l;
  }
  let start = 0;
  let best = Infinity;
  poly.forEach(([x, y], i) => {
    const d = Math.abs(Math.atan2(Math.sin(Math.atan2(y - cy, x - cx) - startAngle), Math.cos(Math.atan2(y - cy, x - cx) - startAngle)));
    if (d < best) { best = d; start = i; }
  });
  const out = [];
  let i = start;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const want = (k / n) * total;
    while (acc + seg[i] < want) { acc += seg[i]; i = (i + 1) % poly.length; }
    const f = seg[i] ? (want - acc) / seg[i] : 0;
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    out.push([mix(a[0], b[0], f), mix(a[1], b[1], f)]);
  }
  return out;
}

// An ink line through the points: wobbled a little across its length, and
// smoothed. `t` per point keeps the wobble fixed to the same spot.
function inkPath(pts, seed, waves, amp) {
  const n = pts.length;
  if (n < 2) return '';
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const o = amp * noise(seed + (pts[i][2] ?? i / n) * waves * 3 + st.boil);
    out.push([pts[i][0] - (dy / l) * o, pts[i][1] + (dx / l) * o]);
  }
  let d = `M${r1(out[0][0])} ${r1(out[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const m0 = (out[i][0] + out[i + 1][0]) / 2;
    const m1 = (out[i][1] + out[i + 1][1]) / 2;
    d += `Q${r1(out[i][0])} ${r1(out[i][1])} ${r1(m0)} ${r1(m1)}`;
  }
  return `${d}L${r1(out[n - 1][0])} ${r1(out[n - 1][1])}`;
}

const dotPath = (x, y, r) => `M${r1(x - r)} ${r1(y)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0`;

// ---------------------------------------------------------------------------
// State

const st = {
  el: null,
  svg: null,
  hit: null,
  pool: [],
  used: 0,
  w: 0,
  h: 0,
  bubbles: new Map(),
  order: [],
  first: true,
  pending: 0,
  total: 0,
  worry: 0,
  joy: 1,
  spin: 0,
  spinV: 0,
  drag: null,
  lookYaw: 0,
  lookPitch: 0,
  glance: null,
  nextGlance: 2,
  blinkAt: 3,
  blinkFrom: -1,
  boop: -9,
  cheer: false,
  sparkle: -9,
  t: 0,
  last: 0,
  lastDraw: 0,
  raf: 0,
  visible: true,
  room: 0,
  boil: 0,
  onOpen: null,
};

// Where the bubbles go, by how many there are: centres in stage widths.
const SLOTS = {
  1: { s: 1.1, at: [[0.5, 0.27]] },
  2: { s: 1, at: [[0.26, 0.2], [0.73, 0.31]] },
  3: { s: 1, at: [[0.2, 0.17], [0.58, 0.15], [0.8, 0.42]] },
  4: { s: 0.92, at: [[0.2, 0.15], [0.57, 0.12], [0.82, 0.36], [0.22, 0.44]] },
  5: { s: 0.85, at: [[0.18, 0.13], [0.51, 0.1], [0.83, 0.22], [0.2, 0.4], [0.81, 0.48]] },
  6: { s: 0.8, at: [[0.17, 0.12], [0.5, 0.09], [0.83, 0.15], [0.18, 0.37], [0.51, 0.34], [0.83, 0.41]] },
  7: { s: 0.76, at: [[0.17, 0.11], [0.5, 0.09], [0.83, 0.13], [0.18, 0.35], [0.51, 0.33], [0.83, 0.38], [0.13, 0.61]] },
  8: { s: 0.74, at: [[0.17, 0.11], [0.5, 0.09], [0.83, 0.13], [0.18, 0.35], [0.51, 0.33], [0.83, 0.38], [0.13, 0.61], [0.87, 0.63]] },
};

function build() {
  const el = document.createElement('div');
  el.className = 'mind';
  el.innerHTML = '<svg class="mind-ink" aria-hidden="true"></svg><div class="mind-head" role="img"></div>';
  st.el = el;
  st.svg = el.querySelector('svg');
  st.hit = el.querySelector('.mind-head');
  wireHead(st.hit);
  new ResizeObserver(() => { resize(); kick(); }).observe(el);
  new IntersectionObserver((entries) => {
    st.visible = entries[entries.length - 1].isIntersecting;
    kick();
  }).observe(el);
  document.addEventListener('visibilitychange', kick);
}

function resize() {
  const w = st.el.clientWidth;
  if (!w) return;
  const h = Math.round(w * (ASPECT - SHRINK * st.room));
  if (w === st.w && h === st.h) return;
  st.w = w;
  st.h = h;
  st.el.style.height = `${h}px`;
  st.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const R = HEAD.r * w;
  const hy = headY() * w;
  Object.assign(st.hit.style, { left: `${HEAD.x * w - R * 1.35}px`, top: `${hy - R * 1.4}px`, width: `${R * 2.7}px`, height: `${R * 2.7}px` });
}

const headY = () => HEAD.y - SHRINK * st.room;

// Turning the head: drag sideways (up and down still scrolls the page).
// A tap without a drag gets a little bounce.
function wireHead(hit) {
  hit.addEventListener('pointerdown', (e) => {
    st.drag = { id: e.pointerId, x0: e.clientX, spin0: st.spin, moved: false, lx: e.clientX, lt: performance.now(), v: 0 };
    kick();
  });
  hit.addEventListener('pointermove', (e) => {
    const d = st.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      try { hit.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    }
    if (!d.moved) return;
    const k = Math.PI / (HEAD.r * st.w * 2);
    st.spin = d.spin0 + dx * k;
    const now = performance.now();
    const dt = Math.max(1, now - d.lt) / 1000;
    d.v = mix(d.v, ((e.clientX - d.lx) * k) / dt, 0.5);
    d.lx = e.clientX;
    d.lt = now;
    kick();
  });
  const end = (e) => {
    const d = st.drag;
    if (!d || d.id !== e.pointerId) return;
    st.drag = null;
    if (d.moved) st.spinV = performance.now() - d.lt < 80 ? clamp(d.v, -25, 25) : 0;
    else if (e.type === 'pointerup') st.boop = st.t;
    kick();
  };
  hit.addEventListener('pointerup', end);
  hit.addEventListener('pointercancel', end);
}

function newBubble(d, i) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'thought';
  btn.innerHTML = '<span class="thought-n"></span><span class="thought-label"></span>';
  const b = { key: d.key, seed: hashStr(d.key), state: 'in', p: st.first ? -0.14 * i : 0, wob: 0, x: null, y: null, s: 1, tx: 0, ty: 0, ts: 1, btn, n: d.n };
  btn.addEventListener('click', () => {
    if (b.state === 'pop') return;
    st.glance = { key: b.key, until: st.t + 1.1 };
    b.wob = 0.7;
    kick();
    setTimeout(() => { if (st.onOpen) st.onOpen(b.key); }, 170);
  });
  st.el.appendChild(btn);
  return b;
}

function layout() {
  const live = st.order.map((k) => st.bubbles.get(k)).filter((b) => b && b.state !== 'pop');
  const slots = SLOTS[Math.min(8, live.length)];
  live.forEach((b, i) => {
    const [x, y] = slots.at[Math.min(i, slots.at.length - 1)];
    Object.assign(b, { tx: x, ty: y, ts: slots.s });
    if (b.x == null) Object.assign(b, { x, y, s: slots.s });
  });
}

function update({ bubbles = [], pending = 0 } = {}) {
  const keys = new Set(bubbles.map((b) => b.key));
  for (const b of st.bubbles.values()) {
    if (!keys.has(b.key) && b.state !== 'pop') Object.assign(b, { state: 'pop', p: 0 });
  }
  bubbles.forEach((d, i) => {
    let b = st.bubbles.get(d.key);
    if (b && b.state === 'pop') {
      b.btn.remove();
      b = null;
    }
    if (!b) {
      b = newBubble(d, i);
      st.bubbles.set(d.key, b);
    } else if (b.n !== d.n) b.wob = 1;
    b.n = d.n;
    b.btn.querySelector('.thought-n').textContent = String(d.n);
    b.btn.querySelector('.thought-label').textContent = d.label;
    b.btn.setAttribute('aria-label', `${d.title}: ${d.n}. Show them`);
  });
  st.order = bubbles.map((b) => b.key);
  if (st.pending > 0 && pending === 0) st.cheer = true;
  st.pending = pending;
  st.total = bubbles.reduce((a, b) => a + b.n, 0);
  if (st.first) {
    st.worry = 1 - Math.exp(-pending / 4.5);
    st.joy = pending > 0 ? 0 : 1;
    st.room = bubbles.length ? 0 : 1;
  }
  st.first = false;
  st.hit.setAttribute('aria-label', st.total
    ? `A hand-drawn face, ${pending >= 6 ? 'worried' : 'a little concerned'}: ${st.total} ${st.total === 1 ? 'thing is' : 'things are'} waiting. The bubbles above it open them.`
    : 'A hand-drawn face, smiling: nothing is waiting.');
  layout();
}

export function mountMind(slot, data, { onOpen } = {}) {
  if (!st.el) build();
  st.onOpen = onOpen;
  slot.appendChild(st.el);
  resize();
  update(data);
  kick();
}

// For tests: move time on by hand (a hidden test browser runs no frames).
export function mindStep(seconds = 0, set = {}) {
  Object.assign(st, set);
  for (let s = 0; s < seconds; s += 1 / 60) step(1 / 60);
  draw();
}

// What's showing, for checking it in a test.
export function mindInfo() {
  return { worry: st.worry, joy: st.joy, pending: st.pending, spin: st.spin, bubbles: [...st.bubbles.values()].map((b) => ({ key: b.key, n: b.n, state: b.state, p: b.p })) };
}

function kick() {
  if (st.raf || !st.el || !st.el.isConnected || document.hidden || !st.visible) return;
  st.last = 0;
  st.raf = requestAnimationFrame(frame);
}

function frame(now) {
  st.raf = 0;
  if (!st.el || !st.el.isConnected || document.hidden || !st.visible) return;
  const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 1 / 60;
  st.last = now;
  step(dt);
  // Moving things get every frame; a head just idling gets about 25.
  const busy = st.drag || Math.abs(st.spinV) > 0.05 || (st.room > 0 && st.room < 1) || [...st.bubbles.values()].some((b) => b.state !== 'on' || b.wob > 0.01);
  if (busy || now - st.lastDraw > 40) {
    st.lastDraw = now;
    draw();
  }
  if (busy || !reduced.matches || Math.abs(st.worry - target().worry) > 0.01 || Math.abs(st.joy - target().joy) > 0.01) st.raf = requestAnimationFrame(frame);
}

// The face it's heading for. Bubbles still waiting to pop count until they do.
function target() {
  const waiting = [...st.bubbles.values()].filter((b) => b.state === 'pop').reduce((a, b) => a + b.n, 0);
  const pending = st.pending + waiting;
  return { worry: 1 - Math.exp(-pending / 4.5), joy: pending > 0 || st.bubbles.size ? 0 : 1 };
}

function step(dt) {
  st.t += dt;
  const t = st.t;
  const calm = reduced.matches;
  const goal = target();
  st.worry = approach(st.worry, goal.worry, 3, dt);
  st.joy = approach(st.joy, goal.joy, 2.5, dt);
  st.room = approach(st.room, st.bubbles.size ? 0 : 1, 4, dt);
  if (Math.abs(st.room - (st.bubbles.size ? 0 : 1)) < 0.002) st.room = st.bubbles.size ? 0 : 1;
  if (st.cheer && goal.joy === 1) {
    st.cheer = false;
    st.sparkle = t;
  }

  // Spinning by hand: it keeps going a moment, then turns back to face you.
  if (!st.drag) {
    if (Math.abs(st.spinV) > 2) {
      st.spin += st.spinV * dt;
      st.spinV *= Math.exp(-2.4 * dt);
    } else {
      const home = Math.round(st.spin / TAU) * TAU;
      st.spinV += (-26 * (st.spin - home) - 9 * st.spinV) * dt;
      st.spin += st.spinV * dt;
      if (Math.abs(st.spin - home) < 1e-4 && Math.abs(st.spinV) < 1e-3) {
        st.spin = 0;
        st.spinV = 0;
      }
    }
  }
  st.boil = st.drag || Math.abs(st.spinV) > 0.5 ? Math.floor(t * 8) * 0.37 : 0;

  // Looking about: a slow sway, and a glance at a bubble now and then
  // (more often the more worried it is).
  const live = st.order.map((k) => st.bubbles.get(k)).filter((b) => b && b.state === 'on');
  if (!calm && !st.glance && t > st.nextGlance && live.length) {
    const b = live[Math.floor(hash1(t * 3.1) * live.length)];
    st.glance = { key: b.key, until: t + 0.9 };
    st.nextGlance = t + mix(5, 1.8, st.worry) + hash1(t) * 1.5;
  }
  if (st.glance && t > st.glance.until) st.glance = null;
  const gb = st.glance && st.bubbles.get(st.glance.key);
  let yawT = calm ? 0 : 0.15 * Math.sin(t * 0.45) + 0.05 * Math.sin(t * 1.27);
  let pitchT = (live.length ? 0.1 : 0) + (calm ? 0 : 0.04 * Math.sin(t * 0.63));
  if (gb) {
    yawT = clamp((gb.x - HEAD.x) * 1.7, -0.85, 0.85);
    pitchT = clamp((headY() - gb.y) * 0.9, 0.05, 0.5);
  }
  const rate = gb ? 7 : 2;
  st.lookYaw = approach(st.lookYaw, yawT, rate, dt);
  st.lookPitch = approach(st.lookPitch, pitchT, rate, dt);

  if (!calm && t > st.blinkAt) {
    st.blinkFrom = t;
    st.blinkAt = t + 2.4 + hash1(t * 1.7) * 3.2;
  }

  for (const b of [...st.bubbles.values()]) {
    if (b.x != null) {
      b.x = approach(b.x, b.tx, 7, dt);
      b.y = approach(b.y, b.ty, 7, dt);
      b.s = approach(b.s, b.ts, 7, dt);
    }
    b.wob = Math.max(0, b.wob - dt * 3);
    if (b.state === 'in') {
      b.p += dt / (calm ? 0.2 : 0.6);
      if (b.p >= 1) Object.assign(b, { state: 'on', p: 1 });
    } else if (b.state === 'pop' && !sheetOpen()) {
      b.p += dt / (calm ? 0.2 : 0.5);
      if (b.p >= 1) {
        b.btn.remove();
        st.bubbles.delete(b.key);
        layout();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing

function put(d, { w = 2, op = 1, fill = null } = {}) {
  let p = st.pool[st.used];
  if (!p) {
    p = document.createElementNS(NS, 'path');
    st.svg.appendChild(p);
    st.pool[st.used] = p;
    p._ = {};
  }
  st.used += 1;
  const c = p._;
  if (c.d !== d) { p.setAttribute('d', d); c.d = d; }
  if (c.w !== w) { p.setAttribute('stroke-width', w); c.w = w; }
  if (c.op !== op) { p.setAttribute('opacity', op); c.op = op; }
  if (c.fill !== fill) { p.style.fill = fill || ''; p.style.stroke = fill === 'currentColor' ? 'none' : ''; c.fill = fill; }
}

function draw() {
  resize();
  if (!st.w) return;
  st.used = 0;
  const w = st.w;
  const t = st.t;
  const calm = reduced.matches;
  const R = HEAD.r * w * (1 + (calm ? 0 : 0.006 * Math.sin(t * 1.6)));
  const hx = HEAD.x * w;
  const hy = headY() * w;
  const yaw = st.spin + st.lookYaw;
  const pitch = st.lookPitch;
  const bt = t - st.boop;
  const squash = bt < 0.5 ? 0.06 * Math.sin(bt * 18) * Math.exp(-bt * 7) : 0;
  const roll = (calm ? 0 : st.joy * 0.07 * Math.sin(t * 0.55)) + (bt < 0.8 ? 0.08 * Math.sin(bt * 14) * Math.exp(-bt * 5) : 0);
  const C = { cy: Math.cos(yaw), sy: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch), cr: Math.cos(roll), sr: Math.sin(roll) };
  const rot = (p) => {
    const x1 = p[0] * C.cy + p[2] * C.sy;
    const z1 = -p[0] * C.sy + p[2] * C.cy;
    return [x1, p[1] * C.cp + z1 * C.sp, -p[1] * C.sp + z1 * C.cp];
  };
  const scr = (r) => {
    const k = EYE / (EYE - r[2]);
    const x = r[0] * k * R * (1 + squash * 0.5);
    const y = -r[1] * k * R * (1 - squash);
    return [hx + x * C.cr - y * C.sr, hy + x * C.sr + y * C.cr];
  };

  // The outline: the edge of the shape as it now faces.
  const skin = hull(SKIN.map((p) => scr(rot(p))));
  const ring = resample(skin, 84, hx, hy, -2.35);
  const outline = ring.map((p, i) => [p[0], p[1], i / 84]);
  for (let i = 0; i < 6; i++) {
    const [x, y] = ring[i];
    const push = 1 + (i / 6) * 0.025;
    outline.push([hx + (x - hx) * push, hy + (y - hy) * push, (84 + i) / 84]);
  }
  put(inkPath(outline, 1.7, 7, 0.8), { w: 2.3 });

  // The neck: two lines down from under the jaw.
  for (const side of [-1, 1]) {
    const x = hx + side * R * 0.42;
    let y0 = hy;
    for (let i = 0; i < skin.length; i++) {
      const a = skin[i];
      const b = skin[(i + 1) % skin.length];
      if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) y0 = Math.max(y0, a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]));
    }
    const x2 = x + side * R * 0.05;
    put(inkPath([[x, y0 - 1, 0], [mix(x, x2, 0.5), mix(y0, st.h, 0.5), 0.5], [x2, st.h + 2, 1]], 40 + side, 1.5, 0.7), { w: 2.1 });
  }

  // Everything on and around the head.
  const blink = st.blinkFrom >= 0 && t - st.blinkFrom < 0.18 ? Math.abs(Math.cos(((t - st.blinkFrom) / 0.18) * Math.PI)) : 1;
  const yawT = st.glance ? st.lookYaw : 0;
  const ex = {
    worry: st.worry,
    joy: st.joy,
    open: (1 - st.joy) * mix(0.55, 1, st.worry) * blink,
    lookU: st.glance ? clamp(yawT * 1.2, -1, 1) : 0,
    lookV: st.glance ? clamp(st.lookPitch * 1.6, -1, 1) : 0,
  };
  for (const line of headLines(ex)) {
    const pts = line.pts.map((s) => {
      const r = rot(s.p);
      const [x, y] = scr(r);
      let vis;
      if (line.kind === 'skin') {
        const n = rot(s.n);
        vis = n[0] * -r[0] + n[1] * -r[1] + n[2] * (EYE - r[2]) > 0;
      } else vis = !insideHead(s.p) && !(r[2] < 0 && inPoly(skin, x, y));
      return { x, y, vis, t: s.t, r };
    });
    if (line.dot) {
      const p = pts[0];
      if (p.vis) put(dotPath(p.x, p.y, Math.max(0.8, line.dot * R * (0.55 + 0.45 * clamp(p.r[2], 0, 1)))), { fill: 'currentColor' });
      continue;
    }
    let run = [];
    const flush = () => {
      if (run.length > 1) put(inkPath(run, line.seed, line.waves, 0.55), { w: line.w, op: r1(line.op) });
      run = [];
    };
    for (const p of pts) {
      if (p.vis) run.push([p.x, p.y, p.t]);
      else flush();
    }
    flush();
  }

  // Sparkles, the moment the last bubble goes.
  const sp = t - st.sparkle;
  if (sp < 1.6) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.62;
      const life = clamp((sp - i * 0.08) / 1.2, 0, 1);
      if (life <= 0 || life >= 1) continue;
      const k = Math.sin(life * Math.PI);
      const cx = hx + Math.cos(a) * R * (1.45 + life * 0.25);
      const cy = hy + Math.sin(a) * R * (1.45 + life * 0.25);
      const s = 7 * k;
      put(`M${r1(cx - s)} ${r1(cy)}L${r1(cx + s)} ${r1(cy)}M${r1(cx)} ${r1(cy - s)}L${r1(cx)} ${r1(cy + s)}`, { w: 1.6, op: r1(k) });
    }
  }

  // The bubbles, with their trail of little circles down to the head.
  for (const key of [...st.bubbles.keys()]) drawBubble(st.bubbles.get(key), { w, R, hx, hy });

  for (let i = st.used; i < st.pool.length; i++) {
    const p = st.pool[i];
    if (p._.d !== '') { p.setAttribute('d', ''); p._.d = ''; }
  }
}

function cloud(cx, cy, rx, ry, seed) {
  const K = 9;
  const pts = [];
  const a0 = -2.5 + hash1(seed) * 0.4;
  for (let j = 0; j < K + 1; j++) {
    const aj = a0 + (j / K) * TAU;
    const ak = a0 + ((j + 1) / K) * TAU;
    const bulge = 0.17 + 0.1 * hash1(seed + j * 3.7);
    const steps = j === K ? 2 : 6;
    for (let s = 0; s < steps; s++) {
      const f = s / 6;
      const a = mix(aj, ak, f);
      const r = 1 + bulge * Math.sin(Math.PI * f) + (j === K ? 0.03 * f : 0);
      pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, (j + f) / K]);
    }
  }
  return pts;
}

function loop(cx, cy, r, seed) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = seed + (i / 11) * TAU;
    const rr = r * (1 + (i > 10 ? 0.12 : 0));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, i / 12]);
  }
  return pts;
}

function drawBubble(b, { w, R, hx, hy }) {
  if (b.x == null) return;
  const t = st.t;
  const calm = reduced.matches;
  const bob = calm ? 0 : Math.sin(t * 0.9 + b.seed) * 0.006;
  const cx = b.x * w;
  const cy = (b.y + bob) * w;
  const wob = 1 + 0.07 * Math.sin(b.wob * Math.PI * 3) * b.wob;
  let scale = b.s * wob;
  let textOp = 1;
  let trail = [1, 1, 1];
  let showCloud = true;
  let burst = -1;
  if (b.state === 'in') {
    const p = Math.max(0, b.p);
    trail = [0, 1, 2].map((i) => clamp((p - 0.12 * (2 - i)) / 0.2, 0, 1));
    const c = clamp((p - 0.3) / 0.7, 0, 1);
    scale *= c > 0 ? backOut(c) : 0;
    textOp = c;
    showCloud = c > 0;
  } else if (b.state === 'pop') {
    const p = b.p;
    if (p < 0.16) scale *= 1 + 0.14 * (p / 0.16);
    else {
      showCloud = false;
      burst = (p - 0.16) / 0.84;
    }
    textOp = clamp(1 - p * 3, 0, 1);
    trail = [0, 1, 2].map((i) => (p < 0.22 + 0.13 * i ? 1 : 0));
  }
  const rx = BUB.rx * w * scale;
  const ry = BUB.ry * w * scale;

  // Trail: from the bubble's edge toward the top of the head.
  const dirX = cx - hx;
  const dirY = cy - hy;
  const dl = Math.hypot(dirX, dirY) || 1;
  const hxT = hx + (dirX / dl) * R * 1.12;
  const hyT = hy + (dirY / dl) * R * 1.12;
  const ux = (hxT - cx) / (Math.hypot(hxT - cx, hyT - cy) || 1);
  const uy = (hyT - cy) / (Math.hypot(hxT - cx, hyT - cy) || 1);
  const edge = (1 / Math.sqrt((ux / (BUB.rx * w * b.s)) ** 2 + (uy / (BUB.ry * w * b.s)) ** 2)) * 1.2;
  const ex = cx + ux * edge;
  const ey = cy + uy * edge;
  const gap = Math.hypot(hxT - ex, hyT - ey);
  const unit = w / 343;
  [[0.2, 8], [0.5, 5.8], [0.78, 4]].forEach(([f, r], i) => {
    const k = trail[i];
    if (k <= 0 || gap < 18) return;
    const sz = r * unit * b.s * (b.state === 'in' ? backOut(k) : 1);
    put(inkPath(loop(mix(ex, hxT, f), mix(ey, hyT, f), sz, b.seed + i), b.seed + i * 5, 1, 0.35), { w: 1.6 });
  });

  if (showCloud && scale > 0.02) put(inkPath(cloud(cx, cy, rx, ry, b.seed), b.seed * 1.3, 4, 0.6), { w: 2, fill: 'var(--bg)' });
  if (burst >= 0) {
    const e = 1 - (1 - burst) ** 2;
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + hash1(b.seed + i) * 0.4;
      const r0 = 1 + 0.5 * e;
      const r1x = r0 + 0.25 * (1 - e);
      d += `M${r1(cx + Math.cos(a) * BUB.rx * w * b.s * r0)} ${r1(cy + Math.sin(a) * BUB.ry * w * b.s * r0)}L${r1(cx + Math.cos(a) * BUB.rx * w * b.s * r1x)} ${r1(cy + Math.sin(a) * BUB.ry * w * b.s * r1x)}`;
    }
    put(d, { w: 2, op: r1(1 - burst) });
  }

  const bw = BUB.rx * w * 2 * 0.8;
  const bh = BUB.ry * w * 2 * 0.86;
  const btn = b.btn;
  const tf = `translate(${r1(cx - bw / 2)}px, ${r1(cy - bh / 2)}px) scale(${Math.max(0.01, Math.round(scale * 1000) / 1000)})`;
  if (btn._tf !== tf) { btn.style.transform = tf; btn._tf = tf; }
  if (btn._w !== bw) { btn.style.width = `${bw}px`; btn.style.height = `${bh}px`; btn._w = bw; }
  const op = r1(textOp);
  if (btn._op !== op) { btn.style.opacity = op; btn._op = op; }
  btn.style.pointerEvents = b.state === 'pop' ? 'none' : '';
}
