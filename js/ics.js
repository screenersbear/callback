// Calendar (.ics) generation. Kept apart from the screens so a live feed can
// reuse it unchanged if Callback ever gets a server: give it the data, get
// back calendar text.
import { addDays, todayStr } from './util.js';
import { lastTouchpoint, WARMTH_INFO } from './cadence.js';
import { pickIdea } from './ideas.js';
import { touchTypeLabel } from './model.js';

const UID_HOST = 'callback.screenersbear.github.io';

const compact = (d) => d.replace(/-/g, '');

function who(person, orgsById) {
  const org = person.organizationId && orgsById.get(person.organizationId);
  if (person.role && org) return `${person.role} at ${org.name}`;
  return person.role || (org ? org.name : '');
}

// Upcoming touchpoints for the next `days` days, as plain event objects.
// Overdue people land on today. The uid comes from the person and their
// scheduled date, so exporting again doesn't duplicate an event in calendar
// apps that honour UIDs.
export function upcomingEvents(
  { people, orgsById, touchpointsByPerson, news },
  { today = todayStr(), days = 90, appUrl = '' } = {}
) {
  const end = addDays(today, days);
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const events = [];

  for (const p of people) {
    const scheduled = p.nextTouchpointDate || today;
    const date = scheduled < today ? today : scheduled;
    if (date > end) continue;
    const last = lastTouchpoint(touchpointsByPerson.get(p.id) || []);
    const lines = [];
    const role = who(p, orgsById);
    if (role) lines.push(role);
    if (p.warmth === 'parked') lines.push(`${WARMTH_INFO.parked.label} for a while. Worth trying again?`);
    if (last) {
      const how = touchTypeLabel(last.type);
      lines.push(`Last touchpoint (${last.date}, ${how})${last.note ? `: ${last.note}` : ''}`);
    } else {
      lines.push('No touchpoints yet.');
    }
    lines.push(`Idea: ${pickIdea(p, date)}`);
    if (appUrl) lines.push(`${appUrl}#/person/${p.id}`);
    events.push({
      uid: `${p.id}-${compact(scheduled)}@${UID_HOST}`,
      date,
      summary: `Callback: ${p.name}`,
      description: lines.join('\n'),
    });
  }

  for (const n of news) {
    const p = peopleById.get(n.personId);
    if (!p || n.dismissedAt || n.date < today || n.date > end) continue;
    const lines = [`Their news: ${n.description}`];
    const role = who(p, orgsById);
    if (role) lines.push(role);
    lines.push('Idea: Congratulate them, or send something that fits the moment.');
    if (appUrl) lines.push(`${appUrl}#/person/${p.id}`);
    events.push({
      uid: `news-${n.id}-${compact(n.date)}@${UID_HOST}`,
      date: n.date,
      summary: `Callback: ${p.name}`,
      description: lines.join('\n'),
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary));
}

function escText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 bytes are folded onto continuation lines that start
// with a space (RFC 5545), counting UTF-8 bytes so accents and emoji are safe.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > 75) {
      out.push(cur);
      cur = ' ';
      len = 1;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

function stampUTC(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildCalendar(events, { name = 'Callback', now = new Date() } = {}) {
  const dtstamp = stampUTC(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Callback//Outreach tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText(name)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}`,
      `SUMMARY:${escText(e.summary)}`,
      `DESCRIPTION:${escText(e.description)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
