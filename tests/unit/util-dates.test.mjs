// Date helpers in js/util.js. Dates are local 'YYYY-MM-DD' strings; "today"
// is pinned with fake Date only, never the real clock.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toDateStr, todayStr, isDateStr, parseDate, addDays, addMonths, daysBetween, maxDate,
  weekStartStr, fmtDate, fmtTimestamp, relDay, nowISO,
} from '../../js/util.js';

const pinToday = (y, m, d, h = 12) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(y, m - 1, d, h, 0, 0));
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('toDateStr', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(toDateStr(new Date(2024, 10, 23))).toBe('2024-11-23');
  });
  it('pads single-digit months and days', () => {
    expect(toDateStr(new Date(2024, 0, 5))).toBe('2024-01-05');
    expect(toDateStr(new Date(2024, 8, 9))).toBe('2024-09-09');
  });
  it('uses the local day just before and after midnight', () => {
    expect(toDateStr(new Date(2024, 11, 31, 23, 59, 59))).toBe('2024-12-31');
    expect(toDateStr(new Date(2025, 0, 1, 0, 0, 0))).toBe('2025-01-01');
  });
  it('handles the last day of December and leap days', () => {
    expect(toDateStr(new Date(1999, 11, 31))).toBe('1999-12-31');
    expect(toDateStr(new Date(2024, 1, 29))).toBe('2024-02-29');
  });
  it('gives NaN parts for an invalid date', () => {
    expect(toDateStr(new Date('nonsense'))).toBe('NaN-NaN-NaN');
  });
});

describe('nowISO', () => {
  it('is the current time as an ISO string', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-03-05T10:20:30.000Z'));
    expect(nowISO()).toBe('2024-03-05T10:20:30.000Z');
  });
  it('moves with the clock', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-12-31T23:59:59.999Z'));
    const a = nowISO();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    expect(a).toBe('2024-12-31T23:59:59.999Z');
    expect(nowISO()).toBe('2025-01-01T00:00:00.000Z');
  });
  it('always returns a full ISO timestamp', () => {
    expect(nowISO()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('todayStr', () => {
  it('is the local date of the clock', () => {
    pinToday(2024, 3, 5);
    expect(todayStr()).toBe('2024-03-05');
  });
  it('changes at local midnight, not UTC midnight', () => {
    pinToday(2024, 12, 31, 23);
    expect(todayStr()).toBe('2024-12-31');
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 1));
    expect(todayStr()).toBe('2025-01-01');
  });
  it('handles a leap day', () => {
    pinToday(2024, 2, 29);
    expect(todayStr()).toBe('2024-02-29');
  });
});

describe('isDateStr', () => {
  it('accepts YYYY-MM-DD strings', () => {
    expect(isDateStr('2024-01-05')).toBe(true);
    expect(isDateStr('1999-12-31')).toBe(true);
  });
  it('rejects other shapes of date text', () => {
    for (const s of ['2024-1-05', '2024-01-5', '24-01-05', '2024/01/05', '2024-01-05T00:00', 'x2024-01-05', '2024-01-05x', '', 'today']) {
      expect(isDateStr(s), s).toBe(false);
    }
  });
  it('rejects non-strings', () => {
    for (const v of [null, undefined, 20240105, new Date(2024, 0, 5), ['2024-01-05'], { s: '2024-01-05' }]) {
      expect(isDateStr(v)).toBe(false);
    }
  });
});

describe('parseDate', () => {
  it('makes a local midnight Date', () => {
    const d = parseDate('2024-03-05');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(5);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
  it('round-trips with toDateStr across year ends and leap days', () => {
    for (const s of ['2024-12-31', '2025-01-01', '2024-02-29', '2023-03-01']) expect(toDateStr(parseDate(s))).toBe(s);
  });
  it('rolls an impossible day over into the next month', () => {
    expect(toDateStr(parseDate('2023-02-29'))).toBe('2023-03-01');
  });
  it('gives an invalid Date for text that is not a date', () => {
    expect(Number.isNaN(parseDate('soon').getTime())).toBe(true);
  });
  it('throws for a non-string', () => {
    expect(() => parseDate(null)).toThrow(TypeError);
  });
});

describe('addDays', () => {
  it('adds days within a month', () => {
    expect(addDays('2024-03-05', 3)).toBe('2024-03-08');
  });
  it('crosses month and year ends', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
  });
  it('subtracts with a negative count', () => {
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
  it('returns the same day for zero', () => {
    expect(addDays('2024-06-15', 0)).toBe('2024-06-15');
  });
  it('adds a whole year of days, through daylight saving changes', () => {
    expect(addDays('2024-01-01', 366)).toBe('2025-01-01');
    expect(addDays('2024-03-09', 2)).toBe('2024-03-11');
    expect(addDays('2024-11-02', 2)).toBe('2024-11-04');
  });
});

describe('addMonths', () => {
  it('adds months keeping the day', () => {
    expect(addMonths('2024-01-15', 1)).toBe('2024-02-15');
    expect(addMonths('2024-01-15', 3)).toBe('2024-04-15');
  });
  it('clamps to the last day of a shorter month', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonths('2024-03-31', 1)).toBe('2024-04-30');
    expect(addMonths('2024-05-31', -1)).toBe('2024-04-30');
  });
  it('keeps a 31st when the new month has 31 days', () => {
    expect(addMonths('2024-01-31', 2)).toBe('2024-03-31');
    expect(addMonths('2024-07-31', 1)).toBe('2024-08-31');
  });
  it('crosses year ends both ways', () => {
    expect(addMonths('2024-12-15', 1)).toBe('2025-01-15');
    expect(addMonths('2025-01-31', -2)).toBe('2024-11-30');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2024-11-30', 3)).toBe('2025-02-28');
  });
  it('returns the same day for zero', () => {
    expect(addMonths('2024-02-29', 0)).toBe('2024-02-29');
  });
});

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween('2024-03-05', '2024-03-08')).toBe(3);
  });
  it('is negative going backward and zero for the same day', () => {
    expect(daysBetween('2024-03-08', '2024-03-05')).toBe(-3);
    expect(daysBetween('2024-03-08', '2024-03-08')).toBe(0);
  });
  it('crosses month and year ends', () => {
    expect(daysBetween('2024-12-31', '2025-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });
  it('counts a daylight-saving day as one day', () => {
    // US clocks went forward on 2024-03-10 and back on 2024-11-03.
    expect(daysBetween('2024-03-09', '2024-03-11')).toBe(2);
    expect(daysBetween('2024-11-02', '2024-11-04')).toBe(2);
    expect(daysBetween('2024-03-01', '2024-04-01')).toBe(31);
    expect(daysBetween('2024-11-01', '2024-12-01')).toBe(30);
  });
  it('is NaN for text that is not a date', () => {
    expect(daysBetween('soon', '2024-01-01')).toBeNaN();
  });
});

describe('maxDate', () => {
  it('returns the latest date', () => {
    expect(maxDate('2024-05-01', '2024-01-01', '2024-03-01')).toBe('2024-05-01');
    expect(maxDate('2024-01-01', '2025-01-01')).toBe('2025-01-01');
  });
  it('skips empty values', () => {
    expect(maxDate('2024-01-01', undefined)).toBe('2024-01-01');
    expect(maxDate(null, '2024-01-01', '', undefined)).toBe('2024-01-01');
  });
  it('returns the only date given', () => {
    expect(maxDate('2024-01-01')).toBe('2024-01-01');
  });
  it('returns null when there are no dates', () => {
    expect(maxDate()).toBeNull();
    expect(maxDate(null, undefined, '')).toBeNull();
  });
  it('compares across a year end', () => {
    expect(maxDate('2024-12-31', '2025-01-01', '2024-12-30')).toBe('2025-01-01');
  });
});

describe('weekStartStr', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartStr('2024-03-07')).toBe('2024-03-04'); // Thursday
  });
  it('keeps a Monday as is', () => {
    expect(weekStartStr('2024-03-04')).toBe('2024-03-04');
  });
  it('puts a Sunday in the week that started the Monday before', () => {
    expect(weekStartStr('2024-03-10')).toBe('2024-03-04');
    expect(weekStartStr('2024-03-09')).toBe('2024-03-04'); // Saturday
    expect(weekStartStr('2024-03-05')).toBe('2024-03-04'); // Tuesday
  });
  it('crosses month and year ends', () => {
    expect(weekStartStr('2025-01-01')).toBe('2024-12-30');
    expect(weekStartStr('2024-03-01')).toBe('2024-02-26');
    expect(weekStartStr('2023-01-01')).toBe('2022-12-26'); // a Sunday
  });
  it('gives NaN parts for text that is not a date', () => {
    expect(weekStartStr('soon')).toBe('NaN-NaN-NaN');
  });
});

describe('fmtDate', () => {
  beforeEach(() => pinToday(2024, 6, 15));

  it('shows weekday, month and day for this year by default', () => {
    expect(fmtDate('2024-03-05')).toBe('Tue, Mar 5');
  });
  it('adds the year for another year by default', () => {
    expect(fmtDate('2023-03-05')).toBe('Sun, Mar 5, 2023');
    expect(fmtDate('2025-01-01')).toBe('Wed, Jan 1, 2025');
  });
  it('leaves out the weekday when asked', () => {
    expect(fmtDate('2024-03-05', { weekday: false })).toBe('Mar 5');
  });
  it('always shows the year with year: true', () => {
    expect(fmtDate('2024-03-05', { year: true })).toBe('Tue, Mar 5, 2024');
  });
  it('never shows the year with year: false', () => {
    expect(fmtDate('2023-03-05', { year: false })).toBe('Sun, Mar 5');
    expect(fmtDate('2023-03-05', { weekday: false, year: false })).toBe('Mar 5');
  });
  it('compares against the year of today', () => {
    vi.setSystemTime(new Date(2025, 0, 1, 9));
    expect(fmtDate('2024-12-31')).toBe('Tue, Dec 31, 2024');
    expect(fmtDate('2025-01-02')).toBe('Thu, Jan 2');
  });
  it('passes the expected options to the formatter', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    fmtDate('2023-03-05', { weekday: true, year: 'auto' });
    expect(spy).toHaveBeenLastCalledWith(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    fmtDate('2024-03-05', { weekday: false });
    expect(spy).toHaveBeenLastCalledWith(undefined, { weekday: undefined, month: 'short', day: 'numeric', year: undefined });
  });
  it('returns an empty string for no date', () => {
    expect(fmtDate('')).toBe('');
    expect(fmtDate(null)).toBe('');
    expect(fmtDate(undefined)).toBe('');
  });
});

describe('fmtTimestamp', () => {
  beforeEach(() => pinToday(2024, 6, 15));

  it('shows month, day and year without a weekday', () => {
    expect(fmtTimestamp('2024-03-05T15:30:00')).toBe('Mar 5, 2024');
  });
  it('uses the local day of the timestamp', () => {
    // Late on Dec 31 here can already be Jan 1 in UTC: the local day counts.
    const iso = new Date(2024, 11, 31, 22, 30).toISOString();
    expect(fmtTimestamp(iso)).toBe('Dec 31, 2024');
  });
  it('shows the year for another year too', () => {
    expect(fmtTimestamp('2019-07-04T09:00:00')).toBe('Jul 4, 2019');
  });
  it('returns an empty string for no timestamp', () => {
    expect(fmtTimestamp('')).toBe('');
    expect(fmtTimestamp(null)).toBe('');
    expect(fmtTimestamp(undefined)).toBe('');
  });
});

describe('relDay', () => {
  it('names today, tomorrow and yesterday', () => {
    expect(relDay('2024-03-05', '2024-03-05')).toBe('today');
    expect(relDay('2024-03-06', '2024-03-05')).toBe('tomorrow');
    expect(relDay('2024-03-04', '2024-03-05')).toBe('yesterday');
  });
  it('counts days ahead and behind', () => {
    expect(relDay('2024-03-10', '2024-03-05')).toBe('in 5 days');
    expect(relDay('2024-03-02', '2024-03-05')).toBe('3 days ago');
    expect(relDay('2024-03-07', '2024-03-05')).toBe('in 2 days');
    expect(relDay('2024-03-03', '2024-03-05')).toBe('2 days ago');
  });
  it('crosses month and year ends', () => {
    expect(relDay('2025-01-01', '2024-12-31')).toBe('tomorrow');
    expect(relDay('2024-12-31', '2025-01-01')).toBe('yesterday');
    expect(relDay('2025-01-10', '2024-12-31')).toBe('in 10 days');
  });
  it('uses today when no day is given', () => {
    pinToday(2024, 3, 5);
    expect(relDay('2024-03-05')).toBe('today');
    expect(relDay('2024-03-15')).toBe('in 10 days');
  });
  it('reads text that is not a date as NaN days ago', () => {
    expect(relDay('soon', '2024-03-05')).toBe('NaN days ago');
  });
});
