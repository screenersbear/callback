// The sky behind Today's buddy (11-10).
//
// By day a hand-drawn sun with little rays crosses the sky with the time:
// up on the left in the morning, highest at midday, down on the right. In
// golden hour it turns orange and the page warms a touch. After dark the
// page grays a little and outline stars come out in the sky over the
// buddy's head and one either side (clear of any hair), some behind the
// clouds, each drifting a little.
//
// Sunrise and sunset are worked out for today from the phone's time zone
// (a city for the common ones, else the zone's own longitude), so no
// location is asked for. Close enough for a sky: within half an hour or so.

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

// A city's latitude and longitude for the common time zones.
const ZONES = {
  'America/New_York': [40.7, -74], 'America/Detroit': [42.3, -83], 'America/Chicago': [41.9, -87.6],
  'America/Denver': [39.7, -105], 'America/Phoenix': [33.4, -112], 'America/Los_Angeles': [34.05, -118.25],
  'America/Anchorage': [61.2, -149.9], 'Pacific/Honolulu': [21.3, -157.9], 'America/Puerto_Rico': [18.4, -66.1],
  'America/Toronto': [43.7, -79.4], 'America/Vancouver': [49.3, -123.1], 'America/Halifax': [44.6, -63.6],
  'America/Mexico_City': [19.4, -99.1], 'America/Bogota': [4.7, -74.1], 'America/Lima': [-12, -77],
  'America/Caracas': [10.5, -66.9], 'America/Santo_Domingo': [18.5, -69.9], 'America/Havana': [23.1, -82.4],
  'America/Sao_Paulo': [-23.5, -46.6], 'America/Argentina/Buenos_Aires': [-34.6, -58.4], 'America/Santiago': [-33.4, -70.6],
  'Europe/London': [51.5, -0.1], 'Europe/Dublin': [53.3, -6.3], 'Europe/Lisbon': [38.7, -9.1], 'Europe/Madrid': [40.4, -3.7],
  'Europe/Paris': [48.9, 2.35], 'Europe/Amsterdam': [52.4, 4.9], 'Europe/Berlin': [52.5, 13.4], 'Europe/Rome': [41.9, 12.5],
  'Europe/Athens': [38, 23.7], 'Europe/Istanbul': [41, 29], 'Europe/Moscow': [55.8, 37.6], 'Africa/Lagos': [6.5, 3.4],
  'Africa/Cairo': [30, 31.2], 'Africa/Johannesburg': [-26.2, 28], 'Africa/Nairobi': [-1.3, 36.8], 'Asia/Dubai': [25.2, 55.3],
  'Asia/Kolkata': [22.6, 88.4], 'Asia/Bangkok': [13.75, 100.5], 'Asia/Singapore': [1.35, 103.8], 'Asia/Jakarta': [-6.2, 106.8],
  'Asia/Manila': [14.6, 121], 'Asia/Shanghai': [31.2, 121.5], 'Asia/Hong_Kong': [22.3, 114.2], 'Asia/Seoul': [37.6, 127],
  'Asia/Tokyo': [35.7, 139.7], 'Australia/Perth': [-31.95, 115.9], 'Australia/Sydney': [-33.9, 151.2],
  'Australia/Melbourne': [-37.8, 145], 'Pacific/Auckland': [-36.85, 174.8],
};

let testNow = null;
// For checking by hand: pass a Date (or null to go back to the clock).
export function skyTestTime(d) {
  testNow = d;
  tint();
}
const now = () => testNow || new Date();

function place(d) {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* no zone */ }
  if (ZONES[zone]) return ZONES[zone];
  // The zone's own meridian, and a middling latitude for its hemisphere.
  const south = /^(Australia|Antarctica)\//.test(zone) || ['America/Montevideo', 'America/Asuncion', 'America/La_Paz'].includes(zone);
  return [south ? -30 : 35, -d.getTimezoneOffset() / 4];
}

// Sunrise and sunset today, in minutes after local midnight (NOAA's
// simple formulas). Far north in summer the sun may not set: clamped.
const cache = { key: '', rise: 0, set: 0 };
function sunTimes(d) {
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (cache.key === key) return cache;
  const [lat, lon] = place(d);
  const doy = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
  const g = (TAU / 365) * (doy - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
  const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) / RAD;
  const off = d.getTimezoneOffset();
  Object.assign(cache, {
    key,
    rise: Math.max(60, 720 - 4 * (lon + ha) - eq - off),
    set: Math.min(23 * 60, 720 - 4 * (lon - ha) - eq - off),
  });
  return cache;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

// Where the day is: the sun's way across (0 at sunrise, 1 at sunset), how
// golden it is, and how much it's night (0 by day, 1 an hour after sunset).
export function skyNow() {
  const d = now();
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const { rise, set } = sunTimes(d);
  const evening = smooth(set - 75, set - 20, m);
  const morning = 0.6 * smooth(rise - 20, rise, m) * (1 - smooth(rise + 15, rise + 55, m));
  return {
    f: (m - rise) / (set - rise),
    // The page warms in golden hour and lets go of it as the light goes.
    golden: Math.max(evening * (1 - smooth(set + 10, set + 35, m)), morning),
    // The sun itself stays orange all the way down.
    sunGold: Math.max(evening, morning),
    night: Math.max(smooth(set + 5, set + 60, m), 1 - smooth(rise - 50, rise, m)),
    rise,
    set,
  };
}

// The page's colours: warmer in golden hour, grayer at night. Only the
// light look changes; the dark look is already night.
const root = document.documentElement;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => root.getAttribute('data-theme') === 'dark' || (root.getAttribute('data-theme') !== 'light' && darkQuery.matches);
const r2 = (v) => Math.round(v * 100) / 100;
function tint() {
  const s = skyNow();
  const golden = isDark() ? 0 : r2(s.golden);
  const night = isDark() ? 0 : r2(s.night);
  const on = golden > 0 || night > 0;
  root.classList.toggle('sky-tint', on);
  if (on) {
    root.style.setProperty('--golden', golden);
    root.style.setProperty('--night', night);
  } else {
    root.style.removeProperty('--golden');
    root.style.removeProperty('--night');
  }
}

let started = false;
export function startSky() {
  if (started) return;
  started = true;
  tint();
  setInterval(tint, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tint(); });
  darkQuery.addEventListener('change', tint);
  new MutationObserver(tint).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}

// ---------------------------------------------------------------------------
// Drawing: lines for the stage behind the buddy, each { d, stroke, w, fill, op }.

function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x) { const i = Math.floor(x); const f = x - i; const u = f * f * (3 - 2 * f); return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1; }
const r1 = (v) => Math.round(v * 10) / 10;
function mixHex(a, b, k) {
  const A = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const B = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

// A round line with the ink's wobble, closed a little past where it began.
function ring(cx, cy, R, seed) {
  const N = 36;
  const p = [];
  for (let i = 0; i <= N + 2; i++) {
    const a = (i / N) * TAU;
    const o = R * 0.05 * noise(seed + (i % N) * 0.37);
    p.push([cx + Math.cos(a) * (R + o), cy + Math.sin(a) * (R + o)]);
  }
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) d += `Q${r1(p[i][0])} ${r1(p[i][1])} ${r1((p[i][0] + p[i + 1][0]) / 2)} ${r1((p[i][1] + p[i + 1][1]) / 2)}`;
  return d;
}

// A five-point star in outline, the line running on a little at the end.
function star(cx, cy, r, seed, spin) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + spin + (i / 10) * TAU;
    const rr = i % 2 ? r * 0.45 : r;
    p.push([cx + Math.cos(a) * rr + noise(seed + i) * r * 0.06, cy + Math.sin(a) * rr + noise(seed + i + 9) * r * 0.06]);
  }
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 1; i <= 10; i++) d += `L${r1(p[i % 10][0])} ${r1(p[i % 10][1])}`;
  return `${d}L${r1(p[0][0] + (p[1][0] - p[0][0]) * 0.18)} ${r1(p[0][1] + (p[1][1] - p[0][1]) * 0.18)}`;
}

// Stars over the head, as [across, down, size]: down runs from the top of
// the stage (0) to just above the tallest hair (1), so none sits beside or
// below the buddy and none touches any hairstyle (11-10). Some land behind
// the clouds, which cover them.
const STARS = [
  [0.05, 0.05, 7], [0.18, 0.22, 9], [0.31, 0.03, 6], [0.43, 0.3, 8], [0.56, 0.07, 10], [0.68, 0.25, 6], [0.81, 0.04, 8], [0.94, 0.19, 7],
  [0.09, 0.52, 6], [0.25, 0.66, 8], [0.38, 0.84, 5], [0.51, 0.57, 7], [0.64, 0.86, 9], [0.77, 0.6, 6], [0.9, 0.78, 9],
  [0.03, 0.95, 6], [0.97, 0.97, 7],
];
// How far the hair can reach above the middle of the head, in head radii:
// the high ponytail at 1.74 with the head turned and tipped as far as it
// goes (every style measured 11-10), plus a little room.
const HAIR_TOP = 1.85;
// And one a little lower each side of the head, in toward it, as [across,
// up] in head radii from its middle (11-10). Each side has a few spots, best
// first, and its star takes the first one no cloud is sitting on and that
// fits on the screen. Measured over every hairstyle, turn and tilt the same
// way: the nearest hair is 0.55 radii or more off the left ones, 0.3 or
// more off the right ones (the high ponytail's tail), so they stay clear
// as they drift.
const SIDE_STARS = [
  [[-1.15, 1.65], [-1.45, 1.35], [-1.6, 1.1]],
  [[1.2, 1.78], [1.45, 1.55], [1.6, 1.4]],
];
const SIDE_SIZE = 8;

// clouds: where the thought clouds sit, as { cx, cy, rx, ry } in pixels.
export function skyLines({ W, hx, hy, R, t, calm, clouds = [] }) {
  const s = skyNow();
  const dark = isDark();
  const out = [];
  const top = 14;
  const low = hy - R * 0.55; // where the sun comes up and goes down
  // The sun, rising on the left and setting on the right.
  if (s.f > -0.05 && s.f < 1.05) {
    const f = clamp(s.f, 0, 1);
    const sink = s.f < 0 ? -s.f : s.f > 1 ? s.f - 1 : 0;
    const fade = 1 - smooth(0.25, 1, sink / 0.05);
    const sr = clamp(W * 0.065, 18, 30);
    const x = W * (0.08 + 0.84 * f);
    const y = low - (low - (top + sr * 1.7)) * Math.sin(Math.PI * f) + sink * 900 + (calm ? 0 : Math.sin(t * 0.6) * 1.6);
    const stroke = mixHex('#f2bd00', '#ec7a14', s.sunGold);
    const fill = dark ? mixHex('#5c5530', '#6a4a2c', s.sunGold) : mixHex('#fff3b0', '#ffc98a', s.sunGold);
    out.push({ d: ring(x, y, sr, 3.1), stroke, w: 2.2, fill, op: fade });
    // Little rays, slowly turning, each breathing in and out a touch.
    const turn = calm ? 0 : t * 0.05;
    let rays = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + turn;
      const len = sr * (0.32 + (calm ? 0 : 0.08 * Math.sin(t * 0.9 + i * 1.7))) * (i % 2 ? 0.8 : 1);
      const r0 = sr * 1.28;
      rays += `M${r1(x + Math.cos(a) * r0)} ${r1(y + Math.sin(a) * r0)}L${r1(x + Math.cos(a + 0.03) * (r0 + len))} ${r1(y + Math.sin(a + 0.03) * (r0 + len))}`;
    }
    out.push({ d: rays, stroke, w: 2.2, fill: null, op: fade });
  }
  // Night: outline stars, each twinkling on its own.
  if (s.night > 0.01) {
    // The lowest a star's middle goes: its points stay clear of the hair.
    const bottom = Math.max(top, hy - R * HAIR_TOP - 12);
    const color = dark ? '#e9c548' : '#dca800';
    const m = SIDE_SIZE + 6;
    const free = ([x, y]) => x > m && x < W - m && clouds.every((c) => Math.hypot((x - c.cx) / (c.rx + m), (y - c.cy) / (c.ry + m)) > 1);
    const spots = [
      ...STARS.map(([ax, dy, size]) => [W * ax, top + (bottom - top) * dy, size]),
      // A side one with every spot under a cloud or off the screen is left out.
      ...SIDE_STARS.map((list) => list.map(([ax, up]) => [hx + ax * R, hy - up * R, SIDE_SIZE]).find(free) || null),
    ];
    spots.forEach((spot, i) => {
      if (!spot) return;
      const [x0, y0, size] = spot;
      // Each drifts in a small slow loop of its own and rocks a little,
      // besides twinkling.
      const x = x0 + (calm ? 0 : 2.2 * Math.sin(t * (0.28 + hash(i + 9) * 0.2) + i * 1.7));
      const y = y0 + (calm ? 0 : 1.8 * Math.cos(t * (0.24 + hash(i + 3) * 0.2) + i * 2.3));
      const spin = hash(i + 4) * 0.4 - 0.2 + (calm ? 0 : 0.14 * Math.sin(t * (0.35 + hash(i + 6) * 0.25) + i));
      const tw = calm ? 1 : 0.82 + 0.18 * Math.sin(t * (0.7 + hash(i) * 0.6) + i * 2.1);
      const sz = size * (calm ? 1 : 0.94 + 0.08 * Math.sin(t * 0.5 + i));
      out.push({ d: star(x, y, sz, i * 3.7, spin), stroke: color, w: 1.9, fill: null, op: Math.round(s.night * tw * 100) / 100 });
    });
  }
  return out;
}
