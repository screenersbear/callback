import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { upcomingEvents, buildCalendar } from '../../js/ics.js';
import { pickIdea, setIdeaLibrary } from '../../js/ideas.js';

const HOST = 'callback.screenersbear.github.io';
const TODAY = '2026-11-12';

function data({ people = [], orgs = [], tps = {}, news = [] } = {}) {
  return {
    people,
    orgsById: new Map(orgs.map((o) => [o.id, o])),
    touchpointsByPerson: new Map(Object.entries(tps)),
    news,
  };
}

const person = (over = {}) => ({
  id: 'p1',
  name: 'Test Person',
  nextTouchpointDate: '2026-11-20',
  customIdea: 'Send the test zine.',
  ...over,
});

const ORG = { id: 'o1', name: 'Test Studio' };

beforeEach(() => setIdeaLibrary([]));
afterEach(() => vi.useRealTimers());

describe('upcomingEvents: people', () => {
  it('makes one all-day event for a person due in the window', () => {
    const events = upcomingEvents(data({ people: [person()] }), { today: TODAY });
    expect(events).toEqual([
      {
        uid: `p1-20261120@${HOST}`,
        date: '2026-11-20',
        summary: 'Callback: Test Person',
        description: 'No touchpoints yet.\nIdea: Send the test zine.',
      },
    ]);
  });

  it('returns an empty list when there is nobody and no news', () => {
    expect(upcomingEvents(data(), { today: TODAY })).toEqual([]);
  });

  it('puts an overdue person on today but keeps the scheduled date in the uid', () => {
    const [e] = upcomingEvents(data({ people: [person({ nextTouchpointDate: '2026-10-30' })] }), { today: TODAY });
    expect(e.date).toBe(TODAY);
    expect(e.uid).toBe(`p1-20261030@${HOST}`);
  });

  it('puts someone with no next date on today', () => {
    const [e] = upcomingEvents(data({ people: [person({ nextTouchpointDate: null })] }), { today: TODAY });
    expect(e.date).toBe(TODAY);
    expect(e.uid).toBe(`p1-20261112@${HOST}`);
  });

  it('includes the last day of the window and leaves out the day after (default 90 days, across the year end)', () => {
    const people = [
      person({ id: 'in', name: 'Inside', nextTouchpointDate: '2027-02-10' }),
      person({ id: 'out', name: 'Outside', nextTouchpointDate: '2027-02-11' }),
    ];
    const events = upcomingEvents(data({ people }), { today: TODAY });
    expect(events.map((e) => e.uid)).toEqual([`in-20270210@${HOST}`]);
  });

  it('honours a custom window length', () => {
    const people = [
      person({ id: 'a', name: 'A', nextTouchpointDate: '2026-11-19' }),
      person({ id: 'b', name: 'B', nextTouchpointDate: '2026-11-20' }),
    ];
    expect(upcomingEvents(data({ people }), { today: TODAY, days: 7 }).map((e) => e.date)).toEqual(['2026-11-19']);
    expect(upcomingEvents(data({ people }), { today: TODAY, days: 0 })).toEqual([]);
  });

  it('skips people only on the dream list, but not once they have touchpoints', () => {
    const tp = { id: 't1', date: '2026-11-01', type: 'email' };
    const people = [
      person({ id: 'dream', name: 'Dream', dreamList: true }),
      person({ id: 'started', name: 'Started', dreamList: true }),
    ];
    const events = upcomingEvents(data({ people, tps: { started: [tp] } }), { today: TODAY });
    expect(events.map((e) => e.summary)).toEqual(['Callback: Started']);
  });

  it('describes the role and organization in every combination', () => {
    const people = [
      person({ id: 'a', name: 'A', role: 'Producer', organizationId: 'o1' }),
      person({ id: 'b', name: 'B', role: 'Producer' }),
      person({ id: 'c', name: 'C', organizationId: 'o1' }),
      person({ id: 'd', name: 'D', role: 'Producer', organizationId: 'missing' }),
      person({ id: 'e', name: 'E', organizationId: 'missing' }),
    ];
    const events = upcomingEvents(data({ people, orgs: [ORG] }), { today: TODAY });
    expect(events.map((e) => e.description.split('\n')[0])).toEqual([
      'Producer at Test Studio',
      'Producer',
      'Test Studio',
      'Producer',
      'No touchpoints yet.',
    ]);
  });

  it('adds a nudge line for parked people', () => {
    const [e] = upcomingEvents(data({ people: [person({ warmth: 'parked' })] }), { today: TODAY });
    expect(e.description).toBe('Parked for a while. Worth trying again?\nNo touchpoints yet.\nIdea: Send the test zine.');
  });

  it('does not add the nudge for other warmths', () => {
    const [e] = upcomingEvents(data({ people: [person({ warmth: 'warm' })] }), { today: TODAY });
    expect(e.description).toBe('No touchpoints yet.\nIdea: Send the test zine.');
  });

  it('describes the latest touchpoint, with its note when it has one', () => {
    const tps = {
      p1: [
        { id: 't1', date: '2026-10-01', type: 'call', note: 'Older call' },
        { id: 't2', date: '2026-11-01', type: 'email', note: 'Sent the test series' },
      ],
      p2: [{ id: 't3', date: '2026-11-02', type: 'dm' }],
      p3: [{ id: 't4', date: '2026-11-03', type: 'carrier-pigeon', note: '' }],
    };
    const people = [person(), person({ id: 'p2', name: 'Test Two' }), person({ id: 'p3', name: 'Test Three' })];
    const events = upcomingEvents(data({ people, tps }), { today: TODAY });
    expect(events.map((e) => e.description.split('\n')[0])).toEqual([
      'Last touchpoint (2026-11-01, Email): Sent the test series',
      'Last touchpoint (2026-11-03, carrier-pigeon)',
      'Last touchpoint (2026-11-02, DM)',
    ]);
  });

  it('adds a link back to the person when an app url is given, and none by default', () => {
    const d = data({ people: [person()] });
    const [linked] = upcomingEvents(d, { today: TODAY, appUrl: 'https://test.example/app/' });
    expect(linked.description.split('\n').pop()).toBe('https://test.example/app/#/person/p1');
    const [plain] = upcomingEvents(d, { today: TODAY });
    expect(plain.description).not.toContain('#/person/');
  });

  it('uses the picked idea for the event day when there is no custom idea (overdue uses today)', () => {
    const p = person({ customIdea: '   ', nextTouchpointDate: '2026-10-05' });
    const tps = { p1: [{ id: 't1', date: '2026-10-01', type: 'email' }] };
    // Guard: the two days pick different ideas, so the test can tell them apart.
    expect(pickIdea(p, TODAY)).not.toBe(pickIdea(p, '2026-10-05'));
    const [e] = upcomingEvents(data({ people: [p], tps }), { today: TODAY });
    expect(e.description.split('\n').pop()).toBe(`Idea: ${pickIdea(p, TODAY)}`);
  });

  it('uses the picked idea when customIdea is missing', () => {
    const p = person({ customIdea: undefined });
    const tps = { p1: [{ id: 't1', date: '2026-10-01', type: 'email' }] };
    const [e] = upcomingEvents(data({ people: [p], tps }), { today: TODAY });
    expect(e.description.split('\n').pop()).toBe(`Idea: ${pickIdea(p, '2026-11-20')}`);
  });

  it('trims a custom idea', () => {
    const [e] = upcomingEvents(data({ people: [person({ customIdea: '  Send a print.  ' })] }), { today: TODAY });
    expect(e.description).toBe('No touchpoints yet.\nIdea: Send a print.');
  });

  it('picks first-contact ideas before the first touchpoint', () => {
    const justMet = ["Send a quick note while it's fresh.", 'Share the frame or idea you talked about.'];
    const p = person({ customIdea: '', firstContact: 'justMet' });
    const [e] = upcomingEvents(data({ people: [p] }), { today: TODAY });
    const idea = e.description.split('\n').pop().replace(/^Idea: /, '');
    expect(justMet).toContain(idea);
  });

  it('starts a light touch with a follow', () => {
    const p = person({ customIdea: '', lightTouch: true });
    const [e] = upcomingEvents(data({ people: [p] }), { today: TODAY });
    expect(e.description).toBe("No touchpoints yet.\nIdea: Follow them and send a quick note while it's fresh.");
  });

  it('stops using first-contact ideas once there is a touchpoint', () => {
    const justMet = ["Send a quick note while it's fresh.", 'Share the frame or idea you talked about.'];
    const p = person({ customIdea: '', firstContact: 'justMet' });
    const tps = { p1: [{ id: 't1', date: '2026-11-01', type: 'email' }] };
    const [e] = upcomingEvents(data({ people: [p], tps }), { today: TODAY });
    const idea = e.description.split('\n').pop().replace(/^Idea: /, '');
    expect(justMet).not.toContain(idea);
    expect(idea).toBe(pickIdea(p, '2026-11-20'));
  });

  it('gives a light touch with touchpoints the light ideas, not the first follow', () => {
    const p = person({ customIdea: '', lightTouch: true });
    const tps = { p1: [{ id: 't1', date: '2026-11-01', type: 'dm' }] };
    const [e] = upcomingEvents(data({ people: [p], tps }), { today: TODAY });
    expect(e.description.split('\n').pop()).toBe(`Idea: ${pickIdea(p, '2026-11-20')}`);
    expect(e.description).not.toContain('Follow them');
  });

  it('copes with a person missing from the touchpoint map', () => {
    const p = person({ customIdea: '', firstContact: 'reachOutNow' });
    const d = { people: [p], orgsById: new Map(), touchpointsByPerson: new Map(), news: [] };
    const [e] = upcomingEvents(d, { today: TODAY });
    expect(e.description.startsWith('No touchpoints yet.\nIdea: ')).toBe(true);
  });

  it('uses the real date when no today is given (across a year end)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 30));
    const [e] = upcomingEvents(data({ people: [person({ nextTouchpointDate: '2026-12-01' })] }));
    expect(e.date).toBe('2026-12-31');
  });
});

describe('upcomingEvents: news', () => {
  const p = person({ nextTouchpointDate: '2099-01-01' });

  it('adds one-off news inside the window with a dated uid and no repeat', () => {
    const news = [{ id: 'n1', personId: 'p1', date: '2026-11-25', description: 'Opened a test show' }];
    const events = upcomingEvents(data({ people: [p], news }), { today: TODAY });
    expect(events).toEqual([
      {
        uid: `news-n1-20261125@${HOST}`,
        date: '2026-11-25',
        summary: 'Callback: Test Person',
        description: 'Their news: Opened a test show\nIdea: Congratulate them, or send something that fits the moment.',
        rrule: null,
      },
    ]);
  });

  it('keeps one-off news on today and on the last day, and drops it before, after, or once dismissed', () => {
    const news = [
      { id: 'today', personId: 'p1', date: TODAY, description: 'A' },
      { id: 'last', personId: 'p1', date: '2026-11-19', description: 'B' },
      { id: 'past', personId: 'p1', date: '2026-11-11', description: 'C' },
      { id: 'later', personId: 'p1', date: '2026-11-20', description: 'D' },
      { id: 'gone', personId: 'p1', date: '2026-11-15', description: 'E', dismissedAt: '2026-11-10T10:00:00Z' },
    ];
    const events = upcomingEvents(data({ people: [p], news }), { today: TODAY, days: 7 });
    expect(events.map((e) => e.uid)).toEqual([`news-today-20261112@${HOST}`, `news-last-20261119@${HOST}`]);
  });

  it('adds yearly news once, from its next occurrence, whatever the window or dismissal', () => {
    const news = [
      {
        id: 'b1',
        personId: 'p1',
        date: '1990-10-01',
        description: 'Birthday',
        repeatsYearly: true,
        dismissedAt: '2026-10-01T10:00:00Z',
      },
    ];
    const events = upcomingEvents(data({ people: [p], news }), { today: TODAY, days: 7 });
    expect(events).toEqual([
      {
        uid: `news-b1@${HOST}`,
        date: '2027-10-01',
        summary: 'Callback: Test Person',
        description: 'Their news: Birthday (every year)\nIdea: A card or a print would land well.',
        rrule: 'FREQ=YEARLY',
      },
    ]);
  });

  it('repeats February 29 on the last day of February, and only that date', () => {
    const news = [
      { id: 'leap', personId: 'p1', date: '2000-02-29', description: 'Leap birthday', repeatsYearly: true },
      { id: 'feb28', personId: 'p1', date: '2000-02-28', description: 'Studio anniversary', repeatsYearly: true },
      { id: 'mar29', personId: 'p1', date: '2000-03-29', description: 'Agency anniversary', repeatsYearly: true },
    ];
    const events = upcomingEvents(data({ people: [p], news }), { today: TODAY });
    const byUid = Object.fromEntries(events.map((e) => [e.uid, e]));
    expect(byUid[`news-leap@${HOST}`].rrule).toBe('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1');
    expect(byUid[`news-leap@${HOST}`].date).toBe('2027-02-28');
    expect(byUid[`news-feb28@${HOST}`].rrule).toBe('FREQ=YEARLY');
    expect(byUid[`news-mar29@${HOST}`].rrule).toBe('FREQ=YEARLY');
    expect(byUid[`news-mar29@${HOST}`].description).toBe(
      'Their news: Agency anniversary (every year)\nIdea: Congratulate them, or send something that fits the moment.'
    );
  });

  it('matches birthday in any case', () => {
    const news = [{ id: 'n1', personId: 'p1', date: '2026-11-13', description: 'Test Person BIRTHDAY party' }];
    const [e] = upcomingEvents(data({ people: [p], news }), { today: TODAY });
    expect(e.description).toBe('Their news: Test Person BIRTHDAY party\nIdea: A card or a print would land well.');
  });

  it('adds the role and app link to news events', () => {
    const q = person({ role: 'Editor', organizationId: 'o1', nextTouchpointDate: '2099-01-01' });
    const news = [{ id: 'n1', personId: 'p1', date: '2026-11-13', description: 'New issue' }];
    const [e] = upcomingEvents(data({ people: [q], orgs: [ORG], news }), { today: TODAY, appUrl: 'https://test.example/' });
    expect(e.description).toBe(
      'Their news: New issue\nEditor at Test Studio\nIdea: Congratulate them, or send something that fits the moment.\nhttps://test.example/#/person/p1'
    );
  });

  it('skips news for someone who is not in the list', () => {
    const news = [{ id: 'n1', personId: 'ghost', date: '2026-11-13', description: 'Orphan news' }];
    expect(upcomingEvents(data({ people: [p], news }), { today: TODAY })).toEqual([]);
  });

  it('sorts by date, then by summary', () => {
    const people = [
      person({ id: 'z', name: 'Zed Test', nextTouchpointDate: '2026-11-14' }),
      person({ id: 'a', name: 'Ann Test', nextTouchpointDate: '2026-11-14' }),
      person({ id: 'm', name: 'Mid Test', nextTouchpointDate: '2026-11-13' }),
    ];
    const news = [{ id: 'n1', personId: 'z', date: '2026-11-12', description: 'Wrapped a test film' }];
    const events = upcomingEvents(data({ people, news }), { today: TODAY });
    expect(events.map((e) => `${e.date} ${e.summary}`)).toEqual([
      '2026-11-12 Callback: Zed Test',
      '2026-11-13 Callback: Mid Test',
      '2026-11-14 Callback: Ann Test',
      '2026-11-14 Callback: Zed Test',
    ]);
  });
});

describe('buildCalendar', () => {
  const NOW = new Date(Date.UTC(2026, 10, 12, 9, 30, 5, 123));
  const HEAD = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Callback//Outreach tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  it('builds an empty calendar with the default name', () => {
    expect(buildCalendar([], { now: NOW })).toBe([...HEAD, 'X-WR-CALNAME:Callback', 'END:VCALENDAR'].join('\r\n') + '\r\n');
  });

  it('writes one all-day event per item', () => {
    const ev = { uid: `p1-20261120@${HOST}`, date: '2026-11-20', summary: 'Callback: Test Person', description: 'Idea' };
    expect(buildCalendar([ev], { name: 'Test Cal', now: NOW })).toBe(
      [
        ...HEAD,
        'X-WR-CALNAME:Test Cal',
        'BEGIN:VEVENT',
        `UID:p1-20261120@${HOST}`,
        'DTSTAMP:20261112T093005Z',
        'DTSTART;VALUE=DATE:20261120',
        'DTEND;VALUE=DATE:20261121',
        'SUMMARY:Callback: Test Person',
        'DESCRIPTION:Idea',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n') + '\r\n'
    );
  });

  it('adds RRULE only when the event repeats', () => {
    const base = { uid: 'u', date: '2026-11-20', summary: 'S', description: 'D' };
    const out = buildCalendar([{ ...base, rrule: 'FREQ=YEARLY' }, { ...base, uid: 'v', rrule: null }, { ...base, uid: 'w' }], { now: NOW });
    expect(out.match(/RRULE:/g)).toHaveLength(1);
    expect(out).toContain('DTEND;VALUE=DATE:20261121\r\nRRULE:FREQ=YEARLY\r\nSUMMARY:S');
  });

  it('ends events on the next day across month, year and leap-day boundaries', () => {
    const ev = (date) => ({ uid: date, date, summary: 'S', description: 'D' });
    const out = buildCalendar([ev('2026-12-31'), ev('2027-02-28'), ev('2028-02-28'), ev('2026-11-30')], { now: NOW });
    const ends = out.match(/DTEND;VALUE=DATE:\d+/g);
    expect(ends).toEqual([
      'DTEND;VALUE=DATE:20270101',
      'DTEND;VALUE=DATE:20270301',
      'DTEND;VALUE=DATE:20280229',
      'DTEND;VALUE=DATE:20261201',
    ]);
  });

  it('escapes backslashes, semicolons, commas and newlines in text', () => {
    const ev = { uid: 'u', date: '2026-11-20', summary: 'A; B, C\\D', description: 'one\ntwo\r\nthree' };
    const out = buildCalendar([ev], { name: 'Mine; yours, ours\\', now: NOW });
    expect(out).toContain('\r\nX-WR-CALNAME:Mine\\; yours\\, ours\\\\\r\n');
    expect(out).toContain('\r\nSUMMARY:A\\; B\\, C\\\\D\r\n');
    expect(out).toContain('\r\nDESCRIPTION:one\\ntwo\\nthree\r\n');
  });

  it('turns non-string text into strings', () => {
    const out = buildCalendar([{ uid: 'u', date: '2026-11-20', summary: 42, description: null }], { name: 7, now: NOW });
    expect(out).toContain('\r\nX-WR-CALNAME:7\r\n');
    expect(out).toContain('\r\nSUMMARY:42\r\n');
    expect(out).toContain('\r\nDESCRIPTION:null\r\n');
  });

  it('stamps with the current time by default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)));
    const out = buildCalendar([{ uid: 'u', date: '2026-12-31', summary: 'S', description: 'D' }]);
    expect(out).toContain('\r\nDTSTAMP:20261231T235959Z\r\n');
    expect(out).toContain('\r\nX-WR-CALNAME:Callback\r\n');
  });

  it('leaves a 75-byte line alone and folds a 76-byte one', () => {
    const at75 = 'S'.repeat(75 - 'SUMMARY:'.length);
    const at76 = 'S'.repeat(76 - 'SUMMARY:'.length);
    const out = buildCalendar(
      [
        { uid: 'a', date: '2026-11-20', summary: at75, description: 'D' },
        { uid: 'b', date: '2026-11-20', summary: at76, description: 'D' },
      ],
      { now: NOW }
    );
    const lines = out.split('\r\n');
    expect(lines).toContain(`SUMMARY:${at75}`);
    // The first SUMMARY line is the 75-byte one; the folded one comes after it.
    const i = lines.lastIndexOf(`SUMMARY:${at76.slice(0, -1)}`);
    expect(i).toBeGreaterThan(lines.indexOf(`SUMMARY:${at75}`));
    expect(i).toBeGreaterThan(-1);
    expect(lines[i + 1]).toBe(' S');
  });

  it('folds long lines into 75-byte pieces that join back to the original', () => {
    const description = 'x'.repeat(200);
    const out = buildCalendar([{ uid: 'u', date: '2026-11-20', summary: 'S', description }], { now: NOW });
    const lines = out.split('\r\n');
    const start = lines.findIndex((l) => l.startsWith('DESCRIPTION:'));
    // Nothing stray before the folded line, and the event closes right after it.
    expect(lines[start - 1]).toBe('SUMMARY:S');
    const pieces = [lines[start]];
    for (let i = start + 1; lines[i].startsWith(' '); i++) pieces.push(lines[i]);
    expect(lines[start + pieces.length]).toBe('TRANSP:TRANSPARENT');
    // 212 characters: 75 on the first line, then a space plus 74, then a space plus the last 63.
    expect(pieces.map((l) => l.length)).toEqual([75, 75, 64]);
    expect(pieces[0] + pieces.slice(1).map((l) => l.slice(1)).join('')).toBe(`DESCRIPTION:${description}`);
  });

  it('counts bytes, not characters, and never splits a multi-byte character', () => {
    const description = 'é'.repeat(40) + '😀'.repeat(10);
    const out = buildCalendar([{ uid: 'u', date: '2026-11-20', summary: 'S', description }], { now: NOW });
    const enc = new TextEncoder();
    const lines = out.split('\r\n');
    const start = lines.findIndex((l) => l.startsWith('DESCRIPTION:'));
    const pieces = [lines[start]];
    for (let i = start + 1; lines[i].startsWith(' '); i++) pieces.push(lines[i]);
    expect(pieces.length).toBeGreaterThan(1);
    for (const l of pieces) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    // 12 bytes of "DESCRIPTION:" + 31 two-byte letters = 74; the 32nd would make 76.
    expect(pieces[0]).toBe(`DESCRIPTION:${'é'.repeat(31)}`);
    expect(pieces[0] + pieces.slice(1).map((l) => l.slice(1)).join('')).toBe(`DESCRIPTION:${description}`);
    expect(out).not.toContain('�');
  });
});
