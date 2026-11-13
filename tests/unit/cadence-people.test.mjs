// Unit tests for js/cadence.js, part 3: yearly dates, the dream list, how
// someone was added, light touch, idea pools and the "Did they reply?" check.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  nextYearly, YEARLY_LEAD_DAYS, LOOP_LEAD_DAYS, yearlyWindow, isDreamOnly, JUST_MET_DAYS, firstContactStage,
  leavesLightTouch, lightOffFields, isEngaging, ideaStage, REPLY_CHECK_HOURS, replyCheckDue,
} from '../../js/cadence.js';

const TODAY = '2026-03-10';

afterEach(() => {
  vi.useRealTimers();
});

describe('lead-time constants', () => {
  it('yearly dates, loops and just-met follow-ups have their lead times', () => {
    expect(YEARLY_LEAD_DAYS).toBe(7);
    expect(LOOP_LEAD_DAYS).toBe(7);
    expect(JUST_MET_DAYS).toBe(2);
    expect(REPLY_CHECK_HOURS).toBe(48);
  });
});

describe('nextYearly', () => {
  it('lands later this year when the day is still ahead', () => {
    expect(nextYearly('1990-07-04', TODAY)).toBe('2026-07-04');
    expect(nextYearly('1990-01-05', '2026-01-01')).toBe('2026-01-05');
  });

  it('lands next year when the day has passed', () => {
    expect(nextYearly('1990-02-01', TODAY)).toBe('2027-02-01');
    expect(nextYearly('1990-03-09', TODAY)).toBe('2027-03-09');
  });

  it('counts today itself', () => {
    expect(nextYearly('1990-03-10', TODAY)).toBe(TODAY);
    expect(nextYearly('1985-12-31', '2026-12-31')).toBe('2026-12-31');
  });

  it('rolls over a year end', () => {
    expect(nextYearly('1985-01-01', '2026-12-31')).toBe('2027-01-01');
  });

  it('puts February 29 on the 28th outside leap years', () => {
    expect(nextYearly('2000-02-29', '2026-01-01')).toBe('2026-02-28');
    expect(nextYearly('2000-02-29', '2028-01-01')).toBe('2028-02-29');
    expect(nextYearly('2000-02-29', '2027-03-01')).toBe('2028-02-29');
  });

  it('clamps a day past the month end (bad input)', () => {
    expect(nextYearly('1990-04-31', TODAY)).toBe('2026-04-30');
  });

  it('is null when no next date can be written as a four-digit year', () => {
    expect(nextYearly('2000-06-01', '9999-12-31')).toBeNull();
  });

  it('uses the real date when no from date is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 5, 12, 0, 0));
    expect(nextYearly('1990-07-04')).toBe('2027-07-04');
  });
});

describe('yearlyWindow', () => {
  const yearly = (date, extra = {}) => ({ date, repeatsYearly: true, ...extra });

  it('says "today" on the day', () => {
    expect(yearlyWindow(yearly('1990-03-10'), [], TODAY)).toBe('today');
  });

  it('gives the date when it is up to a week ahead', () => {
    expect(yearlyWindow(yearly('1990-03-13'), [], TODAY)).toBe('2026-03-13');
    expect(yearlyWindow(yearly('1990-03-17'), [], TODAY)).toBe('2026-03-17');
  });

  it('is null more than a week ahead, or just after the day', () => {
    expect(yearlyWindow(yearly('1990-03-18'), [], TODAY)).toBeNull();
    expect(yearlyWindow(yearly('1990-03-09'), [], TODAY)).toBeNull();
  });

  it('counts the week across a year end and a daylight-saving change', () => {
    expect(yearlyWindow(yearly('1990-01-02'), [], '2026-12-28')).toBe('2027-01-02');
    expect(yearlyWindow(yearly('1990-03-12'), [], '2026-03-05')).toBe('2026-03-12');
    expect(yearlyWindow(yearly('1990-11-07'), [], '2026-10-31')).toBe('2026-11-07');
  });

  it('is settled once dismissed in the week before', () => {
    // The 13th's window starts on the 6th.
    expect(yearlyWindow(yearly('1990-03-13', { dismissedAt: '2026-03-08T10:00:00' }), [], TODAY)).toBeNull();
    expect(yearlyWindow(yearly('1990-03-13', { dismissedAt: '2026-03-06T09:00:00' }), [], TODAY)).toBeNull();
  });

  it('comes back when the dismissal is from before this year\'s window', () => {
    expect(yearlyWindow(yearly('1990-03-13', { dismissedAt: '2026-03-05T23:00:00' }), [], TODAY)).toBe('2026-03-13');
    expect(yearlyWindow(yearly('1990-03-10', { dismissedAt: '2025-03-10T10:00:00' }), [], TODAY)).toBe('today');
  });

  it('is settled by a touchpoint on or after the day', () => {
    expect(yearlyWindow(yearly('1990-03-10'), [{ date: TODAY }], TODAY)).toBeNull();
    expect(yearlyWindow(yearly('1990-03-13'), [{ date: '2026-03-14' }], TODAY)).toBeNull();
    expect(yearlyWindow(yearly('1990-03-13'), [{ date: '2026-03-14' }, { date: '2026-03-01' }], TODAY)).toBeNull();
  });

  it('is not settled by a touchpoint before the day', () => {
    expect(yearlyWindow(yearly('1990-03-13'), [{ date: '2026-03-12' }], TODAY)).toBe('2026-03-13');
  });

  it('is null when there is no next date', () => {
    expect(yearlyWindow(yearly('2000-06-01'), [], '9999-12-31')).toBeNull();
  });

  it('uses the real date when no today is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 4, 8, 0, 0));
    expect(yearlyWindow(yearly('1990-07-04'), [])).toBe('today');
  });
});

describe('isDreamOnly', () => {
  it('is true for someone on the dream list with no touchpoints', () => {
    expect(isDreamOnly({ dreamList: true }, [])).toBe(true);
    expect(isDreamOnly({ dreamList: 'yes' }, [])).toBe(true);
  });

  it('is false once there is a touchpoint', () => {
    expect(isDreamOnly({ dreamList: true }, [{ date: TODAY }])).toBe(false);
  });

  it('is false for someone not on the dream list', () => {
    expect(isDreamOnly({}, [])).toBe(false);
    expect(isDreamOnly({ dreamList: false }, [])).toBe(false);
    expect(isDreamOnly({ dreamList: 0 }, [{ date: TODAY }])).toBe(false);
  });
});

describe('firstContactStage', () => {
  it('returns how they were added before the first touchpoint', () => {
    expect(firstContactStage({ firstContact: 'justMet' }, [])).toBe('justMet');
    expect(firstContactStage({ firstContact: 'reachOutNow' }, [])).toBe('reachOutNow');
    expect(firstContactStage({ firstContact: 'pickDate' }, [])).toBe('pickDate');
  });

  it('is null once there is a touchpoint', () => {
    expect(firstContactStage({ firstContact: 'justMet' }, [{ date: TODAY }])).toBeNull();
  });

  it('is null for other ways of adding, none, or unknown values', () => {
    expect(firstContactStage({ firstContact: 'alreadyDid' }, [])).toBeNull();
    expect(firstContactStage({ firstContact: 'someday' }, [])).toBeNull();
    expect(firstContactStage({}, [])).toBeNull();
    expect(firstContactStage({ firstContact: '' }, [])).toBeNull();
    expect(firstContactStage({ firstContact: 'JustMet' }, [])).toBeNull();
  });
});

describe('leavesLightTouch', () => {
  const light = (extra = {}) => ({ lightTouch: true, warmth: 'warm', relationshipTypes: ['prospect'], ...extra });

  it('ends light touch on becoming active or on a project', () => {
    expect(leavesLightTouch(light(), light({ warmth: 'active' }))).toBe(true);
    expect(leavesLightTouch(light({ warmth: 'cold' }), light({ warmth: 'client' }))).toBe(true);
  });

  it('ends light touch on becoming a past client', () => {
    expect(leavesLightTouch(light(), light({ relationshipTypes: ['pastClient', 'collaborator'] }))).toBe(true);
    expect(leavesLightTouch(light({ relationshipType: 'prospect', relationshipTypes: undefined }), light({ relationshipType: 'pastClient', relationshipTypes: undefined }))).toBe(true);
  });

  it('does not end it when nothing real changed', () => {
    expect(leavesLightTouch(light(), light())).toBe(false);
    expect(leavesLightTouch(light({ warmth: 'active' }), light({ warmth: 'active' }))).toBe(false);
    expect(leavesLightTouch(light({ warmth: 'client' }), light({ warmth: 'client' }))).toBe(false);
    expect(leavesLightTouch(light({ relationshipTypes: ['pastClient'] }), light({ relationshipTypes: ['pastClient'] }))).toBe(false);
    expect(leavesLightTouch(light(), light({ warmth: 'cold', relationshipTypes: ['collaborator'] }))).toBe(false);
  });

  it('is false when the person is no longer a light touch anyway', () => {
    expect(leavesLightTouch(light(), light({ lightTouch: false, warmth: 'active' }))).toBe(false);
    expect(leavesLightTouch(light(), { warmth: 'client' })).toBe(false);
  });

  it('copes with a bare before record (bad input)', () => {
    expect(leavesLightTouch({}, light({ warmth: 'active' }))).toBe(true);
    expect(leavesLightTouch({}, light())).toBe(false);
  });
});

describe('lightOffFields', () => {
  it('only turns light touch off when there is no history and no plan', () => {
    expect(lightOffFields({ warmth: 'warm', lightTouch: true }, [], undefined, TODAY)).toStrictEqual({ lightTouch: false });
  });

  it('keeps a planned date ahead, and brings a missed one up to today', () => {
    expect(lightOffFields({ warmth: 'warm', lightTouch: true, nextTouchpointDate: '2026-04-01' }, [], undefined, TODAY))
      .toStrictEqual({ lightTouch: false, nextTouchpointDate: '2026-04-01' });
    expect(lightOffFields({ warmth: 'warm', lightTouch: true, nextTouchpointDate: '2026-02-01' }, [], undefined, TODAY))
      .toStrictEqual({ lightTouch: false, nextTouchpointDate: TODAY });
  });

  it('switches to the normal rhythm from the last touchpoint', () => {
    expect(lightOffFields({ warmth: 'active', lightTouch: true }, [{ date: '2026-03-08' }], undefined, TODAY))
      .toStrictEqual({ lightTouch: false, nextTouchpointDate: '2026-03-15' });
    expect(lightOffFields({ warmth: 'warm', lightTouch: true }, [{ date: '2026-03-08' }], { cadence: { warm: 14 } }, TODAY))
      .toStrictEqual({ lightTouch: false, nextTouchpointDate: '2026-03-22' });
  });

  it('keeps a custom rhythm', () => {
    expect(lightOffFields({ warmth: 'warm', lightTouch: true, cadenceOverrideDays: 10 }, [{ date: '2026-03-08' }], undefined, TODAY))
      .toStrictEqual({ lightTouch: false, nextTouchpointDate: '2026-03-18' });
  });

  it('never makes them overdue because of the switch', () => {
    expect(lightOffFields({ warmth: 'warm', lightTouch: true }, [{ date: '2025-11-01' }], undefined, TODAY))
      .toStrictEqual({ lightTouch: false, nextTouchpointDate: TODAY });
    // Due exactly today stays today.
    expect(lightOffFields({ warmth: 'warm', lightTouch: true }, [{ date: '2026-01-27' }], undefined, TODAY))
      .toStrictEqual({ lightTouch: false, nextTouchpointDate: TODAY });
  });

  it('uses the real date when no today is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 18, 0, 0));
    expect(lightOffFields({ warmth: 'warm', lightTouch: true }, [{ date: '2026-01-01' }], undefined))
      .toStrictEqual({ lightTouch: false, nextTouchpointDate: '2026-12-31' });
  });
});

describe('isEngaging', () => {
  const yes = (id, date) => ({ id, date, responded: 'yes' });
  const no = (id, date) => ({ id, date, responded: 'no' });

  it('is true for a light touch whose last two touchpoints got replies', () => {
    expect(isEngaging({ lightTouch: true }, [yes('a', '2026-03-01'), yes('b', '2026-03-05'), no('c', '2026-02-01')])).toBe(true);
  });

  it('looks at the two newest, not the input order', () => {
    expect(isEngaging({ lightTouch: true }, [yes('a', '2026-03-01'), no('old', '2026-01-01'), yes('b', '2026-03-05')])).toBe(true);
    expect(isEngaging({ lightTouch: true }, [yes('a', '2026-01-01'), no('mid', '2026-02-01'), yes('b', '2026-03-05')])).toBe(false);
  });

  it('needs both of the last two to be replies', () => {
    expect(isEngaging({ lightTouch: true }, [no('a', '2026-03-01'), yes('b', '2026-03-05')])).toBe(false);
    expect(isEngaging({ lightTouch: true }, [yes('a', '2026-03-01'), no('b', '2026-03-05')])).toBe(false);
  });

  it('needs at least two touchpoints', () => {
    expect(isEngaging({ lightTouch: true }, [yes('a', '2026-03-01')])).toBe(false);
    expect(isEngaging({ lightTouch: true }, [])).toBe(false);
  });

  it('is only for light touches', () => {
    expect(isEngaging({}, [yes('a', '2026-03-01'), yes('b', '2026-03-05')])).toBe(false);
  });

  it('stays quiet once dismissed for the newest reply, until another comes in', () => {
    const tps = [yes('a', '2026-03-01'), yes('b', '2026-03-05')];
    expect(isEngaging({ lightTouch: true, engagePromptDismissed: 'b' }, tps)).toBe(false);
    expect(isEngaging({ lightTouch: true, engagePromptDismissed: 'a' }, tps)).toBe(true);
  });
});

describe('ideaStage', () => {
  it('is light touch for a light touch with no touchpoints, however they were added', () => {
    expect(ideaStage({ lightTouch: true, firstContact: 'justMet' }, [])).toBe('lightTouch');
  });

  it('follows how they were added otherwise', () => {
    expect(ideaStage({ firstContact: 'justMet' }, [])).toBe('justMet');
    expect(ideaStage({ firstContact: 'pickDate' }, [])).toBe('pickDate');
  });

  it('is null once there is a touchpoint, or with no first-contact stage', () => {
    expect(ideaStage({ lightTouch: true, firstContact: 'justMet' }, [{ date: TODAY }])).toBeNull();
    expect(ideaStage({}, [])).toBeNull();
  });
});

describe('replyCheckDue', () => {
  const warm = { warmth: 'warm' };
  const NOW = new Date('2026-03-12T12:00:00.000Z');
  const pending = (extra = {}) => ({ date: '2026-03-10', responded: 'pending', ...extra });

  it('asks 48 hours after the touchpoint was logged, not before', () => {
    expect(replyCheckDue(warm, pending({ createdAt: '2026-03-10T12:00:00.000Z' }), NOW)).toBe(true);
    expect(replyCheckDue(warm, pending({ createdAt: '2026-03-10T12:00:00.001Z' }), NOW)).toBe(false);
    expect(replyCheckDue(warm, pending({ createdAt: '2026-03-01T12:00:00.000Z' }), NOW)).toBe(true);
  });

  it('counts from the last "Not yet" instead of when it was logged', () => {
    const old = '2026-03-01T12:00:00.000Z';
    expect(replyCheckDue(warm, pending({ createdAt: old, replyCheckAt: '2026-03-11T12:00:00.000Z' }), NOW)).toBe(false);
    expect(replyCheckDue(warm, pending({ createdAt: old, replyCheckAt: '2026-03-10T12:00:00.000Z' }), NOW)).toBe(true);
  });

  it('counts from the start of the touchpoint day when there is no timestamp', () => {
    const t = { date: '2026-06-10', responded: 'pending' };
    expect(replyCheckDue(warm, t, new Date(2026, 5, 12, 0, 0, 0))).toBe(true);
    expect(replyCheckDue(warm, t, new Date(2026, 5, 11, 23, 59, 59))).toBe(false);
  });

  it('uses the logged time over the touchpoint date', () => {
    const t = pending({ date: '2026-03-01', createdAt: '2026-03-12T00:00:00.000Z' });
    expect(replyCheckDue(warm, t, NOW)).toBe(false);
  });

  it('does not ask once they replied or did not, or with no answer field', () => {
    for (const responded of ['yes', 'no', undefined]) {
      expect(replyCheckDue(warm, { date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', responded }, NOW)).toBe(false);
    }
  });

  it('does not ask for light touches or parked people', () => {
    const t = pending({ createdAt: '2026-03-01T12:00:00.000Z' });
    expect(replyCheckDue(warm, { ...t, lightTouch: true }, NOW)).toBe(false);
    expect(replyCheckDue({ warmth: 'warm', lightTouch: true }, t, NOW)).toBe(false);
    expect(replyCheckDue({ warmth: 'parked' }, t, NOW)).toBe(false);
  });

  it('does not ask for a touchpoint with an unreadable time (bad input)', () => {
    expect(replyCheckDue(warm, pending({ createdAt: 'not a time' }), NOW)).toBe(false);
  });

  it('uses the real time when no now is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'));
    expect(replyCheckDue(warm, pending({ createdAt: '2026-03-10T12:00:00.000Z' }))).toBe(true);
    expect(replyCheckDue(warm, pending({ createdAt: '2026-03-11T12:00:00.000Z' }))).toBe(false);
  });
});
