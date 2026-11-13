// Unit tests for js/cadence.js, part 4: buildToday, everything the Today
// screen lists. "Today" is Wednesday 2026-03-11; its week runs Monday the
// 9th to Sunday the 15th.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildToday } from '../../js/cadence.js';

const TODAY = '2026-03-11';
const NOW = new Date('2026-03-11T12:00:00');

const person = (id, extra = {}) => ({ id, name: `Test ${id}`, warmth: 'warm', ...extra });
const build = ({ people = [], tps = {}, news = [], loops, now = NOW } = {}, today = TODAY) => {
  const input = { people, touchpointsByPerson: new Map(Object.entries(tps)), news, now };
  if (loops) input.loops = loops;
  return buildToday(input, today);
};
const ids = (list) => list.map((x) => x.id);

afterEach(() => {
  vi.useRealTimers();
});

describe('buildToday: empty', () => {
  it('returns every section empty for nobody', () => {
    expect(build()).toEqual({
      justMet: [], overdue: [], due: [], news: [], dueNews: new Map(), comingUp: [],
      resurfaced: [], loops: [], loopsComing: [], light: [], replyChecks: [],
    });
  });

  it('lists nobody whose next date is still ahead', () => {
    const r = build({ people: [person('a', { nextTouchpointDate: '2026-03-12' })] });
    expect([...r.overdue, ...r.due, ...r.resurfaced, ...r.light, ...r.justMet]).toEqual([]);
  });
});

describe('buildToday: overdue and due', () => {
  it('splits people into overdue and due today, no date counting as today', () => {
    const r = build({ people: [
      person('late', { nextTouchpointDate: '2026-03-10' }),
      person('now', { nextTouchpointDate: TODAY }),
      person('soon', { nextTouchpointDate: '2026-03-12' }),
      person('undated'),
    ] });
    expect(ids(r.overdue)).toEqual(['late']);
    expect(ids(r.due)).toEqual(['now', 'undated']);
  });

  it('sorts overdue people by how late they are, oldest first, across a year end', () => {
    const r = build({ people: [
      person('b', { nextTouchpointDate: '2026-01-02' }),
      person('c', { nextTouchpointDate: '2026-03-10' }),
      person('a', { nextTouchpointDate: '2025-12-30' }),
    ] });
    expect(ids(r.overdue)).toEqual(['a', 'b', 'c']);
  });

  it('sorts people due today by name', () => {
    const r = build({ people: [
      person('3', { name: 'Test Cleo', nextTouchpointDate: TODAY }),
      person('1', { name: 'Test Ada' }),
      person('2', { name: 'Test Bo', nextTouchpointDate: TODAY }),
    ] });
    expect(r.due.map((p) => p.name)).toEqual(['Test Ada', 'Test Bo', 'Test Cleo']);
  });
});

describe('buildToday: parked', () => {
  it('brings parked people back once their date comes, never as overdue', () => {
    const r = build({ people: [
      person('future', { warmth: 'parked', nextTouchpointDate: '2026-03-12' }),
      person('today', { warmth: 'parked', nextTouchpointDate: TODAY }),
      person('past', { warmth: 'parked', nextTouchpointDate: '2026-02-01' }),
      person('undated', { warmth: 'parked' }),
    ] });
    expect(ids(r.resurfaced)).toEqual(['past', 'today', 'undated']);
    expect(r.overdue).toEqual([]);
    expect(r.due).toEqual([]);
  });

  it('sorts resurfaced people by date, no date counting as today', () => {
    const r = build({ people: [
      person('undated', { warmth: 'parked' }),
      person('past', { warmth: 'parked', nextTouchpointDate: '2026-03-10' }),
    ] });
    expect(ids(r.resurfaced)).toEqual(['past', 'undated']);
    const r2 = build({ people: [
      person('past', { warmth: 'parked', nextTouchpointDate: '2026-03-10' }),
      person('undated', { warmth: 'parked' }),
    ] });
    expect(ids(r2.resurfaced)).toEqual(['past', 'undated']);
  });
});

describe('buildToday: light touches', () => {
  it('lists light touches due by the end of this week, missed ones included, never as overdue', () => {
    const r = build({ people: [
      person('sunday', { lightTouch: true, nextTouchpointDate: '2026-03-15' }),
      person('monday', { lightTouch: true, nextTouchpointDate: '2026-03-16' }),
      person('missed', { lightTouch: true, nextTouchpointDate: '2026-02-01' }),
      person('undated', { lightTouch: true }),
    ], tps: { sunday: [{ date: '2026-01-01' }] } });
    expect(ids(r.light)).toEqual(['missed', 'undated', 'sunday']);
    expect(r.overdue).toEqual([]);
    expect(r.due).toEqual([]);
  });

  it('leaves out light touches who are only on the dream list', () => {
    const r = build({ people: [
      person('dream', { lightTouch: true, dreamList: true, nextTouchpointDate: '2026-03-01' }),
      person('dreamTalked', { lightTouch: true, dreamList: true, nextTouchpointDate: '2026-03-01' }),
    ], tps: { dreamTalked: [{ date: '2026-01-01', responded: 'no' }] } });
    expect(ids(r.light)).toEqual(['dreamTalked']);
  });

  it('treats a parked light touch as parked', () => {
    const r = build({ people: [person('p', { lightTouch: true, warmth: 'parked', nextTouchpointDate: '2026-03-01' })] });
    expect(r.light).toEqual([]);
    expect(ids(r.resurfaced)).toEqual(['p']);
  });

  it('sorts light touches by date, then by name', () => {
    const r = build({ people: [
      person('z', { name: 'Test Zed', lightTouch: true, nextTouchpointDate: '2026-03-01' }),
      person('y', { name: 'Test Amy', lightTouch: true, nextTouchpointDate: '2026-03-14' }),
      person('x', { name: 'Test Max', lightTouch: true, nextTouchpointDate: '2026-03-01' }),
      person('w', { name: 'Test Bea', lightTouch: true }),
    ] });
    expect(ids(r.light)).toEqual(['x', 'z', 'w', 'y']);
  });

  it('runs the week to the next Sunday across a year end', () => {
    const r = build({ people: [
      person('in', { lightTouch: true, nextTouchpointDate: '2027-01-03' }),
      person('out', { lightTouch: true, nextTouchpointDate: '2027-01-04' }),
    ] }, '2026-12-30');
    expect(ids(r.light)).toEqual(['in']);
  });
});

describe('buildToday: just met and dream list', () => {
  it('keeps people just met in their own section until the first touchpoint', () => {
    const r = build({ people: [
      person('fresh', { firstContact: 'justMet', nextTouchpointDate: '2026-03-10' }),
      person('later', { firstContact: 'justMet', nextTouchpointDate: '2026-04-01' }),
      person('talked', { firstContact: 'justMet', nextTouchpointDate: '2026-03-10' }),
    ], tps: { talked: [{ date: '2026-03-01', responded: 'no' }] } });
    expect(ids(r.justMet)).toEqual(['fresh', 'later']);
    expect(ids(r.overdue)).toEqual(['talked']);
  });

  it('does not count someone just met as due today as well', () => {
    const r = build({ people: [person('fresh', { firstContact: 'justMet' })] });
    expect(ids(r.justMet)).toEqual(['fresh']);
    expect(r.due).toEqual([]);
  });

  it('treats a parked person as parked even if just met', () => {
    const r = build({ people: [person('p', { firstContact: 'justMet', warmth: 'parked', nextTouchpointDate: '2026-03-01' })] });
    expect(r.justMet).toEqual([]);
    expect(ids(r.resurfaced)).toEqual(['p']);
  });

  it('sorts people just met by their deadline, then name, no deadline counting as today', () => {
    const r = build({ people: [
      person('none', { name: 'Test Ann', firstContact: 'justMet' }),
      person('late', { name: 'Test Bob', firstContact: 'justMet', firstContactDeadline: '2026-03-12' }),
      person('b', { name: 'Test Zoe', firstContact: 'justMet', firstContactDeadline: '2026-03-10' }),
      person('a', { name: 'Test Kim', firstContact: 'justMet', firstContactDeadline: '2026-03-10' }),
    ] });
    expect(ids(r.justMet)).toEqual(['a', 'b', 'none', 'late']);
  });

  it('skips people only on the dream list, but not once they have a touchpoint', () => {
    const r = build({ people: [
      person('dream', { dreamList: true, nextTouchpointDate: '2026-03-01' }),
      person('started', { dreamList: true, nextTouchpointDate: '2026-03-01' }),
    ], tps: { started: [{ date: '2026-02-01', responded: 'no' }] } });
    expect(ids(r.overdue)).toEqual(['started']);
  });
});

describe('buildToday: reply checks', () => {
  it('lists touchpoints waiting two days or more for a reply, longest first', () => {
    const r = build({ people: [person('a'), person('b', { nextTouchpointDate: '2026-04-01' })], tps: {
      a: [
        { id: 't2', date: '2026-03-05', createdAt: '2026-03-05T15:00:00', responded: 'pending' },
        { id: 'fresh', date: '2026-03-10', createdAt: '2026-03-10T15:00:00', responded: 'pending' },
        { id: 'answered', date: '2026-03-01', createdAt: '2026-03-01T15:00:00', responded: 'yes' },
      ],
      b: [
        { id: 't1', date: '2026-03-01', createdAt: '2026-03-01T15:00:00', responded: 'pending' },
        { id: 't3', date: '2026-03-05', createdAt: '2026-03-05T09:00:00', responded: 'pending' },
      ],
    } });
    expect(ids(r.replyChecks)).toEqual(['t1', 't3', 't2']);
  });

  it('puts one without a createdAt first on the same date', () => {
    const r = build({ people: [person('a')], tps: { a: [
      { id: 'timed', date: '2026-03-05', createdAt: '2026-03-05T09:00:00', responded: 'pending' },
      { id: 'untimed', date: '2026-03-05', responded: 'pending' },
    ] } });
    expect(ids(r.replyChecks)).toEqual(['untimed', 'timed']);
    const r2 = build({ people: [person('a')], tps: { a: [
      { id: 'untimed', date: '2026-03-05', responded: 'pending' },
      { id: 'timed', date: '2026-03-05', createdAt: '2026-03-05T09:00:00', responded: 'pending' },
    ] } });
    expect(ids(r2.replyChecks)).toEqual(['untimed', 'timed']);
  });

  it('skips light touches and parked people', () => {
    const waiting = [{ id: 't', date: '2026-03-01', createdAt: '2026-03-01T09:00:00', responded: 'pending' }];
    const r = build({ people: [person('l', { lightTouch: true }), person('p', { warmth: 'parked' })], tps: { l: waiting, p: waiting } });
    expect(r.replyChecks).toEqual([]);
  });

  it('uses the real time when no now is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T12:00:00'));
    const tps = { a: [{ id: 't', date: '2026-03-09', createdAt: '2026-03-09T12:00:00', responded: 'pending' }] };
    const r = buildToday({ people: [person('a', { nextTouchpointDate: '2026-04-01' })], touchpointsByPerson: new Map(Object.entries(tps)), news: [] }, TODAY);
    expect(ids(r.replyChecks)).toEqual(['t']);
    vi.setSystemTime(new Date('2026-03-11T11:59:00'));
    const r2 = buildToday({ people: [person('a', { nextTouchpointDate: '2026-04-01' })], touchpointsByPerson: new Map(Object.entries(tps)), news: [] }, TODAY);
    expect(r2.replyChecks).toEqual([]);
  });
});

describe('buildToday: their news', () => {
  const later = { nextTouchpointDate: '2026-04-01' };

  it('lists news from the last week, newest first', () => {
    const r = build({ people: [person('a', later), person('b', later)], news: [
      { id: 'n6', personId: 'a', date: '2026-03-05' },
      { id: 'n0', personId: 'b', date: TODAY },
      { id: 'n7', personId: 'a', date: '2026-03-04' },
      { id: 'n3', personId: 'b', date: '2026-03-08' },
      { id: 'tomorrow', personId: 'a', date: '2026-03-12' },
    ] });
    expect(ids(r.news)).toEqual(['n0', 'n3', 'n6']);
  });

  it('drops news that was dismissed or followed by a touchpoint on or after its date', () => {
    const r = build({ people: [person('a', later), person('b', later), person('c', later), person('d', later)], tps: {
      b: [{ date: '2026-03-08', responded: 'no' }],
      c: [{ date: '2026-03-09', responded: 'no' }],
      d: [{ date: '2026-03-07', responded: 'no' }],
    }, news: [
      { id: 'dismissed', personId: 'a', date: '2026-03-08', dismissedAt: '2026-03-09T10:00:00' },
      { id: 'sameDay', personId: 'b', date: '2026-03-08' },
      { id: 'after', personId: 'c', date: '2026-03-08' },
      { id: 'before', personId: 'd', date: '2026-03-08' },
    ] });
    expect(ids(r.news)).toEqual(['before']);
  });

  it('skips news for people who are not in the list', () => {
    const r = build({ people: [person('a', later)], news: [
      { id: 'gone', personId: 'zz', date: TODAY },
      { id: 'goneYearly', personId: 'zz', date: '1990-03-11', repeatsYearly: true },
      { id: 'goneSoon', personId: 'zz', date: '1990-03-13', repeatsYearly: true },
    ] });
    expect(r.news).toEqual([]);
    expect(r.comingUp).toEqual([]);
  });

  it('shows a yearly date on its day with today\'s date, and in the week before under Coming up', () => {
    const r = build({ people: [person('a', later), person('b', later)], news: [
      { id: 'bday', personId: 'a', date: '1990-03-11', repeatsYearly: true },
      { id: 'soon2', personId: 'b', date: '1985-03-17', repeatsYearly: true },
      { id: 'soon1', personId: 'a', date: '1985-03-13', repeatsYearly: true },
      { id: 'far', personId: 'b', date: '1985-03-19', repeatsYearly: true },
    ] });
    expect(r.news).toEqual([{ id: 'bday', personId: 'a', date: TODAY, repeatsYearly: true }]);
    expect(r.comingUp).toEqual([
      { id: 'soon1', personId: 'a', date: '2026-03-13', repeatsYearly: true },
      { id: 'soon2', personId: 'b', date: '2026-03-17', repeatsYearly: true },
    ]);
  });

  it('settles a yearly date by a touchpoint on the day', () => {
    const r = build({ people: [person('a', later)], tps: { a: [{ date: TODAY, responded: 'no' }] }, news: [
      { id: 'bday', personId: 'a', date: '1990-03-11', repeatsYearly: true },
    ] });
    expect(r.news).toEqual([]);
  });

  it('puts yearly and one-off news together, newest first', () => {
    const r = build({ people: [person('a', later), person('b', later)], news: [
      { id: 'old', personId: 'b', date: '2026-03-09' },
      { id: 'bday', personId: 'a', date: '1990-03-11', repeatsYearly: true },
    ] });
    expect(ids(r.news)).toEqual(['bday', 'old']);
  });
});

describe('buildToday: news on a due card', () => {
  it('moves news for someone due onto their card, the newest one only', () => {
    const r = build({ people: [person('due'), person('late', { nextTouchpointDate: '2026-03-01' }), person('met', { firstContact: 'justMet' }), person('free', { nextTouchpointDate: '2026-04-01' })], news: [
      { id: 'dueOld', personId: 'due', date: '2026-03-08' },
      { id: 'dueNew', personId: 'due', date: TODAY },
      { id: 'lateN', personId: 'late', date: '2026-03-10' },
      { id: 'metN', personId: 'met', date: '2026-03-10' },
      { id: 'freeN', personId: 'free', date: '2026-03-10' },
    ] });
    expect(ids(r.news)).toEqual(['freeN']);
    expect([...r.dueNews.keys()].sort()).toEqual(['due', 'late', 'met']);
    expect(r.dueNews.get('due').id).toBe('dueNew');
    expect(r.dueNews.get('late').id).toBe('lateN');
    expect(r.dueNews.get('met').id).toBe('metN');
  });

  it('keeps news as its own card for parked and light-touch people', () => {
    const r = build({ people: [person('p', { warmth: 'parked' }), person('l', { lightTouch: true })], news: [
      { id: 'pN', personId: 'p', date: TODAY },
      { id: 'lN', personId: 'l', date: TODAY },
    ] });
    expect(ids(r.news).sort()).toEqual(['lN', 'pN']);
    expect(r.dueNews.size).toBe(0);
  });
});

describe('buildToday: open loops', () => {
  const later = { nextTouchpointDate: '2026-04-01' };
  const loop = (id, dueDate, extra = {}) => ({ id, personId: 'a', status: 'open', direction: 'iOwe', dueDate, ...extra });

  it('shows loops on or after their day, and the week ahead under Coming up', () => {
    const r = build({ people: [person('a', later)], loops: [
      loop('past', '2026-03-01'),
      loop('today', TODAY),
      loop('tomorrow', '2026-03-12'),
      loop('week', '2026-03-18'),
      loop('far', '2026-03-19'),
    ] });
    expect(ids(r.loops)).toEqual(['past', 'today']);
    expect(ids(r.loopsComing)).toEqual(['tomorrow', 'week']);
  });

  it('leaves out closed loops, undated ones and ones for people not listed', () => {
    const r = build({ people: [person('a', later)], loops: [
      loop('closed', TODAY, { status: 'closed' }),
      loop('closedSoon', '2026-03-12', { status: 'closed' }),
      loop('undated', undefined),
      loop('blank', ''),
      loop('stranger', TODAY, { personId: 'zz' }),
      loop('strangerSoon', '2026-03-12', { personId: 'zz' }),
      loop('kept', TODAY, { status: undefined }),
    ] });
    expect(ids(r.loops)).toEqual(['kept']);
    expect(r.loopsComing).toEqual([]);
  });

  it('sorts loops by date, your side first on the same day', () => {
    const r = build({ people: [person('a', later)], loops: [
      loop('theirs', TODAY, { direction: 'theyOwe' }),
      loop('mine', TODAY),
      loop('old', '2026-03-02', { direction: 'theyOwe' }),
    ] });
    expect(ids(r.loops)).toEqual(['old', 'mine', 'theirs']);
    const r2 = build({ people: [person('a', later)], loops: [
      loop('mine', TODAY),
      loop('theirs', TODAY, { direction: 'theyOwe' }),
    ] });
    expect(ids(r2.loops)).toEqual(['mine', 'theirs']);
  });

  it('sorts coming loops the same way', () => {
    const r = build({ people: [person('a', later)], loops: [
      loop('theirs', '2026-03-13', { direction: 'theyOwe' }),
      loop('later', '2026-03-16'),
      loop('mine', '2026-03-13'),
    ] });
    expect(ids(r.loopsComing)).toEqual(['mine', 'theirs', 'later']);
  });

  it('runs the week ahead across a month end', () => {
    const r = build({ people: [person('a', later)], loops: [loop('in', '2026-04-04'), loop('out', '2026-04-05')] }, '2026-03-28');
    expect(ids(r.loopsComing)).toEqual(['in']);
  });
});
