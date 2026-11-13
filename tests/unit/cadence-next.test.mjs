// Unit tests for js/cadence.js, part 2: the next-touchpoint rules, warmth
// changes, rhythm labels, park and warm prompts, and snoozing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  computeNextDate, warmthChangeFields, cadenceLabel, rhythmWords, needsParkPrompt, needsWarmPrompt,
  SNOOZE_OPTIONS, snoozeDate,
} from '../../js/cadence.js';

const TODAY = '2026-03-10';
// Distinct cold gaps, so each step of the sequence shows which one it used.
const COLD = { cadence: { coldFollowUp: 5, coldLastTry: 11, coldWait: 3 } };
const tp = (date, extra = {}) => ({ date, responded: 'pending', ...extra });
// A cold touchpoint logged on its own day (counts toward the cold sequence).
const coldTp = (date) => tp(date, { createdAt: `${date}T13:00:00` });
const coldPerson = (extra = {}) => ({ warmth: 'cold', coldSince: '2026-01-01T12:00:00', ...extra });

afterEach(() => {
  vi.useRealTimers();
});

describe('computeNextDate: parked', () => {
  it('rests the full parked span from today when there is nothing else', () => {
    expect(computeNextDate({ warmth: 'parked' }, [], undefined, TODAY)).toBe('2026-09-06');
  });

  it('counts from the day they were parked when that is later than the last touchpoint', () => {
    const p = { warmth: 'parked', parkedOn: '2026-04-01' };
    expect(computeNextDate(p, [tp('2026-02-20')], undefined, TODAY)).toBe('2026-09-28');
  });

  it('counts from the last touchpoint when that is later than the park day', () => {
    const p = { warmth: 'parked', parkedOn: '2026-01-15' };
    expect(computeNextDate(p, [tp('2026-02-20')], undefined, TODAY)).toBe('2026-08-19');
  });

  it('uses today as the park day when none is stored', () => {
    expect(computeNextDate({ warmth: 'parked' }, [tp('2026-02-20')], undefined, TODAY)).toBe('2026-09-06');
    expect(computeNextDate({ warmth: 'parked' }, [tp('2026-04-01')], undefined, TODAY)).toBe('2026-09-28');
  });

  it('uses the parked span from the settings', () => {
    expect(computeNextDate({ warmth: 'parked' }, [], { cadence: { parked: 10 } }, TODAY)).toBe('2026-03-20');
  });

  it('comes before a check-in, a custom rhythm and light touch', () => {
    const p = { warmth: 'parked', parkedOn: TODAY, postProjectCheckIn: { date: '2026-04-01' }, cadenceOverrideDays: 5, lightTouch: true };
    expect(computeNextDate(p, [tp('2026-03-01')], undefined, TODAY)).toBe('2026-09-06');
  });
});

describe('computeNextDate: check-in after a project', () => {
  it('waits for the check-in date instead of the rhythm', () => {
    const p = { warmth: 'client', postProjectCheckIn: { date: '2026-05-01' }, cadenceOverrideDays: 5 };
    expect(computeNextDate(p, [tp('2026-03-01')], undefined, TODAY)).toBe('2026-05-01');
    expect(computeNextDate({ ...p, lightTouch: true }, [], undefined, TODAY)).toBe('2026-05-01');
  });

  it('ignores a check-in with a bad date', () => {
    const p = { warmth: 'warm', postProjectCheckIn: { date: 'soon' } };
    expect(computeNextDate(p, [tp('2026-03-01')], undefined, TODAY)).toBe('2026-04-12');
  });
});

describe('computeNextDate: no touchpoints yet', () => {
  it('keeps the planned next date', () => {
    expect(computeNextDate({ warmth: 'warm', nextTouchpointDate: '2026-04-02' }, [], undefined, TODAY)).toBe('2026-04-02');
  });

  it('is today without a planned date', () => {
    expect(computeNextDate({ warmth: 'warm' }, [], undefined, TODAY)).toBe(TODAY);
    expect(computeNextDate({ warmth: 'cold', lightTouch: true, cadenceOverrideDays: 9 }, [], undefined, TODAY)).toBe(TODAY);
  });

  it('uses the real date when no today is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
    expect(computeNextDate({ warmth: 'warm' }, [], undefined)).toBe('2026-06-15');
  });
});

describe('computeNextDate: custom rhythm', () => {
  it('counts the custom days from the last touchpoint', () => {
    expect(computeNextDate({ warmth: 'warm', cadenceOverrideDays: 10 }, [tp('2026-03-10')], undefined, TODAY)).toBe('2026-03-20');
  });

  it('counts from a reply that came in after the touchpoint', () => {
    const tps = [tp('2026-03-01', { responded: 'yes', respondedAt: '2026-03-04T10:00:00' })];
    expect(computeNextDate({ warmth: 'warm', cadenceOverrideDays: 10 }, tps, undefined, TODAY)).toBe('2026-03-14');
  });

  it('accepts the days as a string and rounds them', () => {
    expect(computeNextDate({ warmth: 'warm', cadenceOverrideDays: '10' }, [tp('2026-03-10')], undefined, TODAY)).toBe('2026-03-20');
    expect(computeNextDate({ warmth: 'warm', cadenceOverrideDays: 9.6 }, [tp('2026-03-10')], undefined, TODAY)).toBe('2026-03-20');
  });

  it('beats light touch and warmth', () => {
    const p = { warmth: 'cold', lightTouch: true, cadenceOverrideDays: 10, coldSince: '2026-01-01T00:00:00' };
    expect(computeNextDate(p, [coldTp('2026-03-10')], COLD, TODAY)).toBe('2026-03-20');
  });

  it('ignores zero, negative or bad custom days', () => {
    for (const bad of [0, -5, 'abc', null, 0.3]) {
      expect(computeNextDate({ warmth: 'active', cadenceOverrideDays: bad }, [tp('2026-03-08')], undefined, TODAY), String(bad)).toBe('2026-03-15');
    }
  });
});

describe('computeNextDate: light touch', () => {
  it('uses the light touch rhythm whatever the warmth', () => {
    expect(computeNextDate({ warmth: 'active', lightTouch: true }, [tp('2026-02-01')], undefined, TODAY)).toBe('2026-05-02');
  });

  it('uses the light touch rhythm from the settings', () => {
    expect(computeNextDate({ warmth: 'warm', lightTouch: true }, [tp('2026-03-10')], { cadence: { lightTouch: 10 } }, TODAY)).toBe('2026-03-20');
  });

  it('beats the cold sequence', () => {
    expect(computeNextDate(coldPerson({ lightTouch: true }), [coldTp('2026-02-01')], COLD, TODAY)).toBe('2026-05-02');
  });
});

describe('computeNextDate: cold sequence', () => {
  it('waits for the planned date before the first note', () => {
    expect(computeNextDate(coldPerson({ nextTouchpointDate: '2026-03-12' }), [], COLD, TODAY)).toBe('2026-03-12');
  });

  it('treats notes from before they went cold as no notes', () => {
    const p = coldPerson({ coldSince: '2026-03-01T12:00:00' });
    const old = tp('2026-02-01', { createdAt: '2026-02-01T10:00:00' });
    expect(computeNextDate(p, [old], COLD, TODAY)).toBe(TODAY);
    expect(computeNextDate({ ...p, nextTouchpointDate: '2026-03-15' }, [old], COLD, TODAY)).toBe('2026-03-15');
  });

  it('follows up after the first note, tries last after the second, waits after the third', () => {
    const p = coldPerson();
    expect(computeNextDate(p, [coldTp('2026-03-01')], COLD, TODAY)).toBe('2026-03-06');
    expect(computeNextDate(p, [coldTp('2026-03-01'), coldTp('2026-03-06')], COLD, TODAY)).toBe('2026-03-17');
    expect(computeNextDate(p, [coldTp('2026-03-01'), coldTp('2026-03-06'), coldTp('2026-03-17')], COLD, TODAY)).toBe('2026-03-20');
    expect(computeNextDate(p, [coldTp('2026-03-01'), coldTp('2026-03-06'), coldTp('2026-03-17'), coldTp('2026-03-20')], COLD, TODAY)).toBe('2026-03-23');
  });

  it('uses the default gaps: a week, three weeks, a week', () => {
    const p = coldPerson();
    expect(computeNextDate(p, [coldTp('2026-03-01')], undefined, TODAY)).toBe('2026-03-08');
    expect(computeNextDate(p, [coldTp('2026-02-01'), coldTp('2026-02-08')], undefined, TODAY)).toBe('2026-03-01');
    expect(computeNextDate(p, [coldTp('2026-02-01'), coldTp('2026-02-08'), coldTp('2026-03-01')], undefined, TODAY)).toBe('2026-03-08');
  });
});

describe('computeNextDate: warmth defaults', () => {
  it('uses the rhythm of each warmth', () => {
    expect(computeNextDate({ warmth: 'warm' }, [tp('2026-03-01')], undefined, TODAY)).toBe('2026-04-12');
    expect(computeNextDate({ warmth: 'active' }, [tp('2026-03-08')], undefined, TODAY)).toBe('2026-03-15');
    expect(computeNextDate({ warmth: 'client' }, [tp('2026-02-01')], undefined, TODAY)).toBe('2026-05-02');
  });

  it('crosses a year end and the daylight-saving changes', () => {
    expect(computeNextDate({ warmth: 'warm' }, [tp('2026-12-20')], undefined, TODAY)).toBe('2027-01-31');
    expect(computeNextDate({ warmth: 'active' }, [tp('2026-03-05')], undefined, TODAY)).toBe('2026-03-12');
    expect(computeNextDate({ warmth: 'active' }, [tp('2026-10-30')], undefined, TODAY)).toBe('2026-11-06');
  });

  it('counts from the latest of several touchpoints', () => {
    expect(computeNextDate({ warmth: 'active' }, [tp('2026-01-01'), tp('2026-03-08'), tp('2026-02-01')], undefined, TODAY)).toBe('2026-03-15');
  });

  it('uses the warm rhythm for an unknown or missing warmth', () => {
    expect(computeNextDate({ warmth: 'hot' }, [tp('2026-03-01')], undefined, TODAY)).toBe('2026-04-12');
    expect(computeNextDate({}, [tp('2026-03-01')], undefined, TODAY)).toBe('2026-04-12');
  });

  it('uses rhythms from the settings, falling back to warm for a zero', () => {
    expect(computeNextDate({ warmth: 'warm' }, [tp('2026-03-01')], { cadence: { warm: 10 } }, TODAY)).toBe('2026-03-11');
    expect(computeNextDate({ warmth: 'active' }, [tp('2026-03-01')], { cadence: { active: 0 } }, TODAY)).toBe('2026-04-12');
  });
});

describe('warmthChangeFields', () => {
  const NOW = '2026-03-10T15:00:00.000Z';

  it('sets just the warmth for most changes', () => {
    expect(warmthChangeFields({ warmth: 'cold' }, 'warm', NOW, TODAY)).toStrictEqual({ warmth: 'warm' });
    expect(warmthChangeFields({ warmth: 'warm' }, 'client', NOW, TODAY)).toStrictEqual({ warmth: 'client' });
  });

  it('restarts the cold sequence when going cold', () => {
    expect(warmthChangeFields({ warmth: 'warm' }, 'cold', NOW, TODAY)).toStrictEqual({ warmth: 'cold', coldSince: NOW });
  });

  it('remembers the park day and the warmth before parking', () => {
    expect(warmthChangeFields({ warmth: 'active' }, 'parked', NOW, TODAY))
      .toStrictEqual({ warmth: 'parked', parkedOn: TODAY, warmthBeforePark: 'active' });
  });

  it('does not overwrite the old warmth when parking someone already parked or with no warmth', () => {
    expect(warmthChangeFields({ warmth: 'parked', warmthBeforePark: 'warm' }, 'parked', NOW, TODAY))
      .toStrictEqual({ warmth: 'parked', parkedOn: TODAY });
    expect(warmthChangeFields({}, 'parked', NOW, TODAY)).toStrictEqual({ warmth: 'parked', parkedOn: TODAY });
  });

  it('uses the real date when no today is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 0, 0));
    expect(warmthChangeFields({ warmth: 'warm' }, 'parked', NOW).parkedOn).toBe('2026-12-31');
  });

  it('passes an unknown warmth through as given (bad input)', () => {
    expect(warmthChangeFields({ warmth: 'warm' }, undefined, NOW, TODAY)).toStrictEqual({ warmth: undefined });
  });
});

describe('cadenceLabel', () => {
  it('describes parking with the parked span', () => {
    expect(cadenceLabel({ warmth: 'parked', cadenceOverrideDays: 10 }, [], undefined)).toBe('Parked. Comes back after 6 months');
    expect(cadenceLabel({ warmth: 'parked' }, [], { cadence: { parked: 30 } })).toBe('Parked. Comes back after 30 days');
  });

  it('describes a check-in after a project before a custom rhythm', () => {
    expect(cadenceLabel({ warmth: 'client', cadenceOverrideDays: 10, postProjectCheckIn: { date: '2026-04-01' } }, [], undefined))
      .toBe('Check-in after the project');
  });

  it('describes a custom rhythm before light touch', () => {
    expect(cadenceLabel({ warmth: 'warm', cadenceOverrideDays: 42, lightTouch: true }, [], undefined)).toBe('Every 6 weeks (custom)');
    expect(cadenceLabel({ warmth: 'warm', cadenceOverrideDays: '10' }, [], undefined)).toBe('Every 10 days (custom)');
  });

  it('describes light touch before the cold sequence', () => {
    expect(cadenceLabel({ warmth: 'cold', lightTouch: true }, [], undefined)).toBe('Every 3 months (light touch default)');
    expect(cadenceLabel({ warmth: 'warm', lightTouch: true }, [], { cadence: { lightTouch: 60 } })).toBe('Every 2 months (light touch default)');
  });

  it('describes each step of the cold sequence', () => {
    const p = coldPerson();
    expect(cadenceLabel(p, [], undefined)).toBe('Cold. First note next');
    expect(cadenceLabel(p, [coldTp('2026-03-01')], undefined)).toBe('Cold. Follow-up 1 week after the first note');
    expect(cadenceLabel(p, [coldTp('2026-03-01'), coldTp('2026-03-08')], undefined)).toBe('Cold. Last try 3 weeks after the follow-up');
    expect(cadenceLabel(p, [coldTp('2026-03-01'), coldTp('2026-03-08'), coldTp('2026-03-29')], undefined)).toBe('Cold. The sequence is finished');
  });

  it('uses the cold gaps from the settings', () => {
    const p = coldPerson();
    expect(cadenceLabel(p, [coldTp('2026-03-01')], COLD)).toBe('Cold. Follow-up 5 days after the first note');
    expect(cadenceLabel(p, [coldTp('2026-03-01'), coldTp('2026-03-06')], COLD)).toBe('Cold. Last try 11 days after the follow-up');
  });

  it('says they replied as soon as a cold note got a reply', () => {
    const p = coldPerson();
    expect(cadenceLabel(p, [tp('2026-03-01', { createdAt: '2026-03-01T13:00:00', responded: 'yes' })], undefined)).toBe('Cold, but they replied');
  });

  it('describes the warmth default for warm, active and on-a-project people', () => {
    expect(cadenceLabel({ warmth: 'warm' }, [], undefined)).toBe('Every 6 weeks (Warm default)');
    expect(cadenceLabel({ warmth: 'active' }, [], undefined)).toBe('Every week (Active default)');
    expect(cadenceLabel({ warmth: 'client' }, [], undefined)).toBe('Every 3 months (On a project default)');
    expect(cadenceLabel({ warmth: 'warm' }, [], { cadence: { warm: 60 } })).toBe('Every 2 months (Warm default)');
  });
});

describe('rhythmWords', () => {
  it('describes a custom rhythm first, even for a parked person', () => {
    expect(rhythmWords({ warmth: 'parked', cadenceOverrideDays: 30 }, undefined)).toBe('Every month (custom)');
    expect(rhythmWords({ warmth: 'warm', lightTouch: true, cadenceOverrideDays: 60 }, undefined)).toBe('Every 2 months (custom)');
  });

  it('describes parking before light touch', () => {
    expect(rhythmWords({ warmth: 'parked', lightTouch: true }, undefined)).toBe('Back after 6 months (Parked default)');
    expect(rhythmWords({ warmth: 'parked' }, { cadence: { parked: 90 } })).toBe('Back after 3 months (Parked default)');
  });

  it('describes light touch before the cold sequence', () => {
    expect(rhythmWords({ warmth: 'cold', lightTouch: true }, undefined)).toBe('Every 3 months (Light touch default)');
    expect(rhythmWords({ warmth: 'cold' }, undefined)).toBe('The cold sequence (Cold default)');
  });

  it('describes the warmth default', () => {
    expect(rhythmWords({ warmth: 'warm' }, undefined)).toBe('Every 6 weeks (Warm default)');
    expect(rhythmWords({ warmth: 'active' }, undefined)).toBe('Every week (Active default)');
    expect(rhythmWords({ warmth: 'client' }, undefined)).toBe('Every 3 months (On a project default)');
    expect(rhythmWords({ warmth: 'warm' }, { cadence: { warm: 14 } })).toBe('Every 2 weeks (Warm default)');
  });

  it('falls back to warm for an unknown or missing warmth', () => {
    expect(rhythmWords({ warmth: 'hot' }, undefined)).toBe('Every 6 weeks (Warm default)');
    expect(rhythmWords({}, undefined)).toBe('Every 6 weeks (Warm default)');
  });

  it('falls back to the warm days when a warmth rhythm is zero', () => {
    expect(rhythmWords({ warmth: 'active' }, { cadence: { active: 0 } })).toBe('Every 6 weeks (Active default)');
  });
});

describe('needsParkPrompt', () => {
  const three = [coldTp('2026-02-01'), coldTp('2026-02-08'), coldTp('2026-03-01')];

  it('asks after three cold notes with no reply', () => {
    expect(needsParkPrompt(coldPerson(), three)).toBe(true);
    expect(needsParkPrompt(coldPerson({ cadenceOverrideDays: 0 }), three)).toBe(true);
  });

  it('does not ask before the third note or after a reply', () => {
    expect(needsParkPrompt(coldPerson(), three.slice(0, 2))).toBe(false);
    expect(needsParkPrompt(coldPerson(), [])).toBe(false);
    const replied = [...three.slice(0, 2), tp('2026-03-01', { createdAt: '2026-03-01T13:00:00', responded: 'yes' })];
    expect(needsParkPrompt(coldPerson(), replied)).toBe(false);
  });

  it('does not ask for someone who is not cold, has a custom rhythm or is a light touch', () => {
    expect(needsParkPrompt({ warmth: 'warm' }, three)).toBe(false);
    expect(needsParkPrompt(coldPerson({ cadenceOverrideDays: 14 }), three)).toBe(false);
    expect(needsParkPrompt(coldPerson({ lightTouch: true }), three)).toBe(false);
  });
});

describe('needsWarmPrompt', () => {
  const replied = [coldTp('2026-02-01'), tp('2026-02-08', { createdAt: '2026-02-08T13:00:00', responded: 'yes' })];

  it('asks when a cold person replied', () => {
    expect(needsWarmPrompt(coldPerson(), replied)).toBe(true);
  });

  it('does not ask without a reply', () => {
    expect(needsWarmPrompt(coldPerson(), [coldTp('2026-02-01')])).toBe(false);
    expect(needsWarmPrompt(coldPerson(), [])).toBe(false);
  });

  it('does not ask for someone who is not cold', () => {
    expect(needsWarmPrompt({ warmth: 'warm' }, replied)).toBe(false);
    expect(needsWarmPrompt({}, replied)).toBe(false);
  });
});

describe('SNOOZE_OPTIONS', () => {
  it('offers four snoozes in order', () => {
    expect(SNOOZE_OPTIONS.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: '3d', label: '3 days' },
      { key: '1w', label: '1 week' },
      { key: '2w', label: '2 weeks' },
      { key: '1m', label: '1 month' },
    ]);
  });

  it('each moves the date by its own span, across a month end', () => {
    const [d3, w1, w2, m1] = SNOOZE_OPTIONS;
    expect(d3.apply('2026-01-31')).toBe('2026-02-03');
    expect(w1.apply('2026-01-31')).toBe('2026-02-07');
    expect(w2.apply('2026-01-31')).toBe('2026-02-14');
    expect(m1.apply('2026-01-31')).toBe('2026-02-28');
  });
});

describe('snoozeDate', () => {
  it('snoozes across a year end', () => {
    expect(snoozeDate('3d', '2026-12-29')).toBe('2027-01-01');
    expect(snoozeDate('1w', '2026-12-29')).toBe('2027-01-05');
    expect(snoozeDate('2w', '2026-12-29')).toBe('2027-01-12');
    expect(snoozeDate('1m', '2026-12-29')).toBe('2027-01-29');
  });

  it('keeps a month snooze inside a short month, leap years included', () => {
    expect(snoozeDate('1m', '2028-01-31')).toBe('2028-02-29');
    expect(snoozeDate('1m', '2026-03-31')).toBe('2026-04-30');
  });

  it('returns today for an unknown or missing key', () => {
    expect(snoozeDate('5y', TODAY)).toBe(TODAY);
    expect(snoozeDate(undefined, TODAY)).toBe(TODAY);
  });

  it('uses the real date when no today is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 27, 9, 0, 0));
    expect(snoozeDate('3d')).toBe('2026-03-02');
  });
});

describe('an unknown or missing warmth counts as warm', () => {
  const asWarm = cadenceLabel({ warmth: 'warm' }, [], undefined);
  it('labels the rhythm as the warm default', () => {
    expect(cadenceLabel({ warmth: 'hot' }, [], undefined)).toBe(asWarm);
    expect(cadenceLabel({}, [], undefined)).toBe(asWarm);
    expect(cadenceLabel({ warmth: 'constructor' }, [], undefined)).toBe(asWarm);
  });
  it('labels a zero setting with the warm rhythm, as the date uses', () => {
    expect(cadenceLabel({ warmth: 'active' }, [], { cadence: { active: 0 } })).toBe('Every 6 weeks (Active default)');
    expect(rhythmWords({ warmth: 'active' }, { cadence: { active: 0 } })).toBe(cadenceLabel({ warmth: 'active' }, [], { cadence: { active: 0 } }));
  });
  it('uses your warm setting in the label', () => {
    expect(cadenceLabel({ warmth: 'hot' }, [], { cadence: { warm: 14 } })).toBe(cadenceLabel({ warmth: 'warm' }, [], { cadence: { warm: 14 } }));
  });
  it('describes the rhythm and picks the date as warm too', () => {
    expect(rhythmWords({ warmth: 'constructor' }, undefined)).toBe(rhythmWords({ warmth: 'warm' }, undefined));
    expect(computeNextDate({ warmth: 'constructor' }, [], undefined, TODAY)).toBe(computeNextDate({ warmth: 'warm' }, [], undefined, TODAY));
    expect(computeNextDate({ warmth: 'toString' }, [], undefined, TODAY)).toBe(computeNextDate({ warmth: 'warm' }, [], undefined, TODAY));
  });
});
