// Callback: screens, routing and actions. Data goes through db.js, the
// scheduling rules through cadence.js; this file only draws and reacts.
import * as db from './db.js';
import {
  todayStr, addDays, daysBetween, fmtDate, fmtTimestamp, relDay, span, plural, esc,
  debounce, weekStartStr, toDateStr, parseDate, normalizeUrl, instagramUrl, saveFile, readFileText, nowISO, uuid, hash,
} from './util.js';
import {
  WARMTH, WARMTH_INFO, COLD_STEPS, computeNextDate, warmthChangeFields, cadenceLabel, needsParkPrompt,
  needsWarmPrompt, SNOOZE_OPTIONS, snoozeDate, buildToday, coldState, sortTouchpoints, nextYearly, isDreamOnly,
  firstContactStage, JUST_MET_DAYS, leavesLightTouch, lightOffFields, isEngaging, ideaStage, replyDay, lastContactDay,
  checkInDate, rhythmWords, RHYTHM_PRESETS, replyCheckDue,
} from './cadence.js';
import { pickIdea, yearlyIdea, setIdeaLibrary, isOwnIdea } from './ideas.js';
import { upcomingEvents, buildCalendar } from './ics.js';
import { canPickContacts, pickContacts, parseVCards, parsePasted } from './contacts.js';
import {
  TOUCH_TYPES, touchTypeLabel, RESPONDED, respondedLabel, ROLE_SUGGESTIONS, ORG_TYPES, orgTypeLabel,
  NEWS_SUGGESTIONS, RELATIONSHIP_TYPES, DEFAULT_RELATIONSHIP, relationshipInfo, LOOP_DIRECTIONS,
  INTEREST_LEVELS, interestInfo, CIRCLE_SUGGESTIONS, FIRST_CONTACT_OPTIONS, DEFAULT_FIRST_CONTACT,
  relTypesOf, relFields,
} from './model.js';
import { openSheet, confirmSheet, choiceSheet, toast, closeAllSheets } from './ui.js';
import { updateSwipeBar, setSwipePeek } from './swipebar.js';
import * as sync from './sync.js';
import { getPath } from './merge.js';
import { mountMind, BUDDIES, buddyStyle, setBuddy, buddySVG, setWelcome } from './mind.js';
import { startSky } from './sky.js';
import { mountRing, figureSVG } from './ring.js';
import { mountMap } from './map.js';

const APP_VERSION = '1.0.0';
const view = document.getElementById('view');

// ---------------------------------------------------------------------------
// State: everything is small enough to hold in memory and redraw from.

const S = {
  people: [],
  orgs: [],
  circles: [],
  tps: [],
  news: [],
  loops: [],
  ideas: [],
  weeks: [],
  personById: new Map(),
  orgById: new Map(),
  circleById: new Map(),
  tpsByPerson: new Map(),
  newsByPerson: new Map(),
  loopsByPerson: new Map(),
  settings: null,
  meta: {},
  installPrompt: null,
  ui: {
    ideaTurn: new Map(),
    // Light touches start folded away at the bottom of Today.
    collapsed: new Set(['today-light']),
    // Month and year groups (foldHTML): open or shut, as last tapped.
    folds: new Map(),
    scroll: new Map(),
    backTo: null,
    people: { q: '', sort: 'contact', reverse: false, sortOpen: false, warmth: new Set(), rel: new Set(), interest: new Set(), circles: new Set(), loops: false, pending: false, dream: false, light: false, role: '', org: '', showParked: false, filtersOpen: false, view: readPeopleView() },
    circle: { sort: 'contact', reverse: false, sortOpen: false, light: false },
    circlesReorder: false,
    orgsQ: '',
    // On a phone, Circles and Organizations are maps unless List is on;
    // the choice stays on this device.
    circlesView: readMapView('circles'),
    orgsView: readMapView('orgs'),
    // Today in a wide window: the head (or the board, with List on), and
    // the bubble whose cards are open on the right of the head.
    todayView: readMapView('today'),
    thought: null,
    thoughtKey: null,
    // Today's board in a big window: who's open on the right ({ id, focus }),
    // and the board's people in order, to move on to the next one.
    pick: null,
    boardOrder: [],
    revealPick: false,
  },
};

function groupBy(list, key) {
  const m = new Map();
  for (const x of list) {
    if (!m.has(x[key])) m.set(x[key], []);
    m.get(x[key]).push(x);
  }
  return m;
}

async function load() {
  const [people, orgs, circles, tps, news, loops, ideas, weeks, settings, lastExportAt, installedAt, reminderUntil, lastLogType, syncCfg, conflicts] =
    await Promise.all([
      db.getPeople(), db.getOrganizations(), db.getCircles(), db.getTouchpoints(), db.getNews(), db.getOpenLoops(), db.getIdeas(), db.getWeeks(), db.getSettings(),
      db.getMeta('lastExportAt'), db.getMeta('installedAt'), db.getMeta('exportReminderUntil'), db.getMeta('lastLogType'), sync.syncConfig(),
      sync.getConflicts(),
    ]);
  S.people = people.sort((a, b) => a.name.localeCompare(b.name));
  S.orgs = orgs.sort((a, b) => a.name.localeCompare(b.name));
  S.tps = tps;
  S.news = news;
  S.weeks = weeks;
  S.settings = settings;
  S.personById = new Map(people.map((p) => [p.id, p]));
  S.orgById = new Map(orgs.map((o) => [o.id, o]));
  S.circles = circles.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  S.circleById = new Map(circles.map((c) => [c.id, c]));
  S.tpsByPerson = groupBy(tps, 'personId');
  for (const [k, list] of S.tpsByPerson) S.tpsByPerson.set(k, sortTouchpoints(list));
  S.newsByPerson = groupBy(news, 'personId');
  S.loops = loops;
  S.ideas = ideas;
  setIdeaLibrary(ideas);
  S.loopsByPerson = groupBy(loops, 'personId');
  S.meta = { lastExportAt, installedAt, reminderUntil, lastLogType, sync: syncCfg, conflicts };
}

// The People sort and its order (and a circle's) stay until you change
// them, even after the app closes. They're kept with this device's own
// values (db meta), which backups and sync don't carry, so sorting on the
// Mac never changes the phone's and never touches the synced settings.
async function loadListSorts() {
  const saved = await db.getMeta('listSorts');
  for (const k of ['people', 'circle']) {
    const v = saved && saved[k];
    if (v && SORTS[v.sort]) Object.assign(S.ui[k], { sort: v.sort, reverse: !!v.reverse });
  }
}

function saveListSorts() {
  const keep = (u) => ({ sort: u.sort, reverse: u.reverse });
  db.setMeta('listSorts', { people: keep(S.ui.people), circle: keep(S.ui.circle) }).catch(() => {});
}

async function refresh() {
  await load();
  render();
}

const tpsOf = (id) => S.tpsByPerson.get(id) || [];
const newsOf = (id) => S.newsByPerson.get(id) || [];
const loopsOf = (id) => S.loopsByPerson.get(id) || [];
const openLoopsOf = (id) => loopsOf(id).filter((l) => l.status !== 'closed');
// The promise made with a touchpoint. Newer ones carry its id; older ones were
// saved a moment after it, in the same Log touchpoint.
function tpLoop(tp) {
  const list = loopsOf(tp.personId);
  const at = Date.parse(tp.createdAt);
  return list.find((l) => l.touchpointId === tp.id)
    || list.find((l) => !l.touchpointId && Math.abs(Date.parse(l.createdAt) - at) < 5000)
    || null;
}
// How a closed promise ended: `outcome` is 'kept' (or got, on their side) or
// 'letGo'; older closed ones count as kept. `keptBy` is the touchpoint logged
// when you kept it. Both only count while the promise is closed, since an
// older copy of the app can reopen one and leave them behind.
const isLetGo = (l) => l.status === 'closed' && l.outcome === 'letGo';
const keptLoopOf = (tp) => loopsOf(tp.personId).find((l) => l.status === 'closed' && l.keptBy === tp.id) || null;
const OPEN_AGAIN = { status: 'open', closedAt: null, outcome: null, keptBy: null };
// A touchpoint's words: the promise it kept comes first.
function tpNote(t) {
  const k = keptLoopOf(t);
  if (!k) return t.note || '';
  return `Kept the promise: ${k.description}${t.note ? `. ${t.note}` : ''}`;
}
const orgOf = (p) => (p && p.organizationId ? S.orgById.get(p.organizationId) : null);
// A person's circles in your order. Ids of deleted circles are skipped.
const circlesOf = (p) => S.circles.filter((c) => (p.circleIds || []).includes(c.id));
const membersOf = (id) => S.people.filter((p) => (p.circleIds || []).includes(id));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// The first word of someone's name.
const firstWord = (p) => (p.name || '').trim().split(/\s+/)[0] || 'them';
// How someone is called in a sentence or under their drawing: the first
// name, with the first letter of the last name and a period ("Ava T.")
// when anyone else has the same first name (11-10).
let firstCounts = { list: null, map: null };
function firstName(p) {
  const first = firstWord(p);
  if (firstCounts.list !== S.people) {
    const map = new Map();
    for (const x of S.people) {
      const k = firstWord(x).toLowerCase();
      map.set(k, (map.get(k) || 0) + 1);
    }
    firstCounts = { list: S.people, map };
  }
  if ((firstCounts.map.get(first.toLowerCase()) || 0) < 2) return first;
  const words = (p.name || '').trim().split(/\s+/);
  return words.length > 1 ? `${first} ${words[words.length - 1].charAt(0).toUpperCase()}.` : first;
}


// ---------------------------------------------------------------------------
// Small pieces of markup

const LOGO = `<svg class="brand-logo" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" fill="#ffd103"/><path d="M346.4 331.8A118 118 0 1 1 346.4 180.2" fill="none" stroke="#12850f" style="stroke: var(--green, #12850f)" stroke-width="64"/><path d="M402 133L290 226L398 245Z" fill="#12850f" style="fill: var(--green, #12850f)"/></svg>`;

const X_ICON_SMALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M4 12.5l5 5L20 6.5"/></svg>`;
const ARROW = `<svg class="collapse-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

const WARMTH_ICON = {
  cold: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  warm: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor"/>',
  active: '<circle cx="8" cy="8" r="6.5" fill="currentColor"/>',
  client: '<path d="M8 .8l2.1 4.5 4.9.6-3.6 3.4 1 4.9L8 11.8l-4.4 2.4 1-4.9L1 5.9l4.9-.6z" fill="currentColor"/>',
  parked: '<rect x="3.5" y="2.5" width="3" height="11" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" fill="currentColor"/>',
};

function warmthIcon(w) {
  return `<svg class="warmth-icon" viewBox="0 0 16 16" aria-hidden="true">${WARMTH_ICON[w] || WARMTH_ICON.cold}</svg>`;
}

// Warmth inside a sentence: "Kai is Warm now", "Kai is on a project now".
const warmthWord = (w) => WARMTH_INFO[w].phrase || WARMTH_INFO[w].label;

function warmthBadge(w) {
  const info = WARMTH_INFO[w] || WARMTH_INFO.cold;
  return `<span class="warmth warmth-${esc(w)}">${warmthIcon(w)}<span>${esc(info.label)}</span></span>`;
}

// Relationship type: an icon and a word, no box, so it never reads as a
// second warmth badge.
const REL_ICON = {
  pastClient: '<rect x="1.8" y="5" width="12.4" height="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.8 5V2.8h4.4V5M1.8 8.6h12.4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  prospect: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/>',
  collaborator: '<circle cx="5.7" cy="8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10.3" cy="8" r="4.4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  industry: '<path d="M3 12.5L8 3.5L13 12.5H3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="3" cy="12.5" r="2.1" fill="currentColor"/><circle cx="13" cy="12.5" r="2.1" fill="currentColor"/><circle cx="8" cy="3.5" r="2.1" fill="currentColor"/>',
  other: '<circle cx="2.8" cy="8" r="1.9" fill="currentColor"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/><circle cx="13.2" cy="8" r="1.9" fill="currentColor"/>',
};

function relIcon(t) {
  return `<svg class="rel-icon" viewBox="0 0 16 16" aria-hidden="true">${REL_ICON[t] || REL_ICON.prospect}</svg>`;
}

function relLabel(t) {
  const info = relationshipInfo(t);
  return `<span class="rel rel-${esc(info.key)}">${relIcon(info.key)}<span>${esc(info.label)}</span></span>`;
}

// Every relationship type someone has, side by side.
const relLabels = (p) => relTypesOf(p).map(relLabel).join('');
const relWords = (p) => joinWords(relTypesOf(p).map((k) => relationshipInfo(k).label));

const NEWS_ICON = '<svg class="warmth-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M1.5 6.8h13M5 1v3.5M11 1v3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

// Open loops: an arrow out for your side, an hourglass for what you're
// waiting on, and a circling arrow for the count on People.
const LOOP_SVG = {
  iOwe: '<path d="M1.5 8h9M7.5 4.5L11 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 2.5v11" fill="none" stroke="currentColor" stroke-width="2"/>',
  theyOwe: '<path d="M3.5 1.5h9L8 8l4.5 6.5h-9L8 8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  count: '<path d="M13 8.5A5 5 0 1 1 11.6 4.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.6 1.6v3.8H9.8" fill="none" stroke="currentColor" stroke-width="2"/>',
};

function loopIcon(kind) {
  return `<svg class="loop-icon" viewBox="0 0 16 16" aria-hidden="true">${LOOP_SVG[kind] || LOOP_SVG.count}</svg>`;
}

function loopCountBadge(n) {
  return n ? `<span class="loop-count" title="${plural(n, 'open loop')}">${loopIcon('count')}<span>${n}</span><span class="visually-hidden"> open ${n === 1 ? 'loop' : 'loops'}</span></span>` : '';
}

// Interest: an icon and a word, like relationship type.
const INTEREST_SVG = {
  eager: '<path d="M8 14V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  open: '<path d="M2 8h11M8.5 3.5L13 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  lukewarm: '<path d="M1.5 9c1.6-2.6 3.1-2.6 4.4 0s2.8 2.6 4.2 0 2.8-2.6 4.4 0" fill="none" stroke="currentColor" stroke-width="2"/>',
  unknown: '<path d="M5.4 5.6a2.6 2.6 0 1 1 3.7 2.3c-.8.4-1.1.9-1.1 1.8v.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="13.2" r="1.2" fill="currentColor"/>',
};

function interestIcon(k) {
  return `<svg class="rel-icon" viewBox="0 0 16 16" aria-hidden="true">${INTEREST_SVG[k] || INTEREST_SVG.unknown}</svg>`;
}

function interestLabel(k, { prefix = false } = {}) {
  const info = interestInfo(k);
  return `<span class="rel interest interest-${esc(info.key)}">${interestIcon(info.key)}<span>${prefix ? 'Interest: ' : ''}${esc(info.label)}</span></span>`;
}

// The Dream list link on People: a star drawn like the night sky's on
// Today (sky.js star(8, 8.6, 7, 7.4, -0.12)), in its yellow (11-10).
const DREAM_SKY_STAR = '<svg class="warmth-icon dream-sky-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.5 1.3L9.8 5.7L14.7 5.8L11.3 9.1L12.8 13.7L8.3 11.5L4.7 14.8L5 10L1.2 7.1L5.6 6.3L7.5 1.3L7.9 2.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DREAM_STAR = '<svg class="warmth-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.4l2 4.3 4.6.6-3.4 3.2.9 4.6L8 11.8 3.9 14.1l.9-4.6L1.4 6.3 6 5.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

// The dream list on someone's page: a star by their name, drawn like a
// colouring book outline (the sky star's line). Empty, its line is broken
// up like a quick drawing (one break along each side); tap it
// and it's coloured in yellow with a solid line, with a quick crayon
// scribble the first time (11-10).
const STAR_DASHED = 'M9 4.17L9.8 5.7L11.01 5.72M13 5.77L14.7 5.8L13.89 6.59M12.45 7.98L11.3 9.1L11.66 10.22M12.29 12.12L12.8 13.7L11.67 13.15M9.88 12.27L8.3 11.5L7.42 12.31M5.94 13.66L4.7 14.8L4.77 13.64M4.9 11.64L5 10L4.08 9.3M2.5 8.09L1.2 7.1L2.2 6.92M4.16 6.56L5.6 6.3L6.1 4.98M6.81 3.12L7.5 1.3L8.07 2.39';
const STAR_LINE = 'M7.5 1.3L9.8 5.7L14.7 5.8L11.3 9.1L12.8 13.7L8.3 11.5L4.7 14.8L5 10L1.2 7.1L5.6 6.3L7.5 1.3L7.9 2.1';
const STAR_SHAPE = 'M7.5 1.3L9.8 5.7L14.7 5.8L11.3 9.1L12.8 13.7L8.3 11.5L4.7 14.8L5 10L1.2 7.1L5.6 6.3Z';
const STAR_SCRIBBLE = 'M0 -0.4 L16 1.2 L0 2.8 L16 4.4 L0 6 L16 7.6 L0 9.2 L16 10.8 L0 12.4 L16 14 L0 15.6 L16 17.2';
let dreamJustStarred = null;
function dreamStar(p) {
  const id = `dream-clip-${esc(p.id)}`;
  const filling = dreamJustStarred === p.id;
  if (filling) dreamJustStarred = null;
  return `<button type="button" class="dream-star${p.dreamList ? ' is-on' : ''}${filling ? ' is-filling' : ''}" data-action="toggle-dream" data-id="${esc(p.id)}" aria-pressed="${p.dreamList ? 'true' : 'false'}" aria-label="Dream list">
    <svg class="dream-star-pic" viewBox="0 0 16 16" aria-hidden="true">
      <clipPath id="${id}"><path d="${STAR_SHAPE}"/></clipPath>
      ${p.dreamList ? `<path class="dream-star-fill" d="${STAR_SCRIBBLE}" clip-path="url(#${id})"/>` : ''}
      <path class="dream-star-line${p.dreamList ? '' : ' is-broken'}" d="${p.dreamList ? STAR_LINE : STAR_DASHED}"/>
    </svg></button>`;
}

function dreamBadge() {
  return `<span class="dream-badge">${DREAM_STAR}<span>Dream list</span></span>`;
}

// Light touch: a feather, for weak ties kept faintly familiar.
const LIGHT_ICON = '<svg class="warmth-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M14.2 1.8c-5.2.3-9 3.5-9.8 9.6l.6.6c6-.8 9-4.8 9.2-10.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M1.8 14.2l8-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
// A finished project: a little flag (Wrap project, 11-10).
const WRAP_ICON = '<svg class="warmth-icon wrap-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 14.6V1.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3.8 2.4c2.4-1 4.2 1 6.6.1.9-.3 1.6-.6 2.3-.9-.4 1.6-.4 3.1 0 4.7-.7.3-1.4.6-2.3.9-2.4.9-4.2-1.1-6.6-.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const QUICK_ICON = '<svg class="warmth-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.6 1.2L3.2 9.1h4.3l-1.1 5.7 6.4-7.9H8.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

function lightBadge() {
  return `<span class="dream-badge light-badge">${LIGHT_ICON}<span>Light touch</span></span>`;
}

const dreamOnly = (p) => isDreamOnly(p, tpsOf(p.id));
const firstStage = (p) => firstContactStage(p, tpsOf(p.id));

// "today", "tomorrow" or the weekday: the just-met deadline is never far off.
function byDay(d, today = todayStr()) {
  const n = daysBetween(today, d);
  if (n <= 1) return relDay(d, today);
  return n < 7 ? parseDate(d).toLocaleDateString(undefined, { weekday: 'long' }) : fmtDate(d, { weekday: false });
}

// Someone you just met: "Follow up by Friday", or late once that's passed.
function followUpText(p, today = todayStr()) {
  const by = p.firstContactDeadline || today;
  return by < today ? 'Follow-up is late' : `Follow up by ${byDay(by, today)}`;
}
// Circles: a dashed ring drawn around a few people. (Overlapping rings are
// already Collaborator.)
const CIRCLE_ICON = '<svg class="circle-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 1.6"/><circle cx="8" cy="5.6" r="1.5" fill="currentColor"/><circle cx="5.6" cy="9.7" r="1.5" fill="currentColor"/><circle cx="10.4" cy="9.7" r="1.5" fill="currentColor"/></svg>';
const UP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg>';
const DOWN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

// A person's circles as small chips: links on the person page, plain labels
// on Today, where the whole card already opens the person.
function circleChips(p, { link = false } = {}) {
  const list = circlesOf(p);
  if (!list.length) return '';
  return `<span class="circle-chips">${list.map((c) => (link
    ? `<a class="circle-chip" href="#/circle/${esc(c.id)}">${CIRCLE_ICON}${esc(c.name)}</a>`
    : `<span class="circle-chip">${CIRCLE_ICON}${esc(c.name)}</span>`)).join('')}</span>`;
}

// People who list `id` among those they could introduce you to.
const pathsTo = (id) => S.people.filter((c) => c.id !== id && (c.canIntroduceToIds || []).includes(id));

// Their news dates still ahead, soonest first.
function upcomingNews(p, today = todayStr()) {
  return newsOf(p.id)
    .map((n) => (n.repeatsYearly ? { ...n, date: nextYearly(n.date, today) } : n))
    .filter((n) => (n.repeatsYearly || !n.dismissedAt) && n.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function subLine(p, { link = false } = {}) {
  const org = orgOf(p);
  const parts = [];
  if (p.role) parts.push(esc(p.role));
  if (org) parts.push(link ? `<a href="#/org/${esc(org.id)}">${esc(org.name)}</a>` : esc(org.name));
  return parts.join(' <span class="dot">·</span> ');
}

function sinceText(p, today = todayStr()) {
  const last = tpsOf(p.id)[0];
  if (!last) return 'No contact yet';
  const n = daysBetween(last.date, today);
  if (n < 0) return `Touchpoint planned ${relDay(last.date, today)}`;
  if (n === 0) return 'In touch today';
  return `${plural(n, 'day')} since contact`;
}

// The line over the date on someone's next touchpoint (11-10): "Next
// touchpoint in 89 days", "Next touchpoint today", "Next touchpoint, 3 days
// overdue". The rhythm itself is in Change date now.
function nextLabelText(label, next, today = todayStr()) {
  const n = daysBetween(today, next);
  if (n < 0) return `${label}, ${plural(-n, 'day')} overdue`;
  return `${label} ${relDay(next, today)}`;
}

function nextRelText(next, today = todayStr()) {
  const n = daysBetween(today, next);
  if (n === 0) return 'Today';
  if (n < 0) return `${plural(-n, 'day')} overdue`;
  return cap(relDay(next, today));
}

function sectionBlock(key, title, count, inner, tone) {
  const collapsed = S.ui.collapsed.has(key);
  return `<section class="section-block">
    <h2 class="heading-${tone}${collapsed ? ' collapsed' : ''}" data-action="toggle-section" data-key="${esc(key)}" role="button" tabindex="0" aria-expanded="${!collapsed}">
      <span>${esc(title)}${count != null ? ` [${count}]` : ''}</span>${ARROW}
    </h2>
    <div class="card-list"${collapsed ? ' hidden' : ''}>${inner}</div>
  </section>`;
}

function promptBox(text, buttons) {
  return `<div class="prompt"><p>${text}</p><div class="prompt-actions">${buttons}</div></div>`;
}

// The idea showing for a person right now: their typed one, a yearly date
// or the rotating suggestion.
function shownIdea(p) {
  const own = (p.customIdea || '').trim();
  const turn = S.ui.ideaTurn.get(p.id) || 0;
  const firstContact = ideaStage(p, tpsOf(p.id));
  // The check-in after a wrapped project, from a week before it's due.
  const check = checkInDate(p);
  const after = !own && !turn && check && todayStr() >= addDays(check, -7) ? afterProjectIdea(p) : null;
  const yearly = own || turn || firstContact || after ? null : yearlyIdea(newsOf(p.id), tpsOf(p.id), todayStr(), { light: p.lightTouch });
  return { own, yearly, after, text: own || after || yearly || pickIdea(p, todayStr(), turn, { firstContact }) };
}

// The rotating suggestion, or the idea the person typed themselves.
function ideaHTML(p) {
  const id = esc(p.id);
  const { own, yearly, after, text } = shownIdea(p);
  const removable = own || (!yearly && !after);
  return `<div class="idea${own ? ' is-own' : ''}">
    ${removable ? `<button type="button" class="idea-remove" data-action="hide-idea" data-id="${id}"${own ? ' data-typed="1"' : ''} aria-label="Remove this suggestion for good">${X_ICON_SMALL}</button>` : ''}
    <span class="idea-label">${own ? 'Your idea' : 'Idea'}</span>
    <p class="idea-text">${esc(text)}</p>
    <div class="idea-tools">
      <button type="button" class="idea-next" data-action="next-idea" data-id="${id}">Another idea</button>
      <button type="button" class="idea-next" data-action="type-idea" data-id="${id}">${own ? 'Edit your idea' : 'Type idea'}</button>
    </div>
  </div>`;
}

// Adds an idea to your suggestions, or brings it back if it was removed.
async function addOwnIdea(text) {
  const key = text.trim().toLowerCase();
  const found = S.ideas.find((r) => r.source === 'own' && r.text.trim().toLowerCase() === key);
  if (found && !found.hidden) return;
  await db.saveIdea(found ? { ...found, hidden: false } : { source: 'own', text: text.trim(), hidden: false });
}

// Removes a suggestion for good: your own ones are marked hidden, built-in
// ones get a hidden record keyed by their text. Bring back undoes both.
async function removeSuggestion(text) {
  const key = text.trim().toLowerCase();
  const own = S.ideas.find((r) => r.source === 'own' && r.text.trim().toLowerCase() === key);
  if (own) {
    await db.saveIdea({ ...own, hidden: true });
    return;
  }
  const id = `builtin-${hash(key)}`;
  const existing = S.ideas.find((r) => r.id === id);
  await db.saveIdea({ ...(existing || { id, source: 'builtin', text: text.trim() }), hidden: true });
}

function suggestionSheet() {
  const s = openSheet({
    title: 'Add a suggestion',
    className: 'sheet-small',
    body: `<form class="form" novalidate>
      <label class="field"><span class="field-label">An idea Callback can suggest for anyone</span>
        <textarea name="idea" rows="3" maxlength="280" placeholder="Send a still from your latest short film"></textarea></label>
      <button type="submit" class="modal-cta primary">Add suggestion</button>
    </form>`,
  });
  s.body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idea = String(new FormData(e.target).get('idea') || '').trim();
    if (!idea) return;
    await addOwnIdea(idea);
    s.close();
    await refresh();
    toast('Suggestion added');
  });
}

function ideaSheet(p) {
  if (!p) return;
  const had = !!(p.customIdea || '').trim();
  const s = openSheet({
    title: `Your idea for ${firstName(p)}`,
    className: 'sheet-small',
    body: `<form class="form" novalidate>
      <label class="field"><span class="field-label">What will you reach out with?</span>
        <textarea name="idea" rows="3" maxlength="280" placeholder="Send the prints from Friday's test">${esc(p.customIdea || '')}</textarea>
</label>
      <label class="check"><input type="checkbox" name="keep" checked> Also add it to my suggestions, for anyone</label>
      <button type="submit" class="modal-cta primary">Save idea</button>
    </form>`,
  });
  s.body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const idea = String(fd.get('idea') || '').trim();
    if (!idea && !had) {
      s.close();
      return;
    }
    if (idea && fd.get('keep')) await addOwnIdea(idea);
    await db.savePerson({ ...p, customIdea: idea });
    s.close();
    await refresh();
    toast(idea ? 'Idea saved' : 'Idea removed');
  });
}

// A link, a button that opens what it counts (`stat`), or a plain box.
// A loose line drawn under a number on phone Today, a little different
// under each (shown only there; style.css hides it elsewhere).
function statScrib(label) {
  const seed = [...label].reduce((a, c) => a + c.charCodeAt(0), 0) % 97;
  const r = (k) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const f = (v) => v.toFixed(1);
  const a = 8 + r(1) * 2;
  const m = 6 + (r(2) - 0.5) * 4;
  const z = 9 + (r(3) - 0.5) * 3;
  return `<svg class="stat-scrib" viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M3 ${f(a)} C ${f(30 + r(4) * 8)} ${f(m + 4)} ${f(62 + r(5) * 8)} ${f(m - 2)} 94 ${f(z)} Q 101 ${f(z - 1)} 99 ${f(z - 6)}"/></svg>`;
}

function statBox(num, label, href, stat) {
  const inner = `<span class="stat-num">${num}</span><span class="stat-label">${esc(label)}</span>${statScrib(label)}`;
  if (stat) return `<button type="button" class="stat-box" data-action="stat-sheet" data-stat="${stat}" aria-haspopup="dialog">${inner}</button>`;
  return href ? `<a class="stat-box" href="${href}">${inner}</a>` : `<div class="stat-box">${inner}</div>`;
}

function backButton(fallback, label) {
  return `<button type="button" class="back-btn" data-action="back" data-fallback="${esc(fallback)}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 5 8 12 15 19"/></svg>${esc(label)}</button>`;
}

// ---------------------------------------------------------------------------
// Today

// The title is as big as Contact Sheet's. There the logo and "Contact Sheet"
// fill the header's width, so the same sum is done here with that title,
// measured in whatever font the phone has (iPhones have no Arial Black and
// fall back to Helvetica, which is narrower, so the size can't be fixed).
function fitBrandTitle() {
  const t = view.querySelector('.hero-band .brand-title');
  if (!t) return;
  const row = t.parentElement;
  const probe = document.createElement('span');
  probe.className = 'brand-title';
  probe.textContent = 'Contact Sheet';
  probe.style.cssText = 'position: absolute; visibility: hidden; white-space: nowrap; font-family: var(--font-title); font-size: 100px; letter-spacing: 0;';
  row.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  // Contact Sheet's row at 100px: a 130px logo and a 35px gap before the title.
  const size = (100 * row.clientWidth) / (130 + 35 + width);
  t.style.fontSize = `${Math.min(64, Math.floor(size * 0.995 * 10) / 10)}px`;
}
window.addEventListener('resize', fitBrandTitle);

function renderToday() {
  const today = todayStr();
  const t = buildToday({ people: S.people, touchpointsByPerson: S.tpsByPerson, news: S.news, loops: S.loops }, today);
  // Today is the numbers and the head: every section is one of its thought
  // bubbles, so there's no header and no list of sections. A wide window
  // can have the board instead (List).
  // With nobody yet it's the head too (one bubble, to add someone), unless
  // a wide window has List on. The welcome is always the head.
  const head = !!S.ui.welcome || phoneQuery.matches || S.ui.todayView !== 'list';
  let html = head ? '' : `
    <div class="hero-band">
      <div class="brand-row">
        <div class="brand-logo-wrap shine-sweep">${LOGO}</div>
        <h1 class="brand-title">Callback</h1>
      </div>
    </div>`;

  if (!S.people.length && !head) return html + firstRunHTML();

  const week = weekStats(weekStartStr(today));
  const g = S.settings.goals;
  const stats = `<div class="stats-row">
    ${statBox(t.justMet.length + t.overdue.length + t.due.length, 'To reach out', null, 'reach')}
    ${statBox(`${week.regular.length}<small>/${g.touchpoints}</small>`, 'Touchpoints this week', null, 'touchpoints')}
    ${statBox(`${week.added.length}<small>/${g.newPeople}</small>`, 'New people this week', null, 'added')}
  </div>`;
  // On a phone the numbers sit in a row on top; with the side rail they
  // stack in a column on the left and the rest of Today fills the right.
  const list = todaySectionList(t);
  if (head) {
    // A bubble clicked in a big window: its cards on the right of the head.
    const sec = thoughtBeside() && S.ui.thoughtKey ? list.find((b) => b.key === S.ui.thoughtKey) : null;
    if (!sec) S.ui.thoughtKey = null;
    const toggle = phoneQuery.matches || S.ui.welcome ? '' : `<div class="today-view">${listButton('today-view', false)}</div>`;
    const cls = `${sec ? ' has-thought' : ''}${S.ui.welcome ? ' is-welcome' : ''}${S.ui.arrive ? ' is-arriving' : ''}`;
    return `<div class="dash is-mind${cls}">${stats}<div class="dash-main">${S.ui.welcome ? welcomeHTML() : ''}${toggle}${conflictBannerHTML()}${exportReminderHTML(today)}${mindSlotHTML(list)}</div>${sec ? thoughtPanelHTML(sec) : ''}</div>`;
  }
  const dash = (rest, aside = '') => `${html}<div class="dash${aside ? ' has-pick' : ''}">${stats}<div class="dash-main"><div class="today-view">${listButton('today-view', true)}</div>${conflictBannerHTML()}${exportReminderHTML(today)}${rest}</div>${aside}</div>`;

  const blocks = list.map((b, i) => ({ key: b.key, n: b.n, html: sectionBlock(b.key, b.title, b.n, b.inner, i % 2 ? 'navy' : 'yellow') }));
  if (!list.some((b) => b.key !== 'today-light')) return dash(caughtUpHTML(today) + blocks.map((b) => b.html).join(''));
  // A big window (full screen, or a big Mac window) gets the board: a column
  // per section, as many as fit, and whoever you click opens on the right.
  if (bigQuery.matches) {
    const pick = S.ui.pick && S.personById.get(S.ui.pick.id) ? S.ui.pick : null;
    return dash(boardHTML(blocks, boardFit(!!pick)), pick ? pickPanelHTML(pick.id) : '');
  }
  if (!wideQuery.matches) return dash(blocks.map((b) => b.html).join(''));
  // A wide window gets two columns. Each section goes to the shorter one so
  // far, judged by how tall its cards run, so the first two sit side by side
  // at the top and neither column runs on alone.
  const cols = [{ h: 0, html: '' }, { h: 0, html: '' }];
  for (const b of blocks) {
    const col = cols[0].h <= cols[1].h ? cols[0] : cols[1];
    col.h += 1 + b.n * (PER_ITEM[b.key] || 1); // folding a section doesn't move the others
    col.html += b.html;
  }
  return dash(`<div class="today-cols">${cols.map((c) => `<div class="today-col">${c.html}</div>`).join('')}</div>`);
}

// Today's sections, in order, each with its cards. Light touches come last,
// folded away, to do in one sitting.
function todaySectionList(t) {
  const sections = [];
  const card = (kind) => (p) => personCard(p, kind, t.dueNews.get(p.id));
  if (t.justMet.length) sections.push({ key: 'justmet', title: 'Just met', n: t.justMet.length, inner: t.justMet.map(card('justMet')).join('') });
  if (t.overdue.length) sections.push({ key: 'overdue', title: 'Overdue', n: t.overdue.length, inner: t.overdue.map(card('overdue')).join('') });
  if (t.due.length) sections.push({ key: 'due', title: 'Due today', n: t.due.length, inner: t.due.map(card('due')).join('') });
  if (t.loops.length) sections.push({ key: 'loops', title: 'Open loops', n: t.loops.length, inner: t.loops.map((l) => loopCard(l)).join('') });
  if (t.replyChecks.length) {
    sections.push({ key: 'replies', title: 'Did they reply?', n: t.replyChecks.length, inner: `
      <p class="light-intro">Still waiting, two days or more after you reached out. Mark each one, or tap Not yet and Callback asks again in two days.</p>
      <div class="light-list">${t.replyChecks.map(replyRow).join('')}</div>` });
  }
  if (t.news.length) sections.push({ key: 'news', title: 'Their news', n: t.news.length, inner: t.news.map((n) => newsCard(n)).join('') });
  // The week ahead: loops coming due and yearly news, soonest first.
  const coming = [
    ...t.loopsComing.map((l) => ({ date: l.dueDate, html: loopCard(l, { coming: true }) })),
    ...t.comingUp.map((n) => ({ date: n.date, html: newsCard(n, { coming: true }) })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (coming.length) sections.push({ key: 'coming', title: 'Coming up', n: coming.length, inner: coming.map((c) => c.html).join('') });
  if (t.resurfaced.length) {
    sections.push({ key: 'resurfaced', title: 'Resurfaced', n: t.resurfaced.length, inner: t.resurfaced.map((p) => personCard(p, 'resurfaced')).join('') });
  }

  // Light touches wait at the bottom, folded away, to do in one sitting.
  if (t.light.length) {
    sections.push({ key: 'today-light', title: 'Light touches', n: t.light.length, inner: `
      <p class="light-intro">${plural(t.light.length, 'light touch', 'light touches')} this week. Small gestures, easy to do in one sitting.</p>
      <div class="light-list">${t.light.map(lightRow).join('')}</div>` });
  }
  return sections;
}

// The head on a phone: a thought bubble for each of Today's sections with
// anything in it, most pressing first. Light touches weigh half, being
// small, and Coming up doesn't weigh at all (nothing to do yet).
const THOUGHTS = [['overdue', 'overdue'], ['due', 'due today'], ['justmet', 'just met'], ['replies', 'reply?'], ['loops', 'open loops'], ['news', 'their news'], ['resurfaced', 'resurfaced'], ['today-light', 'light touches'], ['coming', 'coming up']];
const WEIGHT = { 'today-light': 0.5, coming: 0 };
const phoneQuery = window.matchMedia('(max-width: 899px)');
let todayMind = { bubbles: [], pending: 0 };

function mindSlotHTML(list) {
  const byKey = new Map(list.map((b) => [b.key, b]));
  // With just one, these read in the singular ("1 open loop").
  const one = { loops: 'open loop', 'today-light': 'light touch' };
  let bubbles = THOUGHTS.filter(([k]) => byKey.has(k)).map(([key, label]) => ({ key, label: byKey.get(key).n === 1 && one[key] ? one[key] : label, title: byKey.get(key).title, n: byKey.get(key).n, weight: WEIGHT[key] ?? 1 }));
  // Nobody yet: one bubble, to add the first person (openThought). None
  // at all while the welcome is up.
  if (!S.people.length) bubbles = [{ key: 'first', label: 'add someone', title: 'Add your first person', n: '+', weight: 0, aria: 'Add your first person' }];
  if (S.ui.welcome) bubbles = [];
  todayMind = { bubbles, pending: bubbles.reduce((a, b) => a + (typeof b.n === 'number' ? b.n * b.weight : 0), 0) };
  return '<div class="mind-slot" data-mind-slot></div>';
}

function todaySection(key) {
  const t = buildToday({ people: S.people, touchpointsByPerson: S.tpsByPerson, news: S.news, loops: S.loops }, todayStr());
  return todaySectionList(t).find((b) => b.key === key) || null;
}

// A tapped bubble opens its section's cards in a sheet. The buttons work as
// they do on Today, the sheet keeps up as things change, and it closes by
// itself once the section is empty, so the bubble can pop.
function thoughtSheet(key) {
  const sec = todaySection(key);
  if (!sec) return;
  const s = openSheet({
    title: sec.title,
    className: 'thought-sheet',
    body: `<div class="card-list">${sec.inner}</div>`,
    onClose: () => { if (S.ui.thought && S.ui.thought.s === s) S.ui.thought = null; },
  });
  S.ui.thought = { key, s };
  s.body.addEventListener('click', (e) => {
    const host = e.target.closest('[data-pick]');
    if (!host || e.target.closest('button, a, input, textarea, select, label, [data-action]')) return;
    if (String(window.getSelection() || '').trim()) return;
    leaveTo(`#/person/${host.dataset.pick}${host.dataset.focus ? `/${host.dataset.focus}` : ''}`);
  });
}

// A window wide enough for a bubble's cards to open beside the head.
const thoughtQuery = window.matchMedia('(min-width: 1300px)');
const thoughtBeside = () => thoughtQuery.matches && !phoneQuery.matches;
function openThought(key) {
  if (key === 'first') {
    personForm(null);
    return;
  }
  if (!thoughtBeside()) {
    thoughtSheet(key);
    return;
  }
  // The same bubble again puts its cards away.
  S.ui.thoughtKey = S.ui.thoughtKey === key ? null : key;
  render();
}
function thoughtPanelHTML(sec) {
  return `<aside class="thought-panel" aria-label="${esc(sec.title)}">
    <div class="detail-top"><button type="button" class="back-btn pick-close" data-action="close-thought">${X_ICON_SMALL}Close</button></div>
    <section class="section-block"><h2 class="heading-yellow"><span>${esc(sec.title)} [${sec.n}]</span></h2>
    <div class="card-list">${sec.inner}</div></section>
  </aside>`;
}

// Tapping the buddy's face (11-10): Settings, Buddy and Help, over its head.
// Tapping the face again, or anywhere else, puts them away.
function faceMenu() {
  if (closeFaceMenu() || S.ui.welcome) return;
  const head = document.querySelector('.mind-head');
  if (!head) return;
  const m = document.createElement('div');
  m.className = 'buddy-menu';
  m.dataset.acts = '';
  m.setAttribute('role', 'menu');
  m.setAttribute('aria-label', 'Buddy');
  m.innerHTML = [['face-settings', 'Settings'], ['face-buddy', 'Buddy'], ['face-help', 'Help']]
    .map(([a, label]) => `<button type="button" class="hand-btn" role="menuitem" data-action="${a}"><span class="hand-btn-text">${label}</span>${statScrib(label)}</button>`).join('');
  document.body.appendChild(m);
  placeFaceMenu();
  if (head.matches(':focus-visible')) m.querySelector('button').focus({ preventScroll: true });
}
function placeFaceMenu() {
  const m = document.querySelector('.buddy-menu');
  const head = document.querySelector('.mind-head');
  if (!m) return;
  if (!head || !head.isConnected) {
    m.remove();
    return;
  }
  const r = head.getBoundingClientRect();
  // The tap area is 2.7 head sizes tall; the head's top is just inside it.
  const left = Math.max(12, Math.min(window.innerWidth - m.offsetWidth - 12, r.left + r.width / 2 - m.offsetWidth / 2));
  const top = Math.max(12, r.top + r.height * 0.05 - m.offsetHeight - 4);
  m.style.left = `${Math.round(left)}px`;
  m.style.top = `${Math.round(top)}px`;
}
function closeFaceMenu() {
  const m = document.querySelector('.buddy-menu');
  if (m) m.remove();
  return !!m;
}
document.addEventListener('pointerdown', (e) => {
  if (document.querySelector('.buddy-menu') && !e.target.closest('.buddy-menu, .mind-head')) closeFaceMenu();
}, true);
window.addEventListener('resize', placeFaceMenu);
window.addEventListener('scroll', () => closeFaceMenu(), { passive: true });

// Help (11-10): just the tour, the one offered on first open.
function helpSheet() {
  const s = openSheet({
    title: 'Help',
    className: 'help-sheet',
    body: `<p class="sheet-message">Want a tour of the app? It's the same one you could take when you first opened Callback.</p>
      <button type="button" class="modal-cta primary" data-action="tour-start">Take the tour</button>`,
  });
  s.el.dataset.acts = '';
}

// Settings (11-10): a pop-up from the buddy's face, out of the bottom bar.
// #/settings (the Mac menu, the 7 key, an old link) opens it over the page
// you were on. It redraws with the page, unless you're typing in it.
function openSettings() {
  if (S.ui.settings && S.ui.settings.overlay.isConnected) return;
  S.ui.settings = openSheet({ title: 'Settings', className: 'settings-sheet', body: renderSettings(true), onClose: () => { S.ui.settings = null; } });
}
function refreshSettings() {
  const s = S.ui.settings;
  if (!s || !s.overlay.isConnected) return;
  const a = document.activeElement;
  if (a && s.body.contains(a) && a.matches('input, textarea, select')) return;
  const y = s.body.scrollTop;
  s.body.innerHTML = renderSettings(true);
  s.body.scrollTop = y;
}

// Picking how the buddy looks. Kept on this device.
function buddySheet() {
  const cur = buddyStyle().key;
  const pick = (b) => `<button type="button" class="buddy-option${b.key === cur ? ' is-on' : ''}" data-buddy="${b.key}" aria-pressed="${b.key === cur}">${buddySVG(b.key)}<span>${esc(b.label)}</span></button>`;
  const s = openSheet({
    title: 'Your buddy',
    className: 'buddy-sheet',
    body: `<p class="hint">Pick how the face on Today looks.</p><div class="buddy-row">${BUDDIES.map(pick).join('')}</div>${greenRowHTML("And the app's color.")}`,
  });
  s.body.addEventListener('click', (e) => {
    const g = e.target.closest('[data-green]');
    if (g) {
      // Stays open, so you can try them all.
      pickGreen(g.dataset.green);
      return;
    }
    const b = e.target.closest('[data-buddy]');
    if (!b) return;
    setBuddy(b.dataset.buddy);
    s.close();
  });
}

// The app's colour: the green it came with, or one of three others. A
// choice for this device, like light or dark; index.html puts it on the
// page (--green in style.css) before the first paint.
const GREENS = [
  { label: 'Green', hex: '#12850f' },
  { label: 'Blue', hex: '#1f5bb8' },
  { label: 'Berry', hex: '#b3195b' },
  { label: 'Purple', hex: '#6b3fa0' },
];
const GREEN_KEY = 'callback-green';
function greenNow() {
  let v = null;
  try { v = localStorage.getItem(GREEN_KEY); } catch { /* the green */ }
  return GREENS.find((g) => g.hex === v) || GREENS[0];
}
function greenRowHTML(hint) {
  const cur = greenNow();
  return `<p class="hint green-hint">${hint}</p><div class="green-row" role="group" aria-label="The app's color">${GREENS.map((g) => `<button type="button" class="green-option${g === cur ? ' is-on' : ''}" data-green="${g.hex}" data-action="pick-green" aria-pressed="${g === cur}" aria-label="${g.label}" title="${g.label}" style="--swatch: ${g.hex}"></button>`).join('')}</div>`;
}
function pickGreen(hex) {
  const g = GREENS.find((x) => x.hex === hex) || GREENS[0];
  try {
    if (g === GREENS[0]) localStorage.removeItem(GREEN_KEY);
    else localStorage.setItem(GREEN_KEY, g.hex);
  } catch { /* private mode: for this visit only */ }
  const root = document.documentElement;
  if (g === GREENS[0]) root.style.removeProperty('--green');
  else root.style.setProperty('--green', g.hex);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', g.hex);
  document.querySelectorAll('[data-green]').forEach((b) => {
    const on = b.dataset.green === g.hex;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // Pictures of the map taken in the old colour aren't used again.
  for (const k of Object.keys(mapShots)) delete mapShots[k];
}

function refreshThought() {
  const th = S.ui.thought;
  if (!th || !th.s.el.isConnected) return;
  const sec = parseRoute().name === 'today' ? todaySection(th.key) : null;
  if (!sec) {
    th.s.close();
    return;
  }
  const y = th.s.body.scrollTop;
  const yy = th.s.el.scrollTop;
  th.s.body.innerHTML = `<div class="card-list">${sec.inner}</div>`;
  th.s.body.scrollTop = y;
  th.s.el.scrollTop = yy;
}

// How tall a section's cards run, roughly, per item.
const PER_ITEM = { justmet: 3, overdue: 3, due: 3, resurfaced: 3, loops: 1.2, news: 1.2, coming: 1.2, replies: 0.6, 'today-light': 0.5 };

// Big windows: Today becomes a board and the weekly review gets columns.
// 1400 is the narrowest window where the open person and one column still
// fit side by side (a full-screen 14 or 16 inch Mac is 1496 or wider).
// The sizes here match the board's in style.css.
const bigQuery = window.matchMedia('(min-width: 1400px)');
const BOARD = { rail: 200, pad: 32, stats: 172, gap: 28, col: 340, colGap: 20, panelMin: 560, panelMax: 1000 };

// How many columns fit beside the numbers, and beside the open person.
function boardFit(withPanel) {
  const dash = window.innerWidth - BOARD.rail - 2 * BOARD.pad;
  let main = dash - BOARD.stats - BOARD.gap;
  if (withPanel) main -= Math.min(BOARD.panelMax, Math.max(BOARD.panelMin, dash * 0.5)) + BOARD.gap;
  return Math.max(1, Math.floor((main + BOARD.colGap) / (BOARD.col + BOARD.colGap)));
}

// A column per section while there's room. With more sections than columns,
// each goes to the shortest column so far.
function boardHTML(blocks, fit) {
  const cols = Array.from({ length: Math.min(fit, blocks.length) }, () => ({ h: 0, html: '' }));
  for (const b of blocks) {
    const col = cols.reduce((a, c) => (c.h < a.h ? c : a));
    col.h += 1 + b.n * (PER_ITEM[b.key] || 1);
    col.html += b.html;
  }
  return `<div class="board" data-fit="${fit}" style="--board-cols: ${cols.length}">${cols.map((c) => `<div class="board-col">${c.html}</div>`).join('')}</div>`;
}

// The person you clicked on the board: their whole page, on the right.
function pickPanelHTML(id) {
  const p = S.personById.get(id);
  return `<aside class="pick-panel" data-id="${esc(id)}" aria-label="${esc(p.name)}">${renderPerson(id, { panel: true })}</aside>`;
}

const boardOn = () => view.classList.contains('is-board') && parseRoute().name === 'today';

// Everyone on the board, in the order you see them (column by column).
// `shown` leaves out folded sections.
function boardPeople(shown = false) {
  const els = [...view.querySelectorAll('.board [data-pick]')].filter((el) => !shown || !el.closest('[hidden]'));
  return [...new Set(els.map((el) => el.dataset.pick))];
}

function pickPerson(id, focus = null) {
  S.ui.pick = { id, focus };
  S.ui.revealPick = true;
  render();
}

function closePick() {
  S.ui.pick = null;
  render();
}

// Down and up on the board go to the next or previous person.
function stepBoard(dir) {
  const ids = boardPeople(true);
  if (!ids.length) return;
  const at = S.ui.pick ? ids.indexOf(S.ui.pick.id) : -1;
  const next = ids[at < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, at + dir))];
  if (S.ui.pick && next === S.ui.pick.id) return;
  pickPerson(next);
}

// Once the open person leaves the board (logged, snoozed, done), the one
// after them opens, or the one before if they were last.
function nextPick(id, order) {
  if (!S.personById.get(id)) return null;
  const prev = S.ui.boardOrder;
  const at = prev.indexOf(id);
  if (at < 0) return null;
  const next = prev.slice(at + 1).find((x) => order.includes(x)) || prev.slice(0, at).reverse().find((x) => order.includes(x));
  return next ? { id: next, focus: null } : null;
}

// A touchpoint still waiting on a reply. The row opens it on the person's
// page; the buttons settle it right here.
function replyRow(t) {
  const p = S.personById.get(t.personId);
  const id = esc(t.id);
  return `<div class="reply-row" data-pick="${esc(t.personId)}" data-focus="${id}">
    <a class="light-main" href="#/person/${esc(t.personId)}/${id}"><span class="light-name">${esc(p.name)}</span>
      <span class="reply-what">${esc(touchTypeLabel(t.type))} <span class="dot">·</span> ${esc(fmtDate(t.date))}</span>
      ${tpNote(t) ? `<span class="light-idea">${esc(tpNote(t))}</span>` : ''}</a>
    <span class="reply-actions">
      <button type="button" class="primary small-btn" data-action="reply-mark" data-key="yes" data-id="${id}">Replied</button>
      <button type="button" class="secondary small-btn" data-action="reply-mark" data-key="no" data-id="${id}">No reply</button>
      <button type="button" class="secondary small-btn" data-action="reply-later" data-id="${id}">Not yet</button>
    </span>
  </div>`;
}

// One light touch on Today: who, their circle and a light idea, with Log
// and Snooze. Never late: a missed one just carries on to the next sitting.
function lightRow(p) {
  const id = esc(p.id);
  return `<div class="light-row" data-pick="${id}">
    <a class="light-main" href="#/person/${id}"><span class="light-who"><span class="light-name">${esc(p.name)}</span>${circleChips(p)}</span>
      <span class="light-idea">${esc(shownIdea(p).text)}</span></a>
    <span class="light-actions">
      <button type="button" class="primary small-btn" data-action="log" data-id="${id}">Log</button>
      <button type="button" class="secondary small-btn" data-action="snooze" data-id="${id}">Snooze</button>
    </span>
  </div>`;
}

function firstRunHTML() {
  return `<section class="teach">
    <h2 class="teach-title">Keep your people close</h2>
    <p>Callback remembers who to reach out to, when, and why, so the people who hire you never go cold.</p>
    <ol class="teach-steps">
      <li><b>Add someone</b> you want to work with, or keep working with: a casting director, a booker, an editor, a past client.</li>
      <li><b>Log a touchpoint</b> each time you reach out. An email, a DM, a coffee, a print in the mail. It takes ten seconds.</li>
      <li><b>Callback schedules the next one</b> based on how well you know them, and lists who's due right here every morning.</li>
    </ol>
    <div class="teach-warmth">
      <p class="teach-label">How well you know them</p>
      ${WARMTH.map((w) => `<p class="teach-warmth-row">${warmthBadge(w)}<span>${esc(WARMTH_INFO[w].blurb)}</span></p>`).join('')}
    </div>
    <p class="teach-tip">The best touchpoints give something: a new frame that fits their work, congratulations on a launch, selects after a shoot. Callback suggests one for each person.</p>
    <button type="button" class="hero-cta" data-action="add-person">Add your first person</button>
    <div class="teach-more">
      <button type="button" class="btn secondary" data-action="import-contacts">Add from your contacts</button>
      <button type="button" class="btn secondary" data-action="import-json">Restore a backup</button>
    </div>
  </section>`;
}

function caughtUpHTML(today) {
  const upcoming = S.people
    .filter((p) => p.warmth !== 'parked' && !p.lightTouch && !dreamOnly(p) && (p.nextTouchpointDate || today) > today)
    .sort((a, b) => a.nextTouchpointDate.localeCompare(b.nextTouchpointDate))
    .slice(0, 4);
  return `<div class="caught-up">
    <p class="caught-up-title">You're all caught up.</p>
    <p>Nobody is due today.${upcoming.length ? ' Coming up next:' : ''}</p>
    ${upcoming.length ? `<div class="card-list">${upcoming.map(personRow).join('')}</div>` : ''}
  </div>`;
}

function exportReminderHTML(today) {
  if (S.meta.reminderUntil && S.meta.reminderUntil > today) return '';
  // Syncing counts as a backup: the repository keeps every version.
  const synced = S.meta.sync && S.meta.sync.lastSyncAt;
  if (synced && daysBetween(toDateStr(new Date(synced)), today) <= 30) return '';
  const ref = S.meta.lastExportAt || S.meta.installedAt;
  if (!ref) return '';
  const days = daysBetween(toDateStr(new Date(ref)), today);
  if (days <= 30) return '';
  const lead = S.meta.lastExportAt ? `Your last backup was ${days} days ago.` : "You haven't saved a backup yet.";
  return `<div class="reminder">
    <p><b>${esc(lead)}</b> Callback keeps everything in this browser only, so an export now and then keeps it safe.</p>
    <div class="prompt-actions">
      <button type="button" class="btn primary" data-action="export-json">Export now</button>
      <button type="button" class="btn secondary" data-action="remind-later">Later</button>
    </div>
  </div>`;
}

// news: their-news item to show on this card, when it falls on the day
// they're due.
function personCard(p, kind, news = null) {
  const today = todayStr();
  const tps = tpsOf(p.id);
  const last = tps[0];
  const facts = [];
  if (kind === 'justMet') facts.push(`<b>${esc(followUpText(p, today))}</b>`);
  if (kind === 'overdue') facts.push(`<b>Due ${esc(relDay(p.nextTouchpointDate, today))}</b>`);
  if (kind === 'due') facts.push('<b>Due today</b>');
  if (kind === 'resurfaced') facts.push(`<b>Parked ${p.parkedOn ? esc(relDay(p.parkedOn, today)) : 'a while ago'}</b>`);
  facts.push(esc(sinceText(p, today)));
  if (last && last.responded === 'pending') facts.push('Waiting on a reply');

  const id = esc(p.id);
  const name = esc(firstName(p));
  let prompt = '';
  if (kind === 'resurfaced') {
    prompt = promptBox(
      'Worth trying again?',
      `<button type="button" class="btn primary" data-action="unpark" data-id="${id}">Try again</button>
       <button type="button" class="btn secondary" data-action="repark" data-id="${id}">Not yet</button>`
    );
  } else if (needsParkPrompt(p, tps)) {
    prompt = promptBox(
      `No reply after all ${COLD_STEPS} notes. Park ${name} for now? Callback will bring them back in ${span(S.settings.cadence.parked)}.`,
      `<button type="button" class="btn primary" data-action="park" data-id="${id}">Park ${name}</button>`
    );
  } else if (needsWarmPrompt(p, tps)) {
    prompt = promptBox(`${name} replied. Move them to Warm?`, `<button type="button" class="btn primary" data-action="make-warm" data-id="${id}">Move to Warm</button>`);
  }

  const logBtn = `<button type="button" class="btn primary" data-action="log" data-id="${id}"${news ? ` data-news="${esc(news.id)}"` : ''}>Log touchpoint</button>`;
  const openBtn = `<button type="button" class="btn secondary" data-action="open-person" data-id="${id}">Open</button>`;
  // Just met waits for the first touchpoint, not a date, so no snooze.
  const actions =
    kind === 'resurfaced' ? openBtn
      : kind === 'justMet' ? logBtn + openBtn
      : `<button type="button" class="btn primary" data-action="log" data-id="${id}"${news ? ` data-news="${esc(news.id)}"` : ''}>Log touchpoint</button>
         <button type="button" class="btn secondary" data-action="snooze" data-id="${id}">Snooze</button>
         <button type="button" class="btn secondary" data-action="open-person" data-id="${id}">Open</button>`;
  const newsLine = news
    ? `<p class="news-line"><span class="news-when">Their news</span>${esc(news.description)}${news.date === today ? '' : ` <span class="dot">·</span> ${esc(relDay(news.date, today))}`}</p>`
    : '';
  const idea = news && !news.repeatsYearly
    ? '<div class="idea"><span class="idea-label">Idea</span><p class="idea-text">Congratulate them, or send something that fits the moment.</p></div>'
    : ideaHTML(p);
  const stage = kind === 'justMet' ? null : firstStage(p);
  return `<article class="item-card${kind === 'overdue' || (kind === 'justMet' && (p.firstContactDeadline || today) < today) ? ' is-overdue' : ''}" data-pick="${id}">
    ${itemHead(p)}
    ${stage ? '<p class="first-line"><span class="first-tag">First contact</span></p>' : ''}
    <p class="item-facts">${facts.join(' <span class="dot">·</span> ')}</p>
    ${newsLine}
    ${last && tpNote(last) ? `<p class="item-last"><span class="item-last-label">Last:</span> ${esc(tpNote(last))}</p>` : ''}
    ${prompt || idea}
    <div class="item-actions">${actions}</div>
  </article>`;
}

function itemHead(p) {
  const sub = subLine(p);
  return `<a class="item-head" href="#/person/${esc(p.id)}">
      <span class="item-who"><span class="item-name">${esc(p.name)}</span>${sub ? `<span class="item-sub">${sub}</span>` : ''}${relLabels(p)}${circleChips(p)}</span>
      ${warmthBadge(p.warmth)}
    </a>`;
}

// A their-news card. `coming` marks a yearly date still a few days off.
function newsCard(n, { coming = false } = {}) {
  const p = S.personById.get(n.personId);
  const today = todayStr();
  const id = esc(p.id);
  const when = n.date === today ? 'Today' : coming ? `${fmtDate(n.date)}, ${relDay(n.date, today)}` : cap(relDay(n.date, today));
  const idea = (n.repeatsYearly && yearlyIdea([n], tpsOf(p.id), today, { light: p.lightTouch })) || 'Congratulate them, or send something that fits the moment.';
  return `<article class="item-card news-card" data-pick="${id}">
    ${itemHead(p)}
    <p class="news-line"><span class="news-when">${esc(when)}</span>${esc(n.description)}${n.repeatsYearly ? ' <span class="yearly-tag">Every year</span>' : ''}</p>
    <p class="item-facts">${esc(sinceText(p, today))}</p>
    <div class="idea"><span class="idea-label">Idea</span><p class="idea-text">${esc(idea)}</p></div>
    <div class="item-actions">
      <button type="button" class="btn primary" data-action="log" data-id="${id}" data-news="${esc(n.id)}">Log touchpoint</button>
      <button type="button" class="btn secondary" data-action="dismiss-news" data-id="${esc(n.id)}">${n.repeatsYearly ? 'Not this year' : 'Dismiss'}</button>
      <button type="button" class="btn secondary" data-action="open-person" data-id="${id}">Open</button>
    </div>
  </article>`;
}

// "Beach dates" reads as "beach dates" mid-sentence, unless it starts with
// someone's name.
function midSentence(text) {
  const t = text.trim().replace(/[.!\s]+$/, '');
  const m = t.match(/^([A-Z])([a-z]+)(?:'s)?\b/);
  if (!m) return t;
  const word = (m[1] + m[2]).toLowerCase();
  if (S.people.some((p) => firstWord(p).toLowerCase() === word)) return t;
  return t[0].toLowerCase() + t.slice(1);
}

// A loop on Today. One on your side reads as a promise to keep; one on their
// side reads as a gentle follow-up. Under Coming up (`coming`), before it's
// due, it's a heads-up.
function loopCard(l, { coming = false } = {}) {
  const p = S.personById.get(l.personId);
  const today = todayStr();
  const pid = esc(p.id);
  const lid = esc(l.id);
  const n = daysBetween(l.dueDate, today);
  const who = `<a href="#/person/${pid}">${esc(firstName(p))}</a>`;
  const when = `${fmtDate(l.dueDate)}, ${relDay(l.dueDate, today)}`;
  if (coming) {
    const theirs = l.direction === 'theyOwe';
    return `<article class="item-card loop-card ${theirs ? 'is-theyowe' : 'is-iowe'}" data-pick="${pid}">
      <p class="loop-kicker">${loopIcon(l.direction)}<span>On ${theirs ? 'their' : 'your'} side</span></p>
      <p class="loop-desc">${theirs ? `Waiting on ${esc(midSentence(l.description))} from ${who}.` : `You promised ${who}: ${esc(l.description)}`}</p>
      <p class="item-facts"><b>${theirs ? 'Expected' : 'Due'} ${esc(when)}</b></p>
      <div class="item-actions">
        <button type="button" class="btn primary" data-action="close-loop" data-id="${lid}">${theirs ? 'Got it' : 'Kept it'}</button>
        <button type="button" class="btn secondary" data-action="open-person" data-id="${pid}">Open</button>
      </div>
    </article>`;
  }
  if (l.direction === 'theyOwe') {
    return `<article class="item-card loop-card is-theyowe" data-pick="${pid}">
      <p class="loop-kicker">${loopIcon('theyOwe')}<span>On their side</span></p>
      <p class="loop-desc">${n === 0 ? 'Waiting' : 'Still waiting'} on ${esc(midSentence(l.description))} from ${who}.</p>
      <p class="item-facts">${n === 0 ? '<b>Expected today</b>' : `<b>Expected ${esc(fmtDate(l.dueDate))}</b> <span class="dot">·</span> ${esc(relDay(l.dueDate, today))}`}</p>
      <div class="item-actions">
        <button type="button" class="btn primary" data-action="close-loop" data-id="${lid}">Got it</button>
        <button type="button" class="btn secondary" data-action="loop-not-yet" data-id="${lid}">Not yet</button>
        <button type="button" class="btn secondary" data-action="open-person" data-id="${pid}">Open</button>
      </div>
    </article>`;
  }
  return `<article class="item-card loop-card is-iowe${n > 0 ? ' is-overdue' : ''}" data-pick="${pid}">
    <p class="loop-kicker">${loopIcon('iOwe')}<span>On your side</span></p>
    <p class="loop-desc">You promised ${who}: ${esc(l.description)}</p>
    <p class="item-facts"><b>${n === 0 ? 'Due today' : `Due ${esc(relDay(l.dueDate, today))}`}</b></p>
    <div class="item-actions">
      <button type="button" class="btn primary" data-action="close-loop" data-id="${lid}">Kept it</button>
      <button type="button" class="btn secondary" data-action="loop-not-yet" data-id="${lid}">Not yet</button>
      <button type="button" class="btn secondary" data-action="open-person" data-id="${pid}">Open</button>
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// People

const SORTS = {
  contact: 'Days since contact',
  name: 'Name',
  next: 'Next touchpoint',
  warmth: 'Warmth',
  added: 'Date added',
};
// Each sort's two orders: its usual one first, then the other way round.
const SORT_ORDERS = {
  contact: ['Longest ago first', 'Most recent first'],
  name: ['A to Z', 'Z to A'],
  next: ['Soonest first', 'Latest first'],
  warmth: ['Warmest first', 'Coldest first'],
  added: ['Newest first', 'Oldest first'],
};
const sortLabel = (ui) => `Sort: ${SORTS[ui.sort]}${ui.reverse ? `, ${SORT_ORDERS[ui.sort][1]}` : ''}`;
// The sort choices and the order under them (People, and a circle's members).
function sortPanelHTML(ui, scope = '') {
  const sc = scope ? ` data-scope="${scope}"` : '';
  const chip = (on, attrs, label) => `<button type="button" class="chip${on ? ' active' : ''}" ${attrs}${sc} aria-pressed="${on}">${esc(label)}</button>`;
  return `<div class="sort-panel"${ui.sortOpen ? '' : ' hidden'}>
    <div class="filters">${Object.entries(SORTS).map(([k, label]) => chip(ui.sort === k, `data-action="set-sort" data-sort="${k}"`, label)).join('')}</div>
    <p class="filter-label">Order</p>
    <div class="filters">${SORT_ORDERS[ui.sort].map((label, i) => chip(ui.reverse === !!i, `data-action="set-order" data-reverse="${i}"`, label)).join('')}</div>
  </div>`;
}
const WARMTH_ORDER = { client: 0, active: 1, warm: 2, cold: 3, parked: 4 };

// `added`: also say when they were added (when that's the sort).
function personRow(p, { added = false, flag = false } = {}) {
  const today = todayStr();
  const next = p.nextTouchpointDate || today;
  const sub = subLine(p);
  let nextText;
  if (firstStage(p) === 'justMet') nextText = `<b>${esc(followUpText(p, today))}</b>`;
  else if (dreamOnly(p)) nextText = 'Not reached out yet';
  else if (p.lightTouch && p.warmth !== 'parked' && next <= addDays(weekStartStr(today), 6)) nextText = 'Light touch this week';
  else if (p.warmth === 'parked') nextText = `Back ${esc(fmtDate(next, { weekday: false }))}`;
  else if (next < today) nextText = `<b>${esc(nextRelText(next, today))}</b>`;
  else if (next === today) nextText = '<b>Due today</b>';
  else nextText = `Next ${esc(fmtDate(next, { weekday: false }))}`;
  const waiting = flag && waitingTps(p).length > 0;
  return `<a class="row-card${p.warmth === 'parked' ? ' is-parked' : ''}${waiting ? ' is-waiting' : ''}" href="#/person/${esc(p.id)}"${flag && replyToAsk(p) ? ` data-ask-reply="${esc(p.id)}"` : ''}>
    <span class="row-main">
      <span class="row-name">${esc(p.name)}${waiting ? REPLY_FLAG : ''}</span>
      ${sub ? `<span class="row-sub">${sub}</span>` : ''}
      <span class="row-meta">${added && p.createdAt ? `<span class="nowrap">Added ${esc(fmtDate(toDateStr(new Date(p.createdAt)), { weekday: false }))}</span> <span class="dot">·</span> ` : ''}${dreamOnly(p) ? `<span class="nowrap">${nextText}</span>` : `<span class="nowrap">${esc(sinceText(p, today))}</span> <span class="dot">·</span> <span class="nowrap">${nextText}</span>`}</span>
    </span>
    <span class="row-badges">${warmthBadge(p.warmth)}${p.lightTouch ? `<span class="dream-mark" title="Light touch">${LIGHT_ICON}<span class="visually-hidden">Light touch</span></span>` : ''}${p.dreamList ? `<span class="dream-mark" title="Dream list">${DREAM_STAR}<span class="visually-hidden">Dream list</span></span>` : ''}${loopCountBadge(openLoopsOf(p.id).length)}</span>
  </a>`;
}

// Still waiting on a reply: touchpoints marked Waiting that Callback asks
// about (the ones "Did they reply?" on Today asks about, at any age). On
// People they put a little drawn "!" over the person; tapping someone whose
// reply has waited two days or more asks about it over their page (11-10).
function waitingTps(p) {
  if (p.lightTouch || p.warmth === 'parked') return [];
  return tpsOf(p.id).filter((t) => t.responded === 'pending' && !t.lightTouch && t.type !== 'project_wrapped');
}
// The one to ask about: waiting longest, and due a check (two days on, or
// two days after the last "Not yet").
function replyToAsk(p) {
  return waitingTps(p).filter((t) => replyCheckDue(p, t)).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}
// The Pending responses filter's icon: the same drawn "!" (11-10).
const PENDING_ICON = '<svg class="warmth-icon pending-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.9 1.8c-.3 3.2-.6 6.2-1 9.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="7.5" cy="13.9" r="1.3" fill="currentColor"/></svg>';
const REPLY_FLAG = ' <span class="reply-flag" title="Waiting on a reply"><svg viewBox="0 0 12 24" aria-hidden="true"><path d="M7.4 2.4c-.4 4.3-.9 8.5-1.5 12.6"/><circle cx="5.3" cy="20.3" r="1.7"/></svg><span class="visually-hidden">Waiting on a reply.</span></span>';

function openFromPeople(id) {
  const p = S.personById.get(id);
  const to = `#/person/${id}`;
  if (p && replyToAsk(p)) {
    if (location.hash === to) {
      askWaitingReply(p);
      return;
    }
    S.ui.askReplyFor = id;
  }
  location.hash = to;
}

async function askWaitingReply(p) {
  const t = replyToAsk(p);
  if (!t) return;
  const note = tpNote(t);
  const short = note.length > 80 ? `${note.slice(0, 78).trimEnd()}...` : note;
  const key = await choiceSheet({
    title: 'Did they reply?',
    message: `You reached out to ${esc(firstName(p))} on ${esc(fmtDate(t.date))} (${esc(touchTypeLabel(t.type).toLowerCase())}${short ? `: ${esc(short)}` : ''}). Did ${esc(firstName(p))} get back to you?`,
    options: [
      { key: 'yes', label: 'Replied' },
      { key: 'no', label: 'No reply' },
      { key: 'later', label: 'Not yet', detail: 'Callback asks again in two days.' },
    ],
  });
  if (!key) return;
  if (key === 'later') {
    await db.saveTouchpoint({ ...t, replyCheckAt: nowISO() });
    await refresh();
    toast('Callback will ask again in two days.');
    return;
  }
  await markResponse(t, key);
}

function filteredPeople() {
  const f = S.ui.people;
  const today = todayStr();
  const q = f.q.trim().toLowerCase();
  let list = S.people.filter((p) => f.showParked || p.warmth !== 'parked');
  if (f.warmth.size) list = list.filter((p) => f.warmth.has(p.warmth));
  if (f.rel.size) list = list.filter((p) => relTypesOf(p).some((k) => f.rel.has(k)));
  if (f.interest.size) list = list.filter((p) => f.interest.has(p.interest));
  if (f.circles.size) list = list.filter((p) => p.circleIds.some((id) => f.circles.has(id)));
  if (f.loops) list = list.filter((p) => openLoopsOf(p.id).length);
  if (f.pending) list = list.filter((p) => waitingTps(p).length);
  if (f.dream) list = list.filter((p) => p.dreamList);
  if (f.light) list = list.filter((p) => p.lightTouch);
  if (f.role) list = list.filter((p) => (p.role || '').toLowerCase() === f.role.toLowerCase());
  if (f.org) list = list.filter((p) => p.organizationId === f.org);
  if (q) {
    list = list.filter((p) => {
      const org = orgOf(p);
      return [p.name, org && org.name, p.notes, p.role, p.email, p.howWeMet, ...circlesOf(p).map((c) => c.name)]
        .some((v) => v && v.toLowerCase().includes(q));
    });
  }
  return sortPeople(list, f.sort, f.reverse);
}

// The People sorts, also used for a circle's members. `reverse` flips the
// sort itself; people who tie stay A to Z.
function sortPeople(list, sort, reverse = false) {
  const today = todayStr();
  const since = (p) => {
    const last = tpsOf(p.id)[0];
    return last ? daysBetween(last.date, today) : Infinity;
  };
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sorters = {
    contact: (a, b) => {
      const sa = since(a);
      const sb = since(b);
      return sa === sb ? 0 : sb - sa;
    },
    name: byName,
    next: (a, b) => (a.nextTouchpointDate || '').localeCompare(b.nextTouchpointDate || ''),
    warmth: (a, b) => WARMTH_ORDER[a.warmth] - WARMTH_ORDER[b.warmth],
    // Newest first.
    added: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
  };
  const by = sorters[sort] || sorters.contact;
  const dir = reverse ? -1 : 1;
  return list.sort((a, b) => dir * by(a, b) || byName(a, b));
}

function activeFilterCount() {
  const f = S.ui.people;
  return f.warmth.size + f.rel.size + f.interest.size + f.circles.size + (f.loops ? 1 : 0) + (f.pending ? 1 : 0) + (f.dream ? 1 : 0) + (f.light ? 1 : 0) + (f.role ? 1 : 0) + (f.org ? 1 : 0);
}

function peopleListHTML() {
  if (!S.people.length) {
    return `<div class="empty">
      <p class="empty-title">No one here yet.</p>
      <p>Add the casting directors, bookers, editors and clients you want to stay close to. Callback will tell you when to reach out.</p>
      <button type="button" class="hero-cta" data-action="add-person">Add your first person</button>
      <button type="button" class="btn secondary wide" data-action="import-contacts">Add from your contacts</button>
    </div>`;
  }
  const list = filteredPeople();
  const parkedHidden = S.ui.people.showParked ? 0 : S.people.filter((p) => p.warmth === 'parked').length;
  const count = `<p class="list-count">${plural(list.length, 'person', 'people')}${parkedHidden ? ` <span class="dot">·</span> ${parkedHidden} parked hidden` : ''}</p>`;
  if (!list.length) {
    return `${count}<div class="empty"><p>Nobody matches that.</p>
      <button type="button" class="btn secondary" data-action="clear-filters">Clear search and filters</button></div>`;
  }
  const added = S.ui.people.sort === 'added';
  return count + list.map((p) => personRow(p, { added, flag: true })).join('');
}

function uniqueSorted(values) {
  const seen = new Map();
  for (const v of values) if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function filtersHTML() {
  const f = S.ui.people;
  const roles = uniqueSorted(S.people.map((p) => p.role));
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  return `
    <p class="filter-label">Show only</p>
    <div class="filters">
      <button type="button" class="chip${f.pending ? ' active' : ''}" data-action="filter-pending" aria-pressed="${f.pending}">${PENDING_ICON}Pending responses</button>
      <button type="button" class="chip${f.loops ? ' active' : ''}" data-action="filter-loops" aria-pressed="${f.loops}">${loopIcon('count')}Has open loops</button>
      <button type="button" class="chip${f.dream ? ' active' : ''}" data-action="filter-dream" aria-pressed="${f.dream}">${DREAM_STAR}Dream list</button>
      <button type="button" class="chip${f.light ? ' active' : ''}" data-action="filter-light" aria-pressed="${f.light}">${LIGHT_ICON}Light touch</button>
    </div>
    <p class="filter-label">Warmth</p>
    <div class="filters">
      ${WARMTH.filter((w) => w !== 'parked' || f.showParked)
        .map((w) => `<button type="button" class="chip${f.warmth.has(w) ? ' active' : ''}" data-action="filter-warmth" data-w="${w}" aria-pressed="${f.warmth.has(w)}">${warmthIcon(w)}${esc(WARMTH_INFO[w].label)}</button>`)
        .join('')}
    </div>
    <p class="filter-label">Relationship</p>
    <div class="filters">
      ${RELATIONSHIP_TYPES.map((r) => `<button type="button" class="chip${f.rel.has(r.key) ? ' active' : ''}" data-action="filter-rel" data-r="${r.key}" aria-pressed="${f.rel.has(r.key)}">${relIcon(r.key)}${esc(r.label)}</button>`).join('')}
    </div>
    <p class="filter-label">Interest</p>
    <div class="filters">
      ${INTEREST_LEVELS.map((i) => `<button type="button" class="chip${f.interest.has(i.key) ? ' active' : ''}" data-action="filter-interest" data-i="${i.key}" aria-pressed="${f.interest.has(i.key)}">${interestIcon(i.key)}${esc(i.label)}</button>`).join('')}
    </div>
    ${S.circles.length ? `<p class="filter-label">Circles</p>
    <div class="filters">
      ${S.circles.map((c) => `<button type="button" class="chip${f.circles.has(c.id) ? ' active' : ''}" data-action="filter-circle" data-c="${esc(c.id)}" aria-pressed="${f.circles.has(c.id)}">${CIRCLE_ICON}${esc(c.name)}</button>`).join('')}
    </div>` : ''}
    <div class="filter-grid">
      <label class="field"><span class="field-label">Role</span>
        <select data-filter="role">${opt('', 'Any role', !f.role)}${roles.map((r) => opt(r, r, f.role === r)).join('')}</select></label>
      <label class="field"><span class="field-label">Organization</span>
        <select data-filter="org">${opt('', 'Any organization', !f.org)}${S.orgs.map((o) => opt(o.id, o.name, f.org === o.id)).join('')}</select></label>
    </div>
    ${activeFilterCount() ? '<button type="button" class="text-btn" data-action="clear-filters">Clear filters</button>' : ''}`;
}

// People on a phone: written by hand like Today, and everyone drawn holding
// hands in a ring (ring.js) unless List is on. The choice stays on this
// device.
function readPeopleView() {
  try { return localStorage.getItem('callback.peopleView') === 'list' ? 'list' : 'ring'; } catch { return 'ring'; }
}
const ringOn = () => S.people.length > 0 && S.ui.people.view !== 'list';
let ringPeople = [];

// How big someone stands in the ring: the closer you are, the bigger.
const RING_SIZE = { client: 1, active: 0.9, warm: 0.8, cold: 0.7, parked: 0.6 };
function ringSize(p) {
  let s = RING_SIZE[p.warmth] ?? 0.75;
  if (p.lightTouch) s = Math.min(s, 0.72);
  if (dreamOnly(p)) s = Math.min(s, 0.66);
  return s;
}
// How someone is drawn. The words are never shown under the drawings; they
// only name them for screen readers and the sync clash view.
const FIGURES = [['man', 'With a tie'], ['woman', 'In a dress'], ['person', 'Plain']];
const figureWords = (k) => (FIGURES.find(([x]) => x === k) || FIGURES[2])[1];
const figureOf = (p) => (FIGURES.some(([k]) => k === p.figure) ? p.figure : 'person');
const ringData = (list, { flags = false } = {}) => ({
  people: list.map((p) => ({ id: p.id, name: firstName(p), figure: figureOf(p), size: ringSize(p), warmth: p.warmth, flag: flags && waitingTps(p).length > 0 })),
  key: list.map((p) => p.id).join(','),
});
const RING_OPTS = { onOpen: (id) => { location.hash = `#/person/${id}`; } };
// Inside a building, a few windows float behind them, and only the real
// people stand there: five or fewer in a line, more in a small ring.
const RING_INSIDE = { ...RING_OPTS, backdrop: 'windows', ghosts: false };
// People: the page holds still under the ring.
const RING_PEOPLE = { ...RING_OPTS, hold: true, onOpen: (id) => openFromPeople(id) };
let ringOpts = RING_OPTS;

function ringHTML(list) {
  if (!list.length) {
    return `<div class="empty"><p>Nobody matches that.</p>
      <button type="button" class="btn secondary" data-action="clear-filters">Clear search and filters</button></div>`;
  }
  // A key to the colours, for the warmths in the ring.
  const KEY = ['client', 'active', 'warm', 'cold', 'parked'];
  const here = KEY.filter((w) => list.some((p) => p.warmth === w));
  return `<div class="ring-key" aria-hidden="true">${here.map((w) => `<span class="ring-key-item"><i class="ring-key-dot is-${w}"></i>${esc(WARMTH_INFO[w].label)}</span>`).join('')}</div>
    <div class="ring-slot" data-ring-slot></div>
    <ul class="visually-hidden">${list.map((p) => `<li><a href="#/person/${esc(p.id)}">${esc(p.name)}</a></li>`).join('')}</ul>`;
}

function mountRingIn(root) {
  const slot = root.querySelector('[data-ring-slot]');
  if (slot) mountRing(slot, ringData(ringPeople, { flags: ringOpts === RING_PEOPLE }), ringOpts);
}

// A loose line drawn under the search, and the hand-drawn icons.
const HAND_RULE = '<svg class="hand-rule" viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M2 6 C 40 3.5 80 7.5 125 5.2 S 210 3.8 250 6 S 290 5 298 4.2"/></svg>';
const HAND_QUICK = '<svg class="hand-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.2 2.6 C 11 7 8.6 10.4 6.4 13.4 C 8.6 13.2 10.4 13.1 12 13.3 C 11.2 16.2 10.6 18.8 9.8 21.6 C 12.6 17.8 15.2 14.2 17.8 10.6 C 15.9 10.6 14.2 10.8 12.6 11 C 13.1 8.2 13.6 5.4 14.2 2.6"/></svg>';
const HAND_LIST = '<svg class="hand-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.6 6.2 a1 1 0 1 0 .2 0 M8 6.4 C 11 5.6 15 7 20.6 5.8 M3.6 12 a1 1 0 1 0 .2 0 M8 12.2 C 12 11.4 15.6 12.8 20.2 11.8 M3.6 17.8 a1 1 0 1 0 .2 0 M8 18 C 11.4 17.2 16 18.6 20.8 17.4"/></svg>';
const HAND_BACK = '<svg class="hand-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 5.2 C 8.4 7.6 6.2 9.8 3.8 12.1 C 6 14.2 8.1 16.5 10.3 18.9 M4.4 12.2 C 9 11.5 14.6 12.7 20.6 11.7"/></svg>';
const HAND_RING = '<svg class="hand-circle" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M58 4 C 26 2 4 9 5 21 C 6 33 34 38 60 36 C 86 34 97 26 95 16 C 93 7 74 3 50 5 C 40 6 32 8 27 11"/></svg>';

// ---------------------------------------------------------------------------
// Circles and Organizations on a phone: a map (map.js) of little rings of
// people, or of buildings, unless List is on. A tap flies in and opens the
// circle or organization as a ring of its people, like People.

function toggleMapView(kind) {
  const k = `${kind}View`;
  S.ui[k] = S.ui[k] === 'list' ? 'map' : 'list';
  try { localStorage.setItem(`callback.${k}`, S.ui[k]); } catch { /* this device only */ }
  if (parseRoute().id) location.hash = `#/${kind}`;
  else render();
}
function readMapView(kind) {
  try { return localStorage.getItem(`callback.${kind}View`) === 'list' ? 'list' : 'map'; } catch { return 'map'; }
}
function listButton(action, on) {
  return `<button type="button" class="hand-btn hand-list" data-action="${action}" aria-pressed="${on}"><span class="hand-btn-text">${HAND_LIST}List</span>${HAND_RING}${statScrib('List')}</button>`;
}
let mapNow = null;

function circlesMapData() {
  const items = S.circles.map((c) => {
    const members = membersOf(c.id);
    return { id: c.id, name: c.name, count: members.length, people: members.map((p) => ({ id: p.id, figure: figureOf(p), size: ringSize(p), warmth: p.warmth })) };
  });
  const key = items.map((c) => `${c.id}:${c.name}:${c.people.map((p) => `${p.id}.${p.figure}.${p.warmth}.${p.size}`).join(',')}`).join('|');
  return { kind: 'circles', items, key };
}
function orgsMapData(list) {
  const counts = groupBy(S.people.filter((p) => p.organizationId), 'organizationId');
  const items = list.map((o) => ({ id: o.id, name: o.name, type: o.type, n: (counts.get(o.id) || []).length }));
  // The busiest in the middle.
  items.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { kind: 'orgs', items, key: items.map((o) => `${o.id}:${o.name}:${o.type}:${o.n}`).join('|') };
}
function mapHTML(kind, list) {
  mapNow = kind === 'orgs' ? orgsMapData(list) : circlesMapData();
  return `<div class="map-wrap" id="${kind === 'orgs' ? 'orgList' : 'circleMap'}"><div class="map-slot" data-map-slot></div>
    <ul class="visually-hidden">${mapNow.items.map((x) => `<li><a href="#/${kind}/${esc(x.id)}">${esc(x.name)}</a></li>`).join('')}</ul></div>`;
}
// The section next door, drawn beside this page while the bottom bar is
// swiped (swipebar.js) so the two slide as one. Today's head, People's ring
// and a map are mounted in it for real when this page isn't using them;
// Circles and Orgs share the one map, so beside one the other is a picture
// of how it looked last time (or empty, the first time). Drawing it mustn't
// change what this page relies on, so those are put back after. It shows
// the section where going there will show it: at the top, or where it was
// left when coming from someone's page.
const mapShots = {};
function copyCanvas(cv) {
  const c = document.createElement('canvas');
  c.width = cv.width;
  c.height = cv.height;
  try { c.getContext('2d').drawImage(cv, 0, 0); } catch { /* left blank */ }
  const w = cv.clientWidth || parseFloat(cv.style.width) || 0;
  const h = cv.clientHeight || parseFloat(cv.style.height) || 0;
  c.style.cssText = `display: block; width: ${w}px; height: ${h}px;`;
  return c;
}
function shootMap() {
  const cv = view.querySelector('[data-map-slot] canvas');
  if (cv && cv.width && mapNow) mapShots[mapNow.kind] = copyCanvas(cv);
}
function peekPage(name, page) {
  const keep = [ringPeople, ringOpts, mapNow, todayMind];
  try {
    // Laid out the way render() would: the list beside an empty page on a
    // wide window, Today's board on a big one.
    const list = splitList(name);
    page.innerHTML = `<div class="view${list ? ' is-split' : ''}" data-route="${name}">${list ? splitHTML({ name, id: null }, list) : ROUTES[name]()}</div>`;
    const pv = page.firstElementChild;
    if (pv.querySelector('.board')) pv.classList.add('is-board');
    const fromDetail = /^#\/(person|org|circle)\//.test(location.hash);
    const y = fromDetail ? S.ui.scroll.get(`${name}/`) || 0 : 0;
    if (y) page.style.transform = `translate3d(0, ${-y}px, 0)`;
    const mind = pv.querySelector('[data-mind-slot]');
    if (mind) mountMind(mind, todayMind, { onOpen: openThought, onFace: faceMenu });
    mountRingIn(pv);
    const slot = pv.querySelector('[data-map-slot]');
    if (slot && mapNow) {
      if (view.querySelector('[data-map-slot] canvas')) {
        const shot = mapShots[mapNow.kind];
        if (shot) slot.appendChild(copyCanvas(shot));
      } else mountMap(slot, mapNow, { onOpen: () => {} });
    }
  } finally {
    [ringPeople, ringOpts, mapNow, todayMind] = keep;
  }
}
setSwipePeek(peekPage);

function mountMapIn(root, from = null) {
  const slot = root.querySelector('[data-map-slot]');
  if (!slot || !mapNow) return;
  const kind = mapNow.kind;
  mountMap(slot, mapNow, {
    from,
    onOpen: (id) => {
      location.hash = `#/${kind}/${id}`;
      // So "All circles" can go back to the map, not on to a new one.
      try { history.replaceState({ fromMap: true }, ''); } catch { /* fine */ }
    },
  });
}

// Inside a circle or an organization: its people in a ring.
function insideHTML({ title, back, backLabel, details, people, empty, inside }) {
  ringPeople = people;
  ringOpts = inside ? RING_INSIDE : RING_OPTS;
  return `
    <header class="topbar"><h1>${esc(title)}</h1></header>
    <div class="people-hand"><div class="hand-row">
      <button type="button" class="hand-btn" data-action="map-out" data-to="${back}"><span class="hand-btn-text">${HAND_BACK}${esc(backLabel)}</span>${statScrib(backLabel)}</button>
      <a class="hand-btn hand-end" href="${details}"><span class="hand-btn-text">Details</span>${statScrib('Details')}</a>
    </div></div>
    ${people.length ? `<div class="ring-wrap is-inside">${ringHTML(people)}</div>` : empty}`;
}
function circleInside(c) {
  const cid = esc(c.id);
  return insideHTML({
    title: c.name,
    back: '#/circles',
    backLabel: 'All circles',
    details: `#/circle/${cid}`,
    people: membersOf(c.id),
    empty: `<div class="empty"><p class="empty-title">Nobody in ${esc(c.name)} yet.</p><p>Add people here, or from anyone's page.</p>
      <button type="button" class="hero-cta" data-action="circle-add-people" data-id="${cid}">+ Add people</button></div>`,
  });
}
function orgInside(o) {
  const oid = esc(o.id);
  return insideHTML({
    title: o.name,
    back: '#/orgs',
    backLabel: 'All organizations',
    details: `#/org/${oid}`,
    people: S.people.filter((p) => p.organizationId === o.id),
    inside: true,
    empty: `<div class="empty"><p class="empty-title">Nobody here yet.</p>
      <button type="button" class="hero-cta" data-action="add-person" data-org="${oid}">+ Add person here</button></div>`,
  });
}

function renderPeopleHand(f, n) {
  const ring = f.view !== 'list';
  const list = ring ? filteredPeople() : [];
  ringPeople = list;
  ringOpts = RING_PEOPLE;
  return `
    <header class="topbar"><h1>People</h1>
      <span class="topbar-actions">
        <a class="dream-link" href="#/dreams">${DREAM_SKY_STAR}Dream list</a>
      </span></header>
    <div class="people-hand">
      <div class="hand-row">
        <button type="button" class="hand-btn" data-action="add-person"><span class="hand-btn-text">+ Add person</span>${statScrib('Add person')}</button>
        <button type="button" class="hand-btn" data-action="quick-add"><span class="hand-btn-text">${HAND_QUICK}Quick add</span>${statScrib('Quick add')}</button>
        <button type="button" class="hand-btn hand-list" data-action="people-view" aria-pressed="${!ring}"><span class="hand-btn-text">${HAND_LIST}List</span>${HAND_RING}${statScrib('List')}</button>
      </div>
      <label class="hand-search"><span class="visually-hidden">Search people</span>
        <input type="search" id="peopleSearch" placeholder="Search name, org, notes" value="${esc(f.q)}" autocomplete="off" enterkeyhint="search">${HAND_RULE}
        <button type="button" class="search-clear" data-action="clear-search" data-for="peopleSearch" aria-label="Clear search, show everyone"${f.q ? '' : ' hidden'}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 2.4c2.6 2.4 5.2 5.2 7.8 8M10 2.1C7.6 4.8 4.9 7.5 2 10.4"/></svg></button></label>
      <div class="toolbar hand-tools">
        <button type="button" class="hand-tool" data-action="toggle-sort" aria-expanded="${f.sortOpen}">${esc(sortLabel(f))}</button>
        <button type="button" class="hand-tool${n ? ' is-on' : ''}" data-action="toggle-filters" aria-expanded="${f.filtersOpen}">Filter: ${n ? n : 'All'}</button>
        <label class="check hand-check"><input type="checkbox" data-filter="parked"${f.showParked ? ' checked' : ''}> Show parked</label>
      </div>
      ${sortPanelHTML(f)}
      <div class="filters-panel" id="filtersPanel"${f.filtersOpen ? '' : ' hidden'}>${filtersHTML()}</div>
    </div>
    ${ring ? `<div class="ring-wrap" id="peopleList">${ringHTML(list)}</div>` : `<div class="card-list" id="peopleList">${peopleListHTML()}</div>`}`;
}

function renderPeople() {
  const f = S.ui.people;
  const n = activeFilterCount();
  if (S.people.length) return renderPeopleHand(f, n);
  return `
    <header class="topbar"><h1>People</h1>
      <span class="topbar-actions">
        <a class="dream-link" href="#/dreams">${DREAM_SKY_STAR}Dream list</a>
      </span></header>
    <div class="quick-row">
      <button type="button" class="primary small-btn" data-action="add-person">+ Add person</button>
      <button type="button" class="small-btn navy" data-action="quick-add">${QUICK_ICON} Quick add</button>
    </div>
    ${S.people.length ? `
    <input type="search" class="search" id="peopleSearch" placeholder="Search name, org, notes" value="${esc(f.q)}" autocomplete="off" aria-label="Search people">
    <div class="toolbar">
      <button type="button" class="filter-toggle" data-action="toggle-sort" aria-expanded="${f.sortOpen}">${esc(sortLabel(f))}</button>
      <button type="button" class="filter-toggle${n ? ' is-on' : ''}" data-action="toggle-filters" aria-expanded="${f.filtersOpen}">Filter: ${n ? n : 'All'}</button>
      <label class="check"><input type="checkbox" data-filter="parked"${f.showParked ? ' checked' : ''}> Show parked</label>
    </div>
    ${sortPanelHTML(f)}
    <div class="filters-panel" id="filtersPanel"${f.filtersOpen ? '' : ' hidden'}>${filtersHTML()}</div>` : ''}
    <div class="card-list" id="peopleList">${peopleListHTML()}</div>`;
}

// The x after a name typed in the People (or Orgs) search sits a space
// after the last letter. Tapping it clears the search back to everyone.
let searchRuler = null;
function placeSearchClear() {
  view.querySelectorAll('.search-clear').forEach(placeClearX);
}
function placeClearX(x) {
  const input = document.getElementById(x.dataset.for);
  if (!input) return;
  x.hidden = !input.value;
  if (!input.value) return;
  const cs = getComputedStyle(input);
  searchRuler = searchRuler || document.createElement('canvas').getContext('2d');
  searchRuler.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const end = parseFloat(cs.paddingLeft) + searchRuler.measureText(input.value).width - input.scrollLeft;
  const space = searchRuler.measureText(' ').width;
  // The button is wider than its x so it's easy to tap; the x sits in its middle.
  const pad = (x.offsetWidth - 12) / 2;
  x.style.left = `${Math.min(end + space - pad, input.offsetWidth - x.offsetWidth)}px`;
}

function updatePeopleList() {
  const el = document.getElementById('peopleList');
  if (el && el.classList.contains('ring-wrap')) {
    ringPeople = filteredPeople();
    el.innerHTML = ringHTML(ringPeople);
    mountRingIn(el);
    return;
  }
  if (el) el.innerHTML = peopleListHTML();
  markSelected();
}

// ---------------------------------------------------------------------------
// Person detail

function notFoundHTML(what, fallback, label) {
  return `<div class="detail-top">${backButton(fallback, label)}</div>
    <div class="empty"><p class="empty-title">This ${what} isn't here anymore.</p><p>It may have been deleted, or replaced by an import.</p></div>`;
}

// `panel`: shown beside Today's board, with Close instead of Back. Its
// sections fold on their own, apart from the board's.
function renderPerson(id, { panel = false } = {}) {
  const p = S.personById.get(id);
  if (!p) return notFoundHTML('person', '#/people', 'People');
  const k = (key) => (panel ? `pick-${key}` : key);
  const today = todayStr();
  const tps = tpsOf(id);
  const next = p.nextTouchpointDate || today;
  const pid = esc(p.id);
  const name = esc(firstName(p));
  const c = S.settings.cadence;

  let prompt = '';
  if (p.warmth === 'parked') {
    prompt = promptBox(
      `${name} is parked. Callback brings them back on ${esc(fmtDate(next))}.`,
      `<button type="button" class="btn primary" data-action="unpark" data-id="${pid}">Try again now</button>`
    );
  } else if (needsParkPrompt(p, tps) && next <= today) {
    prompt = promptBox(
      `No reply after all ${COLD_STEPS} notes. Park ${name} for now? Callback will bring them back in ${span(c.parked)}.`,
      `<button type="button" class="btn primary" data-action="park" data-id="${pid}">Park ${name}</button>`
    );
  } else if (needsWarmPrompt(p, tps)) {
    prompt = promptBox(`${name} replied. Move them to Warm?`, `<button type="button" class="btn primary" data-action="make-warm" data-id="${pid}">Move to Warm</button>`);
  } else if (isEngaging(p, tps)) {
    prompt = promptBox("They're engaging. Give them more attention?",
      `<button type="button" class="btn primary" data-action="light-off" data-id="${pid}">Turn off light touch</button>
       <button type="button" class="btn secondary" data-action="dismiss-engage" data-id="${pid}">Not now</button>`);
  }

  const stage = p.warmth === 'parked' ? null : firstStage(p);
  const deadline = p.firstContactDeadline || today;
  // A light touch is never late: a missed one carries on from today.
  const light = p.lightTouch && p.warmth !== 'parked';
  const shownNext = light && next < today ? today : next;
  // Warmth sits under their drawing (11-10), except On a project: that and
  // Wrap project stay side by side in the row of badges.
  const onProject = p.warmth === 'client';
  const warmthBtn = `<button type="button" class="warmth-btn" data-action="change-warmth" data-id="${pid}" aria-label="Change warmth, now ${esc(WARMTH_INFO[p.warmth].label)}">
          ${warmthBadge(p.warmth)}</button>`;
  const overdue = p.warmth !== 'parked' && !light && (stage === 'justMet' ? deadline < today : next < today);
  const sub = subLine(p, { link: true });
  const left = `
    <header class="person-head has-fig">
      <div class="person-side">
        <button type="button" class="person-fig" data-action="change-figure" data-id="${pid}" style="color: var(--w-${esc(p.warmth)})" aria-label="How they're drawn: ${esc(figureWords(figureOf(p)).toLowerCase())}. Change it">${figureSVG(figureOf(p), 'person-fig-pic', 170)}</button>
        ${onProject ? '' : warmthBtn}
      </div>
      <div class="person-name-line"><h1 class="person-name">${esc(p.name)}</h1>${dreamStar(p)}</div>
      ${sub ? `<p class="person-sub">${sub}</p>` : ''}
      <div class="person-badges">
        ${onProject ? `<span class="warmth-pair">${warmthBtn}<button type="button" class="warmth-btn" data-action="wrap-project" data-id="${pid}">
          <span class="dream-badge wrap-badge">${WRAP_ICON}<span>Wrap project</span></span></button></span>` : ''}
        <button type="button" class="warmth-btn" data-action="change-rel" data-id="${pid}" aria-label="Change relationship, now ${esc(relWords(p))}">
          <span class="rel-set">${relLabels(p)}</span></button>
        <button type="button" class="warmth-btn light-toggle${p.lightTouch ? ' is-on' : ''}" data-action="toggle-light" data-id="${pid}" aria-pressed="${p.lightTouch ? 'true' : 'false'}" aria-label="Light touch">
          ${lightBadge()}</button>
      </div>
      <div class="person-circles">${circleChips(p, { link: true })}
        <button type="button" class="circle-change" data-action="change-circles" data-id="${pid}">${circlesOf(p).length ? 'Change circles' : '+ Add to a circle'}</button></div>
      ${metLine(p)}
    </header>
    ${dreamOnly(p) ? `<section class="next-panel">
      <p class="next-label">On your dream list</p>
      <p class="next-date">No rhythm yet</p>
    </section>` : stage === 'justMet' ? `<section class="next-panel${overdue ? ' is-overdue' : ''}">
      <p class="next-label">Just met. Follow up by</p>
      <p class="next-date">${esc(fmtDate(deadline))}</p>
      <p class="next-rel">${overdue ? 'Follow-up is late' : esc(cap(relDay(deadline, today)))} <span class="dot">·</span> A quick note while it's fresh</p>
    </section>` : `<section class="next-panel${overdue ? ' is-overdue' : ''}">
      <p class="next-label">${esc(nextLabelText(p.warmth === 'parked' ? 'Comes back' : light ? 'Next light touch' : stage ? 'First touchpoint' : 'Next touchpoint', shownNext, today))}</p>
      <p class="next-date">${esc(fmtDate(shownNext))}</p>
      <div class="next-actions">
        <button type="button" class="btn on-ink" data-action="snooze" data-id="${pid}">Snooze</button>
        <button type="button" class="btn on-ink" data-action="change-date" data-id="${pid}">Change date</button>
      </div>
    </section>`}
    ${prompt}
    <button type="button" class="hero-cta log-cta" data-action="log" data-id="${pid}">Log touchpoint</button>
    ${p.warmth === 'parked' ? '' : ideaHTML(p)}
    ${personSections(p, tps, k)}`;

  // After Log touchpoint: news, loops and touchpoints, then who they are.
  // Two columns put those beside the rest; one column stacks them in order.
  // The small things about them come last, on their own, with no heading.
  const right = `
    ${sectionBlock(k('details'), 'Details', null, detailsHTML(p), 'navy')}
    ${sectionBlock(k('connections'), 'Connections', null, connectionsHTML(p), 'navy')}
    <div class="person-notes">${personalHTML(p)}</div>`;

  const top = panel
    ? `<div class="detail-top"><button type="button" class="back-btn pick-close" data-action="close-pick">${X_ICON_SMALL}Close</button>
      <span class="pick-links"><a class="text-btn" href="#/person/${pid}">Full page</a>
      <button type="button" class="text-btn" data-action="edit-person" data-id="${pid}">Edit</button></span></div>`
    : splitList('person')
    ? `<div class="detail-top split-top"><span class="pick-links"><button type="button" class="text-btn" data-action="edit-person" data-id="${pid}">Edit</button>
      <button type="button" class="back-btn pick-close split-close" data-action="close-person">${X_ICON_SMALL}Close</button></span></div>`
    : `<div class="detail-top">${backButton('#/people', 'Back')}
      <span class="pick-links"><button type="button" class="text-btn" data-action="edit-person" data-id="${pid}">Edit</button></span></div>`;
  return `
    ${top}
    <div class="detail-cols"><div class="detail-col">${left}</div><div class="detail-col">${right}</div></div>`;
}

// Contact fields, each added or changed in its own small sheet from the
// person page.
const CONTACT_FIELDS = [
  { key: 'email', label: 'Email', word: 'email', type: 'email', mode: 'email', placeholder: 'name@example.com' },
  { key: 'phone', label: 'Phone', word: 'phone number', type: 'tel', mode: 'tel', placeholder: '+1 212 555 0101' },
  { key: 'website', label: 'Website', word: 'website', type: 'text', mode: 'url', placeholder: 'example.com' },
];

// Their accounts (11-10): tick the ones they have and a box with an @
// opens for each handle. Saved on the person as instagram, facebook,
// linkedin and x ('' or missing when they have none).
const ACCOUNTS = [
  { key: 'instagram', label: 'Instagram', base: 'https://instagram.com/' },
  { key: 'facebook', label: 'Facebook', base: 'https://facebook.com/' },
  { key: 'linkedin', label: 'LinkedIn', base: 'https://linkedin.com/in/' },
  { key: 'x', label: 'X', base: 'https://x.com/' },
];
function accountUrl(a, v) {
  const s = String(v || '').trim();
  return looksLikeLink(s) ? normalizeUrl(s) : `${a.base}${s.replace(/^@/, '')}`;
}
function accountsFieldHTML(v) {
  const has = (a) => !!String(v[a.key] || '').trim();
  return `<fieldset class="field accounts-field"><legend class="field-label">Accounts</legend>
      <div class="account-checks">${ACCOUNTS.map((a) => `<label class="check"><input type="checkbox" data-account="${a.key}"${has(a) ? ' checked' : ''}> ${esc(a.label)}</label>`).join('')}</div>
      ${ACCOUNTS.map((a) => `<label class="field account-box" data-account-box="${a.key}"${has(a) ? '' : ' hidden'}><span class="field-label">${esc(a.label)}</span>
        <input name="${a.key}" value="${esc(atHandle(v[a.key]))}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="@handle" data-handle></label>`).join('')}
    </fieldset>`;
}
// Ticking an account opens its box with the @ in place, ready to type.
function wireAccounts(form) {
  form.addEventListener('change', (e) => {
    const key = e.target.dataset && e.target.dataset.account;
    if (!key) return;
    const box = form.querySelector(`[data-account-box="${key}"]`);
    box.hidden = !e.target.checked;
    if (!e.target.checked) return;
    const input = box.querySelector('input');
    if (!input.value.trim()) input.value = '@';
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}
// A box filled in by code (a paste) ticks its account.
function showFilledAccounts(form) {
  for (const a of ACCOUNTS) {
    const input = form.querySelector(`[name="${a.key}"]`);
    if (!input || !handleValue(input.value)) continue;
    form.querySelector(`[data-account="${a.key}"]`).checked = true;
    form.querySelector(`[data-account-box="${a.key}"]`).hidden = false;
  }
}
// What the form saves for each account: nothing when it's unticked.
function readAccounts(form) {
  const out = {};
  for (const a of ACCOUNTS) {
    const tick = form.querySelector(`[data-account="${a.key}"]`);
    const input = form.querySelector(`[name="${a.key}"]`);
    out[a.key] = tick && tick.checked && input ? handleValue(input.value) : '';
  }
  return out;
}

function accountsSheet(p) {
  if (!p) return;
  const s = openSheet({
    title: 'Accounts',
    className: 'sheet-small',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form" novalidate>
      ${accountsFieldHTML(p)}
      <button type="submit" class="modal-cta primary">Save</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  wireAccounts(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const acc = readAccounts(form);
    const changed = ACCOUNTS.some((a) => (acc[a.key] || '') !== (p[a.key] || ''));
    s.close();
    if (!changed) return;
    await db.savePerson({ ...p, ...acc });
    await refresh();
    toast('Accounts saved');
  });
}

// Account fields put the @ in front for you (a pasted link stays a link).
const looksLikeLink = (s) => /[/:]|instagram\.com|facebook\.com|linkedin\.com|^www\./i.test(s);
function atHandle(v) {
  const s = String(v || '').trim().replace(/^@+/, '@');
  return s && !s.startsWith('@') && !looksLikeLink(s) ? `@${s}` : s;
}
// What gets saved: a lone @ counts as nothing typed.
const handleValue = (v) => (atHandle(v) === '@' ? '' : atHandle(v));

function contactLink(p, key) {
  const v = p[key];
  if (key === 'email') return `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
  if (key === 'phone') return `<a href="tel:${esc(v.replace(/[^\d+]/g, ''))}">${esc(v)}</a>`;
  if (key === 'instagram') return `<a href="${esc(instagramUrl(v))}" target="_blank" rel="noopener">${esc(v.startsWith('@') || /instagram\.com/i.test(v) ? v : `@${v}`)}</a>`;
  return `<a href="${esc(normalizeUrl(v))}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\//, ''))}</a>`;
}

// What a person's details don't have yet (11-11): only filled-in details
// show, and one button adds any of these.
function missingDetails(p) {
  const out = [];
  for (const f of CONTACT_FIELDS) {
    if (!String(p[f.key] || '').trim()) out.push({ key: f.key, label: f.label, word: f.word });
    if (f.key === 'phone' && !ACCOUNTS.some((x) => String(p[x.key] || '').trim())) out.push({ key: 'accounts', label: 'Accounts', word: 'an account' });
  }
  if (!p.birthday) out.push({ key: 'birthday', label: 'Birthday', word: 'birthday' });
  return out;
}

function detailsHTML(p) {
  const rows = [];
  const row = (label, value) => rows.push(`<div class="detail-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`);
  for (const f of CONTACT_FIELDS) {
    const btn = (text) => `<button type="button" class="text-btn inline contact-edit" data-action="edit-contact" data-id="${esc(p.id)}" data-field="${f.key}">${text}</button>`;
    if ((p[f.key] || '').trim()) rows.push(`<div class="detail-row contact-row"><dt>${esc(f.label)}</dt><dd><span class="contact-value">${contactLink(p, f.key)}</span>${btn('Edit')}</dd></div>`);
    // Their accounts sit after the phone, all changed in one small sheet.
    if (f.key === 'phone') {
      const had = ACCOUNTS.filter((a) => String(p[a.key] || '').trim());
      const abtn = (text) => `<button type="button" class="text-btn inline contact-edit" data-action="edit-accounts" data-id="${esc(p.id)}">${text}</button>`;
      if (had.length) rows.push(`<div class="detail-row contact-row"><dt>Accounts</dt><dd><span class="contact-value account-list">${had.map((a) => `<span class="account-line"><span class="account-name">${esc(a.label)}</span> <a href="${esc(accountUrl(a, p[a.key]))}" target="_blank" rel="noopener">${esc(looksLikeLink(p[a.key]) ? p[a.key] : atHandle(p[a.key]))}</a></span>`).join('')}</span>${abtn('Edit')}</dd></div>`);
    }
  }
  // Birthday sits with the contact details, changed in its own small sheet.
  const bday = (text) => `<button type="button" class="text-btn inline contact-edit" data-action="edit-birthday" data-id="${esc(p.id)}">${text}</button>`;
  if (p.birthday) {
    const today = todayStr();
    const nextBday = nextYearly(`2000-${String(p.birthday.month).padStart(2, '0')}-${String(p.birthday.day).padStart(2, '0')}`, today);
    rows.push(`<div class="detail-row contact-row"><dt>Birthday</dt><dd><span class="contact-value">${esc(birthdayText(p.birthday))}<span class="pd-sub">${esc(nextBday === today ? 'Today' : cap(relDay(nextBday, today)))}</span></span>${bday('Edit')}</dd></div>`);
  }
  // How often, in plain words, changed in its own small sheet (11-10).
  rows.push(`<div class="detail-row contact-row"><dt>Rhythm</dt><dd><span class="contact-value">${esc(rhythmWords(p, S.settings))}</span><button type="button" class="text-btn inline contact-edit" data-action="edit-rhythm" data-id="${esc(p.id)}">Change</button></dd></div>`);
  if (p.notes) row('Notes', `<span class="pre">${esc(p.notes)}</span>`);
  if (p.pastOrganizations && p.pastOrganizations.length) {
    row('Previously', p.pastOrganizations
      .slice()
      .reverse()
      .map((o) => {
        const org = S.orgById.get(o.organizationId);
        const label = esc(org ? org.name : o.name || 'Unknown');
        return `${org ? `<a href="#/org/${esc(org.id)}">${label}</a>` : label}, until ${esc(fmtDate(o.until, { weekday: false, year: true }))}`;
      })
      .join('<br>'));
  }
  row('Added', esc(fmtTimestamp(p.createdAt)));
  const missing = missingDetails(p);
  const add = missing.length
    ? `<button type="button" class="text-btn" data-action="add-missing-detail" data-id="${esc(p.id)}">${esc(missing.length === 1 ? `+ Add ${missing[0].word}` : '+ Add more')}</button>`
    : '';
  return `<dl class="details">${rows.join('')}</dl>${add}`;
}

// Introductions, both ways: who introduced you and who they introduced you
// to; who they could introduce you to, and who could introduce you to them.
function connectionsHTML(p) {
  const link = (x) => `<a href="#/person/${esc(x.id)}">${esc(x.name)}</a>`;
  const rows = [];
  const row = (label, value) => rows.push(`<div class="detail-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`);
  const by = p.introducedById && S.personById.get(p.introducedById);
  if (by) row('Introduced by', link(by));
  else if (p.introducedByName) row('Introduced by', `${esc(p.introducedByName)} <span class="not-in">(not in Callback)</span>`);
  const introduced = S.people.filter((x) => x.introducedById === p.id);
  if (introduced.length) row('Introduced you to', introduced.map(link).join('<br>'));
  const could = (p.canIntroduceToIds || []).map((id) => S.personById.get(id)).filter(Boolean);
  if (could.length) row('Could introduce you to', could.map((x) => `${link(x)}${x.dreamList ? ` ${DREAM_STAR}` : ''}`).join('<br>'));
  const paths = pathsTo(p.id);
  if (paths.length) row('Paths to them', paths.map((c) => `<span class="path-inline">${link(c)} ${warmthBadge(c.warmth)}</span>`).join(''));
  return `${rows.length ? `<dl class="details">${rows.join('')}</dl>` : ''}
    <button type="button" class="text-btn" data-action="edit-person" data-id="${esc(p.id)}">Edit connections</button>`;
}

// A sheet for picking people. Resolves with an id (single), a list of ids
// (multiple), undefined for "No one", or null when closed. With `allowName`,
// the search box also takes a name that isn't in Callback: { name }.
function peoplePicker({ title, multiple = false, selected = [], exclude = [], allowName = false, typedName = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const chosen = new Set(selected);
    const list = S.people.filter((x) => !exclude.includes(x.id));
    const sub = (x) => subLine(x) || '';
    const s = openSheet({
      title,
      className: `sheet-wide${multiple ? ' has-footer' : ''}`,
      body: `
        ${list.length > 8 || allowName ? `<input type="search" class="search pick-search" data-q placeholder="${allowName ? 'Search, or type a name' : 'Search people'}" value="${esc(typedName)}" autocomplete="off" aria-label="${allowName ? 'Search people, or type a name' : 'Search people'}">` : ''}
        ${list.length || allowName ? '' : '<p class="hint">Add more people first, then link them here.</p>'}
        <div class="pick-list">
          ${allowName ? '<button type="button" class="pick-row pick-one pick-typed" data-typed hidden></button>' : ''}
          ${multiple ? '' : `<button type="button" class="pick-row pick-one" data-none><span class="pick-box" aria-hidden="true"></span><span class="pick-main"><span class="pick-name">No one</span></span></button>`}
          ${list.map((x) => multiple
            ? `<label class="pick-row" data-find="${esc(x.name.toLowerCase())}"><input type="checkbox" data-pid="${esc(x.id)}"${chosen.has(x.id) ? ' checked' : ''}><span class="pick-main"><span class="pick-name">${esc(x.name)}${x.dreamList ? ` ${DREAM_STAR}` : ''}</span>${sub(x) ? `<span class="pick-sub">${sub(x)}</span>` : ''}</span></label>`
            : `<button type="button" class="pick-row pick-one${chosen.has(x.id) ? ' is-current' : ''}" data-pid="${esc(x.id)}" data-find="${esc(x.name.toLowerCase())}"><span class="pick-main"><span class="pick-name">${esc(x.name)}</span>${sub(x) ? `<span class="pick-sub">${sub(x)}</span>` : ''}</span></button>`).join('')}
        </div>
        ${multiple ? '<div class="sheet-footer"><button type="button" class="modal-cta primary" data-done>Done</button></div>' : ''}`,
      onClose: () => resolve(result),
    });
    const typed = s.body.querySelector('[data-typed]');
    const filter = (raw) => {
      const q = raw.trim().toLowerCase();
      s.body.querySelectorAll('[data-find]').forEach((r) => { r.hidden = !!q && !r.dataset.find.includes(q); });
      if (!typed) return;
      // Offer the typed name itself unless it's exactly someone already here.
      const exact = list.some((x) => x.name.trim().toLowerCase() === q);
      typed.hidden = !q || exact;
      typed.innerHTML = `<span class="pick-main"><span class="pick-name">Use \u201c${esc(raw.trim())}\u201d</span><span class="pick-sub">Not in your Callback contacts</span></span>`;
    };
    if (typedName) filter(typedName);
    s.body.addEventListener('input', (e) => {
      if (e.target.matches('[data-q]')) filter(e.target.value);
    });
    s.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-q]') && typed && !typed.hidden) {
        e.preventDefault();
        typed.click();
      }
    });
    s.body.addEventListener('change', (e) => {
      const box = e.target.closest('[data-pid]');
      if (!box || !multiple) return;
      if (box.checked) chosen.add(box.dataset.pid);
      else chosen.delete(box.dataset.pid);
    });
    s.body.addEventListener('click', (e) => {
      if (multiple) {
        if (e.target.closest('[data-done]')) {
          result = [...chosen];
          s.close();
        }
        return;
      }
      if (e.target.closest('[data-none]')) {
        result = undefined;
        s.close();
        return;
      }
      if (e.target.closest('[data-typed]')) {
        result = { name: s.body.querySelector('[data-q]').value.trim() };
        s.close();
        return;
      }
      const b = e.target.closest('[data-pid]');
      if (b) {
        result = b.dataset.pid;
        s.close();
      }
    });
  });
}

function namesOf(ids) {
  return ids.map((id) => S.personById.get(id)).filter(Boolean).map((x) => x.name);
}

// The Dream List: people you'd love to work with someday, and the paths to
// them through people you already know. Warm paths first.
function renderDreams() {
  const rank = { client: 0, active: 0, warm: 0, cold: 1, parked: 2 };
  const best = (id) => Math.min(3, ...pathsTo(id).map((c) => rank[c.warmth] ?? 2));
  const dreams = S.people
    .filter((x) => x.dreamList)
    .map((x) => ({ x, best: best(x.id) }))
    .sort((a, b) => a.best - b.best || a.x.name.localeCompare(b.x.name));
  const card = ({ x }) => {
    const id = esc(x.id);
    const paths = pathsTo(x.id).sort((a, b) => (rank[a.warmth] ?? 2) - (rank[b.warmth] ?? 2));
    const sub = subLine(x);
    return `<article class="item-card dream-card">
      <a class="item-head" href="#/person/${id}">
        <span class="item-who"><span class="item-name">${esc(x.name)}</span>${sub ? `<span class="item-sub">${sub}</span>` : ''}</span>
        ${dreamBadge()}
      </a>
      ${dreamOnly(x) ? '' : `<p class="item-facts">${esc(sinceText(x))}</p>`}
      ${x.notes ? `<p class="dream-notes pre">${esc(x.notes)}</p>` : ''}
      ${paths.length
        ? `<div class="paths"><p class="paths-label">Paths</p>${paths.map((c) => `<a class="path-row" href="#/person/${esc(c.id)}">${warmthBadge(c.warmth)}<span><b>${esc(c.name)}</b> could introduce you</span></a>`).join('')}</div>`
        : promptBox('No path yet. How might you reach them? A mutual friend, an event you could both be at, their agent.',
          `<button type="button" class="btn primary" data-action="dream-notes" data-id="${id}">${x.notes ? 'Edit notes' : 'Add a note'}</button>`)}
    </article>`;
  };
  return `
    <div class="detail-top">${backButton('#/people', 'People')}</div>
    <header class="topbar"><h1>Dream list</h1>
      <button type="button" class="icon-btn" data-action="add-person" data-dream="1" aria-label="Add to dream list">+</button></header>
    <p class="hint">People you'd love to work with someday. They don't get reminders until you first reach out. When someone you know could introduce you, set it on their page under "Could introduce me to" and the path shows here.</p>
    ${dreams.length
      ? `<div class="card-list">${dreams.map(card).join('')}</div>`
      : `<div class="empty"><p class="empty-title">Nobody here yet.</p><p>Add the actors, performers and cultural figures you'd love to photograph. A name is enough to start.</p>
          <button type="button" class="hero-cta" data-action="add-person" data-dream="1">Add to dream list</button></div>`}`;
}

// Where you met them, at the top of their page above the next touchpoint
// (11-10), changed in its own small sheet. Someone on the dream list you
// haven't met yet doesn't get the line until there's something to show.
function metLine(p) {
  const met = (p.howWeMet || '').trim();
  if (!met && dreamOnly(p)) return '';
  const btn = `<button type="button" class="circle-change" data-action="edit-met" data-id="${esc(p.id)}">${met ? 'Change' : '+ Add where you met'}</button>`;
  return met
    ? `<p class="person-met"><span class="person-met-label">Where you met</span> <span class="pre">${esc(met)}</span> ${btn}</p>`
    : `<p class="person-met">${btn}</p>`;
}

function metSheet(p) {
  if (!p) return;
  const s = openSheet({
    title: `${(p.howWeMet || '').trim() ? 'Change' : 'Add'} where you met`,
    className: 'sheet-small',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form" novalidate>
      <label class="field"><span class="field-label">Where you met</span>
        <textarea name="value" rows="2" placeholder="Introduced by Sam at the Rialto screening">${esc(p.howWeMet || '')}</textarea></label>
      <button type="submit" class="modal-cta primary">Save</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await db.savePerson({ ...p, howWeMet: String(new FormData(form).get('value') || '').trim() });
    s.close();
    await refresh();
  });
}

function contactSheet(p, key) {
  const f = CONTACT_FIELDS.find((x) => x.key === key);
  if (!p || !f) return;
  const had = !!(p[key] || '').trim();
  const s = openSheet({
    title: `${had ? 'Change' : 'Add'} ${f.word}`,
    className: 'sheet-small',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form" novalidate>
      <label class="field"><span class="field-label">${esc(f.label)}</span>
        <input name="value" type="${f.type}" inputmode="${f.mode}" value="${esc(key === 'instagram' ? atHandle(p[key]) : p[key] || '')}" placeholder="${esc(f.placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false"${key === 'instagram' ? ' autocorrect="off" data-handle' : ''}></label>
      <p class="field-error" data-error="value" hidden></p>
      ${had ? `<button type="button" class="btn danger wide" data-delete>Remove ${esc(f.word)}</button>` : ''}
      <button type="submit" class="modal-cta primary">Save</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  const error = form.querySelector('[data-error="value"]');
  const save = async (value) => {
    await db.savePerson({ ...p, [key]: value });
    s.close();
    await refresh();
    toast(value ? `${f.label} saved` : `${f.label} removed`);
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let value = String(new FormData(form).get('value') || '').trim();
    if (key === 'instagram') value = handleValue(value);
    if (!value) {
      if (had) await save('');
      else s.close();
      return;
    }
    if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      error.textContent = "That doesn't look like an email address.";
      error.hidden = false;
      return;
    }
    if (key === 'phone' && (value.match(/\d/g) || []).length < 5) {
      error.textContent = 'That looks too short for a phone number.';
      error.hidden = false;
      return;
    }
    await save(value);
  });
  const del = s.body.querySelector('[data-delete]');
  if (del) del.addEventListener('click', () => save(''));
}

function notesSheet(p) {
  if (!p) return;
  const s = openSheet({
    title: `Notes on ${firstName(p)}`,
    className: 'sheet-small',
    body: `<form class="form">
      <label class="field"><span class="field-label">How might you reach them?</span>
        <textarea name="notes" rows="5" placeholder="Sam knows her agent. She's at the Rialto festival in March.">${esc(p.notes || '')}</textarea></label>
      <button type="submit" class="modal-cta primary">Save notes</button>
    </form>`,
  });
  s.body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await db.savePerson({ ...p, notes: String(new FormData(e.target).get('notes') || '').trim() });
    s.close();
    await refresh();
    toast('Notes saved');
  });
}

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' }));
const DETAIL_LABELS = ['From', 'Partner', 'Pet', 'Loves', 'Avoids', 'Coffee order', 'Current project'];

function birthdayText(b) {
  return `${MONTHS[b.month - 1]} ${b.day}${b.year ? `, ${b.year}` : ''}`;
}

// Personal: birthday and free-form details, as label and value rows. Values
// and labels edit in place; the birthday opens its own sheet.
function personalHTML(p) {
  const pid = esc(p.id);
  const details = p.details || [];
  return `
    <div class="pd-list">
      ${details.map((d) => `<div class="pd-row">
        <input class="pd-label" value="${esc(d.label)}" data-detail-field="label" data-person="${pid}" data-id="${esc(d.id)}" aria-label="Label" autocomplete="off">
        <textarea class="pd-value" rows="1" data-detail-field="value" data-person="${pid}" data-id="${esc(d.id)}" aria-label="${esc(d.label || 'Detail')}">${esc(d.value)}</textarea>
        <button type="button" class="pd-remove" data-action="remove-detail" data-person="${pid}" data-id="${esc(d.id)}" aria-label="Remove ${esc(d.label || 'detail')}">${X_ICON_SMALL}</button>
      </div>`).join('')}
    </div>
    <button type="button" class="primary small-btn" data-action="add-detail" data-id="${pid}">+ Add detail</button>`;
}

// In-place detail values wrap onto as many lines as they need.
function fitHeight(el) {
  el.style.height = 'auto';
  // A collapsed section measures 0; leave it at one line until it opens.
  if (el.scrollHeight) el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  else el.style.height = '';
}

// Saves a person without redrawing, for edits made in place.
async function savePersonQuietly(p) {
  const saved = await db.savePerson(p);
  S.people = S.people.map((x) => (x.id === saved.id ? saved : x));
  S.personById.set(saved.id, saved);
  return saved;
}

// A birthday lives on the person and as a yearly "Birthday" news item, so it
// shows on Today and in the calendar like any other date.
async function syncBirthdayNews(p) {
  const existing = newsOf(p.id).find((n) => n.source === 'birthday');
  if (!p.birthday) {
    if (existing) await db.deleteNews(existing.id);
    return;
  }
  const { month, day, year } = p.birthday;
  // The year only anchors the date; 2000 is a leap year, so February 29 works.
  const date = `${year || 2000}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (existing && existing.date === date && existing.repeatsYearly && existing.description === 'Birthday') return;
  await db.saveNews({ ...(existing || {}), personId: p.id, source: 'birthday', description: 'Birthday', date, repeatsYearly: true });
}

// The person's own rhythm (11-10): a preset, a number of days, or the
// default for their warmth or light touch. Stored as cadenceOverrideDays.
// The default option says what the default is, short enough for a phone
// ("Every 6 weeks (default)"); the person form calls the field
// Touchpoints.
const rhythmDefaultText = (p) => rhythmWords({ ...p, cadenceOverrideDays: null }, S.settings)
  .replace(/ \([^()]*default\)$/, ' (default)')
  .replace(/^The cold sequence/, 'Cold sequence');
function rhythmPickerHTML(p, label = 'Rhythm') {
  const n = p && Number(p.cadenceOverrideDays) > 0 ? Math.round(Number(p.cadenceOverrideDays)) : 0;
  const pick = !n ? 'default' : RHYTHM_PRESETS.some((r) => r.days === n) ? String(n) : 'custom';
  return `<label class="field"><span class="field-label">${esc(label)}</span>
      <select name="rhythm" data-rhythm>
        ${RHYTHM_PRESETS.map((r) => `<option value="${r.days}"${pick === String(r.days) ? ' selected' : ''}>${esc(r.label)} (${r.days} days)</option>`).join('')}
        <option value="custom"${pick === 'custom' ? ' selected' : ''}>Custom</option>
        <option value="default"${pick === 'default' ? ' selected' : ''}>${esc(rhythmDefaultText(p || {}))}</option>
      </select></label>
    <label class="field rhythm-days"${pick === 'custom' ? '' : ' hidden'}><span class="field-label">Days</span>
      <input name="override" type="number" min="1" max="3650" inputmode="numeric" value="${pick === 'custom' ? n : ''}" placeholder="45"></label>
    <p class="field-error" data-error="rhythm" hidden>Type how many days, from 1 to 3650.</p>`;
}

function wireRhythm(form) {
  const sel = form.querySelector('[data-rhythm]');
  const days = form.querySelector('.rhythm-days');
  if (!sel || !days) return;
  sel.addEventListener('change', () => {
    days.hidden = sel.value !== 'custom';
    form.querySelector('[data-error="rhythm"]').hidden = true;
    if (!days.hidden) days.querySelector('input').focus();
  });
}

// The days picked: a number, null for the default, or undefined (with the
// error showing) when Custom has no sensible number.
function readRhythm(form) {
  const sel = form.querySelector('[data-rhythm]');
  if (!sel || sel.value === 'default') return null;
  if (sel.value !== 'custom') return Number(sel.value);
  const input = form.querySelector('[name="override"]');
  const n = parseInt(input.value, 10);
  if (n >= 1 && n <= 3650) return n;
  const more = form.querySelector('details');
  if (more && more.contains(sel)) more.open = true;
  form.querySelector('[data-error="rhythm"]').hidden = false;
  input.focus();
  return undefined;
}

function rhythmSheet(p) {
  if (!p) return;
  const s = openSheet({
    title: `How often for ${firstName(p)}?`,
    className: 'sheet-small',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form" novalidate>
      ${rhythmPickerHTML(p)}
      <button type="submit" class="modal-cta primary">Save</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  wireRhythm(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = readRhythm(form);
    if (n === undefined) return;
    const rec = { ...p, cadenceOverrideDays: n };
    if ((n || null) !== (p.cadenceOverrideDays || null)) rec.nextTouchpointDate = computeNextDate(rec, tpsOf(p.id), S.settings, todayStr());
    await db.savePerson(rec);
    s.close();
    await refresh();
    toast(`Rhythm: ${rhythmWords(rec, S.settings)}`);
  });
}

function birthdaySheet(p) {
  if (!p) return;
  const b = p.birthday || { month: 1, day: 1, year: null };
  const s = openSheet({
    title: `${firstName(p)}'s birthday`,
    className: 'sheet-small',
    body: `<form class="form" novalidate>
      <div class="bday-grid">
        <label class="field"><span class="field-label">Month</span>
          <select name="month">${MONTHS.map((m, i) => `<option value="${i + 1}"${b.month === i + 1 ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Day</span>
          <select name="day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${b.day === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Year</span>
          <input name="year" type="number" inputmode="numeric" min="1900" max="2100" value="${esc(b.year || '')}" aria-label="Year (optional)"></label>
      </div>
      <p class="field-error" data-error="day" hidden>That month doesn't have that many days.</p>
      ${p.birthday ? '<button type="button" class="btn danger wide" data-delete>Remove birthday</button>' : ''}
      <button type="submit" class="modal-cta primary">Save birthday</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const month = Number(fd.get('month'));
    const day = Number(fd.get('day'));
    const yearRaw = Number(fd.get('year'));
    const year = yearRaw >= 1900 && yearRaw <= 2100 ? Math.round(yearRaw) : null;
    if (day > new Date(year || 2000, month, 0).getDate()) {
      form.querySelector('[data-error="day"]').hidden = false;
      return;
    }
    const saved = await db.savePerson({ ...p, birthday: { month, day, year } });
    await syncBirthdayNews(saved);
    s.close();
    await refresh();
    toast('Birthday saved');
  });
  const del = s.body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      const saved = await db.savePerson({ ...p, birthday: null });
      await syncBirthdayNews(saved);
      s.close();
      await refresh();
      toast('Birthday removed');
    });
  }
}

function detailSheet(p) {
  if (!p) return;
  const s = openSheet({
    title: 'Add a detail',
    className: 'sheet-small',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form" novalidate>
      <div class="field"><span class="field-label">Pick a label, or type your own</span>
        <div class="chip-choices">${DETAIL_LABELS.map((l) => `<button type="button" class="chip" data-label="${esc(l)}">${esc(l)}</button>`).join('')}</div></div>
      <label class="field"><span class="field-label">Label</span><input name="label" maxlength="40" autocomplete="off" placeholder="Pet"></label>
      <label class="field"><span class="field-label">Detail</span><input name="value" maxlength="200" autocomplete="off" placeholder="A greyhound called Biscuit"></label>
      <p class="field-error" data-error="value" hidden>Add the detail itself.</p>
      <button type="submit" class="modal-cta primary">Add detail</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-label]');
    if (!chip) return;
    form.querySelectorAll('[data-label]').forEach((c) => c.classList.toggle('active', c === chip));
    form.querySelector('[name="label"]').value = chip.dataset.label;
    form.querySelector('[name="value"]').focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const label = String(fd.get('label') || '').trim();
    const value = String(fd.get('value') || '').trim();
    if (!value) {
      form.querySelector('[data-error="value"]').hidden = false;
      return;
    }
    await db.savePerson({ ...p, details: [...(p.details || []), { id: uuid(), label: label || 'Note', value }] });
    s.close();
    await refresh();
    toast('Detail added');
  });
}

function newsListHTML(p) {
  const today = todayStr();
  const list = newsOf(p.id).map((n) => (n.repeatsYearly ? { ...n, date: nextYearly(n.date, today) } : n));
  const upcoming = list.filter((n) => n.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = list.filter((n) => n.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const item = (n) => `<button type="button" class="news-item${n.date < today ? ' is-past' : ''}" data-action="${n.source === 'birthday' ? 'edit-birthday' : 'edit-news'}" data-id="${esc(n.source === 'birthday' ? p.id : n.id)}">
      <span class="news-item-date">${esc(fmtDate(n.date, { weekday: false }))}</span>
      <span class="news-item-text">${esc(n.description)}${n.repeatsYearly ? ' <span class="yearly-tag">Every year</span>' : ''}</span>
      <span class="news-item-rel">${esc(n.date === today ? 'Today' : cap(relDay(n.date, today)))}</span>
    </button>`;
  return `
    ${upcoming.map(item).join('')}${past.map(item).join('')}
    <button type="button" class="primary small-btn" data-action="add-news" data-id="${esc(p.id)}">+ Add a date</button>`;
}

function loopRow(l, today) {
  const closed = l.status === 'closed';
  let when = '';
  const shut = isLetGo(l) ? 'Let go' : 'Done';
  if (closed) when = l.closedAt ? `${shut} ${fmtDate(toDateStr(new Date(l.closedAt)), { weekday: false })}` : shut;
  else if (l.dueDate) {
    const n = daysBetween(l.dueDate, today);
    const lead = l.direction === 'theyOwe' ? 'Expected' : 'Due';
    when = n === 0 ? `${lead} today` : `${lead} ${fmtDate(l.dueDate, { weekday: false })}, ${relDay(l.dueDate, today)}`;
  }
  const late = !closed && l.dueDate && l.dueDate < today;
  return `<li class="loop${late ? ' is-late' : ''}">
    <input type="checkbox" class="loop-box" data-loop-toggle="${esc(l.id)}"${closed ? ' checked' : ''} aria-label="${closed ? 'Reopen' : 'Done'}: ${esc(l.description)}">
    <button type="button" class="loop-text" data-action="edit-loop" data-id="${esc(l.id)}">
      <span class="loop-desc-text">${esc(l.description)}</span>
      ${when ? `<span class="loop-when">${esc(when)}</span>` : ''}
    </button>
  </li>`;
}

// Open loops on the person page: on your side and on their side, with the
// closed ones folded away under Done.
// Open loops, their news and touchpoints on someone's page (11-10): the
// ones with something in them come first, in this order, then the empty
// ones, in the same order. The heading colours keep alternating down the
// page.
function personSections(p, tps, k) {
  const list = [
    { key: 'loops', title: 'Open loops', n: openLoopsOf(p.id).length, html: () => loopsHTML(p) },
    { key: 'news', title: 'Their news', n: newsOf(p.id).length, html: () => newsListHTML(p) },
    { key: 'timeline', title: 'Touchpoints', n: tps.length, html: () => timelineHTML(p, tps) },
  ];
  const ordered = [...list.filter((x) => x.n), ...list.filter((x) => !x.n)];
  return ordered.map((x, i) => sectionBlock(k(x.key), x.title, x.n, x.html(), i % 2 ? 'navy' : 'yellow')).join('\n');
}

function loopsHTML(p) {
  const today = todayStr();
  const all = loopsOf(p.id);
  const open = all.filter((l) => l.status !== 'closed');
  const done = all.filter((l) => l.status === 'closed').sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt);
  const group = (dir) => {
    const list = open.filter((l) => l.direction === dir.key).sort(byDue);
    if (!list.length) return '';
    return `<div class="loop-group">
      <p class="loop-group-title">${loopIcon(dir.key)}${esc(dir.label)}</p>
      <ul class="loop-list">${list.map((l) => loopRow(l, today)).join('')}</ul>
    </div>`;
  };
  return `
    ${LOOP_DIRECTIONS.map(group).join('')}
    <button type="button" class="primary small-btn" data-action="add-loop" data-id="${esc(p.id)}">+ Add loop</button>
    ${done.length ? `<details class="loop-done"><summary>Done (${done.length})</summary><ul class="loop-list">${done.map((l) => loopRow(l, today)).join('')}</ul></details>` : ''}`;
}

function loopSheet(p, l = null, { focusDate = false } = {}) {
  if (!p) return;
  const v = l || { direction: 'iOwe', description: '', dueDate: '' };
  const s = openSheet({
    title: l ? 'Edit loop' : 'Add a loop',
    className: 'sheet-small',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form" novalidate>
      <label class="field"><span class="field-label">What's the promise?</span>
        <input name="description" value="${esc(v.description)}" maxlength="140" autocomplete="off" placeholder="Send a print of the window frame" required></label>
      <p class="field-error" data-error="description" hidden>Say what was promised.</p>
      <fieldset class="field"><legend class="field-label">Whose side is it on?</legend>
        <div class="seg">${LOOP_DIRECTIONS.map((d) => `<label class="seg-option"><input type="radio" name="direction" value="${d.key}"${v.direction === d.key ? ' checked' : ''}><span>${esc(d.label)}</span></label>`).join('')}</div>
      </fieldset>
      <label class="field"><span class="field-label">By when? (optional)</span>
        <input type="date" name="dueDate" value="${esc(v.dueDate || '')}">
</label>
      ${l && l.status !== 'closed' ? '<button type="button" class="btn secondary wide" data-let-go>Let it go</button>' : ''}
      ${l ? '<button type="button" class="btn danger wide" data-delete>Delete loop</button>' : ''}
      <button type="submit" class="modal-cta primary">${l ? 'Save' : 'Add loop'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  if (focusDate) {
    const d = form.querySelector('[name="dueDate"]');
    d.focus();
    try { d.showPicker(); } catch { /* not everywhere */ }
  }
  const go = s.body.querySelector('[data-let-go]');
  if (go) {
    go.addEventListener('click', async () => {
      s.close();
      await letGoLoop(l);
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const description = String(fd.get('description') || '').trim();
    if (!description) {
      form.querySelector('[data-error="description"]').hidden = false;
      return;
    }
    const due = String(fd.get('dueDate') || '');
    await db.saveOpenLoop({
      status: 'open',
      closedAt: null,
      ...(l || {}),
      personId: p.id,
      direction: String(fd.get('direction') || 'iOwe'),
      description,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    });
    // Something real is in motion, so a light touch becomes a full contact.
    const fresh = S.personById.get(p.id);
    const endsLight = !l && fresh && fresh.lightTouch;
    if (endsLight) await db.savePerson({ ...fresh, ...lightOffFields(fresh, tpsOf(p.id), S.settings, todayStr()) });
    s.close();
    await refresh();
    toast(l ? 'Saved' : endsLight ? `Loop added. ${firstName(p)} is off light touch now, since something real is in motion.` : 'Loop added');
  });
  const del = s.body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      await db.deleteOpenLoop(l.id);
      s.close();
      await refresh();
      toast('Loop deleted');
    });
  }
}

// Done on a promise. Yours opens Promise kept, to log how it got to them in
// one go; theirs (Got it) just closes.
async function closeLoop(l) {
  if (!l || l.status === 'closed') return;
  const p = S.personById.get(l.personId);
  if (l.direction === 'iOwe' && p) {
    // Closed without saving, a ticked box goes back to how it was.
    logSheet(p, { keep: l, onClose: () => render() });
    return;
  }
  await db.saveOpenLoop({ ...l, status: 'closed', closedAt: nowISO(), outcome: 'kept', keptBy: null });
  await refresh();
  toast('Loop closed', { action: { label: 'Undo', run: () => reopenLoop(S.loops.find((x) => x.id === l.id), { quiet: true }) } });
}

// ---------------------------------------------------------------------------
// Wrap project (11-10)
//
// The end of a project is one of the best times to follow up, and plain
// Warm would wait six weeks. Wrapping logs a Project wrapped touchpoint,
// moves them to Warm, can add Past client, promises the selects or a
// thank-you, and holds a check-in date in place of the rhythm until the
// next touchpoint (postProjectCheckIn).
const WRAP_THANKS_DAYS = 3;
const WRAP_CHECK_IN_DAYS = 21;

const wrapThanksText = (name) => `Send selects or a thank-you for ${name || 'the project'}`;

// The check-in's idea. Lukewarm contacts only get the check-in, never the ask.
function afterProjectIdea(p) {
  const base = 'Check in on how the images landed.';
  return p.interest === 'lukewarm' ? base : `${base} If it went well, it's a good moment to ask for a testimonial or referral.`;
}

// The most recent Project wrapped touchpoint for someone, if any.
const lastWrap = (tps) => tps.find((t) => t.type === 'project_wrapped') || null;

function wrapSheet(p) {
  if (!p) return;
  const today = todayStr();
  const s = openSheet({
    title: 'Wrap the project',
    className: 'sheet-small',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form wrap-form" novalidate>
      <label class="field"><span class="field-label">Project name (optional)</span>
        <input name="project" maxlength="80" autocomplete="off" placeholder="Smile Swim brand shoot"></label>
      <label class="field"><span class="field-label">Wrap date</span>
        <input type="date" name="wrapDate" value="${today}" required></label>
      <div class="field wrap-opt">
        <label class="check"><input type="checkbox" name="paid" checked> They paid you for this</label>
      </div>
      <div class="field wrap-opt">
        <label class="check"><input type="checkbox" name="thanks" checked data-opt="thanksDate"> Send selects or a thank-you</label>
        <label class="wrap-date"><span class="field-hint">Due</span><input type="date" name="thanksDate" value="${addDays(today, WRAP_THANKS_DAYS)}"></label>
      </div>
      <div class="field wrap-opt">
        <label class="check"><input type="checkbox" name="checkIn" checked data-opt="checkInDate"> Check in afterward</label>
        <label class="wrap-date"><span class="field-hint">On</span><input type="date" name="checkInDate" value="${addDays(today, WRAP_CHECK_IN_DAYS)}"></label>
      </div>
      <button type="submit" class="modal-cta primary">Wrap it up</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  const field = (n) => form.querySelector(`[name="${n}"]`);
  // The two dates follow the wrap date until you change one yourself.
  const touched = new Set();
  ['thanksDate', 'checkInDate'].forEach((n) => field(n).addEventListener('input', () => touched.add(n)));
  field('wrapDate').addEventListener('change', () => {
    const d = field('wrapDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    if (!touched.has('thanksDate')) field('thanksDate').value = addDays(d, WRAP_THANKS_DAYS);
    if (!touched.has('checkInDate')) field('checkInDate').value = addDays(d, WRAP_CHECK_IN_DAYS);
  });
  // A switched-off option's date goes quiet.
  form.querySelectorAll('[data-opt]').forEach((box) => {
    const sync = () => {
      const row = field(box.dataset.opt).closest('.wrap-date');
      row.classList.toggle('is-off', !box.checked);
      field(box.dataset.opt).disabled = !box.checked;
    };
    box.addEventListener('change', sync);
    sync();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const day = (n, fallback) => (/^\d{4}-\d{2}-\d{2}$/.test(field(n).value) ? field(n).value : fallback);
    const wrapDate = day('wrapDate', today);
    const name = field('project').value.replace(/\s+/g, ' ').trim();
    const opts = {
      name,
      wrapDate,
      paid: field('paid').checked,
      thanks: field('thanks').checked ? day('thanksDate', addDays(wrapDate, WRAP_THANKS_DAYS)) : null,
      checkIn: field('checkIn').checked ? day('checkInDate', addDays(wrapDate, WRAP_CHECK_IN_DAYS)) : null,
    };
    s.close();
    await wrapProject(p, opts);
  });
}

async function wrapProject(p, { name, wrapDate, paid, thanks, checkIn }) {
  const today = todayStr();
  const before = { ...p };
  // 1. The touchpoint: Project wrapped, on the wrap date, the name as its note.
  //    A wrap is contact both ways, so it isn't waiting on a reply.
  const tp = await db.saveTouchpoint({
    personId: p.id,
    type: 'project_wrapped',
    date: wrapDate,
    note: name,
    responded: 'yes',
    respondedAt: replyISO(wrapDate, today),
    interest: null,
    lightTouch: false,
  });
  // 2-5. Warm, Past client if paid, the check-in, light touch off.
  const rec = { ...p, ...(p.warmth === 'warm' ? {} : warmthChangeFields(p, 'warm', nowISO(), today)), lightTouch: false };
  if (paid && !relTypesOf(p).includes('pastClient')) Object.assign(rec, relFields([...relTypesOf(p), 'pastClient']));
  rec.postProjectCheckIn = checkIn ? { date: checkIn, projectName: name } : null;
  const all = sortTouchpoints([...tpsOf(p.id), tp]);
  rec.nextTouchpointDate = computeNextDate(rec, all, S.settings, today);
  await db.savePerson(rec);
  // 3. The selects or thank-you, as a promise on your side.
  const loop = thanks
    ? await db.saveOpenLoop({ personId: p.id, touchpointId: tp.id, direction: 'iOwe', description: wrapThanksText(name), dueDate: thanks, status: 'open', closedAt: null })
    : null;
  db.askToPersist();
  await refresh();
  const first = firstName(p);
  toast(checkIn ? `Project wrapped. Check in with ${first} on ${fmtDate(checkIn)}.` : `Project wrapped. ${first} is back to Warm.`, {
    ms: 5000,
    action: {
      label: 'Undo',
      run: async () => {
        await db.deleteTouchpoint(tp.id);
        if (loop) await db.deleteOpenLoop(loop.id);
        await db.savePerson({ ...S.personById.get(p.id), ...before });
        await refresh();
      },
    },
  });
}

async function letGoLoop(l) {
  if (!l || l.status === 'closed') return;
  await db.saveOpenLoop({ ...l, status: 'closed', closedAt: nowISO(), outcome: 'letGo', keptBy: null });
  await refresh();
  toast('Let go', { action: { label: 'Undo', run: () => reopenLoop(S.loops.find((x) => x.id === l.id), { quiet: true }) } });
}

async function reopenLoop(l, { quiet = false } = {}) {
  if (!l) return;
  await db.saveOpenLoop({ ...l, ...OPEN_AGAIN });
  await refresh();
  if (quiet) return;
  toast(l.direction === 'iOwe' ? 'The promise is open again' : 'Loop reopened', { action: { label: 'Undo', run: async () => { await db.saveOpenLoop(l); await refresh(); } } });
}

// Not yet, on a promise that's due: more time, a word that it's late, or let
// it go.
async function notYetSheet(l) {
  const p = l && S.personById.get(l.personId);
  if (!p) return;
  const mine = l.direction === 'iOwe';
  const first = firstName(p);
  const today = todayStr();
  const week = addDays([today, l.dueDate || today].sort().pop(), 7);
  const key = await choiceSheet({
    title: 'Not yet?',
    extra: `<p class="sheet-person">${esc(p.name)}</p><p class="keep-quote">${esc(l.description)}</p>`,
    options: [
      { key: 'week', label: 'Give it another week', detail: `${mine ? 'Due' : 'Expected'} ${fmtDate(week)} instead.` },
      { key: 'date', label: 'Pick a new date', detail: 'For when you know.' },
      mine
        ? { key: 'late', label: `Tell ${first} it's running late`, detail: 'Logs that you let them know, and gives it another week.' }
        : { key: 'nudge', label: `Nudge ${first}`, detail: 'Logs a follow-up, and gives it another week.' },
      { key: 'go', label: 'Let it go', detail: 'Off your list, filed under Done as let go. Nothing logged.' },
    ],
  });
  const fresh = S.loops.find((x) => x.id === l.id);
  if (!key || !fresh || fresh.status === 'closed') return;
  const moveOn = async () => {
    const cur = S.loops.find((x) => x.id === l.id) || fresh;
    await db.saveOpenLoop({ ...cur, dueDate: week });
  };
  if (key === 'week') {
    await moveOn();
    await refresh();
    toast(`${mine ? 'Due' : 'Expected'} ${fmtDate(week)} now`, { action: { label: 'Undo', run: async () => { await db.saveOpenLoop(fresh); await refresh(); } } });
  } else if (key === 'date') {
    loopSheet(p, fresh, { focusDate: true });
  } else if (key === 'late') {
    logSheet(p, { note: `Let them know it's running late: ${midSentence(fresh.description)}`, onSave: moveOn });
  } else if (key === 'nudge') {
    logSheet(p, { note: `Followed up about: ${midSentence(fresh.description)}`, onSave: moveOn });
  } else if (key === 'go') {
    await letGoLoop(fresh);
  }
}

// What a promise reads as on the timeline, by where it stands.
function promiseWord(l) {
  if (l.status !== 'closed') return l.direction === 'iOwe' ? 'You promised:' : 'They promised:';
  if (isLetGo(l)) return 'Let go:';
  return l.direction === 'iOwe' ? 'Promise kept:' : 'They came through:';
}

// Under a touchpoint: the promise it kept, its note, and the promise made with
// it, ticked once it's kept. Untick it and the promise is open again.
function tlPromise(t) {
  const k = keptLoopOf(t);
  const m = tpLoop(t);
  const shut = m && m.status === 'closed';
  return `${k ? `<p class="tl-kept">${CHECK}<span><b>Kept the promise:</b> ${esc(k.description)}</span></p>` : ''}
    ${t.note ? `<p class="tl-note">${esc(t.note)}</p>` : ''}
    ${m ? `<label class="tl-promise${shut ? ' is-shut' : ''}"><input type="checkbox" class="loop-box" data-loop-toggle="${esc(m.id)}"${shut ? ' checked' : ''} aria-label="${shut ? 'Open again' : m.direction === 'iOwe' ? 'Promise kept' : 'Got it'}: ${esc(m.description)}"><span><b>${esc(promiseWord(m))}</b> ${esc(m.description)}</span></label>` : ''}`;
}

function timelineHTML(p, tps) {
  if (!tps.length) {
    return '<p class="hint">No touchpoints yet.</p>';
  }
  return `<ol class="timeline">${tps
    .map(
      (t) => `<li class="tl-item${t.type === 'project_wrapped' ? ' is-wrap' : ''}" data-id="${esc(t.id)}">
        ${t.type === 'project_wrapped' ? `<span class="tl-node tl-wrap" aria-hidden="true">${WRAP_ICON}</span>` : '<span class="tl-node" aria-hidden="true"></span>'}
        <div class="tl-body">
          <p class="tl-head"><span class="tl-date">${esc(fmtDate(t.date))}</span><span class="tl-type">${esc(touchTypeLabel(t.type))}</span>${t.interest ? interestLabel(t.interest) : ''}</p>
          ${tlPromise(t)}
          <div class="tl-foot">
            ${t.type === 'project_wrapped' ? '' : `<button type="button" class="resp resp-${esc(t.responded || 'pending')}" data-action="set-response" data-id="${esc(t.id)}" aria-label="Reply status: ${esc(respondedLabel(t.responded))}. Change">${esc(respondedLabel(t.responded))}</button>`}
            <button type="button" class="text-btn" data-action="edit-tp" data-id="${esc(t.id)}">Edit</button>
          </div>
        </div>
      </li>`
    )
    .join('')}</ol>`;
}

// ---------------------------------------------------------------------------
// Organizations

function renderOrgs(id) {
  const hand = S.orgs.length > 0;
  const map = hand && S.ui.orgsView !== 'list';
  if (map && id && S.orgById.has(id)) return orgInside(S.orgById.get(id));
  const q = S.ui.orgsQ.trim().toLowerCase();
  const counts = groupBy(S.people.filter((p) => p.organizationId), 'organizationId');
  const list = S.orgs.filter((o) => !q || [o.name, o.notes, orgTypeLabel(o.type)].some((v) => v && v.toLowerCase().includes(q)));
  let body;
  if (!S.orgs.length) {
    body = `<div class="empty">
      <p class="empty-title">No organizations yet.</p>
      <p>Organizations group people by where they work: agencies, brands, publications, studios. Type one on a person and it's added here for you, or add one now.</p>
      <button type="button" class="hero-cta" data-action="add-org">Add an organization</button>
    </div>`;
  } else if (!list.length) {
    body = '<div class="empty"><p>No organizations match that.</p></div>';
  } else {
    body = list
      .map((o) => {
        const n = (counts.get(o.id) || []).length;
        return `<a class="row-card" href="#/org/${esc(o.id)}">
          <span class="row-main"><span class="row-name">${esc(o.name)}</span>
          <span class="row-meta">${esc(orgTypeLabel(o.type))} <span class="dot">·</span> ${plural(n, 'person', 'people')}</span></span>
        </a>`;
      })
      .join('');
  }
  if (hand) {
    return `
    <header class="topbar"><h1>Organizations</h1></header>
    <div class="people-hand">
      <div class="hand-row">
        <button type="button" class="hand-btn" data-action="add-org"><span class="hand-btn-text">+ Add organization</span>${statScrib('Add organization')}</button>
        ${listButton('orgs-view', !map)}
      </div>
      <label class="hand-search"><span class="visually-hidden">Search organizations</span>
        <input type="search" id="orgSearch" placeholder="Search organizations" value="${esc(S.ui.orgsQ)}" autocomplete="off" enterkeyhint="search">${HAND_RULE}
        <button type="button" class="search-clear" data-action="clear-search" data-for="orgSearch" aria-label="Clear search, show every organization"${S.ui.orgsQ ? '' : ' hidden'}><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 2.4c2.6 2.4 5.2 5.2 7.8 8M10 2.1C7.6 4.8 4.9 7.5 2 10.4"/></svg></button></label>
    </div>
    ${map && list.length ? mapHTML('orgs', list) : `<div class="card-list" id="orgList">${body}</div>`}`;
  }
  return `
    <header class="topbar"><h1>Organizations</h1>
      <button type="button" class="icon-btn" data-action="add-org" aria-label="Add organization">+</button></header>
    ${S.orgs.length ? `<input type="search" class="search" id="orgSearch" placeholder="Search organizations" value="${esc(S.ui.orgsQ)}" autocomplete="off" aria-label="Search organizations">` : ''}
    <div class="card-list" id="orgList">${body}</div>`;
}

function renderOrg(id) {
  const o = S.orgById.get(id);
  if (!o) return notFoundHTML('organization', '#/orgs', 'Organizations');
  const current = S.people.filter((p) => p.organizationId === id);
  const past = S.people.filter((p) => p.organizationId !== id && (p.pastOrganizations || []).some((x) => x.organizationId === id));
  const oid = esc(o.id);
  return `
    <div class="detail-top">${backButton('#/orgs', 'Back')}
      <button type="button" class="text-btn" data-action="edit-org" data-id="${oid}">Edit</button></div>
    <header class="person-head">
      <h1 class="person-name">${esc(o.name)}</h1>
      <p class="person-sub">${esc(orgTypeLabel(o.type))}${o.website ? ` <span class="dot">·</span> <a href="${esc(normalizeUrl(o.website))}" target="_blank" rel="noopener">${esc(o.website.replace(/^https?:\/\//, ''))}</a>` : ''}</p>
    </header>
    ${o.notes ? `<p class="org-notes pre">${esc(o.notes)}</p>` : ''}
    ${sectionBlock('org-people', 'People here', current.length,
      `${current.length ? current.map(personRow).join('') : '<p class="hint">Nobody here yet.</p>'}
       <button type="button" class="primary small-btn" data-action="add-person" data-org="${oid}">+ Add person here</button>`, 'yellow')}
    ${past.length ? sectionBlock('org-past', 'Previously here', past.length, past.map(personRow).join(''), 'navy') : ''}`;
}

// ---------------------------------------------------------------------------
// Circles: your own groups of people, like Actors or Models. Organizations
// are where people work; circles cut across them, and someone can be in
// several.

function isOverdue(p, today = todayStr()) {
  if (p.warmth === 'parked' || p.lightTouch) return false;
  if (firstStage(p) === 'justMet') return (p.firstContactDeadline || today) < today;
  return !dreamOnly(p) && (p.nextTouchpointDate || today) < today;
}

function renderCircles(id) {
  const hand = S.circles.length > 0;
  const map = hand && S.ui.circlesView !== 'list';
  if (map && id && S.circleById.has(id)) return circleInside(S.circleById.get(id));
  const today = todayStr();
  const reorder = !map && S.ui.circlesReorder && S.circles.length > 1;
  let body;
  if (!S.circles.length) {
    body = `<div class="empty">
      <p class="empty-title">No circles yet.</p>
      <p>Circles are your own groups of people, across organizations, and someone can be in more than one. Try starting with Actors or Models.</p>
      <button type="button" class="hero-cta" data-action="add-circle">+ New circle</button>
    </div>`;
  } else {
    body = S.circles
      .map((c, i) => {
        const members = membersOf(c.id);
        const late = members.filter((p) => isOverdue(p, today)).length;
        const light = members.filter((p) => p.lightTouch).length;
        const main = `<span class="row-main"><span class="row-name">${esc(c.name)}</span>
          ${c.description ? `<span class="row-sub">${esc(c.description)}</span>` : ''}
          <span class="row-meta">${plural(members.length, 'person', 'people')}${light ? ` <span class="dot">·</span> ${plural(light, 'light touch', 'light touches')}` : ''}${late ? ` <span class="dot">·</span> <b>${late} overdue</b>` : ''}</span></span>`;
        if (!reorder) return `<a class="row-card" href="#/circle/${esc(c.id)}">${main}</a>`;
        const cid = esc(c.id);
        return `<div class="row-card is-moving">${main}<span class="move-btns">
          <button type="button" class="move-btn" data-action="move-circle" data-id="${cid}" data-dir="-1"${i === 0 ? ' disabled' : ''} aria-label="Move ${esc(c.name)} up">${UP_ICON}</button>
          <button type="button" class="move-btn" data-action="move-circle" data-id="${cid}" data-dir="1"${i === S.circles.length - 1 ? ' disabled' : ''} aria-label="Move ${esc(c.name)} down">${DOWN_ICON}</button>
        </span></div>`;
      })
      .join('');
  }
  if (hand) {
    return `
    <header class="topbar"><h1>Circles</h1>
      ${!map && S.circles.length > 1 ? `<span class="topbar-actions"><button type="button" class="text-btn" data-action="toggle-reorder" aria-pressed="${reorder}">${reorder ? 'Done' : 'Reorder'}</button></span>` : ''}</header>
    <div class="people-hand"><div class="hand-row">
      <button type="button" class="hand-btn" data-action="add-circle"><span class="hand-btn-text">+ New circle</span>${statScrib('New circle')}</button>
      ${listButton('circles-view', !map)}
    </div></div>
    ${map ? mapHTML('circles') : `<div class="card-list">${body}</div>`}`;
  }
  return `
    <header class="topbar"><h1>Circles</h1>
      <span class="topbar-actions">
        ${S.circles.length > 1 ? `<button type="button" class="text-btn" data-action="toggle-reorder" aria-pressed="${reorder}">${reorder ? 'Done' : 'Reorder'}</button>` : ''}
        <button type="button" class="icon-btn" data-action="add-circle" aria-label="New circle">+</button>
      </span></header>
    <div class="card-list">${body}</div>`;
}

function renderCircle(id) {
  const c = S.circleById.get(id);
  if (!c) return notFoundHTML('circle', '#/circles', 'Circles');
  const today = todayStr();
  const cid = esc(c.id);
  const ui = S.ui.circle;
  const members = membersOf(id);
  const overdue = members.filter((p) => isOverdue(p, today)).sort((a, b) => a.nextTouchpointDate.localeCompare(b.nextTouchpointDate));
  const loops = members.reduce((n, p) => n + openLoopsOf(p.id).length, 0);
  const warmths = WARMTH.map((w) => [w, members.filter((p) => p.warmth === w).length]).filter(([, n]) => n);
  const lightCount = members.filter((p) => p.lightTouch).length;
  const shown = ui.light ? members.filter((p) => p.lightTouch) : members;
  const row = (p) => `<div class="member-row">${personRow(p, { added: ui.sort === 'added' })}
    <button type="button" class="member-remove" data-action="remove-from-circle" data-id="${esc(p.id)}" data-circle="${cid}" aria-label="Remove ${esc(p.name)} from ${esc(c.name)}">${X_ICON_SMALL}</button></div>`;
  const membersHTML = `
    <div class="toolbar circle-tools">
      <button type="button" class="primary small-btn" data-action="circle-add-people" data-id="${cid}">+ Add people</button>
      ${members.length > 1 ? `<button type="button" class="filter-toggle" data-action="toggle-sort" data-scope="circle" aria-expanded="${ui.sortOpen}">${esc(sortLabel(ui))}</button>` : ''}
      ${lightCount || ui.light ? `<button type="button" class="filter-toggle${ui.light ? ' is-on' : ''}" data-action="filter-light" data-scope="circle" aria-pressed="${ui.light}">Light touch</button>` : ''}
    </div>
    ${members.length > 1 ? sortPanelHTML(ui, 'circle') : ''}
    ${shown.length
      ? sortPeople([...shown], ui.sort, ui.reverse).map(row).join('')
      : members.length
        ? `<p class="hint">Nobody in ${esc(c.name)} is a light touch.</p>`
        : `<p class="hint">Nobody in ${esc(c.name)} yet. Add people here, or from anyone's page.</p>`}`;
  return `
    <div class="detail-top">${backButton('#/circles', 'Back')}
      <button type="button" class="text-btn" data-action="edit-circle" data-id="${cid}">Edit</button></div>
    <header class="person-head">
      <h1 class="person-name">${esc(c.name)}</h1>
      ${c.description ? `<p class="person-sub">${esc(c.description)}</p>` : ''}
    </header>
    <div class="stats-row">
      ${statBox(members.length, members.length === 1 ? 'Person' : 'People')}
      ${statBox(overdue.length, 'Overdue')}
      ${statBox(loops, loops === 1 ? 'Open loop' : 'Open loops')}
    </div>
    ${warmths.length ? `<div class="warmth-breakdown" aria-label="Warmth">${warmths.map(([w, n]) => `<span class="warmth-count">${warmthBadge(w)}<b>${n}</b></span>`).join('')}${lightCount ? `<span class="warmth-count">${lightBadge()}<b>${lightCount}</b></span>` : ''}</div>` : ''}
    ${overdue.length ? sectionBlock('circle-overdue', 'Overdue in this circle', overdue.length, overdue.map(personRow).join(''), 'navy') : ''}
    ${sectionBlock('circle-members', ui.light ? 'Light touches' : 'Members', shown.length, membersHTML, 'yellow')}`;
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const nextSortOrder = () => S.circles.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), -1) + 1;

function circleSheet(c = null) {
  const suggest = c ? [] : CIRCLE_SUGGESTIONS.filter((n) => !S.circles.some((x) => sameName(x.name, n)));
  const s = openSheet({
    title: c ? 'Edit circle' : 'New circle',
    className: 'sheet-small',
    body: `<form class="form" novalidate>
      <label class="field"><span class="field-label">Name</span>
        <input name="name" value="${esc(c ? c.name : '')}" maxlength="60" autocomplete="off" placeholder="Actors" required></label>
      <p class="field-error" data-error="name" hidden></p>
      ${suggest.length ? `<div class="chip-choices">${suggest.map((n) => `<button type="button" class="chip" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <label class="field"><span class="field-label">Description (optional)</span>
        <input name="description" value="${esc(c ? c.description || '' : '')}" maxlength="140" autocomplete="off" placeholder="Actors I shoot headshots for"></label>
      ${c ? '<button type="button" class="btn danger wide" data-delete>Delete circle</button>' : ''}
      <button type="submit" class="modal-cta primary">${c ? 'Save' : 'Add circle'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  const nameField = form.querySelector('[name="name"]');
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-name]');
    if (!b) return;
    nameField.value = b.dataset.name;
    form.querySelector('[data-error="name"]').hidden = true;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const err = form.querySelector('[data-error="name"]');
    const clash = S.circles.find((x) => sameName(x.name, name) && (!c || x.id !== c.id));
    if (!name || clash) {
      err.textContent = name ? `You already have a circle called ${clash.name}.` : 'Give the circle a name.';
      err.hidden = false;
      nameField.focus();
      return;
    }
    const saved = await db.saveCircle({
      ...(c || { sortOrder: nextSortOrder() }),
      name,
      description: String(fd.get('description') || '').trim(),
    });
    s.close();
    if (!c) location.hash = `#/circle/${saved.id}`;
    await refresh();
    toast(c ? 'Saved' : `${name} added`);
  });
  const del = s.body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      const n = membersOf(c.id).length;
      const ok = await confirmSheet({
        title: `Delete ${esc(c.name)}?`,
        message: n
          ? `The ${plural(n, 'person', 'people')} in it stay in Callback. Only the circle goes.`
          : 'Nobody is in it yet.',
        confirmLabel: 'Delete circle',
        danger: true,
      });
      if (!ok) return;
      await db.deleteCircle(c.id);
      S.ui.people.circles.delete(c.id);
      s.close();
      location.hash = '#/circles';
      await refresh();
      toast(`${c.name} deleted`);
    });
  }
}

// A sheet for ticking circles, where a new one can be made on the spot.
// Resolves with the chosen ids in your order, or null when closed.
function circlePicker({ title = 'Circles', selected = [] }) {
  return new Promise((resolve) => {
    let result = null;
    const chosen = new Set(selected);
    const row = (c) => `<label class="pick-row"><input type="checkbox" data-cid="${esc(c.id)}"${chosen.has(c.id) ? ' checked' : ''}><span class="pick-main"><span class="pick-name">${esc(c.name)}</span>${c.description ? `<span class="pick-sub">${esc(c.description)}</span>` : ''}</span></label>`;
    const s = openSheet({
      title,
      className: 'sheet-small has-footer',
      body: `
        <p class="hint" data-empty${S.circles.length ? ' hidden' : ''}>No circles yet. Start one below, like Actors or Models.</p>
        <div class="pick-list" data-list${S.circles.length ? '' : ' hidden'}>${S.circles.map(row).join('')}</div>
        <form class="new-circle" novalidate>
          <input name="name" class="search" maxlength="60" autocomplete="off" placeholder="New circle" aria-label="New circle name">
          <button type="submit" class="primary small-btn">+ Add</button>
        </form>
        <div class="sheet-footer"><button type="button" class="modal-cta primary" data-done>Done</button></div>`,
      onClose: () => resolve(result),
    });
    const list = s.body.querySelector('[data-list]');
    s.body.addEventListener('change', (e) => {
      const box = e.target.closest('[data-cid]');
      if (!box) return;
      if (box.checked) chosen.add(box.dataset.cid);
      else chosen.delete(box.dataset.cid);
    });
    s.body.querySelector('.new-circle').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('[name="name"]');
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      const existing = S.circles.find((x) => sameName(x.name, name));
      if (existing) {
        chosen.add(existing.id);
        list.querySelector(`[data-cid="${existing.id}"]`).checked = true;
        return;
      }
      const c = await db.saveCircle({ name, description: '', sortOrder: nextSortOrder() });
      S.circles = [...S.circles, c];
      S.circleById.set(c.id, c);
      chosen.add(c.id);
      list.insertAdjacentHTML('beforeend', row(c));
      list.hidden = false;
      s.body.querySelector('[data-empty]').hidden = true;
    });
    s.body.querySelector('[data-done]').addEventListener('click', () => {
      result = S.circles.filter((c) => chosen.has(c.id)).map((c) => c.id);
      s.close();
    });
  });
}

// ---------------------------------------------------------------------------
// Weekly review

function weekStats(ws) {
  const we = addDays(ws, 6);
  const inWeek = (d) => d >= ws && d <= we;
  const localDay = (iso) => toDateStr(new Date(iso));
  return {
    ws,
    we,
    tps: S.tps.filter((t) => inWeek(t.date)),
    // Light touches count on their own, apart from the touchpoints goal.
    regular: S.tps.filter((t) => inWeek(t.date) && !t.lightTouch),
    light: S.tps.filter((t) => inWeek(t.date) && t.lightTouch),
    replies: S.tps.filter((t) => t.responded === 'yes' && t.type !== 'project_wrapped' && inWeek(t.respondedAt ? localDay(t.respondedAt) : t.date)),
    wrapped: S.tps.filter((t) => inWeek(t.date) && t.type === 'project_wrapped'),
    added: S.people.filter((p) => p.createdAt && inWeek(localDay(p.createdAt))),
  };
}

function weekRange(ws) {
  const a = parseDate(ws);
  const b = parseDate(addDays(ws, 6));
  const m = (d) => d.toLocaleDateString(undefined, { month: 'short' });
  const startLabel = `${m(a)} ${a.getDate()}`;
  return a.getMonth() === b.getMonth() ? `${startLabel} to ${b.getDate()}` : `${startLabel} to ${m(b)} ${b.getDate()}`;
}

function weekRecord(ws) {
  return S.weeks.filter((w) => w.weekStart === ws).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}

function goalBar(label, n, goal) {
  const pct = goal ? Math.min(100, Math.round((n / goal) * 100)) : 0;
  return `<div class="goal">
    <p class="goal-head"><span>${esc(label)}</span>${n >= goal ? '<span>✓</span>' : ''}</p>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${n}" aria-valuetext="${n} of ${goal}" aria-label="${esc(label)}"><span style="width:${pct}%"></span></div>
  </div>`;
}

// Tapping the row opens that touchpoint on the person's page; Edit opens it
// right where you are.
function logRow(t) {
  const p = S.personById.get(t.personId);
  return `<div class="log-row">
    <a class="log-row-main" href="#/person/${esc(t.personId)}/${esc(t.id)}"><span class="log-row-date">${esc(fmtDate(t.date))}</span>
      <b>${esc(p ? p.name : 'Someone')}</b> <span class="dot">·</span> ${esc(touchTypeLabel(t.type))}${t.lightTouch ? ' <span class="dot">·</span> Light touch' : ''}${tpNote(t) ? `<span class="log-row-note">${esc(tpNote(t))}</span>` : ''}</a>
    <span class="log-row-side">${t.type === 'project_wrapped' ? '' : `<button type="button" class="resp resp-${esc(t.responded || 'pending')}" data-action="set-response" data-id="${esc(t.id)}" aria-label="Reply status: ${esc(respondedLabel(t.responded))}. Change">${esc(respondedLabel(t.responded))}</button>`}
      <button type="button" class="text-btn" data-action="edit-tp" data-id="${esc(t.id)}">Edit</button></span>
  </div>`;
}

// The boxes on Today and Weekly review open a sheet with what they count.
// Tapping a row opens that person; the sheet closes as the page changes.
function statSheet(kind) {
  const { title, body } = statContent(kind);
  const s = openSheet({ title, body, className: 'stat-sheet' });
  s.body.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      leaveTo(go.dataset.go);
      return;
    }
    if (e.target.closest('[data-add]')) {
      s.close();
      personForm(null);
    }
    // The reply status changes in a popup over the list.
    const resp = e.target.closest('[data-action="set-response"]');
    const rt = resp && S.tps.find((x) => x.id === resp.dataset.id);
    if (rt) {
      setResponse(rt).then(() => {
        if (s.el.isConnected) s.body.innerHTML = statContent(kind).body;
      });
      return;
    }
    // Editing a touchpoint opens over the list, which then shows the change.
    const edit = e.target.closest('[data-action="edit-tp"]');
    const t = edit && S.tps.find((x) => x.id === edit.dataset.id);
    if (t) {
      logSheet(S.personById.get(t.personId), {
        touchpoint: t,
        onClose: () => {
          if (s.el.isConnected) s.body.innerHTML = statContent(kind).body;
        },
      });
    }
  });
}

function statContent(kind) {
  const today = todayStr();
  const ws = weekStartStr(today);
  const w = weekStats(ws);
  const g = S.settings.goals;
  const rows = (people) => `<div class="card-list">${people.map(personRow).join('')}</div>`;
  const group = (label, people) => (people.length ? `<p class="filter-label stat-group">${esc(label)} [${people.length}]</p>${rows(people)}` : '');
  const weekLine = (count) => `<p class="week-range">This week <span class="dot">·</span> ${esc(weekRange(ws))} <span class="dot">·</span> <span class="nowrap">${count}</span></p>`;
  // Already on Weekly review, the link would go nowhere.
  const weekLink = parseRoute().name === 'week' ? '' : '<button type="button" class="btn secondary wide stat-more" data-go="#/week">Open weekly review</button>';
  let title;
  let body;
  if (kind === 'reach') {
    const t = buildToday({ people: S.people, touchpointsByPerson: S.tpsByPerson, news: S.news, loops: S.loops }, today);
    title = 'To reach out';
    body = t.justMet.length + t.overdue.length + t.due.length
      ? group('Just met', t.justMet) + group('Overdue', t.overdue) + group('Due today', t.due)
      : "<p class=\"hint\">Nobody to reach out to today. You're all caught up.</p>";
  } else if (kind === 'touchpoints') {
    title = 'Touchpoints this week';
    body = `${weekLine(`${w.regular.length} of ${g.touchpoints}`)}
      ${w.regular.length
        ? `<div class="log-list">${sortTouchpoints(w.regular).map(logRow).join('')}</div>`
        : `<p class="hint">${w.light.length ? 'No touchpoints yet this week, only light touches.' : 'Nothing logged yet this week. The To reach out box shows who\'s due.'}</p>`}
      ${w.light.length ? `<p class="filter-label stat-group">Light touches [${w.light.length}]</p>
        <p class="hint stat-note">They count on their own, apart from the goal.</p>
        <div class="log-list">${sortTouchpoints(w.light).map(logRow).join('')}</div>` : ''}
      ${weekLink}`;
  } else if (kind === 'replies') {
    // Counted on the day the reply came in, so the touchpoint itself may be
    // from an earlier week. Latest reply first.
    const replies = [...w.replies].sort((a, b) => (b.respondedAt || b.date).localeCompare(a.respondedAt || a.date));
    title = 'Replies this week';
    body = `${weekLine(plural(replies.length, 'reply', 'replies'))}
      ${replies.length
        ? `<div class="log-list">${replies.map(logRow).join('')}</div>`
        : '<p class="hint">No replies yet this week. When someone writes back, mark that touchpoint as Replied on their page.</p>'}
      ${weekLink}`;
  } else {
    const added = [...w.added].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    title = 'New people this week';
    body = `${weekLine(`${added.length} of ${g.newPeople}`)}
      ${added.length ? rows(added) : '<p class="hint">Nobody added yet this week.</p>'}
      <button type="button" class="primary small-btn stat-add" data-add>+ add another!</button>
      ${weekLink}`;
  }
  return { title, body };
}

function renderWeek() {
  const today = todayStr();
  const ws = weekStartStr(today);
  const w = weekStats(ws);
  const g = S.settings.goals;
  const metBoth = w.regular.length >= g.touchpoints && w.added.length >= g.newPeople;

  const logged = sortTouchpoints(w.tps).map(logRow).join('');

  // Every week from the first sign of activity up to last week, newest first.
  const firsts = [
    ...S.tps.map((t) => t.date),
    ...S.people.map((p) => toDateStr(new Date(p.createdAt))),
    ...S.weeks.map((x) => x.weekStart),
  ].filter(Boolean).sort();
  const pastWeeks = [];
  if (firsts.length) {
    for (let d = addDays(ws, -7); d >= weekStartStr(firsts[0]) && pastWeeks.length < 104; d = addDays(d, -7)) pastWeeks.push(d);
  }
  const pastCard = (pw) => {
    const s = weekStats(pw);
    const r = weekRecord(pw);
    const met = s.regular.length >= g.touchpoints;
    return `<article class="week-card">
      <p class="week-card-head"><span class="week-card-range">${esc(weekRange(pw))}</span>${met ? '<span class="week-card-met">Goal met</span>' : ''}</p>
      <p class="week-card-stats">${plural(s.regular.length, 'touchpoint')}${s.light.length ? ` <span class="dot">·</span> ${plural(s.light.length, 'light touch', 'light touches')}` : ''} <span class="dot">·</span> ${plural(s.replies.length, 'reply', 'replies')} <span class="dot">·</span> ${s.added.length} new${s.wrapped.length ? ` <span class="dot">·</span> ${plural(s.wrapped.length, 'project')} wrapped` : ''}</p>
      ${r && r.points.length ? `<div class="points week-card-points" data-week="${pw}"><ul class="point-list">${pointItems(r.points)}</ul></div>` : ''}
      <button type="button" class="text-btn" data-action="edit-reflection" data-week="${pw}">${r && r.points.length ? '+ Add a point' : 'Add a reflection'}</button>
    </article>`;
  };
  // In folds by month (a week goes in the month it starts in), and by year
  // once there's more than one. The latest month starts open.
  const pastHTML = pastWeeks.length
    ? monthFolds('past', pastWeeks.map((pw) => ({ date: pw, html: pastCard(pw) })), { open: 'first' })
    : '<p class="hint">Your past weeks will collect here, with what you logged and what you wrote about them.</p>';

  return `
    <header class="topbar"><h1>Weekly review</h1></header>
    <p class="week-range">This week <span class="dot">·</span> ${esc(weekRange(ws))}</p>
    <div class="dash no-stats">
    <div class="dash-main">${weekCols([`
    ${w.light.length ? `<p class="week-split">${plural(w.light.length, 'light touch', 'light touches')} this week</p>` : ''}
    ${w.wrapped.length ? `<p class="week-split week-wrapped">${WRAP_ICON}${plural(w.wrapped.length, 'project')} wrapped this week</p>` : ''}
    <div class="goals">
      ${goalBar('Touchpoints', w.regular.length, g.touchpoints)}
      ${goalBar('New people', w.added.length, g.newPeople)}
      <p class="goals-note">${metBoth ? 'Both goals met. Lovely week.' : 'Goals reset every Monday. Change them in Settings.'}</p>
    </div>
    <section class="section-block">
      <h2 class="heading-yellow static"><label for="pointNew">What worked this week?</label></h2>
      ${pointsEditorHTML(ws, 'pointNew')}
    </section>`,
    sectionBlock('week-logged', 'Logged this week', w.tps.length, logged || '<p class="hint">Nothing logged yet this week. Today has a list of who to reach out to.</p>', 'navy'),
    sectionBlock('week-past', 'Past weeks', pastWeeks.length || null, pastHTML, 'yellow')])}
    </div>
    </div>`;
}

// Their news, for everyone: every date still to come (a yearly one on its
// next day), soonest first, in a fold for each month (11-10). A tap opens
// the person.
function renderNews() {
  const today = todayStr();
  const items = S.news
    .filter((n) => S.personById.has(n.personId))
    .map((n) => (n.repeatsYearly ? { ...n, date: nextYearly(n.date, today) } : n))
    .filter((n) => n.date && n.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || S.personById.get(a.personId).name.localeCompare(S.personById.get(b.personId).name));
  const row = (n) => {
    const p = S.personById.get(n.personId);
    return `<a class="news-item news-row" href="#/person/${esc(p.id)}">
      <span class="news-item-date">${esc(fmtDate(n.date, { weekday: false }))}</span>
      <span class="news-row-main"><span class="news-row-name">${esc(p.name)}</span>
        <span class="news-item-text">${esc(n.description)}${n.repeatsYearly ? ' <span class="yearly-tag">Every year</span>' : ''}</span></span>
      <span class="news-item-rel">${esc(n.date === today ? 'Today' : cap(relDay(n.date, today)))}</span>
    </a>`;
  };
  return `
    <header class="topbar"><h1>Their news</h1></header>
    <p class="hint">Upcoming dates worth reaching out about, soonest first: premieres, launches, new agencies, birthdays. Tap one to open the person.</p>
    <div class="card-list news-list">${items.length
      ? monthFolds('news', items.map((n) => ({ date: n.date, html: row(n) })), { open: 'all' })
      : '<p class="hint">Nothing coming up yet. Add a date on someone\'s page, under Their news.</p>'}</div>`;
}

// A group in a list (a year, a month) that folds away with a tap on its
// heading. It starts open or shut as `open` says, then stays as you left it
// until the app is closed (11-10).
function foldHTML(key, title, count, inner, open, level = 'month') {
  const on = S.ui.folds.has(key) ? S.ui.folds.get(key) : open;
  return `<div class="fold fold-${level}">
    <h3 class="fold-head${on ? '' : ' collapsed'}" data-action="toggle-fold" data-key="${esc(key)}" role="button" tabindex="0" aria-expanded="${on}"><span>${esc(title)} <span class="fold-n">[${count}]</span></span>${ARROW}</h3>
    <div class="fold-body"${on ? '' : ' hidden'}>${inner}</div>
  </div>`;
}

const monthName = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long' });

// Dated things, already in order ({ date, html }), in a fold for each
// month, and in a fold for each year too once there's more than one year.
// `open`: 'first' opens only the first month (and its year), 'all' opens
// every one.
function monthFolds(prefix, items, { open = 'first' } = {}) {
  const months = [];
  for (const it of items) {
    const ym = it.date.slice(0, 7);
    let m = months[months.length - 1];
    if (!m || m.ym !== ym) months.push((m = { ym, items: [] }));
    m.items.push(it);
  }
  if (!months.length) return '';
  const first = months[0].ym;
  const opens = (ym) => open === 'all' || ym === first;
  const monthHTML = (m) => foldHTML(`${prefix}:${m.ym}`, monthName(m.ym), m.items.length, m.items.map((i) => i.html).join(''), opens(m.ym));
  const years = [...new Set(months.map((m) => m.ym.slice(0, 4)))];
  if (years.length < 2) return months.map(monthHTML).join('');
  return years.map((y) => {
    const ms = months.filter((m) => m.ym.startsWith(y));
    return foldHTML(`${prefix}:${y}`, y, ms.reduce((n, m) => n + m.items.length, 0), ms.map(monthHTML).join(''), open === 'all' || first.startsWith(y), 'year');
  }).join('');
}

// In a big window the weekly review's three parts sit in columns, each
// scrolling on its own; otherwise one after the other.
function weekCols(parts) {
  if (!bigQuery.matches) return parts.join('');
  return `<div class="board" style="--board-cols: ${parts.length}">${parts.map((p) => `<div class="board-col">${p}</div>`).join('')}</div>`;
}

// What worked, as a running list. The box on top adds a point (Enter or
// Add) and stays ready for the next; each point shows as plain text under
// it, newest first, and tapping one turns it back into a box to edit.
// Emptying a point removes it.
const pointItem = (pt) => `<li class="point" data-id="${esc(pt.id)}"><button type="button" class="point-text" data-point-edit>${esc(pt.text)}</button></li>`;
const pointItems = (points) => [...points].reverse().map(pointItem).join('');

function pointsEditorHTML(ws, inputId = '') {
  const rec = weekRecord(ws);
  const points = rec ? rec.points : [];
  return `<div class="points" data-week="${ws}">
    <div class="point-new"><span class="point-dot" aria-hidden="true"></span>
      <textarea class="point-input" data-point-new rows="1"${inputId ? ` id="${inputId}"` : ''} enterkeyhint="done" aria-label="Add something that worked"></textarea>
      <button type="button" class="primary small-btn" data-point-add>Add</button></div>
    <ul class="point-list">${pointItems(points)}</ul>
    <p class="save-state" aria-live="polite"></p>
  </div>`;
}

// Saves go one at a time, each on top of the last, so quick adds and edits
// never overwrite each other (or start a second record for the week).
let pointsQueue = Promise.resolve();
function changePoints(box, change) {
  const ws = box.dataset.week;
  const state = box.querySelector('.save-state');
  if (state) state.textContent = 'Saving';
  pointsQueue = pointsQueue.then(async () => {
    const rec = weekRecord(ws);
    const points = change(rec ? rec.points : []);
    const saved = await db.saveWeek({ ...(rec || { weekStart: ws }), points, reflection: points.map((p) => p.text).join('\n') });
    S.weeks = [...S.weeks.filter((x) => x.id !== saved.id), saved];
    if (state && state.isConnected) state.textContent = 'Saved';
  }).catch(() => toast("Couldn't save that. Try again."));
  return pointsQueue;
}

const pointText = (v) => v.replace(/\s*\n+\s*/g, ' ').trim();

function addPoint(box, { keepFocus = true } = {}) {
  const input = box.querySelector('[data-point-new]');
  const text = pointText(input.value);
  if (keepFocus) input.focus();
  if (!text) return;
  const pt = { id: uuid(), text };
  input.value = '';
  fitHeight(input);
  box.querySelector('.point-list').insertAdjacentHTML('afterbegin', pointItem(pt));
  changePoints(box, (points) => [...points, pt]);
}

function startPointEdit(btn) {
  const li = btn.closest('.point');
  const ta = document.createElement('textarea');
  ta.className = 'point-input';
  ta.rows = 1;
  ta.dataset.pointEditing = '1';
  ta.setAttribute('enterkeyhint', 'done');
  ta.setAttribute('aria-label', 'Edit this point. Empty it to remove it.');
  ta.value = btn.textContent;
  ta.dataset.was = btn.textContent;
  li.replaceChildren(ta);
  fitHeight(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function finishPointEdit(ta) {
  if (ta.dataset.done) return;
  ta.dataset.done = '1';
  const li = ta.closest('.point');
  const box = ta.closest('.points');
  const id = li.dataset.id;
  const text = pointText(ta.value);
  if (text === ta.dataset.was) {
    li.innerHTML = pointItem({ id, text }).replace(/^<li[^>]*>|<\/li>$/g, '');
    return;
  }
  if (!text) {
    // Removed, with Undo putting it back where it was.
    let removed = null;
    let at = -1;
    li.remove();
    changePoints(box, (points) => {
      at = points.findIndex((p) => p.id === id);
      removed = points[at] || null;
      return points.filter((p) => p.id !== id);
    });
    toast('Point removed', {
      action: {
        label: 'Undo',
        run: async () => {
          await changePoints(box, (points) => (removed ? [...points.slice(0, at), removed, ...points.slice(at)] : points));
          render();
        },
      },
    });
    return;
  }
  li.innerHTML = pointItem({ id, text }).replace(/^<li[^>]*>|<\/li>$/g, '');
  changePoints(box, (points) => points.map((p) => (p.id === id ? { ...p, text } : p)));
}

// ---------------------------------------------------------------------------
// Settings

function numField(path, value, label, hint) {
  return `<label class="set-row">
    <span class="set-label">${esc(label)}${hint ? `<span class="set-hint">${esc(hint)}</span>` : ''}</span>
    <span class="set-input"><input type="number" inputmode="numeric" min="1" max="3650" data-setting="${path}" value="${esc(value)}" aria-label="${esc(label)}"><span class="set-unit" data-span-for="${path}">${esc(path.startsWith('goals') ? 'per week' : span(value))}</span></span>
  </label>`;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function installHTML() {
  if (isStandalone()) return '<p>Callback is installed on this device. It works offline, and your data stays here.</p>';
  if (S.installPrompt) {
    return `<p>Install Callback to open it from your home screen or dock, like any other app. It works offline.</p>
      <button type="button" class="primary small-btn" data-action="install">Install Callback</button>`;
  }
  if (isIOS()) return '<p>To install on iPhone or iPad: open Callback in Safari, tap the Share button, then Add to Home Screen.</p>';
  return '<p>To install, use your browser menu and pick Install or Add to Home Screen. In Chrome and Edge it is the install icon in the address bar.</p>';
}

function renderSettings(inSheet = false) {
  const c = S.settings.cadence;
  const g = S.settings.goals;
  const appearance = getAppearance();
  const events = calendarEvents();
  return `
    ${inSheet ? '' : '<header class="topbar"><h1>Settings</h1></header>'}

    ${sectionBlock('set-cadence', 'Cadence', null, `
      <p class="hint">How often Callback suggests reaching out, by warmth. Logging a touchpoint schedules the next one using these.</p>
      <div class="set-group">
        <p class="set-group-title">${warmthBadge('cold')} A short sequence of three notes</p>
        ${numField('cadence.coldFollowUp', c.coldFollowUp, 'Follow up', 'Days after the first note')}
        ${numField('cadence.coldLastTry', c.coldLastTry, 'Last try', 'Days after the follow-up')}
        ${numField('cadence.coldWait', c.coldWait, 'Wait for a reply', 'Then Callback asks about parking them')}
      </div>
      <div class="set-group">
        ${numField('cadence.warm', c.warm, 'Warm', 'Days between touchpoints')}
        ${numField('cadence.active', c.active, 'Active', 'Days between touchpoints')}
        ${numField('cadence.client', c.client, WARMTH_INFO.client.label, 'Days between touchpoints')}
        ${numField('cadence.parked', c.parked, 'Parked', 'Days before they come back')}
      </div>
      <div class="set-group">
        <p class="set-group-title">${lightBadge()} Weak ties, whatever their warmth</p>
        ${numField('cadence.lightTouch', c.lightTouch, 'Light touch', 'Days between touchpoints')}
      </div>
      <button type="button" class="secondary small-btn" data-action="recalc-all">Recalculate everyone's next date</button>
      <p class="hint">Changes apply the next time you log a touchpoint. Recalculate to apply them to everyone now.</p>`, 'yellow')}

    ${sectionBlock('set-goals', 'Weekly goals', null, `
      ${numField('goals.touchpoints', g.touchpoints, 'Touchpoints')}
      ${numField('goals.newPeople', g.newPeople, 'New people')}`, 'navy')}

    ${sectionBlock('set-ideas', 'Touchpoint ideas', null, ideasSettingsHTML(), 'yellow')}

    ${sectionBlock('set-look', 'Appearance', null, `
      <div class="seg" role="radiogroup" aria-label="Appearance">
        ${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']]
          .map(([k, label]) => `<label class="seg-option"><input type="radio" name="appearance" value="${k}"${appearance === k ? ' checked' : ''}><span>${label}</span></label>`)
          .join('')}
      </div>
      ${greenRowHTML("The app's color.")}`, 'navy')}

    ${sectionBlock('set-data', 'Your data', null, `
      ${S.meta.sync
        ? "<p>Everything lives on this device and syncs with your private GitHub repository, which keeps every version. You can still export a backup any time.</p>"
        : "<p>Everything lives on this device, in this browser. Nothing is sent anywhere unless you turn on sync below. Export a backup now and then so it's safe, and to move to another device.</p>"}
      <p class="set-fact">Last backup: <b>${S.meta.lastExportAt ? esc(fmtTimestamp(S.meta.lastExportAt)) : 'never'}</b></p>
      <div class="button-stack">
        <button type="button" class="primary small-btn" data-action="export-json">Export backup (JSON)</button>
        <button type="button" class="secondary small-btn" data-action="import-json">Import backup</button>
        <button type="button" class="secondary small-btn" data-action="import-contacts">Add people from your contacts</button>
      </div>
      ${syncSettingsHTML()}`, 'yellow')}

    ${sectionBlock('set-cal', 'Calendar', null, `
      <p>Download your next 90 days of touchpoints as a calendar file, one all-day event per person. ${events.length ? `Right now that's ${plural(events.length, 'event')}.` : 'Nothing is scheduled in the next 90 days yet.'}</p>
      <p class="tip"><b>Tip:</b> import it into its own calendar named Callback. When you want fresh dates, delete that calendar, make it again, and import the new file. In Google Calendar on a computer: Settings, Add calendar, Create new calendar, then Import and pick Callback.</p>
      <button type="button" class="primary small-btn" data-action="export-ics"${events.length ? '' : ' disabled'}>Download calendar file (.ics)</button>`, 'navy')}

    ${sectionBlock('set-install', 'Install', null, installHTML(), 'yellow')}

    ${sectionBlock('set-about', 'About', null, `
      <p>Callback is part of a set of free photography apps for Patreon members, alongside Documenting Fictions and Ref.</p>
      <p class="set-fact">Version ${APP_VERSION}</p>
      <button type="button" class="btn danger" data-action="erase-all">Erase everything on this device</button>`, 'navy')}`;
}

// ---- Sync between devices (js/sync.js) ----

function agoText(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return fmtTimestamp(iso);
}

function syncSettingsHTML() {
  const c = S.meta.sync;
  if (!c) {
    return `<h3 class="set-sub">Sync between devices</h3>
      <p>Keep your phone and computer in step through a private GitHub repository of your own. Each device keeps working offline and catches up when it's back online.</p>
      <button type="button" class="secondary small-btn" data-action="sync-setup">Set up sync</button>`;
  }
  return `<h3 class="set-sub">Sync between devices</h3>
    <p class="set-fact">On, through <b>${esc(c.repo)}</b>. Last synced: <b>${c.lastSyncAt ? esc(agoText(c.lastSyncAt)) : 'not yet'}</b></p>
    ${c.lastError ? `<p class="field-error">${esc(c.lastError)}</p>` : ''}
    ${S.meta.conflicts.length ? `<p class="set-fact">${S.meta.conflicts.length === 1 ? 'One thing was' : `${S.meta.conflicts.length} things were`} changed on two devices at once and ${S.meta.conflicts.length === 1 ? 'needs' : 'need'} your pick.</p>` : ''}
    <div class="button-stack">
      ${S.meta.conflicts.length ? '<button type="button" class="primary small-btn" data-action="sync-conflicts">Choose</button>' : ''}
      <button type="button" class="primary small-btn" data-action="sync-now">Sync now</button>
      <button type="button" class="secondary small-btn" data-action="sync-setup">Change key</button>
      <button type="button" class="secondary small-btn" data-action="sync-off">Turn off sync</button>
    </div>`;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (window.callbackApp) return 'the Mac app';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  return 'a browser';
}

function syncSheet() {
  const c = S.meta.sync;
  const s = openSheet({
    title: c ? 'Change sync key' : 'Set up sync',
    body: `<form class="form" novalidate>
      <p class="hint">Callback keeps one file, callback.json, in a private GitHub repository of yours. Every device you turn this on for reads and writes it. If two devices already have people, they're combined and nothing is deleted.</p>
      <details class="paste-box"${c ? '' : ' open'}>
        <summary>How to make the repository and key</summary>
        <ol class="field-hint sync-steps">
          <li>On github.com, make a new <b>private</b> repository, like callback-data, and tick Add a README file.</li>
          <li>In your GitHub settings: Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.</li>
          <li>Repository access: <b>Only select repositories</b>, then pick that repository.</li>
          <li>Permissions, Repository permissions: <b>Contents, Read and write</b>.</li>
          <li>Generate it and paste it below. Use the same repository and key on each device.</li>
        </ol>
      </details>
      <label class="field"><span class="field-label">Repository</span>
        <input name="repo" value="${esc(c ? c.repo : '')}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="your-name/callback-data"></label>
      <p class="field-error" data-error="repo" hidden>Write it as owner/name, like your-name/callback-data.</p>
      <label class="field"><span class="field-label">Key</span>
        <input name="token" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="github_pat_..."></label>
      <p class="field-hint">Kept on this device only. It's never in a backup or in the synced file.</p>
      <p class="field-error" data-error="token" hidden>Paste the key from GitHub.</p>
      <p class="field-error" data-error="sync" hidden></p>
      <button type="submit" class="modal-cta primary" data-save>${c ? 'Save and sync' : 'Turn on sync'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  const showError = (k, msg) => {
    const el = form.querySelector(`[data-error="${k}"]`);
    if (msg) el.textContent = msg;
    el.hidden = false;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const repo = form.repo.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    const token = form.token.value.trim();
    form.querySelectorAll('.field-error').forEach((el) => { el.hidden = true; });
    if (!sync.validRepo(repo)) return showError('repo');
    if (!token) return showError('token');
    const btn = form.querySelector('[data-save]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    try {
      const sameRepo = c && c.repo === repo;
      const r = await sync.queued({ repo, token, device: deviceLabel(), joined: !!(sameRepo && c.joined) });
      s.close();
      await refresh();
      toast(r.changedHere ? 'Sync is on. Your other devices\' changes are in.' : 'Sync is on.');
    } catch (ex) {
      showError('sync', ex.message || 'That did not work. Check the repository and key.');
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

// What the automatic syncs report: bring in other devices' changes, keep the
// Settings status fresh, and say once if sync needs a look.
let syncWarned = false;
async function onSyncResult(r) {
  const busy = isTyping(document.activeElement) || document.body.classList.contains('sheet-open');
  if (r.changedHere || (r.conflicts !== undefined && r.conflicts !== S.meta.conflicts.length) || r.newConflicts) {
    await load();
    if (!busy) render();
    if (r.newConflicts) {
      if (busy) toast('Something was changed on two devices at once. Pick which to keep on Today.');
      else conflictSheet();
    }
    return;
  }
  S.meta.sync = await sync.syncConfig();
  if (S.ui.settings && !busy) render();
  if (r.error && r.error.kind !== 'offline' && r.error.kind !== 'busy' && !syncWarned) {
    syncWarned = true;
    toast('Sync needs a look: see Settings, Your data.');
  }
}

// ---- Changed on both devices ----
// js/merge.js finds a record changed on two devices before they caught up
// (the same field changed to different values, or deleted on one and
// changed on the other). Nothing is overwritten until you pick here;
// sync.resolve saves the pick and sends it out.

function conflictBannerHTML() {
  const n = S.meta.conflicts.length;
  if (!n) return '';
  return `<div class="reminder">
    <p><b>${n === 1 ? 'Something was' : `${n} things were`} changed on two devices at once.</b> Pick which version to keep.</p>
    <div class="prompt-actions">
      <button type="button" class="btn primary" data-action="sync-conflicts">Choose</button>
    </div>
  </div>`;
}

const FIELD_NAMES = {
  people: {
    name: 'Name', organizationId: 'Organization', role: 'Role', email: 'Email', phone: 'Phone', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X',
    website: 'Website', howWeMet: 'How you met', tags: 'Tags', notes: 'Notes', cadenceOverrideDays: 'Own rhythm',
    dreamList: 'Dream list', circleIds: 'Circles', lightTouch: 'Light touch', nextTouchpointDate: 'Next touchpoint', figure: 'Drawing',
    warmth: 'Warmth', relationshipTypes: 'Relationship', interest: 'Interest', birthday: 'Birthday', details: 'Details',
    introducedById: 'Introduced by', introducedByName: 'Introduced by', canIntroduceToIds: 'Can introduce you to',
    customIdea: 'Your idea for them', firstContact: 'First contact', firstContactDeadline: 'First contact by',
    pastOrganizations: 'Previously', postProjectCheckIn: 'Check-in after a project',
    'postProjectCheckIn.date': 'Check-in after a project', 'postProjectCheckIn.projectName': 'Project',
  },
  touchpoints: { date: 'Date', type: 'Type', note: 'Note', direction: 'Who reached out', responded: 'Reply', lightTouch: 'Light touch' },
  organizations: { name: 'Name', type: 'Type', website: 'Website', notes: 'Notes' },
  circles: { name: 'Name', description: 'Description' },
  news: { description: 'What', date: 'Date', repeatsYearly: 'Every year' },
  weeks: { points: 'Plan' },
  ideas: { text: 'Idea', hidden: 'Hidden' },
};
const RHYTHM_NAMES = {
  coldFollowUp: 'Cold: follow up after', coldLastTry: 'Cold: last try after', coldWait: 'Cold: wait for a reply',
  warm: 'Warm rhythm', active: 'Active rhythm', client: 'Client rhythm', parked: 'Parked rhythm', lightTouch: 'Light touch rhythm',
};
const GOAL_NAMES = { touchpoints: 'Weekly goal: touchpoints', newPeople: 'Weekly goal: new people' };

function fieldName(store, path) {
  const [group, key] = path.split('.');
  if (store === 'settings' && group === 'cadence' && RHYTHM_NAMES[key]) return RHYTHM_NAMES[key];
  if (store === 'settings' && group === 'goals' && GOAL_NAMES[key]) return GOAL_NAMES[key];
  if (FIELD_NAMES[store] && FIELD_NAMES[store][path]) return FIELD_NAMES[store][path];
  return cap(path.split('.').pop().replace(/([A-Z])/g, ' $1').toLowerCase());
}

function fieldValue(store, path, v) {
  const key = path.split('.').pop();
  const names = (ids, map, none) => ids.map((id) => (map.get(id) || {}).name || none).join(', ');
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return 'Nothing';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (store === 'settings' && typeof v === 'number') return path.startsWith('cadence.') ? span(v) : String(v);
  if (key === 'cadenceOverrideDays') return span(v);
  if (key === 'postProjectCheckIn' && typeof v === 'object') return `${fmtDate(v.date)}${v.projectName ? `, ${v.projectName}` : ''}`;
  if (key === 'warmth') return WARMTH_INFO[v] ? WARMTH_INFO[v].label : String(v);
  if (key === 'interest') return interestInfo(v).label;
  if (key === 'figure') return figureWords(v);
  if (key === 'relationshipTypes') return v.map((k) => relationshipInfo(k).label).join(', ');
  if (key === 'type' && store === 'touchpoints') return touchTypeLabel(v);
  if (key === 'responded') return respondedLabel(v);
  if (key === 'organizationId') return (S.orgById.get(v) || {}).name || 'An organization';
  if (key === 'circleIds') return names(v, S.circleById, 'A circle');
  if (key === 'introducedById') return (S.personById.get(v) || {}).name || 'Someone';
  if (key === 'canIntroduceToIds') return names(v, S.personById, 'Someone');
  if (key === 'birthday' && typeof v === 'object') return birthdayText(v);
  if (key === 'details') return v.map((d) => [d.label, d.value].filter(Boolean).join(': ')).join('; ');
  if (key === 'points') return v.map((x) => x.text).filter(Boolean).join('; ');
  if (key === 'pastOrganizations') return names(v.map((x) => x.organizationId), S.orgById, 'An organization');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.text || x.name || x.label || '' : String(x))).filter(Boolean).join(', ') || 'Nothing';
  if (typeof v === 'object') return Object.values(v).filter((x) => x !== null && typeof x !== 'object').join(', ');
  const text = String(v);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function recordTitle(store, rec) {
  const person = (id) => (S.personById.get(id) || {}).name || 'someone';
  const day = (d) => (d ? fmtDate(d, { weekday: false }) : 'a day');
  if (!rec) return 'Something';
  if (store === 'people') return rec.name || 'Someone';
  if (store === 'organizations') return rec.name || 'An organization';
  if (store === 'circles') return `The ${rec.name || ''} circle`;
  if (store === 'touchpoints') return `${touchTypeLabel(rec.type)} with ${person(rec.personId)} on ${day(rec.date)}`;
  if (store === 'news') return `${rec.description || 'News'} for ${person(rec.personId)}`;
  if (store === 'openLoops') return `A promise with ${person(rec.personId)}`;
  if (store === 'ideas') return 'One of your ideas';
  if (store === 'weeks') return `Your plan for the week of ${day(rec.weekStart)}`;
  if (store === 'settings') return 'Your settings';
  return 'Something';
}

function hereName() {
  const d = deviceLabel();
  if (d === 'the Mac app') return 'this Mac';
  if (d === 'a browser') return 'this browser';
  if (d === 'Android') return 'this phone';
  return `this ${d}`;
}
function thereName(c) {
  const d = c.from;
  if (!d) return 'your other device';
  if (d === 'the Mac app') return 'your Mac';
  if (d === 'a browser') return 'your browser';
  if (d === 'Android') return 'your Android phone';
  return `your ${d}`;
}

function conflictHTML(c, n, total) {
  const here = hereName();
  const there = thereName(c);
  const title = recordTitle(c.store, c.mine || c.theirs);
  const count = total > 1 ? `<p class="conflict-count">${n} of ${total}</p>` : '';
  if (c.kind === 'both') {
    const mineNewer = (c.mine.updatedAt || '') >= (c.theirs.updatedAt || '');
    const side = (p, who, rec, isNewer) => `<div><span class="conflict-who">${esc(cap(who))}${isNewer ? ' (newer)' : ''}</span>
      <span class="conflict-val">${esc(fieldValue(c.store, p, getPath(rec, p)))}</span></div>`;
    const rows = c.loud.map((p) => `<div class="conflict-field">
        <p class="conflict-name">${esc(fieldName(c.store, p))}</p>
        <div class="conflict-pair">${side(p, there, c.theirs, !mineNewer)}${side(p, here, c.mine, mineNewer)}</div>
      </div>`).join('');
    return `${count}<p class="sheet-message"><b>${esc(title)}</b> was changed on ${esc(here)} and on ${esc(there)} before they caught up. Everything else is combined, but ${c.loud.length === 1 ? 'this differs' : 'these differ'}:</p>
      ${rows}
      <div class="sheet-actions">
        <button type="button" class="btn ${mineNewer ? 'secondary' : 'primary'}" data-pick="theirs">Keep ${esc(there)}'s</button>
        <button type="button" class="btn ${mineNewer ? 'primary' : 'secondary'}" data-pick="mine">Keep ${esc(here)}'s</button>
      </div>`;
  }
  const [gone, changed] = c.kind === 'deletedThere' ? [there, here] : [here, there];
  const tps = (c.children || []).filter((x) => x.store === 'touchpoints' && (c.kind === 'deletedThere' ? x.mine : x.theirs)).length;
  const more = c.store === 'people' && tps ? ` Deleting also removes their ${tps === 1 ? 'touchpoint' : `${tps} touchpoints`}.` : '';
  return `${count}<p class="sheet-message"><b>${esc(title)}</b> was deleted on ${esc(gone)}, but changed on ${esc(changed)} before they caught up.${more}</p>
    <div class="sheet-actions">
      <button type="button" class="btn secondary" data-pick="delete">Delete</button>
      <button type="button" class="btn primary" data-pick="keep">Keep</button>
    </div>`;
}

let conflictOpen = false;
async function conflictSheet() {
  if (conflictOpen) return;
  let list = await sync.getConflicts();
  if (!list.length) {
    await refresh();
    toast('Nothing to pick: your devices agree.');
    return;
  }
  conflictOpen = true;
  const total = list.length;
  const s = openSheet({
    title: 'Changed on two devices',
    onClose: async () => {
      conflictOpen = false;
      await refresh();
    },
  });
  const show = () => {
    s.body.innerHTML = conflictHTML(list[0], total - list.length + 1, total);
  };
  s.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    s.body.querySelectorAll('[data-pick]').forEach((b) => { b.disabled = true; });
    try {
      const r = await sync.resolve(list[0], btn.dataset.pick);
      if (r && r.stale) toast('That one changed again here, so Callback checks it once more.');
    } catch (err) {
      toast(err && err.message ? err.message : "That didn't save. Try again.");
      show();
      return;
    }
    list = list.slice(1);
    if (list.length) show();
    else {
      s.close();
      toast(total === 1 ? 'Sorted. Your pick goes to your other devices.' : 'All sorted. Your picks go to your other devices.');
    }
  });
  show();
}

function ideasSettingsHTML() {
  const own = S.ideas.filter((r) => r.source === 'own' && !r.hidden).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const removed = S.ideas.filter((r) => r.hidden).length;
  return `
    <p class="hint">Callback mixes your own ideas in with its suggestions for everyone, except lukewarm contacts, who only get give-first ideas. Remove any suggestion with the x on it.</p>
    <p class="set-group-title">Your suggestions (${own.length})</p>
    ${own.length
      ? `<ul class="own-ideas">${own.map((r) => `<li><span>${esc(r.text)}</span><button type="button" class="pd-remove" data-action="remove-own-idea" data-id="${esc(r.id)}" aria-label="Remove this suggestion for good">${X_ICON_SMALL}</button></li>`).join('')}</ul>`
      : '<p class="hint">None yet. Ideas you type for someone can join them, or add one here.</p>'}
    <div class="button-stack">
      <button type="button" class="primary small-btn" data-action="add-suggestion">+ Add a suggestion</button>
      <button type="button" class="secondary small-btn" data-action="restore-ideas"${removed ? '' : ' disabled'}>Bring back removed suggestions${removed ? ` (${removed})` : ''}</button>
    </div>`;
}

function calendarEvents() {
  return upcomingEvents(
    { people: S.people, orgsById: S.orgById, touchpointsByPerson: S.tpsByPerson, news: S.news },
    { appUrl: location.origin + location.pathname }
  );
}

function getAppearance() {
  try {
    const v = localStorage.getItem('callback-appearance');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyAppearance(v) {
  try {
    if (v === 'system') localStorage.removeItem('callback-appearance');
    else localStorage.setItem('callback-appearance', v);
  } catch {
    /* private mode: applies for this visit only */
  }
  if (v === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', v);
}

async function saveSetting(path, raw) {
  const n = Math.round(Number(raw));
  const [group, key] = path.split('.');
  const input = document.querySelector(`[data-setting="${path}"]`);
  if (!(n >= 1 && n <= 3650)) {
    if (input) input.value = S.settings[group][key];
    toast('Use a number from 1 to 3650.');
    return;
  }
  if (S.settings[group][key] === n) return;
  const next = { ...S.settings, [group]: { ...S.settings[group], [key]: n } };
  S.settings = await db.saveSettings(next);
  const unit = document.querySelector(`[data-span-for="${path}"]`);
  if (unit && group === 'cadence') unit.textContent = span(n);
  toast('Saved');
}

// ---------------------------------------------------------------------------
// The welcome and the tour (11-10)
//
// First open: the head bigger and facing you, with a hello and "Want a quick
// tour?" over it. Yes: it pulls back to Today as it always looks and the
// tour starts. No: "That's okay", how to find the tour later, then it pulls
// back. The tour is a pop for each thing on Today, then one for each page,
// and Help (tap the face) starts it again.

function welcomeHTML() {
  if (S.ui.welcome === 'no') {
    return `<div class="welcome" role="status"><p class="welcome-hi">That's okay!</p>
      <p class="welcome-text">You can take the tour any time: tap my face, then Help.</p></div>`;
  }
  return `<div class="welcome" role="group" aria-label="Welcome"><p class="welcome-hi">Hi! Welcome to Callback.</p>
    <p class="welcome-text">I'm here to help you remember who to reach out to, when, and why. Want a quick tour?</p>
    <div class="welcome-actions"><button type="button" class="btn primary" data-action="tour-yes">Yes, show me</button><button type="button" class="btn secondary" data-action="tour-no">No thanks</button></div></div>`;
}

// Over the head: on a wide window the head sits left of the middle.
function placeWelcome() {
  const w = document.querySelector('.welcome');
  const h = document.querySelector('.mind-head');
  const d = w && w.offsetParent;
  if (!h || !d) return;
  const dr = d.getBoundingClientRect();
  const hr = h.getBoundingClientRect();
  const half = Math.min(dr.width, 520) / 2;
  const cx = Math.max(half, Math.min(dr.width - half, hr.left + hr.width / 2 - dr.left));
  Object.assign(w.style, { left: `${Math.round(cx - half)}px`, right: 'auto', width: `${Math.round(half * 2)}px` });
}
window.addEventListener('resize', placeWelcome);

const calmMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Off the welcome: the numbers fade in and the head pulls back.
function leaveWelcome() {
  S.ui.welcome = null;
  S.ui.arrive = true;
  render();
  setWelcome(false);
  setTimeout(() => { S.ui.arrive = false; }, 1200);
}

async function answerWelcome(yes) {
  await db.setMeta('welcomed', nowISO());
  if (yes) {
    leaveWelcome();
    setTimeout(startTour, calmMotion() ? 0 : 1100);
    return;
  }
  S.ui.welcome = 'no';
  render();
  setTimeout(() => { if (S.ui.welcome === 'no') leaveWelcome(); }, 4500);
}

function tourSteps() {
  const none = !S.people.length;
  const phone = phoneQuery.matches;
  return [
    { route: 'today', at: '.dash.is-mind > .stats-row', text: "These are your numbers. To reach out is everyone due now. The other two count this week's touchpoints and new people against your weekly goals." },
    { route: 'today', at: 'bubbles', text: none ? "Thought bubbles hold what's waiting for you: who's due, open loops, their news. Tap one to see who's in it, or drag it somewhere else. For now there's one, to add your first person." : "Each thought bubble is something waiting for you: who's due, open loops, their news. Tap one to see who's in it, or drag it somewhere else." },
    { route: 'today', at: '.mind-head', text: "That's me! Tap my face for Settings, a new look for me, and Help. Drag me to turn my head." },
    { route: 'today', at: '#tabbar', text: phone ? 'Swipe this bar, or tap its arrows, to go from page to page.' : 'This bar takes you from page to page.' },
    { route: 'people', text: `People is everyone you keep in touch with. Add someone, search and filter, and tap a name to see their touchpoints, their news and open loops.${phone ? ' Circles and Organizations sit either side of the bar while you are here.' : ''}` },
    { route: 'circles', text: 'Circles are your own groups of people, like actors or stylists. Someone can be in more than one.' },
    { route: 'orgs', text: 'Organizations are where your people work, like agencies, brands and publications, with who is there now and who used to be.' },
    { route: 'news', text: "Their news lists everyone's upcoming dates, like birthdays and launches, soonest first, so you can reach out on time." },
    { route: 'week', text: 'Weekly review shows your week against your goals, a place to note what worked, and your past weeks.' },
    { route: 'today', at: none ? 'first' : '.mind-head', text: none ? "That's the tour! Tap this bubble to add your first person." : "That's the tour! Tap my face, then Help, to take it again." },
  ];
}

function startTour() {
  closeAllSheets();
  closeFaceMenu();
  S.ui.tour = { i: 0, steps: tourSteps() };
  let el = document.querySelector('.tour');
  if (!el) {
    el = document.createElement('div');
    el.className = 'tour';
    el.dataset.acts = '';
    el.innerHTML = `<div class="tour-ring" aria-hidden="true"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-label="Tour">
        <p class="tour-count"></p><p class="tour-text" aria-live="polite"></p>
        <div class="tour-actions"><button type="button" class="btn secondary" data-action="tour-end">End tour</button><button type="button" class="btn primary" data-action="tour-next">Next</button></div>
      </div>`;
    document.body.appendChild(el);
  }
  showTourStep();
}

function showTourStep() {
  const T = S.ui.tour;
  if (!T) return;
  const step = T.steps[T.i];
  if (parseRoute().name !== step.route) location.hash = `#/${step.route}`;
  else placeTour();
  // The page draws on the hash change; place it again once it has.
  setTimeout(placeTour, 120);
}

function nextTourStep() {
  const T = S.ui.tour;
  if (!T) return;
  if (T.i >= T.steps.length - 1) {
    endTour();
    return;
  }
  T.i += 1;
  showTourStep();
}

function endTour() {
  S.ui.tour = null;
  const el = document.querySelector('.tour');
  if (el) el.remove();
  if (parseRoute().name !== 'today') location.hash = '#/today';
}

// What a step points at, as one box round all of it (the bubbles together).
function tourBox(at) {
  if (!at) return null;
  let els;
  if (at === 'bubbles') els = [...document.querySelectorAll('.mind button.thought')];
  else if (at === 'first') els = [...document.querySelectorAll('.mind button.thought[data-key="first"]')];
  else els = [document.querySelector(at)].filter(Boolean);
  // A bubble's button is the middle of its cloud; the cloud's bumps reach
  // about this much further out (mind.js sizes the button off the cloud).
  const grow = at === 'bubbles' || at === 'first' ? [1.8, 1.92] : [1, 1];
  const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height).map((r) => {
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const hw = (r.width / 2) * grow[0];
    const hh = (r.height / 2) * grow[1];
    return { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
  });
  if (!rs.length) return null;
  return {
    left: Math.min(...rs.map((r) => r.left)),
    top: Math.min(...rs.map((r) => r.top)),
    right: Math.max(...rs.map((r) => r.right)),
    bottom: Math.max(...rs.map((r) => r.bottom)),
  };
}

// The step's words in a card by what it's about (under it, or over it if
// there's no room), with a ring round it; a page's own pop sits in the middle.
function placeTour() {
  const T = S.ui.tour;
  const el = document.querySelector('.tour');
  if (!T || !el) return;
  const step = T.steps[T.i];
  const last = T.i === T.steps.length - 1;
  el.querySelector('.tour-count').textContent = `${T.i + 1} of ${T.steps.length}`;
  el.querySelector('.tour-text').textContent = step.text;
  el.querySelector('[data-action="tour-next"]').textContent = last ? 'Done' : 'Next';
  el.querySelector('[data-action="tour-end"]').hidden = last;
  const r = parseRoute().name === step.route ? tourBox(step.at) : null;
  const ring = el.querySelector('.tour-ring');
  const card = el.querySelector('.tour-card');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;
  el.classList.toggle('is-plain', !r);
  ring.style.borderRadius = step.at === '.mind-head' ? '50%' : '';
  if (r) {
    Object.assign(ring.style, { display: 'block', left: `${Math.round(r.left - pad)}px`, top: `${Math.round(r.top - pad)}px`, width: `${Math.round(r.right - r.left + pad * 2)}px`, height: `${Math.round(r.bottom - r.top + pad * 2)}px` });
  } else ring.style.display = 'none';
  const cw = Math.min(360, vw - 32);
  card.style.width = `${cw}px`;
  const ch = card.offsetHeight;
  let left = (vw - cw) / 2;
  let top = (vh - ch) / 2;
  if (r) {
    const midY = Math.max(16, Math.min(vh - ch - 16, (r.top + r.bottom) / 2 - ch / 2));
    left = Math.max(16, Math.min(vw - cw - 16, (r.left + r.right) / 2 - cw / 2));
    if (r.bottom + pad + 12 + ch < vh - 16) top = r.bottom + pad + 12;
    else if (r.top - pad - 12 - ch > 16) top = r.top - pad - 12 - ch;
    // Too tall for either (the bar down the side of a wide window): beside it.
    else if (r.right + pad + 12 + cw < vw - 16) [left, top] = [r.right + pad + 12, midY];
    else if (r.left - pad - 12 - cw > 16) [left, top] = [r.left - pad - 12 - cw, midY];
  }
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}
window.addEventListener('resize', () => { if (S.ui.tour) placeTour(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.ui.tour) endTour();
});

// ---------------------------------------------------------------------------
// Routing

const ROUTES = {
  today: () => renderToday(),
  people: () => renderPeople(),
  person: (id) => renderPerson(id),
  circles: (id) => renderCircles(id),
  circle: (id) => renderCircle(id),
  orgs: (id) => renderOrgs(id),
  org: (id) => renderOrg(id),
  news: () => renderNews(),
  week: () => renderWeek(),
  settings: () => renderSettings(),
  dreams: () => renderDreams(),
};
const TAB_FOR = { person: 'people', org: 'orgs', circle: 'circles', dreams: 'people' };
const TITLES = { today: 'Today', people: 'People', person: 'Person', circles: 'Circles', circle: 'Circle', orgs: 'Organizations', org: 'Organization', news: 'Their news', week: 'Weekly review', settings: 'Settings', dreams: 'Dream list' };

// #/person/<id>/<touchpoint id> opens a person's page at that touchpoint.
function parseRoute() {
  const [name, id, focus] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: ROUTES[name] ? name : 'today', id: id ? decodeURIComponent(id) : null, focus: focus ? decodeURIComponent(focus) : null };
}

let currentKey = '';

// Desktop: in a wide window the list and the open person, organization or
// circle sit side by side, like Mail, and the list keeps its place while
// you go from one to the next. The phone never sees this.
const wideQuery = window.matchMedia('(min-width: 1100px)');
// People with nobody open has the whole window (11-10); the list comes in
// beside someone's page when they're opened.
const SPLIT_LIST = { person: 'people', orgs: 'orgs', org: 'orgs', circles: 'circles', circle: 'circles' };
const SPLIT_EMPTY = {
  orgs: ['Pick an organization on the left.', 'Its page opens here, and the list stays put.'],
  circles: ['Pick a circle on the left.', 'Its page opens here, and the list stays put.'],
};
const splitList = (name) => (wideQuery.matches ? SPLIT_LIST[name] || null : null);

const SPLIT_PAGE = { circles: 'circle', orgs: 'org' };
function splitHTML(r, list) {
  // Picked on the map (#/circles/<id>): inside it on the left, its page on
  // the right.
  const inside = r.name === list && r.id && SPLIT_PAGE[list];
  const open = r.name !== list || inside;
  const [title, text] = SPLIT_EMPTY[list] || [];
  const side = ROUTES[list](inside ? r.id : undefined);
  // ↑ and ↓ go through a list, not the ring or the map.
  const rows = side.includes('row-card');
  return `<div class="split">
    <section class="split-list" data-list="${list}" aria-label="${esc(TITLES[list])}">${side}</section>
    <section class="split-detail">${open ? ROUTES[inside || r.name](r.id) : `<div class="empty split-empty"><p class="empty-title">${title}</p><p>${text}</p>
      <p class="field-hint">${rows ? `↑ and ↓ move through the list. ${inMacApp ? 'Help, Keyboard Shortcuts lists the rest.' : 'Press ? for all the shortcuts.'}` : inMacApp ? 'Help, Keyboard Shortcuts lists the shortcuts.' : 'Press ? for all the shortcuts.'}</p></div>`}</section>
  </div>`;
}

// The open row in the side list.
function markSelected() {
  const r = parseRoute();
  const href = r.id ? `#/${r.name}/${r.id}` : '';
  view.querySelectorAll('.split-list a.row-card').forEach((a) => {
    const on = !!href && a.getAttribute('href') === href;
    a.classList.toggle('is-selected', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    if (on && S.ui.revealRow) a.scrollIntoView({ block: 'nearest' });
  });
  S.ui.revealRow = false;
}

function render() {
  if (parseRoute().name === 'settings') {
    const [name, id] = (currentKey || 'today/').split('/');
    history.replaceState(null, '', `#/${name || 'today'}${id ? `/${id}` : ''}`);
    openSettings();
  }
  const r = parseRoute();
  const key = `${r.name}/${r.id || ''}`;
  const prevKey = currentKey;
  const same = key === currentKey;
  const y = window.scrollY;
  const focus = !same && r.name === 'person' && r.focus;
  if (focus) S.ui.collapsed.delete('timeline');
  const list = splitList(r.name);
  const oldList = view.querySelector('.split-list');
  const listY = oldList && oldList.dataset.list === list ? oldList.scrollTop : 0;
  // The board's columns and the open person keep their scroll.
  const oldPanel = view.querySelector('.pick-panel');
  const pick = S.ui.pick;
  const panelY = oldPanel && pick && oldPanel.dataset.id === pick.id ? oldPanel.scrollTop : 0;
  const colsY = same ? [...view.querySelectorAll('.board-col')].map((c) => c.scrollTop) : [];
  if (pick && pick.focus) S.ui.collapsed.delete('pick-timeline');
  // A picture of the map going away, for beside the other one (peekPage).
  if (!same) shootMap();
  view.innerHTML = list ? splitHTML(r, list) : ROUTES[r.name](r.id);
  view.classList.toggle('is-split', !!list);
  if (list) {
    view.querySelector('.split-list').scrollTop = listY;
    markSelected();
  }
  const board = view.querySelector('.board');
  view.classList.toggle('is-board', !!board);
  if (board) {
    const cols = view.querySelectorAll('.board-col');
    if (cols.length === colsY.length) cols.forEach((c, i) => { c.scrollTop = colsY[i]; });
  }
  if (r.name === 'today' && bigQuery.matches && S.people.length) {
    if (!board) S.ui.pick = null;
    else if (pick) {
      const order = boardPeople();
      if (!order.includes(pick.id)) {
        S.ui.pick = nextPick(pick.id, order);
        S.ui.revealPick = true;
        return render();
      }
    }
    if (board) S.ui.boardOrder = boardPeople();
  }
  if (board && S.ui.pick) {
    const id = S.ui.pick.id;
    const on = [...board.querySelectorAll('[data-pick]')].filter((el) => el.dataset.pick === id);
    on.forEach((el) => el.classList.add('is-picked'));
    if (S.ui.revealPick && on[0]) on[0].scrollIntoView({ block: 'nearest' });
    const panel = view.querySelector('.pick-panel');
    if (panel) {
      if (!oldPanel) panel.classList.add('is-opening');
      panel.scrollTop = panelY;
      const tp = S.ui.pick.focus && [...panel.querySelectorAll('.tl-item')].find((li) => li.dataset.id === S.ui.pick.focus);
      if (tp) {
        tp.scrollIntoView({ block: 'center' });
        tp.classList.add('is-focus');
      }
      S.ui.pick.focus = null;
    }
  }
  S.ui.revealPick = false;
  view.dataset.route = r.name;
  const mindSlot = view.querySelector('[data-mind-slot]');
  if (mindSlot) mountMind(mindSlot, todayMind, { onOpen: openThought, onFace: faceMenu });
  mountRingIn(view);
  // Back out of a circle or organization: the map pulls back from it.
  const [prevName, prevId] = prevKey.split('/');
  mountMapIn(view, prevName === r.name && prevId && !r.id ? prevId : null);
  refreshThought();
  fitBrandTitle();
  view.querySelectorAll('textarea.pd-value').forEach(fitHeight);
  const tab = TAB_FOR[r.name] || r.name;
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === tab;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  updateSwipeBar(tab);
  document.title = r.name === 'today' ? 'Callback' : `${TITLES[r.name]} · Callback`;
  if (same) window.scrollTo(0, y);
  else window.scrollTo(0, S.ui.scroll.get(key) || 0);
  const item = focus && [...view.querySelectorAll('.tl-item')].find((li) => li.dataset.id === focus);
  if (item) {
    item.scrollIntoView({ block: 'center' });
    item.classList.add('is-focus');
  }
  placeSearchClear();
  currentKey = key;
  // The face menu stays through a redraw of the same page, not a new one.
  if (prevKey !== key) closeFaceMenu();
  else placeFaceMenu();
  refreshSettings();
  if (S.ui.tour) setTimeout(placeTour, 0);
  if (S.ui.welcome) {
    placeWelcome();
    setTimeout(placeWelcome, 60);
  }
  // Opened from People with a reply waiting two days or more: ask now.
  if (S.ui.askReplyFor) {
    const ask = r.name === 'person' && S.ui.askReplyFor === r.id ? S.personById.get(r.id) : null;
    S.ui.askReplyFor = null;
    if (ask) askWaitingReply(ask);
  }
}

wideQuery.addEventListener('change', () => render());
bigQuery.addEventListener('change', () => render());
phoneQuery.addEventListener('change', () => render());
thoughtQuery.addEventListener('change', () => { if (S.ui.thoughtKey) render(); });

// Resizing a big window can fit more or fewer board columns.
let boardResize = 0;
window.addEventListener('resize', () => {
  clearTimeout(boardResize);
  boardResize = setTimeout(() => {
    const b = view.querySelector('.board[data-fit]');
    if (b && Number(b.dataset.fit) !== boardFit(!!view.querySelector('.pick-panel'))) render();
    else view.querySelectorAll('textarea.pd-value').forEach(fitHeight);
    placeSearchClear();
  }, 120);
});
// The hand font arriving after the page drew can wrap a detail onto
// another line, so they're measured again.
if (document.fonts) document.fonts.addEventListener('loadingdone', () => {
  view.querySelectorAll('textarea.pd-value').forEach(fitHeight);
  placeSearchClear();
});

// A click anywhere on someone's card on Today (but its buttons) opens
// them: on the board, on the right; otherwise their page. Selecting text
// doesn't count.
view.addEventListener('click', (e) => {
  if (parseRoute().name !== 'today') return;
  const host = e.target.closest('[data-pick]');
  if (!host) return;
  const link = e.target.closest('a[href^="#/person/"]');
  if (!link && e.target.closest('button, a, input, textarea, select, label, [data-action]')) return;
  if (!link && String(window.getSelection() || '').trim()) return;
  if (!boardOn()) {
    if (!link) location.hash = `#/person/${host.dataset.pick}${host.dataset.focus ? `/${host.dataset.focus}` : ''}`;
    return;
  }
  e.preventDefault();
  if (link) {
    const [, , id, focus] = link.getAttribute('href').split('/');
    pickPerson(decodeURIComponent(id), focus ? decodeURIComponent(focus) : null);
  } else pickPerson(host.dataset.pick, host.dataset.focus || null);
});

// A row on People whose reply has waited two days: opening it asks.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a.row-card[data-ask-reply]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  openFromPeople(a.dataset.askReply);
});

// Off to another page from inside a popup (11-10): the popup goes first,
// and the page is drawn without it before moving on. An iPhone keeps a
// picture of the page you leave for its swipe back from the edge, and with
// the popup still up in that picture it seemed to be open again back there.
function leaveTo(to) {
  closeAllSheets();
  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true;
    if (typeof to === 'function') to();
    else location.hash = to;
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
  setTimeout(go, 150);
}
// Links in popups (people, organizations) work the same way.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('.sheet-overlay a[href^="#/"]');
  if (!a || a.closest('[data-action]') || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault();
  e.stopPropagation();
  const ask = a.dataset.askReply;
  leaveTo(ask ? () => openFromPeople(ask) : a.getAttribute('href'));
}, true);

window.addEventListener('hashchange', (e) => {
  const from = new URL(e.oldURL).hash || '#/today';
  S.ui.scroll.set(currentKey, window.scrollY);
  const r = parseRoute();
  // A bubble's panel beside the head (wide windows) goes once you leave
  // Today. Opening someone from it and coming straight Back keeps it.
  const detail = (h) => /^#\/(person|org|circle)\//.test(h);
  if (r.name === 'today' ? detail(from) && !S.ui.goingBack : !detail(location.hash)) S.ui.thoughtKey = null;
  S.ui.goingBack = false;
  if (r.name === 'person' || r.name === 'org' || r.name === 'circle') {
    if (!/^#\/(person|org|circle)\//.test(from) || !S.ui.backTo) S.ui.backTo = from;
  } else {
    S.ui.backTo = null;
    // Lists open at the top when reached from the tab bar, and where you
    // left them when coming back from a person.
    if (!/^#\/(person|org|circle)\//.test(from)) S.ui.scroll.delete(`${r.name}/`);
  }
  closeAllSheets();
  render();
});

// ---------------------------------------------------------------------------
// Sheets: person form

const PASTE_FIELDS = [
  ['name', 'name'],
  ['role', 'role'],
  ['org', 'organization'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['instagram', 'Instagram'],
  ['website', 'website'],
];

function joinWords(list) {
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// Fills the Add person form from pasted text. Fields someone typed into
// themselves are left alone; ones filled by an earlier paste are replaced.
// The organizations you've added drop down under the Organization field when
// it's tapped, narrowing as you type. (A datalist only shows them above the
// iPhone keyboard, one at a time.) Typing a new name still adds it on save.
function wireOrgSuggest(form) {
  const input = form.querySelector('#orgField');
  const list = form.querySelector('#orgSuggest');
  if (!input || !S.orgs.length) return;
  let active = -1;
  const options = () => [...list.querySelectorAll('[data-name]')];
  const hide = () => {
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const matches = S.orgs
      .filter((o) => !q || o.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Nothing to offer, or what's typed is already the one match.
    if (!matches.length || (matches.length === 1 && matches[0].name.toLowerCase() === q)) return hide();
    active = -1;
    list.innerHTML = matches.map((o) => `<button type="button" class="suggest-option" role="option" tabindex="-1" data-name="${esc(o.name)}">${esc(o.name)}</button>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const highlight = (i) => {
    const opts = options();
    active = (i + opts.length) % opts.length;
    opts.forEach((o, n) => o.classList.toggle('is-active', n === active));
    opts[active].scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('focus', show);
  input.addEventListener('input', show);
  // A moment's wait, so a tap on a name lands before the list goes.
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) hide(); }, 200));
  // Keeps the field focused while a name is clicked (desktop).
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-name]');
    if (!b) return;
    input.value = b.dataset.name;
    hide();
    input.blur();
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(active + (e.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      input.value = options()[active].dataset.name;
      hide();
    } else if (e.key === 'Escape') {
      // Closes the list, not the whole sheet.
      e.stopPropagation();
      hide();
    }
  });
}

function wirePasteBox(form) {
  const box = form.querySelector('[data-paste]');
  const result = form.querySelector('[data-paste-result]');
  const fill = (text) => {
    if (!text.trim()) {
      result.textContent = '';
      return;
    }
    const c = parsePasted(text);
    const values = { ...c, instagram: c.instagram ? `@${c.instagram}` : '' };
    const filled = [];
    for (const [key, word] of PASTE_FIELDS) {
      const input = form.querySelector(`[name="${key}"]`);
      if (!values[key]) {
        // Left over from an earlier paste: clear it, don't mix two people.
        if (input.dataset.pasted) {
          input.value = '';
          delete input.dataset.pasted;
        }
        continue;
      }
      if (input.value.trim() && !input.dataset.pasted) continue;
      input.value = values[key];
      input.dataset.pasted = '1';
      filled.push(word);
    }
    showFilledAccounts(form);
    const more = form.querySelector('details.more');
    if (more && filled.some((w) => ['email', 'phone', 'Instagram', 'website'].includes(w))) more.open = true;
    if (values.name) form.querySelector('[data-error="name"]').hidden = true;
    result.textContent = filled.length
      ? `Filled in ${joinWords(filled)}. Check them as you go.`
      : "Couldn't find any details in that. A signature or contact card works best.";
  };
  const fillSoon = debounce(fill, 250);
  box.addEventListener('input', () => fillSoon(box.value));
  // Opened, it moves to the top of the sheet, so the box is already clear
  // of where the keyboard comes up. Left low, iOS scrolls the whole screen
  // to reach it and the box ends up hidden (11-10).
  const paste = box.closest('details');
  paste.addEventListener('toggle', () => {
    const body = paste.closest('.sheet-body');
    if (paste.open && body) body.scrollTop += paste.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
  });
  form.addEventListener('input', (e) => {
    if (e.target !== box && e.target.dataset) delete e.target.dataset.pasted;
  });
  const clip = form.querySelector('[data-clip]');
  if (clip) {
    clip.addEventListener('click', async () => {
      try {
        box.value = await navigator.clipboard.readText();
        fill(box.value);
      } catch {
        result.textContent = 'Your phone didn\'t share what you copied. Press and hold in the box above, then tap Paste.';
      }
    });
  }
}

// On the dream list from the star by their name. Someone you haven't
// reached out to yet waits there with no rhythm until you do.
async function startDream(p) {
  if (!p || p.dreamList) return;
  await db.savePerson({ ...p, dreamList: true });
  dreamJustStarred = p.id;
  await refresh();
  toast(`${firstName(p)} is on your dream list.`, {
    action: {
      label: 'Undo',
      run: async () => {
        await db.savePerson({ ...S.personById.get(p.id), dreamList: false });
        await refresh();
      },
    },
  });
}

// Off the dream list from their page. Someone you haven't reached out to
// yet then joins the regular rhythm, so the toast says when their first
// touchpoint is (today, unless a date was already set).
async function endDream(p) {
  if (!p || !p.dreamList) return;
  const wasOnly = dreamOnly(p);
  await db.savePerson({ ...p, dreamList: false });
  await refresh();
  const now = S.personById.get(p.id);
  const next = now && wasOnly && now.warmth !== 'parked' && !now.lightTouch ? now.nextTouchpointDate || todayStr() : null;
  toast(`${firstName(p)} is off your dream list.${next ? ` First touchpoint ${relDay(next)}.` : ''}`, {
    action: {
      label: 'Undo',
      run: async () => {
        await db.savePerson({ ...S.personById.get(p.id), dreamList: true });
        await refresh();
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Light touch and quick add

// Off light touch by hand: their normal rhythm from the latest touchpoint,
// never overdue because of it.
// The Light touch box on someone's page turns it on; the note says what
// that means.
async function startLightTouch(p) {
  if (!p || p.lightTouch) return;
  const tps = tpsOf(p.id);
  const rec = { ...p, lightTouch: true };
  if (tps.length || p.nextTouchpointDate) rec.nextTouchpointDate = computeNextDate(rec, tps, S.settings, todayStr());
  await db.savePerson(rec);
  await refresh();
  toast(`Light touch on. ${firstName(p)} gets a small gesture every ${span(S.settings.cadence.lightTouch)}, kept in a quiet spot at the bottom of Today.`, {
    ms: 5000,
    action: {
      label: 'Undo',
      run: async () => {
        await db.savePerson({ ...S.personById.get(p.id), lightTouch: false, nextTouchpointDate: p.nextTouchpointDate });
        await refresh();
      },
    },
  });
}

async function endLightTouch(p) {
  if (!p || !p.lightTouch) return;
  const rec = { ...p, ...lightOffFields(p, tpsOf(p.id), S.settings, todayStr()) };
  await db.savePerson(rec);
  await refresh();
  toast(`Light touch off. ${firstName(p)} is back on their usual rhythm${rec.nextTouchpointDate ? `, next touchpoint ${fmtDate(rec.nextTouchpointDate)}` : ''}.`, {
    ms: 5000,
    action: {
      label: 'Undo',
      run: async () => {
        await db.savePerson({ ...S.personById.get(p.id), lightTouch: true, nextTouchpointDate: p.nextTouchpointDate });
        await refresh();
      },
    },
  });
}

// First touch Not yet: no touchpoint, and the first one two days out, while
// meeting them is still fresh.
const QUICK_FIRST_DAYS = 2;
const FIRST_TOUCH_HINT = {
  notYet: "Nothing is logged. The first touchpoint is in 2 days: follow them and send a quick note while it's fresh.",
  followed: 'Logs today as Followed. The next light touch follows the light touch rhythm.',
};

async function quickAddPerson({ name, instagram, note, where, followed, circleIds, figure = 'person' }) {
  const today = todayStr();
  const saved = await db.savePerson({
    name,
    role: '',
    organizationId: null,
    email: '',
    phone: '',
    instagram,
    website: '',
    howWeMet: where,
    notes: note,
    cadenceOverrideDays: null,
    ...relFields([DEFAULT_RELATIONSHIP]),
    interest: 'unknown',
    dreamList: false,
    introducedById: null,
    introducedByName: '',
    canIntroduceToIds: [],
    circleIds: circleIds.filter((id) => S.circleById.has(id)),
    pastOrganizations: [],
    ...warmthChangeFields({}, 'warm', nowISO(), today),
    firstContact: null,
    firstContactDeadline: null,
    lightTouch: true,
    engagePromptDismissed: null,
    nextTouchpointDate: addDays(today, QUICK_FIRST_DAYS),
    figure,
  });
  // Already followed, and only when picked for this person: today's
  // touchpoint is the follow, and the next one follows the light touch rhythm.
  if (followed) {
    const tp = await db.saveTouchpoint({
      personId: saved.id, type: 'followed', date: today, note: 'Followed on Instagram.',
      responded: 'pending', respondedAt: null, interest: null, lightTouch: true,
    });
    await db.savePerson({ ...saved, nextTouchpointDate: computeNextDate(saved, [tp], S.settings, today) });
  }
  db.askToPersist();
}

// For meeting a lot of people at once. The form stays open for the next
// person and keeps the circle and where you met, since a batch shares them.
function quickAddSheet() {
  const c = S.settings.cadence;
  let circleIds = [];
  const added = [];
  const field = (name, label, attrs = '') =>
    `<label class="field"><span class="field-label">${label}</span><input name="${name}" ${attrs}></label>`;
  const s = openSheet({
    title: 'Quick add',
    className: 'quick-sheet',
    body: `<form class="form" novalidate>
      <p class="hint">For meeting lots of people at once. Each one starts as a light touch: every ${span(c.lightTouch)}, with small gestures like reacting to a post.</p>
      ${field('name', 'Name', 'autocomplete="off" autocapitalize="words" placeholder="Who did you meet?" required')}
      <p class="field-error" data-error="name" hidden>Add a name first.</p>
      ${figurePickHTML('person')}
      ${field('instagram', 'Instagram (optional)', 'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="@handle" data-handle')}
      ${field('note', 'Note (optional)', 'autocomplete="off" maxlength="140" placeholder="Model, wants to shoot outdoors"')}
      <div class="picker-row"><span class="field-label">Circle (optional)</span>
        <button type="button" class="picker-btn" data-pick="circles"></button></div>
      ${field('where', 'Where we met (optional)', 'autocomplete="off" maxlength="80" placeholder="Agency party"')}
      <p class="field-hint">The circle and where you met stay filled in for the next person.</p>
      <fieldset class="field"><legend class="field-label">First touch</legend>
        <div class="seg">
          <label class="seg-option"><input type="radio" name="firstTouch" value="notYet" checked><span>Not yet</span></label>
          <label class="seg-option"><input type="radio" name="firstTouch" value="followed"><span>Already followed</span></label>
        </div>
        <span class="field-hint" data-first-hint>${FIRST_TOUCH_HINT.notYet}</span>
      </fieldset>
      <p class="quick-count" data-count aria-live="polite" hidden></p>
      <button type="submit" class="modal-cta primary" data-save>Add</button>
      <button type="button" class="btn secondary wide" data-done>Done</button>
    </form>`,
    onClose: () => {
      if (added.length) toast(`${plural(added.length, 'person', 'people')} added as light touches.`);
    },
  });
  const form = s.body.querySelector('form');
  const input = (k) => form.querySelector(`[name="${k}"]`);
  const showCircles = () => {
    const names = S.circles.filter((x) => circleIds.includes(x.id)).map((x) => x.name);
    form.querySelector('[data-pick="circles"]').textContent = names.length ? joinWords(names) : 'Choose a circle';
  };
  showCircles();
  // Tapping Add keeps the focus (and the keyboard) on the form.
  form.querySelector('[data-save]').addEventListener('mousedown', (e) => e.preventDefault());
  const firstTouch = (value) => {
    form.querySelector(`[name="firstTouch"][value="${value}"]`).checked = true;
    form.querySelector('[data-first-hint]').textContent = FIRST_TOUCH_HINT[value];
  };
  form.addEventListener('input', (e) => {
    if (e.target === input('name')) form.querySelector('[data-error="name"]').hidden = true;
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'firstTouch') firstTouch(e.target.value);
  });
  form.addEventListener('click', async (e) => {
    if (e.target.closest('[data-done]')) {
      s.close();
      return;
    }
    if (!e.target.closest('[data-pick]')) return;
    const ids = await circlePicker({ title: 'Circle', selected: circleIds });
    if (ids === null) return;
    circleIds = ids;
    showCircles();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input('name').value.trim();
    if (!name) {
      form.querySelector('[data-error="name"]').hidden = false;
      input('name').focus();
      return;
    }
    const values = {
      name,
      instagram: handleValue(input('instagram').value),
      note: input('note').value.replace(/\s+/g, ' ').trim(),
      where: input('where').value.trim(),
      followed: form.querySelector('[name="firstTouch"]:checked').value === 'followed',
      circleIds: [...circleIds],
      figure: figureOf({ figure: form.querySelector('[name="figure"]:checked').value }),
    };
    // Cleared and focused right away, before saving, so the keyboard stays
    // up for the next name.
    // Everything but the circle and where you met starts fresh, First touch
    // included, so a follow never carries over to the next person.
    for (const k of ['name', 'instagram', 'note']) input(k).value = '';
    firstTouch('notYet');
    form.querySelector('[name="figure"][value="person"]').checked = true;
    input('name').focus();
    await quickAddPerson(values);
    added.push(name);
    const count = form.querySelector('[data-count]');
    count.innerHTML = `<b>${added.length} added</b> <span class="dot">·</span> ${esc(joinWords(added))}`;
    count.hidden = false;
    await refresh();
  });
}

// Added as Already did: the touchpoint happened, so offer to log it straight
// away. Until it's logged they wait in Due today like Reach out now, since
// the next date is worked out from that touchpoint.
async function offerFirstLog(id, name) {
  const ok = await confirmSheet({
    title: 'Log the touchpoint?',
    message: `You've already reached out to ${esc(name)}. Log it now so Callback can plan the next one.`,
    confirmLabel: 'Log touchpoint',
    cancelLabel: 'Not now',
  });
  if (ok) logSheet(S.personById.get(id));
  else toast(`${name} added. Log the touchpoint from Today when you're ready.`);
}

// How someone is drawn in the ring on People: picked when adding them.
function figurePickHTML(value) {
  return `<fieldset class="field"><legend class="field-label">How they're drawn</legend>
    <div class="seg fig-seg">${FIGURES.map(([k, label]) => `<label class="seg-option"><input type="radio" name="figure" value="${k}" aria-label="${esc(label)}"${value === k ? ' checked' : ''}><span>${figureSVG(k, 'fig-pic')}</span></label>`).join('')}</div>
    <span class="field-hint">For the drawing of everyone on People, on a phone.</span></fieldset>`;
}

// The Add person wizard: one page at a time, Back and Next, the last page's
// button adds them. Each page checks its own must-haves (a name, at least
// one relationship, a first date when picking one, a sensible custom
// rhythm) before moving on. "See every question on one page" shows the
// whole form instead. Everything is one form, so the save is the same.
function wireWizard(sheet, form) {
  const pages = [...form.querySelectorAll('.wiz-page')];
  const q = (sel) => form.querySelector(sel);
  const back = q('[data-wiz-back]');
  const next = q('[data-wiz-next]');
  const save = q('.wiz-save');
  let at = 0;
  const show = (n) => {
    at = Math.max(0, Math.min(pages.length - 1, n));
    pages.forEach((pg, i) => { pg.hidden = i !== at; });
    const pg = pages[at];
    q('.wiz-step').textContent = `Step ${at + 1} of ${pages.length}`;
    q('.wiz-title').textContent = pg.dataset.title;
    q('.wiz-hint').textContent = pg.dataset.hint || '';
    const last = at === pages.length - 1;
    back.hidden = at === 0;
    next.hidden = last;
    save.hidden = !last;
    q('[data-wiz-all]').hidden = last;
    sheet.body.scrollTop = 0;
  };
  const pageOk = () => {
    const pg = pages[at];
    const name = q('[name="name"]');
    if (pg.contains(name) && !name.value.trim()) {
      q('[data-error="name"]').hidden = false;
      name.focus();
      return false;
    }
    if (pg.contains(q('[name="relationshipTypes"]')) && !q('[name="relationshipTypes"]:checked')) {
      q('[data-error="rel"]').hidden = false;
      return false;
    }
    const first = q('[name="firstContact"]:checked');
    if (pg.contains(q('[name="firstDate"]')) && first && first.value === 'pickDate' && !q('[name="firstDate"]').value) {
      q('[data-error="firstDate"]').hidden = false;
      return false;
    }
    if (pg.contains(q('[data-rhythm]')) && readRhythm(form) === undefined) return false;
    return true;
  };
  const forward = () => { if (pageOk()) show(at + 1); };
  next.addEventListener('click', forward);
  back.addEventListener('click', () => show(at - 1));
  q('[name="name"]').addEventListener('input', () => { q('[data-error="name"]').hidden = true; });
  form.addEventListener('change', (e) => { if (e.target.name === 'relationshipTypes') q('[data-error="rel"]').hidden = true; });
  // Return in a box moves on instead of adding them early.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || form.classList.contains('wiz-all') || at === pages.length - 1) return;
    if (!e.target.matches('input:not([type="checkbox"]):not([type="radio"])')) return;
    e.preventDefault();
    forward();
  });
  q('[data-wiz-all]').addEventListener('click', () => {
    form.classList.add('wiz-all');
    pages.forEach((pg) => { pg.hidden = false; });
    save.hidden = false;
    sheet.body.scrollTop = 0;
  });
  show(0);
}

function personForm(p, preset = {}) {
  const isNew = !p;
  const v = p || { warmth: 'cold', nextTouchpointDate: todayStr(), ...preset };
  // Adding from the dream list starts on Someday.
  const firstDefault = preset.dreamList ? 'someday' : DEFAULT_FIRST_CONTACT;
  const org = orgOf(v);
  const c = S.settings.cadence;
  const field = (name, label, value, attrs = '') =>
    `<label class="field"><span class="field-label">${label}</span><input name="${name}" value="${esc(value || '')}" ${attrs}></label>`;
  const s = openSheet({
    title: isNew ? 'Add person' : 'Edit person',
    className: isNew ? 'sheet-wizard' : '',
    // Adding someone goes one step at a time, a related chunk per page
    // (11-10, like the shoot wizard in Documenting Fictions); editing keeps
    // the whole form.
    body: isNew ? `<form class="form wiz" novalidate>
      <div class="wiz-head" aria-live="polite"><p class="wiz-step"></p><h3 class="wiz-title"></h3><p class="wiz-hint"></p></div>
      <section class="wiz-page" data-key="who" data-title="Who is it?" data-hint="A name is enough to start. Pasting a signature or contact fills in what Callback finds.">
      ${isNew ? `<details class="paste-box">
        <summary>Paste details from a signature or contact</summary>
        <div class="field"><textarea data-paste rows="5" aria-label="Pasted details" placeholder="Rosa Lind&#10;Booker | Ford Models&#10;M: +1 212 555 0101&#10;rosa@fordmodels.com"></textarea></div>
        ${navigator.clipboard && navigator.clipboard.readText ? '<button type="button" class="secondary small-btn" data-clip>Paste what I copied</button>' : ''}
        <p class="paste-result" data-paste-result aria-live="polite"></p>
        <p class="field-hint">Paste an email signature, a copied contact, or text from a website or DM. Callback fills in what it finds, and you check it before saving.</p>
      </details>` : ''}
      ${field('name', 'Name', v.name, 'autocomplete="off" placeholder="Who is it?" required')}
      <p class="field-error" data-error="name" hidden>Add a name first.</p>
      ${figurePickHTML(figureOf(v))}
      ${field('role', 'Role', v.role, 'list="roleList" autocomplete="off" placeholder="Casting director, editor, client"')}
      <datalist id="roleList">${ROLE_SUGGESTIONS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <div class="field"><label class="field-label" for="orgField">Organization</label>
        <input id="orgField" name="org" value="${esc(org ? org.name : '')}" autocomplete="off" placeholder="Agency, brand, publication"${S.orgs.length ? ' class="has-suggest" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="orgSuggest"' : ''}>
        <div class="suggest" id="orgSuggest" role="listbox" aria-label="Your organizations" hidden></div>
        <span class="field-hint">Pick one you've added, or type a new name to add it.${org && !isNew ? ' Changing it keeps a note of where they were before.' : ''}</span></div>
      </section>
      <section class="wiz-page" data-key="know" data-title="How you know them" data-hint="Tick any that fit, and add them to your circles if you like.">
      <fieldset class="field"><legend class="field-label">Relationship (tick any that fit)</legend>
        <div class="warmth-options">${RELATIONSHIP_TYPES.map((r) => `<label class="warmth-option">
          <input type="checkbox" name="relationshipTypes" value="${r.key}"${relTypesOf(v).includes(r.key) ? ' checked' : ''}>
          <span class="warmth-option-body">${relLabel(r.key)}<span class="warmth-option-blurb">${esc(r.blurb)}</span></span>
        </label>`).join('')}</div>
        <p class="field-error" data-error="rel" hidden>Tick at least one.</p></fieldset>
      <div class="picker-row"><span class="field-label">Circles</span>
        <button type="button" class="picker-btn" data-pick="circles"></button>
        <span class="field-hint">Your own groups, like Actors or Models. Someone can be in more than one.</span></div>
      </section>
      <section class="wiz-page" data-key="warm" data-title="How warm" data-hint="Where things stand with them right now. It sets how often Callback brings them up.">
      <fieldset class="field"><legend class="field-label">Warmth</legend>
        <div class="warmth-options">${WARMTH.map((w) => `<label class="warmth-option">
          <input type="radio" name="warmth" value="${w}"${v.warmth === w ? ' checked' : ''}>
          <span class="warmth-option-body">${warmthBadge(w)}<span class="warmth-option-blurb">${esc(WARMTH_INFO[w].blurb)}</span></span>
        </label>`).join('')}</div></fieldset>
      <div class="field">
        <label class="check"><input type="checkbox" name="lightTouch"${v.lightTouch ? ' checked' : ''}> ${LIGHT_ICON} Light touch</label>
        <span class="field-hint">For weak ties: every ${span(c.lightTouch)}, small gestures only, in a quiet spot at the bottom of Today.</span>
      </div>
      </section>
      <section class="wiz-page" data-key="touch" data-title="Touchpoints" data-hint="When to first reach out, then how often after that.">
      ${isNew ? `<fieldset class="field"><legend class="field-label">When should you first reach out?</legend>
        <div class="warmth-options first-options">${FIRST_CONTACT_OPTIONS.map((o) => `<label class="warmth-option">
          <input type="radio" name="firstContact" value="${o.key}"${firstDefault === o.key ? ' checked' : ''}>
          <span class="warmth-option-body"><span class="option-name">${esc(o.label)}</span><span class="warmth-option-blurb">${esc(o.blurb)}</span></span>
        </label>`).join('')}</div>
        <label class="field first-date"${firstDefault === 'pickDate' ? '' : ' hidden'}><span class="field-label">Date of the first touchpoint</span>
          <input type="date" name="firstDate" min="${todayStr()}"></label>
        <p class="field-error" data-error="firstDate" hidden>Pick a date for the first touchpoint.</p>
      </fieldset>` : `<label class="field"><span class="field-label">Next touchpoint</span>
        <input type="date" name="next" value="${esc(v.nextTouchpointDate || '')}">
        <span class="field-hint">Logging a touchpoint sets this for you.</span></label>`}
      ${rhythmPickerHTML(v, 'Touchpoints')}
      </section>
      <section class="wiz-page" data-key="contact" data-title="Contact details" data-hint="Whatever you have. The rest can go in later, from their page.">
      ${field('email', 'Email', v.email, 'type="email" autocomplete="off" inputmode="email"')}
      ${field('phone', 'Phone', v.phone, 'type="tel" autocomplete="off"')}
      ${accountsFieldHTML(v)}
      ${field('website', 'Website', v.website, 'autocomplete="off" inputmode="url" placeholder="example.com"')}
      </section>
      <section class="wiz-page" data-key="met" data-title="How you met" data-hint="Who introduced you, who they could introduce you to, and anything worth remembering.">
      <label class="field"><span class="field-label">How we met</span><textarea name="howWeMet" rows="2" placeholder="Introduced by Sam at the Rialto screening">${esc(v.howWeMet || '')}</textarea></label>
      <fieldset class="field connections-field"><legend class="field-label">Dream list and introductions</legend>
        <label class="check"><input type="checkbox" name="dreamList"${v.dreamList ? ' checked' : ''}> ${DREAM_STAR} On my dream list</label>
        <span class="field-hint">Someone you'd love to work with someday. No reminders until you first reach out, and a name is enough.</span>
        <div class="picker-row"><span class="field-label">Introduced by</span>
          <button type="button" class="picker-btn" data-pick="by"></button></div>
        <div class="picker-row"><span class="field-label">Could introduce me to</span>
          <button type="button" class="picker-btn" data-pick="could"></button></div>
      </fieldset>
      <label class="field"><span class="field-label">Notes</span><textarea name="notes" rows="3">${esc(v.notes || '')}</textarea></label>
      </section>
      <div class="wiz-nav">
        <div class="wiz-buttons">
          <button type="button" class="btn secondary" data-wiz-back>Back</button>
          <button type="button" class="btn primary" data-wiz-next>Next</button>
          <button type="submit" class="btn primary wiz-save">Add person</button>
        </div>
        <button type="button" class="text-btn wiz-all-btn" data-wiz-all>See every question on one page</button>
      </div>
    </form>` : `<form class="form" novalidate>
      ${field('name', 'Name', v.name, 'autocomplete="off" placeholder="Who is it?" required')}
      <p class="field-error" data-error="name" hidden>Add a name first.</p>
      ${figurePickHTML(figureOf(v))}
      ${field('role', 'Role', v.role, 'list="roleList" autocomplete="off" placeholder="Casting director, editor, client"')}
      <datalist id="roleList">${ROLE_SUGGESTIONS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <div class="field"><label class="field-label" for="orgField">Organization</label>
        <input id="orgField" name="org" value="${esc(org ? org.name : '')}" autocomplete="off" placeholder="Agency, brand, publication"${S.orgs.length ? ' class="has-suggest" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="orgSuggest"' : ''}>
        <div class="suggest" id="orgSuggest" role="listbox" aria-label="Your organizations" hidden></div>
        <span class="field-hint">Pick one you've added, or type a new name to add it.${org && !isNew ? ' Changing it keeps a note of where they were before.' : ''}</span></div>
      <div class="picker-row"><span class="field-label">Circles</span>
        <button type="button" class="picker-btn" data-pick="circles"></button>
        <span class="field-hint">Your own groups, like Actors or Models. Someone can be in more than one.</span></div>
      <fieldset class="field"><legend class="field-label">Relationship (tick any that fit)</legend>
        <div class="warmth-options">${RELATIONSHIP_TYPES.map((r) => `<label class="warmth-option">
          <input type="checkbox" name="relationshipTypes" value="${r.key}"${relTypesOf(v).includes(r.key) ? ' checked' : ''}>
          <span class="warmth-option-body">${relLabel(r.key)}<span class="warmth-option-blurb">${esc(r.blurb)}</span></span>
        </label>`).join('')}</div>
        <p class="field-error" data-error="rel" hidden>Tick at least one.</p></fieldset>
      <fieldset class="field"><legend class="field-label">Warmth</legend>
        <div class="warmth-options">${WARMTH.map((w) => `<label class="warmth-option">
          <input type="radio" name="warmth" value="${w}"${v.warmth === w ? ' checked' : ''}>
          <span class="warmth-option-body">${warmthBadge(w)}<span class="warmth-option-blurb">${esc(WARMTH_INFO[w].blurb)}</span></span>
        </label>`).join('')}</div></fieldset>
      <div class="field">
        <label class="check"><input type="checkbox" name="lightTouch"${v.lightTouch ? ' checked' : ''}> ${LIGHT_ICON} Light touch</label>
        <span class="field-hint">For weak ties: every ${span(c.lightTouch)}, small gestures only, in a quiet spot at the bottom of Today.</span>
      </div>
      ${isNew ? `<fieldset class="field"><legend class="field-label">When should you first reach out?</legend>
        <div class="warmth-options first-options">${FIRST_CONTACT_OPTIONS.map((o) => `<label class="warmth-option">
          <input type="radio" name="firstContact" value="${o.key}"${firstDefault === o.key ? ' checked' : ''}>
          <span class="warmth-option-body"><span class="option-name">${esc(o.label)}</span><span class="warmth-option-blurb">${esc(o.blurb)}</span></span>
        </label>`).join('')}</div>
        <label class="field first-date"${firstDefault === 'pickDate' ? '' : ' hidden'}><span class="field-label">Date of the first touchpoint</span>
          <input type="date" name="firstDate" min="${todayStr()}"></label>
        <p class="field-error" data-error="firstDate" hidden>Pick a date for the first touchpoint.</p>
      </fieldset>` : `<label class="field"><span class="field-label">Next touchpoint</span>
        <input type="date" name="next" value="${esc(v.nextTouchpointDate || '')}">
        <span class="field-hint">Logging a touchpoint sets this for you.</span></label>`}
      <fieldset class="field connections-field"><legend class="field-label">Dream list and introductions</legend>
        <label class="check"><input type="checkbox" name="dreamList"${v.dreamList ? ' checked' : ''}> ${DREAM_STAR} On my dream list</label>
        <span class="field-hint">Someone you'd love to work with someday. No reminders until you first reach out, and a name is enough.</span>
        <div class="picker-row"><span class="field-label">Introduced by</span>
          <button type="button" class="picker-btn" data-pick="by"></button></div>
        <div class="picker-row"><span class="field-label">Could introduce me to</span>
          <button type="button" class="picker-btn" data-pick="could"></button></div>
      </fieldset>
      <details class="more" open>
        <summary>Contact details and notes</summary>
        ${field('email', 'Email', v.email, 'type="email" autocomplete="off" inputmode="email"')}
        ${field('phone', 'Phone', v.phone, 'type="tel" autocomplete="off"')}
        ${accountsFieldHTML(v)}
        ${field('website', 'Website', v.website, 'autocomplete="off" inputmode="url" placeholder="example.com"')}
        <label class="field"><span class="field-label">How we met</span><textarea name="howWeMet" rows="2" placeholder="Introduced by Sam at the Rialto screening">${esc(v.howWeMet || '')}</textarea></label>
        <label class="field"><span class="field-label">Notes</span><textarea name="notes" rows="3">${esc(v.notes || '')}</textarea></label>
        ${rhythmPickerHTML(v, 'Touchpoints')}
      </details>
      <button type="submit" class="modal-cta primary">Save changes</button>
      <button type="button" class="btn danger wide" data-delete>Delete person</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  wireRhythm(form);
  wireAccounts(form);
  if (isNew) wirePasteBox(form);
  if (isNew) wireWizard(s, form);
  wireOrgSuggest(form);
  // Introductions are picked in their own sheet and kept here until save.
  let introducedById = v.introducedById || null;
  let introducedByName = v.introducedByName || '';
  let canIntroduceToIds = [...(v.canIntroduceToIds || [])];
  let circleIds = [...(v.circleIds || [])];
  const self = p ? [p.id] : [];
  const showPicks = () => {
    const by = introducedById && S.personById.get(introducedById);
    form.querySelector('[data-pick="by"]').textContent = by ? by.name : introducedByName ? `${introducedByName} (not in Callback)` : 'Choose someone, or type a name';
    const names = namesOf(canIntroduceToIds);
    form.querySelector('[data-pick="could"]').textContent = names.length ? joinWords(names) : 'Choose people';
    const circles = S.circles.filter((c) => circleIds.includes(c.id)).map((c) => c.name);
    form.querySelector('[data-pick="circles"]').textContent = circles.length ? joinWords(circles) : 'Choose circles';
  };
  showPicks();
  // A new past client starts on Client warmth (every few months) rather than
  // the cold sequence, unless a warmth was picked by hand.
  if (isNew) {
    let warmthTouched = false;
    let autoClient = false;
    let autoDream = false;
    form.addEventListener('change', (e) => {
      if (e.target.name === 'firstContact') {
        const v2 = e.target.value;
        form.querySelector('.first-date').hidden = v2 !== 'pickDate';
        form.querySelector('[data-error="firstDate"]').hidden = true;
        const dream = form.querySelector('[name="dreamList"]');
        if (v2 === 'someday' && !dream.checked) {
          dream.checked = true;
          autoDream = true;
        } else if (v2 !== 'someday' && autoDream) {
          dream.checked = false;
          autoDream = false;
        }
        return;
      }
      if (e.target.name === 'dreamList') autoDream = false;
      if (e.target.name === 'warmth') {
        warmthTouched = true;
        autoClient = false;
      } else if (e.target.name === 'relationshipTypes' && e.target.value === 'pastClient' && !warmthTouched) {
        const past = e.target.checked;
        if (past || autoClient) form.querySelector(`[name="warmth"][value="${past ? 'client' : v.warmth || 'cold'}"]`).checked = true;
        autoClient = past;
      }
    });
  }
  // The default touchpoints option follows the warmth and light touch picked.
  const rhythmDefault = form.querySelector('[data-rhythm] option[value="default"]');
  form.addEventListener('change', (e) => {
    if (!rhythmDefault || !['warmth', 'lightTouch', 'relationshipTypes'].includes(e.target.name)) return;
    const w = form.querySelector('[name="warmth"]:checked');
    const light = form.querySelector('[name="lightTouch"]');
    rhythmDefault.textContent = rhythmDefaultText({ ...v, warmth: w ? w.value : v.warmth, lightTouch: light ? light.checked : !!v.lightTouch });
  });
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    if (b.dataset.pick === 'circles') {
      const ids = await circlePicker({ selected: circleIds });
      if (ids === null) return;
      circleIds = ids;
    } else if (b.dataset.pick === 'by') {
      const id = await peoplePicker({ title: 'Introduced by', selected: introducedById ? [introducedById] : [], exclude: self, allowName: true, typedName: introducedByName });
      if (id === null) return;
      if (id && typeof id === 'object') {
        // A typed name that matches someone already here links to them.
        const match = S.people.find((x) => !self.includes(x.id) && x.name.trim().toLowerCase() === id.name.toLowerCase());
        introducedById = match ? match.id : null;
        introducedByName = match ? '' : id.name;
      } else {
        introducedById = id || null;
        introducedByName = '';
      }
    } else {
      const ids = await peoplePicker({ title: 'Could introduce me to', multiple: true, selected: canIntroduceToIds, exclude: self });
      if (ids === null) return;
      canIntroduceToIds = ids;
    }
    showPicks();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const get = (k) => String(fd.get(k) || '').trim();
    const name = get('name');
    if (!name) {
      form.querySelector('[data-error="name"]').hidden = false;
      form.querySelector('[name="name"]').focus();
      return;
    }
    if (!fd.getAll('relationshipTypes').length) {
      form.querySelector('[data-error="rel"]').hidden = false;
      form.querySelector('[name="relationshipTypes"]').focus();
      return;
    }
    const override = readRhythm(form);
    if (override === undefined) return;
    const today = todayStr();
    const now = nowISO();

    const orgName = get('org');
    let organizationId = null;
    if (orgName) {
      const match = S.orgs.find((o) => o.name.trim().toLowerCase() === orgName.toLowerCase());
      organizationId = match ? match.id : (await db.saveOrganization({ name: orgName, type: 'other', website: '', notes: '' })).id;
    }
    const fields = {
      name,
      role: get('role'),
      organizationId,
      email: get('email'),
      phone: get('phone'),
      ...readAccounts(form),
      website: get('website'),
      howWeMet: get('howWeMet'),
      notes: get('notes'),
      cadenceOverrideDays: override,
      ...relFields(fd.getAll('relationshipTypes').map(String)),
      dreamList: !!fd.get('dreamList'),
      introducedById,
      introducedByName,
      canIntroduceToIds,
      circleIds: circleIds.filter((id) => S.circleById.has(id)),
      lightTouch: !!fd.get('lightTouch'),
      figure: figureOf({ figure: get('figure') }),
    };
    const warmth = get('warmth') || 'cold';
    const nextInput = /^\d{4}-\d{2}-\d{2}$/.test(get('next')) ? get('next') : '';

    let rec;
    if (isNew) {
      // When to first reach out decides the first date: today for just met
      // (with a two-day deadline) and reach out now, the picked day, or none
      // for someday, which joins the dream list.
      const firstContact = get('firstContact') || DEFAULT_FIRST_CONTACT;
      const firstDate = /^\d{4}-\d{2}-\d{2}$/.test(get('firstDate')) ? get('firstDate') : '';
      if (firstContact === 'pickDate' && !firstDate) {
        form.querySelector('[data-error="firstDate"]').hidden = false;
        form.querySelector('[name="firstDate"]').focus();
        return;
      }
      rec = {
        ...fields,
        ...warmthChangeFields({}, warmth, now, today),
        pastOrganizations: [],
        firstContact,
        firstContactDeadline: firstContact === 'justMet' ? addDays(today, JUST_MET_DAYS) : null,
        nextTouchpointDate: firstContact === 'someday' ? null : firstContact === 'pickDate' ? firstDate : today,
      };
      if (firstContact === 'someday') rec.dreamList = true;
      if (warmth === 'parked') rec.nextTouchpointDate = computeNextDate(rec, [], S.settings, today);
    } else {
      rec = { ...p, ...fields };
      if (p.organizationId && p.organizationId !== organizationId) {
        const old = S.orgById.get(p.organizationId);
        rec.pastOrganizations = [...(p.pastOrganizations || []), { organizationId: p.organizationId, name: old ? old.name : '', until: today }];
      }
      const warmthChanged = warmth !== p.warmth;
      if (warmthChanged) Object.assign(rec, warmthChangeFields(p, warmth, now, today));
      if (leavesLightTouch(p, rec)) rec.lightTouch = false;
      const rhythmChanged = (rec.cadenceOverrideDays || null) !== (p.cadenceOverrideDays || null);
      const lightChanged = rec.lightTouch !== !!p.lightTouch;
      if (nextInput && nextInput !== p.nextTouchpointDate) rec.nextTouchpointDate = nextInput;
      else if (lightChanged && !rec.lightTouch) Object.assign(rec, lightOffFields(rec, tpsOf(p.id), S.settings, today));
      else if (warmthChanged || rhythmChanged || lightChanged) rec.nextTouchpointDate = computeNextDate(rec, tpsOf(p.id), S.settings, today);
    }
    const saved = await db.savePerson(rec);
    db.askToPersist();
    s.close();
    if (isNew) {
      location.hash = `#/person/${saved.id}`;
      await refresh();
      if (saved.firstContact === 'alreadyDid') offerFirstLog(saved.id, name);
      else if (saved.firstContact === 'justMet') toast(`${name} added. ${followUpText(saved)}.`);
      else if (!saved.nextTouchpointDate) toast(`${name} added to your dream list.`);
      else toast(`${name} added. First touchpoint ${relDay(saved.nextTouchpointDate)}.`);
    } else {
      await refresh();
      toast(rec.nextTouchpointDate !== p.nextTouchpointDate ? `Saved. Next touchpoint ${fmtDate(rec.nextTouchpointDate)}.` : 'Saved');
    }
  });

  const del = s.body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      const n = tpsOf(p.id).length;
      const ok = await confirmSheet({
        title: `Delete ${p.name}?`,
        message: `This removes ${esc(p.name)}${n ? ` and ${plural(n, 'touchpoint')}` : ''} from Callback for good. To stop hearing about someone without losing their history, park them instead.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      await db.deletePerson(p.id);
      s.close();
      // Deleted from the panel beside Today's board: stay on Today.
      if (!boardOn()) location.hash = '#/people';
      await refresh();
      toast(`${p.name} deleted`);
    });
  }
}

// ---------------------------------------------------------------------------
// Sheets: log touchpoint

function whyText(p, tps, next) {
  const c = S.settings.cadence;
  const first = esc(firstName(p));
  if (p.warmth === 'parked') return `${first} is parked, so they come back in ${span(c.parked)}.`;
  if (checkInDate(p)) return `That's the check-in after the project. After it, ${first} goes back to the usual rhythm.`;
  const custom = Number(p.cadenceOverrideDays);
  if (custom > 0) return `That's your custom rhythm for ${first}: every ${span(custom)}.`;
  // The rhythm counts from their reply when it came after your touchpoint.
  const lastDay = tps.reduce((m, t) => (t.date > m ? t.date : m), '');
  const after = (lastContactDay(tps) || '') > lastDay ? 'their reply' : 'the latest touchpoint';
  if (p.lightTouch) return `${cap(span(c.lightTouch))} after ${after}, because ${first} is a light touch. A small gesture is enough.`;
  if (p.warmth === 'cold') {
    const { sent, replied } = coldState(p, tps);
    if (replied) return `${first} replied. Nice work.`;
    if (sent === 1) return `Follow-up in ${span(c.coldFollowUp)}. That's note 2 of ${COLD_STEPS} in the cold sequence.`;
    if (sent === 2) return `Last try in ${span(c.coldLastTry)}. That's note 3 of ${COLD_STEPS}.`;
    return `That was the last note in the cold sequence. If ${first} hasn't replied by ${esc(fmtDate(next))}, Callback will ask whether to park them.`;
  }
  return `${cap(span(c[p.warmth]))} after ${after}, because ${first} is ${warmthWord(p.warmth)}.`;
}

// `keep` is a promise of yours being kept: the promise shows on top, the note
// is only what's to add, and saving closes it with this touchpoint (keptBy).
// `onSave` runs once the touchpoint is saved.
function logSheet(p, { touchpoint = null, newsItem = null, note = '', onClose, keep = null, onSave = null } = {}) {
  if (!p) return;
  const editing = !!touchpoint;
  const today = todayStr();
  // A touchpoint that kept a promise shows it when edited, too.
  const kept = keep || (editing ? keptLoopOf(touchpoint) : null);
  // A typed idea is what you said you'd do, so it fills in what you did.
  // Any other idea is offered with "Use it" instead.
  const idea = editing || keep ? null : shownIdea(p);
  const preset = note || (newsItem ? `Their news: ${newsItem.description}` : '');
  const v = touchpoint || {
    type: S.meta.lastLogType && S.meta.lastLogType !== 'project_wrapped' ? S.meta.lastLogType : 'email',
    date: today,
    note: keep ? '' : preset || (idea.own ? idea.own : ''),
    responded: 'pending',
  };
  const offer = idea && idea.text && idea.text !== v.note ? idea.text : '';
  // When they replied: the day already saved, or today when an old
  // touchpoint is marked Replied now. A new log that's Replied straight away
  // is a back-and-forth, so it follows the When date until you change it.
  const replyDefault = replyDay(touchpoint) || (editing ? today : v.date);
  // Editing shows the promise made with this touchpoint, so it can be changed
  // or taken off, or one added that was missed when logging.
  const made = editing ? tpLoop(touchpoint) : null;
  const madeDir = made ? made.direction : LOOP_DIRECTIONS[0].key;
  const s = openSheet({
    title: editing ? 'Edit touchpoint' : keep ? 'Promise kept' : 'Log touchpoint',
    className: 'log-sheet',
    onClose,
    body: `<p class="sheet-person">${esc(p.name)}</p>
    ${kept ? `<p class="keep-quote">${editing ? '<b>Kept the promise:</b> ' : ''}${esc(kept.description)}</p>` : ''}
    <form class="form" novalidate>
      <fieldset class="field"><legend class="field-label">${kept ? `How did it get to ${esc(firstName(p))}?` : 'How did you reach out?'}</legend>
        <div class="chip-choices">${TOUCH_TYPES.filter((t) => t.key !== 'project_wrapped' || v.type === 'project_wrapped').map((t) => `<label class="chip-choice"><input type="radio" name="type" value="${t.key}"${v.type === t.key ? ' checked' : ''}><span>${esc(t.label)}</span></label>`).join('')}</div>
      </fieldset>
      <label class="field"><span class="field-label">When</span><input type="date" name="date" value="${esc(v.date)}" required></label>
      <div class="field">
        <label class="field"><span class="field-label">${kept ? 'Anything to add? (optional)' : 'What you sent or said'}</span>
          <textarea name="note" class="log-note" rows="1" maxlength="280" enterkeyhint="done" placeholder="${kept ? 'Framed it too' : 'Sent three frames from the beach test'}">${esc(v.note || '')}</textarea></label>
        ${offer ? `<p class="field-hint log-idea"><span>${idea.own ? 'Your idea' : 'Idea'}: ${esc(offer)}</span> <button type="button" class="text-btn inline" data-use-idea>Use it</button></p>` : ''}
      </div>
      <fieldset class="field"><legend class="field-label">Did they reply?</legend>
        <div class="seg">${RESPONDED.map((r) => `<label class="seg-option"><input type="radio" name="responded" value="${r.key}"${(v.responded || 'pending') === r.key ? ' checked' : ''}><span>${esc(r.label)}</span></label>`).join('')}</div>
      </fieldset>
      <label class="field" data-reply-day-field${v.responded === 'yes' ? '' : ' hidden'}><span class="field-label">When did they reply?</span>
        <input type="date" name="replyDay" value="${esc(replyDefault)}" min="${esc(v.date)}" max="${today}"></label>
      ${kept ? '' : `<fieldset class="field"><legend class="field-label">How did they seem? (optional)</legend>
        <input type="hidden" name="interest" value="${esc(v.interest || '')}">
        <div class="interest-picks">${INTEREST_LEVELS.map((i) => `<button type="button" class="interest-pick${v.interest === i.key ? ' is-on' : ''}" data-interest="${i.key}" aria-pressed="${v.interest === i.key}">${interestIcon(i.key)}<span>${esc(i.label)}</span></button>`).join('')}</div>
      </fieldset>`}
      ${kept && !made ? '' : `<div class="field promise-field">
        <label class="field"><span class="field-label">Anything promised? (optional)</span>
          <input name="promise" maxlength="140" autocomplete="off" value="${esc(made ? made.description : '')}" placeholder="Send her a print of the window frame"></label>
        ${made ? `<label class="check-row"><input type="checkbox" class="loop-box" name="promiseKept"${made.status === 'closed' ? ' checked' : ''}><span>${isLetGo(made) ? 'Let go' : made.direction === 'iOwe' ? 'Promise kept' : 'They came through'}</span></label>` : ''}
        <div class="promise-more"${made ? '' : ' hidden'}>
          <div class="seg">${LOOP_DIRECTIONS.map((d) => `<label class="seg-option"><input type="radio" name="promiseDir" value="${d.key}"${madeDir === d.key ? ' checked' : ''}><span>${esc(d.label)}</span></label>`).join('')}</div>
          <label class="field"><span class="field-label">By when? (optional)</span><input type="date" name="promiseDue" value="${esc(made && made.dueDate ? made.dueDate : '')}"></label>
        </div>
      </div>`}
      ${editing ? '<button type="button" class="btn danger wide" data-delete>Delete touchpoint</button>' : ''}
      <button type="submit" class="modal-cta primary">${editing ? 'Save changes' : keep ? 'Save' : 'Save touchpoint'}</button>
      ${keep ? '<button type="button" class="text-btn keep-only" data-keep-only>Mark it kept without logging</button>' : ''}
    </form>`,
  });
  const form = s.body.querySelector('form');
  const noteField = form.querySelector('[name="note"]');
  fitHeight(noteField);
  noteField.addEventListener('keydown', (e) => {
    // It wraps to fit, but stays one line of text: Enter just closes the keyboard.
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      noteField.blur();
    }
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-use-idea]')) {
      const cur = noteField.value.trim();
      noteField.value = (cur ? `${cur.replace(/[\s.]+$/, '')}. ${offer}` : offer).slice(0, 280);
      e.target.closest('.log-idea').remove();
      fitHeight(noteField);
      noteField.focus();
      return;
    }
    const b = e.target.closest('[data-interest]');
    if (!b) return;
    const field = form.querySelector('[name="interest"]');
    field.value = field.value === b.dataset.interest ? '' : b.dataset.interest;
    form.querySelectorAll('[data-interest]').forEach((x) => {
      const on = x.dataset.interest === field.value;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', String(on));
    });
  });
  // "When did they reply?" shows only with Replied picked, and can't be
  // before the touchpoint itself.
  const replyField = form.querySelector('[name="replyDay"]');
  const dateField = form.querySelector('[name="date"]');
  let replyTouched = editing;
  form.querySelectorAll('[name="responded"]').forEach((r) => r.addEventListener('change', () => {
    form.querySelector('[data-reply-day-field]').hidden = form.querySelector('[name="responded"]:checked').value !== 'yes';
  }));
  replyField.addEventListener('change', () => { replyTouched = true; });
  dateField.addEventListener('change', () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateField.value)) return;
    replyField.min = dateField.value;
    if (!replyTouched || replyField.value < dateField.value) replyField.value = dateField.value;
  });
  const promise = form.querySelector('[name="promise"]');
  if (promise) {
    promise.addEventListener('input', () => {
      form.querySelector('.promise-more').hidden = !promise.value.trim();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get('date'))) ? String(fd.get('date')) : today;
    const responded = String(fd.get('responded') || 'pending');
    const type = String(fd.get('type') || 'other');
    let respondedAt = touchpoint ? touchpoint.respondedAt || null : null;
    if (responded === 'yes') {
      // Between the touchpoint and today. An unchanged day keeps its time.
      const raw = String(fd.get('replyDay') || '');
      const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? [date, [raw, today].sort()[0]].sort().pop() : today;
      if (!respondedAt || replyDay({ responded, respondedAt }) !== day) respondedAt = replyISO(day, today);
    } else {
      respondedAt = null;
    }

    const before = tpsOf(p.id);
    const tp = await db.saveTouchpoint({
      ...(touchpoint || {}),
      personId: p.id,
      type,
      date,
      note: String(fd.get('note') || '').replace(/\s*\n+\s*/g, ' ').trim(),
      responded,
      respondedAt,
      interest: form.querySelector('[name="interest"]') ? String(fd.get('interest') || '') || null : (touchpoint && touchpoint.interest) || null,
      lightTouch: touchpoint ? !!touchpoint.lightTouch : !!p.lightTouch,
    });
    const all = sortTouchpoints([...before.filter((t) => t.id !== tp.id), tp]);
    // A new touchpoint always resets the schedule. An edit only does when it
    // touches the latest touchpoint, so a snooze survives fixing an old typo.
    // Otherwise a reply marked on an older touchpoint can still move a date
    // that came from the rhythm (followRhythm).
    const touchesLatest = !editing || all[0].id === tp.id || (before[0] && before[0].id === tp.id);
    // After Wrap project, the next touchpoint is the check-in: it ends the
    // wait and the usual rhythm takes over. Sending the wrap's own selects
    // or thank-you (keeping that promise) doesn't count, nor does one dated
    // before the wrap.
    const wrap = lastWrap(before);
    const keepsWrap = !!keep && !!wrap && keep.touchpointId === wrap.id;
    const endsCheckIn = !editing && !!checkInDate(p) && type !== 'project_wrapped' && !keepsWrap && (!wrap || date >= wrap.date);
    const forNext = endsCheckIn ? { ...p, postProjectCheckIn: null } : p;
    const next = touchesLatest ? computeNextDate(forNext, all, S.settings, today) : followRhythm(forNext, before, all);
    // Logging a new touchpoint uses up a typed idea; fixing an old one doesn't.
    const clearedIdea = !editing && !!(p.customIdea || '').trim();
    // How they seemed at their latest touchpoint becomes their current interest.
    const interest = tp.interest && (!editing || all[0].id === tp.id) ? { interest: tp.interest } : {};
    let person = await db.savePerson({ ...p, nextTouchpointDate: next, ...(clearedIdea ? { customIdea: '' } : {}), ...interest, ...(endsCheckIn ? { postProjectCheckIn: null } : {}) });
    if (newsItem) await db.saveNews({ ...newsItem, dismissedAt: nowISO() });
    if (keep) {
      const cur = S.loops.find((x) => x.id === keep.id) || keep;
      await db.saveOpenLoop({ ...cur, status: 'closed', closedAt: nowISO(), outcome: 'kept', keptBy: tp.id });
    }
    if (onSave) await onSave(tp);
    // "Anything promised?" becomes an open loop alongside the touchpoint.
    const promiseOn = !!form.querySelector('[name="promise"]');
    const promised = String(fd.get('promise') || '').trim();
    let loop = null;
    let promiseNote = '';
    if (!promiseOn) {
      // Promise kept: no new promise asked for here.
    } else if (promised) {
      const due = String(fd.get('promiseDue') || '');
      const fields = {
        personId: p.id,
        touchpointId: tp.id,
        direction: String(fd.get('promiseDir') || 'iOwe'),
        description: promised,
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
      };
      if (!made) {
        loop = await db.saveOpenLoop({ ...fields, status: 'open', closedAt: null });
        promiseNote = 'added';
      } else {
        // The Promise kept box: unticked opens it again, ticked closes it
        // as kept (nothing more logged).
        const box = form.querySelector('[name="promiseKept"]');
        const shut = made.status === 'closed';
        const flip = box && box.checked !== shut
          ? (box.checked ? { status: 'closed', closedAt: nowISO(), outcome: 'kept', keptBy: null } : OPEN_AGAIN)
          : null;
        if (flip || ['touchpointId', 'direction', 'description', 'dueDate'].some((k) => (made[k] || null) !== fields[k])) {
          await db.saveOpenLoop({ ...made, ...fields, ...(flip || {}) });
          promiseNote = flip ? (box.checked ? 'kept' : 'reopened') : 'saved';
        }
      }
    } else if (made) {
      await db.deleteOpenLoop(made.id);
      promiseNote = 'removed';
    }
    const lightEnded = !!loop && person.lightTouch;
    if (lightEnded) person = await db.savePerson({ ...person, ...lightOffFields(person, all, S.settings, today) });
    db.setMeta('lastLogType', type);
    db.askToPersist();
    await refresh();

    if (editing) {
      s.close();
      if (promiseNote === 'removed') {
        toast('Touchpoint saved. Promise taken off.', { action: { label: 'Undo', run: async () => { await db.saveOpenLoop(made); await refresh(); } } });
      } else if (lightEnded) {
        toast(`Touchpoint and promise saved. ${firstName(person)} is off light touch now, since something real is in motion.`);
      } else if (promiseNote === 'reopened') {
        toast('Touchpoint saved. The promise is open again.');
      } else if (promiseNote === 'kept') {
        toast('Touchpoint saved. Promise kept.');
      } else {
        toast(promiseNote ? 'Touchpoint and promise saved' : 'Touchpoint saved');
      }
      return;
    }
    showLogged(s, person, all, { clearedIdea, loop, lightEnded, kept: keep });
  });

  const keepOnly = s.body.querySelector('[data-keep-only]');
  if (keepOnly) {
    keepOnly.addEventListener('click', async () => {
      const cur = S.loops.find((x) => x.id === keep.id) || keep;
      await db.saveOpenLoop({ ...cur, status: 'closed', closedAt: nowISO(), outcome: 'kept', keptBy: null });
      s.close();
      await refresh();
      toast('Promise kept', { action: { label: 'Undo', run: () => reopenLoop(S.loops.find((x) => x.id === keep.id), { quiet: true }) } });
    });
  }

  const del = s.body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      const ok = await confirmSheet({
        title: 'Delete this touchpoint?',
        message: kept ? 'It comes off the timeline for good, and the promise it kept is open again.' : 'It comes off the timeline for good.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      const before = tpsOf(p.id);
      await db.deleteTouchpoint(touchpoint.id);
      await reopenKept([touchpoint.id]);
      const rest = before.filter((t) => t.id !== touchpoint.id);
      // Taking away the wrap takes away the check-in it set up.
      const unwraps = touchpoint.type === 'project_wrapped' && !!checkInDate(p) && !lastWrap(rest);
      const forNext = unwraps ? { ...p, postProjectCheckIn: null } : p;
      if (unwraps || (before[0] && before[0].id === touchpoint.id)) {
        await db.savePerson({ ...forNext, nextTouchpointDate: computeNextDate(forNext, rest, S.settings, today) });
      }
      await refresh();
      s.close();
      toast(kept ? 'Touchpoint deleted. The promise is open again.' : 'Touchpoint deleted');
    });
  }
}

// Deleting the touchpoint that kept a promise opens the promise again.
async function reopenKept(ids) {
  const gone = new Set(ids);
  for (const l of S.loops) {
    if (l.status === 'closed' && l.keptBy && gone.has(l.keptBy)) await db.saveOpenLoop({ ...l, ...OPEN_AGAIN });
  }
}

function showLogged(s, p, tps, { clearedIdea = false, loop = null, lightEnded = false, kept = null } = {}) {
  const next = p.nextTouchpointDate;
  const name = esc(firstName(p));
  let prompt = '';
  if (p.warmth === 'parked') {
    const back = p.warmthBeforePark && p.warmthBeforePark !== 'parked' ? p.warmthBeforePark : 'warm';
    prompt = promptBox(`${name} is still parked. Bring them back as ${warmthWord(back)}?`, `<button type="button" class="btn primary" data-sheet-act="unpark">Bring back</button>`);
  } else if (needsWarmPrompt(p, tps)) {
    prompt = promptBox(`${name} replied. Move them to Warm?`, `<button type="button" class="btn primary" data-sheet-act="make-warm">Move to Warm</button>`);
  } else if (p.firstContact === 'justMet' && p.warmth === 'cold' && tps.length === 1) {
    prompt = promptBox(`You met ${name} in person, so they may be warmer than Cold. Move them to Warm?`, `<button type="button" class="btn primary" data-sheet-act="make-warm">Move to Warm</button>`);
  } else if (needsParkPrompt(p, tps) && tps.length && tps[0].responded === 'no') {
    prompt = promptBox(`No reply to any of the ${COLD_STEPS} notes. Park ${name} now?`, `<button type="button" class="btn primary" data-sheet-act="park">Park ${name}</button>`);
  }
  s.setTitle('Logged');
  s.body.innerHTML = `<div class="logged">
    <div class="logged-check">${CHECK}</div>
    <p class="logged-title">${kept ? `Promise kept for ${esc(p.name)}.` : `Touchpoint saved for ${esc(p.name)}.`}</p>
    <section class="next-panel compact">
      <p class="next-label">${esc(nextLabelText(p.warmth === 'parked' ? 'Comes back' : 'Next touchpoint', next))}</p>
      <p class="next-date">${esc(fmtDate(next))}</p>
    </section>
    <p class="logged-why">${whyText(p, tps, next)}</p>
    ${clearedIdea ? '<p class="logged-why">Your typed idea is used up, so fresh suggestions show next time.</p>' : ''}
    ${loop ? `<p class="logged-why">${loopIcon(loop.direction)} Open loop added: ${esc(loop.description)}${loop.dueDate ? `, by ${esc(fmtDate(loop.dueDate))}` : ''}.</p>` : ''}
    ${lightEnded ? `<p class="logged-why">${LIGHT_ICON} ${name} is off light touch now, since something real is in motion.</p>` : ''}
    ${prompt}
    <div class="sheet-actions">
      <button type="button" class="btn secondary" data-sheet-act="change-date">Change date</button>
      <button type="button" class="btn primary" data-close>Done</button>
    </div>
  </div>`;
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sheet-act]');
    if (!b) return;
    const fresh = S.personById.get(p.id);
    if (b.dataset.sheetAct === 'change-date') {
      s.close();
      dateSheet(fresh);
    } else if (b.dataset.sheetAct === 'make-warm') {
      s.close();
      await setWarmth(fresh, 'warm');
    } else if (b.dataset.sheetAct === 'park') {
      s.close();
      await setWarmth(fresh, 'parked');
    } else if (b.dataset.sheetAct === 'unpark') {
      s.close();
      const back = fresh.warmthBeforePark && fresh.warmthBeforePark !== 'parked' ? fresh.warmthBeforePark : 'warm';
      await setWarmth(fresh, back);
    }
  });
}

// ---------------------------------------------------------------------------
// Sheets: dates, snooze, warmth, news, organizations, reflections

function newsChoice(n, today = todayStr()) {
  return {
    key: `news:${n.id}`,
    label: `Their news: ${n.description}`,
    detail: `${fmtDate(n.date)}, ${n.date === today ? 'today' : relDay(n.date, today)}`,
    icon: NEWS_ICON,
  };
}

// Moves the next touchpoint to a date, with an undo.
// extra: other fields saved with it (a new rhythm from Change date), undone too.
async function moveNext(p, d, message, extra = {}) {
  const prev = { nextTouchpointDate: p.nextTouchpointDate };
  for (const k of Object.keys(extra)) prev[k] = p[k] ?? null;
  await db.savePerson({ ...p, ...extra, nextTouchpointDate: d });
  await refresh();
  toast(message, {
    action: {
      label: 'Undo',
      run: async () => {
        const cur = S.personById.get(p.id);
        if (cur) await db.savePerson({ ...cur, ...prev });
        await refresh();
      },
    },
  });
}

// Change date. Under the date sits their rhythm (11-10): tap it to pick
// another rhythm. Until the date is changed by hand it follows the new
// rhythm, so the date shown is what Save keeps.
function dateSheet(p) {
  if (!p) return;
  const news = upcomingNews(p);
  const parked = p.warmth === 'parked';
  const s = openSheet({
    title: parked ? 'Bring back on' : 'Next touchpoint',
    className: 'sheet-small',
    body: `<form class="form" novalidate>
      <label class="field"><span class="field-label">Reach out to ${esc(p.name)} on</span>
        <input type="date" name="date" value="${esc(p.nextTouchpointDate || todayStr())}" required></label>
      ${parked ? '' : `<div class="date-rhythm">
        <button type="button" class="date-rhythm-now" data-rhythm-open><span class="field-label">Rhythm</span>
          <span class="date-rhythm-line"><span>${esc(cadenceLabel(p, tpsOf(p.id), S.settings))}</span><span class="date-rhythm-change">Change</span></span></button>
        <div class="date-rhythm-pick" hidden>${rhythmPickerHTML(p)}</div>
      </div>`}
      <button type="submit" class="modal-cta primary">Save date</button>
      ${news.length ? `<div class="news-picks">
        <p class="field-label">Or time it with their news</p>
        <div class="choice-list">${news.map((n) => {
          const c = newsChoice(n);
          return `<button type="button" class="choice" data-news-date="${esc(n.date)}" data-news-text="${esc(n.description)}">${c.icon}<span class="choice-text"><span class="choice-label">${esc(n.description)}</span><span class="choice-detail">${esc(c.detail)}</span></span></button>`;
        }).join('')}</div>
      </div>` : ''}
    </form>`,
  });
  const form = s.body.querySelector('form');
  const dateIn = form.querySelector('[name="date"]');
  const pick = form.querySelector('.date-rhythm-pick');
  let dateTouched = false;
  dateIn.addEventListener('input', () => { dateTouched = true; });
  if (pick) {
    wireRhythm(form);
    form.querySelector('[data-rhythm-open]').addEventListener('click', (e) => {
      e.currentTarget.hidden = true;
      pick.hidden = false;
      pick.querySelector('[data-rhythm]').focus();
    });
    // The date follows the rhythm being picked, unless it was set by hand.
    const follow = () => {
      if (dateTouched) return;
      const sel = form.querySelector('[data-rhythm]');
      const n = sel.value === 'default' ? null : sel.value === 'custom' ? parseInt(form.querySelector('[name="override"]').value, 10) : Number(sel.value);
      if (sel.value === 'custom' && !(n >= 1 && n <= 3650)) return;
      const d = computeNextDate({ ...p, cadenceOverrideDays: n }, tpsOf(p.id), S.settings, todayStr());
      if (d) dateIn.value = d;
    };
    form.querySelector('[data-rhythm]').addEventListener('change', follow);
    form.querySelector('[name="override"]').addEventListener('input', follow);
  }
  // A new rhythm picked here, saved with the date; undefined when Custom
  // has no sensible number yet (the error shows).
  const rhythmExtra = () => {
    if (!pick || pick.hidden) return {};
    const n = readRhythm(form);
    if (n === undefined) return undefined;
    return (n || null) !== (p.cadenceOverrideDays || null) ? { cadenceOverrideDays: n } : {};
  };
  const rhythmNote = (extra) => ('cadenceOverrideDays' in extra ? `. Rhythm: ${rhythmWords({ ...p, ...extra }, S.settings)}` : '');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = String(new FormData(e.target).get('date') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const extra = rhythmExtra();
    if (!extra) return;
    s.close();
    await moveNext(p, d, `Next touchpoint ${fmtDate(d)}${rhythmNote(extra)}`, extra);
  });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-news-date]');
    if (!b) return;
    const extra = rhythmExtra();
    if (!extra) return;
    s.close();
    await moveNext(p, b.dataset.newsDate, `Next touchpoint ${fmtDate(b.dataset.newsDate)}, for their news: ${b.dataset.newsText}${rhythmNote(extra)}`, extra);
  });
}

async function snoozeSheet(p) {
  if (!p) return;
  const today = todayStr();
  const news = upcomingNews(p, today);
  const key = await choiceSheet({
    title: `Snooze ${p.name}`,
    message: news.length
      ? 'They leave Today until the new date. Their news is often the best moment to reach out.'
      : 'They leave Today until the new date.',
    options: [
      ...news.map((n) => newsChoice(n, today)),
      ...SNOOZE_OPTIONS.map((o) => ({ key: o.key, label: o.label, detail: fmtDate(o.apply(today)) })),
      { key: 'pick', label: 'Pick a date', detail: 'Choose any day' },
    ],
  });
  if (!key) return;
  if (key === 'pick') {
    dateSheet(p);
    return;
  }
  if (key.startsWith('news:')) {
    const n = news.find((x) => `news:${x.id}` === key);
    await moveNext(p, n.date, `Next touchpoint ${fmtDate(n.date)}, for their news: ${n.description}`);
    return;
  }
  const d = snoozeDate(key, today);
  await moveNext(p, d, `Snoozed until ${fmtDate(d)}`);
}

// Changes warmth and recalculates the next date from the latest touchpoint.
// Quietly: the new status shows on the page, so no pop-up after it.
async function setWarmth(p, warmth) {
  if (!p || p.warmth === warmth) return;
  const today = todayStr();
  const rec = { ...p, ...warmthChangeFields(p, warmth, nowISO(), today) };
  // Becoming Active or a client is something real, so light touch ends,
  // without making them overdue.
  const endsLight = leavesLightTouch(p, rec);
  if (endsLight) Object.assign(rec, lightOffFields(rec, tpsOf(p.id), S.settings, today));
  else rec.nextTouchpointDate = computeNextDate(rec, tpsOf(p.id), S.settings, today);
  await db.savePerson(rec);
  await refresh();
}

// Tapping the drawing on someone's page: pick how they're drawn, no words.
function figureSheet(p) {
  if (!p) return;
  const cur = figureOf(p);
  const s = openSheet({
    title: "How they're drawn",
    className: 'sheet-small fig-sheet',
    body: `<p class="hint">How ${esc(firstName(p))} looks on People and in circles.</p>
      <div class="buddy-row fig-row">${FIGURES.map(([k, label]) => `<button type="button" class="buddy-option${k === cur ? ' is-on' : ''}" data-fig="${k}" aria-pressed="${k === cur}" aria-label="${esc(label)}">${figureSVG(k, 'fig-choice-pic', 170)}</button>`).join('')}</div>`,
  });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fig]');
    if (!b) return;
    s.close();
    const fresh = S.personById.get(p.id);
    if (!fresh || figureOf(fresh) === b.dataset.fig) return;
    await db.savePerson({ ...fresh, figure: b.dataset.fig });
    await refresh();
  });
}

// Tick any that fit; at least one stays ticked.
function relationshipPicker(p) {
  return new Promise((resolve) => {
    let result = null;
    const now = relTypesOf(p);
    const s = openSheet({
      title: "What's this relationship?",
      className: 'sheet-small has-footer',
      body: `<p class="sheet-message">Tick any that fit. This shapes the touchpoint ideas; how often you reach out still follows their warmth.</p>
        <div class="warmth-options">${RELATIONSHIP_TYPES.map((r) => `<label class="warmth-option">
          <input type="checkbox" value="${r.key}"${now.includes(r.key) ? ' checked' : ''}>
          <span class="warmth-option-body">${relLabel(r.key)}<span class="warmth-option-blurb">${esc(r.blurb)}</span></span>
        </label>`).join('')}</div>
        <p class="field-error" data-error="rel" hidden>Tick at least one.</p>
        <div class="sheet-footer"><button type="button" class="modal-cta primary" data-done>Done</button></div>`,
      onClose: () => resolve(result),
    });
    s.body.addEventListener('change', () => { s.body.querySelector('[data-error="rel"]').hidden = true; });
    s.body.querySelector('[data-done]').addEventListener('click', () => {
      const picked = [...s.body.querySelectorAll('input:checked')].map((x) => x.value);
      if (!picked.length) {
        s.body.querySelector('[data-error="rel"]').hidden = false;
        return;
      }
      result = picked;
      s.close();
    });
  });
}

async function relationshipSheet(p) {
  if (!p) return;
  const picked = await relationshipPicker(p);
  if (!picked) return;
  const fields = relFields(picked);
  if (fields.relationshipTypes.join() === relTypesOf(p).join()) return;
  const rec = { ...p, ...fields };
  const endsLight = leavesLightTouch(p, rec);
  if (endsLight) Object.assign(rec, lightOffFields(rec, tpsOf(p.id), S.settings, todayStr()));
  await db.savePerson(rec);
  await refresh();
}

async function warmthSheet(p) {
  if (!p) return;
  const key = await choiceSheet({
    title: `How well do you know ${firstName(p)}?`,
    message: 'Callback works out the next touchpoint from their latest one.',
    options: [
      ...WARMTH.map((w) => ({ key: w, label: WARMTH_INFO[w].label, detail: WARMTH_INFO[w].blurb, icon: warmthIcon(w), current: p.warmth === w })),
      // A project just finished: wrap it instead (back to Warm, with a follow-up).
      { key: 'wrap', label: 'Wrap a project', detail: 'A project just finished. Back to Warm, with a thank-you and a check-in.', icon: WRAP_ICON },
    ],
  });
  if (key === 'wrap') wrapSheet(S.personById.get(p.id) || p);
  else if (key) await setWarmth(p, key);
}

async function unpark(p) {
  const today = todayStr();
  const back = p.warmthBeforePark && p.warmthBeforePark !== 'parked' ? p.warmthBeforePark : 'warm';
  const rec = { ...p, ...warmthChangeFields(p, back, nowISO(), today), nextTouchpointDate: today };
  await db.savePerson(rec);
  await refresh();
}

async function repark(p) {
  const today = todayStr();
  const next = addDays(today, S.settings.cadence.parked);
  await db.savePerson({ ...p, parkedOn: today, nextTouchpointDate: next });
  await refresh();
}

function newsSheet(p, n) {
  const editing = !!n;
  const s = openSheet({
    title: editing ? 'Edit date' : 'Add a date',
    className: 'sheet-small',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form" novalidate>
      <label class="field"><span class="field-label">What's happening?</span>
        <input name="description" list="newsList" value="${esc(n ? n.description : '')}" autocomplete="off" placeholder="Show premieres" required></label>
      <datalist id="newsList">${NEWS_SUGGESTIONS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="field-error" data-error="description" hidden>Say what's happening.</p>
      <label class="field"><span class="field-label">When</span><input type="date" name="date" value="${esc(n ? n.date : todayStr())}" required></label>
      <label class="check"><input type="checkbox" name="repeatsYearly"${n && n.repeatsYearly ? ' checked' : ''}> Repeats every year</label>
      ${editing ? '<button type="button" class="btn danger wide" data-delete>Delete date</button>' : ''}
      <button type="submit" class="modal-cta primary">${editing ? 'Save' : 'Add date'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const description = String(fd.get('description') || '').trim();
    const date = String(fd.get('date') || '');
    if (!description) {
      form.querySelector('[data-error="description"]').hidden = false;
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const repeatsYearly = !!fd.get('repeatsYearly');
    const rec = { ...(n || {}), personId: p.id, description, date, repeatsYearly };
    if (n && (n.date !== date || n.repeatsYearly !== repeatsYearly)) rec.dismissedAt = null;
    await db.saveNews(rec);
    s.close();
    await refresh();
    const shows = repeatsYearly ? nextYearly(date, todayStr()) : date;
    toast(editing ? 'Saved' : repeatsYearly
      ? `Added. It comes back every year, a week early under Coming up.`
      : `Added. It shows on Today ${relDay(shows)}.`);
  });
  const del = s.body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      await db.deleteNews(n.id);
      s.close();
      await refresh();
      toast('Date deleted');
    });
  }
}

function orgForm(o) {
  const isNew = !o;
  const v = o || { type: 'agency' };
  const s = openSheet({
    title: isNew ? 'Add organization' : 'Edit organization',
    body: `<form class="form" novalidate>
      <label class="field"><span class="field-label">Name</span><input name="name" value="${esc(v.name || '')}" autocomplete="off" required></label>
      <p class="field-error" data-error="name" hidden>Add a name first.</p>
      <label class="field"><span class="field-label">Type</span>
        <select name="type">${ORG_TYPES.map((t) => `<option value="${t.key}"${v.type === t.key ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Website</span><input name="website" value="${esc(v.website || '')}" autocomplete="off" inputmode="url" placeholder="example.com"></label>
      <label class="field"><span class="field-label">Notes</span><textarea name="notes" rows="3">${esc(v.notes || '')}</textarea></label>
      ${isNew ? '' : '<button type="button" class="btn danger wide" data-delete>Delete organization</button>'}
      <button type="submit" class="modal-cta primary">${isNew ? 'Add organization' : 'Save changes'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) {
      form.querySelector('[data-error="name"]').hidden = false;
      return;
    }
    const clash = S.orgs.find((x) => x.name.trim().toLowerCase() === name.toLowerCase() && (!o || x.id !== o.id));
    if (clash) {
      toast(`${clash.name} is already in Callback.`);
      return;
    }
    const saved = await db.saveOrganization({
      ...(o || {}),
      name,
      type: String(fd.get('type') || 'other'),
      website: String(fd.get('website') || '').trim(),
      notes: String(fd.get('notes') || '').trim(),
    });
    s.close();
    if (isNew) location.hash = `#/org/${saved.id}`;
    await refresh();
    toast(isNew ? `${name} added` : 'Saved');
  });
  const del = s.body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      const n = S.people.filter((p) => p.organizationId === o.id).length;
      const ok = await confirmSheet({
        title: `Delete ${o.name}?`,
        message: n ? `The ${plural(n, 'person', 'people')} here stay in Callback, just without an organization.` : 'Nobody is linked to it.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      await db.deleteOrganization(o.id);
      s.close();
      location.hash = '#/orgs';
      await refresh();
      toast(`${o.name} deleted`);
    });
  }
}

// An earlier week's points, with the same box and list as this week.
function reflectionSheet(ws) {
  const s = openSheet({
    title: `Week of ${weekRange(ws)}`,
    body: `<p class="field-label points-label">What worked that week?</p>
      ${pointsEditorHTML(ws)}
      <button type="button" class="modal-cta primary" data-close>Done</button>`,
    // Whatever is still being typed in the box is kept too.
    onClose: async () => {
      const input = s.body.querySelector('[data-point-new]');
      if (input && pointText(input.value)) addPoint(s.body.querySelector('.points'), { keepFocus: false });
      await pointsQueue;
      render();
    },
  });
}

async function setResponse(t) {
  const key = await choiceSheet({
    title: 'Did they reply?',
    options: RESPONDED.map((r) => ({ key: r.key, label: r.label, current: (t.responded || 'pending') === r.key })),
  });
  if (!key || key === t.responded) return;
  await markResponse(t, key);
}

// When a reply came in, as a timestamp. Today keeps the moment you marked it;
// an earlier day is stored at noon so it stays that day in any time zone.
function replyISO(day, today = todayStr()) {
  if (day >= today) return nowISO();
  const d = parseDate(day);
  d.setHours(12);
  return d.toISOString();
}

// A reply moves the person's next touchpoint only when that date came from
// their rhythm. A snoozed or hand-picked date stays as it is.
function followRhythm(p, beforeTps, afterTps) {
  const was = computeNextDate(p, beforeTps, S.settings);
  return p.nextTouchpointDate === was ? computeNextDate(p, afterTps, S.settings) : p.nextTouchpointDate;
}

// "Replied today", with a Change button that swaps in a date field for a
// reply that came in earlier. `onDay` hears each new day.
function replyWhenHTML(t, today) {
  const canChange = t.date < today;
  return `<div class="reply-when">
    <span class="reply-when-text">Replied <span data-reply-label>today</span></span>
    ${canChange ? `<button type="button" class="text-btn inline" data-reply-change>Change</button>
    <span class="field reply-when-field" hidden><input type="date" data-reply-day value="${today}" min="${esc(t.date)}" max="${today}" aria-label="When they replied"></span>` : ''}
  </div>`;
}

function wireReplyWhen(root, t, today, onDay) {
  const btn = root.querySelector('[data-reply-change]');
  if (!btn) return;
  const wrap = root.querySelector('.reply-when-field');
  const input = wrap.querySelector('[data-reply-day]');
  btn.addEventListener('click', () => {
    btn.hidden = true;
    root.querySelector('[data-reply-label]').hidden = true;
    wrap.hidden = false;
    input.focus();
    try { input.showPicker(); } catch { /* the field is there to tap */ }
  });
  input.addEventListener('change', () => {
    const v = input.value;
    onDay(/^\d{4}-\d{2}-\d{2}$/.test(v) ? [t.date, [v, today].sort()[0]].sort().pop() : today);
  });
}

// A reply came in: when, and how did they seem? How they seemed goes on the
// touchpoint and becomes the person's current interest, since a reply is the
// freshest sign. Closing the popup skips the interest but keeps the day.
async function askReply(t) {
  const p = S.personById.get(t.personId);
  const today = todayStr();
  let day = today;
  const interest = await choiceSheet({
    title: 'How did they seem?',
    message: `In ${p ? esc(firstName(p)) : 'their'}${p ? "'s" : ''} reply. This shapes the touchpoint ideas.`,
    extra: replyWhenHTML(t, today),
    onOpen: (s) => wireReplyWhen(s.body, t, today, (d) => { day = d; }),
    options: INTEREST_LEVELS.map((i) => ({ key: i.key, label: i.label, detail: i.blurb, icon: interestIcon(i.key), current: t.interest === i.key })),
  });
  return { interest, day };
}

async function markResponse(t, key) {
  const { interest, day } = key === 'yes' ? await askReply(t) : { interest: null, day: null };
  const respondedAt = key === 'yes' ? replyISO(day) : null;
  const saved = await db.saveTouchpoint({ ...t, responded: key, respondedAt, ...(interest ? { interest } : {}) });
  const p0 = S.personById.get(t.personId);
  if (p0) {
    const before = tpsOf(p0.id);
    const next = followRhythm(p0, before, before.map((x) => (x.id === saved.id ? saved : x)));
    const fields = { ...(interest && p0.interest !== interest ? { interest } : {}), ...(next !== p0.nextTouchpointDate ? { nextTouchpointDate: next } : {}) };
    if (Object.keys(fields).length) await db.savePerson({ ...p0, ...fields });
  }
  await refresh();
  const p = S.personById.get(t.personId);
  if (key === 'yes' && p && p.warmth === 'cold') {
    toast(`${firstName(p)} replied.`, { action: { label: 'Move to Warm', run: () => setWarmth(S.personById.get(p.id), 'warm') } });
  } else if (p && p0 && p.nextTouchpointDate !== p0.nextTouchpointDate && p.nextTouchpointDate) {
    toast(`Marked as ${respondedLabel(key).toLowerCase()}. Next touchpoint ${fmtDate(p.nextTouchpointDate)}.`);
  } else {
    toast(`Marked as ${respondedLabel(key).toLowerCase()}`);
  }
}

// ---------------------------------------------------------------------------
// Export, import, calendar

function pickFile(accept, onFile) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.remove();
    if (f) onFile(f);
  });
  input.click();
}

async function exportJSON() {
  const data = await db.exportAll();
  const ok = await saveFile(`callback-backup-${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
  if (!ok) return;
  await db.setMeta('lastExportAt', data.exportedAt);
  await db.setMeta('exportReminderUntil', null);
  await refresh();
  toast('Backup saved');
}

function importJSON() {
  pickFile('.json,application/json', async (file) => {
    let payload;
    let data;
    try {
      payload = JSON.parse(await readFileText(file));
      data = db.readExport(payload);
    } catch (err) {
      toast(err instanceof SyntaxError ? "That file isn't a Callback backup." : err.message);
      return;
    }
    const parts = [
      plural(data.people.length, 'person', 'people'),
      plural(data.organizations.length, 'organization'),
      plural(data.touchpoints.length, 'touchpoint'),
      plural(data.news.length, 'news date'),
    ];
    const s = openSheet({
      title: 'Import backup',
      body: `<p class="sheet-message">${esc(file.name)} has ${esc(parts.join(', '))}${payload.exportedAt ? `, exported ${esc(fmtTimestamp(payload.exportedAt))}` : ''}.</p>
      <form class="form">
        <fieldset class="field"><legend class="field-label">How should it come in?</legend>
          <label class="radio-card"><input type="radio" name="mode" value="merge" checked>
            <span><b>Merge with what's here</b><br>Anything in both keeps whichever copy was changed most recently.</span></label>
          <label class="radio-card"><input type="radio" name="mode" value="replace">
            <span><b>Replace everything</b><br>Clears this device first, then loads the backup exactly.</span></label>
        </fieldset>
        <button type="submit" class="modal-cta primary">Import</button>
      </form>`,
    });
    s.body.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const mode = String(new FormData(e.target).get('mode'));
      if (mode === 'replace' && S.people.length) {
        const ok = await confirmSheet({
          title: 'Replace everything?',
          message: `The ${plural(S.people.length, 'person', 'people')} on this device now are removed, then the backup is loaded in their place.`,
          confirmLabel: 'Replace',
          danger: true,
        });
        if (!ok) return;
      }
      try {
        const counts = await db.importAll(payload, mode);
        s.close();
        await refresh();
        toast(mode === 'replace' ? 'Backup restored' : `Merged. ${plural(counts.people, 'person', 'people')} added or updated.`);
      } catch (err) {
        toast(err.message || 'The import did not finish. Nothing was changed.');
      }
    });
  });
}

function staggeredDates(n, perDay, start) {
  const out = [];
  let d = start;
  let used = 0;
  while (out.length < n) {
    const dow = parseDate(d).getDay();
    if (dow === 0 || dow === 6) {
      d = addDays(d, 1);
      continue;
    }
    out.push(d);
    if (++used >= perDay) {
      used = 0;
      d = addDays(d, 1);
    }
  }
  return out;
}

// Where the contacts come from: the phone's own picker when the browser
// offers one, otherwise (and always on iPhone) a contacts file.
function contactsSheet() {
  const picker = canPickContacts();
  const ios = isIOS();
  const steps = ios
    ? `<li>Open the <b>Contacts</b> app and tap <b>Lists</b>.</li>
       <li>Touch and hold <b>All Contacts</b>, or a smaller list, then tap <b>Export</b>.</li>
       <li>Tap <b>Save to Files</b>.</li>
       <li>Come back here and choose that file.</li>`
    : `<li>Export your contacts as a vCard (.vcf) file. Google Contacts, Outlook and most phone contacts apps have an Export option.</li>
       <li>Come back here and choose that file.</li>`;
  const s = openSheet({
    title: 'Add from your contacts',
    className: 'sheet-small',
    body: `
      ${picker ? `<p class="sheet-message">Pick people straight from your phone's contacts.</p>
        <button type="button" class="modal-cta primary" data-pick>Choose from contacts</button>
        <p class="or-line">Or use a contacts file</p>` : ''}
      <p class="sheet-message">${ios
        ? "iPhone doesn't let web apps open Contacts directly, but Contacts can hand Callback a copy in a few taps:"
        : 'Your contacts app can save a copy of your contacts for Callback to read:'}</p>
      <ol class="steps">${steps}</ol>
      <button type="button" class="${picker ? 'secondary small-btn' : 'modal-cta primary'}" data-file>Choose a contacts file</button>
      <p class="hint">Nothing is added until you tick who you want.</p>`,
  });

  s.body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pick]')) {
      let list;
      try {
        list = await pickContacts();
      } catch {
        toast("Your phone didn't share any contacts.");
        return;
      }
      if (!list.length) return;
      s.close();
      contactChooser(list, { preselect: true });
    } else if (e.target.closest('[data-file]')) {
      pickFile('.vcf,text/vcard,text/x-vcard,text/directory', async (file) => {
        let list = [];
        try {
          list = parseVCards(await readFileText(file));
        } catch {
          /* falls through to the message below */
        }
        if (!list.length) {
          toast("No contacts found in that file. It needs to be a .vcf contacts file.");
          return;
        }
        s.close();
        contactChooser(list, { preselect: false });
      });
    }
  });
}

// A tick list of contacts. People already in Callback (same email or name)
// show but can't be ticked. Picked-on-the-phone contacts start ticked, a
// whole address book starts empty.
function contactChooser(list, { preselect }) {
  const emails = new Set(S.people.map((p) => (p.email || '').toLowerCase()).filter(Boolean));
  const names = new Set(S.people.map((p) => p.name.toLowerCase()));
  const seen = new Set();
  const items = [...list]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => {
      const key = `${c.name.toLowerCase()}|${c.email.toLowerCase()}`;
      const dup = (c.email && emails.has(c.email.toLowerCase())) || names.has(c.name.toLowerCase()) || seen.has(key);
      seen.add(key);
      return { c, dup };
    });
  const chosen = new Set(preselect ? items.map((x, i) => (x.dup ? -1 : i)).filter((i) => i >= 0) : []);
  const dups = items.filter((x) => x.dup).length;
  const perDay = Math.max(1, Math.ceil(S.settings.goals.touchpoints / 5));
  let warmth = 'warm';
  let rel = DEFAULT_RELATIONSHIP;

  const row = (x, i) => {
    const sub = [x.c.role, x.c.org].filter(Boolean).join(', ') || [x.c.email, x.c.phone].find((v) => v && v !== x.c.name) || '';
    const find = esc([x.c.name, x.c.org, x.c.role, x.c.email].join(' ').toLowerCase());
    if (x.dup) {
      return `<div class="pick-row is-dup" data-find="${find}"><span class="pick-box" aria-hidden="true"></span>
        <span class="pick-main"><span class="pick-name">${esc(x.c.name)}</span><span class="pick-sub">Already in Callback</span></span></div>`;
    }
    return `<label class="pick-row" data-find="${find}"><input type="checkbox" data-i="${i}"${chosen.has(i) ? ' checked' : ''}>
      <span class="pick-main"><span class="pick-name">${esc(x.c.name)}</span>${sub ? `<span class="pick-sub">${esc(sub)}</span>` : ''}</span></label>`;
  };

  const s = openSheet({
    title: 'Choose who to add',
    className: 'sheet-wide has-footer',
    body: `
      <p class="sheet-message">${plural(items.length, 'contact')}${dups ? `, ${dups} already in Callback` : ''}. Tick the people you want to keep in touch with, or nobody.</p>
      <label class="field"><span class="field-label">Warmth for everyone you add</span>
        <select data-warmth>${WARMTH.map((w) => `<option value="${w}"${w === warmth ? ' selected' : ''}>${esc(WARMTH_INFO[w].label)}: ${esc(WARMTH_INFO[w].blurb)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Relationship for everyone you add</span>
        <select data-rel>${RELATIONSHIP_TYPES.map((r) => `<option value="${r.key}"${r.key === rel ? ' selected' : ''}>${esc(r.label)}: ${esc(r.blurb)}</option>`).join('')}</select></label>
      ${items.length > 8 ? '<input type="search" class="search pick-search" data-q placeholder="Search contacts" autocomplete="off" aria-label="Search contacts">' : ''}
      <div class="pick-tools">
        <button type="button" class="text-btn" data-all>Tick all shown</button>
        <button type="button" class="text-btn" data-none>Untick all</button>
      </div>
      <div class="pick-list">${items.map(row).join('')}</div>
      <div class="sheet-footer">
        <p class="field-hint">Their first touchpoints are spread across the coming weekdays, about ${perDay} a day.</p>
        <button type="button" class="modal-cta primary" data-go></button>
      </div>`,
  });
  const go = s.body.querySelector('[data-go]');
  const update = () => {
    go.textContent = chosen.size ? `Add ${plural(chosen.size, 'person', 'people')}` : 'Tick someone to add';
    go.disabled = !chosen.size;
  };
  update();

  s.body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-i]')) {
      if (t.checked) chosen.add(Number(t.dataset.i));
      else chosen.delete(Number(t.dataset.i));
      update();
    } else if (t.matches('[data-warmth]')) warmth = t.value;
    else if (t.matches('[data-rel]')) rel = t.value;
  });

  s.body.addEventListener('input', (e) => {
    if (!e.target.matches('[data-q]')) return;
    const q = e.target.value.trim().toLowerCase();
    s.body.querySelectorAll('.pick-row').forEach((r) => {
      r.hidden = !!q && !r.dataset.find.includes(q);
    });
  });

  s.body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-all], [data-none]')) {
      const on = !!e.target.closest('[data-all]');
      s.body.querySelectorAll('.pick-row:not([hidden]) input[data-i]').forEach((box) => {
        box.checked = on;
        if (on) chosen.add(Number(box.dataset.i));
        else chosen.delete(Number(box.dataset.i));
      });
      update();
      return;
    }
    if (!e.target.closest('[data-go]') || !chosen.size) return;
    go.disabled = true;
    const picked = [...chosen].sort((a, b) => a - b).map((i) => items[i].c);
    const n = await addPeople(picked, warmth, rel);
    s.close();
    location.hash = '#/people';
    await refresh();
    toast(`${plural(n, 'person', 'people')} added`);
  });
}

// Saves contacts as people: matches or creates their organizations, and
// spreads first touchpoints over the coming weekdays.
async function addPeople(contacts, warmth, relationshipType = DEFAULT_RELATIONSHIP) {
  const today = todayStr();
  const now = nowISO();
  const orgIds = new Map(S.orgs.map((o) => [o.name.trim().toLowerCase(), o.id]));
  for (const c of contacts) {
    const key = c.org.trim().toLowerCase();
    if (key && !orgIds.has(key)) {
      const o = await db.saveOrganization({ name: c.org.trim(), type: 'other', website: '', notes: '' });
      orgIds.set(key, o.id);
    }
  }
  const dates = staggeredDates(contacts.length, Math.max(1, Math.ceil(S.settings.goals.touchpoints / 5)), today);
  const people = contacts.map((c, i) => {
    const rec = {
      name: c.name,
      email: c.email,
      phone: c.phone,
      role: c.role,
      instagram: c.instagram,
      website: c.website,
      howWeMet: '',
      notes: c.notes,
      birthday: c.birthday || null,
      details: [],
      organizationId: c.org ? orgIds.get(c.org.trim().toLowerCase()) : null,
      ...relFields([relationshipType]),
      cadenceOverrideDays: null,
      pastOrganizations: [],
      ...warmthChangeFields({}, warmth, now, today),
      nextTouchpointDate: dates[i],
    };
    if (warmth === 'parked') rec.nextTouchpointDate = computeNextDate(rec, [], S.settings, today);
    return rec;
  });
  const saved = await db.savePeople(people);
  for (const p of saved) if (p.birthday) await syncBirthdayNews(p);
  db.askToPersist();
  return people.length;
}

async function exportICS() {
  const events = calendarEvents();
  if (!events.length) {
    toast('Nothing is scheduled in the next 90 days.');
    return;
  }
  const ok = await saveFile(`callback-calendar-${todayStr()}.ics`, buildCalendar(events), 'text/calendar');
  if (ok) toast(`Calendar file saved with ${plural(events.length, 'event')}`);
}

// ---------------------------------------------------------------------------
// Event wiring

const person = (el) => S.personById.get(el.dataset.id);

const ACTIONS = {
  'pick-green': (el) => pickGreen(el.dataset.green),
  'add-person': (el) => personForm(null, {
    ...(el.dataset.org ? { organizationId: el.dataset.org } : {}),
    ...(el.dataset.dream ? { dreamList: true } : {}),
  }),
  'dream-notes': (el) => notesSheet(person(el)),
  'edit-contact': (el) => contactSheet(person(el), el.dataset.field),
  'edit-accounts': (el) => accountsSheet(person(el)),
  'add-missing-detail': async (el) => {
    const p = person(el);
    if (!p) return;
    const missing = missingDetails(p);
    const key = missing.length === 1 ? missing[0].key : await choiceSheet({ title: 'Add', extra: `<p class="sheet-person">${esc(p.name)}</p>`, options: missing.map((m) => ({ key: m.key, label: m.label })) });
    if (!key) return;
    if (key === 'accounts') accountsSheet(p);
    else if (key === 'birthday') birthdaySheet(p);
    else contactSheet(p, key);
  },
  'edit-person': (el) => personForm(person(el)),
  'quick-add': () => quickAddSheet(),
  'light-off': (el) => endLightTouch(person(el)),
  'toggle-light': (el) => {
    const p = person(el);
    if (p) (p.lightTouch ? endLightTouch(p) : startLightTouch(p));
  },
  'dream-off': (el) => endDream(person(el)),
  'toggle-dream': (el) => {
    const p = person(el);
    if (p) (p.dreamList ? endDream(p) : startDream(p));
  },
  'dismiss-engage': async (el) => {
    const p = person(el);
    const latest = p && tpsOf(p.id)[0];
    if (!latest) return;
    await db.savePerson({ ...p, engagePromptDismissed: latest.id });
    await refresh();
  },
  'filter-light': (el) => {
    const f = el.dataset.scope === 'circle' ? S.ui.circle : S.ui.people;
    f.light = !f.light;
    render();
  },
  log: (el) => logSheet(person(el), { newsItem: el.dataset.news ? S.news.find((n) => n.id === el.dataset.news) : null }),
  snooze: (el) => snoozeSheet(person(el)),
  'change-date': (el) => dateSheet(person(el)),
  'open-person': (el) => {
    if (boardOn() && el.closest('.board')) pickPerson(el.dataset.id);
    else location.hash = `#/person/${el.dataset.id}`;
  },
  'close-pick': () => closePick(),
  'close-person': () => { location.hash = '#/people'; },
  'change-warmth': (el) => warmthSheet(person(el)),
  'change-rel': (el) => relationshipSheet(person(el)),
  'change-figure': (el) => figureSheet(person(el)),
  park: (el) => setWarmth(person(el), 'parked'),
  'make-warm': (el) => setWarmth(person(el), 'warm'),
  unpark: (el) => unpark(person(el)),
  repark: (el) => repark(person(el)),
  'next-idea': async (el) => {
    const p = person(el);
    if ((p.customIdea || '').trim()) {
      const ok = await confirmSheet({
        title: 'Remove your idea?',
        message: `The idea you typed for ${esc(firstName(p))} will be removed, and Callback's suggestions come back.`,
        confirmLabel: 'Remove it',
        cancelLabel: 'Keep it',
      });
      if (!ok) return;
      await db.savePerson({ ...p, customIdea: '' });
      await refresh();
      toast('Your idea was removed');
      return;
    }
    S.ui.ideaTurn.set(p.id, (S.ui.ideaTurn.get(p.id) || 0) + 1);
    el.closest('.idea').querySelector('.idea-text').textContent = shownIdea(p).text;
  },
  'type-idea': (el) => ideaSheet(person(el)),
  'hide-idea': async (el) => {
    const p = person(el);
    const text = el.closest('.idea').querySelector('.idea-text').textContent;
    const typed = el.dataset.typed === '1';
    const ok = await confirmSheet({
      title: 'Remove this suggestion for good?',
      message: `\u201c${esc(text)}\u201d won't be suggested again. You can bring removed suggestions back in Settings.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    // A typed idea only joins the library if it was saved there.
    if (!typed || isOwnIdea(text)) await removeSuggestion(text);
    if (typed) await db.savePerson({ ...p, customIdea: '' });
    await refresh();
    toast('Suggestion removed');
  },
  'remove-own-idea': async (el) => {
    const r = S.ideas.find((x) => x.id === el.dataset.id);
    if (!r) return;
    const ok = await confirmSheet({
      title: 'Remove this suggestion for good?',
      message: `\u201c${esc(r.text)}\u201d won't be suggested again. You can bring it back below.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await db.saveIdea({ ...r, hidden: true });
    await refresh();
    toast('Suggestion removed');
  },
  'add-suggestion': () => suggestionSheet(),
  'restore-ideas': async () => {
    const hidden = S.ideas.filter((r) => r.hidden);
    if (!hidden.length) return;
    const ok = await confirmSheet({
      title: 'Bring back removed suggestions?',
      message: `${plural(hidden.length, 'suggestion')} you removed will show up again.`,
      confirmLabel: 'Bring them back',
    });
    if (!ok) return;
    await db.saveIdeas(hidden.map((r) => ({ ...r, hidden: false })));
    await refresh();
    toast(`${plural(hidden.length, 'suggestion')} back`);
  },
  'edit-birthday': (el) => birthdaySheet(person(el)),
  'edit-rhythm': (el) => rhythmSheet(person(el)),
  'edit-met': (el) => metSheet(person(el)),
  'wrap-project': (el) => wrapSheet(person(el)),
  'add-detail': (el) => detailSheet(person(el)),
  'remove-detail': async (el) => {
    const p = S.personById.get(el.dataset.person);
    const d = (p.details || []).find((x) => x.id === el.dataset.id);
    if (!d) return;
    const ok = await confirmSheet({ title: `Remove ${esc(d.label || 'this detail')}?`, message: esc(d.value), confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await db.savePerson({ ...p, details: p.details.filter((x) => x.id !== d.id) });
    await refresh();
    toast('Detail removed');
  },
  'add-loop': (el) => loopSheet(person(el)),
  'edit-loop': (el) => {
    const l = S.loops.find((x) => x.id === el.dataset.id);
    if (l) loopSheet(S.personById.get(l.personId), l);
  },
  'close-loop': (el) => closeLoop(S.loops.find((x) => x.id === el.dataset.id)),
  'loop-not-yet': (el) => notYetSheet(S.loops.find((x) => x.id === el.dataset.id)),
  'dismiss-news': async (el) => {
    const n = S.news.find((x) => x.id === el.dataset.id);
    if (!n) return;
    await db.saveNews({ ...n, dismissedAt: nowISO() });
    await refresh();
    toast('Dismissed', {
      action: {
        label: 'Undo',
        run: async () => {
          await db.saveNews({ ...n, dismissedAt: null });
          await refresh();
        },
      },
    });
  },
  'add-news': (el) => newsSheet(person(el), null),
  'edit-news': (el) => {
    const n = S.news.find((x) => x.id === el.dataset.id);
    if (n) newsSheet(S.personById.get(n.personId), n);
  },
  'edit-tp': (el) => {
    const t = S.tps.find((x) => x.id === el.dataset.id);
    if (t) logSheet(S.personById.get(t.personId), { touchpoint: t });
  },
  'set-response': (el) => {
    const t = S.tps.find((x) => x.id === el.dataset.id);
    if (t) setResponse(t);
  },
  'reply-mark': (el) => {
    const t = S.tps.find((x) => x.id === el.dataset.id);
    if (t) markResponse(t, el.dataset.key);
  },
  'reply-later': async (el) => {
    const t = S.tps.find((x) => x.id === el.dataset.id);
    if (!t) return;
    await db.saveTouchpoint({ ...t, replyCheckAt: nowISO() });
    await refresh();
    toast('Callback will ask again in two days.');
  },
  'stat-sheet': (el) => statSheet(el.dataset.stat),
  'add-circle': () => circleSheet(),
  'edit-circle': (el) => circleSheet(S.circleById.get(el.dataset.id)),
  'toggle-reorder': () => {
    S.ui.circlesReorder = !S.ui.circlesReorder;
    render();
  },
  'move-circle': async (el) => {
    const list = [...S.circles];
    const i = list.findIndex((c) => c.id === el.dataset.id);
    const j = i + Number(el.dataset.dir);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await db.saveCircles(list.map((c, n) => ({ ...c, sortOrder: n })).filter((c, n) => list[n].sortOrder !== n));
    await refresh();
    const again = view.querySelector(`[data-action="move-circle"][data-id="${el.dataset.id}"][data-dir="${el.dataset.dir}"]:not(:disabled)`);
    if (again) again.focus();
  },
  'circle-add-people': async (el) => {
    const c = S.circleById.get(el.dataset.id);
    if (!c) return;
    const ids = await peoplePicker({ title: `People in ${c.name}`, multiple: true, selected: membersOf(c.id).map((p) => p.id) });
    if (ids === null) return;
    const want = new Set(ids);
    const changed = S.people
      .filter((p) => want.has(p.id) !== p.circleIds.includes(c.id))
      .map((p) => ({ ...p, circleIds: want.has(p.id) ? [...p.circleIds, c.id] : p.circleIds.filter((x) => x !== c.id) }));
    if (!changed.length) return;
    await db.savePeople(changed);
    await refresh();
    toast(`${plural(want.size, 'person', 'people')} in ${c.name}`);
  },
  'remove-from-circle': async (el) => {
    const p = person(el);
    const c = S.circleById.get(el.dataset.circle);
    if (!p || !c) return;
    await db.savePerson({ ...p, circleIds: p.circleIds.filter((x) => x !== c.id) });
    await refresh();
    toast(`${firstName(p)} left ${c.name}`, {
      action: {
        label: 'Undo',
        run: async () => {
          const now = S.personById.get(p.id);
          if (!now || now.circleIds.includes(c.id)) return;
          await db.savePerson({ ...now, circleIds: [...now.circleIds, c.id] });
          await refresh();
        },
      },
    });
  },
  'change-circles': async (el) => {
    const p = person(el);
    const ids = await circlePicker({ title: `${firstName(p)}'s circles`, selected: p.circleIds });
    if (ids !== null) await db.savePerson({ ...p, circleIds: ids });
    // A circle made in the picker shows up either way.
    await refresh();
    if (ids !== null) toast('Circles saved');
  },
  'add-org': () => orgForm(null),
  'edit-org': (el) => orgForm(S.orgById.get(el.dataset.id)),
  back: (el) => {
    S.ui.goingBack = true;
    if (S.ui.backTo) history.back();
    else location.hash = el.dataset.fallback || '#/today';
  },
  'toggle-fold': (el) => {
    const on = el.getAttribute('aria-expanded') !== 'true';
    S.ui.folds.set(el.dataset.key, on);
    el.classList.toggle('collapsed', !on);
    el.setAttribute('aria-expanded', String(on));
    el.nextElementSibling.hidden = !on;
  },
  'toggle-section': (el) => {
    const k = el.dataset.key;
    if (S.ui.collapsed.has(k)) S.ui.collapsed.delete(k);
    else S.ui.collapsed.add(k);
    el.classList.toggle('collapsed');
    el.setAttribute('aria-expanded', String(!S.ui.collapsed.has(k)));
    el.nextElementSibling.hidden = S.ui.collapsed.has(k);
    el.nextElementSibling.querySelectorAll('textarea.pd-value').forEach(fitHeight);
  },
  'toggle-sort': (el) => {
    const ui = el.dataset.scope === 'circle' ? S.ui.circle : S.ui.people;
    ui.sortOpen = !ui.sortOpen;
    render();
  },
  'set-sort': (el) => {
    const ui = el.dataset.scope === 'circle' ? S.ui.circle : S.ui.people;
    // A new sort starts in its usual order.
    if (ui.sort !== el.dataset.sort) ui.reverse = false;
    ui.sort = el.dataset.sort;
    saveListSorts();
    render();
  },
  'set-order': (el) => {
    const ui = el.dataset.scope === 'circle' ? S.ui.circle : S.ui.people;
    ui.reverse = el.dataset.reverse === '1';
    saveListSorts();
    render();
  },
  'toggle-filters': () => {
    S.ui.people.filtersOpen = !S.ui.people.filtersOpen;
    render();
  },
  'filter-interest': (el) => {
    const set = S.ui.people.interest;
    if (set.has(el.dataset.i)) set.delete(el.dataset.i);
    else set.add(el.dataset.i);
    render();
  },
  'filter-dream': () => {
    S.ui.people.dream = !S.ui.people.dream;
    render();
  },
  'filter-loops': () => {
    S.ui.people.loops = !S.ui.people.loops;
    render();
  },
  'filter-pending': () => {
    S.ui.people.pending = !S.ui.people.pending;
    render();
  },
  'filter-rel': (el) => {
    const set = S.ui.people.rel;
    if (set.has(el.dataset.r)) set.delete(el.dataset.r);
    else set.add(el.dataset.r);
    render();
  },
  'filter-warmth': (el) => {
    const w = el.dataset.w;
    const set = S.ui.people.warmth;
    if (set.has(w)) set.delete(w);
    else set.add(w);
    render();
  },
  'filter-circle': (el) => {
    const set = S.ui.people.circles;
    if (set.has(el.dataset.c)) set.delete(el.dataset.c);
    else set.add(el.dataset.c);
    render();
  },
  'circles-view': () => toggleMapView('circles'),
  'today-view': () => {
    S.ui.thoughtKey = null;
    toggleMapView('today');
  },
  'face-settings': () => {
    closeFaceMenu();
    openSettings();
  },
  'face-buddy': () => {
    closeFaceMenu();
    buddySheet();
  },
  'face-help': () => {
    closeFaceMenu();
    helpSheet();
  },
  'tour-yes': () => answerWelcome(true),
  'tour-no': () => answerWelcome(false),
  'tour-start': () => startTour(),
  'tour-next': () => nextTourStep(),
  'tour-end': () => endTour(),
  'close-thought': () => {
    S.ui.thoughtKey = null;
    render();
  },
  'orgs-view': () => toggleMapView('orgs'),
  'map-out': (el) => {
    if (history.state && history.state.fromMap) history.back();
    else location.hash = el.dataset.to;
  },
  'people-view': () => {
    S.ui.people.view = S.ui.people.view === 'list' ? 'ring' : 'list';
    try { localStorage.setItem('callback.peopleView', S.ui.people.view); } catch { /* this device only */ }
    render();
  },
  'clear-search': (el) => {
    const input = document.getElementById(el.dataset.for);
    if (!input) return;
    input.value = '';
    input.blur();
    searchTyped(input);
  },
  'clear-filters': () => {
    Object.assign(S.ui.people, { q: '', warmth: new Set(), rel: new Set(), interest: new Set(), circles: new Set(), loops: false, pending: false, dream: false, light: false, role: '', org: '' });
    render();
  },
  'edit-reflection': (el) => reflectionSheet(el.dataset.week),
  'export-json': () => exportJSON(),
  'import-json': () => importJSON(),
  'import-contacts': () => contactsSheet(),
  'export-ics': () => exportICS(),
  'remind-later': async () => {
    await db.setMeta('exportReminderUntil', addDays(todayStr(), 7));
    await refresh();
    toast("I'll remind you next week.");
  },
  'recalc-all': async () => {
    const ok = await confirmSheet({
      title: "Recalculate everyone's next date?",
      message: 'Each person gets a fresh date from their latest touchpoint and the cadence settings. Snoozes and dates you picked yourself are replaced.',
      confirmLabel: 'Recalculate',
    });
    if (!ok) return;
    const today = todayStr();
    const changed = S.people
      .map((p) => ({ p, next: computeNextDate(p, tpsOf(p.id), S.settings, today) }))
      .filter(({ p, next }) => next !== p.nextTouchpointDate)
      .map(({ p, next }) => ({ ...p, nextTouchpointDate: next }));
    if (changed.length) await db.savePeople(changed);
    await refresh();
    toast(changed.length ? `Updated ${plural(changed.length, 'person', 'people')}` : 'Everyone was already up to date');
  },
  'sync-setup': () => syncSheet(),
  'sync-conflicts': () => conflictSheet(),
  'sync-now': async (el) => {
    el.disabled = true;
    el.textContent = 'Syncing...';
    try {
      const r = await sync.queued();
      await refresh();
      if (r.newConflicts) conflictSheet();
      else toast(r.changedHere ? 'Synced. Changes from your other devices are in.' : 'Synced. Everything was already up to date.');
    } catch (e) {
      await refresh();
      toast(e.message);
    }
  },
  'sync-off': async () => {
    const ok = await confirmSheet({
      title: 'Turn off sync?',
      message: 'Everything stays on this device; it just stops catching up with your other devices. The key is forgotten here, and the repository keeps its copy.',
      confirmLabel: 'Turn off sync',
    });
    if (!ok) return;
    await sync.turnOff();
    await refresh();
    toast('Sync is off on this device.');
  },
  'erase-all': async () => {
    const ok = await confirmSheet({
      title: 'Erase everything?',
      message: `This deletes all ${plural(S.people.length, 'person', 'people')}, touchpoints, organizations and notes from this device${S.meta.sync ? ', and turns sync off here (your repository keeps its copy)' : ''}. Export a backup first if you might want them back.`,
      confirmLabel: 'Erase everything',
      danger: true,
    });
    if (!ok) return;
    await db.eraseAll();
    await db.setMeta('installedAt', nowISO());
    location.hash = '#/today';
    await refresh();
    toast('Everything was erased');
  },
  install: async () => {
    if (!S.installPrompt) return;
    S.installPrompt.prompt();
    await S.installPrompt.userChoice.catch(() => null);
    S.installPrompt = null;
    render();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !(view.contains(el) || el.closest('.thought-sheet, .settings-sheet, [data-acts]'))) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

// Section headings act like buttons from the keyboard too, and Enter in an
// in-place detail field saves it.
document.addEventListener('keydown', (e) => {
  // Enter in the People or Orgs search puts the keyboard away so the results show.
  if (e.key === 'Enter' && !e.isComposing && (e.target.id === 'peopleSearch' || e.target.id === 'orgSearch')) {
    e.preventDefault();
    e.target.blur();
    return;
  }
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-detail-field]')) {
    e.preventDefault();
    e.target.blur();
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('h2[data-action]')) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches && t.matches('textarea.pd-value, textarea.log-note, textarea.point-input')) fitHeight(t);
  if (t.matches && t.matches('input[data-handle]') && !e.isComposing) {
    // The @ goes in with the first letter. Typing or pasting a link drops it.
    const was = t.value;
    let now = was.replace(/^\s+/, '').replace(/^@+/, '@');
    if (now.startsWith('@') && looksLikeLink(now.slice(1))) now = now.slice(1);
    else if (now) now = atHandle(now);
    if (now !== was) {
      const caret = Math.max(0, (t.selectionStart ?? was.length) + now.length - was.length);
      t.value = now;
      t.setSelectionRange(caret, caret);
    }
  }
  if (t.id === 'peopleSearch' || t.id === 'orgSearch') searchTyped(t);
});

// The People or Orgs search changed: show what matches.
function searchTyped(t) {
  if (t.id === 'peopleSearch') {
    S.ui.people.q = t.value;
    updatePeopleList();
  } else if (t.id === 'orgSearch') {
    S.ui.orgsQ = t.value;
    const list = document.getElementById('orgList');
    const tmp = document.createElement('div');
    tmp.innerHTML = renderOrgs();
    const fresh = tmp.querySelector('#orgList');
    if (list && fresh) {
      if (fresh.querySelector('[data-map-slot]') || fresh.className !== list.className) {
        list.replaceWith(fresh);
        mountMapIn(fresh);
      } else list.innerHTML = fresh.innerHTML;
    }
    markSelected();
  }
  placeSearchClear();
}

// What worked: Enter adds a point (or finishes an edit), a tap on a point
// edits it, and leaving an edited point saves it. Works on Weekly review and
// in the sheet for an earlier week.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || !t.matches || !t.matches('textarea.point-input')) return;
  e.preventDefault();
  if (t.dataset.pointEditing) t.blur();
  else addPoint(t.closest('.points'));
});
document.addEventListener('click', (e) => {
  const edit = e.target.closest('[data-point-edit]');
  if (edit) startPointEdit(edit);
  const add = e.target.closest('[data-point-add]');
  if (add) addPoint(add.closest('.points'));
});
document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (!t.matches) return;
  if (t.matches('textarea[data-point-editing]')) finishPointEdit(t);
  // Typed but not added yet: keep it rather than lose it on the way out.
  else if (t.matches('textarea[data-point-new]') && pointText(t.value) && t.isConnected) addPoint(t.closest('.points'), { keepFocus: false });
});
// Tapping Add keeps the keyboard up for the next point.
document.addEventListener('mousedown', (e) => {
  if (e.target.closest && e.target.closest('[data-point-add]')) e.preventDefault();
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!view.contains(t) && !t.closest('.settings-sheet')) return;
  if (t.dataset.detailField) {
    const p = S.personById.get(t.dataset.person);
    if (!p) return;
    const details = (p.details || []).map((d) => (d.id === t.dataset.id ? { ...d, [t.dataset.detailField]: t.value.trim() } : d));
    savePersonQuietly({ ...p, details }).then(() => toast('Saved'));
  } else if (t.dataset.loopToggle) {
    const l = S.loops.find((x) => x.id === t.dataset.loopToggle);
    if (t.checked) closeLoop(l);
    else reopenLoop(l);
  } else if (t.dataset.filter === 'parked') {
    S.ui.people.showParked = t.checked;
    if (!t.checked) S.ui.people.warmth.delete('parked');
    render();
  } else if (t.dataset.filter) {
    S.ui.people[t.dataset.filter] = t.value;
    render();
  } else if (t.dataset.setting) {
    saveSetting(t.dataset.setting, t.value);
  } else if (t.name === 'appearance') {
    applyAppearance(t.value);
  }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  S.installPrompt = e;
  if (S.ui.settings) render();
});

window.addEventListener('appinstalled', () => {
  S.installPrompt = null;
  if (S.ui.settings) render();
});

// The date rolls over while the app sits open overnight: redraw when it
// comes back to the foreground on a new day.
let shownDay = todayStr();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayStr() !== shownDay) {
    shownDay = todayStr();
    refresh();
  }
});

// ---------------------------------------------------------------------------
// One-time cleanup: quick add used to log "Followed on Instagram" (as a
// Comment on their work) by itself the moment someone was added. Those are
// listed once, all ticked, for you to delete. Each person's next touchpoint
// is then worked out as if they'd just been added with Not yet.

function autoFollowTouchpoints() {
  return S.tps.filter((t) => {
    if (t.type !== 'comment' || !/^Followed on Instagram\.?$/.test((t.note || '').trim())) return false;
    const p = S.personById.get(t.personId);
    return !!p && !!p.createdAt && !!t.createdAt && Math.abs(new Date(t.createdAt) - new Date(p.createdAt)) <= 10000;
  });
}

async function offerFollowCleanup() {
  if (await db.getMeta('followCleanupDone')) return;
  const found = sortTouchpoints(autoFollowTouchpoints());
  const done = () => db.setMeta('followCleanupDone', nowISO());
  if (!found.length) {
    await done();
    return;
  }
  const s = openSheet({
    title: "Touchpoints you didn't log",
    className: 'sheet-small has-footer',
    body: `<p class="sheet-message">Quick add used to log these by itself when you added someone. Untick any you really made, and delete the rest. Each person's next touchpoint is then set as if you'd just added them with Not yet.</p>
      <div class="pick-list">${found.map((t) => {
        const p = S.personById.get(t.personId);
        return `<label class="pick-row"><input type="checkbox" data-tid="${esc(t.id)}" checked><span class="pick-main"><span class="pick-name">${esc(p.name)}</span><span class="pick-sub">${esc(fmtDate(t.date))} <span class="dot">·</span> ${esc(t.note)}</span></span></label>`;
      }).join('')}</div>
      <div class="sheet-footer">
        <button type="button" class="modal-cta primary" data-delete></button>
        <button type="button" class="btn secondary wide cleanup-keep" data-keep>Keep them all</button>
      </div>`,
  });
  const del = s.body.querySelector('[data-delete]');
  const picked = () => [...s.body.querySelectorAll('[data-tid]:checked')].map((x) => x.dataset.tid);
  const label = () => {
    const n = picked().length;
    del.textContent = n ? `Delete ${plural(n, 'touchpoint')}` : 'Nothing ticked';
    del.disabled = !n;
  };
  label();
  s.body.addEventListener('change', label);
  s.body.querySelector('[data-keep]').addEventListener('click', async () => {
    await done();
    s.close();
    toast('Kept them all.');
  });
  del.addEventListener('click', async () => {
    const ids = new Set(picked());
    if (!ids.size) return;
    del.disabled = true;
    const today = todayStr();
    const people = new Set();
    for (const t of found) {
      if (!ids.has(t.id)) continue;
      await db.deleteTouchpoint(t.id);
      people.add(t.personId);
    }
    await reopenKept([...ids]);
    for (const pid of people) {
      const p = S.personById.get(pid);
      if (!p) continue;
      const rest = tpsOf(pid).filter((t) => !ids.has(t.id));
      const next = rest.length ? computeNextDate(p, rest, S.settings, today) : addDays(today, QUICK_FIRST_DAYS);
      await db.savePerson({ ...p, nextTouchpointDate: next });
    }
    await done();
    s.close();
    await refresh();
    toast(`Deleted ${plural(ids.size, 'touchpoint')} and updated ${people.size === 1 ? 'that person' : 'those people'}'s next touchpoints.`);
  });
}

// ---------------------------------------------------------------------------
// Start

// ---------------------------------------------------------------------------
// Keyboard shortcuts and the Mac app's menu
//
// One set of commands. On a computer the single keys below work in any
// browser; the Mac app's menu sends the same commands with ⌘ shortcuts.

const TAB_ORDER = ['today', 'people', 'circles', 'orgs', 'news', 'week', 'settings'];
const inMacApp = !!(window.callbackApp && window.callbackApp.mac);

function openPerson() {
  const r = parseRoute();
  if (r.name === 'person') return S.personById.get(r.id) || null;
  return boardOn() && S.ui.pick ? S.personById.get(S.ui.pick.id) || null : null;
}

// Down and up go to the next or previous row in the side list.
function stepList(dir) {
  const rows = [...view.querySelectorAll('.split-list a.row-card, #peopleList a.row-card')];
  if (!rows.length) return;
  const at = rows.findIndex((a) => a.classList.contains('is-selected'));
  const next = rows[at < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + dir))];
  if (next.classList.contains('is-selected')) return;
  S.ui.revealRow = true;
  location.hash = next.getAttribute('href');
}

// Search the list you're in (organizations on Orgs, otherwise people).
function findCommand() {
  closeAllSheets();
  const id = SPLIT_LIST[parseRoute().name] === 'orgs' ? 'orgSearch' : 'peopleSearch';
  const focus = () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus();
    el.select();
  };
  if (document.getElementById(id)) return focus();
  window.addEventListener('hashchange', focus, { once: true });
  location.hash = id === 'orgSearch' ? '#/orgs' : '#/people';
}

const COMMANDS = {
  'new-person': () => personForm(null),
  'quick-add': () => quickAddSheet(),
  log: () => {
    const p = openPerson();
    if (p) logSheet(p);
    else if (inMacApp) macFind.start('log');
    else toast('Open someone first, then log a touchpoint.');
  },
  // In the Mac app the bar's search finds anyone; on Orgs it searches orgs.
  find: () => (inMacApp && SPLIT_LIST[parseRoute().name] !== 'orgs' ? macFind.start() : findCommand()),
  // Snooze has no button for someone just met or only on your dream list.
  snooze: () => {
    const p = openPerson();
    if (p && !dreamOnly(p) && (p.warmth === 'parked' || firstStage(p) !== 'justMet')) snoozeSheet(p);
  },
  next: () => (boardOn() ? stepBoard(1) : stepList(1)),
  prev: () => (boardOn() ? stepBoard(-1) : stepList(-1)),
  back: () => {
    S.ui.goingBack = true;
    history.back();
  },
  export: () => exportJSON(),
  import: () => importJSON(),
  shortcuts: () => shortcutsSheet(),
  ...Object.fromEntries(TAB_ORDER.map((t) => [`go-${t}`, () => { location.hash = `#/${t}`; }])),
  // Settings is a pop-up now, over whatever page you're on.
  'go-settings': () => openSettings(),
};

function runCommand(name) {
  const fn = COMMANDS[name];
  if (fn) fn();
}

// In the browser: plain keys, only when you're not typing and nothing is open.
const KEYS = { n: 'new-person', q: 'quick-add', l: 'log', s: 'snooze', '/': 'find', '?': 'shortcuts', ArrowDown: 'next', ArrowUp: 'prev' };
TAB_ORDER.forEach((t, i) => { KEYS[String(i + 1)] = `go-${t}`; });

const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  if (isTyping(document.activeElement) || document.body.classList.contains('sheet-open')) return;
  if (e.key === 'Escape' && boardOn() && S.ui.pick) {
    e.preventDefault();
    closePick();
    return;
  }
  const name = KEYS[e.key];
  if (!name) return;
  // The arrows only move through a side list or Today's board; anywhere
  // else they scroll.
  if ((name === 'next' || name === 'prev') && !view.classList.contains('is-split') && !boardOn() && !(wideQuery.matches && view.querySelector('#peopleList a.row-card'))) return;
  e.preventDefault();
  runCommand(name);
});

// The Mac app's menu.
if (window.callbackApp && window.callbackApp.onCommand) window.callbackApp.onCommand(runCommand);

// The Mac app's bar
//
// The Mac app hides the grey Mac title bar, so the page draws its own bar
// across the top: the name, a search that finds anyone from any page, Log
// touchpoint and Quick add. The window buttons sit at its left (their spot is
// set in Callback Mac/main.js) and dragging its empty parts moves the window.
// The website and the phone don't get it.

// Name matches first (start of the name, then the start of any word, then
// anywhere in it), then org, role, email, notes, how you met and
// circles. Parked people come after the others at the same level.
function findMatches(query, max = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const p of S.people) {
    const name = (p.name || '').toLowerCase();
    let rank;
    if (name.startsWith(q)) rank = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) rank = 1;
    else if (name.includes(q)) rank = 2;
    else {
      const org = orgOf(p);
      const other = [org && org.name, p.role, p.email, p.notes, p.howWeMet, ...circlesOf(p).map((c) => c.name)];
      if (!other.some((v) => v && v.toLowerCase().includes(q))) continue;
      rank = 3;
    }
    if (p.warmth === 'parked') rank += 0.5;
    hits.push([rank, p]);
  }
  return hits.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, max).map(([, p]) => p);
}

const MAC_LOG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

function macBarHTML() {
  return `<header class="mac-bar" id="macBar">
    <span class="mac-brand">${LOGO}<span class="mac-brand-name">Callback</span></span>
    <div class="mac-find" role="search">
      <input type="search" class="mac-find-input" id="macFind" placeholder="Find someone" autocomplete="off" spellcheck="false"
        aria-label="Find someone" role="combobox" aria-controls="macFindList" aria-expanded="false" aria-autocomplete="list">
      <kbd class="mac-find-key" aria-hidden="true">⌘F</kbd>
      <div class="mac-find-list" id="macFindList" role="listbox" hidden></div>
    </div>
    <span class="mac-bar-space"></span>
    <button type="button" class="mac-bar-btn is-ghost" data-mac-cmd="log" aria-label="Log touchpoint" title="Log touchpoint (⌘L)">${MAC_LOG_ICON}<span class="mac-bar-label">Log touchpoint</span></button>
    <button type="button" class="mac-bar-btn" data-mac-cmd="quick-add" title="Quick add (⇧⌘N)">${QUICK_ICON}<span>Quick add</span></button>
  </header>`;
}

// The bar's search. start() focuses it; start('log') asks who you reached
// out to, then opens Log touchpoint for whoever you pick.
const macFind = (() => {
  let input, list;
  let mode = null;
  let hits = [];
  let at = 0;
  let addName = '';

  const dueNow = () => {
    const t = buildToday({ people: S.people, touchpointsByPerson: S.tpsByPerson, news: S.news, loops: S.loops }, todayStr());
    return [...t.justMet, ...t.overdue, ...t.due].slice(0, 8);
  };

  const row = (p, i) => {
    const org = orgOf(p);
    const sub = [org && org.name, p.role].filter(Boolean).join(' · ');
    return `<a class="mac-find-item${i === at ? ' is-active' : ''}" id="macFind-${i}" role="option" aria-selected="${i === at}" href="#/person/${esc(p.id)}" data-i="${i}">
      <span class="mac-find-who"><span class="mac-find-name">${esc(p.name)}</span>${sub ? `<span class="mac-find-sub">${esc(sub)}</span>` : ''}</span>
      ${warmthBadge(p.warmth)}</a>`;
  };

  function draw() {
    const q = input.value.trim();
    hits = q ? findMatches(q) : mode === 'log' ? dueNow() : [];
    addName = q && !hits.length ? q : '';
    const open = !!q || mode === 'log';
    if (at >= hits.length) at = 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    input.setAttribute('aria-activedescendant', open && hits.length ? `macFind-${at}` : '');
    if (!open) {
      list.innerHTML = '';
      return;
    }
    let html = mode === 'log' ? `<p class="mac-find-head">Log a touchpoint for${!q && hits.length ? ' · due now' : ''}</p>` : '';
    html += hits.map(row).join('');
    if (addName) {
      html += `<p class="mac-find-empty">No one matches “${esc(addName)}”.</p>
        <button type="button" class="mac-find-add is-active" data-add tabindex="-1">+ Add “${esc(addName)}” as a new person</button>`;
    } else if (!hits.length) {
      html += '<p class="mac-find-empty">Type their name.</p>';
    }
    list.innerHTML = html;
  }

  function reset() {
    mode = null;
    at = 0;
    input.value = '';
    input.placeholder = 'Find someone';
    draw();
  }

  function pick(p) {
    const logFor = mode === 'log';
    reset();
    input.blur();
    const go = `#/person/${p.id}`;
    const thenLog = () => {
      if (logFor) logSheet(S.personById.get(p.id) || p);
    };
    if (location.hash === go) return thenLog();
    S.ui.revealRow = true;
    window.addEventListener('hashchange', thenLog, { once: true });
    location.hash = go;
  }

  function addNew() {
    const name = addName;
    reset();
    input.blur();
    personForm(null, { name });
  }

  function start(how = null) {
    // A form is open over the bar: leave it alone rather than lose what's typed.
    if (!input || document.body.classList.contains('sheet-open')) return;
    mode = how;
    input.placeholder = how === 'log' ? 'Who did you reach out to?' : 'Find someone';
    at = 0;
    input.focus();
    input.select();
    draw();
  }

  function init() {
    document.documentElement.classList.add('mac-app');
    document.body.insertAdjacentHTML('afterbegin', macBarHTML());
    input = document.getElementById('macFind');
    list = document.getElementById('macFindList');
    input.addEventListener('input', () => {
      at = 0;
      draw();
    });
    input.addEventListener('focus', draw);
    // Clicking away closes the list; what you typed stays for next time.
    input.addEventListener('blur', () => {
      if (mode === 'log') {
        mode = null;
        input.placeholder = 'Find someone';
      }
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!hits.length) return;
        at = (at + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        draw();
        const el = document.getElementById(`macFind-${at}`);
        if (el) el.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (hits[at]) pick(hits[at]);
        else if (addName) addNew();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (input.value) {
          input.value = '';
          draw();
        } else {
          reset();
          input.blur();
        }
      }
    });
    // Keep the box focused while clicking in the list.
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.mac-find-item');
      if (item) {
        e.preventDefault();
        pick(hits[Number(item.dataset.i)]);
      } else if (e.target.closest('[data-add]')) addNew();
    });
    list.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.mac-find-item');
      if (!item || Number(item.dataset.i) === at) return;
      list.querySelector('.mac-find-item.is-active')?.classList.remove('is-active');
      at = Number(item.dataset.i);
      item.classList.add('is-active');
      input.setAttribute('aria-activedescendant', item.id);
    });
    document.getElementById('macBar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mac-cmd]');
      if (b) runCommand(b.dataset.macCmd);
    });
    if (window.callbackApp.onFullscreen) {
      window.callbackApp.onFullscreen((on) => document.documentElement.classList.toggle('mac-fullscreen', on));
    }
  }

  return { init, start };
})();

if (inMacApp) macFind.init();

function shortcutsSheet() {
  const mac = inMacApp;
  const rows = [
    [mac ? '⌘N' : 'N', 'New person'],
    [mac ? '⇧⌘N' : 'Q', 'Quick add'],
    [mac ? '⌘L' : 'L', mac ? 'Log a touchpoint for the person you have open, or pick someone' : 'Log a touchpoint for the person you have open'],
    [mac ? '⌘F' : '/', mac ? 'Find someone (on Orgs, search orgs)' : 'Search'],
    ['S', 'Snooze the person you have open'],
    ['↑ ↓', 'Previous or next in the list, or on Today in a big window'],
    [mac ? '⌘1 to ⌘6' : '1 to 7', 'Today, People, Circles, Orgs, Their news, Week' + (mac ? '' : ', Settings')],
    ...(mac ? [['⌘,', 'Settings'], ['⌘[', 'Back'], ['⌘E', 'Export a backup'], ['⌘O', 'Import a backup']] : []),
    ['Esc', 'Close a form, a popup or the person open beside Today'],
  ];
  openSheet({
    title: 'Keyboard shortcuts',
    className: 'sheet-small',
    body: `<dl class="shortcut-list">${rows.map(([k, what]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(what)}</dd>`).join('')}</dl>
      ${mac ? '' : '<p class="field-hint">They work when you are not typing in a box.</p>'}`,
  });
}

// One-time change (11-05): Active went from every 30 days to every 7, since
// a live lead goes cold in a month. A saved 30 (the old default) becomes 7,
// and Active people whose next touchpoint came from the 30-day rhythm (30
// days after their last touchpoint) move up to 7 days after it, today at the
// earliest, never later. Snoozed or hand-picked dates, custom rhythms and
// light touches stay as they are, and so does an Active rhythm you'd changed.
async function activeWeekly() {
  if (await db.getMeta('activeWeeklyDone')) return;
  if (S.settings.cadence.active === 30) {
    S.settings = await db.saveSettings({ ...S.settings, cadence: { ...S.settings.cadence, active: 7 } });
  }
  const days = S.settings.cadence.active;
  if (days === 7) {
    const today = todayStr();
    const moved = [];
    for (const p of S.people) {
      if (p.warmth !== 'active' || p.lightTouch || Number(p.cadenceOverrideDays) > 0) continue;
      const last = tpsOf(p.id).reduce((m, t) => (!m || t.date > m.date ? t : m), null);
      if (!last || p.nextTouchpointDate !== addDays(last.date, 30)) continue;
      const next = [addDays(last.date, days), today].sort().pop();
      if (next < p.nextTouchpointDate) moved.push({ ...p, nextTouchpointDate: next });
    }
    if (moved.length) {
      await db.savePeople(moved);
      await refresh();
    }
  }
  await db.setMeta('activeWeeklyDone', nowISO());
}

async function start() {
  try {
    if (!(await db.getMeta('installedAt'))) await db.setMeta('installedAt', nowISO());
    // First open, with nobody in it yet: the welcome, the head big and
    // facing you.
    if (!(await db.getMeta('welcomed'))) {
      if ((await db.getPeople()).length) await db.setMeta('welcomed', nowISO());
      else {
        S.ui.welcome = 'ask';
        setWelcome(true, true);
        if (parseRoute().name !== 'today') history.replaceState(null, '', '#/today');
      }
    }
    await loadListSorts();
    await refresh();
    sync.startAutoSync(onSyncResult);
    await activeWeekly();
    await offerFollowCleanup();
  } catch (err) {
    view.innerHTML = `<div class="empty"><p class="empty-title">Callback couldn't open its storage.</p>
      <p>${esc(err && err.message ? err.message : 'Your browser may be blocking site data, for example in a private window.')}</p></div>`;
  }
  // The Mac app serves its own files, so it needs no offline cache.
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.callbackApp) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// The sky behind the buddy, and the page warming at golden hour and graying at night.
startSky();
start();
