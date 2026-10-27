// Callback: screens, routing and actions. Data goes through db.js, the
// scheduling rules through cadence.js; this file only draws and reacts.
import * as db from './db.js';
import {
  todayStr, addDays, daysBetween, fmtDate, fmtLongDate, fmtTimestamp, relDay, span, plural, esc,
  debounce, weekStartStr, toDateStr, parseDate, normalizeUrl, instagramUrl, saveFile, readFileText, nowISO, uuid, hash,
} from './util.js';
import {
  WARMTH, WARMTH_INFO, COLD_STEPS, computeNextDate, warmthChangeFields, cadenceLabel, needsParkPrompt,
  needsWarmPrompt, SNOOZE_OPTIONS, snoozeDate, buildToday, coldState, sortTouchpoints, nextYearly, isDreamOnly,
} from './cadence.js';
import { pickIdea, yearlyIdea, setIdeaLibrary, isOwnIdea } from './ideas.js';
import { upcomingEvents, buildCalendar } from './ics.js';
import { canPickContacts, pickContacts, parseVCards, parsePasted } from './contacts.js';
import {
  TOUCH_TYPES, touchTypeLabel, RESPONDED, respondedLabel, ROLE_SUGGESTIONS, ORG_TYPES, orgTypeLabel,
  NEWS_SUGGESTIONS, RELATIONSHIP_TYPES, DEFAULT_RELATIONSHIP, relationshipInfo, LOOP_DIRECTIONS,
  INTEREST_LEVELS, interestInfo,
} from './model.js';
import { openSheet, confirmSheet, choiceSheet, toast, closeAllSheets } from './ui.js';

const APP_VERSION = '1.0.0';
const view = document.getElementById('view');

// ---------------------------------------------------------------------------
// State: everything is small enough to hold in memory and redraw from.

const S = {
  people: [],
  orgs: [],
  tps: [],
  news: [],
  loops: [],
  ideas: [],
  weeks: [],
  personById: new Map(),
  orgById: new Map(),
  tpsByPerson: new Map(),
  newsByPerson: new Map(),
  loopsByPerson: new Map(),
  settings: null,
  meta: {},
  installPrompt: null,
  ui: {
    ideaTurn: new Map(),
    collapsed: new Set(),
    scroll: new Map(),
    backTo: null,
    people: { q: '', sort: 'contact', sortOpen: false, warmth: new Set(), rel: new Set(), interest: new Set(), loops: false, dream: false, role: '', tag: '', org: '', showParked: false, filtersOpen: false },
    orgsQ: '',
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
  const [people, orgs, tps, news, loops, ideas, weeks, settings, lastExportAt, installedAt, reminderUntil, lastLogType] =
    await Promise.all([
      db.getPeople(), db.getOrganizations(), db.getTouchpoints(), db.getNews(), db.getOpenLoops(), db.getIdeas(), db.getWeeks(), db.getSettings(),
      db.getMeta('lastExportAt'), db.getMeta('installedAt'), db.getMeta('exportReminderUntil'), db.getMeta('lastLogType'),
    ]);
  S.people = people.sort((a, b) => a.name.localeCompare(b.name));
  S.orgs = orgs.sort((a, b) => a.name.localeCompare(b.name));
  S.tps = tps;
  S.news = news;
  S.weeks = weeks;
  S.settings = settings;
  S.personById = new Map(people.map((p) => [p.id, p]));
  S.orgById = new Map(orgs.map((o) => [o.id, o]));
  S.tpsByPerson = groupBy(tps, 'personId');
  for (const [k, list] of S.tpsByPerson) S.tpsByPerson.set(k, sortTouchpoints(list));
  S.newsByPerson = groupBy(news, 'personId');
  S.loops = loops;
  S.ideas = ideas;
  setIdeaLibrary(ideas);
  S.loopsByPerson = groupBy(loops, 'personId');
  S.meta = { lastExportAt, installedAt, reminderUntil, lastLogType };
}

async function refresh() {
  await load();
  render();
}

const tpsOf = (id) => S.tpsByPerson.get(id) || [];
const newsOf = (id) => S.newsByPerson.get(id) || [];
const loopsOf = (id) => S.loopsByPerson.get(id) || [];
const openLoopsOf = (id) => loopsOf(id).filter((l) => l.status !== 'closed');
const orgOf = (p) => (p && p.organizationId ? S.orgById.get(p.organizationId) : null);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const firstName = (p) => (p.name || '').trim().split(/\s+/)[0] || 'them';

function parseTags(str) {
  const seen = new Set();
  return String(str || '')
    .split(/[,;#]/)
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Small pieces of markup

const LOGO = `<svg class="brand-logo" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" fill="#ffd103"/><path d="M346.4 331.8A118 118 0 1 1 346.4 180.2" fill="none" stroke="#313d45" stroke-width="64"/><path d="M402 133L290 226L398 245Z" fill="#313d45"/></svg>`;

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
};

function relIcon(t) {
  return `<svg class="rel-icon" viewBox="0 0 16 16" aria-hidden="true">${REL_ICON[t] || REL_ICON.prospect}</svg>`;
}

function relLabel(t) {
  const info = relationshipInfo(t);
  return `<span class="rel rel-${esc(info.key)}">${relIcon(info.key)}<span>${esc(info.label)}</span></span>`;
}

const NEWS_ICON = '<svg class="warmth-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M1.5 6.8h13M5 1v3.5M11 1v3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

// Open loops: an arrow out for what you owe, an hourglass for what you're
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

const DREAM_STAR = '<svg class="warmth-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.4l2 4.3 4.6.6-3.4 3.2.9 4.6L8 11.8 3.9 14.1l.9-4.6L1.4 6.3 6 5.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

function dreamBadge() {
  return `<span class="dream-badge">${DREAM_STAR}<span>Dream list</span></span>`;
}

const dreamOnly = (p) => isDreamOnly(p, tpsOf(p.id));
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

// The rotating suggestion, or the idea the person typed themselves.
function ideaHTML(p) {
  const id = esc(p.id);
  const own = (p.customIdea || '').trim();
  const turn = S.ui.ideaTurn.get(p.id) || 0;
  const yearly = turn ? null : yearlyIdea(newsOf(p.id), tpsOf(p.id));
  const text = own || yearly || pickIdea(p, todayStr(), turn);
  const removable = own || !yearly;
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
        <span class="field-hint">It shows in place of the suggestions until you log your next touchpoint with ${esc(firstName(p))}.</span></label>
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

function statBox(num, label, href) {
  return `<a class="stat-box" href="${href}"><span class="stat-num">${num}</span><span class="stat-label">${esc(label)}</span></a>`;
}

function backButton(fallback, label) {
  return `<button type="button" class="back-btn" data-action="back" data-fallback="${esc(fallback)}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 5 8 12 15 19"/></svg>${esc(label)}</button>`;
}

// ---------------------------------------------------------------------------
// Today

function renderToday() {
  const today = todayStr();
  const t = buildToday({ people: S.people, touchpointsByPerson: S.tpsByPerson, news: S.news, loops: S.loops }, today);
  let html = `
    <div class="hero-band">
      <div class="brand-row">
        <div class="brand-logo-wrap shine-sweep">${LOGO}</div>
        <div class="brand-text">
          <h1 class="brand-title">Callback</h1>
          <p class="hero-date">${esc(fmtLongDate(today))}</p>
        </div>
      </div>
      <button type="button" class="hero-cta shine-sweep" data-action="add-person">+ Add person</button>
    </div>`;

  if (!S.people.length) return html + firstRunHTML();

  const week = weekStats(weekStartStr(today));
  const g = S.settings.goals;
  html += `<div class="stats-row">
    ${statBox(t.overdue.length + t.due.length, 'To reach out', '#/today')}
    ${statBox(`${week.tps.length}<small>/${g.touchpoints}</small>`, 'Touchpoints this week', '#/week')}
    ${statBox(`${week.added.length}<small>/${g.newPeople}</small>`, 'New people this week', '#/week')}
  </div>`;
  html += exportReminderHTML(today);

  const sections = [];
  const card = (kind) => (p) => personCard(p, kind, t.dueNews.get(p.id));
  if (t.overdue.length) sections.push(['overdue', 'Overdue', t.overdue.length, t.overdue.map(card('overdue')).join('')]);
  if (t.due.length) sections.push(['due', 'Due today', t.due.length, t.due.map(card('due')).join('')]);
  if (t.loops.length) sections.push(['loops', 'Open loops', t.loops.length, t.loops.map(loopCard).join('')]);
  if (t.news.length) sections.push(['news', 'Their news', t.news.length, t.news.map((n) => newsCard(n)).join('')]);
  if (t.comingUp.length) sections.push(['coming', 'Coming up', t.comingUp.length, t.comingUp.map((n) => newsCard(n, { coming: true })).join('')]);
  if (t.resurfaced.length) {
    sections.push(['resurfaced', 'Resurfaced', t.resurfaced.length, t.resurfaced.map((p) => personCard(p, 'resurfaced')).join('')]);
  }

  if (!sections.length) return html + caughtUpHTML(today);
  return html + sections.map(([key, title, n, inner], i) => sectionBlock(key, title, n, inner, i % 2 ? 'navy' : 'yellow')).join('');
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
    .filter((p) => p.warmth !== 'parked' && !dreamOnly(p) && (p.nextTouchpointDate || today) > today)
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

  const actions =
    kind === 'resurfaced'
      ? `<button type="button" class="btn secondary" data-action="open-person" data-id="${id}">Open</button>`
      : `<button type="button" class="btn primary" data-action="log" data-id="${id}"${news ? ` data-news="${esc(news.id)}"` : ''}>Log touchpoint</button>
         <button type="button" class="btn secondary" data-action="snooze" data-id="${id}">Snooze</button>
         <button type="button" class="btn secondary" data-action="open-person" data-id="${id}">Open</button>`;
  const newsLine = news
    ? `<p class="news-line"><span class="news-when">Their news</span>${esc(news.description)}${news.date === today ? '' : ` <span class="dot">·</span> ${esc(relDay(news.date, today))}`}</p>`
    : '';
  const idea = news && !news.repeatsYearly
    ? '<div class="idea"><span class="idea-label">Idea</span><p class="idea-text">Congratulate them, or send something that fits the moment.</p></div>'
    : ideaHTML(p);
  return `<article class="item-card${kind === 'overdue' ? ' is-overdue' : ''}">
    ${itemHead(p)}
    <p class="item-facts">${facts.join(' <span class="dot">·</span> ')}</p>
    ${newsLine}
    ${last && last.note ? `<p class="item-last"><span class="item-last-label">Last:</span> ${esc(last.note)}</p>` : ''}
    ${prompt || idea}
    <div class="item-actions">${actions}</div>
  </article>`;
}

function itemHead(p) {
  const sub = subLine(p);
  return `<a class="item-head" href="#/person/${esc(p.id)}">
      <span class="item-who"><span class="item-name">${esc(p.name)}</span>${sub ? `<span class="item-sub">${sub}</span>` : ''}${relLabel(p.relationshipType)}</span>
      ${warmthBadge(p.warmth)}
    </a>`;
}

// A their-news card. `coming` marks a yearly date still a few days off.
function newsCard(n, { coming = false } = {}) {
  const p = S.personById.get(n.personId);
  const today = todayStr();
  const id = esc(p.id);
  const when = n.date === today ? 'Today' : coming ? `${fmtDate(n.date)}, ${relDay(n.date, today)}` : cap(relDay(n.date, today));
  const idea = (n.repeatsYearly && yearlyIdea([n], tpsOf(p.id), today)) || 'Congratulate them, or send something that fits the moment.';
  return `<article class="item-card news-card">
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

// A loop on Today. What you owe reads as a promise to keep; what they owe
// reads as a gentle follow-up.
function loopCard(l) {
  const p = S.personById.get(l.personId);
  const today = todayStr();
  const pid = esc(p.id);
  const lid = esc(l.id);
  const n = daysBetween(l.dueDate, today);
  const who = `<a href="#/person/${pid}">${esc(p.name)}</a>`;
  if (l.direction === 'theyOwe') {
    return `<article class="item-card loop-card is-theyowe">
      <p class="loop-kicker">${loopIcon('theyOwe')}<span>Still waiting on ${who}</span></p>
      <p class="loop-desc">${esc(l.description)}</p>
      <p class="item-facts"><b>Expected ${esc(fmtDate(l.dueDate))}</b> <span class="dot">·</span> ${esc(relDay(l.dueDate, today))}. A gentle nudge?</p>
      <div class="item-actions">
        <button type="button" class="btn primary" data-action="loop-follow-up" data-id="${lid}">Log follow-up</button>
        <button type="button" class="btn secondary" data-action="close-loop" data-id="${lid}">Got it</button>
        <button type="button" class="btn secondary" data-action="open-person" data-id="${pid}">Open</button>
      </div>
    </article>`;
  }
  return `<article class="item-card loop-card is-iowe${n > 0 ? ' is-overdue' : ''}">
    <p class="loop-kicker">${loopIcon('iOwe')}<span>You promised ${who}</span></p>
    <p class="loop-desc">${esc(l.description)}</p>
    <p class="item-facts"><b>${n === 0 ? 'Due today' : `Due ${esc(relDay(l.dueDate, today))}`}</b></p>
    <div class="item-actions">
      <button type="button" class="btn primary" data-action="close-loop" data-id="${lid}">Done</button>
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
};
const WARMTH_ORDER = { client: 0, active: 1, warm: 2, cold: 3, parked: 4 };

function personRow(p) {
  const today = todayStr();
  const next = p.nextTouchpointDate || today;
  const sub = subLine(p);
  let nextText;
  if (dreamOnly(p)) nextText = 'Not reached out yet';
  else if (p.warmth === 'parked') nextText = `Back ${esc(fmtDate(next, { weekday: false }))}`;
  else if (next < today) nextText = `<b>${esc(nextRelText(next, today))}</b>`;
  else if (next === today) nextText = '<b>Due today</b>';
  else nextText = `Next ${esc(fmtDate(next, { weekday: false }))}`;
  return `<a class="row-card${p.warmth === 'parked' ? ' is-parked' : ''}" href="#/person/${esc(p.id)}">
    <span class="row-main">
      <span class="row-name">${esc(p.name)}</span>
      ${sub ? `<span class="row-sub">${sub}</span>` : ''}
      <span class="row-meta">${dreamOnly(p) ? `<span class="nowrap">${nextText}</span>` : `<span class="nowrap">${esc(sinceText(p, today))}</span> <span class="dot">·</span> <span class="nowrap">${nextText}</span>`}</span>
    </span>
    <span class="row-badges">${warmthBadge(p.warmth)}${p.dreamList ? `<span class="dream-mark" title="Dream list">${DREAM_STAR}<span class="visually-hidden">Dream list</span></span>` : ''}${loopCountBadge(openLoopsOf(p.id).length)}</span>
  </a>`;
}

function filteredPeople() {
  const f = S.ui.people;
  const today = todayStr();
  const q = f.q.trim().toLowerCase();
  let list = S.people.filter((p) => f.showParked || p.warmth !== 'parked');
  if (f.warmth.size) list = list.filter((p) => f.warmth.has(p.warmth));
  if (f.rel.size) list = list.filter((p) => f.rel.has(p.relationshipType));
  if (f.interest.size) list = list.filter((p) => f.interest.has(p.interest));
  if (f.loops) list = list.filter((p) => openLoopsOf(p.id).length);
  if (f.dream) list = list.filter((p) => p.dreamList);
  if (f.role) list = list.filter((p) => (p.role || '').toLowerCase() === f.role.toLowerCase());
  if (f.tag) list = list.filter((p) => (p.tags || []).some((t) => t.toLowerCase() === f.tag.toLowerCase()));
  if (f.org) list = list.filter((p) => p.organizationId === f.org);
  if (q) {
    list = list.filter((p) => {
      const org = orgOf(p);
      return [p.name, org && org.name, p.notes, p.role, p.email, p.howWeMet, ...(p.tags || [])]
        .some((v) => v && v.toLowerCase().includes(q));
    });
  }
  const since = (p) => {
    const last = tpsOf(p.id)[0];
    return last ? daysBetween(last.date, today) : Infinity;
  };
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sorters = {
    contact: (a, b) => since(b) - since(a) || byName(a, b),
    name: byName,
    next: (a, b) => (a.nextTouchpointDate || '').localeCompare(b.nextTouchpointDate || '') || byName(a, b),
    warmth: (a, b) => WARMTH_ORDER[a.warmth] - WARMTH_ORDER[b.warmth] || byName(a, b),
  };
  return list.sort(sorters[f.sort] || sorters.contact);
}

function activeFilterCount() {
  const f = S.ui.people;
  return f.warmth.size + f.rel.size + f.interest.size + (f.loops ? 1 : 0) + (f.dream ? 1 : 0) + (f.role ? 1 : 0) + (f.tag ? 1 : 0) + (f.org ? 1 : 0);
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
  return count + list.map(personRow).join('');
}

function uniqueSorted(values) {
  const seen = new Map();
  for (const v of values) if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function filtersHTML() {
  const f = S.ui.people;
  const roles = uniqueSorted(S.people.map((p) => p.role));
  const tags = uniqueSorted(S.people.flatMap((p) => p.tags || []));
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  return `
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
    <p class="filter-label">Show only</p>
    <div class="filters">
      <button type="button" class="chip${f.loops ? ' active' : ''}" data-action="filter-loops" aria-pressed="${f.loops}">${loopIcon('count')}Has open loops</button>
      <button type="button" class="chip${f.dream ? ' active' : ''}" data-action="filter-dream" aria-pressed="${f.dream}">${DREAM_STAR}Dream list</button>
    </div>
    <div class="filter-grid">
      <label class="field"><span class="field-label">Role</span>
        <select data-filter="role">${opt('', 'Any role', !f.role)}${roles.map((r) => opt(r, r, f.role === r)).join('')}</select></label>
      <label class="field"><span class="field-label">Tag</span>
        <select data-filter="tag">${opt('', 'Any tag', !f.tag)}${tags.map((t) => opt(t, t, f.tag === t)).join('')}</select></label>
      <label class="field"><span class="field-label">Organization</span>
        <select data-filter="org">${opt('', 'Any organization', !f.org)}${S.orgs.map((o) => opt(o.id, o.name, f.org === o.id)).join('')}</select></label>
    </div>
    ${activeFilterCount() ? '<button type="button" class="text-btn" data-action="clear-filters">Clear filters</button>' : ''}`;
}

function renderPeople() {
  const f = S.ui.people;
  const n = activeFilterCount();
  return `
    <header class="topbar"><h1>People</h1>
      <span class="topbar-actions">
        <a class="dream-link" href="#/dreams">${DREAM_STAR}Dream list</a>
        <button type="button" class="icon-btn" data-action="add-person" aria-label="Add person">+</button>
      </span></header>
    ${S.people.length ? `
    <input type="search" class="search" id="peopleSearch" placeholder="Search name, org, notes" value="${esc(f.q)}" autocomplete="off" aria-label="Search people">
    <div class="toolbar">
      <button type="button" class="filter-toggle" data-action="toggle-sort" aria-expanded="${f.sortOpen}">Sort: ${esc(SORTS[f.sort])}</button>
      <button type="button" class="filter-toggle${n ? ' is-on' : ''}" data-action="toggle-filters" aria-expanded="${f.filtersOpen}">Filter: ${n ? n : 'All'}</button>
      <label class="check"><input type="checkbox" data-filter="parked"${f.showParked ? ' checked' : ''}> Show parked</label>
    </div>
    <div class="filters"${f.sortOpen ? '' : ' hidden'}>
      ${Object.entries(SORTS).map(([k, label]) => `<button type="button" class="chip${f.sort === k ? ' active' : ''}" data-action="set-sort" data-sort="${k}">${esc(label)}</button>`).join('')}
    </div>
    <div class="filters-panel" id="filtersPanel"${f.filtersOpen ? '' : ' hidden'}>${filtersHTML()}</div>` : ''}
    <div class="card-list" id="peopleList">${peopleListHTML()}</div>`;
}

function updatePeopleList() {
  const el = document.getElementById('peopleList');
  if (el) el.innerHTML = peopleListHTML();
}

// ---------------------------------------------------------------------------
// Person detail

function notFoundHTML(what, fallback, label) {
  return `<div class="detail-top">${backButton(fallback, label)}</div>
    <div class="empty"><p class="empty-title">This ${what} isn't here anymore.</p><p>It may have been deleted, or replaced by an import.</p></div>`;
}

function renderPerson(id) {
  const p = S.personById.get(id);
  if (!p) return notFoundHTML('person', '#/people', 'People');
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
  }

  const overdue = p.warmth !== 'parked' && next < today;
  const sub = subLine(p, { link: true });
  const left = `
    <header class="person-head">
      <h1 class="person-name">${esc(p.name)}</h1>
      ${sub ? `<p class="person-sub">${sub}</p>` : ''}
      <div class="person-badges">
        <button type="button" class="warmth-btn" data-action="change-warmth" data-id="${pid}" aria-label="Change warmth, now ${esc(WARMTH_INFO[p.warmth].label)}">
          ${warmthBadge(p.warmth)}<span class="warmth-btn-hint">Change</span></button>
        <button type="button" class="warmth-btn" data-action="change-rel" data-id="${pid}" aria-label="Change relationship, now ${esc(relationshipInfo(p.relationshipType).label)}">
          ${relLabel(p.relationshipType)}<span class="warmth-btn-hint">Change</span></button>
        <button type="button" class="warmth-btn" data-action="change-interest" data-id="${pid}" aria-label="Change interest, now ${esc(interestInfo(p.interest).label)}">
          ${interestLabel(p.interest, { prefix: true })}<span class="warmth-btn-hint">Change</span></button>
        ${p.dreamList ? dreamBadge() : ''}
      </div>
    </header>
    ${dreamOnly(p) ? `<section class="next-panel">
      <p class="next-label">On your dream list</p>
      <p class="next-date">No rhythm yet</p>
      <p class="next-rel">Log a first touchpoint when you reach out, and Callback starts one.</p>
    </section>` : `<section class="next-panel${overdue ? ' is-overdue' : ''}">
      <p class="next-label">${p.warmth === 'parked' ? 'Comes back' : 'Next touchpoint'}</p>
      <p class="next-date">${esc(fmtDate(next))}</p>
      <p class="next-rel">${esc(nextRelText(next, today))} <span class="dot">·</span> ${esc(cadenceLabel(p, tps, S.settings))}</p>
      <div class="next-actions">
        <button type="button" class="btn on-ink" data-action="snooze" data-id="${pid}">Snooze</button>
        <button type="button" class="btn on-ink" data-action="change-date" data-id="${pid}">Change date</button>
      </div>
    </section>`}
    ${prompt}
    <button type="button" class="hero-cta log-cta" data-action="log" data-id="${pid}">Log touchpoint</button>
    ${p.warmth === 'parked' ? '' : ideaHTML(p)}
    ${sectionBlock('details', 'Details', null, detailsHTML(p), 'navy')}
    ${sectionBlock('personal', 'Personal', null, personalHTML(p), 'yellow')}
    ${sectionBlock('connections', 'Connections', null, connectionsHTML(p), 'navy')}`;

  const right = `
    ${sectionBlock('news', 'Their news', newsOf(id).length, newsListHTML(p), 'yellow')}
    ${sectionBlock('loops', 'Open loops', openLoopsOf(id).length, loopsHTML(p), 'navy')}
    ${sectionBlock('timeline', 'Touchpoints', tps.length, timelineHTML(p, tps), 'yellow')}`;

  return `
    <div class="detail-top">${backButton('#/people', 'Back')}
      <button type="button" class="text-btn" data-action="edit-person" data-id="${pid}">Edit</button></div>
    <div class="detail-cols"><div class="detail-col">${left}</div><div class="detail-col">${right}</div></div>`;
}

// Contact fields, each added or changed in its own small sheet from the
// person page.
const CONTACT_FIELDS = [
  { key: 'email', label: 'Email', word: 'email', type: 'email', mode: 'email', placeholder: 'name@example.com' },
  { key: 'phone', label: 'Phone', word: 'phone number', type: 'tel', mode: 'tel', placeholder: '+1 212 555 0101' },
  { key: 'instagram', label: 'Instagram', word: 'Instagram', type: 'text', mode: 'text', placeholder: '@handle' },
  { key: 'website', label: 'Website', word: 'website', type: 'text', mode: 'url', placeholder: 'example.com' },
];

function contactLink(p, key) {
  const v = p[key];
  if (key === 'email') return `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
  if (key === 'phone') return `<a href="tel:${esc(v.replace(/[^\d+]/g, ''))}">${esc(v)}</a>`;
  if (key === 'instagram') return `<a href="${esc(instagramUrl(v))}" target="_blank" rel="noopener">${esc(v.startsWith('@') || /instagram\.com/i.test(v) ? v : `@${v}`)}</a>`;
  return `<a href="${esc(normalizeUrl(v))}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\//, ''))}</a>`;
}

function detailsHTML(p) {
  const rows = [];
  const row = (label, value) => rows.push(`<div class="detail-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`);
  for (const f of CONTACT_FIELDS) {
    const btn = (text) => `<button type="button" class="text-btn inline contact-edit" data-action="edit-contact" data-id="${esc(p.id)}" data-field="${f.key}">${text}</button>`;
    rows.push(`<div class="detail-row contact-row"><dt>${esc(f.label)}</dt><dd>${(p[f.key] || '').trim()
      ? `<span class="contact-value">${contactLink(p, f.key)}</span>${btn('Edit')}`
      : btn(`+ Add ${esc(f.word)}`)}</dd></div>`);
  }
  if (p.howWeMet) row('How we met', `<span class="pre">${esc(p.howWeMet)}</span>`);
  if (p.tags && p.tags.length) row('Tags', `<span class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>`);
  if (p.notes) row('Notes', `<span class="pre">${esc(p.notes)}</span>`);
  if (p.cadenceOverrideDays) row('Rhythm', `Every ${esc(span(p.cadenceOverrideDays))}, set by you`);
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
  const hint = !p.howWeMet && !p.notes && !(p.tags || []).length
    ? `<p class="hint">Add how you met, tags and notes with <button type="button" class="text-btn inline" data-action="edit-person" data-id="${esc(p.id)}">Edit</button>.</p>`
    : '';
  return `<dl class="details">${rows.join('')}</dl>${hint}`;
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
  return `${rows.length ? `<dl class="details">${rows.join('')}</dl>` : '<p class="hint">Who introduced you, who you met through them, and who they could put you in touch with.</p>'}
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
        <input name="value" type="${f.type}" inputmode="${f.mode}" value="${esc(p[key] || '')}" placeholder="${esc(f.placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
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
    const value = String(new FormData(form).get('value') || '').trim();
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
  const today = todayStr();
  const nextBday = p.birthday ? nextYearly(`2000-${String(p.birthday.month).padStart(2, '0')}-${String(p.birthday.day).padStart(2, '0')}`, today) : null;
  return `
    <div class="pd-list">
      <div class="pd-row pd-birthday">
        <span class="pd-label-text">Birthday</span>
        ${p.birthday
          ? `<button type="button" class="pd-value-btn" data-action="edit-birthday" data-id="${pid}">${esc(birthdayText(p.birthday))}<span class="pd-sub">${esc(nextBday === today ? 'Today' : cap(relDay(nextBday, today)))}</span></button>`
          : `<button type="button" class="text-btn" data-action="edit-birthday" data-id="${pid}">+ Add birthday</button>`}
      </div>
      ${details.map((d) => `<div class="pd-row">
        <input class="pd-label" value="${esc(d.label)}" data-detail-field="label" data-person="${pid}" data-id="${esc(d.id)}" aria-label="Label" autocomplete="off">
        <textarea class="pd-value" rows="1" data-detail-field="value" data-person="${pid}" data-id="${esc(d.id)}" aria-label="${esc(d.label || 'Detail')}">${esc(d.value)}</textarea>
        <button type="button" class="pd-remove" data-action="remove-detail" data-person="${pid}" data-id="${esc(d.id)}" aria-label="Remove ${esc(d.label || 'detail')}">${X_ICON_SMALL}</button>
      </div>`).join('')}
    </div>
    ${details.length ? '' : '<p class="hint">The small things that turn a contact into a relationship: where they\'re from, a pet\'s name, the show they love.</p>'}
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
        <label class="field"><span class="field-label">Year (optional)</span>
          <input name="year" type="number" inputmode="numeric" min="1900" max="2100" value="${esc(b.year || '')}" placeholder="Year"></label>
      </div>
      <p class="field-error" data-error="day" hidden>That month doesn't have that many days.</p>
      <p class="field-hint">It comes back every year: on Today a week early under Coming up, and again on the day.</p>
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
    <p class="hint">Upcoming dates worth reaching out about: a premiere, a launch, a new agency. They show up on Today when the day comes.</p>
    ${upcoming.map(item).join('')}${past.map(item).join('')}
    <button type="button" class="primary small-btn" data-action="add-news" data-id="${esc(p.id)}">+ Add a date</button>`;
}

function loopRow(l, today) {
  const closed = l.status === 'closed';
  let when = '';
  if (closed) when = l.closedAt ? `Done ${fmtDate(toDateStr(new Date(l.closedAt)), { weekday: false })}` : 'Done';
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

// Open loops on the person page: what you owe and what they owe, with the
// closed ones folded away under Done.
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
    ${open.length ? LOOP_DIRECTIONS.map(group).join('') : `<p class="hint">Small promises, either way: a print you said you'd send, dates they said they'd share. Add them here so none slip.</p>`}
    <button type="button" class="primary small-btn" data-action="add-loop" data-id="${esc(p.id)}">+ Add loop</button>
    ${done.length ? `<details class="loop-done"><summary>Done (${done.length})</summary><ul class="loop-list">${done.map((l) => loopRow(l, today)).join('')}</ul></details>` : ''}`;
}

function loopSheet(p, l = null) {
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
      <fieldset class="field"><legend class="field-label">Who owes it?</legend>
        <div class="seg">${LOOP_DIRECTIONS.map((d) => `<label class="seg-option"><input type="radio" name="direction" value="${d.key}"${v.direction === d.key ? ' checked' : ''}><span>${esc(d.label)}</span></label>`).join('')}</div>
      </fieldset>
      <label class="field"><span class="field-label">By when? (optional)</span>
        <input type="date" name="dueDate" value="${esc(v.dueDate || '')}">
        <span class="field-hint">With a date, it shows on Today when it's due. Without one, it waits here.</span></label>
      ${l ? '<button type="button" class="btn danger wide" data-delete>Delete loop</button>' : ''}
      <button type="submit" class="modal-cta primary">${l ? 'Save' : 'Add loop'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
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
    s.close();
    await refresh();
    toast(l ? 'Saved' : 'Loop added');
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

// Closing what you owe is often a touchpoint in itself, so offer to log it.
async function closeLoop(l) {
  if (!l || l.status === 'closed') return;
  await db.saveOpenLoop({ ...l, status: 'closed', closedAt: nowISO() });
  await refresh();
  const p = S.personById.get(l.personId);
  if (l.direction !== 'iOwe' || !p) {
    toast('Loop closed', { action: { label: 'Undo', run: () => reopenLoop(S.loops.find((x) => x.id === l.id)) } });
    return;
  }
  const log = await confirmSheet({
    title: 'Log this as a touchpoint?',
    message: `You kept a promise to ${esc(firstName(p))}: ${esc(l.description)}. Logging it lets Callback schedule what's next.`,
    confirmLabel: 'Log touchpoint',
    cancelLabel: 'Not now',
  });
  if (log) logSheet(S.personById.get(l.personId), { note: l.description });
}

async function reopenLoop(l) {
  if (!l) return;
  await db.saveOpenLoop({ ...l, status: 'open', closedAt: null });
  await refresh();
  toast('Loop reopened');
}

function timelineHTML(p, tps) {
  if (!tps.length) {
    return `<p class="hint">No touchpoints yet. When you reach out to ${esc(firstName(p))}, log it here and Callback schedules the next one.</p>`;
  }
  return `<ol class="timeline">${tps
    .map(
      (t) => `<li class="tl-item">
        <span class="tl-node" aria-hidden="true"></span>
        <div class="tl-body">
          <p class="tl-head"><span class="tl-date">${esc(fmtDate(t.date))}</span><span class="tl-type">${esc(touchTypeLabel(t.type))}</span>${t.interest ? interestLabel(t.interest) : ''}</p>
          ${t.note ? `<p class="tl-note">${esc(t.note)}</p>` : ''}
          <div class="tl-foot">
            <button type="button" class="resp resp-${esc(t.responded || 'pending')}" data-action="set-response" data-id="${esc(t.id)}" aria-label="Reply status: ${esc(respondedLabel(t.responded))}. Change">${esc(respondedLabel(t.responded))}</button>
            <button type="button" class="text-btn" data-action="edit-tp" data-id="${esc(t.id)}">Edit</button>
          </div>
        </div>
      </li>`
    )
    .join('')}</ol>`;
}

// ---------------------------------------------------------------------------
// Organizations

function renderOrgs() {
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
// Weekly review

function weekStats(ws) {
  const we = addDays(ws, 6);
  const inWeek = (d) => d >= ws && d <= we;
  const localDay = (iso) => toDateStr(new Date(iso));
  return {
    ws,
    we,
    tps: S.tps.filter((t) => inWeek(t.date)),
    replies: S.tps.filter((t) => t.responded === 'yes' && inWeek(t.respondedAt ? localDay(t.respondedAt) : t.date)),
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
    <p class="goal-head"><span>${esc(label)}</span><span>${n} of ${goal}${n >= goal ? ' ✓' : ''}</span></p>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${n}" aria-label="${esc(label)}"><span style="width:${pct}%"></span></div>
  </div>`;
}

function renderWeek() {
  const today = todayStr();
  const ws = weekStartStr(today);
  const w = weekStats(ws);
  const g = S.settings.goals;
  const rec = weekRecord(ws);
  const metBoth = w.tps.length >= g.touchpoints && w.added.length >= g.newPeople;

  const logged = sortTouchpoints(w.tps)
    .map((t) => {
      const p = S.personById.get(t.personId);
      return `<a class="log-row" href="#/person/${esc(t.personId)}">
        <span class="log-row-main"><span class="log-row-date">${esc(fmtDate(t.date))}</span>
          <b>${esc(p ? p.name : 'Someone')}</b> <span class="dot">·</span> ${esc(touchTypeLabel(t.type))}${t.note ? `<span class="log-row-note">${esc(t.note)}</span>` : ''}</span>
        <span class="resp resp-${esc(t.responded)}">${esc(respondedLabel(t.responded))}</span>
      </a>`;
    })
    .join('');

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
  const pastHTML = pastWeeks.length
    ? pastWeeks
        .map((pw) => {
          const s = weekStats(pw);
          const r = weekRecord(pw);
          const met = s.tps.length >= g.touchpoints;
          return `<article class="week-card">
            <p class="week-card-head"><span class="week-card-range">${esc(weekRange(pw))}</span>${met ? '<span class="week-card-met">Goal met</span>' : ''}</p>
            <p class="week-card-stats">${plural(s.tps.length, 'touchpoint')} <span class="dot">·</span> ${plural(s.replies.length, 'reply', 'replies')} <span class="dot">·</span> ${s.added.length} new</p>
            ${r && r.reflection ? `<p class="week-card-reflection pre">${esc(r.reflection)}</p>` : ''}
            <button type="button" class="text-btn" data-action="edit-reflection" data-week="${pw}">${r && r.reflection ? 'Edit reflection' : 'Add a reflection'}</button>
          </article>`;
        })
        .join('')
    : '<p class="hint">Your past weeks will collect here, with what you logged and what you wrote about them.</p>';

  return `
    <header class="topbar"><h1>Weekly review</h1></header>
    <p class="week-range">This week <span class="dot">·</span> ${esc(weekRange(ws))}</p>
    <div class="stats-row">
      ${statBox(`${w.tps.length}<small>/${g.touchpoints}</small>`, 'Touchpoints logged', '#/week')}
      ${statBox(w.replies.length, 'Replies received', '#/week')}
      ${statBox(`${w.added.length}<small>/${g.newPeople}</small>`, 'New people added', '#/week')}
    </div>
    <div class="goals">
      ${goalBar('Touchpoints', w.tps.length, g.touchpoints)}
      ${goalBar('New people', w.added.length, g.newPeople)}
      <p class="goals-note">${metBoth ? 'Both goals met. Lovely week.' : 'Goals reset every Monday. Change them in Settings.'}</p>
    </div>
    <section class="section-block">
      <h2 class="heading-yellow static"><label for="reflection">What worked this week?</label></h2>
      <textarea id="reflection" class="reflection" data-week="${ws}" rows="5" placeholder="A note that landed, a reply that surprised you, something to try again next week.">${esc(rec ? rec.reflection : '')}</textarea>
      <p class="save-state" id="reflectionState" aria-live="polite">${rec && rec.reflection ? 'Saved' : ''}</p>
    </section>
    ${sectionBlock('week-logged', 'Logged this week', w.tps.length, logged || '<p class="hint">Nothing logged yet this week. Today has a list of who to reach out to.</p>', 'navy')}
    ${sectionBlock('week-past', 'Past weeks', pastWeeks.length || null, pastHTML, 'yellow')}`;
}

const saveReflection = debounce(async (ws, text) => {
  const rec = weekRecord(ws);
  const saved = await db.saveWeek({ ...(rec || { weekStart: ws }), reflection: text });
  S.weeks = [...S.weeks.filter((x) => x.id !== saved.id), saved];
  const el = document.getElementById('reflectionState');
  if (el) el.textContent = 'Saved';
}, 500);

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

function renderSettings() {
  const c = S.settings.cadence;
  const g = S.settings.goals;
  const appearance = getAppearance();
  const events = calendarEvents();
  return `
    <header class="topbar"><h1>Settings</h1></header>

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
        ${numField('cadence.client', c.client, 'Client', 'Days between touchpoints')}
        ${numField('cadence.parked', c.parked, 'Parked', 'Days before they come back')}
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
      </div>`, 'navy')}

    ${sectionBlock('set-data', 'Your data', null, `
      <p>Everything lives on this device, in this browser. Nothing is sent anywhere. Export a backup now and then so it's safe, and to move to another device.</p>
      <p class="set-fact">Last backup: <b>${S.meta.lastExportAt ? esc(fmtTimestamp(S.meta.lastExportAt)) : 'never'}</b></p>
      <div class="button-stack">
        <button type="button" class="primary small-btn" data-action="export-json">Export backup (JSON)</button>
        <button type="button" class="secondary small-btn" data-action="import-json">Import backup</button>
        <button type="button" class="secondary small-btn" data-action="import-contacts">Add people from your contacts</button>
      </div>`, 'yellow')}

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
// Routing

const ROUTES = {
  today: () => renderToday(),
  people: () => renderPeople(),
  person: (id) => renderPerson(id),
  orgs: () => renderOrgs(),
  org: (id) => renderOrg(id),
  week: () => renderWeek(),
  settings: () => renderSettings(),
  dreams: () => renderDreams(),
};
const TAB_FOR = { person: 'people', org: 'orgs', dreams: 'people' };
const TITLES = { today: 'Today', people: 'People', person: 'Person', orgs: 'Organizations', org: 'Organization', week: 'Weekly review', settings: 'Settings', dreams: 'Dream list' };

function parseRoute() {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: ROUTES[name] ? name : 'today', id: id ? decodeURIComponent(id) : null };
}

let currentKey = '';

function render() {
  const r = parseRoute();
  const key = `${r.name}/${r.id || ''}`;
  const same = key === currentKey;
  const y = window.scrollY;
  view.innerHTML = ROUTES[r.name](r.id);
  view.dataset.route = r.name;
  view.querySelectorAll('textarea.pd-value').forEach(fitHeight);
  const tab = TAB_FOR[r.name] || r.name;
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === tab;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  document.title = r.name === 'today' ? 'Callback' : `${TITLES[r.name]} · Callback`;
  if (same) window.scrollTo(0, y);
  else window.scrollTo(0, S.ui.scroll.get(key) || 0);
  currentKey = key;
}

window.addEventListener('hashchange', (e) => {
  const from = new URL(e.oldURL).hash || '#/today';
  S.ui.scroll.set(currentKey, window.scrollY);
  const r = parseRoute();
  if (r.name === 'person' || r.name === 'org') {
    if (!/^#\/(person|org)\//.test(from) || !S.ui.backTo) S.ui.backTo = from;
  } else {
    S.ui.backTo = null;
    // Lists open at the top when reached from the tab bar, and where you
    // left them when coming back from a person.
    if (!/^#\/(person|org)\//.test(from)) S.ui.scroll.delete(`${r.name}/`);
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
    if (filled.some((w) => ['email', 'phone', 'Instagram', 'website'].includes(w))) form.querySelector('details.more').open = true;
    if (values.name) form.querySelector('[data-error="name"]').hidden = true;
    result.textContent = filled.length
      ? `Filled in ${joinWords(filled)}. Check them below before saving.`
      : "Couldn't find any details in that. A signature or contact card works best.";
  };
  const fillSoon = debounce(fill, 250);
  box.addEventListener('input', () => fillSoon(box.value));
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

function personForm(p, preset = {}) {
  const isNew = !p;
  const v = p || { warmth: 'cold', nextTouchpointDate: todayStr(), ...preset };
  const org = orgOf(v);
  const c = S.settings.cadence;
  const field = (name, label, value, attrs = '') =>
    `<label class="field"><span class="field-label">${label}</span><input name="${name}" value="${esc(value || '')}" ${attrs}></label>`;
  const s = openSheet({
    title: isNew ? 'Add person' : 'Edit person',
    body: `<form class="form" novalidate>
      ${isNew ? `<details class="paste-box">
        <summary>Paste details from a signature or contact</summary>
        <p class="field-hint">Paste an email signature, a copied contact, or text from a website or DM. Callback fills in what it finds, and you check it before saving.</p>
        <div class="field"><textarea data-paste rows="5" aria-label="Pasted details" placeholder="Rosa Lind&#10;Booker | Ford Models&#10;M: +1 212 555 0101&#10;rosa@fordmodels.com"></textarea></div>
        ${navigator.clipboard && navigator.clipboard.readText ? '<button type="button" class="secondary small-btn" data-clip>Paste what I copied</button>' : ''}
        <p class="paste-result" data-paste-result aria-live="polite"></p>
      </details>` : ''}
      ${field('name', 'Name', v.name, 'autocomplete="off" placeholder="Who is it?" required')}
      <p class="field-error" data-error="name" hidden>Add a name first.</p>
      ${field('role', 'Role', v.role, 'list="roleList" autocomplete="off" placeholder="Casting director, editor, client"')}
      <datalist id="roleList">${ROLE_SUGGESTIONS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <label class="field"><span class="field-label">Organization</span>
        <input name="org" list="orgList" value="${esc(org ? org.name : '')}" autocomplete="off" placeholder="Agency, brand, publication">
        <span class="field-hint">Pick one you've added, or type a new name to add it.${org && !isNew ? ' Changing it keeps a note of where they were before.' : ''}</span></label>
      <datalist id="orgList">${S.orgs.map((o) => `<option value="${esc(o.name)}">`).join('')}</datalist>
      <fieldset class="field"><legend class="field-label">Relationship</legend>
        <div class="warmth-options">${RELATIONSHIP_TYPES.map((r) => `<label class="warmth-option">
          <input type="radio" name="relationshipType" value="${r.key}"${(v.relationshipType || DEFAULT_RELATIONSHIP) === r.key ? ' checked' : ''}>
          <span class="warmth-option-body">${relLabel(r.key)}<span class="warmth-option-blurb">${esc(r.blurb)}</span></span>
        </label>`).join('')}</div></fieldset>
      <fieldset class="field"><legend class="field-label">Warmth</legend>
        <div class="warmth-options">${WARMTH.map((w) => `<label class="warmth-option">
          <input type="radio" name="warmth" value="${w}"${v.warmth === w ? ' checked' : ''}>
          <span class="warmth-option-body">${warmthBadge(w)}<span class="warmth-option-blurb">${esc(WARMTH_INFO[w].blurb)}</span></span>
        </label>`).join('')}</div></fieldset>
      <label class="field"><span class="field-label">Next touchpoint</span>
        <input type="date" name="next" value="${esc(v.nextTouchpointDate || todayStr())}">
        <span class="field-hint">${isNew ? 'Today puts them on your Today list right away.' : 'Logging a touchpoint sets this for you.'}</span></label>
      <fieldset class="field connections-field"><legend class="field-label">Dream list and introductions</legend>
        <label class="check"><input type="checkbox" name="dreamList"${v.dreamList ? ' checked' : ''}> ${DREAM_STAR} On my dream list</label>
        <span class="field-hint">Someone you'd love to work with someday. No reminders until you first reach out, and a name is enough.</span>
        <div class="picker-row"><span class="field-label">Introduced by</span>
          <button type="button" class="picker-btn" data-pick="by"></button></div>
        <div class="picker-row"><span class="field-label">Could introduce me to</span>
          <button type="button" class="picker-btn" data-pick="could"></button></div>
      </fieldset>
      <details class="more"${isNew ? '' : ' open'}>
        <summary>Contact details and notes</summary>
        ${field('email', 'Email', v.email, 'type="email" autocomplete="off" inputmode="email"')}
        ${field('phone', 'Phone', v.phone, 'type="tel" autocomplete="off"')}
        ${field('instagram', 'Instagram', v.instagram, 'autocomplete="off" placeholder="@handle"')}
        ${field('website', 'Website', v.website, 'autocomplete="off" inputmode="url" placeholder="example.com"')}
        <label class="field"><span class="field-label">How we met</span><textarea name="howWeMet" rows="2" placeholder="Introduced by Sam at the Rialto screening">${esc(v.howWeMet || '')}</textarea></label>
        ${field('tags', 'Tags', (v.tags || []).join(', '), 'autocomplete="off" placeholder="commercial, nyc, fashion"')}
        <label class="field"><span class="field-label">Notes</span><textarea name="notes" rows="3">${esc(v.notes || '')}</textarea></label>
        <label class="field"><span class="field-label">Custom rhythm in days (optional)</span>
          <input name="override" type="number" min="1" max="3650" inputmode="numeric" value="${esc(v.cadenceOverrideDays || '')}" placeholder="Leave empty to follow their warmth">
          <span class="field-hint">Defaults: warm every ${span(c.warm)}, active ${span(c.active)}, client ${span(c.client)}.</span></label>
      </details>
      ${isNew ? '' : '<button type="button" class="btn danger wide" data-delete>Delete person</button>'}
      <button type="submit" class="modal-cta primary">${isNew ? 'Add person' : 'Save changes'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  if (isNew) wirePasteBox(form);
  // Introductions are picked in their own sheet and kept here until save.
  let introducedById = v.introducedById || null;
  let introducedByName = v.introducedByName || '';
  let canIntroduceToIds = [...(v.canIntroduceToIds || [])];
  const self = p ? [p.id] : [];
  const showPicks = () => {
    const by = introducedById && S.personById.get(introducedById);
    form.querySelector('[data-pick="by"]').textContent = by ? by.name : introducedByName ? `${introducedByName} (not in Callback)` : 'Choose someone, or type a name';
    const names = namesOf(canIntroduceToIds);
    form.querySelector('[data-pick="could"]').textContent = names.length ? joinWords(names) : 'Choose people';
  };
  showPicks();
  // A new past client starts on Client warmth (every few months) rather than
  // the cold sequence, unless a warmth was picked by hand.
  if (isNew) {
    let warmthTouched = false;
    let autoClient = false;
    form.addEventListener('change', (e) => {
      if (e.target.name === 'warmth') {
        warmthTouched = true;
        autoClient = false;
      } else if (e.target.name === 'relationshipType' && !warmthTouched) {
        const past = e.target.value === 'pastClient';
        if (past || autoClient) form.querySelector(`[name="warmth"][value="${past ? 'client' : v.warmth || 'cold'}"]`).checked = true;
        autoClient = past;
      }
    });
  }
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    if (b.dataset.pick === 'by') {
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
    const today = todayStr();
    const now = nowISO();

    const orgName = get('org');
    let organizationId = null;
    if (orgName) {
      const match = S.orgs.find((o) => o.name.trim().toLowerCase() === orgName.toLowerCase());
      organizationId = match ? match.id : (await db.saveOrganization({ name: orgName, type: 'other', website: '', notes: '' })).id;
    }
    const override = parseInt(get('override'), 10);
    const fields = {
      name,
      role: get('role'),
      organizationId,
      email: get('email'),
      phone: get('phone'),
      instagram: get('instagram'),
      website: get('website'),
      howWeMet: get('howWeMet'),
      tags: parseTags(get('tags')),
      notes: get('notes'),
      cadenceOverrideDays: override > 0 ? override : null,
      relationshipType: get('relationshipType') || DEFAULT_RELATIONSHIP,
      dreamList: !!fd.get('dreamList'),
      introducedById,
      introducedByName,
      canIntroduceToIds,
    };
    const warmth = get('warmth') || 'cold';
    const nextInput = /^\d{4}-\d{2}-\d{2}$/.test(get('next')) ? get('next') : '';

    let rec;
    if (isNew) {
      rec = { ...fields, ...warmthChangeFields({}, warmth, now, today), pastOrganizations: [], nextTouchpointDate: nextInput || today };
      if (warmth === 'parked') rec.nextTouchpointDate = computeNextDate(rec, [], S.settings, today);
    } else {
      rec = { ...p, ...fields };
      if (p.organizationId && p.organizationId !== organizationId) {
        const old = S.orgById.get(p.organizationId);
        rec.pastOrganizations = [...(p.pastOrganizations || []), { organizationId: p.organizationId, name: old ? old.name : '', until: today }];
      }
      const warmthChanged = warmth !== p.warmth;
      if (warmthChanged) Object.assign(rec, warmthChangeFields(p, warmth, now, today));
      const rhythmChanged = (rec.cadenceOverrideDays || null) !== (p.cadenceOverrideDays || null);
      if (nextInput && nextInput !== p.nextTouchpointDate) rec.nextTouchpointDate = nextInput;
      else if (warmthChanged || rhythmChanged) rec.nextTouchpointDate = computeNextDate(rec, tpsOf(p.id), S.settings, today);
    }
    const saved = await db.savePerson(rec);
    db.askToPersist();
    s.close();
    if (isNew) {
      location.hash = `#/person/${saved.id}`;
      await refresh();
      toast(`${name} added. Next touchpoint ${relDay(saved.nextTouchpointDate)}.`);
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
      location.hash = '#/people';
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
  const custom = Number(p.cadenceOverrideDays);
  if (custom > 0) return `That's your custom rhythm for ${first}: every ${span(custom)}.`;
  if (p.warmth === 'cold') {
    const { sent, replied } = coldState(p, tps);
    if (replied) return `${first} replied. Nice work.`;
    if (sent === 1) return `Follow-up in ${span(c.coldFollowUp)}. That's note 2 of ${COLD_STEPS} in the cold sequence.`;
    if (sent === 2) return `Last try in ${span(c.coldLastTry)}. That's note 3 of ${COLD_STEPS}.`;
    return `That was the last note in the cold sequence. If ${first} hasn't replied by ${esc(fmtDate(next))}, Callback will ask whether to park them.`;
  }
  return `${cap(span(c[p.warmth]))} after the latest touchpoint, because ${first} is ${WARMTH_INFO[p.warmth].label}.`;
}

function logSheet(p, { touchpoint = null, newsItem = null, note = '' } = {}) {
  if (!p) return;
  const editing = !!touchpoint;
  const today = todayStr();
  const v = touchpoint || {
    type: S.meta.lastLogType || 'email',
    date: today,
    note: note || (newsItem ? `Their news: ${newsItem.description}` : ''),
    responded: 'pending',
  };
  const s = openSheet({
    title: editing ? 'Edit touchpoint' : 'Log touchpoint',
    className: 'log-sheet',
    body: `<p class="sheet-person">${esc(p.name)}</p>
    <form class="form" novalidate>
      <fieldset class="field"><legend class="field-label">What did you do?</legend>
        <div class="chip-choices">${TOUCH_TYPES.map((t) => `<label class="chip-choice"><input type="radio" name="type" value="${t.key}"${v.type === t.key ? ' checked' : ''}><span>${esc(t.label)}</span></label>`).join('')}</div>
      </fieldset>
      <label class="field"><span class="field-label">When</span><input type="date" name="date" value="${esc(v.date)}" required></label>
      <label class="field"><span class="field-label">Note</span><input name="note" value="${esc(v.note || '')}" maxlength="280" autocomplete="off" placeholder="Sent three frames from the beach test"></label>
      <fieldset class="field"><legend class="field-label">Did they reply?</legend>
        <div class="seg">${RESPONDED.map((r) => `<label class="seg-option"><input type="radio" name="responded" value="${r.key}"${(v.responded || 'pending') === r.key ? ' checked' : ''}><span>${esc(r.label)}</span></label>`).join('')}</div>
      </fieldset>
      <fieldset class="field"><legend class="field-label">How did they seem? (optional)</legend>
        <input type="hidden" name="interest" value="${esc(v.interest || '')}">
        <div class="interest-picks">${INTEREST_LEVELS.map((i) => `<button type="button" class="interest-pick${v.interest === i.key ? ' is-on' : ''}" data-interest="${i.key}" aria-pressed="${v.interest === i.key}">${interestIcon(i.key)}<span>${esc(i.label)}</span></button>`).join('')}</div>
      </fieldset>
      ${editing ? '' : `<div class="field promise-field">
        <label class="field"><span class="field-label">Anything promised? (optional)</span>
          <input name="promise" maxlength="140" autocomplete="off" placeholder="Send her a print of the window frame"></label>
        <div class="promise-more" hidden>
          <div class="seg">${LOOP_DIRECTIONS.map((d, i) => `<label class="seg-option"><input type="radio" name="promiseDir" value="${d.key}"${i === 0 ? ' checked' : ''}><span>${esc(d.label)}</span></label>`).join('')}</div>
          <label class="field"><span class="field-label">By when? (optional)</span><input type="date" name="promiseDue"></label>
        </div>
      </div>`}
      ${editing ? '<button type="button" class="btn danger wide" data-delete>Delete touchpoint</button>' : ''}
      <button type="submit" class="modal-cta primary">${editing ? 'Save changes' : 'Save touchpoint'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');
  form.addEventListener('click', (e) => {
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
    if (responded === 'yes' && !respondedAt) respondedAt = nowISO();
    if (responded !== 'yes') respondedAt = null;

    const before = tpsOf(p.id);
    const tp = await db.saveTouchpoint({
      ...(touchpoint || {}),
      personId: p.id,
      type,
      date,
      note: String(fd.get('note') || '').trim(),
      responded,
      respondedAt,
      interest: String(fd.get('interest') || '') || null,
    });
    const all = sortTouchpoints([...before.filter((t) => t.id !== tp.id), tp]);
    // A new touchpoint always resets the schedule. An edit only does when it
    // touches the latest touchpoint, so a snooze survives fixing an old typo.
    const touchesLatest = !editing || all[0].id === tp.id || (before[0] && before[0].id === tp.id);
    const next = touchesLatest ? computeNextDate(p, all, S.settings, today) : p.nextTouchpointDate;
    // Logging a new touchpoint uses up a typed idea; fixing an old one doesn't.
    const clearedIdea = !editing && !!(p.customIdea || '').trim();
    // How they seemed at their latest touchpoint becomes their current interest.
    const interest = tp.interest && (!editing || all[0].id === tp.id) ? { interest: tp.interest } : {};
    const person = await db.savePerson({ ...p, nextTouchpointDate: next, ...(clearedIdea ? { customIdea: '' } : {}), ...interest });
    if (newsItem) await db.saveNews({ ...newsItem, dismissedAt: nowISO() });
    // "Anything promised?" becomes an open loop alongside the touchpoint.
    const promised = String(fd.get('promise') || '').trim();
    let loop = null;
    if (!editing && promised) {
      const due = String(fd.get('promiseDue') || '');
      loop = await db.saveOpenLoop({
        personId: p.id,
        direction: String(fd.get('promiseDir') || 'iOwe'),
        description: promised,
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
        status: 'open',
        closedAt: null,
      });
    }
    db.setMeta('lastLogType', type);
    db.askToPersist();
    await refresh();

    if (editing) {
      s.close();
      toast('Touchpoint saved');
      return;
    }
    showLogged(s, person, all, { clearedIdea, loop });
  });

  const del = s.body.querySelector('[data-delete]');
  if (del) {
    del.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Delete this touchpoint?', message: 'It comes off the timeline for good.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      const before = tpsOf(p.id);
      await db.deleteTouchpoint(touchpoint.id);
      const rest = before.filter((t) => t.id !== touchpoint.id);
      if (before[0] && before[0].id === touchpoint.id) {
        await db.savePerson({ ...p, nextTouchpointDate: computeNextDate(p, rest, S.settings, today) });
      }
      s.close();
      await refresh();
      toast('Touchpoint deleted');
    });
  }
}

function showLogged(s, p, tps, { clearedIdea = false, loop = null } = {}) {
  const next = p.nextTouchpointDate;
  const name = esc(firstName(p));
  let prompt = '';
  if (p.warmth === 'parked') {
    const back = p.warmthBeforePark && p.warmthBeforePark !== 'parked' ? p.warmthBeforePark : 'warm';
    prompt = promptBox(`${name} is still parked. Bring them back as ${WARMTH_INFO[back].label}?`, `<button type="button" class="btn primary" data-sheet-act="unpark">Bring back</button>`);
  } else if (needsWarmPrompt(p, tps)) {
    prompt = promptBox(`${name} replied. Move them to Warm?`, `<button type="button" class="btn primary" data-sheet-act="make-warm">Move to Warm</button>`);
  } else if (needsParkPrompt(p, tps) && tps.length && tps[0].responded === 'no') {
    prompt = promptBox(`No reply to any of the ${COLD_STEPS} notes. Park ${name} now?`, `<button type="button" class="btn primary" data-sheet-act="park">Park ${name}</button>`);
  }
  s.setTitle('Logged');
  s.body.innerHTML = `<div class="logged">
    <div class="logged-check">${CHECK}</div>
    <p class="logged-title">Touchpoint saved for ${esc(p.name)}.</p>
    <section class="next-panel compact">
      <p class="next-label">${p.warmth === 'parked' ? 'Comes back' : 'Next touchpoint'}</p>
      <p class="next-date">${esc(fmtDate(next))}</p>
      <p class="next-rel">${esc(nextRelText(next))}</p>
    </section>
    <p class="logged-why">${whyText(p, tps, next)}</p>
    ${clearedIdea ? '<p class="logged-why">Your typed idea is used up, so fresh suggestions show next time.</p>' : ''}
    ${loop ? `<p class="logged-why">${loopIcon(loop.direction)} Open loop added: ${esc(loop.description)}${loop.dueDate ? `, by ${esc(fmtDate(loop.dueDate))}` : ''}.</p>` : ''}
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
async function moveNext(p, d, message) {
  const prev = p.nextTouchpointDate;
  await db.savePerson({ ...p, nextTouchpointDate: d });
  await refresh();
  toast(message, {
    action: {
      label: 'Undo',
      run: async () => {
        const cur = S.personById.get(p.id);
        if (cur) await db.savePerson({ ...cur, nextTouchpointDate: prev });
        await refresh();
      },
    },
  });
}

function dateSheet(p) {
  if (!p) return;
  const news = upcomingNews(p);
  const s = openSheet({
    title: p.warmth === 'parked' ? 'Bring back on' : 'Next touchpoint',
    className: 'sheet-small',
    body: `<form class="form" novalidate>
      <label class="field"><span class="field-label">Reach out to ${esc(p.name)} on</span>
        <input type="date" name="date" value="${esc(p.nextTouchpointDate || todayStr())}" required></label>
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
  s.body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = String(new FormData(e.target).get('date') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    s.close();
    await moveNext(p, d, `Next touchpoint ${fmtDate(d)}`);
  });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-news-date]');
    if (!b) return;
    s.close();
    await moveNext(p, b.dataset.newsDate, `Next touchpoint ${fmtDate(b.dataset.newsDate)}, for their news: ${b.dataset.newsText}`);
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
async function setWarmth(p, warmth, { quiet = false } = {}) {
  if (!p || p.warmth === warmth) return;
  const today = todayStr();
  const rec = { ...p, ...warmthChangeFields(p, warmth, nowISO(), today) };
  rec.nextTouchpointDate = computeNextDate(rec, tpsOf(p.id), S.settings, today);
  await db.savePerson(rec);
  await refresh();
  if (quiet) return;
  const label = WARMTH_INFO[warmth].label;
  const msg = warmth === 'parked'
    ? `${p.name} parked. Back ${fmtDate(rec.nextTouchpointDate)}.`
    : `${p.name} is ${label} now. Next touchpoint ${fmtDate(rec.nextTouchpointDate)}.`;
  toast(msg, {
    action: {
      label: 'Undo',
      run: async () => {
        await db.savePerson({ ...p });
        await refresh();
      },
    },
  });
}

async function interestSheet(p) {
  if (!p) return;
  const key = await choiceSheet({
    title: 'How engaged do they seem?',
    message: 'This shapes the touchpoint ideas. How often you reach out still follows their warmth.',
    options: INTEREST_LEVELS.map((i) => ({ key: i.key, label: i.label, detail: i.blurb, icon: interestIcon(i.key), current: p.interest === i.key })),
  });
  if (!key || key === p.interest) return;
  await db.savePerson({ ...p, interest: key });
  await refresh();
  toast(`${firstName(p)} seems ${interestInfo(key).label.toLowerCase()} now.`, {
    action: {
      label: 'Undo',
      run: async () => {
        await db.savePerson({ ...S.personById.get(p.id), interest: p.interest });
        await refresh();
      },
    },
  });
}

async function relationshipSheet(p) {
  if (!p) return;
  const key = await choiceSheet({
    title: "What's this relationship?",
    message: 'This shapes the touchpoint ideas. How often you reach out still follows their warmth.',
    options: RELATIONSHIP_TYPES.map((r) => ({ key: r.key, label: r.label, detail: r.blurb, icon: relIcon(r.key), current: p.relationshipType === r.key })),
  });
  if (!key || key === p.relationshipType) return;
  await db.savePerson({ ...p, relationshipType: key });
  await refresh();
  toast(`${firstName(p)} is marked as ${relationshipInfo(key).label}.`, {
    action: {
      label: 'Undo',
      run: async () => {
        await db.savePerson({ ...S.personById.get(p.id), relationshipType: p.relationshipType });
        await refresh();
      },
    },
  });
}

async function warmthSheet(p) {
  if (!p) return;
  const key = await choiceSheet({
    title: `How well do you know ${firstName(p)}?`,
    message: 'Callback works out the next touchpoint from their latest one.',
    options: WARMTH.map((w) => ({ key: w, label: WARMTH_INFO[w].label, detail: WARMTH_INFO[w].blurb, icon: warmthIcon(w), current: p.warmth === w })),
  });
  if (key) await setWarmth(p, key);
}

async function unpark(p) {
  const today = todayStr();
  const back = p.warmthBeforePark && p.warmthBeforePark !== 'parked' ? p.warmthBeforePark : 'warm';
  const rec = { ...p, ...warmthChangeFields(p, back, nowISO(), today), nextTouchpointDate: today };
  await db.savePerson(rec);
  await refresh();
  toast(`${p.name} is ${WARMTH_INFO[back].label} again and due today.`);
}

async function repark(p) {
  const today = todayStr();
  const next = addDays(today, S.settings.cadence.parked);
  await db.savePerson({ ...p, parkedOn: today, nextTouchpointDate: next });
  await refresh();
  toast(`Parked again until ${fmtDate(next)}`);
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

function reflectionSheet(ws) {
  const rec = weekRecord(ws);
  const s = openSheet({
    title: `Week of ${weekRange(ws)}`,
    body: `<form class="form">
      <label class="field"><span class="field-label">What worked this week?</span>
        <textarea name="reflection" rows="7">${esc(rec ? rec.reflection : '')}</textarea></label>
      <button type="submit" class="modal-cta primary">Save</button>
    </form>`,
  });
  s.body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = String(new FormData(e.target).get('reflection') || '').trim();
    await db.saveWeek({ ...(rec || { weekStart: ws }), reflection: text });
    s.close();
    await refresh();
    toast('Saved');
  });
}

async function setResponse(t) {
  const key = await choiceSheet({
    title: 'Did they reply?',
    options: RESPONDED.map((r) => ({ key: r.key, label: r.label, current: (t.responded || 'pending') === r.key })),
  });
  if (!key || key === t.responded) return;
  await db.saveTouchpoint({ ...t, responded: key, respondedAt: key === 'yes' ? nowISO() : null });
  await refresh();
  const p = S.personById.get(t.personId);
  if (key === 'yes' && p && p.warmth === 'cold') {
    toast(`${firstName(p)} replied.`, { action: { label: 'Move to Warm', run: () => setWarmth(S.personById.get(p.id), 'warm') } });
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
      tags: parseTags(c.tags.join(',')),
      birthday: c.birthday || null,
      details: [],
      organizationId: c.org ? orgIds.get(c.org.trim().toLowerCase()) : null,
      relationshipType,
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
  'add-person': (el) => personForm(null, {
    ...(el.dataset.org ? { organizationId: el.dataset.org } : {}),
    ...(el.dataset.dream ? { dreamList: true } : {}),
  }),
  'dream-notes': (el) => notesSheet(person(el)),
  'edit-contact': (el) => contactSheet(person(el), el.dataset.field),
  'edit-person': (el) => personForm(person(el)),
  log: (el) => logSheet(person(el), { newsItem: el.dataset.news ? S.news.find((n) => n.id === el.dataset.news) : null }),
  snooze: (el) => snoozeSheet(person(el)),
  'change-date': (el) => dateSheet(person(el)),
  'open-person': (el) => {
    location.hash = `#/person/${el.dataset.id}`;
  },
  'change-warmth': (el) => warmthSheet(person(el)),
  'change-rel': (el) => relationshipSheet(person(el)),
  'change-interest': (el) => interestSheet(person(el)),
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
    el.closest('.idea').querySelector('.idea-text').textContent = pickIdea(p, todayStr(), S.ui.ideaTurn.get(p.id));
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
  'loop-follow-up': (el) => {
    const l = S.loops.find((x) => x.id === el.dataset.id);
    if (l) logSheet(S.personById.get(l.personId), { note: `Followed up about: ${l.description}` });
  },
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
  'add-org': () => orgForm(null),
  'edit-org': (el) => orgForm(S.orgById.get(el.dataset.id)),
  back: (el) => {
    if (S.ui.backTo) history.back();
    else location.hash = el.dataset.fallback || '#/today';
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
  'toggle-sort': () => {
    S.ui.people.sortOpen = !S.ui.people.sortOpen;
    render();
  },
  'set-sort': (el) => {
    S.ui.people.sort = el.dataset.sort;
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
  'clear-filters': () => {
    Object.assign(S.ui.people, { q: '', warmth: new Set(), rel: new Set(), interest: new Set(), loops: false, dream: false, role: '', tag: '', org: '' });
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
  'erase-all': async () => {
    const ok = await confirmSheet({
      title: 'Erase everything?',
      message: `This deletes all ${plural(S.people.length, 'person', 'people')}, touchpoints, organizations and notes from this device. Export a backup first if you might want them back.`,
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
  if (!el || !view.contains(el)) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

// Section headings act like buttons from the keyboard too, and Enter in an
// in-place detail field saves it.
document.addEventListener('keydown', (e) => {
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
  if (t.matches && t.matches('textarea.pd-value')) fitHeight(t);
  if (t.id === 'peopleSearch') {
    S.ui.people.q = t.value;
    updatePeopleList();
  } else if (t.id === 'orgSearch') {
    S.ui.orgsQ = t.value;
    const list = document.getElementById('orgList');
    const tmp = document.createElement('div');
    tmp.innerHTML = renderOrgs();
    list.innerHTML = tmp.querySelector('#orgList').innerHTML;
  } else if (t.id === 'reflection') {
    const st = document.getElementById('reflectionState');
    if (st) st.textContent = 'Saving';
    saveReflection(t.dataset.week, t.value);
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!view.contains(t)) return;
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
  if (parseRoute().name === 'settings') render();
});

window.addEventListener('appinstalled', () => {
  S.installPrompt = null;
  if (parseRoute().name === 'settings') render();
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
// Start

async function start() {
  try {
    if (!(await db.getMeta('installedAt'))) await db.setMeta('installedAt', nowISO());
    await refresh();
  } catch (err) {
    view.innerHTML = `<div class="empty"><p class="empty-title">Callback couldn't open its storage.</p>
      <p>${esc(err && err.message ? err.message : 'Your browser may be blocking site data, for example in a private window.')}</p></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
