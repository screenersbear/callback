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
// worries more the more is waiting, and smiles once nothing is. A bubble
// can be picked up and put somewhere else (dropped on another, they swap
// places), and stays where it's put, on this device.

import { skyLines } from './sky.js';

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const EYE = 5; // the viewer's distance, in head sizes: a touch of perspective
const HEAD = { x: 0.5, r: 0.3 }; // in stage widths; it sits at the bottom
const REST_YAW = -0.32; // at rest it looks a little to the left, not at you
const REST_PITCH = 0.24; // and tips its chin up a little, as if thinking
const SKY = 0.57; // bubble heights (SLOTS) are given against this much sky
const BUB = { rx: 0.16, ry: 0.1 }; // a bubble's size, in stage widths
// Turning it by hand: only so far each way, and against a little give.
const SPIN_L = 0.85;
const SPIN_R = 1.25;
const softSpin = (raw) => (raw < 0 ? SPIN_L * Math.tanh(raw / SPIN_L) : SPIN_R * Math.tanh(raw / SPIN_R));
const rawSpin = (v) => (v < 0 ? SPIN_L * Math.atanh(clamp(v / SPIN_L, -0.999, 0)) : SPIN_R * Math.atanh(clamp(v / SPIN_R, 0, 0.999)));
// And tipping it up and down: up to look over the bubbles, down at the bar.
const TILT_UP = 0.42;
const TILT_DOWN = 0.5;
const softTilt = (raw) => (raw > 0 ? TILT_UP * Math.tanh(raw / TILT_UP) : TILT_DOWN * Math.tanh(raw / TILT_DOWN));
const rawTilt = (v) => (v > 0 ? TILT_UP * Math.atanh(clamp(v / TILT_UP, 0, 0.999)) : TILT_DOWN * Math.atanh(clamp(v / TILT_DOWN, -0.999, 0)));

// How the buddy looks, picked by tapping its face (kept on this device).
// One list, no groups: a plain face with the one hair it started with,
// short hair, a ponytail or shoulder length hair, or a softer face (bigger
// lashed eyes, arched brows, a smaller nose, full lips) with its own fuller
// hair: a bob, a high ponytail or long hair. Each face has curls too (11-09):
// short curls on the plain face, big curls to the shoulders on the softer
// one. The keys are what's saved, so they stay as they were.
export const BUDDIES = [
  { key: 'tuft', face: 'plain', hair: 'tuft', label: 'One hair' },
  { key: 'man-short', face: 'plain', hair: 'short', label: 'Short' },
  { key: 'man-pony', face: 'plain', hair: 'ponytail', label: 'Ponytail' },
  { key: 'man-long', face: 'plain', hair: 'shoulder', label: 'Shoulder length' },
  { key: 'man-curly', face: 'plain', hair: 'curly', label: 'Short curls' },
  { key: 'woman-short', face: 'soft', hair: 'bob', label: 'Bob' },
  { key: 'woman-pony', face: 'soft', hair: 'highpony', label: 'High ponytail' },
  { key: 'woman-long', face: 'soft', hair: 'long', label: 'Long hair' },
  { key: 'woman-curly', face: 'soft', hair: 'curls', label: 'Big curls' },
];
const BUDDY_KEY = 'callback.buddy';
function readBuddy() {
  let k = 'tuft';
  try { k = localStorage.getItem(BUDDY_KEY) || k; } catch { /* this device only */ }
  return BUDDIES.find((b) => b.key === k) || BUDDIES[0];
}

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const sheetOpen = () => document.body.classList.contains('sheet-open');
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

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

// Hair adds to the outline: points over the scalp a little out from the
// skin (clear of the face), and for shoulder length a fall of hair round
// the back and sides down past the jaw.
const HAIR_HULL = new Map();
function hairHull(hair) {
  if (HAIR_HULL.has(hair)) return HAIR_HULL.get(hair);
  const pts = [];
  if (hair && hair !== 'tuft') {
    const vol = { shoulder: 0.1, ponytail: 0.045, short: 0.075, bob: 0.15, highpony: 0.06, long: 0.14, curly: 0.21, curls: 0.22 }[hair] ?? 0.075;
    for (let j = 0; j <= 14; j++) {
      const ph = mix(0.05, Math.PI / 2, j / 14);
      for (let i = 0; i < 40; i++) {
        const th = (i / 40) * TAU - Math.PI;
        if (Math.cos(th) > 0.25 && ph < 0.62) continue;
        const bump = hair === 'short' ? 0.05 * Math.abs(Math.sin(th * 6 + ph * 9)) : 0;
        const p = surf(th, ph);
        const k = 1 + vol + bump;
        pts.push([p[0] * k, p[1] * k, p[2] * k]);
      }
    }
    // A bob: full all round, down to the jaw, the ends turned under.
    if (hair === 'bob') {
      for (let j = 0; j <= 10; j++) {
        const f = j / 10;
        const y = mix(0.15, -0.8, f);
        const rr = (1.2 + 0.03 * f) * (f > 0.9 ? 0.94 : 1);
        for (let i = 0; i <= 22; i++) {
          const th = mix(1.0, TAU - 1.0, i / 22);
          pts.push([Math.sin(th) * rr, y, Math.cos(th) * rr * 0.95]);
        }
      }
    }
    // Long hair: down past the shoulders to the bottom, fuller as it falls.
    if (hair === 'long') {
      for (let j = 0; j <= 14; j++) {
        const f = j / 14;
        const y = mix(0.1, -1.38, f);
        const rr = 1.18 + 0.16 * f;
        for (let i = 0; i <= 22; i++) {
          const th = mix(0.95, TAU - 0.95, i / 22);
          pts.push([Math.sin(th) * rr, y, Math.cos(th) * rr * 0.95]);
        }
      }
    }
    // Big curls: a full cloud round the head, down to the shoulders.
    if (hair === 'curls') {
      for (let j = 0; j <= 12; j++) {
        const f = j / 12;
        const y = mix(0.15, -1.05, f);
        const rr = 1.3 + 0.1 * Math.sin(Math.PI * Math.min(1, f * 1.3));
        for (let i = 0; i <= 22; i++) {
          const th = mix(0.9, TAU - 0.9, i / 22);
          pts.push([Math.sin(th) * rr, y, Math.cos(th) * rr * 0.95]);
        }
      }
    }
    if (hair === 'shoulder') {
      for (let j = 0; j <= 12; j++) {
        const f = j / 12;
        const y = mix(0.1, -1.3, f);
        const rr = 1.1 - 0.08 * f + (f > 0.85 ? 0.08 : 0);
        for (let i = 0; i <= 22; i++) {
          const th = mix(1.12, TAU - 1.12, i / 22);
          pts.push([Math.sin(th) * rr, y, Math.cos(th) * rr * 0.95]);
        }
      }
    }
  }
  HAIR_HULL.set(hair, pts);
  return pts;
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

// Where the outline leaves the neck: one long loop, drawn the way the pen
// carries on, so the neck line runs on through it into the jaw.
function coil(u, v, dir, R) {
  const turn = -1;
  const e1 = [Math.cos(dir), Math.sin(dir)];
  const e2 = [Math.cos(dir + (turn * Math.PI) / 2), Math.sin(dir + (turn * Math.PI) / 2)];
  const rl = R * 0.15;
  const rw = R * 0.07;
  const drift = R * 0.06;
  return Array.from({ length: 26 }, (_, i) => {
    const b = ((i + 1) / 26) * TAU;
    const a1 = rl * Math.sin(b) + (drift * b) / TAU;
    const a2 = rw * (1 - Math.cos(b));
    return [u + e1[0] * a1 + e2[0] * a2, v + e1[1] * a1 + e2[1] * a2];
  });
}

// Every line of the head for one expression, in the head's own space, kept
// to a few strokes the way a single-line drawing goes: they run from one
// feature into the next and loop where the pen turns. Points are [th, ph, off, kind]:
// 'skin' hides when it faces away; 'out' (ears, nose, tuft) hides when it's
// behind the head or inside it.
function headLines(ex, style = BUDDIES[0]) {
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
  if (style.hair === 'tuft') {
    const B = surf(0.15, 1.28);
    const up = normalAt(0.15, 1.28);
    const sd = [1 - up[0] * up[0], -up[0] * up[1], -up[0] * up[2]];
    const sl = Math.hypot(...sd);
    const at = ([x, y]) => [B[0] + (sd[0] / sl) * x + up[0] * y, B[1] + (sd[1] / sl) * x + up[1] * y, B[2] + (sd[2] / sl) * x + up[2] * y];
    const rise = range(6, (t) => [0.03 * t, 0.14 * t]);
    const top = rise[5];
    free([...rise, ...curl(...top, heading(rise[4], top), 0.05, 1, 16), [0.075, 0.175], [0.12, 0.15]].map(at), { w: 1.9, waves: 1.5 });
  }

  // Hair: a hairline over the forehead from temple to temple, and what
  // makes each style.
  const full = { bob: 0.16, long: 0.15 }[style.hair];
  if (full) {
    // A bob or long hair: a full fringe swept from a part on the right
    // down over the left brow, a second line in it, and the hair from the
    // part down to the right temple.
    // Lying on the forehead, so only just off the skin.
    const sweep = (ctrl, o = {}) => stroke(off(spline(ctrl, 26), 0.05), { w: 1.9, waves: 1.5, ...o });
    if (style.hair === 'bob') {
      sweep([[0.55, 1.0], [0.22, 0.56], [-0.18, 0.4], [-0.6, 0.37], [-0.98, 0.42], [-1.22, 0.55]]);
      sweep([[0.46, 0.98], [0.08, 0.64], [-0.34, 0.52], [-0.72, 0.52]], { w: 1.5, op: 0.9 });
      sweep([[0.55, 1.0], [0.72, 0.7], [0.86, 0.45], [0.98, 0.3]]);
    } else {
      // Long: parted a little off centre, falling away each side like curtains.
      sweep([[0.2, 1.08], [-0.1, 0.7], [-0.55, 0.45], [-0.95, 0.38], [-1.15, 0.3]]);
      sweep([[0.2, 1.08], [0.42, 0.7], [0.68, 0.45], [0.9, 0.3]]);
      sweep([[0.12, 1.0], [-0.25, 0.72], [-0.72, 0.56]], { w: 1.5, op: 0.9 });
    }
    // Down each side in front of the ears: the bob to the jaw, turned under
    // toward the chin; long hair in waves over the shoulders to the bottom,
    // with a second lock inside it.
    for (const side of [-1, 1]) {
      const a = onHead(side * 1.15, 0.3, full).p;
      if (style.hair === 'bob') {
        // The far side starts up by the crown: the outline stops at the
        // temple there, so this line is that side of the bob.
        const a1 = side > 0 ? onHead(0.95, 0.85, full).p : a;
        const b = onHead(side * 1.28, -0.2, 0.22).p;
        const c = [side * 1.16, -0.72, 0.4];
        const d = [side * 0.96, -0.86, 0.48];
        free([...range(20, (t) => bez(a1, b, c, d, t)), [side * 0.86, -0.8, 0.5], [side * 0.84, -0.72, 0.5]], { w: 2, waves: 1.5 });
      } else {
        const b = onHead(side * 1.22, -0.3, 0.24).p;
        const c = [side * 1.12, -1.0, 0.44];
        const d = [side * 1.3, -1.36, 0.34];
        const wave = (t) => side * 0.07 * Math.sin(t * Math.PI * 2.5) * Math.sin(Math.PI * t);
        free(range(24, (t) => { const q = bez(a, b, c, d, t); return [q[0] + wave(t), q[1], q[2]]; }), { w: 2, waves: 1.5 });
        const a2 = onHead(side * 1.3, -0.05, 0.26).p;
        const d2 = [side * 1.22, -1.22, 0.3];
        free(range(18, (t) => { const q = bez(a2, [a2[0], -0.6, a2[2] + 0.04], [side * 1.08, -0.95, 0.36], d2, t); return [q[0] + wave(t) * 0.8, q[1], q[2]]; }), { w: 1.5, op: 0.85, waves: 1.2 });
      }
    }
  }

  if (style.hair === 'highpony') {
    // Pulled up smooth from the hairline, tied high on top with a puffy
    // scrunchie, the tail big and wavy, and a wisp loose at each temple.
    const hl = 0.72;
    stroke(off(range(28, (t) => {
      const th = mix(-1.38, 1.38, t);
      return [th, hl - 0.2 * (th / 1.38) ** 2 + 0.012 * Math.sin(t * 11)];
    }), 0.06), { w: 1.9, waves: 2 });
    for (const th0 of [-0.4, 0.05, 0.42]) stroke(off(range(12, (t) => [th0 * (1 - 0.75 * t), mix(hl + 0.02, 1.4, t)]), 0.06), { w: 1.5, waves: 1.2, op: 0.9 });
    const S = onHead(Math.PI - 0.6, 1.36, 0.16).p;
    const scrunch = range(30, (t) => {
      const a = -Math.PI / 2 + t * TAU * 1.05;
      const r = 0.085 + 0.025 * Math.abs(Math.sin(a * 3.5));
      return [S[0] + r * Math.cos(a), S[1] + r * Math.sin(a), S[2]];
    });
    const c1 = [S[0] + 0.5, S[1] + 0.45, S[2] - 0.1];
    const c2 = [S[0] + 1.35, S[1] + 0.05, S[2] - 0.1];
    const E = [S[0] + 1.05, S[1] - 1.5, S[2]];
    const mid = range(30, (t) => bez(S, c1, c2, E, t));
    const edge = (sgn, k = 1) => mid.map((p, i) => {
      const a = mid[Math.max(0, i - 1)];
      const b = mid[Math.min(mid.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const t = i / (mid.length - 1);
      const wd = k * (0.17 * Math.sin(Math.PI * Math.min(1, t * 1.04)) ** 0.6 + 0.03 * Math.sin(t * 17));
      return [p[0] - (dy / l) * wd * sgn, p[1] + (dx / l) * wd * sgn, p[2]];
    });
    free([...scrunch, ...edge(1), ...edge(-1).reverse()], { w: 2, waves: 2 });
    free(edge(1, 0.25).slice(5, 25), { w: 1.4, op: 0.85, waves: 1.2 });
    for (const side of [-1, 1]) {
      stroke(off(range(12, (t) => [side * (1.18 + 0.06 * Math.sin(t * TAU)), mix(0.5, -0.25, t)]), 0.05), { w: 1.5, waves: 0.8 });
    }
  }

  if (style.hair === 'short' || style.hair === 'ponytail' || style.hair === 'shoulder') {
    const hl = style.hair === 'ponytail' ? 0.72 : 0.62;
    const lift = style.hair === 'shoulder' ? 0.1 : 0.06;
    if (style.hair === 'short') {
      // A choppy fringe: the hairline zigzags down onto the forehead.
      stroke(off(range(40, (t) => {
        const th = mix(-1.3, 1.15, t);
        return [th, hl + 0.03 - 0.16 * (th / 1.3) ** 2 - 0.085 * Math.abs(Math.sin(t * Math.PI * 7))];
      }), lift), { w: 1.9, waves: 1 });
    } else {
      stroke(off(range(28, (t) => {
        const th = mix(-1.38, 1.38, t);
        return [th, hl - 0.2 * (th / 1.38) ** 2 + 0.012 * Math.sin(t * 11)];
      }), lift), { w: 1.9, waves: 2 });
    }
    if (style.hair === 'ponytail') {
      // Pulled back over the top, tied high with a loop, and the tail
      // falling away down the side it's turned from.
      for (const th0 of [-0.32, 0.3]) stroke(off(range(12, (t) => [th0 * (1 - 0.7 * t), mix(hl + 0.03, 1.42, t)]), 0.05), { w: 1.6, waves: 1.2 });
      const S = onHead(Math.PI - 0.35, 1.2, 0.18).p;
      const tie = range(14, (t) => {
        const a = -Math.PI / 2 + t * TAU * 1.1;
        return [S[0] + 0.075 * Math.cos(a), S[1] + 0.075 * Math.sin(a), S[2]];
      });
      // The tail as one long thin loop: out along the top, back along the
      // bottom, narrow at the tie and at the tip.
      const c1 = [S[0] + 0.55, S[1] + 0.22, S[2] - 0.08];
      const c2 = [S[0] + 1.2, S[1] - 0.35, S[2] - 0.08];
      const E = [S[0] + 0.95, S[1] - 1.2, S[2]];
      const mid = range(26, (t) => bez(S, c1, c2, E, t));
      const edge = (sgn) => mid.map((p, i) => {
        const a = mid[Math.max(0, i - 1)];
        const b = mid[Math.min(mid.length - 1, i + 1)];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const t = i / (mid.length - 1);
        const wd = 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.7 + 0.012 * Math.sin(t * 19);
        return [p[0] - (dy / l) * wd * sgn, p[1] + (dx / l) * wd * sgn, p[2]];
      });
      free([...tie, ...edge(1), ...edge(-1).reverse()], { w: 1.9, waves: 2 });
    }
    if (style.hair === 'shoulder') {
      // A lock each side of the face, down past the jaw, flicking out.
      for (const side of [-1, 1]) {
        const a = onHead(side * 1.3, 0.42, 0.1).p;
        const b = onHead(side * 1.18, -0.3, 0.16).p;
        const c = [side * 0.98, -1.05, 0.46];
        const d = [side * 1.16, -1.3, 0.34];
        free([...range(16, (t) => bez(a, b, c, d, t)), [d[0] + side * 0.06, d[1] + 0.06, d[2]]], { w: 1.9, waves: 2 });
      }
    }
  }

  // Curls: the pen runs along in small loops, like a phone cord. On the
  // head each row follows a line across it, `rise` lifting the middle.
  if (style.hair === 'curly' || style.hair === 'curls') {
    const big = style.hair === 'curls';
    const loops = (th0, th1, ph0, rise, n, a, b, lift, o = {}) => stroke(off(range(n * 12 + 1, (t) => {
      const w = t * n * TAU;
      const th = mix(th0, th1, t) - a * Math.sin(w);
      const u = th / Math.max(Math.abs(th0), Math.abs(th1));
      return [th, ph0 + rise * (1 - u * u) + b * (1 - Math.cos(w))];
    }), lift), { w: 1.8, waves: 1, ...o });
    // Curls down a side: the pen loops along a curve, bulging toward `side`.
    const column = (a, b, c, d, side, n, A, B, o = {}) => {
      const base = range(n * 12 + 1, (t) => bez(a, b, c, d, t));
      free(base.map((q, i) => {
        const t = i / (base.length - 1);
        const w = t * n * TAU;
        const p0 = base[Math.max(0, i - 1)];
        const p1 = base[Math.min(base.length - 1, i + 1)];
        const dx = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const l = Math.hypot(dx, dy) || 1;
        const along = -A * Math.sin(w);
        const out = B * (1 - Math.cos(w));
        return [q[0] + (dx / l) * along + side * Math.abs(dy / l) * out, q[1] + (dy / l) * along, q[2]];
      }), { w: 1.8, waves: 1, ...o });
    };
    // The hairline over the forehead, the curls hanging onto it, then a
    // row over the crown and a few on top.
    if (big) {
      loops(-1.42, 1.42, 0.4, 0.14, 5, 0.2, 0.16, 0.2);
      loops(-1.25, 1.25, 0.66, 0.1, 5, 0.18, 0.13, 0.23, { w: 1.6, op: 0.9 });
      loops(-1.0, 1.0, 0.92, 0.06, 3, 0.2, 0.13, 0.25, { w: 1.5, op: 0.85 });
    } else {
      // Short curls (looser since 11-09): fewer, rounder loops standing out
      // from the head, and a few down each side to the temple.
      loops(-1.42, 1.42, 0.4, 0.13, 5, 0.21, 0.17, 0.17);
      loops(-1.2, 1.2, 0.7, 0.1, 4, 0.22, 0.16, 0.21, { w: 1.6, op: 0.9 });
      loops(-0.75, 0.75, 1.0, 0.04, 2, 0.24, 0.14, 0.23, { w: 1.5, op: 0.85 });
      column(onHead(-1.08, 0.5, 0.17).p, onHead(-1.16, 0.32, 0.2).p, onHead(-1.2, 0.14, 0.2).p, onHead(-1.18, 0.0, 0.18).p, 1, 2, 0.11, 0.1);
      column(onHead(0.95, 0.9, 0.22).p, onHead(1.32, 0.72, 0.24).p, onHead(1.5, 0.4, 0.24).p, onHead(1.5, 0.08, 0.2).p, 1, 3, 0.13, 0.12);
    }
    if (big) {
      // Down each side to the shoulders: a column of curls by the face and
      // one further out, bulging outward as they fall.
      // The near side (left, where the outline runs) curls in toward the
      // cheek, in front of the outline. The far side, where the outline
      // stops at the temple, starts up by the crown and is that side of the
      // hair, a second column outside it.
      column(onHead(-1.12, 0.45, 0.2).p, onHead(-1.22, -0.2, 0.3).p, [-1.08, -0.72, 0.5], [-1.12, -1.06, 0.46], 1, 5, 0.12, 0.11);
      const top = onHead(0.9, 0.95, 0.24).p;
      column(top, onHead(1.42, 0.1, 0.3).p, [1.3, -0.7, 0.38], [1.26, -1.06, 0.36], 1, 6, 0.13, 0.12);
      const a2 = onHead(1.5, 0.2, 0.3).p;
      column(a2, [a2[0] + 0.08, -0.35, a2[2]], [1.46, -0.78, 0.28], [1.4, -1.02, 0.28], 1, 4, 0.13, 0.11, { w: 1.5, op: 0.85 });
    }
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
  // The soft face's eyes are a little bigger.
  const soft = style.face === 'soft';
  const lidL = mix(0.05, 0.065, ex.joy);
  const lidU = soft ? 0.16 : 0.13;
  const half = soft ? 0.145 : 0.13;
  for (const side of [-1, 1]) {
    const th0 = side * 0.35;
    const outer = th0 + side * half;
    const lid = (s, top) => [mix(outer, th0 - side * half, s), (top ? mix(-lidL, lidU, ex.open) : -lidL) * Math.sin(Math.PI * s)];
    const flick = [[outer + side * 0.035, 0.012], [outer + side * 0.065, 0.045]];
    let pts;
    if (ex.open > 0.12) {
      pts = [...range(13, (s) => lid(s, true)), ...range(13, (s) => lid(1 - s, false)).slice(1), ...flick];
    } else {
      pts = [...range(13, (s) => lid(1 - s, false)), ...flick];
    }
    stroke(off(pts, 0.006), { w: 1.9, waves: 1.2 });
    // The soft face: four long lashes curling out from the outer half of
    // the lid, and with the eyes shut, three along the closed curve.
    if (soft && ex.open > 0.12) {
      for (const [k, s] of [[0, 0.03], [1, 0.14], [2, 0.26], [3, 0.38]]) {
        const [u, v] = lid(s, true);
        const len = 0.1 - k * 0.012;
        stroke(off([[u, v], [u + side * len * 0.35, v + len * 0.7], [u + side * len * 0.85, v + len]], 0.01), { w: 1.7, waves: 0.4 });
      }
    } else if (soft) {
      for (const s of [0.12, 0.28, 0.44]) {
        const [u, v] = lid(s, false);
        stroke(off([[u, v], [u + side * 0.025, v - 0.06]], 0.01), { w: 1.5, waves: 0.3 });
      }
    }
  }

  // Brows. The right one runs on down the side of the nose to its tip and
  // loops for the nostril, all one line; the inner ends rise with worry.
  const base = mix(0.21, 0.25, ex.joy) + (soft ? 0.02 : 0);
  const inner = 0.08 * ex.worry * (1 - ex.joy);
  const outerDrop = -0.02 * ex.worry;
  const arch = mix(0.025, 0.045, ex.joy) - 0.02 * ex.worry + (soft ? 0.04 : 0);
  const brow = (side, t) => [side * mix(0.15, 0.5, t), base + mix(inner, outerDrop, t) + arch * Math.sin(Math.PI * t)];
  {
    const pts = range(12, (t) => brow(-1, t));
    const e = pts[11];
    pts.push([e[0] - 0.04, e[1] - 0.025], [e[0] - 0.055, e[1] - 0.06]);
    stroke(off(pts, 0.008), { w: soft ? 1.6 : 2, waves: 1 });
  }
  {
    const browPts = off(range(12, (t) => brow(1, 1 - t)), 0.008, 'skin');
    const b0 = brow(1, 0);
    // The soft face's nose is shorter and sticks out less.
    const nv = soft ? 0.88 : 1;
    const nz = soft ? 0.7 : 1;
    const nose = spline([[b0[0], b0[1], 0.008], [0.07, b0[1] - 0.09, 0.015], [0.045, -0.02 * nv, 0.03 * nz], [0.03, -0.14 * nv, 0.1 * nz], [0.012, -0.24 * nv, 0.19 * nz], [0, -0.3 * nv, 0.23 * nz], [0.03, -0.33 * nv, 0.15 * nz], [0.06, -0.315 * nv, 0.06 * nz]], 22)
      .slice(1)
      .map(([u, v, o]) => [u, v, o, 'out']);
    const n1 = nose[nose.length - 2];
    const n2 = nose[nose.length - 1];
    const loopPts = curl(n2[0], n2[1], heading(n1, n2), soft ? 0.032 : 0.04, 1, 14).map(([u, v]) => [u, v, 0.05, 'out']);
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
    // The soft face has full lips: an upper lip with a dip in the middle
    // (a cupid's bow) following the mouth, and a round lower lip.
    if (soft) {
      const mouthAt = (u) => -0.5 - smile * depth * Math.sin(Math.PI * clamp(u / width + 0.5, 0, 1));
      stroke(off(range(16, (t) => {
        const u = (t - 0.5) * width * 0.64;
        return [u, mouthAt(u) + 0.055 * Math.sin(Math.PI * t) ** 0.7 - 0.03 * Math.exp(-(((t - 0.5) / 0.09) ** 2))];
      }), 0.01), { w: 1.7, waves: 0.6 });
      const low = m[9][1];
      stroke(off(range(14, (t) => [(t - 0.5) * width * 0.58, low - 0.05 - 0.08 * Math.sin(Math.PI * t)]), 0.01), { w: 1.8, waves: 0.8 });
    }
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

// Where each bubble has been put, kept on this device: its middle, across
// in stage widths and down in the sky's height (like SLOTS).
const SPOTS_KEY = 'callback.bubbleSpots';
function readSpots() {
  try {
    const v = JSON.parse(localStorage.getItem(SPOTS_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function saveSpots() {
  try { localStorage.setItem(SPOTS_KEY, JSON.stringify(st.spots)); } catch { /* this device only */ }
}

const st = {
  el: null,
  svg: null,
  hit: null,
  spots: readSpots(),
  carry: null, // a bubble being moved by hand
  // The bubble drawn over all the others (11-10): one being carried, and
  // for a moment after it's put down, while any it landed on move off.
  lifted: null,
  liftUntil: 0,
  pool: [],
  topPool: [],
  topUsed: 0,
  skyPool: [],
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
  spinGoal: 0,
  style: readBuddy(),
  onFace: null,
  faceAt: 0,
  tilt: 0,
  tiltV: 0,
  tiltGoal: 0,
  drag: null,
  lookYaw: REST_YAW,
  lookPitch: REST_PITCH,
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
  el.innerHTML = '<svg class="mind-sky" aria-hidden="true"></svg><svg class="mind-ink" aria-hidden="true"></svg><svg class="mind-top" aria-hidden="true"></svg><div class="mind-head" role="button" tabindex="0"></div>';
  st.el = el;
  st.sky = el.querySelector('.mind-sky');
  st.svg = el.querySelector('.mind-ink');
  st.top = el.querySelector('.mind-top');
  st.hit = el.querySelector('.mind-head');
  wireHead(st.hit);
  // A phone sends its click a moment after the finger lifts, and by then
  // the picker that tap opened is under the finger: that click would pick
  // a look and shut the picker at once (so tapping the face seemed to do
  // nothing). The first click straight after is dropped.
  window.addEventListener('click', (e) => {
    if (!st.faceAt) return;
    const late = performance.now() - st.faceAt > 450;
    st.faceAt = 0;
    if (late || st.hit.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // On a phone Today doesn't move at all: a drag anywhere on it (outside a
  // popup) only moves what's under the finger, so the page can't be pulled
  // down. (iOS still pulled it about even with the page set not to scroll.)
  document.addEventListener('touchmove', (e) => {
    if (!st.el || !st.el.isConnected || !st.el.closest('.dash.is-mind') || st.el.closest('.peek')) return;
    if (e.target.closest && e.target.closest('.sheet-overlay')) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  new ResizeObserver(() => { resize(); kick(); }).observe(el);
  new IntersectionObserver((entries) => {
    st.visible = entries[entries.length - 1].isIntersecting;
    kick();
  }).observe(el);
  document.addEventListener('visibilitychange', kick);
  // The window's height decides the stage's (a phone's toolbars come and go).
  window.addEventListener('resize', () => { if (st.el.isConnected) { resize(); kick(); } });
}

// The stage runs from where it starts down to the tab bar, so the neck's
// line runs along just over the bar; the head sits at the bottom and the bubbles fill the sky.
function resize() {
  const w = st.el.clientWidth;
  if (!w) return;
  const bar = document.getElementById('tabbar');
  const br = bar && bar.getBoundingClientRect();
  const barTop = br && br.height && br.top > window.innerHeight / 2 ? br.top : window.innerHeight;
  // From the top of its page: the window's (scrolled) or, drawn beside it
  // while the bottom bar is swiped, the peek's.
  const page = st.el.closest('.peek-app');
  const top = st.el.getBoundingClientRect().top + (page ? -page.getBoundingClientRect().top : window.scrollY);
  const h = Math.round(Math.max(w * 0.95, barTop - top));
  if (w === st.w && h === st.h) return;
  st.w = w;
  st.h = h;
  st.el.style.height = `${h}px`;
  st.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  st.top.setAttribute('viewBox', `0 0 ${w} ${h}`);
  st.sky.setAttribute('viewBox', `0 0 ${w} ${h}`);
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
    st.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, raw0: rawSpin(st.spin), rawT0: rawTilt(st.tilt), moved: false };
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
    // Slower than the finger, and harder the further it goes; let go and
    // it turns back. Up tips the chin up, down tips it down.
    const k = (Math.PI / (geom().R * 2)) * 0.5;
    st.spinGoal = softSpin(d.raw0 + dx * k);
    st.tiltGoal = softTilt(d.rawT0 - dy * k);
    kick();
  });
  const end = (e) => {
    const d = st.drag;
    if (!d || d.id !== e.pointerId) return;
    st.drag = null;
    if (!d.moved && e.type === 'pointerup') {
      st.boop = st.t;
      if (st.onFace) {
        st.faceAt = performance.now();
        st.onFace();
      }
    }
    kick();
  };
  hit.addEventListener('pointerup', end);
  hit.addEventListener('pointercancel', end);
  hit.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && st.onFace) {
      e.preventDefault();
      st.onFace();
    }
  });
}

function newBubble(d, i) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'thought';
  btn.innerHTML = '<span class="thought-in"><span class="thought-n"></span><span class="thought-label"></span></span>';
  const b = { key: d.key, seed: hashStr(d.key), state: 'in', p: st.first ? -0.14 * i : 0, wob: 0, x: null, y: null, s: 1, tx: 0, ty: 0, ts: 1, btn, n: d.n, moved: -9 };
  // Picked up and moved: it follows the finger, and isn't opened.
  btn.addEventListener('pointerdown', (e) => {
    if (e.button || b.state === 'pop' || st.carry) return;
    st.carry = { b, id: e.pointerId, x0: e.clientX, y0: e.clientY, from: [b.tx, b.ty], moved: false };
  });
  btn.addEventListener('pointermove', (e) => {
    const c = st.carry;
    if (!c || c.b !== b || c.id !== e.pointerId) return;
    const dx = e.clientX - c.x0;
    const dy = e.clientY - c.y0;
    if (!c.moved) {
      if (Math.hypot(dx, dy) < 8) return;
      c.moved = true;
      st.lifted = b;
      try { btn.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    }
    const [x, y] = fitSpot(c.from[0] + dx / st.w, c.from[1] + (dy / geom().sky) * SKY, b.ts);
    Object.assign(b, { x, y, tx: x, ty: y });
    // The face watches it go, until it's let go.
    st.glance = { key: b.key, until: Infinity };
    kick();
  });
  const drop = (e) => {
    const c = st.carry;
    if (!c || c.b !== b || c.id !== e.pointerId) return;
    st.carry = null;
    if (c.moved) {
      b.moved = performance.now();
      settle(b, c.from);
      st.glance = { key: b.key, until: st.t + 0.5 };
      st.liftUntil = st.t + 1;
    }
    kick();
  };
  btn.addEventListener('pointerup', drop);
  btn.addEventListener('pointercancel', drop);
  btn.addEventListener('click', () => {
    if (b.state === 'pop' || performance.now() - b.moved < 500) return;
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
  if (!live.length || !st.w) return;
  const slots = SLOTS[Math.min(8, live.length)];
  // One or two bubbles have room to spare in a tall sky, so they grow a bit.
  const grow = live.length <= 2 ? clamp(geom().sky / (SKY * st.w), 1, 1.2) : 1;
  const s = slots.s * grow;
  const put = (b, [x, y]) => {
    if (!(st.carry && st.carry.b === b)) Object.assign(b, { tx: x, ty: y });
    b.ts = s;
    if (b.x == null) Object.assign(b, { x, y, s });
    taken.push([x, y]);
  };
  const taken = [];
  const clash = ([x, y]) => taken.some(([u, v]) => overlap(bubPx(x, y, s), bubPx(u, v, s)) < 1);
  // Ones that have been put somewhere stay there; the rest take their own
  // slot, or the first free one.
  for (const b of live) if (st.spots[b.key]) put(b, fitSpot(...st.spots[b.key], s));
  const pool = [...slots.at, ...SLOTS[8].at];
  let i = 0;
  for (const b of live) {
    if (st.spots[b.key]) continue;
    const own = slots.at[Math.min(i, slots.at.length - 1)];
    i += 1;
    put(b, !clash(own) ? own : pool.find((p) => !clash(p)) || own);
  }
}

// A bubble's middle and half sizes on the screen, in pixels.
function bubPx(x, y, s) {
  return { cx: x * st.w, cy: (y / SKY) * geom().sky, rx: BUB.rx * st.w * s * 1.05, ry: BUB.ry * st.w * s * 1.08 };
}
// How far apart two bubbles are: under 1, they overlap.
const overlap = (a, q) => Math.hypot((a.cx - q.cx) / (a.rx + q.rx), (a.cy - q.cy) / (a.ry + q.ry));

// Somewhere a bubble fits: on the stage, and clear of the head.
function fitSpot(x, y, s) {
  if (!st.w) return [x, y];
  const g = geom();
  const rx = BUB.rx * st.w * s * 1.05;
  const ry = BUB.ry * st.w * s * 1.08;
  const inside = (cx, cy) => [clamp(cx, rx + 4, st.w - rx - 4), clamp(cy, ry + 4, st.h - ry - 8)];
  let [cx, cy] = inside(x * st.w, (y / SKY) * g.sky);
  const dx = cx - g.hx;
  const dy = cy - g.hy;
  const d = Math.hypot(dx, dy) || 1;
  const need = g.R * 1.2 + Math.max(rx, ry) * 0.85;
  if (d < need) [cx, cy] = inside(g.hx + (dx / d) * need, g.hy + (dy / d) * need);
  return [cx / st.w, (cy / g.sky) * SKY];
}

// Let go: it stays where it was put down (11-10), and any bubble it's on
// moves off to the nearest spot where it's clear of every other one, so
// each can be read on its own. Where they end up is kept.
function settle(b, from) {
  const CLEAR = 1.25; // a little air between them, not just touching
  const others = [...st.bubbles.values()].filter((o) => o !== b && o.state !== 'pop' && o.x != null);
  const at = (o) => bubPx(o.tx, o.ty, o.ts);
  const clearOf = (o, spot) => {
    const a = bubPx(spot[0], spot[1], o.ts);
    return [b, ...others].every((q) => q === o || overlap(a, at(q)) >= CLEAR);
  };
  for (const o of others) {
    if (overlap(at(b), at(o)) >= CLEAR) continue;
    const me = at(b);
    const q = at(o);
    // Out from under it, trying the way away from it first.
    const away = Math.atan2(q.cy - me.cy || -1, q.cx - me.cx);
    let spot = null;
    const far = Math.max(st.w, st.h);
    for (let d = 6; d < far && !spot; d += 6) {
      for (let i = 0; i < 24 && !spot; i++) {
        const a = away + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
        const s2 = fitSpot((q.cx + Math.cos(a) * d) / st.w, ((q.cy + Math.sin(a) * d) / geom().sky) * SKY, o.ts);
        if (clearOf(o, s2)) spot = s2;
      }
    }
    // Nowhere clear at all: it takes the spot the moved one came from.
    [o.tx, o.ty] = spot || from;
    st.spots[o.key] = [o.tx, o.ty];
  }
  st.spots[b.key] = [b.tx, b.ty];
  saveSpots();
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
    ? `A hand-drawn face, ${pending >= 6 ? 'worried' : 'a little concerned'}: ${st.total} ${st.total === 1 ? 'thing is' : 'things are'} waiting. The bubbles above it open them. Tap the face to change how it looks.`
    : 'A hand-drawn face, smiling: nothing is waiting. Tap it to change how it looks.');
  layout();
}

export function mountMind(slot, data, { onOpen, onFace } = {}) {
  if (!st.el) build();
  st.onOpen = onOpen;
  st.onFace = onFace;
  slot.appendChild(st.el);
  resize();
  update(data);
  kick();
}

// The buddy's look, and a still picture of each for the picker: turned
// as it rests, a calm half smile.
export const buddyStyle = () => st.style;
export function setBuddy(key) {
  const b = BUDDIES.find((x) => x.key === key);
  if (!b) return;
  st.style = b;
  try { localStorage.setItem(BUDDY_KEY, b.key); } catch { /* this device only */ }
  if (st.el) { draw(); kick(); }
}
export function buddySVG(key) {
  const style = BUDDIES.find((x) => x.key === key) || BUDDIES[0];
  const parts = [];
  const out = (d, { w = 2, op = 1 } = {}) => { if (d) parts.push(`<path d="${d}" stroke-width="${w}"${op < 1 ? ` opacity="${op}"` : ''}/>`); };
  const boil = st.boil;
  st.boil = 0;
  drawHead(out, { R: 30, hx: 50, hy: 54, yaw: REST_YAW, pitch: REST_PITCH, roll: 0, squash: 0, bottom: 102, style, ex: { worry: 0, joy: 0.35, open: 0.6, lookU: 0, lookV: 0 } });
  st.boil = boil;
  return `<svg class="buddy-pic" viewBox="0 0 100 100" aria-hidden="true">${parts.join('')}</svg>`;
}

// For tests: move time on by hand (a hidden test browser runs no frames).
export function mindStep(seconds = 0, set = {}) {
  Object.assign(st, set);
  for (let s = 0; s < seconds; s += 1 / 60) step(1 / 60);
  draw();
}

// What's showing, for checking it in a test.
export function mindInfo() {
  return { worry: st.worry, joy: st.joy, pending: st.pending, spin: st.spin, tilt: st.tilt, lookYaw: st.lookYaw, lookPitch: st.lookPitch, glance: st.glance && st.glance.key, bubbles: [...st.bubbles.values()].map((b) => ({ key: b.key, n: b.n, state: b.state, p: b.p })) };
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
  const busy = st.drag || (st.carry && st.carry.moved) || st.lifted || [...st.bubbles.values()].some((b) => b.x != null && (Math.abs(b.x - b.tx) > 0.0005 || Math.abs(b.y - b.ty) > 0.0005)) || Math.abs(st.spinV) > 0.05 || Math.abs(st.spin) > 0.002 || Math.abs(st.tilt) > 0.002 || [...st.bubbles.values()].some((b) => b.state !== 'on' || b.wob > 0.01);
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

  // Turned by hand it follows the finger a little behind; let go and it
  // eases back to where it rests.
  const spinTo = st.drag && st.drag.moved ? st.spinGoal : 0;
  st.spinV += (-(st.drag ? 40 : 14) * (st.spin - spinTo) - (st.drag ? 12 : 7.5) * st.spinV) * dt;
  st.spin += st.spinV * dt;
  if (!st.drag && Math.abs(st.spin) < 1e-4 && Math.abs(st.spinV) < 1e-3) st.spin = st.spinV = 0;
  const tiltTo = st.drag && st.drag.moved ? st.tiltGoal : 0;
  st.tiltV += (-(st.drag ? 40 : 30) * (st.tilt - tiltTo) - (st.drag ? 12 : 10) * st.tiltV) * dt;
  st.tilt += st.tiltV * dt;
  if (!st.drag && Math.abs(st.tilt) < 1e-4 && Math.abs(st.tiltV) < 1e-3) st.tilt = st.tiltV = 0;
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
  // Only a little: it mostly holds still and lets you turn it. A bubble
  // being carried it follows properly, wherever it goes.
  const carried = !!(gb && st.carry && st.carry.moved && st.carry.b === gb);
  let yawT = REST_YAW + (calm ? 0 : 0.035 * Math.sin(t * 0.37));
  let pitchT = REST_PITCH + (live.length ? 0.03 : 0) + (calm ? 0 : 0.012 * Math.sin(t * 0.51));
  if (gb && st.w && gb.x != null) {
    const g = geom();
    yawT = clamp(REST_YAW * 0.5 + (gb.x - HEAD.x) * (carried ? 0.95 : 0.6), carried ? -0.75 : -0.45, carried ? 0.6 : 0.3);
    pitchT = clamp(((g.hy - (gb.y / SKY) * g.sky) / st.w) * (carried ? 0.5 : 0.35) + REST_PITCH * 0.5, REST_PITCH * 0.7, REST_PITCH + (carried ? 0.32 : 0.14));
  }
  const rate = carried ? 8 : gb ? 4 : 1.5;
  st.lookYaw = approach(st.lookYaw, yawT, rate, dt);
  st.lookPitch = approach(st.lookPitch, pitchT, rate, dt);

  if (!calm && t > st.blinkAt) {
    st.blinkFrom = t;
    st.blinkAt = t + 2.4 + hash1(t * 1.7) * 3.2;
  }

  if (st.lifted && !(st.carry && st.carry.b === st.lifted) && st.t > st.liftUntil) st.lifted = null;
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

// top: on the layer over every bubble's words (the lifted bubble's cloud).
function put(d, { w = 2, op = 1, fill = null } = {}, top = false) {
  const pool = top ? st.topPool : st.pool;
  const i = top ? st.topUsed++ : st.used++;
  let p = pool[i];
  if (!p) {
    p = document.createElementNS(NS, 'path');
    (top ? st.top : st.svg).appendChild(p);
    pool[i] = p;
    p._ = {};
  }
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
  st.topUsed = 0;
  const w = st.w;
  const t = st.t;
  const calm = reduced.matches;
  const g = geom();
  const R = g.R * (1 + (calm ? 0 : 0.003 * Math.sin(t * 1.6)));
  const { hx, hy, sky } = g;
  const bt = t - st.boop;
  const squash = bt < 0.5 ? 0.06 * Math.sin(bt * 18) * Math.exp(-bt * 7) : 0;
  const roll = (calm ? 0 : st.joy * 0.025 * Math.sin(t * 0.55)) + (bt < 0.8 ? 0.08 * Math.sin(bt * 14) * Math.exp(-bt * 5) : 0);
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
  drawHead(put, { R, hx, hy, yaw: st.spin + st.lookYaw, pitch: st.lookPitch + st.tilt, roll, squash, bottom: st.h + 2, trail: true, style: st.style, ex });

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

  drawSky({ R, hx, hy });

  for (let i = st.used; i < st.pool.length; i++) {
    const p = st.pool[i];
    if (p._.d !== '') { p.setAttribute('d', ''); p._.d = ''; }
  }
  for (let i = st.topUsed; i < st.topPool.length; i++) {
    const p = st.topPool[i];
    if (p._.d !== '') { p.setAttribute('d', ''); p._.d = ''; }
  }
}

// The sky behind it all (sky.js): the sun by day, stars at night. Clouds
// are filled, so whatever is behind one is hidden.
function drawSky({ R, hx, hy }) {
  // Where the clouds are going (not where they bob), so the stars beside
  // the head can keep out from under them; one being carried doesn't count
  // until it's put down.
  const clouds = [...st.bubbles.values()]
    .filter((b) => b.state !== 'pop' && b.tx != null && !(st.carry && st.carry.b === b))
    .map((b) => bubPx(b.tx, b.ty, b.ts || b.s || 1));
  const lines = skyLines({ W: st.w, hx, hy, R, t: st.t, calm: reduced.matches, clouds });
  lines.forEach((l, i) => {
    let p = st.skyPool[i];
    if (!p) {
      p = document.createElementNS(NS, 'path');
      st.sky.appendChild(p);
      st.skyPool[i] = p;
      p._ = {};
    }
    const c = p._;
    const fill = l.fill || 'none';
    if (c.d !== l.d) { p.setAttribute('d', l.d); c.d = l.d; }
    if (c.s !== l.stroke) { p.setAttribute('stroke', l.stroke); c.s = l.stroke; }
    if (c.w !== l.w) { p.setAttribute('stroke-width', l.w); c.w = l.w; }
    if (c.f !== fill) { p.setAttribute('fill', fill); c.f = fill; }
    if (c.op !== l.op) { p.setAttribute('opacity', l.op); c.op = l.op; }
  });
  for (let i = lines.length; i < st.skyPool.length; i++) {
    const p = st.skyPool[i];
    if (p._.d !== '') { p.setAttribute('d', ''); p._.d = ''; }
  }
}

// The head itself, into `out` (the page's pool of lines, or a picture of
// it for the picker): where it is, which way it's turned, its look and
// its face.
function drawHead(out, P) {
  const { R, hx, hy, yaw, pitch, roll, squash, style, ex } = P;
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
  const skin = hull([...SKIN, ...hairHull(style.hair)].map((p) => scr(rot(p))));
  const cont = contour(skin, hx, R);
  let way;
  let swingOK = true;
  let upPart = null;
  let arc = null;
  let trail = null;
  if (cont) {
    const bottom = P.bottom;
    const [lx, ly] = cont.L;
    let up = [[lx - R * 0.06, bottom], [lx - R * 0.03, mix(bottom, ly, 0.5)], [lx, ly]];
    if (P.trail) {
      // On Today there's no bar line for the neck to stand on: the pen comes
      // in from the left along the bottom, thin, thickening as it turns up
      // into the neck.
      const yb = bottom - 2 - R * 0.07;
      const fx = lx - R * 0.07;
      const x0 = Math.max(R * 0.12, hx - R * 1.55);
      const run = spline([[x0, yb + R * 0.02], [mix(x0, fx, 0.5), yb + R * 0.035], [fx - R * 0.26, yb + R * 0.012], [fx - R * 0.06, yb - R * 0.035], [fx, yb - R * 0.16], [lx - R * 0.03, mix(yb, ly, 0.55)], [lx, ly]], 44);
      const cut = 18;
      trail = run.slice(0, cut + 1);
      up = run.slice(cut);
    }
    const loopPts = coil(lx, ly - R * 0.02, heading(up[up.length - 2], up[up.length - 1]), R);
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
    out(inkPath(pts, 1.7, 2.5, 0.8), { w: 2.1 });
    if (trail) {
      // Thinner and thinner the farther left it runs.
      const m = trail.length - 1;
      const tp = trail.map((p, i) => [p[0], p[1], -6.4 + (1.4 * i) / m]);
      const K = 6;
      for (let k = 0; k < K; k++) {
        const a = Math.floor((k * m) / K);
        const b = Math.floor(((k + 1) * m) / K);
        out(inkPath(tp.slice(a, b + 1), 1.7, 2.5, 0.8), { w: r1(mix(0.45, 1.9, ((k + 1) / K) ** 1.4)) });
      }
    }
    wayDone = true;
  };

  let joinRun = null;
  for (const line of headLines(ex, style)) {
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
        if (len < Math.max(1.2, R * 0.045)) { run = []; return; } // no specks where a line turns away
        // The brow-and-nose line waits: the outline may run on into it.
        if (line.join && from === 0 && !joinRun) joinRun = { run, line, op };
        else out(inkPath(run, line.seed, line.waves, 0.7), { w: line.w, op: r1(op) });
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
  if (joinRun && !swung) out(inkPath(joinRun.run, joinRun.line.seed, joinRun.line.waves, 0.7), { w: joinRun.line.w, op: r1(joinRun.op) });

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

// The trail: one line from the head out to the bubble that squiggles on its
// way, small by the head and wider as it nears the bubble.
function trail(x0, y0, x1, y1, unit, seed) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const side = seed % 2 ? 1 : -1;
  const bow = Math.min(9, len * 0.07) * side;
  const waves = Math.max(2, len / (24 * unit));
  const ph0 = hash1(seed) * TAU;
  const N = Math.ceil(waves * 12);
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const amp = mix(1.6, 4.6, s) * unit * (1 + 0.35 * noise(seed + s * 5)) * Math.min(1, s * 6);
    const off = bow * Math.sin(Math.PI * s) + amp * Math.sin(ph0 + s * waves * TAU + 0.8 * noise(seed * 2 + s * 3));
    pts.push([x0 + ux * s * len - uy * off, y0 + uy * s * len + ux * off, s]);
  }
  return pts;
}

function drawBubble(b, { w, R, hx, hy, sky }, pass) {
  if (b.x == null) return;
  const t = st.t;
  const calm = reduced.matches;
  // Each cloud drifts ever so slightly on its own slow loop: a few px side
  // to side and up and down, never in step with the others. The words go
  // with it, the same distance at the same moment (11-10: a little slower).
  const dt = t * 0.65;
  const driftX = calm ? 0 : (Math.sin(dt * 0.31 + b.seed) * 0.6 + Math.sin(dt * 0.17 + b.seed * 1.7) * 0.4) * 0.009;
  const driftY = calm ? 0 : (Math.sin(dt * 0.43 + b.seed * 0.6) * 0.7 + Math.sin(dt * 0.9 + b.seed) * 0.3) * 0.004;
  const cx = (b.x + driftX) * w;
  const cy = ((b.y + driftY) / SKY) * sky;
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

  // A lifted bubble (being carried, or just put down) is drawn over all the
  // others, words and all, and its cloud hides whatever is under it.
  const lifted = st.lifted === b;
  if (cloudPart > 0 && scale > 0.02) {
    const pts = cloud(cx, cy, rx, ry, b.seed);
    const k = Math.ceil(cloudPart * (pts.length - 1)) + 1;
    put(inkPath(pts.slice(0, k), b.seed * 1.3, 4, 0.5), { w: 2, fill: cloudPart >= 1 ? 'var(--bg)' : null }, lifted);
  }
  if (b.btn._lift !== lifted) { b.btn.classList.toggle('is-lifted', lifted); b.btn._lift = lifted; }
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
  // The button only moves, on a layer of its own so it glides by fractions
  // of a pixel just like the cloud's line; its words grow and shrink inside.
  const tf = `translate(${r2(cx - bw / 2)}px, ${r2(cy - bh / 2)}px)`;
  if (btn._tf !== tf) { btn.style.transform = tf; btn._tf = tf; }
  const sc = `scale(${Math.max(0.01, Math.round(scale * 1000) / 1000)})`;
  if (btn._sc !== sc) { btn.firstChild.style.transform = sc; btn._sc = sc; }
  if (btn._w !== bw) { btn.style.width = `${bw}px`; btn.style.height = `${bh}px`; btn._w = bw; }
  const op = r1(textOp);
  if (btn._op !== op) { btn.style.opacity = op; btn._op = op; }
  btn.style.pointerEvents = b.state === 'pop' ? 'none' : '';
}
