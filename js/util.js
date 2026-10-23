// Small shared helpers: ids, dates, escaping, downloads.
// Dates the app reasons about (touchpoint dates, next dates, news dates) are
// plain local 'YYYY-MM-DD' strings, never Date objects, so a record means the
// same day on every device and in every export. Timestamps (createdAt,
// updatedAt) are ISO strings.

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function nowISO() {
  return new Date().toISOString();
}

const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ?today=YYYY-MM-DD pins "today" for the session. A testing aid only: it is
// never stored, so a normal launch always uses the real date.
const pinnedToday = (() => {
  try {
    const v = new URLSearchParams(location.search).get('today');
    return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null;
  } catch {
    return null;
  }
})();

export function todayStr() {
  return pinnedToday || toDateStr(new Date());
}

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function addMonths(s, n) {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toDateStr(d);
}

// Whole days from a to b. Rounded, so a daylight-saving 23 or 25 hour day
// still counts as one.
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

export function maxDate(...dates) {
  return dates.filter(Boolean).sort().pop() || null;
}

// Weeks start on Monday.
export function weekStartStr(s) {
  const d = parseDate(s);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return toDateStr(d);
}

export function fmtDate(s, { weekday = true, year = 'auto' } = {}) {
  if (!s) return '';
  const d = parseDate(s);
  const showYear = year === true || (year === 'auto' && d.getFullYear() !== parseDate(todayStr()).getFullYear());
  return d.toLocaleDateString(undefined, {
    weekday: weekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: showYear ? 'numeric' : undefined,
  });
}

export function fmtLongDate(s) {
  return parseDate(s).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function fmtTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return fmtDate(toDateStr(d), { weekday: false, year: true });
}

// "today", "tomorrow", "in 5 days", "3 days ago"
export function relDay(s, today = todayStr()) {
  const n = daysBetween(today, s);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// 42 -> "6 weeks", 90 -> "3 months", 10 -> "10 days"
export function span(days) {
  const n = Number(days);
  if (!n) return '0 days';
  if (n === 1) return '1 day';
  if (n % 30 === 0 && n >= 60) return `${n / 30} months`;
  if (n % 7 === 0 && n <= 84) return n === 7 ? '1 week' : `${n / 7} weeks`;
  return `${n} days`;
}

export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Small stable hash for picking a rotating item per person per day.
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function normalizeUrl(v) {
  const s = (v || '').trim();
  if (!s) return '';
  return /^[a-z]+:\/\//i.test(s) ? s : `https://${s}`;
}

export function instagramUrl(v) {
  const s = (v || '').trim();
  if (!s) return '';
  if (/instagram\.com/i.test(s)) return normalizeUrl(s);
  return `https://instagram.com/${s.replace(/^@/, '')}`;
}

// Saves a file. On phones the share sheet is the dependable way to get a
// file out of an installed web app, so it is tried first there; desktops
// always get a normal download.
export async function saveFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.canShare) {
    const file = new File([blob], filename, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return true;
      } catch (err) {
        if (err && err.name === 'AbortError') return false;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
