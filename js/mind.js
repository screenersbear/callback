// Today's head and its thought bubbles, on a phone.
//
// The head is a small 3D shape drawn the way a single-line drawing is: one
// line from the left, up the neck, round the head and on into the brow and
// nose, with the right side left open, and loops where the pen turns. Its
// outline is worked out from the shape every frame, and the ears and face
// are curves on its surface that hide as they turn away, so it can be spun
// round with a finger and still looks drawn from any side. Each bubble is a Today section
// with something waiting: tapping one opens it, and once it's empty it pops
// (when you can see it: not behind a sheet, not scrolled away). The face
// worries more the more is waiting, and smiles once nothing is.

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const EYE = 5; // the viewer's distance, in head sizes: a touch of perspective
const HEAD = { x: 0.5, r: 0.3 }; // in stage widths; it sits at the bottom
const REST_YAW = -0.32; // at rest it looks a little to the left, not at you
const SKY = 0.57; // bubble heights (SLOTS) are given against this much sky
const BUB = { rx: 0.16, ry: 0.1 }; // a bubble's size, in stage widths

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
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

// A loop the pen makes on its way: once round a small circle, leaving from
// (u, v) heading at angle `dir` and coming back to carry on the same way.
// turn 1 loops to the left of the heading, -1 to the right.
function curl(u, v, dir, r, turn = 1, n = 14) {
  const cu = u + Math.cos(dir + (turn * Math.PI) / 2) * r;
  const cv = v + Math.sin(dir + (turn * Math.PI) / 2) * r;
  const a0 = dir - (turn * Math.PI) / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + turn * ((i + 1) / n) * TAU;
    return [cu + Math.cos(a) * r, cv + Math.sin(a) * r];
  });
}
const heading = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);

// Every line of the head for one expression, in the head's own space, kept
// to a few strokes the way a single-line drawing goes: they run from one
// feature into the next and loop where the pen turns. Points are [th, ph, off, kind]:
// 'skin' hides when it faces away; 'out' (ears, nose, tuft) hides when it's
// behind the head or inside it.
function headLines(ex) {
  const L = [];
  const stroke = (pts, o = {}) => {
    const n = pts.length;
    L.push({ kind: 'skin', w: 2, op: 1, seed: L.length * 7.3, waves: 3, ...o, pts: pts.map((q, i) => ({ ...onHead(q[0], q[1], q[2] ?? 0.01), k: q[3], t: i / (n - 1) })) });
  };
  const free = (pts3, o = {}) => {
    const n = pts3.length;
    L.push({ kind: 'out', w: 2, op: 1, seed: L.length * 7.3, waves: 2, ...o, pts: pts3.map((p, i) => ({ p, t: i / (n - 1) })) });
  };
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1), i));
  const off = (pts, o, k) => pts.map(([u, v]) => [u, v, o, k]);

  // A tuft that loops once, like the top of a quickly drawn rose.
  {
    const B = surf(0.15, 1.28);
    const up = normalAt(0.15, 1.28);
    const sd = [1 - up[0] * up[0], -up[0] * up[1], -up[0] * up[2]];
    const sl = Math.hypot(...sd);
    const at = ([x, y]) => [B[0] + (sd[0] / sl) * x + up[0] * y, B[1] + (sd[1] / sl) * x + up[1] * y, B[2] + (sd[2] / sl) * x + up[2] * y];
    const rise = range(6, (t) => [0.03 * t, 0.14 * t]);
    const top = rise[5];
    free([...rise, ...curl(...top, heading(rise[4], top), 0.05, 1, 16), [0.075, 0.175], [0.12, 0.15]].map(at), { w: 1.9, waves: 1.5 });
  }

  // Ears: the rim round the outside, then a hook back into the middle, like
  // a 6. The inner half of the rim sinks into the head and hides.
  for (const side of [-1, 1]) {
    const base = onHead(side * (Math.PI / 2 + 0.05), -0.08, 0.05).p;
    const d = [side * 0.7, 0, -0.71];
    const at = ([cu, cv]) => [base[0] + d[0] * cu, base[1] + cv, base[2] + d[2] * cu];
    const rim = range(24, (t) => {
      const a = mix(1.95, -1.95, t);
      return [0.18 * Math.cos(a), 0.24 * Math.sin(a)];
    });
    const hook = spline([rim[23], [0.03, -0.15], [0.085, -0.05], [0.065, 0.05], [0.01, 0.06]], 12);
    free([...rim, ...hook.slice(1)].map(at), { waves: 2.5, ear: true });
  }

  // Eyes: an almond that the pen runs round and flicks out of at the outer
  // corner, left empty. Shut, it's the lower curve with the flick: a calm,
  // content ⌣.
  const lidL = mix(0.05, 0.065, ex.joy);
  const lidU = 0.13;
  for (const side of [-1, 1]) {
    const th0 = side * 0.35;
    const outer = th0 + side * 0.13;
    const lid = (s, top) => [mix(outer, th0 - side * 0.13, s), (top ? mix(-lidL, lidU, ex.open) : -lidL) * Math.sin(Math.PI * s)];
    const flick = [[outer + side * 0.035, 0.012], [outer + side * 0.065, 0.045]];
    let pts;
    if (ex.open > 0.12) {
      pts = [...range(13, (s) => lid(s, true)), ...range(13, (s) => lid(1 - s, false)).slice(1), ...flick];
    } else {
      pts = [...range(13, (s) => lid(1 - s, false)), ...flick];
    }
    stroke(off(pts, 0.006), { w: 1.9, waves: 1.2 });
  }

  // Brows. The right one runs on down the side of the nose to its tip and
  // loops for the nostril, all one line; the inner ends rise with worry.
  const base = mix(0.21, 0.25, ex.joy);
  const inner = 0.08 * ex.worry * (1 - ex.joy);
  const outerDrop = -0.02 * ex.worry;
  const arch = mix(0.025, 0.045, ex.joy) - 0.02 * ex.worry;
  const brow = (side, t) => [side * mix(0.15, 0.5, t), base + mix(inner, outerDrop, t) + arch * Math.sin(Math.PI * t)];
  {
    const pts = range(12, (t) => brow(-1, t));
    const e = pts[11];
    pts.push([e[0] - 0.04, e[1] - 0.025], [e[0] - 0.055, e[1] - 0.06]);
    stroke(off(pts, 0.008), { w: 2, waves: 1 });
  }
  {
    const browPts = off(range(12, (t) => brow(1, 1 - t)), 0.008, 'skin');
    const b0 = brow(1, 0);
    const nose = spline([[b0[0], b0[1], 0.008], [0.07, b0[1] - 0.09, 0.015], [0.045, -0.02, 0.03], [0.03, -0.14, 0.1], [0.012, -0.24, 0.19], [0, -0.3, 0.23], [0.035, -0.335, 0.15], [0.07, -0.32, 0.06]], 22)
      .slice(1)
      .map(([u, v, o]) => [u, v, o, 'out']);
    const n1 = nose[nose.length - 2];
    const n2 = nose[nose.length - 1];
    const loopPts = curl(n2[0], n2[1], heading(n1, n2), 0.04, 1, 14).map(([u, v]) => [u, v, 0.05, 'out']);
    stroke([...browPts, ...nose, ...loopPts, [n2[0] + 0.04, n2[1] + 0.008, 0.02, 'out']], { w: 2.1, waves: 2.5, join: true });
  }

  // Mouth: a curl at one corner, then a smile that flattens, turns down and
  // wobbles with worry (a big U once everything's done), and a hook up at
  // the far corner.
  {
    const width = mix(mix(0.34, 0.3, ex.worry), 0.48, ex.joy);
    const depth = mix(0.15, 0.21, ex.joy);
    const smile = mix(0.3 - 0.65 * ex.worry, 1, ex.joy);
    const wav = Math.max(0, (ex.worry - 0.45) / 0.55) * (1 - ex.joy);
    const m = range(18, (t) => [(t - 0.5) * width, -0.5 - smile * depth * Math.sin(Math.PI * t) + wav * 0.02 * Math.sin(4 * Math.PI * t)]);
    const e = m[17];
    const pts = [m[0], ...curl(...m[0], heading(m[0], m[1]), 0.03, 1, 12), ...m.slice(1), [e[0] + 0.025, e[1] + 0.02], [e[0] + 0.03, e[1] + 0.045]];
    stroke(off(pts, 0.008), { w: 2, waves: 1.5 });
  }

  // Worry lines on the forehead, and a drop of sweat when it's a lot.
  if (ex.worry > 0.55) {
    const op = clamp((ex.worry - 0.55) / 0.3, 0, 1) * (1 - ex.joy);
    for (const ph of [0.31, 0.355]) {
      stroke(off(range(8, (t) => [(t - 0.5) * 0.22, ph + 0.008 * Math.sin(TAU * t)]), 0.008), { w: 1.4, op, waves: 0.8 });
    }
  }
  if (ex.worry > 0.7) {
    const op = clamp((ex.worry - 0.7) / 0.2, 0, 1) * (1 - ex.joy);
    stroke(off(range(18, (t) => {
      const a = t * TAU * 1.06;
      return [0.68 + 0.032 * Math.sin(a) * Math.sin(a / 2), 0.2 + 0.05 * Math.cos(a)];
    }), 0.02), { w: 1.5, op, waves: 0.6 });
  }
  return L;
}

// ---------------------------------------------------------------------------
// Flat geometry helpers

// Points every `step` along an open line.
function resampleOpen(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = step - carry;
    while (d <= l) {
      out.push([mix(a[0], b[0], d / l), mix(a[1], b[1], d / l)]);
      d += step;
    }
    carry = l - (d - step);
  }
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

// The outline split where the neck lines meet it: the arc over the top of
// the head (from the left neck line to the right) and the jaw below.
function contour(skin, hx, R) {
  const n = skin.length;
  const meet = (side) => {
    const x = hx + side * R * 0.42;
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = skin[i];
      const b = skin[(i + 1) % n];
      if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
        const y = a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
        if (!best || y > best.y) best = { i, x, y };
      }
    }
    return best;
  };
  const A = meet(-1);
  const B = meet(1);
  if (!A || !B || A.i === B.i) return null;
  const walk = (P, Q) => {
    const out = [[P.x, P.y]];
    for (let i = (P.i + 1) % n, g = 0; g < n; i = (i + 1) % n, g++) {
      out.push(skin[i]);
      if (i === Q.i) break;
    }
    out.push([Q.x, Q.y]);
    return out;
  };
  const ab = walk(A, B);
  const ba = walk(B, A);
  const top = (pts) => Math.min(...pts.map((p) => p[1]));
  const overTop = top(ab) < top(ba);
  return {
    L: [A.x, A.y],
    R: [B.x, B.y],
    head: overTop ? ab : ba.slice().reverse(),
    chin: overTop ? ba.slice().reverse() : ab,
  };
}

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
  tilt: 0,
  tiltV: 0,
  drag: null,
  lookYaw: REST_YAW,
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
  // The window's height decides the stage's (a phone's toolbars come and go).
  window.addEventListener('resize', () => { if (st.el.isConnected) { resize(); kick(); } });
}

// The stage runs from where it starts down to the tab bar, so the neck
// meets the bar; the head sits at the bottom and the bubbles fill the sky.
function resize() {
  const w = st.el.clientWidth;
  if (!w) return;
  const bar = document.getElementById('tabbar');
  const br = bar && bar.getBoundingClientRect();
  const barTop = br && br.height && br.top > window.innerHeight / 2 ? br.top : window.innerHeight;
  const top = st.el.getBoundingClientRect().top + window.scrollY;
  const h = Math.round(Math.max(w * 0.95, barTop - top));
  if (w === st.w && h === st.h) return;
  st.w = w;
  st.h = h;
  st.el.style.height = `${h}px`;
  st.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  layout();
  const { R, hx, hy } = geom();
  Object.assign(st.hit.style, { left: `${hx - R * 1.35}px`, top: `${hy - R * 1.4}px`, width: `${R * 2.7}px`, height: `${R * 2.7}px` });
}

// Where the head is, in pixels, and how much sky there is above it.
function geom() {
  const R = Math.min(HEAD.r * st.w, st.h * 0.21);
  const hy = st.h - R * 1.5;
  return { R, hx: HEAD.x * st.w, hy, sky: hy - R * 1.15 };
}

// Turning the head by hand: drag sideways to spin it, up and down to tip
// it. A tap without a drag gets a little bounce.
function wireHead(hit) {
  hit.addEventListener('pointerdown', (e) => {
    st.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, spin0: st.spin, tilt0: st.tilt, moved: false, lx: e.clientX, lt: performance.now(), v: 0 };
    kick();
  });
  hit.addEventListener('pointermove', (e) => {
    const d = st.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) > 6) {
      d.moved = true;
      try { hit.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    }
    if (!d.moved) return;
    const k = Math.PI / (geom().R * 2);
    st.spin = d.spin0 + dx * k;
    st.tilt = clamp(d.tilt0 - dy * k * 0.8, -0.75, 0.75);
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
    if (d.moved) {
      st.spinV = performance.now() - d.lt < 80 ? clamp(d.v, -25, 25) : 0;
      st.tiltV = 0;
    }
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
  // One or two bubbles have room to spare in a tall sky, so they grow a bit.
  const grow = live.length <= 2 && st.w ? clamp(geom().sky / (SKY * st.w), 1, 1.2) : 1;
  live.forEach((b, i) => {
    const [x, y] = slots.at[Math.min(i, slots.at.length - 1)];
    Object.assign(b, { tx: x, ty: y, ts: slots.s * grow });
    if (b.x == null) Object.assign(b, { x, y, s: slots.s * grow });
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
    b.wt = d.weight ?? 1;
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
  return { worry: st.worry, joy: st.joy, pending: st.pending, spin: st.spin, tilt: st.tilt, bubbles: [...st.bubbles.values()].map((b) => ({ key: b.key, n: b.n, state: b.state, p: b.p })) };
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
  const busy = st.drag || Math.abs(st.spinV) > 0.05 || Math.abs(st.tilt) > 0.002 || [...st.bubbles.values()].some((b) => b.state !== 'on' || b.wob > 0.01);
  if (busy || now - st.lastDraw > 40) {
    st.lastDraw = now;
    draw();
  }
  if (busy || !reduced.matches || Math.abs(st.worry - target().worry) > 0.01 || Math.abs(st.joy - target().joy) > 0.01) st.raf = requestAnimationFrame(frame);
}

// The face it's heading for. Bubbles still waiting to pop count until they
// do; a bubble with nothing to do in it (Coming up) doesn't count.
function target() {
  const waiting = [...st.bubbles.values()].filter((b) => b.state === 'pop').reduce((a, b) => a + b.n * (b.wt ?? 1), 0);
  const pending = st.pending + waiting;
  return { worry: 1 - Math.exp(-pending / 4.5), joy: pending > 0 ? 0 : 1 };
}

function step(dt) {
  st.t += dt;
  const t = st.t;
  const calm = reduced.matches;
  const goal = target();
  st.worry = approach(st.worry, goal.worry, 3, dt);
  st.joy = approach(st.joy, goal.joy, 2.5, dt);
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
  if (!st.drag) {
    st.tiltV += (-30 * st.tilt - 10 * st.tiltV) * dt;
    st.tilt += st.tiltV * dt;
    if (Math.abs(st.tilt) < 1e-4 && Math.abs(st.tiltV) < 1e-3) st.tilt = st.tiltV = 0;
  }
  st.boil = st.drag || Math.abs(st.spinV) > 0.5 ? Math.floor(t * 8) * 0.37 : 0;

  // Looking about: a slow sway, and a glance at a bubble now and then
  // (more often the more worried it is).
  const live = st.order.map((k) => st.bubbles.get(k)).filter((b) => b && b.state === 'on');
  if (!calm && !st.glance && t > st.nextGlance && live.length) {
    const b = live[Math.floor(hash1(t * 3.1) * live.length)];
    st.glance = { key: b.key, until: t + 0.9 };
    st.nextGlance = t + mix(14, 7, st.worry) + hash1(t) * 4;
  }
  if (st.glance && t > st.glance.until) st.glance = null;
  const gb = st.glance && st.bubbles.get(st.glance.key);
  // Only a little: it mostly holds still and lets you turn it.
  let yawT = REST_YAW + (calm ? 0 : 0.035 * Math.sin(t * 0.37));
  let pitchT = (live.length ? 0.06 : 0) + (calm ? 0 : 0.012 * Math.sin(t * 0.51));
  if (gb && st.w) {
    const g = geom();
    yawT = clamp(REST_YAW * 0.5 + (gb.x - HEAD.x) * 0.6, -0.45, 0.3);
    pitchT = clamp(((g.hy - (gb.y / SKY) * g.sky) / st.w) * 0.35, 0.04, 0.2);
  }
  const rate = gb ? 4 : 1.5;
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
  const g = geom();
  const R = g.R * (1 + (calm ? 0 : 0.003 * Math.sin(t * 1.6)));
  const { hx, hy, sky } = g;
  const yaw = st.spin + st.lookYaw;
  const pitch = st.lookPitch + st.tilt;
  const bt = t - st.boop;
  const squash = bt < 0.5 ? 0.06 * Math.sin(bt * 18) * Math.exp(-bt * 7) : 0;
  const roll = (calm ? 0 : st.joy * 0.025 * Math.sin(t * 0.55)) + (bt < 0.8 ? 0.08 * Math.sin(bt * 14) * Math.exp(-bt * 5) : 0);
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

  // The outline is half a head, from the left: up the left of the neck, a
  // loop where it leaves it, round the head and over the top, then (below)
  // it swings in to become the right brow and the nose, all one line. The
  // right side, the jaw and the chin are left open.
  const skin = hull(SKIN.map((p) => scr(rot(p))));
  const cont = contour(skin, hx, R);
  let way;
  let swingOK = true;
  let upPart = null;
  let arc = null;
  if (cont) {
    const bottom = st.h + 2;
    const [lx, ly] = cont.L;
    const up = [[lx - R * 0.06, bottom], [lx - R * 0.03, mix(bottom, ly, 0.5)], [lx, ly]];
    const loopPts = curl(lx, ly - R * 0.02, heading(up[1], up[2]), R * 0.075, -1, 16);
    const head = resampleOpen(cont.head, 3.2);
    // Turned to show its right profile, the line carries on down that side
    // so the face has an edge to sit on.
    const prof = clamp((Math.sin(yaw) - 0.7) / 0.25, 0, 1) * clamp((Math.cos(yaw) + 0.45) / 0.3, 0, 1);
    swingOK = prof < 0.5;
    let end = head.findIndex((p) => p[0] > hx + R * (0.5 + 0.8 * prof));
    if (end < 2) end = head.length;
    upPart = [...up, ...loopPts];
    arc = head;
    way = [...upPart, ...head.slice(1, end)];
  } else {
    let ring = resample(skin, 84, hx, hy, Math.PI * 0.72);
    const ang = (p) => Math.atan2(p[1] - hy, p[0] - hx);
    if (Math.sin(ang(ring[3]) - ang(ring[0])) < 0) ring = [ring[0], ...ring.slice(1).reverse()];
    way = ring.slice(0, 46);
  }
  let wayDone = false;
  // The pen's way round, and on into `more` (the brow) with a swing between.
  const drawWay = (more = []) => {
    const n = way.length;
    const pts = way.map((p, i) => [p[0], p[1], -5 + (4 * i) / n]);
    if (more.length > 1) {
      const E = way[n - 1];
      const B = more[0];
      const k = Math.hypot(B[0] - E[0], B[1] - E[1]) * 0.3;
      const hE = heading(way[n - 2], E);
      const hB = heading(B, more[1]);
      const c1 = [E[0] + Math.cos(hE) * k, E[1] + Math.sin(hE) * k];
      const c2 = [B[0] - Math.cos(hB) * k, B[1] - Math.sin(hB) * k];
      for (let i = 1; i < 12; i++) {
        const q = bez(E, c1, c2, B, i / 12);
        pts.push([q[0], q[1], -1 + i / 12]);
      }
      pts.push(...more);
    }
    put(inkPath(pts, 1.7, 2.5, 0.8), { w: 2.1 });
    wayDone = true;
  };

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
  let joinRun = null;
  for (const line of headLines(ex)) {
    const pts = line.pts.map((s) => {
      const r = rot(s.p);
      const [x, y] = scr(r);
      let vis;
      if ((s.k || line.kind) === 'skin') {
        const n = rot(s.n);
        vis = n[0] * -r[0] + n[1] * -r[1] + n[2] * (EYE - r[2]) > 0;
      } else vis = !insideHead(s.p) && !(r[2] < 0 && inPoly(skin, x, y));
      return { x, y, vis, t: s.t, r };
    });
    let op = line.op;
    if (line.ear) {
      // Only the ear on the drawn side: the one round the right fades out.
      const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      op *= clamp((hx + R * 0.35 - mx) / (R * 0.4), 0, 1);
      if (op < 0.03) continue;
    }
    let run = [];
    let from = 0;
    const flush = () => {
      if (run.length > 1) {
        let len = 0;
        for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
        if (len < 5) { run = []; return; } // no specks where a line turns away
        // The brow-and-nose line waits: the outline may run on into it.
        if (line.join && from === 0 && !joinRun) joinRun = { run, line, op };
        else put(inkPath(run, line.seed, line.waves, 0.7), { w: line.w, op: r1(op) });
      }
      run = [];
    };
    pts.forEach((p, i) => {
      if (!p.vis) return flush();
      if (!run.length) from = i;
      run.push([p.x, p.y, p.t]);
    });
    flush();
  }
  // The outline leaves the head at the temple, a little above and to the
  // right of where the brow starts, and swings in to become it. Turned so
  // far that the brow is left of the middle, the two are drawn apart.
  if (joinRun && swingOK && arc) {
    const B = joinRun.run[0];
    let top = 0;
    arc.forEach((p, i) => { if (p[1] < arc[top][1]) top = i; });
    const end = arc.findIndex((p, i) => i > top && p[0] > B[0] + R * 0.12 && p[1] > B[1] - R * 0.55);
    const E = end > top + 1 ? arc[end - 1] : null;
    if (E && B[0] > hx - R * 0.05 && Math.hypot(B[0] - E[0], B[1] - E[1]) < R * 1.1) {
      way = [...upPart, ...arc.slice(1, end)];
      drawWay(joinRun.run);
    }
  }
  const swung = wayDone;
  if (!wayDone && way.length > 1) drawWay();
  if (joinRun && !swung) put(inkPath(joinRun.run, joinRun.line.seed, joinRun.line.waves, 0.7), { w: joinRun.line.w, op: r1(joinRun.op) });

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

  // The bubbles, each with a looping trail down to the head.
  // Trails first, then the clouds over them, so a trail running up behind
  // another bubble goes under it.
  for (const pass of [0, 1]) for (const key of [...st.bubbles.keys()]) drawBubble(st.bubbles.get(key), { w, R, hx, hy, sky }, pass);

  for (let i = st.used; i < st.pool.length; i++) {
    const p = st.pool[i];
    if (p._.d !== '') { p.setAttribute('d', ''); p._.d = ''; }
  }
}

// A cloud in one go: big arcs out, with a little loop where each one turns
// into the next, and the line running on a bit past where it started.
function cloud(cx, cy, rx, ry, seed) {
  const K = 8;
  const N = 136;
  const a0 = -2.3 + hash1(seed) * 0.6;
  const rl = Math.min(rx, ry) * 0.24;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const A = a0 + t * TAU * 1.05;
    let nx = Math.cos(A) / rx;
    let ny = Math.sin(A) / ry;
    const nl = Math.hypot(nx, ny);
    nx /= nl;
    ny /= nl;
    const ph = t * K * TAU * 1.05;
    const o = rl * (1 + 0.15 * noise(seed + t * 9));
    pts.push([cx + Math.cos(A) * rx - nx * o * Math.cos(ph) + ny * o * Math.sin(ph), cy + Math.sin(A) * ry - ny * o * Math.cos(ph) - nx * o * Math.sin(ph), t]);
  }
  return pts;
}

// The trail: one line from the head out to the bubble, bowed a little, that
// loops round two or three times on the way, each loop bigger than the last.
function trail(x0, y0, x1, y1, unit, seed) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const side = seed % 2 ? 1 : -1;
  const n = len > 64 * unit ? 3 : 2;
  const bow = Math.min(9, len * 0.07) * side;
  const at = (s) => {
    const b = bow * Math.sin(Math.PI * s);
    return [x0 + ux * s * len - uy * b, y0 + uy * s * len + ux * b];
  };
  const spots = Array.from({ length: n }, (_, k) => (k + 0.75) / (n + 0.15));
  const N = 36;
  const pts = [];
  let next = 0;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const p = at(s);
    pts.push([p[0], p[1], s]);
    if (next < n && s >= spots[next]) {
      const r = mix(2.6, 5.4, next / (n - 1)) * unit;
      curl(p[0], p[1], heading(p, at(s + 0.01)), r, -side, 16).forEach((c, j) => pts.push([c[0], c[1], s + j * 0.003]));
      next++;
    }
  }
  return pts;
}

function drawBubble(b, { w, R, hx, hy, sky }, pass) {
  if (b.x == null) return;
  const t = st.t;
  const calm = reduced.matches;
  const bob = calm ? 0 : Math.sin(t * 0.9 + b.seed) * 0.003;
  const cx = b.x * w;
  const cy = ((b.y + bob) / SKY) * sky;
  const bs = b.s;
  const wob = 1 + 0.07 * Math.sin(b.wob * Math.PI * 3) * b.wob;
  let scale = bs * wob;
  let textOp = 1;
  let trailPart = 1; // how much of the trail is drawn, from the head out
  let cloudPart = 1; // how much of the cloud is drawn
  let burst = -1;
  if (b.state === 'in') {
    // Drawn in: the trail from the head, then the cloud round, then the words.
    const p = Math.max(0, b.p);
    trailPart = clamp(p / 0.35, 0, 1);
    cloudPart = clamp((p - 0.3) / 0.6, 0, 1);
    textOp = clamp((p - 0.7) / 0.3, 0, 1);
  } else if (b.state === 'pop') {
    // Pops: puffs up, bursts into flicks, and the trail runs back to the head.
    const p = b.p;
    if (p < 0.16) scale *= 1 + 0.14 * (p / 0.16);
    else {
      cloudPart = 0;
      burst = (p - 0.16) / 0.84;
    }
    textOp = clamp(1 - p * 3, 0, 1);
    trailPart = 1 - clamp((p - 0.1) / 0.6, 0, 1);
  }
  const rx = BUB.rx * w * scale * 1.05;
  const ry = BUB.ry * w * scale * 1.08;

  // The trail goes from the head toward the bubble's edge.
  const dirX = cx - hx;
  const dirY = cy - hy;
  const dl = Math.hypot(dirX, dirY) || 1;
  const hxT = hx + (dirX / dl) * R * 1.14;
  const hyT = hy + (dirY / dl) * R * 1.14;
  const gx = cx - hxT;
  const gy = cy - hyT;
  const gl = Math.hypot(gx, gy) || 1;
  const edge = 1 / Math.sqrt((gx / gl / (BUB.rx * w * bs)) ** 2 + (gy / gl / (BUB.ry * w * bs)) ** 2);
  const ex = cx - (gx / gl) * edge * 1.18;
  const ey = cy - (gy / gl) * edge * 1.18;
  if (pass === 0) {
    if (trailPart > 0 && Math.hypot(ex - hxT, ey - hyT) > 16) {
      const pts = trail(hxT, hyT, ex, ey, (w / 343) * bs, b.seed);
      const k = Math.ceil(trailPart * (pts.length - 1)) + 1;
      if (k > 1) put(inkPath(pts.slice(0, k), b.seed * 0.7, 2, 0.4), { w: 1.7 });
    }
    return;
  }

  if (cloudPart > 0 && scale > 0.02) {
    const pts = cloud(cx, cy, rx, ry, b.seed);
    const k = Math.ceil(cloudPart * (pts.length - 1)) + 1;
    put(inkPath(pts.slice(0, k), b.seed * 1.3, 4, 0.5), { w: 2, fill: cloudPart >= 1 ? 'var(--bg)' : null });
  }
  if (burst >= 0) {
    const e = 1 - (1 - burst) ** 2;
    let d = '';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + hash1(b.seed + i) * 0.4;
      const p = (rr, da) => [cx + Math.cos(a + da) * BUB.rx * w * bs * rr, cy + Math.sin(a + da) * BUB.ry * w * bs * rr];
      const r0 = 1.05 + 0.5 * e;
      const q0 = p(r0, 0);
      const q1 = p(r0 + 0.14 * (1 - e), 0.08);
      const q2 = p(r0 + 0.22 * (1 - e), 0.22);
      d += `M${r1(q0[0])} ${r1(q0[1])}Q${r1(q1[0])} ${r1(q1[1])} ${r1(q2[0])} ${r1(q2[1])}`;
    }
    put(d, { w: 1.9, op: r1(1 - burst) });
  }

  const bw = BUB.rx * w * 2 * 0.82;
  const bh = BUB.ry * w * 2 * 0.72;
  const btn = b.btn;
  const tf = `translate(${r1(cx - bw / 2)}px, ${r1(cy - bh / 2)}px) scale(${Math.max(0.01, Math.round(scale * 1000) / 1000)})`;
  if (btn._tf !== tf) { btn.style.transform = tf; btn._tf = tf; }
  if (btn._w !== bw) { btn.style.width = `${bw}px`; btn.style.height = `${bh}px`; btn._w = bw; }
  const op = r1(textOp);
  if (btn._op !== op) { btn.style.opacity = op; btn._op = op; }
  btn.style.pointerEvents = b.state === 'pop' ? 'none' : '';
}
