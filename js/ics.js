// Calendar (.ics) generation. Kept apart from the screens so a live feed can
// reuse it unchanged if Callback ever gets a server: give it the data, get
// back calendar text.
import { addDays, todayStr } from './util.js';
import { lastTouchpoint, WARMTH_INFO, nextYearly, isDreamOnly, ideaStage } from './cadence.js';
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
    if (isDreamOnly(p, touchpointsByPerson.get(p.id) || [])) continue;
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
    const firstContact = ideaStage(p, touchpointsByPerson.get(p.id) || []);
    lines.push(`Idea: ${(p.customIdea || '').trim() || pickIdea(p, date, 0, { firstContact })}`);
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
    if (!p) continue;
    // Yearly dates go in once with a yearly repeat, whatever the window,
    // starting from their next occurrence. Their uid has no date in it, so a
    // later export updates the same event.
    const yearly = !!n.repeatsYearly;
    const date = yearly ? nextYearly(n.date, today) : n.date;
    if (!yearly && (n.dismissedAt || date < today || date > end)) continue;
    const lines = [`Their news: ${n.description}${yearly ? ' (every year)' : ''}`];
    const role = who(p, orgsById);
    if (role) lines.push(role);
    lines.push(/birthday/i.test(n.description)
      ? 'Idea: A card or a print would land well.'
      : 'Idea: Congratulate them, or send something that fits the moment.');
    if (appUrl) lines.push(`${appUrl}#/person/${p.id}`);
    const [, m, d] = n.date.split('-').map(Number);
    events.push({
      uid: yearly ? `news-${n.id}@${UID_HOST}` : `news-${n.id}-${compact(n.date)}@${UID_HOST}`,
      date,
      summary: `Callback: ${p.name}`,
      description: lines.join('\n'),
      // February 29 repeats on the last day of February in other years.
      rrule: yearly ? (m === 2 && d === 29 ? 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1' : 'FREQ=YEARLY') : null,
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
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      `SUMMARY:${escText(e.summary)}`,
      `DESCRIPTION:${escText(e.description)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
