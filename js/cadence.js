// The cadence engine: given a person, their touchpoints and the settings,
// work out when to reach out next. Pure functions only, no storage or DOM,
// so the same rules can run anywhere (a future sync server or feed included).
import { addDays, addMonths, todayStr, maxDate, span, daysBetween, toDateStr } from './util.js';

export const WARMTH = ['cold', 'warm', 'active', 'client', 'parked'];

export const WARMTH_INFO = {
  cold: { label: 'Cold', blurb: "You haven't really connected yet." },
  warm: { label: 'Warm', blurb: 'You know each other.' },
  active: { label: 'Active', blurb: "You're talking about something right now." },
  client: { label: 'Client', blurb: "They've hired you." },
  parked: { label: 'Parked', blurb: 'Resting for now. Callback brings them back later.' },
};

// How many notes make up the cold sequence: first note, follow-up, last try.
export const COLD_STEPS = 3;

export const DEFAULT_SETTINGS = {
  id: 'settings',
  cadence: {
    coldFollowUp: 7, // days after the first note
    coldLastTry: 21, // days after the follow-up
    coldWait: 7, // days to wait for a reply after the last try
    warm: 42,
    active: 30,
    client: 90,
    parked: 180,
  },
  goals: { touchpoints: 10, newPeople: 3 },
};

export function withDefaults(s) {
  const d = DEFAULT_SETTINGS;
  return {
    ...d,
    ...(s || {}),
    cadence: { ...d.cadence, ...((s && s.cadence) || {}) },
    goals: { ...d.goals, ...((s && s.goals) || {}) },
  };
}

export function sortTouchpoints(tps) {
  return [...tps].sort((a, b) =>
    a.date === b.date ? (b.createdAt || '').localeCompare(a.createdAt || '') : b.date.localeCompare(a.date));
}

export function lastTouchpoint(tps) {
  return sortTouchpoints(tps)[0] || null;
}

// Touchpoints that count toward the current cold sequence: the ones logged
// since the person was last set to cold (so a note logged with an earlier
// date still counts), plus any dated after that day.
export function coldTouchpoints(person, tps) {
  const since = person.coldSince;
  if (!since) return tps;
  const sinceDay = toDateStr(new Date(since));
  return tps.filter((t) => (t.createdAt || '') >= since || t.date > sinceDay);
}

export function coldState(person, tps) {
  const seq = coldTouchpoints(person, tps);
  return {
    sent: seq.length,
    replied: seq.some((t) => t.responded === 'yes'),
    done: seq.length >= COLD_STEPS,
  };
}

function overrideDays(person) {
  const n = Number(person.cadenceOverrideDays);
  return n > 0 ? Math.round(n) : 0;
}

// The next touchpoint date for a person, from their most recent touchpoint.
// Order of rules: parked first (they rest, whatever else is set), then the
// person's own cadence override, then their warmth default, then for cold
// people the step they're on in the sequence.
export function computeNextDate(person, tps, settings, today = todayStr()) {
  const c = withDefaults(settings).cadence;
  const last = lastTouchpoint(tps);

  if (person.warmth === 'parked') {
    // Rest counts from whichever is later: the last touchpoint or the day
    // they were parked, so parking someone always buys the full rest.
    return addDays(maxDate(last && last.date, person.parkedOn || today), c.parked);
  }

  if (!last) return person.nextTouchpointDate || today;

  const custom = overrideDays(person);
  if (custom) return addDays(last.date, custom);

  if (person.warmth === 'cold') {
    const { sent } = coldState(person, tps);
    if (sent === 0) return person.nextTouchpointDate || today;
    const gap = sent === 1 ? c.coldFollowUp : sent === 2 ? c.coldLastTry : c.coldWait;
    return addDays(last.date, gap);
  }

  return addDays(last.date, c[person.warmth] || c.warm);
}

// Fields to merge into a person when their warmth changes, so the cold
// sequence restarts and parking remembers where they came from.
export function warmthChangeFields(person, newWarmth, nowIso, today = todayStr()) {
  const f = { warmth: newWarmth };
  if (newWarmth === 'cold') f.coldSince = nowIso;
  if (newWarmth === 'parked') {
    f.parkedOn = today;
    if (person.warmth && person.warmth !== 'parked') f.warmthBeforePark = person.warmth;
  }
  return f;
}

export function cadenceLabel(person, tps, settings) {
  const c = withDefaults(settings).cadence;
  const custom = overrideDays(person);
  if (person.warmth === 'parked') return `Parked. Comes back after ${span(c.parked)}`;
  if (custom) return `Every ${span(custom)} (your custom rhythm)`;
  if (person.warmth === 'cold') {
    const { sent, replied } = coldState(person, tps);
    if (replied) return 'Cold, but they replied';
    if (sent === 0) return 'Cold. First note next';
    if (sent === 1) return `Cold. Follow-up ${span(c.coldFollowUp)} after the first note`;
    if (sent === 2) return `Cold. Last try ${span(c.coldLastTry)} after the follow-up`;
    return 'Cold. The sequence is finished';
  }
  return `Every ${span(c[person.warmth])} (${WARMTH_INFO[person.warmth].label})`;
}

// A cold person who got all three notes and never replied.
export function needsParkPrompt(person, tps) {
  if (person.warmth !== 'cold' || overrideDays(person)) return false;
  const s = coldState(person, tps);
  return s.done && !s.replied;
}

// A cold person who replied: time to call them warm.
export function needsWarmPrompt(person, tps) {
  return person.warmth === 'cold' && coldState(person, tps).replied;
}

export const SNOOZE_OPTIONS = [
  { key: '3d', label: '3 days', apply: (d) => addDays(d, 3) },
  { key: '1w', label: '1 week', apply: (d) => addDays(d, 7) },
  { key: '2w', label: '2 weeks', apply: (d) => addDays(d, 14) },
  { key: '1m', label: '1 month', apply: (d) => addMonths(d, 1) },
];

export function snoozeDate(key, today = todayStr()) {
  const opt = SNOOZE_OPTIONS.find((o) => o.key === key);
  return opt ? opt.apply(today) : today;
}

// ---------- Yearly dates (birthdays and other repeating news) ----------

const pad2 = (n) => String(n).padStart(2, '0');

// The day a yearly date lands on next, today included. February 29 falls on
// the 28th in other years.
export function nextYearly(dateStr, from = todayStr()) {
  const [, m, d] = dateStr.split('-').map(Number);
  const y0 = Number(from.slice(0, 4));
  for (const y of [y0, y0 + 1]) {
    const day = Math.min(d, new Date(y, m, 0).getDate());
    const s = `${y}-${pad2(m)}-${pad2(day)}`;
    if (s >= from) return s;
  }
  return null;
}

export const YEARLY_LEAD_DAYS = 7;

// Where a yearly item stands today: 'today' on the day, the date itself when
// it's coming up within a week, or null. It's settled for this year once
// it's dismissed or logged from its card in the week before, or once any
// touchpoint is logged on or after the day.
export function yearlyWindow(n, tps, today = todayStr()) {
  const occ = nextYearly(n.date, today);
  if (!occ) return null;
  const ahead = daysBetween(today, occ);
  if (ahead > YEARLY_LEAD_DAYS) return null;
  const start = addDays(occ, -YEARLY_LEAD_DAYS);
  if (n.dismissedAt && toDateStr(new Date(n.dismissedAt)) >= start) return null;
  if (tps.some((t) => t.date >= occ)) return null;
  return ahead === 0 ? 'today' : occ;
}

// On the dream list and not reached out to yet: no cadence, never due.
export function isDreamOnly(person, tps) {
  return !!person.dreamList && !tps.length;
}

// Everything the Today screen lists, already sorted.
// news: their-news items from the last week that nobody has acted on yet
// (no touchpoint for that person since the news date, not dismissed).
export function buildToday({ people, touchpointsByPerson, news, loops = [] }, today = todayStr()) {
  const overdue = [];
  const due = [];
  const resurfaced = [];
  for (const p of people) {
    // Dream list people are aspirations, not follow-ups, until the first
    // touchpoint starts their rhythm.
    if (isDreamOnly(p, touchpointsByPerson.get(p.id) || [])) continue;
    const next = p.nextTouchpointDate || today;
    if (p.warmth === 'parked') {
      if (next <= today) resurfaced.push(p);
    } else if (next < today) overdue.push(p);
    else if (next === today) due.push(p);
  }
  const byNext = (a, b) => (a.nextTouchpointDate || today).localeCompare(b.nextTouchpointDate || today);
  overdue.sort(byNext);
  resurfaced.sort(byNext);
  due.sort((a, b) => a.name.localeCompare(b.name));

  const ids = new Set(people.map((p) => p.id));
  const newsToday = [];
  const comingUp = [];
  for (const n of news) {
    if (!ids.has(n.personId)) continue;
    if (n.repeatsYearly) {
      const w = yearlyWindow(n, touchpointsByPerson.get(n.personId) || [], today);
      if (w === 'today') newsToday.push({ ...n, date: today });
      else if (w) comingUp.push({ ...n, date: w });
    } else if (
      !n.dismissedAt && n.date <= today && daysBetween(n.date, today) < 7 &&
      !(touchpointsByPerson.get(n.personId) || []).some((t) => t.date >= n.date)
    ) newsToday.push(n);
  }
  newsToday.sort((a, b) => b.date.localeCompare(a.date));
  comingUp.sort((a, b) => a.date.localeCompare(b.date));

  // Someone due today whose news is today too (often because their next
  // touchpoint was set to that news date) gets one card, not two: the news
  // rides along on their due card.
  const dueIds = new Set([...overdue, ...due].map((p) => p.id));
  const dueNews = new Map();
  for (const n of newsToday) if (dueIds.has(n.personId) && !dueNews.has(n.personId)) dueNews.set(n.personId, n);

  // Open loops: one on your side shows once it's due and stays until closed;
  // one on their side shows once it's late, as a nudge. Undated loops never do.
  const loopsToday = loops
    .filter((l) => ids.has(l.personId) && l.status !== 'closed' && l.dueDate)
    .filter((l) => (l.direction === 'theyOwe' ? l.dueDate < today : l.dueDate <= today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.direction === 'iOwe' ? -1 : 1));

  return { overdue, due, news: newsToday.filter((n) => !dueIds.has(n.personId)), dueNews, comingUp, resurfaced, loops: loopsToday };
}
