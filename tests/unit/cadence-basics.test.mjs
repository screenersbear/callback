// Unit tests for js/cadence.js, part 1: the fixed lists, settings defaults,
// touchpoint sorting, the cold sequence, rhythm words and reply days.
// Timestamps without a "Z" are local time, so the day they fall on is the
// same in every time zone the tests run in.
import { describe, it, expect } from 'vitest';
import {
  WARMTH, WARMTH_INFO, COLD_STEPS, DEFAULT_SETTINGS, withDefaults, sortTouchpoints, lastTouchpoint,
  coldTouchpoints, coldState, RHYTHM_PRESETS, every, checkInDate, replyDay, lastContactDay,
} from '../../js/cadence.js';

const ids = (list) => list.map((t) => t.id);

describe('fixed lists', () => {
  it('WARMTH lists the stored warmth keys in order', () => {
    expect(WARMTH).toEqual(['cold', 'warm', 'active', 'client', 'parked']);
  });

  it('WARMTH_INFO has a label and blurb for every warmth', () => {
    expect(WARMTH_INFO).toEqual({
      cold: { label: 'Cold', blurb: "You haven't really connected yet." },
      warm: { label: 'Warm', blurb: 'You know each other.' },
      active: { label: 'Active', blurb: "You're talking about something right now." },
      client: { label: 'On a project', phrase: 'on a project', blurb: 'Currently working on a project together.' },
      parked: { label: 'Parked', blurb: 'Resting for now. Callback brings them back later.' },
    });
    for (const w of WARMTH) expect(WARMTH_INFO[w].label).toBeTruthy();
  });

  it('the cold sequence has three notes', () => {
    expect(COLD_STEPS).toBe(3);
  });

  it('DEFAULT_SETTINGS holds the default rhythms and goals', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      id: 'settings',
      cadence: { coldFollowUp: 7, coldLastTry: 21, coldWait: 7, warm: 42, active: 7, client: 90, parked: 180, lightTouch: 90 },
      goals: { touchpoints: 10, newPeople: 3 },
    });
  });

  it('RHYTHM_PRESETS are the picker presets, shortest first', () => {
    expect(RHYTHM_PRESETS).toEqual([
      { days: 14, label: 'Every 2 weeks' },
      { days: 30, label: 'Every month' },
      { days: 42, label: 'Every 6 weeks' },
      { days: 60, label: 'Every 2 months' },
      { days: 90, label: 'Every 3 months' },
      { days: 180, label: 'Every 6 months' },
    ]);
  });
});

describe('withDefaults', () => {
  it('returns the defaults for no settings', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults({})).toEqual(DEFAULT_SETTINGS);
  });

  it('returns copies, never the shared defaults object', () => {
    const s = withDefaults();
    expect(s).not.toBe(DEFAULT_SETTINGS);
    expect(s.cadence).not.toBe(DEFAULT_SETTINGS.cadence);
    expect(s.goals).not.toBe(DEFAULT_SETTINGS.goals);
    s.cadence.warm = 1;
    expect(DEFAULT_SETTINGS.cadence.warm).toBe(42);
  });

  it('fills in only the cadence values that are missing', () => {
    const s = withDefaults({ cadence: { warm: 30, coldWait: 3 } });
    expect(s.cadence).toEqual({ coldFollowUp: 7, coldLastTry: 21, coldWait: 3, warm: 30, active: 7, client: 90, parked: 180, lightTouch: 90 });
    expect(s.goals).toEqual({ touchpoints: 10, newPeople: 3 });
  });

  it('fills in only the goals that are missing', () => {
    const s = withDefaults({ goals: { newPeople: 5 } });
    expect(s.goals).toEqual({ touchpoints: 10, newPeople: 5 });
    expect(s.cadence).toEqual(DEFAULT_SETTINGS.cadence);
  });

  it('keeps other top-level settings and lets them override the defaults', () => {
    const s = withDefaults({ id: 'other', theme: 'dark', cadence: { active: 3 } });
    expect(s).toEqual({
      id: 'other',
      theme: 'dark',
      cadence: { ...DEFAULT_SETTINGS.cadence, active: 3 },
      goals: { touchpoints: 10, newPeople: 3 },
    });
  });

  it('treats null cadence and goals as missing', () => {
    expect(withDefaults({ cadence: null, goals: null })).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores settings that are not an object', () => {
    expect(withDefaults(5)).toEqual(DEFAULT_SETTINGS);
    expect(withDefaults(false)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('sortTouchpoints', () => {
  it('puts the newest date first, across a year end', () => {
    const tps = [
      { id: 'a', date: '2026-01-05' },
      { id: 'b', date: '2026-03-01' },
      { id: 'c', date: '2025-12-31' },
    ];
    expect(ids(sortTouchpoints(tps))).toEqual(['b', 'a', 'c']);
  });

  it('on the same date puts the one logged last first, whatever the input order', () => {
    const early = { id: 'early', date: '2026-03-01', createdAt: '2026-03-01T09:00:00.000Z' };
    const late = { id: 'late', date: '2026-03-01', createdAt: '2026-03-01T18:00:00.000Z' };
    expect(ids(sortTouchpoints([early, late]))).toEqual(['late', 'early']);
    expect(ids(sortTouchpoints([late, early]))).toEqual(['late', 'early']);
  });

  it('on the same date puts one without a createdAt after one with it', () => {
    const withTime = { id: 'with', date: '2026-03-01', createdAt: '2026-03-01T09:00:00.000Z' };
    const without = { id: 'without', date: '2026-03-01' };
    expect(ids(sortTouchpoints([without, withTime]))).toEqual(['with', 'without']);
    expect(ids(sortTouchpoints([withTime, without]))).toEqual(['with', 'without']);
  });

  it('returns a new array and leaves the input order alone', () => {
    const tps = [{ id: 'a', date: '2026-01-01' }, { id: 'b', date: '2026-02-01' }];
    const out = sortTouchpoints(tps);
    expect(out).not.toBe(tps);
    expect(ids(tps)).toEqual(['a', 'b']);
    expect(ids(out)).toEqual(['b', 'a']);
  });

  it('handles empty and single lists', () => {
    expect(sortTouchpoints([])).toEqual([]);
    const one = [{ id: 'x', date: '2026-01-01' }];
    expect(sortTouchpoints(one)).toEqual(one);
  });

  it('falls back to createdAt when none of them has a date (bad input)', () => {
    const tps = [{ id: 'a', createdAt: '2026-01-01T09:00:00.000Z' }, { id: 'b', createdAt: '2026-01-02T09:00:00.000Z' }];
    expect(ids(sortTouchpoints(tps))).toEqual(['b', 'a']);
  });
});

describe('lastTouchpoint', () => {
  it('is null with no touchpoints', () => {
    expect(lastTouchpoint([])).toBeNull();
  });

  it('is the only touchpoint when there is one', () => {
    const t = { id: 'a', date: '2026-01-01' };
    expect(lastTouchpoint([t])).toBe(t);
  });

  it('is the newest, the latest logged on a tie', () => {
    const tps = [
      { id: 'old', date: '2025-12-30' },
      { id: 'tieEarly', date: '2026-01-02', createdAt: '2026-01-02T08:00:00.000Z' },
      { id: 'tieLate', date: '2026-01-02', createdAt: '2026-01-02T20:00:00.000Z' },
    ];
    expect(lastTouchpoint(tps).id).toBe('tieLate');
  });
});

describe('coldTouchpoints', () => {
  const since = '2026-03-10T12:00:00';
  const person = { warmth: 'cold', coldSince: since };

  it('counts every touchpoint when the person has no coldSince', () => {
    const tps = [{ id: 'a', date: '2020-01-01' }];
    expect(coldTouchpoints({ warmth: 'cold' }, tps)).toBe(tps);
    expect(coldTouchpoints({ warmth: 'cold', coldSince: '' }, tps)).toBe(tps);
  });

  it('counts touchpoints logged since then, even with an earlier date', () => {
    const t = { id: 'a', date: '2026-03-01', createdAt: '2026-03-10T13:00:00' };
    expect(ids(coldTouchpoints(person, [t]))).toEqual(['a']);
  });

  it('counts one logged at exactly the coldSince moment', () => {
    const t = { id: 'a', date: '2026-03-01', createdAt: since };
    expect(ids(coldTouchpoints(person, [t]))).toEqual(['a']);
  });

  it('counts touchpoints dated after the coldSince day, even if logged before', () => {
    const t = { id: 'a', date: '2026-03-11', createdAt: '2026-03-09T10:00:00' };
    expect(ids(coldTouchpoints(person, [t]))).toEqual(['a']);
  });

  it('leaves out ones logged earlier and dated on or before the coldSince day', () => {
    const onDay = { id: 'onDay', date: '2026-03-10', createdAt: '2026-03-10T11:59:59' };
    const before = { id: 'before', date: '2026-02-01', createdAt: '2026-02-01T10:00:00' };
    expect(coldTouchpoints(person, [onDay, before])).toEqual([]);
  });

  it('judges touchpoints without a createdAt by their date alone', () => {
    const old = { id: 'old', date: '2026-03-10' };
    const newer = { id: 'newer', date: '2026-03-12' };
    expect(ids(coldTouchpoints(person, [old, newer]))).toEqual(['newer']);
  });

  it('handles an empty list', () => {
    expect(coldTouchpoints(person, [])).toEqual([]);
  });
});

describe('coldState', () => {
  const person = { warmth: 'cold', coldSince: '2026-03-10T12:00:00' };
  const tp = (id, date, responded = 'pending') => ({ id, date, createdAt: `${date}T13:00:00`, responded });

  it('is empty before the first note', () => {
    expect(coldState(person, [])).toEqual({ sent: 0, replied: false, done: false });
  });

  it('is not done after two notes', () => {
    const tps = [tp('a', '2026-03-10'), tp('b', '2026-03-17', 'no')];
    expect(coldState(person, tps)).toEqual({ sent: 2, replied: false, done: false });
  });

  it('is done after the third note, and stays done after more', () => {
    const three = [tp('a', '2026-03-10'), tp('b', '2026-03-17'), tp('c', '2026-04-07')];
    expect(coldState(person, three)).toEqual({ sent: 3, replied: false, done: true });
    expect(coldState(person, [...three, tp('d', '2026-04-14')])).toEqual({ sent: 4, replied: false, done: true });
  });

  it('notices a reply anywhere in the sequence', () => {
    const tps = [tp('a', '2026-03-10', 'no'), tp('b', '2026-03-17', 'yes'), tp('c', '2026-04-07', 'pending')];
    expect(coldState(person, tps)).toEqual({ sent: 3, replied: true, done: true });
  });

  it('ignores replies and notes from before the person went cold', () => {
    const before = { id: 'x', date: '2026-01-05', createdAt: '2026-01-05T10:00:00', responded: 'yes' };
    expect(coldState(person, [before])).toEqual({ sent: 0, replied: false, done: false });
  });
});

describe('every', () => {
  it('uses the preset words for preset rhythms', () => {
    expect(every(14)).toBe('Every 2 weeks');
    expect(every(30)).toBe('Every month');
    expect(every(42)).toBe('Every 6 weeks');
    expect(every(60)).toBe('Every 2 months');
    expect(every(90)).toBe('Every 3 months');
    expect(every(180)).toBe('Every 6 months');
  });

  it('says "Every week" for seven days', () => {
    expect(every(7)).toBe('Every week');
  });

  it('spells out other spans', () => {
    expect(every(10)).toBe('Every 10 days');
    expect(every(21)).toBe('Every 3 weeks');
    expect(every(120)).toBe('Every 4 months');
    expect(every(1)).toBe('Every 1 day');
  });

  it('accepts numbers as strings and rounds fractions', () => {
    expect(every('42')).toBe('Every 6 weeks');
    expect(every(41.6)).toBe('Every 6 weeks');
    expect(every(6.6)).toBe('Every week');
    expect(every('9.4')).toBe('Every 9 days');
  });

  it('says zero days for zero or bad input', () => {
    expect(every(0)).toBe('Every 0 days');
    expect(every('abc')).toBe('Every 0 days');
    expect(every(undefined)).toBe('Every 0 days');
  });
});

describe('checkInDate', () => {
  const withCheck = (date) => ({ postProjectCheckIn: { date } });

  it('returns the check-in date when there is a valid one', () => {
    expect(checkInDate(withCheck('2026-04-01'))).toBe('2026-04-01');
    expect(checkInDate(withCheck('2027-01-01'))).toBe('2027-01-01');
  });

  it('is null with no person or no check-in', () => {
    expect(checkInDate(undefined)).toBeNull();
    expect(checkInDate(null)).toBeNull();
    expect(checkInDate({})).toBeNull();
    expect(checkInDate({ postProjectCheckIn: null })).toBeNull();
    expect(checkInDate({ postProjectCheckIn: {} })).toBeNull();
  });

  it('is null when the date is not a plain YYYY-MM-DD', () => {
    for (const bad of ['x2026-04-01', '2026-04-01x', '226-04-01', '20266-04-01', '2026-4-01', '2026-004-01',
      '2026-04-1', '2026-04-001', '2026/04/01', 'abcd-ef-gh', '', '2026-04-01T00:00:00']) {
      expect(checkInDate(withCheck(bad)), bad).toBeNull();
    }
  });
});

describe('replyDay', () => {
  it('is the local day of the reply', () => {
    expect(replyDay({ responded: 'yes', respondedAt: '2026-03-10T15:00:00' })).toBe('2026-03-10');
  });

  it('keeps a late-night reply on its own day across a year end', () => {
    expect(replyDay({ responded: 'yes', respondedAt: '2026-12-31T23:30:00' })).toBe('2026-12-31');
    expect(replyDay({ responded: 'yes', respondedAt: '2027-01-01T00:10:00' })).toBe('2027-01-01');
  });

  it('is null without a reply', () => {
    expect(replyDay({ responded: 'no', respondedAt: '2026-03-10T15:00:00' })).toBeNull();
    expect(replyDay({ responded: 'pending', respondedAt: '2026-03-10T15:00:00' })).toBeNull();
    expect(replyDay({ responded: 'yes' })).toBeNull();
    expect(replyDay({ responded: 'yes', respondedAt: '' })).toBeNull();
  });

  it('is null for a missing touchpoint', () => {
    expect(replyDay(null)).toBeNull();
    expect(replyDay(undefined)).toBeNull();
  });
});

describe('lastContactDay', () => {
  it('is null with no touchpoints', () => {
    expect(lastContactDay([])).toBeNull();
  });

  it('is the newest touchpoint date when nobody replied', () => {
    expect(lastContactDay([{ date: '2026-01-02' }, { date: '2026-02-03', responded: 'no' }])).toBe('2026-02-03');
  });

  it('moves to a reply that came in later, across a month end', () => {
    const tps = [{ date: '2026-01-28', responded: 'yes', respondedAt: '2026-02-02T10:00:00' }];
    expect(lastContactDay(tps)).toBe('2026-02-02');
  });

  it('counts a late reply to an older touchpoint', () => {
    const tps = [
      { date: '2026-03-01', responded: 'pending' },
      { date: '2026-02-01', responded: 'yes', respondedAt: '2026-03-05T09:00:00' },
    ];
    expect(lastContactDay(tps)).toBe('2026-03-05');
  });

  it('keeps the touchpoint date when the reply day is earlier', () => {
    const tps = [{ date: '2026-03-01', responded: 'yes', respondedAt: '2026-02-27T09:00:00' }];
    expect(lastContactDay(tps)).toBe('2026-03-01');
  });

  it('uses the last touchpoint it is given', () => {
    const tps = [{ date: '2026-01-01', responded: 'yes', respondedAt: '2026-01-03T09:00:00' }];
    expect(lastContactDay(tps, { date: '2026-05-01' })).toBe('2026-05-01');
    expect(lastContactDay(tps, { date: '2025-12-01' })).toBe('2026-01-03');
    expect(lastContactDay(tps, null)).toBeNull();
  });
});
