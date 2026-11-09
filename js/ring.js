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
const GAP = 0.5; // from one person to the next, in their heights
const AROUND = 14; // the ring's length, in heights
const EYE = 3; // the camera's distance from the front of the ring, in heights
const ARM = 0.42; // an arm's length, in its owner's height
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
// The figures, in their own heights: feet at 0, the top of the head at 1.

function loop(cx, cy, rx, ry, a0, turns, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * turns * TAU;
    const k = 1 + 0.07 * (i / n); // a loop that doesn't quite close on itself
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
function line(pts, n) {
  const out = [pts[0]];
  for (let j = 1; j < pts.length; j++) {
    const [ax, ay] = pts[j - 1];
    const [bx, by] = pts[j];
    for (let i = 1; i <= n; i++) out.push([mix(ax, bx, i / n), mix(ay, by, i / n)]);
  }
  return out;
}
function curve(a, c, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

// The head is a loop drawn from under the chin, and (but for the person on
// a sign) the pen carries on down into the body.
const head = (n) => loop(0, 0.905, 0.066, 0.088, -Math.PI / 2 + 0.3, 1.08, n);

// `fine` is false for a figure far away: fewer turns of the pen, no tie.
function shape(kind, fine) {
  const n = fine ? 22 : 12;
  const m = fine ? 5 : 2;
  if (kind === 'man') {
    const strokes = [
      [...head(n), [0, 0.775]],
      line([[-0.115, 0.75], [-0.09, 0.42], [0.09, 0.42], [0.115, 0.75], [-0.115, 0.75]], m),
      line([[-0.055, 0.42], [-0.066, 0]], m),
      line([[0.055, 0.42], [0.066, 0]], m),
    ];
    if (fine) strokes.push(line([[0, 0.75], [-0.024, 0.705], [0, 0.565], [0.024, 0.705], [0, 0.75]], 3));
    return { strokes, sh: [[-0.112, 0.735], [0.112, 0.735]] };
  }
  if (kind === 'woman') {
    return {
      strokes: [
        [...head(n), ...line([[0.004, 0.812], [0, 0.55]], m)],
        [...line([[0, 0.56], [-0.165, 0.2]], m), ...curve([-0.165, 0.2], [0, 0.165], [0.165, 0.2], m * 2).slice(1), ...line([[0.165, 0.2], [0, 0.56]], m).slice(1)],
        line([[-0.045, 0.19], [-0.06, 0]], m),
        line([[0.045, 0.19], [0.06, 0]], m),
      ],
      sh: [[0, 0.73], [0, 0.73]],
    };
  }
  // Like the person on a sign: a round head on its own, and one line round
  // the body and down and up the legs.
  return {
    strokes: [
      loop(0, 0.9, 0.072, 0.076, -Math.PI / 2, 1.05, n),
      [
        ...line([[-0.07, 0], [-0.08, 0.4], [-0.105, 0.66]], m),
        ...curve([-0.105, 0.66], [-0.105, 0.78], [0, 0.78], m).slice(1),
        ...curve([0, 0.78], [0.105, 0.78], [0.105, 0.66], m).slice(1),
        ...line([[0.105, 0.66], [0.08, 0.4], [0.07, 0], [0.022, 0], [0, 0.36], [-0.022, 0], [-0.07, 0]], m).slice(1),
      ],
    ],
    sh: [[-0.1, 0.68], [0.1, 0.68]],
  };
}

// A figure's lines with its own hand-drawn shake, worked out once.
const shapes = new Map();
function figureLines(kind, fine, seed) {
  const key = `${kind}|${fine}|${seed}`;
  let f = shapes.get(key);
  if (f) return f;
  const base = shape(kind, fine);
  const amp = 0.0055;
  const strokes = base.strokes.map((pts, k) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const o = amp * noise(seed * 0.37 + k * 5.1 + i * 0.45);
    return [p[0] - (dy / l) * o, p[1] + (dx / l) * o];
  }));
  f = { strokes, sh: base.sh };
  if (shapes.size > 400) shapes.clear();
  shapes.set(key, f);
  return f;
}

// The same figures as SVG, standing still with their arms down: for the
// picker when adding someone. In a 0 0 60 100 box.
export function figureSVG(kind, cls = '') {
  const f = figureLines(kind, true, 11);
  const P = ([x, y]) => `${(30 + x * 92).toFixed(1)} ${(96 - y * 92).toFixed(1)}`;
  const arms = f.sh.map(([x, y], i) => {
    const s = i ? 1 : -1;
    return [[x, y], [x + s * 0.07, y - 0.2], [x + s * 0.1, y - 0.38]];
  });
  const d = [...f.strokes, ...arms].map((pts) => `M${pts.map(P).join('L')}`).join('');
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
    const fig = figureLines(it.figure || 'person', hp > 70, it.seed);
    const put = ([fx, fy]) => [p.x + (fx + lean * fy * (0.55 + 0.45 * fy)) * hp, p.y - fy * hp];
    on.push({ it, i, d, p, hp, fade, fig, put, sh: fig.sh.map(put) });
  });
  const byIndex = new Map(on.map((o) => [o.i, o]));
  const n = st.items.length;
  // Hands: each with the next one round, unless the next is out of sight
  // round the back.
  for (const o of on) {
    const nb = byIndex.get((o.i + 1) % n);
    if (!nb || (st.ring < st.len && nb.d < o.d)) continue;
    const hand = handBetween(o.sh[1], ARM * o.hp, nb.sh[0], ARM * nb.hp);
    o.right = hand;
    nb.left = hand;
  }

  on.sort((a, b) => a.p.s - b.p.s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const o of on) {
    const { it, p, hp } = o;
    const path = new Path2D();
    for (const pts of o.fig.strokes) trace(path, pts.map(o.put));
    // Arms, with a little sag at the elbow; a free hand hangs down.
    o.sh.forEach((s, j) => {
      const side = j ? 1 : -1;
      const hand = (j ? o.right : o.left) || [s[0] + side * 0.12 * hp, s[1] + 0.38 * hp];
      const mx = (s[0] + hand[0]) / 2;
      const my = (s[1] + hand[1]) / 2 + 0.025 * hp;
      trace(path, [s, [mx, my], hand]);
      if (j ? o.right : o.left) {
        const r = Math.max(1, 0.014 * hp);
        path.moveTo(hand[0] + r, hand[1]);
        path.arc(hand[0], hand[1], r, 0, TAU);
      }
    });
    const near = clamp((p.s - sBack) / (1 - sBack), 0, 1);
    const lw = Math.max(0.8, 2.2 * Math.pow(p.s, 0.7));
    ctx.globalAlpha = o.fade;
    ctx.strokeStyle = paper;
    ctx.lineWidth = lw + 2 + 3 * p.s;
    ctx.stroke(path);
    ctx.globalAlpha = o.fade * mix(dark ? 0.7 : 0.45, 1, near) * (it.ghost ? (dark ? 0.5 : 0.33) : 1);
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.stroke(path);
    if (!it.ghost && o.fade > 0.5) {
      const half2 = Math.max(18, 0.16 * hp);
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
