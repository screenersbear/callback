// Callback: screens, routing and actions. Data goes through db.js, the
// scheduling rules through cadence.js; this file only draws and reacts.
import * as db from './db.js';
import {
  todayStr, addDays, daysBetween, fmtDate, fmtLongDate, fmtTimestamp, relDay, span, plural, esc,
  debounce, weekStartStr, toDateStr, parseDate, normalizeUrl, instagramUrl, saveFile, readFileText, nowISO,
} from './util.js';
import {
  WARMTH, WARMTH_INFO, COLD_STEPS, computeNextDate, warmthChangeFields, cadenceLabel, needsParkPrompt,
  needsWarmPrompt, SNOOZE_OPTIONS, snoozeDate, buildToday, coldState, sortTouchpoints,
} from './cadence.js';
import { pickIdea } from './ideas.js';
import { upcomingEvents, buildCalendar } from './ics.js';
import { parseCSV, guessMapping, CSV_FIELDS } from './csv.js';
import {
  TOUCH_TYPES, touchTypeLabel, RESPONDED, respondedLabel, ROLE_SUGGESTIONS, ORG_TYPES, orgTypeLabel,
  NEWS_SUGGESTIONS,
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
  weeks: [],
  personById: new Map(),
  orgById: new Map(),
  tpsByPerson: new Map(),
  newsByPerson: new Map(),
  settings: null,
  meta: {},
  installPrompt: null,
  ui: {
    ideaTurn: new Map(),
    collapsed: new Set(),
    scroll: new Map(),
    backTo: null,
    people: { q: '', sort: 'contact', sortOpen: false, warmth: new Set(), role: '', tag: '', org: '', showParked: false, filtersOpen: false },
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
  const [people, orgs, tps, news, weeks, settings, lastExportAt, installedAt, reminderUntil, lastLogType] =
    await Promise.all([
      db.getPeople(), db.getOrganizations(), db.getTouchpoints(), db.getNews(), db.getWeeks(), db.getSettings(),
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
  S.meta = { lastExportAt, installedAt, reminderUntil, lastLogType };
}

async function refresh() {
  await load();
  render();
}

const tpsOf = (id) => S.tpsByPerson.get(id) || [];
const newsOf = (id) => S.newsByPerson.get(id) || [];
const orgOf = (p) => (p && p.organizationId ? S.orgById.get(p.organizationId) : null);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const firstName = (p) => (p.name || '').trim().split(/\s+/)[0] || 'them';
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);

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

function ideaHTML(p) {
  const turn = S.ui.ideaTurn.get(p.id) || 0;
  return `<div class="idea">
    <span class="idea-label">Idea</span>
    <p class="idea-text">${esc(pickIdea(p, todayStr(), turn))}</p>
    <button type="button" class="idea-next" data-action="next-idea" data-id="${esc(p.id)}">Another idea</button>
  </div>`;
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
  const t = buildToday({ people: S.people, touchpointsByPerson: S.tpsByPerson, news: S.news }, today);
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
  if (t.overdue.length) sections.push(['overdue', 'Overdue', t.overdue.length, t.overdue.map((p) => personCard(p, 'overdue')).join('')]);
  if (t.due.length) sections.push(['due', 'Due today', t.due.length, t.due.map((p) => personCard(p, 'due')).join('')]);
  if (t.news.length) sections.push(['news', 'Their news', t.news.length, t.news.map(newsCard).join('')]);
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
      <button type="button" class="btn secondary" data-action="import-csv">Import a spreadsheet (CSV)</button>
      <button type="button" class="btn secondary" data-action="import-json">Restore a backup</button>
    </div>
  </section>`;
}

function caughtUpHTML(today) {
  const upcoming = S.people
    .filter((p) => p.warmth !== 'parked' && (p.nextTouchpointDate || today) > today)
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

function personCard(p, kind) {
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
      : `<button type="button" class="btn primary" data-action="log" data-id="${id}">Log touchpoint</button>
         <button type="button" class="btn secondary" data-action="snooze" data-id="${id}">Snooze</button>
         <button type="button" class="btn secondary" data-action="open-person" data-id="${id}">Open</button>`;
  const sub = subLine(p);
  return `<article class="item-card${kind === 'overdue' ? ' is-overdue' : ''}">
    <a class="item-head" href="#/person/${id}">
      <span class="item-who"><span class="item-name">${esc(p.name)}</span>${sub ? `<span class="item-sub">${sub}</span>` : ''}</span>
      ${warmthBadge(p.warmth)}
    </a>
    <p class="item-facts">${facts.join(' <span class="dot">·</span> ')}</p>
    ${last && last.note ? `<p class="item-last"><span class="item-last-label">Last:</span> ${esc(last.note)}</p>` : ''}
    ${prompt || ideaHTML(p)}
    <div class="item-actions">${actions}</div>
  </article>`;
}

function newsCard(n) {
  const p = S.personById.get(n.personId);
  const today = todayStr();
  const id = esc(p.id);
  const sub = subLine(p);
  return `<article class="item-card news-card">
    <a class="item-head" href="#/person/${id}">
      <span class="item-who"><span class="item-name">${esc(p.name)}</span>${sub ? `<span class="item-sub">${sub}</span>` : ''}</span>
      ${warmthBadge(p.warmth)}
    </a>
    <p class="news-line"><span class="news-when">${n.date === today ? 'Today' : esc(cap(relDay(n.date, today)))}</span>${esc(n.description)}</p>
    <p class="item-facts">${esc(sinceText(p, today))}</p>
    <div class="idea"><span class="idea-label">Idea</span><p class="idea-text">Congratulate them, or send something that fits the moment.</p></div>
    <div class="item-actions">
      <button type="button" class="btn primary" data-action="log" data-id="${id}" data-news="${esc(n.id)}">Log touchpoint</button>
      <button type="button" class="btn secondary" data-action="dismiss-news" data-id="${esc(n.id)}">Dismiss</button>
      <button type="button" class="btn secondary" data-action="open-person" data-id="${id}">Open</button>
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
  if (p.warmth === 'parked') nextText = `Back ${esc(fmtDate(next, { weekday: false }))}`;
  else if (next < today) nextText = `<b>${esc(nextRelText(next, today))}</b>`;
  else if (next === today) nextText = '<b>Due today</b>';
  else nextText = `Next ${esc(fmtDate(next, { weekday: false }))}`;
  return `<a class="row-card${p.warmth === 'parked' ? ' is-parked' : ''}" href="#/person/${esc(p.id)}">
    <span class="row-main">
      <span class="row-name">${esc(p.name)}</span>
      ${sub ? `<span class="row-sub">${sub}</span>` : ''}
      <span class="row-meta"><span class="nowrap">${esc(sinceText(p, today))}</span> <span class="dot">·</span> <span class="nowrap">${nextText}</span></span>
    </span>
    ${warmthBadge(p.warmth)}
  </a>`;
}

function filteredPeople() {
  const f = S.ui.people;
  const today = todayStr();
  const q = f.q.trim().toLowerCase();
  let list = S.people.filter((p) => f.showParked || p.warmth !== 'parked');
  if (f.warmth.size) list = list.filter((p) => f.warmth.has(p.warmth));
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
  return f.warmth.size + (f.role ? 1 : 0) + (f.tag ? 1 : 0) + (f.org ? 1 : 0);
}

function peopleListHTML() {
  if (!S.people.length) {
    return `<div class="empty">
      <p class="empty-title">No one here yet.</p>
      <p>Add the casting directors, bookers, editors and clients you want to stay close to. Callback will tell you when to reach out.</p>
      <button type="button" class="hero-cta" data-action="add-person">Add your first person</button>
      <button type="button" class="btn secondary wide" data-action="import-csv">Import a spreadsheet (CSV)</button>
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
      <button type="button" class="icon-btn" data-action="add-person" aria-label="Add person">+</button></header>
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
      <button type="button" class="warmth-btn" data-action="change-warmth" data-id="${pid}" aria-label="Change warmth, now ${esc(WARMTH_INFO[p.warmth].label)}">
        ${warmthBadge(p.warmth)}<span class="warmth-btn-hint">Change</span></button>
    </header>
    <section class="next-panel${overdue ? ' is-overdue' : ''}">
      <p class="next-label">${p.warmth === 'parked' ? 'Comes back' : 'Next touchpoint'}</p>
      <p class="next-date">${esc(fmtDate(next))}</p>
      <p class="next-rel">${esc(nextRelText(next, today))} <span class="dot">·</span> ${esc(cadenceLabel(p, tps, S.settings))}</p>
      <div class="next-actions">
        <button type="button" class="btn on-ink" data-action="snooze" data-id="${pid}">Snooze</button>
        <button type="button" class="btn on-ink" data-action="change-date" data-id="${pid}">Change date</button>
      </div>
    </section>
    ${prompt}
    <button type="button" class="hero-cta log-cta" data-action="log" data-id="${pid}">Log touchpoint</button>
    ${p.warmth === 'parked' ? '' : ideaHTML(p)}
    ${sectionBlock('details', 'Details', null, detailsHTML(p), 'navy')}`;

  const right = `
    ${sectionBlock('news', 'Their news', newsOf(id).length, newsListHTML(p), 'yellow')}
    ${sectionBlock('timeline', 'Touchpoints', tps.length, timelineHTML(p, tps), 'navy')}`;

  return `
    <div class="detail-top">${backButton('#/people', 'Back')}
      <button type="button" class="text-btn" data-action="edit-person" data-id="${pid}">Edit</button></div>
    <div class="detail-cols"><div class="detail-col">${left}</div><div class="detail-col">${right}</div></div>`;
}

function detailsHTML(p) {
  const rows = [];
  const row = (label, value) => rows.push(`<div class="detail-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`);
  if (p.email) row('Email', `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`);
  if (p.phone) row('Phone', `<a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>`);
  if (p.instagram) row('Instagram', `<a href="${esc(instagramUrl(p.instagram))}" target="_blank" rel="noopener">${esc(p.instagram.startsWith('@') || /instagram\.com/i.test(p.instagram) ? p.instagram : `@${p.instagram}`)}</a>`);
  if (p.website) row('Website', `<a href="${esc(normalizeUrl(p.website))}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, ''))}</a>`);
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
  const hint = rows.length <= 1 ? `<p class="hint">Add contact details, how you met and notes with <button type="button" class="text-btn inline" data-action="edit-person" data-id="${esc(p.id)}">Edit</button>.</p>` : '';
  return `<dl class="details">${rows.join('')}</dl>${hint}`;
}

function newsListHTML(p) {
  const today = todayStr();
  const list = newsOf(p.id);
  const upcoming = list.filter((n) => n.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = list.filter((n) => n.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const item = (n) => `<button type="button" class="news-item${n.date < today ? ' is-past' : ''}" data-action="edit-news" data-id="${esc(n.id)}">
      <span class="news-item-date">${esc(fmtDate(n.date, { weekday: false }))}</span>
      <span class="news-item-text">${esc(n.description)}</span>
      <span class="news-item-rel">${esc(n.date === today ? 'Today' : cap(relDay(n.date, today)))}</span>
    </button>`;
  return `
    <p class="hint">Upcoming dates worth reaching out about: a premiere, a launch, a new agency. They show up on Today when the day comes.</p>
    ${upcoming.map(item).join('')}${past.map(item).join('')}
    <button type="button" class="primary small-btn" data-action="add-news" data-id="${esc(p.id)}">+ Add a date</button>`;
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
          <p class="tl-head"><span class="tl-date">${esc(fmtDate(t.date))}</span><span class="tl-type">${esc(touchTypeLabel(t.type))}</span></p>
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

function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function installHTML() {
  if (isStandalone()) return '<p>Callback is installed on this device. It works offline, and your data stays here.</p>';
  if (S.installPrompt) {
    return `<p>Install Callback to open it from your home screen or dock, like any other app. It works offline.</p>
      <button type="button" class="primary small-btn" data-action="install">Install Callback</button>`;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return '<p>To install on iPhone or iPad: open Callback in Safari, tap the Share button, then Add to Home Screen.</p>';
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

    ${sectionBlock('set-look', 'Appearance', null, `
      <div class="seg" role="radiogroup" aria-label="Appearance">
        ${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']]
          .map(([k, label]) => `<label class="seg-option"><input type="radio" name="appearance" value="${k}"${appearance === k ? ' checked' : ''}><span>${label}</span></label>`)
          .join('')}
      </div>`, 'yellow')}

    ${sectionBlock('set-data', 'Your data', null, `
      <p>Everything lives on this device, in this browser. Nothing is sent anywhere. Export a backup now and then so it's safe, and to move to another device.</p>
      <p class="set-fact">Last backup: <b>${S.meta.lastExportAt ? esc(fmtTimestamp(S.meta.lastExportAt)) : 'never'}</b></p>
      <div class="button-stack">
        <button type="button" class="primary small-btn" data-action="export-json">Export backup (JSON)</button>
        <button type="button" class="secondary small-btn" data-action="import-json">Import backup</button>
        <button type="button" class="secondary small-btn" data-action="import-csv">Import people from a spreadsheet (CSV)</button>
      </div>`, 'navy')}

    ${sectionBlock('set-cal', 'Calendar', null, `
      <p>Download your next 90 days of touchpoints as a calendar file, one all-day event per person. ${events.length ? `Right now that's ${plural(events.length, 'event')}.` : 'Nothing is scheduled in the next 90 days yet.'}</p>
      <p class="tip"><b>Tip:</b> import it into its own calendar named Callback. When you want fresh dates, delete that calendar, make it again, and import the new file. In Google Calendar on a computer: Settings, Add calendar, Create new calendar, then Import and pick Callback.</p>
      <button type="button" class="primary small-btn" data-action="export-ics"${events.length ? '' : ' disabled'}>Download calendar file (.ics)</button>`, 'yellow')}

    ${sectionBlock('set-install', 'Install', null, installHTML(), 'navy')}

    ${sectionBlock('set-about', 'About', null, `
      <p>Callback is part of a set of free photography apps for Patreon members, alongside Documenting Fictions and Ref.</p>
      <p class="set-fact">Version ${APP_VERSION}</p>
      <button type="button" class="btn danger" data-action="erase-all">Erase everything on this device</button>`, 'yellow')}`;
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
};
const TAB_FOR = { person: 'people', org: 'orgs' };
const TITLES = { today: 'Today', people: 'People', person: 'Person', orgs: 'Organizations', org: 'Organization', week: 'Weekly review', settings: 'Settings' };

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
      ${field('name', 'Name', v.name, 'autocomplete="off" placeholder="Who is it?" required')}
      <p class="field-error" data-error="name" hidden>Add a name first.</p>
      ${field('role', 'Role', v.role, 'list="roleList" autocomplete="off" placeholder="Casting director, editor, client"')}
      <datalist id="roleList">${ROLE_SUGGESTIONS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <label class="field"><span class="field-label">Organization</span>
        <input name="org" list="orgList" value="${esc(org ? org.name : '')}" autocomplete="off" placeholder="Agency, brand, publication">
        <span class="field-hint">Pick one you've added, or type a new name to add it.${org && !isNew ? ' Changing it keeps a note of where they were before.' : ''}</span></label>
      <datalist id="orgList">${S.orgs.map((o) => `<option value="${esc(o.name)}">`).join('')}</datalist>
      <fieldset class="field"><legend class="field-label">Warmth</legend>
        <div class="warmth-options">${WARMTH.map((w) => `<label class="warmth-option">
          <input type="radio" name="warmth" value="${w}"${v.warmth === w ? ' checked' : ''}>
          <span class="warmth-option-body">${warmthBadge(w)}<span class="warmth-option-blurb">${esc(WARMTH_INFO[w].blurb)}</span></span>
        </label>`).join('')}</div></fieldset>
      <label class="field"><span class="field-label">Next touchpoint</span>
        <input type="date" name="next" value="${esc(v.nextTouchpointDate || todayStr())}">
        <span class="field-hint">${isNew ? 'Today puts them on your Today list right away.' : 'Logging a touchpoint sets this for you.'}</span></label>
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

function logSheet(p, { touchpoint = null, newsItem = null } = {}) {
  if (!p) return;
  const editing = !!touchpoint;
  const today = todayStr();
  const v = touchpoint || {
    type: S.meta.lastLogType || 'email',
    date: today,
    note: newsItem ? `Their news: ${newsItem.description}` : '',
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
      ${editing ? '<button type="button" class="btn danger wide" data-delete>Delete touchpoint</button>' : ''}
      <button type="submit" class="modal-cta primary">${editing ? 'Save changes' : 'Save touchpoint'}</button>
    </form>`,
  });
  const form = s.body.querySelector('form');

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
    });
    const all = sortTouchpoints([...before.filter((t) => t.id !== tp.id), tp]);
    // A new touchpoint always resets the schedule. An edit only does when it
    // touches the latest touchpoint, so a snooze survives fixing an old typo.
    const touchesLatest = !editing || all[0].id === tp.id || (before[0] && before[0].id === tp.id);
    const next = touchesLatest ? computeNextDate(p, all, S.settings, today) : p.nextTouchpointDate;
    const person = await db.savePerson({ ...p, nextTouchpointDate: next });
    if (newsItem) await db.saveNews({ ...newsItem, dismissedAt: nowISO() });
    db.setMeta('lastLogType', type);
    db.askToPersist();
    await refresh();

    if (editing) {
      s.close();
      toast('Touchpoint saved');
      return;
    }
    showLogged(s, person, all);
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

function showLogged(s, p, tps) {
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

function dateSheet(p) {
  if (!p) return;
  const s = openSheet({
    title: p.warmth === 'parked' ? 'Bring back on' : 'Next touchpoint',
    className: 'sheet-small',
    body: `<form class="form" novalidate>
      <label class="field"><span class="field-label">Reach out to ${esc(p.name)} on</span>
        <input type="date" name="date" value="${esc(p.nextTouchpointDate || todayStr())}" required></label>
      <button type="submit" class="modal-cta primary">Save date</button>
    </form>`,
  });
  s.body.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = String(new FormData(e.target).get('date') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    await db.savePerson({ ...p, nextTouchpointDate: d });
    s.close();
    await refresh();
    toast(`Next touchpoint ${fmtDate(d)}`);
  });
}

async function snoozeSheet(p) {
  if (!p) return;
  const today = todayStr();
  const key = await choiceSheet({
    title: `Snooze ${p.name}`,
    message: 'They leave Today until the new date.',
    options: [
      ...SNOOZE_OPTIONS.map((o) => ({ key: o.key, label: o.label, detail: fmtDate(o.apply(today)) })),
      { key: 'pick', label: 'Pick a date', detail: 'Choose any day' },
    ],
  });
  if (!key) return;
  if (key === 'pick') {
    dateSheet(p);
    return;
  }
  const d = snoozeDate(key, today);
  const prev = p.nextTouchpointDate;
  await db.savePerson({ ...p, nextTouchpointDate: d });
  await refresh();
  toast(`Snoozed until ${fmtDate(d)}`, {
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
    const rec = { ...(n || {}), personId: p.id, description, date };
    if (n && n.date !== date) rec.dismissedAt = null;
    await db.saveNews(rec);
    s.close();
    await refresh();
    toast(editing ? 'Saved' : `Added. It shows on Today ${relDay(date)}.`);
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

function importCSV() {
  pickFile('.csv,text/csv,text/plain', async (file) => {
    let rows;
    try {
      rows = parseCSV(await readFileText(file));
    } catch {
      toast("That file couldn't be read.");
      return;
    }
    if (!rows.length) {
      toast('That file looks empty.');
      return;
    }
    csvSheet(rows, file.name);
  });
}

function csvSheet(rows, filename) {
  let hasHeader = true;
  let warmth = 'cold';
  const headerNames = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  let map = guessMapping(headerNames);
  const s = openSheet({ title: 'Import people', className: 'sheet-wide' });

  const build = () => {
    const data = hasHeader ? rows.slice(1) : rows;
    const get = (r, k) => (map[k] >= 0 ? String(r[map[k]] || '').trim() : '');
    const emails = new Set(S.people.map((p) => (p.email || '').toLowerCase()).filter(Boolean));
    const names = new Set(S.people.map((p) => p.name.toLowerCase()));
    const out = [];
    let skipped = 0;
    for (const r of data) {
      let name = get(r, 'name');
      const last = get(r, 'lastName');
      if (last) name = `${name} ${last}`.trim();
      if (!name) continue;
      const email = get(r, 'email');
      if ((email && emails.has(email.toLowerCase())) || names.has(name.toLowerCase())) {
        skipped++;
        continue;
      }
      names.add(name.toLowerCase());
      if (email) emails.add(email.toLowerCase());
      out.push({
        name,
        email,
        role: get(r, 'role'),
        orgName: get(r, 'organization'),
        notes: get(r, 'notes'),
        phone: get(r, 'phone'),
        instagram: get(r, 'instagram'),
        website: get(r, 'website'),
        howWeMet: get(r, 'howWeMet'),
        tags: parseTags(get(r, 'tags')),
      });
    }
    return { data, out, skipped };
  };

  const draw = () => {
    const cols = hasHeader ? headerNames : rows[0].map((_, i) => `Column ${i + 1}`);
    const { data, out, skipped } = build();
    const sample = data[0] || [];
    s.body.innerHTML = `
      <p class="sheet-message">${esc(filename)}: ${plural(data.length, 'row')}. Match your columns to Callback's fields. Name is the only one you need.</p>
      <label class="check"><input type="checkbox" data-header${hasHeader ? ' checked' : ''}> The first row has column names</label>
      <div class="map-grid">${CSV_FIELDS.map((f) => `<label class="field"><span class="field-label">${esc(f.label)}</span>
        <select data-field="${f.key}"><option value="-1">Don't import</option>${cols
          .map((c, i) => `<option value="${i}"${map[f.key] === i ? ' selected' : ''}>${esc(c)}${sample[i] ? ` (${esc(trunc(String(sample[i]).trim(), 22))})` : ''}</option>`)
          .join('')}</select></label>`).join('')}</div>
      <label class="field"><span class="field-label">Warmth for everyone in this file</span>
        <select data-warmth>${WARMTH.map((w) => `<option value="${w}"${w === warmth ? ' selected' : ''}>${esc(WARMTH_INFO[w].label)}</option>`).join('')}</select></label>
      <div class="csv-preview">
        <p class="field-label">Preview</p>
        ${out.length ? `<ul>${out.slice(0, 4).map((x) => `<li><b>${esc(x.name)}</b>${x.role || x.orgName ? ` <span class="dot">·</span> ${esc([x.role, x.orgName].filter(Boolean).join(', '))}` : ''}${x.email ? ` <span class="dot">·</span> ${esc(x.email)}` : ''}</li>`).join('')}${out.length > 4 ? `<li>and ${out.length - 4} more</li>` : ''}</ul>` : '<p>No names found with this setup. Check the Name column.</p>'}
        ${skipped ? `<p>${plural(skipped, 'person', 'people')} already in Callback will be skipped.</p>` : ''}
      </div>
      <p class="field-hint">Callback spreads their first touchpoints across the coming weekdays, about ${Math.max(1, Math.ceil(S.settings.goals.touchpoints / 5))} a day, so Today stays manageable.</p>
      <button type="button" class="modal-cta primary" data-go${out.length ? '' : ' disabled'}>Import ${plural(out.length, 'person', 'people')}</button>`;
  };

  s.body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-header]')) hasHeader = t.checked;
    else if (t.matches('[data-field]')) map = { ...map, [t.dataset.field]: Number(t.value) };
    else if (t.matches('[data-warmth]')) warmth = t.value;
    draw();
  });

  s.body.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (!go || go.disabled) return;
    go.disabled = true;
    const { out } = build();
    const today = todayStr();
    const now = nowISO();
    const orgIds = new Map(S.orgs.map((o) => [o.name.trim().toLowerCase(), o.id]));
    for (const x of out) {
      const key = x.orgName.toLowerCase();
      if (x.orgName && !orgIds.has(key)) {
        const o = await db.saveOrganization({ name: x.orgName, type: 'other', website: '', notes: '' });
        orgIds.set(key, o.id);
      }
    }
    const dates = staggeredDates(out.length, Math.max(1, Math.ceil(S.settings.goals.touchpoints / 5)), today);
    const people = out.map(({ orgName, ...x }, i) => {
      const rec = {
        ...x,
        organizationId: orgName ? orgIds.get(orgName.toLowerCase()) : null,
        cadenceOverrideDays: null,
        pastOrganizations: [],
        ...warmthChangeFields({}, warmth, now, today),
        nextTouchpointDate: dates[i],
      };
      if (warmth === 'parked') rec.nextTouchpointDate = computeNextDate(rec, [], S.settings, today);
      return rec;
    });
    await db.savePeople(people);
    db.askToPersist();
    s.close();
    location.hash = '#/people';
    await refresh();
    toast(`${plural(people.length, 'person', 'people')} imported`);
  });

  draw();
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
  'add-person': (el) => personForm(null, el.dataset.org ? { organizationId: el.dataset.org } : {}),
  'edit-person': (el) => personForm(person(el)),
  log: (el) => logSheet(person(el), { newsItem: el.dataset.news ? S.news.find((n) => n.id === el.dataset.news) : null }),
  snooze: (el) => snoozeSheet(person(el)),
  'change-date': (el) => dateSheet(person(el)),
  'open-person': (el) => {
    location.hash = `#/person/${el.dataset.id}`;
  },
  'change-warmth': (el) => warmthSheet(person(el)),
  park: (el) => setWarmth(person(el), 'parked'),
  'make-warm': (el) => setWarmth(person(el), 'warm'),
  unpark: (el) => unpark(person(el)),
  repark: (el) => repark(person(el)),
  'next-idea': (el) => {
    const p = person(el);
    S.ui.ideaTurn.set(p.id, (S.ui.ideaTurn.get(p.id) || 0) + 1);
    el.closest('.idea').querySelector('.idea-text').textContent = pickIdea(p, todayStr(), S.ui.ideaTurn.get(p.id));
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
  'filter-warmth': (el) => {
    const w = el.dataset.w;
    const set = S.ui.people.warmth;
    if (set.has(w)) set.delete(w);
    else set.add(w);
    render();
  },
  'clear-filters': () => {
    Object.assign(S.ui.people, { q: '', warmth: new Set(), role: '', tag: '', org: '' });
    render();
  },
  'edit-reflection': (el) => reflectionSheet(el.dataset.week),
  'export-json': () => exportJSON(),
  'import-json': () => importJSON(),
  'import-csv': () => importCSV(),
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

// Section headings act like buttons from the keyboard too.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('h2[data-action]')) {
    e.preventDefault();
    e.target.click();
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
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
  if (t.dataset.filter === 'parked') {
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
