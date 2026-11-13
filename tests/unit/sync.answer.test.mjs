// js/sync.js resolve: answering a held clash on this device. The answer is
// saved here as the newest copy, the last-agreed copy moves on, the clash
// leaves the list, and a sync is asked for so the answer goes out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fake from './sync.fakes.mjs';
import { resolve, queued, getConflicts } from '../../js/sync.js';

vi.mock('../../js/db.js', async () => await import('./sync.fakes.mjs'));

const NOW = '2026-03-10T09:00:00.000Z';
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';
const T3 = '2026-01-04T00:00:00.000Z';
const person = (id, extra = {}) => ({ id, createdAt: T0, updatedAt: T1, name: 'Test Person', ...extra });
const rec = (id, extra = {}) => ({ id, createdAt: T0, updatedAt: T1, ...extra });
const tombAt = (store, id, at) => ({ id, store, deletedAt: at, createdAt: at, updatedAt: at });
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

beforeEach(() => {
  fake.resetFakes();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(NOW));
  // No sync setup unless a test adds one, so the sync asked for after an
  // answer does nothing.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('no network in tests');
  }));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('resolve: a record changed on both sides', () => {
  const b = person('p1', { city: 'Base', phone: '000' });
  const mine = { ...b, city: 'Mine', phone: '111', updatedAt: T2 };
  const theirs = { ...b, city: 'Theirs', updatedAt: T3 };
  const conflict = { kind: 'both', store: 'people', id: 'p1', mine, theirs, base: b, merged: { name: 'Test Person', city: 'Mine', phone: '111' }, clashes: ['city'], loud: ['city'], children: [] };
  const other = { kind: 'both', store: 'people', id: 'p2' };
  const sameIdOtherStore = { kind: 'both', store: 'ideas', id: 'p1' };
  const start = (data = { people: [mine] }, syncBase = { people: { p1: b, p9: person('p9') } }) => fake.useDevice(fake.makeDevice(data, { syncBase, syncConflicts: [other, conflict, sameIdOtherStore] }));

  it('keeps this device\'s value when "mine" is picked, saved as the newest copy', async () => {
    const device = start({ people: [person('p0', { updatedAt: T3 }), mine] });
    expect(await resolve(conflict, 'mine')).toEqual({ stale: false });
    expect(device.data.people).toEqual([person('p0', { updatedAt: T3 }), { ...b, city: 'Mine', phone: '111', updatedAt: NOW }]);
    expect(device.meta.syncBase).toEqual({ people: { p1: theirs, p9: person('p9') } });
    expect(device.meta.syncConflicts).toEqual([other, sameIdOtherStore]);
  });

  it('takes the shared value when "theirs" is picked, keeping the other changes', async () => {
    const device = start();
    await resolve(conflict, 'theirs');
    expect(device.data.people).toEqual([{ ...b, city: 'Theirs', phone: '111', updatedAt: NOW }]);
  });

  it('asks again later when the record changed here since the question came up', async () => {
    const device = start({ people: [{ ...mine, city: 'Changed again', updatedAt: '2026-03-01T00:00:00.000Z' }] });
    expect(await resolve(conflict, 'theirs')).toEqual({ stale: true });
    expect(device.data.people[0].city).toBe('Changed again');
    expect(device.meta.syncBase).toEqual({ people: { p1: b, p9: person('p9') } });
    expect(device.meta.syncConflicts).toEqual([other, sameIdOtherStore]);
    expect(fake.applySync).toHaveBeenCalledWith(Object.fromEntries(fake.STORE_NAMES.map((s) => [s, []])), Object.fromEntries(fake.STORE_NAMES.map((s) => [s, []])));
  });

  it('asks again later when the record was deleted here since', async () => {
    const device = start({});
    expect(await resolve(conflict, 'mine')).toEqual({ stale: true });
    expect(device.data.people).toEqual([]);
  });

  it('starts a last-agreed copy when there was none', async () => {
    const device = start({ people: [mine] }, null);
    await resolve(conflict, 'mine');
    expect(device.meta.syncBase).toEqual({ people: { p1: theirs } });
  });
});

describe('resolve: deleted in the shared file, changed here', () => {
  const b = person('p1', { city: 'Base' });
  const mine = { ...b, city: 'Changed', updatedAt: T2 };
  const tp = rec('t1', { personId: 'p1', note: 'coffee' });
  const nw = rec('n1', { personId: 'p1', text: 'news' });
  const gone = rec('l1', { personId: 'p1', text: 'deleted here since' });
  const conflict = {
    kind: 'deletedThere', store: 'people', id: 'p1', mine, theirs: null, tomb: tombAt('people', 'p1', T3), base: b,
    children: [
      { store: 'touchpoints', id: 't1', mine: tp, theirs: null, base: tp },
      { store: 'news', id: 'n1', mine: nw, theirs: nw, base: null },
      { store: 'openLoops', id: 'l1', mine: gone, theirs: null, base: null },
    ],
  };
  const start = () => fake.useDevice(fake.makeDevice(
    { people: [mine], touchpoints: [rec('t0', { personId: 'p7' }), tp], news: [nw], ideas: [rec('i1')] },
    { syncBase: { people: { p1: b }, touchpoints: { t1: tp, t2: rec('t2') } }, syncConflicts: [conflict] },
  ));

  it('"keep" saves this device\'s copies (person and children) as the newest', async () => {
    const device = start();
    expect(await resolve(conflict, 'keep')).toEqual({ stale: false });
    expect(device.data.people).toEqual([{ ...mine, updatedAt: NOW }]);
    expect(device.data.touchpoints).toEqual([rec('t0', { personId: 'p7' }), { ...tp, updatedAt: NOW }]);
    expect(device.data.news).toEqual([{ ...nw, updatedAt: NOW }]);
    // Nothing made up for a child that is gone here.
    expect(device.data.openLoops).toEqual([]);
    expect(device.data.tombstones).toEqual([]);
    expect(device.meta.syncBase).toEqual({ people: {}, touchpoints: { t2: rec('t2') }, news: {}, openLoops: {} });
    expect(device.meta.syncConflicts).toEqual([]);
  });

  it('"delete" deletes them here and leaves a dated deletion for each', async () => {
    const device = start();
    expect(await resolve(conflict, 'delete')).toEqual({ stale: false });
    expect(device.data.people).toEqual([]);
    expect(device.data.touchpoints).toEqual([rec('t0', { personId: 'p7' })]);
    expect(device.data.news).toEqual([]);
    expect(device.data.ideas).toEqual([rec('i1')]);
    expect(device.data.tombstones).toEqual([
      tombAt('people', 'p1', NOW), tombAt('touchpoints', 't1', NOW), tombAt('news', 'n1', NOW), tombAt('openLoops', 'l1', NOW),
    ]);
    expect(fake.applySync.mock.calls[0][1].openLoops).toEqual([]);
    expect(device.meta.syncBase).toEqual({ people: {}, touchpoints: { t2: rec('t2') }, news: {}, openLoops: {} });
  });

  it('works for a record with no children list', async () => {
    const c = { ...conflict, children: undefined };
    const device = fake.useDevice(fake.makeDevice({ people: [mine], touchpoints: [tp] }, { syncConflicts: [c] }));
    await resolve(c, 'delete');
    expect(device.data.people).toEqual([]);
    expect(device.data.touchpoints).toEqual([tp]);
    expect(device.data.tombstones).toEqual([tombAt('people', 'p1', NOW)]);
    expect(device.meta.syncBase).toEqual({ people: {} });
  });
});

describe('resolve: deleted here, changed in the shared file', () => {
  const b = person('p1', { city: 'Base' });
  const theirs = { ...b, city: 'Changed there', updatedAt: T2 };
  const tp = rec('t1', { personId: 'p1', note: 'their touchpoint' });
  const ptomb = tombAt('people', 'p1', T3);
  const conflict = {
    kind: 'deletedHere', store: 'people', id: 'p1', mine: null, theirs, tomb: ptomb, base: b,
    children: [
      { store: 'touchpoints', id: 't1', mine: null, theirs: tp, base: null },
      { store: 'news', id: 'n1', mine: rec('n1'), theirs: null, base: rec('n1') },
    ],
  };
  const start = (tombstones = [ptomb]) => fake.useDevice(fake.makeDevice(
    { tombstones, news: [rec('n1')] },
    { syncBase: { people: { p1: b }, news: { n1: rec('n1') } }, syncConflicts: [conflict] },
  ));

  it('"keep" brings back the shared copies and drops the deletions here', async () => {
    const device = start([ptomb, tombAt('touchpoints', 't1', T3), tombAt('ideas', 'i1', T3)]);
    expect(await resolve(conflict, 'keep')).toEqual({ stale: false });
    expect(device.data.people).toEqual([theirs]);
    expect(device.data.touchpoints).toEqual([tp]);
    expect(device.data.tombstones).toEqual([tombAt('ideas', 'i1', T3)]);
    // A child with no shared copy is left as it is.
    expect(device.data.news).toEqual([rec('n1')]);
    expect(device.meta.syncBase).toEqual({ people: { p1: theirs }, touchpoints: { t1: tp }, news: { n1: rec('n1') } });
    expect(device.meta.syncConflicts).toEqual([]);
  });

  it('"delete" keeps it deleted, adding a deletion only where there is none here', async () => {
    const other = tombAt('ideas', 'i1', T1);
    const device = start([other, ptomb]);
    expect(await resolve(conflict, 'delete')).toEqual({ stale: false });
    expect(device.data.people).toEqual([]);
    expect(device.data.tombstones).toEqual([other, ptomb, tombAt('touchpoints', 't1', NOW)]);
    expect(device.meta.syncBase).toEqual({ people: { p1: theirs }, touchpoints: { t1: tp }, news: { n1: rec('n1') } });
  });
});

describe('resolve: odd input', () => {
  it('only drops a clash of a kind it does not know', async () => {
    const c = { kind: 'mystery', store: 'people', id: 'p1', theirs: person('p1') };
    const device = fake.useDevice(fake.makeDevice({ people: [person('p1', { city: 'Here' })] }, { syncConflicts: [c] }));
    expect(await resolve(c, 'keep')).toEqual({ stale: false });
    expect(device.data.people).toEqual([person('p1', { city: 'Here' })]);
    expect(device.meta.syncConflicts).toEqual([]);
    expect(device.meta.syncBase).toEqual({});
  });

  it('copes with no saved clash list', async () => {
    const c = { kind: 'mystery', store: 'people', id: 'p1' };
    const device = fake.useDevice(fake.makeDevice());
    await resolve(c, 'keep');
    expect(device.meta.syncConflicts).toEqual([]);
    expect(await getConflicts()).toEqual([]);
  });

  it('passes a storage failure on, and later syncs still run', async () => {
    fake.useDevice(fake.makeDevice());
    fake.exportAll.mockRejectedValueOnce(new Error('Storage broke'));
    await expect(resolve({ kind: 'both', store: 'people', id: 'p1' }, 'mine')).rejects.toThrow('Storage broke');
    // No sync is asked for after a failed answer.
    expect(vi.getTimerCount()).toBe(0);
    expect(await queued()).toEqual({ off: true });
  });
});

describe('resolve: timing', () => {
  const c = { kind: 'mystery', store: 'people', id: 'p1' };

  it('asks for a sync once the answer is saved, so it goes out', async () => {
    const device = fake.useDevice(fake.makeDevice({}, { sync: { repo: fake.REPO, token: fake.KEY }, syncConflicts: [c] }));
    const gh = fake.makeGitHub();
    vi.stubGlobal('fetch', gh.fetch);
    await resolve(c, 'keep');
    expect(gh.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(gh.fetch).toHaveBeenCalled();
    expect(gh.puts).toHaveLength(1);
    expect(device.meta.sync.lastSyncAt).toBe(NOW);
  });

  it('waits for a sync under way before answering', async () => {
    const device = fake.useDevice(fake.makeDevice({}, { sync: { repo: fake.REPO, token: fake.KEY }, syncConflicts: [c] }));
    let release;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => {
      release = r;
    })));
    const sync = queued();
    const answer = resolve(c, 'keep');
    await flush();
    expect(device.meta.syncConflicts).toEqual([c]);
    release(fake.json({}, 401));
    await expect(sync).rejects.toMatchObject({ kind: 'auth' });
    await answer;
    expect(device.meta.syncConflicts).toEqual([]);
  });
});
