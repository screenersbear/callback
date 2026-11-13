// Saving, reading and deleting records (js/db.js), and the sync hook.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { freshDb, rawAll, rawPut, pinClock, UUID } from './db-helpers.mjs';

let db;
const T1 = '2024-12-31T23:00:00.000Z';
const T2 = '2025-01-01T08:30:00.000Z';

beforeEach(async () => {
  db = await freshDb();
  pinClock(T1);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tomb = (id, store, at = T1) => ({ id, store, deletedAt: at, createdAt: at, updatedAt: at });

describe('savePerson and the shared stamping', () => {
  it('gives a new record an id and both timestamps', async () => {
    const saved = await db.savePerson({ name: 'Test Person' });
    expect(saved).toEqual({ name: 'Test Person', id: expect.stringMatching(UUID), createdAt: T1, updatedAt: T1 });
    expect(await rawAll('people')).toEqual([saved]);
  });
  it('keeps the id and createdAt of an existing record and moves updatedAt', async () => {
    const first = await db.savePerson({ name: 'Test Person' });
    vi.setSystemTime(new Date(T2));
    const again = await db.savePerson({ ...first, name: 'Renamed Person' });
    expect(again).toEqual({ name: 'Renamed Person', id: first.id, createdAt: T1, updatedAt: T2 });
    expect(await rawAll('people')).toEqual([again]);
  });
  it('gives each new record its own id', async () => {
    const a = await db.savePerson({ name: 'Test Person' });
    const b = await db.savePerson({ name: 'Test Person' });
    expect(a.id).not.toBe(b.id);
    expect(await rawAll('people')).toHaveLength(2);
  });
  it('does not change the object it was given', async () => {
    const input = { name: 'Test Person' };
    await db.savePerson(input);
    expect(input).toEqual({ name: 'Test Person' });
  });
  it('rejects a record that cannot be stored', async () => {
    await expect(db.savePerson({ name: 'Test Person', fn: () => {} })).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(await rawAll('people')).toEqual([]);
  });
});

describe('getPeople and getPerson', () => {
  it('fills defaults on people saved by older copies', async () => {
    await db.getPeople();
    await rawPut('people', [{ id: 'p1', name: 'Test Person' }]);
    const [p] = await db.getPeople();
    expect(p).toMatchObject({ id: 'p1', relationshipType: 'prospect', circleIds: [], postProjectCheckIn: null });
    expect(await db.getPerson('p1')).toEqual(p);
  });
  it('returns undefined for someone who is not there', async () => {
    expect(await db.getPerson('nobody')).toBeUndefined();
  });
  it('returns everyone', async () => {
    await db.savePeople([{ id: 'a', name: 'Test A' }, { id: 'b', name: 'Test B' }]);
    expect((await db.getPeople()).map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('savePeople', () => {
  it('stamps and saves every person in one go', async () => {
    const recs = await db.savePeople([{ name: 'Test A' }, { id: 'b', name: 'Test B', createdAt: '2020-01-01T00:00:00.000Z' }]);
    expect(recs).toEqual([
      { name: 'Test A', id: expect.stringMatching(UUID), createdAt: T1, updatedAt: T1 },
      { name: 'Test B', id: 'b', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: T1 },
    ]);
    expect(await rawAll('people')).toHaveLength(2);
  });
  it('saves nothing for an empty list', async () => {
    expect(await db.savePeople([])).toEqual([]);
    expect(await rawAll('people')).toEqual([]);
  });
  it('rejects when one of them cannot be stored, and that one is not saved', async () => {
    await expect(db.savePeople([{ id: 'a', name: 'Test A' }, { id: 'b', bad: Symbol('x') }])).rejects.toMatchObject({ name: 'DataCloneError' });
    expect((await rawAll('people')).map((p) => p.id)).not.toContain('b');
  });
  it('saves none of them when one cannot be stored', async () => {
    await expect(db.savePeople([{ id: 'a', name: 'Test A' }, { id: 'b', bad: Symbol('x') }])).rejects.toMatchObject({ name: 'DataCloneError' });
    expect(await rawAll('people')).toEqual([]);
    await expect(db.savePeople([{ id: 'c', name: 'Test C' }])).resolves.toHaveLength(1);
    expect((await rawAll('people')).map((p) => p.id)).toEqual(['c']);
  });
});

describe('deletePerson', () => {
  it('removes the person with their touchpoints, news and open loops, leaving tombstones', async () => {
    await db.savePeople([{ id: 'p1', name: 'Test Person' }, { id: 'p2', name: 'Other Person' }]);
    await db.saveTouchpoint({ id: 't1', personId: 'p1' });
    await db.saveTouchpoint({ id: 't2', personId: 'p1' });
    await db.saveTouchpoint({ id: 't3', personId: 'p2' });
    await db.saveNews({ id: 'n1', personId: 'p1' });
    await db.saveOpenLoop({ id: 'l1', personId: 'p1' });
    await db.saveOpenLoop({ id: 'l2', personId: 'p2' });
    vi.setSystemTime(new Date(T2));
    await db.deletePerson('p1');
    expect((await rawAll('people')).map((p) => p.id)).toEqual(['p2']);
    expect((await rawAll('touchpoints')).map((t) => t.id)).toEqual(['t3']);
    expect(await rawAll('news')).toEqual([]);
    expect((await rawAll('openLoops')).map((l) => l.id)).toEqual(['l2']);
    expect(await rawAll('tombstones')).toEqual([
      tomb('l1', 'openLoops', T2), tomb('n1', 'news', T2), tomb('p1', 'people', T2), tomb('t1', 'touchpoints', T2), tomb('t2', 'touchpoints', T2),
    ]);
  });
  it('removes someone with nothing else attached', async () => {
    await db.savePerson({ id: 'p1', name: 'Test Person' });
    await db.deletePerson('p1');
    expect(await rawAll('people')).toEqual([]);
    expect(await rawAll('tombstones')).toEqual([tomb('p1', 'people')]);
  });
  it('still leaves a tombstone for someone already gone', async () => {
    await db.deletePerson('ghost');
    expect(await rawAll('tombstones')).toEqual([tomb('ghost', 'people')]);
  });
});

describe('organizations', () => {
  it('saves, lists and gets organizations', async () => {
    const o = await db.saveOrganization({ name: 'Test Org' });
    expect(await db.getOrganizations()).toEqual([o]);
    expect(await db.getOrganization(o.id)).toEqual(o);
    expect(await db.getOrganization('missing')).toBeUndefined();
  });
  it('deletes an organization and takes its people out of it', async () => {
    await db.saveOrganization({ id: 'o1', name: 'Test Org' });
    await db.saveOrganization({ id: 'o2', name: 'Other Org' });
    await db.savePeople([
      { id: 'p1', name: 'Test A', organizationId: 'o1' },
      { id: 'p2', name: 'Test B', organizationId: 'o2' },
      { id: 'p3', name: 'Test C' },
    ]);
    vi.setSystemTime(new Date(T2));
    await db.deleteOrganization('o1');
    expect((await db.getOrganizations()).map((o) => o.id)).toEqual(['o2']);
    expect(await rawAll('people')).toEqual([
      { id: 'p1', name: 'Test A', organizationId: null, createdAt: T1, updatedAt: T2 },
      { id: 'p2', name: 'Test B', organizationId: 'o2', createdAt: T1, updatedAt: T1 },
      { id: 'p3', name: 'Test C', createdAt: T1, updatedAt: T1 },
    ]);
    expect(await rawAll('tombstones')).toEqual([tomb('o1', 'organizations', T2)]);
  });
  it('deletes an organization nobody belongs to', async () => {
    await db.saveOrganization({ id: 'o1', name: 'Test Org' });
    await db.deleteOrganization('o1');
    expect(await db.getOrganizations()).toEqual([]);
    expect(await rawAll('tombstones')).toEqual([tomb('o1', 'organizations')]);
  });
});

describe('circles', () => {
  it('saves one or many circles', async () => {
    const c = await db.saveCircle({ name: 'Test Circle' });
    const more = await db.saveCircles([{ id: 'c2', name: 'Second' }, { name: 'Third' }]);
    expect(more).toEqual([
      { id: 'c2', name: 'Second', createdAt: T1, updatedAt: T1 },
      { name: 'Third', id: expect.stringMatching(UUID), createdAt: T1, updatedAt: T1 },
    ]);
    expect(await db.getCircles()).toHaveLength(3);
    expect(await db.getCircles()).toContainEqual(c);
    expect(await db.saveCircles([])).toEqual([]);
  });
  it('deletes a circle and every membership in it, keeping the people', async () => {
    await db.saveCircles([{ id: 'c1' }, { id: 'c2' }]);
    await db.savePeople([
      { id: 'p1', circleIds: ['c1', 'c2'] },
      { id: 'p2', circleIds: ['c2'] },
      { id: 'p3' },
      { id: 'p4', circleIds: ['c1'] },
    ]);
    vi.setSystemTime(new Date(T2));
    await db.deleteCircle('c1');
    expect((await db.getCircles()).map((c) => c.id)).toEqual(['c2']);
    expect(await rawAll('people')).toEqual([
      { id: 'p1', circleIds: ['c2'], createdAt: T1, updatedAt: T2 },
      { id: 'p2', circleIds: ['c2'], createdAt: T1, updatedAt: T1 },
      { id: 'p3', createdAt: T1, updatedAt: T1 },
      { id: 'p4', circleIds: [], createdAt: T1, updatedAt: T2 },
    ]);
    expect(await rawAll('tombstones')).toEqual([tomb('c1', 'circles', T2)]);
  });
  it('deletes a circle when there are no people', async () => {
    await db.saveCircle({ id: 'c1' });
    await db.deleteCircle('c1');
    expect(await db.getCircles()).toEqual([]);
    expect(await rawAll('tombstones')).toEqual([tomb('c1', 'circles')]);
  });
});

describe('touchpoints, news and open loops', () => {
  it('fills touchpoint defaults when listing all, and lists one person\'s', async () => {
    await db.saveTouchpoint({ id: 't1', personId: 'p1', date: '2024-12-31' });
    await db.saveTouchpoint({ id: 't2', personId: 'p2', date: '2025-01-01', lightTouch: true, replyCheckAt: T1 });
    expect(await db.getTouchpoints()).toEqual([
      { id: 't1', personId: 'p1', date: '2024-12-31', createdAt: T1, updatedAt: T1, lightTouch: false, replyCheckAt: null },
      { id: 't2', personId: 'p2', date: '2025-01-01', lightTouch: true, replyCheckAt: T1, createdAt: T1, updatedAt: T1 },
    ]);
    expect((await db.getTouchpointsFor('p1')).map((t) => t.id)).toEqual(['t1']);
    expect(await db.getTouchpointsFor('nobody')).toEqual([]);
  });
  it('deletes a touchpoint, leaving a tombstone', async () => {
    await db.saveTouchpoint({ id: 't1', personId: 'p1' });
    await db.deleteTouchpoint('t1');
    expect(await db.getTouchpoints()).toEqual([]);
    expect(await rawAll('tombstones')).toEqual([tomb('t1', 'touchpoints')]);
  });
  it('fills news defaults when listing all, lists one person\'s and deletes', async () => {
    await db.saveNews({ id: 'n1', personId: 'p1' });
    await db.saveNews({ id: 'n2', personId: 'p2', repeatsYearly: true });
    expect((await db.getNews()).map((n) => n.repeatsYearly)).toEqual([false, true]);
    expect((await db.getNewsFor('p2')).map((n) => n.id)).toEqual(['n2']);
    await db.deleteNews('n2');
    expect((await db.getNews()).map((n) => n.id)).toEqual(['n1']);
    expect(await rawAll('tombstones')).toEqual([tomb('n2', 'news')]);
  });
  it('saves, lists and deletes open loops', async () => {
    const l = await db.saveOpenLoop({ personId: 'p1', text: 'Send the photos' });
    expect(await db.getOpenLoops()).toEqual([l]);
    await db.deleteOpenLoop(l.id);
    expect(await db.getOpenLoops()).toEqual([]);
    expect(await rawAll('tombstones')).toEqual([tomb(l.id, 'openLoops')]);
  });
  it('leaves a tombstone even when deleting something already gone', async () => {
    await db.deleteNews('missing');
    expect(await rawAll('tombstones')).toEqual([tomb('missing', 'news')]);
  });
});

describe('ideas', () => {
  it('saves one or many ideas', async () => {
    const one = await db.saveIdea({ source: 'own', text: 'Send a postcard' });
    const many = await db.saveIdeas([{ id: 'builtin:x', source: 'builtin' }, { source: 'own', text: 'Share a link' }]);
    expect(many[0]).toEqual({ id: 'builtin:x', source: 'builtin', createdAt: T1, updatedAt: T1 });
    expect(many[1].id).toMatch(UUID);
    const all = await db.getIdeas();
    expect(all).toHaveLength(3);
    expect(all).toContainEqual(one);
  });
  it('saves nothing for an empty list', async () => {
    expect(await db.saveIdeas([])).toEqual([]);
    expect(await db.getIdeas()).toEqual([]);
  });
  it('replaces an idea saved again with the same id', async () => {
    await db.saveIdea({ id: 'i1', text: 'Old' });
    await db.saveIdeas([{ id: 'i1', text: 'New' }]);
    expect((await db.getIdeas()).map((i) => i.text)).toEqual(['New']);
  });
});

describe('weeks', () => {
  it('fills points on old weeks when listing all', async () => {
    await db.saveWeek({ id: 'w1', weekStart: '2024-12-30', reflection: 'Good week' });
    await db.saveWeek({ id: 'w2', weekStart: '2025-01-06', points: [] });
    const weeks = await db.getWeeks();
    expect(weeks[0].points).toEqual([{ id: 'reflection', text: 'Good week' }]);
    expect(weeks[1].points).toEqual([]);
  });
  it('gets the newest record for a week when two devices each made one', async () => {
    await db.getWeeks();
    await rawPut('weeks', [
      { id: 'w-a', weekStart: '2024-12-30', updatedAt: '2024-12-31T10:00:00.000Z' },
      { id: 'w-b', weekStart: '2024-12-30', updatedAt: '2025-01-02T10:00:00.000Z' },
      { id: 'w-c', weekStart: '2024-12-30', updatedAt: '2025-01-01T10:00:00.000Z' },
      { id: 'w-d', weekStart: '2025-01-06', updatedAt: '2025-01-09T10:00:00.000Z' },
    ]);
    expect((await db.getWeek('2024-12-30')).id).toBe('w-b');
    expect((await db.getWeek('2025-01-06')).id).toBe('w-d');
  });
  it('returns null for a week with no record', async () => {
    expect(await db.getWeek('2025-01-13')).toBeNull();
  });
});

describe('settings', () => {
  it('gives the default settings before any are saved', async () => {
    const s = await db.getSettings();
    expect(s.id).toBe('settings');
    expect(s.cadence.warm).toBe(42);
    expect(s.goals).toEqual({ touchpoints: 10, newPeople: 3 });
  });
  it('saves under the one shared id and merges with the defaults', async () => {
    const saved = await db.saveSettings({ id: 'something-else', goals: { touchpoints: 4 } });
    expect(saved).toEqual({ id: 'settings', goals: { touchpoints: 4 }, createdAt: T1, updatedAt: T1 });
    expect(await rawAll('settings')).toEqual([saved]);
    const s = await db.getSettings();
    expect(s.goals).toEqual({ touchpoints: 4, newPeople: 3 });
    expect(s.cadence.warm).toBe(42);
  });
  it('keeps one settings record however often it is saved', async () => {
    await db.saveSettings({ goals: { touchpoints: 1 } });
    vi.setSystemTime(new Date(T2));
    await db.saveSettings({ ...(await db.getSettings()), goals: { touchpoints: 2 } });
    const all = await rawAll('settings');
    expect(all).toHaveLength(1);
    expect(all[0].createdAt).toBe(T1);
    expect(all[0].updatedAt).toBe(T2);
  });
});

describe('device-only facts', () => {
  it('returns undefined for a key never set', async () => {
    expect(await db.getMeta('lastExport')).toBeUndefined();
  });
  it('sets and replaces a value', async () => {
    await db.setMeta('lastExport', T1);
    expect(await db.getMeta('lastExport')).toBe(T1);
    await db.setMeta('lastExport', T2);
    expect(await db.getMeta('lastExport')).toBe(T2);
    expect(await rawAll('meta')).toEqual([{ key: 'lastExport', value: T2 }]);
  });
  it('returns falsy values as they were set', async () => {
    await db.setMeta('zero', 0);
    await db.setMeta('empty', '');
    await db.setMeta('off', false);
    await db.setMeta('nothing', null);
    expect(await db.getMeta('zero')).toBe(0);
    expect(await db.getMeta('empty')).toBe('');
    expect(await db.getMeta('off')).toBe(false);
    expect(await db.getMeta('nothing')).toBeNull();
  });
  it('keeps objects', async () => {
    await db.setMeta('sync', { token: 'test-only', at: T1 });
    expect(await db.getMeta('sync')).toEqual({ token: 'test-only', at: T1 });
  });
});

describe('askToPersist', () => {
  const realStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
  const setStorage = (value) => Object.defineProperty(navigator, 'storage', { value, configurable: true });
  afterEach(() => {
    if (realStorage) Object.defineProperty(navigator, 'storage', realStorage);
    else delete navigator.storage;
  });

  it('asks when storage is not yet persistent', async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: vi.fn(async () => false), persist });
    await expect(db.askToPersist()).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it('does not ask again when storage is already persistent', async () => {
    const persist = vi.fn(async () => true);
    setStorage({ persisted: vi.fn(async () => true), persist });
    await db.askToPersist();
    expect(persist).not.toHaveBeenCalled();
  });
  it('does nothing without storage support', async () => {
    setStorage(undefined);
    await expect(db.askToPersist()).resolves.toBeUndefined();
    const persisted = vi.fn(async () => false);
    setStorage({ persisted });
    await expect(db.askToPersist()).resolves.toBeUndefined();
    expect(persisted).not.toHaveBeenCalled();
  });
  it('swallows errors from the browser', async () => {
    setStorage({ persisted: vi.fn(async () => { throw new Error('denied'); }), persist: vi.fn() });
    await expect(db.askToPersist()).resolves.toBeUndefined();
    setStorage({ persisted: async () => false, persist: vi.fn(async () => { throw new Error('denied'); }) });
    await expect(db.askToPersist()).resolves.toBeUndefined();
  });
});

describe('saving: failures', () => {
  // A stand-in transaction, so the transaction's own error paths can be driven.
  const fakeTx = () => {
    const tx = { error: null, objectStore: () => ({ put() {}, delete() {}, clear() {} }) };
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => tx);
    return tx;
  };

  it('rejects with the transaction error', async () => {
    await db.getPeople();
    const tx = fakeTx();
    const saving = db.savePerson({ name: 'Test Person' });
    await vi.waitFor(() => expect(tx.onerror).toBeTypeOf('function'));
    tx.error = new Error('disk full');
    tx.onerror();
    await expect(saving).rejects.toThrow('disk full');
  });
  it('rejects with the abort reason when a save is aborted', async () => {
    await db.getPeople();
    const tx = fakeTx();
    const saving = db.setMeta('k', 1);
    await vi.waitFor(() => expect(tx.onabort).toBeTypeOf('function'));
    tx.error = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    tx.onabort();
    await expect(saving).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });
  it('rejects with a plain message when a save is cancelled with no reason', async () => {
    await db.getPeople();
    const tx = fakeTx();
    const saving = db.deleteTouchpoint('t1');
    await vi.waitFor(() => expect(tx.onabort).toBeTypeOf('function'));
    tx.onabort();
    await expect(saving).rejects.toThrow('Save was cancelled.');
  });
  it('rejects when a real transaction is aborted', async () => {
    await db.getPeople();
    const real = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(function abortSoon(...args) {
      const tx = real.apply(this, args);
      queueMicrotask(() => tx.abort());
      return tx;
    });
    let failed = false;
    await db.savePerson({ id: 'p1' }).catch(() => { failed = true; });
    expect(failed).toBe(true);
    expect(await rawAll('people')).toEqual([]);
  });
  it('rejects a real cancelled save with a plain message, not an empty reason', async () => {
    await db.getPeople();
    const real = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(function abortSoon(...args) {
      const tx = real.apply(this, args);
      queueMicrotask(() => tx.abort());
      return tx;
    });
    await expect(db.savePerson({ id: 'p1' })).rejects.toThrow('Save was cancelled.');
  });
  it('waits for the abort when an error comes with no reason yet', async () => {
    await db.getPeople();
    const tx = fakeTx();
    const saving = db.savePerson({ name: 'Test Person' });
    await vi.waitFor(() => expect(tx.onerror).toBeTypeOf('function'));
    tx.onerror();
    tx.error = Object.assign(new Error('taken'), { name: 'ConstraintError' });
    tx.onabort();
    await expect(saving).rejects.toMatchObject({ name: 'ConstraintError' });
  });
});

describe('onSyncedChange', () => {
  it('is told after each save of synced data', async () => {
    const fn = vi.fn();
    db.onSyncedChange(fn);
    await db.savePerson({ name: 'Test Person' });
    expect(fn).toHaveBeenCalledTimes(1);
    await db.deleteTouchpoint('t1');
    await db.saveCircles([{ id: 'c1' }]);
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('is called after the save has finished', async () => {
    let seen;
    db.onSyncedChange(() => { seen = rawAll('people'); });
    await db.savePerson({ id: 'p1' });
    expect(await seen).toHaveLength(1);
  });
  it('is not told about device-only facts', async () => {
    const fn = vi.fn();
    db.onSyncedChange(fn);
    await db.setMeta('lastExport', T1);
    expect(fn).not.toHaveBeenCalled();
  });
  it('is told when a save covers synced and device-only stores', async () => {
    const fn = vi.fn();
    db.onSyncedChange(fn);
    await db.eraseAll();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('only the latest listener is told', async () => {
    const first = vi.fn();
    const second = vi.fn();
    db.onSyncedChange(first);
    db.onSyncedChange(second);
    await db.saveNews({ id: 'n1' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
  it('saving works with no listener at all', async () => {
    await expect(db.saveIdea({ id: 'i1' })).resolves.toMatchObject({ id: 'i1' });
    db.onSyncedChange(null);
    await expect(db.saveIdea({ id: 'i2' })).resolves.toMatchObject({ id: 'i2' });
  });
  it('is not told when a save fails', async () => {
    const fn = vi.fn();
    db.onSyncedChange(fn);
    await expect(db.savePerson({ bad: () => {} })).rejects.toBeTruthy();
    expect(fn).not.toHaveBeenCalled();
  });
});
