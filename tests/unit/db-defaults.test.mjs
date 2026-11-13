// Filling in fields for records saved by older copies of the app, and
// checking export files (js/db.js). These must keep reading old data.
import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION, withPersonDefaults, withTouchpointDefaults, withNewsDefaults, withWeekDefaults, readExport,
} from '../../js/db.js';

// A person with every field already present: nothing should be filled in.
const complete = () => ({
  id: 'p1',
  name: 'Test Person',
  relationshipType: 'pastClient',
  relationshipTypes: ['pastClient', 'collaborator'],
  birthday: null,
  details: [],
  dreamList: false,
  introducedById: null,
  introducedByName: '',
  canIntroduceToIds: [],
  interest: 'unknown',
  circleIds: [],
  firstContact: null,
  firstContactDeadline: null,
  lightTouch: false,
  engagePromptDismissed: null,
  postProjectCheckIn: null,
  updatedAt: '2024-01-01T00:00:00.000Z',
});

describe('SCHEMA_VERSION', () => {
  it('is still 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

describe('withPersonDefaults', () => {
  it('fills every later field on a version 1 person', () => {
    const old = { id: 'p1', name: 'Test Person', updatedAt: '2020-05-05T00:00:00.000Z' };
    expect(withPersonDefaults(old)).toEqual({
      id: 'p1',
      name: 'Test Person',
      updatedAt: '2020-05-05T00:00:00.000Z',
      relationshipType: 'prospect',
      relationshipTypes: ['prospect'],
      birthday: null,
      details: [],
      dreamList: false,
      introducedById: null,
      introducedByName: '',
      canIntroduceToIds: [],
      interest: 'unknown',
      circleIds: [],
      firstContact: null,
      firstContactDeadline: null,
      lightTouch: false,
      engagePromptDismissed: null,
      postProjectCheckIn: null,
    });
  });
  it('returns the same object when nothing is missing', () => {
    const p = complete();
    expect(withPersonDefaults(p)).toBe(p);
  });
  it('does not change the record it was given', () => {
    const old = { id: 'p1' };
    const out = withPersonDefaults(old);
    expect(old).toEqual({ id: 'p1' });
    expect(out).not.toBe(old);
  });
  it('keeps values that are already set', () => {
    const p = {
      ...complete(),
      birthday: '1990-02-28',
      details: [{ id: 'd1', text: 'Likes tea' }],
      dreamList: true,
      introducedById: 'p9',
      introducedByName: 'Another Person',
      canIntroduceToIds: ['p7'],
      interest: 'high',
      circleIds: ['c1'],
      firstContact: '2024-01-05',
      firstContactDeadline: '2024-02-01',
      lightTouch: true,
      engagePromptDismissed: '2024-03-01',
      postProjectCheckIn: { date: '2024-04-01', projectName: 'Test Project' },
    };
    expect(withPersonDefaults(p)).toBe(p);
  });
  it('fills each missing field on its own', () => {
    const cases = [
      ['birthday', undefined, null],
      ['details', 'not a list', []],
      ['dreamList', 'yes', false],
      ['introducedById', undefined, null],
      ['introducedByName', null, ''],
      ['canIntroduceToIds', null, []],
      ['interest', '', 'unknown'],
      ['circleIds', 'c1', []],
      ['firstContact', undefined, null],
      ['firstContactDeadline', undefined, null],
      ['lightTouch', 1, false],
      ['engagePromptDismissed', undefined, null],
    ];
    for (const [key, bad, filled] of cases) {
      const p = { ...complete(), [key]: bad };
      const out = withPersonDefaults(p);
      expect(out, key).not.toBe(p);
      expect(out, key).toEqual({ ...complete(), [key]: filled });
    }
  });
  it('keeps null and empty values that mean "none" already', () => {
    for (const [key, v] of [['birthday', ''], ['introducedById', ''], ['firstContact', ''], ['engagePromptDismissed', false]]) {
      const p = { ...complete(), [key]: v };
      expect(withPersonDefaults(p), key).toBe(p);
    }
  });

  describe('relationship types', () => {
    it('turns the old single type into a list of one', () => {
      const out = withPersonDefaults({ id: 'p1', relationshipType: 'industry' });
      expect(out.relationshipType).toBe('industry');
      expect(out.relationshipTypes).toEqual(['industry']);
    });
    it('makes a list from the single type when the list is empty or not a list', () => {
      expect(withPersonDefaults({ relationshipType: 'other', relationshipTypes: [] }).relationshipTypes).toEqual(['other']);
      expect(withPersonDefaults({ relationshipType: 'other', relationshipTypes: 'other' }).relationshipTypes).toEqual(['other']);
      expect(withPersonDefaults({ relationshipTypes: null }).relationshipTypes).toEqual(['prospect']);
    });
    it('lets a single type changed by an older copy win over the list', () => {
      const out = withPersonDefaults({ ...complete(), relationshipType: 'industry', relationshipTypes: ['pastClient', 'collaborator'] });
      expect(out.relationshipType).toBe('industry');
      expect(out.relationshipTypes).toEqual(['industry']);
    });
    it('puts the list in the standard order', () => {
      const p = { ...complete(), relationshipType: 'pastClient', relationshipTypes: ['collaborator', 'pastClient'] };
      const out = withPersonDefaults(p);
      expect(out.relationshipTypes).toEqual(['pastClient', 'collaborator']);
      expect(p.relationshipTypes).toEqual(['collaborator', 'pastClient']);
    });
    it('drops unknown types from the list', () => {
      expect(withPersonDefaults({ ...complete(), relationshipType: 'industry', relationshipTypes: ['made-up', 'industry'] }).relationshipTypes)
        .toEqual(['industry']);
      expect(withPersonDefaults({ ...complete(), relationshipType: undefined, relationshipTypes: ['made-up'] }).relationshipTypes)
        .toEqual(['prospect']);
    });
    it('keeps a valid list when only the single type is missing', () => {
      const out = withPersonDefaults({ ...complete(), relationshipType: undefined, relationshipTypes: ['collaborator'] });
      expect(out.relationshipTypes).toEqual(['collaborator']);
      expect(out.relationshipType).toBe('prospect');
    });
    it('leaves an ordered list that includes the single type alone', () => {
      const p = { ...complete(), relationshipType: 'collaborator', relationshipTypes: ['pastClient', 'collaborator'] };
      expect(withPersonDefaults(p)).toBe(p);
    });
  });

  describe('check-in after a wrapped project', () => {
    it('is null when missing', () => {
      expect(withPersonDefaults({ ...complete(), postProjectCheckIn: undefined }).postProjectCheckIn).toBeNull();
    });
    it('keeps a good check-in as is', () => {
      const p = { ...complete(), postProjectCheckIn: { date: '2024-12-31', projectName: 'Test Project' } };
      expect(withPersonDefaults(p)).toBe(p);
    });
    it('adds an empty project name when it is missing or not text', () => {
      for (const projectName of [undefined, null, 5]) {
        const out = withPersonDefaults({ ...complete(), postProjectCheckIn: { date: '2025-01-01', projectName, extra: 1 } });
        expect(out.postProjectCheckIn).toEqual({ date: '2025-01-01', projectName: '' });
      }
    });
    it('drops a malformed check-in', () => {
      const bad = [
        'soon', 5, 0, false, '', [], {}, { date: '2025-1-1' }, { date: 'x2025-01-01' }, { date: '2025-01-01x' },
        { date: 20250101 }, { projectName: 'Test Project' }, Object.assign(() => {}, { date: '2025-01-01' }),
      ];
      for (const pc of bad) {
        expect(withPersonDefaults({ ...complete(), postProjectCheckIn: pc }).postProjectCheckIn, JSON.stringify(pc)).toBeNull();
      }
    });
  });

  it('throws for a missing person', () => {
    expect(() => withPersonDefaults(undefined)).toThrow(TypeError);
    expect(() => withPersonDefaults(null)).toThrow(TypeError);
  });
});

describe('withTouchpointDefaults', () => {
  it('fills lightTouch and replyCheckAt on an old touchpoint', () => {
    expect(withTouchpointDefaults({ id: 't1', date: '2024-01-05' }))
      .toEqual({ id: 't1', date: '2024-01-05', lightTouch: false, replyCheckAt: null });
  });
  it('returns the same object when nothing is missing', () => {
    const t = { id: 't1', lightTouch: true, replyCheckAt: '2024-01-06T10:00:00.000Z' };
    expect(withTouchpointDefaults(t)).toBe(t);
    const u = { id: 't2', lightTouch: false, replyCheckAt: null };
    expect(withTouchpointDefaults(u)).toBe(u);
  });
  it('fills each field on its own', () => {
    expect(withTouchpointDefaults({ id: 't1', lightTouch: 'yes', replyCheckAt: null }))
      .toEqual({ id: 't1', lightTouch: false, replyCheckAt: null });
    expect(withTouchpointDefaults({ id: 't1', lightTouch: true }))
      .toEqual({ id: 't1', lightTouch: true, replyCheckAt: null });
  });
  it('throws for a missing touchpoint', () => {
    expect(() => withTouchpointDefaults(undefined)).toThrow(TypeError);
  });
});

describe('withNewsDefaults', () => {
  it('adds repeatsYearly: false to old news', () => {
    expect(withNewsDefaults({ id: 'n1', text: 'New job' })).toEqual({ id: 'n1', text: 'New job', repeatsYearly: false });
  });
  it('returns the same object when repeatsYearly is set', () => {
    const a = { id: 'n1', repeatsYearly: true };
    const b = { id: 'n2', repeatsYearly: false };
    expect(withNewsDefaults(a)).toBe(a);
    expect(withNewsDefaults(b)).toBe(b);
  });
  it('replaces a repeatsYearly that is not true or false', () => {
    expect(withNewsDefaults({ id: 'n1', repeatsYearly: 'yes' })).toEqual({ id: 'n1', repeatsYearly: false });
    expect(withNewsDefaults({ id: 'n1', repeatsYearly: null })).toEqual({ id: 'n1', repeatsYearly: false });
  });
  it('throws for missing news', () => {
    expect(() => withNewsDefaults(null)).toThrow(TypeError);
  });
});

describe('withWeekDefaults', () => {
  it('keeps a week that already has points', () => {
    const w = { id: 'w1', points: [{ id: 'a', text: 'Called back' }] };
    expect(withWeekDefaults(w)).toBe(w);
    const empty = { id: 'w2', points: [], reflection: 'ignored' };
    expect(withWeekDefaults(empty)).toBe(empty);
  });
  it('turns an old block of reflection text into one point', () => {
    expect(withWeekDefaults({ id: 'w1', reflection: '  Sent three notes.\nGot a reply.  ' }))
      .toEqual({ id: 'w1', reflection: '  Sent three notes.\nGot a reply.  ', points: [{ id: 'reflection', text: 'Sent three notes.\nGot a reply.' }] });
  });
  it('gives no points for empty or blank reflection text', () => {
    expect(withWeekDefaults({ id: 'w1' })).toEqual({ id: 'w1', points: [] });
    expect(withWeekDefaults({ id: 'w1', reflection: '   ' })).toEqual({ id: 'w1', reflection: '   ', points: [] });
    expect(withWeekDefaults({ id: 'w1', reflection: null, points: 'bad' })).toEqual({ id: 'w1', reflection: null, points: [] });
  });
  it('throws for a missing week', () => {
    expect(() => withWeekDefaults(undefined)).toThrow(TypeError);
  });
});

describe('readExport', () => {
  const STORES = ['people', 'organizations', 'circles', 'touchpoints', 'news', 'openLoops', 'ideas', 'weeks', 'settings', 'tombstones'];

  it('returns every synced store, filling defaults on old records', () => {
    const data = readExport({
      app: 'callback',
      version: 1,
      data: {
        people: [{ id: 'p1', name: 'Test Person' }],
        news: [{ id: 'n1' }],
        touchpoints: [{ id: 't1' }],
        weeks: [{ id: 'w1', reflection: 'Good week' }],
        organizations: [{ id: 'o1', name: 'Test Org' }],
        settings: [{ id: 'settings', goals: { touchpoints: 4 } }],
      },
    });
    expect(Object.keys(data).sort()).toEqual([...STORES].sort());
    expect(data.people[0]).toEqual(withPersonDefaults({ id: 'p1', name: 'Test Person' }));
    expect(data.news[0]).toEqual({ id: 'n1', repeatsYearly: false });
    expect(data.touchpoints[0]).toEqual({ id: 't1', lightTouch: false, replyCheckAt: null });
    expect(data.weeks[0].points).toEqual([{ id: 'reflection', text: 'Good week' }]);
    expect(data.organizations).toEqual([{ id: 'o1', name: 'Test Org' }]);
    // Settings are read as they are; getSettings fills their defaults.
    expect(data.settings).toEqual([{ id: 'settings', goals: { touchpoints: 4 } }]);
    expect(data.circles).toEqual([]);
    expect(data.tombstones).toEqual([]);
  });
  it('reads a file without a version, or an older version', () => {
    expect(readExport({ app: 'callback', data: {} }).people).toEqual([]);
    expect(readExport({ app: 'callback', version: 0, data: {} }).people).toEqual([]);
    expect(readExport({ app: 'callback', version: '1', data: {} }).people).toEqual([]);
  });
  it('drops records without a text id and stores that are not lists', () => {
    const data = readExport({
      app: 'callback',
      version: 1,
      data: {
        organizations: [null, 'o1', { id: 5 }, {}, { id: 'o2' }, { id: '' }],
        circles: { id: 'c1' },
        ideas: 'nope',
        meta: [{ id: 'm1' }],
      },
    });
    expect(data.organizations).toEqual([{ id: 'o2' }, { id: '' }]);
    expect(data.circles).toEqual([]);
    expect(data.ideas).toEqual([]);
    expect(data.meta).toBeUndefined();
  });
  it('turns away files that are not Callback exports', () => {
    const msg = "This file doesn't look like a Callback export.";
    for (const p of [null, undefined, 0, '', {}, { app: 'other', data: {} }, { app: 'Callback', data: {} }, { app: 'callback' }, { app: 'callback', data: null }]) {
      expect(() => readExport(p), JSON.stringify(p)).toThrow(msg);
    }
  });
  it('turns away files from a newer version of the app', () => {
    const msg = 'This export comes from a newer version of Callback. Update the app, then try again.';
    expect(() => readExport({ app: 'callback', version: 2, data: {} })).toThrow(msg);
    expect(() => readExport({ app: 'callback', version: '2', data: {} })).toThrow(msg);
    expect(() => readExport({ app: 'callback', version: 1.5, data: {} })).toThrow(msg);
  });
});
